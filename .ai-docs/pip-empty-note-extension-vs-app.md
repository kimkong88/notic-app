# PiP empty-note logic: extension vs app comparison

## Rule

**If a session is activated from "PiP – new tab" and no content was written, it should be deleted and not stored in the sidebar.**

---

## Extension (notic) – current behavior

### How PiP-created notes are identified

- When PiP sends `addNote` with a new `sessionId`, the dashboard creates the note with **`hasEverHadContent: false`** (`dashboard-pip.ts` ~line 620).
- Notes created from the **sidebar** (`createNewNote`) are created with **`hasEverHadContent: true`** (`dashboard-notes.ts` ~line 2161).

So the extension does **not** use a `createdFromPip` flag; it relies on `hasEverHadContent`:
- PiP-created → `hasEverHadContent: false` → eligible for delete when closed empty.
- Sidebar-created → `hasEverHadContent: true` → never deleted when closed empty (content is cleared but note is kept).

### When empty notes are removed

1. **Single-tab close** (`closeNote`): Dashboard receives `closeNote` with `isEmpty`. If `isEmpty` and note has `hasEverHadContent === false`, the note is **deleted** from `notesData` and storage (`dashboard-pip.ts` ~459–471, ~512–526).
2. **Multi-tab close** (`closeNotes`): Same rule per item: `isEmpty` and `hasEverHadContent === false` → delete.
3. **PiP window close**: The PiP page’s `beforeunload` / `pagehide` runs `onPiPClose`, which builds `closeNotes` with `(sessionId, isEmpty)` for each open note and posts it to the dashboard. So when the user closes the PiP window normally, the dashboard **does** receive `closeNotes` and can delete empty PiP-created notes.

### Gap in the extension

- If the PiP window is closed in a way that **does not** run the PiP page’s `beforeunload` (e.g. force-close, task manager, or browser-specific behavior), the dashboard **never** receives `closeNotes`.
- The dashboard still runs **`handlePiPClose`** when it detects the window is closed (e.g. `setInterval` sees `requestedWindow.closed`). Today `handlePiPClose` only:
  - Removes the message listener
  - Sets `pipWindow = null`, clears message handler, sets PiP closed, re-renders
- It does **not** remove empty PiP-created notes from `notesData` / storage or from `pipActiveNotes`.

So in that scenario, empty PiP-created notes **remain** in the sidebar and in storage.

**Required change in extension:** In `handlePiPClose`, before clearing PiP state, for each `sessionId` in `pipActiveNotes`: if the note exists in `notesData`, has `hasEverHadContent === false`, and content is empty, delete it from `notesData` and storage and remove it from `pipActiveNotes`, then `savePipActiveNotes()`. This matches the app’s onClose cleanup.

---

## App (notic-app) – current behavior

### How PiP-created notes are identified

- The app uses an explicit **`createdFromPip`** flag on the note type.
- When the dashboard handles `notic-pip-add-note`, it creates the note with **`createdFromPip: true`** (and does not set `hasEverHadContent` for new notes).
- Notes created from the sidebar use `addNote(...)` without `createdFromPip`, so they are not treated as PiP-created.

### When empty notes are removed

1. **Single-tab close** (`notic-pip-close-tab` with `isEmpty`): If the note has **`createdFromPip === true`** and **`hasEverHadContent !== true`**, the note is **removed** from the notes store (`Layout.tsx`).
2. **PiP window close** (`onClose` from `openPipWithNote`): Before clearing `openInPipNoteIds` / `openInPipActiveNoteId`, the app iterates over the current PiP note ids and **removes** any note where **`createdFromPip === true`** and **`hasEverHadContent !== true`**, then clears UI state (`MainContent.tsx`, `Sidebar.tsx`).

So the app:
- Only deletes notes that are both PiP-created and never had content.
- Always runs this cleanup on PiP window close (via the Document PiP `onClose` callback), so it does not depend on the PiP document’s `beforeunload`.

---

## Summary and parity

| Aspect | Extension | App |
|--------|-----------|-----|
| Identify PiP-created notes | `hasEverHadContent: false` (only PiP add sets this) | `createdFromPip: true` |
| Delete on single-tab close when empty | Yes, when `isEmpty` and `hasEverHadContent === false` | Yes, when `isEmpty` and `createdFromPip && !hasEverHadContent` |
| Delete on PiP window close | Only if PiP sends `closeNotes` (e.g. beforeunload) | Yes, in `onClose` callback (no dependency on PiP document) |
| Gap | No cleanup in `handlePiPClose` when PiP never sent `closeNotes` | None |

To align the extension with the app and with the rule “PiP new-tab sessions with no content must not be stored” even when the PiP window is closed without firing `beforeunload`, the extension should add the same cleanup logic inside **`handlePiPClose`**: remove empty PiP-created notes (empty content and `hasEverHadContent === false`) from `notesData` and storage, and remove their ids from `pipActiveNotes` and persist via `savePipActiveNotes()`.
