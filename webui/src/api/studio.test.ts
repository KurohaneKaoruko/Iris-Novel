import { describe, expect, it } from 'vitest'
import { STUDIO_TOOLS, STUDIO_CATEGORIES, studioResultToMarkdown } from './studio'

describe('studio 工具目录', () => {
  it('四个分类齐全，每个分类至少 2 个工具', () => {
    for (const cat of STUDIO_CATEGORIES) {
      const n = STUDIO_TOOLS.filter((t) => t.category === cat).length
      expect(n).toBeGreaterThanOrEqual(2)
    }
  })

  it('工具 id 唯一且图标非空', () => {
    const ids = STUDIO_TOOLS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const t of STUDIO_TOOLS) {
      expect(t.icon.trim()).not.toBe('')
      expect(t.placeholder.trim()).not.toBe('')
    }
  })

  it('每个工具的 prompt 都包含输入文本且引用附加要求', () => {
    for (const t of STUDIO_TOOLS) {
      const { system, user } = t.build({
        text: '测试内容XYZ',
        instruction: '第一人称',
        style: '热血爽感',
        targetWords: 800,
      })
      expect(system.trim().length).toBeGreaterThan(10)
      expect(user).toContain('测试内容XYZ')
      expect(user).toContain('【附加要求】第一人称')
      if (t.styleField) expect(user).toContain('【文风要求】热血爽感')
      if (t.wordsField) expect(user).toContain('目标 800 字')
    }
  })

  it('可选字段留空时不产生空标签', () => {
    const t = STUDIO_TOOLS.find((x) => x.id === 'continue')!
    const { user } = t.build({ text: 'abc' })
    expect(user).not.toContain('【附加要求】')
    expect(user).not.toContain('【文风要求】')
    expect(user).not.toContain('【篇幅】')
  })
})

describe('studioResultToMarkdown', () => {
  it('包含工具名、输入与输出', () => {
    const t = STUDIO_TOOLS[0]
    const md = studioResultToMarkdown(t, { text: '输入内容', style: '悬疑冷峻' }, '# 输出结果')
    expect(md).toContain(`# ${t.name} · 创作工坊`)
    expect(md).toContain('- 文风：悬疑冷峻')
    expect(md).toContain('输入内容')
    expect(md).toContain('# 输出结果')
  })
})
