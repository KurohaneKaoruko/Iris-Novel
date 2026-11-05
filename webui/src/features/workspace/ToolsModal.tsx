import { useCallback, useMemo, useRef, useState } from 'react'
import { listWorkspaceTree, readText, riskScanContent, type FsEntry, type RiskScanResult } from '../../api/backend'
import { LintTab } from './LintTab'
import { ImportTab } from './ImportTab'
import { ConsistencyTab } from './ConsistencyTab'
import './ToolsModal.css'

type Props = {
  onClose: () => void
  onError: (msg: string | null) => void
  /** 搜索结果点击跳转 */
  onOpenFile: (path: string) => void
  /** 当前活动章节（风险审阅默认目标） */
  activePath: string | null
  /** 导入/体检等操作后外部刷新 */
  onRefresh?: () => void
  /** 初始页签（命令面板直达） */
  initialTab?: Tab
}

type Tab = 'search' | 'export' | 'risk' | 'lint' | 'import' | 'consistency'

type SearchHit = { path: string; line: number; text: string }

type ExportOptions = {
  includeOutline: boolean
  includeCharacters: boolean
  format: 'md' | 'txt'
}

function collectFiles(entry: FsEntry, test: (p: string) => boolean): FsEntry[] {
  const out: FsEntry[] = []
  const walk = (e: FsEntry) => {
    if (e.kind === 'file' && test(e.path)) out.push(e)
    for (const c of e.children ?? []) walk(c)
  }
  walk(entry)
  return out
}

