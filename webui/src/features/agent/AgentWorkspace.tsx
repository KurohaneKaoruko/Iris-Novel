import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry } from '../../api/backend'
import { createDir, createFile, listWorkspaceTree, readText, renameEntry, deleteEntry as del, writeText, getSkills, getChatSession, saveChatSession, deleteChatSession, getAppSettings, getApiKeyStatus, exportWork, type Skill, type ChatMessagePayload } from '../../api/backend'
import { listChapters, createChapterFile } from '../../api/novel'

/** Blob 触发浏览器下载 */
function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
import { subscribeEvent } from '../../api/rpc'
import { useProject } from '../../state/ProjectContext'
import { useChat, type ChatItem } from '../../hooks/useChat'
import { useTheme } from '../../state/ThemeContext'
import { Icon } from '../../components/Icon'
import { SessionSidebar } from './SessionSidebar'
import { FileTree } from './FileTree'
import { MarkdownView, extractToc } from './MarkdownView'
import { CommandPalette, type Command } from './CommandPalette'
import { sessionToMarkdown } from '../../api/sessionExport'
import { Markdown } from './Markdown'
import { StepCard } from './StepCard'
import { PromptDialog, ConfirmDialog } from '../workspace/Dialogs'
import { SettingsDialog } from './SettingsDialog'
import { ToolsDialog } from './ToolsDialog'
import { StudioDialog } from './StudioDialog'
import { ChaptersPanel } from './ChaptersPanel'
import { LorePanel } from './LorePanel'
import { DiffView } from './DiffView'
import './AgentWorkspace.css'

/**
 * 主流 Agent 布局（ChatGPT/Claude/Cline 综合）：
 * [会话侧栏] [中央对话流：消息 + 工具步骤卡 + 悬浮输入] [Artifacts 文件面板（可折叠）]
 */
