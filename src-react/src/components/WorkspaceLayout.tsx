/**
 * 四区小说工作区容器：左章节列表 / 上标签栏 / 中编辑器 / 右 AI 栏。
 *
 * 桌面端与 Web 端共用。当前阶段先在现有壳内并行挂载验证（workbenchMode="preview"），
 * 后续替换主布局后由 App 直接渲染本容器。
 *
 * 沉浸模式（D6）：纯前端布局状态切换——渲染全屏 AI 对话区，
 * 进入前布局快照存于状态，退出恢复；不中断任何服务层活动。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import { ChapterList } from './ChapterList'
import { AppIcon } from './icons/AppIcon'
import './WorkspaceLayout.css'

export type WorkspaceLayoutSnapshot = {
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightPanelWidth: number
  rightPanelVisible: boolean
}

type Props = {
  workspaceRoot: string | null
  activePath: string | null
  onOpenChapter: (filePath: string) => void
  onCreateChapter?: () => void
  /** 渲染槽：由 App 提供既有组件（TabBar/编辑器/AI 栏），容器只负责布局 */
  tabsSlot: ReactNode
  editorSlot: ReactNode
  aiPanelSlot: ReactNode
  /** 布局状态（受控，值来自 UISettingsManager） */
  sidebarCollapsed: boolean
  sidebarWidth: number
  rightPanelWidth: number
  onSidebarCollapsedChange: (collapsed: boolean) => void
  onSidebarWidthChange: (width: number) => void
  onRightPanelWidthChange: (width: number) => void
  /** 沉浸模式（可选；不传则不显示入口） */
  immersive?: boolean
  onImmersiveChange?: (immersive: boolean) => void
}

const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const RIGHT_MIN = 280
const RIGHT_MAX = 560

export function WorkspaceLayout(props: Props) {
  const {
    workspaceRoot,
    activePath,
    onOpenChapter,
    onCreateChapter,
    tabsSlot,
    editorSlot,
    aiPanelSlot,
    sidebarCollapsed,
    sidebarWidth,
    rightPanelWidth,
    onSidebarCollapsedChange,
    onSidebarWidthChange,
    onRightPanelWidthChange,
    immersive = false,
    onImmersiveChange,
  } = props
  const { t } = useI18n()

  const [rightVisible, setRightVisible] = useState(true)
  const [snapshot, setSnapshot] = useState<WorkspaceLayoutSnapshot | null>(null)
  const resizeStateRef = useRef<{ zone: 'sidebar' | 'right'; startX: number; startWidth: number } | null>(null)

  // 沉浸模式：进入时快照当前布局，退出恢复
  const enterImmersive = useCallback(() => {
    setSnapshot({
      sidebarCollapsed,
      sidebarWidth,
      rightPanelWidth,
      rightPanelVisible: rightVisible,
    })
    onImmersiveChange?.(true)
  }, [sidebarCollapsed, sidebarWidth, rightPanelWidth, rightVisible, onImmersiveChange])

  const exitImmersive = useCallback(() => {
    if (snapshot) {
      onSidebarCollapsedChange(snapshot.sidebarCollapsed)
      onSidebarWidthChange(snapshot.sidebarWidth)
      onRightPanelWidthChange(snapshot.rightPanelWidth)
      setRightVisible(snapshot.rightPanelVisible)
      setSnapshot(null)
    }
    onImmersiveChange?.(false)
  }, [snapshot, onSidebarCollapsedChange, onSidebarWidthChange, onRightPanelWidthChange, onImmersiveChange])

  // 拖宽行为（pointer 事件，双端一致）
  const startResize = useCallback((zone: 'sidebar' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault()
    const startWidth = zone === 'sidebar' ? sidebarWidth : rightPanelWidth
    resizeStateRef.current = { zone, startX: e.clientX, startWidth }

    const onMove = (ev: PointerEvent) => {
      const st = resizeStateRef.current
      if (!st) return
      const dx = st.zone === 'sidebar' ? ev.clientX - st.startX : st.startX - ev.clientX
      const next = st.zone === 'sidebar'
        ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, st.startWidth + dx))
        : Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, st.startWidth + dx))
      if (st.zone === 'sidebar') onSidebarWidthChange(Math.round(next))
      else onRightPanelWidthChange(Math.round(next))
    }
    const onUp = () => {
      resizeStateRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('workspace-layout-resizing')
    }
    document.body.classList.add('workspace-layout-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [sidebarWidth, rightPanelWidth, onSidebarWidthChange, onRightPanelWidthChange])

  // Escape 退出沉浸
  useEffect(() => {
    if (!immersive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitImmersive()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [immersive, exitImmersive])

  // ---- 沉浸模式分支：仅 AI 对话区，全屏 ----
  if (immersive) {
    return (
      <div className="workspace-layout immersive" data-testid="workspace-immersive">
        <div className="workspace-immersive-body">{aiPanelSlot}</div>
        <button
          type="button"
          className="workspace-immersive-exit"
          onClick={exitImmersive}
          title={t('layout.exitImmersive')}
        >
          <AppIcon name="preview" size={14} />
          <span>{t('layout.exitImmersive')}</span>
        </button>
      </div>
    )
  }

  // ---- 常规四区 ----
  return (
    <div className="workspace-layout" data-testid="workspace-layout">
      <div className="workspace-left" style={sidebarCollapsed ? undefined : { width: sidebarWidth }}>
        {sidebarCollapsed ? null : (
          <>
            <ChapterList
              workspaceRoot={workspaceRoot}
              activePath={activePath}
              onOpenChapter={onOpenChapter}
              onCreateChapter={onCreateChapter}
            />
            <button
              type="button"
              className="workspace-collapse-btn"
              onClick={() => onSidebarCollapsedChange(true)}
              title={t('layout.collapseSidebar')}
            >
              <span className="workspace-collapse-icon">‹</span>
            </button>
          </>
        )}
      </div>
      {sidebarCollapsed ? (
        <button
          type="button"
          className="workspace-expand-btn"
          onClick={() => onSidebarCollapsedChange(false)}
          title={t('layout.expandSidebar')}
        >
          <span className="workspace-collapse-icon">›</span>
        </button>
      ) : (
        <div
          className="workspace-resize-handle"
          onPointerDown={startResize('sidebar')}
          role="separator"
          aria-orientation="vertical"
        />
      )}

      <div className="workspace-main">
        <div className="workspace-main-tabs">{tabsSlot}</div>
        <div className="workspace-main-editor">{editorSlot}</div>
      </div>

      {rightVisible ? (
        <>
          <div
            className="workspace-resize-handle"
            onPointerDown={startResize('right')}
            role="separator"
            aria-orientation="vertical"
          />
          <aside className="workspace-right" style={{ width: rightPanelWidth }}>
            {aiPanelSlot}
          </aside>
        </>
      ) : null}
      <button
        type="button"
        className={`workspace-right-toggle ${rightVisible ? 'visible' : ''}`}
        onClick={() => setRightVisible((v) => !v)}
        title={rightVisible ? t('layout.hideAiPanel') : t('layout.showAiPanel')}
      >
        <AppIcon name="chat" size={13} />
      </button>

      {onImmersiveChange ? (
        <button
          type="button"
          className="workspace-immersive-enter"
          onClick={enterImmersive}
          title={t('layout.enterImmersive')}
        >
          <AppIcon name="target" size={13} />
        </button>
      ) : null}
    </div>
  )
}
