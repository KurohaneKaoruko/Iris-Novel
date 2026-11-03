'use client'

import { useMemo } from 'react'
import { useI18n } from '../i18n'
import './Timeline.css'

export type TimelineItem = {
  id: string
  date: Date | string
  title: string
  description?: string
  type?: 'chapter' | 'event' | 'milestone' | 'note'
}

type TimelineProps = {
  items: TimelineItem[]
  onItemClick?: (item: TimelineItem) => void
}

export function Timeline({ items, onItemClick }: TimelineProps) {
  const { locale } = useI18n()

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const dateA = new Date(a.date).getTime()
      const dateB = new Date(b.date).getTime()
      return dateB - dateA // newest first
    })
  }, [items])

  const formatDate = (date: Date | string) => {
    const d = new Date(date)
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getTypeIcon = (type?: string) => {
    switch (type) {
      case 'chapter': return '📄'
      case 'event': return '🎉'
      case 'milestone': return '🏆'
      default: return '📝'
    }
  }

  const getTypeClass = (type?: string) => {
    switch (type) {
      case 'chapter': return 'timeline-item-chapter'
      case 'event': return 'timeline-item-event'
      case 'milestone': return 'timeline-item-milestone'
      default: return 'timeline-item-note'
    }
  }

  if (items.length === 0) {
    return (
      <div className="timeline-empty">
        <span className="timeline-empty-icon">📅</span>
        <span className="timeline-empty-text">暂无时间线</span>
      </div>
    )
  }

  return (
    <div className="timeline">
      {sortedItems.map((item, index) => (
        <div
          key={item.id}
          className={`timeline-item ${getTypeClass(item.type)} ${onItemClick ? 'clickable' : ''}`}
          onClick={() => onItemClick?.(item)}
        >
          <div className="timeline-dot">
            <span className="timeline-dot-inner">{getTypeIcon(item.type)}</span>
          </div>
          {index < sortedItems.length - 1 && <div className="timeline-line" />}
          <div className="timeline-content">
            <div className="timeline-date">{formatDate(item.date)}</div>
            <div className="timeline-title">{item.title}</div>
            {item.description && (
              <div className="timeline-desc">{item.description}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// Compact version for sidebar
export function TimelineCompact({ items }: { items: TimelineItem[] }) {
  const recentItems = useMemo(() => {
    return [...items]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
  }, [items])

  const formatDate = (date: Date | string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  if (items.length === 0) return null

  return (
    <div className="timeline-compact">
      {recentItems.map((item) => (
        <div key={item.id} className="timeline-compact-item">
          <span className="timeline-compact-icon">
            {item.type === 'chapter' ? '📄' : item.type === 'milestone' ? '🏆' : '📝'}
          </span>
          <span className="timeline-compact-title">{item.title}</span>
          <span className="timeline-compact-date">{formatDate(item.date)}</span>
        </div>
      ))}
    </div>
  )
}
