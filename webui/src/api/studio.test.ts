import { describe, expect, it } from 'vitest'
import { STUDIO_TOOLS, STUDIO_CATEGORIES, studioResultToMarkdown, parseStyleFingerprint, type StyleFingerprint } from './studio'

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
      if (t.styleField) expect(user).toContain('【文风要求】预设文风：热血爽感')
      if (t.wordsField) expect(user).toContain('目标 800 字')
    }
  })

  it('文风指纹注入所有 styleField 工具且与预设文风并存', () => {
    const fp: StyleFingerprint = {
      rhythm: '短句为主，段落极短',
      vocabulary: '口语化，京味儿词汇',
      dialogue: '',
      imagery: '',
      pov: '',
      extras: '',
    }
    for (const t of STUDIO_TOOLS) {
      if (!t.styleField) continue
      const { user } = t.build({ text: 'X', fingerprint: fp })
      expect(user).toContain('仿照范文文风（句式节奏：短句为主，段落极短；词汇偏好：口语化，京味儿词汇）')
    }
    // 与预设文风同时存在时两者都保留
    const { user } = STUDIO_TOOLS.find((t) => t.styleField)!.build({
      text: 'X',
      style: '悬疑冷峻',
      fingerprint: fp,
    })
    expect(user).toContain('预设文风：悬疑冷峻')
    expect(user).toContain('仿照范文文风')
    // 空指纹不注入
    const { user: u2 } = STUDIO_TOOLS.find((t) => t.styleField)!.build({ text: 'X', fingerprint: null })
    expect(u2).not.toContain('仿照范文文风')
  })

  it('parseStyleFingerprint 容忍围栏与杂文本，空对象返回 null', () => {
    const ok = parseStyleFingerprint('分析结果如下：\n```json\n{"rhythm":"短句","vocabulary":"书面","dialogue":"少","imagery":"冷色","pov":"第三人称限知","extras":"破折号多"}\n```\n以上。')
    expect(ok).toEqual({
      rhythm: '短句',
      vocabulary: '书面',
      dialogue: '少',
      imagery: '冷色',
      pov: '第三人称限知',
      extras: '破折号多',
    })
    expect(parseStyleFingerprint('{"rhythm":"","vocabulary":"","dialogue":"","imagery":"","pov":"","extras":""}')).toBeNull()
    expect(parseStyleFingerprint('完全没有 JSON 的回复')).toBeNull()
    // 超长字段截断到 80 字
    const long = parseStyleFingerprint(`{"rhythm":"${'长'.repeat(120)}"}`)
    expect(long?.rhythm.length).toBe(80)
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
