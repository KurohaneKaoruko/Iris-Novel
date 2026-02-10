import Editor from '@monaco-editor/react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import type { editor as MonacoEditor } from 'monaco-editor'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import './App.css'
import {
  createFile,
  createDir,
  deleteEntry,
  getAgents,
  getApiKeyStatus,
  getAppSettings,
  getLastWorkspace,
  gitCommit,
  gitDiff,
  gitInit,
  gitLog,
  gitStatus,
  initNovel,
  isTauriApp,
  listWorkspaceTree,
  openFolderDialog,
  readText,
  renameEntry,
  setAgents,
  setApiKey,
  setAppSettings,
  saveChatSession,
  setWorkspace,
  writeText,
  type Agent,
  type AppSettings,
  type FsEntry,
  type GitCommitInfo,
  type GitStatusItem,
  type ModelProvider,
} from './tauri'
import { useDiff } from './contexts/DiffContext'
import { modificationService } from './services'
import DiffView from './components/DiffView'

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
  streamId?: string
  changeSet?: import('./services/ModificationService').ChangeSet
  timestamp?: number
}

type ChatContextMenuState = {
  x: number
  y: number
  message: string
  selection: string
}

type ExplorerContextMenuState = {
  x: number
  y: number
  entry: FsEntry
}

type ExplorerModalState =
  | { mode: 'newFile'; dirPath: string }
  | { mode: 'newFolder'; dirPath: string }
  | { mode: 'rename'; entry: FsEntry; parentDir: string }

