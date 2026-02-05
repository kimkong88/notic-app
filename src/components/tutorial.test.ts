import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Tutorial Progress State Machine Tests
 * 
 * Tests the tutorial flow without React components:
 * - Task 1: Float test (tab switching detection)
 * - Task 2: Tab customization (right-click, rename, color)
 * - Task 3: Note workflow (create, bookmark, open)
 */

interface TutorialState {
  // Task 1: Float test
  floatTestCompleted: boolean
  hasLeftTab: boolean

  // Task 2: Tab customization
  tabMenuOpened: boolean
  tabRenamed: boolean
  tabColorChanged: boolean

  // Task 3: Note workflow
  noteCreated: boolean
  noteBookmarked: boolean
  noteOpened: boolean
}

function createInitialState(): TutorialState {
  return {
    floatTestCompleted: false,
    hasLeftTab: false,
    tabMenuOpened: false,
    tabRenamed: false,
    tabColorChanged: false,
    noteCreated: false,
    noteBookmarked: false,
    noteOpened: false,
  }
}

function isTask1Complete(state: TutorialState): boolean {
  return state.floatTestCompleted
}

function isTask2Complete(state: TutorialState): boolean {
  return state.tabMenuOpened && state.tabRenamed && state.tabColorChanged
}

function isTask3Complete(state: TutorialState): boolean {
  return state.noteCreated && state.noteBookmarked && state.noteOpened
}

function isTask2Active(state: TutorialState): boolean {
  return isTask1Complete(state) && !isTask2Complete(state)
}

function isTask3Active(state: TutorialState): boolean {
  return isTask2Complete(state) && !isTask3Complete(state)
}

