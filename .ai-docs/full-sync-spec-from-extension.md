# Full sync spec – exact match to extension

Reimplement full sync in the app by following the extension’s `triggerFullSync` and its helpers **exactly**. Do not reinvent; every step must be cross-checked against the extension.

**Extension source:** `notic/src/sync.ts`, `notic/src/dashboard.ts` (and `storage-keys.ts`, `api-client.ts` where noted).

---

## 0. When full sync runs (extension)

- **On sign-in:** `authCallbacks.onSignedIn` → `enableSyncAndTrigger()` → `triggerFullSync({ ignorePaused: true })`. App: Sidebar after sign-in.
- **On load / reload (window open):** When dashboard init runs, if `!getAuthSignedOut()` and `storedUserId` exists (or profile + backend tokens), extension calls `enableSyncAndTrigger()` → `triggerFullSync({ ignorePaused: true })`. So full sync runs on every popup open / refresh when user is already signed in. App: `main.tsx` init after `hydrateStores` – if `getStoragePartition(db) !== LOCAL_PARTITION`, run `triggerFullSync(db, { ignorePaused: true })`.

---

## 1. Entry: `triggerFullSync(options?)`

**Ref:** `sync.ts` 917–982

1. **Guard (917–918)**  
   If `!options?.ignorePaused && (await getSyncPaused())` then **return** (no-op).  
   App: implement `getSyncPaused()` (e.g. read a pref; if no pref, treat as false). Extension uses `SYNC_PAUSED_KEY` in chrome.storage.

2. **Set state (920)**  
   `setSyncState('syncing')`.

3. **Tokens (922–935)**  
   - `tokens = await getStoredTokens()`.  
   - If no tokens: try `getGoogleTokenSilent()` → `authenticateWithGoogleToken(google.token)` → `getStoredTokens()` again.  
   - If still no tokens: `appendSyncChangeLog([{ kind: 'error', message: 'Full sync failed: not signed in' }])`, `setSyncState('failed')`, **return**.

4. **Try block starts (937).**  
   All following steps are inside this try; on catch → append error to sync log, `setSyncState('failed')`.

---

## 2. Pull from server

**Ref:** `sync.ts` 939–942, 753–783

5. **lastPullAt (939)**  
   `lastPullAt = await getLastPullAt()`.  
   Extension: partition from `getStoragePartition()`, then read `lastPullAtKey(partition)` from chrome.storage; value is number (epoch ms) or 0.

6. **pullFromServer (941–942)**  
   `server = await withRetry(() => pullFromServer(lastPullAt > 0 ? lastPullAt : undefined))`.

   **pullFromServer(since?)** (753–783):
   - Build URL: if `cursor` then `?cursor=...`; else if `since != null && since > 0` then `?since=<since>`; else no query.
   - GET `/sync` or `/sync?cursor=...` or `/sync?since=...`.
   - Loop: for each page, `notes.push(...page.notes)`; `if (page.folders.length > 0) folders = page.folders`; `if (page.workspaces.length > 0) workspaces = page.workspaces`; **only when `!cursor`**: if `page.deletedNoteIds?.length` set `deletedNoteIds`, same for `deletedFolderIds`, `deletedWorkspaceIds`; `cursor = page.nextCursor`. Repeat while cursor.
   - Return `{ notes, folders, workspaces, deletedNoteIds?, deletedFolderIds?, deletedWorkspaceIds? }`.

---

## 3. Local payload

**Ref:** `sync.ts` 944, 317–330, 193–296

7. **getLocalPayload() (944)**  
   `local = await getLocalPayload()`.

   **getLocalPayload()** (317–330):
   - `partition = await getStoragePartition()`.
   - Read **all** storage for current partition: extension does `chrome.storage.local.get(null)` then filters keys with `partitionPrefix(partition)`.
   - Call **buildPayload(filtered, partition)** → returns `SyncPayload` (notes, folders, workspaces).

   **buildPayload** (193–296): from partition key-value map, build:
   - **Notes:** for each key starting with partition + `session_`, extract sessionId, content, meta (lastModified, createdAt, displayName, deletedAt, workspaceId, color, isBookmarked), noteFolderKey → one note per session with id, content, lastModified, createdAt, displayName, folderId, workspaceId, deletedAt?, color?, isBookmarked?.
   - **Folders:** for each key starting with partition + `folder_meta_`, parse JSON → id, name, parentId, createdAt, displayName, workspaceId, color.
   - **Workspaces:** from `workspacesKey(partition)` (array), plus `workspacePrefsKey(partition)` for color/icon per workspace → list with id, name, isDefault, lastModified?, color?, icon?.
   - Return `{ notes, folders, workspaces }` (workspaces only if length > 0).

   App: “storage for current partition” = data for that partition in IndexedDB (notesP, foldersP, workspacesP) **or** Zustand stores for that partition. Must produce the **same shape** as extension’s SyncPayload (notes with id, content, lastModified, …; folders; workspaces with lastModified).

---

## 4. Merge (in memory)

