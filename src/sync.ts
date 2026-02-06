/**
 * Full sync: pull (GET /sync) → merge → push (POST /sync) → write to IndexedDB and stores.
 * Aligned with notic extension sync.ts; uses app stores + db (no chrome.storage).
 */

import type { NoticDB } from "./db/schema";
import { fetchWithAuth, getStoredTokens } from "./api/backend";
import {
    getStoragePartition,
    lastPullAtKey,
    LOCAL_PARTITION,
} from "./db/partition";
import { loadPartitionIntoStores } from "./db/hydrate";
import { PREFS_KEYS } from "./db/prefs-keys";
import { appendSyncChangeLog } from "./sync-change-log";
import type { SyncLogEntry } from "./sync-change-log";
import { useNotesStore } from "./store/useNotesStore";
import { useWorkspaceStore } from "./store/useWorkspaceStore";
import { DEFAULT_WORKSPACE_ID } from "./store/useWorkspaceStore";
import type { NoteData, Folder, WorkspaceInfo } from "./store/types";

/** Chunk size for push when notes count is large (matches extension NOTE_PUSH_CHUNK_SIZE). */
const NOTE_PUSH_CHUNK_SIZE = 500;
/** Retry attempts for pull/push/merge (network/5xx). */
const SYNC_RETRY_ATTEMPTS = 3;
/** Initial delay (ms) before first retry; doubles each attempt. */
const SYNC_RETRY_DELAY_MS = 1000;
/** Periodic pull-only check interval (matches extension PERIODIC_PULL_INTERVAL_MS). */
const PERIODIC_PULL_INTERVAL_MS = 5 * 60 * 1000;
/** Grace period: don't treat as "server newer" if server update is within this of our lastPullAt (matches extension). */
const SERVER_NEWER_GRACE_MS = 60 * 1000;

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(
    fn: () => Promise<T>,
    attempts: number = SYNC_RETRY_ATTEMPTS
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= attempts; i++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e;
            if (i < attempts) await delay(SYNC_RETRY_DELAY_MS * Math.pow(2, i));
        }
    }
    throw lastErr;
}

/** Pull response shape (GET /sync); matches backend. */
export interface PullResponse {
    notes: Array<{
        id: string;
        content: string;
        lastModified: number;
        createdAt: number;
        displayName?: string;
        folderId?: string;
        workspaceId: string;
        deletedAt?: number;
        color?: string;
        isBookmarked?: boolean;
        shareCode?: string;
    }>;
    folders: Array<{
        id: string;
        name: string;
        parentId: string | null;
        createdAt: number;
        displayName?: string;
        workspaceId: string;
        color?: string;
    }>;
    workspaces: Array<{
        id: string;
        name: string;
        isDefault: boolean;
        updatedAt: number;
        color?: string;
        icon?: string;
    }>;
    nextCursor?: string;
    deletedNoteIds?: string[];
    deletedFolderIds?: string[];
    deletedWorkspaceIds?: string[];
}

export type SyncStatus = "idle" | "syncing" | "synced" | "failed";

/** Body for POST /sync: merged/delta payload with deleted*Ids. */
type PushBody = PullResponse & {
    deletedNoteIds: string[];
    deletedFolderIds: string[];
    deletedWorkspaceIds: string[];
};

let syncState: SyncStatus = "idle";
const listeners: Array<(s: SyncStatus) => void> = [];
const serverNewerListeners: Array<() => void> = [];
let periodicPullIntervalId: ReturnType<typeof setInterval> | null = null;
let fullSyncInProgress: Promise<void> | null = null;

/** Cached server snapshot for delta push. Set after full sync; updated after each successful triggerSync. Cleared on sign-out. */
let lastServerSnapshot: PullResponse | null = null;

export function clearLastServerSnapshot(): void {
    lastServerSnapshot = null;
}

function setSyncState(s: SyncStatus): void {
    if (syncState === s) return;
    syncState = s;
    listeners.forEach((cb) => cb(syncState));
}

/** Reset sync state to idle. Call when signing out or entering local-only mode. */
export function resetSyncState(): void {
    setSyncState("idle");
}

export function getSyncStatus(): SyncStatus {
    return syncState;
}

export function subscribeSyncStatus(cb: (s: SyncStatus) => void): () => void {
    listeners.push(cb);
    cb(syncState);
    return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
    };
}

export async function getLastPullAt(db: NoticDB): Promise<number> {
    const partition = await getStoragePartition(db);
    const row = await db.prefs.get(lastPullAtKey(partition));
    const v = row?.value;
    return typeof v === "number" ? v : 0;
}

