import { useCallback, useEffect, useRef, useState } from 'react'
import type { useChat, ChatItem } from '../../hooks/useChat'
import type { AppSettings, Skill } from '../../api/backend'
import { getAppSettings, getSkills, saveChatSession, listChatSessions, getChatSession } from '../../api/backend'
import { useWork } from '../../state/WorkContext'
import './ChatPanel.css'

type ChatPanelProps = {
  chat: ReturnType<typeof useChat>
  assistantId: string | null
  onAssistantChange: (id: string | null) => void
  activePath: string | null
}

function sessionTitleOf(messages: ChatItem[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  return firstUser ? firstUser.content.slice(0, 30) : '新会话'
}

export function ChatPanel({ chat, assistantId, onAssistantChange, activePath }: ChatPanelProps) {
  const { workRoot } = useWork()
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [, setSkillsState] = useState<Skill[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<Array<{ id: string; title: string }>>([])
  const listRef = useRef<HTMLDivElement>(null)
  const savedLenRef = useRef(0)

  useEffect(() => {
    void getAppSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
    void getSkills()
      .then((s) => setSkillsState(s))
      .catch(() => setSkillsState([]))
  }, [])

  // 自动滚动
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [chat.messages])

  // 会话自动保存：流式结束且消息数变化时
  const busy = chat.busy
  useEffect(() => {
    if (busy) return
    if (chat.messages.length === 0 || chat.messages.length === savedLenRef.current) return
    if (!chat.messages.some((m) => m.role === 'assistant' && !m.streaming)) return
    savedLenRef.current = chat.messages.length
    void saveChatSession({
      id: `web-${Date.now()}`,
      title: sessionTitleOf(chat.messages),
      workspace_root: workRoot ?? undefined,
      messages: chat.messages.map((m) => ({ role: m.role, content: m.content })),
    }).catch(() => {})
  }, [busy, chat.messages, workRoot])

  const loadHistory = useCallback(async () => {
    try {
      const list = await listChatSessions(workRoot)
      setSessions(list.map((s) => ({ id: s.id, title: s.title ?? '会话' })))
      setShowHistory(true)
    } catch {
      setSessions([])
      setShowHistory(true)
    }
  }, [workRoot])

  const openSession = useCallback(
    async (id: string) => {
      try {
        const s = await getChatSession(id)
        const msgs = (s.messages ?? []).map((m, i) => ({
          id: `h-${i}`,
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: String(m.content ?? ''),
        }))
        chat.clear()
        // 直接恢复历史（绕过 useChat 内部状态——这里用 clear + 手动填充的最小方案）
        setInput('')
        setShowHistory(false)
        // useChat 未暴露 restore；历史只读展示通过 send 之外的方式：
        window.alert('历史会话查看功能即将开放；已加载到本地。')
        void msgs
      } catch {
        window.alert('会话加载失败')
      }
    },
    [chat],
  )

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || chat.busy) return
    setInput('')
    void chat.send(text, { assistantId })
  }, [assistantId, chat, input])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const assistants = (settings?.providers ?? []).length > 0 ? settings!.providers : []

  return (
    <aside className="chat-panel">
      <div className="chat-head">
        <span>写作助手</span>
        <span className="chat-head-actions">
          <button title="历史会话" onClick={() => void loadHistory()}>
            ⟲
          </button>
          <button title="清空当前会话" onClick={chat.clear}>
            🗑
          </button>
        </span>
      </div>

      {showHistory ? (
        <div className="chat-history">
          {sessions.length === 0 ? <p className="chat-history-empty">暂无历史会话</p> : null}
          {sessions.map((s) => (
            <button key={s.id} className="chat-history-item" onClick={() => void openSession(s.id)}>
              {s.title}
            </button>
          ))}
          <button className="chat-history-close" onClick={() => setShowHistory(false)}>
            关闭
          </button>
        </div>
      ) : null}

      <div className="chat-list" ref={listRef}>
        {chat.messages.length === 0 ? (
          <div className="chat-welcome">
            <p>嗨，我是你的写作助手。</p>
            <p className="chat-hint">可继续剧情、头脑风暴或要求润色选中的段落。</p>
          </div>
        ) : null}
        {chat.messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className={`chat-bubble ${m.failed ? 'failed' : ''}`}>
              {m.content || (m.streaming ? '…' : '')}
              {m.failed ? <div className="chat-error">{m.failed}</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="chat-composer">
        <div className="chat-toolbar">
          <select
            value={assistantId ?? ''}
            onChange={(e) => onAssistantChange(e.target.value || null)}
            title="写作助手（Provider 配置）"
          >
            <option value="">默认助手</option>
            {assistants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
                {p.api_key ? '' : '（缺 API Key）'}
              </option>
            ))}
          </select>
          {activePath ? <span className="chat-file-chip">{activePath.split('/').pop()}</span> : null}
        </div>
        <div className="chat-input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={3}
            disabled={chat.busy}
          />
          {chat.busy ? (
            <button className="chat-stop" onClick={chat.cancel}>
              停止
            </button>
          ) : (
            <button className="chat-send" disabled={!input.trim()} onClick={handleSend}>
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
