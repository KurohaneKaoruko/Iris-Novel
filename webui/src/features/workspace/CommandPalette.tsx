import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'

export type CommandDef = {
  id: string
  label: string
  hint?: string
  group: string
  keywords?: string
  run: () => void
}

type Props = {
  open: boolean
  onClose: () => void
  commands: CommandDef[]
  /** 打开时可选预填搜索词（如从选中文字发起「润色」） */
  initialQuery?: string
}

/** 模糊子序列匹配：'bsl' 命中 '保存章节'？按拼音不现实，按字符子序列 + 原文包含双重打分 */
function score(text: string, q: string): number {
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.includes(q)) return 100 - t.indexOf(q)
  // 子序列匹配（首字母缩写场景）
  let ti = 0
  let hits = 0
  for (const ch of q) {
    const idx = t.indexOf(ch, ti)
    if (idx < 0) return 0
    ti = idx + 1
    hits += 1
  }
  return hits
}

export function CommandPalette({ open, onClose, commands, initialQuery }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery(initialQuery ?? '')
      setActive(0)
      // 等挂载后聚焦
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open, initialQuery])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return commands
      .map((c) => ({
        cmd: c,
        s: Math.max(score(c.label, q), score(c.keywords ?? '', q) * 0.8, score(c.group, q) * 0.3),
      }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.cmd)
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  // 键盘导航（捕获阶段，避免编辑器抢按键）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(a + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const cmd = filtered[active]
        if (cmd) {
          onClose()
          cmd.run()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered, active, onClose])

  useEffect(() => {
    listRef.current?.querySelector('.cmd-item.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = useCallback(
    (cmd: CommandDef) => {
      onClose()
      cmd.run()
    },
    [onClose],
  )

  if (!open) return null

  let lastGroup = ''

  return (
    <div className="palette-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette-box">
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索命令、章节、资料…（↑↓ 选择，Enter 执行）"
          spellCheck={false}
        />
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? <div className="palette-empty">无匹配命令</div> : null}
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {showGroup ? <div className="palette-group">{c.group}</div> : null}
                <div
                  className={`cmd-item ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(c) }}
                >
                  <span className="cmd-label">{c.label}</span>
                  {c.hint ? <span className="cmd-hint">{c.hint}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">Ctrl+K 打开 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  )
}
