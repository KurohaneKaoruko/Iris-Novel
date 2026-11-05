import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ProjectWritingSettings } from '../api/backend'
import { getProjectWritingSettings } from '../api/backend'
import { writeDeepLink } from '../api/deeplink'

type WorkState = {
  /** 当前作品根目录绝对路径 */
  workRoot: string | null
  setWorkRoot: (root: string | null) => void
  /** 当前打开的章节相对路径 */
  activePath: string | null
  setActivePath: (path: string | null) => void
  /** 工程写作设置（章节目标字数等） */
  writingSettings: ProjectWritingSettings | null
  reloadWritingSettings: () => Promise<void>
  /** 全局错误条 */
  error: string | null
  setError: (msg: string | null) => void
}

const WorkContext = createContext<WorkState | null>(null)

export function WorkProvider({ children }: { children: ReactNode }) {
  const [workRoot, setWorkRoot] = useState<string | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [writingSettings, setWritingSettings] = useState<ProjectWritingSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reloadWritingSettings = useCallback(async () => {
    try {
      setWritingSettings(await getProjectWritingSettings())
    } catch {
      setWritingSettings(null)
    }
  }, [])

  useEffect(() => {
    if (workRoot) void reloadWritingSettings()
  }, [workRoot, reloadWritingSettings])

  // activePath 变化同步到 hash 深链（刷新后恢复当前章节）
  useEffect(() => {
    if (workRoot) writeDeepLink(workRoot, activePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath])

  const value = useMemo(
    () => ({
      workRoot,
      setWorkRoot: (root: string | null) => {
        setWorkRoot(root)
        setActivePath(null)
        setError(null)
      },
      activePath,
      setActivePath,
      writingSettings,
      reloadWritingSettings,
      error,
      setError,
    }),
    [workRoot, activePath, writingSettings, reloadWritingSettings, error],
  )

  return <WorkContext.Provider value={value}>{children}</WorkContext.Provider>
}

export function useWork(): WorkState {
  const ctx = useContext(WorkContext)
  if (!ctx) throw new Error('useWork must be used within WorkProvider')
  return ctx
}
