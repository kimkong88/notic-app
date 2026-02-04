# Evaluation: testables we missed & refactor opportunities

Summary of **notic-app** codebase review: test coverage gaps and refactoring opportunities (no implementation).

---

## 1. Testables we missed

### 1.1 New / untested modules (high value)

| Module | What to test | Why |
|--------|--------------|-----|
| **utils/exportZip.ts** | `sanitizeName`, `exportWorkspaceAsZip` (path map, disambiguation, blob shape), `downloadExportBlob` (optional: URL/createObjectURL) | Export is critical; wrong paths or names break round-trip. `sanitizeName` is shared with import. |
| **utils/importZip.ts** | `parsePath`, `importFromZip` with a small in-memory ZIP and mock deps (`addFolder`, `addNote`, `updateNote`) | Import is critical; folder depth, ordering, disambiguation and note creation must be correct. |
| **utils/folderUtils.ts** | `getFolderDepth`, `isDescendantOf`, `canAcceptFolderDrop`, `getFolderAncestorIds`, `getFolderNoteCountRecursive` | Used for sidebar depth, drag-drop validation, and counts; pure functions, easy to test. |
| **utils/dateKeys.ts** | `formatDateKey`, `parseDateKey`, `formatDate` (relative vs absolute) | Date grouping and display; wrong keys break Recent tab and display. |

### 1.2 Partially tested (gaps)

| Area | Missing tests | Why |
|------|----------------|-----|
| **store/useNotesStore** | `updateNote` (patch, content truncation, title/extractTitle, lastModified), `addNote` (folderId/workspaceId), `addFolder`, `restoreNote`, `removeNote`, `deleteNotesAndFoldersByWorkspace`, `updateFolder`, `removeFolder` | Data integrity and UX; many actions are still untested. |
| **utils/noteUtils.ts** | `escapeHtml` (quotes, `<`, `>`, `&`), `applySearchHighlightInElement` / `clearSearchHighlightInElement` (DOM-dependent; can unit-test with jsdom or skip) | `escapeHtml` is used with `highlightMatch` for HTML output; untested escape = XSS risk. |

### 1.3 Lower priority / optional

| Area | Note |
|------|------|
| **api/upload.ts** | `getApiUrl`, `getAccessToken` (storage/opener/parent), `uploadImage` (validation, fetch). Better tested with mocks or E2E; not blocking. |
| **db/schema.ts** | Key shapes and version; could add a small “key contract” test that persist keys match what hydrate expects. |
| **Components** | No component tests yet; Layout/Sidebar/MainContent/SettingsView are integration-heavy. Optional: focus on pure utils and store first. |

---

## 2. Refactor opportunities

### 2.1 Store typing (useNotesStore)

- **NotesActions** is missing **`updateFolder`** and **`removeFolder`**. They are implemented and used (Sidebar, MainContent) but not declared on the interface. **Refactor:** Add both to `NotesActions` so the store API is complete and type-safe.

### 2.2 Export/import shared surface

- **exportZip**: `buildFolderPathMap` is not exported; only `sanitizeName` and the export function are. Tests for path building can go through `exportWorkspaceAsZip` (e.g. assert blob contents or a small fflate parse). Alternatively, export `buildFolderPathMap` for unit tests only (or a test-only entrypoint).
- **importZip**: `parsePath` is exported; good for unit tests. `importFromZip` is dependency-injected; easy to test with mock deps. No refactor strictly needed; adding tests is the main improvement.

### 2.3 Constants and magic numbers

- **importZip.ts**: `MAX_FOLDER_DEPTH = 4` is local; **folderUtils.ts** exports `MAX_FOLDER_DEPTH = 4`. **Refactor:** Import a single constant from one place (e.g. `folderUtils` or `store/types`) to avoid drift.
- **exportZip**: Uses inline `DEFAULT_WORKSPACE_ID` from workspace store; consistent. No change needed.

### 2.4 Settings export/import UX

- Export/import progress and error handling live in **SettingsView**. Logic is thin (call utils + setState). Optional: extract a small hook (e.g. `useExportImport`) to simplify the component and make the flow testable in isolation (e.g. with mock store and blob APIs).

### 2.5 Duplicate “Untitled” fallback

- **exportZip** `sanitizeName` returns `'Untitled'` when trimmed name is empty; **importZip** uses `sanitizeName(stem) || 'Untitled'`. Single shared constant (e.g. `DEFAULT_NOTE_TITLE = 'Untitled'`) would avoid drift; low priority.

---

## 3. Suggested order of work

1. **Tests**
   - **exportZip**: `sanitizeName` + `exportWorkspaceAsZip` (paths, same-name disambiguation, only current workspace).
   - **importZip**: `parsePath` + `importFromZip` with mock deps and a small ZIP (e.g. 2–3 .md files, one in a folder).
   - **folderUtils**: all pure functions.
   - **dateKeys**: `formatDateKey`, `parseDateKey`, `formatDate` (relative/absolute).
   - **noteUtils**: `escapeHtml` (and optionally DOM helpers if using jsdom).
   - **useNotesStore**: `updateNote`, `addNote`, `addFolder`, `restoreNote`, `removeNote`, `deleteNotesAndFoldersByWorkspace`, `updateFolder`, `removeFolder`.
2. **Refactors**
   - Add `updateFolder` and `removeFolder` to `NotesActions` in **useNotesStore**.
   - Unify **MAX_FOLDER_DEPTH** (one module).
   - Optionally: single **Untitled** constant; optional **useExportImport** hook.

---

## 4. References

- Existing test-coverage doc: `.ai-docs/test-coverage-and-missing-critical-tests.md` (notic + notic-app).
- Test runners: `npm test` / `npm run test:run` (Vitest) in notic-app root.
