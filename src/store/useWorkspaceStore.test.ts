import { describe, it, expect, beforeEach } from 'vitest'
import {
  useWorkspaceStore,
  getWorkspacesInDisplayOrder,
  WORKSPACE_NAME_MAX_LENGTH,
} from './useWorkspaceStore'

function resetWorkspaceStore(): void {
  useWorkspaceStore.setState({
    currentWorkspaceId: null,
    workspaces: {},
  })
}

describe('useWorkspaceStore', () => {
  beforeEach(resetWorkspaceStore)

  describe('setCurrentWorkspaceId / setWorkspaces', () => {
    it('updates currentWorkspaceId and workspaces', () => {
      const ws = { id: 'w1', name: 'Default', isDefault: true }
      useWorkspaceStore.getState().setWorkspaces({ w1: ws })
      useWorkspaceStore.getState().setCurrentWorkspaceId('w1')
      expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('w1')
      expect(useWorkspaceStore.getState().workspaces).toEqual({ w1: ws })
    })
  })

  describe('renameWorkspace', () => {
    it('trims and updates name', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'Old', isDefault: true },
      })
      useWorkspaceStore.getState().renameWorkspace('w1', '  New Name  ')
      expect(useWorkspaceStore.getState().workspaces.w1?.name).toBe('New Name')
    })

    it('caps name at WORKSPACE_NAME_MAX_LENGTH', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'Default', isDefault: true },
      })
      const long = 'a'.repeat(WORKSPACE_NAME_MAX_LENGTH + 10)
      useWorkspaceStore.getState().renameWorkspace('w1', long)
      expect(useWorkspaceStore.getState().workspaces.w1?.name).toHaveLength(WORKSPACE_NAME_MAX_LENGTH)
    })

    it('keeps existing name when trimmed result is empty', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'Keep', isDefault: true },
      })
      useWorkspaceStore.getState().renameWorkspace('w1', '   ')
      expect(useWorkspaceStore.getState().workspaces.w1?.name).toBe('Keep')
    })

    it('does nothing when workspace does not exist', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'A', isDefault: true },
      })
      useWorkspaceStore.getState().renameWorkspace('missing', 'X')
      expect(useWorkspaceStore.getState().workspaces).toEqual({ w1: { id: 'w1', name: 'A', isDefault: true } })
    })
  })

  describe('addWorkspace', () => {
    it('adds a new workspace with name "Workspace N"', () => {
      const added = useWorkspaceStore.getState().addWorkspace()
      expect(added.name).toBe('Workspace 1')
      expect(added.isDefault).toBe(false)
      expect(useWorkspaceStore.getState().workspaces[added.id]).toEqual(added)
    })

    it('increments number when workspaces exist', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'One', isDefault: true },
        w2: { id: 'w2', name: 'Two', isDefault: false },
      })
      const added = useWorkspaceStore.getState().addWorkspace()
      expect(added.name).toBe('Workspace 3')
    })
  })

  describe('deleteWorkspace', () => {
    it('removes non-default workspace and updates currentWorkspaceId if it was deleted', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'Default', isDefault: true },
        w2: { id: 'w2', name: 'Other', isDefault: false },
      })
      useWorkspaceStore.getState().setCurrentWorkspaceId('w2')
      useWorkspaceStore.getState().deleteWorkspace('w2')
      expect(useWorkspaceStore.getState().workspaces.w2).toBeUndefined()
      expect(useWorkspaceStore.getState().currentWorkspaceId).toBe('w1')
    })

    it('does not remove default workspace', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'Default', isDefault: true },
      })
      useWorkspaceStore.getState().deleteWorkspace('w1')
      expect(useWorkspaceStore.getState().workspaces.w1).toBeDefined()
    })
  })

  describe('updateWorkspaceMeta', () => {
    it('updates icon and color', () => {
      useWorkspaceStore.getState().setWorkspaces({
        w1: { id: 'w1', name: 'A', isDefault: true },
      })
      useWorkspaceStore.getState().updateWorkspaceMeta('w1', { color: '#fff', icon: 'X' })
      expect(useWorkspaceStore.getState().workspaces.w1?.color).toBe('#fff')
      expect(useWorkspaceStore.getState().workspaces.w1?.icon).toBe('X')
    })
  })
})

describe('getWorkspacesInDisplayOrder', () => {
  it('puts default workspace first', () => {
    const workspaces = {
      w2: { id: 'w2', name: 'B', isDefault: false },
      w1: { id: 'w1', name: 'A', isDefault: true },
    }
    const ordered = getWorkspacesInDisplayOrder(workspaces)
    expect(ordered[0].id).toBe('w1')
    expect(ordered[1].id).toBe('w2')
  })

  it('sorts non-default by lastModified asc (oldest first)', () => {
    const workspaces = {
      w1: { id: 'w1', name: 'A', isDefault: true, lastModified: 100 },
      w2: { id: 'w2', name: 'B', isDefault: false, lastModified: 200 },
      w3: { id: 'w3', name: 'C', isDefault: false, lastModified: 150 },
    }
    const ordered = getWorkspacesInDisplayOrder(workspaces)
    expect(ordered[0].id).toBe('w1') // default first
    expect(ordered[1].id).toBe('w3') // lastModified: 150 (older)
    expect(ordered[2].id).toBe('w2') // lastModified: 200 (newer)
  })
})
