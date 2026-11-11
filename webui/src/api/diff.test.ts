import { describe, it, expect } from 'vitest'
import { diffLines, diffStats, collapseDiff } from './diff'

describe('diffLines', () => {
  it('识别新增/删除/保留行并带行号', () => {
    const d = diffLines('一\n二\n三', '一\n二改\n三\n四')
    const adds = d.filter((l) => l.type === 'add')
    const dels = d.filter((l) => l.type === 'del')
    expect(adds.map((l) => l.text)).toEqual(['二改', '四'])
    expect(dels.map((l) => l.text)).toEqual(['二'])
    expect(adds[0].newNo).toBe(2)
    expect(dels[0].oldNo).toBe(2)
    expect(d.find((l) => l.type === 'same' && l.text === '三')).toBeTruthy()
  })

  it('空旧文本（1 个空行）= 删空行 + 全新增', () => {
    const d = diffLines('', '甲\n乙')
    expect(d.filter((l) => l.type === 'add').map((l) => l.text)).toEqual(['甲', '乙'])
    expect(d.filter((l) => l.type === 'del')).toHaveLength(1) // 原空行被删
  })

  it('完全相同 = 全 same', () => {
    const d = diffLines('a\nb', 'a\nb')
    expect(d.every((l) => l.type === 'same')).toBe(true)
  })

  it('CRLF 归一化', () => {
    const d = diffLines('a\r\nb', 'a\nb')
    expect(d.every((l) => l.type === 'same')).toBe(true)
  })
})

describe('diffStats / collapseDiff', () => {
  it('统计增删行数', () => {
    const d = diffLines('一\n二\n三', '一\n二改\n三\n四')
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 })
  })

  it('长 same 段折叠为 gap', () => {
    const long = Array.from({ length: 40 }, (_, i) => `行${i}`).join('\n')
    const d = diffLines(long, long.replace('行20', '行20改'))
    const c = collapseDiff(d, 3)
    const gaps = c.filter((l) => l.type === 'gap') as Array<{ type: string; count: number }>
    expect(gaps.length).toBeGreaterThan(0)
    expect(c.length).toBeLessThan(d.length)
  })
})
