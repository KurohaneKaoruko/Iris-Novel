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
  // 确保 .novel/tasks/ 目录存在（新建工程可能没有；已存在时报错被吞掉）
  const { createDir } = await import('./backend')
  await createDir('.novel/tasks').catch(() => {})
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

/** 从 AI 回复中提取 JSON 数组（容忍 ```json 围栏与前后杂text） */
export function extractJsonArray(raw: string): unknown[] | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = fenced ? fenced[1] : raw
  // 杂文本里可能混入无关的 [，从每个 [ 起尝试解析，取第一个成功的
  let from = text.indexOf('[')
  while (from >= 0) {
    const end = text.lastIndexOf(']')
    if (end > from) {
      try {
        const parsed: unknown = JSON.parse(text.slice(from, end + 1))
        if (Array.isArray(parsed)) return parsed
      } catch {
        /* 尝试下一个 [ */
      }
    }
    from = text.indexOf('[', from + 1)
  }
  return null
}

/**
 * AI 拆解写作目标为任务链。输出经 sanitizeTask 严格清洗（与 run-queue 持久化同一防线）；
 * id/依赖链按顺序重建（AI 生成的依赖不可信），解析失败或空结果返回 null（调用方回退模板）。
 */
export function parseAiTasks(
  raw: string,
  startChapter: number,
  count: number,
  targetWords: number,
  goal: string,
): NovelTask[] | null {
  const arr = extractJsonArray(raw)
  if (!arr || arr.length === 0) return null
  const slice = arr.slice(0, Math.max(1, Math.min(20, count)))
  const tasks: NovelTask[] = []
  for (let i = 0; i < slice.length; i++) {
    const idx = startChapter + i
    // AI 输出无 id 字段：注入占位 id 以通过 sanitizeTask 的持久化格式防线（随后被重建覆盖）
    const raw0 = slice[i]
    const item = isRecord(raw0) ? { id: `tmp-${i}`, ...raw0 } : null
    const sanitized = item ? sanitizeTask(item) : null
    if (!sanitized) continue
    // id 与依赖链按顺序重建：AI 的 id/depends_on 不作为持久化依据
    const id = `ch${String(idx).padStart(3, '0')}`
    tasks.push({
      ...sanitized,
      id,
      status: 'todo',
      priority: i === 0 ? 'high' : 'medium',
      depends_on: i === 0 ? [] : [tasks[i - 1].id],
      target_words: sanitized.target_words || targetWords,
      scope: `stories/chapter-${String(idx).padStart(4, '0')}.md`,
      volume: 1,
      chapter_index: idx,
      retries: 0,
    })
  }
  if (tasks.length === 0) return null
  // 保证每条任务有可用的提示词
  for (const t of tasks) {
    if (!t.task_prompt) t.task_prompt = goal ? `围绕「${goal}」写第 ${t.chapter_index} 章。` : ''
  }
  return tasks
}

