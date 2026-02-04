# Auto-save and sync trigger: extension vs app

Comparison of (1) auto-save behaviour and (2) when sync (triggerSync, not full sync) is triggered.

---

## 1. Auto-save behaviour

### Extension (notic)

| Aspect | Behaviour |
|--------|-----------|
| **Where** | `editor.ts`: Lexical `registerUpdateListener` + `saveEditorContent(editorRoot)` |
| **Debounce** | **700 ms** (`SAVE_DEBOUNCE_MS = 700`) before persisting content. Only when content actually changed (skips selection/focus-only updates). |
| **Flush on blur** | **Yes.** `editorRoot.addEventListener('blur', () => { clear timeout; saveEditorContent(editorRoot); })` so content is persisted when user navigates away before debounce fires. |
| **Flush on unmount / beforeunload** | Yes (implicit on teardown; PiP also has beforeunload). |
| **Flow** | Editor content change → debounce 700ms → `saveEditorContent` → `onSave(markdown)` → dashboard `saveNoteContentFromDetailEditor(sessionId, markdown)` → update in-memory `notesData`, write to `chrome.storage.local`, then `triggerSync()`. |
| **PiP** | Same editor: 700ms debounce + flush on blur; on save, PiP writes to storage and posts to dashboard; after storage write, `triggerSync()`. |

### App (notic-app)

| Aspect | Behaviour |
|--------|-----------|
| **Where** | `NoteEditor.tsx`: `OnChangePlugin` → `handleChange` → `onChange(markdown)`. `MainContent.tsx`: `handleNoteDetailContentChange` → `updateNote(selectedNoteId, { content })`. |
| **Debounce** | **None in the editor.** Every Lexical change calls `onChange` → `updateNote`. Persist layer then debounces **300 ms** (`DEBOUNCE_MS_DATA`) before writing to IndexedDB and calling `triggerSync(db)`. |
| **Flush on blur** | **No.** No blur listener on the editor. Only flush is **on unmount** and **beforeunload** (`FlushOnUnmountPlugin` → `onFlush`). |
| **Flush on unmount / beforeunload** | Yes. `onFlush` calls `updateNote(..., { content })` so latest content is in store before tab close or when switching note (unmount). |
| **Flow** | Editor change → `updateNote` (every keystroke) → store update → persist subscribe → debounce 300ms → `persistNotesAndFolders` → `triggerSync(db)`. |
| **PiP** | `PipView`: debounced `applyNoteUpdate` (e.g. 700ms `SAVE_DEBOUNCE_MS`), `handleFlush` on tab switch/beforeunload; posts `notic-pip-note-update` to parent; parent updates store → persist → triggerSync. |

### Gaps (app vs extension)

1. **No editor-level debounce (700 ms)**  
   - Extension: saves to storage (and triggers sync) at most every 700 ms while typing.  
   - App: store is updated on every keystroke; only persist (and thus sync) is debounced 300 ms.  
   - **Impact:** More store updates and re-renders while typing; sync can run more often (300 ms) than in the extension (700 ms). Consider debouncing `handleNoteDetailContentChange` (e.g. 700 ms) before `updateNote` to match extension and reduce load.

2. **No flush on blur**  
   - Extension: editor `blur` clears the save timeout and runs `saveEditorContent` immediately.  
   - App: no blur handler; content is only flushed on unmount (e.g. switching note) or beforeunload.  
   - **Impact:** If the user types and blurs the editor (e.g. clicks elsewhere) before the 300 ms persist debounce fires, the last edits are still in the editor and will only be persisted when the debounce runs or on next flush (e.g. switch note). Small race window; adding blur-to-flush would match the extension.

3. **PiP: no “flush before main-app selection change”**  
   - Extension: before changing selection in the dashboard, it calls `requestPiPFlushSave()` so the PiP window flushes its current note to storage (and then sync runs).  
   - App: no equivalent. When the user changes selection in the main app (e.g. clicks another note), the main app does not ask the PiP window to flush.  
   - **Impact:** If the user is editing in PiP and then clicks a different note in the main app, PiP’s last debounced content might not have been sent yet. The app could send a `flushSave` (or similar) message to the PiP window before applying the selection change and have PipView flush and post the update.

---

## 2. When sync (triggerSync) is triggered

### Extension (notic)

