import { useCallback, useState } from 'react'
import { bookAnalyze, readText, listWorkspaceTree, type BookAnalysisResult, type FsEntry } from '../../api/backend'
import './BookAnalyzerPanel.css'

type Props = {
  onError: (msg: string | null) => void
}

function collectChapters(entry: FsEntry): FsEntry[] {
  const out: FsEntry[] = []
  const walk = (e: FsEntry) => {
    if (e.kind === 'file' && /^stories\/.*\.(md|txt)$/i.test(e.path)) out.push(e)
    for (const c of e.children ?? []) walk(c)
  }
  walk(entry)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** 拆书面板：整本内容 → book_analyze AI 拆解 → 结构/人物/技法报告 */
export function BookAnalyzerPanel({ onError }: Props) {
  const [source, setSource] = useState<'paste' | 'work'>('paste')
  const [pasted, setPasted] = useState('')
  const [chapterFiles, setChapterFiles] = useState<FsEntry[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BookAnalysisResult | null>(null)

  const loadWorkChapters = useCallback(async () => {
    try {
      const tree = await listWorkspaceTree(6)
      setChapterFiles(collectChapters(tree))
    } catch (e) {
      onError(`读取目录失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [onError])

  const pick = (path: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      let content = ''
      let bookTitle = title.trim()
      if (source === 'paste') {
        content = pasted.trim()
        if (!content) {
          onError('请粘贴要拆解的书籍内容')
          return
        }
      } else {
        if (picked.size === 0) {
          onError('请勾选要拆解的章节')
          return
        }
        const parts: string[] = []
        for (const p of picked) {
          try {
            parts.push(await readText(p))
          } catch { /* skip */ }
        }
        content = parts.join('\n\n')
        if (!bookTitle) bookTitle = '本书'
      }
      const r = await bookAnalyze(content.slice(0, 60000), bookTitle || '未命名')
      setResult(r)
    } catch (e) {
      onError(`拆书失败：${e instanceof Error ? e.message : String(e)}（需要已配置 Provider API Key）`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => { if (!running) onError(null) }}>
      <div className="modal-box book-box" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="book-title">拆书分析</span>
          <button className="modal-close" onClick={() => onError(null)}>✕</button>
        </header>
        <div className="modal-body book-body">
          <div className="book-source-tabs">
            <button className={source === 'paste' ? 'active' : ''} onClick={() => setSource('paste')}>粘贴文本</button>
            <button
              className={source === 'work' ? 'active' : ''}
              onClick={() => { setSource('work'); if (chapterFiles.length === 0) void loadWorkChapters() }}
            >
              拆当前作品
            </button>
          </div>

          {source === 'paste' ? (
            <textarea
              className="book-paste"
              rows={8}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="粘贴书籍全文或片段（最多取前 6 万字）…"
            />
          ) : (
            <div className="book-chapters">
              <div className="book-chapter-head">
                <span>选择章节（{picked.size}）</span>
                <button onClick={() => setPicked(new Set(chapterFiles.map((f) => f.path)))}>全选</button>
                <button onClick={() => setPicked(new Set())}>清空</button>
              </div>
              <div className="book-chapter-list">
                {chapterFiles.map((f) => (
                  <label key={f.path}>
                    <input type="checkbox" checked={picked.has(f.path)} onChange={() => pick(f.path)} />
                    {f.name}
                  </label>
                ))}
                {chapterFiles.length === 0 ? <span className="book-empty">当前作品没有章节</span> : null}
              </div>
            </div>
          )}

          <div className="book-run-row">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="书名（可选）" />
            <button className="book-run" disabled={running} onClick={() => void run()}>
              {running ? '拆解中…（可能需要一分钟左右）' : '开始拆解'}
            </button>
          </div>

          {result ? (
            <div className="book-report">
              <h3>{result.title}{result.author ? ` · ${result.author}` : ''} <small>（{result.source}）</small></h3>

              <section>
                <h4>结构</h4>
                <p>
                  类型：{result.structure.type} · 节奏：{result.structure.pacing} · 受众：{result.structure.audience}
                </p>
                {result.structure.acts.map((a) => (
                  <div key={a.id} className="book-act">
                    <b>{a.name}</b>（章 {a.chapters.join(', ')}）— {a.description}
                  </div>
                ))}
              </section>

              {result.plot_arcs.length > 0 ? (
                <section>
                  <h4>情节线</h4>
                  {result.plot_arcs.map((p, i) => (
                    <div key={i} className="book-line">
                      <span className={`book-badge ${p.main ? 'main' : ''}`}>{p.main ? '主线' : '支线'}</span>
                      <b>{p.name}</b>（章 {p.chapters.join(', ')}）— {p.description}
                    </div>
                  ))}
                </section>
              ) : null}

              {result.characters.length > 0 ? (
                <section>
                  <h4>人物（{result.characters.length}）</h4>
                  {result.characters.map((c, i) => (
                    <div key={i} className="book-item">{JSON.stringify(c, null, 0).slice(0, 200)}</div>
                  ))}
                </section>
              ) : null}

              {result.techniques.length > 0 ? (
                <section>
                  <h4>写作技法（{result.techniques.length}）</h4>
                  {result.techniques.map((t, i) => (
                    <div key={i} className="book-item">{JSON.stringify(t, null, 0).slice(0, 200)}</div>
                  ))}
                </section>
              ) : null}

              {result.learnable_points.length > 0 ? (
                <section>
                  <h4>可借鉴点</h4>
                  <ul>{result.learnable_points.map((p, i) => (<li key={i}>{p}</li>))}</ul>
                </section>
              ) : null}

              <section>
                <h4>总结</h4>
                <p className="book-summary">{result.summary}</p>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
