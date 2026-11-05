import { describe, expect, it } from 'vitest'
import { checkCharacterGaps, checkPlotLines, checkForeshadowRecovery, checkChapterHealth, runConsistencyCheck } from './consistency'
import type { Chapter, CharacterMention, PlotLine } from './novel'

const mkChapters = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ title: `第 ${i + 1} 章`, path: `stories/chapter-${String(i + 1).padStart(4, '0')}.md`, content: `第${i + 1}章正文。` }))

describe('checkCharacterGaps（人物断档）', () => {
  it('登场后连续失踪报 medium/high', () => {
    const chapters = mkChapters(10)
    // 林越 1-10 章都在；苏晚只在第 1 章和第 9 章出场（中间断 7 章）
    const mentions: CharacterMention[] = [
      ...chapters.map((c) => ({ name: '林越', chapter: c.title, chapterPath: c.path, mentions: 5, dialogueLines: 2 })),
      { name: '苏晚', chapter: '第 1 章', chapterPath: chapters[0].path, mentions: 5, dialogueLines: 1 },
      { name: '苏晚', chapter: '第 9 章', chapterPath: chapters[8].path, mentions: 4, dialogueLines: 1 },
    ]
    const issues = checkCharacterGaps(chapters, mentions, 5)
    const gap = issues.find((i) => i.message.includes('苏晚'))
    expect(gap).toBeDefined()
    expect(gap?.severity).toBe('medium')
    expect(gap?.jumpPath).toBe(chapters[1].path)
  })

  it('掠过式提及（<3 次）不算登场', () => {
    const chapters = mkChapters(8)
    const mentions: CharacterMention[] = [
      { name: '苏晚', chapter: '第 1 章', chapterPath: chapters[0].path, mentions: 1, dialogueLines: 0 },
      { name: '苏晚', chapter: '第 8 章', chapterPath: chapters[7].path, mentions: 1, dialogueLines: 0 },
    ]
    expect(checkCharacterGaps(chapters, mentions, 5)).toHaveLength(0)
  })
})

describe('checkPlotLines（情节线推进）', () => {
  it('进行中的线长期无推进报 medium', () => {
    const chapters = mkChapters(10).map((c, i) => (i < 3 ? { ...c, content: `正文提到复仇线的事。${c.content}` } : c))
    const plotLines: PlotLine[] = [{ id: 'p1', name: '复仇线', startChapter: '第 1 章', status: 'ongoing' }]
    const issues = checkPlotLines(chapters, plotLines)
    expect(issues[0]?.message).toContain('7 章无推进')
  })

  it('全书无提及报 low', () => {
    const chapters = mkChapters(5)
    const plotLines: PlotLine[] = [{ id: 'p1', name: '寻宝线', startChapter: '第 1 章', status: 'ongoing' }]
    const issues = checkPlotLines(chapters, plotLines)
    expect(issues[0]?.message).toContain('全书无正文提及')
  })
})

describe('checkForeshadowRecovery（伏笔回收）', () => {
  it('未回收伏笔在后续无呼应报 medium，已回收跳过', () => {
    const chapters = mkChapters(6)
    const index = [
      '# 伏笔线索',
      '',
      '## F001 神秘玉佩',
      '- 埋设：第 2 章',
      '- 原文：他摸到了那块神秘玉佩',
      '- 状态：未回收',
      '',
      '## F002 师门疑云',
      '- 埋设：第 1 章',
      '- 状态：已回收',
      '',
    ].join('\n')
    // 章节正文不含「神秘玉佩」→ F001 报；F002 已回收跳过
    const issues = checkForeshadowRecovery(chapters, index)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('F001')
  })

  it('后续章节有呼应不报', () => {
    const chapters = mkChapters(4)
    chapters[3].content = '玉佩终于发光了。'
    const index = '## F001 玉佩\n- 埋设：第 1 章\n- 状态：未回收\n'
    expect(checkForeshadowRecovery(chapters, index)).toHaveLength(0)
  })
})

describe('checkChapterHealth（章节健康）', () => {
  const mk = (over: Partial<Chapter>): Chapter => ({
    id: 'x', filePath: 'stories/x.md', title: 'X', wordCount: 100, status: 'draft', lastModified: 0, order: 1, ...over,
  })
  it('空章与状态矛盾各报一条', () => {
    const issues = checkChapterHealth([
      mk({ title: '空章', wordCount: 0 }),
      mk({ title: '假完成', status: 'completed', wordCount: 300 }),
    ])
    expect(issues).toHaveLength(2)
    expect(issues[0].message).toContain('空章')
    expect(issues[1].message).toContain('标为完成但仅 300 字')
  })
  it('正常章节不报', () => {
    expect(checkChapterHealth([mk({ status: 'completed', wordCount: 3000 })])).toHaveLength(0)
  })
})

describe('runConsistencyCheck（合并排序）', () => {
  it('high 排最前，报告带统计', () => {
    const chapters = mkChapters(10)
    const mentions: CharacterMention[] = [
      { name: '苏晚', chapter: '第 1 章', chapterPath: chapters[0].path, mentions: 5, dialogueLines: 1 },
      { name: '苏晚', chapter: '第 9 章', chapterPath: chapters[8].path, mentions: 4, dialogueLines: 1 },
    ]
    const report = runConsistencyCheck({
      chapters,
      chapterMeta: [],
      characters: [{ id: 'c1', name: '苏晚', data: { name: '苏晚' } }],
      mentions,
      plotLines: [],
      foreshadowIndex: '',
    })
    expect(report.chapterCount).toBe(10)
    if (report.issues.length > 1) {
      const sev = { high: 0, medium: 1, low: 2 }
      for (let i = 1; i < report.issues.length; i++) {
        expect(sev[report.issues[i - 1].severity]).toBeLessThanOrEqual(sev[report.issues[i].severity])
      }
    }
  })
})
