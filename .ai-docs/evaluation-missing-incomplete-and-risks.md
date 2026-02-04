# Notic app: missing features, incomplete features, and bug/vulnerability risks

Evaluation of the cloud app vs the extension: what’s missing, what’s incomplete, and what’s vulnerable to bugs. See repo root `.ai-docs` for related docs.

---

## 1. Missing features (extension has them, app does not)

### 1.1 Share (publish note to web) — DONE

- **App**: Share modal in MainContent (Publish / Copy link / Unpublish), `publishNote` / `unpublishNote` in `api/backend.ts`, `shareModalNoteId` in useUIStore; Share button opens modal and updates `note.shareCode` after API success.

### 1.2 Move to folder — DONE

- **App**: MoveToFolderModal in Sidebar: flat folder list (Root + search), move one or multiple notes/folders via `updateNote`/`updateFolder`; context menu “Move to folder…” opens modal.

### 1.3 Move to workspace — DONE

- **App**: MoveToWorkspaceModal in Sidebar: workspace select + folder list for target workspace; move notes via `updateNote(..., { workspaceId, folderId })`; context menu “Move to workspace…” opens modal.

### 1.4 Integrations (Notion / Obsidian) beyond UI

- **Extension**: Integrations page + API usage (e.g. Notion status, sync); `api-client` has Notion/Obsidian-related endpoints.
- **App**: Settings has “Integrations” sub-view and “Open Integrations” link; copy says “Sync to Notion or export your notes to Obsidian.” No actual Notion/Obsidian API calls or deep links from the app – only the static Integrations page.
- **Gap**: If the extension uses backend endpoints for Notion/Obsidian, the app does not call them; UX is informational only unless backend is used elsewhere (e.g. redirect to external integration flow).

---

## 2. Incomplete or placeholder behavior

### 2.3 Subscription refresh on load when auth is restored from storage

- **Current**: Hydrate restores `authUser` from `authLastUser` when partition is signed-in; Sidebar has `useEffect(() => { if (authUser) void useSubscriptionStore.getState().refresh(db) }, [authUser])`. So after first paint, subscription is refreshed.
- **Possible gap**: If React batches and `authUser` is set in the same tick as initial render, the effect runs once. If there is a timing where partition is set but authUser is not yet restored, subscription might stay `null` until user interaction. Low risk but worth a quick test: sign in, refresh, confirm Pro/Free badge updates after load.

### 2.4 Free user note limit (10 notes)

- **Current**: MainContent checks `!subscribed && totalNoteCount > FREE_NOTE_LIMIT` when user tries to “Resume sync” and shows “Sync limit reached” modal. Sync and normal use otherwise respect the limit on the backend.
- **Possible gap**: Limit is not enforced in the UI when creating a new note (e.g. “Add note” when already at 10 as free user). Extension may prevent or warn; app may allow create and then sync fails or backend rejects. Worth confirming backend behavior and whether to block/warn in UI before create.

---

## 3. Bug-prone and vulnerability areas

### 3.1 No app-level Error Boundary

- **Current**: Only Lexical editor uses `LexicalErrorBoundary`. There is no React Error Boundary around the main app or Layout.
- **Risk**: Any uncaught render error in Sidebar, MainContent, or Settings unmounts the whole tree and user sees a blank screen or the framework error overlay. One bad state (e.g. malformed note in store) can take down the whole UI.
- **Recommendation**: Add an Error Boundary around the main content (e.g. Layout or root App content) with a simple “Something went wrong” + reload, and optionally log to console or reporting.

### 3.2 Token expiry during long sync or background tabs

- **Current**: `refreshTokens` is used in `main.tsx` before sync-on-load and in `fetchWithAuth` on 401 (retry once after refresh). Sync itself does not proactively refresh before a long push/pull.
- **Risk**: If access token expires mid-sync (e.g. long push), requests can fail with 401; retry-after-refresh helps but only for the next request. If refresh token is expired, user is effectively signed out and may not see a clear “session expired, please sign in again” message in the sync path.
- **Recommendation**: Ensure sync failure (e.g. 401 after refresh) sets a clear “Sync failed” state and, if appropriate, prompts re-auth. Already partially there; confirm UX and that 401 is not swallowed.

### 3.3 Offline / partition switch