/** AI 任务链拆解提示词：要求严格 JSON 输出，字段与 run-queue 任务对齐 */
export function buildTaskDraftPrompt(goal: string, startChapter: number, count: number, targetWords: number): string {
  return [
    `你是小说项目的任务规划器。请把以下写作目标拆解为 ${count} 个连续章节的写作任务链。`,
    ``,
    `【写作目标】${goal || '推进主线剧情'}`,
    `【起始章节】第 ${startChapter} 章`,
    `【每章目标字数】约 ${targetWords} 字`,
    ``,
    `只输出 JSON 数组（不要任何解释或围栏），每个元素包含：`,
    `- "title": 章节任务标题（如「第 ${startChapter} 章 · 雨夜追击」，含冲突与钩子）`,
    `- "chapter_index": 章节序号（从 ${startChapter} 递增）`,
    `- "task_prompt": 该章写作提示词，一句话说明本章要完成的剧情推进、出场人物、章末钩子`,
    `- "acceptance_checks": 2-3 条验收标准（字数、承接前章、人物一致性等）`,
    `- "arc_targets": 本章推进的情节线名称数组（可为空）`,
    `- "foreshadow_refs": 本章埋设/回收的伏笔名称数组（可为空）`,
    `- "timeline_window": 时间窗（如「第 3 日夜」或「global」）`,
  ].join('\n')
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

// ============ 大纲 → 任务链导入 ============

export type OutlineChapter = {
  /** 章节序号（中文数字已转阿拉伯；解析不出时为 0） */
  chapterIndex: number
  /** 标题（含「第X章」前缀原文） */
  heading: string
  /** 标题下的细纲正文 */
  body: string
}

const OUTLINE_HEADING_RE = /^\s*(?:#+\s*)?第\s*([0-9一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖]+)\s*(章|回|节)\s*[:：]?\s*(.*)$/

/** 从大纲文本抽取章节条目：`第X章 标题` 行 + 后续正文直到下一个标题 */
export function parseOutlineChapters(text: string): OutlineChapter[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: OutlineChapter[] = []
  let cur: OutlineChapter | null = null
  const flush = () => {
    if (cur) {
      cur.body = cur.body.trim()
      out.push(cur)
    }
  }
  for (const line of lines) {
    const m = line.match(OUTLINE_HEADING_RE)
    if (m && line.trim().length <= 80) {
      flush()
      cur = { chapterIndex: cnNum(m[1]), heading: line.trim(), body: '' }
      continue
    }
    if (cur && line.trim()) {
      cur.body += (cur.body ? '\n' : '') + line.trim()
    }
  }
  flush()
  return out
}

function cnNum(s: string): number {
  if (/^\d+$/.test(s)) return Number(s)
  const norm = s.replace(/[壹贰叁肆伍陆柒捌玖]/g, (c) => '一二三四五六七八九'['壹贰叁肆伍陆柒捌玖'.indexOf(c)]).replace(/[佰仟拾]/g, (c) => ({ 佰: '百', 仟: '千', 拾: '十' })[c] ?? c)
  const D: Record<string, number> = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let total = 0
  let current = 0
  let has = false
  for (const ch of norm) {
    const d = D[ch]
    if (d !== undefined) { current = current * 10 + d; has = true }
    else if (ch === '十') { total += (current || 1) * 10; current = 0; has = true }
    else if (ch === '百') { total += (current || 1) * 100; current = 0; has = true }
    else if (ch === '千') { total += (current || 1) * 1000; current = 0; has = true }
    else return 0
  }
  return has ? total + current : 0
}

/**
 * 大纲章节 → 规划任务。已有 queue 任务时按 chapter_index 去重（跳过已存在的章）。
 */
export function outlineToTasks(chapters: OutlineChapter[], existing: NovelTask[], targetWords: number): NovelTask[] {
  const have = new Set(existing.map((t) => t.chapter_index))
  const fresh = chapters.filter((c) => c.chapterIndex > 0 && !have.has(c.chapterIndex))
  fresh.sort((a, b) => a.chapterIndex - b.chapterIndex)
  const titleOf = (c: OutlineChapter): string => {
    const m = c.heading.replace(/^#+\s*/, '').replace(/^第\s*[0-9一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖]+\s*[章回节卷]\s*[:：]?\s*/, '').trim()
    return m || c.heading
  }
  return fresh.map((c, i) => {
    const idx = c.chapterIndex
    return {
      id: `ch${String(idx).padStart(3, '0')}`,
      title: `第 ${idx} 章 · ${titleOf(c)}`,
      status: 'todo' as const,
      priority: i === 0 ? ('high' as const) : ('medium' as const),
      depends_on: i === 0 ? [] : [`ch${String(fresh[i - 1].chapterIndex).padStart(3, '0')}`],
      target_words: targetWords,
      scope: `stories/chapter-${String(idx).padStart(4, '0')}.md`,
      volume: 1,
      chapter_index: idx,
      acceptance_checks: [
        `字数 ≥ ${targetWords}`,
        '按细纲推进情节点，不与人物状态索引冲突',
        '章末有钩子',
      ],
      arc_targets: [],
      foreshadow_refs: [],
      timeline_window: 'global',
      task_prompt: c.body ? `细纲：\n${c.body}` : '',
      retries: 0,
    }
  })
}

/** 读 outline/ 下所有 md 并抽取章节条目（按文件名排序拼接） */
export async function loadOutlineChapters(): Promise<OutlineChapter[]> {
  const { listWorkspaceTree } = await import('./backend')
  const tree = await listWorkspaceTree(6)
  const files: string[] = []
  const walk = (e: { kind: string; path: string; children?: Array<{ kind: string; path: string; children?: unknown[] }> }) => {
    if (e.kind === 'file' && /^outline\/.*\.md$/i.test(e.path)) files.push(e.path)
    for (const c of e.children ?? []) walk(c as typeof e)
  }
  walk(tree as never)
  files.sort()
  let text = ''
  for (const f of files) {
    try {
      text += `\n${await readText(f)}`
    } catch { /* skip */ }
  }
  return parseOutlineChapters(text)
}

/** 任务状态 → Markdown checkbox 符号 */
const STATUS_MARK: Record<TaskStatus, string> = {
  done: 'x',
  running: '~',
  blocked: '!',
  retry: '!',
  todo: ' ',
}

/**
 * 任务队列 → Markdown 写作计划（浏览器下载/存盘两用）。
 * 含进度概览 + 逐章任务（状态/章号/字数/细纲/验收标准/情节线/伏笔/时间窗）。
 */
export function tasksToPlanMarkdown(tasks: NovelTask[], title = '写作计划'): string {
  const done = tasks.filter((t) => t.status === 'done').length
  const lines: string[] = [
    `# ${title}`,
    '',
    `- 任务总数：${tasks.length}`,
    `- 已完成：${done}（${tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0}%）`,
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 任务链',
    '',
  ]
  for (const t of tasks) {
    const mark = STATUS_MARK[t.status]
    const meta = [`第 ${t.chapter_index} 章`, `目标 ${t.target_words} 字`]
    if (t.timeline_window && t.timeline_window !== 'global') meta.push(`时间窗 ${t.timeline_window}`)
    if (t.arc_targets.length > 0) meta.push(`情节线：${t.arc_targets.join('、')}`)
    if (t.foreshadow_refs.length > 0) meta.push(`伏笔：${t.foreshadow_refs.join('、')}`)
    lines.push(`### [${mark}] ${t.title}`)
    lines.push('')
    lines.push(`- ${meta.join(' · ')}`)
    if (t.depends_on.length > 0) lines.push(`- 依赖：${t.depends_on.join(' → ')}`)
    if (t.task_prompt) {
      lines.push('')
      for (const p of t.task_prompt.split('\n')) lines.push(`> ${p}`)
    }
    if (t.acceptance_checks.length > 0) {
      lines.push('')
      for (const c of t.acceptance_checks) lines.push(`- [ ] 验收：${c}`)
    }
    if (t.last_error) {
      lines.push('')
      lines.push(`- ⚠ 最近错误：${t.last_error}`)
    }
    lines.push('')
  }
  return lines.join('\n') + '\n'
}
