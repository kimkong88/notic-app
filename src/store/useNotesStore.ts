import { create } from 'zustand';
import type { NoteData, Folder, SortOption } from './types';
import { BOOKMARKS_SENTINEL, ROOT_SENTINEL } from './types';
import { extractTitle, NOTE_CHAR_LIMIT } from '../utils/noteUtils';

type TabKind = 'recent' | 'folders';

interface NotesState {
  notes: Record<string, NoteData>;
  folders: Record<string, Folder>;
  currentTab: TabKind;
  selectedNoteId: string | null;
  /** Sidebar context: date key (Recent tab) or folder id / ROOT_SENTINEL / BOOKMARKS_SENTINEL (Folders tab). Single source for both tabs. */
  selectedSidebarContext: string | null;
  searchQuery: string;
  /** Saved when entering search; restored when exiting (match notic extension). */
  previousSidebarContext: string | null;
  previousNoteId: string | null;
  sort: SortOption;
  selectedNoteIds: string[];
  selectedFolderIds: string[];
  expandedSidebarFolderIds: string[];
  expandedMainFolderIds: string[];
}

interface NotesActions {
  setNotes: (notes: Record<string, NoteData>) => void;
  updateNote: (sessionId: string, patch: Partial<NoteData>) => void;
  /** Create a new note and return its sessionId. */
  addNote: (options?: { workspaceId?: string | null; folderId?: string | null }) => string;
  /** Duplicate a note (clone with new sessionId). Returns new sessionId or null if note not found. */
  duplicateNote: (sessionId: string) => string | null;
  setFolders: (folders: Record<string, Folder>) => void;
  /** Create a folder. Returns new folder id. parentId null = root. */
  addFolder: (options: { name?: string; parentId?: string | null; workspaceId?: string | null }) => string;
  /** Update folder name, displayName, color, or parentId (move). */
  updateFolder: (folderId: string, patch: Partial<Pick<Folder, 'name' | 'displayName' | 'color' | 'parentId'>>) => void;
  /** Delete folder; notes inside become folderless. */
  removeFolder: (folderId: string) => void;
  setCurrentTab: (tab: TabKind) => void;
  setSelectedNoteId: (id: string | null) => void;
  setSelectedSidebarContext: (context: string | null) => void;
  setSearchQuery: (query: string) => void;
  setSort: (sort: SortOption) => void;
  setSelection: (noteIds: string[], folderIds: string[]) => void;
  clearSelection: () => void;
  toggleFolderExpanded: (folderId: string, inSidebar: boolean) => void;
  /** Set sidebar expanded folder ids (for expand all / collapse all). */
  setExpandedSidebarFolderIds: (ids: string[]) => void;
  /** Remove all notes and folders belonging to a workspace (e.g. when deleting that workspace). */
  deleteNotesAndFoldersByWorkspace: (workspaceId: string) => void;
  /** Restore a soft-deleted note (clear deletedAt). */
  restoreNote: (sessionId: string) => void;
  /** Permanently remove a note from state (e.g. from trash). */
  removeNote: (sessionId: string) => void;
}

const defaultSort: SortOption = 'modified-desc';

