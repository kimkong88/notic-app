import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * App-level Error Boundary. Catches render errors in the tree so the app doesn't go blank.
 * Shows a simple fallback with reload. For API 5xx we use toast (see fetchWithAuth).
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('AppErrorBoundary caught:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          className="dashboard-container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            minHeight: '100vh',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 360 }}>
            <h2 style={{ marginBottom: 8, fontSize: 18 }}>Something went wrong</h2>
            <p style={{ marginBottom: 16, color: 'var(--color-fg-secondary, #64748b)' }}>
              An unexpected error occurred. Try reloading the page.
            </p>
            <button
              type="button"
              className="modal-btn modal-btn-primary"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
