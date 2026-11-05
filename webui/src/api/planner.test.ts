import { describe, expect, it } from 'vitest'
import { parseOutlineChapters, outlineToTasks } from './planner'

describe('parseOutlineChapters（大纲抽取）', () => {
  it('抽取章节标题与细纲正文', () => {
    const text = [
      '# 第一卷 总纲',
      '',
      '第一章 试炼开始',
      '- 主角进入剑冢',
      '- 遇到神秘老者',
      '',
      '第二章 守心',
      '洞中三日幻境试炼，拒绝诱惑。',
    ].join('\n')
    const chapters = parseOutlineChapters(text)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].chapterIndex).toBe(1)
    expect(chapters[0].heading).toBe('第一章 试炼开始')
    expect(chapters[0].body).toContain('剑冢')
    expect(chapters[1].chapterIndex).toBe(2)
  })

  it('中文数字与阿拉伯数字混用', () => {
    const text = '第十二章 重逢\n渡口相认。\n第130章 决战\n最终一战。'
    const chapters = parseOutlineChapters(text)
    expect(chapters.map(c => c.chapterIndex)).toEqual([12, 130])
  })

  it('正文里的行内引用不误抽（含标题模式的叙述行超过长度限制）', () => {
    const text = '第一章 出门\n他说第三章的内容他曾经在书里读到过，那是很多年前的旧事了，这里按下不表，且说眼下这一幕究竟如何展开。'
    expect(parseOutlineChapters(text)).toHaveLength(1)
  })
})

describe('outlineToTasks（大纲转任务）', () => {
  const chapters = [
    { chapterIndex: 1, heading: '第一章 试炼', body: '进剑冢' },
    { chapterIndex: 2, heading: '第二章 守心', body: '拒幻境' },
  ]
  it('生成任务链并按顺序接依赖', () => {
    const tasks = outlineToTasks(chapters, [], 3000)
    expect(tasks).toHaveLength(2)
    expect(tasks[0].id).toBe('ch001')
    expect(tasks[0].priority).toBe('high')
    expect(tasks[1].depends_on).toEqual(['ch001'])
    expect(tasks[1].task_prompt).toBe('细纲：\n拒幻境')
    expect(tasks[1].scope).toBe('stories/chapter-0002.md')
  })

  it('已有章节去重跳过', () => {
    const existing = [{ ...outlineToTasks([{ chapterIndex: 1, heading: '第一章 旧', body: '' }], [], 3000)[0] }]
    const tasks = outlineToTasks(chapters, existing, 3000)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].chapter_index).toBe(2)
  })
})
