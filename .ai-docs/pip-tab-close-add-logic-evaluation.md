# PiP tab close/add logic evaluation

## Summary

PiP tab close and add were acting up because (1) the dashboard sent **stale** `notesUpdate` after PiP messages, and (2) closing a tab did not remove empty notes like the Notic extension does.

---

## 1. Root cause: stale state when sending `notesUpdate`

**Where:** `Layout.tsx` message handler for `notic-pip-add-note`, `notic-pip-close-tab`, `notic-pip-switch-tab`.

**What was wrong:** The handler did:

```ts
const ui = useUIStore.getState()
// ...
ui.addNoteToPip(newId, true)   // or removeNoteFromPip(noteId) / setPipActiveNote(noteId)
sendNotesUpdateToPip(ui.openInPipNoteIds, ui.openInPipActiveNoteId)
```

`ui` is a snapshot from the **start** of the handler. After `addNoteToPip` / `removeNoteFromPip` / `setPipActiveNote`, the store is updated but `ui` still holds the old values. So we were sending the **previous** list and activeId to the PiP iframe.

**Effects:**

- **Close tab “sometimes opens a new note”:** User closes a tab; PiP updates its local state and sends `notic-pip-close-tab`. Dashboard calls `removeNoteFromPip(noteId)` then `sendNotesUpdateToPip(ui.openInPipNoteIds, ui.openInPipActiveNoteId)` with the **old** list (still including the closed id). PiP receives `notesUpdate` and overwrites its state with that old list, so the closed tab **reappears** — it looks like closing brought a note back or “opened” something.
- **Add tab “clunky / sometimes won’t open”:** User adds a note; dashboard creates the note and calls `addNoteToPip(newId, true)` then `sendNotesUpdateToPip(ui.openInPipNoteIds, ui.openInPipActiveNoteId)` with the **old** list (without the new id). PiP never gets the new note in the list, so the new tab doesn’t show or is inconsistent.

**Fix:** After any PiP state change, read **fresh** state and send that:

```ts
sendNotesUpdateToPip(useUIStore.getState().openInPipNoteIds, useUIStore.getState().openInPipActiveNoteId)
```

---

## 2. Extension vs app: close tab and empty notes

**Extension (notic) behavior:**

- PiP `closeNote(sessionId)` in `pip.ts`:
  - Reads editor content, sets `isEmpty = (content.trim() === '')`.
  - Sends `closeNote` to dashboard with `{ sessionId, isEmpty }`.
- Dashboard `dashboard-pip.ts` on `closeNote`:
  - Removes `sessionId` from `pipActiveNotes`.
  - If `isEmpty`: if note **has never had content** (`!stable`), **delete** the note from `notesData` and storage; otherwise keep the note but clear content (and sync).

So in the extension: **if nothing has been modified (empty and never had content), the note is removed** from the sidebar and storage when you close the tab in PiP.

**App (notic-app) before fix:**

- PiP sent only `notic-pip-close-tab` with `noteId`. No `isEmpty`.
- Dashboard only called `removeNoteFromPip(noteId)` and never deleted the note from the notes store. Empty “new” notes stayed in the sidebar.

**Fix (align with extension):**

- **PipView:** When closing a tab (or context menu “Close”), compute  
  `isEmpty = (notes[noteId]?.content?.trim() ?? '') === ''`  
  and send `{ type: 'notic-pip-close-tab', noteId, isEmpty }`.
- **Layout (dashboard):** On `notic-pip-close-tab`:
  - Call `removeNoteFromPip(noteId)`.
  - If `event.data.isEmpty === true`: get the note from the notes store; if `!note?.hasEverHadContent`, call `removeNote(noteId)` so the note is removed from state (and persist layer can drop it). If the note has had content, we only remove it from PiP (do not delete the note).
  - Then send `notesUpdate` to PiP with **fresh** state (see above).

Result: “If nothing has been modified, it should remove empty note” — only for notes that are empty and never had content, matching the extension.

---

## 3. Add-note flow (extension vs app)

**Extension:**

- PiP generates a new `sessionId`, sends `addNote(sessionId)` to dashboard.
- Dashboard creates the note, adds it to `pipActiveNotes`, then `sendNotesToPiP()`. PiP receives `notesUpdate` with the new list and shows the new tab.

**App:**

- PiP sends `notic-pip-add-note` (no id). Dashboard creates the note (`addNote`), adds it to PiP state (`addNoteToPip(newId, true)`), then must send `notesUpdate` with the **updated** list. The only bug was the stale state; with the fix above, add-note should behave correctly.

---

## 4. Summary of code changes

| Area | Change |
|------|--------|
| **Layout.tsx** | After each PiP action, call `sendNotesUpdateToPip(useUIStore.getState().openInPipNoteIds, useUIStore.getState().openInPipActiveNoteId)` so PiP always receives current list and activeId. |
| **Layout.tsx** | On `notic-pip-close-tab`: if `event.data.isEmpty === true`, and note exists and `!note.hasEverHadContent`, call `useNotesStore.getState().removeNote(noteId)`. |
| **PipView.tsx** | In `handleCloseTab` and in the context menu “Close” handler: compute `isEmpty` from `notes[noteId]?.content?.trim() === ''` and include `isEmpty` in the `notic-pip-close-tab` postMessage payload. |

No change to the extension’s “replace” or tab-limit logic was required for this evaluation; the issues were stale `notesUpdate` and missing empty-note removal.
