import { useCallback, useEffect, useState } from 'react'
import type { BookshelfState, ProjectItem } from '../../api/backend'
import { createNovelWork, getBookshelfState, setWorkspace, updateWorkDescription } from '../../api/backend'
import { useWork } from '../../state/WorkContext'
import './Bookshelf.css'

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--'
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

export function Bookshelf({ onOpen }: { onOpen: (root: string) => void }) {
  const { setWorkRoot } = useWork()
  const [state, setState] = useState<BookshelfState | null>(null)
  const [selected, setSelected] = useState<ProjectItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descInput, setDescInput] = useState('')

  const refresh = useCallback(async () => {
    try {
      const s = await getBookshelfState()
      setState(s)
    } catch (e) {
      // 书架加载失败在页内呈现
      console.error('加载书架失败', e)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openWork = useCallback(
    async (path: string) => {
      setBusy(true)
      try {
        await setWorkspace(path)
        setWorkRoot(path)
        onOpen(path)
      } catch (e) {
        alert(`打开失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setBusy(false)
      }
    },
    [onOpen, setWorkRoot],
  )

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const project = await createNovelWork(name, newDesc.trim() || undefined)
      setCreating(false)
      setNewName('')
      setNewDesc('')
      await refresh()
      await openWork(project.path)
    } catch (e) {
      alert(`创建失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, newDesc, newName, openWork, refresh])

  const handleSaveDesc = useCallback(async () => {
    if (!selected) return
    setBusy(true)
    try {
      await updateWorkDescription(selected.path, descInput.trim())
      setEditingDesc(false)
      await refresh()
    } catch (e) {
      alert(`保存简介失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }, [descInput, refresh, selected])

  return (
    <div className="bookshelf">
      <header className="bookshelf-header">
        <h1>Iris-Creation</h1>
        <p>AI 小说写作工作台 · Web 版</p>
      </header>

      <div className="bookshelf-body">
        <section className="bookshelf-list" aria-label="书架">
          {(state?.default_projects ?? []).map((p) => (
            <button
              key={p.path}
              className={`book-card ${selected?.path === p.path ? 'selected' : ''}`}
              onClick={() => {
                setSelected(p)
                setEditingDesc(false)
              }}
              onDoubleClick={() => void openWork(p.path)}
            >
              <span className="book-title">{p.name}</span>
              {p.description ? <span className="book-desc">{p.description}</span> : null}
              <span className="book-meta">
                {p.chapters_count} 章 · {p.total_words} 字 · {formatTime(p.updated_at)}
              </span>
            </button>
          ))}
          <button className="book-card create-card" onClick={() => setCreating(true)}>
            <span className="book-title">＋ 创建新作品</span>
            <span className="book-desc">将自动初始化 stories / outline / concept / .novel</span>
          </button>
        </section>

        <aside className="bookshelf-detail">
          {creating ? (
            <div className="detail-form">
              <h2>创建新作品</h2>
              <label>
                书名
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="必填" autoFocus />
              </label>
              <label>
                简介
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="一句话介绍（可选）"
                  rows={4}
                />
              </label>
              <div className="form-actions">
                <button disabled={busy || !newName.trim()} onClick={() => void handleCreate()}>
                  创建并打开
                </button>
                <button onClick={() => setCreating(false)}>取消</button>
              </div>
            </div>
          ) : selected ? (
            <div className="detail-info">
              <h2>{selected.name}</h2>
              {editingDesc ? (
                <div className="desc-edit">
                  <textarea value={descInput} onChange={(e) => setDescInput(e.target.value)} rows={3} autoFocus />
                  <div className="form-actions">
                    <button disabled={busy} onClick={() => void handleSaveDesc()}>
                      保存
                    </button>
                    <button onClick={() => setEditingDesc(false)}>取消</button>
                  </div>
                </div>
              ) : (
                <p className="detail-desc" onDoubleClick={() => {
                  setDescInput(selected.description ?? '')
                  setEditingDesc(true)
                }}>
                  {selected.description || '（双击编辑简介）'}
                </p>
              )}
              <dl>
                <dt>章节</dt>
                <dd>{selected.chapters_count}</dd>
                <dt>总字数</dt>
                <dd>{selected.total_words}</dd>
                <dt>更新时间</dt>
                <dd>{formatTime(selected.updated_at)}</dd>
                <dt>路径</dt>
                <dd className="detail-path">{selected.path}</dd>
              </dl>
              <button className="open-btn" disabled={busy} onClick={() => void openWork(selected.path)}>
                打开作品 →
              </button>
            </div>
          ) : (
            <div className="detail-empty">
              <p>选择一部作品，或创建新作品</p>
              <p className="hint">双击卡片可直接打开</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
