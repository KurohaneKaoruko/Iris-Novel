import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listChapters,
  listCharacters,
  listPlotLines,
  loadChapterContents,
  scanCharacterMentions,
  loadMemoryIndices,
  computeWorkStats,
  importChapters,
  type Chapter,
  type WorkStats,
} from '../../api/novel'
import { runConsistencyCheck, type ConsistencyReport } from '../../api/consistency'
import { lintChapter, type LintIssue } from '../../api/lint'
import type { IconName } from '../../components/Icon'
import { splitIntoChapters, importSummary } from '../../api/import'
import { readText } from '../../api/backend'
import { Icon } from '../../components/Icon'
import { PlannerTab } from './PlannerTab'
import { SearchTab } from './SearchTab'
import './ToolsDialog.css'
import './PlannerTab.css'

type TabId = 'import' | 'consistency' | 'lint' | 'stats' | 'planner' | 'search'

const TABS: Array<{ id: TabId; label: string; icon: IconName }> = [
  { id: 'search', label: '检索', icon: 'search' },
  { id: 'planner', label: '任务队列', icon: 'list-checks' },
  { id: 'stats', label: '作品统计', icon: 'chart' },
  { id: 'consistency', label: '一致性检查', icon: 'check-circle' },
  { id: 'lint', label: '正文铁律', icon: 'scale' },
  { id: 'import', label: '导入切章', icon: 'file-input' },
]

type Props = { initialTab?: TabId; onClose: () => void; onOpenFile: (path: string, line?: number) => void }

/** 工具中心：全文检索 / 作品统计 / 一致性检查 / 正文铁律体检 / 存量导入切章 / 任务队列 */
export function ToolsDialog({ initialTab = 'planner', onClose, onOpenFile }: Props) {
  const [tab, setTab] = useState<TabId>(initialTab)
  return (
    <div className="tools-overlay" onClick={onClose}>
      <div className="tools-dialog glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tools-head">
          <div className="tools-tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                <Icon name={t.icon} size={14} />
                {t.label}
              </button>
            ))}
          </div>
          <button className="tools-x" onClick={onClose} title="关闭"><Icon name="x" size={16} /></button>
        </div>
        <div className="tools-body">
          {tab === 'search' ? <SearchTab onOpenFile={onOpenFile} /> : null}
          {tab === 'stats' ? <StatsTab onOpenFile={onOpenFile} /> : null}
          {tab === 'consistency' ? <ConsistencyTab onOpenFile={onOpenFile} /> : null}
          {tab === 'lint' ? <LintTab onOpenFile={onOpenFile} /> : null}
          {tab === 'planner' ? <PlannerTab onOpenFile={onOpenFile} /> : null}
          {tab === 'import' ? <ImportTab /> : null}
        </div>
      </div>
    </div>
  )
}

