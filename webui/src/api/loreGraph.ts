/**
 * 人物关系图纯函数层：人物卡 relationships 自由文本 → 关系边 + 确定性布局。
 *
 * 数据模型核实：novel.ts parseCharacters 解析人物卡的「关系」字段为自由文本
 * （`- **关系**: 苏晚（师徒）、与陆昭为敌`），并无结构化 relations 数组。
 * 本层沿用旧桌面端资料索引的投影约定：分隔符切段 → 剥括号注记 →
 * 与已知人物名匹配成边（切段中包含某人名即视为关联该人物）。
 */
import type { Character } from './novel'

/** 单条关系边（无向；from/to 为首次发现方向的次序，仅作端点引用） */
export type RelationEdge = { fromId: string; fromName: string; toId: string; toName: string; label: string }

/** 提切段中的括号注记作关系标签：`苏晚（师徒）` → `师徒`；无注记返回空串 */
function annotationOf(segment: string): string {
  const m = segment.match(/[（(]([^（）()]+)[）)]/)
  return m ? m[1].trim() : ''
}

/** 剥掉段中所有括号注记：`（搭档）苏晚（师徒）` → `苏晚` */
function stripAnnotations(segment: string): string {
  return segment.replace(/[（(][^（）()]*[）)]/g, ' ').trim()
}

/**
 * 关系自由文本 → 切段：按逗号/顿号/分号/换行拆分，去首尾空白，空段丢弃。
 * 「无」「暂无」等无匹配名的切段会在建边阶段自然落空，无需在此过滤。
 */
export function parseRelationSegments(text: string): string[] {
  return text
    .split(/[,，、;；\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 人物卡集合 → 无向关系边。切段（剥括号注记后）完整等于某人名或包含某人名
 * 即成边；自指忽略；同一对人物的双向记录合并为一条，标签去重后以「·」拼接。
 */
export function buildRelationEdges(characters: Character[]): RelationEdge[] {
  const byName = new Map(characters.map((c) => [c.name, c]))
  // 长名优先扫描：「林越秋」包含「林越」，短名在前会误配
  const namesByLength = [...byName.keys()].sort((a, b) => b.length - a.length)
  const merged = new Map<string, RelationEdge>()
  for (const c of characters) {
    for (const seg of parseRelationSegments(c.data.relationships ?? '')) {
      const note = annotationOf(seg)
      const stripped = stripAnnotations(seg)
      if (!stripped) continue
      let target = byName.get(stripped)
      if (!target || target.id === c.id) {
        for (const name of namesByLength) {
          const ch = byName.get(name)
          if (ch && ch.id !== c.id && stripped.includes(name)) {
            target = ch
            break
          }
        }
      }
      if (!target || target.id === c.id) continue
      const label = (note || stripped).slice(0, 24)
      const key = [c.id, target.id].sort().join('\u0000')
      const prev = merged.get(key)
      if (prev) {
        if (!prev.label.split('·').includes(label)) prev.label = `${prev.label}·${label}`
      } else {
        merged.set(key, { fromId: c.id, fromName: c.name, toId: target.id, toName: target.name, label })
      }
    }
  }
  return [...merged.values()]
}

// ============ 确定性布局（环形初始位 + 斥力/弹簧/向心迭代） ============

export type GraphNodeInput = { id: string; name: string }
export type PlacedNode = GraphNodeInput & { x: number; y: number }
export type PlacedEdge = { a: PlacedNode; b: PlacedNode; label: string }
export type GraphLayout = { nodes: PlacedNode[]; edges: PlacedEdge[] }

type SimNode = PlacedNode & { vx: number; vy: number }

/**
 * 确定性力导向布局：节点按环形等分初始排布（无随机数），随后固定轮数的
 * 两两斥力 + 关系弹簧 + 向心收敛。同输入恒同输出（可测试、可复现）。
 * 孤立节点（无任何关系）同样参与布局并落位。未知 id 的边丢弃，自环丢弃。
 */
export function loreGraphLayout(
  nodesIn: GraphNodeInput[],
  edgesIn: Array<{ fromId: string; toId: string; label?: string }>,
  width = 320,
  height = 320,
  iterations = 220,
): GraphLayout {
  const n = nodesIn.length
  if (n === 0) return { nodes: [], edges: [] }
  const cx = width / 2
  const cy = height / 2
  const scale = Math.min(width, height) / 480 // 以下常数按 480 盒调校，随画布等比缩放
  const ringR = Math.min(width, height) * 0.32
  const pad = 28
  const nodes: SimNode[] = nodesIn.map((nd, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2
    return { ...nd, x: cx + ringR * Math.cos(a), y: cy + ringR * Math.sin(a), vx: 0, vy: 0 }
  })
  const byId = new Map(nodes.map((nd) => [nd.id, nd]))
  const springs: Array<[SimNode, SimNode, string]> = []
  for (const e of edgesIn) {
    const a = byId.get(e.fromId)
    const b = byId.get(e.toId)
    if (a && b && a !== b) springs.push([a, b, e.label ?? ''])
  }

  const REPULSION = 5200 * scale * scale
  const SPRING = 0.012
  const REST = 110 * scale
  const CENTER_PULL = 0.008
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          // 完全重叠时给稳定的小扰动，避免除零与抖动
          dx = 0.5 + i * 0.01
          dy = 0.5 + j * 0.01
          d2 = 1
        }
        const f = REPULSION / d2
        const d = Math.sqrt(d2)
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }
    for (const [a, b] of springs) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const f = (d - REST) * SPRING
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
    for (const nd of nodes) {
      nd.vx += (cx - nd.x) * CENTER_PULL
      nd.vy += (cy - nd.y) * CENTER_PULL
      nd.vx *= 0.85
      nd.vy *= 0.85
      nd.x = Math.max(pad, Math.min(width - pad, nd.x + nd.vx * 0.05))
      nd.y = Math.max(pad, Math.min(height - pad, nd.y + nd.vy * 0.05))
    }
  }
  const edges: PlacedEdge[] = springs.map(([a, b, label]) => ({ a, b, label }))
  return {
    nodes: nodes.map(({ id, name, x, y }) => ({ id, name, x, y })),
    edges,
  }
}
