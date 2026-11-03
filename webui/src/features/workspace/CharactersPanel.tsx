import { useState } from 'react'
import type { Character } from '../../api/novel'
import './CharactersPanel.css'

type Props = {
  characters: Character[]
  onSave: (next: Character[]) => Promise<void>
  onError: (msg: string | null) => void
}

let seq = 0
const newId = () => `character-${Date.now()}-${(seq += 1)}`

const FIELDS = [
  { key: 'appearance', label: '外貌' },
  { key: 'personality', label: '性格' },
  { key: 'background', label: '背景' },
  { key: 'relationships', label: '关系' },
  { key: 'notes', label: '备注' },
] as const

export function CharactersPanel({ characters, onSave, onError }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Character | null>(null)
  const [busy, setBusy] = useState(false)

  const startCreate = () => {
    const c: Character = { id: newId(), name: '', data: { name: '' } }
    setDraft(c)
    setEditingId(c.id)
  }

  const startEdit = (c: Character) => {
    setDraft(JSON.parse(JSON.stringify(c)) as Character)
    setEditingId(c.id)
  }

  const commit = async () => {
    if (!draft) return
    const name = draft.data.name.trim()
    if (!name) {
      onError('人物姓名不能为空')
      return
    }
    setBusy(true)
    try {
      const next = characters.some((c) => c.id === draft.id)
        ? characters.map((c) => (c.id === draft.id ? { ...draft, name } : c))
        : [...characters, { ...draft, name }]
      await onSave(next)
      setEditingId(null)
      setDraft(null)
    } catch (e) {
      onError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('确认删除该人物？')) return
    await onSave(characters.filter((c) => c.id !== id))
  }

  return (
    <div className="panel-section characters-panel">
      <div className="panel-head">
        <span>人物（{characters.length}）</span>
        <button onClick={startCreate} title="新建人物">＋</button>
      </div>

      {characters.map((c) =>
        editingId === c.id && draft ? (
          <div key={c.id} className="char-editor">
            <input
              className="char-name-input"
              value={draft.data.name}
              onChange={(e) => setDraft({ ...draft, data: { ...draft.data, name: e.target.value } })}
              placeholder="姓名"
              autoFocus
            />
            {FIELDS.map((f) => (
              <label key={f.key}>
                {f.label}
                <textarea
                  rows={2}
                  value={draft.data[f.key] ?? ''}
                  onChange={(e) => setDraft({ ...draft, data: { ...draft.data, [f.key]: e.target.value } })}
                />
              </label>
            ))}
            <div className="char-actions">
              <button disabled={busy} onClick={() => void commit()}>保存</button>
              <button onClick={() => { setEditingId(null); setDraft(null) }}>取消</button>
            </div>
          </div>
        ) : (
          <div key={c.id} className="char-card" onDoubleClick={() => startEdit(c)}>
            <div className="char-row">
              <span className="char-name">{c.name}</span>
              <span className="file-actions">
                <button title="编辑" onClick={(e) => { e.stopPropagation(); startEdit(c) }}>✎</button>
                <button title="删除" onClick={(e) => { e.stopPropagation(); void remove(c.id) }}>✕</button>
              </span>
            </div>
            {FIELDS.some((f) => c.data[f.key]) ? (
              <div className="char-fields">
                {FIELDS.filter((f) => c.data[f.key]).map((f) => (
                  <div key={f.key} className="char-field">
                    <span className="char-field-label">{f.label}</span>
                    <span className="char-field-value">{c.data[f.key]}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="char-field-empty">（双击编辑）</div>
            )}
          </div>
        ),
      )}

      {editingId && draft && !characters.some((c) => c.id === draft.id) ? (
        <div className="char-editor">
          <input
            className="char-name-input"
            value={draft.data.name}
            onChange={(e) => setDraft({ ...draft, data: { ...draft.data, name: e.target.value } })}
            placeholder="姓名"
            autoFocus
          />
          {FIELDS.map((f) => (
            <label key={f.key}>
              {f.label}
              <textarea
                rows={2}
                value={draft.data[f.key] ?? ''}
                onChange={(e) => setDraft({ ...draft, data: { ...draft.data, [f.key]: e.target.value } })}
              />
            </label>
          ))}
          <div className="char-actions">
            <button disabled={busy} onClick={() => void commit()}>保存</button>
            <button onClick={() => { setEditingId(null); setDraft(null) }}>取消</button>
          </div>
        </div>
      ) : null}

      {characters.length === 0 && !editingId ? <div className="panel-empty">暂无人物卡</div> : null}
    </div>
  )
}
