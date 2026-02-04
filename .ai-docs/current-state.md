# Notic App – Current State

Snapshot of what exists in the notic-app SPA (as of this doc). Use for context and to avoid duplicating or breaking existing behavior.

## Overview

- **Stack**: Vite 7, React 19, TypeScript, Zustand, Dexie (IndexedDB), Tailwind 4, vitest.
- **Goal**: SaaS web app (not a Chrome extension) that mirrors notic extension design and core behavior, offline-first with Document PiP for notes.

## Architecture

### State (Zustand)

- **useUIStore**: `isDarkMode`, `sidebarCollapsed`, `sidebarWidth` (200–480, default 280), `currentView` (notes | settings | integrations), `isTrashView`, `openInPipNoteId`. All persisted via prefs except openInPipNoteId.
- **useNotesStore**: `notes`, `folders`, `currentTab` (recent | folders), selection and folder-expansion state, `searchQuery`, `sort`. Notes/folders persisted to IndexedDB.
- **useWorkspaceStore**: `currentWorkspaceId`, `workspaces`. Persisted via prefs + workspaces table.

### Persistence (Dexie)

- **Schema** (`src/db/schema.ts`): `NoticDB` with tables `notes`, `folders`, `workspaces`, `prefs` (key-value).
- **Hydrate**: On app init, `hydrateStores(db)` loads notes, folders, workspaces, and prefs into Zustand.
- **Persist**: `startPersist(db)` subscribes to stores and debounced-writes back to Dexie (notes/folders 300ms, prefs 150ms). `stopPersist()` clears subscriptions (e.g. tests).

### Prefs keys

- `currentWorkspaceId`, `sidebarCollapsed`, `isDarkMode`, `sidebarWidth` (see `src/db/prefs-keys.ts`).

### UI Shell

- **Layout**: Resizable sidebar (drag edge; double-click edge to collapse; click collapsed strip to expand). No extra collapse button (matches extension).
- **Sidebar**: Workspace selector, Recent/Folders tabs, Open Notes (PiP), toolbar (New Note, New Folder, Sort, Expand All, Trash), notes list placeholder, footer (Connect for sync, Settings, theme toggle).
- **MainContent**: Breadcrumbs, sync status placeholder, search, notes list placeholder.
- **PipPanel**: In-app PiP-style modal fallback when Document PiP is unavailable.

### PiP

- **documentPip.ts**: `isDocumentPipSupported()` (checks `window.documentPictureInPicture`), `openPipWithNote(note, { isDarkMode, onClose })` opens Chrome Document PiP and injects note UI. PiP window state tracked in module; close detection via interval.

## Implemented vs TODO

- **Done**: App shell, sidebar resize/collapse (extension behavior), theme toggle, hydrate/persist, PiP open + fallback modal, design tokens and notic-style CSS.
- **TODO**: Notes CRUD, folders UI + actions, search filter, settings view, auth/sync, trash, rich editor (e.g. Lexical).

## Tests

- **hydrate.test.ts**: Hydrates notes, folders, workspaces, prefs into stores; empty DB leaves defaults.
- **useUIStore.test.ts**: Sidebar width clamping, UI setters.
- **useNotesStore.test.ts**: toggleFolderExpanded, setSelection/clearSelection.
- **documentPip.test.ts**: isDocumentPipSupported with/without `documentPictureInPicture`.
- **persist.test.ts**: startPersist + store changes trigger debounced writes to mock DB (prefs, notes/folders shape).

## Key Files

| Area        | Path |
|------------|------|
| App entry  | `src/main.tsx` (hydrate → startPersist → render App) |
| Layout     | `src/components/Layout.tsx` |
| Sidebar    | `src/components/Sidebar.tsx` |
| Main       | `src/components/MainContent.tsx` |
| PiP modal  | `src/components/PipPanel.tsx` |
| PiP API    | `src/pip/documentPip.ts` |
| DB         | `src/db/schema.ts`, `hydrate.ts`, `persist.ts` |
| Store      | `src/store/useUIStore.ts`, `useNotesStore.ts`, `useWorkspaceStore.ts`, `types.ts` |
| Styles     | `src/index.css` (tokens), `src/dashboard.css` (layout/components) |
