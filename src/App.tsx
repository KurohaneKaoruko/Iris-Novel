import Editor from '@monaco-editor/react'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import './App.css'
import {
  createFile,
  exportAgents,
  getAgents,
  getAppSettings,
  gitCommit,
  gitDiff,
  gitInit,
  gitLog,
  gitStatus,
  importAgents,
  initNovel,
  isTauriApp,
  listWorkspaceTree,
  readText,
  setAgents,
  setAppSettings,
  saveChatSession,
  setWorkspace,
  writeText,
  type Agent,
  type AppSettings,
  type FsEntry,
  type GitCommitInfo,
  type GitStatusItem,
} from './tauri'

type OpenFile = {
  path: string
  name: string
  content: string
  dirty: boolean
}

type ChatItem = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

function App() {
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const chatInputRef = useRef<HTMLInputElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [chatMessages, setChatMessages] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')
  const streamIdRef = useRef<string | null>(null)
  const assistantIdRef = useRef<string | null>(null)
  const chatSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  const [appSettings, setAppSettingsState] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [agentsList, setAgentsList] = useState<Agent[]>([])
  const [agentEditorId, setAgentEditorId] = useState<string>('')
  const [agentsJson, setAgentsJson] = useState<string>('')

  const [gitItems, setGitItems] = useState<GitStatusItem[]>([])
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([])
  const [gitCommitMsg, setGitCommitMsg] = useState('')
  const [gitSelectedPath, setGitSelectedPath] = useState<string | null>(null)
  const [gitDiffText, setGitDiffText] = useState('')
  const [gitError, setGitError] = useState<string | null>(null)

  const [chapterWordTarget, setChapterWordTarget] = useState<number>(2000)
  const [writingSeconds, setWritingSeconds] = useState<number>(0)
  const [showGraph, setShowGraph] = useState(false)
  const [graphNodes, setGraphNodes] = useState<Array<{ id: string; name: string }>>([])
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string; type?: string }>>([])

  const activeFile = useMemo(() => openFiles.find((f) => f.path === activePath) ?? null, [openFiles, activePath])
  const activeCharCount = useMemo(() => {
    if (!activeFile) return 0
    return activeFile.content.replace(/\s/g, '').length
  }, [activeFile])

  const refreshTree = useCallback(async () => {
    if (!workspaceRoot) return
    const t = await listWorkspaceTree(6)
    setTree(t)
  }, [workspaceRoot])

  const refreshGit = useCallback(async () => {
    if (!workspaceRoot) return
    if (!isTauriApp()) return
    try {
      const [items, commits] = await Promise.all([gitStatus(), gitLog(20)])
      setGitItems(items)
      setGitCommits(commits)
      setGitError(null)
    } catch (e) {
      setGitItems([])
      setGitCommits([])
      setGitError(e instanceof Error ? e.message : String(e))
    }
  }, [workspaceRoot])

  const loadProjectSettings = useCallback(async () => {
    if (!workspaceRoot) return
    try {
      const raw = await readText('.novel/.settings/project.json')
      const v: unknown = JSON.parse(raw)
      const n =
        typeof v === 'object' && v && 'chapter_word_target' in v
          ? Number((v as { chapter_word_target?: unknown }).chapter_word_target)
          : NaN
      if (Number.isFinite(n) && n > 0) {
        setChapterWordTarget(n)
      }
    } catch {
      return
    }
  }, [workspaceRoot])

  const saveProjectSettings = useCallback(async () => {
    if (!workspaceRoot) return
    const raw = JSON.stringify({ chapter_word_target: chapterWordTarget }, null, 2)
    await writeText('.novel/.settings/project.json', raw)
  }, [workspaceRoot, chapterWordTarget])

  const loadGraph = useCallback(async () => {
    if (!workspaceRoot) return
    try {
      const [rawChars, rawRels] = await Promise.all([readText('concept/characters.md'), readText('concept/relations.md')])

      const nodes = rawChars
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
        .filter(Boolean)
        .map((name) => ({ id: name, name }))

      const relLines = rawRels
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))

      const edges = relLines
        .map((l) => l.replace(/^- /, ''))
        .map((l) => {
          const m = l.match(/^(.+?)\s*->\s*(.+?)(?:\s*:\s*(.+))?$/)
          if (!m) return null
          return { from: m[1].trim(), to: m[2].trim(), type: m[3]?.trim() || undefined }
        })
        .filter(Boolean) as Array<{ from: string; to: string; type?: string }>

      const nodeMap = new Map<string, { id: string; name: string }>()
      for (const n of nodes) nodeMap.set(n.id, n)
      for (const e of edges) {
        if (!nodeMap.has(e.from)) nodeMap.set(e.from, { id: e.from, name: e.from })
        if (!nodeMap.has(e.to)) nodeMap.set(e.to, { id: e.to, name: e.to })
      }
      setGraphNodes(Array.from(nodeMap.values()))
      setGraphEdges(edges)
    } catch {
      setGraphNodes([])
      setGraphEdges([])
    }
  }, [workspaceRoot])

  const onOpenWorkspace = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      if (!isTauriApp()) {
        throw new Error('当前未运行在 Tauri 环境（浏览器预览仅展示 UI）')
      }
      const info = await setWorkspace(workspaceInput.trim())
      setWorkspaceRoot(info.root)
      const t = await listWorkspaceTree(6)
      setTree(t)
      await refreshGit()
      await loadProjectSettings()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceInput, refreshGit, loadProjectSettings])

  const onOpenFile = useCallback(
    async (entry: FsEntry) => {
      if (entry.kind !== 'file') return
      setError(null)
      setBusy(true)
      try {
        const existing = openFiles.find((f) => f.path === entry.path)
        if (existing) {
          setActivePath(existing.path)
          return
        }
        const content = await readText(entry.path)
        const next: OpenFile = { path: entry.path, name: entry.name, content, dirty: false }
        setOpenFiles((prev) => [...prev, next])
        setActivePath(entry.path)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [openFiles],
  )

  const onOpenByPath = useCallback(
    async (relPath: string) => {
      if (!relPath) return
      setError(null)
      setBusy(true)
      try {
        const existing = openFiles.find((f) => f.path === relPath)
        if (existing) {
          setActivePath(existing.path)
          return
        }
        const parts = relPath.replaceAll('\\', '/').split('/')
        const name = parts[parts.length - 1] || relPath
        const content = await readText(relPath)
        const next: OpenFile = { path: relPath, name, content, dirty: false }
        setOpenFiles((prev) => [...prev, next])
        setActivePath(relPath)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [openFiles],
  )

  const onSaveActive = useCallback(async () => {
    if (!activeFile) return
    setError(null)
    setBusy(true)
    try {
      await writeText(activeFile.path, activeFile.content)
      setOpenFiles((prev) => prev.map((f) => (f.path === activeFile.path ? { ...f, dirty: false } : f)))
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [activeFile, refreshTree])

  const onNewChapter = useCallback(async () => {
    if (!workspaceRoot) return
    setError(null)
    setBusy(true)
    try {
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const fileName = `stories/chapter-${yyyy}${mm}${dd}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.md`
      await createFile(fileName)
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, refreshTree])

  const onGitInit = useCallback(async () => {
    if (!workspaceRoot) return
    setBusy(true)
    try {
      await gitInit()
      await refreshGit()
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, refreshGit])

  const onGitSelect = useCallback(
    async (path: string) => {
      if (!workspaceRoot) return
      setBusy(true)
      setGitSelectedPath(path)
      try {
        const text = await gitDiff(path)
        setGitDiffText(text)
      } catch (e) {
        setGitDiffText(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [workspaceRoot],
  )

  const onGitCommit = useCallback(async () => {
    if (!workspaceRoot) return
    const msg = gitCommitMsg.trim()
    if (!msg) return
    setBusy(true)
    try {
      await gitCommit(msg)
      setGitCommitMsg('')
      await refreshGit()
    } catch (e) {
      setGitError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, gitCommitMsg, refreshGit])

  const filteredTree = useMemo(() => {
    const allowTop = new Set(['concept', 'outline', 'stories'])
    const isAllowedPath = (p: string) =>
      p === 'concept' || p === 'outline' || p === 'stories' || p.startsWith('concept/') || p.startsWith('outline/') || p.startsWith('stories/')

    const walk = (e: FsEntry, depth: number): FsEntry | null => {
      if (depth === 1 && e.kind === 'file') return null
      if (depth === 1 && !allowTop.has(e.name)) return null

      if (e.kind === 'file') {
        if (!isAllowedPath(e.path)) return null
        return e.name.toLowerCase().endsWith('.md') ? e : null
      }

      const children = e.children.map((c) => walk(c, depth + 1)).filter(Boolean) as FsEntry[]
      return { ...e, children }
    }

    return tree ? walk(tree, 0) : null
  }, [tree])

  const TreeNode = useCallback(
    function TreeNodeInner({ entry, depth }: { entry: FsEntry; depth: number }) {
      const [open, setOpen] = useState(depth < 1)
      const pad = { paddingLeft: `${depth * 12}px` }
      if (entry.kind === 'file') {
        return (
          <div className="treeRow treeFile" style={pad} onClick={() => void onOpenFile(entry)}>
            {entry.name}
          </div>
        )
      }
      return (
        <div>
          <div className="treeRow treeDir" style={pad} onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'} {entry.name}
          </div>
          {open && entry.children.map((c) => <TreeNodeInner key={c.path} entry={c} depth={depth + 1} />)}
        </div>
      )
    },
    [onOpenFile],
  )

  const newId = useCallback(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }, [])

  const getSelectionText = useCallback((): string => {
    const editor = editorRef.current
    if (!editor) return ''
    const model = editor.getModel?.()
    const sel = editor.getSelection?.()
    if (!model || !sel) return ''
    const text = model.getValueInRange(sel) as string
    return text ?? ''
  }, [])

  const insertAtCursor = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor || !text) return
    const sel = editor.getSelection?.()
    if (!sel) return
    editor.executeEdits?.('ai-insert', [{ range: sel, text, forceMoveMarkers: true }])
    editor.focus?.()
  }, [])

  const onQuoteSelection = useCallback(() => {
    const text = getSelectionText().trim()
    if (!text) return
    setChatInput((prev) => (prev ? `${prev}\n${text}` : text))
    chatInputRef.current?.focus()
  }, [getSelectionText])

  const onSendChat = useCallback(async (overrideContent?: string) => {
    const content = (overrideContent ?? chatInput).trim()
    if (!content) return
    const user: ChatItem = { id: newId(), role: 'user', content }
    const assistantId = newId()
    const assistant: ChatItem = { id: assistantId, role: 'assistant', content: '', streaming: true }

    const streamId = newId()
    streamIdRef.current = streamId
    assistantIdRef.current = assistantId

    setChatMessages((prev) => [...prev, user, assistant])
    if (!overrideContent || overrideContent === chatInput) {
      setChatInput('')
    }

    if (!isTauriApp()) {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: '当前未运行在 Tauri 环境，无法调用 AI。', streaming: false } : m)),
      )
      return
    }

    if (!workspaceRoot) {
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: '请先打开一个工作区（Workspace）。', streaming: false } : m)),
      )
      return
    }

    try {
      await initNovel()
    } catch (e) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: e instanceof Error ? e.message : String(e), streaming: false } : m,
        ),
      )
      return
    }

    const messagesToSend = [...chatMessages, user].map((m) => ({ role: m.role, content: m.content }))
    try {
      const { chatGenerateStream } = await import('./tauriChat')
      await chatGenerateStream({
        streamId,
        messages: messagesToSend,
        useMarkdown: appSettings?.output.use_markdown ?? false,
        agentId: appSettings?.active_agent_id ?? null,
      })
    } catch (e) {
      setChatMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: e instanceof Error ? e.message : String(e), streaming: false } : m,
        ),
      )
    }
  }, [chatInput, chatMessages, newId, appSettings, workspaceRoot])

  const onSmartComplete = useCallback(() => {
    if (!activeFile) return
    const editor = editorRef.current
    const model = editor?.getModel?.()
    const full: string = model?.getValue?.() ?? activeFile.content
    let snippet = full.slice(Math.max(0, full.length - 1200))
    const pos = editor?.getPosition?.()
    if (pos && model?.getOffsetAt) {
      const offset = model.getOffsetAt(pos)
      snippet = full.slice(Math.max(0, offset - 1200), offset)
    }
    const nearing = chapterWordTarget > 0 && activeCharCount >= Math.floor(chapterWordTarget * 0.9)
    const prompt =
      `续写补全：本章目标字数 ${chapterWordTarget}，当前 ${activeCharCount}。\n` +
      (nearing ? '请开始考虑本章收尾，并给出下一章开头建议。\n' : '请续写下一段（150-300 字）。\n') +
      `上下文：\n${snippet}`
    void onSendChat(prompt)
  }, [activeFile, chapterWordTarget, activeCharCount, onSendChat])

  useEffect(() => {
    if (!isTauriApp()) return
    void getAppSettings()
      .then((s) => setAppSettingsState(s))
      .catch(() => setAppSettingsState(null))
    void getAgents()
      .then((list) => {
        setAgentsList(list)
        setAgentEditorId((prev) => prev || list[0]?.id || '')
      })
      .catch(() => setAgentsList([]))
  }, [])

  useEffect(() => {
    if (!isTauriApp()) return

    const unlistenFns: Array<() => void> = []

    void listen('ai_stream_token', (event) => {
      const payload: unknown = event.payload
      if (!payload || typeof payload !== 'object') return
      const p = payload as Record<string, unknown>
      const streamId = typeof p.streamId === 'string' ? p.streamId : undefined
      if (!streamId || streamIdRef.current !== streamId) return
      const token = typeof p.token === 'string' ? p.token : ''
      const assistantId = assistantIdRef.current
      if (!assistantId || !token) return
      setChatMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: `${m.content}${token}` } : m)),
      )
    }).then((u) => unlistenFns.push(u))

    void listen('ai_stream_done', (event) => {
      const payload: unknown = event.payload
      if (!payload || typeof payload !== 'object') return
      const p = payload as Record<string, unknown>
      const streamId = typeof p.streamId === 'string' ? p.streamId : undefined
      if (!streamId || streamIdRef.current !== streamId) return
      const assistantId = assistantIdRef.current
      if (!assistantId) return
      setChatMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, streaming: false } : m)))
    }).then((u) => unlistenFns.push(u))

    return () => {
      for (const u of unlistenFns) u()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault()
        chatInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!isTauriApp()) return
    if (chatMessages.length === 0) return
    if (chatMessages.some((m) => m.streaming)) return
    void saveChatSession({
      id: chatSessionIdRef.current,
      workspace_root: workspaceRoot ?? '',
      created_at: 0,
      updated_at: 0,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    }).catch(() => {})
  }, [chatMessages, workspaceRoot])

  useEffect(() => {
    setWritingSeconds(0)
    if (!activePath) return
    const t = window.setInterval(() => setWritingSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [activePath])

  useEffect(() => {
    if (!showGraph) return
    const canvas = graphCanvasRef.current
    if (!canvas) return

    const cssW = 760
    const cssH = 520
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(cssW * dpr)
    canvas.height = Math.floor(cssH * dpr)
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const nodes = graphNodes.slice()
    const n = nodes.length
    const cx = cssW / 2
    const cy = cssH / 2
    const r = Math.min(cssW, cssH) * 0.35
    const placed = nodes.map((node, i) => {
      const a = (Math.PI * 2 * i) / Math.max(1, n)
      return { ...node, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    })
    const byId = new Map<string, { id: string; name: string; x: number; y: number }>()
    for (const p of placed) byId.set(p.id, p)

    ctx.lineWidth = 1
    ctx.strokeStyle = '#3a3a3a'
    for (const e of graphEdges) {
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    for (const p of placed) {
      ctx.beginPath()
      ctx.fillStyle = '#2a2a2a'
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#4a4a4a'
      ctx.stroke()

      ctx.fillStyle = '#d4d4d4'
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.name, p.x, p.y)
    }
  }, [showGraph, graphNodes, graphEdges])

  return (
    <div className="appShell">
      <header className="appTopbar">
        <div className="appTitle">Iris-Creation</div>
        <div className="appTopbarSpacer" />
        <input
          className="topbarInput"
          value={workspaceInput}
          onChange={(e) => setWorkspaceInput(e.target.value)}
          placeholder="输入工作区路径，例如 D:\\Novels\\MyBook"
        />
        <button className="topbarButton" disabled={busy || !workspaceInput.trim()} onClick={() => void onOpenWorkspace()}>
          打开
        </button>
        <button className="topbarButton" disabled={busy || !workspaceRoot} onClick={() => void refreshTree()}>
          刷新
        </button>
        <button className="topbarButton" disabled={busy || !workspaceRoot} onClick={() => void onNewChapter()}>
          新建章节
        </button>
        <button className="topbarButton" disabled={busy || !activeFile || !activeFile.dirty} onClick={() => void onSaveActive()}>
          保存
        </button>
        <button
          className="topbarButton"
          disabled={!workspaceRoot}
          onClick={() => {
            setShowGraph(true)
            void loadGraph()
          }}
        >
          关系图谱
        </button>
        {workspaceRoot ? (
          <>
            <div className="topbarLabel">章目标</div>
            <input
              className="topbarInputSmall"
              type="number"
              min={1}
              value={chapterWordTarget}
              onChange={(e) => setChapterWordTarget(Number(e.target.value) || 0)}
              onBlur={() => void saveProjectSettings()}
            />
          </>
        ) : null}
        <div className="appTopbarRight">Workspace: {workspaceRoot ?? '未打开'}</div>
      </header>

      <div className="appBody">
        <aside className="appSidebar">
          <div className="panelHeader">资源</div>
          <div className="panelBody panelScroll">
            {error ? <div className="errorText">{error}</div> : null}
            {filteredTree ? <TreeNode entry={filteredTree} depth={0} /> : <div>未加载</div>}
          </div>
          <div className="panelHeader">大纲</div>
          <div className="panelBody">
            <button className="topbarButton" disabled={!workspaceRoot} onClick={() => void onOpenByPath('outline/outline.md')}>
              打开 outline.md
            </button>
            <div style={{ marginTop: '10px', color: '#9b9b9b', fontSize: '12px' }}>
              在 outline/ 目录维护章节大纲（仅 .md 文档）。
            </div>
          </div>
          <div className="panelHeader">Git</div>
          <div className="panelBody panelScroll">
            {gitError ? <div className="errorText">{gitError}</div> : null}
            <div className="gitToolbar">
              <button className="topbarButton" disabled={busy || !workspaceRoot} onClick={() => void onGitInit()}>
                初始化
              </button>
              <button className="topbarButton" disabled={busy || !workspaceRoot} onClick={() => void refreshGit()}>
                刷新
              </button>
            </div>
            <div className="gitStatusList">
              {gitItems.length === 0 ? (
                <div className="gitEmpty">无变更</div>
              ) : (
                gitItems.map((it) => (
                  <div
                    key={it.path}
                    className={gitSelectedPath === it.path ? 'gitRow gitRowActive' : 'gitRow'}
                    onClick={() => void onGitSelect(it.path)}
                  >
                    <span className="gitStatus">{it.status}</span>
                    <span className="gitPath">{it.path}</span>
                  </div>
                ))
              )}
            </div>
            {gitSelectedPath ? <pre className="gitDiff">{gitDiffText}</pre> : null}
            <div className="gitCommitBox">
              <input
                className="gitInput"
                value={gitCommitMsg}
                onChange={(e) => setGitCommitMsg(e.target.value)}
                placeholder="提交信息"
              />
              <button className="topbarButton" disabled={busy || !gitCommitMsg.trim()} onClick={() => void onGitCommit()}>
                提交
              </button>
            </div>
            {gitCommits.length > 0 ? (
              <div className="gitLog">
                {gitCommits.slice(0, 5).map((c) => (
                  <div key={c.id} className="gitLogRow">
                    <span className="gitLogId">{c.id.slice(0, 7)}</span>
                    <span className="gitLogMsg">{c.summary}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </aside>

        <main className="appMain">
          <div className="editorTabs">
            {openFiles.length === 0 ? (
              <div className="tabInactive">未打开文件</div>
            ) : (
              openFiles.map((f) => (
                <div
                  key={f.path}
                  className={f.path === activePath ? 'tabActive' : 'tabInactive'}
                  onClick={() => setActivePath(f.path)}
                >
                  {f.name}
                  {f.dirty ? ' *' : ''}
                </div>
              ))
            )}
            <div className="tabsSpacer" />
            <button className="topbarButton" disabled={!activeFile} onClick={() => void onSmartComplete()}>
              智能补全
            </button>
            <button className="topbarButton" disabled={!workspaceRoot} onClick={() => void onNewChapter()}>
              开新章
            </button>
          </div>
          <div className="editorArea">
            {activeFile ? (
              <Editor
                theme="vs-dark"
                language="plaintext"
                value={activeFile.content}
                onMount={(editor, monaco) => {
                  editorRef.current = editor
                  monacoRef.current = monaco
                }}
                onChange={(v) => {
                  const value = v ?? ''
                  setOpenFiles((prev) =>
                    prev.map((f) => (f.path === activeFile.path ? { ...f, content: value, dirty: true } : f)),
                  )
                }}
                options={{
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  fontSize: 14,
                }}
              />
            ) : (
              <div className="emptyHint">从左侧文件树打开一个章节文件</div>
            )}
          </div>
        </main>

        <aside className="appRight">
          <div className="panelHeader">AI</div>
          <div className="panelBody panelScroll">
            <div className="aiToolbar">
              <button className="topbarButton" onClick={() => setShowSettings((v) => !v)}>
                设置
              </button>
              <select
                className="aiSelect"
                value={appSettings?.active_agent_id ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  setAppSettingsState((prev) => {
                    if (!prev) return prev
                    const next = { ...prev, active_agent_id: id }
                    void setAppSettings(next)
                    return next
                  })
                }}
              >
                {agentsList.length === 0 ? <option value="">智能体未加载</option> : null}
                {agentsList.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.category} / {a.name}
                  </option>
                ))}
              </select>
              <div className="aiToolbarInfo">
                Provider：{appSettings?.providers.active ?? '未加载'}；输出：{appSettings?.output.use_markdown ? 'Markdown' : '纯文本'}
              </div>
            </div>

            {showSettings && appSettings ? (
              <div className="aiSettings">
                <div className="aiSettingsRow">
                  <label className="aiLabel">是否使用 md 格式</label>
                  <input
                    type="checkbox"
                    checked={appSettings.output.use_markdown}
                    onChange={(e) =>
                      setAppSettingsState((prev) => (prev ? { ...prev, output: { ...prev.output, use_markdown: e.target.checked } } : prev))
                    }
                  />
                </div>

                <div className="aiSettingsRow">
                  <label className="aiLabel">Provider</label>
                  <select
                    className="aiSelect"
                    value={appSettings.providers.active}
                    onChange={(e) =>
                      setAppSettingsState((prev) => (prev ? { ...prev, providers: { ...prev.providers, active: e.target.value } } : prev))
                    }
                  >
                    <option value="openai">OpenAI（兼容）</option>
                    <option value="claude">Claude</option>
                    <option value="wenxin">文心一言（兼容）</option>
                  </select>
                </div>

                <div className="aiSettingsGroup">OpenAI（兼容）</div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">Base URL</label>
                  <input
                    className="aiInput"
                    value={appSettings.providers.openai.base_url}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, openai: { ...prev.providers.openai, base_url: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">Model</label>
                  <input
                    className="aiInput"
                    value={appSettings.providers.openai.model}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, openai: { ...prev.providers.openai, model: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">API Key</label>
                  <input
                    type="password"
                    className="aiInput"
                    value={appSettings.providers.openai.api_key}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, openai: { ...prev.providers.openai, api_key: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>

                <div className="aiSettingsGroup">Claude</div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">Model</label>
                  <input
                    className="aiInput"
                    value={appSettings.providers.claude.model}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, claude: { ...prev.providers.claude, model: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">API Key</label>
                  <input
                    type="password"
                    className="aiInput"
                    value={appSettings.providers.claude.api_key}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, claude: { ...prev.providers.claude, api_key: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>

                <div className="aiSettingsGroup">文心一言（兼容）</div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">Base URL</label>
                  <input
                    className="aiInput"
                    value={appSettings.providers.wenxin.base_url}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, wenxin: { ...prev.providers.wenxin, base_url: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">Model</label>
                  <input
                    className="aiInput"
                    value={appSettings.providers.wenxin.model}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, wenxin: { ...prev.providers.wenxin, model: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">API Key</label>
                  <input
                    type="password"
                    className="aiInput"
                    value={appSettings.providers.wenxin.api_key}
                    onChange={(e) =>
                      setAppSettingsState((prev) =>
                        prev ? { ...prev, providers: { ...prev.providers, wenxin: { ...prev.providers.wenxin, api_key: e.target.value } } } : prev,
                      )
                    }
                  />
                </div>

                <div className="aiSettingsGroup">智能体</div>
                <div className="aiSettingsRow">
                  <label className="aiLabel">编辑</label>
                  <select className="aiSelect" value={agentEditorId} onChange={(e) => setAgentEditorId(e.target.value)}>
                    {agentsList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.category} / {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {agentsList.find((a) => a.id === agentEditorId) ? (
                  <>
                    <div className="aiSettingsRow">
                      <label className="aiLabel">名称</label>
                      <input
                        className="aiInput"
                        value={agentsList.find((a) => a.id === agentEditorId)?.name ?? ''}
                        onChange={(e) =>
                          setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, name: e.target.value } : a)))
                        }
                      />
                    </div>
                    <div className="aiSettingsRow">
                      <label className="aiLabel">分类</label>
                      <input
                        className="aiInput"
                        value={agentsList.find((a) => a.id === agentEditorId)?.category ?? ''}
                        onChange={(e) =>
                          setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, category: e.target.value } : a)))
                        }
                      />
                    </div>
                    <div className="aiSettingsRow">
                      <label className="aiLabel">温度</label>
                      <input
                        className="aiInput"
                        type="number"
                        step="0.05"
                        value={agentsList.find((a) => a.id === agentEditorId)?.temperature ?? 0.7}
                        onChange={(e) =>
                          setAgentsList((prev) =>
                            prev.map((a) =>
                              a.id === agentEditorId ? { ...a, temperature: Number(e.target.value) || 0 } : a,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="aiSettingsRow">
                      <label className="aiLabel">Max Tokens</label>
                      <input
                        className="aiInput"
                        type="number"
                        value={agentsList.find((a) => a.id === agentEditorId)?.max_tokens ?? 1024}
                        onChange={(e) =>
                          setAgentsList((prev) =>
                            prev.map((a) =>
                              a.id === agentEditorId ? { ...a, max_tokens: Number(e.target.value) || 0 } : a,
                            ),
                          )
                        }
                      />
                    </div>
                    <div className="aiSettingsRow aiSettingsRowFull">
                      <label className="aiLabel">提示词</label>
                      <textarea
                        className="aiTextarea"
                        value={agentsList.find((a) => a.id === agentEditorId)?.system_prompt ?? ''}
                        onChange={(e) =>
                          setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, system_prompt: e.target.value } : a)))
                        }
                      />
                    </div>
                  </>
                ) : null}

                <div className="aiSettingsRow aiSettingsRowFull">
                  <label className="aiLabel">导入/导出</label>
                  <textarea className="aiTextarea" value={agentsJson} onChange={(e) => setAgentsJson(e.target.value)} />
                </div>

                <div className="aiSettingsActions">
                  <button
                    className="topbarButton"
                    onClick={() => {
                      void setAppSettings(appSettings)
                    }}
                  >
                    保存设置
                  </button>
                  <button
                    className="topbarButton"
                    onClick={() => {
                      void setAgents(agentsList)
                    }}
                  >
                    保存智能体
                  </button>
                  <button
                    className="topbarButton"
                    onClick={() => {
                      const id = newId()
                      const next: Agent = {
                        id,
                        name: '新智能体',
                        category: '自定义',
                        system_prompt: '',
                        temperature: 0.7,
                        max_tokens: 1024,
                      }
                      setAgentsList((prev) => [...prev, next])
                      setAgentEditorId(id)
                    }}
                  >
                    新增
                  </button>
                  <button
                    className="topbarButton"
                    disabled={!agentEditorId}
                    onClick={() => {
                      setAgentsList((prev) => prev.filter((a) => a.id !== agentEditorId))
                      setAgentEditorId('')
                    }}
                  >
                    删除
                  </button>
                  <button
                    className="topbarButton"
                    onClick={() => {
                      void exportAgents().then((s) => setAgentsJson(s))
                    }}
                  >
                    导出
                  </button>
                  <button
                    className="topbarButton"
                    onClick={() => {
                      void importAgents(agentsJson).then(() => getAgents().then((list) => setAgentsList(list)))
                    }}
                  >
                    导入
                  </button>
                </div>
              </div>
            ) : null}
            <div className="chatList">
              {chatMessages.length === 0 ? (
                <div className="chatEmpty">Ctrl+Shift+L 聚焦输入框；可用“引用选区”把编辑器选区发给 AI</div>
              ) : (
                chatMessages.map((m) => (
                  <div key={m.id} className={m.role === 'user' ? 'chatMsg chatUser' : 'chatMsg chatAssistant'}>
                    <div className="chatMeta">{m.role === 'user' ? '你' : m.streaming ? 'AI（生成中）' : 'AI'}</div>
                    <div className="chatContent">{m.content}</div>
                    {m.role === 'assistant' && m.content ? (
                      <div className="chatActions">
                        <button className="topbarButton" disabled={!activeFile} onClick={() => insertAtCursor(m.content)}>
                          插入到光标
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            <div className="chatComposer">
              <div className="chatComposerRow">
                <button className="topbarButton" disabled={!activeFile} onClick={() => onQuoteSelection()}>
                  引用选区
                </button>
                <button className="topbarButton" disabled={busy || !chatInput.trim()} onClick={() => void onSendChat()}>
                  发送
                </button>
              </div>
              <input
                ref={chatInputRef}
                className="chatInput"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.ctrlKey && e.key === 'Enter') {
                    e.preventDefault()
                    void onSendChat()
                  }
                }}
                placeholder="输入消息，Ctrl+Enter 发送"
              />
            </div>
          </div>
        </aside>
      </div>

      {showGraph ? (
        <div className="modalOverlay" onClick={() => setShowGraph(false)}>
          <div className="modalPanel" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div className="modalTitle">人物关系图谱</div>
              <div className="modalSpacer" />
              <button className="topbarButton" onClick={() => void loadGraph()}>
                刷新
              </button>
              <button className="topbarButton" onClick={() => setShowGraph(false)}>
                关闭
              </button>
            </div>
            <div className="modalBody">
              <canvas ref={graphCanvasRef} className="graphCanvas" />
              <div className="graphHint">
                数据来自 concept/characters.md（用 - 人名 列表）与 concept/relations.md（A {'->'} B : 关系）。
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="appStatusbar">
        <div className="statusItem">字数：{activeCharCount}</div>
        <div className="statusItem">写作：{writingSeconds}s</div>
        <div className="statusItem">会话：{chatMessages.length}</div>
        <div className="statusItem">Git：{gitError ? '未初始化/不可用' : `${gitItems.length} 变更`}</div>
      </footer>
    </div>
  )
}

export default App
