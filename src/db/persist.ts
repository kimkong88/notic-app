import type { NoticDB } from './schema'
import { PREFS_KEYS } from './prefs-keys'
import { getStoragePartition, currentWorkspaceIdKey, LOCAL_PARTITION } from './partition'
import { triggerSync } from '../sync'
import { useNotesStore } from '../store/useNotesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useUIStore } from '../store/useUIStore'

const DEBOUNCE_MS_DATA = 300
const DEBOUNCE_MS_PREFS = 150

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  return ((...args: Parameters<T>) => {
    if (timeoutId != null) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      timeoutId = null
      fn(...args)
    }, ms)
  }) as T
}

let unsubscribeNotes: (() => void) | undefined
let unsubscribeWorkspace: (() => void) | undefined
let unsubscribeUI: (() => void) | undefined
let isHydrating = false

/**
 * Persist notes and folders to IndexedDB for the current partition (debounced).
 * Uses a single transaction so delete + bulkAdd are atomic and concurrent runs don't cause "Key already exists".
 */
async function persistNotesAndFolders(db: NoticDB): Promise<void> {
  const partition = await getStoragePartition(db)
  const state = useNotesStore.getState()
  const notesList = Object.values(state.notes)
  const foldersList = Object.values(state.folders)
  await db.transaction('rw', [db.notesP, db.foldersP], async () => {
    await db.notesP.where('partition').equals(partition).delete()
    await db.foldersP.where('partition').equals(partition).delete()
    if (notesList.length > 0) {
      await db.notesP.bulkAdd(notesList.map((n) => ({ ...n, partition })))
    }
    if (foldersList.length > 0) {
      await db.foldersP.bulkAdd(foldersList.map((f) => ({ ...f, partition })))
    }
  })
  // Don't trigger sync during initial hydration (avoids double-sync on page load).
  if (!isHydrating && partition !== LOCAL_PARTITION) void triggerSync(db)
}

/**
 * Persist workspaces to IndexedDB for the current partition (debounced).
 * Uses a single transaction so delete + bulkAdd are atomic (avoids "Key already exists" on concurrent runs).
 */
async function persistWorkspaces(db: NoticDB): Promise<void> {
  const partition = await getStoragePartition(db)
  const state = useWorkspaceStore.getState()
  const list = Object.values(state.workspaces)
  await db.transaction('rw', [db.workspacesP], async () => {
    await db.workspacesP.where('partition').equals(partition).delete()
    if (list.length > 0) {
      await db.workspacesP.bulkAdd(list.map((w) => ({ ...w, partition })))
    }
  })
  // Don't trigger sync during initial hydration (avoids double-sync on page load).
  if (!isHydrating && partition !== LOCAL_PARTITION) void triggerSync(db)
}

/**
 * Persist UI and workspace prefs to IndexedDB (debounced).
 * currentWorkspaceId is stored per partition.
 */
async function persistPrefs(db: NoticDB): Promise<void> {
  const partition = await getStoragePartition(db)
  const workspace = useWorkspaceStore.getState()
  const ui = useUIStore.getState()
  await db.prefs.bulkPut([
    { key: currentWorkspaceIdKey(partition), value: workspace.currentWorkspaceId },
    { key: PREFS_KEYS.sidebarCollapsed, value: ui.sidebarCollapsed },
    { key: PREFS_KEYS.isDarkMode, value: ui.isDarkMode },
    { key: PREFS_KEYS.sidebarWidth, value: ui.sidebarWidth },
  ])
}

/**
 * Subscribe to Zustand stores and persist changes to Dexie.
 * Call once after hydrate so store updates are written to IndexedDB (offline-first).
 */
export function startPersist(db: NoticDB): void {
  const persistData = debounce(() => void persistNotesAndFolders(db), DEBOUNCE_MS_DATA)
  const persistWorkspacesDebounced = debounce(() => void persistWorkspaces(db), DEBOUNCE_MS_DATA)
  const persistPrefsDebounced = debounce(() => void persistPrefs(db), DEBOUNCE_MS_PREFS)

  unsubscribeNotes = useNotesStore.subscribe(() => {
    persistData()
  })

  unsubscribeWorkspace = useWorkspaceStore.subscribe(() => {
    persistWorkspacesDebounced()
    persistPrefsDebounced()
  })

  unsubscribeUI = useUIStore.subscribe(() => {
    persistPrefsDebounced()
  })

  // Clear hydrating flag immediately after subscriptions are set up.
  // Subscriptions fire on next change, not retroactively for hydrated data.
  isHydrating = false
}

/**
 * Stop persisting (e.g. for tests). Subscriptions are removed.
 */
export function stopPersist(): void {
  unsubscribeNotes?.()
  unsubscribeWorkspace?.()
  unsubscribeUI?.()
  unsubscribeNotes = undefined
  unsubscribeWorkspace = undefined
  unsubscribeUI = undefined
}

/**
 * Mark that hydration is in progress. Persist won't trigger sync until hydration completes.
 * Call before loading partition data into stores, and clear after sync completes.
 */
export function setHydrating(value: boolean): void {
  isHydrating = value
}

/** For debugging: check if currently hydrating */
export function getHydrating(): boolean {
  return isHydrating
}
