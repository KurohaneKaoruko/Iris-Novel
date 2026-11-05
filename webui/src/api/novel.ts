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

export async function createChapterFile(title: string, order?: number): Promise<string> {
  const chapters = await listChapters()
  const nextOrder = order ?? chapters.length + 1
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

export async function listCharacters(): Promise<Character[]> {
  let content = ''
  try {
    content = await readText(CHAR_FILE)
  } catch {
    return []
  }
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

export async function saveCharacters(characters: Character[]): Promise<void> {
  const lines: string[] = ['# 人物卡', '']
  for (const c of characters) {
    lines.push(`## ${c.name} <!-- id: ${c.id} -->`, '')
    for (const f of CHAR_FIELDS) {
      const v = c.data[f.key]
      if (v && v.trim()) lines.push(`- **${f.zh}**: ${v.trim()}`)
    }
    lines.push('')
  }
  await writeText(CHAR_FILE, lines.join('\n'))
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

export async function listPlotLines(): Promise<PlotLine[]> {
  let content = ''
  try {
    content = await readText(PLOT_FILE)
  } catch {
    return []
  }
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

export async function savePlotLines(plotLines: PlotLine[]): Promise<void> {
  const lines: string[] = ['# 情节线', '']
  for (const p of plotLines) {
    lines.push(`## ${p.name} <!-- id: ${p.id} -->`, '')
    lines.push(`- **起始章节**: ${p.startChapter || '—'}`)
    lines.push(`- **结束章节**: ${p.endChapter || '—'}`)
    lines.push(`- **状态**: ${STATUS_ZH[p.status]}`)
    if (p.description?.trim()) lines.push(`- **简介**: ${p.description.trim()}`)
    lines.push('')
  }
  await writeText(PLOT_FILE, lines.join('\n'))
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
