/**
 * 设定关联图谱（5.3）：SVG 力导向布局，节点 = 资料条目（人物/设定/大纲），
 * 边 = 资料中声明的关系。点击节点展示摘要并可打开源文件。
 *
 * 数据源 MaterialIndexService（concept/outline .md 唯一事实来源的投影）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import {
  getMaterialIndex,
  type MaterialEntry,
  type MaterialIndex,
} from '../services/MaterialIndexService'
import { AppIcon } from './icons/AppIcon'
import './MaterialGraphPanel.css'

type Props = {
  onOpenSourceFile: (path: string) => void
}

type SimNode = MaterialEntry & { x: number; y: number; vx: number; vy: number }

const W = 600
const H = 480
const ITERATIONS = 220
const REPULSION = 5200
const SPRING = 0.012
const CENTER_PULL = 0.008

/** 简易力导向：斥力 + 关系弹簧 + 向心，迭代至稳定（无外部依赖） */
function runForceLayout(entries: MaterialEntry[], edges: Array<{ from: string; to: string }>) {
  const rand = mulberry32(entries.length * 977 + edges.length * 31 + 7)
  const nodes: SimNode[] = entries.map((e, i) => {
    const a = rand() * Math.PI * 2
    const r = 40 + rand() * 140
    return {
      ...e,
      x: W / 2 + r * Math.cos(a),
      y: H / 2 + r * Math.sin(a),
      vx: 0,
      vy: 0,
      // 占位避免 unused
      ...(i >= 0 ? {} : {}),
    }
  })
  const byTitle = new Map(nodes.map((n) => [n.title, n]))
  const pairs: Array<[SimNode, SimNode]> = []
  for (const e of edges) {
    const a = byTitle.get(e.from)
    const b = byTitle.get(e.to)
    if (a && b && a !== b) pairs.push([a, b])
  }

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    // 斥力
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) {
          dx = 0.5
          dy = 0.5
          d2 = 0.5
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
    // 弹簧
    for (const [a, b] of pairs) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.max(1, Math.hypot(dx, dy))
      const f = (d - 110) * SPRING
      a.vx += (dx / d) * f
      a.vy += (dy / d) * f
      b.vx -= (dx / d) * f
      b.vy -= (dy / d) * f
    }
    // 向心 + 阻尼 + 边界
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * CENTER_PULL
      n.vy += (H / 2 - n.y) * CENTER_PULL
      n.vx *= 0.85
      n.vy *= 0.85
      n.x = Math.max(36, Math.min(W - 36, n.x + n.vx * 0.05))
      n.y = Math.max(24, Math.min(H - 24, n.y + n.vy * 0.05))
    }
  }
  return { nodes, pairs }
}

/** 确定性随机（图谱布局稳定可复现） */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KIND_COLOR: Record<string, string> = {
  character: 'var(--accent-primary, #58a6ff)',
  setting: 'var(--status-success, #3fb950)',
  outline: 'var(--text-muted, #8b949e)',
}

export function MaterialGraphPanel({ onOpenSourceFile }: Props) {
  const { t } = useI18n()
  const [index, setIndex] = useState<MaterialIndex | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SimNode | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setIndex(await getMaterialIndex())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const layout = useMemo(() => {
    if (!index || index.entries.length === 0) return null
    const edges: Array<{ from: string; to: string }> = []
    const titles = new Set(index.entries.map((e) => e.title))
    for (const entry of index.entries) {
      for (const rel of entry.relations) {
        if (titles.has(rel)) edges.push({ from: entry.title, to: rel })
      }
    }
    return runForceLayout(index.entries, edges)
  }, [index])

  const reloadTimer = useRef<number | null>(null)
  useEffect(() => {
    // 外部改文件 → fs_changed 后刷新（单一事实来源）
    let disposed = false
    void import('../transport').then(async ({ subscribeEvent }) => {
      const un = await subscribeEvent('fs_changed', () => {
        if (disposed) return
        if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current)
        reloadTimer.current = window.setTimeout(() => void load(), 600)
      })
      if (disposed) un()
    })
    return () => {
      disposed = true
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current)
    }
  }, [load])

  return (
    <div className="material-graph">
      <div className="material-graph-header">
        <span className="material-graph-title">{t('materialGraph.title')}</span>
        <button type="button" className="material-graph-btn" onClick={() => void load()} disabled={loading}>
          <AppIcon name="refresh" size={13} />
        </button>
      </div>

      {error ? <div className="material-graph-error">{error}</div> : null}
      {!error && !loading && (!layout || layout.nodes.length === 0) ? (
        <div className="material-graph-empty">{t('materialGraph.empty')}</div>
      ) : null}

      {layout ? (
        <div className="material-graph-body">
          <svg viewBox={`0 0 ${W} ${H}`} className="material-graph-svg" role="img">
            {layout.pairs.map(([a, b], i) => (
              <line
                key={`e-${i}-${a.id}-${b.id}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="material-graph-edge"
              />
            ))}
            {layout.nodes.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                className={`material-graph-node ${selected?.id === n.id ? 'selected' : ''}`}
                onClick={() => setSelected(selected?.id === n.id ? null : n)}
              >
                <circle r={9} fill={KIND_COLOR[n.kind] ?? 'var(--text-muted)'} />
                <text y={-14} textAnchor="middle" className="material-graph-label">
                  {n.title}
                </text>
              </g>
            ))}
          </svg>

          {selected ? (
            <div className="material-graph-detail" data-testid="material-graph-detail">
              <div className="material-graph-detail-title">
                <span className={`material-graph-kind ${selected.kind}`}>
                  {t(`materialGraph.kind.${selected.kind}`)}
                </span>
                <span>{selected.title}</span>
              </div>
              {Object.entries(selected.attributes).slice(0, 6).map(([k, v]) => (
                <div key={k} className="material-graph-attr">
                  <span className="k">{k}</span>
                  <span className="v">{v}</span>
                </div>
              ))}
              {selected.body ? (
                <p className="material-graph-body-text">
                  {selected.body.slice(0, 160)}
                  {selected.body.length > 160 ? '…' : ''}
                </p>
              ) : null}
              <button
                type="button"
                className="material-graph-btn open"
                onClick={() => onOpenSourceFile(selected.sourcePath)}
              >
                {t('materialGraph.openSource')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
