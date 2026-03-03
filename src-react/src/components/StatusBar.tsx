'use client'

import { useMemo } from 'react'
import { useI18n } from '../i18n'
import './StatusBar.css'

export type StatusBarInfo = {
  fileName?: string
  filePath?: string
  language?: string
  lineCount?: number
  charCount?: number
  wordCount?: number
  chapterTarget?: number
  currentChapter?: string
  historyLabel?: string
  historyStatus?: 'idle' | 'recording'
  theme?: 'light' | 'dark'
}

type StatusBarProps = {
  info: StatusBarInfo
  onThemeToggle?: () => void
  onHistoryClick?: () => void
}

export function StatusBar({ info, onThemeToggle, onHistoryClick }: StatusBarProps) {
  const { t } = useI18n()

  const wordCountText = useMemo(() => {
    if (!info.wordCount) return ''
    const w = info.wordCount.toLocaleString()
    if (info.chapterTarget) {
      const progress = Math.min(100, Math.round((info.wordCount / info.chapterTarget) * 100))
      return `${w} / ${info.chapterTarget.toLocaleString()} (${progress}%)`
    }
    return w
  }, [info.wordCount, info.chapterTarget])

  const historyText = useMemo(() => {
    if (!info.historyLabel) return null
    if (info.historyStatus === 'recording') return `${info.historyLabel} *`
    return info.historyLabel
  }, [info.historyLabel, info.historyStatus])

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        {historyText && (
          <div
            className={`status-bar-item clickable ${info.historyStatus === 'recording' ? 'recording' : ''}`}
            onClick={onHistoryClick}
            title={t('status.history')}
          >
            <span className="status-bar-icon">H</span>
            {historyText}
          </div>
        )}
        {info.currentChapter && (
          <div className="status-bar-item" title={t('status.currentChapter')}>
            <span className="status-bar-icon">C</span>
            {info.currentChapter}
          </div>
        )}
      </div>

      <div className="status-bar-right">
        {wordCountText && (
          <div className="status-bar-item" title={t('status.wordCount')}>
            <span className="status-bar-icon">W</span>
            {wordCountText}
          </div>
        )}
        {info.charCount !== undefined && (
          <div className="status-bar-item" title={t('status.characterCount')}>
            {info.charCount.toLocaleString()} {t('status.chars')}
          </div>
        )}
        {info.lineCount !== undefined && (
          <div className="status-bar-item" title={t('status.lineCount')}>
            {info.lineCount} {t('status.lines')}
          </div>
        )}
        {info.language && <div className="status-bar-item">{info.language}</div>}
        <div className="status-bar-item clickable theme-toggle" onClick={onThemeToggle} title={t('status.toggleTheme')}>
          {info.theme === 'dark' ? t('common.light') : t('common.dark')}
        </div>
      </div>
    </div>
  )
}
