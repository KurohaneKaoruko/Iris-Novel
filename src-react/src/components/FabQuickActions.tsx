/**
 * 右下悬浮快速操作（FAB）：新建章节 / 保存 / 导出 / 沉浸模式。
 * 玻璃菜单 + 主按钮旋转；仅工作台视图渲染。
 */

import { useEffect, useRef, useState } from 'react'

type Props = {
  immersive: boolean
  canSave: boolean
  canExport: boolean
  onNewChapter: () => void
  onSave: () => void
  onExport: () => void
  onImmersive: () => void
  labels: {
    newChapter: string
    save: string
    export: string
    immersive: string
  }
}

export function FabQuickActions({
  immersive,
  canSave,
  canExport,
  onNewChapter,
  onSave,
  onExport,
  onImmersive,
  labels,
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  const items: Array<{ key: string; label: string; disabled?: boolean; run: () => void }> = [
    { key: 'new', label: labels.newChapter, run: onNewChapter },
    { key: 'save', label: labels.save, disabled: !canSave, run: onSave },
    { key: 'export', label: labels.export, disabled: !canExport, run: onExport },
    {
      key: 'immersive',
      label: labels.immersive,
      run: onImmersive,
    },
  ]

  return (
    <div className={`fab-stack ${immersive ? 'fab-immersive' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`fab-main ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="quick actions"
      >
        +
      </button>
      <div className={`fab-menu glass-float ${open ? 'open' : ''}`} role="menu">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className="fab-menu-item"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              setOpen(false)
              item.run()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
