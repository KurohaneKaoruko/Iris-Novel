import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadRunQueue,
  saveRunQueue,
  nextExecutableTask,
  buildTaskDraftPrompt,
  draftTasksFromGoal,
  parseAiTasks,
  loadOutlineChapters,
  outlineToTasks,
  newTaskId,
  tasksToPlanMarkdown,
  type NovelTask,
  type TaskStatus,
} from '../../api/planner'
import { readText, writeText } from '../../api/backend'
import { syncChapterContent, loadWritingHistory, recordTodayWords } from '../../api/novel'
import { lintChapter, type LintIssue } from '../../api/lint'
import { streamStudio, type StudioHandle } from '../../api/studio'
import { loadStyleFingerprint, fingerprintText, type StyleFingerprint } from '../../api/stylefp'
import { Icon } from '../../components/Icon'

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待执行',
  running: '进行中',
  blocked: '受阻',
  done: '已完成',
  retry: '待重试',
}

const STATUS_CYCLE: TaskStatus[] = ['todo', 'running', 'blocked', 'done', 'retry']

/** 章节正文生成系统人设：只产出成品正文 */
const CHAPTER_SYSTEM =
  '你是 Iris-Creation 的专业中文小说写作引擎，为长篇项目逐章产出成品正文。' +
  '只输出正文本身：不要解释、不要前言结语、不要 Markdown 代码围栏、不要输出章节标题行。'

/** 组装逐章生成的用户提示词（人物卡 + 前章结尾 + 任务细纲 + 文风指纹） */
export function buildChapterPrompt(
  task: NovelTask,
  ctx: { charactersText?: string; prevTail?: string; fingerprint?: StyleFingerprint | null },
): string {
  const parts = [
    ctx.charactersText ? `【人物设定】\n${ctx.charactersText.slice(0, 2500)}` : '',
    ctx.prevTail ? `【前章结尾（承接其情节与悬念）】\n${ctx.prevTail}` : '',
    `【本章任务】${task.title}`,
    task.task_prompt ? `【本章细纲】\n${task.task_prompt}` : '',
    task.acceptance_checks.length ? `【验收标准】\n${task.acceptance_checks.map((c) => `- ${c}`).join('\n')}` : '',
    fingerprintText(ctx.fingerprint) ? `【${fingerprintText(ctx.fingerprint)}】` : '',
    `请写出本章完整正文，目标 ${task.target_words} 字左右。只输出正文。`,
  ]
  return parts.filter(Boolean).join('\n\n')
}

/** 生成质量闸门：一级套路（error）即不合格；返回空数组表示通过 */
export function gateIssues(content: string): LintIssue[] {
  return lintChapter(content).filter((i) => i.level === 'error')
}

/**
 * 任务队列页签：AI 拆解写作目标 → 任务链管理 → 逐章生成正文。
 * 数据持久化在 .novel/tasks/run-queue.md（与旧桌面端格式兼容）。
 * 生成走 studio 纯净补全通道（无 ReAct 工具循环），产出过 lint 一级套路闸门。
 */
