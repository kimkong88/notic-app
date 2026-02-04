# Test coverage and missing critical tests

Summary of existing tests and critical gaps across **notic** (extension) and **notic-app** (SPA).

---

## notic (extension)

### What’s covered

| File | Area | What’s tested |
|------|------|----------------|
| `sync.test.ts` | Sync flow | `pullFromServer` (paginated, folders/workspaces first page), `mergeIntoLocal`, `triggerFullSync`, cache cleanup, `computeMergedState`, `buildDeltaPayload`, deleted ids, delta logic |
| `dashboard-state.test.ts` | Selection | `clearSelection`, `selectOnly`, `toggleSelection`, `setSelectionToRange`, `hasMultiSelection`, `getSelectedNoteIds` / `getSelectedFolderIds` |
| `dashboard-toolbar.test.ts` | Toolbar + PiP | `handleNewNoteFromToolbar`: PiP open vs closed, `launchPiP` / `waitForPipReady`, focus note |

### Critical gaps (no tests)

- **auth.ts** – Token refresh, sign-in/sign-out, silent auth. High impact on sync and security.
- **api-client.ts** – `fetchWithAuth`, retries, error handling. Sync and all server calls depend on it.
- **storage-keys.ts** – Key building (partitioned keys, meta/content keys). Wrong keys = data loss or cross-partition leaks.
- **dashboard-utils.ts** – `escapeHtml`, `highlightMatch`, `getContentPreview`, `formatDateKey` (used in search and UI). No tests; regressions affect display and XSS risk for `escapeHtml`/`highlightMatch`.
- **workspace.ts** – Workspace CRUD, default workspace, `renameWorkspace`, `addWorkspace`, `deleteWorkspace`. Core to multi-workspace behavior.
- **dashboard-notes.ts** – `createNewNote`, note CRUD, `startRenamingNote`, inline rename, persistence. Core note behavior.
- **dashboard-folders.ts** – Folder CRUD, move, delete. Core hierarchy behavior.

---

## notic-app (SPA)

### What’s covered

| File | Area | What’s tested |
|------|------|----------------|
| `useNotesStore.test.ts` | Notes store | `toggleFolderExpanded`, `setSelection` / `clearSelection`, `setNotes` / `setFolders`, `duplicateNote`, `setExpandedSidebarFolderIds` |
| `useUIStore.test.ts` | UI store | Sidebar width clamping, `setSidebarCollapsed`, `setIsDarkMode`, `setCurrentView`, `setIsTrashView`, PiP ids, `addNoteToPip` / `removeNoteFromPip` |
| `persist.test.ts` | Persist | UI prefs and notes written after store change + debounce, `currentWorkspaceId` to prefs |
| `hydrate.test.ts` | Hydrate | Notes/folders/workspaces/prefs into stores, defaults when DB empty |
| `documentPip.test.ts` | PiP | `isDocumentPipSupported` (missing API, no requestWindow, Chrome vs Cursor UA) |
| **`useNotesStore.test.ts`** | **Search** | **`setSearchQuery`**: entering search saves previousFolderDate/previousNoteId and clears selection; exiting restores; refining search only updates query |
| **`noteUtils.test.ts`** | **Search/display** | **`highlightMatch`** (case-insensitive, regex escape, all occurrences), **`getContentPreview`** (strip markdown, cap length), **`extractTitle`** (heading, first line, 50-char cap) |
| **`useWorkspaceStore.test.ts`** | **Workspace** | **`renameWorkspace`** (trim, max length, empty fallback), **`addWorkspace`**, **`deleteWorkspace`** (no delete default), **`updateWorkspaceMeta`**, **`getWorkspacesInDisplayOrder`** |

### Critical gaps (no tests)

- **useNotesStore – missing actions** – `updateNote`, `addNote`, `addFolder`, `restoreNote`, `removeNote`, `deleteNotesAndFoldersByWorkspace`, `updateFolder`, `removeFolder` are untested. `setSearchQuery` is tested. Data integrity and folder/note mutations depend on these.
- **utils/noteUtils.ts** – `escapeHtml` is untested (XSS/safety); `highlightMatch`, `getContentPreview`, `extractTitle` are tested. `applySearchHighlightInElement` / `clearSearchHighlightInElement` (DOM) untested.
- **utils/dateKeys.ts** – `formatDateKey`, `parseDateKey`, `formatDate`. No tests; wrong keys break date-based grouping and display.
- **utils/exportZip.ts** – `sanitizeName`, `exportWorkspaceAsZip`, path/disambiguation. No tests; export is critical for round-trip.
- **utils/importZip.ts** – `parsePath`, `importFromZip` (with mock deps). No tests; import and folder recreation are critical.
- **utils/folderUtils.ts** – `getFolderDepth`, `isDescendantOf`, `canAcceptFolderDrop`, `getFolderAncestorIds`, `getFolderNoteCountRecursive`. No tests; used for sidebar and drag-drop.
- **db/schema.ts** – Schema and key shapes. No tests; migrations or key changes can break persist/hydrate.
- **Storage / key consistency** – Persist and hydrate are tested with mocks; no test that written keys match what hydrate expects (round-trip or key-contract tests).
- **api/upload.ts** – Optional; `getApiUrl`, `getAccessToken`, `uploadImage` (validation, 401 handling). Prefer mocks or E2E.

---

## Suggested priority (critical tests to add)

1. **notic-app: useWorkspaceStore** – `renameWorkspace` (trim, max length, empty fallback), `addWorkspace`, `deleteWorkspace` (no delete default), `getWorkspacesInDisplayOrder`.
2. **notic-app: useNotesStore** – `updateNote` (patch behavior), `setSearchQuery`, delete/restore (trash) if present.
3. **Both: escapeHtml + highlightMatch** – One small test file per project: escape quotes/angles, highlight case-insensitive and regex-special chars, no XSS when injected into HTML.
4. **notic-app: noteUtils** – `getContentPreview` (length, stripping), `extractTitle` (first line, heading).
5. **notic: storage-keys** – Key builders (partitioned meta/content, workspace, folder) and consistency with sync/storage usage.
6. **notic: auth / api-client** – At least: token in header, retry on 401, or similar; can be minimal with mocks.

---

## Test runners

- **notic**: Vitest (from sync/dashboard-state/dashboard-toolbar tests).
- **notic-app**: Vitest (from store/db/pip tests).

Run from each project root (e.g. `npm test` or `npx vitest run`).
