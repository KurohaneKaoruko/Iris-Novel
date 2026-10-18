/**
 * 封面流（Coverflow）：聚焦条目居中放大，两侧按距离渐次缩小/下沉/淡出，
 * 支持拖拽、滚轮、键盘导航与滚动停止自动吸附；全部动画仅用 transform/opacity。
 *
 * 性能降级：条目数 ≥ 60 时渲染静态网格，不激活封面流动画。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react'
import './CoverflowShelf.css'

export type CoverflowEntry = {
  key: string
  content: ReactNode
}

type Props = {
  entries: CoverflowEntry[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  /** Enter / 双击激活当前聚焦条目 */
  onActivate?: (index: number) => void
  /** 触发降级的条目数阈值 */
  virtualizeThreshold?: number
  ariaLabel?: string
}

const SNAP_IDLE_MS = 140
const DRAG_SUPPRESS_PX = 6
/** 布局常量（与 CSS 中 .coverflow-item 宽度一致） */
const ITEM_WIDTH = 240
const CENTER_SCALE = 1.14
const EDGE_SCALE = 0.6
const EDGE_LIFT = 30
const EDGE_OPACITY = 0.34

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  if (document.documentElement.dataset.motion === 'reduced') return true
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** 每一条目的垂直抖动（确定性，制造参考图的错落感），中心收敛到 0 */
function jitterFor(index: number): number {
  const h = (index * 2654435761) % 41
  return (h - 20) * 1.6
}

