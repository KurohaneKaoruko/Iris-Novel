import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadRunQueue, saveRunQueue, nextExecutableTask, draftTasksFromGoal, newTaskId,
  parseAiTasks, buildTaskDraftPrompt,
  type NovelTask, type RunQueueState, type TaskStatus,
} from '../../api/planner'
import { readText, writeText } from '../../api/backend'
import { generateStream, streamChat, type GenerateHandle } from '../../api/writing'
import './PlannerPanel.css'

type Props = {
  assistantId: string | null
  onError: (msg: string | null) => void
  onOpenFile: (path: string) => void
  /** 任务开始/完成后外部刷新（章节字数等） */
  onRefresh: () => void
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: '待办',
  running: '执行中',
  blocked: '受阻',
  done: '完成',
  retry: '重试',
}

/**
 * 规划队列面板：总纲阅读 → 目标拆解为章节任务链 → 逐任务 AI 续写并落盘 →
 * 状态流转与连续性记录。数据存 .novel/tasks/run-queue.md（与旧桌面端兼容）。
 */
export function PlannerPanel({ assistantId, onError, onOpenFile, onRefresh }: Props) {
  const [queue, setQueue] = useState<RunQueueState | null>(null)
  const [goal, setGoal] = useState('')
  const [count, setCount] = useState(3)
  const [startChapter, setStartChapter] = useState(1)
  const [targetWords, setTargetWords] = useState(2000)
  const [runningTask, setRunningTask] = useState<string | null>(null)
  const [runOutput, setRunOutput] = useState('')
  const [aiDrafting, setAiDrafting] = useState(false)
  const aiDraftRef = useRef<GenerateHandle | null>(null)

  const reload = useCallback(async () => {
    setQueue(await loadRunQueue().catch(() => null))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const persist = useCallback(
    async (mode: RunQueueState['mode'], tasks: NovelTask[]) => {
      await saveRunQueue(mode, tasks)
      await reload()
    },
    [reload],
  )

  const draft = async () => {
    const tasks = draftTasksFromGoal(goal.trim(), startChapter, Math.min(20, Math.max(1, count)), targetWords)
    await persist('plan', tasks)
  }

  /** AI 拆解：流式生成任务链 JSON，解析失败回退规则模板并提示 */
  const draftWithAi = async () => {
    const n = Math.min(20, Math.max(1, count))
    const g = goal.trim()
    setAiDrafting(true)
    setRunOutput('')
    try {
      const handle = streamChat({
        prompt: buildTaskDraftPrompt(g || '推进主线剧情', startChapter, n, targetWords),
        assistantId,
        onToken: (full) => setRunOutput(full.slice(-600)),
      })
      aiDraftRef.current = handle
      const raw = await handle.promise
      const tasks = parseAiTasks(raw, startChapter, n, targetWords, g)
      if (tasks && tasks.length > 0) {
        await persist('plan', tasks)
        onError(null)
      } else {
        onError('AI 输出无法解析为任务链，已回退规则模板')
        await draft()
      }
    } catch (e) {
      onError(`AI 拆解失败（${e instanceof Error ? e.message : String(e)}），已回退规则模板`)
      await draft()
    } finally {
      setAiDrafting(false)
      setRunOutput('')
    }
  }

  const addTask = async () => {
    if (!queue) return
    const title = window.prompt('任务标题（如：第 4 章 · 雨夜追逐）')
    if (!title?.trim()) return
    const maxIdx = queue.tasks.reduce((m, t) => Math.max(m, t.chapter_index), 0)
    const task: NovelTask = {
      id: newTaskId(maxIdx + 1),
      title: title.trim(),
      status: 'todo',
      priority: 'medium',
      depends_on: [],
      target_words: targetWords,
      scope: `stories/chapter-${String(maxIdx + 1).padStart(4, '0')}.md`,
      volume: 1,
      chapter_index: maxIdx + 1,
      acceptance_checks: [`字数 ≥ ${targetWords}`],
      arc_targets: [],
      foreshadow_refs: [],
      timeline_window: 'global',
      task_prompt: '',
      retries: 0,
    }
    await persist(queue.mode, [...queue.tasks, task])
  }

  const setStatus = async (taskId: string, status: TaskStatus) => {
    if (!queue) return
    const tasks = queue.tasks.map((t) =>
      t.id === taskId
        ? { ...t, status, completed_at: status === 'done' ? new Date().toISOString() : undefined }
        : t,
    )
    await persist(queue.mode, tasks)
  }

  const removeTask = async (taskId: string) => {
    if (!queue || !window.confirm('确认删除该任务？')) return
    await persist(queue.mode, queue.tasks.filter((t) => t.id !== taskId))
  }

  /** 执行单个任务：读总纲+人物卡为上下文 → AI 生成正文 → 写入 scope 文件 → 标记完成 */
  const runTask = useCallback(
    async (task: NovelTask) => {
      if (runningTask) return
      setRunningTask(task.id)
      setRunOutput('')
      try {
        // 1) 标记执行中
        if (queue) {
          await persist(queue.mode, queue.tasks.map((t) => (t.id === task.id ? { ...t, status: 'running' } : t)))
        }
        // 2) 组装上下文
        const [masterPlan, characters, prevChapter] = await Promise.all([
          readText('.novel/plans/master-plan.md').catch(() => ''),
          readText('concept/characters.md').catch(() => ''),
          readText(task.scope).catch(() => ''),
        ])
        const ctxParts: string[] = []
        if (masterPlan.trim()) ctxParts.push(`【总纲】\n${masterPlan.slice(0, 2500)}`)
        if (characters.trim()) ctxParts.push(`【人物卡】\n${characters.slice(0, 2500)}`)
        if (prevChapter.trim()) ctxParts.push(`【本章已有内容（请续写而非重写）】\n${prevChapter}`)
        const prompt = [
          ...ctxParts,
          `【任务】${task.title}`,
          task.task_prompt ? `【任务要求】${task.task_prompt}` : '',
          `【验收标准】\n${task.acceptance_checks.map((c) => `- ${c}`).join('\n')}`,
          `请写出正文，目标 ${task.target_words} 字。只输出正文内容。`,
        ]
          .filter(Boolean)
          .join('\n\n')

        // 3) 流式生成
        const handle = generateStream({
          mode: 'chapter-outline', // 仅占位；真实 prompt 已完整构建，用 polish 的透传通道
          promptInput: { chapterContent: prompt, chapterTitle: task.title },
          assistantId,
          onToken: (t) => setRunOutput(t),
        })
        // 直接覆盖 prompt：writing.ts 的 buildPrompt 不适合 planner，走最简透传
        const text = await handle.promise

        // 4) 写盘 + 状态流转
        const existing = await readText(task.scope).catch(() => '')
        const next = existing.trim()
          ? `${existing.trimEnd()}\n\n${text.trim()}\n`
          : `# ${task.title}\n\n${text.trim()}\n`
        await writeText(task.scope, next)
        if (queue) {
          await persist(
            queue.mode,
            queue.tasks.map((t) =>
              t.id === task.id ? { ...t, status: 'done', completed_at: new Date().toISOString(), last_error: undefined } : t,
            ),
          )
        }
        onRefresh()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (queue) {
          await persist(
            queue.mode,
            queue.tasks.map((t) =>
              t.id === task.id ? { ...t, status: 'retry', retries: t.retries + 1, last_error: msg.slice(0, 300) } : t,
            ),
          ).catch(() => {})
        }
        onError(`任务执行失败：${msg}`)
      } finally {
        setRunningTask(null)
      }
    },
    [assistantId, onError, onRefresh, persist, queue, runningTask],
  )

  if (!queue) {
    return <div className="panel-empty">规划队列加载失败或尚未初始化</div>
  }

  const next = nextExecutableTask(queue.tasks)
  const doneCount = queue.tasks.filter((t) => t.status === 'done').length

  return (
    <div className="panel-section planner-panel">
      <div className="panel-head">
        <span>规划队列（{doneCount}/{queue.tasks.length}）</span>
        <button onClick={() => void addTask()} title="手动加任务">＋</button>
      </div>

      {/* 拆解器 */}
      <div className="planner-draft">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="写作目标（如：主角进入剑冢试炼）"
        />
        <div className="planner-draft-row">
          <label>起始章 <input type="number" min={1} value={startChapter} onChange={(e) => setStartChapter(Number(e.target.value) || 1)} /></label>
          <label>章数 <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} /></label>
          <label>每章字数 <input type="number" min={500} step={500} value={targetWords} onChange={(e) => setTargetWords(Number(e.target.value) || 2000)} /></label>
        </div>
        <div className="planner-draft-actions">
          <button className="planner-draft-btn" onClick={() => {
            if (queue.tasks.length > 0 && !window.confirm('将覆盖现有队列，确认？')) return
            void draft()
          }}>
            模板生成
          </button>
          <button
            className="planner-draft-btn planner-draft-btn-ai"
            disabled={aiDrafting}
            onClick={() => {
              if (queue.tasks.length > 0 && !window.confirm('AI 将覆盖现有队列，确认？')) return
              void draftWithAi()
            }}
          >
            {aiDrafting ? 'AI 拆解中…' : 'AI 拆解'}
          </button>
          {aiDrafting && (
            <button className="planner-draft-btn" onClick={() => aiDraftRef.current?.cancel()}>取消</button>
          )}
        </div>
        {aiDrafting && runOutput && <pre className="planner-run-output">{runOutput}</pre>}
      </div>

      {/* 下一个可执行 */}
      {next ? (
        <div className="planner-next">
          <span className="planner-next-label">下一可执行</span>
          <span className="planner-next-title">{next.title}</span>
          <button disabled={!!runningTask} onClick={() => void runTask(next)}>▶ 执行</button>
        </div>
      ) : queue.tasks.length > 0 ? (
        <div className="planner-next all-done">全部任务已完成</div>
      ) : null}

      {/* 运行输出 */}
      {runningTask ? (
        <div className="planner-run">
          <div className="planner-run-head">执行中：{queue.tasks.find((t) => t.id === runningTask)?.title}</div>
          <pre className="planner-run-body">{runOutput}</pre>
        </div>
      ) : null}

      {/* 任务列表 */}
      {queue.tasks.map((t) => (
        <div key={t.id} className={`planner-task status-${t.status}`}>
          <div className="planner-task-row">
            <span className={`planner-status status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
            <span className="planner-task-title" onClick={() => onOpenFile(t.scope)} title={t.scope}>
              {t.title}
            </span>
            <span className="file-actions">
              {t.id !== runningTask ? (
                <button title="执行此任务" onClick={() => void runTask(t)}>▶</button>
              ) : null}
              <button title="标记完成" onClick={() => void setStatus(t.id, 'done')}>✓</button>
              <button title="删除" onClick={() => void removeTask(t.id)}>✕</button>
            </span>
          </div>
          <div className="planner-task-meta">
            {t.scope} · {t.target_words} 字
            {t.depends_on.length > 0 ? ` · 依赖 ${t.depends_on.join(',')}` : ''}
            {t.retries > 0 ? ` · 重试 ${t.retries}` : ''}
          </div>
          {t.last_error ? <div className="planner-task-error">{t.last_error}</div> : null}
        </div>
      ))}
      {queue.tasks.length === 0 ? <div className="panel-empty">队列空。填写作目标后「生成任务链」。</div> : null}
    </div>
  )
}
