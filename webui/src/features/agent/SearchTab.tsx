import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SEARCH_SCOPES,
  MAX_TOTAL_HITS,
  collectScopeFiles,
  isValidQuery,
  searchFiles,
  splitHighlight,
  type SearchHit,
  type SearchScope,
} from '../../api/search'
import { listWorkspaceTree, readText, type FsEntry } from '../../api/backend'
import { Icon } from '../../components/Icon'

type Props = {
  /** 点击结果：打开/聚焦文件并跳到行 */
  onOpenFile: (path: string, line?: number) => void
}

/**
 * 「检索」页签：作品级全文检索（stories/concept/outline）。
 * 千章级工程分批扫描（批间让出主线程），可随时取消或改词。
 */
export function SearchTab({ onOpenFile }: Props) {
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [scopes, setScopes] = useState<SearchScope[]>([...SEARCH_SCOPES.map((s) => s.id)])
  const [hits, setHits] = useState<SearchHit[]>([])
  const [running, setRunning] = useState(false)
  const [scanned, setScanned] = useState(0)
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [err, setErr] = useState('')
  const runIdRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = useCallback(async () => {
    const q = query
    if (!isValidQuery(q) || scopes.length === 0 || running) return
    const runId = ++runIdRef.current
    const signal = { cancelled: false }
    setRunning(true)
    setErr('')
    setHits([])
    setScanned(0)
    setTotal(0)
    setTruncated(false)
    try {
      const tree = await listWorkspaceTree(8)
      if (runId !== runIdRef.current) return
      const files = collectScopeFiles(tree as FsEntry, scopes)
      setTotal(files.length)
      const r = await searchFiles(files, (p) => readText(p), q, {
        caseSensitive,
        signal,
        onProgress: (p) => {
          if (runId === runIdRef.current) setScanned(p.scanned)
        },
      })
      if (runId !== runIdRef.current) return
      setHits(r.hits)
      setScanned(r.scanned)
      setTruncated(r.truncated)
    } catch (e) {
      if (runId === runIdRef.current) setErr(e instanceof Error ? e.message : String(e))
    } finally {
      if (runId === runIdRef.current) setRunning(false)
    }
  }, [caseSensitive, query, running, scopes])

  const cancel = useCallback(() => {
    runIdRef.current += 1
    setRunning(false)
  }, [])

  const toggleScope = useCallback((s: SearchScope) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }, [])

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>()
    for (const h of hits) {
      const arr = m.get(h.path) ?? []
      arr.push(h)
      m.set(h.path, arr)
    }
    return [...m.entries()]
  }, [hits])

  return (
    <div className="srch">
      <div className="tools-runbar">
        <div className="srch-inputwrap">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            className="srch-input"
            value={query}
            placeholder="搜索全作品正文、设定、大纲…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (running) cancel()
                void run()
              }
            }}
          />
          {query ? (
            <button className="srch-clear" title="清空" onClick={() => { setQuery(''); setHits([]) }}>
              <Icon name="x" size={12} />
            </button>
          ) : null}
        </div>
        {running ? (
          <button className="tools-run" onClick={cancel}>停止</button>
        ) : (
          <button className="tools-run primary" disabled={!isValidQuery(query) || scopes.length === 0} onClick={() => void run()}>
            <Icon name="search" size={14} />搜索
          </button>
        )}
      </div>

      <div className="srch-filters">
        <span className="srch-filter-label">范围</span>
        {SEARCH_SCOPES.map((s) => (
          <button
            key={s.id}
            className={`srch-chip ${scopes.includes(s.id) ? 'on' : ''}`}
            onClick={() => toggleScope(s.id)}
            title={`${s.id}/`}
          >
            {s.zh}
          </button>
        ))}
        <label className="srch-case" title="区分大小写">
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          Aa
        </label>
        <span className="srch-progress">
          {running && total > 0
            ? `扫描中 ${scanned}/${total}…`
            : hits.length > 0
              ? `${hits.length} 处命中 · ${grouped.length} 个文件${truncated ? `（已达 ${MAX_TOTAL_HITS} 上限，请细化关键词）` : ''}`
              : ''}
        </span>
      </div>

      {err ? <div className="tools-err">{err}</div> : null}

      {grouped.length > 0 ? (
        <div className="srch-results">
          {grouped.map(([path, fileHits]) => (
            <div key={path} className="srch-file">
              <div className="srch-file-head">
                <Icon name="file-text" size={13} />
                <span className="srch-path" title={path}>{path}</span>
                <span className="srch-count">{fileHits.length}</span>
              </div>
              {fileHits.map((h, i) => (
                <button key={i} className="srch-hit" onClick={() => onOpenFile(h.path, h.line)} title={`${path}:${h.line}`}>
                  <span className="srch-line-no">{h.line}</span>
                  <span className="srch-line-text">
                    <span className="srch-main">
                      {splitHighlight(h.text, query, caseSensitive).map((p, j) =>
                        p.hit ? <mark key={j} className="srch-mark">{p.text}</mark> : <span key={j}>{p.text}</span>,
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : !running && scanned > 0 ? (
        <div className="tools-hint">无匹配结果（已扫描 {scanned} 个文件）</div>
      ) : null}
    </div>
  )
}
