# Design parity with notic extension – why it’s hard

Short note for future work: copying the extension’s UI exactly in the app is non‑trivial for these reasons.

---

## 1. No single source of truth

- **Extension**: DOM is built in several places (`dashboard-notes.ts`, `dashboard-folders.ts`, `dashboard.ts`), with inline HTML strings and `createElement`. Styles live in `dashboard.css` (3800+ lines) with no clear “folder view” or “sidebar” section.
- **App**: React components (Sidebar, MainContent, etc.) and the same CSS file. There is no 1:1 mapping “this block in the extension = this component”.
- So every feature (folder view, trash, breadcrumbs, etc.) requires **cross‑referencing** multiple extension files and reconciling with the app’s structure.

---

## 2. Different structure, same visuals

- Extension: one big `renderMainNotes()` / `renderSidebarFolders()` that replace `innerHTML` or append nodes. Order of branches (trash → folders → recent → search) is easy to get wrong when reimplementing.
- App: React conditional render tree. The **order of conditions** (e.g. “show folder list vs detail vs empty”) must match the extension’s logic or the wrong view shows (e.g. “files don’t appear” when the folder branch is never hit).
- Same for sidebar: extension has one function that builds the whole tree; app has FoldersTabList + RecentTabList. Both must receive the same data and use the same layout (width, margins, icons) or the sidebar looks different between tabs.

---

## 3. CSS is scattered and contextual

- Extension uses shared class names (e.g. `.sidebar-folder-header-icon`, `.notes-content`) in many places. The **same class** can be used for “Bookmarks”, “Root”, and real folders; color (e.g. `var(--accent-primary)`) is defined once and applies everywhere.
- In the app, if we add a new block (e.g. Folders tab) and forget to apply the same class or the same CSS, that block looks different (e.g. icons not colored).
- So parity means: for every visual element in the extension (icon color, folder color dot, width, margin), we must find the **exact** selector in `notic/src/dashboard.css` and mirror it in the app, including for new components.

---

## 4. Data and filters

- Extension often uses global state (e.g. `notesData`, `folders`, `currentTab`) and may not filter by workspace in every code path. The app uses Zustand and explicitly filters by `workspaceId`. If the filter is too strict (or wrong), lists show 0 items even when data exists – so “files not showing” can be a **data/filter bug**, not just layout.

---

## 5. What helps

- **Use the extension as the reference**: For any UI (main content width, sidebar items, folder/bookmark icons), open the corresponding part of the extension (e.g. `dashboard-notes.ts` for main content, `dashboard-folders.ts` for sidebar folders, `dashboard.css` for `.sidebar-folder-header-icon`, `.notes-content`, etc.) and match:
  - container width (e.g. 800px for main content)
  - sidebar item width (full width of sidebar, same for Recent and Folders)
  - icon color (e.g. `color: var(--accent-primary)` for folder/bookmark icons)
  - optional color dot for folders (`sidebar-folder-color` + inline `background-color`)
- **One checklist per screen**: e.g. “Folder view: main = 800px, sidebar = full width, folder/bookmark icons = accent, folder color dot when present” so we don’t miss a rule.

---

## Reference (quick)

- **Main content width**: Extension uses `max-width: 800px` on `.breadcrumbs-row`, `.breadcrumbs`, `.search-container`, `.notes-content` (not on `.content-view`). App keeps main content in an 800px container (e.g. `.content-view` or `.notes-content` at 800px) for both Recent and Folders.
- **Sidebar**: Same width for Recent and Folders; `.notes-list` and `.sidebar-content` full width; folder headers use `margin: 0 16px`; `.sidebar-folder-header-icon` and bookmark icon use `color: var(--accent-primary)`; folders with a color show `.sidebar-folder-color` with `background-color: folder.color`.