const stripMd = (t: string) => t.replace(/^#{1,6}\s+/gm, '').replace(/[*_`>]/g, '')

export function ToolsModal({ onClose, onError, onOpenFile, activePath, onRefresh, initialTab }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'search')

  // ---- 搜索 ----
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)

  const doSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const tree = await listWorkspaceTree(6)
      const files = collectFiles(tree, (p) => /\.(md|txt)$/i.test(p) && !p.startsWith('.novel'))
      const all: SearchHit[] = []
      for (const f of files) {
        try {
          const content = await readText(f.path)
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(q)) {
              all.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 120) })
              if (all.length >= 200) throw new Error('limit')
            }
          }
        } catch {
          /* 单文件失败跳过 */
        }
      }
      setHits(all)
    } catch (e) {
      if (!(e instanceof Error && e.message === 'limit')) onError(`搜索失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSearching(false)
    }
  }, [onError, query])

  // ---- 导出 ----
  const [exportOpts, setExportOpts] = useState<ExportOptions>({ includeOutline: false, includeCharacters: false, format: 'md' })
  const [exporting, setExporting] = useState(false)
  const exportSummaryRef = useRef('')

  const doExport = useCallback(async () => {
    setExporting(true)
    try {
      const tree = await listWorkspaceTree(6)
      const chapters = collectFiles(tree, (p) => /^stories\/.*\.(md|txt)$/i.test(p)).sort((a, b) =>
        a.path.localeCompare(b.path, 'zh-Hans-CN', { numeric: true }),
      )
      if (chapters.length === 0) {
        onError('没有可导出的章节')
        return
      }
      const parts: string[] = []
      let workName = '全书'
      const rootName = workName
      if (exportOpts.includeOutline || exportOpts.includeCharacters) {
        const extras: string[] = []
        if (exportOpts.includeOutline) {
          for (const f of collectFiles(tree, (p) => /^outline\/.*\.md$/i.test(p))) {
            try {
              extras.push(`## ${f.name.replace(/\.md$/i, '')}\n\n${await readText(f.path)}`)
            } catch { /* skip */ }
          }
        }
        if (exportOpts.includeCharacters) {
          try {
            extras.push(`## 人物卡\n\n${await readText('concept/characters.md')}`)
          } catch { /* skip */ }
        }
        if (extras.length > 0) parts.push(`# 附录\n\n${extras.join('\n\n')}`)
      }
      for (const f of chapters) {
        try {
          const c = await readText(f.path)
          const title = f.name.replace(/\.(md|txt)$/i, '')
          parts.push(c.trim().startsWith('#') ? c : `# ${title}\n\n${c}`)
        } catch { /* skip */ }
      }
      let body = parts.join('\n\n---\n\n')
      if (exportOpts.format === 'txt') body = stripMd(body)
      const blob = new Blob([body], { type: exportOpts.format === 'md' ? 'text/markdown' : 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${rootName}.${exportOpts.format}`
      a.click()
      URL.revokeObjectURL(url)
      exportSummaryRef.current = `已导出 ${chapters.length} 章`
    } catch (e) {
      onError(`导出失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setExporting(false)
    }
  }, [exportOpts, onError])

  // ---- 风险审阅 ----
  const [riskTarget, setRiskTarget] = useState<'active' | 'all'>('active')
  const [risk, setRisk] = useState<RiskScanResult | null>(null)
  const [riskRunning, setRiskRunning] = useState(false)

  const doRisk = useCallback(async () => {
    setRiskRunning(true)
    setRisk(null)
    try {
      const tree = await listWorkspaceTree(6)
      let content = ''
      let path: string | null = activePath
      if (riskTarget === 'active') {
        if (!activePath) {
          onError('没有打开的章节')
          return
        }
        content = await readText(activePath)
      } else {
        const chapters = collectFiles(tree, (p) => /^stories\/.*\.(md|txt)$/i.test(p)).sort((a, b) => a.path.localeCompare(b.path))
        const texts: string[] = []
        for (const f of chapters) {
          try {
            texts.push(await readText(f.path))
          } catch { /* skip */ }
        }
        content = texts.join('\n\n')
        path = null
      }
      const r = await riskScanContent(path, content)
      setRisk(r)
    } catch (e) {
      onError(`风险审阅失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRiskRunning(false)
    }
  }, [activePath, onError, riskTarget])

  const levelBadge = useMemo(
    () => ({ high: '高风险', medium: '中风险', low: '低风险' }) as Record<string, string>,
    [],
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box tools-box" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <nav className="settings-tabs">
            {([['search', '全局搜索'], ['consistency', '一致性'], ['lint', '正文体检'], ['import', '导入切章'], ['export', '全书导出'], ['risk', '风险审阅']] as const).map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          <button className="modal-close" onClick={onClose}>✕</button>
        </header>

        <div className="modal-body">
          {tab === 'search' ? (
            <div className="tools-section">
              <div className="tools-row">
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void doSearch() }}
                  placeholder="搜索正文 / 大纲 / 设定…"
                />
                <button className="tools-run" disabled={searching} onClick={() => void doSearch()}>
                  {searching ? '搜索中…' : '搜索'}
                </button>
              </div>
              {hits ? (
                <div className="search-hits">
                  {hits.length === 0 ? <p className="tools-empty">无结果</p> : null}
                  {hits.map((h, i) => (
                    <div key={`${h.path}:${h.line}:${i}`} className="search-hit" onClick={() => { onOpenFile(h.path); onClose() }}>
                      <span className="search-hit-path">{h.path}:{h.line}</span>
                      <span className="search-hit-text">{h.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'export' ? (
            <div className="tools-section">
              <label><input type="checkbox" checked={exportOpts.includeOutline} onChange={(e) => setExportOpts({ ...exportOpts, includeOutline: e.target.checked })} /> 附录包含大纲（outline/）</label>
              <label><input type="checkbox" checked={exportOpts.includeCharacters} onChange={(e) => setExportOpts({ ...exportOpts, includeCharacters: e.target.checked })} /> 附录包含人物卡（concept/characters.md）</label>
              <label>
                格式：
                <select value={exportOpts.format} onChange={(e) => setExportOpts({ ...exportOpts, format: e.target.value as 'md' | 'txt' })}>
                  <option value="md">Markdown</option>
                  <option value="txt">纯文本（去除标记）</option>
                </select>
              </label>
              <p className="settings-hint">章节按文件名自然顺序合并，章节间以分隔线隔开。</p>
              <button className="settings-save" disabled={exporting} onClick={() => void doExport()}>
                {exporting ? '导出中…' : '导出下载'}
              </button>
            </div>
          ) : null}

          {tab === 'risk' ? (
            <div className="tools-section">
              <div className="tools-row">
                <select value={riskTarget} onChange={(e) => setRiskTarget(e.target.value as 'active' | 'all')}>
                  <option value="active">当前章节</option>
                  <option value="all">全书（所有章节合并）</option>
                </select>
                <button className="tools-run" disabled={riskRunning} onClick={() => void doRisk()}>
                  {riskRunning ? '审阅中…' : '开始审阅'}
                </button>
              </div>
              <p className="settings-hint">调用 AI 对内容做合规与风险检测（需要已配置 Provider API Key）。</p>
              {risk ? (
                <div className="risk-result">
                  <div className={`risk-summary level-${risk.overall_level}`}>
                    {levelBadge[risk.overall_level] ?? risk.overall_level} · {risk.summary}（{risk.scanned_chars} 字）
                  </div>
                  {risk.findings.map((f, i) => (
                    <div key={i} className={`risk-finding level-${f.level}`}>
                      <span className="risk-badge">{levelBadge[f.level] ?? f.level}</span>
                      <div>
                        <div className="risk-excerpt">「{f.excerpt}」</div>
                        {f.suggestion ? <div className="risk-suggestion">建议：{f.suggestion}</div> : null}
                      </div>
                    </div>
                  ))}
                  {risk.findings.length === 0 ? <p className="tools-empty">未发现风险点</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'lint' ? (
            <LintTab activePath={activePath} onError={onError} onOpenFile={onOpenFile} />
          ) : null}

          {tab === 'consistency' ? (
            <ConsistencyTab onError={onError} onOpenFile={onOpenFile} />
          ) : null}

          {tab === 'import' ? (
            <ImportTab
              onError={onError}
              onOpenFile={onOpenFile}
              onImported={() => onRefresh?.()}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
