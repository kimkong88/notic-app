import { create } from "zustand";
import type { MainContentView } from "./types";

interface UIState {
    /** Dark mode (matches notic isDarkMode) */
    isDarkMode: boolean;
    /** Sidebar collapsed (narrow strip) */
    sidebarCollapsed: boolean;
    /** Sidebar width in px when expanded */
    sidebarWidth: number;
    /** Main content: notes list+detail, settings, or integrations */
    currentView: MainContentView;
    /** When on settings view: 'main' = Settings page, 'integrations' = Integrations sub-page (for breadcrumb) */
    settingsSubView: "main" | "integrations";
    /** When true, main content shows trash (soft-deleted notes) */
    isTrashView: boolean;
    /** Note ids open in PiP (tabs); empty = PiP closed or empty state */
    openInPipNoteIds: string[];
    /** Which note is the active tab in PiP */
    openInPipActiveNoteId: string | null;
    /** When true, show modal that browser doesn't support Picture-in-Picture */
    pipUnsupportedModalOpen: boolean;
    /** Note id being edited in main detail view (null = view mode). Match extension detailEditNoteId. */
    detailEditNoteId: string | null;
    /** Anchor for note context menu (from sidebar or main detail More button). */
    noteContextMenuAnchor: { x: number; y: number; noteId: string } | null;
    /** Note id for Share modal (when set, MainContent shows Share modal). */
    shareModalNoteId: string | null;
    /** When true, show "Session expired" modal (401 after refresh failed; user is signed out). */
    sessionExpiredModalOpen: boolean;
    /** Move to folder picker: sessionId or null, optional noteIds/folderIds for multi. Null = closed. */
    moveToFolderModal: {
        sessionIdOrNull: string | null;
        noteIds?: string[];
        folderIds?: string[];
    } | null;
    /** Move to workspace picker: sessionId or null, optional noteIds. Null = closed. */
    moveToWorkspaceModal: {
        sessionIdOrNull: string | null;
        noteIds?: string[];
    } | null;
    /** Global toast message (e.g. API 5xx). Shown in Layout; clear after a few seconds or on dismiss. */
    toastMessage: string | null;
    /** When true, show "Data updated on another device. Refresh to get the latest." banner (matches extension serverNewerBanner). */
    serverNewerBannerVisible: boolean;
    /** @deprecated Sync limit modal removed - free users now have unlimited notes */
    syncLimitModalOpen: boolean;
    /** When true, tutorial is in progress (blocks real PiP opening, enables tutorial message tracking). */
    tutorialInProgress: boolean;
    /** When true, tutorial is ready for user to open a note (step 3). */
    tutorialReadyForNoteOpen: boolean;
    /** When true, show visual hint to create a note (toolbar + button). */
    tutorialShowCreateHint: boolean;
    /** PWA install prompt event (captured from beforeinstallprompt). Null if not available or already installed. */
    installPromptEvent: any | null;
    /** When true, user dismissed the install bar (stored in localStorage). */
    installBarDismissed: boolean;
    /** Mobile sidebar open state (overlay drawer). Only used on mobile breakpoint. */
    mobileSidebarOpen: boolean;
    /** Mobile bottom sheet open state. */
    bottomSheetOpen: boolean;
    /** Note ids open in the bottom sheet (tabs). */
    bottomSheetNoteIds: string[];
    /** Active note id in the bottom sheet. */
    bottomSheetActiveNoteId: string | null;
    /** Editor modal open state (fallback for non-PiP browsers on desktop). */
    editorModalOpen: boolean;
}