export function PlannerTab({ onOpenFile }: { onOpenFile: (p: string) => void }) {
  const [tasks, setTasks] = useState<NovelTask[]>([])
  const [loaded, setLoaded] = useState(false)

  // 拆解表单
  const [goal, setGoal] = useState('')
  const [startChapter, setStartChapter] = useState('1')
  const [count, setCount] = useState('3')
  const [targetWords, setTargetWords] = useState('2000')
  const [planning, setPlanning] = useState(false)
  const [planErr, setPlanErr] = useState('')

  // 逐章生成
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runLog, setRunLog] = useState('')
  const [fp, setFp] = useState<StyleFingerprint | null>(null)
  const runAbortRef = useRef(false)
  const genHandleRef = useRef<StudioHandle | null>(null)

  useEffect(() => {
    void loadRunQueue()
      .then((q) => {
        setTasks(q.tasks)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    void loadStyleFingerprint().then(setFp)
  }, [])

  const persist = useCallback(async (next: NovelTask[]) => {
    setTasks(next)
    await saveRunQueue(null, next).catch(() => {})
  }, [])

  const startChapterN = Math.max(1, Number(startChapter) || 1)
  const countN = Math.max(1, Math.min(20, Number(count) || 3))
  const wordsN = Math.max(500, Math.min(20000, Number(targetWords) || 2000))

  /** AI 拆解 → 失败回退规则模板（同样走纯净补全通道） */
  const planWithAI = useCallback(async () => {
    setPlanErr('')
    setPlanning(true)
    try {
      const raw = await streamStudio({
        system: '你是小说项目的任务规划器，只输出 JSON 数组本身，不要解释、不要 Markdown 代码围栏。',
        user: buildTaskDraftPrompt(goal, startChapterN, countN, wordsN),
      }).promise
      const aiTasks = parseAiTasks(raw, startChapterN, countN, wordsN, goal)
      if (aiTasks && aiTasks.length > 0) {
        await persist(aiTasks)
      } else {
        // AI 输出不可解析 → 回退规则模板
        await persist(draftTasksFromGoal(goal, startChapterN, countN, wordsN))
        setPlanErr('AI 输出未能解析为任务链，已用规则模板生成（可手动编辑 scope 后重新拆解）')
      }
    } catch (e) {
      setPlanErr(`AI 拆解失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPlanning(false)
    }
  }, [goal, startChapterN, countN, wordsN, persist])

  /** 大纲导入：outline/*.md 的「第X章」条目 → 任务（按章号去重） */
  const importFromOutline = useCallback(async () => {
    setPlanErr('')
    try {
      const chapters = await loadOutlineChapters()
      if (chapters.length === 0) {
        setPlanErr('outline/ 下未找到「第X章」格式的章节条目')
        return
      }
      const next = outlineToTasks(chapters, tasks, wordsN)
      if (next.length === 0) {
        setPlanErr('大纲中的章节都已在队列中')
        return
      }
      await persist([...tasks, ...next])
    } catch (e) {
      setPlanErr(`大纲导入失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [tasks, wordsN, persist])

  const cycleStatus = useCallback(
    (id: string) => {
      const next = tasks.map((t) => {
        if (t.id !== id) return t
        const i = STATUS_CYCLE.indexOf(t.status)
        return { ...t, status: STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length] }
      })
      void persist(next)
    },
    [tasks, persist],
  )

  const removeTask = useCallback(
    (id: string) => {
      void persist(tasks.filter((t) => t.id !== id))
    },
    [tasks, persist],
  )

  // ==== 手动添加 / 编辑细纲 ====
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPrompt, setEditPrompt] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addPrompt, setAddPrompt] = useState('')

  const beginEdit = useCallback((t: NovelTask) => {
    setEditingId(t.id)
    setEditPrompt(t.task_prompt)
  }, [])

  const commitEdit = useCallback(() => {
    if (editingId === null) return
    void persist(tasks.map((t) => (t.id === editingId ? { ...t, task_prompt: editPrompt.trim() } : t)))
    setEditingId(null)
  }, [editingId, editPrompt, tasks, persist])

  const addTask = useCallback(() => {
    const title = addTitle.trim()
    if (!title) return
    const existingIdx = tasks.map((t) => t.chapter_index)
    const idx = existingIdx.length > 0 ? Math.max(...existingIdx) + 1 : startChapterN
    const id = newTaskId(idx)
    const task: NovelTask = {
      id,
      title,
      status: 'todo',
      priority: 'medium',
      depends_on: tasks.length > 0 ? [tasks[tasks.length - 1].id] : [],
      target_words: wordsN,
      scope: `stories/chapter-${String(idx).padStart(4, '0')}.md`,
      volume: 1,
      chapter_index: idx,
      acceptance_checks: [],
      arc_targets: [],
      foreshadow_refs: [],
      timeline_window: 'global',
      task_prompt: addPrompt.trim(),
      retries: 0,
    }
    void persist([...tasks, task])
    setAddOpen(false)
    setAddTitle('')
    setAddPrompt('')
  }, [addTitle, addPrompt, tasks, startChapterN, wordsN, persist])

  /** 批量重试：所有待重试任务 → 待执行（按依赖顺序自动推进） */
  const retryAll = useCallback(() => {
    const n = tasks.filter((t) => t.status === 'retry').length
    if (n === 0) return
    void persist(tasks.map((t) => (t.status === 'retry' ? { ...t, status: 'todo' as TaskStatus, last_error: undefined } : t)))
  }, [tasks, persist])
  const retryCount = tasks.filter((t) => t.status === 'retry').length

  /** 导出 Markdown 写作计划（浏览器下载） */
  const exportPlan = useCallback(() => {
    const md = tasksToPlanMarkdown(tasks, '写作计划')
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `writing-plan-${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [tasks])

  /**
   * 逐章生成核心（单章与连写共用）：上下文 → 纯净补全 → 质检 → 落盘 → 状态推进。
   * 状态读写都走磁盘队列（loadRunQueue/saveRunQueue），连写时闭包不过期。
   */
  const generateOne = useCallback(
    async (task: NovelTask): Promise<boolean> => {
      setRunningId(task.id)
      runAbortRef.current = false
      try {
        setRunLog(`准备上下文（${task.title}）…`)
        const prevPath = `stories/chapter-${String(task.chapter_index - 1).padStart(4, '0')}.md`
        let prevTail = ''
        try {
          const prev = await readText(prevPath)
          prevTail = prev.slice(-1200)
        } catch { /* 首章无前文 */ }
        const charactersText = await readText('concept/characters.md').catch(() => '')

        setRunLog(`AI 生成中（${task.title}）……`)
        const handle = streamStudio({
          system: CHAPTER_SYSTEM,
          user: buildChapterPrompt(task, { charactersText, prevTail, fingerprint: fp }),
          onToken: undefined,
        })
        genHandleRef.current = handle
        const content = await handle.promise
        if (runAbortRef.current) return false

        // 质检闸门：一级套路零容忍
        const issues = gateIssues(content)
        if (issues.length > 0) {
          const brief = issues.slice(0, 3).map((i) => i.rule).join('、')
          const msg = `质检未通过：命中一级套路 ${issues.length} 处（${brief}），本章已标待重试；建议调整附加要求后重新生成`
          setRunLog(msg)
          const q = await loadRunQueue()
          await saveRunQueue(
            null,
            q.tasks.map((t) => (t.id === task.id ? { ...t, status: 'retry' as TaskStatus, last_error: msg } : t)),
          )
          return false
        }

        // 写作统计闭环：逐章生成的产出也按日累计（写入前先取旧字数算差值）
        const before = await readText(task.scope).then((c) => c.replace(/\s/g, '').length).catch(() => 0)
        await writeText(task.scope, content)
        // 章节元数据同步（文件已存在则只更新字数；不存在则登记）
        await syncChapterContent(task.scope, content).catch(() => {})
        {
          const delta = Math.max(0, content.replace(/\s/g, '').length - before)
          if (delta > 0) {
            const { dailyGoal } = await loadWritingHistory()
            await recordTodayWords(delta, dailyGoal).catch(() => {})
          }
        }
        setRunLog(`已写入 ${task.scope}（${content.length} 字，质检通过）`)

        const q = await loadRunQueue()
        await saveRunQueue(
          null,
          q.tasks.map((t) =>
            t.id === task.id ? { ...t, status: 'done' as TaskStatus, completed_at: new Date().toISOString() } : t,
          ),
        )
        return true
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setRunLog(`失败：${msg}`)
        const q = await loadRunQueue()
        await saveRunQueue(
          null,
          q.tasks.map((t) => (t.id === task.id ? { ...t, status: 'retry' as TaskStatus, last_error: msg } : t)),
        )
        return false
      } finally {
        genHandleRef.current = null
        setRunningId(null)
      }
    },
    [fp],
  )

  const runTask = useCallback(
    async (task: NovelTask) => {
      await generateOne(task)
      setTasks((await loadRunQueue().catch(() => ({ tasks: [] as NovelTask[] }))).tasks)
    },
    [tasks, generateOne],
  )

  const runNext = useCallback(async () => {
    const t = nextExecutableTask(tasks)
    if (!t) return
    await generateOne(t)
    setTasks((await loadRunQueue().catch(() => ({ tasks: [] as NovelTask[] }))).tasks)
  }, [tasks, generateOne])

  const runAll = useCallback(async () => {
    let guard = tasks.length + 2
    let current = tasks
    while (guard-- > 0) {
      if (runAbortRef.current) return
      const t = nextExecutableTask(current)
      if (!t) break
      const ok = await generateOne(t)
      current = (await loadRunQueue()).tasks
      setTasks(current)
      // 质检不过/失败即停，避免连烧后续章节
      if (!ok) return
    }
  }, [tasks, generateOne])

  const stopAll = useCallback(() => {
    runAbortRef.current = true
    genHandleRef.current?.cancel()
  }, [])

  if (!loaded) return <div className="tools-loading">加载队列…</div>

  const doneCount = tasks.filter((t) => t.status === 'done').length
  const next = nextExecutableTask(tasks)

  return (
    <div className="planner-wrap">
      {/* 拆解表单 */}
      <div className="planner-plan">
        <div className="planner-plan-row">
          <input
            className="planner-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="写作目标：一句话描述要推进的剧情，如「林晚秋查明电台秘密，与神秘人正面接触」"
            spellCheck={false}
          />
        </div>
        <div className="planner-plan-row">
          <label className="planner-mini">
            起始章
            <input className="planner-num" type="number" min={1} value={startChapter} onChange={(e) => setStartChapter(e.target.value)} />
          </label>
          <label className="planner-mini">
            章数
            <input className="planner-num" type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />
          </label>
          <label className="planner-mini">
            每章字数
            <input className="planner-num" type="number" min={500} step={100} value={targetWords} onChange={(e) => setTargetWords(e.target.value)} />
          </label>
          <button className="tools-run primary" disabled={planning} onClick={() => void planWithAI()}>
            {planning ? <><Icon name="clock" size={13} />拆解中…</> : <><Icon name="sparkles" size={13} />AI 拆解任务链</>}
          </button>
          <button className="tools-run" disabled={planning} onClick={() => void importFromOutline()} title="从 outline/*.md 的「第X章」条目导入">
            <Icon name="download" size={13} />
            从大纲导入
          </button>
        </div>
        {fp ? (
          <div className="planner-fp" title={fingerprintText(fp)}>
            <Icon name="pen-line" size={12} />
            已启用范文文风指纹（创作工坊学习）
          </div>
        ) : null}
        {planErr ? <div className="planner-err">{planErr}</div> : null}
      </div>

      {/* 队列 */}
      {tasks.length > 0 ? (
        <>
          <div className="planner-bar">
            <span className="planner-progress">
              {doneCount}/{tasks.length} 完成
            </span>
            <div className="planner-progressbar">
              <div style={{ width: `${Math.round((doneCount / tasks.length) * 100)}%` }} />
            </div>
            <button className="tools-run" disabled={runningId !== null || !next} onClick={() => void runNext()}>
              <Icon name="pen-line" size={13} />
              生成下一章
            </button>
            <button className="tools-run" disabled={runningId !== null || !next} onClick={() => void runAll()} title="按依赖链串行生成全部任务；质检不过即停">
              <Icon name="chevrons-right" size={13} />
              连续生成
            </button>
            {runningId !== null ? (
              <button className="tools-run" onClick={stopAll}>
                <Icon name="x" size={13} />
                停止
              </button>
            ) : null}
            <span style={{ flex: 1 }} />
            {retryCount > 0 && runningId === null ? (
              <button className="tools-run" onClick={retryAll} title={`把 ${retryCount} 个待重试任务重置为待执行`}>
                <Icon name="refresh" size={13} />
                重试全部（{retryCount}）
              </button>
            ) : null}
            {runningId === null ? (
              <button className="tools-run" onClick={() => setAddOpen((v) => !v)} title="手动添加一个章节任务到队列末尾">
                <Icon name="plus" size={13} />
                添加任务
              </button>
            ) : null}
            <button className="tools-run" onClick={exportPlan} title="导出 Markdown 写作计划（进度概览 + 逐章任务细纲）">
              <Icon name="download" size={13} />
              导出计划
            </button>
          </div>
          {addOpen ? (
            <div className="planner-addrow">
              <input
                className="planner-goal"
                style={{ flex: 2 }}
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="任务标题，如「第 8 章 · 灯塔下的对峙」"
                spellCheck={false}
              />
              <input
                className="planner-goal"
                style={{ flex: 3 }}
                value={addPrompt}
                onChange={(e) => setAddPrompt(e.target.value)}
                placeholder="本章细纲（可选）：剧情推进 / 出场人物 / 章末钩子"
                spellCheck={false}
              />
              <button className="tools-run primary" disabled={!addTitle.trim()} onClick={addTask}>
                <Icon name="check" size={13} />
                加入队列
              </button>
              <button className="tools-run" onClick={() => setAddOpen(false)}>
                取消
              </button>
            </div>
          ) : null}
          {runLog ? <div className="planner-log">{runLog}</div> : null}
          <div className="planner-list">
            {tasks.map((t) => (
              <div key={t.id} className={`planner-task st-${t.status}${runningId === t.id ? ' running' : ''}`}>
                <button className="planner-status" onClick={() => cycleStatus(t.id)} title="点击切换状态">
                  {STATUS_LABEL[t.status]}
                </button>
                <div className="planner-taskmain">
                  <div className="planner-tasktitle">
                    {t.title}
                    <span className="planner-taskmeta">
                      第 {t.chapter_index} 章 · {t.target_words} 字{t.arc_targets.length ? ` · ${t.arc_targets.join('/')}` : ''}
                    </span>
                  </div>
                  {editingId === t.id ? (
                    <div className="planner-editrow">
                      <textarea
                        className="planner-editprompt"
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        placeholder="本章细纲：剧情推进 / 出场人物 / 章末钩子"
                        rows={3}
                        spellCheck={false}
                      />
                      <div className="planner-editops">
                        <button className="tools-run" onClick={commitEdit} disabled={!editPrompt.trim()}>
                          <Icon name="check" size={12} />
                          保存细纲
                        </button>
                        <button className="tools-run" onClick={() => setEditingId(null)}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {t.task_prompt ? <div className="planner-taskprompt">{t.task_prompt}</div> : null}
                      {t.last_error ? <div className="planner-taskerr">{t.last_error}</div> : null}
                    </>
                  )}
                </div>
                <div className="planner-taskops">
                  {t.status !== 'done' && runningId === null ? (
                    <button className="tools-run" onClick={() => void runTask(t)} title="生成本章正文">
                      <Icon name="pen-line" size={12} />
                      生成
                    </button>
                  ) : null}
                  {editingId !== t.id ? (
                    <button className="tools-run" onClick={() => beginEdit(t)} title="编辑本章细纲">
                      <Icon name="square-pen" size={12} />
                    </button>
                  ) : null}
                  {t.status === 'done' ? (
                    <button className="tools-run" onClick={() => onOpenFile(t.scope)} title="打开章节文件">
                      <Icon name="file" size={12} />
                      打开
                    </button>
                  ) : null}
                  <button className="tools-run" onClick={() => removeTask(t.id)} title="从队列移除">
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="planner-empty">
          <Icon name="list-checks" size={26} />
          <p>还没有任务队列</p>
          <p className="planner-empty-sub">输入写作目标用 AI 拆解，或从 outline/ 大纲导入「第X章」条目</p>
        </div>
      )}
    </div>
  )
}
