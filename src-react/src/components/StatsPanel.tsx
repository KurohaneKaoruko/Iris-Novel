/**
 * 作品统计面板：总字数 / 章节数 / 日均等核心指标 + 长短板章节明细。
 * 数据来自 WorkStatsService；可刷新。
 */

import { useCallback, useEffect, useState } from 'react'
import { workStatsService } from '../services/WorkStatsService'
import './StatsPanel.css'

type StatsPanelProps = {
  stats?: WritingStats
}

export type WritingStats = {
  totalWords: number
  chapterCount: number
  characterCount: number
  conceptCount: number
  outlineCount: number
  daysWriting: number
  avgWordsPerDay: number
  longestChapter?: { title: string; words: number }
  shortestChapter?: { title: string; words: number }
}

function formatWords(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return n.toLocaleString()
}

export function StatsPanel({ stats: statsProp }: StatsPanelProps) {
  const [stats, setStats] = useState<WritingStats | null>(statsProp ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await workStatsService.getWorkStats()
      setStats({
        totalWords: next.totalWords,
        chapterCount: next.chapterCount,
        characterCount: 0,
        conceptCount: next.conceptCount,
        outlineCount: next.outlineCount,
        daysWriting: next.daysWriting,
        avgWordsPerDay: next.avgWordsPerDay,
        longestChapter: next.longestChapter,
        shortestChapter: next.shortestChapter,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!statsProp) void refresh()
  }, [statsProp, refresh])

  if (error) {
    return <div className="stats-panel stats-panel-error">{error}</div>
  }

  if (!stats) {
    return <div className="stats-panel stats-panel-loading">统计加载中…</div>
  }

  return (
    <div className="stats-panel">
      <div className="stats-panel-header">
        <span className="stats-panel-title">作品统计</span>
        <button
          type="button"
          className="stats-panel-refresh"
          onClick={() => void refresh()}
          disabled={loading}
          title="刷新统计"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {/* Main Stats */}
      <div className="stats-main">
        <div className="stats-main-item">
          <span className="stats-main-value">{formatWords(stats.totalWords)}</span>
          <span className="stats-main-label">总字数</span>
        </div>
        <div className="stats-main-divider" />
        <div className="stats-main-item">
          <span className="stats-main-value">{stats.chapterCount}</span>
          <span className="stats-main-label">章节</span>
        </div>
        <div className="stats-main-divider" />
        <div className="stats-main-item">
          <span className="stats-main-value">{stats.avgWordsPerDay.toLocaleString()}</span>
          <span className="stats-main-label">日均</span>
        </div>
      </div>

      {/* Details */}
      <div className="stats-details">
        <div className="stats-detail">
          <span className="stats-detail-value">{stats.conceptCount}</span>
          <span className="stats-detail-label">设定资料</span>
        </div>
        <div className="stats-detail">
          <span className="stats-detail-value">{stats.outlineCount}</span>
          <span className="stats-detail-label">大纲文件</span>
        </div>
        <div className="stats-detail">
          <span className="stats-detail-value">{stats.daysWriting}</span>
          <span className="stats-detail-label">写作天数</span>
        </div>
        {stats.longestChapter ? (
          <div className="stats-detail-wide">
            <span className="stats-detail-label">最长章节</span>
            <span className="stats-detail-text">
              {stats.longestChapter.title}（{formatWords(stats.longestChapter.words)} 字）
            </span>
          </div>
        ) : null}
        {stats.shortestChapter ? (
          <div className="stats-detail-wide">
            <span className="stats-detail-label">最短章节</span>
            <span className="stats-detail-text">
              {stats.shortestChapter.title}（{formatWords(stats.shortestChapter.words)} 字）
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
