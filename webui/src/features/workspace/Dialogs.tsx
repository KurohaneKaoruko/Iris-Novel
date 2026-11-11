import { useEffect, useRef, useState } from 'react'

type PromptDialogProps = {
  title: string
  placeholder?: string
  initialValue?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

/** 玻璃质感输入对话框（替代 window.prompt） */
export function PromptDialog({ title, placeholder, initialValue = '', onConfirm, onCancel }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="dialog-box glass-panel" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 90vw)' }}>
        <h3 className="dialog-title">{title}</h3>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm(value.trim())
          }}
          autoFocus
        />
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel}>取消</button>
          <button className="dialog-btn primary" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}

type ConfirmDialogProps = {
  title: string
  message: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** 玻璃质感确认对话框（替代 window.confirm） */
export function ConfirmDialog({ title, message, danger, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="dialog-box glass-panel" onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 90vw)' }}>
        <h3 className="dialog-title">{title}</h3>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel}>取消</button>
          <button className={`dialog-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
