# Notic App – TODO and remaining work

What’s left to implement or align with the extension. Updated when scope or status changes.

---

## Current focus

- *(None – folder view done.)* – Main content: mixed list of folders + notes (folders first, then notes); folder rows with icon, name, note count; click folder to navigate, click note to select. Sidebar Folders tab: folder tree (Bookmarks virtual folder, Root, then recursive folders + notes); expand/collapse; select folder or note. Empty states: “This folder is empty” / “No notes or folders”.

---

## Remaining / TODO (high level)

- **Tests** – useNotesStore: updateNote, setSearchQuery, restoreNote/removeNote; noteUtils: escapeHtml, DOM highlight helpers (JSDOM); useWorkspaceStore coverage (see test-coverage-and-missing-critical-tests.md).
- **Auth/sync** – Connect Google, sync status, push/pull (extension has full flow).
- **Settings view** – Filled settings screen (extension has sync, theme, etc.).

---

## Done (for reference)

- App shell, sidebar resize/collapse, theme toggle, hydrate/persist, PiP + fallback modal.
- Workspace dropdown, default workspace, Recent/Folders tabs, toolbar (New Note, Sort, Expand All, Trash).
- Main content: breadcrumbs, search, note list (Recent by date / Bookmarks), note detail (read-only + edit), Pip button.
- Trash view: deleted notes list, Restore, Delete permanently, Empty trash; trash breadcrumb; hide search in trash.
- Inline rename, read-only markdown in detail, search scope (title + displayName + content), search highlight, date click clears search.
- Folder view (main): mixed list of folders + notes (folders first, then notes); folder rows with icon, name, note count; click folder to navigate, click note to select. Empty: "This folder is empty" / "No notes or folders". Root vs inside-folder and ROOT_SENTINEL.
- Folder view (sidebar): Folders tab shows folder tree – Bookmarks virtual folder, Root virtual folder, recursive folders + notes; expand/collapse; select folder or note; workspace-filtered; getFolderNoteCountRecursive; folder-item and sidebar-folder-container CSS.
- Folder CRUD: Create (toolbar New Folder at root, folder context “New Folder” for subfolder, empty-area context “New Folder” on Folders tab); Rename (folder context “Rename” → inline rename); Delete (folder context “Delete” → confirm modal); Change color and Export folder in folder context menu.
- Drag-and-drop: Move notes/folders in sidebar and main content (drop on folder or root); canAcceptFolderDrop prevents invalid moves.
- Context menus: Folder context menu (Rename, New Note, New Folder, Change color, Export folder, Delete); empty-area “New Note” and “New Folder” (Folders tab).
- Share: Share modal (Publish / Copy link / Unpublish), publishNote/unpublishNote in api/backend.ts, wired in MainContent and Sidebar.
- Move to folder / Move to workspace: MoveToFolderModal and MoveToWorkspaceModal in Sidebar with picker UI and updateNote/updateFolder apply.

---

## Sync (full vs incremental / delta)

- **Pull**: Incremental when possible – `pullFromServer(db, lastPullAt > 0 ? lastPullAt : undefined)` sends `since=lastPullAt`.
- **Push**: **triggerSync(db)** is push-only and sends a **delta** when we have a cached `lastServerSnapshot` (after a full sync): only local-only + local-newer notes, plus `deletedNoteIds` / `deletedFolderIds` / `deletedWorkspaceIds`. When no snapshot (e.g. after sign-out or first load), it sends the full local payload. Matches extension `triggerSync` and `buildDeltaPayload`.
- **When delta runs**: After persist (notes/folders/workspaces) when signed in, `triggerSync(db)` is called from `persist.ts`. Full sync on load and on "Resume sync"; delta push after edits.
- **lastServerSnapshot** is set after successful full sync and after each successful triggerSync; cleared on sign-out and when sync is paused.

---

## Reference

- Extension folder view: `notic/src/dashboard-notes.ts` (main: folders + notes list around 2290–2515), `notic/src/dashboard-folders.ts` (renderSidebarFolders, getFolderNoteCountRecursive, sortFolders).
- Extension CSS: `.folder-item`, `.folder-icon`, `.sidebar-folder-container`, `.sidebar-folder-header`, `.sidebar-folder-content`, `.sidebar-note-item`.
