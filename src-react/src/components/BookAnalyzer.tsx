/**
 * 拆书分析弹窗：粘贴文本或导入 TXT 文件，调用后端 book_analyze / book_extract_techniques。
 * 结果分节展示：结构 / 节奏 / 爽点 / 人物 / 世界观 / 技法。
 */

import { useCallback, useRef, useState } from 'react'
import { bookAnalyze, bookExtractTechniques, type BookAnalysisReport } from '../tauri'
import './BookAnalyzer.css'

type BookAnalyzerProps = {
  isOpen: boolean
  onClose: () => void
  /** 分析完成后回调（如写入资料库） */
  onAnalyzed?: (report: BookAnalysisReport) => void
}

const MAX_CONTENT_CHARS = 200_000

export function BookAnalyzer({ isOpen, onClose, onAnalyzed }: BookAnalyzerProps) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BookAnalysisReport | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const wordCount = content.replace(/\s/g, '').length

  const handleAnalyze = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await bookAnalyze(content, title || fileName || '未命名作品')
      setResult(data)
      onAnalyzed?.(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [content, title, fileName, onAnalyzed])

  const handleExtractTechniques = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    setError(null)
    try {
      const techniques = await bookExtractTechniques(content)
      setResult((prev) =>
        prev
          ? { ...prev, techniques }
          : {
              title: title || fileName || '技法提取',
              author: null,
              source: 'extract',
              structure: { type: '', acts: [], pacing: '', audience: '' },
              plot_arcs: [],
              rhythm: {
                average_chapter_length: 0,
                conflict_density: '',
                turning_points: [],
                chapter_hooks: [],
              },
              climax_points: [],
              power_moments: [],
              characters: [],
              character_relationships: [],
              world_settings: [],
              power_system: [],
              techniques,
              summary: '',
              learnable_points: techniques.map((t) => t.application),
            },
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [content, title, fileName])

  const handleFileImport = useCallback(async (file: File) => {
    setError(null)
    const text = await file.text()
    if (text.length > MAX_CONTENT_CHARS) {
      setContent(text.slice(0, MAX_CONTENT_CHARS))
      setError(`文件过大，已截取前 ${MAX_CONTENT_CHARS / 10000} 万字分析`)
    } else {
      setContent(text)
    }
    setFileName(file.name.replace(/\.[^.]+$/, ''))
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''))
  }, [title])

  if (!isOpen) return null

  return (
    <div className="book-analyzer-overlay glass-modal-overlay" onClick={onClose}>
      <div className="book-analyzer glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="book-analyzer-header">
          <h2>拆书分析</h2>
          <button type="button" className="book-analyzer-close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        <div className="book-analyzer-content">
          <div className="book-analyzer-input">
            <div className="book-analyzer-file-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFileImport(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className="mode-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                导入 TXT / MD 文件
              </button>
              {fileName ? <span className="book-analyzer-file-name">{fileName}</span> : null}
            </div>
            <input
              className="title-input"
              placeholder="书名（可选）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="content-input"
              placeholder="粘贴要分析的正文…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <div className="book-analyzer-meta">
              <span>{wordCount.toLocaleString()} 字</span>
            </div>
          </div>

          <div className="book-analyzer-modes">
            <button
              type="button"
              className="mode-btn"
              disabled={loading || !content.trim()}
              onClick={() => void handleAnalyze()}
            >
              {loading ? '分析中…' : '完整分析'}
            </button>
            <button
              type="button"
              className="mode-btn"
              disabled={loading || !content.trim()}
              onClick={() => void handleExtractTechniques()}
            >
              仅提取技法
            </button>
          </div>

          {error ? <div className="book-analyzer-error">{error}</div> : null}

          {result ? (
            <div className="book-analyzer-result">
              {result.summary ? (
                <div className="result-summary">
                  <h3>{result.title}</h3>
                  <p>{result.summary}</p>
                </div>
              ) : null}

              {result.structure && result.structure.type ? (
                <div className="result-section">
                  <h4>结构分析</h4>
                  <div className="structure-info">
                    <div className="info-item">
                      <span className="info-label">类型</span>
                      <span className="info-value">{result.structure.type}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">节奏</span>
                      <span className="info-value">{result.structure.pacing || '—'}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">受众</span>
                      <span className="info-value">{result.structure.audience || '—'}</span>
                    </div>
                  </div>
                  {result.structure.acts?.length ? (
                    <div className="acts-flow">
                      {result.structure.acts.map((act, i) => (
                        <div key={i} className="act-box">
                          <span className="act-name">{act.name}</span>
                          <span className="act-desc">{act.description}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {result.rhythm && result.rhythm.conflict_density ? (
                <div className="result-section">
                  <h4>节奏分析</h4>
                  <div className="rhythm-stats">
                    <div className="stat-item">
                      <span className="stat-value">{result.rhythm.average_chapter_length}</span>
                      <span className="stat-label">章均字数</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{result.rhythm.conflict_density}</span>
                      <span className="stat-label">冲突密度</span>
                    </div>
                  </div>
                  {result.rhythm.turning_points?.length ? (
                    <div className="turning-points">
                      {result.rhythm.turning_points.map((tp, i) => (
                        <div key={i} className="turning-point">
                          <span className="tp-chapter">第 {tp.chapter} 章</span>
                          <span className="tp-type">{tp.type}</span>
                          <span className="tp-desc">{tp.description}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {result.power_moments?.length ? (
                <div className="result-section">
                  <h4>爽点分布</h4>
                  <div className="power-moments">
                    {result.power_moments.map((pm, i) => (
                      <div key={i} className="power-moment">
                        <span className="pm-chapter">第 {pm.chapter} 章</span>
                        <span className="pm-type">{pm.type}</span>
                        <span className="pm-desc">{pm.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.characters?.length ? (
                <div className="result-section">
                  <h4>人物分析</h4>
                  <div className="characters-list">
                    {result.characters.map((c, i) => (
                      <div key={i} className="character-card">
                        <div className="char-header">
                          <span className="char-name">{c.name}</span>
                          <span className="char-role">{c.role}</span>
                        </div>
                        <div className="char-archetype">{c.archetype}</div>
                        <div className="char-growth">{c.growth}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.world_settings?.length ? (
                <div className="result-section">
                  <h4>世界观设定</h4>
                  <div className="world-settings">
                    {result.world_settings.map((w, i) => (
                      <div key={i} className="world-setting">
                        <span className="ws-name">{w.name}</span>
                        <span className="ws-category">{w.category}</span>
                        <span className="ws-desc">{w.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.techniques?.length ? (
                <div className="result-section">
                  <h4>写作技法</h4>
                  <div className="techniques-list">
                    {result.techniques.map((t, i) => (
                      <div key={i} className="technique-item">
                        <div className="tech-header">
                          <span className="tech-category">{t.category}</span>
                          <span className="tech-name">{t.technique}</span>
                        </div>
                        <div className="tech-example">例：{t.example}</div>
                        <div className="tech-application">可用：{t.application}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {result.learnable_points?.length ? (
                <div className="result-section">
                  <h4>可借鉴要点</h4>
                  <ul className="learnable-points">
                    {result.learnable_points.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
