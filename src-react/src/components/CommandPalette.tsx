/**
 * 命令面板（Ctrl+K）：聚合工作台全部命令入口，支持模糊搜索与键盘导航。
 * 项由 App 注入（labels 感知 i18n）；组件本身无业务逻辑。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import './CommandPalette.css'

export type CommandItem = {
  id: string
  title: string
  category?: string
  shortcut?: string
  icon?: string
  disabled?: boolean
  run: () => void
}

type CommandPaletteProps = {
  isOpen: boolean
  items: CommandItem[]
  onClose: () => void
  placeholder?: string
}

/** 简易模糊匹配：query 的字符按顺序出现在 title/category 中即命中，返回起始位置用于高亮 */
function fuzzyMatch(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let ti = 0
  let firstHit = -1
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    if (firstHit === -1) firstHit = found
    ti = found + 1
  }
  return firstHit
}

export function CommandPalette({ isOpen, items, onClose, placeholder }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // query 变化后重置选中项（渲染期调整 state 的标准模式，避免 effect 级联渲染）
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setActiveIndex(0)
  }

  // 每次打开重置输入与选中
  const [prevOpen, setPrevOpen] = useState(isOpen)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    setQuery('')
    setActiveIndex(0)
  }

  useEffect(() => {
    if (!isOpen) return
    // 打开时聚焦输入框（等弹层挂载完成）
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(0)
  }, [isOpen])

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    return items.filter((item) => fuzzyMatch(query.trim(), `${item.title} ${item.category ?? ''}`) !== null)
  }, [items, query])

  // 活动项滚动跟随（jsdom 等环境无 scrollIntoView，需防御）
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.children[activeIndex] as HTMLElement | undefined
    active?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  if (!isOpen) return null

  const execute = (item: CommandItem) => {
    if (item.disabled) return
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
      if (item) execute(item)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette glass-float" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-header">
          <span className="command-palette-search-icon">⌘</span>
          <input
            ref={inputRef}
            className="command-palette-input"
            placeholder={placeholder ?? '输入命令名称…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="command-palette-esc">ESC</kbd>
        </div>
        <div className="command-palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="command-palette-empty">没有匹配的命令</div>
          ) : (
            filtered.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`command-palette-item ${index === activeIndex ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                disabled={item.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => execute(item)}
              >
                {item.icon ? <span className="command-palette-item-icon">{item.icon}</span> : null}
                <span className="command-palette-item-title">{item.title}</span>
                {item.category ? <span className="command-palette-item-category">{item.category}</span> : null}
                {item.shortcut ? <kbd className="command-palette-item-shortcut">{item.shortcut}</kbd> : null}
              </button>
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>↑↓ 选择</span>
          <span>↵ 执行</span>
          <span>esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