export function CoverflowShelf({
  entries,
  activeIndex,
  onActiveIndexChange,
  onActivate,
  virtualizeThreshold = 60,
  ariaLabel,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const rafRef = useRef<number | null>(null)
  const snapTimerRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const dragMovedRef = useRef(0)
  const suppressClickRef = useRef(false)
  const internalActiveRef = useRef(activeIndex)
  const activeIndexRef = useRef(activeIndex)
  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  const virtualized = entries.length >= virtualizeThreshold

  const applyTransforms = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const viewportWidth = container.clientWidth || 1
    const center = container.scrollLeft + viewportWidth / 2
    for (let i = 0; i < itemRefs.current.length; i += 1) {
      const el = itemRefs.current[i]
      if (!el) continue
      const itemCenter = el.offsetLeft + el.offsetWidth / 2
      const raw = (itemCenter - center) / viewportWidth
      const d = Math.max(-1, Math.min(1, raw))
      const t = Math.min(1, Math.abs(d) * 1.35)
      const scale = CENTER_SCALE - (CENTER_SCALE - EDGE_SCALE) * t
      const lift = EDGE_LIFT * t
      const opacity = 1 - (1 - EDGE_OPACITY) * t
      const rotate = d * -8
      const jitter = jitterFor(i) * Math.min(1, Math.abs(d) * 2.4)
      el.style.transform = `translate3d(0, ${(lift + jitter).toFixed(2)}px, 0) rotateY(${rotate.toFixed(2)}deg) scale(${scale.toFixed(4)})`
      el.style.opacity = opacity.toFixed(3)
      el.style.zIndex = String(Math.round((1 - Math.abs(d)) * 100))
    }
  }, [])

  const scheduleTransforms = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null
      applyTransforms()
    })
  }, [applyTransforms])

  const scrollToIndex = useCallback(
    (index: number, smooth: boolean) => {
      const container = scrollRef.current
      const el = itemRefs.current[index]
      if (!container || !el) return
      const left = el.offsetLeft + el.offsetWidth / 2 - container.clientWidth / 2
      internalActiveRef.current = index
      container.scrollTo({
        left,
        behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
      })
    },
    [],
  )

  const nearestIndex = useCallback((): number => {
    const container = scrollRef.current
    if (!container) return activeIndexRef.current
    const viewportWidth = container.clientWidth || 1
    const center = container.scrollLeft + viewportWidth / 2
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < itemRefs.current.length; i += 1) {
      const el = itemRefs.current[i]
      if (!el) continue
      const dist = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }, [])

  const handleScroll = useCallback(() => {
    scheduleTransforms()
    const container = scrollRef.current
    if (!container) return
    const nearest = nearestIndex()
    if (nearest !== internalActiveRef.current) {
      internalActiveRef.current = nearest
      onActiveIndexChange(nearest)
    }
    if (draggingRef.current) return
    if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current)
    snapTimerRef.current = window.setTimeout(() => {
      snapTimerRef.current = null
      if (draggingRef.current) return
      const target = nearestIndex()
      const el = itemRefs.current[target]
      const inner = scrollRef.current
      if (!el || !inner) return
      const desired = el.offsetLeft + el.offsetWidth / 2 - inner.clientWidth / 2
      if (Math.abs(inner.scrollLeft - desired) > 1) {
        internalActiveRef.current = target
        inner.scrollTo({
          left: desired,
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
      }
    }, SNAP_IDLE_MS)
  }, [nearestIndex, onActiveIndexChange, scheduleTransforms])

  // 原生滚动/滚轮监听（非 passive 才能拦截纵向滚轮）
  useEffect(() => {
    const container = scrollRef.current
    if (!container || virtualized) return
    const onScroll = () => handleScroll()
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault()
        container.scrollLeft += e.deltaY
      }
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      container.removeEventListener('scroll', onScroll)
      container.removeEventListener('wheel', onWheel)
    }
  }, [handleScroll, virtualized])

  // 外部（键盘/父组件）改变聚焦时平滑滚动过去
  useEffect(() => {
    if (virtualized) return
    if (activeIndex === internalActiveRef.current) return
    internalActiveRef.current = activeIndex
    scrollToIndex(activeIndex, true)
  }, [activeIndex, scrollToIndex, virtualized])

  // 初始定位与尺寸变化
  useLayoutEffect(() => {
    if (virtualized) return
    scrollToIndex(activeIndexRef.current, false)
    applyTransforms()
  }, [applyTransforms, scrollToIndex, virtualized])

  useEffect(() => {
    if (virtualized) return
    const container = scrollRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      scrollToIndex(activeIndexRef.current, false)
      scheduleTransforms()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [scheduleTransforms, scrollToIndex, virtualized])

  // 条目数变化后重新定位（异步动画结束后尺寸才稳定）
  useEffect(() => {
    if (virtualized) return
    const timer = window.setTimeout(() => {
      scrollToIndex(activeIndexRef.current, false)
      applyTransforms()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [entries.length, applyTransforms, scrollToIndex, virtualized])

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
      if (snapTimerRef.current !== null) window.clearTimeout(snapTimerRef.current)
    },
    [],
  )

  // 拖拽（指针事件）
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollRef.current
    if (!container || e.button !== 0) return
    draggingRef.current = true
    dragMovedRef.current = 0
    container.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const container = scrollRef.current
    if (!container || !draggingRef.current) return
    dragMovedRef.current += Math.abs(e.movementX)
    container.scrollLeft -= e.movementX
  }, [])

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = scrollRef.current
      if (!container || !draggingRef.current) return
      draggingRef.current = false
      if (container.hasPointerCapture(e.pointerId)) {
        container.releasePointerCapture(e.pointerId)
      }
      if (dragMovedRef.current > DRAG_SUPPRESS_PX) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      handleScroll()
    },
    [handleScroll],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const next = Math.max(0, activeIndex - 1)
        onActiveIndexChange(next)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const next = Math.min(entries.length - 1, activeIndex + 1)
        onActiveIndexChange(next)
      } else if (e.key === 'Enter') {
        onActivate?.(activeIndex)
      }
    },
    [activeIndex, entries.length, onActivate, onActiveIndexChange],
  )

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      e.stopPropagation()
      e.preventDefault()
    }
  }, [])

  if (virtualized) {
    return (
      <div className="coverflow-grid" aria-label={ariaLabel}>
        {entries.map((entry) => (
          <div key={entry.key} className="coverflow-grid-cell">
            {entry.content}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="coverflow"
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
      onDoubleClick={() => onActivate?.(activeIndex)}
    >
      <div className="coverflow-track">
        {entries.map((entry, index) => (
          <div
            key={entry.key}
            ref={(el) => {
              itemRefs.current[index] = el
            }}
            className={`coverflow-item ${index === activeIndex ? 'is-active' : ''}`}
            style={{ width: ITEM_WIDTH }}
            role="option"
            aria-selected={index === activeIndex}
            onFocus={() => {
              if (index !== activeIndex) onActiveIndexChange(index)
            }}
          >
            {entry.content}
          </div>
        ))}
      </div>
    </div>
  )
}
