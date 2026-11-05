import { useCallback, useEffect, useState } from 'react'
import { WorkProvider, useWork } from './state/WorkContext'
import { Bookshelf } from './features/bookshelf/Bookshelf'
import { Workspace } from './features/workspace/Workspace'
import { readDeepLink, writeDeepLink } from './api/deeplink'
import { setWorkspace } from './api/backend'

function Shell() {
  const { workRoot, setWorkRoot } = useWork()
  const [view, setView] = useState<'bookshelf' | 'studio'>(workRoot ? 'studio' : 'bookshelf')
  const [restoring, setRestoring] = useState(() => readDeepLink().work !== null)

  // 启动时从 hash 深链恢复：后端 set_workspace → setWorkRoot（activePath 由 Workspace 恢复）
  useEffect(() => {
    const link = readDeepLink()
    if (!link.work) {
      setRestoring(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        await setWorkspace(link.work!)
        if (cancelled) return
        setWorkRoot(link.work!)
        setView('studio')
      } catch {
        // 深链失效（作品被移动/删除）：清 hash 回书架
        writeDeepLink(null)
        setView('bookshelf')
      } finally {
        if (!cancelled) setRestoring(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openStudio = useCallback(() => setView('studio'), [])
  const exitToBookshelf = useCallback(() => {
    setWorkRoot(null)
    writeDeepLink(null)
    setView('bookshelf')
  }, [setWorkRoot])

  // workRoot 变化同步到 hash（进入/切换作品）
  useEffect(() => {
    if (workRoot) writeDeepLink(workRoot, null)
  }, [workRoot])

  if (restoring) return null
  return view === 'bookshelf' ? (
    <Bookshelf onOpen={openStudio} />
  ) : (
    <Workspace onExit={exitToBookshelf} />
  )
}

export default function App() {
  return (
    <WorkProvider>
      <Shell />
    </WorkProvider>
  )
}
