import type { WorkStats } from '../../api/novel'
import './StatsPanel.css'

type Props = { stats: WorkStats }

export function StatsPanel({ stats }: Props) {
  const pct =
    stats.chapterCount > 0
      ? Math.round((stats.completedChapters / stats.chapterCount) * 100)
      : 0
  return (
    <div className="stats-footer">
      <div className="stats-grid">
        <div className="stat-cell">
          <span className="stat-value">{stats.totalWords.toLocaleString()}</span>
          <span className="stat-label">总字数</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value">{stats.chapterCount}</span>
          <span className="stat-label">章节</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value">{stats.completedChapters}<small>/{pct}%</small></span>
          <span className="stat-label">完结</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value">{stats.todayWords}</span>
          <span className="stat-label">今日</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value">{stats.conceptCount + stats.outlineCount}</span>
          <span className="stat-label">资料</span>
        </div>
        <div className="stat-cell">
          <span className="stat-value">{stats.daysWriting}</span>
          <span className="stat-label">写作天</span>
        </div>
      </div>
    </div>
  )
}
