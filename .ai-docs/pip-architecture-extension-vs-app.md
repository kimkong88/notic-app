# PiP architecture: extension vs app (evaluation, no code changes)

Evaluation of how the **extension** and the **app** handle PiP so the parity gap is explicit.

---

## Extension: single store, PiP is a thin client

### Where note data lives
- **Dashboard only.** `notesData` (Map) + chrome.storage. PiP holds **no** note store.
- PiP holds: editor DOM (Lexical), `noteTitles` / `noteBreadcrumbs` / `noteColors` (copies from last `notesUpdate`), and which tab is active.

### Content flow: dashboard is source of truth

1. **Dashboard → PiP: `notesUpdate`**
   - Payload: `notes` (sessionIds), `noteTitles`, `noteBreadcrumbs`, `noteColors`, `layout`, `activeSessionId`.
   - PiP uses this to render tab bar and know active tab. **No note body content** in this message.

2. **PiP → Dashboard: `loadContent`**
   - When PiP needs to show a note (e.g. when it creates an editor in `renderNotes()`), it sends `loadContent(key, sessionId)`.
   - Dashboard reads content from storage, replies with **`contentLoaded(sessionId, value)`**.
   - PiP initializes or updates the editor with that value. So **all displayed content comes from the dashboard**.

3. **PiP → Dashboard: `saveContent`**
   - On editor save (debounced + blur), PiP sends `saveContent(key, value)`.
   - Dashboard updates `notesData`, persists to chrome.storage, and can send **`updateNoteTitles`** back so PiP tab labels stay in sync.

4. **Tab titles in PiP**
   - From `noteTitles` in `notesUpdate` and `updateNoteTitles`. Dashboard is the source of truth for titles.

5. **Tab switch in PiP**
   - Flush current editor (`saveEditorContent` → `saveContent` to dashboard).
   - Switch visible tab. The other tab’s content was **already loaded** when that tab was first shown (via `loadContent` → `contentLoaded`). So no second store; content always came from dashboard.

### Summary (extension)
- **One store:** dashboard.
- **PiP:** request/response for content (`loadContent` / `contentLoaded`), push saves (`saveContent`), receive titles and metadata (`notesUpdate` / `updateNoteTitles`).
- **No duplicate note state in PiP;** only editor DOM and display caches from messages.

---

## App: two stores, PiP keeps local copy

### Where note data lives
- **Main app:** Zustand store (notes) + IndexedDB persist.
- **PiP iframe:** separate document → **second** Zustand store. So two in-memory note stores.

### Content flow: no request/response for content

1. **Main → PiP: `notesUpdate`**
   - Payload: **only** `noteIds` and `activeId`. No `noteTitles`, no content.
   - PiP updates local state (`setNoteIds`, `setActiveTabId`). PiP has no note bodies unless it already stored them locally.

2. **No `loadContent` / `contentLoaded`**
   - App has no equivalent. PiP **never** asks main for “content for noteId X”. Main never sends content to PiP for display.

3. **PiP → Main: `notic-pip-note-update`**
   - PiP sends content patches to main. Main updates **main** store and persist. Main is updated from PiP, but main **never** sends content back into PiP.

4. **How PiP shows content**
   - PiP renders `NoteEditor` with `initialContent={notes[noteId]?.content ?? ''}`. That `notes` is the **PiP** store.
   - So PiP is designed to have note content in its **own** store. With no loadContent, that store is only filled when the user types (we added upsert so the first update creates the note in the PiP store). So we rely on a **second store** that we sync *out* to main, but never populate *from* main.

5. **Tab titles in PiP**
   - From PiP store: `notes[id].title` (derived from content in PiP). So inside PiP, the PiP store is the source of truth for titles; main does not send titles in `notesUpdate`.

6. **Tab switch in PiP**
   - Flush current editor, then switch tab. The other tab’s content is read from **PiP store** (`notes[id]?.content`). If that note was never edited in this session, PiP store had no entry → we added upsert so the first type creates it; we never “load” it from main.

### Summary (app)
- **Two stores:** main app + PiP iframe.
- **No** loadContent/contentLoaded; PiP never requests content from main.
- **notesUpdate** is ids + activeId only (no titles, no content).
- PiP keeps a local copy of note data and syncs *to* main via `notic-pip-note-update`; main never pushes content *to* PiP.

---

## Parity gap (why we have “huge parity”)

| Aspect | Extension | App |
|--------|-----------|-----|
| **Number of stores** | One (dashboard) | Two (main + PiP) |
| **How PiP gets content** | `loadContent` → `contentLoaded` from dashboard | Only from PiP’s own store (no request to main) |
| **notesUpdate payload** | `notes`, `noteTitles`, `noteBreadcrumbs`, `noteColors`, `activeSessionId` | `noteIds`, `activeId` only |
| **Tab titles in PiP** | From dashboard (`notesUpdate` / `updateNoteTitles`) | From PiP store (derived from content) |
| **Save flow** | PiP → `saveContent` → dashboard updates single store + persist | PiP → update PiP store + `notic-pip-note-update` → main updates main store + persist |
| **Tab switch** | Flush; other tab already has content from earlier `contentLoaded` | Flush; other tab reads from PiP store (empty until typed or upserted) |

So: the extension uses **one store** and **postMessage to request/respond with content** so the dashboard is the only source of truth. The app uses **two stores** and **no content request/response**; PiP maintains its own copy and only pushes updates to main, which is why the architectures diverge so much.
