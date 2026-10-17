/**
 * 资料索引服务（5.1）：concept/outline Markdown → 结构化条目解析器
 * 与 `.novel/index/material-index.json` 缓存。
 *
 * 单一事实来源：`.md` 文件。缓存只是解析产物投影，损坏/缺失/过期时
 * 从源文件完整重建。沿用记忆索引的 source/locked 语义：
 * - source: auto（解析器生成）| manual（用户改过缓存）
 * - locked: true（条目不被自动重建覆盖）
 */

import { callCommand } from '../transport'
import { readText, writeText } from '../tauri'

export type MaterialKind = 'character' | 'setting' | 'outline'

export type MaterialEntry = {
  /** 条目 ID：`<kind>:<file>:<heading-slug>` */
  id: string
  kind: MaterialKind
  /** 源文件相对路径（如 concept/人物-林秋.md） */
  sourcePath: string
  /** 条目所在标题（人物名/设定名/大纲条目名） */
  title: string
  /** 属性键值对（- 键： 值 列表项；别名/身份/关系等） */
  attributes: Record<string, string>
  /** 正文段落（标题下非列表内容） */
  body: string
  /** 关联声明（attributes 中 relations/关系 字段解析出的目标名列表） */
  relations: string[]
  meta: MaterialEntryMeta
}

export type MaterialEntryMeta = {
  source: 'auto' | 'manual'
  locked: boolean
}

export type MaterialIndex = {
  entries: MaterialEntry[]
  builtAt: string
  sourceFiles: Record<string, string>
}

const CACHE_PATH = '.novel/index/material-index.json'
const RELATION_KEYS = ['关系', 'relations', '关联']

// ---- 解析 ----

function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '') || 'untitled'
}

function kindForPath(path: string): MaterialKind | null {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('concept/')) return 'character'
  if (normalized.startsWith('outline/')) return 'outline'
  return null
}

/** 解析单个 md 文件的条目（按二级标题分节；无标题时整文件一条） */
export function parseMaterialFile(sourcePath: string, raw: string): MaterialEntry[] {
  const kind = kindForPath(sourcePath)
  if (!kind) return []
  const normalized = raw.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  const sections: Array<{ title: string; lines: string[] }> = []
  let current: { title: string; lines: string[] } | null = null
  let preamble: string[] = []

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      if (current) sections.push(current)
      current = { title: heading[2].trim(), lines: [] }
    } else if (current) {
      current.lines.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) sections.push(current)

  const fileTitle = sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? sourcePath
  const entries: MaterialEntry[] = []

  const buildEntry = (title: string, bodyLines: string[]): MaterialEntry => {
    const attributes: Record<string, string> = {}
    const bodyParts: string[] = []
    for (const line of bodyLines) {
      const item = line.match(/^\s*[-*]\s+([^：:]+)[：:]\s*(.+)$/)
      if (item) {
        attributes[item[1].trim()] = item[2].trim()
      } else if (line.trim()) {
        bodyParts.push(line.trim())
      }
    }
    // YAML front matter（若有）并入 attributes
    if (bodyParts[0] === '---') {
      const end = bodyParts.indexOf('---', 1)
      if (end > 0) {
        for (const line of bodyParts.slice(1, end)) {
          const m = line.match(/^([\w\u4e00-\u9fa5-]+)\s*:\s*(.+)$/)
          if (m) attributes[m[1].trim()] = m[2].trim()
        }
        bodyParts.splice(0, end + 1)
      }
    }
    const relations: string[] = []
    for (const key of RELATION_KEYS) {
      const v = attributes[key]
      if (!v) continue
      for (const part of v.split(/[,，、;；]/)) {
        // 去掉关系注记括号：前缀（搭档）苏晚 / 后缀 苏晚（搭档）均支持
        const name = part.trim().replace(/^[（(][^）)]*[）)]\s*/, '').replace(/\s*[（(][^）)]*[）)]$/, '')
        if (name) relations.push(name)
      }
    }
    return {
      id: `${kind}:${sourcePath}:${slugify(title)}`,
      kind,
      sourcePath,
      title,
      attributes,
      body: bodyParts.join('\n'),
      relations,
      meta: { source: 'auto', locked: false },
    }
  }

  if (sections.length === 0) {
    entries.push(buildEntry(fileTitle, preamble))
  } else {
    for (const s of sections) entries.push(buildEntry(s.title, s.lines))
  }
  return entries
}

