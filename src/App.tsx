import { useEffect } from 'react'
import { useUIStore } from './store'
import { Layout } from './components/Layout'
import { PipView } from './components/PipView'
import { AppErrorBoundary } from './components/AppErrorBoundary'

function App() {
  const isDarkMode = useUIStore((s) => s.isDarkMode)

  useEffect(() => {
    if (window.location.pathname !== '/pip') {
      document.body.classList.toggle('dark-mode', isDarkMode)
    }
  }, [isDarkMode])

  if (typeof window !== 'undefined' && window.location.pathname === '/pip') {
    return <PipView />
  }

  return (
    <AppErrorBoundary>
      <Layout />
    </AppErrorBoundary>
  )
}

export default App
