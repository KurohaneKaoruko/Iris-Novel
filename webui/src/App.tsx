import { useEffect, useState } from 'react'
import { ProjectProvider, useProject } from './state/ProjectContext'
import { ThemeProvider } from './state/ThemeContext'
import { LaunchScreen } from './features/launch/LaunchScreen'
import { AgentWorkspace } from './features/agent/AgentWorkspace'

function Shell() {
  const { workRoot, error, setError, refresh } = useProject()
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    // last_workspace 不再自动进入：Agent 工作台强调「打开目录」的显式动作
    setBooted(true)
    void refresh()
  }, [refresh])

  if (!booted) return null

  return (
    <>
      {workRoot ? <AgentWorkspace /> : <LaunchScreen />}
      {error ? (
        <div className="toast-error glass-float" role="alert" onClick={() => setError(null)}>
          {error}
        </div>
      ) : null}
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ProjectProvider>
        <Shell />
      </ProjectProvider>
    </ThemeProvider>
  )
}