async function setLastPullAt(
    db: NoticDB,
    partition: string,
    epochMs: number
): Promise<void> {
    await db.prefs.put({ key: lastPullAtKey(partition), value: epochMs });
}

/** Debug: whether sync is paused (no pull/push). Reads from prefs; matches extension SYNC_PAUSED_KEY. */
export async function getSyncPaused(db: NoticDB): Promise<boolean> {
    const row = await db.prefs.get(PREFS_KEYS.syncPaused);
    return row?.value === true;
}

/** Set sync paused. When true, triggerFullSync no-ops unless ignorePaused; clears lastServerSnapshot so resume sends full. Matches extension setSyncPaused. */
export async function setSyncPaused(
    db: NoticDB,
    value: boolean
): Promise<void> {
    if (value) clearLastServerSnapshot();
    await db.prefs.put({ key: PREFS_KEYS.syncPaused, value: !!value });
}

/** Subscribe to "server has newer data" (from periodic pull-only check). Use to show "Refresh to get latest" hint. Matches extension. */
export function subscribeServerNewer(cb: () => void): () => void {
    serverNewerListeners.push(cb);
    return () => {
        const i = serverNewerListeners.indexOf(cb);
        if (i >= 0) serverNewerListeners.splice(i, 1);
    };
}

/** Lightweight check: GET /sync/status; if server lastUpdatedAt > our lastPullAt, notify listeners (no merge). Matches extension checkServerNewer. */
export async function checkServerNewer(db: NoticDB): Promise<boolean> {
    if (await getSyncPaused(db)) return false;
    const tokens = await getStoredTokens(db);
    if (!tokens) return false;
    try {
        const res = await fetchWithAuth(db, "/sync/status", { method: "GET" });
        if (!res.ok) return false;
        const data = (await res.json()) as { lastUpdatedAt: number };
        const lastPullAt = await getLastPullAt(db);
        if (
            lastPullAt > 0 &&
            data.lastUpdatedAt > lastPullAt + SERVER_NEWER_GRACE_MS
        ) {
            serverNewerListeners.forEach((cb) => {
                try {
                    cb();
                } catch (e) {
                    console.error("[sync] serverNewer listener error", e);
                }
            });
            return true;
        }
    } catch {
        // ignore network errors for periodic check
    }
    return false;
}

/** Start periodic pull-only check (every N min). Call when signed in. No merge; only notifies if server is newer. Matches extension. */
export function startPeriodicPullCheck(db: NoticDB): void {
    stopPeriodicPullCheck();
    periodicPullIntervalId = setInterval(() => {
        // Only check if online - avoid failed API calls when offline
        if (navigator.onLine) {
            void checkServerNewer(db);
        }
    }, PERIODIC_PULL_INTERVAL_MS);
}

/** Stop periodic pull check. Call when signed out or app unloads. Matches extension. */
export function stopPeriodicPullCheck(): void {
    if (periodicPullIntervalId != null) {
        clearInterval(periodicPullIntervalId);
        periodicPullIntervalId = null;
    }
}

/** Build payload from current stores (same shape as POST /sync body). */
function buildLocalPayload(): {
    notes: PullResponse["notes"];
    folders: PullResponse["folders"];
    workspaces: PullResponse["workspaces"];
} {
    const notesState = useNotesStore.getState();
    const workspaceState = useWorkspaceStore.getState();
    const notesList = Object.values(notesState.notes);
    const foldersList = Object.values(notesState.folders);
    const workspacesList = Object.values(workspaceState.workspaces);

    const notes: PullResponse["notes"] = notesList.map((n) => ({
        id: n.sessionId,
        content: n.content,
        lastModified: n.lastModified,
        createdAt: n.createdAt,
        displayName: n.displayName,
        folderId: n.folderId,
        workspaceId: n.workspaceId ?? DEFAULT_WORKSPACE_ID,
        ...(n.deletedAt != null && { deletedAt: n.deletedAt }),
        ...(n.color != null && { color: n.color }),
        ...(n.isBookmarked != null && { isBookmarked: n.isBookmarked }),
        ...(n.shareCode != null && { shareCode: n.shareCode }),
    }));

    const folders: PullResponse["folders"] = foldersList.map((f) => ({
        id: f.id,
        name: f.name,
        parentId: f.parentId ?? null,
        createdAt: f.createdAt,
        displayName: f.displayName,
        workspaceId: f.workspaceId ?? DEFAULT_WORKSPACE_ID,
        ...(f.color != null && { color: f.color }),
    }));

    const workspaces: PullResponse["workspaces"] =
        workspacesList.length > 0
            ? workspacesList.map((w) => ({
                  id: w.id,
                  name: w.name,
                  isDefault: w.isDefault,
                  updatedAt: w.lastModified ?? Date.now(),
                  ...(w.color != null && { color: w.color }),
                  ...(w.icon != null && { icon: w.icon }),
              }))
            : [
                  {
                      id: DEFAULT_WORKSPACE_ID,
                      name: "Workspace 1",
                      isDefault: true,
                      updatedAt: Date.now(),
                  },
              ];

    return { notes, folders, workspaces };
}

