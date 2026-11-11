import { useCallback, useState } from 'react'
import { useProject } from '../../state/ProjectContext'
import { useTheme } from '../../state/ThemeContext'
import { createNovelWork } from '../../api/backend'
import { DirPickerDialog } from './DirPickerDialog'
import './LaunchScreen.css'

/**
 * 启动页：一键打开目录（服务端目录浏览器点选）/ 最近工程 / 新建标准工程。
 */
export function LaunchScreen() {
  const { state, openDir } = useProject()
  const { theme, toggleTheme } = useTheme()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const recent = [
    ...(state?.external_projects ?? []),
    ...(state?.default_projects ?? []),
  ].sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))

  const handleCreate = useCallback(async () => {
    const name = newName.trim()
    if (!name || busy) return
    setBusy(true)
    try {
      const p = await createNovelWork(name)
      setCreating(false)
      setNewName('')
      await openDir(p.path)
    } catch {
      /* openDir 已 toast */
    } finally {
      setBusy(false)
    }
  }, [busy, newName, openDir])

  return (
    <div className="launch">
      <header className="launch-head">
        <h1>Iris-Creation</h1>
        <span className="launch-tagline">本地目录 · 全 Markdown · Agent 工作台</span>
        <button className="launch-theme" onClick={toggleTheme} title="切换主题">
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>
      </header>

      <main className="launch-main">
        <button className="launch-open glass-panel" onClick={() => setPickerOpen(true)}>
          <span className="launch-open-icon">📂</span>
          <span className="launch-open-title">打开目录…</span>
          <span className="launch-open-desc">选择任意文件夹作为作品工程，所有内容都是 Markdown</span>
        </button>

        <button className="launch-new" onClick={() => setCreating(true)}>
          ＋ 新建作品工程
        </button>

        {creating ? (
          <div className="launch-create glass-panel">
            <input
              value={newName}
              placeholder="作品名，如「星海遗歌」"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') setCreating(false)
              }}
              autoFocus
            />
            <button className="launch-create-go" disabled={!newName.trim() || busy} onClick={() => void handleCreate()}>
              创建并打开
            </button>
          </div>
        ) : null}

        {recent.length > 0 ? (
          <section className="launch-recent">
            <h3>最近打开</h3>
            <div className="launch-recent-list">
              {recent.slice(0, 8).map((p) => (
                <button key={p.path} className="launch-recent-item glass-panel" onClick={() => void openDir(p.path)}>
                  <span className="lr-name">{p.name}</span>
                  <span className="lr-meta">
                    {p.chapters_count} 章 · {p.total_words.toLocaleString()} 字
                  </span>
                  <span className="lr-path">{p.path}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {pickerOpen ? (
        <DirPickerDialog
          onPick={(path) => {
            setPickerOpen(false)
            void openDir(path)
          }}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}
