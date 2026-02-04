/**
 * Sync log: situation-agnostic, Obsidian-style event log (user-visible).
 * Each entry is "at this time, this happened" with a human-readable message.
 * Matches notic extension sync-change-log.ts.
 */

import type { NoticDB } from './db/schema'
import { getStoragePartition } from './db/partition'
import { syncChangeLogKey } from './db/partition'

const SYNC_CHANGE_LOG_MAX_ENTRIES = 500

/** Kind of sync event (for filtering/display). Matches extension SyncLogEntryKind. */
export type SyncLogEntryKind =
  | 'connecting'
  | 'connection_success'
  | 'connection_failed'
  | 'detecting_changes'
  | 'fully_synced'
  | 'uploading'
  | 'upload_complete'
  | 'downloading'
  | 'download_complete'
  | 'server_overwrote_local'
  | 'local_overwrote_server'
  | 'deleting_remote'
  | 'error'

export interface SyncLogEntry {
  at: number
  kind: SyncLogEntryKind
  message: string
  details?: Record<string, unknown>
}

export async function getSyncChangeLog(db: NoticDB): Promise<SyncLogEntry[]> {
  const partition = await getStoragePartition(db)
  const key = syncChangeLogKey(partition)
  const row = await db.prefs.get(key)
  const raw = row?.value
  if (!Array.isArray(raw)) return []
  return raw as SyncLogEntry[]
}

/** Append entries and cap at SYNC_CHANGE_LOG_MAX_ENTRIES (keep newest). Uses current partition. */
export async function appendSyncChangeLog(db: NoticDB, entries: SyncLogEntry[]): Promise<void> {
  if (entries.length === 0) return
  const partition = await getStoragePartition(db)
  const key = syncChangeLogKey(partition)
  const log = await getSyncChangeLog(db)
  const next = [...log, ...entries]
  const capped = next.slice(-SYNC_CHANGE_LOG_MAX_ENTRIES)
  await db.prefs.put({ key, value: capped })
}
