'use client'

import { useState, useCallback } from 'react'
import { 拆书Analyze, 拆书ExtractTechniques, type Book拆书Result } from '../tauri'
import './BookAnalyzer.css'

type BookAnalyzerProps = {
  isOpen: boolean
  onClose: () => void
}

export function BookAnalyzer({ isOpen, onClose }: BookAnalyzerProps) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Book拆书Result | null>(null)
  const [mode, setMode] = useState<'full' | 'techniques'>('full')

  const handleAnalyze = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const data = await 拆书Analyze(content, title || '未命名作品')
      setResult(data)
    } catch (error) {
      console.error('拆书分析失败:', error)
    } finally {
      setLoading(false)
    }
  }, [content, title])

  const handleExtractTechniques = useCallback(async () => {
    if (!content.trim()) return
    setLoading(true)
    try {
      const techniques = await 拆书ExtractTechniques(content)
      setResult({
        title: title || '提取结果',
        author: null,
        source: '提取',
        structure: { type: '提取', acts: [], pacing: '未知', audience: '未知' },
        plot_arcs: [],
        rhythm: { average_chapter_length: 0, conflict_density: '未知', turning_points: [], chapter_hooks: [] },
        climax_points: [],
        爽点列表: [],
        characters: [],
        character_relationships: [],
        world_settings: [],
        power_system: [],
        techniques: techniques,
        summary: '',
        learnable_points: techniques.map(t => t.application)
      } as Book拆书Result)
    } catch (error) {
      console.error('提取失败:', error)
    } finally {
      setLoading(false)
    }
  }, [content, title])

  if (!isOpen) return null

  return (
    <div className="book-analyzer-overlay" onClick={onClose}>
      <div className="book-analyzer" onClick={(e) => e.stopPropagation()}>
        <div className="book-analyzer-header">
          <h2>📖 拆书分析</h2>
<button className="book-analyzer-close" onClick={onClose}>x</button>
        </div>

        <div className="book-analyzer-content">
          {/* Mode Selection */}
          <div className="book-analyzer-modes">
            <button 
              className={`mode-btn ${mode === 'full' ? 'active' : ''}`}
              onClick={() => { setMode('full'); setResult(null); }}
            >
              📊 完整分析
            </button>
            <button 
              className={`mode-btn ${mode === 'techniques' ? 'active' : ''}`}
              onClick={() => { setMode('techniques'); setResult(null); }}
            >
              ✨ 提取技巧
            </button>
          </div>

          {/* Input */}
          <div className="book-analyzer-input">
            <input
              type="text"
                  placeholder="Book title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="title-input"
            />
            <textarea
                  placeholder="Paste book content to analyze..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="content-input"
            />
          </div>

          {/* Action */}
          <button 
            className="book-analyzer-action"
            disabled={!content.trim() || loading}
            onClick={mode === 'full' ? handleAnalyze : handleExtractTechniques}
          >
            {loading ? '分析中...' : mode === 'full' ? '📊 开始拆书分析' : '✨ 提取写作技巧'}
          </button>

          {/* Result */}
          {result && (
            <div className="book-analyzer-result">
              {/* Summary */}
              <div className="result-summary">
                <h3>📖 拆书总结</h3>
                <p>{result.summary || '分析完成'}</p>
              </div>

              {/* Structure */}
              {result.structure && result.structure.type && (
                <div className="result-section">
                  <h4>🏗️ 结构分析</h4>
                  <div className="structure-info">
                    <div className="info-item">
                      <span className="info-label">类型</span>
                      <span className="info-value">{result.structure.type}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">节奏</span>
                      <span className="info-value">{result.structure.pacing}</span>
                    </div>
                  </div>
                  
                  {result.structure.acts && result.structure.acts.length > 0 && (
                    <div className="acts-flow">
                      {result.structure.acts.map((act, i) => (
                        <div key={i} className="act-box">
                          <span className="act-name">{act.name}</span>
                          <span className="act-desc">{act.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Rhythm */}
              {result.rhythm && result.rhythm.conflict_density && (
                <div className="result-section">
                  <h4>⚡ 节奏分析</h4>
                  <div className="rhythm-stats">
                    <div className="stat-item">
                      <span className="stat-value">{result.rhythm.average_chapter_length}</span>
                      <span className="stat-label">平均章节字数</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-value">{result.rhythm.conflict_density}</span>
                      <span className="stat-label">冲突密度</span>
                    </div>
                  </div>
                  
                  {result.rhythm.chapter_hooks && result.rhythm.chapter_hooks.length > 0 && (
                    <div className="hooks-list">
                      <span className="hooks-label">章尾钩子：</span>
                      {result.rhythm.chapter_hooks.map((hook, i) => (
                        <span key={i} className="hook-tag">{hook}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 爽点 */}
              {result.爽点列表 && result.爽点列表.length > 0 && (
                <div className="result-section">
                  <h4>🔥 爽点分析</h4>
                  <div className="爽点-list">
                    {result.爽点列表.map((s, i) => (
                      <div key={i} className="爽点-item">
                        <span className="爽点-type">{s.type}</span>
                        <span className="爽点-desc">{s.description}</span>
                        <span className="爽点-freq">{s.frequency}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Characters */}
              {result.characters && result.characters.length > 0 && (
                <div className="result-section">
                  <h4>👥 人物分析</h4>
                  <div className="characters-list">
                    {result.characters.map((char, i) => (
                      <div key={i} className="character-card">
                        <div className="char-header">
                          <span className="char-name">{char.name}</span>
                          <span className="char-role">{char.role}</span>
                        </div>
                        <div className="char-archetype">人设：{char.archetype}</div>
                        <div className="char-growth">成长：{char.growth}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Techniques - 重点！ */}
              {result.techniques && result.techniques.length > 0 && (
                <div className="result-section techniques-section">
                  <h4>✨ 写作技巧（可学习）</h4>
                  <div className="techniques-list">
                    {result.techniques.map((tech, i) => (
                      <div key={i} className="technique-card">
                        <div className="tech-category">{tech.category}</div>
                        <div className="tech-name">{tech.technique}</div>
                        <div className="tech-example">例：{tech.example}</div>
                        <div className="tech-application">✅ 应用：{tech.application}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Learnable Points */}
              {result.learnable_points && result.learnable_points.length > 0 && (
                <div className="result-section learnable-section">
                  <h4>📝 核心学习点</h4>
                  <div className="learnable-list">
                    {result.learnable_points.map((point, i) => (
                      <div key={i} className="learnable-item">
                        {point}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
