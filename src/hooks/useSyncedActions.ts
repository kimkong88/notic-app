import { useCallback } from 'react'
import { useNotesStore, useWorkspaceStore } from '../store'
import { triggerSyncAfterUserAction } from '../sync'
import { db } from '../db'
import type { NoteData, Folder } from '../store/types'

/**
 * Wraps store actions to automatically trigger sync after user modifications.
 * Use these instead of direct store actions when user performs operations.
 */
export function useSyncedActions() {
  const storeUpdateNote = useNotesStore((s) => s.updateNote)
  const storeUpdateFolder = useNotesStore((s) => s.updateFolder)
  const storeRemoveFolder = useNotesStore((s) => s.removeFolder)
  const storeRestoreNote = useNotesStore((s) => s.restoreNote)
  const storeRenameWorkspace = useWorkspaceStore((s) => s.renameWorkspace)

  const updateNote = useCallback((sessionId: string, patch: Partial<NoteData>) => {
    storeUpdateNote(sessionId, patch)
    triggerSyncAfterUserAction(db)
  }, [storeUpdateNote])

  const updateFolder = useCallback((folderId: string, patch: Partial<Pick<Folder, 'name' | 'displayName' | 'color' | 'parentId'>>) => {
    storeUpdateFolder(folderId, patch)
    triggerSyncAfterUserAction(db)
  }, [storeUpdateFolder])

  const removeFolder = useCallback((folderId: string) => {
    storeRemoveFolder(folderId)
    triggerSyncAfterUserAction(db)
  }, [storeRemoveFolder])

  const restoreNote = useCallback((sessionId: string) => {
    storeRestoreNote(sessionId)
    triggerSyncAfterUserAction(db)
  }, [storeRestoreNote])

  const renameWorkspace = useCallback((id: string, name: string) => {
    storeRenameWorkspace(id, name)
    triggerSyncAfterUserAction(db)
  }, [storeRenameWorkspace])

  return {
    updateNote,
    updateFolder,
    removeFolder,
    restoreNote,
    renameWorkspace,
  }
}
