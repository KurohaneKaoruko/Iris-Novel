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
  type NovelTask,
  type TaskStatus,
} from '../../api/planner'
import { readText, writeText } from '../../api/backend'
import { createChapterFile } from '../../api/novel'
import { Icon } from '../../components/Icon'

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待执行',
  running: '进行中',
  blocked: '受阻',
  done: '已完成',
  retry: '待重试',
}

const STATUS_CYCLE: TaskStatus[] = ['todo', 'running', 'blocked', 'done', 'retry']

/**
 * 任务队列页签：AI 拆解写作目标 → 任务链管理 → 逐章生成正文。
 * 数据持久化在 .novel/tasks/run-queue.md（与旧桌面端格式兼容）。
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
  const runAbortRef = useRef(false)

  useEffect(() => {
    void loadRunQueue()
      .then((q) => {
        setTasks(q.tasks)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const persist = useCallback(async (next: NovelTask[]) => {
    setTasks(next)
    await saveRunQueue(null, next).catch(() => {})
  }, [])

  const startChapterN = Math.max(1, Number(startChapter) || 1)
  const countN = Math.max(1, Math.min(20, Number(count) || 3))
  const wordsN = Math.max(500, Math.min(20000, Number(targetWords) || 2000))

  /** AI 拆解 → 失败回退规则模板 */
  const planWithAI = useCallback(async () => {
    setPlanErr('')
    setPlanning(true)
    try {
      const { streamChat } = await import('../../api/writing')
      const handle = streamChat({
        prompt: buildTaskDraftPrompt(goal, startChapterN, countN, wordsN),
      })
      const raw = await handle.promise
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

  /** 逐章生成：读前章结尾做上下文 → streamChat 写正文 → 落盘 → 标 done → 下一章 */
  const runTask = useCallback(
    async (task: NovelTask) => {
      setRunningId(task.id)
      setRunLog('准备上下文…')
      runAbortRef.current = false
      try {
        const prevPath = `stories/chapter-${String(task.chapter_index - 1).padStart(4, '0')}.md`
        let prevTail = ''
        try {
          const prev = await readText(prevPath)
          prevTail = prev.slice(-1200)
        } catch { /* 首章无前文 */ }

        const charactersText = await readText('concept/characters.md').catch(() => '')
        const prompt = [
          charactersText ? `【人物设定】\n${charactersText.slice(0, 2500)}` : '',
          prevTail ? `【前章结尾（承接其情节与悬念）】\n${prevTail}` : '',
          `【本章任务】${task.title}`,
          task.task_prompt ? `【本章细纲】\n${task.task_prompt}` : '',
          task.acceptance_checks.length ? `【验收标准】\n${task.acceptance_checks.map((c) => `- ${c}`).join('\n')}` : '',
          `请写出本章完整正文，目标 ${task.target_words} 字左右。只输出正文。`,
        ]
          .filter(Boolean)
          .join('\n\n')

        setRunLog('AI 生成中……')
        const { streamChat } = await import('../../api/writing')
        const handle = streamChat({ prompt: prompt.trim() })
        const content = await handle.promise
        if (runAbortRef.current) return

        await writeText(task.scope, content)
        setRunLog(`已写入 ${task.scope}（${content.length} 字）`)

        const next = tasks.map((t) =>
          t.id === task.id ? { ...t, status: 'done' as TaskStatus, completed_at: new Date().toISOString() } : t,
        )
        await persist(next)

        // 章节索引登记（chapter-XXXX 已存在时 create 会失败，容忍）
        try {
          await createChapterFile(`第${task.chapter_index}章`)
        } catch { /* 文件已由 writeText 创建 */ }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setRunLog(`失败：${msg}`)
        await persist(tasks.map((t) => (t.id === task.id ? { ...t, status: 'retry' as TaskStatus, last_error: msg } : t)))
      } finally {
        setRunningId(null)
      }
    },
    [tasks, persist],
  )

  const runNext = useCallback(async () => {
    const t = nextExecutableTask(tasks)
    if (!t) return
    await runTask(t)
  }, [tasks, runTask])

  const runAll = useCallback(async () => {
    runAbortRef.current = false
    let guard = tasks.length + 2
    let current = tasks
    while (guard-- > 0) {
      if (runAbortRef.current) return
      const t = nextExecutableTask(current)
      if (!t) break
      // runTask 内部用 tasks state persist，需要串行等待
      await runTaskById(t)
      current = (await loadRunQueue()).tasks
      setTasks(current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

  // runAll 用直接读盘的版本避免闭包过期
  const runTaskById = useCallback(
    async (task: NovelTask) => {
      setRunningId(task.id)
      try {
        const prevPath = `stories/chapter-${String(task.chapter_index - 1).padStart(4, '0')}.md`
        let prevTail = ''
        try {
          const prev = await readText(prevPath)
          prevTail = prev.slice(-1200)
        } catch { /* 首章 */ }
        const charactersText = await readText('concept/characters.md').catch(() => '')
        const prompt = [
          charactersText ? `【人物设定】\n${charactersText.slice(0, 2500)}` : '',
          prevTail ? `【前章结尾】\n${prevTail}` : '',
          `【本章任务】${task.title}`,
          task.task_prompt ? `【本章细纲】\n${task.task_prompt}` : '',
          task.acceptance_checks.length ? `【验收标准】\n${task.acceptance_checks.map((c) => `- ${c}`).join('\n')}` : '',
          `请写出本章完整正文，目标 ${task.target_words} 字左右。只输出正文。`,
        ]
          .filter(Boolean)
          .join('\n\n')
        setRunLog(`生成 ${task.title}……`)
        const { streamChat } = await import('../../api/writing')
        const content = await streamChat({ prompt: prompt.trim() }).promise
        if (runAbortRef.current) return
        await writeText(task.scope, content)
        const q = await loadRunQueue()
        const next = q.tasks.map((t) =>
          t.id === task.id ? { ...t, status: 'done' as TaskStatus, completed_at: new Date().toISOString() } : t,
        )
        await saveRunQueue(null, next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setRunLog(`失败：${msg}`)
        const q = await loadRunQueue()
        await saveRunQueue(
          null,
          q.tasks.map((t) => (t.id === task.id ? { ...t, status: 'retry' as TaskStatus, last_error: msg } : t)),
        )
      }
    },
    [],
  )

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
            <button className="tools-run" disabled={runningId !== null || !next} onClick={() => void runAll()}>
              <Icon name="chevrons-right" size={13} />
              连续生成
            </button>
            {runningId !== null ? (
              <button
                className="tools-run"
                onClick={() => {
                  runAbortRef.current = true
                  handleCancelRunning()
                }}
              >
                <Icon name="x" size={13} />
                停止
              </button>
            ) : null}
          </div>
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
                  {t.last_error ? <div className="planner-taskerr">{t.last_error}</div> : null}
                </div>
                <div className="planner-taskops">
                  {t.status !== 'done' && runningId === null ? (
                    <button className="tools-run" onClick={() => void runTask(t)} title="生成本章正文">
                      <Icon name="pen-line" size={12} />
                      生成
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

  function handleCancelRunning() {
    // streamChat 的 handle 在 runTask/runTaskById 内部，这里通过 abort 标志让下一轮退出；
    // 进行中的 HTTP 由后端 cancel 通道处理：streamId 未知，直接依赖自然结束。
  }
}
