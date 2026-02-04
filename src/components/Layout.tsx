import { useRef, useCallback, useEffect } from 'react'
import { useUIStore, useNotesStore, useWorkspaceStore } from '../store'
import { Sidebar } from './Sidebar'
import { MainContent } from './MainContent'
import { PipPanel } from './PipPanel'
import { sendNotesUpdateToPip, getPipWindow, requestPipFlushSave } from '../pip/documentPip'
import { ChevronRight } from 'lucide-react'
import { db, loadPartitionIntoStores, getStoragePartition, LOCAL_PARTITION } from '../db'
import { triggerFullSync, subscribeServerNewer, stopPeriodicPullCheck } from '../sync'

const SIDEBAR_WIDTH_MIN = 200
const SIDEBAR_WIDTH_MAX = 480
/** If user drags sidebar width below this, collapse instead of clamping at min (match notic). */
const SIDEBAR_COLLAPSE_THRESHOLD = 150

export function Layout() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useUIStore((s) => s.sidebarWidth)
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const pipUnsupportedModalOpen = useUIStore((s) => s.pipUnsupportedModalOpen)
  const setPipUnsupportedModalOpen = useUIStore((s) => s.setPipUnsupportedModalOpen)
  const sessionExpiredModalOpen = useUIStore((s) => s.sessionExpiredModalOpen)
  const setSessionExpiredModalOpen = useUIStore((s) => s.setSessionExpiredModalOpen)
  const toastMessage = useUIStore((s) => s.toastMessage)
  const setToastMessage = useUIStore((s) => s.setToastMessage)
  const serverNewerBannerVisible = useUIStore((s) => s.serverNewerBannerVisible)
  const setServerNewerBannerVisible = useUIStore((s) => s.setServerNewerBannerVisible)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const setSelectedNoteId = useNotesStore((s) => s.setSelectedNoteId)
  const setSelection = useNotesStore((s) => s.setSelection)
  const selectedNoteId = useNotesStore((s) => s.selectedNoteId)
  const selectedSidebarContext = useNotesStore((s) => s.selectedSidebarContext)
  const currentTab = useNotesStore((s) => s.currentTab)
  const isTrashView = useUIStore((s) => s.isTrashView)
  const isResizing = useRef(false)

  /** Any navigation (selection, tab, trash) exits settings. Single place – no per-handler logic. */
  useEffect(() => {
    if (useUIStore.getState().currentView === 'settings') {
      setCurrentView('notes')
    }
  }, [selectedNoteId, selectedSidebarContext, currentTab, isTrashView, setCurrentView])

  /** Best-effort: ask PiP to flush editors before main app unloads (e.g. refresh) so content isn't lost (match notic). */
  useEffect(() => {
    const flush = () => requestPipFlushSave()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  /** Subscribe to "server has newer data" from periodic pull check (match extension). */
  useEffect(() => {
    const unsub = subscribeServerNewer(() => setServerNewerBannerVisible(true))
    return unsub
  }, [setServerNewerBannerVisible])

  const handleServerNewerRefresh = useCallback(async () => {
    setServerNewerBannerVisible(false)
    try {
      await triggerFullSync(db, { ignorePaused: true })
      const partition = await getStoragePartition(db)
      await loadPartitionIntoStores(db, partition)
    } catch {
      // Keep banner visible so user can retry
      setServerNewerBannerVisible(true)
    }
  }, [setServerNewerBannerVisible])

  const startX = useRef(0)
  const startWidth = useRef(0)
  const lastRequestedWidth = useRef(0)
  const lastDoubleClickTime = useRef(0)

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (sidebarCollapsed) return
      e.preventDefault()
      isResizing.current = true
      startX.current = e.clientX
      startWidth.current = sidebarWidth
      lastRequestedWidth.current = sidebarWidth
      document.body.classList.add('user-is-resizing')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [sidebarCollapsed, sidebarWidth]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = e.clientX - startX.current
      const raw = startWidth.current + delta
      const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(0, raw))
      lastRequestedWidth.current = next
      setSidebarWidth(next)
    },
    [setSidebarWidth]
  )

  const handleMouseUp = useCallback(() => {
    if (!isResizing.current) return
    const finalWidth = lastRequestedWidth.current
    isResizing.current = false
    document.body.classList.remove('user-is-resizing')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (finalWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
      setSidebarCollapsed(true)
      setSidebarWidth(Math.max(SIDEBAR_WIDTH_MIN, startWidth.current))
    } else {
      setSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, finalWidth)))
    }
  }, [setSidebarCollapsed, setSidebarWidth])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  /** When note titles or colors change in the main app, push to PiP so tab bar stays in sync (e.g. rename/color from sidebar). */
  useEffect(() => {
    const unsubNotes = useNotesStore.subscribe(() => {
      const pipWin = getPipWindow()
      if (!pipWin || pipWin.closed) return
      const ui = useUIStore.getState()
      if (ui.openInPipNoteIds.length === 0) return
      const notes = useNotesStore.getState().notes
      const noteTitles: Record<string, string> = {}
      const noteColors: Record<string, string> = {}
      const notePayloads: Record<string, { content?: string; title?: string; displayName?: string; color?: string; workspaceId?: string }> = {}
      ui.openInPipNoteIds.forEach((id) => {
        const n = notes[id]
        noteTitles[id] = n?.displayName ?? n?.title ?? 'Untitled'
        if (n?.color) noteColors[id] = n.color
        notePayloads[id] = { content: n?.content ?? '', title: n?.title ?? 'Untitled', displayName: n?.displayName, color: n?.color, workspaceId: n?.workspaceId }
      })
      sendNotesUpdateToPip(ui.openInPipNoteIds, ui.openInPipActiveNoteId, { noteTitles, noteColors, notePayloads })
    })
    return unsubNotes
  }, [])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const t = event.data?.type
      if (!t) return
      // PiP note update: same as extension saveContent – accept so sidebar and PiP tabs stay in sync.
      // Ignore updates for notes that no longer exist (e.g. we just deleted an empty PiP-created note) so PiP cannot resurrect them (fixes QA1 flicker and QA3 Untitled left behind).
      if (t === 'notic-pip-note-update') {
        const fromPip =
          event.origin === window.location.origin ||
          (getPipWindow() != null && event.source === getPipWindow())
        if (fromPip && event.data?.noteId != null && event.data?.patch != null) {
          if (useNotesStore.getState().notes[event.data.noteId] == null) return
          useNotesStore.getState().updateNote(event.data.noteId, event.data.patch)
        }
        return
      }
      if (t !== 'notic-pip-add-note' && t !== 'notic-pip-close-tab' && t !== 'notic-pip-switch-tab' && t !== 'notic-pip-ready') return
      const pipWin = getPipWindow()
      if (t === 'notic-pip-ready') {
        if (pipWin && event.source === pipWin) {
          const state = useUIStore.getState()
          const notes = useNotesStore.getState().notes
          const noteTitles: Record<string, string> = {}
          const noteColors: Record<string, string> = {}
          state.openInPipNoteIds.forEach((id) => {
            const n = notes[id]
            noteTitles[id] = n?.displayName ?? n?.title ?? 'Untitled'
            if (n?.color) noteColors[id] = n.color
          })
          sendNotesUpdateToPip(state.openInPipNoteIds, state.openInPipActiveNoteId, { noteTitles, noteColors })
        }
        return
      }
      if (!pipWin || event.source !== pipWin) return
      const ui = useUIStore.getState()
      if (t === 'notic-pip-add-note') {
        const addNote = useNotesStore.getState().addNote
        const currentWorkspaceId = useWorkspaceStore.getState().currentWorkspaceId
        const newId = addNote({ workspaceId: currentWorkspaceId, createdFromPip: true })
        ui.addNoteToPip(newId, true)
        const after = useUIStore.getState()
        const notes = useNotesStore.getState().notes
        const noteTitles: Record<string, string> = {}
        const noteColors: Record<string, string> = {}
        const notePayloads: Record<string, { content?: string; title?: string; displayName?: string; color?: string; workspaceId?: string }> = {}
        after.openInPipNoteIds.forEach((id) => {
          const n = notes[id]
          noteTitles[id] = n?.displayName ?? n?.title ?? 'Untitled'
          if (n?.color) noteColors[id] = n.color
          notePayloads[id] = { content: n?.content ?? '', title: n?.title ?? 'Untitled', displayName: n?.displayName, color: n?.color, workspaceId: n?.workspaceId }
        })
        sendNotesUpdateToPip(after.openInPipNoteIds, after.openInPipActiveNoteId, { noteTitles, noteColors, notePayloads })
      } else if (t === 'notic-pip-close-tab' && event.data.noteId) {
        const noteId = event.data.noteId as string
        const isEmpty = event.data.isEmpty === true
        ui.removeNoteFromPip(noteId)
        if (isEmpty) {
          const note = useNotesStore.getState().notes[noteId]
          if (note && note.createdFromPip === true && note.hasEverHadContent !== true) {
            useNotesStore.getState().removeNote(noteId)
          }
        }
        const after = useUIStore.getState()
        const notesAfterClose = useNotesStore.getState().notes
        const noteTitlesClose: Record<string, string> = {}
        const noteColorsClose: Record<string, string> = {}
        const notePayloadsClose: Record<string, { content?: string; title?: string; displayName?: string; color?: string; workspaceId?: string }> = {}
        after.openInPipNoteIds.forEach((id) => {
          const n = notesAfterClose[id]
          noteTitlesClose[id] = n?.displayName ?? n?.title ?? 'Untitled'
          if (n?.color) noteColorsClose[id] = n.color
          notePayloadsClose[id] = { content: n?.content ?? '', title: n?.title ?? 'Untitled', displayName: n?.displayName, color: n?.color, workspaceId: n?.workspaceId }
        })
        sendNotesUpdateToPip(after.openInPipNoteIds, after.openInPipActiveNoteId, { noteTitles: noteTitlesClose, noteColors: noteColorsClose, notePayloads: notePayloadsClose })
      } else if (t === 'notic-pip-switch-tab' && event.data.noteId) {
        ui.setPipActiveNote(event.data.noteId)
        const after = useUIStore.getState()
        const notesAfterSwitch = useNotesStore.getState().notes
        const noteTitlesSwitch: Record<string, string> = {}
        const noteColorsSwitch: Record<string, string> = {}
        const notePayloadsSwitch: Record<string, { content?: string; title?: string; displayName?: string; color?: string; workspaceId?: string }> = {}
        after.openInPipNoteIds.forEach((id) => {
          const n = notesAfterSwitch[id]
          noteTitlesSwitch[id] = n?.displayName ?? n?.title ?? 'Untitled'
          if (n?.color) noteColorsSwitch[id] = n.color
          notePayloadsSwitch[id] = { content: n?.content ?? '', title: n?.title ?? 'Untitled', displayName: n?.displayName, color: n?.color, workspaceId: n?.workspaceId }
        })
        sendNotesUpdateToPip(after.openInPipNoteIds, after.openInPipActiveNoteId, { noteTitles: noteTitlesSwitch, noteColors: noteColorsSwitch, notePayloads: notePayloadsSwitch })
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleResizeDoubleClick = useCallback(() => {
    if (sidebarCollapsed) return
    lastDoubleClickTime.current = Date.now()
    setSidebarCollapsed(true)
  }, [sidebarCollapsed, setSidebarCollapsed])

  const handleCollapsedStripClick = useCallback(() => {
    if (!sidebarCollapsed) return
    if (Date.now() - lastDoubleClickTime.current < 400) return
    setSidebarCollapsed(false)
  }, [sidebarCollapsed, setSidebarCollapsed])

  const handleCollapsedStripKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!sidebarCollapsed) return
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setSidebarCollapsed(false)
      }
    },
    [sidebarCollapsed, setSidebarCollapsed]
  )

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToastMessage(null), 4000)
    return () => clearTimeout(t)
  }, [toastMessage, setToastMessage])

  return (
    <div className="dashboard-container">
      <Sidebar
        collapsed={sidebarCollapsed}
        width={sidebarCollapsed ? 0 : sidebarWidth}
      />
      <div
        className={`sidebar-resize-handle ${sidebarCollapsed ? 'sidebar-resize-handle--collapsed' : ''}`}
        role={sidebarCollapsed ? 'button' : 'separator'}
        aria-label={sidebarCollapsed ? 'Show sidebar' : 'Resize sidebar'}
        title={sidebarCollapsed ? 'Click to show sidebar' : 'Double-click to hide sidebar'}
        tabIndex={sidebarCollapsed ? 0 : undefined}
        onMouseDown={sidebarCollapsed ? undefined : handleResizeStart}
        onDoubleClick={handleResizeDoubleClick}
        onClick={sidebarCollapsed ? handleCollapsedStripClick : undefined}
        onKeyDown={sidebarCollapsed ? handleCollapsedStripKeyDown : undefined}
      >
        {sidebarCollapsed && (
          <ChevronRight className="sidebar-resize-handle-icon" style={{ width: 16, height: 16 }} />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {serverNewerBannerVisible && (
          <div className="server-newer-banner" role="status" aria-live="polite">
            <span className="server-newer-banner-text">Data updated on another device. Refresh to get the latest.</span>
            <button type="button" className="server-newer-banner-refresh" onClick={handleServerNewerRefresh}>
              Refresh
            </button>
          </div>
        )}
        <MainContent />
      </div>
      <PipPanel />
      {pipUnsupportedModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pip-unsupported-title"
          onClick={() => setPipUnsupportedModalOpen(false)}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 id="pip-unsupported-title" className="modal-title">
                Picture-in-Picture not supported
              </h2>
              <p className="modal-message">
                Your browser does not support the Document Picture-in-Picture API. Use a supported browser (e.g. Chrome) to open notes in a floating window.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-primary"
                onClick={() => setPipUnsupportedModalOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionExpiredModalOpen && (
        <div
          className="modal-overlay show"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-expired-title"
          onClick={async () => {
            setSessionExpiredModalOpen(false)
            stopPeriodicPullCheck()
            setServerNewerBannerVisible(false)
            setSelectedNoteId(null)
            setSelection([], [])
            await loadPartitionIntoStores(db, LOCAL_PARTITION)
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="session-expired-title" className="modal-title">
                Session expired
              </h2>
              <p className="modal-message">
                Your session has expired. You have been signed out. Sign in again to sync your notes.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="modal-btn modal-btn-primary"
                onClick={async () => {
                  setSessionExpiredModalOpen(false)
                  stopPeriodicPullCheck()
                  setServerNewerBannerVisible(false)
                  setSelectedNoteId(null)
                  setSelection([], [])
                  await loadPartitionIntoStores(db, LOCAL_PARTITION)
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div
          className="toast-message"
          role="status"
          style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10002 }}
          onClick={() => setToastMessage(null)}
        >
          {toastMessage}
        </div>
      )}
    </div>
  )
}
