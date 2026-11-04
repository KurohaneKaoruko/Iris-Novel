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
  /** 轻量错误上抛（可选，缺省用 alert） */
  onError?: (msg: string) => void
}

function sessionTitleOf(messages: ChatItem[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  return firstUser ? firstUser.content.slice(0, 30) : '新会话'
}

export function ChatPanel({ chat, assistantId, onAssistantChange, activePath, onError }: ChatPanelProps) {
  const { workRoot } = useWork()
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [skills, setSkills] = useState<Skill[]>([])
  const [skillId, setSkillId] = useState<string>('')
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<Array<{ id: string; title: string }>>([])
  const listRef = useRef<HTMLDivElement>(null)
  const savedLenRef = useRef(0)

  useEffect(() => {
    void getAppSettings()
      .then(setSettings)
      .catch(() => setSettings(null))
    void getSkills()
      .then(setSkills)
      .catch(() => setSkills([]))
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
        const msgs = (s.messages ?? []).map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: String(m.content ?? ''),
        }))
        chat.restore(msgs)
        savedLenRef.current = 0
        setShowHistory(false)
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
    // /skill <id> <prompt> 指令：把该技能写作规范注入本次请求（后续轮次也保持）
    const m = text.match(/^\/skill\s+(\S+)\s*([\s\S]*)$/)
    if (m) {
      const [, id, rest] = m
      const skill = skills.find((s) => s.id === id || s.name === id)
      if (!skill) {
        onError?.(`未找到技能「${id}」`)
        return
      }
      setSkillId(skill.id)
      const prompt = rest.trim()
      if (!prompt) {
        onError?.(`已切换到技能「${skill.name}」，请继续输入写作要求`)
        return
      }
      void chat.send(prompt, { assistantId, systemPrompt: skill.prompt })
      return
    }
    void chat.send(text, { assistantId, systemPrompt: skillId ? skills.find((s) => s.id === skillId)?.prompt : undefined })
  }, [assistantId, chat, input, onError, skillId, skills])

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
          <select
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            title="写作技能：注入该技能的写作规范"
          >
            <option value="">无技能</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.category ? `[${s.category}] ` : ''}{s.name}
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
