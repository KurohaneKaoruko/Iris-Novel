import { describe, expect, it } from 'vitest'
import { applyReplaceSelection } from './AgentWorkspace'

describe('applyReplaceSelection（工坊结果替换编辑器选区）', () => {
  const draft = '前文。旧句子中段。后文。'

  it('选区仍一致时原位替换', () => {
    const out = applyReplaceSelection(draft, { start: 3, end: 8 }, '旧句子中段', '新句子')
    expect(out).toBe('前文。新句子。后文。')
  })

  it('内容已被修改（选区错位）时退化为追加，不错删', () => {
    const changed = '前文。用户又改了别的地方。旧句子中段。后文。'
    const out = applyReplaceSelection(changed, { start: 3, end: 8 }, '旧句子中段', '新句子')
    expect(out).toBe(`${changed}\n\n新句子`)
  })

  it('range 缺失时退化为追加', () => {
    expect(applyReplaceSelection(draft, null, '旧句子中段', '新句子')).toBe(`${draft}\n\n新句子`)
  })

  it('空草稿 + 失效选区 → 结果就是替换文本', () => {
    expect(applyReplaceSelection('', { start: 0, end: 2 }, 'xx', '新文')).toBe('新文')
  })
})
