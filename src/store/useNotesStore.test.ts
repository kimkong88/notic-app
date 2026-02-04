import { describe, it, expect, beforeEach } from 'vitest'
import { useNotesStore } from './useNotesStore'

function resetNotesStore(): void {
  useNotesStore.setState({
    notes: {},
    folders: {},
    currentTab: 'recent',
    selectedNoteId: null,
    selectedSidebarContext: null,
    searchQuery: '',
    previousSidebarContext: null,
    previousNoteId: null,
    sort: 'modified-desc',
    selectedNoteIds: [],
    selectedFolderIds: [],
    expandedSidebarFolderIds: [],
    expandedMainFolderIds: [],
  })
}

describe('useNotesStore', () => {
  beforeEach(resetNotesStore)

  describe('toggleFolderExpanded', () => {
    it('adds folder to expandedSidebarFolderIds when inSidebar is true', () => {
      useNotesStore.getState().toggleFolderExpanded('f1', true)
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual(['f1'])
      useNotesStore.getState().toggleFolderExpanded('f2', true)
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual(['f1', 'f2'])
    })

    it('removes folder from expandedSidebarFolderIds on second toggle', () => {
      useNotesStore.getState().toggleFolderExpanded('f1', true)
      useNotesStore.getState().toggleFolderExpanded('f1', true)
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual([])
    })

    it('tracks main folder expansion separately from sidebar', () => {
      useNotesStore.getState().toggleFolderExpanded('f1', true)
      useNotesStore.getState().toggleFolderExpanded('f1', false)
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual(['f1'])
      expect(useNotesStore.getState().expandedMainFolderIds).toEqual(['f1'])
    })
  })

  describe('setSelection / clearSelection', () => {
    it('setSelection sets selected note and folder ids', () => {
      useNotesStore.getState().setSelection(['n1', 'n2'], ['f1'])
      expect(useNotesStore.getState().selectedNoteIds).toEqual(['n1', 'n2'])
      expect(useNotesStore.getState().selectedFolderIds).toEqual(['f1'])
    })

    it('clearSelection resets both to empty arrays', () => {
      useNotesStore.getState().setSelection(['n1'], ['f1'])
      useNotesStore.getState().clearSelection()
      expect(useNotesStore.getState().selectedNoteIds).toEqual([])
      expect(useNotesStore.getState().selectedFolderIds).toEqual([])
    })
  })

  describe('notes and folders', () => {
    it('setNotes and setFolders replace state', () => {
      const note = {
        sessionId: 'n1',
        content: 'x',
        lastModified: 1,
        createdAt: 0,
        title: 'T',
        wordCount: 1,
        folderId: undefined as string | undefined,
        workspaceId: 'w1',
      }
      const folder = {
        id: 'f1',
        name: 'F1',
        parentId: null as string | null,
        createdAt: 0,
        workspaceId: 'w1',
      }
      useNotesStore.getState().setNotes({ n1: note })
      useNotesStore.getState().setFolders({ f1: folder })
      expect(useNotesStore.getState().notes).toEqual({ n1: note })
      expect(useNotesStore.getState().folders).toEqual({ f1: folder })
    })
  })

  describe('duplicateNote', () => {
    it('returns null when note does not exist', () => {
      expect(useNotesStore.getState().duplicateNote('missing')).toBeNull()
      expect(Object.keys(useNotesStore.getState().notes)).toHaveLength(0)
    })

    it('creates a clone with new sessionId and (copy) in title/displayName', () => {
      const note = {
        sessionId: 'n1',
        content: 'Hello',
        lastModified: 100,
        createdAt: 50,
        title: 'Original',
        wordCount: 1,
        folderId: undefined as string | undefined,
        displayName: 'My Note',
      }
      useNotesStore.getState().setNotes({ n1: note })
      const newId = useNotesStore.getState().duplicateNote('n1')
      expect(newId).not.toBeNull()
      expect(newId).not.toBe('n1')
      const notes = useNotesStore.getState().notes
      expect(notes).toHaveProperty('n1', note)
      expect(notes).toHaveProperty(newId!)
      const clone = notes[newId!]
      expect(clone.sessionId).toBe(newId)
      expect(clone.title).toBe('Original (copy)')
      expect(clone.displayName).toBe('My Note (copy)')
      expect(clone.content).toBe('Hello')
      expect(clone.createdAt).toBeGreaterThanOrEqual(clone.lastModified - 1)
      expect(clone.lastModified).toBeGreaterThanOrEqual(100)
    })
  })

  describe('setSearchQuery (search: list only, save/restore selection)', () => {
    it('when entering search: saves selectedSidebarContext and selectedNoteId, then clears selection', () => {
      useNotesStore.getState().setSelectedSidebarContext('2025-02-01')
      useNotesStore.getState().setSelectedNoteId('n1')
      useNotesStore.getState().setSearchQuery('foo')
      expect(useNotesStore.getState().searchQuery).toBe('foo')
      expect(useNotesStore.getState().selectedSidebarContext).toBeNull()
      expect(useNotesStore.getState().selectedNoteId).toBeNull()
      expect(useNotesStore.getState().previousSidebarContext).toBe('2025-02-01')
      expect(useNotesStore.getState().previousNoteId).toBe('n1')
    })

    it('when exiting search: restores selectedSidebarContext and selectedNoteId, clears previous', () => {
      useNotesStore.getState().setSelectedSidebarContext('2025-02-01')
      useNotesStore.getState().setSelectedNoteId('n1')
      useNotesStore.getState().setSearchQuery('foo')
      useNotesStore.getState().setSearchQuery('')
      expect(useNotesStore.getState().searchQuery).toBe('')
      expect(useNotesStore.getState().selectedSidebarContext).toBe('2025-02-01')
      expect(useNotesStore.getState().selectedNoteId).toBe('n1')
      expect(useNotesStore.getState().previousSidebarContext).toBeNull()
      expect(useNotesStore.getState().previousNoteId).toBeNull()
    })

    it('when refining search (already searching): only updates searchQuery', () => {
      useNotesStore.getState().setSelectedSidebarContext('2025-02-01')
      useNotesStore.getState().setSelectedNoteId('n1')
      useNotesStore.getState().setSearchQuery('foo')
      useNotesStore.getState().setSearchQuery('foobar')
      expect(useNotesStore.getState().searchQuery).toBe('foobar')
      expect(useNotesStore.getState().previousSidebarContext).toBe('2025-02-01')
      expect(useNotesStore.getState().previousNoteId).toBe('n1')
      expect(useNotesStore.getState().selectedNoteId).toBeNull()
    })
  })

  describe('setExpandedSidebarFolderIds', () => {
    it('replaces expandedSidebarFolderIds with given array', () => {
      useNotesStore.getState().toggleFolderExpanded('f1', true)
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual(['f1'])
      useNotesStore.getState().setExpandedSidebarFolderIds(['f1', 'f2', 'f3'])
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual(['f1', 'f2', 'f3'])
    })

    it('collapse all when given empty array', () => {
      useNotesStore.getState().toggleFolderExpanded('f1', true)
      useNotesStore.getState().toggleFolderExpanded('f2', true)
      useNotesStore.getState().setExpandedSidebarFolderIds([])
      expect(useNotesStore.getState().expandedSidebarFolderIds).toEqual([])
    })
  })
})