/** Merge local + server. Respects server deleted*Ids (filters out before merge). Workspaces: newer wins; when server wins preserve local color/icon if server lacks them; append local-only. Folders: local overwrites server. Notes: newer wins; tie → local. Matches extension. */
function computeMergedState(
    local: {
        notes: PullResponse["notes"];
        folders: PullResponse["folders"];
        workspaces: PullResponse["workspaces"];
    },
    server: PullResponse
): PullResponse {
    // Filter out local items that the server explicitly deleted (respect server.deleted*Ids).
    const deletedNoteIds = new Set(server.deletedNoteIds ?? []);
    const deletedFolderIds = new Set(server.deletedFolderIds ?? []);
    const deletedWorkspaceIds = new Set(server.deletedWorkspaceIds ?? []);
    const filteredLocalNotes = local.notes.filter(
        (n) => !deletedNoteIds.has(n.id)
    );
    const filteredLocalFolders = local.folders.filter(
        (f) => !deletedFolderIds.has(f.id)
    );
    const filteredLocalWorkspaces = local.workspaces.filter(
        (w) => !deletedWorkspaceIds.has(w.id)
    );

    const serverWs =
        server.workspaces.length > 0
            ? server.workspaces
            : [
                  {
                      id: DEFAULT_WORKSPACE_ID,
                      name: "Workspace 1",
                      isDefault: true,
                      updatedAt: Date.now(),
                  },
              ];
    const localWs = filteredLocalWorkspaces;
    const workspaceById = new Map(serverWs.map((w) => [w.id, w]));
    for (const w of localWs) {
        const existing = workspaceById.get(w.id);
        const localTs = w.updatedAt ?? 0;
        if (!existing || localTs > (existing.updatedAt ?? 0)) {
            workspaceById.set(w.id, { ...w, updatedAt: localTs });
        } else {
            // Server won on timestamp; preserve local color/icon if server doesn't have them (matches extension)
            const sw = existing;
            workspaceById.set(w.id, {
                ...sw,
                ...(w.color != null &&
                    (sw.color == null || sw.color === "") && {
                        color: w.color,
                    }),
                ...(w.icon != null &&
                    (sw.icon == null || sw.icon === "") && { icon: w.icon }),
            });
        }
    }
    // Append local-only workspaces (ids not in merged list)
    const mergedWsIds = new Set(workspaceById.keys());
    for (const w of localWs) {
        if (!mergedWsIds.has(w.id)) {
            workspaceById.set(w.id, {
                ...w,
                updatedAt: w.updatedAt ?? Date.now(),
            });
        }
    }
    const workspaces = Array.from(workspaceById.values()).sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

    const folderById = new Map(server.folders.map((f) => [f.id, f]));
    for (const f of filteredLocalFolders) folderById.set(f.id, f);
    const folders = Array.from(folderById.values());

    const noteById = new Map(server.notes.map((n) => [n.id, n]));
    for (const n of filteredLocalNotes) {
        const existing = noteById.get(n.id);
        if (!existing || n.lastModified >= (existing.lastModified ?? 0)) {
            noteById.set(n.id, n as (typeof server.notes)[0]);
        }
    }
    const notes = Array.from(noteById.values());

    return { notes, folders, workspaces };
}

function valueEq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (typeof a === "object" && typeof b === "object")
        return JSON.stringify(a) === JSON.stringify(b);
    return false;
}

function diffChanged(
    local: Record<string, unknown>,
    server: Record<string, unknown>,
    keys: string[]
): Array<{ key: string; oldValue: unknown; newValue: unknown }> {
    return keys
        .filter((k) => !valueEq(local[k], server[k]))
        .map((k) => ({ key: k, oldValue: local[k], newValue: server[k] }));
}

