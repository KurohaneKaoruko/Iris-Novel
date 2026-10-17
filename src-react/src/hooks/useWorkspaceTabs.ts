/**
 * 工作区标签页状态：打开文件集合、当前激活文件、打开/关闭/切换行为。
 * 从 App.tsx 等价搬移（行为不变），供布局重构后复用。
 */

import { useCallback, useMemo, useState } from 'react'
import { readText } from '../tauri'

export type OpenFile = {
  path: string
  name: string
  content: string
  dirty: boolean
}

export type OpenByPathOptions = {
  forceReload?: boolean
}

type UseWorkspaceTabsResult = {
  openFiles: OpenFile[]
  activePath: string | null
  activeFile: OpenFile | null
  setActivePath: (path: string | null) => void
  setOpenFiles: React.Dispatch<React.SetStateAction<OpenFile[]>>
  onOpenByPath: (relPath: string, options?: OpenByPathOptions) => Promise<void>
  closeActiveTab: () => void
  focusNeighborTab: (direction: 'next' | 'prev') => void
}

export function useWorkspaceTabs(opts: {
  onError: (message: string | null) => void
  onBusyChange?: (busy: boolean) => void
}): UseWorkspaceTabsResult {
  const { onError, onBusyChange } = opts
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)

  const activeFile = useMemo(
    () => openFiles.find((f) => f.path === activePath) ?? null,
    [openFiles, activePath],
  )

  const onOpenByPath = useCallback(
    async (relPath: string, options?: OpenByPathOptions) => {
      if (!relPath) return
      const forceReload = options?.forceReload === true
      onError(null)
      onBusyChange?.(true)
      try {
        const existing = openFiles.find((f) => f.path === relPath)
        if (existing && !forceReload) {
          setActivePath(existing.path)
          return
        }
        const parts = relPath.replaceAll('\\', '/').split('/')
        const name = parts[parts.length - 1] || relPath
        const content = await readText(relPath)
        if (existing) {
          setOpenFiles((prev) =>
            prev.map((f) => (f.path === relPath ? { ...f, name, content, dirty: false } : f)),
          )
        } else {
          const next: OpenFile = { path: relPath, name, content, dirty: false }
          setOpenFiles((prev) => [...prev, next])
        }
        setActivePath(relPath)
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e))
      } finally {
        onBusyChange?.(false)
      }
    },
    [openFiles, onError, onBusyChange],
  )

  const closeActiveTab = useCallback(() => {
    if (!activePath) return
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== activePath)
      setActivePath(next[next.length - 1]?.path ?? null)
      return next
    })
  }, [activePath])

  const focusNeighborTab = useCallback(
    (direction: 'next' | 'prev') => {
      if (!activePath || openFiles.length <= 1) return
      const currentIndex = openFiles.findIndex((f) => f.path === activePath)
      if (currentIndex < 0) return
      const offset = direction === 'next' ? 1 : -1
      const nextIndex = (currentIndex + offset + openFiles.length) % openFiles.length
      setActivePath(openFiles[nextIndex]?.path ?? activePath)
    },
    [activePath, openFiles],
  )

  return {
    openFiles,
    activePath,
    activeFile,
    setActivePath,
    setOpenFiles,
    onOpenByPath,
    closeActiveTab,
    focusNeighborTab,
  }
}
