import { describe, it, expect } from 'vitest'
import {
  getRangeIndices,
  getRangeSelection,
  getRangeNoteIds,
  type SelectableItem,
} from './selectionRange'

describe('getRangeIndices', () => {
  it('when anchorIndex < 0 (no prior anchor), returns single-item range at clickIndex', () => {
    expect(getRangeIndices(-1, 0)).toEqual([0, 0])
    expect(getRangeIndices(-1, 5)).toEqual([5, 5])
  })

  it('forward range: anchor < click returns [anchor, click]', () => {
    expect(getRangeIndices(0, 4)).toEqual([0, 4])
    expect(getRangeIndices(2, 5)).toEqual([2, 5])
  })

  it('backward range: anchor > click returns [click, anchor] (same inclusive range)', () => {
    expect(getRangeIndices(4, 0)).toEqual([0, 4])
    expect(getRangeIndices(5, 2)).toEqual([2, 5])
  })

  it('same index returns single-item range', () => {
    expect(getRangeIndices(3, 3)).toEqual([3, 3])
  })
})

describe('getRangeSelection', () => {
  const mixedList: SelectableItem[] = [
    { type: 'note', id: 'n1' },
    { type: 'folder', id: 'f1' },
    { type: 'note', id: 'n2' },
    { type: 'note', id: 'n3' },
    { type: 'folder', id: 'f2' },
  ]

  it('no prior anchor: selects only clicked item', () => {
    expect(getRangeSelection(mixedList, -1, 0)).toEqual({ noteIds: ['n1'], folderIds: [] })
    expect(getRangeSelection(mixedList, -1, 2)).toEqual({ noteIds: ['n2'], folderIds: [] })
    expect(getRangeSelection(mixedList, -1, 4)).toEqual({ noteIds: [], folderIds: ['f2'] })
  })

  it('forward range: anchor 0, click 4', () => {
    const r = getRangeSelection(mixedList, 0, 4)
    expect(r.noteIds).toEqual(['n1', 'n2', 'n3'])
    expect(r.folderIds).toEqual(['f1', 'f2'])
  })

  it('backward range: anchor 4, click 0', () => {
    const r = getRangeSelection(mixedList, 4, 0)
    expect(r.noteIds).toEqual(['n1', 'n2', 'n3'])
    expect(r.folderIds).toEqual(['f1', 'f2'])
  })

  it('same index: single item', () => {
    expect(getRangeSelection(mixedList, 2, 2)).toEqual({ noteIds: ['n2'], folderIds: [] })
    expect(getRangeSelection(mixedList, 1, 1)).toEqual({ noteIds: [], folderIds: ['f1'] })
  })

  it('notes-only list: correct noteIds, empty folderIds', () => {
    const notesOnly: SelectableItem[] = [
      { type: 'note', id: 'a' },
      { type: 'note', id: 'b' },
      { type: 'note', id: 'c' },
    ]
    expect(getRangeSelection(notesOnly, 0, 2)).toEqual({
      noteIds: ['a', 'b', 'c'],
      folderIds: [],
    })
  })
})

describe('getRangeNoteIds', () => {
  const notesOnly = [
    { type: 'note' as const, id: 'n1' },
    { type: 'note' as const, id: 'n2' },
    { type: 'note' as const, id: 'n3' },
    { type: 'note' as const, id: 'n4' },
  ]

  it('no prior anchor: single note', () => {
    expect(getRangeNoteIds(notesOnly, -1, 2)).toEqual(['n3'])
  })

  it('forward and backward range', () => {
    expect(getRangeNoteIds(notesOnly, 0, 3)).toEqual(['n1', 'n2', 'n3', 'n4'])
    expect(getRangeNoteIds(notesOnly, 3, 0)).toEqual(['n1', 'n2', 'n3', 'n4'])
  })

  it('same index', () => {
    expect(getRangeNoteIds(notesOnly, 1, 1)).toEqual(['n2'])
  })
})
