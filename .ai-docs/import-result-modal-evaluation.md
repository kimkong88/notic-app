# Import result: extension vs app behaviour (evaluation)

## Extension behaviour (notic)

Import from ZIP **always** shows a **modal dialog** for the result (no inline message).

- **No notes imported** (empty ZIP or no .md files):  
  `showInfoModal('Import', message)`  
  - Title: **"Import"**  
  - Message: either *"No Markdown (.md) files found in this ZIP. Only .md files are imported."* or *"No notes were imported from this file."* (depending on `result.skipped > 0`)

- **Success** (at least one note or folder):  
  `showInfoModal('Import complete', parts.join(' '))`  
  - Title: **"Import complete"**  
  - Message: e.g. *"5 notes imported. 2 folders created."* and optionally *"3 file(s) skipped (non-.md)."*

- **Error** (exception):  
  `showInfoModal('Import failed', 'Something went wrong. Please try again.')`  
  - Title: **"Import failed"**  
  - Message: *"Something went wrong. Please try again."*

`showInfoModal` in the extension is an overlay with:
- Backdrop (click to close or OK)
- `.modal` box with `.modal-header`, `.modal-title`, `.modal-message`, `.modal-actions`
- Single **OK** button that closes the modal

So the user gets a clear, blocking feedback in a modal; no result is only shown inline.

---

## App behaviour (notic-app) today

- **All outcomes** (empty, success, error) are shown as an **inline** message below the "Import from ZIP" button:  
  `<p className="settings-import-message" role="status">{importMessage}</p>`
- No modal is shown for import result.

---

## Mismatch

| Aspect        | Extension              | App (current)     |
|--------------|------------------------|-------------------|
| Result UX    | Modal (overlay + OK)   | Inline text only  |
| Visibility   | High (centered modal)  | Lower (in page)    |
| Dismissal    | Explicit OK            | Message stays     |
| Parity       | —                      | **Does not match**|

---

## Recommendation

To match the extension:

1. **Show an info modal** for every import result (empty, success, error), with:
   - **Title:** "Import" (empty) / "Import complete" (success) / "Import failed" (error)
   - **Message:** same copy as extension (see above)
   - **Single OK button** that closes the modal

2. **Keep or drop inline message:**  
   - Option A: **Only** modal (match extension exactly; remove or hide the inline `settings-import-message` for import).  
   - Option B: Keep inline message as well (e.g. for accessibility / status region). Extension does not do this, so for parity, Option A is enough.

3. **Implementation approach:**  
   - Reuse the existing **modal pattern** already used in the app (e.g. `Layout` PiP unsupported: `modal-overlay` + `modal` + `modal-header` + `modal-title` + `modal-message` + `modal-actions` + `modal-btn`).  
   - In **SettingsView**, add local state for the import result modal, e.g. `importResultModal: null | { title: string; message: string }`.  
   - After `importFromZip` (and any re-renders/refreshes), set that state with the appropriate title and message instead of (or in addition to) `setImportMessage`.  
   - Render a modal when `importResultModal !== null`, with the title and message and an OK button that sets `importResultModal` back to `null`.  
   - No need for a global store for this unless you want a shared “info modal” used elsewhere; local state in SettingsView is enough.

---

## Reference (extension code)

- **Import handler:** `notic/src/dashboard.ts` (around lines 487–531): file input change → `importFromZip(bytes)` → `renderSidebarNotes()` etc. → `showInfoModal(...)` for all three outcomes.  
- **Modal implementation:** `notic/src/dashboard-notes.ts` (around 1367): `showInfoModal(title, message, options?)` builds overlay + modal + OK.
