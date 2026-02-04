# Notic App – Feature Audit: Complete vs Incomplete

Audit of which features are complete and which are incomplete or partial (as of this doc). Use for planning and parity with the extension.

---

## 1. Complete features

### 1.1 Core app shell
- **Layout**: Resizable sidebar (drag edge, double-click collapse, persist width 200–480px), theme toggle (dark/light), persisted prefs.
- **Sidebar**: Workspace dropdown (switch, add workspace, rename, delete with confirm; delete also removes notes/folders in that workspace). Recent / Folders tabs. Toolbar: New Note, New Folder, Sort, Expand All, Trash. Open Notes (PiP) entry. Footer: Connect for sync, Settings, theme. Quota warning when free and notes > 10.
- **MainContent**: Breadcrumbs (workspace, Recent/Folders/Trash/Bookmarks, date/folder/note), sync status, search, notes list and detail (read-only + edit mode), empty states.

### 1.2 Notes
- **CRUD**: Create (toolbar, folder context, empty area, onboarding CTA), read (list + detail), update (content, displayName, color, folderId, workspaceId), delete (move to trash from context menus; permanent delete from Trash).
- **Selection**: Single and multi-select (shift/ctrl), Move to folder, Move to workspace, bulk Move to Trash.
- **Rename**: Inline rename in sidebar (Recent and Folders). Pending rename state after “New Note”.
- **Bookmarks**: Toggle from context menu; Bookmarks virtual group in Recent.
- **Duplicate**: Context menu “Copy” (duplicate note).

### 1.3 Folders
- **CRUD**: Create (toolbar at root, folder context “New Folder”, empty-area “New Folder”), rename (folder context → inline), delete (folder context → confirm; notes moved to trash).
- **Tree**: Sidebar Folders tab – Bookmarks, Root, recursive folders and notes; expand/collapse; workspace-filtered; note count per folder.
- **Main content**: Folder view – mixed list (folders first, then notes); click folder to navigate, click note to select; Root vs nested; empty state.

### 1.4 Drag and drop
- Move notes and folders in sidebar and in main content; drop on folder or root; `canAcceptFolderDrop` prevents invalid moves (e.g. into self or descendant).

### 1.5 Trash
- **View**: Trash in breadcrumbs; list of deleted notes with `deletedAt`; Restore, Delete permanently (single), Empty trash (with confirm).
- **Behavior**: Move to Trash from note context menus (Recent + Folders); sync and merge respect `deletedAt` / server `deletedNoteIds`.

### 1.6 Search
- **Scope**: Filters notes by `searchQuery` (title, displayName, content); list shows matching notes; breadcrumb shows “Search: …”.
- **Highlight**: Match highlight in list (title) and in read-only detail body; cleared when entering edit mode or clearing search.

### 1.7 Workspaces
- **Switch / add / rename / delete**: Sidebar workspace dropdown; add workspace, rename (inline), delete (confirm + `deleteNotesAndFoldersByWorkspace` then `deleteWorkspace`). Default workspace not deletable.
- **Settings**: Workspace appearance (icon, color) for current workspace; Plan (Pro/Free, link to getnotic.io/billing).

### 1.8 Auth and sync
- **Sign in**: Google OAuth (GIS); `authenticateWithGoogleToken`; tokens stored; partition switch; `authLastUser` for offline display.
- **Sign out**: Clear tokens, load local partition, clear server snapshot.
- **Sync**: Full sync (pull → merge → push) on load and on “Resume sync”; delta push after persist when signed in; periodic pull; pause when free user has >10 notes; sync change log; “Sync limit reached” modal and quota warning in sidebar.

### 1.9 Share (publish note)
- **Share modal**: From detail Share button and sidebar note context “Share”. Publish (Pro gate; 402 → upgrade message), Copy link, Unpublish. `publishNote` / `unpublishNote` in `api/backend.ts`. Share link uses `SHARE_PUBLIC_BASE` (public view is on notic-frontend or backend-served page, not in this app).