function formatChangePart(c: {
    key: string;
    oldValue: unknown;
    newValue: unknown;
}): string {
    if (c.key === "content") return "Content is updated";
    if (c.key === "lastModified") return "Updated from server";
    if (c.key === "folderId") {
        const wasRoot = c.oldValue === undefined || c.oldValue === null;
        const nowRoot = c.newValue === undefined || c.newValue === null;
        if (wasRoot && !nowRoot) return "Moved to a folder";
        if (!wasRoot && nowRoot) return "Moved to No folder";
        return "Folder changed";
    }
    if (c.key === "displayName") return "Title changed";
    if (c.key === "name") return "Name changed";
    if (c.key === "workspaceId") return "Workspace changed";
    if (c.key === "parentId") return "Location changed";
    if (c.key === "deletedAt") {
        const hadDeletedAt = c.oldValue !== undefined && c.oldValue !== null;
        const hasDeletedAt = c.newValue !== undefined && c.newValue !== null;
        if (hadDeletedAt && !hasDeletedAt) return "Restored from trash";
        if (!hadDeletedAt && hasDeletedAt) return "Moved to trash";
        return "Trash status changed";
    }
    if (c.key === "color") return "Color changed";
    if (c.key === "icon") return "Icon changed";
    return "Updated";
}

function entityDisplayLabel(
    entityType: "workspace" | "folder" | "note",
    _fallbackId: string
): string {
    switch (entityType) {
        case "note":
            return "Untitled note";
        case "folder":
            return "Unnamed folder";
        case "workspace":
            return "Unnamed workspace";
        default:
            return "Item";
    }
}

