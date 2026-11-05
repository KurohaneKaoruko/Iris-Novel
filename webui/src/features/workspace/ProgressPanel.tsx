/**
 * 全书进度看板：章节状态总览 + 字数分布 + 最近 30 天日字数柱状图。
 * 数据全部来自已有元数据（chapters / writing-history），无新 RPC。
 */
import { useMemo } from 'react'
import type { Chapter, WritingHistoryEntry } from '../../api/novel'
import './ProgressPanel.css'

type Props = {
  chapters: Chapter[]
  history: WritingHistoryEntry[]
  dailyGoal: number
  activePath: string | null
  onOpenChapter: (path: string) => void
}

const STATUS_LABEL: Record<Chapter['status'], string> = {
  draft: '草稿',
  revising: '改稿中',
  completed: '完结',
}

/** 取最近 n 天（含今天）的日期串数组，旧 → 新 */
function lastNDates(n: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

export function ProgressPanel({ chapters, history, dailyGoal, activePath, onOpenChapter }: Props) {
  const byStatus = useMemo(() => {
    const m: Record<Chapter['status'], number> = { draft: 0, revising: 0, completed: 0 }
    for (const c of chapters) m[c.status] += 1
    return m
  }, [chapters])

  const sorted = useMemo(() => [...chapters].sort((a, b) => a.order - b.order), [chapters])
  const maxWords = Math.max(1, ...chapters.map((c) => c.wordCount))
  const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0)

  const recent = useMemo(() => {
    const map = new Map(history.map((h) => [h.date, h.wordCount]))
    const dates = lastNDates(30)
    const values = dates.map((d) => map.get(d) ?? 0)
    const peak = Math.max(1, ...values, dailyGoal)
    return { dates, values, peak }
  }, [history, dailyGoal])

  const daysActive = recent.values.filter((v) => v > 0).length
  const sum30 = recent.values.reduce((s, v) => s + v, 0)

  return (
    <div className="progress-panel">
      <div className="panel-section">
        <div className="panel-head"><span>章节进度（{chapters.length} 章 · {totalWords.toLocaleString()} 字）</span></div>

        <div className="prog-status-row">
          {(['completed', 'revising', 'draft'] as const).map((s) => (
            <span key={s} className={`prog-chip chip-${s}`}>
              {STATUS_LABEL[s]} <b>{byStatus[s]}</b>
            </span>
          ))}
        </div>

        {sorted.length === 0 ? (
          <div className="prog-empty">还没有章节</div>
        ) : (
          <div className="prog-bars">
            {sorted.map((c) => (
              <button
                key={c.filePath}
                className={`prog-row ${activePath === c.filePath ? 'active' : ''}`}
                title={`${c.title} · ${STATUS_LABEL[c.status]} · 点击打开`}
                onClick={() => onOpenChapter(c.filePath)}
              >
                <span className="prog-row-label">{c.order >= 0 ? String(c.order).padStart(2, '0') : '--'}</span>
                <span className="prog-row-track">
                  <span className={`prog-row-fill fill-${c.status}`} style={{ width: `${Math.max(2, Math.round((c.wordCount / maxWords) * 100))}%` }} />
                </span>
                <span className="prog-row-words">{c.wordCount > 0 ? c.wordCount.toLocaleString() : '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-head">
          <span>近 30 天（{sum30.toLocaleString()} 字 · {daysActive} 天）</span>
          {dailyGoal > 0 ? <span className="prog-goal">日标 {dailyGoal}</span> : null}
        </div>
        <div className="prog-chart" role="img" aria-label="近 30 天每日字数柱状图">
          {recent.dates.map((d, i) => {
            const v = recent.values[i]
            const hPct = Math.round((v / recent.peak) * 100)
            return (
              <span key={d} className="prog-col" title={`${d}：${v} 字`}>
                <span className={`prog-bar ${dailyGoal > 0 && v >= dailyGoal ? 'goal-hit' : ''}`} style={{ height: `${Math.max(v > 0 ? 4 : 1, hPct)}%` }} />
              </span>
            )
          })}
        </div>
        <div className="prog-range">
          <span>{recent.dates[0].slice(5)}</span>
          <span>{recent.dates[recent.dates.length - 1].slice(5)}</span>
        </div>
      </div>
    </div>
  )
}
