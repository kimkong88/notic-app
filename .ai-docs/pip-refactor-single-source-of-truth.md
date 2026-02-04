# PiP refactor: single source of truth (main app)

Goal: main app is the **only** store for note data. PiP is a thin client that requests content from main and pushes saves to main. Dashboard content updates reflect in the PiP editor, and PiP edits reflect in the dashboard.

---

## Step 1 – Main app sends titles (and colors) in `notesUpdate` ✅ implemented

### What was done
- Main app now includes `noteTitles` and `noteColors` (from main store) in every `notesUpdate` sent to PiP.
- PiP stores these in `noteTitlesFromMain` / `noteColorsFromMain` and uses them for the tab bar (with fallback to local store when absent).

### Manual QA for Step 1

1. **Open PiP with a note that has a custom title**
   - In the main app sidebar, create or select a note and set its title (e.g. type a first line or use rename so the sidebar shows e.g. "My note").
   - Open that note in PiP (Document PiP or embedded panel).
   - **Expect:** The PiP tab shows the **same title** as in the sidebar (e.g. "My note"), not "Untitled".

2. **Multiple tabs – titles from main**
   - Open two notes in PiP (e.g. Note A and Note B, with different titles in the sidebar).
   - **Expect:** Each PiP tab label matches the sidebar title for that note.

3. **Rename in main, then open PiP (or refresh PiP list)**
   - In the main app, rename a note (e.g. change title in sidebar).
   - Open PiP with that note (or if PiP is already open with that note, trigger a notesUpdate e.g. by switching tab in main or adding a note to PiP).
   - **Expect:** The PiP tab shows the **new** title from the main app.

4. **Tab color from main (if you have notes with color)**
   - In the main app, set a color on a note (if the UI supports it).
   - Open that note in PiP.
   - **Expect:** The PiP tab shows the same color indicator as in the main app.

**Pass criteria:** PiP tab bar titles (and colors) always match the main app sidebar for the same notes; no "Untitled" when the main app has a real title.

---

## 2. Main app: handle `loadContent` and send `contentLoaded`

**Where:** Layout (or a dedicated pip message module) message handler.

**New message from PiP:** e.g. `notic-pip-load-content` with `{ sessionId: string }`.

**Main app behavior:**

- When receiving `notic-pip-load-content` (from PiP window / same-origin):
  - Read content from the **main** store: `content = useNotesStore.getState().notes[sessionId]?.content ?? ''`
  - If you ever need content that might only be in IndexedDB (e.g. note not in memory), add a small path to load from DB; for now store is enough.
  - Send to PiP: `contentLoaded(sessionId, value)` with `value = content` (string) or `null` if note missing.

**PiP window forwarding:** In `documentPip.ts`, the script that runs in the PiP document must forward **from opener to iframe**:

- `notesUpdate` (already)
- `flushSave` (already)
- **`contentLoaded`** — so when main sends `contentLoaded`, the PiP window forwards it to the iframe.

**Effect:** PiP can ask main “give me content for this note” and main responds; PiP does not need to hold that content in its own store.

---

## 3. PiP: content cache + request content from main

**Where:** `PipView.tsx`.

**Concept:** PiP does **not** use `useNotesStore` for note content. It keeps a **display-only cache** filled only by:

1. **`contentLoaded(sessionId, value)`** — main sent content; cache[sessionId] = value.
2. **Current editor** — on change and on flush, write current markdown into cache for the *current* note so that after tab switch we don’t lose it before the next load; and when we switch back we can show it until/if we get a fresh contentLoaded.

**State in PipView:**

- `contentCache: Record<string, string>` (useState or useRef). Key = sessionId, value = markdown string.
- `noteTitles: Record<string, string>` (useState). Key = sessionId, value = display title. Updated only from `notesUpdate` (and later `updateNoteTitles`).

**When PiP needs content for a note:**

- When the **active tab** is set (or when noteIds/activeId change): if we don’t have `contentCache[activeId]` (or we want to refresh from main), send **`notic-pip-load-content`** with that `sessionId`.
- When we receive **`contentLoaded(sessionId, value)`**, set `contentCache[sessionId] = value ?? ''` and force the active editor to use it (e.g. set key so NoteEditor remounts with new initialContent, or expose an “setContent” if the editor supports it).

