# Notic extension PiP & editor vs notic-app

Evaluation of features in the notic Chrome extension (PiP + editor) and gaps in the notic-app SPA. Use this to prioritise missing parts.

## 1. Editor (content layer)

### Notic extension (`notic/src/editor.ts`)

- **Lexical** with **markdown in/out**: content is stored and synced as **markdown**; the editor parses it into Lexical nodes and serialises back on save.
- **Nodes**: `HeadingNode`, `QuoteNode`, `ListNode`, `ListItemNode`, `CodeNode`, `CodeHighlightNode`, `LinkNode`, `HorizontalRuleNode`, `TableNode`, `TableRowNode`, `TableCellNode`, custom `ImageNode` (DecoratorNode).
- **Markdown**: `@lexical/markdown` — `$convertFromMarkdownString` / `$convertToMarkdownString`, `registerMarkdownShortcuts`. Transformers: HEADING, QUOTE, CHECK_LIST, UNORDERED_LIST, ORDERED_LIST, CODE, HORIZONTAL_RULE (custom), TABLE (custom), IMAGE (custom), plus text format (bold/italic) and LINK.
- **Behaviour**: headings, blockquote, task lists (`- [ ]` / `- [x]`), bullet/numbered lists, code blocks, links, horizontal rule, tables, images; bold/italic in table cells; slash command (optional); char limit (50k) with warning at 40k; image paste/drop and “upload from computer”; PiP image upload via `uploadImageRequest` → dashboard → `uploadImageResult`.

### Notic-app (`notic-app` before this pass)

- **Lexical** with **plain text only**: `PlainTextPlugin`, paragraph + text nodes; initial content = split by `\n` into lines; `onChange` = `getTextContent()` (no markdown).
- **Missing**: headings, lists, task lists, quote, code, links, tables, images, horizontal rule, markdown shortcuts, markdown serialisation, char limit warning, image upload.

**Conclusion:** Editor must use Lexical **markdown** (parse on load, serialise on change) and the same node set + shortcuts as notic so the app “displays markdown in the editor” like the extension.

---

## 2. PiP (floating window / iframe)

### Notic extension PiP (`notic/src/pip.ts` + `dashboard-pip.ts`)

| Feature | Description |
|--------|-------------|
| Empty state | “No notes open” + “Add Note” button |
| Tabs | One per note; label = title/displayName; close button; “new tab” button |
| Tab order | Pinned tabs first, then unpinned (pin via context menu) |
| Tab context menu | Pin / Unpin, Rename, Change color (submenu), Close, Close others, Close after, Close all |
| Rename | Modal: input + Cancel / Rename → `renameNote` postMessage |
| Tab limit (free) | 1 tab; modal “1 tab on free plan” with Upgrade link |
| Active tab switch | Flush save for *previous* tab before switching (`saveEditorContent(prevEditor.editorRoot)`) |
| contentLoaded | Init editor with markdown or update existing editor content |
| saveContent / loadContent | Key = `notic_session_${sessionId}`, value = markdown; postMessage to/from dashboard |
| Char limit warning | Below editor when length ≥ 40k: “Approaching note limit (40,000 / 50,000 characters)” |
| Note theme | default / sepia / dark / high-contrast (`data-note-theme`); app dark mode |
| Image upload in PiP | PiP sends `uploadImageRequest`; dashboard uploads and replies `uploadImageResult` (url/sessionId) |
| beforeunload / pagehide | Flush all editors, `closeNotesAndNotify(items)` |
| updateNoteTitles | Update tab labels only (no full re-render) to preserve scroll |
| focusNote | Switch to that tab |
| flushSave | Dashboard asks PiP to save current tab |
| Tab color | Dot from note color on tab |
| Tab separator | Visual sep between non-active tabs |

### Notic-app PiP (`PipView.tsx` + SPA store)

| Feature | Status |
|--------|--------|
| Empty state + Add Note | ✅ |
| Tabs (title, close, new tab) | ✅ |
| Tab context menu (pin, rename, color, close others/after/all) | ✅ |
| Rename modal | ✅ |
| Tab limit modal (free) | ✅ |
| Flush save on tab switch | ✅ (flush on unmount) |
| Char limit warning in PiP | ✅ |
| Note theme (sepia/dark/high-contrast) | ✅ (context menu submenu + localStorage) |
| Image upload from PiP | ✅ (SPA: same origin, direct API upload when token in localStorage) |
| beforeunload flush | ✅ |
| flushSave message | N/A (SPA single window; no separate PiP window message) |
| Pinned tabs + order | ✅ |
| Tab color dot | ✅ |
| Tab separator | ✅ |

**Conclusion:** PiP has flush save, context menu, modals, char warning, pinned order, tab color/separator, image upload (when signed in), note theme (default/sepia/dark/high-contrast via context menu + localStorage).

---

## 4. Missing from current SPA PiP (summary)

| Area | Missing |
|------|--------|
| **Editor** | Tables (TableNode + TABLE markdown); image paste/drop (paste/drop → upload → insert). |
| **PiP** | Note theme (`data-note-theme`: sepia / dark / high-contrast) – optional. |
| **Document PiP** | Real Document Picture-in-Picture window when supported; fallback modal when not (e.g. Cursor browser). |
| **Other** | Sidebar collapse; “Add new note” from PiP creating note in store; sign-in copy/icon; modal design match. |

---

## 5. Order of work (reference)

1. **Editor:** Lexical markdown, ImageNode, horizontal rule, slash strip, char limit, image upload – done. Remaining: tables, image paste/drop.
2. **PiP:** Flush save, context menu, modals, char warning, pin/color/separator, image upload, note theme – done.
3. **Document PiP / UX:** Real PiP window, sidebar collapse, sign-in, modal design, etc. as needed.
4. **Recent tab:** Bookmarks row, empty state (Bookmarks(0) + “No notes yet”), initial expand first date folder, shift/ctrl multi-select, context menu on note (Add/Remove bookmark, Rename), context menu on empty area (New note) – done.

This doc is in `.ai-docs` at project root.
