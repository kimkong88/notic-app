import Dexie, { type Table } from 'dexie'
import type { NoteData, Folder, WorkspaceInfo } from '../store/types'

/** Note with partition (compound key [partition+sessionId]). */
export type NoteDataP = NoteData & { partition: string }
/** Folder with partition (compound key [partition+id]). */
export type FolderP = Folder & { partition: string }
/** Workspace with partition (compound key [partition+id]). */
export type WorkspaceInfoP = WorkspaceInfo & { partition: string }

/**
 * IndexedDB schema for offline-first SPA (replaces chrome.storage.local).
 * Partition = user id when signed in, __local__ when not (match notic extension).
 * v2: partitioned tables (notesP, foldersP, workspacesP) so local and user data are separate.
 */
export class NoticDB extends Dexie {
  notes!: Table<NoteData, string>
  folders!: Table<Folder, string>
  workspaces!: Table<WorkspaceInfo, string>
  /** Partitioned notes: compound key [partition+sessionId]. */
  notesP!: Table<NoteDataP, [string, string]>
  /** Partitioned folders: compound key [partition+id]. */
  foldersP!: Table<FolderP, [string, string]>
  /** Partitioned workspaces: compound key [partition+id]. */
  workspacesP!: Table<WorkspaceInfoP, [string, string]>
  /** Key-value for prefs: currentWorkspaceId per partition, sidebarCollapsed, etc. */
  prefs!: Table<{ key: string; value: unknown }, string>

  constructor() {
    super('notic-app')
    this.version(1).stores({
      notes: 'sessionId, lastModified, createdAt, workspaceId, folderId, deletedAt',
      folders: 'id, parentId, createdAt, workspaceId',
      workspaces: 'id',
      prefs: 'key',
    })
    this.version(2)
      .stores({
        notes: 'sessionId, lastModified, createdAt, workspaceId, folderId, deletedAt',
        folders: 'id, parentId, createdAt, workspaceId',
        workspaces: 'id',
        prefs: 'key',
        notesP: '[partition+sessionId], partition, sessionId, lastModified, createdAt, workspaceId, folderId, deletedAt',
        foldersP: '[partition+id], partition, id, parentId, createdAt, workspaceId',
        workspacesP: '[partition+id], partition, id',
      })
      .upgrade(async (tx) => {
        const notes = await tx.table('notes').toArray()
        const folders = await tx.table('folders').toArray()
        const workspaces = await tx.table('workspaces').toArray()
        const partition = '__local__'
        if (notes.length > 0) {
          await tx.table('notesP').bulkAdd(notes.map((n) => ({ ...n, partition })))
        }
        if (folders.length > 0) {
          await tx.table('foldersP').bulkAdd(folders.map((f) => ({ ...f, partition })))
        }
        if (workspaces.length > 0) {
          await tx.table('workspacesP').bulkAdd(workspaces.map((w) => ({ ...w, partition })))
        }
      })
  }
}

export const db = new NoticDB()
