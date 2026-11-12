import { describe, expect, it } from 'vitest'
import { parseCharacters, serializeCharacters, parsePlotLines, serializePlotLines, chapterBodyFromResult } from './novel'
import {
  scanCharacterMentions,
  buildCharacterStateIndex,
  scanForeshadows,
  buildForeshadowIndex,
} from './novel'
import {
  draftTasksFromGoal,
  extractJsonArray,
  parseAiTasks,
  buildTaskDraftPrompt,
} from './planner'

describe('parseCharacters（与旧桌面端格式双向兼容）', () => {
  it('解析旧桌面端写入的人物卡', () => {
    const md = `# 人物卡

## 林越 <!-- id: character-linyue -->

- **外貌**: 黑发剑眉，身形瘦削
- **性格**: 外冷内热，行事果决
- **背景**: 出身没落剑修世家
- **关系**: 与苏晚为师徒
- **备注**: 惯用左手剑

## 苏晚 <!-- id: character-suwan -->

- **性格**: 沉静聪慧
`
    const chars = parseCharacters(md)
    expect(chars).toHaveLength(2)
    expect(chars[0]).toMatchObject({
      id: 'character-linyue',
      name: '林越',
      data: {
        name: '林越',
        appearance: '黑发剑眉，身形瘦削',
        personality: '外冷内热，行事果决',
        background: '出身没落剑修世家',
        relationships: '与苏晚为师徒',
        notes: '惯用左手剑',
      },
    })
    expect(chars[1].data.personality).toBe('沉静聪慧')
    expect(chars[1].data.appearance).toBeUndefined()
  })

  it('无 id 注释时按名字生成 id', () => {
    const md = `# 人物卡\n\n## 无名客\n\n- **备注**: 神秘人\n`
    const chars = parseCharacters(md)
    expect(chars[0].id).toBe('character-无名客')
  })

  it('多行字段值保留换行', () => {
    const md = `# 人物卡\n\n## 甲\n\n- **背景**: 第一行\n  第二行\n`
    const chars = parseCharacters(md)
    expect(chars[0].data.background).toContain('第一行')
    expect(chars[0].data.background).toContain('第二行')
  })

  it('空内容返回空数组', () => {
    expect(parseCharacters('')).toEqual([])
    expect(parseCharacters('# 仅标题\n')).toEqual([])
  })

  it('serialize → parse 往返一致', () => {
    const chars = [
      {
        id: 'character-a',
        name: '甲',
        data: { name: '甲', appearance: '高', personality: '冷', background: '谜', relationships: '无', notes: '—' },
      },
    ]
    const roundTrip = parseCharacters(serializeCharacters(chars))
    expect(roundTrip).toEqual(chars)
  })
})

describe('parsePlotLines（与旧桌面端格式双向兼容）', () => {
  it('解析旧桌面端写入的情节线', () => {
    const md = `# 情节线

## 主线·剑冢之谜 <!-- id: plot-main -->

- **起始章节**: 第 1 章
- **结束章节**: 第 20 章
- **状态**: 进行中
- **简介**: 追查剑冢异变的真相

## 支线·苏晚身世 <!-- id: plot-sub -->

- **起始章节**: 第 3 章
- **结束章节**: —
- **状态**: 已暂停
`
    const plots = parsePlotLines(md)
    expect(plots).toHaveLength(2)
    expect(plots[0]).toEqual({
      id: 'plot-main',
      name: '主线·剑冢之谜',
      startChapter: '第 1 章',
      endChapter: '第 20 章',
      status: 'ongoing',
      description: '追查剑冢异变的真相',
    })
    expect(plots[1].status).toBe('paused')
    expect(plots[1].description).toBeUndefined()
  })

  it('状态中文徽章双向映射', () => {
    const md = `# 情节线\n\n## A\n\n- **起始章节**: 1\n- **状态**: 已完结\n`
    const plots = parsePlotLines(md)
    expect(plots[0].status).toBe('completed')
    const roundTrip = parsePlotLines(serializePlotLines(plots))
    expect(roundTrip[0].status).toBe('completed')
  })

  it('serialize → parse 往返一致', () => {
    const plots = [
      { id: 'p1', name: '线一', startChapter: '第 1 章', endChapter: '第 9 章', status: 'ongoing' as const, description: '主线' },
      // 无 endChapter：序列化为占位「—」，解析回来是「—」（与 UI 展示一致，视为空）
      { id: 'p2', name: '线二', startChapter: '第 2 章', endChapter: '—', status: 'paused' as const },
    ]
    const roundTrip = parsePlotLines(serializePlotLines(plots))
    expect(roundTrip).toEqual(plots)
  })

  it('空内容返回空数组', () => {
    expect(parsePlotLines('')).toEqual([])
  })
})

