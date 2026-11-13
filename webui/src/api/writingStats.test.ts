import { describe, expect, it } from 'vitest'
import { recentWritingDays, trendBarHeights, summarizeWritingDays, trendAxisLabels, isGoalHit, dayGoal, streakGoalDays } from './writingStats'

describe('recentWritingDays', () => {
  it('最近 N 天窗口 + 零字数补位，按日期升序', () => {
    const today = new Date(2026, 10, 13) // 2026-11-13
    const days = recentWritingDays(
      [
        { date: '2026-11-12', wordCount: 800, goal: 2000 },
        { date: '2026-11-13', wordCount: 1200, goal: 2000 },
        { date: '2026-10-01', wordCount: 99999, goal: 0 }, // 窗口外丢弃
      ],
      3,
      today,
    )
    expect(days.map((d) => d.date)).toEqual(['2026-11-11', '2026-11-12', '2026-11-13'])
    expect(days.map((d) => d.wordCount)).toEqual([0, 800, 1200])
    expect(days[2].goal).toBe(2000)
  })

  it('空历史返回全零窗口', () => {
    const days = recentWritingDays([], 2, new Date(2026, 0, 5))
    expect(days).toEqual([
      { date: '2026-01-04', wordCount: 0, goal: 0 },
      { date: '2026-01-05', wordCount: 0, goal: 0 },
    ])
  })

  it('跨月/跨年补位日期正确', () => {
    const days = recentWritingDays([], 3, new Date(2027, 0, 2))
    expect(days.map((d) => d.date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02'])
  })
})

describe('trendBarHeights', () => {
  it('按最大值等比缩放', () => {
    expect(trendBarHeights([0, 500, 1000])).toEqual([0, 0.5, 1])
  })

  it('非零最小高度 0.12（矮条可见）', () => {
    expect(trendBarHeights([1000, 10])[1]).toBe(0.12)
    expect(trendBarHeights([1000, 10])[0]).toBe(1)
  })

  it('全零返回全零', () => {
    expect(trendBarHeights([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('summarizeWritingDays', () => {
  it('总字数/有产出天数/按活跃天日均', () => {
    const s = summarizeWritingDays([
      { date: '2026-11-11', wordCount: 0, goal: 0 },
      { date: '2026-11-12', wordCount: 800, goal: 0 },
      { date: '2026-11-13', wordCount: 1200, goal: 0 },
    ])
    expect(s).toEqual({ total: 2000, activeDays: 2, avg: 1000 })
  })

  it('全零窗口日均 0', () => {
    expect(summarizeWritingDays([{ date: '2026-11-11', wordCount: 0, goal: 0 }])).toEqual({ total: 0, activeDays: 0, avg: 0 })
  })
})

describe('trendAxisLabels', () => {
  it('首/中/尾三点 M/D 刻度', () => {
    const days = recentWritingDays([], 30, new Date(2026, 10, 13))
    const labels = trendAxisLabels(days)
    expect(labels[0]).toEqual({ index: 0, label: '10/15' })
    expect(labels[1].label).toBe('10/29')
    expect(labels[2]).toEqual({ index: 29, label: '11/13' })
  })

  it('窗口过短去重叠刻度', () => {
    const labels = trendAxisLabels([{ date: '2026-11-13', wordCount: 0, goal: 0 }])
    expect(labels).toEqual([{ index: 0, label: '11/13' }])
    const two = trendAxisLabels([
      { date: '2026-11-12', wordCount: 0, goal: 0 },
      { date: '2026-11-13', wordCount: 0, goal: 0 },
    ])
    expect(two).toEqual([
      { index: 0, label: '11/12' },
      { index: 1, label: '11/13' },
    ])
  })

  it('空输入返回空', () => {
    expect(trendAxisLabels([])).toEqual([])
  })
})

describe('isGoalHit（单日达标判定）', () => {
  it('目标 > 0 且字数 ≥ 目标 才算达标', () => {
    expect(isGoalHit({ wordCount: 2000, goal: 2000 })).toBe(true)
    expect(isGoalHit({ wordCount: 1999, goal: 2000 })).toBe(false)
  })

  it('无目标（goal 0）不算达标——包括 0 字当日', () => {
    expect(isGoalHit({ wordCount: 5000, goal: 0 })).toBe(false)
    expect(isGoalHit({ wordCount: 0, goal: 2000 })).toBe(false)
  })
})

describe('dayGoal（逐日目标回退全局）', () => {
  it('逐日已固化 goal 优先，否则回退全局目标', () => {
    expect(dayGoal({ goal: 1500 }, 2000)).toBe(1500)
    expect(dayGoal({ goal: 0 }, 2000)).toBe(2000)
    expect(dayGoal({ goal: 0 }, 0)).toBe(0)
  })
})

describe('streakGoalDays（连续达标天数）', () => {
  const mk = (wcs: number[], goals: number[] = []) =>
    wcs.map((wordCount, i) => ({
      date: `2026-11-${String(13 - wcs.length + 1 + i).padStart(2, '0')}`,
      wordCount,
      goal: goals[i] ?? 0,
    }))

  it('从今天往回连续达标计数', () => {
    // 11,12,13 三天全部 ≥ 1000
    expect(streakGoalDays(mk([1200, 1000, 2500], [1000, 1000, 1000]), 0)).toBe(3)
  })

  it('今天写了但未达标不断链——跳过今天继续数', () => {
    expect(streakGoalDays(mk([1000, 1000, 300], [1000, 1000, 1000]), 0)).toBe(2)
  })

  it('昨天及更早未达标即停', () => {
    expect(streakGoalDays(mk([1200, 500, 100], [1000, 1000, 1000]), 0)).toBe(0)
    // 今天 100 未达标（豁免）、昨天 1000 达标 → 连续从昨天起 1 天
    expect(streakGoalDays(mk([500, 1000, 100], [1000, 1000, 1000]), 0)).toBe(1)
  })

  it('逐日已固化 goal 优先于全局目标判定', () => {
    // 12 日固化目标 800（达标），13 日无固化目标回退全局 1500（未达标，今天豁免）→ 连续 1
    expect(streakGoalDays(mk([900, 1200], [800, 0]), 1500)).toBe(1)
  })

  it('无目标（全 0）返回 0', () => {
    expect(streakGoalDays(mk([3000, 3000], [0, 0]), 0)).toBe(0)
  })

  it('空窗口返回 0', () => {
    expect(streakGoalDays([], 2000)).toBe(0)
  })

  it('只有今天且达标计 1；只有今天未达标计 0', () => {
    expect(streakGoalDays(mk([2500], [2000]), 0)).toBe(1)
    expect(streakGoalDays(mk([300], [2000]), 0)).toBe(0)
  })
})
