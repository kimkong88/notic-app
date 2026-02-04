/**
 * Storage partition: local vs user (aligned with notic extension).
 * Partition = backend user id when signed in; LOCAL_PARTITION when not.
 * All notes, folders, workspaces are scoped by partition.
 */

import type { NoticDB } from './schema'
import { PREFS_KEYS } from './prefs-keys'

/** Partition for local-only data when not signed in (match extension storage-keys). */
export const LOCAL_PARTITION = '__local__'

/** Prefs key for current workspace per partition (extension: currentWorkspaceIdKey(partition)). */
export function currentWorkspaceIdKey(partition: string): string {
  return `currentWorkspaceId_${partition}`
}

/** Prefs key for last full sync time (epoch ms) per partition. */
export function lastPullAtKey(partition: string): string {
  return `lastPullAt_${partition}`
}

/** Prefs key for sync change log (array of SyncLogEntry) per partition. Match extension syncChangeLogKey. */
export function syncChangeLogKey(partition: string): string {
  return `notic_${partition}_syncChangeLog`
}

/**
 * Stored backend user id (partition key). Set on sign-in, cleared on sign-out.
 * When null, partition is LOCAL_PARTITION.
 */
export async function getStoredUserId(db: NoticDB): Promise<string | null> {
  const row = await db.prefs.get(PREFS_KEYS.authUserId)
  const value = row?.value
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * Last signed-in user id (not cleared on sign-out). Used for offline restore only (extension: getLastUserId).
 */
export async function getLastUserId(db: NoticDB): Promise<string | null> {
  const row = await db.prefs.get(PREFS_KEYS.authLastUserId)
  const value = row?.value
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

/**
 * Set current partition to userId (e.g. when restoring for offline mode from last user id).
 */
export async function setStoredUserId(db: NoticDB, userId: string): Promise<void> {
  await db.prefs.put({ key: PREFS_KEYS.authUserId, value: userId })
}

/**
 * Current storage partition: signed-in user id or LOCAL_PARTITION.
 * Use for all partition-scoped reads/writes (notes, folders, workspaces, currentWorkspaceId).
 */
export async function getStoragePartition(db: NoticDB): Promise<string> {
  const id = await getStoredUserId(db)
  return id ?? LOCAL_PARTITION
}
