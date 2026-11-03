import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry } from '../../api/backend'
import { createFile, createDir, deleteEntry, listWorkspaceTree, readText, renameEntry, writeText } from '../../api/backend'
import {
  computeWorkStats, createChapterFile, listChapters, listCharacters, listConceptFiles, listPlotLines,
  loadMemoryIndices, markChapterStatus, saveMemoryIndex, saveCharacters, savePlotLines, syncChapterContent,
  type Chapter, type Character, type DocFile, type MemoryIndex, type PlotLine, type WorkStats,
} from '../../api/novel'
import { useWork } from '../../state/WorkContext'
import { useChat } from '../../hooks/useChat'
import { EditorPane } from './EditorPane'
import { ChatPanel } from './ChatPanel'
import { CharactersPanel } from './CharactersPanel'
import { PlotLinesPanel } from './PlotLinesPanel'
import { MemoryPanel } from './MemoryPanel'
import { StatsPanel } from './StatsPanel'
import { AiWriteBar } from './AiWriteBar'
import { SettingsModal } from './SettingsModal'
import { ToolsModal } from './ToolsModal'
import './Workspace.css'

type SideTab = 'chapters' | 'characters' | 'plotlines' | 'docs' | 'memory'

const SIDE_TABS: Array<{ id: SideTab; label: string }> = [
  { id: 'chapters', label: '章节' },
  { id: 'characters', label: '人物' },
  { id: 'plotlines', label: '情节线' },
  { id: 'docs', label: '资料' },
  { id: 'memory', label: '记忆' },
]

function collectFiles(entry: FsEntry, test: (p: string) => boolean): FsEntry[] {
  const out: FsEntry[] = []
  const walk = (e: FsEntry) => {
    if (e.kind === 'file' && test(e.path)) out.push(e)
    for (const c of e.children ?? []) walk(c)
  }
  walk(entry)
  return out
}

