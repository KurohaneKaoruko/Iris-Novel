import { useCallback, useEffect, useState } from 'react'
import { browseDir, quickLocations, type DirListing, type DirEntryInfo } from '../../api/backend'
import './DirPickerDialog.css'

type DirPickerProps = {
  onPick: (path: string) => void
  onCancel: () => void
}

/**
 * 服务端目录浏览器：逐级点选目录（像 Finder 一样），不是手打路径。
 * 带作品工程标记（is_workspace），快速位置一键跳转。
 */
export function DirPickerDialog({ onPick, onCancel }: DirPickerProps) {
  const [listing, setListing] = useState<DirListing | null>(null)
  const [quick, setQuick] = useState<DirEntryInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const go = useCallback(async (path: string) => {
    setLoading(true)
    setError(null)
    try {
      setListing(await browseDir(path))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void go('')
    void quickLocations().then(setQuick).catch(() => setQuick([]))
  }, [go])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const atHome = listing?.path === listing?.home

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="dirpick glass-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dirpick-head">
          <button
            className="dirpick-nav"
            disabled={!listing?.parent}
            onClick={() => listing?.parent && void go(listing.parent)}
            title="上一级"
          >
            ←
          </button>
          <button className={`dirpick-nav ${atHome ? 'active' : ''}`} onClick={() => void go('')} title="主目录">
            ⌂
          </button>
          <span className="dirpick-path" title={listing?.path}>{listing?.path ?? '…'}</span>
        </div>

        {quick.length > 1 ? (
          <div className="dirpick-quick">
            {quick.map((q) => (
              <button key={q.path} className="dirpick-quick-item" onClick={() => void go(q.path)}>
                {q.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="dirpick-list">
          {loading ? (
            <div className="dirpick-empty">加载中…</div>
          ) : error ? (
            <div className="dirpick-empty dirpick-err">{error}</div>
          ) : (listing?.entries.length ?? 0) === 0 ? (
            <div className="dirpick-empty">此目录下没有子目录</div>
          ) : (
            listing!.entries.map((e) => (
              <button key={e.path} className="dirpick-item" onDoubleClick={() => void go(e.path)} onClick={() => void go(e.path)}>
                <span className="dirpick-icon">📁</span>
                <span className="dirpick-name">{e.name}</span>
                {e.is_workspace ? <span className="dirpick-badge">作品</span> : null}
              </button>
            ))
          )}
        </div>

        <div className="dirpick-foot">
          <span className="dirpick-hint">单击进入目录；当前目录就是要打开的工程</span>
          <span className="dirpick-actions">
            <button className="dirpick-btn" onClick={onCancel}>取消</button>
            <button className="dirpick-btn primary" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
              在此打开工程
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
