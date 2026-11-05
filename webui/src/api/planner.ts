/**
 * 规划队列（Planner）：.novel/tasks/run-queue.md JSON frontmatter 格式，
 * 与旧桌面端 NovelPlannerService 序列化完全兼容（可互相读取）。
 */
import { readText, writeText } from './backend'

export type WriterMode = 'normal' | 'plan' | 'spec'
export type TaskStatus = 'todo' | 'running' | 'blocked' | 'done' | 'retry'

export type NovelTask = {
  id: string
  title: string
  status: TaskStatus
  priority: 'low' | 'medium' | 'high'
  depends_on: string[]
  target_words: number
  scope: string
  volume: number
  chapter_index: number
  acceptance_checks: string[]
  arc_targets: string[]
  foreshadow_refs: string[]
  timeline_window: string
  task_prompt: string
  retries: number
  last_error?: string
  completed_at?: string
}

export type RunQueueState = { mode: WriterMode | null; tasks: NovelTask[] }

const RUN_QUEUE_PATH = '.novel/tasks/run-queue.md'

function parseFrontMatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { meta: {}, body: raw }
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) return { meta: {}, body: raw }
  const headerRaw = normalized.slice(4, end).trim()
  const body = normalized.slice(end + 5).trim()
  try {
    return { meta: JSON.parse(headerRaw) as Record<string, unknown>, body }
  } catch {
    return { meta: {}, body }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sanitizeTask(v: unknown): NovelTask | null {
  if (!isRecord(v)) return null
  const id = typeof v.id === 'string' ? v.id.trim() : ''
  const title = typeof v.title === 'string' ? v.title.trim() : ''
  if (!id || !title) return null
  const statusRaw = typeof v.status === 'string' ? v.status : 'todo'
  const status: TaskStatus =
    statusRaw === 'running' || statusRaw === 'blocked' || statusRaw === 'done' || statusRaw === 'retry'
      ? statusRaw
      : 'todo'
  const priorityRaw = typeof v.priority === 'string' ? v.priority : 'medium'
  const priority: 'low' | 'medium' | 'high' = priorityRaw === 'low' || priorityRaw === 'high' ? priorityRaw : 'medium'
  const num = (x: unknown, min: number, fallback: number) => {
    const n = Number(x)
    return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : fallback
  }
  const strArr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
  return {
    id,
    title,
    status,
    priority,
    depends_on: strArr(v.depends_on),
    target_words: num(v.target_words, 500, 2000),
    scope: typeof v.scope === 'string' && v.scope.trim() ? v.scope.trim() : `stories/${id}.md`,
    volume: num(v.volume, 1, 1),
    chapter_index: num(v.chapter_index, 1, 1),
    acceptance_checks: strArr(v.acceptance_checks),
    arc_targets: strArr(v.arc_targets),
    foreshadow_refs: strArr(v.foreshadow_refs),
    timeline_window: typeof v.timeline_window === 'string' ? v.timeline_window : 'global',
    task_prompt: typeof v.task_prompt === 'string' ? v.task_prompt.trim() : '',
    retries: num(v.retries, 0, 0),
    last_error: typeof v.last_error === 'string' ? v.last_error : undefined,
    completed_at: typeof v.completed_at === 'string' ? v.completed_at : undefined,
  }
}

export async function loadRunQueue(): Promise<RunQueueState> {
  let raw = ''
  try {
    raw = await readText(RUN_QUEUE_PATH)
  } catch {
    return { mode: null, tasks: [] }
  }
  const { meta } = parseFrontMatter(raw)
  const modeRaw = typeof meta.mode === 'string' ? meta.mode : ''
  const mode: WriterMode | null = modeRaw === 'normal' || modeRaw === 'plan' || modeRaw === 'spec' ? modeRaw : null
  const rawTasks = Array.isArray(meta.tasks) ? meta.tasks : []
  return { mode, tasks: rawTasks.map(sanitizeTask).filter((v): v is NovelTask => v !== null) }
}

export async function saveRunQueue(mode: WriterMode | null, tasks: NovelTask[]): Promise<void> {
  const meta = {
    id: 'run-queue',
    mode,
    updated_at: new Date().toISOString(),
    total: tasks.length,
    tasks,
  }
  const lines: string[] = ['# Run Queue', '', `总任务数：${tasks.length}`, '']
  for (const t of tasks) {
    const checked = t.status === 'done' ? 'x' : ' '
    lines.push(`- [${checked}] ${t.id} ${t.title} (${t.scope}, ${t.target_words}字, ${t.status})`)
  }
  const body = lines.join('\n')
  await writeText(RUN_QUEUE_PATH, `---\n${JSON.stringify(meta, null, 2)}\n---\n\n${body}\n`)
}

/** 依赖已完成的下一个可执行任务（与旧端 getNextExecutableTask 一致） */
export function nextExecutableTask(tasks: NovelTask[]): NovelTask | null {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  for (const t of tasks) {
    if (t.status !== 'todo' && t.status !== 'retry') continue
    if (t.depends_on.every((dep) => done.has(dep))) return t
  }
  return null
}

let seq = 0
export function newTaskId(chapterIndex: number): string {
  seq += 1
  return `ch${String(chapterIndex).padStart(3, '0')}-${Date.now().toString(36)}-${seq}`
}

/** 用 AI 从一句写作目标生成任务队列草稿（规则模板，无需 API Key；后续可换 AI 生成） */
export function draftTasksFromGoal(goal: string, startChapter: number, count: number, targetWords: number): NovelTask[] {
  const tasks: NovelTask[] = []
  for (let i = 0; i < count; i++) {
    const idx = startChapter + i
    const id = `ch${String(idx).padStart(3, '0')}`
    tasks.push({
      id,
      title: `${goal || '推进主线'} · 第 ${idx} 章`,
      status: 'todo',
      priority: i === 0 ? 'high' : 'medium',
      depends_on: i === 0 ? [] : [tasks[i - 1].id],
      target_words: targetWords,
      scope: `stories/chapter-${String(idx).padStart(4, '0')}.md`,
      volume: 1,
      chapter_index: idx,
      acceptance_checks: [
        `字数 ≥ ${targetWords}`,
        '承接前章伏笔且不与人物状态索引冲突',
        '章末有钩子',
      ],
      arc_targets: [],
      foreshadow_refs: [],
      timeline_window: 'global',
      task_prompt: goal ? `围绕「${goal}」写第 ${idx} 章。` : '',
      retries: 0,
    })
  }
  return tasks
}
