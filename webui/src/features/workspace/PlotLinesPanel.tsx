import { useState } from 'react'
import type { PlotLine, PlotLineStatus } from '../../api/novel'
import './PlotLinesPanel.css'

type Props = {
  plotLines: PlotLine[]
  onSave: (next: PlotLine[]) => Promise<void>
  onError: (msg: string | null) => void
}

const STATUS_LABEL: Record<PlotLineStatus, string> = {
  ongoing: '进行中',
  completed: '已完结',
  paused: '已暂停',
}

let seq = 0
const newId = () => `plot-${Date.now()}-${(seq += 1)}`

export function PlotLinesPanel({ plotLines, onSave, onError }: Props) {
  const [draft, setDraft] = useState<PlotLine | null>(null)
  const [busy, setBusy] = useState(false)

  const startCreate = () =>
    setDraft({ id: newId(), name: '', startChapter: '', status: 'ongoing', description: '' })

  const startEdit = (p: PlotLine) => setDraft({ ...p })

  const commit = async () => {
    if (!draft) return
    if (!draft.name.trim()) {
      onError('情节线名称不能为空')
      return
    }
    setBusy(true)
    try {
      const next = plotLines.some((p) => p.id === draft.id)
        ? plotLines.map((p) => (p.id === draft.id ? draft : p))
        : [...plotLines, draft]
      await onSave(next)
      setDraft(null)
    } catch (e) {
      onError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('确认删除该情节线？')) return
    await onSave(plotLines.filter((p) => p.id !== id))
  }

  const cycleStatus = async (p: PlotLine) => {
    const order: PlotLineStatus[] = ['ongoing', 'paused', 'completed']
    const next = order[(order.indexOf(p.status) + 1) % order.length]
    await onSave(plotLines.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
  }

  return (
    <div className="panel-section plotlines-panel">
      <div className="panel-head">
        <span>情节线（{plotLines.length}）</span>
        <button onClick={startCreate} title="新建情节线">＋</button>
      </div>

      {plotLines.map((p) =>
        draft?.id === p.id ? (
          <div key={p.id} className="plot-editor">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="情节线名称"
              autoFocus
            />
            <div className="plot-row">
              <input
                value={draft.startChapter}
                onChange={(e) => setDraft({ ...draft, startChapter: e.target.value })}
                placeholder="起始章节"
              />
              <input
                value={draft.endChapter ?? ''}
                onChange={(e) => setDraft({ ...draft, endChapter: e.target.value })}
                placeholder="结束章节"
              />
            </div>
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as PlotLineStatus })}
            >
              {(Object.keys(STATUS_LABEL) as PlotLineStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <textarea
              rows={3}
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="一句话简介"
            />
            <div className="plot-actions">
              <button disabled={busy} onClick={() => void commit()}>保存</button>
              <button onClick={() => setDraft(null)}>取消</button>
            </div>
          </div>
        ) : (
          <div key={p.id} className="plot-card" onDoubleClick={() => startEdit(p)}>
            <div className="plot-row-head">
              <span className="plot-name">{p.name}</span>
              <span className={`plot-status ${p.status}`} onClick={(e) => { e.stopPropagation(); void cycleStatus(p) }} title="点击切换状态">
                {STATUS_LABEL[p.status]}
              </span>
              <span className="file-actions">
                <button title="编辑" onClick={(e) => { e.stopPropagation(); startEdit(p) }}>✎</button>
                <button title="删除" onClick={(e) => { e.stopPropagation(); void remove(p.id) }}>✕</button>
              </span>
            </div>
            <div className="plot-chapters">
              {p.startChapter}{p.endChapter && p.endChapter !== p.startChapter ? ` → ${p.endChapter}` : ''}
            </div>
            {p.description ? <div className="plot-desc">{p.description}</div> : null}
          </div>
        ),
      )}

      {draft && !plotLines.some((p) => p.id === draft.id) ? (
        <div className="plot-editor">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="情节线名称"
            autoFocus
          />
          <div className="plot-row">
            <input
              value={draft.startChapter}
              onChange={(e) => setDraft({ ...draft, startChapter: e.target.value })}
              placeholder="起始章节"
            />
            <input
              value={draft.endChapter ?? ''}
              onChange={(e) => setDraft({ ...draft, endChapter: e.target.value })}
              placeholder="结束章节"
            />
          </div>
          <select
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as PlotLineStatus })}
          >
            {(Object.keys(STATUS_LABEL) as PlotLineStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <textarea
            rows={3}
            value={draft.description ?? ''}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="一句话简介"
          />
          <div className="plot-actions">
            <button disabled={busy} onClick={() => void commit()}>保存</button>
            <button onClick={() => setDraft(null)}>取消</button>
          </div>
        </div>
      ) : null}

      {plotLines.length === 0 && !draft ? <div className="panel-empty">暂无情节线</div> : null}
    </div>
  )
}