// ---- 缓存 ----

function parseCache(raw: string): MaterialIndex | null {
  try {
    const data = JSON.parse(raw) as MaterialIndex
    if (!Array.isArray(data.entries) || typeof data.sourceFiles !== 'object') return null
    return data
  } catch {
    return null
  }
}

async function listMaterialFiles(dir: 'concept' | 'outline'): Promise<string[]> {
  try {
    const tree = await callCommand<{ name: string; kind: string; path: string; children?: unknown[] }>(
      'list_workspace_tree',
      { maxDepth: 2 },
    )
    const target = tree.children?.find((c) => c.name === dir && c.kind === 'dir')
    if (!target?.children) return []
    return (target.children as Array<{ name: string; kind: string; path: string }>)
      .filter((c) => c.kind === 'file' && c.name.endsWith('.md'))
      .map((c) => c.path)
      .sort()
  } catch {
    return []
  }
}

/**
 * 构建资料索引：读源文件解析条目，合并缓存中 manual/locked 条目，
 * 写回缓存文件。缓存缺失/损坏时自动全量重建（降级不失败）。
 */
export async function buildMaterialIndex(): Promise<MaterialIndex> {
  const [conceptFiles, outlineFiles] = await Promise.all([
    listMaterialFiles('concept'),
    listMaterialFiles('outline'),
  ])

  let cached: MaterialIndex | null = null
  try {
    cached = parseCache(await readText(CACHE_PATH))
  } catch {
    cached = null
  }

  const entries: MaterialEntry[] = []
  const sourceFiles: Record<string, string> = {}
  for (const file of [...conceptFiles, ...outlineFiles]) {
    try {
      const raw = await readText(file)
      sourceFiles[file] = raw
      entries.push(...parseMaterialFile(file, raw))
    } catch {
      // 单文件失败不阻断索引构建
    }
  }

  // 合并 manual/locked：同名 id 的缓存条目若 locked，保留缓存版本
  if (cached) {
    const lockedById = new Map(
      cached.entries.filter((e) => e.meta.locked || e.meta.source === 'manual')
        .map((e) => [e.id, e] as const),
    )
    for (let i = 0; i < entries.length; i += 1) {
      const locked = lockedById.get(entries[i].id)
      if (locked) entries[i] = locked
    }
  }

  const index: MaterialIndex = {
    entries,
    builtAt: new Date().toISOString(),
    sourceFiles,
  }

  try {
    await writeText(CACHE_PATH, JSON.stringify(index, null, 2))
  } catch {
    // 缓存写失败不影响返回（视图仍可用）
  }
  return index
}

/** 读缓存（不重建）；无缓存返回 null */
export async function readMaterialIndexCache(): Promise<MaterialIndex | null> {
  try {
    return parseCache(await readText(CACHE_PATH))
  } catch {
    return null
  }
}

/**
 * 获取索引：优先缓存且未过期（源文件 mtime 比对简化为内容比对）；
 * 不匹配或缺失时重建。外部改文件 → 内容变 → 自动重建（单一事实来源）。
 */
export async function getMaterialIndex(): Promise<MaterialIndex> {
  const cached = await readMaterialIndexCache()
  if (cached) {
    // 快速校验：源文件集合与内容一致则直接用缓存
    const [conceptFiles, outlineFiles] = await Promise.all([
      listMaterialFiles('concept'),
      listMaterialFiles('outline'),
    ])
    const files = [...conceptFiles, ...outlineFiles]
    const cachedFiles = Object.keys(cached.sourceFiles)
    let fresh = files.length === cachedFiles.length && files.every((f) => cachedFiles.includes(f))
    if (fresh) {
      for (const f of files) {
        try {
          const raw = await readText(f)
          if (cached.sourceFiles[f] !== raw) {
            fresh = false
            break
          }
        } catch {
          fresh = false
          break
        }
      }
    }
    if (fresh) return cached
  }
  return buildMaterialIndex()
}

/** 手动重建入口 */
export async function rebuildMaterialIndex(): Promise<MaterialIndex> {
  return buildMaterialIndex()
}
