import { useCallback, useState } from 'react'
import { WorkProvider, useWork } from './state/WorkContext'
import { Bookshelf } from './features/bookshelf/Bookshelf'
import { Workspace } from './features/workspace/Workspace'

function Shell() {
  const { workRoot, setWorkRoot } = useWork()
  const [view, setView] = useState<'bookshelf' | 'studio'>(workRoot ? 'studio' : 'bookshelf')

  const openStudio = useCallback(() => setView('studio'), [])
  const exitToBookshelf = useCallback(() => {
    setWorkRoot(null)
    setView('bookshelf')
  }, [setWorkRoot])

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