**Ref:** `sync.ts` 945, 343–405

8. **computeMergedState(local, server) (945)**  
   `merged = computeMergedState(local, server)`.  
   Input: `SyncPayload` (local), `PullResponse` (server). Output: `PullResponse` (merged).

   **Workspaces (347–384):**
   - If server.workspaces.length === 0, use `[{ id: DEFAULT_WORKSPACE_ID, name: 'Workspace 1', isDefault: true, updatedAt: Date.now() }]`.
   - For each server workspace: if local has same id, then **workspaceNewer(localW, sw)**: `localTs = localW.lastModified ?? 0`, newer iff `localTs > serverW.updatedAt`. If local newer → use local (id, name, isDefault, updatedAt: lastModified, color, icon). If server newer → use server but **preserve local color/icon if server doesn’t have them**: `...(localW.color != null && (sw.color == null || sw.color === '') && { color: localW.color })`, same for icon. Then append **local-only** workspaces (ids not in merged list). Sort: default first, then by updatedAt desc.

   **Folders (386–389):**  
   `folderById = new Map(server.folders)`, then `for (f of local.folders) folderById.set(f.id, f)`. So **local overwrites server** for same id. Result: `Array.from(folderById.values())`.

   **Notes (391–402):**  
   `allNoteIds = server note ids ∪ local note ids`. For each id: if only server → server; if only local → local; if both → **local.lastModified >= server.lastModified ? local : server** (tie → **local**).

---

## 5. Overwrite log (for UI only)

**Ref:** `sync.ts` 946

9. **computeServerOverwriteLogEntries(local, server) (946)**  
   `overwriteEntries = computeServerOverwriteLogEntries(local, server)`.  
   Used only for sync log (which items were overwritten by server). Optional for app but must not change data flow.

---

## 6. Push (unless skipped)

**Ref:** `sync.ts` 948–958, 408–446

10. **skipPush (948)**  
    `skipPush = options?.ignorePaused && (await getSyncPaused())`.

11. **If !skipPush (950–958):**  
    `pushOk = await withRetry(() => pushPayload(merged))`. If !pushOk → append error log, setSyncState('failed'), return.

    **pushPayload(merged)** (408–446):
    - workspaceList = merged.workspaces.length > 0 ? merged.workspaces : default one workspace.
    - workspacesForApi = workspaceList mapped to { id, name, isDefault, color?, icon? } (omit color/icon if null or '').
    - baseBody = { folders: merged.folders, workspaces: workspacesForApi, **deletedNoteIds: []**, **deletedFolderIds: []**, **deletedWorkspaceIds: []** }.
    - If merged.notes.length <= **500** (NOTE_PUSH_CHUNK_SIZE): POST `/sync` with body `{ ...baseBody, notes: merged.notes }`.
    - Else: for each chunk of 500 notes, POST `/sync` with `{ ...baseBody, notes: chunk }` (same baseBody every time). Extension does **multiple POSTs** for large note sets; each POST has full folders + workspaces + one note chunk, **empty** deleted*Ids.

---

## 7. Success log and write to local

**Ref:** `sync.ts` 960–965, 790–883

12. **Append success log (960–964)**  
    successLog = [{ kind: 'fully_synced', message: ... }, ...overwriteEntries]. `appendSyncChangeLog(successLog)`.

13. **mergeIntoLocal(merged) (965)**  
    `await withRetry(() => mergeIntoLocal(merged))`.  
    **Argument is merged**, not server.

    **mergeIntoLocal(server: PullResponse)** (790–883) – parameter name is “server” but caller passes **merged**:
    - partition = getStoragePartition().
    - Read **current** currentWorkspaceId from storage (extension: `currentWorkspaceIdKey(partition)`).
    - workspaceList = merged.workspaces.length > 0 ? merged.workspaces : default one. defaultId = first default or first workspace. **currentWorkspaceId** = storedCurrentId if it’s in workspaceIds else defaultId.
    - **Set** in storage:
      - workspacesKey(partition) = JSON.stringify(workspaceList.map(w => ({ id, name, isDefault, lastModified: w.updatedAt }))).
      - currentWorkspaceIdKey(partition) = currentWorkspaceId.
      - workspacePrefsKey(partition): **read existing** prefs, then for each workspace in workspaceList merge (w.color, w.icon) into prefs for that w.id; write back only if non-empty.
      - For each merged.folders: set folderMetaKeyPartitioned(partition, f.id) = JSON.stringify({ id, name, parentId, createdAt, displayName, workspaceId, color? }).
      - For each merged.notes: set sessionKeyPartitioned(partition, n.id) = n.content; metaKeyPartitioned = JSON.stringify({ lastModified, createdAt, displayName, folderId, workspaceId, deletedAt?, color?, isBookmarked?, shareCode? }); noteFolderKeyPartitioned = n.folderId ?? ''.
    - **No** bulk delete of partition; only **set** these keys. Keys not written (e.g. old notes no longer in merged) are left in storage until step 14.

    App: equivalent = write **merged** to IndexedDB partition (notesP, foldersP, workspacesP) and prefs (currentWorkspaceId, workspace prefs). Same semantics: “set” merged state; do not clear partition first in this step.

