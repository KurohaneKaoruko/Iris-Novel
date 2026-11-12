import { useCallback, useEffect, useState } from 'react'
import { useProject } from '../../state/ProjectContext'
import { useTheme } from '../../state/ThemeContext'
import { createNovelWork, forgetWork } from '../../api/backend'
import { DirPickerDialog } from './DirPickerDialog'
import { Icon } from '../../components/Icon'
import './LaunchScreen.css'

/**
 * 启动页：继续上次工程 / 打开目录（服务端目录浏览器点选）/ 最近工程 / 新建标准工程。
 */
export function LaunchScreen() {
  const { state, openDir, refresh } = useProject()
  const { theme, toggleTheme } = useTheme()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const recent = [
    ...(state?.external_projects ?? []),
    ...(state?.default_projects ?? []),
  ].sort((a, b) => (b.last_opened_at ?? b.updated_at ?? 0) - (a.last_opened_at ?? a.updated_at ?? 0))

  const lastPath = state?.last_workspace ?? null
  const lastItem = lastPath ? recent.find((p) => p.path === lastPath) : undefined
  const lastName = lastPath?.split(/[/\\]/).filter(Boolean).pop() ?? ''

  // 「继续上次工程」卡片就绪动画
  const [lastReady, setLastReady] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLastReady(true), 60)
    return () => window.clearTimeout(t)
  }, [])

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
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
      </header>

      <main className="launch-main">
        {lastPath ? (
          <button
            className={`launch-resume glass-panel ${lastReady ? 'in' : ''}`}
            onClick={() => void openDir(lastPath)}
          >
            <span className="launch-resume-label">继续上次</span>
            <span className="launch-resume-name">{lastName}</span>
            <span className="launch-resume-meta">
              {lastItem ? `${lastItem.chapters_count} 章 · ${lastItem.total_words.toLocaleString()} 字 · ` : ''}
              {lastPath}
            </span>
            <span className="launch-resume-go"><Icon name="arrow-right" size={20} /></span>
          </button>
        ) : null}

        <button className="launch-open glass-panel" onClick={() => setPickerOpen(true)}>
          <span className="launch-open-icon"><Icon name="folder-open" size={44} strokeWidth={1.5} /></span>
          <span className="launch-open-title">打开目录…</span>
          <span className="launch-open-desc">选择任意文件夹作为作品工程，所有内容都是 Markdown</span>
        </button>

        <button className="launch-new" onClick={() => setCreating(true)}>
          <Icon name="plus" size={15} />
          新建作品工程
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
              {recent
                .filter((p, i, arr) => arr.findIndex((x) => x.path === p.path) === i)
                .slice(0, 8)
                .map((p) => (
                  <div key={p.path} className="launch-recent-item glass-panel">
                    <button className="lr-open" onClick={() => void openDir(p.path)}>
                      <span className="lr-name">{p.name}</span>
                      <span className="lr-meta">
                        {p.chapters_count} 章 · {p.total_words.toLocaleString()} 字
                      </span>
                      <span className="lr-path">{p.path}</span>
                    </button>
                    <button
                      className="lr-remove"
                      title="从最近列表移除（不删除文件）"
                      onClick={() => void forgetWork(p.path).then(() => refresh())}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
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
