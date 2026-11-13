/**
 * 作品内数据服务：章节元数据、人物卡、情节线、记忆索引、写作历史。
 * 全部走 read_text/write_text 直读直写 Markdown/JSON，与旧桌面端格式完全兼容。
 */
import { readText, writeText, listWorkspaceTree, type FsEntry } from './backend'
import { rpc } from './rpc'

// ============ 章节（.novel/.settings/chapters.json + stories/） ============

export type ChapterStatus = 'draft' | 'revising' | 'completed'

export type Chapter = {
  id: string
  filePath: string
  title: string
  wordCount: number
  status: ChapterStatus
  lastModified: number
  order: number
}

type ChapterMetadata = { chapters: Chapter[] }

const CH_META = '.novel/.settings/chapters.json'

function words(text: string): number {
  return text.replace(/\s/g, '').length
}

export async function listChapters(): Promise<Chapter[]> {
  const tree = await listWorkspaceTree(6)
  const files: FsEntry[] = []
  const walk = (e: FsEntry) => {
    if (e.kind === 'file' && /^stories\/.*\.(md|txt)$/i.test(e.path)) files.push(e)
    for (const c of e.children ?? []) walk(c)
  }
  walk(tree)
  files.sort((a, b) => a.path.localeCompare(b.path))

  let meta: ChapterMetadata = { chapters: [] }
  try {
    meta = JSON.parse(await readText(CH_META)) as ChapterMetadata
  } catch {
    /* 无元数据视为首次 */
  }

  // 字数从文件内容实时重算，自愈旧桌面端遗留的陈旧元数据
  const contents = await Promise.all(files.map((f) => readText(f.path).catch(() => '')))
  return files.map((f, i) => {
    const known = meta.chapters.find((m) => m.filePath === f.path)
    return {
      id: known?.id ?? f.path,
      filePath: f.path,
      title: known?.title ?? f.name.replace(/\.(md|txt)$/i, ''),
      wordCount: words(contents[i]),
      status: known?.status ?? 'draft',
      lastModified: known?.lastModified ?? 0,
      order: known?.order ?? i + 1,
    }
  })
}

export async function saveChapterMeta(chapter: Chapter): Promise<void> {
  let meta: ChapterMetadata = { chapters: [] }
  try {
    meta = JSON.parse(await readText(CH_META)) as ChapterMetadata
  } catch {
    /* 新文件 */
  }
  const idx = meta.chapters.findIndex((m) => m.filePath === chapter.filePath)
  const rec = { ...chapter }
  if (idx >= 0) meta.chapters[idx] = rec
  else meta.chapters.push(rec)
  await writeText(CH_META, JSON.stringify(meta, null, 2))
}

export async function syncChapterContent(filePath: string, content: string): Promise<Chapter | null> {
  const chapters = await listChapters()
  const ch = chapters.find((c) => c.filePath === filePath)
  if (!ch) return null
  const updated: Chapter = { ...ch, wordCount: words(content), lastModified: Date.now() }
  await saveChapterMeta(updated)
  return updated
}

export async function markChapterStatus(filePath: string, status: ChapterStatus): Promise<void> {
  const chapters = await listChapters()
  const ch = chapters.find((c) => c.filePath === filePath)
  if (!ch) return
  await saveChapterMeta({ ...ch, status })
}

/** 纯排序：把 fromPath 移到 toPath 原位置（drop 占位，目标后移；供 reorderChapters 与测试共用） */
export function reorderList<T extends { filePath: string }>(items: T[], fromPath: string, toPath: string): T[] {
  const fromIdx = items.findIndex((c) => c.filePath === fromPath)
  const toIdx = items.findIndex((c) => c.filePath === toPath)
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return items
  const next = [...items]
  const [moved] = next.splice(fromIdx, 1)
  // 移除后若目标在来源之后，其索引左移一位，插入即占据原位置
  next.splice(fromIdx < toIdx ? toIdx - 1 : toIdx, 0, moved)
  return next
}

