import { useState } from 'react'
import type { MemoryIndex } from '../../api/novel'
import './MemoryPanel.css'

type Props = {
  memory: MemoryIndex[]
  onSave: (path: string, content: string) => Promise<void>
  onError: (msg: string | null) => void
}

const LABELS: Record<string, string> = {
  '.novel/state/character-state-index.md': '人物状态索引',
  '.novel/state/foreshadow-index.md': '伏笔线索索引',
  '.novel/state/continuity-index.md': '连续性索引',
}

export function MemoryPanel({ memory, onSave, onError }: Props) {
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const startEdit = (m: MemoryIndex) => {
    setEditingPath(m.path)
    setDraft(m.content || `# ${LABELS[m.path] ?? m.path}\n\n<!-- source: manual -->\n`)
  }

  const commit = async (path: string) => {
    setBusy(true)
    try {
      await onSave(path, draft)
      setEditingPath(null)
    } catch (e) {
      onError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-section memory-panel">
      <div className="panel-head">
        <span>记忆索引</span>
      </div>
      <p className="memory-hint">
        索引由 AI 写作自动维护，也可手动修订。含 <code>locked: true</code> 的索引受保护。
      </p>
      {memory.map((m) =>
        editingPath === m.path ? (
          <div key={m.path} className="memory-editor">
            <textarea
              rows={14}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            <div className="memory-actions">
              <button disabled={busy} onClick={() => void commit(m.path)}>保存</button>
              <button onClick={() => setEditingPath(null)}>取消</button>
            </div>
          </div>
        ) : (
          <div key={m.path} className="memory-card" onDoubleClick={() => startEdit(m)}>
            <div className="memory-row">
              <span className="memory-name">{LABELS[m.path] ?? m.path}</span>
              {m.locked ? <span className="memory-locked">🔒</span> : null}
              <span className="file-actions">
                <button title="编辑" onClick={(e) => { e.stopPropagation(); startEdit(m) }}>✎</button>
              </span>
            </div>
            <div className="memory-preview">
              {m.exists ? m.content.split('\n').slice(0, 3).join(' · ').slice(0, 80) || '（空）' : '尚未生成'}
            </div>
          </div>
        ),
      )}
    </div>
  )
}
