/**
 * 导出中心：纯函数组装层（落盘与下载 IO 在 ExportTab）。
 * - 整本 TXT 在前端组装：章节标题独立行 + 去 Markdown 语法（后端 export_work('txt') 不做语法清理）
 * - 整本 Markdown 复用后端 export_work RPC（剥 frontmatter 与首个标题防重复）
 * - 资料册：人物卡 + 设定集 + 情节线合并为单文档
 * 文件统一落盘到作品目录 exports/，文件名带时间戳避免覆盖旧导出。
 */
import { type Character, type CodexEntry, type PlotLine } from './novel'

/** 文件名净化：替换 Windows/通用非法字符与路径分隔符，空白保留，空名/纯占位符兜底 */
export function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!cleaned || /^_+$/.test(cleaned)) return 'untitled'
  return cleaned
}

/** 本地时间戳后缀：yyyymmdd-HHmm（导出文件名防覆盖） */
export function timestampSuffix(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

/** 导出文件名：《书名》-<种类>-<时间戳>.<ext> */
export function buildExportFilename(
  workName: string,
  kind: 'book' | 'dossier' | 'backup',
  ext: 'md' | 'txt',
  now: Date = new Date(),
): string {
  const name = sanitizeFilename(workName || '未命名作品')
  const zh = kind === 'book' ? '全文' : kind === 'dossier' ? '资料册' : '备份清单'
  return `${name}-${zh}-${timestampSuffix(now)}.${ext}`
}

/**
 * 去 Markdown 语法（小说正文友好）：
 * 剥 YAML frontmatter 与 HTML 注释；行级去标题井号/引用符/列表标记/分隔线；
 * 行内去粗体/斜体/删除线/行内代码/链接图片（保留可见文本）；连续空行压为一空行。
 */
export function stripMarkdown(text: string): string {
  let s = text.replace(/\r\n/g, '\n')
  // YAML frontmatter
  if (s.trimStart().startsWith('---')) {
    const end = s.indexOf('\n---', 3)
    if (end >= 0) s = s.slice(s.indexOf('\n', end + 1) + 1)
  }
  // HTML 注释（人物卡/设定集 id 标记等，单行）
  s = s.replace(/<!--.*?-->/g, '')
  const out: string[] = []
  for (const line of s.split('\n')) {
    let l = line
    // 行级标记
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) continue // 分隔线
    l = l.replace(/^\s{0,3}#{1,6}\s+/, '') // 标题
    l = l.replace(/^\s{0,3}>\s?/, '') // 引用
    l = l.replace(/^(\s{0,3})[-*+]\s+/, '$1') // 无序列表
    l = l.replace(/^(\s{0,3})\d+\.\s+/, '$1') // 有序列表
    // 行内标记（行内代码最先，保护代码内容不被后续规则误伤）
    l = l.replace(/`([^`]+)`/g, '$1')
    l = l.replace(/\*\*([^*]+)\*\*/g, '$1')
    l = l.replace(/\*([^*\n]+)\*/g, '$1')
    l = l.replace(/~~([^~]+)~~/g, '$1')
    l = l.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    l = l.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    out.push(l)
  }
  // 连续空行压为一个空行
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * 整本 TXT 组装：书名头部 + 每章标题独立行（空行包围）+ 去 Markdown 语法的正文。
 * 章节内容剥首个 `# 标题`（避免与章节标题行重复），空正文只保留标题行。
 */
export function assembleBookTxt(
  chapters: Array<{ title: string; content: string }>,
  workName: string,
): string {
  const out: string[] = [`《${workName || '未命名作品'}》`, '']
  for (const ch of chapters) {
    const title = ch.title.trim() || '未命名章节'
    // 剥正文首个 `# 标题`（1-6 级，避免与章节标题行重复；后续小标题由 stripMarkdown 降为纯文本）
    const headingRe = /^#{1,6}\s+.+?(?:\n|$)/
    const rawBody = ch.content.replace(/\r\n/g, '\n').replace(headingRe, '')
    const body = stripMarkdown(rawBody).trim()
    out.push(title, '')
    if (body) out.push(body, '')
  }
  return out.join('\n').trimEnd() + '\n'
}

const CODEX_TYPE_ZH: Record<string, string> = {
  location: '地点',
  faction: '组织',
  item: '物品',
  term: '术语',
  setting: '设定',
}

/**
 * 资料册组装：人物卡 + 设定集 + 情节线合并为单 Markdown 文档。
 * 空区块整段跳过；人物/设定不携带内部 id 注释。
 */
export function assembleDossier(opts: {
  workName: string
  characters: Character[]
  codex: CodexEntry[]
  plotLines: PlotLine[]
  exportedAt?: number
}): string {
  const { workName, characters, codex, plotLines } = opts
  const time = new Date(opts.exportedAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false })
  const out: string[] = [
    `# 《${workName || '未命名作品'}》资料册`,
    '',
    `> 导出时间：${time} · 人物 ${characters.length} · 设定 ${codex.length} · 情节线 ${plotLines.length}`,
    '',
  ]

  if (characters.length > 0) {
    out.push('## 人物', '')
    for (const c of characters) {
      out.push(`### ${c.name}`, '')
      const fields: Array<[string, string | undefined]> = [
        ['外貌', c.data.appearance],
        ['性格', c.data.personality],
        ['背景', c.data.background],
        ['关系', c.data.relationships],
        ['备注', c.data.notes],
      ]
      for (const [zh, v] of fields) {
        if (v && v.trim()) out.push(`- **${zh}**: ${v.trim()}`)
      }
      out.push('')
    }
  }

  if (codex.length > 0) {
    out.push('## 设定集', '')
    for (const e of codex) {
      out.push(`### ${e.name}`, '')
      out.push(`- **类型**: ${CODEX_TYPE_ZH[e.type] ?? '设定'}`)
      if (e.summary.trim()) out.push(`- **简介**: ${e.summary.trim()}`)
      if (e.details.trim()) out.push(`- **详情**: ${e.details.trim()}`)
      out.push('')
    }
  }

  if (plotLines.length > 0) {
    out.push('## 情节线', '')
    for (const p of plotLines) {
      out.push(`### ${p.name}`, '')
      out.push(`- **起始章节**: ${p.startChapter || '—'}`)
      out.push(`- **结束章节**: ${p.endChapter || '—'}`)
      out.push(`- **状态**: ${p.status === 'completed' ? '已完结' : p.status === 'paused' ? '已暂停' : '进行中'}`)
      if (p.description?.trim()) out.push(`- **简介**: ${p.description.trim()}`)
      out.push('')
    }
  }

  return out.join('\n').trimEnd() + '\n'
}