/** 重排章节顺序：把 fromPath 移动到 toPath 当前位置，其余章节按原相对顺序补位 */
export async function reorderChapters(fromPath: string, toPath: string): Promise<void> {
  const chapters = await listChapters()
  const sorted = [...chapters].sort((a, b) => a.order - b.order)
  const next = reorderList(sorted, fromPath, toPath)
  if (next === sorted) return
  for (let i = 0; i < next.length; i++) {
    if (next[i].order !== i + 1) {
      await saveChapterMeta({ ...next[i], order: i + 1 })
    }
  }
}

/** 新章节的下一个 order：取现有最大 order + 1（不能用条数——删章产生 order 空洞时按条数会撞上已有文件并覆盖） */
export function nextChapterOrder(chapters: Array<{ order: number }>): number {
  return chapters.reduce((mx, c) => Math.max(mx, c.order), 0) + 1
}

export async function createChapterFile(title: string, order?: number): Promise<string> {
  const chapters = await listChapters()
  const nextOrder = order ?? nextChapterOrder(chapters)
  const num = String(nextOrder).padStart(4, '0')
  const slug = `chapter-${num}`
  const path = `stories/${slug}.md`
  const heading = `# ${title || `Chapter ${num}`}\n\n`
  await writeText(path, heading)
  await saveChapterMeta({
    id: path,
    filePath: path,
    title: title || `Chapter ${num}`,
    wordCount: 0,
    status: 'draft',
    lastModified: Date.now(),
    order: nextOrder,
  })
  return path
}

/**
 * 工坊结果 → 章节正文体：剥掉 AI 产出的首行 `# 标题`（避免与章节标题重复），
 * 返回 {title, body}；无标题行时 title 传空由调用方兜底。
 */
export function chapterBodyFromResult(raw: string): { title: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n').trim()
  const m = normalized.match(/^#\s+(.+?)\s*\n/)
  if (m) {
    return { title: m[1].trim(), body: normalized.slice(m[0].length).trim() }
  }
  return { title: '', body: normalized }
}

/**
 * 工坊结果直写新章节：写入 stories/chapter-XXXX.md（自动接在现有章节末尾），
 * 登记章节元数据，返回落盘路径。标题缺省用「第 N 章」。
 */
export async function createChapterWithContent(title: string, content: string): Promise<string> {
  const chapters = await listChapters()
  const order = nextChapterOrder(chapters)
  const num = String(order).padStart(4, '0')
  const path = `stories/chapter-${num}.md`
  const cleanTitle = title.trim() || `第 ${order} 章`
  const heading = `# ${cleanTitle}\n\n`
  const body = heading + content.trim() + '\n'
  await writeText(path, body)
  await saveChapterMeta({
    id: path,
    filePath: path,
    title: cleanTitle,
    wordCount: words(body),
    status: 'draft',
    lastModified: Date.now(),
    order,
  })
  return path
}

/** 批量导入章节（存量作品切章后调用）：从 startOrder 起逐章写文件+元数据，返回落盘路径列表 */export async function importChapters(
  items: Array<{ title: string; content: string }>,
  startOrder: number,
): Promise<string[]> {
  const paths: string[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const order = startOrder + i
    const num = String(order).padStart(4, '0')
    const path = `stories/chapter-${num}.md`
    const body = `# ${item.title}\n\n${item.content.trim()}\n`
    await writeText(path, body)
    await saveChapterMeta({
      id: path,
      filePath: path,
      title: item.title,
      wordCount: words(body),
      status: 'draft',
      lastModified: Date.now(),
      order,
    })
    paths.push(path)
  }
  return paths
}

// ============ 人物卡（concept/characters.md） ============

export type CharacterData = {
  name: string
  appearance?: string
  personality?: string
  background?: string
  relationships?: string
  notes?: string
}

export type Character = { id: string; name: string; data: CharacterData }

const CHAR_FILE = 'concept/characters.md'

type CharField = { key: keyof CharacterData; zh: string }

const CHAR_FIELDS: CharField[] = [
  { key: 'appearance', zh: '外貌' },
  { key: 'personality', zh: '性格' },
  { key: 'background', zh: '背景' },
  { key: 'relationships', zh: '关系' },
  { key: 'notes', zh: '备注' },
]

/** 解析人物卡 markdown（旧桌面端同格式：`## 名字 <!-- id: ... -->` + `- **字段**:` 行） */
export function parseCharacters(content: string): Character[] {
  const chars: Character[] = []
  const sections = content.split(/^## /m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const head = lines[0]?.trim() ?? ''
    if (!head) continue
    const idMatch = head.match(/<!--\s*id:\s*([^\s]+)\s*-->/)
    const name = head.replace(/<!--.*?-->/, '').trim()
    if (!name) continue
    const data: CharacterData = { name }
    let field: keyof CharacterData | null = null
    const buf: string[] = []
    const flush = () => {
      if (field && buf.length > 0) {
        const v = buf.join('\n').trim()
        if (v) data[field] = v
      }
      buf.length = 0
    }
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const hit = CHAR_FIELDS.find((f) => line.startsWith(`- **${f.zh}**:`) || line.startsWith(`- **${f.zh}**：`))
      if (hit) {
        flush()
        field = hit.key
        const inline = line.replace(/^- \*\*.*?\*\*[::]\s*/, '').trim()
        if (inline) buf.push(inline)
      } else if (field && line.trim()) {
        buf.push(line)
      }
    }
    flush()
    chars.push({ id: idMatch?.[1] ?? `character-${name}`, name, data })
  }
  return chars
}

