import { useCallback, useEffect, useRef, useState } from 'react'
import { useUIStore, useNotesStore, useWorkspaceStore } from '../store'
import { X, Plus } from 'lucide-react'
import { getPipWindow, isDocumentPipSupported } from '../pip/documentPip'
import { NoteEditor } from './NoteEditor'

const SAVE_DEBOUNCE_MS = 400

export function PipPanel() {
  const openInPipNoteIds = useUIStore((s) => s.openInPipNoteIds)
  const openInPipActiveNoteId = useUIStore((s) => s.openInPipActiveNoteId)
  const setOpenInPipNoteIds = useUIStore((s) => s.setOpenInPipNoteIds)
  const setOpenInPipActiveNoteId = useUIStore((s) => s.setOpenInPipActiveNoteId)
  const addNoteToPip = useUIStore((s) => s.addNoteToPip)
  const notes = useNotesStore((s) => s.notes)
  const updateNote = useNotesStore((s) => s.updateNote)
  const addNote = useNotesStore((s) => s.addNote)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  const [localTitle, setLocalTitle] = useState('')
  const contentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeId = openInPipActiveNoteId && openInPipNoteIds.includes(openInPipActiveNoteId)
    ? openInPipActiveNoteId
    : openInPipNoteIds[0] ?? null
  const note = activeId ? notes[activeId] : null
  const title = note?.title ?? 'Untitled'
  const content = note?.content ?? ''

  useEffect(() => {
    setLocalTitle('')
  }, [activeId])

  const persistContent = useCallback(
    (newContent: string) => {
      if (!activeId) return
      updateNote(activeId, { content: newContent })
    },
    [activeId, updateNote]
  )

  const persistTitle = useCallback(
    (newTitle: string) => {
      if (!activeId) return
      updateNote(activeId, { title: newTitle.trim() || 'Untitled' })
    },
    [activeId, updateNote]
  )

  const handleContentChange = useCallback(
    (newContent: string) => {
      if (contentTimeoutRef.current) clearTimeout(contentTimeoutRef.current)
      contentTimeoutRef.current = setTimeout(() => {
        contentTimeoutRef.current = null
        persistContent(newContent)
      }, SAVE_DEBOUNCE_MS)
    },
    [persistContent]
  )

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setLocalTitle(value)
      if (titleTimeoutRef.current) clearTimeout(titleTimeoutRef.current)
      titleTimeoutRef.current = setTimeout(() => {
        titleTimeoutRef.current = null
        persistTitle(value)
      }, SAVE_DEBOUNCE_MS)
    },
    [persistTitle]
  )

  const handleTitleFocus = useCallback(() => {
    setLocalTitle(title)
  }, [title])

  const handleAddNote = useCallback(() => {
    const newId = addNote({ workspaceId: currentWorkspaceId })
    addNoteToPip(newId, true)
  }, [addNote, currentWorkspaceId, addNoteToPip])

  const handleClose = useCallback(() => {
    setOpenInPipNoteIds([])
    setOpenInPipActiveNoteId(null)
  }, [setOpenInPipNoteIds, setOpenInPipActiveNoteId])

  const displayTitle = localTitle !== '' ? localTitle : title

  if (openInPipNoteIds.length === 0) return null
  if (isDocumentPipSupported()) return null
  if (getPipWindow() != null) return null

  return (
    <div className="pip-panel" role="dialog" aria-label="Note in PiP">
      <div className="pip-panel-header">
        <input
          type="text"
          className="pip-panel-title-input"
          value={displayTitle}
          onChange={handleTitleChange}
          onFocus={handleTitleFocus}
          placeholder="Untitled"
          aria-label="Note title"
        />
        <button
          type="button"
          className="pip-panel-close"
          onClick={handleClose}
          aria-label="Close note"
        >
          <X size={16} />
        </button>
      </div>
      <div className="pip-panel-content">
        {activeId ? (
          <NoteEditor
            key={activeId}
            editorKey={activeId}
            initialContent={content}
            onChange={handleContentChange}
            placeholder="Start writing..."
            className="pip-panel-editor"
          />
        ) : (
          <div className="pip-panel-content--empty">
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
        )}
      </div>
    </div>
  )
}