- **Current**: Sign-out clears tokens and loads local partition; sign-in loads user partition. Offline message when clicking “Connect for sync” is shown; no offline restore of auth (by design).
- **Risk**: If the user goes offline while signed in and the app does not handle “no network” in sync/API calls, errors may be generic. Sync status shows “Sync failed” and sync log helps; confirm that all API paths (billing, publish when added, upload) handle offline in a consistent way.

### 3.4 Subscription state vs backend truth

- **Current**: Subscription is persisted in prefs (`subscriptionIsPro`) and refreshed when signed in (Sidebar effect) and on load (hydrate). If refresh fails (e.g. network), UI keeps previous value.
- **Risk**: Stale “Pro” after downgrade or stale “Free” after upgrade until next successful refresh. Minor; refresh on sign-in and on load is usually enough. Consider invalidating or re-fetching after long idle or tab focus if needed.

### 3.5 Sync conflict and overwrite

- **Current**: Sync follows extension logic: pull → merge (last-write-wins by `lastModified`) → push → apply to store and DB. Overwrite events are appended to sync change log.
- **Risk**: Conflicting edits on two devices can result in one version being overwritten without a “conflict” UX. This matches the extension; acceptable if product is last-write-wins, but users may expect conflict resolution. Document behavior and consider future “conflict” UX if required.

### 3.6 Image upload 401

- **Current**: `upload.ts` throws on 401 with “Sign in to upload images.” Caller (e.g. editor paste) may or may not show this to the user.
- **Risk**: If the message is not surfaced, user may not understand why paste failed. Confirm that paste/drop handlers show a toast or inline message on upload failure.

### 3.7 Large payloads and persist debounce

- **Current**: Notes/folders and prefs (including `currentWorkspaceId`) are persisted with debounce (150–300 ms). Workspace switch also does an immediate persist of `currentWorkspaceId`.
- **Risk**: If the user closes the tab or navigates away within the debounce window, last change might not be persisted. Unlikely to lose much; for critical prefs (e.g. workspace) immediate persist on change is already in place. Notes are batched; acceptable for normal use.

### 3.8 Hydrate / init order

- **Current**: `init()` in main: hydrate → startPersist → then (if partition !== LOCAL) setTimeout(refreshTokens + triggerFullSync). Hydrate restores auth user when partition is signed-in.
- **Risk**: If `getStoragePartition` or hydrate fails (e.g. DB open fails), the app may not bootstrap correctly. Consider try/catch and a minimal “failed to load” UI. Same for sync-on-load: failure is caught and only logs; user sees “Sync failed” in UI, which is acceptable.

---

## 4. Summary table

| Area                     | Status        | Notes                                                                 |
|--------------------------|---------------|-----------------------------------------------------------------------|
| Share (publish/unpublish)| Done          | Modal + api/backend publishNote/unpublishNote; wired in MainContent and Sidebar. |
| Move to folder           | Done          | MoveToFolderModal + updateNote/updateFolder.                          |
| Move to workspace        | Done          | MoveToWorkspaceModal + updateNote(workspaceId, folderId).              |
| Integrations (Notion/Obsidian) | Partial | UI only; no API or deep links in app.                                 |
| Subscription state       | Complete      | Persisted and refreshed on load/sign-in.                             |
| Auth state on refresh    | Fixed         | Restored from `authLastUser` when partition is signed-in.             |
| Workspace filter sidebar | Fixed         | Recent and Folders tabs use workspace-filtered lists.                 |
| Sync (full flow)         | Complete      | Pull (with `since` for incremental), merge, push, pause/resume, sync log, limit modal. |
| Error Boundary           | Done          | AppErrorBoundary + toast on API 5xx.                                 |
| Token refresh / 401      | Handled       | fetchWithAuth retries once after refresh; confirm UX on full failure.  |
| Free note limit          | Complete      | Enforced on “Resume sync”; confirm create-note and backend alignment. |

---

## 5. Recommended next steps (priority)

1. **Error Boundary**: Done – AppErrorBoundary wraps Layout; fetchWithAuth shows toast on 5xx.
2. **Free limit**: App now switches to Local (setSyncPaused) when free user has >10 notes (match extension updateQuotaWarning). Confirm backend behavior when free user creates 11th note if needed.
3. **Import result modal**: Done – SettingsView shows modal (Import / Import complete / Import failed) with OK, matching extension.
4. **Integrations**: If product requires in-app Notion/Obsidian flows, add API calls or deep links; otherwise leave as informational.

This doc can be updated as features are implemented or new risks are found.
