import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'

export type Command = {
  id: string
  label: string
  hint?: string
  keywords?: string
  icon?: string
  run: () => void
}

type Props = {
  commands: Command[]
  onClose: () => void
}

/** Ctrl+K 命令面板：模糊过滤 + 上下键选择 + Enter 执行 */
export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ''} ${c.hint ?? ''}`.toLowerCase().includes(q),
    )
  }, [commands, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    // 键盘选择跟随滚动
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (i: number) => {
    const cmd = filtered[i]
    if (!cmd) return
    onClose()
    cmd.run()
  }

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk glass-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          value={query}
          placeholder="输入命令或搜索…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(active)
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmdk-empty">无匹配命令</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                data-idx={i}
                className={`cmdk-item ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="cmdk-icon">{c.icon ?? '·'}</span>
                <span className="cmdk-label">{c.label}</span>
                {c.hint ? <span className="cmdk-hint">{c.hint}</span> : null}
              </button>
            ))
          )}
        </div>
        <div className="cmdk-foot">
          <span>↑↓ 选择</span>
          <span>↵ 执行</span>
          <span>esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