| Trigger | Where |
|--------|--------|
| **After note content save** | `dashboard-notes.ts`: `saveNoteContentFromDetailEditor` → after storage write callback → `getStoredTokens().then((tokens) => { if (tokens) void triggerSync(); })`. |
| **After bookmark toggle** | `dashboard-notes.ts`: after setting note meta in storage → `triggerSync()`. |
| **After move note to folder** | `dashboard-folders.ts`: `doWrite` (folder + meta) → `triggerSync()`. |
| **After PiP saves content** | `dashboard-pip.ts`: after PiP writes to storage and updates notesData → `getStoredTokens().then((tokens) => { if (tokens) void triggerSync(); })`. |
| **onWorkspaceAction** | `dashboard.ts`: when user creates/renames/deletes a workspace → `if (isSignedInForSync) triggerSync()`. |
| **onFolderAction** | `dashboard.ts`: when user creates/renames/deletes/moves a folder → `if (isSignedInForSync) triggerSync()`. |
| **onNoteAction** | `dashboard.ts`: when user creates/deletes/restores/duplicates/moves/renames notes → `if (isSignedInForSync) triggerSync()`. |

So the extension calls `triggerSync()` **at the point of each action**, right after the relevant storage write (or in its callback). No separate “persist” layer; storage is written by the dashboard/PiP and then sync is invoked.

### App (notic-app)

| Trigger | Where |
|--------|--------|
| **After persist (notes/folders)** | `db/persist.ts`: `persistNotesAndFolders` runs (debounced 300 ms after any note/folder store change); at the end, if `partition !== LOCAL_PARTITION` then `void triggerSync(db)`. |
| **After persist (workspaces)** | `db/persist.ts`: `persistWorkspaces` (debounced 300 ms); at the end, if not local partition, `void triggerSync(db)`. |

So the app **only** triggers sync from the persist layer: after debounced writes to IndexedDB for notes/folders and for workspaces. Any action that updates the store (note edit, folder create, workspace switch, move, delete, etc.) eventually triggers persist and then triggerSync, but **only after the 300 ms debounce**.

### Gaps (app vs extension)

1. **Sync is only tied to persist debounce**  
   - Extension: sync runs immediately after each logical action’s storage write (note save, bookmark, move, workspace/folder/note CRUD).  
   - App: sync runs only when `persistNotesAndFolders` or `persistWorkspaces` runs, i.e. 300 ms after the last store change.  
   - **Impact:** Sync is delayed by up to 300 ms after an action. For many actions (e.g. “move to folder”) the extension syncs as soon as the move is written; the app syncs when the next persist batch runs. Functionally the app still syncs all changes; the difference is timing and that the app does not have explicit “sync right after this action” hooks.

2. **No explicit triggerSync on workspace switch**  
   - Extension: switching workspace only updates UI and loads data; it does **not** call `triggerSync()` for the switch itself (workspace list is already synced via onWorkspaceAction when workspace was created/renamed/deleted). So no gap here.  
   - App: workspace switch updates `currentWorkspaceId` in store → `persistPrefs` (150 ms) runs; we do **not** call `triggerSync` from prefs persist (only from notes/folders and workspaces persist). Workspace **list** changes do trigger sync (via `persistWorkspaces`). So for “switch current workspace” we don’t push anything new; that’s correct. No change needed.

3. **Summary**  
   - The only behavioural gap is that sync is **always** delayed by the persist debounce (up to 300 ms), whereas the extension often syncs immediately after the action. If desired, the app could call `triggerSync(db)` explicitly after specific actions (e.g. after “move to folder” or after workspace CRUD) in addition to the persist-based trigger, to get closer to “sync right after action” without waiting for the next batch.

---

## Summary table

| Item | Extension | App | Gap? |
|------|-----------|-----|------|
| Editor save debounce | 700 ms | None (store every keystroke; persist 300 ms) | Yes – consider 700 ms before updateNote. |
| Flush on blur | Yes | No | Yes – consider blur → flush. |
| Flush on unmount/beforeunload | Yes | Yes | No. |
| PiP flush before main selection change | Yes (`requestPiPFlushSave`) | No | Yes – consider postMessage flushSave. |
| When triggerSync runs | After each action’s storage write | After persist debounce (300 ms) | Yes – sync can be up to 300 ms delayed; optional: explicit triggerSync after key actions. |
