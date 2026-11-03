/**
 * 写作进度追踪：总目标 / 日更目标 / 章节完成三环进度。
 * 数据来自 WorkStatsService.getProgress；目标值可由外部注入。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { workStatsService } from '../services/WorkStatsService'
import './ProgressTracker.css'

export type WritingProgress = {
  totalWords: number
  targetWords: number
  chapters: number
  completedChapters: number
  dailyTarget: number
  todayWords: number
}

type ProgressTrackerProps = {
  progress?: WritingProgress
  /** 作品目标字数（如 100 万），不传则总目标环显示占位 */
  targetWords?: number
}

function ProgressRing({ percent, label, value }: { percent: number; label: string; value: string }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="progress-ring-item">
      <div
        className="progress-ring"
        style={{ background: `conic-gradient(var(--accent-primary, #7aa2f7) ${clamped * 3.6}deg, var(--bg-secondary, rgba(127,127,127,0.15)) 0deg)` }}
      >
        <div className="progress-ring-inner">
          <span className="progress-ring-percent">{clamped}%</span>
        </div>
      </div>
      <span className="progress-ring-label">{label}</span>
      <span className="progress-ring-value">{value}</span>
    </div>
  )
}

export function ProgressTracker({ progress: progressProp, targetWords }: ProgressTrackerProps) {
  const [progress, setProgress] = useState<WritingProgress | null>(progressProp ?? null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setProgress(await workStatsService.getProgress(targetWords))
    } catch {
      /* 静默降级：保留上次数据 */
    } finally {
      setLoading(false)
    }
  }, [targetWords])

  useEffect(() => {
    if (!progressProp) void refresh()
  }, [progressProp, refresh])

  const derived = useMemo(() => {
    const p =
      progress ??
      ({ totalWords: 0, targetWords: 0, chapters: 0, completedChapters: 0, dailyTarget: 0, todayWords: 0 } as WritingProgress)
    const totalProgress = p.targetWords > 0 ? Math.min(100, Math.round((p.totalWords / p.targetWords) * 100)) : 0
    const dailyProgress = p.dailyTarget > 0 ? Math.min(100, Math.round((p.todayWords / p.dailyTarget) * 100)) : 0
    const chapterProgress = p.chapters > 0 ? Math.round((p.completedChapters / p.chapters) * 100) : 0
    return { p, totalProgress, dailyProgress, chapterProgress }
  }, [progress])

  if (!progress && !loading) {
    return null
  }

  const { p, totalProgress, dailyProgress, chapterProgress } = derived

  return (
    <div className="progress-tracker">
      <div className="progress-tracker-header">
        <span className="progress-tracker-title">写作进度</span>
        <button
          type="button"
          className="progress-tracker-refresh"
          onClick={() => void refresh()}
          disabled={loading}
          title="刷新进度"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>
      <div className="progress-rings">
        <ProgressRing
          percent={totalProgress}
          label="总目标"
          value={p.targetWords > 0 ? `${p.totalWords.toLocaleString()} / ${p.targetWords.toLocaleString()}` : '未设置'}
        />
        <ProgressRing
          percent={dailyProgress}
          label="今日"
          value={p.dailyTarget > 0 ? `${p.todayWords.toLocaleString()} / ${p.dailyTarget.toLocaleString()}` : '未设置'}
        />
        <ProgressRing
          percent={chapterProgress}
          label="章节"
          value={`${p.completedChapters} / ${p.chapters}`}
        />
      </div>
    </div>
  )
}
