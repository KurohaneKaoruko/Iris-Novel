import { describe, expect, it } from 'vitest'
import { parseOutlineChapters, outlineToTasks, tasksToPlanMarkdown, draftTasksFromGoal } from './planner'

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

describe('tasksToPlanMarkdown（写作计划导出）', () => {
  it('包含进度概览与逐章任务块', () => {
    const tasks = draftTasksFromGoal('复仇', 1, 2, 2000)
    tasks[0].status = 'done'
    tasks[1].task_prompt = '追击戏：雨夜巷战'
    tasks[1].acceptance_checks = ['承接前章', '章末钩子']
    tasks[1].last_error = '质检未通过'
    const md = tasksToPlanMarkdown(tasks, '我的计划')
    expect(md).toContain('# 我的计划')
    expect(md).toContain('任务总数：2')
    expect(md).toContain('已完成：1（50%）')
    expect(md).toContain('### [x]')            // done 的 checkbox
    expect(md).toContain('### [ ]')            // todo 的 checkbox
    expect(md).toContain('第 2 章')
    expect(md).toContain('> 追击戏：雨夜巷战')
    expect(md).toContain('- [ ] 验收：承接前章')
    expect(md).toContain('⚠ 最近错误：质检未通过')
  })

  it('空队列也输出合法 Markdown', () => {
    const md = tasksToPlanMarkdown([], '空计划')
    expect(md).toContain('# 空计划')
    expect(md).toContain('任务总数：0')
    expect(md).toContain('已完成：0（0%）')
  })

  it('global 时间窗不写入、依赖链与情节线照常输出', () => {
    const t = draftTasksFromGoal('复仇', 3, 1, 1500)
    t[0].timeline_window = 'global'
    t[0].arc_targets = ['主线', '复仇线']
    const md = tasksToPlanMarkdown(t)
    expect(md).not.toContain('时间窗')
    expect(md).toContain('情节线：主线、复仇线')
  })
})
