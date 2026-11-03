import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/transport', () => ({
  callCommand: vi.fn(),
}))

import { callCommand } from '../src/transport'
import { workStatsService } from '../src/services/WorkStatsService'
import { chapterService } from '../src/services/ChapterService'
import { writingGoalService } from '../src/services/WritingGoalService'

const invokeMock = vi.mocked(callCommand)

function mockTree(dirs: Record<string, string[]>) {
  return {
    name: 'work',
    path: '/work',
    kind: 'dir' as const,
    children: Object.entries(dirs).map(([name, files]) => ({
      name,
      path: `/work/${name}`,
      kind: 'dir' as const,
      children: files.map((f) => ({ name: f, path: `/work/${name}/${f}`, kind: 'file' as const, children: [] })),
    })),
  }
}

describe('WorkStatsService', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    vi.spyOn(chapterService, 'listChapters').mockResolvedValue([
      { id: '1', filePath: 'stories/001.md', title: '第一章', wordCount: 3000, status: 'completed', lastModified: 100, order: 1 },
      { id: '2', filePath: 'stories/002.md', title: '第二章', wordCount: 1500, status: 'draft', lastModified: 200, order: 2 },
      { id: '3', filePath: 'stories/003.md', title: '第三章', wordCount: 500, status: 'draft', lastModified: 300, order: 3 },
    ])
    vi.spyOn(writingGoalService, 'getCurrentGoal').mockResolvedValue({
      dailyWordCount: 2000,
      currentStreak: 3,
      longestStreak: 5,
    })
    vi.spyOn(writingGoalService, 'getTodayStats').mockResolvedValue({
      date: '2026-11-03',
      wordCount: 800,
      goal: 2000,
      progress: 0.4,
      timeSpent: 1200,
    })
    vi.spyOn(writingGoalService, 'getHistory').mockResolvedValue([
      { date: '2026-11-01', wordCount: 1200, goal: 2000, achieved: false },
      { date: '2026-11-02', wordCount: 2200, goal: 2000, achieved: true },
    ])
  })

  it('getWorkStats 汇总章节字数与完成数', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_workspace_tree') {
        return mockTree({ concept: ['人物.md', '关系.md'], outline: ['总纲.md'] })
      }
      throw new Error(`unexpected command: ${cmd}`)
    })

    const stats = await workStatsService.getWorkStats()
    expect(stats.totalWords).toBe(5000)
    expect(stats.chapterCount).toBe(3)
    expect(stats.completedChapters).toBe(1)
    expect(stats.conceptCount).toBe(2)
    expect(stats.outlineCount).toBe(1)
    expect(stats.daysWriting).toBe(2)
    expect(stats.todayWords).toBe(800)
    expect(stats.longestChapter).toEqual({ title: '第一章', words: 3000 })
    expect(stats.shortestChapter).toEqual({ title: '第三章', words: 500 })
    expect(stats.lastUpdated).toBe(300)
  })

  it('目录读取失败时资料计数降级为 0', async () => {
    invokeMock.mockRejectedValue(new Error('no workspace'))
    const stats = await workStatsService.getWorkStats()
    expect(stats.conceptCount).toBe(0)
    expect(stats.outlineCount).toBe(0)
    expect(stats.totalWords).toBe(5000)
  })

  it('章节服务失败时字数降级为 0', async () => {
    vi.spyOn(chapterService, 'listChapters').mockRejectedValue(new Error('io'))
    invokeMock.mockResolvedValue(mockTree({}))
    const stats = await workStatsService.getWorkStats()
    expect(stats.totalWords).toBe(0)
    expect(stats.chapterCount).toBe(0)
    expect(stats.longestChapter).toBeUndefined()
  })

  it('getProgress 返回三环进度数据', async () => {
    const progress = await workStatsService.getProgress(1_000_000)
    expect(progress.totalWords).toBe(5000)
    expect(progress.targetWords).toBe(1_000_000)
    expect(progress.chapters).toBe(3)
    expect(progress.completedChapters).toBe(1)
    expect(progress.dailyTarget).toBe(2000)
    expect(progress.todayWords).toBe(800)
  })

  it('getProgress 无目标时 targetWords 为 0', async () => {
    const progress = await workStatsService.getProgress()
    expect(progress.targetWords).toBe(0)
  })
})