function noteDisplayLabel(note: {
    displayName?: string;
    content?: string;
    id: string;
}): string {
    const isIdLike = (s: string) =>
        /^[0-9a-f-]{36}$/i.test(s) ||
        s.length > 40 ||
        /^(clip_|session_)/i.test(s);
    if (note.displayName && !isIdLike(note.displayName))
        return note.displayName;
    if (note.content && note.content.trim()) {
        const firstLine = note.content.split("\n")[0].trim();
        const heading = firstLine.match(/^#{1,6}\s+(.+)$/);
        const title = heading ? heading[1].trim() : firstLine;
        if (title)
            return title.length > 50 ? title.substring(0, 50) + "…" : title;
    }
    return "Untitled note";
}

function formatOverwriteMessage(
    entityType: "workspace" | "folder" | "note",
    displayName: string,
    changed: Array<{ key: string; oldValue: unknown; newValue: unknown }>
): string {
    const parts = changed.map(formatChangePart);
    const isLikelyUuid = (s: string) =>
        /^[0-9a-f-]{36}$/i.test(s) || s.length > 40;
    const name =
        displayName && !isLikelyUuid(displayName)
            ? displayName
            : entityDisplayLabel(entityType, displayName);
    const summary = parts.length === 1 ? parts[0] : parts.join(". ");
    const entityLabel =
        entityType === "note"
            ? "Note"
            : entityType === "folder"
            ? "Folder"
            : "Workspace";
    return `${entityLabel} "${name}" — ${summary}`;
}

type LocalPayload = {
    notes: PullResponse["notes"];
    folders: PullResponse["folders"];
    workspaces: PullResponse["workspaces"];
};

/** Compute "server overwrote local" log entries. Matches extension computeServerOverwriteLogEntries. */
function computeServerOverwriteLogEntries(
    local: LocalPayload,
    server: PullResponse
): SyncLogEntry[] {
    const now = Date.now();
    const entries: SyncLogEntry[] = [];
    const workspaceKeys = ["name", "isDefault", "color", "icon"];
    for (const sw of server.workspaces) {
        const lw = local.workspaces.find((w) => w.id === sw.id);
        if (!lw) continue;
        const changed = diffChanged(
            lw as unknown as Record<string, unknown>,
            sw as unknown as Record<string, unknown>,
            workspaceKeys
        );
        if (changed.length > 0)
            entries.push({
                at: now,
                kind: "server_overwrote_local",
                message: formatOverwriteMessage(
                    "workspace",
                    lw.name ?? sw.id,
                    changed
                ),
                details: { entityType: "workspace", entityId: sw.id, changed },
            });
    }
    const folderKeys = [
        "name",
        "parentId",
        "displayName",
        "workspaceId",
        "color",
    ];
    for (const sf of server.folders) {
        const lf = local.folders.find((f) => f.id === sf.id);
        if (!lf) continue;
        const changed = diffChanged(
            lf as unknown as Record<string, unknown>,
            sf as unknown as Record<string, unknown>,
            folderKeys
        );
        if (changed.length > 0)
            entries.push({
                at: now,
                kind: "server_overwrote_local",
                message: formatOverwriteMessage(
                    "folder",
                    lf.name ?? sf.id,
                    changed
                ),
                details: { entityType: "folder", entityId: sf.id, changed },
            });
    }
    const noteKeys = [
        "content",
        "lastModified",
        "displayName",
        "folderId",
        "workspaceId",
        "deletedAt",
        "color",
    ];
    for (const sn of server.notes) {
        const ln = local.notes.find((n) => n.id === sn.id);
        if (!ln) continue;
        const changed = diffChanged(
            ln as unknown as Record<string, unknown>,
            sn as unknown as Record<string, unknown>,
            noteKeys
        );
        if (changed.length > 0)
            entries.push({
                at: now,
                kind: "server_overwrote_local",
                message: formatOverwriteMessage(
                    "note",
                    noteDisplayLabel(ln),
                    changed
                ),
                details: { entityType: "note", entityId: sn.id, changed },
            });
    }
    return entries;
}

/**
 * Filter to selective push: local-only + local-newer-or-equal notes; folders/workspaces sent in full.
 * Uses >= (not >) to include metadata-only changes where lastModified matches (e.g. deletedAt set with same timestamp).
 * Matches extension filterPayloadToLocalNewer.
 */
function filterPayloadToLocalNewer(
    local: LocalPayload,
    server: PullResponse
): LocalPayload {
    const serverNoteById = new Map(server.notes.map((n) => [n.id, n]));
    const filteredNotes = local.notes.filter((n) => {
        const serverNote = serverNoteById.get(n.id);
        if (!serverNote) return true;
        return n.lastModified >= serverNote.lastModified;
    });
    return {
        notes: filteredNotes,
        folders: local.folders,
        workspaces: local.workspaces,
    };
}

/** IDs on server but not in local = hard-deleted. For delta push deleted*Ids. */
function computeDeletedIds(
    server: PullResponse,
    local: LocalPayload
): {
    deletedNoteIds: string[];
    deletedFolderIds: string[];
    deletedWorkspaceIds: string[];
} {
    const localNoteIds = new Set(local.notes.map((n) => n.id));
    const localFolderIds = new Set(local.folders.map((f) => f.id));
    const localWorkspaceIds = new Set(local.workspaces.map((w) => w.id));
    return {
        deletedNoteIds: server.notes
            .filter((n) => !localNoteIds.has(n.id))
            .map((n) => n.id),
        deletedFolderIds: server.folders
            .filter((f) => !localFolderIds.has(f.id))
            .map((f) => f.id),
        deletedWorkspaceIds: server.workspaces
            .filter((w) => !localWorkspaceIds.has(w.id))
            .map((w) => w.id),
    };
}

/** Build delta payload: local-only + local-newer entities + deleted*Ids. Matches extension buildDeltaPayload. */
function buildDeltaPayload(
    local: LocalPayload,
    server: PullResponse
): PushBody {
    const filtered = filterPayloadToLocalNewer(local, server);
    const deleted = computeDeletedIds(server, local);
    return {
        ...filtered,
        deletedNoteIds: deleted.deletedNoteIds,
        deletedFolderIds: deleted.deletedFolderIds,
        deletedWorkspaceIds: deleted.deletedWorkspaceIds,
    };
}

/** Apply delta push to server snapshot (in memory). Used to update lastServerSnapshot after successful triggerSync. */
function applyDeltaToSnapshot(
    server: PullResponse,
    payload: PushBody
): PullResponse {
    const delNotes = new Set(payload.deletedNoteIds);
    const delFolders = new Set(payload.deletedFolderIds);
    const delWorkspaces = new Set(payload.deletedWorkspaceIds);
    const noteById = new Map(
        server.notes.filter((n) => !delNotes.has(n.id)).map((n) => [n.id, n])
    );
    for (const n of payload.notes) noteById.set(n.id, n);
    const folderById = new Map(
        server.folders
            .filter((f) => !delFolders.has(f.id))
            .map((f) => [f.id, f])
    );
    for (const f of payload.folders) folderById.set(f.id, f);
    const workspaceById = new Map(
        server.workspaces
            .filter((w) => !delWorkspaces.has(w.id))
            .map((w) => [w.id, w])
    );
    const workspaceList =
        payload.workspaces.length > 0
            ? payload.workspaces
            : [
                  {
                      id: DEFAULT_WORKSPACE_ID,
                      name: "Workspace 1",
                      isDefault: true,
                      updatedAt: Date.now(),
                  },
              ];
    for (const w of workspaceList) {
        workspaceById.set(w.id, w);
    }
    return {
        notes: Array.from(noteById.values()),
        folders: Array.from(folderById.values()),
        workspaces: Array.from(workspaceById.values()),
    };
}

/** Convert local payload to PullResponse shape (for caching after full push when no server snapshot). */
function localPayloadToPullResponse(local: LocalPayload): PullResponse {
    return {
        notes: local.notes,
        folders: local.folders,
        workspaces: local.workspaces,
    };
}

/** GET /sync (all pages). */
async function pullFromServer(
    db: NoticDB,
    since?: number
): Promise<PullResponse> {
    const notes: PullResponse["notes"] = [];
    let folders: PullResponse["folders"] = [];
    let workspaces: PullResponse["workspaces"] = [];
    let deletedNoteIds: string[] | undefined;
    let deletedFolderIds: string[] | undefined;
    let deletedWorkspaceIds: string[] | undefined;
    let cursor: string | undefined;

    do {
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", cursor);
        else if (since != null && since > 0) params.set("since", String(since));
        const url = params.toString() ? `/sync?${params.toString()}` : "/sync";
        const res = await fetchWithAuth(db, url, { method: "GET" });
        if (!res.ok) throw new Error(`Pull failed: ${res.status}`);
        const page = (await res.json()) as PullResponse;
        notes.push(...page.notes);
        if (page.folders.length > 0) folders = page.folders;
        if (page.workspaces.length > 0) workspaces = page.workspaces;
        if (!cursor && page.deletedNoteIds?.length)
            deletedNoteIds = page.deletedNoteIds;
        if (!cursor && page.deletedFolderIds?.length)
            deletedFolderIds = page.deletedFolderIds;
        if (!cursor && page.deletedWorkspaceIds?.length)
            deletedWorkspaceIds = page.deletedWorkspaceIds;
        cursor = page.nextCursor;
    } while (cursor);

    const out: PullResponse = { notes, folders, workspaces };
    if (deletedNoteIds?.length) out.deletedNoteIds = deletedNoteIds;
    if (deletedFolderIds?.length) out.deletedFolderIds = deletedFolderIds;
    if (deletedWorkspaceIds?.length)
        out.deletedWorkspaceIds = deletedWorkspaceIds;
    return out;
}

/** POST /sync with payload (full or delta). Chunks notes by NOTE_PUSH_CHUNK_SIZE (500). */
async function pushPayload(db: NoticDB, body: PushBody): Promise<void> {
    const workspacesForApi = (
        body.workspaces.length > 0
            ? body.workspaces
            : [
                  {
                      id: DEFAULT_WORKSPACE_ID,
                      name: "Workspace 1",
                      isDefault: true,
                      updatedAt: Date.now(),
                  },
              ]
    ).map((w) => ({
        id: w.id,
        name: w.name,
        isDefault: w.isDefault,
        ...(w.color != null && w.color !== "" && { color: w.color }),
        ...(w.icon != null && w.icon !== "" && { icon: w.icon }),
    }));
    const baseBody = {
        folders: body.folders,
        workspaces: workspacesForApi,
        deletedNoteIds: body.deletedNoteIds,
        deletedFolderIds: body.deletedFolderIds,
        deletedWorkspaceIds: body.deletedWorkspaceIds,
    };
    const notes = body.notes;
    if (notes.length <= NOTE_PUSH_CHUNK_SIZE) {
        const res = await fetchWithAuth(db, "/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...baseBody, notes }),
        });
        if (!res.ok) throw new Error(`Push failed: ${res.status}`);
        return;
    }
    for (let i = 0; i < notes.length; i += NOTE_PUSH_CHUNK_SIZE) {
        const chunk = notes.slice(i, i + NOTE_PUSH_CHUNK_SIZE);
        const res = await fetchWithAuth(db, "/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...baseBody, notes: chunk }),
        });
        if (!res.ok) throw new Error(`Push failed (chunk): ${res.status}`);
    }
}

