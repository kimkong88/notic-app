/**
 * Shared tab utilities for PiP, EditorModal, and MobileBottomSheet.
 * Extracted from duplicated logic across all three editor components.
 */

import { useNotesStore } from "../store";

// ---------------------------------------------------------------------------
// #13  Auto-delete empty PiP-created notes
// ---------------------------------------------------------------------------

/**
 * Check whether a note is an empty, ephemeral PiP-created note that should
 * be auto-deleted when its tab closes.
 *
 * A note qualifies when:
 *  - `createdFromPip` is `true` (created via the "+" button during this session)
 *  - The content is empty or whitespace-only
 */
export function isEmptyPipNote(
    note: { createdFromPip?: boolean; content?: string } | undefined | null
): boolean {
    if (!note) return false;
    return (
        note.createdFromPip === true &&
        (note.content?.trim() ?? "") === ""
    );
}

/**
 * Delete all empty PiP-created notes from the given list.
 *
 * Call this when closing tabs/editors to clean up ephemeral notes that were
 * created via the "+" button but ended up without meaningful content.
 */
export function cleanupEmptyPipNotes(noteIds: string[]): void {
    const { notes, removeNote } = useNotesStore.getState();
    for (const id of noteIds) {
        if (isEmptyPipNote(notes[id])) {
            removeNote(id);
        }
    }
}

// ---------------------------------------------------------------------------
// #14  Sort tabs — pinned first
// ---------------------------------------------------------------------------

/**
 * Sort note IDs with pinned tabs first, preserving the relative order within
 * each group (pinned and unpinned).
 */
export function sortTabsByPinned(
    noteIds: string[],
    pinnedTabIds: Set<string>
): string[] {
    const pinned = noteIds.filter((id) => pinnedTabIds.has(id));
    const unpinned = noteIds.filter((id) => !pinnedTabIds.has(id));
    return [...pinned, ...unpinned];
}

// ---------------------------------------------------------------------------
// #15  Context-menu viewport clamping
// ---------------------------------------------------------------------------

/**
 * Callback ref that clamps a `position: fixed` context menu so it stays
 * within the viewport.  Pass directly as the `ref` prop on the context-menu
 * container element.
 *
 * @example
 * ```tsx
 * <div className="pip-context-menu show"
 *      style={{ left: x, top: y }}
 *      ref={clampContextMenuPosition}>
 * ```
 */
export function clampContextMenuPosition(el: HTMLElement | null): void {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth)
        el.style.left = `${window.innerWidth - r.width - 10}px`;
    if (r.bottom > window.innerHeight)
        el.style.top = `${window.innerHeight - r.height - 10}px`;
}
