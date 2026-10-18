import { describe, expect, it } from 'vitest'
import { coverFor, coverStyle, hashTitle } from '../src/utils/coverArt'

describe('coverArt', () => {
  it('同一标题输出完全一致的封面（确定性）', () => {
    const a = coverFor('雨夜侦探')
    const b = coverFor('雨夜侦探')
    expect(a).toEqual(b)
  })

  it('不同标题输出不同色板', () => {
    const a = coverFor('雨夜侦探')
    const b = coverFor('深海回声')
    expect(a.from).not.toBe(b.from)
  })

  it('哈希稳定且非负', () => {
    expect(hashTitle('iris')).toBe(hashTitle('iris'))
    expect(hashTitle('iris')).toBeGreaterThanOrEqual(0)
    expect(hashTitle('')).toBe(0x811c9dc5)
  })

  it('中文标题取前两字作首字', () => {
    expect(coverFor('雨夜侦探').initials).toBe('雨夜')
  })

  it('拉丁标题取词首字母', () => {
    expect(coverFor('Silent City').initials).toBe('SC')
    expect(coverFor('iris').initials).toBe('IR')
  })

  it('空标题回退不崩溃', () => {
    const art = coverFor('')
    expect(art.initials).toBe('书')
    expect(coverStyle(art).background).toContain('linear-gradient')
  })
})
