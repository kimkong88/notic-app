/**
 * Pure helpers for shift+click range selection.
 * Industry standard: range from anchor index to click index (inclusive) in list order.
 * See .ai-docs/sidebar-shift-multiselect.md.
 */

export type SelectableItem =
  | { type: 'note'; id: string }
  | { type: 'folder'; id: string }

/**
 * Returns the list indices for a range selection.
 * - If anchorIndex < 0 (no prior anchor), the range is just [clickIndex].
 * - Otherwise range is [min(anchor, click), max(anchor, click)] inclusive.
 */
export function getRangeIndices(anchorIndex: number, clickIndex: number): [number, number] {
  if (anchorIndex < 0) {
    return [clickIndex, clickIndex]
  }
  const lo = Math.min(anchorIndex, clickIndex)
  const hi = Math.max(anchorIndex, clickIndex)
  return [lo, hi]
}

/**
 * Returns the selected note and folder ids for a range in an ordered list of selectables.
 * Used by both Recent tab (notes only) and Folders tab (notes + folders).
 */
export function getRangeSelection(
  orderedList: SelectableItem[],
  anchorIndex: number,
  clickIndex: number
): { noteIds: string[]; folderIds: string[] } {
  const [lo, hi] = getRangeIndices(anchorIndex, clickIndex)
  const slice = orderedList.slice(lo, hi + 1)
  const noteIds = slice.filter((i): i is { type: 'note'; id: string } => i.type === 'note').map((i) => i.id)
  const folderIds = slice.filter((i): i is { type: 'folder'; id: string } => i.type === 'folder').map((i) => i.id)
  return { noteIds, folderIds }
}

/**
 * For lists that are notes-only (e.g. Recent tab), returns the note ids in the range.
 */
export function getRangeNoteIds(
  orderedList: Array<{ type: 'note'; id: string }>,
  anchorIndex: number,
  clickIndex: number
): string[] {
  const [lo, hi] = getRangeIndices(anchorIndex, clickIndex)
  return orderedList.slice(lo, hi + 1).map((i) => i.id)
}