interface UIActions {
    setIsDarkMode: (value: boolean) => void;
    setSidebarCollapsed: (value: boolean) => void;
    setSidebarWidth: (value: number) => void;
    setCurrentView: (view: MainContentView) => void;
    setSettingsSubView: (sub: "main" | "integrations") => void;
    setIsTrashView: (value: boolean) => void;
    setOpenInPipNoteIds: (ids: string[]) => void;
    setOpenInPipActiveNoteId: (id: string | null) => void;
    /** Add a note to PiP tabs and optionally set active */
    addNoteToPip: (noteId: string, setActive?: boolean) => void;
    /** Remove a note from PiP tabs */
    removeNoteFromPip: (noteId: string) => void;
    /** Set active PiP tab */
    setPipActiveNote: (noteId: string) => void;
    setPipUnsupportedModalOpen: (value: boolean) => void;
    setDetailEditNoteId: (id: string | null) => void;
    setNoteContextMenuAnchor: (
        anchor: { x: number; y: number; noteId: string } | null
    ) => void;
    setShareModalNoteId: (id: string | null) => void;
    setSessionExpiredModalOpen: (value: boolean) => void;
    setMoveToFolderModal: (
        value: {
            sessionIdOrNull: string | null;
            noteIds?: string[];
            folderIds?: string[];
        } | null
    ) => void;
    setMoveToWorkspaceModal: (
        value: {
            sessionIdOrNull: string | null;
            noteIds?: string[];
        } | null
    ) => void;
    setToastMessage: (message: string | null) => void;
    setServerNewerBannerVisible: (value: boolean) => void;
    setSyncLimitModalOpen: (value: boolean) => void;
    setTutorialInProgress: (value: boolean) => void;
    setTutorialReadyForNoteOpen: (value: boolean) => void;
    setTutorialShowCreateHint: (value: boolean) => void;
    setInstallPromptEvent: (event: any | null) => void;
    setInstallBarDismissed: (value: boolean) => void;
    setMobileSidebarOpen: (value: boolean) => void;
    setBottomSheetOpen: (value: boolean) => void;
    setBottomSheetNoteIds: (ids: string[]) => void;
    setBottomSheetActiveNoteId: (id: string | null) => void;
    addNoteToBottomSheet: (noteId: string, setActive?: boolean) => void;
    removeNoteFromBottomSheet: (noteId: string) => void;
    setEditorModalOpen: (value: boolean) => void;
}

const SIDEBAR_WIDTH_DEFAULT = 280;
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 480;
const INSTALL_BAR_DISMISSED_KEY = "notic_installBarDismissed";

function getInstallBarDismissed(): boolean {
    try {
        return localStorage.getItem(INSTALL_BAR_DISMISSED_KEY) === "true";
    } catch {
        return false;
    }
}

function setInstallBarDismissedStorage(value: boolean): void {
    try {
        localStorage.setItem(
            INSTALL_BAR_DISMISSED_KEY,
            value ? "true" : "false"
        );
    } catch {}
}

