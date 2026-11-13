import { describe, expect, it } from 'vitest'
import { parseRelationSegments, buildRelationEdges, loreGraphLayout } from './loreGraph'
import { parseCharacters } from './novel'

const mkChars = (md: string) => parseCharacters(md)

describe('parseRelationSegments（关系自由文本切段）', () => {
  it('按逗号/顿号/分号/换行切段', () => {
    expect(parseRelationSegments('苏晚（师徒）、陆昭（敌对），王五；赵六\n孙七')).toEqual([
      '苏晚（师徒）',
      '陆昭（敌对）',
      '王五',
      '赵六',
      '孙七',
    ])
  })

  it('空段丢弃、首尾空白去除', () => {
    expect(parseRelationSegments('  苏晚 、、；\n')).toEqual(['苏晚'])
    expect(parseRelationSegments('')).toEqual([])
  })
})

describe('buildRelationEdges（人物卡 → 关系边）', () => {
  const md = `# 人物卡

## 林越 <!-- id: character-linyue -->

- **关系**: 苏晚（师徒）、与陆昭为敌

## 苏晚 <!-- id: character-suwan -->

- **关系**: 林越（师徒）

## 陆昭 <!-- id: character-luzhao -->

- **关系**: 无

## 孤客 <!-- id: character-guke -->
`

  it('切段包含人名即成边（含括号注记/叙述句式）', () => {
    const edges = buildRelationEdges(mkChars(md))
    expect(edges).toHaveLength(2)
    const pair = (a: string, b: string) => edges.find((e) => (e.fromName === a && e.toName === b) || (e.fromName === b && e.toName === a))
    expect(pair('林越', '苏晚')).toMatchObject({ fromId: 'character-linyue', toId: 'character-suwan', label: '师徒' })
    expect(pair('林越', '陆昭')).toMatchObject({ label: '与陆昭为敌' })
  })

  it('同一对人物的双向记录合并为一条', () => {
    const edges = buildRelationEdges(mkChars(md))
    expect(edges.filter((e) => ['林越', '苏晚'].includes(e.fromName) && ['林越', '苏晚'].includes(e.toName))).toHaveLength(1)
  })

  it('关系缺失/无匹配的人物不产生边（陆昭仅经林越卡片入边）——孤节点仍会出现在布局节点里', () => {
    const edges = buildRelationEdges(mkChars(md))
    // 孤客无关系字段：完全不出现
    expect(edges.some((e) => e.fromName === '孤客' || e.toName === '孤客')).toBe(false)
    // 陆昭只在「与林越为敌」一条边上，且这条边来自林越卡片
    const lu = edges.filter((e) => e.fromName === '陆昭' || e.toName === '陆昭')
    expect(lu).toHaveLength(1)
    expect(lu[0]).toMatchObject({ fromName: '林越', toName: '陆昭' })
    expect(edges.every((e) => e.fromId !== e.toId)).toBe(true)
  })

  it('自指关系（我与我）不成边', () => {
    const md2 = `## 甲 <!-- id: character-a -->\n\n- **关系**: 甲（分身）\n`
    expect(buildRelationEdges(mkChars(md2))).toEqual([])
  })

  it('空人物列表返回空边', () => {
    expect(buildRelationEdges([])).toEqual([])
  })
})

describe('loreGraphLayout（确定性力导向布局）', () => {
  const nodes = [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
    { id: 'c', name: '丙' },
  ]

  it('节点全部落位且在画布边界内', () => {
    const { nodes: placed } = loreGraphLayout(nodes, [{ fromId: 'a', toId: 'b' }], 320, 320)
    expect(placed).toHaveLength(3)
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(28)
      expect(p.x).toBeLessThanOrEqual(292)
      expect(p.y).toBeGreaterThanOrEqual(28)
      expect(p.y).toBeLessThanOrEqual(292)
    }
  })

  it('边端点对齐已落位节点、标签透传；未知 id / 自环丢弃', () => {
    const { edges } = loreGraphLayout(nodes, [
      { fromId: 'a', toId: 'b', label: '师徒' },
      { fromId: 'a', toId: 'ghost' },
      { fromId: 'c', toId: 'c' },
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0].a.id).toBe('a')
    expect(edges[0].b.id).toBe('b')
    expect(edges[0].label).toBe('师徒')
  })

  it('孤立节点也参与布局并落位', () => {
    const { nodes: placed, edges } = loreGraphLayout(nodes, [{ fromId: 'a', toId: 'b' }])
    expect(placed.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(edges).toHaveLength(1)
  })

  it('同一输入恒同输出（确定性）', () => {
    const l1 = loreGraphLayout(nodes, [{ fromId: 'a', toId: 'b' }], 300, 280)
    const l2 = loreGraphLayout(nodes, [{ fromId: 'a', toId: 'b' }], 300, 280)
    expect(l1).toEqual(l2)
  })

  it('有关系的节点比孤立孤立节点更靠近彼此——斥力让连通簇聚拢、弹簧限制距离', () => {
    const { nodes: placed } = loreGraphLayout(nodes, [{ fromId: 'a', toId: 'b' }], 320, 320)
    const d = (id1: string, id2: string) => {
      const p1 = placed.find((p) => p.id === id1)!
      const p2 = placed.find((p) => p.id === id2)!
      return Math.hypot(p1.x - p2.x, p1.y - p2.y)
    }
    // 弹簧静止长度 110*scale ≈ 73：a-b 应显著小于 a-c（a-c 间无弹簧约束）
    expect(d('a', 'b')).toBeLessThan(d('a', 'c'))
  })

  it('空输入返回空布局', () => {
    expect(loreGraphLayout([], [])).toEqual({ nodes: [], edges: [] })
  })
})
