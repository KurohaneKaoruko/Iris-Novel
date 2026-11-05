import { describe, expect, it } from 'vitest'
import { parseCodex, serializeCodex, queryCodex, type CodexEntry } from './novel'

describe('parseCodex（设定集解析）', () => {
  it('解析类型/简介/详情字段', () => {
    const md = [
      '# 设定集',
      '',
      '## 青云宗 <!-- id: codex-qingyun -->',
      '',
      '- **类型**: 组织',
      '- **简介**: 修真界第一大宗',
      '- **详情**: 建于青云山上，<br>弟子三千，以剑道立派。',
      '',
    ].join('\n')
    const entries = parseCodex(md)
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('codex-qingyun')
    expect(entries[0].name).toBe('青云宗')
    expect(entries[0].type).toBe('faction')
    expect(entries[0].summary).toBe('修真界第一大宗')
    expect(entries[0].details).toContain('弟子三千')
  })

  it('未知类型回退 setting，缺 id 用名称兜底', () => {
    const md = '## 幽冥谷\n\n- **类型**: 神秘地方\n- **简介**: 禁地'
    const entries = parseCodex(md)
    expect(entries[0].type).toBe('setting')
    expect(entries[0].id).toBe('codex-幽冥谷')
  })

  it('serialize ↔ parse 往返一致', () => {
    const entries: CodexEntry[] = [
      { id: 'codex-a', name: '赤霄剑', type: 'item', summary: '本命法宝', details: '剑身三尺七寸' },
      { id: 'codex-b', name: '灵石', type: 'term', summary: '', details: '' },
    ]
    const round = parseCodex(serializeCodex(entries))
    expect(round).toHaveLength(2)
    expect(round[0].name).toBe('赤霄剑')
    expect(round[0].type).toBe('item')
    expect(round[0].details).toBe('剑身三尺七寸')
    expect(round[1].summary).toBe('')
  })
})

describe('queryCodex（选词查询）', () => {
  const entries: CodexEntry[] = [
    { id: '1', name: '青云宗', type: 'faction', summary: '', details: '' },
    { id: '2', name: '青云山', type: 'location', summary: '', details: '' },
  ]
  it('完全匹配优先', () => {
    expect(queryCodex(entries, '青云宗')?.id).toBe('1')
  })
  it('选中文本包含条目名也命中（短名优先）', () => {
    expect(queryCodex(entries, '他抬头望向青云山之巅')?.id).toBe('2')
  })
  it('无命中返回 null', () => {
    expect(queryCodex(entries, ' unrelated ')).toBeNull()
    expect(queryCodex(entries, '')).toBeNull()
  })
})