export const useNotesStore = create<NotesState & NotesActions>((set, get) => ({
  notes: {},
  folders: {},
  currentTab: 'recent',
  selectedNoteId: null,
  selectedSidebarContext: null,
  searchQuery: '',
  previousSidebarContext: null,
  previousNoteId: null,
  sort: defaultSort,
  selectedNoteIds: [],
  selectedFolderIds: [],
  expandedSidebarFolderIds: [ROOT_SENTINEL],
  expandedMainFolderIds: [],

  setNotes: (notes) => set({ notes: { ...notes } }),
  updateNote: (sessionId, patch) =>
    set((state) => {
      const existing = state.notes[sessionId]
      if (!existing) return state
      const updated = { ...existing, ...patch }
      if (patch.content !== undefined) {
        let content = patch.content
        if (content.length > NOTE_CHAR_LIMIT) content = content.slice(0, NOTE_CHAR_LIMIT)
        updated.content = content
        const trimmed = content.trim()
        updated.wordCount = trimmed ? trimmed.split(/\s+/).length : 0
        updated.lastModified = Date.now()
        updated.title = extractTitle(content, existing.title)
      }
      if (patch.title !== undefined) updated.lastModified = Date.now()
      return { notes: { ...state.notes, [sessionId]: updated } }
    }),
  addNote: (options) => {
    const sessionId = crypto.randomUUID()
    const now = Date.now()
    const firstNote = Object.values(get().notes)[0]
    const wsId = options?.workspaceId ?? firstNote?.workspaceId ?? 'workspace_1'
    const newNote: NoteData = {
      sessionId,
      content: '',
      lastModified: now,
      createdAt: now,
      title: 'Untitled',
      wordCount: 0,
      folderId: options?.folderId ?? undefined,
      workspaceId: wsId,
    }
    set((state) => ({ notes: { ...state.notes, [sessionId]: newNote } }))
    return sessionId
  },
  duplicateNote: (sessionId) => {
    const existing = get().notes[sessionId]
    if (!existing) return null
    const newId = crypto.randomUUID()
    const now = Date.now()
    const clone: NoteData = {
      ...existing,
      sessionId: newId,
      title: existing.title ? `${existing.title} (copy)` : 'Untitled (copy)',
      displayName: existing.displayName ? `${existing.displayName} (copy)` : undefined,
      lastModified: now,
      createdAt: now,
    }
    set((state) => ({ notes: { ...state.notes, [newId]: clone } }))
    return newId
  },
  setFolders: (folders) => set({ folders: { ...folders } }),
  addFolder: (options) => {
    const id = crypto.randomUUID()
    const now = Date.now()
    const wsId = options.workspaceId ?? Object.values(get().folders)[0]?.workspaceId ?? 'workspace_1'
    const folder: Folder = {
      id,
      name: options.name ?? 'Untitled',
      parentId: options.parentId ?? null,
      createdAt: now,
      workspaceId: wsId,
    }
    set((state) => ({ folders: { ...state.folders, [id]: folder } }))
    return id
  },
  updateFolder: (folderId, patch) =>
    set((state) => {
      const folder = state.folders[folderId]
      if (!folder) return state
      const updated = { ...folder, ...patch }
      if (patch.name !== undefined) updated.displayName = undefined
      return { folders: { ...state.folders, [folderId]: updated } }
    }),
  removeFolder: (folderId) =>
    set((state) => {
      const folder = state.folders[folderId]
      if (!folder) return state
      const folders = { ...state.folders }
      delete folders[folderId]
      const notes = { ...state.notes }
      for (const id of Object.keys(notes)) {
        if ((notes[id] as NoteData).folderId === folderId) {
          notes[id] = { ...notes[id], folderId: undefined }
        }
      }
      const selectedSidebarContext =
        state.selectedSidebarContext === folderId ? ROOT_SENTINEL : state.selectedSidebarContext
      const selectedFolderIds = state.selectedFolderIds.filter((id) => id !== folderId)
      return {
        folders,
        notes,
        selectedSidebarContext,
        selectedFolderIds,
      }
    }),
  setCurrentTab: (tab) => set({ currentTab: tab }),
  setSelectedNoteId: (id) => set({ selectedNoteId: id }),
  setSelectedSidebarContext: (context) => set({ selectedSidebarContext: context }),
  setSearchQuery: (query) => {
    const prevQuery = get().searchQuery.trim().length > 0
    const nextQuery = (query ?? '').trim().length > 0
    if (!prevQuery && nextQuery) {
      set({
        searchQuery: query ?? '',
        previousSidebarContext: get().selectedSidebarContext,
        previousNoteId: get().selectedNoteId,
        selectedSidebarContext: null,
        selectedNoteId: null,
      })
    } else if (prevQuery && !nextQuery) {
      set({
        searchQuery: query ?? '',
        selectedSidebarContext: get().previousSidebarContext,
        selectedNoteId: get().previousNoteId,
        previousSidebarContext: null,
        previousNoteId: null,
      })
    } else {
      set({ searchQuery: query ?? '' })
    }
  },
  setSort: (sort) => set({ sort }),
  setSelection: (noteIds, folderIds) =>
    set({ selectedNoteIds: [...noteIds], selectedFolderIds: [...folderIds] }),
  clearSelection: () =>
    set({ selectedNoteIds: [], selectedFolderIds: [] }),
  toggleFolderExpanded: (folderId, inSidebar) => {
    const key = inSidebar ? 'expandedSidebarFolderIds' : 'expandedMainFolderIds';
    const current = get()[key];
    const next = current.includes(folderId)
      ? current.filter((id) => id !== folderId)
      : [...current, folderId];
    set({ [key]: next });
  },
  setExpandedSidebarFolderIds: (ids) => set({ expandedSidebarFolderIds: [...ids] }),
  deleteNotesAndFoldersByWorkspace: (workspaceId) => {
    set((state) => {
      const notes = { ...state.notes };
      const folders = { ...state.folders };
      for (const id of Object.keys(notes)) {
        if ((notes[id] as NoteData).workspaceId === workspaceId) delete notes[id];
      }
      for (const id of Object.keys(folders)) {
        if ((folders[id] as Folder).workspaceId === workspaceId) delete folders[id];
      }
      const selectedNoteId =
        state.selectedNoteId && notes[state.selectedNoteId] != null ? state.selectedNoteId : null;
      const ctx = state.selectedSidebarContext;
      const selectedSidebarContext =
        ctx == null ||
        ctx === ROOT_SENTINEL ||
        ctx === BOOKMARKS_SENTINEL ||
        folders[ctx] != null
          ? ctx
          : null;
      const selectedNoteIds = state.selectedNoteIds.filter((id) => notes[id] != null);
      const selectedFolderIds = state.selectedFolderIds.filter((id) => folders[id] != null);
      return {
        notes,
        folders,
        selectedNoteId,
        selectedSidebarContext,
        selectedNoteIds,
        selectedFolderIds,
      };
    });
  },
  restoreNote: (sessionId) => {
    set((state) => {
      const existing = state.notes[sessionId];
      if (!existing || existing.deletedAt == null) return state;
      const updated = { ...existing };
      delete updated.deletedAt;
      return { notes: { ...state.notes, [sessionId]: updated } };
    });
  },
  removeNote: (sessionId) => {
    set((state) => {
      if (state.notes[sessionId] == null) return state;
      const notes = { ...state.notes };
      delete notes[sessionId];
      const selectedNoteId = state.selectedNoteId === sessionId ? null : state.selectedNoteId;
      const selectedNoteIds = state.selectedNoteIds.filter((id) => id !== sessionId);
      return {
        notes,
        selectedNoteId,
        selectedNoteIds,
      };
    });
  },
}));
