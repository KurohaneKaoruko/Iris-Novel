/**
 * 自绘标题栏（自定义窗口边框）：品牌区 + 上下文标题 + 窗口控制。
 *
 * 桌面端（Tauri，decorations: false）：拖拽移动（data-tauri-drag-region +
 * startDragging 兜底）、双击最大化、最小化/最大化/关闭按钮。
 * 浏览器端：仅品牌区与非交互上下文标题，不渲染窗口控制按钮。
 */

import { useCallback, useEffect, useState } from 'react'
import { isTauriApp } from '../transport'
import { useI18n } from '../i18n'
import { AppIcon } from './icons/AppIcon'
import './TitleBar.css'

type Props = {
  /** 上下文标题（如当前作品名） */
  title?: string | null
  /** 打开书架（品牌区点击） */
  onOpenBookshelf?: () => void
}

type WindowControls = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  startDragging: () => void
  isMaximized: () => Promise<boolean>
  onResized: (cb: () => void) => Promise<() => void>
}

async function loadWindow(): Promise<WindowControls | null> {
  if (!isTauriApp()) return null
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    return {
      minimize: () => void win.minimize(),
      toggleMaximize: () =>
        void win.isMaximized().then((m) => (m ? win.unmaximize() : win.maximize())),
      close: () => void win.close(),
      startDragging: () => void win.startDragging(),
      isMaximized: () => win.isMaximized(),
      onResized: (cb) => win.onResized(cb),
    }
  } catch {
    return null
  }
}

export function TitleBar({ title, onOpenBookshelf }: Props) {
  const { t } = useI18n()
  const [controls, setControls] = useState<WindowControls | null>(null)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let disposed = false
    void (async () => {
      const c = await loadWindow()
      if (disposed) return
      setControls(c)
      if (c) {
        void c.isMaximized().then((m) => {
          if (!disposed) setMaximized(m)
        })
        void c.onResized(() => {
          void c.isMaximized().then(setMaximized)
        }).then((off) => {
          if (disposed) off()
          else unlisten = off
        })
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const onDragRegionMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 仅主键且点在区域本身（不拦截子按钮）
      if (e.button !== 0 || e.target !== e.currentTarget) return
      controls?.startDragging()
    },
    [controls],
  )

  const tauri = isTauriApp()

  return (
    <header
      className={`title-bar ${tauri ? 'title-bar-tauri' : ''}`}
      data-tauri-drag-region
      onMouseDown={onDragRegionMouseDown}
      onDoubleClick={() => {
        if (tauri) controls?.toggleMaximize()
      }}
    >
      <div className="title-bar-left">
        <button
          type="button"
          className="title-bar-brand"
          onClick={onOpenBookshelf}
          title={t('project.localLibrary')}
        >
          <AppIcon name="projectSwitch" size={13} />
          <span>N.I.C.E.</span>
        </button>
        {title ? <span className="title-bar-context" title={title}>{title}</span> : null}
      </div>

      {tauri && controls ? (
        <div className="title-bar-controls">
          <button
            type="button"
            className="title-bar-button"
            onClick={controls.minimize}
            title={t('titlebar.minimize')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className="title-bar-button"
            onClick={controls.toggleMaximize}
            title={maximized ? t('titlebar.restore') : t('titlebar.maximize')}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="1" y="3" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.1" />
                <path d="M3 3 V1 H9 V7 H7" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="title-bar-button title-bar-close"
            onClick={controls.close}
            title={t('titlebar.close')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
              <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      ) : null}
    </header>
  )
}
