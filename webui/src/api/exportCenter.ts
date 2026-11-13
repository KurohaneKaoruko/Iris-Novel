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

// ============ 工程备份快照报告（零依赖：文本清单 + SHA-256 hash，非压缩包） ============

/** 单个被备份文件的清单条目 */
export type BackupFileEntry = {
  path: string
  /** 去空白字符数（与 novel.ts words 口径一致） */
  words: number
  /** 文件字节大小 */
  bytes: number
  /** 内容 SHA-256（hex，前端 crypto.subtle 计算） */
  hash: string
}

/**
 * SHA-256 hex 摘要（Web Crypto；node >= 16 与现代浏览器均有 crypto.subtle）。
 * 输入按 UTF-8 编码，与后端字节口径对文本文件一致。
 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 备份应跳过的路径：导出产物与备份自身（防自吞递增）；其余 .novel/ 状态照常纳入 */
export function isBackupExcluded(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return p.startsWith('exports/')
}

/** 树节点最小结构（collectBackupFiles 只需 path/kind/children） */
type BackupNode = { path: string; kind: string; children?: BackupNode[] }

/** 从工作区文件树收集纳入备份的文件相对路径（排除 exports/，其余全量）。
 * 纯函数：只读树，不做 IO。 */
export function collectBackupFiles(tree: BackupNode): string[] {
  const out: string[] = []
  const walk = (e: BackupNode) => {
    if (e.kind === 'file') {
      if (!isBackupExcluded(e.path)) out.push(e.path)
    }
    for (const c of e.children ?? []) walk(c)
  }
  walk(tree)
  return out.sort((a, b) => a.localeCompare(b))
}

/**
 * 备份快照报告组装（Markdown）：头部摘要 + 按顶层目录分组的逐文件
 * 字数/大小/hash 清单 + 完整性说明。hash 列可用于日后核对文件是否被改动。
 */
export function assembleBackupReport(opts: {
  workName: string
  files: BackupFileEntry[]
  createdAt?: number
}): string {
  const { workName, files } = opts
  const time = new Date(opts.createdAt ?? Date.now()).toLocaleString('zh-CN', { hour12: false })
  const totalWords = files.reduce((s, f) => s + f.words, 0)
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0)
  const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
  const out: string[] = [
    `# 《${workName || '未命名作品'}》备份快照`,
    '',
    `> 快照时间：${time} · 文件 ${files.length} 个 · 总字数 ${totalWords.toLocaleString()} · 总大小 ${fmtBytes(totalBytes)}`,
    '>',
    '> 本报告为文本清单式备份：逐文件记录字数与 SHA-256，可用于核对内容是否被改动。',
    '> 正文与设定的完整内容以本工程目录为准；建议定期用系统工具对整个目录做冷备份。',
    '',
  ]

  // 按顶层目录分组（无目录前缀的归「根目录」）
  const groups = new Map<string, BackupFileEntry[]>()
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.indexOf('/')) : '根目录'
    const arr = groups.get(dir) ?? []
    arr.push(f)
    groups.set(dir, arr)
  }
  for (const [dir, entries] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`## ${dir}/`, '')
    for (const f of entries) {
      out.push(`- \`${f.path}\` — ${f.words.toLocaleString()} 字 · ${fmtBytes(f.bytes)} · \`${f.hash.slice(0, 12)}…\``)
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
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
