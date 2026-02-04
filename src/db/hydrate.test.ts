import { describe, it, expect, beforeEach } from 'vitest'
import type { NoticDB } from './schema'
import { hydrateStores } from './hydrate'
import { useNotesStore } from '../store/useNotesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useUIStore } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import { useSubscriptionStore } from '../store/useSubscriptionStore'
import { PREFS_KEYS } from './prefs-keys'
import { currentWorkspaceIdKey, LOCAL_PARTITION } from './partition'
import type { NoteData, Folder, WorkspaceInfo } from '../store/types'

function resetStores(): void {
  useNotesStore.getState().setNotes({})
  useNotesStore.getState().setFolders({})
  useWorkspaceStore.getState().setWorkspaces({})
  useWorkspaceStore.getState().setCurrentWorkspaceId(null)
  useUIStore.getState().setSidebarCollapsed(false)
  useUIStore.getState().setIsDarkMode(false)
  useUIStore.getState().setSidebarWidth(280)
  useAuthStore.getState().setUser(null)
  useSubscriptionStore.getState().setSubscribed(null)
}

/** Mock DB: partition-based notesP/foldersP/workspacesP and prefs.get/toArray/put. */
function createMockDb(overrides: {
  notes?: NoteData[]
  folders?: Folder[]
  workspaces?: WorkspaceInfo[]
  prefs?: { key: string; value: unknown }[]
}): NoticDB {
  const {
    notes = [],
    folders = [],
    workspaces = [],
    prefs: prefsList = [],
  } = overrides

  const prefsGet = (key: string) =>
    Promise.resolve(prefsList.find((p) => p.key === key))
  const partitionTable = <T extends { sessionId?: string; id?: string }>(items: T[], _keyField?: string) => ({
    where: () => ({
      equals: (partition: string) => ({
        toArray: () =>
          Promise.resolve(items.map((item) => ({ ...item, partition }))),
        delete: () => Promise.resolve(),
      }),
    }),
    bulkAdd: () => Promise.resolve(),
  })

  return {
    notes: { toArray: () => Promise.resolve(notes) },
    folders: { toArray: () => Promise.resolve(folders) },
    workspaces: { toArray: () => Promise.resolve(workspaces), clear: () => Promise.resolve(), add: () => Promise.resolve() },
    notesP: partitionTable(notes, 'sessionId'),
    foldersP: partitionTable(folders, 'id'),
    workspacesP: {
      ...partitionTable(workspaces),
      where: () => ({
        equals: (_p: string) => ({
          toArray: () => Promise.resolve(workspaces.map((w) => ({ ...w, partition: LOCAL_PARTITION }))),
          delete: () => Promise.resolve(),
        }),
      }),
      add: () => Promise.resolve(),
    },
    prefs: {
      get: prefsGet,
      toArray: () => Promise.resolve(prefsList),
      put: () => Promise.resolve(),
    },
  } as unknown as NoticDB
}

describe('hydrateStores', () => {
  beforeEach(resetStores)

  it('hydrates notes and folders into the notes store', async () => {
    const note: NoteData = {
      sessionId: 'n1',
      content: 'Hello',
      lastModified: 1000,
      createdAt: 900,
      title: 'Note 1',
      wordCount: 1,
      folderId: undefined,
      workspaceId: 'w1',
    }
    const folder: Folder = {
      id: 'f1',
      name: 'Folder 1',
      parentId: null,
      createdAt: 800,
      workspaceId: 'w1',
    }
    const mockDb = createMockDb({ notes: [note], folders: [folder] })

    await hydrateStores(mockDb)

    expect(useNotesStore.getState().notes).toEqual({ n1: note })
    expect(useNotesStore.getState().folders).toEqual({ f1: folder })
  })

  it('hydrates workspaces and currentWorkspaceId', async () => {
    const ws: WorkspaceInfo = { id: 'w1', name: 'Default', isDefault: true }
    const mockDb = createMockDb({
      workspaces: [ws],
      prefs: [{ key: currentWorkspaceIdKey(LOCAL_PARTITION), value: 'w1' }],
    })

    await hydrateStores(mockDb)

    expect(useWorkspaceStore.getState().workspaces).toEqual({ w1: ws })
    expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('w1')
  })

  it('hydrates UI prefs: sidebarCollapsed, isDarkMode, sidebarWidth', async () => {
    const mockDb = createMockDb({
      prefs: [
        { key: PREFS_KEYS.sidebarCollapsed, value: true },
        { key: PREFS_KEYS.isDarkMode, value: true },
        { key: PREFS_KEYS.sidebarWidth, value: 320 },
      ],
    })

    await hydrateStores(mockDb)

    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    expect(useUIStore.getState().isDarkMode).toBe(true)
    expect(useUIStore.getState().sidebarWidth).toBe(320)
  })

  it('leaves notes/folders empty but ensures default workspace when db is empty', async () => {
    const mockDb = createMockDb({})

    await hydrateStores(mockDb)

    expect(useNotesStore.getState().notes).toEqual({})
    expect(useNotesStore.getState().folders).toEqual({})
    const workspaces = useWorkspaceStore.getState().workspaces
    expect(Object.keys(workspaces).length).toBe(1)
    expect(Object.values(workspaces)[0].isDefault).toBe(true)
    expect(useWorkspaceStore.getState().currentWorkspaceId).not.toBeNull()
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    expect(useUIStore.getState().isDarkMode).toBe(false)
  })
})
