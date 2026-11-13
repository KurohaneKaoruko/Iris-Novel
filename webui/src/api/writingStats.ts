/**
 * 写作会话统计：基于 .novel/.history/writing-history.json（recordTodayWords 逐日累计）。
 * 纯函数组装层，供 ToolsDialog「作品统计」页签渲染 30 天趋势条。
 * 数据源缺失/为空时返回空数组（UI 显示空态说明，不做伪造近似）。
 */
import type { WritingHistoryEntry } from './novel'

/** 单日趋势数据（不含零字数填充日——UI 用日期轴补位） */
export type WritingDay = { date: string; wordCount: number; goal: number }

/**
 * 写作历史 → 最近 N 天（默认 30）逐日字数序列，按日期升序。
 * 超出窗口的条目丢弃；窗口内缺失的日期（未写作）由补位函数填充为零。
 */
export function recentWritingDays(history: WritingHistoryEntry[], days = 30, today = new Date()): WritingDay[] {
  const map = new Map(history.map((h) => [h.date, h]))
  const out: WritingDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const hit = map.get(key)
    out.push({ date: key, wordCount: hit?.wordCount ?? 0, goal: hit?.goal ?? 0 })
  }
  return out
}

/**
 * 趋势条高度归一：0 字数恒为 0 高度；其余按 max 等比缩放（min 高度 0.12，
 * 保证非零日肉眼可见）。max <= 0 时全部为 0。
 */
export function trendBarHeights(values: number[]): number[] {
  const max = Math.max(...values, 0)
  if (max <= 0) return values.map(() => 0)
  return values.map((v) => (v <= 0 ? 0 : Math.max(0.12, v / max)))
}

/**
 * 最近 N 天汇总：总字数 / 有产出天数 / 日均（按有产出天数计，避免冷启动期稀释）；
 * 全零时日均 0。
 */
export function summarizeWritingDays(days: WritingDay[]): { total: number; activeDays: number; avg: number } {
  const total = days.reduce((s, d) => s + d.wordCount, 0)
  const activeDays = days.filter((d) => d.wordCount > 0).length
  return { total, activeDays, avg: activeDays > 0 ? Math.round(total / activeDays) : 0 }
}

/**
 * 趋势条日期轴刻度：挑首日/末日与中间稀疏点（约每 1/4 窗口一处），
 * 返回 {index, label} 供 UI 定位。label 格式 M/D。
 */
export function trendAxisLabels(days: WritingDay[]): Array<{ index: number; label: string }> {
  if (days.length === 0) return []
  const fmt = (d: WritingDay) => {
    const [, m, dd] = d.date.split('-')
    return `${Number(m)}/${Number(dd)}`
  }
  if (days.length <= 2) return days.map((d, i) => ({ index: i, label: fmt(d) }))
  const mid = Math.floor((days.length - 1) / 2)
  const out = [
    { index: 0, label: fmt(days[0]) },
    { index: mid, label: fmt(days[mid]) },
    { index: days.length - 1, label: fmt(days[days.length - 1]) },
  ]
  // 去重：窗口很短时三点可能重叠
  return out.filter((t, i) => i === 0 || t.index !== out[i - 1].index)
}

// ============ 每日目标与连续达标 ============

/** 单日达标判定：目标 > 0 且当日字数 ≥ 目标。无目标视为不达标。 */
export function isGoalHit(day: { wordCount: number; goal: number }): boolean {
  return day.goal > 0 && day.wordCount >= day.goal
}

/**
 * 单日有效目标：逐日 goal 优先（写作历史里已固化的目标），否则回退当前全局目标。
 * 两者皆无返回 0（无目标）。
 */
export function dayGoal(day: { goal: number }, globalGoal: number): number {
  return day.goal > 0 ? day.goal : globalGoal
}

/**
 * 连续达标天数：从窗口末尾（今天）往回数，遇到不达标日即停。
 * 今天写了但未达标不算断链——跳过今天从昨天继续数（目标鼓励的是不间断的习惯，
 * 今天的仗还没打完）。无任何达标日返回 0。
 */
export function streakGoalDays(days: WritingDay[], globalGoal: number): number {
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]
    const goal = dayGoal(d, globalGoal)
    if (goal <= 0) return streak
    if (d.wordCount >= goal) {
      streak += 1
    } else if (i === days.length - 1) {
      continue // 今天未达标：不断链，看昨天
    } else {
      break
    }
  }
  return streak
}
