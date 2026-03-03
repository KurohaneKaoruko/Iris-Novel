'use client'

import { useState } from 'react'
import './Export.css'

export type ExportFormat = 'txt' | 'md' | 'html' | 'pdf' | 'docx' | 'epub'

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
  workspaceName?: string
}

const formatLabels: Record<ExportFormat, { label: string; icon: string; desc: string }> = {
  txt: { label: 'Plain Text', icon: 'TXT', desc: '.txt format, simple and portable' },
  md: { label: 'Markdown', icon: 'MD', desc: '.md format, keeps basic formatting' },
  html: { label: 'Web Page', icon: 'HTML', desc: '.html format, easy to share' },
  pdf: { label: 'PDF', icon: 'PDF', desc: '.pdf format, print-friendly' },
  docx: { label: 'Word', icon: 'DOCX', desc: '.docx format, editable' },
  epub: { label: 'EPUB', icon: 'EPUB', desc: '.epub format, ebook ready' },
}

export function ExportPanel({ isOpen, onClose, onExport, workspaceName = '小说' }: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>('txt')
  const [options, setOptions] = useState<ExportOptions>({
    format: 'txt',
    includeOutline: false,
    includeCharacters: false,
    includeMetadata: true,
  })
  const [title, setTitle] = useState(workspaceName)
  const [author, setAuthor] = useState('')

  if (!isOpen) return null

  const handleExport = () => {
    onExport({
      ...options,
      title,
      author,
    })
    onClose()
  }

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-header">
          <h2>导出小说</h2>
              <button className="export-close" onClick={onClose}>x</button>
        </div>

        <div className="export-content">
          {/* Format Selection */}
          <div className="export-section">
            <h3 className="export-section-title">导出格式</h3>
            <div className="export-formats">
              {Object.entries(formatLabels).map(([key, value]) => (
                <label
                  key={key}
                  className={`export-format ${format === key ? 'active' : ''}`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={key}
                    checked={format === key}
                    onChange={(e) => {
                      setFormat(e.target.value as ExportFormat)
                      setOptions({ ...options, format: e.target.value as ExportFormat })
                    }}
                  />
                  <span className="export-format-icon">{value.icon}</span>
                  <div className="export-format-text">
                    <span className="export-format-label">{value.label}</span>
                    <span className="export-format-desc">{value.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Metadata */}
          <div className="export-section">
            <h3 className="export-section-title">元信息</h3>
            <div className="export-field">
              <label>书名</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                    placeholder="Novel title"
              />
            </div>
            <div className="export-field">
              <label>作者</label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Author name"
              />
            </div>
          </div>

          {/* Options */}
          <div className="export-section">
            <h3 className="export-section-title">导出内容</h3>
            <label className="export-option">
              <input
                type="checkbox"
                checked={options.includeOutline}
                onChange={(e) => setOptions({ ...options, includeOutline: e.target.checked })}
              />
              <span>包含大纲</span>
            </label>
            <label className="export-option">
              <input
                type="checkbox"
                checked={options.includeCharacters}
                onChange={(e) => setOptions({ ...options, includeCharacters: e.target.checked })}
              />
              <span>包含人物设定</span>
            </label>
            <label className="export-option">
              <input
                type="checkbox"
                checked={options.includeMetadata}
                onChange={(e) => setOptions({ ...options, includeMetadata: e.target.checked })}
              />
              <span>包含元信息（标题、作者等）</span>
            </label>
          </div>
        </div>

        <div className="export-footer">
            <button className="export-btn secondary" onClick={onClose}>Cancel</button>
          <button className="export-btn primary" onClick={handleExport}>
            导出 {formatLabels[format].label}
          </button>
        </div>
      </div>
    </div>
  )
}
