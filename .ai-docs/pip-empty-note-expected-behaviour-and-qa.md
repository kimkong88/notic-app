# PiP empty-note behaviour (match extension) – expected behaviour & QA

## Rule (same as extension)

**If a note was created from PiP (“new tab”) and the user never wrote any content, it must not be stored in the sidebar or DB.** Closing the tab or the PiP window should remove it.

---

## Expected behaviour (app = extension)

| Scenario | Expected result |
|----------|-----------------|
| **1. PiP new tab → close tab without typing** | Note is **removed**. It does **not** appear in the sidebar and is not persisted. |
| **2. PiP new tab → type something → close tab** | Note **stays**. It appears in the sidebar and is persisted with the content. |
| **3. PiP new tab → close PiP window without typing** | Note is **removed**. It does **not** appear in the sidebar and is not persisted. |
| **4. PiP new tab → type something → close PiP window** | Note **stays**. It appears in the sidebar and is persisted. |
| **5. Sidebar: create new note (empty) → open in PiP → close tab without typing** | Note **stays** (it was created from sidebar). It remains in the sidebar as an empty note. |
| **6. Sidebar: create new note → open in PiP → type → close tab** | Note **stays** with the content. |

Summary:

- **Created in PiP + never had content** → remove on close (tab or window).
- **Created in PiP + had content** → keep.
- **Created in sidebar** → never remove just because it’s closed in PiP (even if still empty).

---

## How the app implements it (parity with extension)

- **PiP “Add note”** creates a note with `createdFromPip: true` (extension uses `hasEverHadContent: false` for the same idea).
- **Close tab:** PiP sends `notic-pip-close-tab` with `noteId` and `isEmpty`. Main app removes the note from PiP state; if `isEmpty` and note has `createdFromPip === true` and `hasEverHadContent !== true`, it **deletes** the note from the store (and it won’t be persisted).
- **Close PiP window:** Document PiP `onClose` runs. For each note that was in PiP, if `createdFromPip === true` and `hasEverHadContent !== true`, the app **deletes** that note, then clears PiP state. (Extension gets the same effect when PiP sends `closeNotes` on window `beforeunload`.)
- **Typing in PiP** sets `hasEverHadContent: true` for that note, so it is never treated as “empty PiP-created” and is kept.

---

## QA steps (lock it in)

Do these in the **app** and confirm the expected results.

### QA 1 – PiP new tab, close tab, no content

1. Open PiP (e.g. “Open Notes” or open an existing note in PiP).
2. In PiP, click **Add note** (new tab).
3. Do **not** type anything.
4. Close that tab (X on the tab).
5. **Expected:** The new note does **not** appear in the sidebar. No “Untitled” or empty note left behind.

### QA 2 – PiP new tab, type, close tab

1. Open PiP, click **Add note**.
2. Type some text (e.g. “test”).
3. Close that tab.
4. **Expected:** A note appears in the sidebar with content “test”.

### QA 3 – PiP new tab, close window, no content

1. Open PiP, click **Add note**.
2. Do **not** type anything.
3. Close the **PiP window** (not just the tab).
4. **Expected:** The new note does **not** appear in the sidebar.

### QA 4 – PiP new tab, type, close window

1. Open PiP, click **Add note**.
2. Type some text.
3. Close the PiP window.
4. **Expected:** A note appears in the sidebar with that content.

### QA 5 – Sidebar new note, open in PiP, close tab empty

1. In the **sidebar**, create a new note (e.g. “New Note” or equivalent). Leave it empty.
2. Open that note in PiP (e.g. “Open” or PiP icon).
3. In PiP, do **not** type anything.
4. Close that tab in PiP.
5. **Expected:** The note **remains** in the sidebar (empty). It was created from the sidebar, so we do not delete it.

### QA 6 – Sidebar note, open in PiP, type, close tab

1. Create or pick a note in the sidebar, open it in PiP.
2. Type in PiP.
3. Close the tab (or window).
4. **Expected:** The note stays in the sidebar with the updated content.

---

## Sign-off

Once all QA steps match the expected results above, behaviour is **locked in** and matches the extension.

- [ ] QA 1 – PiP new tab, close tab, no content → note not in sidebar  
- [ ] QA 2 – PiP new tab, type, close tab → note in sidebar with content  
- [ ] QA 3 – PiP new tab, close window, no content → note not in sidebar  
- [ ] QA 4 – PiP new tab, type, close window → note in sidebar with content  
- [ ] QA 5 – Sidebar new note, open in PiP, close tab empty → note stays in sidebar  
- [ ] QA 6 – Sidebar note, open in PiP, type, close → note in sidebar with content  