/** Write merged state to IndexedDB for partition, then reload stores. */
async function mergeIntoDbAndStores(
    db: NoticDB,
    partition: string,
    merged: PullResponse
): Promise<void> {
    const notesP: Array<NoteData & { partition: string }> = merged.notes.map(
        (n) => {
            const title =
                (n.displayName ??
                    n.content.split("\n")[0]?.trim().slice(0, 100) ??
                    "") ||
                "Untitled";
            const wordCount = (n.content.match(/\S+/g) ?? []).length;
            return {
                sessionId: n.id,
                content: n.content,
                lastModified: n.lastModified,
                createdAt: n.createdAt,
                title,
                wordCount,
                folderId: n.folderId,
                displayName: n.displayName,
                workspaceId: n.workspaceId,
                deletedAt: n.deletedAt,
                color: n.color,
                isBookmarked: n.isBookmarked,
                shareCode: n.shareCode,
                partition,
            };
        }
    );
    const foldersP: Array<Folder & { partition: string }> = merged.folders.map(
        (f) => ({ ...f, partition })
    );
    const workspacesP: Array<WorkspaceInfo & { partition: string }> =
        merged.workspaces.map((w) => ({
            id: w.id,
            name: w.name,
            isDefault: w.isDefault,
            lastModified: w.updatedAt,
            color: w.color,
            icon: w.icon,
            partition,
        }));

    await db.notesP.where("partition").equals(partition).delete();
    await db.foldersP.where("partition").equals(partition).delete();
    await db.workspacesP.where("partition").equals(partition).delete();
    if (notesP.length > 0) await db.notesP.bulkAdd(notesP);
    if (foldersP.length > 0) await db.foldersP.bulkAdd(foldersP);
    if (workspacesP.length > 0) await db.workspacesP.bulkAdd(workspacesP);

    await loadPartitionIntoStores(db, partition);
}