### 1.10 Move to folder / Move to workspace
- **MoveToFolderModal**: Flat folder list (Root + search); move one or multiple notes/folders via `updateNote` / `updateFolder`.
- **MoveToWorkspaceModal**: Choose target workspace + folder; move notes via `updateNote(..., { workspaceId, folderId })`.

### 1.11 Export and import
- **Export**: Workspace as ZIP (Settings); folder as ZIP (folder context “Export folder”); single note as Markdown (note context “Export”). Obsidian export (Settings → Integrations) – ZIP of markdown files.
- **Import**: Settings → Import ZIP; `importFromZip`; result modal (notes/folders created, skipped).

### 1.12 Integrations (Notion / Obsidian)
- **Notion**: Connect (OAuth link), set sync root (page URL/ID), Sync to Notion button; `getNotionStatus`, `setNotionSyncRoot`, `syncToNotion` in `api/backend.ts`; status and last sync time in UI.
- **Obsidian**: Export to Obsidian button; `getObsidianExport` + `obsidianFilesToZipBlob`; download ZIP; Pro gate (402).

### 1.13 Picture-in-Picture (PiP)
- **Document PiP**: `documentPip.ts` – `openPipWithNote`, `sendNotesUpdateToPip`, `requestPipFlushSave`; iframe in PiP window; multi-tab (openInPipNoteIds, activeId); free limit (2 tabs, replace oldest); PiP unsupported modal when API missing (e.g. Safari).
- **Blocking**: PiP disabled when note is edited in main; “Open in editor” and “Edit” disabled in sidebar/detail when note is in PiP or edited in main; toast “Finish editing in main view first” when trying to open in PiP while editing in main.
- **PipPanel**: In-app fallback when Document PiP not supported.

### 1.14 Subscription and limits
- **Billing status**: `getBillingStatus`; persisted; refreshed on load and sign-in; Pro/Free in Settings and sidebar.
- **Free note limit (10)**: When free and total notes > 10, sync paused on “Resume sync”; sync limit modal; quota warning in sidebar. Backend may reject push for over-quota; app does not block “New Note” in UI when at 10 (see incomplete).
- **Free PiP tab limit (2)**: Enforced; replace oldest tab and toast when opening third; PipView shows limit modal when at limit and adding.

### 1.15 Settings
- **Main**: App theme (dark/light), Note theme (default/sepia/dark/high-contrast), Workspace appearance (icon, color), Plan (Pro/Free + link to billing), Open Integrations.
- **Integrations**: Notion (connect, set root, sync), Obsidian (export); copy and buttons wired to API.

### 1.16 Editor and detail
- **Lexical editor**: Rich text, slash commands, toolbar (bold, italic, etc.), image paste/drop; autosave to store; PiP gets content via `notePayloads` / `sendNotesUpdateToPip`.
- **Detail view**: Read-only markdown when not editing; Edit button; Share, Open editor (PiP), context menu (Edit, Open, Bookmarks, Copy, Move…, Share, Delete); PiP and “edited in main” blocking.

### 1.17 Analytics
- **Umami**: Script in index.html; custom events: `note_created`, `note_deleted` (single/count), `folder_created`, `pip_opened`, `sign_in_completed`, `export_completed` (format: zip/markdown/obsidian), `notion_connected`, `notion_sync_run`.

### 1.18 Error handling
- **AppErrorBoundary**: Wraps Layout; catches render errors; user-facing message.
- **API**: `fetchWithAuth` retries once after token refresh on 401; toast on 5xx; main.tsx shows PiP unsupported modal on related errors.

---

## 2. Incomplete or partial

### 2.1 Free note limit – no UI block on create
- **Current**: Sync is paused when free user has >10 notes; sync limit modal on “Resume sync”; quota warning in sidebar. Creating a new note (toolbar, context menu, onboarding) is **not** blocked or warned when already at 10 notes as free user.
- **Gap**: User can create 11th note locally; sync will be paused or backend may reject push. Extension may warn or block; app allows create.
- **Recommendation**: Optionally block or show a “Sync limit reached” modal before `addNote` when `!isSubscribed && totalNoteCount >= FREE_NOTE_LIMIT`.

