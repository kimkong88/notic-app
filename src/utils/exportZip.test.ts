import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import {
  sanitizeName,
  exportWorkspaceAsZip,
  exportNoteAsMarkdownBlob,
  exportFolderAsZip,
  downloadExportBlob,
} from './exportZip'
import type { NoteData, Folder } from '../store/types'

describe('exportZip', () => {
  describe('sanitizeName', () => {
    it('removes path-unsafe characters', () => {
      expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    })
    it('collapses spaces and trims', () => {
      expect(sanitizeName('  foo   bar  ')).toBe('foo bar')
    })
    it('returns Untitled for empty after trim', () => {
      expect(sanitizeName('')).toBe('Untitled')
      expect(sanitizeName('   ')).toBe('Untitled')
      expect(sanitizeName('/\\:*?"<>|')).toBe('Untitled')
    })
    it('keeps normal names unchanged', () => {
      expect(sanitizeName('My Note')).toBe('My Note')
      expect(sanitizeName('Folder-1')).toBe('Folder-1')
    })
  })

  describe('exportNoteAsMarkdownBlob', () => {
    it('returns a Blob with note content and text/markdown type', async () => {
      const note: NoteData = {
        sessionId: 's1',
        content: '# Hello\n\nWorld.',
        title: 'Hello',
        lastModified: 1,
        createdAt: 1,
        wordCount: 2,
        folderId: undefined,
      }
      const blob = exportNoteAsMarkdownBlob(note)
      expect(blob.type).toBe('text/markdown')
      expect(blob.size).toBe(note.content.length)
      const text = await blob.text()
      expect(text).toBe(note.content)
    })
  })

  describe('exportWorkspaceAsZip', () => {
    const wsId = 'workspace_1'
    it('returns a ZIP blob containing notes as .md files', async () => {
      const notes: Record<string, NoteData> = {
        n1: {
          sessionId: 'n1',
          content: 'content 1',
          title: 'Note1',
          lastModified: 1,
          createdAt: 1,
          wordCount: 1,
          folderId: undefined,
          workspaceId: wsId,
        },
        n2: {
          sessionId: 'n2',
          content: 'content 2',
          title: 'Note2',
          lastModified: 2,
          createdAt: 2,
          wordCount: 1,
          folderId: 'f1',
          workspaceId: wsId,
        },
      }
      const folders: Record<string, Folder> = {
        f1: {
          id: 'f1',
          name: 'FolderA',
          parentId: null,
          createdAt: 1,
          workspaceId: wsId,
        },
      }
      const blob = exportWorkspaceAsZip(notes, folders, wsId)
      expect(blob.type).toBe('application/zip')
      const buf = await blob.arrayBuffer()
      const entries = unzipSync(new Uint8Array(buf))
      const keys = Object.keys(entries).sort()
      expect(keys).toEqual(['FolderA/Note2.md', 'Note1.md'])
      expect(strFromU8(entries['Note1.md'])).toBe('content 1')
      expect(strFromU8(entries['FolderA/Note2.md'])).toBe('content 2')
    })

    it('excludes deleted notes', async () => {
      const notes: Record<string, NoteData> = {
        n1: {
          sessionId: 'n1',
          content: 'ok',
          title: 'OK',
          lastModified: 1,
          createdAt: 1,
          wordCount: 1,
          folderId: undefined,
          workspaceId: wsId,
          deletedAt: 123,
        },
      }
      const blob = exportWorkspaceAsZip(notes, {}, wsId)
      const buf = await blob.arrayBuffer()
      const entries = unzipSync(new Uint8Array(buf))
      expect(Object.keys(entries)).toHaveLength(0)
    })

    it('excludes notes from other workspace', async () => {
      const notes: Record<string, NoteData> = {
        n1: {
          sessionId: 'n1',
          content: 'other',
          title: 'Other',
          lastModified: 1,
          createdAt: 1,
          wordCount: 1,
          folderId: undefined,
          workspaceId: 'other_ws',
        },
      }
      const blob = exportWorkspaceAsZip(notes, {}, wsId)
      const buf = await blob.arrayBuffer()
      const entries = unzipSync(new Uint8Array(buf))
      expect(Object.keys(entries)).toHaveLength(0)
    })
  })

  describe('exportFolderAsZip', () => {
    const wsId = 'workspace_1'
    it('returns ZIP with folder and descendant notes only', async () => {
      const folders: Record<string, Folder> = {
        f1: {
          id: 'f1',
          name: 'Parent',
          parentId: null,
          createdAt: 1,
          workspaceId: wsId,
        },
        f2: {
          id: 'f2',
          name: 'Child',
          parentId: 'f1',
          createdAt: 2,
          workspaceId: wsId,
        },
      }
      const notes: Record<string, NoteData> = {
        n1: {
          sessionId: 'n1',
          content: 'in parent',
          title: 'InParent',
          lastModified: 1,
          createdAt: 1,
          wordCount: 1,
          folderId: 'f1',
          workspaceId: wsId,
        },
        n2: {
          sessionId: 'n2',
          content: 'in child',
          title: 'InChild',
          lastModified: 2,
          createdAt: 2,
          wordCount: 1,
          folderId: 'f2',
          workspaceId: wsId,
        },
        n3: {
          sessionId: 'n3',
          content: 'root',
          title: 'Root',
          lastModified: 3,
          createdAt: 3,
          wordCount: 1,
          folderId: undefined,
          workspaceId: wsId,
        },
      }
      const blob = exportFolderAsZip('f1', notes, folders, wsId)
      expect(blob.type).toBe('application/zip')
      const buf = await blob.arrayBuffer()
      const entries = unzipSync(new Uint8Array(buf))
      expect(Object.keys(entries).sort()).toEqual(['Parent/Child/InChild.md', 'Parent/InParent.md'])
      expect(strFromU8(entries['Parent/InParent.md'])).toBe('in parent')
      expect(strFromU8(entries['Parent/Child/InChild.md'])).toBe('in child')
    })

    it('returns empty ZIP for missing folder', () => {
      const blob = exportFolderAsZip('missing', {}, {}, wsId)
      expect(blob.type).toBe('application/zip')
      expect(blob.size).toBeLessThan(100)
    })

    it('returns ZIP with only root folder name when folder has no notes', async () => {
      const folders: Record<string, Folder> = {
        f1: { id: 'f1', name: 'EmptyFolder', parentId: null, createdAt: 1, workspaceId: wsId },
      }
      const blob = exportFolderAsZip('f1', {}, folders, wsId)
      const buf = await blob.arrayBuffer()
      const entries = unzipSync(new Uint8Array(buf))
      expect(Object.keys(entries)).toHaveLength(0)
    })
  })

  describe('downloadExportBlob', () => {
    it('is defined (DOM download not testable in Node)', () => {
      expect(typeof downloadExportBlob).toBe('function')
    })
  })
})