/* ============ 作品统计 ============ */
function StatsTab({ onOpenFile }: { onOpenFile: (p: string) => void }) {
  const [stats, setStats] = useState<WorkStats | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void (async () => {
      setStats(await computeWorkStats().catch(() => null))
      setChapters((await listChapters().catch(() => []) as Chapter[]).sort((a, b) => a.order - b.order))
    })()
  }, [])

  const doExport = useCallback(async (format: 'md' | 'txt') => {
    setExporting(true)
    try {
      const { exportWork } = await import('../../api/backend')
      const { filename, content } = await exportWork(format)
      // 浏览器下载
      const blob = new Blob([content], { type: format === 'txt' ? 'text/plain' : 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }, [])

  if (!stats) return <div className="tools-loading">统计中…</div>

  return (
    <div className="stats-wrap">
      <div className="stats-export">
        <button className="tools-run" disabled={exporting || stats.chapterCount === 0} onClick={() => void doExport('md')}>
          {exporting ? '导出中…' : <><Icon name="download" size={14} />导出 Markdown</>}
        </button>
        <button className="tools-run" disabled={exporting || stats.chapterCount === 0} onClick={() => void doExport('txt')}>
          {exporting ? '导出中…' : <><Icon name="download" size={14} />导出 TXT</>}
        </button>
        <span className="tools-run-hint">按章序合并 stories/ 全部章节为单文件下载</span>
      </div>
      <div className="stats-grid">
        <Stat big value={stats.totalWords.toLocaleString()} label="总字数" />
        <Stat value={`${stats.chapterCount}`} label="章节" sub={`${stats.completedChapters} 已完结`} />
        <Stat value={`${stats.conceptCount}`} label="设定文档" />
        <Stat value={`${stats.outlineCount}`} label="大纲文档" />
        <Stat value={`${stats.daysWriting}`} label="写作天数" />
        <Stat value={stats.todayWords.toLocaleString()} label="今日字数" />
        {stats.longestChapter ? (
          <Stat value={`${stats.longestChapter.words.toLocaleString()} 字`} label="最长" sub={stats.longestChapter.title} />
        ) : null}
        {stats.shortestChapter ? (
          <Stat value={`${stats.shortestChapter.words.toLocaleString()} 字`} label="最短" sub={stats.shortestChapter.title} />
        ) : null}
      </div>

      {chapters.length > 0 ? (
        <div className="stats-chapters">
          <div className="tools-section-title">章节列表</div>
          <div className="stats-chapter-list">
            {chapters.map((c) => (
              <button key={c.id} className="stats-chapter" onClick={() => onOpenFile(c.filePath)}>
                <span className="sc-order">#{c.order + 1}</span>
                <span className="sc-title">{c.title}</span>
                <span className={`sc-status ${c.status}`}>{statusLabel(c.status)}</span>
                <span className="sc-words">{c.wordCount.toLocaleString()} 字</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="tools-hint">还没有章节元数据。在 stories/ 写入文件后，Agent 或「导入切章」会建立元数据。</div>
      )}
    </div>
  )
}

function statusLabel(s: Chapter['status']): string {
  return s === 'completed' ? '完结' : s === 'revising' ? '修稿' : '草稿'
}

function Stat({ value, label, sub, big }: { value: string; label: string; sub?: string; big?: boolean }) {
  return (
    <div className={`stat-card ${big ? 'big' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  )
}

/* ============ 一致性检查 ============ */
function ConsistencyTab({ onOpenFile }: { onOpenFile: (p: string) => void }) {
  const [report, setReport] = useState<ConsistencyReport | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')

  const run = useCallback(async () => {
    setRunning(true)
    setErr('')
    try {
      const [chapters, meta, characters, plotLines, indices] = await Promise.all([
        loadChapterContents(),
        listChapters(),
        listCharacters(),
        listPlotLines(),
        loadMemoryIndices(),
      ])
      const names = characters.map((c) => c.name)
      const mentions = scanCharacterMentions(chapters, names)
      const foreshadowIndex = indices.find((i) => i.path.includes('foreshadow'))?.content ?? ''
      setReport(runConsistencyCheck({ chapters, chapterMeta: meta, characters, mentions, plotLines, foreshadowIndex }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [])

  return (
    <div>
      <div className="tools-runbar">
        <button className="tools-run" disabled={running} onClick={() => void run()}>
          {running ? '检查中…' : '开始检查'}
        </button>
        <span className="tools-run-hint">四维交叉核对：人物断档 / 情节线推进 / 伏笔回收 / 章节健康</span>
      </div>
      {err ? <div className="tools-err">{err}</div> : null}
      {report ? (
        <>
          <div className="consistency-meta">
            {report.chapterCount} 章 · {report.characterCount} 人物 · {report.plotLineCount} 情节线 · {report.issues.length} 个问题
          </div>
          {report.issues.length === 0 ? (
            <div className="tools-ok"><Icon name="check-circle" size={14} /> 未发现问题</div>
          ) : (
            <div className="issue-list">
              {report.issues.map((it, i) => (
                <div key={i} className={`issue-card ${it.severity}`}>
                  <div className="issue-head">
                    <span className={`issue-sev ${it.severity}`}>{sevLabel(it.severity)}</span>
                    <span className="issue-dim">{dimLabel(it.dimension)}</span>
                  </div>
                  <div className="issue-msg">{it.message}</div>
                  {it.detail ? <div className="issue-detail">{it.detail}</div> : null}
                  {it.jumpPath ? (
                    <button className="issue-jump" onClick={() => onOpenFile(it.jumpPath!)}>查看 {it.jumpPath} →</button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function sevLabel(s: string): string {
  return s === 'high' || s === 'error' ? '严重' : s === 'medium' || s === 'warn' ? '警告' : '提示'
}
function dimLabel(d: string): string {
  return d === 'character' ? '人物' : d === 'plotline' ? '情节线' : d === 'foreshadow' ? '伏笔' : '章节'
}

/* ============ 正文铁律体检 ============ */
function LintTab({ onOpenFile }: { onOpenFile: (p: string) => void }) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selected, setSelected] = useState<string>('')
  const [issues, setIssues] = useState<LintIssue[] | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    void listChapters().then((cs) => {
      const sorted = cs.sort((a, b) => a.order - b.order)
      setChapters(sorted)
      if (sorted.length > 0) setSelected(sorted[0].filePath)
    }).catch(() => {})
  }, [])

  const run = useCallback(async () => {
    if (!selected) return
    setRunning(true)
    try {
      const content = await readText(selected)
      setIssues(lintChapter(content))
    } catch {
      setIssues([])
    } finally {
      setRunning(false)
    }
  }, [selected])

  return (
    <div>
      <div className="tools-runbar">
        <select className="tools-select" value={selected} onChange={(e) => { setSelected(e.target.value); setIssues(null) }}>
          {chapters.length === 0 ? <option value="">（无章节元数据）</option> : null}
          {chapters.map((c) => (
            <option key={c.id} value={c.filePath}>#{c.order + 1} {c.title}</option>
          ))}
        </select>
        <button className="tools-run" disabled={!selected || running} onClick={() => void run()}>
          {running ? '体检中…' : '开始体检'}
        </button>
      </div>
      {issues ? (
        issues.length === 0 ? (
          <div className="tools-ok"><Icon name="check-circle" size={14} /> 本章通过全部铁律</div>
        ) : (
          <div className="issue-list">
            {issues.map((it, i) => (
              <div key={i} className={`issue-card ${it.level}`}>
                <div className="issue-head">
                  <span className={`issue-sev ${it.level}`}>{sevLabel(it.level)}</span>
                  <span className="issue-dim">{it.rule}</span>
                  <span className="issue-count">行 {it.line}</span>
                </div>
                <div className="issue-msg">{it.snippet}</div>
                <div className="issue-detail">{it.advice}</div>
                <button className="issue-jump" onClick={() => onOpenFile(selected)}>打开本章 →</button>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  )
}

/* ============ 导入切章 ============ */
function ImportTab() {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ReturnType<typeof splitIntoChapters>>([])
  const [done, setDone] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const parse = useCallback((t: string) => {
    setText(t)
    setDone(null)
    setParsed(t.trim() ? splitIntoChapters(t) : [])
  }, [])

  const onFile = useCallback(async (f: File) => {
    try {
      const t = await f.text()
      parse(t)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [parse])

  const doImport = useCallback(async () => {
    if (parsed.length === 0 || busy) return
    setBusy(true)
    setErr('')
    try {
      const existing = await listChapters()
      const startOrder = existing.length ? Math.max(...existing.map((c) => c.order)) + 1 : 0
      const paths = await importChapters(parsed, startOrder)
      setDone(paths)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, parsed])

  const summary = parsed.length > 0 ? importSummary(parsed) : null

  return (
    <div>
      {done ? (
        <div className="tools-ok">
          <Icon name="check-circle" size={14} /> 已导入 {done.length} 章到 stories/：{done.slice(0, 3).join('、')}{done.length > 3 ? '…' : ''}
        </div>
      ) : null}
      <div className="import-row">
        <textarea
          className="import-textarea"
          value={text}
          placeholder={'粘贴全文，或选择 txt/md 文件。按「第X章 / Chapter X / 数字序号」智能切分章节…'}
          onChange={(e) => parse(e.target.value)}
        />
        <div className="import-side">
          <button className="tools-run" onClick={() => fileRef.current?.click()}>选择文件…</button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f) }}
          />
          {summary ? (
            <div className="import-summary">
              <div><b>{summary.count}</b> 章</div>
              <div>共 {summary.words.toLocaleString()} 字</div>
              <div>最短 {summary.min} 字 / 最长 {summary.max} 字</div>
            </div>
          ) : null}
          <button className="tools-run primary" disabled={parsed.length === 0 || busy} onClick={() => void doImport()}>
            {busy ? '导入中…' : `导入 ${parsed.length || ''} 章`}
          </button>
          {err ? <div className="tools-err">{err}</div> : null}
        </div>
      </div>
      {parsed.length > 0 ? (
        <div className="import-preview">
          <div className="tools-section-title">预览（前 20 章）</div>
          {parsed.slice(0, 20).map((c, i) => (
            <div key={i} className="import-chapter">
              <span className="ic-idx">{i + 1}</span>
              <span className="ic-title">{c.title}</span>
              <span className="ic-words">{c.content.replace(/\s/g, '').length} 字</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
