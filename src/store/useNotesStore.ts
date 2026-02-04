import { create } from 'zustand';
import type { NoteData, Folder, SortOption } from './types';
import { BOOKMARKS_SENTINEL, ROOT_SENTINEL } from './types';
import { extractTitle, NOTE_CHAR_LIMIT } from '../utils/noteUtils';
import { getFolderAndDescendantIds } from '../utils/folderUtils';

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
  addNote: (options?: { workspaceId?: string | null; folderId?: string | null; createdFromPip?: boolean }) => string;
  /** Duplicate a note (clone with new sessionId). Returns new sessionId or null if note not found. */
  duplicateNote: (sessionId: string) => string | null;
  setFolders: (folders: Record<string, Folder>) => void;
  /** Create a folder. Returns new folder id. parentId null = root. */
  addFolder: (options: { name?: string; parentId?: string | null; workspaceId?: string | null }) => string;
  /** Update folder name, displayName, color, or parentId (move). */
  updateFolder: (folderId: string, patch: Partial<Pick<Folder, 'name' | 'displayName' | 'color' | 'parentId'>>) => void;
  /** Delete folder and all nested subfolders; notes in this folder tree are moved to trash. */
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
  updateNote: (sessionId, patch) => {
    set((state) => {
      const existing = state.notes[sessionId]
      const now = Date.now()
      if (!existing) {
        // PiP (and others) may have noteIds but no note in this store yet – upsert so local state is kept
        const content = patch.content ?? ''
        const trimmed = content.trim()
        const newNote: NoteData = {
          sessionId,
          content: content.length > NOTE_CHAR_LIMIT ? content.slice(0, NOTE_CHAR_LIMIT) : content,
          title: patch.content !== undefined ? extractTitle(patch.content, 'Untitled') : (patch.title ?? 'Untitled'),
          lastModified: now,
          createdAt: now,
          wordCount: trimmed ? trimmed.split(/\s+/).length : 0,
          folderId: patch.folderId,
          workspaceId: patch.workspaceId ?? 'workspace_1',
          hasEverHadContent: trimmed.length > 0,
        }
        if (patch.displayName !== undefined) newNote.displayName = patch.displayName
        if (patch.color !== undefined) newNote.color = patch.color
        return { notes: { ...state.notes, [sessionId]: newNote } }
      }
      const updated = { ...existing, ...patch }
      let shouldBumpLastModified = false
      if (patch.content !== undefined) {
        let content = patch.content
        if (content.length > NOTE_CHAR_LIMIT) content = content.slice(0, NOTE_CHAR_LIMIT)
        const trimmed = content.trim()
        const existingTrimmed = existing.content?.trim() ?? ''
        updated.content = content
        updated.wordCount = trimmed ? trimmed.split(/\s+/).length : 0
        // When content is cleared, show "Untitled" in sidebar and PiP tab (match extension).
        updated.title = trimmed ? extractTitle(content, existing.title) : 'Untitled'
        if (trimmed) updated.hasEverHadContent = true
        // Only bump lastModified when content actually changed (prevents "open in PiP" from moving note to top when user didn't type).
        if (trimmed !== existingTrimmed) shouldBumpLastModified = true
      }
      // Bump lastModified for any metadata change (title, deletedAt, folderId, workspaceId, color, etc.) to ensure sync propagates changes correctly
      if (patch.title !== undefined) shouldBumpLastModified = true
      if (patch.deletedAt !== undefined) shouldBumpLastModified = true
      if (patch.folderId !== undefined && patch.folderId !== existing.folderId) shouldBumpLastModified = true
      if (patch.workspaceId !== undefined && patch.workspaceId !== existing.workspaceId) shouldBumpLastModified = true
      if (patch.color !== undefined && patch.color !== existing.color) shouldBumpLastModified = true
      if (patch.displayName !== undefined && patch.displayName !== existing.displayName) shouldBumpLastModified = true
      if (patch.isBookmarked !== undefined && patch.isBookmarked !== existing.isBookmarked) shouldBumpLastModified = true
        if (shouldBumpLastModified) updated.lastModified = Date.now()
        return { notes: { ...state.notes, [sessionId]: updated } }
      })
    // Trigger sync after user modifies note (debounced in triggerSyncAfterUserAction)
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
  },
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
      createdFromPip: options?.createdFromPip,
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
    // Trigger sync after duplicating note
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
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
    // Trigger sync after creating folder
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
    return id
  },
  updateFolder: (folderId, patch) => {
    set((state) => {
      const folder = state.folders[folderId]
      if (!folder) return state
      const updated = { ...folder, ...patch }
      if (patch.name !== undefined) updated.displayName = undefined
      return { folders: { ...state.folders, [folderId]: updated } }
    })
    // Trigger sync after updating folder
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
  },
  removeFolder: (folderId) => {
    set((state) => {
      const folder = state.folders[folderId]
      if (!folder) return state
      const folderIdsToRemove = getFolderAndDescendantIds(folderId, state.folders)
      const now = Date.now()
      const notes = { ...state.notes }
      const trashedNoteIds = new Set<string>()
      for (const id of Object.keys(notes)) {
        const n = notes[id] as NoteData
        if (n.folderId != null && folderIdsToRemove.has(n.folderId) && n.deletedAt == null) {
          notes[id] = { ...n, deletedAt: now }
          trashedNoteIds.add(id)
        }
      }
      const folders = { ...state.folders }
      folderIdsToRemove.forEach((id) => delete folders[id])
      const selectedSidebarContext = folderIdsToRemove.has(state.selectedSidebarContext ?? '')
        ? ROOT_SENTINEL
        : state.selectedSidebarContext
      const selectedFolderIds = state.selectedFolderIds.filter((id) => !folderIdsToRemove.has(id))
      const selectedNoteId =
        state.selectedNoteId != null && trashedNoteIds.has(state.selectedNoteId)
          ? null
          : state.selectedNoteId
      return {
        folders,
        notes,
        selectedSidebarContext,
        selectedFolderIds,
        selectedNoteId,
      }
    })
    // Trigger sync after deleting folder
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
  },
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
    // Trigger sync after restoring note
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
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
    // Trigger sync after permanently deleting note
    void import('../db').then(({ db }) => 
      import('../sync').then(({ triggerSyncAfterUserAction }) => 
        triggerSyncAfterUserAction(db)
      )
    )
  },
}));
