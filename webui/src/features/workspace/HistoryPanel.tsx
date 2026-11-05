import { useCallback, useEffect, useState } from 'react'
import {
  listHistoryEntries, createHistorySnapshot, readHistorySnapshot, restoreHistorySnapshot,
  type HistoryEntry,
} from '../../api/backend'
import './HistoryPanel.css'

type Props = {
  /** 当前活动文件（快照目标默认值） */
  activePath: string | null
  onError: (msg: string | null) => void
  /** 恢复快照后通知外部刷新 */
  onRestored?: () => void
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 版本快照面板：按文件分组查看、创建快照、预览、一键恢复 */
export function HistoryPanel({ activePath, onError, onRestored }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [groupPath, setGroupPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const list = await listHistoryEntries(200)
      setEntries(list)
      setLoaded(true)
    } catch (e) {
      onError(`加载历史失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [onError])

  useEffect(() => {
    if (activePath) setGroupPath(activePath)
    void reload()
  }, [activePath, reload])

  const snapshot = async () => {
    const target = groupPath ?? activePath
    if (!target) {
      onError('没有可快照的文件（先打开一个文档）')
      return
    }
    const label = window.prompt('快照标签（可选，如「改稿前」）') || undefined
    setBusy(true)
    try {
      await createHistorySnapshot(target, label)
      await reload()
    } catch (e) {
      onError(`创建快照失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const openPreview = async (id: string) => {
    if (preview?.id === id) {
      setPreview(null)
      return
    }
    try {
      const content = await readHistorySnapshot(id)
      setPreview({ id, content: content.slice(0, 2000) })
    } catch (e) {
      onError(`读取快照失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const restore = async (entry: HistoryEntry) => {
    if (!window.confirm(`将「${entry.file_path}」恢复到此快照（${fmtTime(entry.created_at)}），当前内容将被覆盖。确认？`)) return
    setBusy(true)
    try {
      await restoreHistorySnapshot(entry.id)
      onError(null)
      onRestored?.()
    } catch (e) {
      onError(`恢复失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  // 按文件分组
  const groups = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const arr = groups.get(e.file_path) ?? []
    arr.push(e)
    groups.set(e.file_path, arr)
  }
  const shown = groupPath ? (groups.get(groupPath) ?? []) : [...groups.keys()].flatMap((k) => groups.get(k) ?? [])

  return (
    <div className="panel-section history-panel">
      <div className="panel-head">
        <span>版本历史</span>
        <span className="history-head-actions">
          <select value={groupPath ?? ''} onChange={(e) => setGroupPath(e.target.value || null)} title="按文件过滤">
            <option value="">全部文件</option>
            {[...groups.keys()].map((p) => (
              <option key={p} value={p}>{p.split('/').pop()}</option>
            ))}
          </select>
          <button disabled={busy} onClick={() => void snapshot()} title="为当前文件创建快照">📸</button>
        </span>
      </div>

      {!loaded ? (
        <div className="panel-empty">加载中…</div>
      ) : shown.length === 0 ? (
        <div className="panel-empty">暂无快照。编辑保存后会自动记录，也可手动 📸 创建。</div>
      ) : (
        shown.map((e) => (
          <div key={e.id} className="history-card">
            <div className="history-row" onClick={() => void openPreview(e.id)}>
              <span className="history-time">{fmtTime(e.created_at)}</span>
              <span className="history-meta">
                {e.word_count} 字{e.reason ? ` · ${e.reason}` : ''}
              </span>
              <span className="file-actions">
                <button title="恢复此版本" onClick={(ev) => { ev.stopPropagation(); void restore(e) }}>⏪</button>
              </span>
            </div>
            {preview?.id === e.id ? <pre className="history-preview">{preview.content}</pre> : null}
          </div>
        ))
      )}
    </div>
  )
}