/** Remove from IndexedDB the notes/folders that the server reported as deleted (pull deleted*Ids). Uses server response, not merged. Call after mergeIntoDbAndStores. */
async function removeLocalKeysForDeletedIds(
    db: NoticDB,
    partition: string,
    deletedNoteIds: string[],
    deletedFolderIds: string[]
): Promise<void> {
    if (deletedNoteIds.length === 0 && deletedFolderIds.length === 0) return;
    await Promise.all([
        ...deletedNoteIds.map((id) => db.notesP.delete([partition, id])),
        ...deletedFolderIds.map((id) => db.foldersP.delete([partition, id])),
    ]);
    if (deletedNoteIds.length > 0 || deletedFolderIds.length > 0) {
        await loadPartitionIntoStores(db, partition);
    }
}

export interface TriggerFullSyncOptions {
    /** When true, run full sync even if sync is paused (e.g. on sign-in so user gets their data). */
    ignorePaused?: boolean;
}

/**
 * Full sync: pull → merge → push → write to DB → remove server-deleted ids → set lastPullAt.
 * Atomic: if any step fails, state is set to 'failed', no partial merge is written, and error is rethrown.
 * Order matches extension: guard getSyncPaused → syncing → tokens → pull → local → merged → push (unless skipPush) → mergeIntoLocal(merged) → removeLocalKeysForDeletedIds(server) → setLastPullAt → synced.
 */
