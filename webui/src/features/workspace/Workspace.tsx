import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry } from '../../api/backend'
import { createFile, deleteEntry, listWorkspaceTree, readText, renameEntry, writeText } from '../../api/backend'
import { useWork } from '../../state/WorkContext'
import { useChat } from '../../hooks/useChat'
import { EditorPane } from './EditorPane'
import { ChatPanel } from './ChatPanel'
import './Workspace.css'

function collectMarkdownFiles(entry: FsEntry): FsEntry[] {
  const out: FsEntry[] = []
  const walk = (e: FsEntry) => {
    if (e.kind === 'file' && /\.(md|txt)$/i.test(e.name)) out.push(e)
    for (const c of e.children ?? []) walk(c)
  }
  walk(entry)
  return out
}

function groupByDir(files: FsEntry[]): Array<{ dir: string; files: FsEntry[] }> {
  const map = new Map<string, FsEntry[]>()
  for (const f of files) {
    const idx = f.path.lastIndexOf('/')
    const dir = idx >= 0 ? f.path.slice(0, idx) : ''
    const list = map.get(dir) ?? []
    list.push(f)
    map.set(dir, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, fs]) => ({ dir, files: fs }))
}

type ChatContextOpts = {
  assistantId: string | null
}

export function Workspace({ onExit }: { onExit: () => void }) {
  const { workRoot, activePath, setActivePath, error, setError } = useWork()
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [assistantId, setAssistantId] = useState<string | null>(null)
  const chat = useChat()
  const chatContextRef = useRef<ChatContextOpts>({ assistantId: null })

  const refreshTree = useCallback(async () => {
    if (!workRoot) return
    try {
      setTree(await listWorkspaceTree(6))
    } catch (e) {
      setError(`加载目录失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [setError, workRoot])

  useEffect(() => {
    void refreshTree()
  }, [refreshTree])

  const files = useMemo(() => (tree ? collectMarkdownFiles(tree) : []), [tree])
  const groups = useMemo(() => groupByDir(files), [files])

  // 自动打开第一章
  useEffect(() => {
    if (!activePath && files.length > 0) {
      const first = [...files].sort((a, b) => a.path.localeCompare(b.path))[0]
      setActivePath(first.path)
    }
  }, [activePath, files, setActivePath])

  const handleSave = useCallback(
    async (content: string) => {
      if (!activePath) return
      setSaving(true)
      try {
        await writeText(activePath, content)
        setDirty(false)
      } catch (e) {
        setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setSaving(false)
      }
    },
    [activePath, setError],
  )

  const handleCreateFile = useCallback(async () => {
    const name = window.prompt('新文件名（相对 stories/，如 chapter-0002.md）')
    if (!name) return
    const rel = name.startsWith('stories/') ? name : `stories/${name}`
    try {
      await createFile(rel)
      await refreshTree()
      setActivePath(rel)
    } catch (e) {
      setError(`创建失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [refreshTree, setActivePath, setError])

  const handleDelete = useCallback(
    async (path: string) => {
      if (!window.confirm(`确认删除 ${path}？`)) return
      try {
        await deleteEntry(path)
        if (activePath === path) setActivePath(null)
        await refreshTree()
      } catch (e) {
        setError(`删除失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [activePath, refreshTree, setActivePath, setError],
  )

  const handleRename = useCallback(
    async (path: string) => {
      const newName = window.prompt('新名称', path.split('/').pop() ?? path)
      if (!newName) return
      const idx = path.lastIndexOf('/')
      const toPath = idx >= 0 ? `${path.slice(0, idx)}/${newName}` : newName
      try {
        await renameEntry(path, toPath)
        if (activePath === path) setActivePath(toPath)
        await refreshTree()
      } catch (e) {
        setError(`重命名失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [activePath, refreshTree, setActivePath, setError],
  )

  const workName = workRoot?.split(/[/\\]/).filter(Boolean).pop() ?? ''

  return (
    <div className="workspace">
      <header className="workspace-header">
        <button className="header-btn" onClick={onExit} title="返回书架">
          ← 书架
        </button>
        <span className="work-name">{workName}</span>
        <span className="header-spacer" />
        {error ? (
          <span className="header-error" role="alert" onClick={() => setError(null)}>
            {error} ✕
          </span>
        ) : null}
        <span className={`save-state ${dirty ? 'dirty' : ''}`}>
          {saving ? '保存中…' : dirty ? '未保存' : '已保存'}
        </span>
      </header>

      <div className="workspace-body">
        <aside className="chapter-sidebar">
          <div className="sidebar-head">
            <span>章节</span>
            <button onClick={() => void handleCreateFile()} title="新建文件">
              ＋
            </button>
          </div>
          <div className="sidebar-list">
            {groups.map(({ dir, files: fs }) => (
              <div key={dir} className="dir-group">
                <div className="dir-name">{dir || '根目录'}</div>
                {fs.map((f) => (
                  <div
                    key={f.path}
                    className={`file-item ${activePath === f.path ? 'active' : ''}`}
                    onClick={() => setActivePath(f.path)}
                  >
                    <span className="file-name">{f.name}</span>
                    <span className="file-actions">
                      <button
                        title="重命名"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleRename(f.path)
                        }}
                      >
                        ✎
                      </button>
                      <button
                        title="删除"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleDelete(f.path)
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {files.length === 0 ? <div className="sidebar-empty">暂无文档</div> : null}
          </div>
        </aside>

        <main className="editor-main">
          {activePath ? (
            <EditorPane
              key={activePath}
              path={activePath}
              onContentChanged={() => setDirty(true)}
              onSaved={() => setDirty(false)}
              saving={saving}
              onSave={handleSave}
              onError={setError}
            />
          ) : (
            <div className="editor-empty">
              <p>从左侧选择或新建一个文档</p>
            </div>
          )}
        </main>

        <ChatPanel
          chat={chat}
          assistantId={assistantId}
          onAssistantChange={setAssistantId}
          contextRef={chatContextRef}
          activePath={activePath}
        />
      </div>
    </div>
  )
}

// 供 EditorPane 惰性读取内容时复用
export { readText }
