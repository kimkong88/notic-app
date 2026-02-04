# Sync logic: verification vs notic extension

Verified against `notic/src/sync.ts`. This doc records what matches, intentional app improvements, and remaining gaps.

---

## 1. Full sync flow (triggerFullSync)

| Step | Extension | App | Status |
|------|-----------|-----|--------|
| Guard | `!ignorePaused && getSyncPaused()` → return | Same | Match |
| setSyncState('syncing') | Yes | Yes | Match |
| Tokens | getStoredTokens(); if none → getGoogleTokenSilent + authenticateWithGoogleToken, retry | getStoredTokens(); if none → error log, set failed, return | **Gap** (see below) |
| lastPullAt | getLastPullAt() | getLastPullAt(db) | Match |
| Pull | pullFromServer(lastPullAt > 0 ? lastPullAt : undefined) | Same | Match |
| Local payload | getLocalPayload() (async, from storage) | buildLocalPayload() (sync, from Zustand) | Match (shape equivalent) |
| Merge | computeMergedState(local, server) — union merge only | computeMergedState(local, server, **initialSync**) | **App improvement** |
| Push | pushPayload(merged) with **empty** deleted*Ids | pushPayload({ ...merged, ...deleted }) with **computed** deleted*Ids when !initialSync | **App improvement** |
| skipPush | options?.ignorePaused && getSyncPaused() | Same | Match |
| Success log | appendSyncChangeLog + overwrite entries | Same | Match |
| Write to storage | mergeIntoLocal(merged) | mergeIntoDbAndStores(db, partition, merged) | Match (concept) |
| Remove server-deleted | removeLocalKeysForDeletedIds(partition, server.deletedNoteIds, server.deletedFolderIds) | Same (no deletedWorkspaceIds) | Match |
| setLastPullAt | setLastPullAt(now()) | setLastPullAt(db, partition, now()) | Match |
| lastServerSnapshot | merged | merged | Match |
| setSyncState('synced') | Yes | Yes | Match |

---

## 2. Merge (computeMergedState)

- **Extension:** Single strategy. Union of server + local; for notes “newer wins”, tie → local; folders local overwrites server; workspaces “newer wins” + append local-only. **Effect:** server-only items (e.g. after local delete) stay in merged → deleted workspace/notes can reappear. Full sync push sends empty deleted*Ids → server never gets deletes.
- **App:** Two modes via `initialSync` (lastPullAt <= 0).
  - **initialSync = true:** Server as base, local overwrites when newer (same as extension union). Ensures fresh login / empty IndexedDB gets full server data.
  - **initialSync = false:** Only entities present in local; server overwrites when newer. Local deletes are not resurrected. Push sends computeDeletedIds(server, local) so server is updated with deletes.

So the app fixes two extension bugs: (1) full sync not sending deletes, (2) merge resurrecting server-only items after local delete. Fresh pull is preserved via initialSync.

---

## 3. Delta push (triggerSync)

| Step | Extension | App | Status |
|------|-----------|-----|--------|
| getSyncPaused | return if paused | Same | Match |
| Tokens | getStoredTokens(); if none → try Google refresh; else error | getStoredTokens(); if none → set failed | **Gap** (same as full sync) |
| Payload | serverToUse ? buildDeltaPayload(full, serverToUse) : full (no deleted*Ids) | Same; when no snapshot use full + deleted*Ids: [] | Match |
| buildDeltaPayload | filterPayloadToLocalNewer + computeDeletedIds | Same | Match |
| pushPayload | Chunked POST, same body shape | Same | Match |
| lastServerSnapshot | applyDeltaToSnapshot(serverToUse, payload) or localPayloadToPullResponse(full) | Same | Match |

---

## 4. Pull (pullFromServer)

- Pagination (cursor), since param, accumulation of notes; folders/workspaces from last page; deleted*Ids from first page only. **App matches.**
- Pull response shape (notes, folders, workspaces, deletedNoteIds, deletedFolderIds, deletedWorkspaceIds). **App matches.**

---

## 5. removeLocalKeysForDeletedIds

- **Extension:** Only note and folder ids; does not remove workspace keys (workspaces are one JSON key).
- **App:** Only note and folder ids; workspaces are full-replaced in mergeIntoDbAndStores, so no separate workspace delete step. **Aligned.**

---

## 6. Periodic “server newer” check

- checkServerNewer: GET /sync/status, compare lastUpdatedAt to lastPullAt + SERVER_NEWER_GRACE_MS, notify listeners. **App has it.**
- startPeriodicPullCheck / stopPeriodicPullCheck, PERIODIC_PULL_INTERVAL_MS (5 min), SERVER_NEWER_GRACE_MS (60 s). **App matches.** (Extension passes no db; app passes db for fetch.)

---

## 7. Other details

- **shareCode:** App includes shareCode in buildLocalPayload, mergeIntoDbAndStores, and PullResponse. Extension’s localPayloadToPullResponse and applyDeltaToSnapshot toPullNote do not include shareCode (extension gap; app correct).
- **Chunking:** NOTE_PUSH_CHUNK_SIZE 500, same in both.
- **Retry:** SYNC_RETRY_ATTEMPTS 3, exponential backoff, same in both.
- **applyDeltaToSnapshot:** App applies payload.notes/folders/workspaces and deleted*Ids; extension uses toPullNote/toPullFolder (no shareCode). App behavior is correct and more complete.

---

## 8. Identified gaps (app vs extension)

### 8.1 Token refresh when tokens are missing (full sync and triggerSync)

- **Extension:** If getStoredTokens() is empty, calls getGoogleTokenSilent() then authenticateWithGoogleToken(google.token), then getStoredTokens() again. If still empty, then error and fail.
- **App:** If getStoredTokens(db) is empty, immediately appends error and sets sync state to failed; no attempt to refresh via Google or backend.

**Impact:** If the app relies on a different auth flow (e.g. only backend refresh token or session), this may be intentional. If the app should support the same “silent Google token → backend auth” recovery as the extension, then triggerFullSync and triggerSync should add the same retry (getGoogleTokenSilent + authenticateWithGoogleToken + getStoredTokens) before failing.

**Recommendation:** Confirm how the app obtains/refreshes tokens (e.g. auth callback, backend refresh). If the app never has getGoogleTokenSilent/equivalent, this gap is by design. If it does, add the same token-refresh attempt before setting sync to failed.

---

## 9. Summary

- **Aligned:** Full sync order (pull → merge → push → write → remove server-deleted → setLastPullAt), pull pagination and since, delta push (buildDeltaPayload, chunking, applyDeltaToSnapshot), removeLocalKeysForDeletedIds (notes + folders only), periodic server-newer check, constants, retry.
- **App improvements (intentional):** initialSync merge + full sync sending deleted*Ids when !initialSync; shareCode preserved in payload and snapshot.
- **Gap:** No token refresh attempt when tokens are missing (extension tries Google silent + authenticate before failing). Resolve per auth design above.