export function Workspace({ onExit }: { onExit: () => void }) {
  const { workRoot, activePath, setActivePath, error, setError, writingSettings } = useWork()
  const [sideTab, setSideTab] = useState<SideTab>('chapters')
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [plotLines, setPlotLines] = useState<PlotLine[]>([])
  const [memory, setMemory] = useState<MemoryIndex[]>([])
  const [docs, setDocs] = useState<DocFile[]>([])
  const [stats, setStats] = useState<WorkStats | null>(null)
  const [dirty, setDirty] = useState(false)
  const [assistantId, setAssistantId] = useState<string | null>(null)
  const [modal, setModal] = useState<'settings' | 'tools' | null>(null)
  const chat = useChat()
  const contentRef = useRef<Map<string, string>>(new Map())

  const refreshAll = useCallback(async () => {
    if (!workRoot) return
    try {
      const [t, ch, chars, plots, mem] = await Promise.all([
        listWorkspaceTree(6),
        listChapters(),
        listCharacters(),
        listPlotLines(),
        loadMemoryIndices(),
      ])
      setTree(t)
      setChapters(ch)
      setCharacters(chars)
      setPlotLines(plots)
      setMemory(mem)
      setDocs(await listConceptFiles())
      setStats(await computeWorkStats())
    } catch (e) {
      setError(`加载数据失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [setError, workRoot])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const chapterFiles = useMemo(
    () => (tree ? collectFiles(tree, (p) => /^stories\/.*\.(md|txt)$/i.test(p)) : []),
    [tree],
  )
  const docFiles = useMemo(() => docs, [docs])
  const allOpenable = useMemo(
    () => (tree ? collectFiles(tree, (p) => /\.(md|txt)$/i.test(p) && !p.startsWith('.novel')) : []),
    [tree],
  )
  const openableMap = useMemo(() => new Map(allOpenable.map((f) => [f.path, f])), [allOpenable])

  // 自动打开第一章
  useEffect(() => {
    if (!activePath && chapterFiles.length > 0) {
      setActivePath([...chapterFiles].sort((a, b) => a.path.localeCompare(b.path))[0].path)
    }
  }, [activePath, chapterFiles, setActivePath])

  const handleSaved = useCallback(
    async (path: string, content: string) => {
      setDirty(false)
      // 同步章节元数据 + 记录今日字数
      try {
        const updated = await syncChapterContent(path, content)
        if (updated) {
          setChapters((prev) => prev.map((c) => (c.filePath === path ? updated : c)))
        }
      } catch {
        /* 元数据同步失败不影响主流程 */
      }
      void refreshAll()
    },
    [refreshAll],
  )

  const handleCreateChapter = useCallback(async () => {
    const title = window.prompt('章节标题', `第 ${chapters.length + 1} 章`)
    if (title === null) return
    try {
      const path = await createChapterFile(title.trim())
      await refreshAll()
      setActivePath(path)
    } catch (e) {
      setError(`创建章节失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [chapters.length, refreshAll, setActivePath, setError])

  const handleCreateFile = useCallback(async () => {
    const name = window.prompt('新文件相对路径（如 concept/世界观.md）')
    if (!name) return
    const rel = name.replace(/^\/+/, '')
    try {
      if (rel.includes('/')) await createDir(rel.slice(0, rel.lastIndexOf('/')))
      await createFile(rel)
      await refreshAll()
      setActivePath(rel)
    } catch (e) {
      setError(`创建失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [refreshAll, setActivePath, setError])

  const handleDelete = useCallback(
    async (path: string) => {
      if (!window.confirm(`确认删除 ${path}？`)) return
      try {
        await deleteEntry(path)
        if (activePath === path) setActivePath(null)
        await refreshAll()
      } catch (e) {
        setError(`删除失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [activePath, refreshAll, setActivePath, setError],
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
        await refreshAll()
      } catch (e) {
        setError(`重命名失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [activePath, refreshAll, setActivePath, setError],
  )

  const openDoc = useCallback((path: string) => setActivePath(path), [setActivePath])

  const handleSetStatus = useCallback(
    async (path: string, status: Chapter['status']) => {
      try {
        await markChapterStatus(path, status)
        await refreshAll()
      } catch (e) {
        setError(`更新状态失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [refreshAll, setError],
  )

  const handleSaveMemory = useCallback(
    async (path: string, content: string) => {
      try {
        await saveMemoryIndex(path, content)
        await refreshAll()
      } catch (e) {
        setError(`保存索引失败：${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [refreshAll, setError],
  )

  const workName = workRoot?.split(/[/\\]/).filter(Boolean).pop() ?? ''
  const activeIsOpenable = activePath ? openableMap.has(activePath) : false

  return (
    <div className="workspace">
      <header className="workspace-header">
        <button className="header-btn" onClick={onExit} title="返回书架">← 书架</button>
        <span className="work-name">{workName}</span>
        {stats ? (
          <span className="header-stats">
            {stats.totalWords.toLocaleString()} 字 · {stats.chapterCount} 章 · 今日 {stats.todayWords} 字
          </span>
        ) : null}
        <span className="header-spacer" />
        <button className="header-btn" onClick={() => setModal('tools')} title="搜索 / 导出 / 风险审阅">工具箱</button>
        <button className="header-btn" onClick={() => setModal('settings')} title="Provider / 写作偏好 / 技能">设置</button>
        {error ? (
          <span className="header-error" role="alert" onClick={() => setError(null)}>
            {error} ✕
          </span>
        ) : null}
        <span className={`save-state ${dirty ? 'dirty' : ''}`}>
          {dirty ? '未保存' : '已保存'}
        </span>
      </header>

      <div className="workspace-body">
        <aside className="side-panel">
          <nav className="side-tabs">
            {SIDE_TABS.map((t) => (
              <button
                key={t.id}
                className={sideTab === t.id ? 'active' : ''}
                onClick={() => setSideTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="side-content">
            {sideTab === 'chapters' ? (
              <div className="panel-section">
                <div className="panel-head">
                  <span>章节（{chapters.length}）</span>
                  <button onClick={() => void handleCreateChapter()} title="新建章节">＋</button>
                </div>
                {chapters.map((c) => (
                  <div
                    key={c.filePath}
                    className={`file-item ${activePath === c.filePath ? 'active' : ''}`}
                    onClick={() => setActivePath(c.filePath)}
                  >
                    <span className="file-main">
                      <span className="file-name">{c.title}</span>
                      <span className="file-sub">
                        {c.wordCount > 0 ? `${c.wordCount} 字` : '空'} ·{' '}
                        {c.status === 'completed' ? '✓完结' : c.status === 'revising' ? '改稿中' : '草稿'}
                      </span>
                    </span>
                    <span className="file-actions">
                      {c.status !== 'completed' ? (
                        <button title="标记完结" onClick={(e) => { e.stopPropagation(); void handleSetStatus(c.filePath, 'completed') }}>✓</button>
                      ) : null}
                      <button title="重命名" onClick={(e) => { e.stopPropagation(); void handleRename(c.filePath) }}>✎</button>
                      <button title="删除" onClick={(e) => { e.stopPropagation(); void handleDelete(c.filePath) }}>✕</button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {sideTab === 'characters' ? (
              <CharactersPanel
                characters={characters}
                onSave={async (next) => { await saveCharacters(next); await refreshAll() }}
                onError={setError}
              />
            ) : null}

            {sideTab === 'plotlines' ? (
              <PlotLinesPanel
                plotLines={plotLines}
                onSave={async (next) => { await savePlotLines(next); await refreshAll() }}
                onError={setError}
              />
            ) : null}

            {sideTab === 'docs' ? (
              <div className="panel-section">
                <div className="panel-head">
                  <span>设定 / 大纲</span>
                  <button onClick={() => void handleCreateFile()} title="新建文档">＋</button>
                </div>
                {docFiles.map((d) => (
                  <div
                    key={d.path}
                    className={`file-item ${activePath === d.path ? 'active' : ''}`}
                    onClick={() => openDoc(d.path)}
                  >
                    <span className="file-main">
                      <span className="file-name">{d.name}</span>
                      <span className="file-sub">{d.path}</span>
                    </span>
                    <span className="file-actions">
                      <button title="重命名" onClick={(e) => { e.stopPropagation(); void handleRename(d.path) }}>✎</button>
                      <button title="删除" onClick={(e) => { e.stopPropagation(); void handleDelete(d.path) }}>✕</button>
                    </span>
                  </div>
                ))}
                {docFiles.length === 0 ? <div className="panel-empty">暂无资料文档</div> : null}
              </div>
            ) : null}

            {sideTab === 'memory' ? (
              <MemoryPanel memory={memory} onSave={handleSaveMemory} onError={setError} />
            ) : null}
          </div>

          {stats ? <StatsPanel stats={stats} /> : null}
        </aside>

        <main className="editor-main">
          {activePath && activeIsOpenable ? (
            <>
              <AiWriteBar
                activePath={activePath}
                assistantId={assistantId}
                targetWords={writingSettings?.chapter_word_target}
                contentRef={contentRef}
                onApply={(content) => {
                  contentRef.current.set('ai-replace', content)
                }}
                onError={setError}
              />
              <EditorPane
                key={activePath}
                path={activePath}
                saving={false}
                onSave={async (content) => {
                  await writeText(activePath, content)
                  await handleSaved(activePath, content)
                }}
                onContentChanged={() => setDirty(true)}
                onSaved={() => setDirty(false)}
                onError={setError}
                aiReplaceSignal={contentRef}
              />
            </>
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
          activePath={activePath}
        />

        {modal === 'settings' ? (
          <SettingsModal
            onClose={() => setModal(null)}
            onError={setError}
            onSaved={() => void refreshAll()}
          />
        ) : null}
        {modal === 'tools' ? (
          <ToolsModal
            onClose={() => setModal(null)}
            onError={setError}
            onOpenFile={(p) => setActivePath(p)}
            activePath={activePath}
          />
        ) : null}
      </div>
    </div>
  )
}

export { readText }