function App() {
  // Diff Context
  const diffContext = useDiff()
  
  // DiffView State
  const [showDiffPanel, setShowDiffPanel] = useState(false)
  const [activeDiffTab, setActiveDiffTab] = useState<string | null>(null)
  
  // Activity Bar State
  const [activeSidebarTab, setActiveSidebarTab] = useState<'files' | 'git'>('files')
  const [activeRightTab, setActiveRightTab] = useState<'chat' | 'graph' | null>('chat')

  // Workspace & Files
  const [workspaceInput, setWorkspaceInput] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [lastWorkspace, setLastWorkspace] = useState<string | null>(null)
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // New state for model modal
  const [showModelModal, setShowModelModal] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Partial<ModelProvider>>({})
  const [isNewProvider, setIsNewProvider] = useState(true)

  // ... (rest of App component)
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenuState | null>(null)
  const [explorerModal, setExplorerModal] = useState<ExplorerModalState | null>(null)
  const [explorerModalValue, setExplorerModalValue] = useState<string>('')
  const [explorerQuery, setExplorerQuery] = useState<string>('')

  // Editors & Refs
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const autoOpenedRef = useRef(false)

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenuState | null>(null)
  const chatSessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  // Settings & Agents
  const [appSettings, setAppSettingsState] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [agentsList, setAgentsList] = useState<Agent[]>([])
  const [agentEditorId, setAgentEditorId] = useState<string>('')
  const [settingsSnapshot, setSettingsSnapshot] = useState<AppSettings | null>(null)
  const [agentsSnapshot, setAgentsSnapshot] = useState<Agent[] | null>(null)
  const [apiKeyStatus, setApiKeyStatus] = useState<Record<string, boolean>>({})

  // Git State
  const [gitItems, setGitItems] = useState<GitStatusItem[]>([])
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([])
  const [gitCommitMsg, setGitCommitMsg] = useState('')
  const [gitSelectedPath, setGitSelectedPath] = useState<string | null>(null)
  const [gitDiffText, setGitDiffText] = useState('')
  const [gitError, setGitError] = useState<string | null>(null)

  // Stats & Visuals
  const [chapterWordTarget, setChapterWordTarget] = useState<number>(2000)
  const [writingSeconds, setWritingSeconds] = useState<number>(0)
  const [graphNodes, setGraphNodes] = useState<Array<{ id: string; name: string }>>([])
  const [graphEdges, setGraphEdges] = useState<Array<{ from: string; to: string; type?: string }>>([])

  const activeFile = useMemo(() => openFiles.find((f) => f.path === activePath) ?? null, [openFiles, activePath])
  const isMarkdownFile = useMemo(() => !!activeFile && activeFile.path.toLowerCase().endsWith('.md'), [activeFile])
  const activeCharCount = useMemo(() => {
    if (!activeFile) return 0
    return activeFile.content.replace(/\s/g, '').length
  }, [activeFile])

  const effectiveProviderId = useMemo(() => {
    if (!appSettings) return ''
    const active = appSettings.active_provider_id
    if (active && appSettings.providers.some((p) => p.id === active)) return active
    return appSettings.providers[0]?.id ?? ''
  }, [appSettings])

  // --- Actions ---

  const refreshTree = useCallback(async () => {
    if (!workspaceRoot) return
    const t = await listWorkspaceTree(6)
    setTree(t)
  }, [workspaceRoot])

  const refreshGit = useCallback(async () => {
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
  }, [])

  const reloadAppSettings = useCallback(async () => {
    if (!isTauriApp()) return
    try {
      const s = await getAppSettings()
      setAppSettingsState(s)
      setSettingsError(null)
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : String(e))
      setAppSettingsState(null)
    }
  }, [])

  const openWorkspacePath = useCallback(
    async (path: string) => {
      const p = path.trim()
      if (!p) return
      setError(null)
      setBusy(true)
      try {
        const info = await setWorkspace(p)
        setWorkspaceRoot(info.root)
        setLastWorkspace(info.root)
      } catch (e) {
        setWorkspaceRoot(null)
        setTree(null)
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

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
    if (isTauriApp()) {
      try {
        await initNovel()
      } catch {
        return
      }
    }
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
    try {
      if (!isTauriApp()) {
        await openWorkspacePath(workspaceInput)
      } else {
        const selected = await openFolderDialog()
        if (!selected) return
        await openWorkspacePath(selected)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [openWorkspacePath, workspaceInput])

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

  const showConfirm = useCallback(async (text: string): Promise<boolean> => {
    if (!isTauriApp()) return window.confirm(text)
    return confirm(text, { title: '确认', kind: 'warning' })
  }, [])

  const onNewChapter = useCallback(async () => {
    if (!workspaceRoot) return
    setError(null)
    setBusy(true)
    try {
      const now = new Date()
      const yyyy = String(now.getFullYear())
      const mm = String(now.getMonth() + 1).padStart(2, '0')
      const dd = String(now.getDate()).padStart(2, '0')
      const fileName = `stories/chapter-${yyyy}${mm}${dd}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.txt`
      try {
        await createFile(fileName)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("parent directory does not exist")) {
          const ok = await showConfirm('stories/ 目录不存在，是否创建？')
          if (!ok) throw e
          await createDir('stories')
          await createFile(fileName)
        } else {
          throw e
        }
      }
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [workspaceRoot, refreshTree, showConfirm])

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

  const nameCollator = useMemo(() => new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }), [])

  const visibleTree = useMemo(() => {
    if (!tree) return null
    const q = explorerQuery.trim().toLowerCase()
    if (!q) return tree

    const walk = (e: FsEntry): FsEntry | null => {
      const name = e.name.toLowerCase()
      if (e.kind === 'file') return name.includes(q) ? e : null
      const children = e.children.map(walk).filter(Boolean) as FsEntry[]
      if (name.includes(q) || children.length > 0) return { ...e, children }
      return null
    }

    return walk(tree)
  }, [tree, explorerQuery])

  const openExplorerContextMenu = useCallback((e: MouseEvent, entry: FsEntry) => {
    e.preventDefault()
    e.stopPropagation()
    setExplorerContextMenu({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const TreeNode = useCallback(
    function TreeNodeInner({ entry, depth }: { entry: FsEntry; depth: number }) {
      const [open, setOpen] = useState(depth < 1)
      const pad = { paddingLeft: `${depth * 12}px` }
      if (entry.kind === 'file') {
        return (
          <div
            className="file-tree-item"
            style={pad}
            onClick={() => void onOpenFile(entry)}
            onContextMenu={(e) => openExplorerContextMenu(e, entry)}
          >
            <span className="file-icon file">📄</span>
            {entry.name}
          </div>
        )
      }
      return (
        <div>
          <div
            className="file-tree-item"
            style={pad}
            onClick={() => setOpen((v) => !v)}
            onContextMenu={(e) => openExplorerContextMenu(e, entry)}
          >
            <span className="file-icon">{open ? '📂' : '📁'}</span>
            {entry.name}
          </div>
          {open &&
            [...entry.children]
              .sort((a, b) => {
                if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
                return nameCollator.compare(a.name, b.name)
              })
              .map((c) => <TreeNodeInner key={c.path} entry={c} depth={depth + 1} />)}
        </div>
      )
    },
    [onOpenFile, openExplorerContextMenu, nameCollator],
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

  const copyText = useCallback(async (text: string) => {
    const value = text ?? ''
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      const el = document.createElement('textarea')
      el.value = value
      el.setAttribute('readonly', 'true')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      el.style.top = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
  }, [])

  const showErrorDialog = useCallback(async (text: string) => {
    if (!isTauriApp()) {
      window.alert(text)
      return
    }
    await message(text, { title: '错误', kind: 'error' })
  }, [])

  const persistAppSettings = useCallback(
    async (next: AppSettings, prev?: AppSettings | null) => {
      try {
        await setAppSettings(next)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await showErrorDialog(`保存设置失败：${msg}`)
        if (prev) {
          setAppSettingsState(prev)
        } else {
          await reloadAppSettings()
        }
      }
    },
    [reloadAppSettings, showErrorDialog],
  )

  const settingsDirty = useMemo(() => {
    if (!showSettings) return false
    if (!appSettings) return false
    if (!settingsSnapshot) return false
    const a = JSON.stringify(appSettings)
    const b = JSON.stringify(settingsSnapshot)
    if (a !== b) return true
    if (!agentsSnapshot) return false
    return JSON.stringify(agentsList) !== JSON.stringify(agentsSnapshot)
  }, [agentsList, agentsSnapshot, appSettings, settingsSnapshot, showSettings])

  useEffect(() => {
    if (!showSettings) {
      setSettingsSnapshot(null)
      setAgentsSnapshot(null)
      return
    }
    if (appSettings && !settingsSnapshot) {
      setSettingsSnapshot(appSettings)
    }
    if (!agentsSnapshot) {
      setAgentsSnapshot(agentsList)
    }
  }, [agentsList, agentsSnapshot, appSettings, settingsSnapshot, showSettings])

  const saveAndCloseSettings = useCallback(async () => {
    if (!appSettings) return
    try {
      await setAppSettings(appSettings)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await showErrorDialog(`保存设置失败：${msg}`)
      return
    }
    try {
      await setAgents(agentsList)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await showErrorDialog(`保存智能体失败：${msg}`)
      return
    }
    await reloadAppSettings()
    setShowSettings(false)
  }, [agentsList, appSettings, reloadAppSettings, showErrorDialog])

  const requestCloseSettings = useCallback(() => {
    void (async () => {
      if (!settingsDirty) {
        setShowSettings(false)
        return
      }
      const shouldSave = await showConfirm('检测到未保存的设置更改，是否保存？')
      if (shouldSave) {
        await saveAndCloseSettings()
        return
      }
      const discard = await showConfirm('确认放弃未保存的更改？')
      if (!discard) return
      if (settingsSnapshot) setAppSettingsState(settingsSnapshot)
      if (agentsSnapshot) setAgentsList(agentsSnapshot)
      setShowSettings(false)
    })()
  }, [agentsSnapshot, saveAndCloseSettings, settingsDirty, settingsSnapshot, showConfirm])

  const openChatContextMenu = useCallback((e: MouseEvent, message: string) => {
    e.preventDefault()
    e.stopPropagation()
    const selection = window.getSelection?.()?.toString() ?? ''
    setChatContextMenu({ x: e.clientX, y: e.clientY, message, selection })
  }, [])

  useEffect(() => {
    if (!chatContextMenu) return
    const onClick = () => setChatContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setChatContextMenu(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [chatContextMenu])

  useEffect(() => {
    if (!explorerContextMenu) return
    const onClick = () => setExplorerContextMenu(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExplorerContextMenu(null)
    }
    window.addEventListener('click', onClick)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [explorerContextMenu])

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
    const streamId = newId()
    const assistantId = newId()
    const assistant: ChatItem = { id: assistantId, role: 'assistant', content: '', streaming: true, streamId }

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

    const messagesToSend = [...chatMessages, user].map((m) => ({ 
      id: m.id,
      role: m.role, 
      content: m.content,
      timestamp: m.timestamp || Date.now()
    }))
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

  // --- DiffView Handlers ---

  const onAcceptModification = useCallback(async (changeSetId: string, modificationId: string) => {
    try {
      await modificationService.acceptModification(changeSetId, modificationId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext])

  const onRejectModification = useCallback((changeSetId: string, modificationId: string) => {
    try {
      modificationService.rejectModification(changeSetId, modificationId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext])

  const onAcceptAllModifications = useCallback(async (changeSetId: string) => {
    try {
      await modificationService.acceptAll(changeSetId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
      // Refresh tree after accepting all modifications
      await refreshTree()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext, refreshTree])

  const onRejectAllModifications = useCallback((changeSetId: string) => {
    try {
      modificationService.rejectAll(changeSetId)
      const updatedChangeSet = modificationService.getChangeSet(changeSetId)
      if (updatedChangeSet) {
        diffContext.updateChangeSet(updatedChangeSet)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [diffContext])

  const onCloseDiffView = useCallback((changeSetId: string) => {
    diffContext.removeChangeSet(changeSetId)
    if (activeDiffTab === changeSetId) {
      // Switch to another tab if available
      const remainingChangeSets = Array.from(diffContext.changeSets.keys()).filter(id => id !== changeSetId)
      setActiveDiffTab(remainingChangeSets[0] || null)
    }
    // Close panel if no more change sets
    if (diffContext.changeSets.size <= 1) {
      setShowDiffPanel(false)
    }
  }, [diffContext, activeDiffTab])

  const onOpenDiffView = useCallback((changeSetId: string) => {
    setShowDiffPanel(true)
    setActiveDiffTab(changeSetId)
    diffContext.setActiveChangeSet(changeSetId)
  }, [diffContext])

  // --- Effects ---

  useEffect(() => {
    if (!showPreview || !activeFile) {
      setPreviewHtml('')
      return
    }
    const content = activeFile.content
    const t = window.setTimeout(() => {
      try {
        const escapeHtml = (s: string) =>
          s.replace(/[&<>"']/g, (c) => {
            if (c === '&') return '&amp;'
            if (c === '<') return '&lt;'
            if (c === '>') return '&gt;'
            if (c === '"') return '&quot;'
            return '&#39;'
          })
        if (isMarkdownFile) {
          const html = marked.parse(content, { breaks: true }) as string
          setPreviewHtml(DOMPurify.sanitize(html))
        } else {
          setPreviewHtml(DOMPurify.sanitize(`<pre>${escapeHtml(content)}</pre>`))
        }
      } catch {
        setPreviewHtml('')
      }
    }, 120)
    return () => window.clearTimeout(t)
  }, [activeFile, isMarkdownFile, showPreview])

  useEffect(() => {
    if (!isTauriApp()) return
    void reloadAppSettings()
    void getAgents()
      .then((list) => {
        setAgentsList(list)
        setAgentEditorId((prev) => prev || list[0]?.id || '')
      })
      .catch(() => setAgentsList([]))
  }, [reloadAppSettings])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!showSettings) return
    if (!appSettings) return
    void (async () => {
      const entries = await Promise.all(
        appSettings.providers.map(async (p) => {
          try {
            const ok = await getApiKeyStatus(p.id)
            return [p.id, ok] as const
          } catch {
            return [p.id, false] as const
          }
        }),
      )
      const next: Record<string, boolean> = {}
      for (const [id, ok] of entries) next[id] = ok
      setApiKeyStatus(next)
    })()
  }, [appSettings, showSettings])

  useEffect(() => {
    if (!isTauriApp()) return
    if (autoOpenedRef.current) return
    autoOpenedRef.current = true
    void (async () => {
      try {
        const last = await getLastWorkspace()
        setLastWorkspace(last)
        if (!workspaceRoot && last) {
          await openWorkspacePath(last)
        }
      } catch {
        setLastWorkspace(null)
      }
    })()
  }, [openWorkspacePath, workspaceRoot])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workspaceRoot) return
    void (async () => {
      try {
        const t = await listWorkspaceTree(6)
        setTree(t)
      } catch {
        setTree(null)
      }
    })()
    void refreshGit()
    void loadProjectSettings()
  }, [loadProjectSettings, refreshGit, workspaceRoot])

  useEffect(() => {
    if (!isTauriApp()) return
    const unlistenFns: Array<() => void> = []
    const normalizeStreamId = (v: unknown): string | null => {
      if (typeof v === 'string' && v) return v
      return null
    }
    const parsePayload = (payload: unknown): Record<string, unknown> | null => {
      if (!payload) return null
      if (typeof payload === 'string') {
        try {
          const v: unknown = JSON.parse(payload)
          if (v && typeof v === 'object') return v as Record<string, unknown>
          return null
        } catch {
          return null
        }
      }
      if (typeof payload === 'object') return payload as Record<string, unknown>
      return null
    }
    void listen('ai_stream_token', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const token = typeof p.token === 'string' ? p.token : ''
      if (!token) return
      setChatMessages((prev) =>
        prev.map((m) => (m.role === 'assistant' && m.streamId === streamId ? { ...m, content: `${m.content}${token}` } : m)),
      )
    }).then((u) => unlistenFns.push(u))

    void listen('ai_stream_done', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      setChatMessages((prev) => prev.map((m) => (m.role === 'assistant' && m.streamId === streamId ? { ...m, streaming: false } : m)))
    }).then((u) => unlistenFns.push(u))

    void listen('ai_change_set', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const changeSet = p.changeSet as import('./services/ModificationService').ChangeSet | undefined
      if (!changeSet) return
      
      // Add the ChangeSet to the DiffContext
      diffContext.addChangeSet(changeSet)
      
      // Update the chat message with the ChangeSet
      setChatMessages((prev) => 
        prev.map((m) => 
          m.role === 'assistant' && m.streamId === streamId 
            ? { ...m, changeSet } 
            : m
        )
      )
      
      // Open the DiffView panel
      onOpenDiffView(changeSet.id)
    }).then((u) => unlistenFns.push(u))

    void listen('ai_error', (event) => {
      const p = parsePayload(event.payload)
      if (!p) return
      const streamId = normalizeStreamId(p.streamId) ?? normalizeStreamId(p.stream_id)
      if (!streamId) return
      const message = typeof p.message === 'string' ? p.message : 'AI 调用失败'
      const stage = typeof p.stage === 'string' ? p.stage : ''
      const provider = typeof p.provider === 'string' ? p.provider : ''
      const extra = [provider ? `provider=${provider}` : '', stage ? `stage=${stage}` : ''].filter(Boolean).join(' ')
      setChatMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.streamId === streamId
            ? { ...m, content: extra ? `${message}\n(${extra})` : message, streaming: false }
            : m,
        ),
      )
    }).then((u) => unlistenFns.push(u))

    return () => {
      for (const u of unlistenFns) u()
    }
  }, [])

  useEffect(() => {
    if (!isTauriApp()) return
    if (!workspaceRoot) return
    let timer: number | null = null
    const unlistenFns: Array<() => void> = []
    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => void refreshTree(), 200)
    }
    void listen('fs_changed', () => {
      scheduleRefresh()
    }).then((u) => unlistenFns.push(u))
    void listen('fs_watch_error', (event) => {
      const payload: unknown = event.payload
      if (payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string') {
        setError((payload as { message: string }).message)
      }
    }).then((u) => unlistenFns.push(u))
    return () => {
      if (timer) window.clearTimeout(timer)
      for (const u of unlistenFns) u()
    }
  }, [workspaceRoot, refreshTree])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void onSaveActive()
        return
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault()
        chatInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSaveActive])

  useEffect(() => {
    if (!isTauriApp()) return
    const hasUnsaved = openFiles.some((f) => f.dirty) || settingsDirty
    if (!hasUnsaved) return
    let unlisten: null | (() => void) = null
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const ok = await showConfirm('存在未保存内容，确认要关闭吗？')
        if (!ok) event.preventDefault()
      })
      .then((u) => {
        unlisten = u
      })
    return () => {
      if (unlisten) unlisten()
    }
  }, [openFiles, settingsDirty, showConfirm])

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
    // Only render graph if the tab is active
    if (activeRightTab !== 'graph') return
    const canvas = graphCanvasRef.current
    if (!canvas) return
    // Adjust size based on container? For now use fixed-ish or flexible CSS
    // We'll rely on ResizeObserver or simple effect
    const cssW = canvas.clientWidth || 300
    const cssH = canvas.clientHeight || 500
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(cssW * dpr)
    canvas.height = Math.floor(cssH * dpr)
    // canvas.style.width is handled by CSS (100%)
    
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
  }, [activeRightTab, graphNodes, graphEdges]) // Re-render when tab changes or data changes

  // --- Render ---

  return (
    <div className="app-container">
      <div className="workbench-body">
        {/* Activity Bar (Left) */}
        <div className="activity-bar">
          <div
            className={`activity-bar-item ${activeSidebarTab === 'files' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('files')}
            title="资源管理器"
          >
            <span className="activity-bar-icon">📁</span>
          </div>
          <div
            className={`activity-bar-item ${activeSidebarTab === 'git' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('git')}
            title="源代码管理"
          >
            <span className="activity-bar-icon">📦</span>
          </div>
          <div className="spacer" />
          <div
            className="activity-bar-item"
            onClick={() => {
              setShowSettings(true)
              if (!appSettings) void reloadAppSettings()
            }}
            title="设置"
          >
            <span className="activity-bar-icon">⚙️</span>
          </div>
        </div>

        {/* Sidebar Panel (Left) */}
        <div className="sidebar">
        {activeSidebarTab === 'files' ? (
          <>
            <div className="sidebar-header">
              <span>资源管理器</span>
              <div style={{ flex: 1 }} />
              {workspaceRoot ? (
                <button className="icon-button" onClick={() => void refreshTree()} title="刷新">
                  ↻
                </button>
              ) : null}
            </div>
            <div className="sidebar-content">
              {workspaceRoot ? (
                <>
                  <div style={{ padding: '10px 20px', fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid #333' }}>
                    {workspaceRoot.split(/[/\\]/).pop()}
                  </div>
                  {error ? <div className="error-text">{error}</div> : null}
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid #333' }}>
                    <input
                      className="explorer-search"
                      value={explorerQuery}
                      onChange={(e) => setExplorerQuery(e.target.value)}
                      placeholder="搜索..."
                    />
                  </div>
                  {visibleTree ? <TreeNode entry={visibleTree} depth={0} /> : <div style={{ padding: 10 }}>加载中...</div>}
                </>
              ) : (
                <div style={{ padding: 20, textAlign: 'center' }}>
                  <button className="primary-button" onClick={() => void onOpenWorkspace()}>
                    打开文件夹
                  </button>
                  {error ? <div className="error-text">{error}</div> : null}
                  {lastWorkspace ? (
                    <div className="welcome-recent" style={{ width: '100%' }}>
                      <h3>最近打开</h3>
                      <div className="recent-list">
                        <div className="recent-item" onClick={() => void openWorkspacePath(lastWorkspace)}>
                          {lastWorkspace}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {!isTauriApp() && (
                    <input
                      style={{ width: '100%', marginTop: 10, padding: 4 }}
                      value={workspaceInput}
                      onChange={(e) => setWorkspaceInput(e.target.value)}
                      placeholder="或输入路径"
                    />
                  )}
                </div>
              )}
            </div>
            {workspaceRoot ? (
              <>
                <div className="sidebar-header">大纲</div>
                <div className="sidebar-content" style={{ flex: '0 0 auto', maxHeight: '150px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void onOpenByPath('outline/outline.md')}
                    style={{ width: 'calc(100% - 20px)', margin: '10px', display: 'block' }}
                  >
                    打开 outline.md
                  </button>
                  <div style={{ padding: '0 10px', fontSize: '11px', color: '#888' }}>在 outline/ 目录维护章节大纲。</div>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {activeSidebarTab === 'git' ? (
          <>
            <div className="sidebar-header">源代码管理</div>
            <div className="sidebar-content">
              {gitError ? <div className="error-text">{gitError}</div> : null}
              <div className="git-toolbar">
                <button disabled={busy || !workspaceRoot} onClick={() => void onGitInit()}>
                  初始化
                </button>
                <button disabled={busy || !workspaceRoot} onClick={() => void refreshGit()}>
                  刷新
                </button>
              </div>
              <div className="git-status-list">
                {gitItems.length === 0 ? (
                  <div style={{ padding: 10, color: '#888' }}>无变更</div>
                ) : (
                  gitItems.map((it) => (
                    <div
                      key={it.path}
                      className={gitSelectedPath === it.path ? 'git-row active' : 'git-row'}
                      onClick={() => void onGitSelect(it.path)}
                    >
                      <span className={`git-status-icon ${it.status === 'M' ? 'modified' : 'new'}`}>{it.status}</span>
                      <span className="git-path">{it.path}</span>
                    </div>
                  ))
                )}
              </div>
              {gitSelectedPath ? <pre className="git-diff-view">{gitDiffText}</pre> : null}
              <div className="git-commit-section">
                <input
                  className="git-commit-input"
                  value={gitCommitMsg}
                  onChange={(e) => setGitCommitMsg(e.target.value)}
                  placeholder="提交信息 (Ctrl+Enter)"
                  onKeyDown={(e) => {
                    if (e.ctrlKey && e.key === 'Enter') void onGitCommit()
                  }}
                />
                <button className="git-commit-btn" disabled={busy || !gitCommitMsg.trim()} onClick={() => void onGitCommit()}>
                  提交
                </button>
              </div>
              {gitCommits.length > 0 ? (
                <div style={{ padding: 10, borderTop: '1px solid #333' }}>
                  {gitCommits.slice(0, 5).map((c) => (
                    <div key={c.id} style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                      <span style={{ fontFamily: 'monospace', marginRight: 6 }}>{c.id.slice(0, 7)}</span>
                      <span>{c.summary}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="editor-tabs">
          {openFiles.length === 0 ? (
            <div className="editor-tab">无文件</div>
          ) : (
            openFiles.map((f) => (
              <div
                key={f.path}
                className={f.path === activePath ? 'editor-tab active' : 'editor-tab'}
                onClick={() => setActivePath(f.path)}
              >
                {f.name}
                {f.dirty ? ' *' : ''}
                <span
                  style={{ marginLeft: 8 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    void (async () => {
                      if (f.dirty) {
                        const ok = await showConfirm(`文件“${f.name}”未保存，确认关闭吗？`)
                        if (!ok) return
                      }
                      setOpenFiles((prev) => {
                        const next = prev.filter((p) => p.path !== f.path)
                        if (activePath === f.path) {
                          setActivePath(next[next.length - 1]?.path ?? null)
                        }
                        return next
                      })
                    })()
                  }}
                >
                  ×
                </span>
              </div>
            ))
          )}
          <div className="spacer" />
          <button className="icon-button" disabled={!workspaceRoot} onClick={() => void onNewChapter()} title="新建章节">
            +
          </button>
          <button className="icon-button" disabled={!activeFile || !activeFile.dirty} onClick={() => void onSaveActive()} title="保存">
            💾
          </button>
          <button
            className="icon-button"
            disabled={!activeFile}
            onClick={() => setShowPreview((v) => !v)}
            title="预览"
          >
            👁
          </button>
        </div>
        <div className="editor-content">
          {activeFile ? (
            <>
              <div className="editor-pane" style={showPreview ? { width: '50%', maxWidth: '50%' } : undefined}>
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
                    lineNumbers: 'off',
                    padding: { top: 16, bottom: 16 },
                    unicodeHighlight: { ambiguousCharacters: false },
                  }}
                  className="markdown-editor"
                />
              </div>
              {showPreview ? (
                <div className="preview-pane">
                  {previewHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                  ) : (
                    <div className="preview-empty">无预览内容</div>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <div className="welcome-screen">
              <h1>Iris-Creation</h1>
              <div className="welcome-actions">
                <button className="welcome-btn" onClick={() => void onOpenWorkspace()}>
                  打开文件夹
                </button>
              </div>
              {!workspaceRoot && error ? <div className="error-text">{error}</div> : null}
            </div>
          )}
        </div>
      </div>

      {/* Right Activity Bar & Panel */}
      <div className="right-panel-container">
        {activeRightTab ? (
          <aside className="right-panel-content">
            {activeRightTab === 'chat' ? (
              <>
                <div className="ai-header">
                  <div className="ai-config-row">
                    <select
                      className="ai-select"
                      value={appSettings?.active_agent_id ?? ''}
                      onChange={(e) => {
                        const id = e.target.value
                        if (!appSettings) return
                        const prev = appSettings
                        const next = { ...appSettings, active_agent_id: id }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                    >
                      {agentsList.length === 0 ? <option value="">无智能体</option> : null}
                      {agentsList.map((a) => (
                        <option key={a.id} value={a.id}>
                          🤖 {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ai-config-row">
                    <select
                      className="ai-select"
                      value={effectiveProviderId}
                      onChange={(e) => {
                        const active = e.target.value
                        if (!appSettings) return
                        const prev = appSettings
                        const next = { ...appSettings, active_provider_id: active }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                    >
                      {appSettings?.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="ai-messages">
                  {chatMessages.length === 0 ? (
                    <div style={{ padding: 20, color: '#888', textAlign: 'center', fontSize: 13 }}>
                      <div>👋 嗨，我是你的写作助手。</div>
                      <div style={{ marginTop: 8 }}>我可以帮你续写情节、润色文笔或构思大纲。</div>
                    </div>
                  ) : (
                    chatMessages.map((m) => (
                      <div key={m.id} className={m.role === 'user' ? 'message user' : 'message assistant'}>
                        <div className="message-meta">
                          {m.role === 'user' ? (
                            '你'
                          ) : (
                            <span className="ai-meta">
                              AI
                              {m.streaming ? (
                                <span className="ai-dot-pulse" aria-hidden="true">
                                  <span />
                                  <span />
                                  <span />
                                </span>
                              ) : null}
                            </span>
                          )}
                        </div>
                        <div className="message-content" style={{ whiteSpace: 'pre-wrap' }} onContextMenu={(e) => openChatContextMenu(e, m.content)}>
                          {m.content || (m.role === 'assistant' && m.streaming ? '正在思考…' : '')}
                        </div>
                        {m.role === 'assistant' && m.streaming ? (
                          <div className="ai-processing-indicator">
                            <div className="ai-processing-spinner" />
                            <span>AI 正在处理文件...</span>
                          </div>
                        ) : null}
                        {m.role === 'assistant' && m.changeSet && m.changeSet.files.length > 0 ? (
                          <div className="file-modifications">
                            <div className="file-modifications-header">
                              <span className="file-icon">📝</span>
                              <span>修改了 {m.changeSet.files.length} 个文件</span>
                            </div>
                            <div className="file-modifications-list">
                              {m.changeSet.files.map((fileModification) => {
                                const stats = {
                                  additions: fileModification.modifications.filter(mod => mod.type === 'add').length,
                                  deletions: fileModification.modifications.filter(mod => mod.type === 'delete').length,
                                  modifications: fileModification.modifications.filter(mod => mod.type === 'modify').length,
                                }
                                return (
                                  <div 
                                    key={fileModification.filePath} 
                                    className="file-modification-item"
                                    onClick={() => onOpenDiffView(m.changeSet!.id)}
                                    title="点击查看差异"
                                  >
                                    <div className="file-modification-name">
                                      <span className="file-icon">📄</span>
                                      <span className="file-name">{fileModification.filePath.split('/').pop()}</span>
                                    </div>
                                    <div className="file-modification-path">{fileModification.filePath}</div>
                                    <div className="file-modification-stats">
                                      {stats.additions > 0 && <span className="stat-add">+{stats.additions}</span>}
                                      {stats.deletions > 0 && <span className="stat-delete">-{stats.deletions}</span>}
                                      {stats.modifications > 0 && <span className="stat-modify">~{stats.modifications}</span>}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ) : null}
                        {m.role === 'assistant' && m.content ? (
                          <div className="ai-actions">
                            <button className="icon-button" disabled={!activeFile} onClick={() => insertAtCursor(m.content)} title="插入">
                              ↵
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <div className="ai-input-area">
                  <div className="ai-actions" style={{ marginBottom: 6, justifyContent: 'flex-start', gap: 10 }}>
                    <button className="icon-button" disabled={!activeFile} onClick={() => onQuoteSelection()} title="引用选区">
                      ❝
                    </button>
                    <button className="icon-button" disabled={!activeFile} onClick={() => void onSmartComplete()} title="智能补全">
                      ⚡
                    </button>
                    <div style={{ flex: 1 }} />
                    <button className="primary-button" disabled={busy || !chatInput.trim()} onClick={() => void onSendChat()}>
                      发送
                    </button>
                  </div>
                  <textarea
                    ref={chatInputRef}
                    className="ai-textarea"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.ctrlKey && e.key === 'Enter') {
                        e.preventDefault()
                        void onSendChat()
                      }
                    }}
                    placeholder="输入指令..."
                  />
                </div>
              </>
            ) : null}

            {activeRightTab === 'graph' ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div className="ai-header" style={{ justifyContent: 'center' }}>
                  <button className="icon-button" onClick={() => void loadGraph()}>
                    ↻ 刷新图谱
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                  <canvas ref={graphCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                </div>
                <div style={{ padding: 10, fontSize: 11, color: '#666', textAlign: 'center' }}>
                  数据: concept/characters.md & relations.md
                </div>
              </div>
            ) : null}
          </aside>
        ) : null}

        <div className="right-activity-bar">
          <div
            className={`right-activity-item ${activeRightTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveRightTab(activeRightTab === 'chat' ? null : 'chat')}
            title="对话"
          >
            💬
          </div>
          <div
            className={`right-activity-item ${activeRightTab === 'graph' ? 'active' : ''}`}
            onClick={() => {
              setActiveRightTab(activeRightTab === 'graph' ? null : 'graph')
              if (activeRightTab !== 'graph') void loadGraph()
            }}
            title="图谱"
          >
            🕸️
          </div>
        </div>
      </div>
    </div>

      {/* DiffView Panel */}
      {showDiffPanel && diffContext.changeSets.size > 0 ? (
        <div className="diff-panel-overlay">
          <div className="diff-panel-container">
            <div className="diff-panel-tabs">
              {Array.from(diffContext.changeSets.values()).map((changeSet) => (
                <div
                  key={changeSet.id}
                  className={`diff-panel-tab ${activeDiffTab === changeSet.id ? 'active' : ''}`}
                  onClick={() => {
                    setActiveDiffTab(changeSet.id)
                    diffContext.setActiveChangeSet(changeSet.id)
                  }}
                >
                  <span className="diff-panel-tab-title">
                    {changeSet.files.length} file{changeSet.files.length !== 1 ? 's' : ''}
                  </span>
                  <span className="diff-panel-tab-status">{changeSet.status}</span>
                  <button
                    className="diff-panel-tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseDiffView(changeSet.id)
                    }}
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="diff-panel-tabs-spacer" />
              <button
                className="diff-panel-close-all"
                onClick={() => {
                  setShowDiffPanel(false)
                  setActiveDiffTab(null)
                }}
                title="Close diff panel"
              >
                Close Panel
              </button>
            </div>

            <div className="diff-panel-content">
              {activeDiffTab && diffContext.changeSets.has(activeDiffTab) ? (
                <div className="diff-panel-files">
                  {diffContext.changeSets.get(activeDiffTab)!.files.map((fileModification) => (
                    <div key={fileModification.filePath} className="diff-panel-file">
                      <DiffView
                        fileModification={fileModification}
                        viewMode={diffContext.viewMode}
                        onAccept={(modId) => onAcceptModification(activeDiffTab, modId)}
                        onReject={(modId) => onRejectModification(activeDiffTab, modId)}
                        onAcceptAll={() => onAcceptAllModifications(activeDiffTab)}
                        onRejectAll={() => onRejectAllModifications(activeDiffTab)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="diff-panel-empty">
                  <p>No diff view selected</p>
                </div>
              )}
            </div>

            <div className="diff-panel-footer">
              <button
                className="diff-panel-view-mode-toggle"
                onClick={() => diffContext.toggleViewMode()}
                title={`Switch to ${diffContext.viewMode === 'split' ? 'unified' : 'split'} view`}
              >
                {diffContext.viewMode === 'split' ? '⊟ Unified' : '⊞ Split'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Settings Modal */}
      {showSettings ? (
        <div className="modal-overlay" onClick={requestCloseSettings}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>设置</h2>
              <button className="close-btn" onClick={requestCloseSettings}>
                ×
              </button>
            </div>
            <div className="modal-body">
              {!appSettings ? (
                <div style={{ padding: 12, color: '#ccc' }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>设置加载失败或尚未加载完成。</div>
                  {settingsError ? <div className="error-text">{settingsError}</div> : null}
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button className="btn btn-secondary" onClick={() => void reloadAppSettings()}>
                      重新加载
                    </button>
                    <button className="primary-button" onClick={() => setShowSettings(false)}>
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                <div className="settings-form">
                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff' }}>通用</h3>
                  <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <label style={{ flex: 1 }}>Markdown 输出</label>
                    <input
                      type="checkbox"
                      checked={appSettings.output.use_markdown}
                      onChange={(e) => {
                        const prev = appSettings
                        const next = { ...appSettings, output: { ...appSettings.output, use_markdown: e.target.checked } }
                        setAppSettingsState(next)
                        void persistAppSettings(next, prev)
                      }}
                    />
                  </div>
                  <div className="form-group">
                    <label>章节目标字数</label>
                    <input
                      type="number"
                      value={chapterWordTarget}
                      onChange={(e) => setChapterWordTarget(Number(e.target.value) || 0)}
                      onBlur={() => void saveProjectSettings()}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <h3 style={{ fontSize: 14, color: '#fff', margin: 0 }}>模型配置</h3>
                    <button
                      className="primary-button"
                      style={{ fontSize: 12, padding: '4px 8px' }}
                      onClick={() => {
                        setEditingProvider({
                          id: newId(),
                          kind: 'OpenAICompatible',
                          base_url: 'https://api.openai.com/v1',
                          model_name: 'gpt-4o-mini',
                        })
                        setIsNewProvider(true)
                        setShowModelModal(true)
                      }}
                    >
                      + 添加模型
                    </button>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {appSettings.providers.map((p) => (
                      <div
                        key={p.id}
                        className="provider-item"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: '#333',
                          padding: '8px 12px',
                          borderRadius: 4,
                          border: appSettings.active_provider_id === p.id ? '1px solid #007acc' : '1px solid transparent',
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                          <div style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ color: '#888', fontSize: 11 }}>
                            {p.kind} • {p.model_name}
                          </div>
                          <div style={{ color: apiKeyStatus[p.id] ? '#9cdcfe' : '#888', fontSize: 11 }}>
                            API Key：{apiKeyStatus[p.id] ? '已设置' : '未设置'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {appSettings.active_provider_id !== p.id && (
                            <button
                              className="icon-button"
                              title="设为默认"
                              onClick={() => {
                                const prev = appSettings
                                const next = { ...appSettings, active_provider_id: p.id }
                                setAppSettingsState(next)
                                void persistAppSettings(next, prev)
                              }}
                            >
                              ★
                            </button>
                          )}
                          <button
                            className="icon-button"
                            title="编辑"
                            onClick={() => {
                              setEditingProvider(p)
                              setIsNewProvider(false)
                              setShowModelModal(true)
                            }}
                          >
                            ✎
                          </button>
                          <button
                            className="icon-button"
                            title="删除"
                            disabled={appSettings.providers.length <= 1}
                            onClick={() => {
                              void (async () => {
                                const ok = await showConfirm('确定删除该模型配置？')
                                if (!ok) return
                                const prev = appSettings
                                const nextProviders = appSettings.providers.filter((x) => x.id !== p.id)
                                let nextActive = appSettings.active_provider_id
                                if (p.id === nextActive) {
                                  nextActive = nextProviders[0]?.id ?? ''
                                }
                                const next = { ...appSettings, providers: nextProviders, active_provider_id: nextActive }
                                setAppSettingsState(next)
                                await persistAppSettings(next, prev)
                              })()
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, marginBottom: 10, color: '#fff' }}>智能体管理</h3>
                  
                  {/* Built-in Agents */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>内置智能体</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {agentsList
                        .filter((a) => a.category !== '自定义')
                        .map((a) => (
                          <div
                            key={a.id}
                            className="agent-card"
                            style={{
                              background: '#333',
                              padding: 10,
                              borderRadius: 4,
                              cursor: 'pointer',
                              border: agentEditorId === a.id ? '1px solid #007acc' : '1px solid transparent',
                            }}
                            onClick={() => setAgentEditorId(a.id)}
                          >
                            <div style={{ fontWeight: 500, color: '#fff', fontSize: 13 }}>{a.name}</div>
                            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{a.category}</div>
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Custom Agents */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 12, color: '#888' }}>自定义智能体</div>
                      <button
                        className="icon-button"
                        style={{ fontSize: 12, padding: '2px 6px', border: '1px solid #444', borderRadius: 3 }}
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
                        + 创建
                      </button>
                    </div>
                    {agentsList.filter((a) => a.category === '自定义').length === 0 ? (
                      <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', padding: 10, textAlign: 'center', background: '#2d2d2d', borderRadius: 4 }}>
                        暂无自定义智能体
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {agentsList
                          .filter((a) => a.category === '自定义')
                          .map((a) => (
                            <div
                              key={a.id}
                              className="agent-card"
                              style={{
                                background: '#333',
                                padding: 10,
                                borderRadius: 4,
                                cursor: 'pointer',
                                border: agentEditorId === a.id ? '1px solid #007acc' : '1px solid transparent',
                                position: 'relative',
                              }}
                              onClick={() => setAgentEditorId(a.id)}
                            >
                              <div style={{ fontWeight: 500, color: '#fff', fontSize: 13 }}>{a.name}</div>
                              <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>自定义</div>
                              {agentEditorId === a.id && (
                                <button
                                  className="icon-button"
                                  style={{ position: 'absolute', top: 6, right: 6, padding: 2, fontSize: 12 }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    void (async () => {
                                      const ok = await showConfirm('确定删除此智能体？')
                                      if (!ok) return
                                      setAgentsList((prev) => prev.filter((x) => x.id !== a.id))
                                      setAgentEditorId('')
                                    })()
                                  }}
                                >
                                  🗑️
                                </button>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>

                  {agentEditorId && agentsList.find((a) => a.id === agentEditorId) && (
                    <div style={{ marginTop: 16, borderTop: '1px solid #444', paddingTop: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 'bold', color: '#fff', marginBottom: 10 }}>
                        编辑: {agentsList.find((a) => a.id === agentEditorId)?.name}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="form-group">
                          <label>名称</label>
                          <input
                            className="ai-select"
                            value={agentsList.find((a) => a.id === agentEditorId)?.name ?? ''}
                            onChange={(e) =>
                              setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, name: e.target.value } : a)))
                            }
                            disabled={agentsList.find((a) => a.id === agentEditorId)?.category !== '自定义'}
                          />
                        </div>
                        <div className="form-group">
                          <label>系统提示词 (System Prompt)</label>
                          <textarea
                            className="ai-textarea"
                            placeholder="你是一个..."
                            style={{ height: 120 }}
                            value={agentsList.find((a) => a.id === agentEditorId)?.system_prompt ?? ''}
                            onChange={(e) =>
                              setAgentsList((prev) => prev.map((a) => (a.id === agentEditorId ? { ...a, system_prompt: e.target.value } : a)))
                            }
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>
            <div className="modal-footer">
              {appSettings ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    void saveAndCloseSettings()
                  }}
                >
                  保存并关闭
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Model Modal */}
      {showModelModal && (
        <div className="modal-overlay" onClick={() => setShowModelModal(false)}>
          <div className="modal-content" style={{ width: 450 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{isNewProvider ? '添加模型' : '编辑模型'}</h2>
              <button className="close-btn" onClick={() => setShowModelModal(false)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-form">
                <div className="form-group">
                  <label>名称 (显示用)</label>
                  <input
                    value={editingProvider.name ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, name: e.target.value }))}
                    placeholder="例如：DeepSeek V3"
                  />
                </div>
                <div className="form-group">
                  <label>类型</label>
                  <select
                    value={editingProvider.kind ?? 'OpenAICompatible'}
                    onChange={(e) => {
                      const k = e.target.value as ModelProvider['kind']
                      let base = editingProvider.base_url
                      if (k === 'OpenAI') base = 'https://api.openai.com/v1'
                      else if (k === 'Anthropic') base = 'https://api.anthropic.com'
                      setEditingProvider((p) => ({ ...p, kind: k, base_url: base }))
                    }}
                  >
                    <option value="OpenAICompatible">OpenAI 兼容 (通用)</option>
                    <option value="OpenAI">OpenAI 官方</option>
                    <option value="Anthropic">Anthropic (Claude)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Base URL</label>
                  <input
                    value={editingProvider.base_url ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, base_url: e.target.value }))}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
                <div className="form-group">
                  <label>Model ID</label>
                  <input
                    value={editingProvider.model_name ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, model_name: e.target.value }))}
                    placeholder="例如：gpt-4o, deepseek-chat"
                  />
                </div>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={editingProvider.api_key ?? ''}
                    onChange={(e) => setEditingProvider((p) => ({ ...p, api_key: e.target.value }))}
                    placeholder={
                      editingProvider.id && apiKeyStatus[editingProvider.id] ? '已设置（留空表示不修改）' : 'sk-...'
                    }
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="primary-button"
                disabled={!editingProvider.name || !editingProvider.model_name}
                onClick={() => {
                  if (!appSettings) return
                  void (async () => {
                    const prev = appSettings
                    const rawKey = (editingProvider.api_key ?? '').trim()
                    const pid = editingProvider.id ?? ''
                    if (isNewProvider && pid && !rawKey) {
                      const ok = await showConfirm('未填写 API Key，仍要保存该模型配置吗？')
                      if (!ok) return
                    }
                    if (pid && rawKey) {
                      try {
                        await setApiKey(pid, rawKey)
                        setApiKeyStatus((m) => ({ ...m, [pid]: true }))
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : String(e)
                        await showErrorDialog(`保存 API Key 失败：${msg}`)
                        return
                      }
                    }
                    let nextProviders = [...appSettings.providers]
                    if (isNewProvider) {
                      nextProviders.push({ ...(editingProvider as ModelProvider), api_key: '' })
                    } else {
                      nextProviders = nextProviders.map((p) =>
                        p.id === editingProvider.id ? ({ ...(editingProvider as ModelProvider), api_key: '' } as ModelProvider) : p,
                      )
                    }
                    const next = { ...appSettings, providers: nextProviders }
                    setAppSettingsState(next)
                    try {
                      await setAppSettings(next)
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e)
                      await showErrorDialog(`保存设置失败：${msg}`)
                      setAppSettingsState(prev)
                      return
                    }
                    if (pid) {
                      try {
                        const ok = await getApiKeyStatus(pid)
                        setApiKeyStatus((m) => ({ ...m, [pid]: ok }))
                        if (rawKey && !ok) {
                          await showErrorDialog(`API Key 已提交保存，但读取状态仍为“未设置”（provider=${pid}）。可能是系统凭据存储不可用。`)
                          return
                        }
                      } catch {
                        setApiKeyStatus((m) => ({ ...m, [pid]: false }))
                        if (rawKey) {
                          await showErrorDialog(`API Key 已提交保存，但读取状态失败（provider=${pid}）。可能是系统凭据存储不可用。`)
                          return
                        }
                      }
                    }
                    await reloadAppSettings()
                    setShowModelModal(false)
                  })()
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="status-bar">
        <div className="status-item">字数：{activeCharCount} / {chapterWordTarget}</div>
        <div className="status-item">写作：{writingSeconds}s</div>
        <div className="status-item">Git：{gitError ? '不可用' : `${gitItems.length} 变更`}</div>
        <div className="status-spacer" />
      </div>

      {chatContextMenu ? (
        <div className="context-menu" style={{ left: chatContextMenu.x, top: chatContextMenu.y }}>
          <button
            className={chatContextMenu.selection ? 'context-menu-item' : 'context-menu-item disabled'}
            disabled={!chatContextMenu.selection}
            onClick={() => void copyText(chatContextMenu.selection).finally(() => setChatContextMenu(null))}
          >
            复制选中内容
          </button>
          <button
            className="context-menu-item"
            onClick={() => void copyText(chatContextMenu.message).finally(() => setChatContextMenu(null))}
          >
            复制该条消息
          </button>
        </div>
      ) : null}

      {explorerContextMenu ? (
        <div className="context-menu" style={{ left: explorerContextMenu.x, top: explorerContextMenu.y }}>
          <button className="context-menu-item" onClick={() => void refreshTree().finally(() => setExplorerContextMenu(null))}>
            刷新
          </button>
          {explorerContextMenu.entry.kind === 'dir' ? (
            <>
              <button
                className="context-menu-item"
                onClick={() => {
                  setExplorerModal({ mode: 'newFile', dirPath: explorerContextMenu.entry.path })
                  setExplorerModalValue('')
                  setExplorerContextMenu(null)
                }}
              >
                新建文件
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  setExplorerModal({ mode: 'newFolder', dirPath: explorerContextMenu.entry.path })
                  setExplorerModalValue('')
                  setExplorerContextMenu(null)
                }}
              >
                新建文件夹
              </button>
            </>
          ) : null}
          <button
            className="context-menu-item"
            onClick={() => {
              const parentDir = explorerContextMenu.entry.path.replaceAll('\\', '/').split('/').slice(0, -1).join('/')
              setExplorerModal({ mode: 'rename', entry: explorerContextMenu.entry, parentDir })
              setExplorerModalValue(explorerContextMenu.entry.name)
              setExplorerContextMenu(null)
            }}
          >
            重命名
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const entry = explorerContextMenu.entry
              setExplorerContextMenu(null)
              void (async () => {
                const ok = await showConfirm(`确认删除：${entry.path} ?`)
                if (!ok) return
                try {
                  await deleteEntry(entry.path)
                  await refreshTree()
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e)
                  await showErrorDialog(msg)
                }
              })()
            }}
          >
            删除
          </button>
        </div>
      ) : null}

      {explorerModal ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setExplorerModal(null)
          }}
        >
          <div
            className="modal-content"
            onClick={(e) => {
              e.stopPropagation()
            }}
          >
            <div className="modal-header">
              <h2>
                {explorerModal.mode === 'newFile' ? '新建文件' : explorerModal.mode === 'newFolder' ? '新建文件夹' : '重命名'}
              </h2>
              <button className="close-btn" onClick={() => setExplorerModal(null)}>
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>名称</label>
                <input
                  value={explorerModalValue}
                  onChange={(e) => setExplorerModalValue(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setExplorerModal(null)}>
                取消
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  void (async () => {
                    const name = explorerModalValue.trim()
                    if (!name) return
                    if (explorerModal.mode === 'newFile') {
                      const rel = `${explorerModal.dirPath.replaceAll('\\', '/')}/${name}`.replaceAll('//', '/')
                      const ok = await showConfirm(`确认新建文件：${rel} ?`)
                      if (!ok) return
                      try {
                        await createFile(rel)
                        await refreshTree()
                        setExplorerModal(null)
                      } catch (e) {
                        await showErrorDialog(e instanceof Error ? e.message : String(e))
                      }
                      return
                    }
                    if (explorerModal.mode === 'newFolder') {
                      const rel = `${explorerModal.dirPath.replaceAll('\\', '/')}/${name}`.replaceAll('//', '/')
                      const ok = await showConfirm(`确认新建文件夹：${rel} ?`)
                      if (!ok) return
                      try {
                        await createDir(rel)
                        await refreshTree()
                        setExplorerModal(null)
                      } catch (e) {
                        await showErrorDialog(e instanceof Error ? e.message : String(e))
                      }
                      return
                    }
                    const next = `${explorerModal.parentDir}/${name}`.replaceAll('//', '/')
                    const ok = await showConfirm(`确认重命名为：${next} ?`)
                    if (!ok) return
                    try {
                      await renameEntry(explorerModal.entry.path, next)
                      await refreshTree()
                      setExplorerModal(null)
                    } catch (e) {
                      await showErrorDialog(e instanceof Error ? e.message : String(e))
                    }
                  })()
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
