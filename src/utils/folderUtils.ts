import type { NoteData, Folder } from '../store/types'

/**
 * Depth of a folder (1 = root/top-level, 2 = one level under root, etc.).
 * Matches extension getFolderDepth for data-depth and indentation.
 */
export function getFolderDepth(
  folderId: string,
  folders: Record<string, Folder>
): number {
  let depth = 0
  let currentId: string | null = folderId
  while (currentId) {
    depth++
    const folder: Folder | undefined = folders[currentId]
    currentId = folder?.parentId ?? null
  }
  return depth
}

/** Max folder nesting depth (match notic extension). */
export const MAX_FOLDER_DEPTH = 4

/**
 * True if folderId is the same as ancestorId or is a descendant of ancestorId
 * (i.e. ancestorId is an ancestor of folderId when walking up by parentId).
 * Used to prevent moving a folder into its own descendant (infinite loop).
 */
export function isDescendantOf(
  folderId: string,
  ancestorId: string,
  folders: Record<string, Folder>
): boolean {
  let currentId: string | null = folderId
  while (currentId) {
    if (currentId === ancestorId) return true
    const folder: Folder | undefined = folders[currentId]
    if (!folder) return false
    currentId = folder.parentId
  }
  return false
}

/**
 * True if moving draggedFolderId into targetFolderId is allowed:
 * not self, no cycle, and target depth + 1 <= MAX_FOLDER_DEPTH.
 */
export function canAcceptFolderDrop(
  draggedFolderId: string,
  targetFolderId: string,
  folders: Record<string, Folder>
): boolean {
  if (draggedFolderId === targetFolderId) return false
  if (isDescendantOf(targetFolderId, draggedFolderId, folders)) return false
  const targetDepth = getFolderDepth(targetFolderId, folders)
  return targetDepth + 1 <= MAX_FOLDER_DEPTH
}

/**
 * Returns folder id and all ancestor ids (root-first). Used to expand sidebar path.
 */
export function getFolderAncestorIds(
  folderId: string,
  folders: Record<string, Folder>
): string[] {
  const ids: string[] = []
  let current: string | null = folderId
  while (current) {
    ids.unshift(current)
    const folder: Folder | undefined = folders[current]
    current = folder?.parentId ?? null
  }
  return ids
}

/**
 * Count notes in a folder and all descendant folders (recursive).
 * Excludes soft-deleted notes. Matches extension getFolderNoteCountRecursive.
 */
export function getFolderNoteCountRecursive(
  folderId: string,
  notes: Record<string, NoteData>,
  folders: Record<string, Folder>
): number {
  const direct = Object.values(notes).filter(
    (n) => !n.deletedAt && n.folderId === folderId
  ).length
  const subfolders = Object.values(folders).filter((f) => f.parentId === folderId)
  const childCount = subfolders.reduce(
    (sum, sub) => sum + getFolderNoteCountRecursive(sub.id, notes, folders),
    0
  )
  return direct + childCount
}