export const useUIStore = create<UIState & UIActions>((set, get) => ({
    isDarkMode: false,
    sidebarCollapsed: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    currentView: "notes",
    settingsSubView: "main",
    isTrashView: false,
    openInPipNoteIds: [],
    openInPipActiveNoteId: null,
    pipUnsupportedModalOpen: false,
    detailEditNoteId: null,
    noteContextMenuAnchor: null,
    shareModalNoteId: null,
    sessionExpiredModalOpen: false,
    moveToFolderModal: null,
    moveToWorkspaceModal: null,
    toastMessage: null,
    serverNewerBannerVisible: false,
    syncLimitModalOpen: false,
    tutorialInProgress: false,
    tutorialReadyForNoteOpen: false,
    tutorialShowCreateHint: false,
    installPromptEvent: null,
    installBarDismissed: getInstallBarDismissed(),
    mobileSidebarOpen: false,
    bottomSheetOpen: false,
    bottomSheetNoteIds: [],
    bottomSheetActiveNoteId: null,
    editorModalOpen: false,

    setIsDarkMode: (value) => set({ isDarkMode: value }),
    setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
    setSidebarWidth: (value) =>
        set({ sidebarWidth: Math.min(SIDEBAR_WIDTH_MAX, Math.max(0, value)) }),
    setCurrentView: (view) =>
        set((_s) => ({
            currentView: view,
            ...(view === "settings"
                ? { settingsSubView: "main" as const }
                : {}),
        })),
    setSettingsSubView: (sub) => set({ settingsSubView: sub }),
    setIsTrashView: (value) => set({ isTrashView: value }),
    setOpenInPipNoteIds: (ids) =>
        set({ openInPipNoteIds: ids, openInPipActiveNoteId: ids[0] ?? null }),
    setOpenInPipActiveNoteId: (id) => set({ openInPipActiveNoteId: id }),
    addNoteToPip: (noteId, setActive = true) => {
        const { openInPipNoteIds } = get();
        if (openInPipNoteIds.includes(noteId)) {
            if (setActive) get().setOpenInPipActiveNoteId(noteId);
            return;
        }
        const next = [...openInPipNoteIds, noteId];
        set({
            openInPipNoteIds: next,
            openInPipActiveNoteId: setActive ? noteId : next[0] ?? null,
        });
    },
    removeNoteFromPip: (noteId) => {
        const { openInPipNoteIds, openInPipActiveNoteId } = get();
        const next = openInPipNoteIds.filter((id) => id !== noteId);
        const nextActive =
            openInPipActiveNoteId === noteId
                ? next[0] ?? null
                : openInPipActiveNoteId;
        set({ openInPipNoteIds: next, openInPipActiveNoteId: nextActive });
    },
    setPipActiveNote: (noteId) => set({ openInPipActiveNoteId: noteId }),
    setPipUnsupportedModalOpen: (value) =>
        set({ pipUnsupportedModalOpen: value }),
    setDetailEditNoteId: (id) => set({ detailEditNoteId: id }),
    setNoteContextMenuAnchor: (anchor) =>
        set({ noteContextMenuAnchor: anchor }),
    setShareModalNoteId: (id) => set({ shareModalNoteId: id }),
    setSessionExpiredModalOpen: (value) =>
        set({ sessionExpiredModalOpen: value }),
    setMoveToFolderModal: (value) => set({ moveToFolderModal: value }),
    setMoveToWorkspaceModal: (value) => set({ moveToWorkspaceModal: value }),
    setToastMessage: (message) => set({ toastMessage: message }),
    setServerNewerBannerVisible: (value) =>
        set({ serverNewerBannerVisible: value }),
    setSyncLimitModalOpen: (value) => set({ syncLimitModalOpen: value }),
    setTutorialInProgress: (value) => set({ tutorialInProgress: value }),
    setTutorialReadyForNoteOpen: (value) =>
        set({ tutorialReadyForNoteOpen: value }),
    setTutorialShowCreateHint: (value) =>
        set({ tutorialShowCreateHint: value }),
    setInstallPromptEvent: (event) => set({ installPromptEvent: event }),
    setInstallBarDismissed: (value) => {
        setInstallBarDismissedStorage(value);
        set({ installBarDismissed: value });
    },
    setMobileSidebarOpen: (value) => set({ mobileSidebarOpen: value }),
    setBottomSheetOpen: (value) => set({ bottomSheetOpen: value }),
    setBottomSheetNoteIds: (ids) => set({ bottomSheetNoteIds: ids }),
    setBottomSheetActiveNoteId: (id) => set({ bottomSheetActiveNoteId: id }),
    addNoteToBottomSheet: (noteId, setActive) => {
        const { bottomSheetNoteIds } = get();
        if (bottomSheetNoteIds.includes(noteId)) {
            if (setActive) set({ bottomSheetActiveNoteId: noteId });
            return;
        }
        const next = [...bottomSheetNoteIds, noteId];
        set({
            bottomSheetNoteIds: next,
            ...(setActive ? { bottomSheetActiveNoteId: noteId } : {}),
        });
    },
    setEditorModalOpen: (value) => set({ editorModalOpen: value }),
    removeNoteFromBottomSheet: (noteId) => {
        const { bottomSheetNoteIds, bottomSheetActiveNoteId } = get();
        const next = bottomSheetNoteIds.filter((id) => id !== noteId);
        const nextActive =
            bottomSheetActiveNoteId === noteId
                ? next[0] ?? null
                : bottomSheetActiveNoteId;
        set({
            bottomSheetNoteIds: next,
            bottomSheetActiveNoteId: nextActive,
            ...(next.length === 0 ? { bottomSheetOpen: false } : {}),
        });
    },
}));

export { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT };
