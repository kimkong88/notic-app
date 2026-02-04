import type { NoticDB } from './schema'
import { PREFS_KEYS } from './prefs-keys'
import { getStoragePartition, currentWorkspaceIdKey, LOCAL_PARTITION } from './partition'
import { setHydrating } from './persist'
import { useNotesStore } from '../store/useNotesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { DEFAULT_WORKSPACE_ID } from '../store/useWorkspaceStore'
import { useUIStore } from '../store/useUIStore'
import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from '../store/useUIStore'
import { useAuthStore } from '../store/useAuthStore'
import type { GoogleUserProfile } from '../store/useAuthStore'
import { useSubscriptionStore } from '../store/useSubscriptionStore'
import type { NoteData, Folder, WorkspaceInfo } from '../store/types'

/** Convert array to record by key for notes/folders/workspaces. */
function toRecord<K extends string, T extends { [k in K]: string }>(
  items: T[],
  key: K
): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of items) out[item[key]] = item
  return out
}

/**
 * Ensure at least one default workspace exists and currentWorkspaceId is valid for this partition.
 * Matches extension ensureDefaultWorkspace(); writes to workspacesP and partition-scoped prefs.
 */
async function ensureDefaultWorkspace(
  db: NoticDB,
  partition: string,
  workspacesRecord: Record<string, WorkspaceInfo>,
  currentWorkspaceId: string | null | undefined
): Promise<{ workspaces: Record<string, WorkspaceInfo>; currentWorkspaceId: string }> {
  const list = Object.values(workspacesRecord)
  let currentId: string | null = currentWorkspaceId ?? null

  if (list.length === 0) {
    const now = Date.now()
    const defaultWs: WorkspaceInfo = {
      id: DEFAULT_WORKSPACE_ID,
      name: 'Workspace 1',
      isDefault: true,
      lastModified: now,
    }
    const nextRecord = { [DEFAULT_WORKSPACE_ID]: defaultWs }
    await db.workspacesP.where('partition').equals(partition).delete()
    await db.workspacesP.add({ ...defaultWs, partition })
    await db.prefs.put({ key: currentWorkspaceIdKey(partition), value: DEFAULT_WORKSPACE_ID })
    return { workspaces: nextRecord, currentWorkspaceId: DEFAULT_WORKSPACE_ID }
  }

  const hasCurrent = currentId != null && workspacesRecord[currentId] != null
  if (!hasCurrent) {
    const defaultOrFirst =
      list.find((w) => w.isDefault)?.id ?? list[0]?.id ?? DEFAULT_WORKSPACE_ID
    currentId = defaultOrFirst
    await db.prefs.put({ key: currentWorkspaceIdKey(partition), value: currentId })
  }

  const finalId = currentId ?? list[0]?.id ?? DEFAULT_WORKSPACE_ID
  return { workspaces: workspacesRecord, currentWorkspaceId: finalId }
}

/**
 * Load one partition's notes, folders, workspaces and currentWorkspaceId into stores.
 * Used at init (hydrate), on sign-in (switch to user partition), and on sign-out (switch to local).
 * Note: Caller is responsible for managing isHydrating flag to prevent persist from triggering syncs.
 */
export async function loadPartitionIntoStores(db: NoticDB, partition: string): Promise<void> {
  const [notesP, foldersP, workspacesP, cwPref, legacyCwPref] = await Promise.all([
    db.notesP.where('partition').equals(partition).toArray(),
    db.foldersP.where('partition').equals(partition).toArray(),
    db.workspacesP.where('partition').equals(partition).toArray(),
    db.prefs.get(currentWorkspaceIdKey(partition)),
    partition === LOCAL_PARTITION ? db.prefs.get(PREFS_KEYS.currentWorkspaceId) : Promise.resolve(undefined),
  ])

  const notes = notesP.map((n) => {
    const { partition: _p, ...rest } = n
    return rest as NoteData
  })
  const folders = foldersP.map((f) => {
    const { partition: _p, ...rest } = f
    return rest as Folder
  })
  const workspaces = workspacesP.map((w) => {
    const { partition: _p, ...rest } = w
    return rest as WorkspaceInfo
  })

  useNotesStore.getState().setNotes(toRecord(notes, 'sessionId'))
  useNotesStore.getState().setFolders(toRecord(folders, 'id'))

  const workspacesRecord = toRecord(workspaces, 'id')
  const currentWorkspaceIdPref = (cwPref?.value ?? legacyCwPref?.value) as string | null | undefined

  const { workspaces: finalWorkspaces, currentWorkspaceId: finalCurrentId } =
    await ensureDefaultWorkspace(db, partition, workspacesRecord, currentWorkspaceIdPref)

  useWorkspaceStore.getState().setWorkspaces(finalWorkspaces)
  useWorkspaceStore.getState().setCurrentWorkspaceId(finalCurrentId)
}

/**
 * Read current partition data from the DB and update Zustand stores.
 * Call once at app init; also call after sign-in/sign-out to switch partition.
 */
export async function hydrateStores(db: NoticDB): Promise<void> {
  const partition = await getStoragePartition(db)
  await loadPartitionIntoStores(db, partition)

  const prefsList = await db.prefs.toArray()
  const prefs = Object.fromEntries(prefsList.map((p) => [p.key, p.value])) as Record<
    string,
    unknown
  >

  const sidebarCollapsed = prefs[PREFS_KEYS.sidebarCollapsed] as boolean | undefined
  if (typeof sidebarCollapsed === 'boolean') {
    useUIStore.getState().setSidebarCollapsed(sidebarCollapsed)
  }

  const isDarkMode = prefs[PREFS_KEYS.isDarkMode] as boolean | undefined
  if (typeof isDarkMode === 'boolean') {
    useUIStore.getState().setIsDarkMode(isDarkMode)
  }

  const sidebarWidth = prefs[PREFS_KEYS.sidebarWidth] as number | undefined
  if (typeof sidebarWidth === 'number') {
    const clamped = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, sidebarWidth))
    useUIStore.getState().setSidebarWidth(clamped)
  }

  // Restore auth UI state from stored profile when we have a signed-in partition (avatar persists after refresh).
  if (partition !== LOCAL_PARTITION) {
    const authLastUser = prefs[PREFS_KEYS.authLastUser] as GoogleUserProfile | null | undefined
    if (
      authLastUser &&
      typeof authLastUser === 'object' &&
      typeof authLastUser.sub === 'string' &&
      typeof authLastUser.name === 'string' &&
      typeof authLastUser.picture === 'string'
    ) {
      useAuthStore.getState().setUser({
        sub: authLastUser.sub,
        email: typeof authLastUser.email === 'string' ? authLastUser.email : undefined,
        name: authLastUser.name,
        picture: authLastUser.picture,
      })
    }
  }

  const subscriptionIsPro = prefs[PREFS_KEYS.subscriptionIsPro] as boolean | undefined
  if (typeof subscriptionIsPro === 'boolean') {
    useSubscriptionStore.getState().setSubscribed(subscriptionIsPro)
  }
}
