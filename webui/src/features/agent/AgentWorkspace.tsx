import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FsEntry } from '../../api/backend'
import { createDir, createFile, listWorkspaceTree, readText, renameEntry, deleteEntry as del, writeText, getSkills, getChatSession, saveChatSession, deleteChatSession, getAppSettings, getApiKeyStatus, type Skill, type ChatMessagePayload } from '../../api/backend'
import { listChapters, createChapterFile } from '../../api/novel'
import { subscribeEvent } from '../../api/rpc'
import { useProject } from '../../state/ProjectContext'
import { useChat, type ChatItem } from '../../hooks/useChat'
import { useTheme } from '../../state/ThemeContext'
import { SessionSidebar } from './SessionSidebar'
import { FileTree } from './FileTree'
import { MarkdownView } from './MarkdownView'
import { Markdown } from './Markdown'
import { StepCard } from './StepCard'
import { PromptDialog, ConfirmDialog } from '../workspace/Dialogs'
import { SettingsDialog } from './SettingsDialog'
import { ToolsDialog } from './ToolsDialog'
import { ChaptersPanel } from './ChaptersPanel'
import './AgentWorkspace.css'

/**
 * 主流 Agent 布局（ChatGPT/Claude/Cline 综合）：
 * [会话侧栏] [中央对话流：消息 + 工具步骤卡 + 悬浮输入] [Artifacts 文件面板（可折叠）]
 */
export function AgentWorkspace() {
  const { workRoot, workName, activePath, setActivePath, setError } = useProject()
  const { theme, toggleTheme } = useTheme()
  const chat = useChat()
  const [tree, setTree] = useState<FsEntry | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // 窄屏（<1100px）面板是覆盖抽屉，默认收起，避免遮挡输入区
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 1100)
  const [panelTab, setPanelTab] = useState<'tree' | 'chapters' | 'file'>('tree')
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
          void readText(activePath).then(setFileContent).catch(() => {})
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
        <button className="agw-btn" onClick={() => setToolsOpen(true)} title="统计 / 一致性检查 / 正文体检 / 导入切章">
          工具
        </button>
        <button className="agw-btn" onClick={() => setSettingsOpen(true)} title="模型与密钥设置">
          设置{keyMissing ? <span className="agw-dot" /> : null}
        </button>
        <button className="agw-btn" onClick={toggleTheme} title="切换主题">{theme === 'dark' ? '🌙' : '☀️'}</button>
        <button className="agw-btn" onClick={() => setPanelOpen((v) => !v)}>{panelOpen ? '隐藏文件' : '文件'}</button>
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
              <button className={panelTab === 'file' ? 'active' : ''} disabled={!activePath} onClick={() => setPanelTab('file')}>预览</button>
              <span className="agw-side-spacer" />
              <button className="agw-icon-btn" title="新建文件" onClick={() => setDialog({ kind: 'new-file' })}>＋</button>
              <button className="agw-icon-btn" title="新建目录" onClick={() => setDialog({ kind: 'new-dir' })}>＋📁</button>
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
            ) : panelTab === 'chapters' ? (
              <ChaptersPanel
                activePath={activePath}
                onOpen={(p) => {
                  setActivePath(p)
                  setPanelTab('file')
                }}
                onNewChapter={() => setDialog({ kind: 'new-chapter' })}
                onImport={() => {
                  setToolsOpen(true)
                  setPanelTab('tree')
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
                          </>
                        )}
                      </span>
                    </div>
                    <div className="agw-file-body">
                      {fileLoading ? (
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
                        <MarkdownView content={fileContent} />
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
      {toolsOpen ? (
        <ToolsDialog
          onClose={() => setToolsOpen(false)}
          onOpenFile={(p) => {
            jumpToFile(p)
            setToolsOpen(false)
          }}
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
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [chat.messages])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || chat.busy) return
    setInput('')
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
      <div className="chatcol-scroll" ref={listRef}>
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

      <div className="composer glass-float">
        {attach ? (
          <div className="composer-attach">
            📎 <span title={attach.path}>{attach.path}</span>
            <button onClick={() => setAttach(null)}>✕</button>
          </div>
        ) : null}
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="给 Agent 下指令…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          disabled={chat.busy}
        />
        <div className="composer-tools">
          <select className="composer-skill" value={skillId} onChange={(e) => setSkillId(e.target.value)} title="写作技能">
            <option value="">通用写作</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <span className="composer-spacer" />
          {chat.busy ? (
            <button className="composer-btn stop" onClick={chat.cancel}>停止</button>
          ) : (
            <button className="composer-btn send" disabled={!input.trim()} onClick={send}>↑</button>
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
            {m.streaming && !m.content && (!m.steps || m.steps.length === 0) ? <span className="msg-typing">● ● ●</span> : null}
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
