/** 设定集面板：地点/组织/物品/术语/设定卡片管理 */
import { useCallback, useEffect, useState } from 'react'
import { listCodex, saveCodex, CODEX_TYPES, type CodexEntry, type CodexType } from '../../api/novel'
import './CodexPanel.css'

type Props = {
  onError: (msg: string | null) => void
  /** 打开某章节文件（详情里引用章节时） */
  onOpenFile?: (path: string) => void
}

type Draft = { name: string; type: CodexType; summary: string; details: string }

const emptyDraft: Draft = { name: '', type: 'setting', summary: '', details: '' }

export function CodexPanel({ onError }: Props) {
  const [entries, setEntries] = useState<CodexEntry[]>([])
  const [filter, setFilter] = useState<CodexType | 'all'>('all')
  const [editing, setEditing] = useState<string | null>(null) // entry id 或 'new'
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      setEntries(await listCodex())
    } catch (e) {
      onError(`读取设定集失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => { void reload() }, [reload])

  const persist = useCallback(async (next: CodexEntry[]) => {
    setEntries(next)
    try {
      await saveCodex(next)
    } catch (e) {
      onError(`保存设定集失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [onError])

  const startNew = () => {
    setEditing('new')
    setDraft(emptyDraft)
  }

  const startEdit = (e: CodexEntry) => {
    setEditing(e.id)
    setDraft({ name: e.name, type: e.type, summary: e.summary, details: e.details })
  }

  const commit = () => {
    const name = draft.name.trim()
    if (!name) {
      onError('名称不能为空')
      return
    }
    if (editing === 'new') {
      if (entries.some((e) => e.name === name)) {
        onError(`「${name}」已存在`)
        return
      }
      const entry: CodexEntry = {
        id: `codex-${Date.now().toString(36)}`,
        name,
        type: draft.type,
        summary: draft.summary.trim(),
        details: draft.details.trim(),
      }
      void persist([...entries, entry])
    } else {
      void persist(entries.map((e) => (e.id === editing ? { ...e, name, type: draft.type, summary: draft.summary.trim(), details: draft.details.trim() } : e)))
    }
    setEditing(null)
  }

  const remove = (id: string) => {
    if (!window.confirm('删除这条设定？')) return
    void persist(entries.filter((e) => e.id !== id))
  }

  const shown = filter === 'all' ? entries : entries.filter((e) => e.type === filter)

  if (loading) return <div className="panel-empty">读取中…</div>

  return (
    <div className="codex-panel">
      <div className="codex-toolbar">
        <div className="codex-filters">
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {entries.length}</button>
          {CODEX_TYPES.map((t) => {
            const n = entries.filter((e) => e.type === t.id).length
            return (
              <button key={t.id} className={filter === t.id ? 'active' : ''} onClick={() => setFilter(t.id)}>
                {t.icon} {t.zh} {n}
              </button>
            )
          })}
        </div>
        <button className="codex-add" onClick={startNew}>＋ 新增</button>
      </div>

      {editing === 'new' || editing !== null ? (
        <div className="codex-editor">
          <div className="codex-editor-row">
            <input
              autoFocus
              placeholder="名称（如：青云宗）"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
            />
            <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as CodexType })}>
              {CODEX_TYPES.map((t) => <option key={t.id} value={t.id}>{t.zh}</option>)}
            </select>
          </div>
          <input
            placeholder="一句话简介"
            value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
          <textarea
            rows={4}
            placeholder="详情（设定细节、历史沿革、关联人物…）"
            value={draft.details}
            onChange={(e) => setDraft({ ...draft, details: e.target.value })}
          />
          <div className="codex-editor-actions">
            <button onClick={commit}>保存</button>
            <button onClick={() => setEditing(null)}>取消</button>
          </div>
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="panel-empty">
          {entries.length === 0 ? '还没有设定条目。地点、组织、物品、术语都可以收录在这里，写正文时选中文本即可快查。' : '该分类下暂无条目'}
        </div>
      ) : (
        <div className="codex-list">
          {shown.map((e) => {
            const t = CODEX_TYPES.find((x) => x.id === e.type)
            return editing === e.id ? null : (
              <div key={e.id} className="codex-card">
                <div className="codex-card-head">
                  <span className="codex-badge">{t?.icon} {t?.zh ?? '设定'}</span>
                  <span className="codex-name">{e.name}</span>
                  <span className="codex-card-actions">
                    <button title="编辑" onClick={() => startEdit(e)}>✎</button>
                    <button title="删除" onClick={() => remove(e.id)}>🗑</button>
                  </span>
                </div>
                {e.summary ? <div className="codex-summary">{e.summary}</div> : null}
                {e.details ? <div className="codex-details">{e.details}</div> : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