describe('extractJsonArray（AI 回复 JSON 提取）', () => {
  it('解析纯 JSON 数组', () => {
    expect(extractJsonArray('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
  })
  it('容忍 ```json 围栏', () => {
    const raw = '以下是任务链：\n```json\n[{"title":"第 1 章"}]\n```\n请查收。'
    expect(extractJsonArray(raw)).toEqual([{ title: '第 1 章' }])
  })
  it('容忍前后杂文本（截取首 [ 到末 ]）', () => {
    const raw = '好的，任务如下 [见下]：[{"x":1}] 以上。'
    expect(extractJsonArray(raw)).toEqual([{ x: 1 }])
  })
  it('非法 JSON 返回 null', () => {
    expect(extractJsonArray('完全没有数组')).toBeNull()
    expect(extractJsonArray('[{broken}]')).toBeNull()
  })
})

describe('parseAiTasks（AI 任务链清洗）', () => {
  const aiRaw = JSON.stringify([
    { title: '第 3 章 · 雨夜伏击', chapter_index: 3, task_prompt: '雨夜伏击战，主角识破内奸', acceptance_checks: ['字数≥2000', '承接第 2 章悬念'], arc_targets: ['主线'], foreshadow_refs: ['玉佩'], timeline_window: '第 3 日夜' },
    { title: '第 4 章 · 密谈', chapter_index: 4, task_prompt: '师徒密谈揭开来历', acceptance_checks: ['章末钩子'], arc_targets: [], foreshadow_refs: [], timeline_window: 'global' },
    { title: '', chapter_index: 5 }, // 缺 title → sanitizeTask 拒收
  ])

  it('清洗字段并按顺序重建 id 与依赖链', () => {
    const tasks = parseAiTasks(aiRaw, 3, 5, 2000, '追查内奸')
    expect(tasks).toHaveLength(2) // 第三条被拒收
    expect(tasks![0]).toMatchObject({
      id: 'ch003',
      title: '第 3 章 · 雨夜伏击',
      status: 'todo',
      priority: 'high',
      depends_on: [],
      chapter_index: 3,
      scope: 'stories/chapter-0003.md',
      task_prompt: '雨夜伏击战，主角识破内奸',
    })
    expect(tasks![1]).toMatchObject({ id: 'ch004', depends_on: ['ch003'], priority: 'medium' })
  })

  it('截断到请求数量', () => {
    const tasks = parseAiTasks('[{"title":"a"},{"title":"b"},{"title":"c"}]', 1, 2, 1000, '')
    expect(tasks).toHaveLength(2)
  })

  it('缺 task_prompt 时用目标补齐', () => {
    const tasks = parseAiTasks('[{"title":"第 1 章"}]', 1, 1, 1000, '寻剑')
    expect(tasks![0].task_prompt).toBe('围绕「寻剑」写第 1 章。')
  })

  it('解析失败 / 全部拒收返回 null（调用方回退模板）', () => {
    expect(parseAiTasks('乱写一通', 1, 3, 2000, '')).toBeNull()
    expect(parseAiTasks('[{"no_title":1}]', 1, 3, 2000, '')).toBeNull()
  })

  it('提示词包含数量/起始章/字数约束', () => {
    const p = buildTaskDraftPrompt('夺嫡之争', 5, 4, 2500)
    expect(p).toContain('拆解为 4 个')
    expect(p).toContain('第 5 章')
    expect(p).toContain('2500')
    expect(p).toContain('夺嫡之争')
  })

  it('规则模板兜底仍可用（draftTasksFromGoal）', () => {
    const tasks = draftTasksFromGoal('推进主线', 1, 3, 2000)
    expect(tasks).toHaveLength(3)
    expect(tasks[0].depends_on).toEqual([])
    expect(tasks[1].depends_on).toEqual([tasks[0].id])
  })
})

describe('scanCharacterMentions（人物提及统计）', () => {
  const names = ['林越', '苏晚']
  it('统计出现次数与对话行数', () => {
    const content = [
      '林越拔剑出鞘。',
      '林越：跟我来。',
      '苏晚说道：「小心身后。」',
      '他看向苏晚。',
    ].join('\n')
    const hits = scanCharacterMentions([{ title: '第 1 章', path: 'stories/c1.md', content }], names)
    const linyue = hits.find((h) => h.name === '林越')
    const suwan = hits.find((h) => h.name === '苏晚')
    expect(linyue).toMatchObject({ mentions: 2, chapter: '第 1 章' })
    expect(linyue?.dialogueLines).toBe(1)
    expect(suwan?.mentions).toBe(2) // 「苏晚说道」+「看向苏晚」
  })

  it('无名单匹配时返回空', () => {
    const hits = scanCharacterMentions([{ title: '第 1 章', path: 'c1.md', content: '王五走在路上。' }], names)
    expect(hits).toEqual([])
  })

  it('空名单返回空', () => {
    expect(scanCharacterMentions([{ title: 'a', path: 'a.md', content: '林越' }], [])).toEqual([])
  })

  it('正则特殊字符名字不炸', () => {
    const hits = scanCharacterMentions([{ title: 'a', path: 'a.md', content: 'A.B 出现了。' }], ['A.B'])
    expect(hits[0].mentions).toBe(1)
  })
})

describe('buildCharacterStateIndex（人物状态索引生成）', () => {
  it('按人物聚合出场与对话统计', () => {
    const md = buildCharacterStateIndex(
      [
        { name: '林越', chapter: '第 1 章', chapterPath: 'c1.md', mentions: 5, dialogueLines: 2 },
        { name: '林越', chapter: '第 2 章', chapterPath: 'c2.md', mentions: 3, dialogueLines: 4 },
        { name: '苏晚', chapter: '第 2 章', chapterPath: 'c2.md', mentions: 1, dialogueLines: 0 },
      ],
      [{ title: '第 2 章' }],
    )
    expect(md).toContain('<!-- source: auto -->')
    expect(md).toContain('最新章节：第 2 章')
    expect(md).toContain('## 林越')
    expect(md).toContain('合计提及 8 次 / 对话 6 行')
    expect(md).toContain('第 1 章(×5)、第 2 章(×3)')
  })

  it('无出场时输出占位说明', () => {
    const md = buildCharacterStateIndex([], [])
    expect(md).toContain('暂无人物出场记录')
  })
})

describe('scanForeshadows + buildForeshadowIndex（伏笔抽取）', () => {
  it('抽取含提示词的句子（按句切分）', () => {
    const hits = scanForeshadows([
      { title: '第 1 章', path: 'c1.md', content: '剑冢深处传来异响。奇怪的是没有人注意到这道裂缝。正常叙述句子不该被抓。' },
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toContain('没有人注意到')
  })

  it('过滤过短与超长句', () => {
    const hits = scanForeshadows([{ title: 'a', path: 'a.md', content: '暗示。' + '很'.repeat(200) + '悬念' }])
    expect(hits).toHaveLength(0)
  })

  it('buildForeshadowIndex 保留已有条目并续编号', () => {
    const existing = '# 伏笔线索\n\n## F001 剑冢异变\n- 埋设：第 1 章\n- 状态：未回收\n'
    const md = buildForeshadowIndex(existing, [{ chapter: '第 2 章', chapterPath: 'c2.md', text: '他暗自记下了那串数字' }])
    expect(md).toContain('## F001 剑冢异变')
    expect(md).toContain('## F002 他暗自记下了那串数字')
    expect(md).toContain('- 埋设：第 2 章')
  })

  it('空输入输出占位说明', () => {
    expect(buildForeshadowIndex('', [])).toContain('暂未发现疑似伏笔')
  })
})

describe('chapterBodyFromResult（工坊结果 → 章节体）', () => {
  it('剥除首行 # 标题并提取标题', () => {
    const r = chapterBodyFromResult('# 雨夜便利店\n\n\n正文第一段。\n\n正文第二段。')
    expect(r.title).toBe('雨夜便利店')
    expect(r.body).toBe('正文第一段。\n\n正文第二段。')
    expect(r.body).not.toContain('# 雨夜便利店')
  })

  it('无标题行时 title 为空、正文原样保留', () => {
    const raw = '直接开头，没有标题。\n\n第二段。'
    const r = chapterBodyFromResult(raw)
    expect(r.title).toBe('')
    expect(r.body).toBe(raw)
  })

  it('二级标题不被误剥（只认首行一级标题）', () => {
    const raw = '## 镜头一\n\n内容'
    const r = chapterBodyFromResult(raw)
    expect(r.title).toBe('')
    expect(r.body).toContain('## 镜头一')
  })

  it('容忍 CRLF 与首尾空白', () => {
    const r = chapterBodyFromResult('\r\n# 标题X\r\n\r\n正文\r\n')
    expect(r.title).toBe('标题X')
    expect(r.body).toBe('正文')
  })
})
