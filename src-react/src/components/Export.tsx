'use client'

import { useState } from 'react'
import { useI18n } from '../i18n'
import './Export.css'

export type ExportFormat = 'txt' | 'md' | 'html'

export type ExportOptions = {
  format: ExportFormat
  includeOutline: boolean
  includeCharacters: boolean
  includeMetadata: boolean
  title?: string
  author?: string
}

type ExportPanelProps = {
  isOpen: boolean
  onClose: () => void
  onExport: (options: ExportOptions) => void
  busy?: boolean
  workspaceName?: string
}

export function ExportPanel({ isOpen, onClose, onExport, busy = false, workspaceName = '' }: ExportPanelProps) {
  const { t } = useI18n()
  const [format, setFormat] = useState<ExportFormat>('md')
  const [includeOutline, setIncludeOutline] = useState(false)
  const [includeCharacters, setIncludeCharacters] = useState(false)
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [title, setTitle] = useState(workspaceName)

  if (!isOpen) return null

  const formats: Array<{ key: ExportFormat; icon: string }> = [
    { key: 'md', icon: 'MD' },
    { key: 'txt', icon: 'TXT' },
    { key: 'html', icon: 'HTML' },
  ]

  const handleExport = () => {
    onExport({
      format,
      includeOutline,
      includeCharacters,
      includeMetadata,
      title: title.trim() || workspaceName || 'novel',
      author: '',
    })
  }

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-header">
          <h2>{t('export.title')}</h2>
          <button className="export-close" onClick={onClose}>x</button>
        </div>

        <div className="export-content">
          <div className="export-section">
            <h3 className="export-section-title">{t('export.format')}</h3>
            <div className="export-formats">
              {formats.map(({ key, icon }) => (
                <label key={key} className={`export-format ${format === key ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="format"
                    value={key}
                    checked={format === key}
                    onChange={() => setFormat(key)}
                  />
                  <span className="export-format-icon">{icon}</span>
                  <div className="export-format-text">
                    <span className="export-format-label">{t(`export.format.${key}`)}</span>
                    <span className="export-format-desc">{t(`export.format.${key}.desc`)}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="export-section">
            <h3 className="export-section-title">{t('export.meta')}</h3>
            <div className="export-field">
              <label>{t('export.meta.title')}</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={workspaceName || t('export.meta.titlePlaceholder')}
              />
            </div>
          </div>

          <div className="export-section">
            <h3 className="export-section-title">{t('export.content')}</h3>
            <label className="export-option">
              <input
                type="checkbox"
                checked={includeMetadata}
                onChange={(e) => setIncludeMetadata(e.target.checked)}
              />
              <span>{t('export.includeMetadata')}</span>
            </label>
            <label className="export-option">
              <input
                type="checkbox"
                checked={includeOutline}
                onChange={(e) => setIncludeOutline(e.target.checked)}
              />
              <span>{t('export.includeOutline')}</span>
            </label>
            <label className="export-option">
              <input
                type="checkbox"
                checked={includeCharacters}
                onChange={(e) => setIncludeCharacters(e.target.checked)}
              />
              <span>{t('export.includeCharacters')}</span>
            </label>
          </div>
        </div>

        <div className="export-footer">
          <button className="export-btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="export-btn primary" onClick={handleExport} disabled={busy}>
            {busy ? t('export.busy') : t('export.action')}
          </button>
        </div>
      </div>
    </div>
  )
}