export function AgentWorkspace() {
  const { workRoot, workName, activePath, setActivePath, setError, closeWork } = useProject()
  const { theme, toggleTheme } = useTheme()
  const chat = useChat()
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [externalChange, setExternalChange] = useState<{ path: string; at: number } | null>(null)
  const [previewMode, setPreviewMode] = useState<'content' | 'history'>('content')
  const [skills, setSkills] = useState<Skill[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // 右侧文件面板默认常驻（对标主流 Agent 三栏）；极窄屏（<900px）才退化为覆盖抽屉
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<'tree' | 'chapters' | 'lore' | 'file'>('tree')
  const [dialog, setDialog] = useState<
    | { kind: 'new-file' }
    | { kind: 'new-dir' }
    | { kind: 'new-chapter' }
    | { kind: 'rename'; path: string; name: string }
    | { kind: 'delete'; path: string }
    | null
  >(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<'stats' | 'consistency' | 'lint' | 'import'>('stats')
  const [studioOpen, setStudioOpen] = useState(false)
  const [studioToolId, setStudioToolId] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [keyMissing, setKeyMissing] = useState(false)
  const savedSigRef = useRef('')
  const sessionIdRef = useRef<string | null>(null)

  const refreshTree = useCallback(async () => {
    if (!workRoot) return
    try {
      setTree(await listWorkspaceTree(8))
    } catch (e) {
      setError(`读取目录失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [workRoot, setError])

  useEffect(() => {
    void refreshTree()
  }, [refreshTree])

  useEffect(() => {
    void getSkills().then(setSkills).catch(() => setSkills([]))
  }, [])

  // 检查激活 Provider 是否已配 Key：未配则顶栏红点提醒
  useEffect(() => {
    void (async () => {
      try {
        const s = await getAppSettings()
        if (!s.providers.length) {
          setKeyMissing(true)
          return
        }
        const active = s.providers.find((p) => p.id === s.active_provider_id) ?? s.providers[0]
        setKeyMissing(!(await getApiKeyStatus(active.id).catch(() => false)))
      } catch {
        setKeyMissing(false)
      }
    })()
  }, [settingsOpen])

  useEffect(() => {
    let timer = 0
    const un = subscribeEvent('fs_changed', (raw) => {
      const p = (raw ?? {}) as { path?: string }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void refreshTree()
        if (p.path && activePath && p.path === activePath) {
          const changedPath = p.path
          void readText(activePath).then((c) => {
            setFileContent(c)
            // 非编辑态下文件被外部（Agent）修改时，给一条可关闭的提示
            setExternalChange((prev) => (prev?.path === changedPath ? prev : { path: changedPath, at: Date.now() }))
          }).catch(() => {})
        }
      }, 600)
    })
    return () => {
      window.clearTimeout(timer)
      un()
    }
  }, [refreshTree, activePath])

  useEffect(() => {
    setEditing(false)
    setPreviewMode('content')
    if (!activePath) {
      setFileContent('')
      return
    }
    let alive = true
    setFileLoading(true)
    readText(activePath)
      .then((c) => {
        if (!alive) return
        setFileContent(c)
        setFileLoading(false)
      })
      .catch((e) => {
        if (!alive) return
        setError(`读取失败：${e instanceof Error ? e.message : String(e)}`)
        setFileLoading(false)
      })
    return () => {
      alive = false
    }
  }, [activePath, setError])

  // Agent 提到文件 / 写文件 → 面板亮起
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1]
    if (last?.role === 'assistant' && (last.steps?.some((s) => s.writePath) || /`[^`]+\.(?:md|markdown|txt)`/.test(last.content))) {
      setPanelOpen(true)
    }
  }, [chat.messages])

  // ---- 会话持久化：流结束后自动保存；打开历史会话 ----
  useEffect(() => {
    if (chat.busy) {
      savedSigRef.current = '' // 新一轮流：待流结束后重新保存
      return
    }
    const msgs = chat.messages
    const hasAssistant = msgs.some((m) => m.role === 'assistant' && !m.streaming && (m.content.trim() || m.failed))
    if (!hasAssistant) return
    const sig = msgs.map((m) => `${m.role}:${m.content}`).join('\u0000')
    if (sig === savedSigRef.current) return
    savedSigRef.current = sig
    if (!sessionIdRef.current) {
      sessionIdRef.current = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setActiveSessionId(sessionIdRef.current)
    }
    const payload: ChatMessagePayload[] = msgs
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }))
    void saveChatSession({
      id: sessionIdRef.current,
      workspace_root: workRoot ?? '',
      messages: payload,
    })
      .catch(() => {})
  }, [chat.busy, chat.messages, workRoot])

  const loadSession = useCallback(
    async (id: string) => {
      try {
        const s = await getChatSession(id)
        sessionIdRef.current = id
        setActiveSessionId(id)
        savedSigRef.current = (s.messages ?? []).map((m) => `${m.role}:${m.content}`).join('\u0000')
        chat.restore((s.messages ?? []).map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: String(m.content ?? '') })))
      } catch {
        /* ignore */
      }
    },
    [chat],
  )

  const newSession = useCallback(() => {
    sessionIdRef.current = null
    setActiveSessionId(null)
    savedSigRef.current = ''
    chat.clear()
  }, [chat])

  /** 删除历史会话；若删的是当前会话则同时清空对话区 */
  const deleteSession = useCallback(
    async (id: string) => {
      await deleteChatSession(id)
      if (sessionIdRef.current === id) {
        sessionIdRef.current = null
        setActiveSessionId(null)
        savedSigRef.current = ''
        chat.clear()
      }
    },
    [chat],
  )

  // Ctrl+K / Cmd+K 打开命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paletteCommands = useMemo<Command[]>(() => [
    { id: 'new-session', icon: 'plus', label: '新建会话', hint: 'Ctrl+K 后回车', run: newSession },
    { id: 'new-chapter', icon: 'file-plus', label: '新建章节', keywords: 'chapter 写作', run: () => setDialog({ kind: 'new-chapter' }) },
    { id: 'new-file', icon: 'file-plus', label: '新建 Markdown 文件', keywords: 'file create', run: () => setDialog({ kind: 'new-file' }) },
    { id: 'new-dir', icon: 'folder-plus', label: '新建目录', keywords: 'folder mkdir', run: () => setDialog({ kind: 'new-dir' }) },
    { id: 'studio', icon: 'sparkles', label: '创作工坊', keywords: 'studio 工坊 创作 头脑风暴 场景 对话 润色 翻译 摘要', run: () => { setStudioToolId(null); setStudioOpen(true) } },
    { id: 'studio-brainstorm', icon: 'sparkles', label: '工坊：头脑风暴', keywords: '工坊 点子 创意 brainstorm', run: () => { setStudioToolId('brainstorm'); setStudioOpen(true) } },
    { id: 'studio-polish', icon: 'pencil', label: '工坊：润色文本', keywords: '工坊 润色 polish 改写', run: () => { setStudioToolId('polish'); setStudioOpen(true) } },
    { id: 'studio-critique', icon: 'search', label: '工坊：专业评审', keywords: '工坊 评审 critique 编辑', run: () => { setStudioToolId('critique'); setStudioOpen(true) } },
    { id: 'tools-stats', icon: 'chart', label: '作品统计', keywords: '工具 stats 统计', run: () => { setToolsTab('stats'); setToolsOpen(true) } },
    { id: 'tools-consistency', icon: 'list-checks', label: '一致性检查', keywords: '工具 检查 consistency 人物 伏笔 情节线', run: () => { setToolsTab('consistency'); setToolsOpen(true) } },
    { id: 'tools-lint', icon: 'scale', label: '正文铁律体检', keywords: '工具 lint 体检 套路', run: () => { setToolsTab('lint'); setToolsOpen(true) } },
    { id: 'tools-import', icon: 'file-input', label: '导入切章', keywords: '工具 导入 import txt 切章', run: () => { setToolsTab('import'); setToolsOpen(true) } },
    { id: 'toggle-panel', icon: 'panel-right', label: panelOpen ? '隐藏文件面板' : '显示文件面板', keywords: 'panel 文件', run: () => setPanelOpen((v) => !v) },
    { id: 'toggle-sidebar', icon: 'panel-left', label: sidebarCollapsed ? '展开会话栏' : '折叠会话栏', keywords: 'sidebar 会话', run: () => setSidebarCollapsed((v) => !v) },
    { id: 'toggle-theme', icon: theme === 'dark' ? 'sun' : 'moon', label: '切换主题', keywords: 'theme dark light 主题', run: toggleTheme },
    { id: 'settings', icon: 'settings', label: '打开设置', keywords: 'settings provider key 设置', run: () => setSettingsOpen(true) },
    {
      id: 'export-md',
      icon: 'download',
      label: '导出整本（Markdown）',
      keywords: 'export 导出',
      run: () => {
        void exportWork('md').then(({ filename, content }) => downloadText(filename, content))
      },
    },
    {
      id: 'export-txt',
      icon: 'download',
      label: '导出整本（TXT）',
      keywords: 'export 导出',
      run: () => {
        void exportWork('txt').then(({ filename, content }) => downloadText(filename, content))
      },
    },
    { id: 'close-work', icon: 'log-out', label: '关闭工程（返回启动页）', keywords: 'close launch', run: closeWork },
  ], [newSession, panelOpen, sidebarCollapsed, theme, toggleTheme, closeWork, setToolsTab])

  const mdFiles = useMemo(() => {
    const out: FsEntry[] = []
    const walk = (e: FsEntry) => {
      if (e.kind === 'file' && /\.(md|markdown|txt)$/i.test(e.path)) out.push(e)
      for (const c of e.children ?? []) walk(c)
    }
    if (tree) walk(tree)
    return out
  }, [tree])

  const jumpToFile = useCallback(
    (p: string) => {
      const hit = mdFiles.find((f) => f.path === p || f.path.endsWith(`/${p}`) || f.name === p)
      if (hit) {
        setActivePath(hit.path)
        setPanelOpen(true)
        setPanelTab('file')
      }
    },
    [mdFiles, setActivePath],
  )

  const runDialog = useCallback(
    async (action: typeof dialog, value: string) => {
      if (!action) return
      try {
        if (action.kind === 'new-file') {
          await createFile(value)
          await refreshTree()
          setActivePath(value)
          setPanelTab('file')
        } else if (action.kind === 'new-chapter') {
          const existing = await listChapters()
          const p = await createChapterFile(value.trim() || `第${existing.length + 1}章`)
          await refreshTree()
          setActivePath(p)
          setPanelTab('file')
        } else if (action.kind === 'new-dir') {
          await createDir(value)
          await refreshTree()
        } else if (action.kind === 'rename') {
          const idx = action.path.lastIndexOf('/')
          const to = idx >= 0 ? `${action.path.slice(0, idx)}/${value}` : value
          await renameEntry(action.path, to)
          if (activePath === action.path) setActivePath(to)
          await refreshTree()
        } else if (action.kind === 'delete') {
          await del(action.path)
          if (activePath === action.path) setActivePath(null)
          await refreshTree()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setDialog(null)
      }
    },
    [activePath, refreshTree, setActivePath, setError],
  )

  const saveEdit = useCallback(async () => {
    if (!activePath) return
    try {
      await writeText(activePath, editDraft)
      setFileContent(editDraft)
      setEditing(false)
      void refreshTree()
    } catch (e) {
      setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [activePath, editDraft, refreshTree, setError])

  return (
    <div className="agw">
      <header className="agw-head">
        <span className="agw-name">{workName}</span>
        <span className="agw-badge">Agent</span>
        <span className="agw-spacer" />
        <button className="agw-iconbtn" onClick={() => setPaletteOpen(true)} title="命令面板（Ctrl+K）">
          <Icon name="command" size={17} />
        </button>
        <button className="agw-iconbtn" onClick={() => { setStudioToolId(null); setStudioOpen(true) }} title="创作工坊：头脑风暴 / 场景 / 对话 / 润色等 AI 快捷创作">
          <Icon name="sparkles" size={16} />
        </button>
        <button className="agw-iconbtn" onClick={() => setToolsOpen(true)} title="工具中心：统计 / 一致性 / 铁律 / 导入切章">
          <Icon name="wrench" size={17} />
        </button>
        <button className="agw-iconbtn" onClick={() => setSettingsOpen(true)} title="模型与密钥设置">
          <Icon name="settings" size={17} />
          {keyMissing ? <span className="agw-dot" /> : null}
        </button>
        <button className="agw-iconbtn" onClick={toggleTheme} title="切换主题">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
        </button>
        <span className="agw-head-sep" />
        <button className="agw-btn" onClick={() => setPanelOpen((v) => !v)}>
          <Icon name="panel-right" size={15} />
          {panelOpen ? '隐藏面板' : '文件面板'}
        </button>
      </header>

      <div className="agw-main">
        <SessionSidebar
          activeSessionId={activeSessionId}
          onNewSession={newSession}
          onLoadSession={loadSession}
          onDeleteSession={(id) => void deleteSession(id)}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
        />

        <ChatColumn chat={chat} skills={skills} workName={workName} onJumpFile={jumpToFile} onOpenSettings={() => setSettingsOpen(true)} />

        {panelOpen ? (
          <aside className="agw-side glass-panel">
            <div className="agw-side-tabs">
              <button className={panelTab === 'tree' ? 'active' : ''} onClick={() => setPanelTab('tree')}>文件</button>
              <button className={panelTab === 'chapters' ? 'active' : ''} onClick={() => setPanelTab('chapters')}>章节</button>
              <button className={panelTab === 'lore' ? 'active' : ''} onClick={() => setPanelTab('lore')}>设定</button>
              <button className={panelTab === 'file' ? 'active' : ''} disabled={!activePath} onClick={() => setPanelTab('file')}>预览</button>
              <span className="agw-side-spacer" />
              <button className="agw-iconbtn sm" title="新建文件" onClick={() => setDialog({ kind: 'new-file' })}><Icon name="file-plus" size={15} /></button>
              <button className="agw-iconbtn sm" title="新建目录" onClick={() => setDialog({ kind: 'new-dir' })}><Icon name="folder-plus" size={15} /></button>
            </div>

            {panelTab === 'tree' ? (
              <div className="agw-tree">
                {tree ? (
                  <FileTree
                    entry={tree}
                    activePath={activePath}
                    onOpen={(p) => {
                      setActivePath(p)
                      setPanelTab('file')
                    }}
                    onRename={(p) => setDialog({ kind: 'rename', path: p, name: p.split('/').pop() ?? p })}
                    onDelete={(p) => setDialog({ kind: 'delete', path: p })}
                  />
                ) : (
                  <div className="agw-empty">加载中…</div>
                )}
              </div>
            ) : panelTab === 'lore' ? (
              <LorePanel
                activePath={activePath}
                onOpen={(p) => {
                  setActivePath(p)
                  setPanelTab('file')
                }}
              />
            ) : panelTab === 'chapters' ? (
              <ChaptersPanel
                activePath={activePath}
                onOpen={(p) => {
                  setActivePath(p)
                  setPanelTab('file')
                }}
                onNewChapter={() => setDialog({ kind: 'new-chapter' })}
                onImport={() => {
                  setToolsTab('import')
                  setToolsOpen(true)
                }}
              />
            ) : (
              <div className="agw-file">
                {activePath ? (
                  <>
                    <div className="agw-file-head">
                      <span className="agw-file-path">{activePath}</span>
                      <span className="agw-file-actions">
                        {editing ? (
                          <>
                            <button className="agw-btn primary" onClick={() => void saveEdit()}>保存</button>
                            <button className="agw-btn" onClick={() => setEditing(false)}>取消</button>
                          </>
                        ) : (
                          <>
                            <button className="agw-btn" onClick={() => { setEditDraft(fileContent); setEditing(true) }}>编辑</button>
                            <button className="agw-btn" onClick={() => window.dispatchEvent(new CustomEvent('agent-attach-file', { detail: activePath }))} title="作为 Agent 上下文">给 Agent</button>
                            <button className="agw-btn" onClick={() => setPreviewMode('history')} title="变更历史与版本恢复">历史</button>
                          </>
                        )}
                      </span>
                    </div>
                    {externalChange && externalChange.path === activePath && !editing ? (
                      <div className="agw-external-note">
                        <span><Icon name="refresh" size={13} /> 此文件刚被更新（可能来自 Agent 写入）</span>
                        <button onClick={() => setExternalChange(null)}>知道了</button>
                      </div>
                    ) : null}
                    <div className="agw-file-body">
                      {previewMode === 'history' && activePath ? (
                        <DiffView
                          path={activePath}
                          currentContent={fileContent}
                          onClose={() => setPreviewMode('content')}
                          onRestored={() => {
                            void readText(activePath).then(setFileContent).catch(() => {})
                            void refreshTree()
                          }}
                        />
                      ) : fileLoading ? (
                        <div className="agw-empty">加载中…</div>
                      ) : editing ? (
                        <textarea
                          className="agw-editor"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                              e.preventDefault()
                              void saveEdit()
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <FilePreviewWithToc content={fileContent} />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="agw-empty">未选择文件</div>
                )}
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {dialog?.kind === 'new-file' ? (
        <PromptDialog title="新建 Markdown 文件" placeholder="outline/ch-0002.md" onConfirm={(v: string) => void runDialog(dialog, v)} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'new-dir' ? (
        <PromptDialog title="新建目录" placeholder="concept" onConfirm={(v: string) => void runDialog(dialog, v)} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'new-chapter' ? (
        <PromptDialog title="新建章节" placeholder="第3章 灯塔（留空自动编号）" onConfirm={(v: string) => void runDialog(dialog, v)} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'rename' ? (
        <PromptDialog title="重命名" initialValue={dialog.name} onConfirm={(v: string) => void runDialog(dialog, v)} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog title="删除确认" message={`确认删除 ${dialog.path}？`} danger onConfirm={() => void runDialog(dialog, '')} onCancel={() => setDialog(null)} />
      ) : null}

      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {paletteOpen ? <CommandPalette commands={paletteCommands} onClose={() => setPaletteOpen(false)} /> : null}
      {toolsOpen ? (
        <ToolsDialog
          initialTab={toolsTab}
          onClose={() => setToolsOpen(false)}
          onOpenFile={(p) => {
            jumpToFile(p)
            setToolsOpen(false)
          }}
        />
      ) : null}
      {studioOpen ? (
        <StudioDialog
          initialToolId={studioToolId ?? undefined}
          activePath={activePath}
          activeContent={fileContent}
          onInsertToEditor={(text) => {
            setEditDraft((d) => (d ? `${d}\n\n${text}` : text))
            setEditing(true)
          }}
          onClose={() => setStudioOpen(false)}
        />
      ) : null}
    </div>
  )
}

/* ============ 中央对话列 ============ */
function ChatColumn({
  chat,
  skills,
  workName,
  onJumpFile,
  onOpenSettings,
}: {
  chat: ReturnType<typeof useChat>
  skills: Skill[]
  workName: string
  onJumpFile: (p: string) => void
  onOpenSettings: () => void
}) {
  const [input, setInput] = useState('')
  const [skillId, setSkillId] = useState('')
  const [attach, setAttach] = useState<{ path: string; content: string } | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const handler = async (e: Event) => {
      const path = (e as CustomEvent<string>).detail
      if (!path) return
      try {
        const { readText } = await import('../../api/backend')
        setAttach({ path, content: await readText(path) })
        taRef.current?.focus()
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('agent-attach-file', handler)
    return () => window.removeEventListener('agent-attach-file', handler)
  }, [])

  useEffect(() => {
    // 仅当用户在底部附近才自动跟随；往上翻阅时保持视口（流式时不打扰）
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (near || atBottom) el.scrollTo({ top: el.scrollHeight })
  }, [chat.messages]) // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text) return
    if (chat.busy) return
    setInput('')
    // 重置自动增高高度
    if (taRef.current) taRef.current.style.height = 'auto'
    const skill = skillId ? skills.find((s) => s.id === skillId) : null
    const parts: string[] = [
      `你是运行在用户本地作品目录中的写作 Agent（ReAct 循环，可调用 fs_list_dir / fs_read_text / fs_write_text 等工具）。所有产出都是 Markdown 文件，写入工程目录；先看再写；回复用 Markdown，提到文件路径用反引号。当前作品：${workName}。`,
    ]
    if (skill?.prompt) parts.push(`<技能规范：${skill.name}>\n${skill.prompt}\n</技能规范>`)
    if (attach) parts.push(`<附带文件：${attach.path}>\n${attach.content}\n</附带文件>`)
    void chat.send(text, { systemPrompt: parts.join('\n\n') })
    setAttach(null)
  }, [attach, chat, input, skillId, skills, workName])

  const retryLast = useCallback(() => {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser || chat.busy) return
    const skill = skillId ? skills.find((s) => s.id === skillId) : null
    const parts = [`你是运行在用户本地作品目录中的写作 Agent。回复用 Markdown；文件路径用反引号。当前作品：${workName}。`]
    if (skill?.prompt) parts.push(skill.prompt)
    chat.resendFrom(lastUser.content, { systemPrompt: parts.join('\n\n') })
  }, [chat, skillId, skills, workName])

  return (
    <div className="chatcol">
      <div className="chatcol-scroll" ref={listRef} onScroll={onScroll}>
        <div className="chatcol-inner">
          {chat.messages.length === 0 ? (
            <div className="chatcol-hero">
              <h2>{workName}</h2>
              <p>对 Agent 说要做什么。它会读目录、写 Markdown，过程逐步可见。</p>
              <div className="chatcol-samples">
                {[
                  '读一下整个目录，总结当前工程结构',
                  '根据已有内容，写下一章到 stories/ 里',
                  '检查人物设定与正文是否一致，输出报告 concept/consistency.md',
                ].map((s) => (
                  <button key={s} className="chatcol-sample" onClick={() => { setInput(s); taRef.current?.focus() }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {chat.messages.map((m) => (
            <MessageRow key={m.id} m={m} onJumpFile={onJumpFile} onRetry={retryLast} canRetry={!chat.busy} onOpenSettings={onOpenSettings} />
          ))}
        </div>
      </div>
      {chat.messages.length > 0 ? (
        <div className="chatcol-sessionbar">
          <span className="csb-count">{chat.messages.filter((m) => m.role === 'user').length} 问 · {chat.messages.filter((m) => m.role === 'assistant').length} 答</span>
          <button
            className="csb-export"
            title="导出会话为 Markdown 分享稿"
            onClick={() => {
              const md = sessionToMarkdown({ workName, messages: chat.messages })
              downloadText(`${workName}-会话记录.md`, md)
            }}
          >
            <Icon name="download" size={13} />
            导出会话
          </button>
        </div>
      ) : null}
      {!atBottom && chat.messages.length > 0 ? (
        <button
          className="chatcol-jumpdown"
          title="滚动到底部"
          onClick={() => {
            const el = listRef.current
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
            setAtBottom(true)
          }}
        >
          <Icon name="arrow-down" size={16} />
        </button>
      ) : null}

      <div className="composer glass-float">
        {attach ? (
          <div className="composer-attach">
            <Icon name="paperclip" size={13} />
            <span title={attach.path}>{attach.path}</span>
            <button onClick={() => setAttach(null)} title="移除附件"><Icon name="x" size={13} /></button>
          </div>
        ) : null}
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            // 自动增高（上限 ~10 行）
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 220)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="给 Agent 下指令…（Enter 发送，Shift+Enter 换行）"
          rows={2}
        />
        <div className="composer-tools">
          <select className="composer-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)} title="写作技能">
            <option value="">通用写作</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="composer-spacer" />
          {input.length > 0 ? <span className="composer-count">{input.length} 字</span> : null}
          {chat.busy ? (
            <button className="composer-btn stop" onClick={chat.cancel}>停止</button>
          ) : (
            <button className="composer-btn send" disabled={!input.trim()} onClick={send} title="发送（Enter）">
              <Icon name="arrow-up" size={17} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageRow({ m, onJumpFile, onRetry, canRetry, onOpenSettings }: { m: ChatItem; onJumpFile: (p: string) => void; onRetry: () => void; canRetry: boolean; onOpenSettings: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(m.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`msg-row ${m.role}`}>
      <div className={`msg ${m.role} ${m.failed ? 'failed' : ''}`}>
        {m.role === 'assistant' ? (
          <>
            {m.steps && m.steps.length > 0 ? (
              <div className="msg-steps">
                {m.steps.map((s) => (
                  <StepCard key={s.actionId} step={s} onOpenFile={onJumpFile} />
                ))}
              </div>
            ) : null}
            <Markdown content={m.content} />
            {m.streaming && !m.content && (!m.steps || m.steps.length === 0) ? <span className="msg-typing" aria-label="正在输入" /> : null}
          </>
        ) : (
          <p className="msg-user-text">{m.content}</p>
        )}
        {m.failed ? (
          <div className="msg-error">
            <span>{m.failed}</span>
            <button className="msg-error-action" onClick={onOpenSettings}>打开设置 →</button>
          </div>
        ) : null}
        {m.role === 'assistant' && !m.streaming && m.content ? (
          <div className="msg-actions">
            <button onClick={copy}>{copied ? '已复制' : '复制'}</button>
            {canRetry ? <button onClick={onRetry}>重新生成</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** 文件预览：TOC 折叠条 + Markdown 正文（标题带锚点，点击目录平滑跳转） */
function FilePreviewWithToc({ content }: { content: string }) {
  const [tocOpen, setTocOpen] = useState(false)
  const toc = useMemo(() => extractToc(content), [content])
  if (toc.length < 2) return <MarkdownView content={content} />
  return (
    <div className="mdv-with-toc">
      <button className="mdv-toc-toggle" onClick={() => setTocOpen((v) => !v)}>
        <span className={`mdv-toc-arrow ${tocOpen ? 'open' : ''}`}><Icon name="chevron-right" size={12} /></span>
        目录（{toc.length}）
      </button>
      {tocOpen ? (
        <nav className="mdv-toc">
          {toc.map((t, i) => (
            <button
              key={i}
              className={`mdv-toc-item lvl${t.lvl}`}
              onClick={() => {
                document.getElementById(t.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              {t.text}
            </button>
          ))}
        </nav>
      ) : null}
      <MarkdownView content={content} />
    </div>
  )
}