**Tab bar:** Render tab label from `noteTitles[id] ?? 'Untitled'`. No longer from `notes[id].title` in a local store.

**Active editor:** `initialContent={contentCache[effectiveActiveId] ?? ''}`. When contentLoaded arrives for that id, update contentCache and either remount the editor (key = `${effectiveActiveId}-${contentVersion}` or similar) or update in place if the editor API allows.

**Effect:** PiP only shows content that came from main (contentLoaded) or from the current session’s edits (cache updated on type/flush). Single source of truth is main.

---

## 4. PiP: stop writing to a local notes store

**Where:** `PipView.tsx` (and any PiP-only usage of `useNotesStore` for notes).

**Change:**

- **Do not** call `updateNote(noteId, patch)` in the PiP for note content. PiP’s store is not the source of truth; main is.
- **Do** on content change (debounced): send **`notic-pip-note-update`** to main with `{ noteId, patch: { content } }`. Main will update its store and persist.
- Optionally: update **only** `contentCache[noteId]** in PiP on each change so the current tab’s content is correct when we switch away (then flush sends that to main). So the “cache” is updated from the editor for the active note only; we never call `updateNote` in PiP for that.

**Effect:** No duplicate store update in PiP; all writes go to main via postMessage.

---

## 5. Main app: optional `updateNoteTitles` after save

**Where:** Layout handler for `notic-pip-note-update`.

**Change:** After updating the main store (and optionally after persist), main can send to PiP: `updateNoteTitles({ [noteId]: newTitle })` so the PiP tab bar updates without PiP deriving title. New title = `extractTitle(content, existing.title)` or from the updated note in the store.

**PiP:** Handle `updateNoteTitles` in the message listener: merge into `noteTitles` state so tab labels stay in sync when user types.

**Effect:** Dashboard content (including title) stays in sync with PiP; PiP tab bar reflects main’s idea of the title.

---

## 6. PiP window script: forward `contentLoaded` and `notic-pip-load-content`

**Where:** `documentPip.ts`, `getPipIframeCloseScript()`.

**Change:**

- **Opener → iframe:** In addition to `notesUpdate` and `flushSave`, forward messages with `d.type === 'contentLoaded'` (and optionally `d.type === 'updateNoteTitles'`) to the iframe.
- **Iframe → opener:** PiP will send `notic-pip-load-content` (type already matches `notic-pip-*` so it’s forwarded to opener). Main must handle this and reply with `contentLoaded` to the PiP window; the script then needs to forward `contentLoaded` to the iframe as above.

**Effect:** loadContent request and contentLoaded response work across the PiP window boundary.

---

## 7. Revert or narrow store upsert (optional)

**Where:** `useNotesStore.ts`, `updateNote`.

**Change:** The “create note if not existing” (upsert) was added so PiP could fill its local store when the user typed. Once PiP no longer relies on a local store for content, we can revert that upsert so only the main app creates notes (and PiP only requests content for existing note ids). Optional: keep upsert only for main-app call paths if useful elsewhere.

---

## Flow summary after refactor

| Direction   | Message / trigger              | Effect |
|------------|--------------------------------|--------|
| Main → PiP | `notesUpdate` (ids, activeId, **noteTitles** [, noteColors]) | PiP updates tab list, active tab, and tab labels from main. |
| Main → PiP | `contentLoaded(sessionId, value)`                          | PiP puts value in contentCache and shows it in the editor. |
| Main → PiP | `updateNoteTitles(record)` (optional)                      | PiP merges into noteTitles so tab bar matches main after save. |
| PiP → Main | `notic-pip-load-content(sessionId)`                        | Main replies with contentLoaded(sessionId, content from store). |
| PiP → Main | `notic-pip-note-update(noteId, patch)`                     | Main updates its store (and persist); optionally sends updateNoteTitles. |

**Dashboard content updated** (e.g. user edited in main): main store changes. When PiP next requests that note via loadContent (e.g. on tab switch or when opening that tab), main sends contentLoaded with the new content → **reflected in PiP editor**.

**PiP editor updated:** PiP sends notic-pip-note-update → main updates store → **reflected in dashboard** (sidebar, etc.). Optionally main sends updateNoteTitles so PiP tab bar reflects the new title.

Single source of truth: main app store. PiP only holds a display cache and request/response for content.
