/**
 * Shared domain types for the app (aligned with notic dashboard-state).
 * Used by Zustand stores and components.
 */

export interface NoteData {
  sessionId: string;
  content: string;
  lastModified: number;
  createdAt: number;
  title: string;
  wordCount: number;
  folderId: string | undefined;
  displayName?: string;
  workspaceId?: string;
  hasEverHadContent?: boolean;
  /** True when note was created via PiP "Add note" (new tab). Used to delete it on PiP close if never had content. */
  createdFromPip?: boolean;
  deletedAt?: number;
  color?: string;
  isBookmarked?: boolean;
  shareCode?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  displayName?: string;
  workspaceId?: string;
  color?: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  isDefault: boolean;
  /** Single character shown in sidebar (optional). */
  icon?: string;
  /** Hex color for workspace indicator (optional). */
  color?: string;
  /** For display order: default first, then by lastModified desc. */
  lastModified?: number;
}

export const BOOKMARKS_SENTINEL = '__bookmarks__';
export const ROOT_SENTINEL = '__root__';

export type LayoutDirection = 'horizontal' | 'vertical';

export type SortOption =
  | 'created-asc'
  | 'created-desc'
  | 'modified-asc'
  | 'modified-desc'
  | 'alphabetical-asc'
  | 'alphabetical-desc';

export type MainContentView = 'notes' | 'settings' | 'integrations';

export type SelectableItem = { type: 'note'; id: string } | { type: 'folder'; id: string };
