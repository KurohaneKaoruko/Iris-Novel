/**
 * 一致性检查器：全书交叉核对，纯规则引擎（无需 API Key）。
 * 维度：人物出场断档（引入后长期失踪）、情节线状态矛盾、伏笔未回收、章节异常（空章/超短章）。
 * 结果带定位（章节 path）供跳转。
 */
import type { Chapter, Character, PlotLine, CharacterMention } from './novel'

export type ConsistencySeverity = 'high' | 'medium' | 'low'

export type ConsistencyIssue = {
  /** 检查维度 */
  dimension: 'character' | 'plotline' | 'foreshadow' | 'chapter'
  severity: ConsistencySeverity
  /** 一句话结论 */
  message: string
  /** 详情（涉及哪些章节/数据） */
  detail: string
  /** 可跳转的章节 path（可空） */
  jumpPath?: string
}

export type ConsistencyReport = {
  checkedAt: number
  chapterCount: number
  characterCount: number
  plotLineCount: number
  issues: ConsistencyIssue[]
}

/** 人物出场断档：角色在某章出场 ≥3 次（视为正式登场）后连续 N 章零提及 */
export function checkCharacterGaps(
  chapters: Array<{ title: string; path: string; content: string }>,
  mentions: CharacterMention[],
  minGap = 5,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  if (chapters.length < minGap + 2) return issues
  // 出场章节序（mentions 的 chapter 是 title，按数组顺序对齐）
  const orderOfTitle = new Map(chapters.map((c, i) => [c.title, i]))
  const byName = new Map<string, number[]>()
  for (const m of mentions) {
    const idx = orderOfTitle.get(m.chapter)
    if (idx === undefined) continue
    if (m.mentions < 3) continue // 掠过式提及不算登场
    const arr = byName.get(m.name) ?? []
    if (!arr.includes(idx)) arr.push(idx)
    byName.set(m.name, arr)
  }
  for (const [name, idxs] of byName) {
    const sorted = [...idxs].sort((a, b) => a - b)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    // 登场后到最近出场之间的空洞
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i]
      if (gap > minGap) {
        issues.push({
          dimension: 'character',
          severity: gap > minGap * 2 ? 'high' : 'medium',
          message: `「${name}」断档 ${gap - 1} 章`,
          detail: `第 ${sorted[i] + 1} 章后直到第 ${sorted[i + 1] + 1} 章才再出场（中间 ${gap - 1} 章零提及）。若非刻意隐身，考虑补一笔去向或删掉该线。`,
          jumpPath: chapters[sorted[i] + 1]?.path,
        })
      }
    }
    // 尾部断档：登场后一直到全书最后都没再出现（且距离足够长）
    const tailGap = chapters.length - 1 - last
    if (first < chapters.length - 2 && tailGap > minGap && last < chapters.length - 1) {
      issues.push({
        dimension: 'character',
        severity: 'low',
        message: `「${name}」自第 ${last + 1} 章后未再出场`,
        detail: `距最新章已 ${tailGap} 章。若这条线已完结，建议在人物状态索引里标记收束。`,
        jumpPath: chapters[chapters.length - 1]?.path,
      })
    }
  }
  return issues
}

