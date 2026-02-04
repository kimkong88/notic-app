import { describe, it, expect } from 'vitest'
import {
  getFolderDepth,
  isDescendantOf,
  canAcceptFolderDrop,
  getFolderAncestorIds,
  getFolderNoteCountRecursive,
  MAX_FOLDER_DEPTH,
} from './folderUtils'
import type { Folder, NoteData } from '../store/types'

function folder(id: string, parentId: string | null, createdAt = 0): Folder {
  return { id, name: id, parentId, createdAt }
}

function note(
  sessionId: string,
  folderId: string | undefined,
  deletedAt?: number
): NoteData {
  return {
    sessionId,
    content: '',
    lastModified: 1,
    createdAt: 0,
    title: 'T',
    wordCount: 0,
    folderId,
    ...(deletedAt !== undefined && { deletedAt }),
  }
}

describe('folderUtils', () => {
  describe('getFolderDepth', () => {
    it('returns 1 for root-level folder (parentId null)', () => {
      const folders: Record<string, Folder> = {
        f1: folder('f1', null),
      }
      expect(getFolderDepth('f1', folders)).toBe(1)
    })

    it('returns 2 for folder with one parent', () => {
      const folders: Record<string, Folder> = {
        root: folder('root', null),
        child: folder('child', 'root'),
      }
      expect(getFolderDepth('child', folders)).toBe(2)
    })

    it('returns 3 for nested folder', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
        c: folder('c', 'b'),
      }
      expect(getFolderDepth('c', folders)).toBe(3)
    })

    it('treats missing folder as single level (depth 1)', () => {
      expect(getFolderDepth('missing', {})).toBe(1)
    })
  })

  describe('getFolderAncestorIds', () => {
    it('returns only folder id when folder has no parent (root-level)', () => {
      const folders: Record<string, Folder> = {
        f1: folder('f1', null),
      }
      expect(getFolderAncestorIds('f1', folders)).toEqual(['f1'])
    })

    it('returns root-first path: [parent, folder] for one level', () => {
      const folders: Record<string, Folder> = {
        root: folder('root', null),
        child: folder('child', 'root'),
      }
      expect(getFolderAncestorIds('child', folders)).toEqual(['root', 'child'])
    })

    it('returns root-first path for deep nesting', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
        c: folder('c', 'b'),
      }
      expect(getFolderAncestorIds('c', folders)).toEqual(['a', 'b', 'c'])
    })

    it('used by sidebar to expand path: ROOT_SENTINEL + ancestors + folderId', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
      }
      const ancestors = getFolderAncestorIds('b', folders)
      const toExpand = ['__root__', ...ancestors]
      expect(toExpand).toEqual(['__root__', 'a', 'b'])
    })
  })

  describe('isDescendantOf', () => {
    it('returns true when folderId equals ancestorId', () => {
      const folders: Record<string, Folder> = { f1: folder('f1', null) }
      expect(isDescendantOf('f1', 'f1', folders)).toBe(true)
    })

    it('returns true when ancestor is parent', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
      }
      expect(isDescendantOf('b', 'a', folders)).toBe(true)
    })

    it('returns true when ancestor is grandparent', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
        c: folder('c', 'b'),
      }
      expect(isDescendantOf('c', 'a', folders)).toBe(true)
    })

    it('returns false when ancestor is not in path', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
        x: folder('x', null),
      }
      expect(isDescendantOf('b', 'x', folders)).toBe(false)
    })
  })

  describe('canAcceptFolderDrop', () => {
    it('returns false when dragging folder onto itself', () => {
      const folders: Record<string, Folder> = { f1: folder('f1', null) }
      expect(canAcceptFolderDrop('f1', 'f1', folders)).toBe(false)
    })

    it('returns false when target is descendant of dragged (would create cycle)', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
      }
      expect(canAcceptFolderDrop('a', 'b', folders)).toBe(false)
    })

    it('returns true when moving child to root', () => {
      const folders: Record<string, Folder> = {
        a: folder('a', null),
        b: folder('b', 'a'),
      }
      expect(canAcceptFolderDrop('b', 'a', folders)).toBe(true)
    })

    it('returns false when dropping into a folder already at MAX_FOLDER_DEPTH', () => {
      const folders: Record<string, Folder> = {}
      const ids = ['root', 'f1', 'f2', 'f3']
      ids.forEach((id, i) => {
        folders[id] = folder(id, i === 0 ? null : ids[i - 1])
      })
      expect(getFolderDepth('f3', folders)).toBe(MAX_FOLDER_DEPTH)
      expect(canAcceptFolderDrop('f2', 'f3', folders)).toBe(false)
      expect(canAcceptFolderDrop('f2', 'f1', folders)).toBe(true)
    })
  })

  describe('getFolderNoteCountRecursive', () => {
    it('returns 0 for empty folder and no children', () => {
      expect(getFolderNoteCountRecursive('f1', {}, { f1: folder('f1', null) })).toBe(0)
    })

    it('counts direct notes only', () => {
      const folders: Record<string, Folder> = { f1: folder('f1', null) }
      const notes: Record<string, NoteData> = {
        n1: note('n1', 'f1'),
        n2: note('n2', 'f1'),
      }
      expect(getFolderNoteCountRecursive('f1', notes, folders)).toBe(2)
    })

    it('excludes soft-deleted notes', () => {
      const folders: Record<string, Folder> = { f1: folder('f1', null) }
      const notes: Record<string, NoteData> = {
        n1: note('n1', 'f1'),
        n2: note('n2', 'f1'),
        n3: note('n3', 'f1', 123),
      }
      expect(getFolderNoteCountRecursive('f1', notes, folders)).toBe(2)
    })

    it('includes notes in subfolders', () => {
      const folders: Record<string, Folder> = {
        root: folder('root', null),
        child: folder('child', 'root'),
      }
      const notes: Record<string, NoteData> = {
        n1: note('n1', 'root'),
        n2: note('n2', 'child'),
      }
      expect(getFolderNoteCountRecursive('root', notes, folders)).toBe(2)
    })
  })
})
