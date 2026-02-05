import { useEffect } from 'react'
import { useUIStore } from './store'
import { Layout } from './components/Layout'
import { PipView } from './components/PipView'
import { TutorialPipView } from './components/TutorialPipView'
import { AppErrorBoundary } from './components/AppErrorBoundary'

function App() {
  const isDarkMode = useUIStore((s) => s.isDarkMode)

  useEffect(() => {
    if (window.location.pathname !== '/pip' && window.location.pathname !== '/pip-tutorial') {
      document.body.classList.toggle('dark-mode', isDarkMode)
    }
  }, [isDarkMode])

  if (typeof window !== 'undefined') {
    if (window.location.pathname === '/pip') {
      return <PipView />
    }
    if (window.location.pathname === '/pip-tutorial') {
      return <TutorialPipView />
    }
  }

  return (
    <AppErrorBoundary>
      <Layout />
    </AppErrorBoundary>
  )
}

export default App