export async function listCharacters(): Promise<Character[]> {
  let content = ''
  try {
    content = await readText(CHAR_FILE)
  } catch {
    return []
  }
  return parseCharacters(content)
}

export function serializeCharacters(characters: Character[]): string {
  const lines: string[] = ['# 人物卡', '']
  for (const c of characters) {
    lines.push(`## ${c.name} <!-- id: ${c.id} -->`, '')
    for (const f of CHAR_FIELDS) {
      const v = c.data[f.key]
      if (v && v.trim()) lines.push(`- **${f.zh}**: ${v.trim()}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export async function saveCharacters(characters: Character[]): Promise<void> {
  await writeText(CHAR_FILE, serializeCharacters(characters))
}

// ============ 设定集 Codex（concept/codex.md） ============

export type CodexType = 'location' | 'faction' | 'item' | 'term' | 'setting'

export const CODEX_TYPES: Array<{ id: CodexType; zh: string; icon: string }> = [
  { id: 'location', zh: '地点', icon: 'map-pin' },
  { id: 'faction', zh: '组织', icon: 'flag' },
  { id: 'item', zh: '物品', icon: 'package' },
  { id: 'term', zh: '术语', icon: 'book-open' },
  { id: 'setting', zh: '设定', icon: 'sparkles' },
]

export type CodexEntry = {
  id: string
  name: string
  type: CodexType
  /** 一句话简介 */
  summary: string
  /** 多行详情 */
  details: string
}

const CODEX_FILE = 'concept/codex.md'
const CODEX_TYPE_ZH: Record<CodexType, string> = { location: '地点', faction: '组织', item: '物品', term: '术语', setting: '设定' }

/** 解析设定集 markdown（与人物卡同构：`## 名称 <!-- id -->` + 类型/简介/详情字段） */
export function parseCodex(content: string): CodexEntry[] {
  const entries: CodexEntry[] = []
  const sections = content.split(/^## /m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const head = lines[0]?.trim() ?? ''
    if (!head) continue
    const idMatch = head.match(/<!--\s*id:\s*([^\s]+)\s*-->/)
    const name = head.replace(/<!--.*?-->/, '').trim()
    if (!name) continue
    let type: CodexType = 'setting'
    let summary = ''
    const detailBuf: string[] = []
    let inDetails = false
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const typeMatch = line.match(/^- \*\*类型\*\*[::]\s*(.*)$/)
      if (typeMatch) {
        const zh = typeMatch[1].trim()
        type = CODEX_TYPES.find((t) => t.zh === zh)?.id ?? 'setting'
        continue
      }
      const summaryMatch = line.match(/^- \*\*简介\*\*[::]\s*(.*)$/)
      if (summaryMatch) {
        summary = summaryMatch[1].trim()
        continue
      }
      if (/^- \*\*详情\*\*[::]/.test(line)) {
        inDetails = true
        const inline = line.replace(/^- \*\*详情\*\*[::]\s*/, '').trim()
        if (inline) detailBuf.push(inline)
        continue
      }
      if (inDetails) detailBuf.push(line)
    }
    entries.push({
      id: idMatch?.[1] ?? `codex-${name}`,
      name,
      type,
      summary,
      details: detailBuf.join('\n').trim(),
    })
  }
  return entries
}

export function serializeCodex(entries: CodexEntry[]): string {
  const lines: string[] = ['# 设定集', '']
  for (const e of entries) {
    lines.push(`## ${e.name} <!-- id: ${e.id} -->`, '')
    lines.push(`- **类型**: ${CODEX_TYPE_ZH[e.type] ?? '设定'}`)
    if (e.summary.trim()) lines.push(`- **简介**: ${e.summary.trim()}`)
    if (e.details.trim()) lines.push(`- **详情**: ${e.details.trim()}`)
    lines.push('')
  }
  return lines.join('\n')
}

export async function listCodex(): Promise<CodexEntry[]> {
  let content = ''
  try {
    content = await readText(CODEX_FILE)
  } catch {
    return []
  }
  return parseCodex(content)
}

export async function saveCodex(entries: CodexEntry[]): Promise<void> {
  await writeText(CODEX_FILE, serializeCodex(entries))
}

/** 编辑器选中文本 → 查设定集：名称完全匹配或被长名称包含 */
export function queryCodex(entries: CodexEntry[], selected: string): CodexEntry | null {
  const q = selected.trim()
  if (!q) return null
  const exact = entries.find((e) => e.name === q)
  if (exact) return exact
  const contained = entries.filter((e) => q.includes(e.name) || e.name.includes(q)).sort((a, b) => a.name.length - b.name.length)
  return contained[0] ?? null
}

// ============ 情节线（outline/plotlines.md） ============

export type PlotLineStatus = 'ongoing' | 'completed' | 'paused'

export type PlotLine = {
  id: string
  name: string
  startChapter: string
  endChapter?: string
  status: PlotLineStatus
  description?: string
}

const PLOT_FILE = 'outline/plotlines.md'

const STATUS_ZH: Record<PlotLineStatus, string> = {
  ongoing: '进行中',
  completed: '已完结',
  paused: '已暂停',
}

const STATUS_FROM_ZH = new Map(Object.entries(STATUS_ZH).map(([k, v]) => [v, k as PlotLineStatus]))

/** 解析情节线 markdown（旧桌面端同格式） */
export function parsePlotLines(content: string): PlotLine[] {
  const out: PlotLine[] = []
  const sections = content.split(/^## /m).slice(1)
  for (const section of sections) {
    const lines = section.split('\n')
    const head = lines[0]?.trim() ?? ''
    if (!head) continue
    const idMatch = head.match(/<!--\s*id:\s*([^\s]+)\s*-->/)
    const name = head.replace(/<!--.*?-->/, '').trim()
    if (!name) continue
    const pl: PlotLine = { id: idMatch?.[1] ?? name, name, startChapter: '', status: 'ongoing' }
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      let m = line.match(/^- \*\*起始章节\*\*[::]\s*(.+)$/)
      if (m) { pl.startChapter = m[1].trim(); continue }
      m = line.match(/^- \*\*结束章节\*\*[::]\s*(.+)$/)
      if (m) { pl.endChapter = m[1].trim(); continue }
      m = line.match(/^- \*\*状态\*\*[::]\s*(.+)$/)
      if (m) { pl.status = STATUS_FROM_ZH.get(m[1].trim()) ?? 'ongoing'; continue }
      m = line.match(/^- \*\*简介\*\*[::]\s*(.+)$/)
      if (m) { pl.description = m[1].trim() }
    }
    out.push(pl)
  }
  return out
}

export async function listPlotLines(): Promise<PlotLine[]> {
  let content = ''
  try {
    content = await readText(PLOT_FILE)
  } catch {
    return []
  }
  return parsePlotLines(content)
}

export function serializePlotLines(plotLines: PlotLine[]): string {
  const lines: string[] = ['# 情节线', '']
  for (const p of plotLines) {
    lines.push(`## ${p.name} <!-- id: ${p.id} -->`, '')
    lines.push(`- **起始章节**: ${p.startChapter || '—'}`)
    lines.push(`- **结束章节**: ${p.endChapter || '—'}`)
    lines.push(`- **状态**: ${STATUS_ZH[p.status]}`)
    if (p.description?.trim()) lines.push(`- **简介**: ${p.description.trim()}`)
    lines.push('')
  }
  return lines.join('\n')
}

export async function savePlotLines(plotLines: PlotLine[]): Promise<void> {
  await writeText(PLOT_FILE, serializePlotLines(plotLines))
}

// ============ 记忆索引（.novel/state/*.md） ============

export type MemoryIndex = {
  path: string
  content: string
  exists: boolean
  locked: boolean
}

const MEMORY_FILES = [
  { path: '.novel/state/character-state-index.md', label: '人物状态' },
  { path: '.novel/state/foreshadow-index.md', label: '伏笔线索' },
  { path: '.novel/state/continuity-index.md', label: '连续性' },
] as const

export async function loadMemoryIndices(): Promise<MemoryIndex[]> {
  const out: MemoryIndex[] = []
  for (const f of MEMORY_FILES) {
    try {
      const content = await readText(f.path)
      out.push({ path: f.path, content, exists: true, locked: content.includes('locked: true') })
    } catch {
      out.push({ path: f.path, content: '', exists: false, locked: false })
    }
  }
  return out
}

export async function saveMemoryIndex(path: string, content: string): Promise<void> {
  await writeText(path, content)
}

// ============ 写作历史（.novel/.history/writing-history.json） ============

export type WritingHistoryEntry = { date: string; wordCount: number; goal: number }

type WritingHistoryDoc = {
  history: WritingHistoryEntry[]
  dailyWordCount?: number
}

const WRITING_HISTORY = '.novel/.history/writing-history.json'

export async function loadWritingHistory(): Promise<{ history: WritingHistoryEntry[]; dailyGoal: number }> {
  try {
    const doc = JSON.parse(await readText(WRITING_HISTORY)) as WritingHistoryDoc
    return { history: doc.history ?? [], dailyGoal: doc.dailyWordCount ?? 0 }
  } catch {
    return { history: [], dailyGoal: 0 }
  }
}

export async function recordTodayWords(deltaWords: number, dailyGoal: number): Promise<void> {
  const { history, dailyGoal: current } = await loadWritingHistory()
  const today = new Date().toISOString().slice(0, 10)
  const idx = history.findIndex((h) => h.date === today)
  if (idx >= 0) history[idx] = { ...history[idx], wordCount: history[idx].wordCount + deltaWords, goal: dailyGoal || history[idx].goal }
  else history.push({ date: today, wordCount: Math.max(0, deltaWords), goal: dailyGoal })
  const doc: WritingHistoryDoc = { history: history.slice(-365), dailyWordCount: dailyGoal || current }
  await writeText(WRITING_HISTORY, JSON.stringify(doc, null, 2))
}

/**
 * 保存每日目标字数：写入 writing-history.json 的 dailyWordCount 字段
 * （既有约定字段，只增不改——不动已有 history 条目的逐日 goal）。
 * goal <= 0 视为清除目标（回退为无目标态）。
 */
export async function saveDailyGoal(goal: number): Promise<void> {
  const { history, dailyGoal: current } = await loadWritingHistory()
  const doc: WritingHistoryDoc = { history, dailyWordCount: Math.max(0, Math.round(goal)) || current }
  await writeText(WRITING_HISTORY, JSON.stringify(doc, null, 2))
}

// ============ 作品统计 ============

export type WorkStats = {
  totalWords: number
  chapterCount: number
  completedChapters: number
  conceptCount: number
  outlineCount: number
  daysWriting: number
  todayWords: number
  longestChapter: { title: string; words: number } | null
  shortestChapter: { title: string; words: number } | null
}

export async function computeWorkStats(): Promise<WorkStats> {
  const [chapters, history, tree] = await Promise.all([
    listChapters(),
    loadWritingHistory(),
    listWorkspaceTree(6),
  ])
  let conceptCount = 0
  let outlineCount = 0
  const walk = (e: FsEntry) => {
    if (e.kind === 'file') {
      if (e.path.startsWith('concept/') && /\.(md|txt)$/i.test(e.path)) conceptCount += 1
      if (e.path.startsWith('outline/') && /\.(md|txt)$/i.test(e.path)) outlineCount += 1
    }
    for (const c of e.children ?? []) walk(c)
  }
  walk(tree)

  const realWords = chapters.filter((c) => c.wordCount > 0)
  const sorted = [...realWords].sort((a, b) => a.wordCount - b.wordCount)
  const today = new Date().toISOString().slice(0, 10)
  return {
    totalWords: realWords.reduce((s, c) => s + c.wordCount, 0),
    chapterCount: chapters.length,
    completedChapters: chapters.filter((c) => c.status === 'completed').length,
    conceptCount,
    outlineCount,
    daysWriting: new Set(history.history.filter((h) => h.wordCount > 0).map((h) => h.date)).size,
    todayWords: history.history.find((h) => h.date === today)?.wordCount ?? 0,
    longestChapter: sorted.length > 0 ? { title: sorted[sorted.length - 1].title, words: sorted[sorted.length - 1].wordCount } : null,
    shortestChapter: sorted.length > 0 ? { title: sorted[0].title, words: sorted[0].wordCount } : null,
  }
}

// ============ 记忆索引自动生成（规则抽取，无需 API Key） ============

/** 单章人物提及统计 */
export type CharacterMention = { name: string; chapter: string; chapterPath: string; mentions: number; dialogueLines: number }

/**
 * 从章节正文统计人物提及：出现次数 + 对话行数（行内含「名字：」或「名字说/道/问」等引导）。
 * 名单来自人物卡，避免把「他/她」等误算。
 */
export function scanCharacterMentions(
  chapters: Array<{ title: string; path: string; content: string }>,
  names: string[],
): CharacterMention[] {
  if (names.length === 0) return []
  // 长名优先：alternation 左优先，若短名在前，「林越秋」会被误计为「林越」
  const escaped = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const nameRe = new RegExp(`(${escaped.join('|')})`, 'g')
  const dialogueRe = new RegExp(`^\\s*(?:「|『|"|“)?(${escaped.join('|')})(?:」|』|"|”)?(?:：|:|说|道|问|答|喊|叫|叹|笑|低声道|开口)`, 'm')
  const out: CharacterMention[] = []
  for (const ch of chapters) {
    const counts = new Map<string, number>()
    const dialogues = new Map<string, number>()
    let total = 0
    for (const m of ch.content.matchAll(nameRe)) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
      total += 1
    }
    if (total === 0) continue
    for (const line of ch.content.split('\n')) {
      const m = line.match(dialogueRe)
      if (m) dialogues.set(m[1], (dialogues.get(m[1]) ?? 0) + 1)
    }
    for (const [name, mentions] of counts) {
      out.push({ name, chapter: ch.title, chapterPath: ch.path, mentions, dialogueLines: dialogues.get(name) ?? 0 })
    }
  }
  return out
}

/** 生成人物状态索引 markdown（source: auto；与旧桌面端索引格式约定一致） */
export function buildCharacterStateIndex(mentions: CharacterMention[], chapters: Array<{ title: string }>): string {
  const lines: string[] = ['# Character State Index', '', '<!-- source: auto -->', '']
  if (mentions.length === 0) {
    lines.push('（暂无人物出场记录。写完章节后可重新生成。）', '')
    return lines.join('\n')
  }
  // 按人物聚合：出场章节列表 + 最近出场 + 总提及
  const byName = new Map<string, CharacterMention[]>()
  for (const m of mentions) {
    const arr = byName.get(m.name) ?? []
    arr.push(m)
    byName.set(m.name, arr)
  }
  const lastChapter = chapters.length > 0 ? chapters[chapters.length - 1].title : ''
  lines.push(`最新章节：${lastChapter}`, '')
  for (const [name, arr] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = arr.reduce((s, m) => s + m.mentions, 0)
    const dialogues = arr.reduce((s, m) => s + m.dialogueLines, 0)
    const chapterList = arr.map((m) => `${m.chapter}(×${m.mentions})`).join('、')
    lines.push(`## ${name}`, '', `- 出场：${chapterList}`, `- 合计提及 ${total} 次 / 对话 ${dialogues} 行`, '')
  }
  return lines.join('\n')
}

/** 伏笔线索条目（从章节正文抽取「伏笔/悬念」标记句） */
export type ForeshadowHit = { chapter: string; chapterPath: string; text: string }

/**
 * 从章节正文抽取疑似伏笔句：含「伏笔/悬念/暗示/似乎/隐约/奇怪的是/没人注意到」等
 * 提示词的句子。纯启发式，结果供作者人工确认。
 */
export function scanForeshadows(chapters: Array<{ title: string; path: string; content: string }>): ForeshadowHit[] {
  const HINTS = ['伏笔', '悬念', '暗示', '没人注意到', '没有人发现', '奇怪的是', '隐约', '似乎没人', '暗自', '埋下']
  const out: ForeshadowHit[] = []
  for (const ch of chapters) {
    for (const raw of ch.content.split(/[。！？\n]/)) {
      const line = raw.trim()
      if (line.length < 8 || line.length > 120) continue
      if (HINTS.some((h) => line.includes(h))) {
        out.push({ chapter: ch.title, chapterPath: ch.path, text: line.slice(0, 100) })
      }
    }
  }
  return out
}

/** 生成伏笔线索索引 markdown（编号 F001 起递增，与旧桌面端格式一致） */
export function buildForeshadowIndex(existing: string, hits: ForeshadowHit[]): string {
  const lines: string[] = ['# 伏笔线索', '', '<!-- source: auto -->', '']
  // 保留已有未回收条目（人工整理的资产不丢）：解析现有 ## Fxxx 标题
  const kept = existing.split('\n').filter((l) => /^## F\d+/.test(l))
  let seq = kept.length
  const seen = new Set(kept)
  if (kept.length > 0) {
    lines.push('<!-- 以下为已有条目，自动生成的补充条目追加在后 -->', '')
    for (const k of kept) lines.push(k, '- 状态：未回收', '')
  }
  for (const h of hits) {
    seq += 1
    const id = `F${String(seq).padStart(3, '0')}`
    if (seen.has(id)) continue
    lines.push(`## ${id} ${h.text.slice(0, 24)}${h.text.length > 24 ? '…' : ''}`, `- 埋设：${h.chapter}`, `- 原文：${h.text}`, '- 状态：未回收', '')
  }
  if (hits.length === 0 && kept.length === 0) lines.push('（暂未发现疑似伏笔。可写正文后重新生成，或手动登记。）', '')
  return lines.join('\n')
}

/** 组装生成所需的章节正文（顺 plot 顺序） */
export async function loadChapterContents(): Promise<Array<{ title: string; path: string; content: string }>> {
  const chapters = await listChapters()
  const sorted = [...chapters].sort((a, b) => a.order - b.order)
  const out: Array<{ title: string; path: string; content: string }> = []
  for (const c of sorted) {
    try {
      out.push({ title: c.title, path: c.filePath, content: await readText(c.filePath) })
    } catch {
      out.push({ title: c.title, path: c.filePath, content: '' })
    }
  }
  return out
}

// ============ 大纲 / 设定 文件浏览（outline/ concept/ 通用 md 编辑） ============

export type DocFile = { path: string; name: string }

export async function listConceptFiles(): Promise<DocFile[]> {
  const tree = await listWorkspaceTree(6)
  const out: DocFile[] = []
  const walk = (e: FsEntry) => {
    if (e.kind === 'file' && /^(concept|outline)\/.*\.(md|txt)$/i.test(e.path) && !/^concept\/characters\.md$/.test(e.path) && !/^outline\/plotlines\.md$/.test(e.path)) {
      out.push({ path: e.path, name: e.name })
    }
    for (const c of e.children ?? []) walk(c)
  }
  walk(tree)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export { rpc }
