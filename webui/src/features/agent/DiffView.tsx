import { useCallback, useEffect, useMemo, useState } from 'react'
import { listHistoryEntries, readHistorySnapshot, restoreHistorySnapshot, type HistoryEntry } from '../../api/backend'
import { diffLines, diffStats, collapseDiff, type DiffLine } from '../../api/diff'
import { Icon } from '../../components/Icon'

type Props = {
  path: string
  /** 当前磁盘上的内容（diff 的「新」侧） */
  currentContent: string
  onClose: () => void
  /** 恢复历史后刷新预览 */
  onRestored: () => void
}

/** 文件变更视图：历史快照列表 + 旧版本 vs 当前 diff（行级，可恢复） */
export function DiffView({ path, currentContent, onClose, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [selected, setSelected] = useState<HistoryEntry | null>(null)
  const [oldContent, setOldContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const all = await listHistoryEntries(200)
        setEntries(all.filter((e) => e.file_path === path))
      } catch {
        setEntries([])
      } finally {
        setLoading(false)
      }
    })()
  }, [path])

  const pick = useCallback(async (e: HistoryEntry) => {
    setSelected(e)
    setOldContent(null)
    try {
      setOldContent(await readHistorySnapshot(e.id))
    } catch {
      setOldContent('')
    }
  }, [])

  const restore = useCallback(async () => {
    if (!selected) return
    await restoreHistorySnapshot(selected.id)
    onRestored()
    onClose()
  }, [selected, onRestored, onClose])

  const diff = useMemo(() => (oldContent === null ? null : diffLines(oldContent, currentContent)), [oldContent, currentContent])
  const collapsed = useMemo(() => (diff ? collapseDiff(diff, 3) : null), [diff])
  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff])

  return (
    <div className="diffv">
      <div className="diffv-head">
        <button className="agw-btn" onClick={onClose}><Icon name="arrow-left" size={14} /> 返回预览</button>
        <span className="diffv-path">{path}</span>
        {selected ? (
          <button className="agw-btn" onClick={() => { setSelected(null); setOldContent(null) }}>变更列表</button>
        ) : null}
      </div>

      {!selected ? (
        <div className="diffv-list">
          {loading ? (
            <div className="agw-empty">加载中…</div>
          ) : entries.length === 0 ? (
            <div className="agw-empty">此文件还没有变更记录。Agent 或编辑器覆盖写入时自动留存旧版本。</div>
          ) : (
            entries.map((e) => (
              <button key={e.id} className="diffv-entry" onClick={() => void pick(e)}>
                <span className="de-time">{formatTime(e.created_at)}</span>
                <span className="de-reason">{e.reason || '修改'}</span>
                <span className="de-words">{e.word_count.toLocaleString()} 字</span>
                <span className="de-arrow"><Icon name="chevron-right" size={14} /></span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="diffv-body">
          <div className="diffv-meta">
            <span>{formatTime(selected.created_at)} 版本 vs 当前</span>
            {stats ? (
              <span className="diffv-stats">
                <span className="ds-add">+{stats.added}</span>
                <span className="ds-del">−{stats.removed}</span>
              </span>
            ) : null}
            <button className="agw-btn" onClick={() => void restore()} title="把文件恢复到此版本">
              恢复此版本
            </button>
          </div>
          {oldContent === null ? (
            <div className="agw-empty">载入中…</div>
          ) : (
            <div className="diffv-lines">
              {collapsed?.map((l, i) => {
                if (l.type === 'gap') {
                  return (
                    <div key={i} className="dl gap">… {l.count} 行相同 …</div>
                  )
                }
                const dl = l as DiffLine
                return (
                  <div key={i} className={`dl ${dl.type}`}>
                    <span className="dl-no">{dl.oldNo ?? dl.newNo ?? ''}</span>
                    <span className="dl-sign">{dl.type === 'add' ? '+' : dl.type === 'del' ? '−' : ' '}</span>
                    <span className="dl-text">{dl.text || ' '}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '—'
  const d = new Date(ts > 10_000_000_000 ? ts : ts * 1000)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
