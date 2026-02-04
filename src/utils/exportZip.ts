/**
 * Export workspace as ZIP: each note as .md file under folder paths.
 * Matches notic extension dashboard-export.ts (structure, disambiguation).
 */

import { zipSync, strToU8 } from 'fflate'
import type { NoteData, Folder } from '../store/types'
import { DEFAULT_WORKSPACE_ID } from '../store/useWorkspaceStore'

/** Sanitize for use as path segment or filename: remove / \ : * ? " < > | and trim. */
export function sanitizeName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled'
}

/** Build folder path segments (root to leaf) with disambiguation for same-name siblings. */
function buildFolderPathMap(
  wsId: string,
  folders: Record<string, Folder>
): Map<string, string[]> {
  const folderPath = new Map<string, string[]>()
  const wsFolders = Object.values(folders).filter(
    (f) => (f.workspaceId ?? DEFAULT_WORKSPACE_ID) === wsId
  )

  function getSegmentsForFolder(folderId: string): string[] {
    const cached = folderPath.get(folderId)
    if (cached) return cached

    const folder = folders[folderId]
    if (!folder) return []

    const parentSegments = folder.parentId
      ? getSegmentsForFolder(folder.parentId)
      : []
    const name = sanitizeName(folder.displayName ?? folder.name)

    const siblings = wsFolders.filter((f) => f.parentId === folder.parentId)
    const sameNameSiblings = siblings.filter(
      (f) => sanitizeName(f.displayName ?? f.name) === name
    )
    const indexOfThis = sameNameSiblings
      .map((f) => f.id)
      .sort()
      .indexOf(folderId)
    const segment =
      indexOfThis === 0 ? name : `${name} (${indexOfThis + 1})`

    const segments = [...parentSegments, segment]
    folderPath.set(folderId, segments)
    return segments
  }

  wsFolders.forEach((f) => getSegmentsForFolder(f.id))
  return folderPath
}

/**
 * Export current workspace to a ZIP: each note as path/filename.md.
 * Folder structure preserved; duplicate names disambiguated.
 */
export function exportWorkspaceAsZip(
  notes: Record<string, NoteData>,
  folders: Record<string, Folder>,
  currentWorkspaceId: string | null
): Blob {
  const wsId = currentWorkspaceId ?? DEFAULT_WORKSPACE_ID
  const folderPathMap = buildFolderPathMap(wsId, folders)

  const wsNotes = Object.values(notes).filter(
    (n) => (n.workspaceId ?? DEFAULT_WORKSPACE_ID) === wsId && n.deletedAt == null
  )

  const files: Record<string, Uint8Array> = {}
  const usedPaths = new Set<string>()

  for (const note of wsNotes) {
    const pathSegments = note.folderId
      ? folderPathMap.get(note.folderId) ?? []
      : []
    const baseName = sanitizeName(note.displayName ?? note.title)
    let fileName = `${baseName}.md`
    let fullPath =
      pathSegments.length > 0
        ? [...pathSegments, fileName].join('/')
        : fileName

    let n = 1
    while (usedPaths.has(fullPath)) {
      const stem = baseName
      fileName = `${stem} (${++n}).md`
      fullPath =
        pathSegments.length > 0
          ? [...pathSegments, fileName].join('/')
          : fileName
    }
    usedPaths.add(fullPath)

    files[fullPath] = strToU8(note.content)
  }

  const zipBytes = zipSync(files, { level: 6 })
  return new Blob([zipBytes as BlobPart], { type: 'application/zip' })
}

/**
 * Build a ZIP blob from Obsidian export files (path -> content). Used for "Export to Obsidian" download in web app.
 */
export function obsidianFilesToZipBlob(
  files: Array<{ path: string; content: string }>
): Blob {
  const entries: Record<string, Uint8Array> = {}
  for (const { path: p, content } of files) {
    const path = p.replace(/^\/+/, '').replace(/\/+/g, '/')
    if (path) entries[path] = strToU8(content)
  }
  const zipBytes = zipSync(entries, { level: 6 })
  return new Blob([zipBytes as BlobPart], { type: 'application/zip' })
}

/** Trigger download of the exported ZIP or any blob. */
export function downloadExportBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Export a single note as a Markdown blob (for download).
 * Caller should use downloadExportBlob(blob, `${sanitizeName(note.displayName ?? note.title)}.md`).
 */
export function exportNoteAsMarkdownBlob(note: NoteData): Blob {
  return new Blob([note.content], { type: 'text/markdown' })
}

/** Collect folder id and all descendant folder ids in the same workspace. */
function getFolderAndDescendantIds(
  folderId: string,
  wsId: string,
  folders: Record<string, Folder>
): Set<string> {
  const out = new Set<string>()
  const wsFolders = Object.values(folders).filter(
    (f) => (f.workspaceId ?? DEFAULT_WORKSPACE_ID) === wsId
  )
  function add(id: string): void {
    if (out.has(id)) return
    out.add(id)
    wsFolders.filter((f) => f.parentId === id).forEach((f) => add(f.id))
  }
  add(folderId)
  return out
}

/**
 * Export a folder (and its descendants) as a ZIP: same structure as workspace export,
 * rooted at the folder name. Excludes soft-deleted notes.
 */
export function exportFolderAsZip(
  folderId: string,
  notes: Record<string, NoteData>,
  folders: Record<string, Folder>,
  currentWorkspaceId: string | null
): Blob {
  const wsId = currentWorkspaceId ?? DEFAULT_WORKSPACE_ID
  const folder = folders[folderId]
  if (!folder) return new Blob([], { type: 'application/zip' })

  const folderAndDescendantIds = getFolderAndDescendantIds(folderId, wsId, folders)
  const folderPathMap = buildFolderPathMap(wsId, folders)
  const rootSegments = folderPathMap.get(folderId) ?? []
  const rootName = sanitizeName(folder.displayName ?? folder.name)

  const wsNotes = Object.values(notes).filter(
    (n) =>
      (n.workspaceId ?? DEFAULT_WORKSPACE_ID) === wsId &&
      n.deletedAt == null &&
      n.folderId != null &&
      folderAndDescendantIds.has(n.folderId)
  )

  const files: Record<string, Uint8Array> = {}
  const usedPaths = new Set<string>()

  for (const note of wsNotes) {
    const pathSegments = note.folderId ? folderPathMap.get(note.folderId) ?? [] : []
    const relativeSegments =
      pathSegments.length >= rootSegments.length
        ? pathSegments.slice(rootSegments.length)
        : []
    const baseName = sanitizeName(note.displayName ?? note.title)
    let fileName = `${baseName}.md`
    const pathParts = relativeSegments.length > 0 ? [...relativeSegments, fileName] : [fileName]
    let fullPath = [rootName, ...pathParts].join('/')

    let n = 1
    while (usedPaths.has(fullPath)) {
      fileName = `${baseName} (${++n}).md`
      const pathParts = relativeSegments.length > 0 ? [...relativeSegments, fileName] : [fileName]
      fullPath = [rootName, ...pathParts].join('/')
    }
    usedPaths.add(fullPath)
    files[fullPath] = strToU8(note.content)
  }

  const zipBytes = zipSync(files, { level: 6 })
  return new Blob([zipBytes as BlobPart], { type: 'application/zip' })
}