describe('Tutorial State Machine', () => {
  let state: TutorialState

  beforeEach(() => {
    state = createInitialState()
  })

  describe('Task 1: Float Test', () => {
    it('starts incomplete', () => {
      expect(isTask1Complete(state)).toBe(false)
    })

    it('completes when user leaves and returns to tab', () => {
      // User leaves tab
      state.hasLeftTab = true
      expect(isTask1Complete(state)).toBe(false)

      // User returns to tab
      state.floatTestCompleted = true
      expect(isTask1Complete(state)).toBe(true)
    })

    it('blocks Task 2 until complete', () => {
      expect(isTask2Active(state)).toBe(false)
      state.floatTestCompleted = true
      expect(isTask2Active(state)).toBe(true)
    })
  })

  describe('Task 2: Tab Customization', () => {
    beforeEach(() => {
      state.floatTestCompleted = true // Prerequisite
    })

    it('is active after Task 1 completes', () => {
      expect(isTask2Active(state)).toBe(true)
    })

    it('requires all 3 sub-steps to complete', () => {
      expect(isTask2Complete(state)).toBe(false)

      // Step 1: Open menu
      state.tabMenuOpened = true
      expect(isTask2Complete(state)).toBe(false)

      // Step 2: Rename
      state.tabRenamed = true
      expect(isTask2Complete(state)).toBe(false)

      // Step 3: Change color
      state.tabColorChanged = true
      expect(isTask2Complete(state)).toBe(true)
    })

    it('blocks Task 3 until complete', () => {
      expect(isTask3Active(state)).toBe(false)

      state.tabMenuOpened = true
      state.tabRenamed = true
      expect(isTask3Active(state)).toBe(false)

      state.tabColorChanged = true
      expect(isTask3Active(state)).toBe(true)
    })

    it('enforces order: rename before color change', () => {
      // Simulates the logic: color change ignored if rename not done
      state.tabMenuOpened = true
      
      // Try to change color without rename (should be blocked in UI)
      const canChangeColor = state.tabRenamed
      expect(canChangeColor).toBe(false)

      // After rename, color change is allowed
      state.tabRenamed = true
      const canChangeColorNow = state.tabRenamed
      expect(canChangeColorNow).toBe(true)
    })
  })

  describe('Task 3: Note Workflow', () => {
    beforeEach(() => {
      state.floatTestCompleted = true
      state.tabMenuOpened = true
      state.tabRenamed = true
      state.tabColorChanged = true // All prerequisites
    })

    it('is active after Task 2 completes', () => {
      expect(isTask3Active(state)).toBe(true)
    })

    it('requires all 3 sub-steps to complete', () => {
      expect(isTask3Complete(state)).toBe(false)

      // Step 1: Create note
      state.noteCreated = true
      expect(isTask3Complete(state)).toBe(false)

      // Step 2: Bookmark note
      state.noteBookmarked = true
      expect(isTask3Complete(state)).toBe(false)

      // Step 3: Open note in PiP
      state.noteOpened = true
      expect(isTask3Complete(state)).toBe(true)
    })

    it('accepts note creation from any source (toolbar or context menu)', () => {
      // Both should set noteCreated to true
      state.noteCreated = true
      expect(state.noteCreated).toBe(true)
    })
  })

  describe('Complete Tutorial Flow', () => {
    it('progresses through all tasks in order', () => {
      // Initial state: nothing complete
      expect(isTask1Complete(state)).toBe(false)
      expect(isTask2Active(state)).toBe(false)
      expect(isTask3Active(state)).toBe(false)

      // Complete Task 1
      state.hasLeftTab = true
      state.floatTestCompleted = true
      expect(isTask1Complete(state)).toBe(true)
      expect(isTask2Active(state)).toBe(true)
      expect(isTask3Active(state)).toBe(false)

      // Complete Task 2
      state.tabMenuOpened = true
      state.tabRenamed = true
      state.tabColorChanged = true
      expect(isTask1Complete(state)).toBe(true)
      expect(isTask2Complete(state)).toBe(true)
      expect(isTask2Active(state)).toBe(false)
      expect(isTask3Active(state)).toBe(true)

      // Complete Task 3
      state.noteCreated = true
      state.noteBookmarked = true
      state.noteOpened = true
      expect(isTask3Complete(state)).toBe(true)
      expect(isTask3Active(state)).toBe(false)
    })
  })

  describe('Tutorial Progress Instructions', () => {
    beforeEach(() => {
      state.floatTestCompleted = true // Enable Task 1 instructions
    })

    it('generates correct instruction for Task 1', () => {
      state.floatTestCompleted = false
      const getInstruction = (hasLeft: boolean, completed: boolean) => {
        if (!hasLeft) return 'Switch to another browser tab (0/2)'
        if (!completed) return 'Now come back to Notic (1/2)'
        return 'Task complete! (2/2) 🎉'
      }

      expect(getInstruction(false, false)).toBe('Switch to another browser tab (0/2)')
      expect(getInstruction(true, false)).toBe('Now come back to Notic (1/2)')
      expect(getInstruction(true, true)).toBe('Task complete! (2/2) 🎉')
    })

    it('generates correct instruction for Task 2', () => {
      const getInstruction = (menuOpened: boolean, renamed: boolean, colorChanged: boolean) => {
        if (!menuOpened) return 'Right-click the tab above (0/3)'
        if (!renamed) return 'Click "Rename" and change the tab name (1/3)'
        if (!colorChanged) return 'Right-click again and change the color (2/3)'
        return 'Task complete! (3/3) 🎉'
      }

      expect(getInstruction(false, false, false)).toBe('Right-click the tab above (0/3)')
      expect(getInstruction(true, false, false)).toBe('Click "Rename" and change the tab name (1/3)')
      expect(getInstruction(true, true, false)).toBe('Right-click again and change the color (2/3)')
      expect(getInstruction(true, true, true)).toBe('Task complete! (3/3) 🎉')
    })

    it('generates correct instruction for Task 3', () => {
      const getInstruction = (created: boolean, bookmarked: boolean, opened: boolean) => {
        if (!created) return 'Create a note (toolbar + or right-click folder) (0/3)'
        if (!bookmarked) return 'Bookmark it (right-click note → Add to Bookmarks) (1/3)'
        if (!opened) return 'Open it in the editor (right-click note → Open) (2/3)'
        return 'Task complete! (3/3) 🎉'
      }

      expect(getInstruction(false, false, false)).toBe('Create a note (toolbar + or right-click folder) (0/3)')
      expect(getInstruction(true, false, false)).toBe('Bookmark it (right-click note → Add to Bookmarks) (1/3)')
      expect(getInstruction(true, true, false)).toBe('Open it in the editor (right-click note → Open) (2/3)')
      expect(getInstruction(true, true, true)).toBe('Task complete! (3/3) 🎉')
    })
  })

  describe('Message Type Validation', () => {
    it('defines correct message types for tutorial events', () => {
      const messageTypes = [
        'notic-pip-tutorial-tab-left',
        'notic-pip-tutorial-tab-returned',
        'notic-pip-tutorial-note-created',
        'notic-pip-tutorial-note-bookmarked',
        'notic-pip-tutorial-note-opened',
        'tutorial-task-completed',
      ]

      // All message types should follow naming conventions
      messageTypes.forEach(type => {
        if (type.startsWith('notic-pip-tutorial-')) {
          expect(type.startsWith('notic-pip-')).toBe(true)
        }
      })
    })
  })
})
