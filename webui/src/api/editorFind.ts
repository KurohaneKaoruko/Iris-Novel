/**
 * 章节编辑器内查找纯函数层：命中位置序列计算 + 循环导航。
 * 与 UI 解耦（不触碰 DOM/React），供 AgentWorkspace 查找条与单测共用。
 */

/** 文本中的单个命中：selectionStart/End 直接可用于 textarea.setSelectionRange */
export type FindHit = { start: number; end: number }

/**
 * 计算 needle 在 haystack 中的全部命中位置（大小写不敏感可关）。
 * 重叠命中也逐一列出（步进 1，如「aaa」找「aa」得 [0,1] 两处）；
 * 空 needle 返回空序列。原始 needle（非 lowercase 视图）长度作命中宽度，
 * 保证中文等无大小写变化的文本长度一致。
 */
export function findHits(haystack: string, needle: string, caseSensitive = false): FindHit[] {
  if (!needle) return []
  const h = caseSensitive ? haystack : haystack.toLowerCase()
  const n = caseSensitive ? needle : needle.toLowerCase()
  const width = needle.length
  const out: FindHit[] = []
  let from = 0
  while (true) {
    const idx = h.indexOf(n, from)
    if (idx < 0) break
    out.push({ start: idx, end: idx + width })
    from = idx + 1
  }
  return out
}

/**
 * 循环导航：取当前光标位置 current 之后的首个命中；其后没有则回绕到首个。
 * 命中序列为空返回 null（UI 关闭定位）。next=false 时取 current 之前
 * （不含光标处命中，即严格小于 current.start 的最后一个）——
 * 序列里没有更早的则回绕到最后一个。
 */
export function nextHit(hits: FindHit[], current: number, next: boolean): FindHit | null {
  if (hits.length === 0) return null
  if (next) {
    return hits.find((hit) => hit.start >= current) ?? hits[0]
  }
  const before = hits.filter((hit) => hit.start < current)
  return before.length > 0 ? before[before.length - 1] : hits[hits.length - 1]
}