export async function triggerFullSync(
    db: NoticDB,
    options?: TriggerFullSyncOptions
): Promise<void> {
    // Prevent concurrent full syncs (return existing promise if one is in progress)
    if (fullSyncInProgress) {
        if (import.meta.env.DEV)
            console.log(
                "[triggerFullSync] Already in progress, waiting for it to complete"
            );
        return fullSyncInProgress;
    }

    if (!options?.ignorePaused && (await getSyncPaused(db))) return;

    const tokens = await getStoredTokens(db);
    if (!tokens) {
        await appendSyncChangeLog(db, [
            {
                at: Date.now(),
                kind: "error",
                message: "Full sync failed: not signed in",
            },
        ]);
        setSyncState("failed");
        return;
    }

    fullSyncInProgress = (async () => {
        setSyncState("syncing");
        const now = () => Date.now();

        try {
            const partition = await getStoragePartition(db);
            const lastPullAt = await getLastPullAt(db);
            const server = await withRetry(() =>
                pullFromServer(db, lastPullAt > 0 ? lastPullAt : undefined)
            );
            const local = buildLocalPayload();
            if (import.meta.env.DEV) {
                console.log("[triggerFullSync] server:", {
                    notes: server.notes.length,
                    notesWithDeletedAt: server.notes.filter((n) => n.deletedAt)
                        .length,
                    folders: server.folders.length,
                    workspaces: server.workspaces.length,
                    deletedNoteIds: server.deletedNoteIds?.length ?? 0,
                });
                console.log("[triggerFullSync] local:", {
                    notes: local.notes.length,
                    notesWithDeletedAt: local.notes.filter((n) => n.deletedAt)
                        .length,
                    folders: local.folders.length,
                    workspaces: local.workspaces.length,
                });
            }
            const merged = computeMergedState(local, server);
            if (import.meta.env.DEV) {
                console.log("[triggerFullSync] merged:", {
                    notes: merged.notes.length,
                    notesWithDeletedAt: merged.notes.filter((n) => n.deletedAt)
                        .length,
                    folders: merged.folders.length,
                    workspaces: merged.workspaces.length,
                });
            }
            const overwriteEntries = computeServerOverwriteLogEntries(
                local,
                server
            );

            const skipPush = options?.ignorePaused && (await getSyncPaused(db));
            if (!skipPush) {
                // Full sync: always send empty deleted*Ids (matches extension). Backend is in delta mode, deletes 0. We upsert merged (union of server + local).
                const pushBody: PushBody = {
                    ...merged,
                    deletedNoteIds: [],
                    deletedFolderIds: [],
                    deletedWorkspaceIds: [],
                };
                await withRetry(() => pushPayload(db, pushBody));
            }

            const successLog: SyncLogEntry[] = [
                {
                    at: now(),
                    kind: "fully_synced",
                    message: skipPush
                        ? "Pulled and merged (sync paused)"
                        : "Full sync succeeded",
                },
                ...overwriteEntries,
            ];
            await appendSyncChangeLog(db, successLog);

            await withRetry(() => mergeIntoDbAndStores(db, partition, merged));
            await removeLocalKeysForDeletedIds(
                db,
                partition,
                server.deletedNoteIds ?? [],
                server.deletedFolderIds ?? []
            );
            await setLastPullAt(db, partition, now());
            lastServerSnapshot = merged;
            setSyncState("synced");
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";
            await appendSyncChangeLog(db, [
                {
                    at: now(),
                    kind: "error",
                    message: `Full sync failed: ${message}`,
                },
            ]);
            setSyncState("failed");
            throw err;
        } finally {
            fullSyncInProgress = null;
        }
    })();

    return fullSyncInProgress;
}

/**
 * Push-only sync (delta when possible). Uses cached lastServerSnapshot to send only local-only + local-newer
 * notes and deleted*Ids; when no snapshot, sends full payload. Call after local changes (e.g. persist).
 * Matches extension triggerSync.
 */
let debouncedDeltaSync: ReturnType<typeof setTimeout> | null = null;
const DELTA_SYNC_DEBOUNCE_MS = 400;

/**
 * Trigger delta sync after user action (debounced to batch rapid changes).
 * Call this explicitly after user modifies notes/folders/workspaces.
 */
export function triggerSyncAfterUserAction(db: NoticDB): void {
    const partition = getStoragePartition(db);
    partition.then((p) => {
        if (p === LOCAL_PARTITION) return;
        if (debouncedDeltaSync) clearTimeout(debouncedDeltaSync);
        debouncedDeltaSync = setTimeout(() => {
            if (import.meta.env.DEV)
                console.log("[sync] User action sync triggered");
            void triggerSync(db);
            debouncedDeltaSync = null;
        }, DELTA_SYNC_DEBOUNCE_MS);
    });
}

export async function triggerSync(db: NoticDB): Promise<void> {
    if (import.meta.env.DEV) console.log("[triggerSync] Delta sync starting");
    if (await getSyncPaused(db)) return;

    const tokens = await getStoredTokens(db);
    if (!tokens) {
        setSyncState("failed");
        return;
    }

    setSyncState("syncing");
    const now = () => Date.now();

    try {
        const full = buildLocalPayload();
        const serverToUse = lastServerSnapshot;
        const rawPayload: PushBody =
            serverToUse != null
                ? buildDeltaPayload(full, serverToUse)
                : {
                      ...full,
                      deletedNoteIds: [],
                      deletedFolderIds: [],
                      deletedWorkspaceIds: [],
                  };

        await withRetry(() => pushPayload(db, rawPayload));
        lastServerSnapshot =
            serverToUse != null
                ? applyDeltaToSnapshot(serverToUse, rawPayload)
                : localPayloadToPullResponse(full);
        await appendSyncChangeLog(db, [
            { at: now(), kind: "fully_synced", message: "Sync succeeded" },
        ]);
        setSyncState("synced");
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await appendSyncChangeLog(db, [
            { at: now(), kind: "error", message: `Sync failed: ${message}` },
        ]);
        setSyncState("failed");
    }
}