---

## 8. Remove server-deleted ids

**Ref:** `sync.ts` 966–971, 883–905

14. **partition (966)**  
    `partition = await getStoragePartition()`.

15. **removeLocalKeysForDeletedIds (967–971)**  
    `await removeLocalKeysForDeletedIds(partition, server.deletedNoteIds ?? [], server.deletedFolderIds ?? [])`.  
    **Use `server`** (pull response), not merged.

    **removeLocalKeysForDeletedIds(partition, deletedNoteIds, deletedFolderIds)** (883–905):
    - Extension does **not** pass deletedWorkspaceIds; only notes and folders.
    - For each id in deletedNoteIds: **remove** sessionKeyPartitioned(partition, id), metaKeyPartitioned(partition, id), noteFolderKeyPartitioned(partition, id).
    - For each id in deletedFolderIds: **remove** folderMetaKeyPartitioned(partition, id).
    - Single remove(keysToRemove) call.

    App: delete from IndexedDB the rows in notesP/foldersP for those partition+id pairs (or delete by compound key). **Must** do this after writing merged; otherwise local will still show notes/folders that were deleted on server.

---

## 9. Post-success updates

**Ref:** `sync.ts` 972–974

16. **setLastPullAt(now()) (972)**  
    Write lastPullAtKey(partition) = current time (epoch ms).

17. **lastServerSnapshot = merged (973)**  
    Cache for future delta push (triggerSync). App: store merged as lastServerSnapshot if you implement delta sync later.

18. **setSyncState('synced') (974)**  
    Then try block ends; catch already described.

---

## 10. Constants / helpers to align

- **NOTE_PUSH_CHUNK_SIZE = 500** (sync.ts 93).
- **withRetry:** extension uses SYNC_RETRY_ATTEMPTS (3), SYNC_RETRY_DELAY_MS (1000), exponential backoff (delay * 2^attempt). Apply to pullFromServer and pushPayload and mergeIntoLocal.
- **DEFAULT_WORKSPACE_ID:** extension uses from workspace.ts; app has same semantic (e.g. 'workspace_1').
- **PullResponse** and **SyncPayload** shapes must match extension (notes with id, content, lastModified, createdAt, displayName, folderId, workspaceId, deletedAt?, color?, isBookmarked?, shareCode?; folders with id, name, parentId, createdAt, displayName, workspaceId, color?; workspaces with id, name, isDefault, updatedAt, color?, icon?).

---

## 11. App-specific mapping (no logic change)

- **Storage:** Extension = chrome.storage.local (key-value). App = IndexedDB (notesP, foldersP, workspacesP) + prefs. “getLocalPayload” must read from app’s current partition store/DB and return same SyncPayload shape. “mergeIntoLocal” must write merged to app’s partition tables + prefs; then “removeLocalKeysForDeletedIds” must delete by (partition, id) for notes and folders.
- **getStoragePartition:** App already has getStoragePartition(db) returning partition string (userId or LOCAL_PARTITION). Same semantics.
- **getLastPullAt / setLastPullAt:** App uses lastPullAtKey(partition) in prefs; same idea. Extension key format is notic_${partition}_lastPullAt; app can use own pref key as long as it’s per-partition.

---

## Checklist before coding

- [x] triggerFullSync: same order (guard → syncing → tokens → try: lastPullAt → pull → local → merged → push (if !skipPush) → mergeIntoLocal(merged) → removeLocalKeysForDeletedIds(server) → setLastPullAt → synced). App omits overwriteLog/successLog and lastServerSnapshot (optional).
- [x] pullFromServer: same URL/query, same accumulation of notes/folders/workspaces, same capture of deleted*Ids only when !cursor.
- [x] getLocalPayload (app: buildLocalPayload): same SyncPayload shape from current partition data (stores).
- [x] computeMergedState: workspace newer-wins + preserve local color/icon when server wins; local-only workspaces appended; folder local overwrites; note newer-wins, tie → local.
- [x] pushPayload: empty deleted*Ids, chunk size 500, same body shape.
- [x] mergeIntoLocal (app: mergeIntoDbAndStores): receives merged; writes every folder, note, workspaces; then reloads stores. App clears partition then bulkAdds (equivalent semantics).
- [x] removeLocalKeysForDeletedIds: uses **server**.deletedNoteIds and server.deletedFolderIds; removes those ids from partition storage (notesP/foldersP); no deletedWorkspaceIds; then reloads stores if any removed.

## App: atomic sync

If any step in the try block fails (pull, push, mergeIntoDbAndStores, removeLocalKeysForDeletedIds, setLastPullAt), the catch sets `setSyncState('failed')` and rethrows. No partial merge is written: we only call mergeIntoDbAndStores after push succeeds, and we only call setLastPullAt after removeLocalKeysForDeletedIds. So on failure the UI shows error and previous local state is unchanged.