### 2.2 Public shared note page
- **Current**: App publishes a note and gets a share link (e.g. `https://…/p/{code}`). The **public viewing page** for that link is not implemented in notic-app; it lives on notic-frontend (or another host). App feature “publish” is complete; the destination URL is external.
- **Note**: If the product expects the shared note to be served by the same app (e.g. app.getnotic.io/p/xxx), that route would need to be added (or confirmed in notic-frontend).

### 2.3 Workspace name in Settings
- **Current**: Settings has “Workspace appearance” (icon, color) for the **current** workspace. Workspace **name** is edited from the Sidebar workspace dropdown (rename), not from Settings. So “rename workspace” exists but only in dropdown, not in Settings. Consider this complete unless product wants rename in Settings too.

### 2.4 Notion “connected” tracking
- **Current**: `notion_connected` is tracked when user sets sync root and `getNotionStatus` returns `connected`. It is not fired when user returns from OAuth and we only refetch status on opening Integrations (no explicit “just connected” transition). Acceptable for analytics; document if you want a stricter “first time connected” event.

---

## 3. Not in app (by design or out of scope)

- **Public share view**: Served by notic-frontend (or backend), not by this SPA.
- **Billing checkout/portal**: Link to getnotic.io/billing; no in-app Stripe UI.
- **Extension-only behavior**: e.g. overlay over arbitrary tabs; this app is a standalone SPA.

---

## 4. Summary table

| Area                    | Status    | Notes                                                                 |
|-------------------------|-----------|-----------------------------------------------------------------------|
| App shell, layout       | Complete  | Sidebar, resize, collapse, theme, workspace dropdown.                 |
| Notes CRUD              | Complete  | Create, read, update, delete (trash + permanent), duplicate.          |
| Folders CRUD            | Complete  | Create, rename, delete; tree in sidebar; folder view in main.          |
| Drag and drop          | Complete  | Notes/folders; drop on folder or root.                                |
| Trash                   | Complete  | View, restore, delete permanently, empty trash.                       |
| Search                  | Complete  | Filter + highlight in list and detail.                                |
| Workspaces              | Complete  | Add, rename, delete (with notes/folders), switch; icon/color in Settings. |
| Auth                    | Complete  | Google sign-in, sign-out, partition, offline last user.               |
| Sync                    | Complete  | Full + delta, pause, periodic pull, limit modal, change log.          |
| Share (publish)         | Complete  | Modal, publish/unpublish, Pro gate; link to external public page.     |
| Move to folder/workspace| Complete  | Modals and API.                                                       |
| Export / Import        | Complete  | ZIP, folder ZIP, note MD, Obsidian; import ZIP with result modal.     |
| Notion / Obsidian       | Complete  | Notion connect, sync root, sync; Obsidian export; API wired.          |
| PiP                     | Complete  | Document PiP, multi-tab, free limit, blocking when editing in main.   |
| Subscription / limits   | Complete  | Pro/Free, 10-note limit (sync pause + modal); PiP 2-tab limit.         |
| Free limit on create    | Incomplete| No block/warn when creating note at 10 as free user.                   |
| Public share page       | N/A       | Not in this app; lives on other host.                                 |
| Analytics               | Complete  | Umami + custom events.                                                |
| Error boundary / API    | Complete  | AppErrorBoundary; 401 retry; 5xx toast.                               |

---

## 5. Recommended next steps (priority)

1. **Free note limit on create** (optional): Before `addNote`, if `!isSubscribed && totalNoteCount >= FREE_NOTE_LIMIT`, show sync limit modal or disable “New Note” and show tooltip.
2. **Keep evaluation-missing-incomplete-and-risks.md** in sync when fixing risks or adding features.
3. **Tests**: Add or extend tests for critical paths (e.g. sync, create-note limit, PiP state) if not already covered (see test-coverage-and-missing-critical-tests.md).
