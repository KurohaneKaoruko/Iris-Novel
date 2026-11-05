/**
 * 选词快查浮层：编辑器选中名词后，自动匹配设定集/人物卡并浮出卡片。
 * 挂载在编辑器区域上层，不可点击穿透（pointer-events 只在卡片上）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { queryCodex, CODEX_TYPES, type CodexEntry, type Character } from '../../api/novel'

type Hit = {
  /** 来源 */
  source: 'codex' | 'character'
  title: string
  badge: string
  summary: string
  details: string
}

type Props = {
  /** 当前选中文本（空串表示无选区） */
  selectedText: string
  codex: CodexEntry[]
  characters: Character[]
  /** 从浮层打开设定集面板 */
  onOpenCodex: () => void
}

export function CodexPeek({ selectedText, codex, characters, onOpenCodex }: Props) {
  const [dismissed, setDismissed] = useState('')
  const lastSelRef = useRef('')

  const hit: Hit | null = useMemo(() => {
    const q = selectedText.trim()
    if (!q || q.length > 20) return null
    const e = queryCodex(codex, q)
    if (e) {
      const t = CODEX_TYPES.find((x) => x.id === e.type)
      return { source: 'codex', title: e.name, badge: `设定 · ${t?.zh ?? '设定'}`, summary: e.summary, details: e.details }
    }
    const c = characters.find((x) => x.name === q) ?? characters.find((x) => q.includes(x.name) || x.name.includes(q))
    if (c) {
      const d = c.data
      const summary = [d.appearance, d.personality].filter(Boolean).join('；')
      const details = [d.background, d.relationships, d.notes].filter(Boolean).join('\n')
      return { source: 'character', title: c.name, badge: '人物', summary, details }
    }
    return null
  }, [selectedText, codex, characters])

  useEffect(() => {
    if (selectedText !== lastSelRef.current) {
      lastSelRef.current = selectedText
      if (selectedText !== dismissed) setDismissed('')
    }
  }, [selectedText, dismissed])

  const visible = hit !== null && dismissed !== hit.title && selectedText.trim() === hit.title.trim()
  if (!visible) return null

  return (
    <div className="codex-peek">
      <div className="codex-peek-card">
        <div className="codex-peek-head">
          <span className="codex-peek-badge">{hit.badge}</span>
          <span className="codex-peek-title">{hit.title}</span>
          <button className="codex-peek-close" title="关闭" onClick={() => setDismissed(hit.title)}>✕</button>
        </div>
        {hit.summary ? <div className="codex-peek-summary">{hit.summary}</div> : null}
        {hit.details ? <div className="codex-peek-details">{hit.details}</div> : null}
        {!hit.summary && !hit.details ? <div className="codex-peek-summary codex-peek-empty">暂无详细信息</div> : null}
        <button className="codex-peek-link" onClick={onOpenCodex}>打开设定集 →</button>
      </div>
    </div>
  )
}
