import { useCallback, useEffect, useRef, useState } from 'react'
import type { useChat, ChatItem } from '../../hooks/useChat'
import type { AppSettings, Skill } from '../../api/backend'
import { getAppSettings, getSkills, saveChatSession, listChatSessions, getChatSession } from '../../api/backend'
import { listCharacters, type Character } from '../../api/novel'
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
  const [characters, setCharacters] = useState<Character[]>([])
  const [roleId, setRoleId] = useState<string>('')
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

  // 作品人物卡（角色扮演选择器）
  useEffect(() => {
    setRoleId('')
    if (!workRoot) {
      setCharacters([])
      return
    }
    void listCharacters()
      .then(setCharacters)
      .catch(() => setCharacters([]))
  }, [workRoot])

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
    // /role <名> 指令：切换角色扮演（/role off 退出）
    const rm = text.match(/^\/role\s+(.+)$/)
    if (rm) {
      const name = rm[1].trim()
      if (name === 'off' || name === '退出') {
        setRoleId('')
        onError?.('已退出角色扮演')
        return
      }
      const role = characters.find((c) => c.name === name || c.id === name)
      if (!role) {
        onError?.(`人物卡里没有「${name}」`)
        return
      }
      setRoleId(role.id)
      onError?.(`已进入角色扮演「${role.name}」，对话将以该角色身份回应`)
      return
    }
    void chat.send(text, { assistantId, systemPrompt: buildSystemPrompt() })
  }, [assistantId, chat, input, onError, skillId, skills, roleId, characters])

  /** 组装 system prompt：技能规范 + 角色扮演人设 */
  const buildSystemPrompt = useCallback((): string | undefined => {
    const parts: string[] = []
    const skill = skillId ? skills.find((s) => s.id === skillId) : null
    if (skill?.prompt) parts.push(skill.prompt)
    const role = roleId ? characters.find((c) => c.id === roleId) : null
    if (role) {
      const d = role.data
      const traits = [d.appearance && `外貌：${d.appearance}`, d.personality && `性格：${d.personality}`, d.background && `背景：${d.background}`, d.relationships && `关系：${d.relationships}`]
        .filter(Boolean)
        .join('；')
      parts.push(
        `你现在扮演小说角色「${role.name}」，以第一人称与用户对话，始终保持在角色内，不跳出设定、不承认自己是 AI。` +
        (traits ? `人设：${traits}。` : '') +
        (d.notes ? `备注：${d.notes}。` : '') +
        '说话风格贴合人物性格与背景；遇到角色不可能知道的信息，用角色的方式回避或追问。',
      )
    }
    return parts.length > 0 ? parts.join('\n\n') : undefined
  }, [skillId, skills, roleId, characters])

  // /role 指令在 handleSend 内处理

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
          {characters.length > 0 ? (
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              title="角色扮演：以人物卡身份对话（测声线）"
            >
              <option value="">不扮演</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>🎭 {c.name}</option>
              ))}
            </select>
          ) : null}
          {activePath ? <span className="chat-file-chip">{activePath.split('/').pop()}</span> : null}
        </div>
        <div className="chat-input-row">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={roleId ? `以「${characters.find((c) => c.id === roleId)?.name ?? ''}」的身份对话中…` : '输入消息，Enter 发送，Shift+Enter 换行'}
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