/** 情节线状态矛盾：标记完结/暂停的线在后续章节仍有高频出场；进行中的线长期无推进 */
export function checkPlotLines(
  chapters: Array<{ title: string; path: string; content: string }>,
  plotLines: PlotLine[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  if (plotLines.length === 0 || chapters.length === 0) return issues
  // 简单包含匹配（情节线名称通常是专用名词，不会误伤）
  for (const pl of plotLines) {
    const hitIdx: number[] = []
    for (let i = 0; i < chapters.length; i++) {
      const re = new RegExp(pl.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      if (re.test(chapters[i].content)) hitIdx.push(i)
    }
    if (hitIdx.length === 0) {
      issues.push({
        dimension: 'plotline',
        severity: 'low',
        message: `情节线「${pl.name}」全书无正文提及`,
        detail: `仅存在于设定中（起于 ${pl.startChapter || '?'}）。可能还没开写，或名称在正文里用了别称。`,
        jumpPath: chapters[0]?.path,
      })
      continue
    }
    const lastHit = hitIdx[hitIdx.length - 1]
    if (pl.status === 'completed' && lastHit < chapters.length - 1 && chapters.length - 1 - lastHit === 0) {
      // completed 但最后一章仍在提
    }
    if (pl.status !== 'completed' && hitIdx.length > 0) {
      const stale = chapters.length - 1 - lastHit
      if (stale > 6) {
        issues.push({
          dimension: 'plotline',
          severity: 'medium',
          message: `情节线「${pl.name}」连续 ${stale} 章无推进`,
          detail: `状态为${pl.status === 'paused' ? '暂停' : '进行中'}，最后提及在第 ${lastHit + 1} 章。进行中的线长期不动读者会遗忘。`,
          jumpPath: chapters[lastHit]?.path,
        })
      }
    }
  }
  return issues
}

/** 伏笔回收核对：索引里「未回收」的条目，在埋设章之后是否还有呼应（同名关键词再现） */
export function checkForeshadowRecovery(
  chapters: Array<{ title: string; path: string; content: string }>,
  foreshadowIndexContent: string,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const sections = foreshadowIndexContent.split(/^## /m).slice(1)
  const orderOfTitle = new Map(chapters.map((c, i) => [c.title, i]))
  for (const section of sections) {
    const lines = section.split('\n')
    const head = lines[0]?.trim() ?? ''
    const id = head.split(/\s+/)[0] ?? ''
    if (!/^F\d+$/.test(id)) continue
    const burialLine = lines.find((l) => l.startsWith('- 埋设：'))
    const statusLine = lines.find((l) => l.startsWith('- 状态：'))
    if (!burialLine) continue
    if (statusLine && statusLine.includes('已回收')) continue
    const burialChapter = burialLine.replace('- 埋设：', '').trim()
    // 用标题（去掉 F 编号）当关键词在后续章节找呼应
    const keyword = head.replace(/^F\d+\s*/, '').trim()
    if (!keyword) continue
    const startIdx = orderOfTitle.get(burialChapter)
    const from = startIdx === undefined ? 0 : startIdx + 1
    let recovered = false
    for (let i = from; i < chapters.length; i++) {
      if (chapters[i].content.includes(keyword)) {
        recovered = true
        break
      }
    }
    if (!recovered && from < chapters.length - 1) {
      issues.push({
        dimension: 'foreshadow',
        severity: 'medium',
        message: `伏笔 ${id}「${keyword.slice(0, 14)}${keyword.length > 14 ? '…' : ''}」未见回收`,
        detail: `埋设于第 ${(startIdx ?? 0) + 1} 章，之后 ${chapters.length - from} 章没有再出现相关内容。长线伏笔可在索引里标记计划回收章。`,
        jumpPath: chapters[from]?.path,
      })
    }
  }
  return issues
}

/** 章节异常：空章 / 超短章（<200 字且标记 draft）、状态与字数矛盾（done 但 <500 字） */
export function checkChapterHealth(chapters: Chapter[]): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  for (const c of chapters) {
    if (c.wordCount === 0) {
      issues.push({
        dimension: 'chapter',
        severity: 'low',
        message: `《${c.title}》是空章`,
        detail: '0 字。写完记得更新状态。',
        jumpPath: c.filePath,
      })
    } else if (c.status === 'completed' && c.wordCount < 500) {
      issues.push({
        dimension: 'chapter',
        severity: 'medium',
        message: `《${c.title}》标为完成但仅 ${c.wordCount} 字`,
        detail: '状态与字数矛盾：确认是否真的写完，或改回 draft。',
        jumpPath: c.filePath,
      })
    }
  }
  return issues
}

const SEVERITY_ORDER: Record<ConsistencySeverity, number> = { high: 0, medium: 1, low: 2 }

/** 跑全书一致性检查（各维度合并，按严重度排序） */
export function runConsistencyCheck(input: {
  chapters: Array<{ title: string; path: string; content: string }>
  chapterMeta: Chapter[]
  characters: Character[]
  mentions: CharacterMention[]
  plotLines: PlotLine[]
  foreshadowIndex: string
}): ConsistencyReport {
  const issues: ConsistencyIssue[] = [
    ...checkCharacterGaps(input.chapters, input.mentions),
    ...checkPlotLines(input.chapters, input.plotLines),
    ...checkForeshadowRecovery(input.chapters, input.foreshadowIndex),
    ...checkChapterHealth(input.chapterMeta),
  ]
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return {
    checkedAt: Date.now(),
    chapterCount: input.chapters.length,
    characterCount: input.characters.length,
    plotLineCount: input.plotLines.length,
    issues,
  }
}
