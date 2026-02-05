import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from './useUIStore'
import {
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_DEFAULT,
} from './useUIStore'

function resetUIStore(): void {
  useUIStore.setState({
    isDarkMode: false,
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    currentView: 'notes',
    isTrashView: false,
    openInPipNoteIds: [],
    openInPipActiveNoteId: null,
  tutorialInProgress: false,
  tutorialReadyForNoteOpen: false,
  tutorialShowCreateHint: false,
})
}

describe('useUIStore', () => {
  beforeEach(resetUIStore)

  describe('sidebar width clamping', () => {
    it('clamps setSidebarWidth to 0 when negative', () => {
      useUIStore.getState().setSidebarWidth(-50)
      expect(useUIStore.getState().sidebarWidth).toBe(0)
    })

    it('clamps setSidebarWidth to MAX when above max', () => {
      useUIStore.getState().setSidebarWidth(600)
      expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX)
    })

    it('accepts width within range', () => {
      useUIStore.getState().setSidebarWidth(300)
      expect(useUIStore.getState().sidebarWidth).toBe(300)
    })

    it('accepts exactly MIN and MAX', () => {
      useUIStore.getState().setSidebarWidth(SIDEBAR_WIDTH_MIN)
      expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN)
      useUIStore.getState().setSidebarWidth(SIDEBAR_WIDTH_MAX)
      expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX)
    })
  })

  describe('UI setters', () => {
    it('setSidebarCollapsed updates state', () => {
      expect(useUIStore.getState().sidebarCollapsed).toBe(false)
      useUIStore.getState().setSidebarCollapsed(true)
      expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    })

    it('setIsDarkMode updates state', () => {
      expect(useUIStore.getState().isDarkMode).toBe(false)
      useUIStore.getState().setIsDarkMode(true)
      expect(useUIStore.getState().isDarkMode).toBe(true)
    })

    it('setCurrentView updates state', () => {
      expect(useUIStore.getState().currentView).toBe('notes')
      useUIStore.getState().setCurrentView('settings')
      expect(useUIStore.getState().currentView).toBe('settings')
    })

    it('setIsTrashView updates state', () => {
      expect(useUIStore.getState().isTrashView).toBe(false)
      useUIStore.getState().setIsTrashView(true)
      expect(useUIStore.getState().isTrashView).toBe(true)
    })

    it('setOpenInPipNoteIds and setOpenInPipActiveNoteId update state', () => {
      expect(useUIStore.getState().openInPipNoteIds).toEqual([])
      useUIStore.getState().setOpenInPipNoteIds(['n1', 'n2'])
      expect(useUIStore.getState().openInPipNoteIds).toEqual(['n1', 'n2'])
      expect(useUIStore.getState().openInPipActiveNoteId).toBe('n1')
      useUIStore.getState().setOpenInPipActiveNoteId('n2')
      expect(useUIStore.getState().openInPipActiveNoteId).toBe('n2')
    })

    it('addNoteToPip and removeNoteFromPip update state', () => {
      useUIStore.getState().addNoteToPip('n1')
      expect(useUIStore.getState().openInPipNoteIds).toEqual(['n1'])
      useUIStore.getState().addNoteToPip('n2')
      expect(useUIStore.getState().openInPipNoteIds).toEqual(['n1', 'n2'])
      useUIStore.getState().removeNoteFromPip('n1')
      expect(useUIStore.getState().openInPipNoteIds).toEqual(['n2'])
      expect(useUIStore.getState().openInPipActiveNoteId).toBe('n2')
    })

    it('setTutorialInProgress updates state', () => {
      expect(useUIStore.getState().tutorialInProgress).toBe(false)
      useUIStore.getState().setTutorialInProgress(true)
      expect(useUIStore.getState().tutorialInProgress).toBe(true)
      useUIStore.getState().setTutorialInProgress(false)
      expect(useUIStore.getState().tutorialInProgress).toBe(false)
    })
  })
})
