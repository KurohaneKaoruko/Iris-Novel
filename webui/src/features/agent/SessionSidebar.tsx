import { useCallback, useEffect, useState } from 'react'
import { listChatSessions, type ChatSessionSummary } from '../../api/backend'
import { useProject } from '../../state/ProjectContext'
import { Icon } from '../../components/Icon'
import './SessionSidebar.css'

type SessionSidebarProps = {
  activeSessionId: string | null
  onNewSession: () => void
  onLoadSession: (id: string) => void
  onDeleteSession: (id: string) => void
  collapsed: boolean
  onToggle: () => void
}

/** 左侧会话栏（ChatGPT 式）：新建会话 / 历史会话 / 工程信息 / 折叠 */
export function SessionSidebar({ activeSessionId, onNewSession, onLoadSession, onDeleteSession, collapsed, onToggle }: SessionSidebarProps) {
  const { workRoot, workName, closeWork } = useProject()
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setSessions(await listChatSessions(workRoot))
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [workRoot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 会话保存后（activeSessionId 变化 / 新会话）刷新列表
  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 400)
    return () => window.clearTimeout(t)
  }, [activeSessionId, refresh])

  if (collapsed) {
    return (
      <aside className="sss collapsed">
        <button className="sss-expand" onClick={onToggle} title="展开会话栏"><Icon name="chevrons-right" size={15} /></button>
        <button className="sss-new-mini" onClick={onNewSession} title="新建会话"><Icon name="plus" size={16} /></button>
      </aside>
    )
  }

  return (
    <aside className="sss">
      <div className="sss-head">
        <span className="sss-work" title={workRoot ?? ''}>{workName}</span>
        <button className="sss-collapse" onClick={onToggle} title="折叠会话栏"><Icon name="chevrons-left" size={15} /></button>
      </div>

      <button className="sss-new" onClick={onNewSession} title="新建会话">
        <Icon name="square-pen" size={14} />
        新建会话
      </button>

      <div className="sss-list">
        <div className="sss-section">历史会话{loading ? '…' : `（${sessions.length}）`}</div>
        {sessions.length === 0 && !loading ? <div className="sss-empty">暂无历史会话</div> : null}
        {sessions.map((s) => {
          const confirming = confirmingId === s.id
          return (
            <div
              key={s.id}
              className={`sss-item-row ${s.id === activeSessionId ? 'active' : ''} ${confirming ? 'confirming' : ''}`}
            >
              <button className="sss-item" onClick={() => { setConfirmingId(null); onLoadSession(s.id) }}>
                <span className="sss-item-title">{s.title || '会话'}</span>
                {s.updated_at ? <span className="sss-item-time">{formatDay(s.updated_at)}</span> : null}
              </button>
              {confirming ? (
                <span className="sss-item-confirm">
                  <button
                    className="danger"
                    onClick={() => { setConfirmingId(null); onDeleteSession(s.id) }}
                    title="确认删除"
                  >
                    删除
                  </button>
                  <button onClick={() => setConfirmingId(null)}>取消</button>
                </span>
              ) : (
                <button
                  className="sss-item-del"
                  title="删除会话"
                  onClick={() => setConfirmingId(s.id)}
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="sss-foot">
        <button className="sss-foot-btn" onClick={closeWork} title="关闭工程，返回启动页">
          <Icon name="log-out" size={14} />
          关闭工程
        </button>
        <button className="sss-foot-btn icon-only" onClick={() => void refresh()} title="刷新列表">
          <Icon name="refresh" size={14} />
        </button>
      </div>
    </aside>
  )
}

function formatDay(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const d = new Date(ts > 10_000_000_000 ? ts : ts * 1000)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}
