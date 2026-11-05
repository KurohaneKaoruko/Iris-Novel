/** 导入切章 tab：粘贴整本文本 → 智能切分 → 预览 → 批量建章 */
import { useMemo, useState } from 'react'
import { importChapters, listChapters } from '../../api/novel'
import { importSummary, splitIntoChapters, type ParsedChapter } from '../../api/import'

type Props = {
  onError: (msg: string | null) => void
  onOpenFile: (path: string) => void
  /** 导入成功后外部刷新（章节列表/统计） */
  onImported: () => void
}

export function ImportTab({ onError, onOpenFile, onImported }: Props) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ParsedChapter[] | null>(null)
  const [startOrder, setStartOrder] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)

  const summary = useMemo(() => (parsed ? importSummary(parsed) : null), [parsed])

  const doSplit = () => {
    if (!text.trim()) {
      onError('先粘贴或输入正文')
      return
    }
    const chapters = splitIntoChapters(text)
    setParsed(chapters)
    setResult(null)
  }

  const doImport = async () => {
    if (!parsed || parsed.length === 0) return
    setImporting(true)
    onError(null)
    try {
      const existing = await listChapters()
      const next = startOrder ?? existing.length + 1
      const paths = await importChapters(parsed, next)
      setResult(paths)
      onImported()
    } catch (e) {
      onError(`导入失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="tools-section">
      <p className="settings-hint">
        粘贴整本/多章文本，按「第X章 / 第X回 / Chapter X / 数字序号」智能切分为章节，确认后批量建入 stories/。
      </p>
      <textarea
        className="import-textarea"
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'第一章 初入江湖\n少年背剑出门。\n\n第二章 雨夜\n雨下了整夜。'}
        spellCheck={false}
      />
      <div className="tools-row">
        <label className="import-start">
          起始章序 <input type="number" min={1} value={startOrder ?? ''} placeholder="追加在末尾" onChange={(e) => setStartOrder(e.target.value ? Number(e.target.value) : null)} />
        </label>
        <button className="tools-run" onClick={doSplit}>切分预览</button>
      </div>

      {summary ? (
        <div className="import-result">
          <div className="import-summary">
            切出 <b>{summary.count}</b> 章 · 共 {summary.words.toLocaleString()} 字（单章 {summary.min}–{summary.max} 字）
            {parsed?.length === 1 && parsed[0].title === '导入文本' ? ' · 未识别到章节标题，将作为单章导入' : ''}
          </div>
          <div className="import-list">
            {parsed!.slice(0, 30).map((c, i) => (
              <div key={i} className="import-row">
                <span className="import-idx">{String(i + 1).padStart(2, '0')}</span>
                <span className="import-title">{c.title}</span>
                <span className="import-words">{c.content.replace(/\s/g, '').length} 字</span>
                <span className="import-peek">{c.content.trim().slice(0, 30)}</span>
              </div>
            ))}
            {parsed!.length > 30 ? <div className="import-more">…还有 {parsed!.length - 30} 章</div> : null}
          </div>
          <button className="tools-run" disabled={importing || parsed!.length === 0} onClick={() => void doImport()}>
            {importing ? '导入中…' : `导入 ${parsed!.length} 章到 stories/`}
          </button>
          {result ? (
            <div className="import-done">
              ✓ 已导入 {result.length} 章。<button onClick={() => onOpenFile(result[0])}>打开第一章</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
