# Sidebar shift multi-select: industry standard and testability

## Industry-standard behavior

Across Windows Explorer, macOS Finder (list view), Gmail, and most list UIs:

1. **Normal click**  
   Select only the clicked item. That item becomes the **anchor** for the next shift+click.

2. **Shift+click**  
   Select the **range** from the anchor to the clicked item (inclusive).  
   - Anchor is the **last clicked item** (whether that click was normal, shift, or ctrl).  
   - After the operation, the anchor is updated to the shift+clicked item (so the next shift+click extends from there).

3. **Ctrl/Cmd+click**  
   **Toggle** the clicked item in the selection (add if not selected, remove if selected).  
   - Anchor is updated to the ctrl+clicked item so the next shift+click extends from it.

4. **First interaction**  
   If there is no prior anchor (e.g. first action in the list), shift+click is treated as “select only this item” (range of length 1).

5. **Range direction**  
   The range is from `min(anchorIndex, clickIndex)` to `max(anchorIndex, clickIndex)` in **list order** (not click order). So shift+click “backwards” still selects the correct contiguous range.

## Our compliance

- We use **last clicked index** as the anchor (`lastClickedIndexRef` / `lastClickedSelectableIndexRef`) and update it on every click (normal, shift, ctrl). This matches the “anchor = last clicked item” behavior.
- Shift+click uses `from = lastClicked >= 0 ? lastClicked : clickIndex`, then `lo = min(from, index)`, `hi = max(from, index)`, and we select `orderedList.slice(lo, hi + 1)`. So range selection and “first interaction” behavior match.
- Ctrl+click toggles the item and we set the anchor to the clicked index, so the next shift+click extends from that item. Compliant.

## Known limitation (dynamic list)

In the **Folders** tab, the ordered list of selectables depends on **expanded state**. If the user:

1. Clicks item at index 5 (anchor = 5),
2. Then expands/collapses a folder so the list order changes,

the stored **index** 5 may now refer to a **different item**. The next shift+click would then select the wrong range.

**Improvement:** Store the anchor by **id** (e.g. `lastClickedSelectableId: { type: 'note'|'folder', id: string } | null`) and, on shift+click, resolve that id to the current index in the ordered list. If the id is no longer in the list (e.g. folder collapsed), fall back to “select only clicked item” or to the clicked index as anchor.

## Testability

The **range logic** is pure: given an ordered list and two indices (anchor, click), the result is deterministic. So we can:

1. **Unit test a pure helper**  
   Extract `getRangeSelection(orderedList, anchorIndex, clickIndex)` (and, for Folders, splitting into `noteIds` / `folderIds`) in a util. Tests cover:
   - No prior anchor (anchorIndex &lt; 0) → single-item range at clickIndex.
   - Forward range (anchor &lt; click) → correct slice.
   - Backward range (anchor &gt; click) → same slice (min/max).
   - Same index → single item.
   - Mixed note/folder list → correct noteIds and folderIds.

2. **Integration / E2E**  
   Optional: drive the UI (click, shift+click, ctrl+click) and assert `selectedNoteIds` / `selectedFolderIds` in the store. Slower but validates the full flow.

Using the pure helper in the Sidebar keeps behavior in one place and ensures all industry-standard cases are covered by unit tests.

## Implementation

- **`src/utils/selectionRange.ts`** exposes:
  - `getRangeIndices(anchorIndex, clickIndex)` — returns `[lo, hi]` (handles anchor &lt; 0).
  - `getRangeSelection(orderedList, anchorIndex, clickIndex)` — returns `{ noteIds, folderIds }` for a mixed list (Folders tab).
  - `getRangeNoteIds(orderedList, anchorIndex, clickIndex)` — returns note ids only (Recent tab).
- **`src/utils/selectionRange.test.ts`** unit-tests:
  - No prior anchor → single-item range.
  - Forward and backward range.
  - Same index; mixed note/folder list; notes-only list.
- **Sidebar** uses these helpers for shift+click in both Recent and Folders tabs so the same logic is covered by the unit tests.
