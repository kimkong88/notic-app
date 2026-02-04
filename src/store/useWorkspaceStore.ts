import { create } from 'zustand';
import type { WorkspaceInfo } from './types';

export const DEFAULT_WORKSPACE_ID = 'workspace_1';
export const WORKSPACE_NAME_MAX_LENGTH = 50;

interface WorkspaceState {
  currentWorkspaceId: string | null;
  workspaces: Record<string, WorkspaceInfo>;
}

interface WorkspaceActions {
  setCurrentWorkspaceId: (id: string | null) => void;
  setWorkspaces: (workspaces: Record<string, WorkspaceInfo>) => void;
  /** Update a workspace's optional fields (e.g. icon, color). */
  updateWorkspaceMeta: (workspaceId: string, patch: Partial<Pick<WorkspaceInfo, 'icon' | 'color'>>) => void;
  /** Rename workspace (trim, max length). */
  renameWorkspace: (workspaceId: string, newName: string) => void;
  /** Create a new workspace; returns the new workspace. */
  addWorkspace: () => WorkspaceInfo;
  /** Remove workspace (only non-default). Caller must delete notes/folders for that workspace first. */
  deleteWorkspace: (workspaceId: string) => void;
}

/** Display order: default first, then by lastModified asc (oldest first) so new workspaces appear at the end. */
export function getWorkspacesInDisplayOrder(workspaces: Record<string, WorkspaceInfo>): WorkspaceInfo[] {
  return Object.values(workspaces).sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    const aTs = a.lastModified ?? 0;
    const bTs = b.lastModified ?? 0;
    if (aTs !== bTs) return aTs - bTs;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>((set, get) => ({
  currentWorkspaceId: null,
  workspaces: {},

  setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
  setWorkspaces: (workspaces) => set({ workspaces: { ...workspaces } }),
  updateWorkspaceMeta: (workspaceId, patch) => {
    const ws = get().workspaces[workspaceId];
    if (!ws) return;
    set({
      workspaces: {
        ...get().workspaces,
        [workspaceId]: { ...ws, ...patch },
      },
    });
  },
  renameWorkspace: (workspaceId, newName) => {
    const ws = get().workspaces[workspaceId];
    if (!ws) return;
    const trimmed = newName.trim().slice(0, WORKSPACE_NAME_MAX_LENGTH);
    const nameToSave = trimmed || ws.name;
    set({
      workspaces: {
        ...get().workspaces,
        [workspaceId]: { ...ws, name: nameToSave, lastModified: Date.now() },
      },
    });
  },
  addWorkspace: () => {
    const list = Object.values(get().workspaces);
    const nextNum = list.length + 1;
    const name = `Workspace ${nextNum}`;
    const id = `workspace_${Date.now()}`;
    const newWs: WorkspaceInfo = {
      id,
      name,
      isDefault: false,
      lastModified: Date.now(),
    };
    set((state) => ({
      workspaces: { ...state.workspaces, [id]: newWs },
    }));
    return newWs;
  },
  deleteWorkspace: (workspaceId) => {
    const ws = get().workspaces[workspaceId];
    if (!ws || ws.isDefault) return;
    const next = { ...get().workspaces };
    delete next[workspaceId];
    const current = get().currentWorkspaceId;
    const newCurrent =
      current === workspaceId
        ? Object.values(next).find((w) => w.isDefault)?.id ?? Object.keys(next)[0] ?? DEFAULT_WORKSPACE_ID
        : current;
    set({ workspaces: next, currentWorkspaceId: newCurrent });
  },
}));
