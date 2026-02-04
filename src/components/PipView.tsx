import { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { useNotesStore, useUIStore, useWorkspaceStore, useSubscriptionStore } from '../store'
import { NoteEditor } from './NoteEditor'
import { Plus, X, Pin } from 'lucide-react'
import { NOTE_CHAR_WARNING, NOTE_CHAR_LIMIT } from '../utils/noteUtils'

const SAVE_DEBOUNCE_MS = 400
const FREE_PIP_TAB_LIMIT = 2
const PIP_COLOR_OPTIONS: Array<{ label: string; value: string }> = [
  { label: 'Color: Default', value: '' },
  { label: 'Color: Blue', value: '#3b82f6' },
  { label: 'Color: Green', value: '#22c55e' },
  { label: 'Color: Purple', value: '#a855f7' },
  { label: 'Color: Orange', value: '#f97316' },
]

const NOTE_THEME_KEY = 'notic_noteTheme'
const NOTE_THEME_VALUES = ['default', 'sepia', 'dark', 'high-contrast'] as const
type NoteThemeId = (typeof NOTE_THEME_VALUES)[number]
function getStoredNoteTheme(): NoteThemeId {
  if (typeof window === 'undefined') return 'default'
  try {
    const stored = localStorage.getItem(NOTE_THEME_KEY)
    if (stored && NOTE_THEME_VALUES.includes(stored as NoteThemeId)) return stored as NoteThemeId
  } catch (_) {}
  return 'default'
}

function parsePipParams(): { noteIds: string[]; activeId: string | null; dark: boolean } {
  if (typeof window === 'undefined') return { noteIds: [], activeId: null, dark: false }
  const params = new URLSearchParams(window.location.search)
  const dark = params.get('dark') === '1'
  const noteIdsStr = params.get('noteIds')
  const activeId = params.get('activeId')
  // Support legacy single noteId
  const legacyNoteId = params.get('noteId')
  if (noteIdsStr) {
    const noteIds = noteIdsStr.split(',').filter(Boolean)
    return { noteIds, activeId: activeId || noteIds[0] || null, dark }
  }
  if (legacyNoteId && legacyNoteId !== '__open_notes__') {
    return { noteIds: [legacyNoteId], activeId: legacyNoteId, dark }
  }
  return { noteIds: [], activeId: null, dark }
}

/**
 * Full-page view for the PiP iframe: /pip?noteIds=id1,id2&activeId=id1&dark=1
 * Matches notic: empty state "No notes open" + "Add Note"; with notes shows tab bar + active editor.
 */
export function PipView() {
  const initial = useMemo(() => parsePipParams(), [])
  const [noteIds, setNoteIds] = useState<string[]>(initial.noteIds)
  const [activeTabId, setActiveTabId] = useState<string | null>(
    initial.activeId || initial.noteIds[0] || null
  )
  const isDark = initial.dark

  const notes = useNotesStore((s) => s.notes)
  const updateNote = useNotesStore((s) => s.updateNote)
  const addNote = useNotesStore((s) => s.addNote)

  /** Update note in store; when PiP is in a separate window, also sync to opener so sidebar reflects changes. */
  const applyNoteUpdate = useCallback(
    (noteId: string, patch: Parameters<typeof updateNote>[1]) => {
      updateNote(noteId, patch)
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'notic-pip-note-update', noteId, patch }, '*')
      }
    },
    [updateNote]
  )
  const setOpenInPipNoteIds = useUIStore((s) => s.setOpenInPipNoteIds)
  const setOpenInPipActiveNoteId = useUIStore((s) => s.setOpenInPipActiveNoteId)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)
  const isSubscribed = useSubscriptionStore((s) => s.isSubscribed)
  const contentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pinnedTabIds, setPinnedTabIds] = useState<Set<string>>(() => new Set())
  const [contentLength, setContentLength] = useState(0)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; noteId: string } | null>(null)
  const [renameState, setRenameState] = useState<{ noteId: string; value: string } | null>(null)
  const [showTabLimitModal, setShowTabLimitModal] = useState(false)
  const [noteTheme, setNoteTheme] = useState<NoteThemeId>(getStoredNoteTheme)
  const [hoveredSubmenu, setHoveredSubmenu] = useState<'color' | null>(null)
  const submenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pipEditorFlushRef = useRef<(() => void) | null>(null)

  const effectiveActiveId = noteIds.includes(activeTabId ?? '') ? activeTabId : noteIds[0] ?? null
  const activeNote = effectiveActiveId ? notes[effectiveActiveId] : null
  const isEmpty = noteIds.length === 0

  /** Pinned first, then rest (match notic). */
  const sortedNoteIds = useMemo(() => {
    const pinned = noteIds.filter((id) => pinnedTabIds.has(id))
    const unpinned = noteIds.filter((id) => !pinnedTabIds.has(id))
    return [...pinned, ...unpinned]
  }, [noteIds, pinnedTabIds])

  useEffect(() => {
    document.body.classList.add('pip-page')
    document.body.classList.toggle('dark-mode', isDark)
    return () => {
      document.body.classList.remove('pip-page')
    }
  }, [isDark])

  useEffect(() => {
    if (noteTheme === 'default') {
      document.body.removeAttribute('data-note-theme')
    } else {
      document.body.setAttribute('data-note-theme', noteTheme)
    }
  }, [noteTheme])

  /** When running inside PiP iframe, tell opener we're ready so it pushes current note list (avoids lost first notesUpdate). */
  useEffect(() => {
    if (window.parent !== window && window.parent.postMessage) {
      window.parent.postMessage({ type: 'notic-pip-ready' }, '*')
    }
  }, [])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const d = e.data
      if (d && d.type === 'notesUpdate' && Array.isArray(d.noteIds)) {
        setNoteIds(d.noteIds)
        setActiveTabId(d.activeId ?? d.noteIds[0] ?? null)
      }
      if (d && d.type === 'flushSave') {
        pipEditorFlushRef.current?.()
      }
      if (d && d.type === 'notic-note-theme-changed' && typeof d.theme === 'string' && NOTE_THEME_VALUES.includes(d.theme as NoteThemeId)) {
        setNoteTheme(d.theme as NoteThemeId)
        try {
          localStorage.setItem(NOTE_THEME_KEY, d.theme)
        } catch (_) {}
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleAddNote = useCallback(() => {
    const tabLimit = isSubscribed === true ? Infinity : FREE_PIP_TAB_LIMIT
    if (noteIds.length >= tabLimit) {
      setShowTabLimitModal(true)
      return
    }
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'notic-pip-add-note' }, '*')
      return
    }
    const newId = addNote({ workspaceId: currentWorkspaceId })
    const next = [...noteIds, newId]
    setNoteIds(next)
    setActiveTabId(newId)
    setOpenInPipNoteIds(next)
    setOpenInPipActiveNoteId(newId)
  }, [addNote, currentWorkspaceId, noteIds, setOpenInPipNoteIds, setOpenInPipActiveNoteId])

  const handleSwitchTab = useCallback((noteId: string) => {
    setActiveTabId(noteId)
    setOpenInPipActiveNoteId(noteId)
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'notic-pip-switch-tab', noteId }, '*')
    }
  }, [setOpenInPipActiveNoteId])

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, noteId: string) => {
      e.stopPropagation()
      const isEmpty = (notes[noteId]?.content?.trim() ?? '') === ''
      const next = noteIds.filter((id) => id !== noteId)
      const nextActive = effectiveActiveId === noteId ? (next[0] ?? null) : effectiveActiveId
      setOpenInPipNoteIds(next)
      setOpenInPipActiveNoteId(nextActive)
      setActiveTabId(nextActive)
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'notic-pip-close-tab', noteId, isEmpty }, '*')
      }
    },
    [noteIds, effectiveActiveId, notes, setOpenInPipNoteIds, setOpenInPipActiveNoteId]
  )

  const handleContentChange = useCallback(
    (noteId: string) => (newContent: string) => {
      if (contentTimeoutRef.current) clearTimeout(contentTimeoutRef.current)
      contentTimeoutRef.current = setTimeout(() => {
        contentTimeoutRef.current = null
        applyNoteUpdate(noteId, { content: newContent })
      }, SAVE_DEBOUNCE_MS)
    },
    [applyNoteUpdate]
  )

  /** Flush current tab to store immediately (tab switch / beforeunload). */
  const handleFlush = useCallback(
    (noteId: string) => (markdown: string) => {
      applyNoteUpdate(noteId, { content: markdown })
    },
    [applyNoteUpdate]
  )

  const handleTabContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, noteId })
  }, [])

  const handleCloseOthers = useCallback(
    (noteId: string) => {
      setContextMenu(null)
      const next = [noteId]
      setNoteIds(next)
      setActiveTabId(noteId)
      setOpenInPipNoteIds(next)
      setOpenInPipActiveNoteId(noteId)
    },
    [setOpenInPipNoteIds, setOpenInPipActiveNoteId]
  )

  const handleCloseAfter = useCallback(
    (noteId: string) => {
      setContextMenu(null)
      const idx = noteIds.indexOf(noteId)
      const next = noteIds.slice(0, idx + 1)
      setNoteIds(next)
      if (effectiveActiveId && !next.includes(effectiveActiveId)) {
        setActiveTabId(next[0] ?? null)
        setOpenInPipActiveNoteId(next[0] ?? null)
      }
      setOpenInPipNoteIds(next)
    },
    [noteIds, effectiveActiveId, setOpenInPipNoteIds, setOpenInPipActiveNoteId]
  )

  const handleCloseAll = useCallback(() => {
    setContextMenu(null)
    setNoteIds([])
    setActiveTabId(null)
    setOpenInPipNoteIds([])
    setOpenInPipActiveNoteId(null)
  }, [setOpenInPipNoteIds, setOpenInPipActiveNoteId])

  const togglePin = useCallback((noteId: string) => {
    setContextMenu(null)
    setPinnedTabIds((prev) => {
      const next = new Set(prev)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }, [])

  const handleRenameOpen = useCallback((noteId: string) => {
    const n = notes[noteId]
    setRenameState({ noteId, value: n?.displayName || n?.title || 'Untitled' })
    setContextMenu(null)
  }, [notes])

  const handleRenameSubmit = useCallback(() => {
    if (!renameState) return
    const { noteId, value } = renameState
    const trimmed = value.trim()
    if (trimmed) applyNoteUpdate(noteId, { displayName: trimmed })
    setRenameState(null)
  }, [renameState, applyNoteUpdate])

  const handleSetColor = useCallback(
    (noteId: string, color: string) => {
      setContextMenu(null)
      applyNoteUpdate(noteId, { color: color || undefined })
    },
    [applyNoteUpdate]
  )

  useEffect(() => {
    if (!contextMenu) return
    setHoveredSubmenu(null)
    if (submenuCloseTimerRef.current) {
      clearTimeout(submenuCloseTimerRef.current)
      submenuCloseTimerRef.current = null
    }
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  useEffect(() => {
    setContentLength(activeNote?.content?.length ?? 0)
  }, [effectiveActiveId, activeNote?.content?.length])

  if (isEmpty) {
    return (
      <div className="pip-container">
        <div className="pip-empty-state">
          <div className="pip-empty-state-content">
            <p className="pip-empty-state-message">No notes open</p>
            <button
              type="button"
              className="pip-empty-state-button"
              onClick={handleAddNote}
              aria-label="Add note"
            >
              <Plus size={14} />
              Add Note
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pip-container">
      <div className="pip-tabs">
        {sortedNoteIds.map((id, index) => {
          const n = notes[id]
          const title = n?.displayName || n?.title || 'Untitled'
          const isActive = id === effectiveActiveId
          const isPinned = pinnedTabIds.has(id)
          const nextId = sortedNoteIds[index + 1]
          const nextIsActive = nextId === effectiveActiveId
          const showSep = !isActive && !nextIsActive && nextId != null
          return (
            <div
              key={id}
              className={`pip-tab-item ${isPinned ? 'pinned' : ''} ${isActive ? 'active' : ''}`}
              data-session-id={id}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('.pip-tab-close') && !(e.target as HTMLElement).closest('.pip-tab-pin')) handleSwitchTab(id)
              }}
              onContextMenu={(e) => handleTabContextMenu(e, id)}
              role="tab"
              aria-selected={isActive}
              title={title}
            >
              {n?.color && (
                <span className="pip-tab-color" style={{ backgroundColor: n.color }} aria-hidden />
              )}
              {isPinned && (
                <span className="pip-tab-pin" title="Pinned">
                  <Pin size={12} />
                </span>
              )}
              <span className="pip-tab-label">{title}</span>
              <button
                type="button"
                className="pip-tab-close"
                title="Close"
                aria-label="Close tab"
                onClick={(e) => handleCloseTab(e, id)}
              >
                <X size={14} />
              </button>
              {showSep && <div className="pip-tab-sep" aria-hidden />}
            </div>
          )
        })}
        <button
          type="button"
          className="pip-tab-new-btn"
          title="New note"
          aria-label="New note"
          onClick={handleAddNote}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="pip-content">
        {effectiveActiveId && (
          <div className="note-container pip-tab-panel-active">
            <NoteEditor
              key={effectiveActiveId}
              editorKey={effectiveActiveId}
              initialContent={activeNote?.content ?? ''}
              onChange={handleContentChange(effectiveActiveId)}
              onFlush={handleFlush(effectiveActiveId)}
              onContentLengthChange={setContentLength}
              placeholder="Type / for commands…"
              registerFlushRef={pipEditorFlushRef}
            />
            {contentLength >= NOTE_CHAR_WARNING && (
              <div className="pip-note-char-warning visible" aria-live="polite">
                Approaching note limit ({contentLength.toLocaleString()} / {NOTE_CHAR_LIMIT.toLocaleString()} characters)
              </div>
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="pip-context-menu show"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          ref={(el) => {
            if (!el) return
            const rect = el.getBoundingClientRect()
            if (rect.right > window.innerWidth) el.style.left = `${window.innerWidth - rect.width - 10}px`
            if (rect.bottom > window.innerHeight) el.style.top = `${window.innerHeight - rect.height - 10}px`
          }}
        >
          <button
            type="button"
            className="pip-context-menu-item"
            onClick={() => { togglePin(contextMenu.noteId); setContextMenu(null) }}
          >
            {pinnedTabIds.has(contextMenu.noteId) ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            className="pip-context-menu-item"
            onClick={() => { handleRenameOpen(contextMenu.noteId); setContextMenu(null) }}
          >
            Rename
          </button>
          <div
            className="pip-context-menu-item pip-context-menu-item-has-submenu"
            onMouseEnter={() => {
              if (submenuCloseTimerRef.current) {
                clearTimeout(submenuCloseTimerRef.current)
                submenuCloseTimerRef.current = null
              }
              setHoveredSubmenu('color')
            }}
            onMouseLeave={() => {
              submenuCloseTimerRef.current = setTimeout(() => {
                submenuCloseTimerRef.current = null
                setHoveredSubmenu(null)
              }, 150)
            }}
          >
            <span className="pip-context-menu-item-label">Change color</span>
            <span className="pip-context-menu-item-chevron">›</span>
            <div className={`pip-context-menu-submenu ${hoveredSubmenu === 'color' ? 'show' : ''}`}>
              {PIP_COLOR_OPTIONS.map((opt) => (
                <button
                  key={opt.value || 'default'}
                  type="button"
                  className="pip-context-menu-submenu-item"
                  onClick={() => { handleSetColor(contextMenu!.noteId, opt.value); setContextMenu(null); setHoveredSubmenu(null) }}
                >
                  <span
                    className={`pip-context-menu-color-swatch ${!opt.value ? 'pip-context-menu-color-swatch-default' : ''}`}
                    style={opt.value ? { backgroundColor: opt.value } : undefined}
                  />
                  <span className="pip-context-menu-submenu-item-label">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="pip-context-menu-item"
            onClick={() => {
              const noteId = contextMenu.noteId
              const isEmpty = (notes[noteId]?.content?.trim() ?? '') === ''
              const next = noteIds.filter((id) => id !== noteId)
              const nextActive = effectiveActiveId === noteId ? next[0] ?? null : effectiveActiveId
              setNoteIds(next)
              setOpenInPipNoteIds(next)
              setOpenInPipActiveNoteId(nextActive)
              setActiveTabId(nextActive)
              setContextMenu(null)
              if (window.parent !== window) window.parent.postMessage({ type: 'notic-pip-close-tab', noteId, isEmpty }, '*')
            }}
          >
            Close
          </button>
          <button
            type="button"
            className="pip-context-menu-item"
            onClick={() => { handleCloseOthers(contextMenu.noteId); setContextMenu(null) }}
          >
            Close others
          </button>
          <button
            type="button"
            className="pip-context-menu-item"
            onClick={() => { handleCloseAfter(contextMenu.noteId); setContextMenu(null) }}
          >
            Close after
          </button>
          <button
            type="button"
            className="pip-context-menu-item"
            onClick={() => { handleCloseAll(); setContextMenu(null) }}
          >
            Close all
          </button>
        </div>
      )}

      {renameState && (
        <div className="pip-modal-overlay show" role="dialog" aria-modal="true" onClick={() => setRenameState(null)}>
          <div className="pip-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pip-modal-header">
              <h3 className="pip-modal-title" id="pipRenameTitle">Rename note</h3>
              <input
                type="text"
                className="pip-modal-input"
                id="pipRenameInput"
                placeholder="Note name"
                value={renameState.value}
                onChange={(e) => setRenameState((s) => (s ? { ...s, value: e.target.value } : null))}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRenameState(null)
                  if (e.key === 'Enter') handleRenameSubmit()
                }}
                autoFocus
              />
            </div>
            <div className="pip-modal-actions">
              <button type="button" className="pip-modal-btn pip-modal-btn-secondary" onClick={() => setRenameState(null)}>
                Cancel
              </button>
              <button type="button" className="pip-modal-btn pip-modal-btn-primary" onClick={handleRenameSubmit}>
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {showTabLimitModal && (
        <div className="pip-modal-overlay show" role="dialog" aria-modal="true" onClick={() => setShowTabLimitModal(false)}>
          <div className="pip-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pip-modal-header">
              <h3 className="pip-modal-title">{FREE_PIP_TAB_LIMIT} tabs on free plan</h3>
              <p className="pip-modal-message">Upgrade to Pro to open more notes at once.</p>
            </div>
            <div className="pip-modal-actions">
              <a href="https://getnotic.io/billing" target="_blank" rel="noopener noreferrer" className="pip-modal-btn pip-modal-btn-primary">
                Upgrade
              </a>
              <button type="button" className="pip-modal-btn pip-modal-btn-secondary" onClick={() => setShowTabLimitModal(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
