/**
 * 上下文注入管线（6.1）：生成前的资料分析步骤。
 *
 * 流程：本地信号（MaterialIndex 人物/设定条目名匹配请求文本 + 当前章节名）
 * → 产出"涉及资料清单"（条目 + 内容 + 优先级），失败降级为空清单并标注，
 * 不中断生成。用户显式 #文件 引用优先于自动匹配。
 *
 * 6.3 的裁剪与注入由 composeInjectedContext 完成：
 * 当前章节 > 清单内人物 > 其余设定与前情。
 */

import { readText } from '../tauri'
import { getMaterialIndex, type MaterialEntry, type MaterialIndex } from './MaterialIndexService'

export type InjectionKind = 'chapter' | 'character' | 'setting' | 'outline' | 'missing'

export type InjectionItem = {
  /** 唯一键：kind:path:title */
  key: string
  kind: InjectionKind
  title: string
  sourcePath: string | null
  /** 注入正文（missing 时为 null） */
  content: string | null
  /** 匹配信号：'explicit'（用户指定）| 'name-match' | 'current-chapter' | 'fallback' */
  matchedBy: 'explicit' | 'name-match' | 'current-chapter' | 'fallback'
  priority: number
}

export type InjectionPlan = {
  items: InjectionItem[]
  /** 分析是否降级（索引不可用等） */
  degraded: boolean
  degradeReason: string | null
}

const PRIORITY = { chapter: 0, character: 1, setting: 2, outline: 3, missing: 4 } as const

function makeItem(
  kind: InjectionKind,
  title: string,
  sourcePath: string | null,
  content: string | null,
  matchedBy: InjectionItem['matchedBy'],
): InjectionItem {
  return {
    key: `${kind}:${sourcePath ?? '-'}:${title}`,
    kind,
    title,
    sourcePath,
    content,
    matchedBy,
    priority: PRIORITY[kind],
  }
}

/**
 * 生成前资料分析：识别请求文本涉及的人物/设定条目与当前章节。
 * @param requestText 用户请求正文
 * @param currentChapterPath 当前编辑章节（若有）
 */
export async function analyzeInjectionPlan(params: {
  requestText: string
  currentChapterPath: string | null
  explicitRefs?: string[]
}): Promise<InjectionPlan> {
  const { requestText, currentChapterPath, explicitRefs = [] } = params
  const items: InjectionItem[] = []
  const seen = new Set<string>()

  const push = (item: InjectionItem) => {
    if (seen.has(item.key)) return
    seen.add(item.key)
    items.push(item)
  }

  // 0. 用户显式引用（#文件 等）最高优先，kind 按路径推断
  for (const ref of explicitRefs) {
    const kind: InjectionKind = ref.startsWith('stories/')
      ? 'chapter'
      : ref.startsWith('concept/')
        ? ref.includes('人物') || ref.includes('character')
          ? 'character'
          : 'setting'
        : ref.startsWith('outline/')
          ? 'outline'
          : 'setting'
    try {
      const raw = await readText(ref)
      push(makeItem(kind, ref.split('/').pop()?.replace(/\.md$/, '') ?? ref, ref, raw, 'explicit'))
    } catch {
      push(makeItem('missing', ref, ref, null, 'explicit'))
    }
  }

  // 1. 当前章节（前情）
  if (currentChapterPath && !seen.has(`chapter:${currentChapterPath}:chapter`)) {
    try {
      const raw = await readText(currentChapterPath)
      push(makeItem('chapter', currentChapterPath.split('/').pop()?.replace(/\.md$/, '') ?? currentChapterPath, currentChapterPath, raw, 'current-chapter'))
    } catch {
      // 当前章节读不到不阻断
    }
  }

  // 2. 本地信号：MaterialIndex 条目名匹配
  let index: MaterialIndex | null = null
  let degraded = false
  let degradeReason: string | null = null
  try {
    index = await getMaterialIndex()
  } catch (e) {
    degraded = true
    degradeReason = e instanceof Error ? e.message : String(e)
  }

  if (index) {
    for (const entry of index.entries as MaterialEntry[]) {
      if (!entry.title) continue
      // 标题（≥2 字符）在请求文本中出现即视为涉及
      if (entry.title.length >= 2 && requestText.includes(entry.title)) {
        const kind: InjectionKind =
          entry.kind === 'character' ? 'character' : entry.kind === 'outline' ? 'outline' : 'setting'
        const content = entry.body || Object.entries(entry.attributes).map(([k, v]) => `${k}：${v}`).join('\n')
        push(makeItem(kind, entry.title, entry.sourcePath, content, 'name-match'))
      }
    }
    // 关系传导（双向）：与命中条目相邻的条目一并带上（人物常成对出现）
    const hitTitles = new Set(items.filter((i) => i.matchedBy === 'name-match').map((i) => i.title))
    const relatedTitles = new Set<string>()
    for (const entry of index.entries) {
      for (const r of entry.relations) {
        if (hitTitles.has(r)) relatedTitles.add(entry.title)
        if (hitTitles.has(entry.title)) relatedTitles.add(r)
      }
    }
    for (const entry of index.entries) {
      if (hitTitles.has(entry.title) || !relatedTitles.has(entry.title)) continue
      const kind: InjectionKind =
        entry.kind === 'character' ? 'character' : entry.kind === 'outline' ? 'outline' : 'setting'
      const content = entry.body || Object.entries(entry.attributes).map(([k, v]) => `${k}：${v}`).join('\n')
      push(makeItem(kind, entry.title, entry.sourcePath, content, 'name-match'))
    }
  }

  return { items, degraded, degradeReason }
}

/**
 * 按清单组装注入上下文块 + 一致性约束指令。
 * 超限按优先级裁剪（chapter > character > setting/outline > missing），
 * 返回被裁条目。缺失条目在块内标注不中断。
 */
export function composeInjectedContext(
  plan: InjectionPlan,
  budgetChars: number,
): { contextBlock: string; trimmed: InjectionItem[]; included: InjectionItem[] } {
  const sorted = [...plan.items].sort((a, b) => a.priority - b.priority)
  const included: InjectionItem[] = []
  const trimmed: InjectionItem[] = []

  const CONSTRAINT_HEADER = '## 设定一致性约束（项目注入）'
  const CONSTRAINT_FOOTER =
    '以上资料为本书既定设定。生成内容 MUST 与之一致：人物性格/关系、世界观规则、时间线不得矛盾；若发现资料间冲突，遵循前文与更高优先级条目。'

  const headerLen = CONSTRAINT_HEADER.length + CONSTRAINT_FOOTER.length + 64
  let used = headerLen

  for (const item of sorted) {
    const itemLen = item.content?.length ?? 0
    if (item.kind === 'missing') continue // 缺失统一在尾部标注
    if (used + itemLen > budgetChars) {
      trimmed.push(item)
      continue
    }
    included.push(item)
    used += itemLen
  }

  const sections: string[] = [CONSTRAINT_HEADER]
  for (const item of included) {
    sections.push(`### [${item.kind}] ${item.title} (${item.sourcePath ?? 'inline'})\n${item.content?.trim() ?? ''}`)
  }
  const missing = plan.items.filter((i) => i.kind === 'missing')
  if (missing.length > 0) {
    sections.push(`### 缺失条目（无法解析到资料文件，生成时请注意不要虚构其细节）\n${missing.map((m) => `- ${m.sourcePath ?? m.title}`).join('\n')}`)
  }
  sections.push(CONSTRAINT_FOOTER)

  return { contextBlock: sections.join('\n\n'), trimmed, included }
}
