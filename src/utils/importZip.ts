/**
 * Import notes from a ZIP of Markdown files.
 * Only .md files are imported; folder structure recreated (up to MAX_FOLDER_DEPTH).
 * Matches notic extension dashboard-import.ts.
 */

import { unzipSync, strFromU8 } from 'fflate'
import { sanitizeName } from './exportZip'
import { extractTitle } from './noteUtils'
import { DEFAULT_WORKSPACE_ID } from '../store/useWorkspaceStore'
import type { NoteData } from '../store/types'

const MAX_FOLDER_DEPTH = 4

export interface ImportResult {
  notesImported: number
  foldersCreated: number
  skipped: number
}

/** Normalize path: forward slashes, no leading/trailing, split. */
function parsePath(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .split('/')
    .filter(Boolean)
}

export type ImportFromZipDeps = {
  currentWorkspaceId: string | null
  notes: Record<string, NoteData>
  addFolder: (options: {
    name?: string
    parentId?: string | null
    workspaceId?: string | null
  }) => string
  addNote: (options?: {
    workspaceId?: string | null
    folderId?: string | null
  }) => string
  updateNote: (sessionId: string, patch: Partial<NoteData>) => void
}

/**
 * Import notes from a ZIP file. Only .md files are processed.
 * Recreates folder structure and creates notes with content and displayName from filename.
 */
export function importFromZip(zipBytes: Uint8Array, deps: ImportFromZipDeps): ImportResult {
  const wsId = deps.currentWorkspaceId ?? DEFAULT_WORKSPACE_ID
  let notesImported = 0
  let foldersCreated = 0
  let skipped = 0

  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(zipBytes)
  } catch {
    return { notesImported: 0, foldersCreated: 0, skipped: 0 }
  }

  const mdEntries = Object.entries(unzipped).filter(([path]) =>
    path.toLowerCase().endsWith('.md')
  )
  if (mdEntries.length === 0) {
    return { notesImported: 0, foldersCreated: 0, skipped: 0 }
  }

  const folderPathToId = new Map<string, string>()

  function getOrCreateFolderId(segments: string[]): string | null {
    const limited = segments.slice(0, MAX_FOLDER_DEPTH)
    if (limited.length === 0) return null
    const pathKey = limited.join('/')
    const existing = folderPathToId.get(pathKey)
    if (existing) return existing
    const parentId =
      limited.length === 1 ? null : getOrCreateFolderId(limited.slice(0, -1))
    const name = sanitizeName(limited[limited.length - 1])
    const folderId = deps.addFolder({ name, parentId, workspaceId: wsId })
    folderPathToId.set(pathKey, folderId)
    foldersCreated++
    return folderId
  }

  const usedNamesByFolder = new Map<string, Set<string>>()

  function ensureFolderNamesSeeded(folderKey: string, folderId: string | null): void {
    if (usedNamesByFolder.has(folderKey)) return
    const existing = Object.values(deps.notes)
      .filter((n) => (n.folderId ?? null) === folderId)
      .map((n) => n.displayName ?? n.title)
    usedNamesByFolder.set(folderKey, new Set(existing))
  }

  function disambiguateName(folderKey: string, baseName: string): string {
    const set = usedNamesByFolder.get(folderKey)!
    let name = baseName
    let n = 1
    while (set.has(name)) {
      name = n === 1 ? `${baseName} (2)` : `${baseName} (${n + 1})`
      n++
    }
    set.add(name)
    return name
  }

  const sortedPaths = mdEntries
    .map(([path]) => path)
    .sort((a, b) => {
      const segsA = parsePath(a).length
      const segsB = parsePath(b).length
      if (segsA !== segsB) return segsA - segsB
      return a.localeCompare(b)
    })

  for (const path of sortedPaths) {
    const bytes = unzipped[path]
    if (!bytes || bytes.length === 0) continue

    const segments = parsePath(path)
    if (segments.length === 0) {
      skipped++
      continue
    }

    const filename = segments[segments.length - 1]
    const stem = filename.replace(/\.md$/i, '')
    const folderSegments = segments.slice(0, -1)
    const folderKey = folderSegments.slice(0, MAX_FOLDER_DEPTH).join('/')

    let content: string
    try {
      content = strFromU8(bytes)
    } catch {
      skipped++
      continue
    }

    const folderId =
      folderSegments.length > 0 ? getOrCreateFolderId(folderSegments) : null
    ensureFolderNamesSeeded(folderKey, folderId)
    const baseName = sanitizeName(stem) || 'Untitled'
    const displayName = disambiguateName(folderKey, baseName)
    const title = extractTitle(content, displayName)

    const sessionId = deps.addNote({
      workspaceId: wsId,
      folderId: folderId ?? undefined,
    })
    deps.updateNote(sessionId, {
      content,
      title,
      displayName,
      hasEverHadContent: true,
    })

    notesImported++
  }

  return { notesImported, foldersCreated, skipped }
}
