import { useMemo, useState } from 'react'
import { buildRelationEdges, loreGraphLayout } from '../../api/loreGraph'
import type { Character } from '../../api/novel'
import { Icon } from '../../components/Icon'

type Props = {
  characters: Character[]
  onOpen: (path: string) => void
}

/** 布局画布尺寸（SVG viewBox 单位；与渲染宽度解耦，整图等比缩放） */
const W = 340
const H = 340

/** 人物关系图（LorePanel 第四页签）：人物为节点、关系文本投影为边。
 * 确定性力导向布局；悬浮边显示关系描述、点击节点打开人物卡。 */
export function LoreGraph({ characters, onOpen }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const layout = useMemo(() => {
    const edges = buildRelationEdges(characters)
    return loreGraphLayout(
      characters.map((c) => ({ id: c.id, name: c.name })),
      edges.map((e) => ({ fromId: e.fromId, toId: e.toId, label: e.label })),
      W,
      H,
    )
  }, [characters])

  const relOf = (id: string) => layout.edges.filter((e) => e.a.id === id || e.b.id === id)
  const focused = hovered ? relOf(hovered) : null
  const focusedNode = hovered ? layout.nodes.find((n) => n.id === hovered) : null

  if (characters.length === 0) {
    return (
      <div className="agw-empty">
        concept/characters.md 还没有人物卡。
        <br />
        让 Agent 用「## 姓名 + 字段列表」格式维护。
      </div>
    )
  }

  return (
    <div className="lgraph">
      <div className="lgraph-canvas" onMouseLeave={() => setHovered(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="lgraph-svg" role="img" aria-label="人物关系图">
          {layout.edges.map((e, i) => {
            const active = hovered !== null && (e.a.id === hovered || e.b.id === hovered)
            const dim = hovered !== null && !active
            return (
              <g key={i} className={dim ? 'dim' : ''} onMouseEnter={() => setHovered(active ? hovered : e.a.id === hovered ? e.b.id : e.a.id)}>
                <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} className={`lgraph-edge ${active ? 'active' : ''}`} />
                {/* 命中区加宽的透明描边线，方便悬浮 */}
                <line x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} className="lgraph-edge-hit" />
                {active && e.label ? (
                  <g>
                    <rect
                      x={(e.a.x + e.b.x) / 2 - Math.min(88, e.label.length * 6.2 + 10) / 2}
                      y={(e.a.y + e.b.y) / 2 - 10}
                      width={Math.min(88, e.label.length * 6.2 + 10)}
                      height={18}
                      rx={4}
                      className="lgraph-edge-tip"
                    />
                    <text x={(e.a.x + e.b.x) / 2} y={(e.a.y + e.b.y) / 2 + 3.5} textAnchor="middle" className="lgraph-edge-tip-text">
                      {e.label}
                    </text>
                  </g>
                ) : null}
              </g>
            )
          })}
          {layout.nodes.map((n) => {
            const dim = hovered !== null && hovered !== n.id && !relOf(hovered).some((e) => e.a.id === n.id || e.b.id === n.id)
            const r = Math.max(9, Math.min(14, 10 + n.name.length * 0.8))
            return (
              <g
                key={n.id}
                className={`lgraph-node ${dim ? 'dim' : ''} ${hovered === n.id ? 'active' : ''}`}
                onMouseEnter={() => setHovered(n.id)}
                onClick={() => onOpen('concept/characters.md')}
              >
                <circle cx={n.x} cy={n.y} r={r + 6} className="lgraph-node-hit" />
                <circle cx={n.x} cy={n.y} r={r} className="lgraph-node-dot" />
                <text x={n.x} y={n.y + r + 11} textAnchor="middle" className="lgraph-node-label">
                  {n.name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="lgraph-side">
        {focused && focusedNode ? (
          <div className="lgraph-focus">
            <span className="lgraph-focus-name"><Icon name="focus" size={13} /> {focusedNode.name}</span>
            {focused.length === 0 ? (
              <div className="lgraph-focus-empty">暂无已登记的关系（可让 Agent 在人物卡「关系」字段补充）</div>
            ) : (
              focused.map((e, i) => (
                <div key={i} className="lgraph-rel">
                  <span className="lgraph-rel-name">{e.a.id === focusedNode.id ? e.b.name : e.a.name}</span>
                  <span className="lgraph-rel-label">{e.label || '相关'}</span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="lgraph-legend">
            <Icon name="network" size={13} />
            悬浮节点/连线查看关系；点击节点打开人物卡。关系来自人物卡「关系」字段的文字投影，
            <span className="lgraph-legend-dim">如「苏晚（师徒）」。</span>
          </div>
        )}
      </div>
    </div>
  )
}
