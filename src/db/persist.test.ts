import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import type { NoticDB } from './schema'
import { startPersist, stopPersist } from './persist'
import { useNotesStore } from '../store/useNotesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useUIStore } from '../store/useUIStore'
import { PREFS_KEYS } from './prefs-keys'
import { currentWorkspaceIdKey, LOCAL_PARTITION } from './partition'
import { SIDEBAR_WIDTH_DEFAULT } from '../store/useUIStore'
import type { NoteData } from '../store/types'

type MockDbRecord = {
  prefsPuts: { key: string; value: unknown }[]
  notesCleared: number
  notesAdded: unknown[]
}

/** Mock DB that records bulkPut/bulkAdd/delete calls for assertions. Matches current persist flow: getStoragePartition (prefs.get), notesP/foldersP/workspacesP, prefs.bulkPut. */
function createMockDb(): MockDbRecord & {
  notesP: {
    where: (key: string) => { equals: (partition: string) => { delete: () => Promise<void> } }
    bulkAdd: (items: unknown[]) => Promise<void>
  }
  foldersP: {
    where: (key: string) => { equals: (partition: string) => { delete: () => Promise<void> } }
    bulkAdd: (items: unknown[]) => Promise<void>
  }
  workspacesP: {
    where: (key: string) => { equals: (partition: string) => { delete: () => Promise<void> } }
    bulkAdd: (items: unknown[]) => Promise<void>
  }
  prefs: {
    get: (key: string) => Promise<{ key: string; value: unknown } | undefined>
    bulkPut: (rows: { key: string; value: unknown }[]) => void
  }
} {
  const rec: MockDbRecord = {
    prefsPuts: [],
    notesCleared: 0,
    notesAdded: [],
  }
  const partitionChain = {
    where: (_key: string) => ({
      equals: (_partition: string) => ({
        delete: () => {
          rec.notesCleared += 1
          return Promise.resolve()
        },
      }),
    }),
    bulkAdd: (items: unknown[]) => {
      rec.notesAdded.push(...items)
      return Promise.resolve()
    },
  }
  const mockDb = {
    notesP: partitionChain,
    foldersP: {
      where: () => ({ equals: () => ({ delete: () => Promise.resolve() }) }),
      bulkAdd: () => Promise.resolve(),
    },
    workspacesP: {
      where: () => ({ equals: () => ({ delete: () => Promise.resolve() }) }),
      bulkAdd: () => Promise.resolve(),
    },
    prefs: {
      get: (_key: string) => Promise.resolve(undefined),
      bulkPut: (rows: { key: string; value: unknown }[]) => {
        rec.prefsPuts.push(...rows)
      },
    },
    get prefsPuts() {
      return rec.prefsPuts
    },
    get notesCleared() {
      return rec.notesCleared
    },
    get notesAdded() {
      return rec.notesAdded
    },
  }
  return mockDb
}

function resetStores(): void {
  useNotesStore.getState().setNotes({})
  useNotesStore.getState().setFolders({})
  useWorkspaceStore.getState().setWorkspaces({})
  useWorkspaceStore.getState().setCurrentWorkspaceId(null)
  useUIStore.getState().setSidebarCollapsed(false)
  useUIStore.getState().setIsDarkMode(false)
  useUIStore.getState().setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
}

describe('persist', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStores()
  })
  afterEach(() => {
    stopPersist()
    vi.useRealTimers()
  })

  it('writes UI prefs to db after store change and debounce', async () => {
    const mockDb = createMockDb()
    startPersist(mockDb as unknown as NoticDB)

    useUIStore.getState().setSidebarCollapsed(true)
    useUIStore.getState().setSidebarWidth(320)
    expect(mockDb.prefsPuts).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(200)

    const prefs = mockDb.prefsPuts
    expect(prefs.some((p) => p.key === PREFS_KEYS.sidebarCollapsed && p.value === true)).toBe(true)
    expect(prefs.some((p) => p.key === PREFS_KEYS.sidebarWidth && p.value === 320)).toBe(true)
  })

  it('writes currentWorkspaceId to prefs after workspace change', async () => {
    const mockDb = createMockDb()
    startPersist(mockDb as unknown as NoticDB)

    useWorkspaceStore.getState().setCurrentWorkspaceId('w1')
    await vi.advanceTimersByTimeAsync(200)

    const prefs = mockDb.prefsPuts
    expect(
      prefs.some(
        (p) => p.key === currentWorkspaceIdKey(LOCAL_PARTITION) && p.value === 'w1'
      )
    ).toBe(true)
  })

  it('writes notes to db after notes change and debounce', async () => {
    const mockDb = createMockDb()
    startPersist(mockDb as unknown as NoticDB)

    const note: NoteData = {
      sessionId: 'n1',
      content: 'Hi',
      lastModified: 1000,
      createdAt: 900,
      title: 'T',
      wordCount: 1,
      folderId: undefined,
      workspaceId: 'w1',
    }
    useNotesStore.getState().setNotes({ n1: note })
    await vi.advanceTimersByTimeAsync(350)
    await Promise.resolve()

    expect(mockDb.notesCleared).toBe(1)
    expect(mockDb.notesAdded).toHaveLength(1)
    expect(mockDb.notesAdded[0]).toMatchObject(note)
  })
})
