import {
    useMemo,
    useCallback,
    useEffect,
    useRef,
    useState,
    Fragment,
} from "react";
import { createPortal } from "react-dom";
import { useUIStore, useWorkspaceStore, useNotesStore } from "../store";
import {
    Search,
    ExternalLink,
    FileText,
    Pencil,
    Check,
    Share2,
    MoreHorizontal,
    Folder as FolderIcon,
    HardDrive,
    ChevronDown,
    WifiOff,
    Cloud,
    AlertCircle,
    Loader2,
    Copy,
    Pause,
    PanelTop,
    CloudSync,
    Download,
    X,
    Menu,
} from "lucide-react";
import { SettingsView } from "./SettingsView";
import {
    getContentPreview,
    escapeHtml,
    highlightMatch,
    applySearchHighlightInElement,
    clearSearchHighlightInElement,
    stripMarkdownForDisplay,
} from "../utils/noteUtils";
import { formatDate, formatDateKey } from "../utils/dateKeys";
import {
    getFolderNoteCountRecursive,
    canAcceptFolderDrop,
} from "../utils/folderUtils";

const FOLDER_DROP_TYPE = "application/x-notic-folder-id";
import { BOOKMARKS_SENTINEL, ROOT_SENTINEL } from "../store/types";
import { useAuthStore } from "../store/useAuthStore";
import { db } from "../db";
import chromeLogo from "../assets/chrome.svg";
import edgeLogo from "../assets/edge.svg";
import braveLogo from "../assets/brave.svg";
import noticLogo from "../assets/logo.svg";
import {
    getSyncStatus,
    subscribeSyncStatus,
    getLastPullAt,
    getSyncPaused,
    setSyncPaused,
    triggerSyncAfterUserAction,
} from "../sync";
import { getSyncChangeLog } from "../sync-change-log";
import type { SyncLogEntry } from "../sync-change-log";
import { useSubscriptionStore } from "../store/useSubscriptionStore";
import { publishNote, unpublishNote, openBillingPage } from "../api/backend";
import { FREE_PIP_TAB_LIMIT } from "../constants";

const SHARE_PUBLIC_BASE =
    (typeof import.meta !== "undefined" &&
        (import.meta.env?.VITE_PUBLIC_URL as string)) ||
    "https://getnotic.io";

/** Rewrite old-format sync log messages to short friendly text (match extension sanitizeSyncLogMessage). */
function sanitizeSyncLogMessage(message: string): string {
    if (!message || message.length < 3) return message;
    const hasRawData =
        /updated from server\s*\(/i.test(message) ||
        /→\s*undefined/i.test(message) ||
        /→\s*—/i.test(message) ||
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
            message
        ) ||
        /\b(parentId|folderId|deletedAt|displayName|content|lastModified):\s*/i.test(
            message
        );
    if (hasRawData) {
        if (/^Full sync succeeded$/i.test(message.trim())) return message;
        if (/^Full sync failed/i.test(message)) return message;
        if (/^(Sync|Connecting|Downloading|Uploading)/i.test(message))
            return message;
        if (/^\s*note\s+"/i.test(message)) return "Note updated from server";
        if (/^\s*folder\s+"/i.test(message))
            return "Folder updated from server";
        if (/^\s*workspace\s+"/i.test(message))
            return "Workspace updated from server";
        return "Updated from server";
    }
    const noteMatch = message.match(/^(\s*Note\s+)"([^"]+)"(.*)$/i);
    if (noteMatch) {
        const [, prefix, quoted, suffix] = noteMatch;
        const isIdLike =
            /^[0-9a-f-]{36}$/i.test(quoted) ||
            quoted.length > 40 ||
            /^(clip_|session_)/i.test(quoted);
        if (isIdLike) return `${prefix}"Untitled note"${suffix}`;
    }
    return message;
}

/** Sync status (top right): Local / Offline / Synced / Paused, last synced, Pause/Resume, Access sync log. Matches extension. */
function SyncStatusButton({
    setCurrentView: _setCurrentView,
}: {
    setCurrentView: (view: "notes" | "settings" | "integrations") => void;
}) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [isOnline, setIsOnline] = useState(
        () => typeof navigator !== "undefined" && navigator.onLine
    );
    const [syncStatus, setSyncStatus] = useState(getSyncStatus);
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
    const [syncPaused, setSyncPausedState] = useState(false);
    const [syncLogOpen, setSyncLogOpen] = useState(false);
    const [syncLogEntries, setSyncLogEntries] = useState<SyncLogEntry[]>([]);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const authUser = useAuthStore((s) => s.user);

    useEffect(() => {
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        // Fallback: Poll navigator.onLine every 3s (DevTools offline mode doesn't always fire events)
        const pollInterval = setInterval(() => {
            setIsOnline(navigator.onLine);
        }, 3000);

        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
            clearInterval(pollInterval);
        };
    }, []);

    useEffect(() => {
        const unsub = subscribeSyncStatus(setSyncStatus);
        return unsub;
    }, []);

    useEffect(() => {
        if (!dropdownOpen) return;
        let cancelled = false;
        Promise.all([getLastPullAt(db), getSyncPaused(db)]).then(
            ([ms, paused]) => {
                if (!cancelled) {
                    setLastSyncAt(ms > 0 ? ms : null);
                    setSyncPausedState(paused);
                }
            }
        );
        return () => {
            cancelled = true;
        };
    }, [dropdownOpen, syncStatus]);

    useEffect(() => {
        if (!authUser) return;
        let cancelled = false;
        getSyncPaused(db).then((paused) => {
            if (!cancelled) setSyncPausedState(paused);
        });
        return () => {
            cancelled = true;
        };
    }, [authUser]);

    useEffect(() => {
        if (!dropdownOpen) return;
        const close = (e: MouseEvent) => {
            if (
                wrapperRef.current &&
                !wrapperRef.current.contains(e.target as Node)
            ) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [dropdownOpen]);

    const handlePauseResume = useCallback(async () => {
        // Only allow pausing/resuming when signed in
        if (!authUser) return;

        const paused = await getSyncPaused(db);
        if (paused) {
            await setSyncPaused(db, false);
            setSyncPausedState(false);
        } else {
            await setSyncPaused(db, true);
            setSyncPausedState(true);
        }
    }, [authUser]);

    const handleAccessSyncLog = useCallback(() => {
        setDropdownOpen(false);
        getSyncChangeLog(db).then((entries) => {
            setSyncLogEntries(entries);
            setSyncLogOpen(true);
        });
    }, []);

    const isSignedIn = !!authUser;
    const statusLabel =
        syncStatus === "syncing"
            ? "Syncing..."
            : syncStatus === "failed"
            ? "Sync failed"
            : syncPaused
            ? "Paused"
            : !isSignedIn
            ? "Local"
            : !isOnline
            ? "Offline"
            : "Synced";
    const statusTitle =
        syncStatus === "syncing"
            ? "Syncing with cloud..."
            : syncStatus === "failed"
            ? "Sync failed – will retry on next sign-in or reload"
            : syncPaused
            ? "Sync paused for debugging"
            : !isSignedIn
            ? "Notes stored locally only"
            : !isOnline
            ? "Offline – sync will resume when back online"
            : "Synced with cloud";
    const StatusIcon =
        syncStatus === "syncing"
            ? Loader2
            : syncStatus === "failed"
            ? AlertCircle
            : syncPaused
            ? Pause
            : !isSignedIn
            ? HardDrive
            : !isOnline
            ? WifiOff
            : Cloud;
    const syncStatusClass =
        syncStatus === "syncing"
            ? "syncing"
            : syncStatus === "failed"
            ? "failed"
            : syncStatus === "synced"
            ? "synced"
            : "";

    const lastSyncText = lastSyncAt ? formatDate(lastSyncAt) : "Never";
    const showPauseResume = isSignedIn && isOnline;
    const displayStatusLabel = syncPaused
        ? "Paused"
        : !isOnline
        ? "Offline"
        : syncStatus === "synced"
        ? "Synced"
        : syncStatus === "failed"
        ? "Sync failed"
        : syncStatus === "syncing"
        ? "Syncing…"
        : "Local";

    return (
        <div
            className="sync-status-wrapper"
            id="syncStatusWrapper"
            ref={wrapperRef}
            onClick={(e) => e.stopPropagation()}
        >
            <button
                type="button"
                className={`sync-status sync-status-trigger${
                    syncStatusClass ? ` ${syncStatusClass}` : ""
                }${!isSignedIn ? " sync-status-no-dropdown" : ""}`}
                id="syncStatus"
                aria-expanded={dropdownOpen}
                aria-haspopup={isSignedIn}
                aria-label="Sync status"
                title={statusTitle}
                onClick={() => {
                    // Only allow dropdown when signed in
                    if (isSignedIn) {
                        setDropdownOpen((prev) => !prev);
                    }
                }}
            >
                <StatusIcon
                    className="sync-status-icon"
                    size={12}
                    aria-hidden
                />
                <span className="sync-status-text">{statusLabel}</span>
                <ChevronDown
                    className="sync-status-chevron"
                    size={12}
                    aria-hidden
                />
            </button>
            <div
                className="sync-status-dropdown"
                id="syncStatusDropdown"
                role="menu"
                hidden={!dropdownOpen}
            >
                <div
                    className="sync-status-dropdown-row sync-status-dropdown-row--disabled"
                    role="menuitem"
                    aria-disabled="true"
                >
                    <span className="sync-status-dropdown-label">
                        Last synced
                    </span>
                    <span
                        className="sync-status-dropdown-value"
                        id="syncStatusLastSynced"
                    >
                        {lastSyncText} · {displayStatusLabel}
                    </span>
                </div>
                {showPauseResume && (
                    <button
                        type="button"
                        className="sync-status-dropdown-row sync-status-dropdown-action"
                        role="menuitem"
                        onClick={(e) => {
                            e.stopPropagation();
                            void handlePauseResume();
                        }}
                    >
                        {syncPaused ? "Resume sync" : "Pause sync"}
                    </button>
                )}
                {isSignedIn && (
                    <button
                        type="button"
                        className="sync-status-dropdown-row sync-status-dropdown-action"
                        role="menuitem"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleAccessSyncLog();
                        }}
                    >
                        Access sync log
                    </button>
                )}
            </div>

            {/* Sync log modal (match extension: same structure and classes) */}
            {syncLogOpen && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="sync-log-title"
                    onClick={() => setSyncLogOpen(false)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") setSyncLogOpen(false);
                    }}
                >
                    <div
                        className="modal modal-sync-log"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <h3 id="sync-log-title" className="modal-title">
                                Sync log
                            </h3>
                            <p className="modal-message">
                                Recent sync events for this device.
                            </p>
                        </div>
                        <div className="modal-folder-picker-list scrollbar-branded modal-sync-log-list">
                            {syncLogEntries.length === 0 ? (
                                <div className="modal-sync-log-empty">
                                    No sync events yet.
                                </div>
                            ) : (
                                [...syncLogEntries]
                                    .sort((a, b) => b.at - a.at)
                                    .map((e) => (
                                        <div
                                            key={`${e.at}-${e.message}`}
                                            className="modal-sync-log-item"
                                        >
                                            <span className="modal-sync-log-time">
                                                {formatDate(e.at)}
                                            </span>
                                            <span className="modal-sync-log-message">
                                                {sanitizeSyncLogMessage(
                                                    e.message
                                                )}
                                            </span>
                                        </div>
                                    ))
                            )}
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="modal-btn modal-btn-secondary"
                                id="modalSyncLogClose"
                                onClick={() => setSyncLogOpen(false)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
import type { NoteData, SortOption, Folder } from "../store/types";
import {
    isDocumentPipSupported,
    openPipWithNote,
    openTutorialPip,
    getPipWindow,
    sendNotesUpdateToPip,
    requestPipFlushSave,
} from "../pip/documentPip";
import { trackEvent } from "../analytics";
import { NoteEditor } from "./NoteEditor";

type BreadcrumbClick =
    | "workspace"
    | "recent"
    | "folders"
    | "trash"
    | "bookmarks"
    | "date"
    | "folder"
    | "note"
    | "settings"
    | "integrations";
interface BreadcrumbItem {
    text: string;
    active: boolean;
    click?: BreadcrumbClick;
    id?: string;
}

function getFolderPath(
    folderId: string | null,
    folders: Record<string, Folder>
): Array<{ id: string; name: string }> {
    if (!folderId || folderId === ROOT_SENTINEL) return [];
    const path: Array<{ id: string; name: string }> = [];
    let f: Folder | undefined = folders[folderId];
    while (f) {
        path.unshift({ id: f.id, name: f.displayName ?? f.name });
        f = f.parentId ? folders[f.parentId] : undefined;
    }
    return path;
}

function formatBreadcrumbDate(dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

function sortNotes(notes: NoteData[], sort: SortOption): NoteData[] {
    return [...notes].sort((a, b) => {
        switch (sort) {
            case "created-asc":
                return a.createdAt - b.createdAt;
            case "created-desc":
                return b.createdAt - a.createdAt;
            case "modified-asc":
                return a.lastModified - b.lastModified;
            case "modified-desc":
                return b.lastModified - a.lastModified;
            case "alphabetical-asc":
                return (a.displayName || a.title).localeCompare(
                    b.displayName || b.title
                );
            case "alphabetical-desc":
                return (b.displayName || b.title).localeCompare(
                    a.displayName || a.title
                );
            default:
                return b.lastModified - a.lastModified;
        }
    });
}

export function MainContent() {
    const currentView = useUIStore((s) => s.currentView);
    const isDarkMode = useUIStore((s) => s.isDarkMode);
    const openInPipNoteIds = useUIStore((s) => s.openInPipNoteIds);
    const openInPipActiveNoteId = useUIStore((s) => s.openInPipActiveNoteId);
    const addNoteToPip = useUIStore((s) => s.addNoteToPip);
    const setOpenInPipActiveNoteId = useUIStore(
        (s) => s.setOpenInPipActiveNoteId
    );
    const searchQuery = useNotesStore((s) => s.searchQuery);
    const setSearchQuery = useNotesStore((s) => s.setSearchQuery);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const currentTab = useNotesStore((s) => s.currentTab);
    const notes = useNotesStore((s) => s.notes);
    const folders = useNotesStore((s) => s.folders);
    const sort = useNotesStore((s) => s.sort);
    const selectedNoteId = useNotesStore((s) => s.selectedNoteId);
    const setSelectedNoteId = useNotesStore((s) => s.setSelectedNoteId);
    const selectedSidebarContext = useNotesStore(
        (s) => s.selectedSidebarContext
    );
    const setCurrentTab = useNotesStore((s) => s.setCurrentTab);
    const setSelectedSidebarContext = useNotesStore(
        (s) => s.setSelectedSidebarContext
    );
    const updateNote = useNotesStore((s) => s.updateNote);
    const duplicateNote = useNotesStore((s) => s.duplicateNote);
    const updateFolder = useNotesStore((s) => s.updateFolder);
    /** Derive tab-specific context from unified selectedSidebarContext (date key on Recent, folder id on Folders). */
    const selectedFolderDate =
        currentTab === "recent" ? selectedSidebarContext : null;
    const selectedFolderId =
        currentTab === "folders" ? selectedSidebarContext : null;
    const restoreNote = useNotesStore((s) => s.restoreNote);
    const removeNote = useNotesStore((s) => s.removeNote);
    const addNote = useNotesStore((s) => s.addNote);

    const setPipUnsupportedModalOpen = useUIStore(
        (s) => s.setPipUnsupportedModalOpen
    );
    const isTrashView = useUIStore((s) => s.isTrashView);
    const setIsTrashView = useUIStore((s) => s.setIsTrashView);
    const setCurrentView = useUIStore((s) => s.setCurrentView);
    const settingsSubView = useUIStore((s) => s.settingsSubView);
    const setSettingsSubView = useUIStore((s) => s.setSettingsSubView);
    const detailEditNoteId = useUIStore((s) => s.detailEditNoteId);
    const setDetailEditNoteId = useUIStore((s) => s.setDetailEditNoteId);
    const noteContextMenuAnchor = useUIStore((s) => s.noteContextMenuAnchor);
    const setNoteContextMenuAnchor = useUIStore(
        (s) => s.setNoteContextMenuAnchor
    );
    const setMoveToFolderModal = useUIStore((s) => s.setMoveToFolderModal);
    const shareModalNoteId = useUIStore((s) => s.shareModalNoteId);
    const setShareModalNoteId = useUIStore((s) => s.setShareModalNoteId);
    const setToastMessage = useUIStore((s) => s.setToastMessage);
    const authUser = useAuthStore((s) => s.user);
    const installPromptEvent = useUIStore((s) => s.installPromptEvent);
    const installBarDismissed = useUIStore((s) => s.installBarDismissed);
    const setInstallBarDismissed = useUIStore((s) => s.setInstallBarDismissed);
    const setInstallPromptEvent = useUIStore((s) => s.setInstallPromptEvent);
    const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);

    const handleInstall = useCallback(async () => {
        if (!installPromptEvent) return;
        try {
            await installPromptEvent.prompt();
            const result = await installPromptEvent.userChoice;
            if (result.outcome === "accepted") {
                setInstallPromptEvent(null);
                setInstallBarDismissed(true);
            }
        } catch (e) {
            console.error("Install prompt failed", e);
        }
    }, [installPromptEvent, setInstallPromptEvent, setInstallBarDismissed]);

    const handleDismissInstallBar = useCallback(() => {
        setInstallBarDismissed(true);
    }, [setInstallBarDismissed]);

    const [proRequiredModal, setProRequiredModal] = useState<{
        title: string;
        message: string;
    } | null>(null);
    const [sharePublishLoading, setSharePublishLoading] = useState(false);
    const [shareUnpublishConfirm, setShareUnpublishConfirm] = useState(false);
    const [shareToast, setShareToast] = useState<string | null>(null);
    const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
        type: "single" | "emptyTrash";
        noteId?: string;
        noteName?: string;
        count?: number;
    } | null>(null);
    const tutorialInProgress = useUIStore((s) => s.tutorialInProgress);
    const setTutorialInProgress = useUIStore((s) => s.setTutorialInProgress);
    const tutorialReadyForNoteOpen = useUIStore(
        (s) => s.tutorialReadyForNoteOpen
    );
    const setTutorialReadyForNoteOpen = useUIStore(
        (s) => s.setTutorialReadyForNoteOpen
    );
    const setTutorialShowCreateHint = useUIStore(
        (s) => s.setTutorialShowCreateHint
    );
    const [showCelebration, setShowCelebration] = useState(false);

    // Close Share modal if the note was removed
    useEffect(() => {
        if (shareModalNoteId != null && notes[shareModalNoteId] == null) {
            setShareModalNoteId(null);
            setShareUnpublishConfirm(false);
        }
    }, [shareModalNoteId, notes, setShareModalNoteId]);

    // Auto-dismiss share toast after 2s
    useEffect(() => {
        if (shareToast == null) return;
        const t = setTimeout(() => setShareToast(null), 2000);
        return () => clearTimeout(t);
    }, [shareToast]);

    // Listen for tutorial task completion from PiP
    useEffect(() => {
        const handler = (e: MessageEvent) => {
            const d = e.data;
            if (
                d &&
                d.type === "tutorial-task-completed" &&
                d.taskId === "float-test"
            ) {
                setShowCelebration(true);
                setToastMessage("Nice! 🎉 This window floats above everything");
                setTimeout(() => setShowCelebration(false), 3000);
            }
            if (
                d &&
                d.type === "tutorial-task-completed" &&
                d.taskId === "tab-customization"
            ) {
                setShowCelebration(true);
                setToastMessage("Great! 🎨 You can personalize every tab");
                setTimeout(() => setShowCelebration(false), 3000);
            }
            if (d && d.type === "tutorial-ready-for-note-open") {
                setTutorialReadyForNoteOpen(true);
                if (import.meta.env.DEV) {
                    console.log("[Tutorial] Ready for note opening step");
                }
            }
            if (d && d.type === "tutorial-show-create-hint") {
                setTutorialShowCreateHint(d.show);
                if (import.meta.env.DEV) {
                    console.log("[Tutorial] Show create hint:", d.show);
                }
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [
        setToastMessage,
        setTutorialReadyForNoteOpen,
        setTutorialShowCreateHint,
    ]);

    // Track visibility changes when tutorial is active to detect tab switching
    useEffect(() => {
        if (!tutorialInProgress) return;

        let hasLeftTab = false;

        const handleVisibilityChange = () => {
            if (import.meta.env.DEV) {
                console.log(
                    "[Tutorial] Visibility changed. document.hidden:",
                    document.hidden
                );
            }

            if (document.hidden) {
                hasLeftTab = true;
                if (import.meta.env.DEV) {
                    console.log("[Tutorial] User left Notic tab");
                }
                // Notify PiP that user left (step 1 of 2)
                const pipWin = getPipWindow();
                if (pipWin && !pipWin.closed) {
                    try {
                        pipWin.postMessage(
                            { type: "notic-pip-tutorial-tab-left" },
                            "*"
                        );
                    } catch {
                        // Ignore
                    }
                }
            } else if (hasLeftTab) {
                if (import.meta.env.DEV) {
                    console.log(
                        "[Tutorial] User returned to Notic tab, sending message to PiP"
                    );
                }
                // User returned to Notic tab after leaving - send to PiP
                const pipWin = getPipWindow();
                if (pipWin && !pipWin.closed) {
                    try {
                        pipWin.postMessage(
                            { type: "notic-pip-tutorial-tab-returned" },
                            "*"
                        );
                        if (import.meta.env.DEV) {
                            console.log(
                                "[Tutorial] Message sent to PiP window"
                            );
                        }
                    } catch (e) {
                        if (import.meta.env.DEV) {
                            console.error(
                                "[Tutorial] Failed to send message to PiP:",
                                e
                            );
                        }
                    }
                } else {
                    if (import.meta.env.DEV) {
                        console.log(
                            "[Tutorial] PiP window not found or closed"
                        );
                    }
                }
                hasLeftTab = false;
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () =>
            document.removeEventListener(
                "visibilitychange",
                handleVisibilityChange
            );
    }, [tutorialInProgress]);

    // Clear detail edit mode when switching to a different note (match extension behavior)
    useEffect(() => {
        if (
            selectedNoteId != null &&
            detailEditNoteId != null &&
            detailEditNoteId !== selectedNoteId
        ) {
            setDetailEditNoteId(null);
        }
    }, [selectedNoteId, detailEditNoteId, setDetailEditNoteId]);

    const detailContentRef = useRef<HTMLDivElement | null>(null);

    // Apply search highlight in read-only detail view when searchQuery is set
    useEffect(() => {
        const container = detailContentRef.current;
        if (!container) return;
        const contentEl = container.querySelector(
            ".note-editor-content-editable"
        ) as HTMLElement | null;
        if (
            !searchQuery.trim() ||
            !selectedNoteId ||
            detailEditNoteId === selectedNoteId
        ) {
            if (contentEl) clearSearchHighlightInElement(contentEl);
            return;
        }
        if (!contentEl) return;
        const t = setTimeout(() => {
            applySearchHighlightInElement(contentEl, searchQuery.trim());
        }, 150);
        return () => {
            clearTimeout(t);
            const c = detailContentRef.current;
            const el = c?.querySelector(
                ".note-editor-content-editable"
            ) as HTMLElement | null;
            if (el) clearSearchHighlightInElement(el);
        };
    }, [searchQuery, selectedNoteId, detailEditNoteId]);

    // Close detail-view note context menu on outside click or Escape
    const isDetailNoteMenuOpen =
        noteContextMenuAnchor != null &&
        selectedNoteId != null &&
        noteContextMenuAnchor.noteId === selectedNoteId;
    useEffect(() => {
        if (!isDetailNoteMenuOpen) return;
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent) {
                if (e.key !== "Escape") return;
            } else {
                const target = e.target as Node;
                if (
                    document
                        .querySelector("[data-context-menu-trigger]")
                        ?.contains(target) ||
                    document
                        .querySelector(".pip-context-menu.show")
                        ?.contains(target)
                )
                    return;
            }
            setNoteContextMenuAnchor(null);
        };
        document.addEventListener("mousedown", close, true);
        document.addEventListener("keydown", close, true);
        return () => {
            document.removeEventListener("mousedown", close, true);
            document.removeEventListener("keydown", close, true);
        };
    }, [isDetailNoteMenuOpen, setNoteContextMenuAnchor]);

    const pipWindow = getPipWindow();
    const pipIsOpen = pipWindow != null && !pipWindow.closed;

    const openNoteInPip = (note: {
        sessionId: string;
        title?: string;
        content?: string;
    }) => {
        if (!isDocumentPipSupported()) {
            setPipUnsupportedModalOpen(true);
            return;
        }
        const noteId = note.sessionId;
        const ui = useUIStore.getState();
        if (ui.detailEditNoteId === noteId) {
            ui.setToastMessage("Finish editing in main view first.");
            return;
        }
        const ids = ui.openInPipNoteIds;
        const isSubscribed = useSubscriptionStore.getState().isSubscribed;
        const atLimit =
            isSubscribed !== true &&
            ids.length >= FREE_PIP_TAB_LIMIT &&
            !ids.includes(noteId);
        if (atLimit) {
            // Replace oldest tab so the new note opens and the previous newest remains
            const newIds = [...ids.slice(1), noteId];
            ui.setOpenInPipNoteIds(newIds);
            ui.setOpenInPipActiveNoteId(noteId);
            ui.setToastMessage(
                `Replaced oldest tab (${FREE_PIP_TAB_LIMIT} tabs on free plan). Upgrade to open more.`
            );
        } else {
            addNoteToPip(noteId, true);
            setOpenInPipActiveNoteId(noteId);
        }

        if (pipWindow && !pipWindow.closed) {
            const state = useUIStore.getState();
            const notes = useNotesStore.getState().notes;
            const noteTitles: Record<string, string> = {};
            const noteColors: Record<string, string> = {};
            state.openInPipNoteIds.forEach((id) => {
                const n = notes[id];
                noteTitles[id] = n?.displayName ?? n?.title ?? "Untitled";
                if (n?.color) noteColors[id] = n.color;
            });
            sendNotesUpdateToPip(
                state.openInPipNoteIds,
                state.openInPipActiveNoteId,
                { noteTitles, noteColors }
            );
            return;
        }

        const state = useUIStore.getState();
        void openPipWithNote(null, {
            isDarkMode,
            onClose: () => {
                const ids = useUIStore.getState().openInPipNoteIds;
                const notes = useNotesStore.getState().notes;
                const removeNote = useNotesStore.getState().removeNote;
                ids.forEach((id) => {
                    const n = notes[id];
                    if (
                        n?.createdFromPip === true &&
                        n.hasEverHadContent !== true
                    )
                        removeNote(id);
                });
                useUIStore.getState().setOpenInPipNoteIds([]);
                useUIStore.getState().setOpenInPipActiveNoteId(null);
            },
            noteIds: state.openInPipNoteIds,
            activeId: state.openInPipActiveNoteId,
            onError: () => setPipUnsupportedModalOpen(true),
        });
    };

    const closeNoteInPip = (noteSessionId: string) => {
        useUIStore.getState().removeNoteFromPip(noteSessionId);
        const win = getPipWindow();
        if (win && !win.closed) {
            const ui = useUIStore.getState();
            const notes = useNotesStore.getState().notes;
            const noteTitles: Record<string, string> = {};
            const noteColors: Record<string, string> = {};
            const notePayloads: Record<
                string,
                {
                    content?: string;
                    title?: string;
                    displayName?: string;
                    color?: string;
                    workspaceId?: string;
                }
            > = {};
            ui.openInPipNoteIds.forEach((id) => {
                const n = notes[id];
                noteTitles[id] = n?.displayName ?? n?.title ?? "Untitled";
                if (n?.color) noteColors[id] = n.color;
                notePayloads[id] = {
                    content: n?.content ?? "",
                    title: n?.title ?? "Untitled",
                    displayName: n?.displayName,
                    color: n?.color,
                    workspaceId: n?.workspaceId,
                };
            });
            sendNotesUpdateToPip(
                ui.openInPipNoteIds,
                ui.openInPipActiveNoteId,
                { noteTitles, noteColors, notePayloads }
            );
        }
    };

    const workspaceName =
        currentWorkspaceId && workspaces[currentWorkspaceId]
            ? workspaces[currentWorkspaceId].name
            : "Personal";

    const defaultWsId = currentWorkspaceId ?? "workspace_1";
    const defaultWsIdStr = String(defaultWsId);
    const allNotesInWorkspace = useMemo(
        () =>
            Object.values(notes).filter(
                (n) =>
                    !n.deletedAt &&
                    String(n.workspaceId ?? "workspace_1") === defaultWsIdStr
            ),
        [notes, defaultWsIdStr]
    );

    const trashNotesInWorkspace = useMemo(() => {
        const deleted = Object.values(notes).filter(
            (n) =>
                n.deletedAt != null &&
                String(n.workspaceId ?? "workspace_1") === defaultWsIdStr
        );
        return [...deleted].sort(
            (a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)
        );
    }, [notes, defaultWsIdStr]);

    const foldersInWorkspace = useMemo(
        () =>
            Object.values(folders).filter(
                (f) => String(f.workspaceId ?? "workspace_1") === defaultWsIdStr
            ),
        [folders, defaultWsIdStr]
    );

    /** Folder view: only current workspace's notes and folders (no fallback to all data). */
    const notesForFolderView = allNotesInWorkspace;
    const foldersForFolderView = foldersInWorkspace;

    type FolderViewItem =
        | { type: "folder"; data: Folder }
        | { type: "note"; data: NoteData };
    const folderViewItems = useMemo((): FolderViewItem[] => {
        if (currentTab !== "folders") return [];
        const folderlessNotes = notesForFolderView.filter(
            (n) => !n.folderId || !folders[n.folderId]
        );
        if (
            selectedFolderId &&
            selectedFolderId !== ROOT_SENTINEL &&
            folders[selectedFolderId]
        ) {
            const subfolders = foldersForFolderView
                .filter((f) => f.parentId === selectedFolderId)
                .sort((a, b) =>
                    (a.displayName ?? a.name).localeCompare(
                        b.displayName ?? b.name
                    )
                );
            const notesInFolder = sortNotes(
                notesForFolderView.filter(
                    (n) => (n.folderId ?? null) === selectedFolderId
                ),
                sort
            );
            return [
                ...subfolders.map((f) => ({
                    type: "folder" as const,
                    data: f,
                })),
                ...notesInFolder.map((n) => ({
                    type: "note" as const,
                    data: n,
                })),
            ];
        }
        const rootFolders = foldersForFolderView
            .filter((f) => f.parentId === null)
            .sort((a, b) =>
                (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
            );
        const sortedFolderless = sortNotes(folderlessNotes, sort);
        return [
            ...rootFolders.map((f) => ({ type: "folder" as const, data: f })),
            ...sortedFolderless.map((n) => ({
                type: "note" as const,
                data: n,
            })),
        ];
    }, [
        currentTab,
        selectedFolderId,
        folders,
        foldersForFolderView,
        notesForFolderView,
        sort,
    ]);

    const filteredAndSortedNotes = useMemo(() => {
        if (searchQuery.trim()) {
            const q = searchQuery.trim().toLowerCase();
            const matching = allNotesInWorkspace.filter(
                (n) =>
                    (n.title || "").toLowerCase().includes(q) ||
                    (n.displayName || "").toLowerCase().includes(q) ||
                    (n.content || "").toLowerCase().includes(q)
            );
            return sortNotes(matching, sort);
        }
        if (currentTab === "recent") {
            if (!selectedFolderDate) return [];
            if (selectedFolderDate === BOOKMARKS_SENTINEL) {
                return sortNotes(
                    allNotesInWorkspace.filter((n) => n.isBookmarked),
                    sort
                );
            }
            return sortNotes(
                allNotesInWorkspace.filter(
                    (n) => formatDateKey(n.lastModified) === selectedFolderDate
                ),
                sort
            );
        }
        if (currentTab === "folders") {
            if (selectedFolderId === BOOKMARKS_SENTINEL) {
                return sortNotes(
                    allNotesInWorkspace.filter((n) => n.isBookmarked),
                    sort
                );
            }
            const folderId = selectedFolderId || null;
            const inFolder = allNotesInWorkspace.filter(
                (n) => (n.folderId ?? null) === folderId
            );
            return sortNotes(inFolder, sort);
        }
        return [];
    }, [
        allNotesInWorkspace,
        searchQuery,
        currentTab,
        selectedFolderDate,
        selectedFolderId,
        sort,
    ]);

    const selectedNote =
        selectedNoteId != null ? notes[selectedNoteId] ?? null : null;

    const handleRowClick = (note: NoteData) => {
        requestPipFlushSave();
        setSelectedNoteId(note.sessionId);
    };

    const handleFolderRowClick = (folderId: string) => {
        requestPipFlushSave();
        setSelectedSidebarContext(folderId);
        setSelectedNoteId(null);
    };

    const handlePipIconClick = (e: React.MouseEvent, note: NoteData) => {
        e.stopPropagation();

        const isOpenInPip = openInPipNoteIds.includes(note.sessionId);
        const shouldDisable = isOpenInPip && pipIsOpen;
        if (shouldDisable) return;
        if (isOpenInPip) closeNoteInPip(note.sessionId);
        else {
            // Block note opening during tutorial until it's time
            if (tutorialInProgress && !tutorialReadyForNoteOpen) {
                setToastMessage(
                    "Follow the tutorial steps in the floating window first"
                );
                return;
            }

            // Tutorial tracking: close tutorial PiP and show confetti before opening real editor
            if (tutorialInProgress && tutorialReadyForNoteOpen) {
                const pipWin = getPipWindow();
                if (pipWin && !pipWin.closed) {
                    try {
                        pipWin.close();
                    } catch {}
                }
                setTutorialInProgress(false);
                setTutorialReadyForNoteOpen(false);
                setTutorialShowCreateHint(false);
                setShowCelebration(true);
                setToastMessage("Perfect! 🎉 You're ready to use Notic");
                setTimeout(() => setShowCelebration(false), 3000);
            }

            openNoteInPip(note);
        }
    };

    const saveNoteContentDebounceRef = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const SAVE_DEBOUNCE_MS = 700;

    const handleNoteDetailContentChange = useCallback(
        (content: string) => {
            if (!selectedNoteId) return;
            if (saveNoteContentDebounceRef.current)
                clearTimeout(saveNoteContentDebounceRef.current);
            saveNoteContentDebounceRef.current = setTimeout(() => {
                saveNoteContentDebounceRef.current = null;
                updateNote(selectedNoteId, { content });
                // Note: sync is triggered only on flush (when user exits editor), not on every change
            }, SAVE_DEBOUNCE_MS);
        },
        [selectedNoteId, updateNote]
    );

    const handleNoteDetailFlush = useCallback(
        (content: string) => {
            if (saveNoteContentDebounceRef.current) {
                clearTimeout(saveNoteContentDebounceRef.current);
                saveNoteContentDebounceRef.current = null;
            }
            if (selectedNoteId) {
                updateNote(selectedNoteId, { content });
                triggerSyncAfterUserAction(db);
            }
        },
        [selectedNoteId, updateNote]
    );

    const draggedFolderIdRef = useRef<string | null>(null);

    const clearMainListDragOver = useCallback(() => {
        document
            .querySelectorAll(".main-notes-list .drag-over")
            .forEach((el) => el.classList.remove("drag-over"));
    }, []);

    const handleNoteDragStart = useCallback(
        (e: React.DragEvent, sessionId: string) => {
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", sessionId);
                e.currentTarget.classList.add("dragging");
            }
        },
        []
    );

    const handleNoteDragEnd = useCallback(
        (e: React.DragEvent) => {
            e.currentTarget.classList.remove("dragging");
            clearMainListDragOver();
        },
        [clearMainListDragOver]
    );

    const handleFolderDragStart = useCallback(
        (e: React.DragEvent, folderId: string) => {
            draggedFolderIdRef.current = folderId;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData(FOLDER_DROP_TYPE, folderId);
                e.currentTarget.classList.add("dragging");
            }
        },
        []
    );

    const handleFolderDragEnd = useCallback(
        (e: React.DragEvent) => {
            draggedFolderIdRef.current = null;
            e.currentTarget.classList.remove("dragging");
            clearMainListDragOver();
        },
        [clearMainListDragOver]
    );

    const handleFolderRowDragOver = useCallback(
        (e: React.DragEvent, targetFolderId: string) => {
            const types = e.dataTransfer?.types ?? [];
            if (types.includes(FOLDER_DROP_TYPE)) {
                const draggedId = draggedFolderIdRef.current;
                if (
                    draggedId &&
                    canAcceptFolderDrop(draggedId, targetFolderId, folders)
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    e.currentTarget.classList.add("drag-over");
                }
            } else {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                e.currentTarget.classList.add("drag-over");
            }
        },
        [folders]
    );

    const handleFolderRowDragLeave = useCallback((e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            e.currentTarget.classList.remove("drag-over");
        }
    }, []);

    const handleFolderRowDrop = useCallback(
        (e: React.DragEvent, targetFolderId: string) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.classList.remove("drag-over");
            const folderId = e.dataTransfer?.getData(FOLDER_DROP_TYPE);
            if (
                folderId &&
                canAcceptFolderDrop(folderId, targetFolderId, folders)
            ) {
                updateFolder(folderId, { parentId: targetFolderId });
                return;
            }
            const sessionId = e.dataTransfer?.getData("text/plain");
            if (sessionId) {
                updateNote(sessionId, { folderId: targetFolderId });
            }
        },
        [updateFolder, updateNote, folders]
    );

    const breadcrumbItems = useMemo((): BreadcrumbItem[] => {
        const items: BreadcrumbItem[] = [];
        items.push({ text: workspaceName, active: false, click: "workspace" });

        if (currentView === "settings") {
            items.push({
                text: "Settings",
                active: settingsSubView === "main",
                click: "settings",
            });
            if (settingsSubView === "integrations") {
                items.push({ text: "Integrations", active: true });
            }
            return items;
        }

        if (isTrashView) {
            items.push({
                text: "Trash",
                active: !selectedNoteId,
                click: "trash",
            });
            if (selectedNoteId && selectedNote) {
                items.push({
                    text: `${
                        (selectedNote.displayName ?? selectedNote.title) ||
                        "Untitled"
                    }.md`,
                    active: true,
                    click: "note",
                    id: selectedNoteId,
                });
            }
            return items;
        }

        if (currentTab === "recent") {
            if (searchQuery.trim()) {
                items.push({ text: "Recent", active: false, click: "recent" });
                items.push({ text: `Search: "${searchQuery}"`, active: true });
            } else if (selectedFolderDate) {
                items.push({ text: "Recent", active: false, click: "recent" });
                if (selectedFolderDate === BOOKMARKS_SENTINEL) {
                    if (selectedNoteId && selectedNote) {
                        items.push({
                            text: "Bookmarks",
                            active: false,
                            click: "bookmarks",
                            id: BOOKMARKS_SENTINEL,
                        });
                        items.push({
                            text: `${stripMarkdownForDisplay(
                                (selectedNote.displayName ??
                                    selectedNote.title) ||
                                    "Untitled"
                            )}.md`,
                            active: true,
                            click: "note",
                            id: selectedNoteId,
                        });
                    } else {
                        items.push({
                            text: "Bookmarks",
                            active: true,
                            click: "bookmarks",
                            id: BOOKMARKS_SENTINEL,
                        });
                    }
                } else {
                    const formattedDate =
                        formatBreadcrumbDate(selectedFolderDate);
                    if (selectedNoteId && selectedNote) {
                        items.push({
                            text: formattedDate,
                            active: false,
                            click: "date",
                            id: selectedFolderDate,
                        });
                        items.push({
                            text: `${stripMarkdownForDisplay(
                                (selectedNote.displayName ??
                                    selectedNote.title) ||
                                    "Untitled"
                            )}.md`,
                            active: true,
                            click: "note",
                            id: selectedNoteId,
                        });
                    } else {
                        items.push({
                            text: formattedDate,
                            active: true,
                            click: "date",
                            id: selectedFolderDate,
                        });
                    }
                }
            } else {
                items.push({ text: "Recent", active: true, click: "recent" });
            }
        } else {
            items.push({ text: "Folders", active: false, click: "folders" });
            if (selectedFolderId === BOOKMARKS_SENTINEL) {
                if (selectedNoteId && selectedNote) {
                    items.push({
                        text: "Bookmarks",
                        active: false,
                        click: "bookmarks",
                        id: BOOKMARKS_SENTINEL,
                    });
                    items.push({
                        text: `${
                            (selectedNote.displayName ?? selectedNote.title) ||
                            "Untitled"
                        }.md`,
                        active: true,
                        click: "note",
                        id: selectedNoteId,
                    });
                } else {
                    items.push({
                        text: "Bookmarks",
                        active: true,
                        click: "bookmarks",
                        id: BOOKMARKS_SENTINEL,
                    });
                }
            } else if (
                selectedFolderId === ROOT_SENTINEL ||
                selectedFolderId === null
            ) {
                if (selectedNoteId && selectedNote) {
                    items.push({
                        text: "Root",
                        active: false,
                        click: "folder",
                        id: ROOT_SENTINEL,
                    });
                    items.push({
                        text: `${
                            (selectedNote.displayName ?? selectedNote.title) ||
                            "Untitled"
                        }.md`,
                        active: true,
                        click: "note",
                        id: selectedNoteId,
                    });
                } else {
                    items.push({
                        text: "Root",
                        active: true,
                        click: "folder",
                        id: ROOT_SENTINEL,
                    });
                }
            } else if (selectedFolderId) {
                const path = getFolderPath(selectedFolderId, folders);
                if (path.length > 0) {
                    path.forEach((p, i) => {
                        const isLastFolder =
                            i === path.length - 1 && !selectedNoteId;
                        items.push({
                            text: p.name,
                            active: isLastFolder,
                            click: "folder",
                            id: p.id,
                        });
                    });
                    if (selectedNoteId && selectedNote) {
                        if (items.length > 0)
                            items[items.length - 1].active = false;
                        items.push({
                            text: `${stripMarkdownForDisplay(
                                (selectedNote.displayName ??
                                    selectedNote.title) ||
                                    "Untitled"
                            )}.md`,
                            active: true,
                            click: "note",
                            id: selectedNoteId,
                        });
                    }
                } else {
                    // Folder not found (e.g. deleted); show Folders as active
                    items[items.length - 1] = {
                        ...items[items.length - 1],
                        active: true,
                    };
                }
            } else {
                items.push({ text: "Folders", active: true, click: "folders" });
            }
        }
        return items;
    }, [
        workspaceName,
        currentView,
        settingsSubView,
        isTrashView,
        currentTab,
        searchQuery,
        selectedFolderDate,
        selectedFolderId,
        selectedNoteId,
        selectedNote,
        folders,
    ]);

    const handleBreadcrumbClick = useCallback(
        (crumb: BreadcrumbClick, id?: string) => {
            requestPipFlushSave();
            if (crumb === "workspace") {
                setCurrentView("notes");
                setIsTrashView(false);
                setCurrentTab("recent");
                setSelectedNoteId(null);
                setSelectedSidebarContext(null);
                setSearchQuery("");
            } else if (crumb === "recent") {
                setCurrentTab("recent");
                setSelectedNoteId(null);
                setSelectedSidebarContext(null);
                setSearchQuery("");
            } else if (crumb === "folders") {
                setCurrentTab("folders");
                setSelectedNoteId(null);
                setSelectedSidebarContext(null);
            } else if (crumb === "trash") {
                setCurrentView("notes");
                setIsTrashView(true);
                setSelectedNoteId(null);
            } else if (crumb === "bookmarks" && id === BOOKMARKS_SENTINEL) {
                setSearchQuery("");
                setCurrentTab("recent");
                setSelectedSidebarContext(BOOKMARKS_SENTINEL);
                setSelectedNoteId(null);
            } else if (crumb === "date" && id) {
                setSearchQuery("");
                setCurrentTab("recent");
                setSelectedSidebarContext(id);
                setSelectedNoteId(null);
            } else if (crumb === "folder" && id) {
                setCurrentTab("folders");
                setSelectedSidebarContext(id);
                setSelectedNoteId(null);
            } else if (crumb === "note" && id) {
                setSelectedNoteId(id);
            } else if (crumb === "settings") {
                setCurrentView("settings");
                setSettingsSubView("main");
            } else if (crumb === "integrations") {
                setCurrentView("settings");
                setSettingsSubView("integrations");
            }
        },
        [
            currentTab,
            setCurrentView,
            setSettingsSubView,
            setIsTrashView,
            setCurrentTab,
            setSelectedNoteId,
            setSelectedSidebarContext,
            setSearchQuery,
        ]
    );

    return (
        <>
            {showCelebration && (
                <div className="confetti-container" aria-hidden>
                    {Array.from({ length: 50 }).map((_, i) => (
                        <div
                            key={i}
                            className="confetti-particle"
                            style={{
                                left: `${50 + (Math.random() - 0.5) * 20}%`,
                                animationDelay: `${Math.random() * 0.3}s`,
                                backgroundColor: [
                                    "#4f46e5",
                                    "#6366f1",
                                    "#22c55e",
                                    "#f59e0b",
                                    "#ef4444",
                                ][Math.floor(Math.random() * 5)],
                            }}
                        />
                    ))}
                </div>
            )}
            <main className="main-content">
                <div className="breadcrumbs-row" id="mainHeaderRow">
                    <button
                        type="button"
                        className="mobile-menu-btn"
                        onClick={() => setMobileSidebarOpen(true)}
                        aria-label="Open menu"
                    >
                        <Menu size={20} />
                    </button>
                    <div className="breadcrumbs" id="breadcrumbs">
                        {breadcrumbItems.map((item, index) => (
                            <Fragment key={index}>
                                {index > 0 && (
                                    <span className="breadcrumb-separator">
                                        /
                                    </span>
                                )}
                                {item.click != null ? (
                                    <button
                                        type="button"
                                        className={`breadcrumb-item breadcrumb-item-clickable${
                                            item.active ? " active" : ""
                                        }`}
                                        data-crumb={item.click}
                                        data-crumb-id={item.id}
                                        title={item.text}
                                        onClick={() =>
                                            handleBreadcrumbClick(
                                                item.click!,
                                                item.id
                                            )
                                        }
                                    >
                                        {item.text}
                                    </button>
                                ) : (
                                    <span
                                        className={`breadcrumb-item${
                                            item.active ? " active" : ""
                                        }`}
                                        title={item.text}
                                    >
                                        {item.text}
                                    </span>
                                )}
                            </Fragment>
                        ))}
                    </div>
                    <SyncStatusButton setCurrentView={setCurrentView} />
                </div>

                {tutorialInProgress && pipIsOpen && (
                    <div className="tutorial-banner" role="status">
                        <div className="tutorial-banner-content">
                            <span className="tutorial-banner-icon">📖</span>
                            <span className="tutorial-banner-text">
                                Tutorial in progress - Follow the steps in the
                                floating window
                            </span>
                        </div>
                        <button
                            type="button"
                            className="tutorial-banner-close"
                            onClick={() => setTutorialInProgress(false)}
                            aria-label="Dismiss banner"
                        >
                            ×
                        </button>
                    </div>
                )}

                {currentView === "notes" && (
                    <div
                        className={`content-view${
                            isTrashView ? " trash-view-active" : ""
                        }`}
                        id="notesView"
                    >
                        <div className="search-container">
                            <input
                                type="text"
                                className="search-input"
                                id="searchInput"
                                placeholder="Search your thoughts..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                        setSearchQuery("");
                                    }
                                }}
                            />
                            <span className="search-icon" aria-hidden>
                                <Search size={14} />
                            </span>
                        </div>
                        <div className="notes-content" id="notesContent">
                            {!isTrashView &&
                            allNotesInWorkspace.length === 0 &&
                            !searchQuery.trim() ? (
                                <div className="onboarding">
                                    <div className="onboarding-hero">
                                        <div
                                            className="onboarding-logo"
                                            aria-hidden
                                        >
                                            <img
                                                src={noticLogo}
                                                alt=""
                                                className="onboarding-logo-image"
                                            />
                                        </div>
                                        <h2 className="onboarding-hero-title">
                                            Your floating notepad. Always
                                            accessible.
                                        </h2>
                                        <p className="onboarding-hero-desc">
                                            Capture ideas instantly with a
                                            pop-out editor that stays on top of
                                            everything.
                                        </p>
                                    </div>

                                    <div className="onboarding-features">
                                        <div className="onboarding-badge">
                                            <PanelTop
                                                size={14}
                                                strokeWidth={2}
                                            />
                                            <span>Pop-out editor</span>
                                        </div>
                                        <div className="onboarding-badge">
                                            <FolderIcon
                                                size={14}
                                                strokeWidth={2}
                                            />
                                            <span>Organized</span>
                                        </div>
                                        <div className="onboarding-badge">
                                            <CloudSync
                                                size={14}
                                                strokeWidth={2}
                                            />
                                            <span>
                                                {authUser
                                                    ? "Synced"
                                                    : "Cloud sync"}
                                            </span>
                                        </div>
                                    </div>

                                    {isDocumentPipSupported() ? (
                                        <div className="onboarding-ctas">
                                            <button
                                                type="button"
                                                className="onboarding-cta onboarding-cta-primary"
                                                disabled={tutorialInProgress}
                                                title={
                                                    tutorialInProgress
                                                        ? "Finish the tutorial first"
                                                        : undefined
                                                }
                                                onClick={() => {
                                                    const workspaceId =
                                                        currentWorkspaceId ??
                                                        undefined;
                                                    const newId = addNote({
                                                        workspaceId,
                                                    });
                                                    trackEvent("note_created");
                                                    setSelectedNoteId(newId);
                                                    const newNote =
                                                        useNotesStore.getState()
                                                            .notes[newId];
                                                    if (newNote)
                                                        openNoteInPip(newNote);
                                                }}
                                            >
                                                Create note
                                            </button>
                                            <button
                                                type="button"
                                                className="onboarding-cta onboarding-cta-secondary"
                                                disabled={
                                                    tutorialInProgress ||
                                                    pipIsOpen
                                                }
                                                title={
                                                    tutorialInProgress ||
                                                    pipIsOpen
                                                        ? "Close the floating window first"
                                                        : undefined
                                                }
                                                onClick={() => {
                                                    setTutorialInProgress(true);
                                                    setTutorialReadyForNoteOpen(
                                                        false
                                                    );
                                                    setTutorialShowCreateHint(
                                                        false
                                                    );
                                                    void openTutorialPip({
                                                        isDarkMode,
                                                        onClose: () => {
                                                            setTutorialInProgress(
                                                                false
                                                            );
                                                            setTutorialReadyForNoteOpen(
                                                                false
                                                            );
                                                            setTutorialShowCreateHint(
                                                                false
                                                            );
                                                        },
                                                        onError: () => {
                                                            setTutorialInProgress(
                                                                false
                                                            );
                                                            setTutorialReadyForNoteOpen(
                                                                false
                                                            );
                                                            setTutorialShowCreateHint(
                                                                false
                                                            );
                                                            setPipUnsupportedModalOpen(
                                                                true
                                                            );
                                                        },
                                                    });
                                                }}
                                            >
                                                Start tutorial
                                            </button>
                                        </div>
                                    ) : (
                                        <div
                                            className="onboarding-browser-info"
                                            role="status"
                                        >
                                            <div className="onboarding-browser-info-icon">
                                                <AlertCircle
                                                    size={20}
                                                    strokeWidth={2}
                                                />
                                            </div>
                                            <div className="onboarding-browser-info-content">
                                                <h3 className="onboarding-browser-info-title">
                                                    Browser not supported
                                                </h3>
                                                <p className="onboarding-browser-info-desc">
                                                    Floating windows are
                                                    available in these browsers:
                                                </p>
                                                <div className="onboarding-browser-logos">
                                                    <img
                                                        src={chromeLogo}
                                                        alt="Chrome"
                                                        className="onboarding-browser-logo"
                                                    />
                                                    <img
                                                        src={edgeLogo}
                                                        alt="Edge"
                                                        className="onboarding-browser-logo"
                                                    />
                                                    <img
                                                        src={braveLogo}
                                                        alt="Brave"
                                                        className="onboarding-browser-logo"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <p className="onboarding-hint">
                                        Works offline • No setup required
                                    </p>
                                </div>
                            ) : isTrashView ? (
                                <div className="settings-page">
                                    <div className="settings-page-content">
                                        <div className="trash-header-row">
                                            <h2 className="settings-page-title">
                                                Trash
                                            </h2>
                                            {trashNotesInWorkspace.length >
                                            0 ? (
                                                <button
                                                    type="button"
                                                    className="modal-btn modal-btn-secondary trash-empty-all-btn"
                                                    onClick={() => {
                                                        setDeleteConfirmModal({
                                                            type: "emptyTrash",
                                                            count: trashNotesInWorkspace.length,
                                                        });
                                                    }}
                                                >
                                                    Empty trash
                                                </button>
                                            ) : null}
                                        </div>
                                        {trashNotesInWorkspace.length === 0 ? (
                                            <p className="trash-empty-desc">
                                                Trash is empty
                                            </p>
                                        ) : (
                                            <div className="trash-list">
                                                {trashNotesInWorkspace.map(
                                                    (note) => {
                                                        const displayName =
                                                            note.displayName ||
                                                            note.title ||
                                                            "Untitled";
                                                        return (
                                                            <div
                                                                key={
                                                                    note.sessionId
                                                                }
                                                                className="note-item"
                                                                data-session-id={
                                                                    note.sessionId
                                                                }
                                                            >
                                                                <div className="note-header">
                                                                    <div className="note-title">
                                                                        {note.color && (
                                                                            <span
                                                                                className="note-list-color"
                                                                                style={{
                                                                                    backgroundColor:
                                                                                        note.color,
                                                                                }}
                                                                                aria-hidden
                                                                            />
                                                                        )}
                                                                        <FileText
                                                                            className="note-file-icon"
                                                                            size={
                                                                                16
                                                                            }
                                                                            aria-hidden
                                                                        />
                                                                        <span>
                                                                            {
                                                                                displayName
                                                                            }
                                                                            .md
                                                                        </span>
                                                                    </div>
                                                                    <div className="note-detail-actions">
                                                                        <button
                                                                            type="button"
                                                                            className="note-detail-action-btn trash-restore-btn"
                                                                            title="Restore"
                                                                            onClick={(
                                                                                e
                                                                            ) => {
                                                                                e.stopPropagation();
                                                                                restoreNote(
                                                                                    note.sessionId
                                                                                );
                                                                            }}
                                                                        >
                                                                            Restore
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="note-detail-action-btn danger trash-delete-btn"
                                                                            title="Delete permanently"
                                                                            onClick={(
                                                                                e
                                                                            ) => {
                                                                                e.stopPropagation();
                                                                                setDeleteConfirmModal(
                                                                                    {
                                                                                        type: "single",
                                                                                        noteId: note.sessionId,
                                                                                        noteName:
                                                                                            displayName,
                                                                                    }
                                                                                );
                                                                            }}
                                                                        >
                                                                            Delete
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="note-metadata">
                                                                    <span>
                                                                        Deleted{" "}
                                                                        {formatDate(
                                                                            note.deletedAt!
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : !searchQuery.trim() && selectedNote ? (
                                (() => {
                                    const isEditMode =
                                        detailEditNoteId === selectedNoteId;
                                    const isEditedInMain =
                                        detailEditNoteId === selectedNoteId;
                                    const isActiveInPip =
                                        openInPipActiveNoteId ===
                                            selectedNoteId && pipIsOpen;
                                    const shouldDisableOpen =
                                        isActiveInPip || isEditedInMain;
                                    const isNoteActiveInPipDetail =
                                        shouldDisableOpen;
                                    return (
                                        <div className="note-detail-view">
                                            <div className="note-detail-header">
                                                <div className="note-detail-header-main">
                                                    <div className="note-detail-title-row">
                                                        {selectedNote.color && (
                                                            <span
                                                                className="note-detail-color"
                                                                style={{
                                                                    backgroundColor:
                                                                        selectedNote.color,
                                                                }}
                                                                aria-hidden
                                                            />
                                                        )}
                                                        <h1 className="note-detail-title">
                                                            {stripMarkdownForDisplay(
                                                                selectedNote.displayName ||
                                                                    selectedNote.title ||
                                                                    "Untitled"
                                                            )}
                                                            .md
                                                        </h1>
                                                    </div>
                                                    <p className="note-detail-meta-inline">
                                                        {formatDate(
                                                            selectedNote.lastModified
                                                        )}{" "}
                                                        ·{" "}
                                                        {selectedNote.wordCount}{" "}
                                                        words
                                                    </p>
                                                </div>
                                                <div className="note-detail-actions">
                                                    {isEditMode ? (
                                                        <button
                                                            type="button"
                                                            className="note-detail-action-btn note-detail-done-btn"
                                                            title="Done editing"
                                                            aria-label="Done editing"
                                                            onClick={() =>
                                                                setDetailEditNoteId(
                                                                    null
                                                                )
                                                            }
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            className={`note-detail-action-btn${
                                                                isNoteActiveInPipDetail
                                                                    ? " disabled"
                                                                    : ""
                                                            }`}
                                                            id="noteDetailEditBtn"
                                                            title={
                                                                isNoteActiveInPipDetail
                                                                    ? "Note is already open in editor"
                                                                    : "Edit"
                                                            }
                                                            aria-label={
                                                                isNoteActiveInPipDetail
                                                                    ? "Note is already open in editor"
                                                                    : "Edit"
                                                            }
                                                            disabled={
                                                                isNoteActiveInPipDetail
                                                            }
                                                            onClick={() =>
                                                                !isNoteActiveInPipDetail &&
                                                                setDetailEditNoteId(
                                                                    selectedNoteId!
                                                                )
                                                            }
                                                        >
                                                            <Pencil size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className={`note-detail-action-btn ${
                                                            shouldDisableOpen
                                                                ? "disabled note-detail-open-active"
                                                                : ""
                                                        }`}
                                                        title={
                                                            isEditedInMain
                                                                ? "Finish editing in main view first"
                                                                : isActiveInPip
                                                                ? "Note is already open in editor"
                                                                : "Open editor"
                                                        }
                                                        aria-label={
                                                            isEditedInMain
                                                                ? "Finish editing in main view first"
                                                                : isActiveInPip
                                                                ? "Note is already open in editor"
                                                                : "Open editor"
                                                        }
                                                        disabled={
                                                            shouldDisableOpen
                                                        }
                                                        onClick={() =>
                                                            !shouldDisableOpen &&
                                                            openNoteInPip(
                                                                selectedNote
                                                            )
                                                        }
                                                    >
                                                        <ExternalLink
                                                            size={16}
                                                        />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`note-detail-action-btn ${
                                                            selectedNote.shareCode
                                                                ? "note-detail-action-shared"
                                                                : ""
                                                        }`}
                                                        title={
                                                            selectedNote.shareCode
                                                                ? "Shared"
                                                                : "Share"
                                                        }
                                                        aria-label={
                                                            selectedNote.shareCode
                                                                ? "Shared"
                                                                : "Share"
                                                        }
                                                        onClick={() =>
                                                            setShareModalNoteId(
                                                                selectedNoteId!
                                                            )
                                                        }
                                                    >
                                                        <Share2 size={16} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="note-detail-action-btn"
                                                        id="noteDetailMoreBtn"
                                                        data-context-menu-trigger
                                                        title="More actions"
                                                        aria-label="More actions"
                                                        aria-haspopup="true"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const rect = (
                                                                e.currentTarget as HTMLElement
                                                            ).getBoundingClientRect();
                                                            setNoteContextMenuAnchor(
                                                                {
                                                                    x: rect.left,
                                                                    y:
                                                                        rect.bottom +
                                                                        4,
                                                                    noteId: selectedNoteId!,
                                                                }
                                                            );
                                                        }}
                                                    >
                                                        <MoreHorizontal
                                                            size={16}
                                                        />
                                                    </button>
                                                </div>
                                            </div>
                                            <div
                                                ref={detailContentRef}
                                                className={`note-detail-content ${
                                                    isEditMode
                                                        ? "note-detail-content-editing"
                                                        : ""
                                                } ${
                                                    !isEditMode &&
                                                    !isNoteActiveInPipDetail
                                                        ? "note-detail-content-click-to-edit"
                                                        : ""
                                                }`}
                                                role={
                                                    !isEditMode &&
                                                    !isNoteActiveInPipDetail
                                                        ? "button"
                                                        : undefined
                                                }
                                                tabIndex={
                                                    !isEditMode &&
                                                    !isNoteActiveInPipDetail
                                                        ? 0
                                                        : undefined
                                                }
                                                onClick={
                                                    !isEditMode &&
                                                    !isNoteActiveInPipDetail
                                                        ? () =>
                                                              setDetailEditNoteId(
                                                                  selectedNoteId!
                                                              )
                                                        : undefined
                                                }
                                                onKeyDown={
                                                    !isEditMode &&
                                                    !isNoteActiveInPipDetail
                                                        ? (e) => {
                                                              if (
                                                                  e.key ===
                                                                      "Enter" ||
                                                                  e.key === " "
                                                              ) {
                                                                  e.preventDefault();
                                                                  setDetailEditNoteId(
                                                                      selectedNoteId!
                                                                  );
                                                              }
                                                          }
                                                        : undefined
                                                }
                                                aria-label={
                                                    !isEditMode &&
                                                    !isNoteActiveInPipDetail
                                                        ? "Click to edit note"
                                                        : undefined
                                                }
                                            >
                                                {isEditMode ? (
                                                    <NoteEditor
                                                        key={selectedNoteId!}
                                                        editorKey={
                                                            selectedNoteId!
                                                        }
                                                        initialContent={
                                                            selectedNote.content ??
                                                            ""
                                                        }
                                                        onChange={
                                                            handleNoteDetailContentChange
                                                        }
                                                        onFlush={
                                                            handleNoteDetailFlush
                                                        }
                                                        placeholder=""
                                                        className="note-detail-lexical-root"
                                                        showToolbar
                                                    />
                                                ) : (
                                                    <NoteEditor
                                                        key={selectedNoteId!}
                                                        editorKey={
                                                            selectedNoteId!
                                                        }
                                                        initialContent={
                                                            selectedNote.content ??
                                                            ""
                                                        }
                                                        onChange={() => {}}
                                                        placeholder=""
                                                        className="note-detail-lexical-root note-detail-content-readonly"
                                                        readOnly
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()
                            ) : searchQuery.trim() ? (
                                filteredAndSortedNotes.length === 0 ? (
                                    <div className="empty-state-main">
                                        <p>
                                            No notes found matching &quot;
                                            {searchQuery.trim()}&quot;
                                        </p>
                                    </div>
                                ) : (
                                    <div className="main-notes-list">
                                        {filteredAndSortedNotes.map((note) => {
                                            const isOpenInPip =
                                                openInPipNoteIds.includes(
                                                    note.sessionId
                                                );
                                            const isEditedInMain =
                                                detailEditNoteId ===
                                                note.sessionId;
                                            const shouldDisable =
                                                (isOpenInPip && pipIsOpen) ||
                                                isEditedInMain;
                                            const displayName =
                                                note.displayName ||
                                                note.title ||
                                                "Untitled";
                                            return (
                                                <div
                                                    key={note.sessionId}
                                                    className={`note-item ${
                                                        selectedNoteId ===
                                                        note.sessionId
                                                            ? "note-item-selected"
                                                            : ""
                                                    } ${
                                                        isOpenInPip
                                                            ? "note-item-open-in-pip"
                                                            : ""
                                                    }`}
                                                    onClick={() =>
                                                        handleRowClick(note)
                                                    }
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        setNoteContextMenuAnchor(
                                                            {
                                                                x: e.clientX,
                                                                y: e.clientY,
                                                                noteId: note.sessionId,
                                                            }
                                                        );
                                                    }}
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            handleRowClick(
                                                                note
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <div className="note-header">
                                                        <div className="note-title">
                                                            {note.color && (
                                                                <span
                                                                    className="note-list-color"
                                                                    style={{
                                                                        backgroundColor:
                                                                            note.color,
                                                                    }}
                                                                />
                                                            )}
                                                            <FileText
                                                                className="note-file-icon"
                                                                size={16}
                                                                aria-hidden
                                                            />
                                                            {searchQuery.trim() ? (
                                                                <span
                                                                    dangerouslySetInnerHTML={{
                                                                        __html: highlightMatch(
                                                                            escapeHtml(
                                                                                `${stripMarkdownForDisplay(
                                                                                    displayName
                                                                                )}.md`
                                                                            ),
                                                                            searchQuery.trim()
                                                                        ),
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span>
                                                                    {stripMarkdownForDisplay(
                                                                        displayName
                                                                    )}
                                                                    .md
                                                                </span>
                                                            )}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`note-pip-icon ${
                                                                shouldDisable
                                                                    ? "disabled"
                                                                    : ""
                                                            }`}
                                                            onClick={(e) =>
                                                                handlePipIconClick(
                                                                    e,
                                                                    note
                                                                )
                                                            }
                                                            title={
                                                                shouldDisable
                                                                    ? "Note is already open in editor"
                                                                    : "Open editor"
                                                            }
                                                            aria-label={
                                                                shouldDisable
                                                                    ? "Note is already open in editor"
                                                                    : "Open editor"
                                                            }
                                                            disabled={
                                                                shouldDisable
                                                            }
                                                        >
                                                            <ExternalLink
                                                                size={14}
                                                            />
                                                        </button>
                                                    </div>
                                                    <div className="note-content">
                                                        {searchQuery.trim() ? (
                                                            <span
                                                                dangerouslySetInnerHTML={{
                                                                    __html: highlightMatch(
                                                                        escapeHtml(
                                                                            note.content
                                                                                ? getContentPreview(
                                                                                      note.content,
                                                                                      150
                                                                                  )
                                                                                : ""
                                                                        ),
                                                                        searchQuery.trim()
                                                                    ),
                                                                }}
                                                            />
                                                        ) : note.content ? (
                                                            getContentPreview(
                                                                note.content,
                                                                150
                                                            )
                                                        ) : (
                                                            ""
                                                        )}
                                                    </div>
                                                    <div className="note-metadata">
                                                        <span>
                                                            {formatDate(
                                                                note.lastModified
                                                            )}
                                                        </span>
                                                        <span className="note-metadata-separator" />
                                                        <span>
                                                            {note.wordCount}{" "}
                                                            words
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )
                            ) : currentTab === "folders" &&
                              !searchQuery.trim() &&
                              !isTrashView ? (
                                folderViewItems.length === 0 ? (
                                    <div className="empty-state-main">
                                        <p>
                                            {selectedFolderId &&
                                            folders[selectedFolderId]
                                                ? "This folder is empty"
                                                : "No notes or folders"}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="main-notes-list">
                                        {folderViewItems.map((item) =>
                                            item.type === "folder" ? (
                                                <div
                                                    key={item.data.id}
                                                    className="note-item folder-item"
                                                    draggable
                                                    onClick={() =>
                                                        handleFolderRowClick(
                                                            item.data.id
                                                        )
                                                    }
                                                    onDragStart={(e) =>
                                                        handleFolderDragStart(
                                                            e,
                                                            item.data.id
                                                        )
                                                    }
                                                    onDragEnd={
                                                        handleFolderDragEnd
                                                    }
                                                    onDragOver={(e) =>
                                                        handleFolderRowDragOver(
                                                            e,
                                                            item.data.id
                                                        )
                                                    }
                                                    onDragLeave={
                                                        handleFolderRowDragLeave
                                                    }
                                                    onDrop={(e) =>
                                                        handleFolderRowDrop(
                                                            e,
                                                            item.data.id
                                                        )
                                                    }
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            handleFolderRowClick(
                                                                item.data.id
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <div className="note-header">
                                                        <div className="note-title">
                                                            {item.data
                                                                .color && (
                                                                <span
                                                                    className="note-list-color"
                                                                    style={{
                                                                        backgroundColor:
                                                                            item
                                                                                .data
                                                                                .color,
                                                                    }}
                                                                    aria-hidden
                                                                />
                                                            )}
                                                            <FolderIcon
                                                                className="folder-icon"
                                                                size={16}
                                                                aria-hidden
                                                            />
                                                            <span>
                                                                {item.data
                                                                    .displayName ??
                                                                    item.data
                                                                        .name}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="note-metadata">
                                                        <span>
                                                            {getFolderNoteCountRecursive(
                                                                item.data.id,
                                                                notes,
                                                                folders
                                                            )}{" "}
                                                            {getFolderNoteCountRecursive(
                                                                item.data.id,
                                                                notes,
                                                                folders
                                                            ) === 1
                                                                ? "note"
                                                                : "notes"}
                                                        </span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div
                                                    key={item.data.sessionId}
                                                    className={`note-item ${
                                                        selectedNoteId ===
                                                        item.data.sessionId
                                                            ? "note-item-selected"
                                                            : ""
                                                    } ${
                                                        openInPipNoteIds.includes(
                                                            item.data.sessionId
                                                        )
                                                            ? "note-item-open-in-pip"
                                                            : ""
                                                    }`}
                                                    draggable
                                                    onClick={() =>
                                                        handleRowClick(
                                                            item.data
                                                        )
                                                    }
                                                    onContextMenu={(e) => {
                                                        e.preventDefault();
                                                        setNoteContextMenuAnchor(
                                                            {
                                                                x: e.clientX,
                                                                y: e.clientY,
                                                                noteId: item
                                                                    .data
                                                                    .sessionId,
                                                            }
                                                        );
                                                    }}
                                                    onDragStart={(e) =>
                                                        handleNoteDragStart(
                                                            e,
                                                            item.data.sessionId
                                                        )
                                                    }
                                                    onDragEnd={
                                                        handleNoteDragEnd
                                                    }
                                                    role="button"
                                                    tabIndex={0}
                                                    onKeyDown={(e) => {
                                                        if (
                                                            e.key === "Enter" ||
                                                            e.key === " "
                                                        ) {
                                                            e.preventDefault();
                                                            handleRowClick(
                                                                item.data
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <div className="note-header">
                                                        <div className="note-title">
                                                            {item.data
                                                                .color && (
                                                                <span
                                                                    className="note-list-color"
                                                                    style={{
                                                                        backgroundColor:
                                                                            item
                                                                                .data
                                                                                .color,
                                                                    }}
                                                                />
                                                            )}
                                                            <FileText
                                                                className="note-file-icon"
                                                                size={16}
                                                                aria-hidden
                                                            />
                                                            <span>
                                                                {stripMarkdownForDisplay(
                                                                    item.data
                                                                        .displayName ??
                                                                        item
                                                                            .data
                                                                            .title ??
                                                                        "Untitled"
                                                                )}
                                                                .md
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`note-pip-icon ${
                                                                (openInPipActiveNoteId ===
                                                                    item.data
                                                                        .sessionId &&
                                                                    pipIsOpen) ||
                                                                detailEditNoteId ===
                                                                    item.data
                                                                        .sessionId
                                                                    ? "disabled"
                                                                    : ""
                                                            }`}
                                                            onClick={(e) =>
                                                                handlePipIconClick(
                                                                    e,
                                                                    item.data
                                                                )
                                                            }
                                                            title={
                                                                detailEditNoteId ===
                                                                item.data
                                                                    .sessionId
                                                                    ? "Finish editing in main view first"
                                                                    : openInPipActiveNoteId ===
                                                                          item
                                                                              .data
                                                                              .sessionId &&
                                                                      pipIsOpen
                                                                    ? "Note is already open in editor"
                                                                    : "Open editor"
                                                            }
                                                            aria-label={
                                                                detailEditNoteId ===
                                                                item.data
                                                                    .sessionId
                                                                    ? "Finish editing in main view first"
                                                                    : openInPipActiveNoteId ===
                                                                          item
                                                                              .data
                                                                              .sessionId &&
                                                                      pipIsOpen
                                                                    ? "Note is already open in editor"
                                                                    : "Open editor"
                                                            }
                                                            disabled={
                                                                (openInPipActiveNoteId ===
                                                                    item.data
                                                                        .sessionId &&
                                                                    pipIsOpen) ||
                                                                detailEditNoteId ===
                                                                    item.data
                                                                        .sessionId
                                                            }
                                                        >
                                                            <ExternalLink
                                                                size={14}
                                                            />
                                                        </button>
                                                    </div>
                                                    <div className="note-content">
                                                        {item.data.content
                                                            ? getContentPreview(
                                                                  item.data
                                                                      .content,
                                                                  150
                                                              )
                                                            : ""}
                                                    </div>
                                                    <div className="note-metadata">
                                                        <span>
                                                            {formatDate(
                                                                item.data
                                                                    .lastModified
                                                            )}
                                                        </span>
                                                        <span className="note-metadata-separator" />
                                                        <span>
                                                            {
                                                                item.data
                                                                    .wordCount
                                                            }{" "}
                                                            words
                                                        </span>
                                                    </div>
                                                </div>
                                            )
                                        )}
                                    </div>
                                )
                            ) : currentTab === "recent" &&
                              !selectedFolderDate ? (
                                <div className="empty-state-main">
                                    <p>Select a folder or note to view</p>
                                </div>
                            ) : currentTab === "folders" &&
                              selectedFolderId === null &&
                              filteredAndSortedNotes.length === 0 ? (
                                <div className="empty-state-main">
                                    <p>No notes or folders</p>
                                </div>
                            ) : filteredAndSortedNotes.length === 0 ? (
                                <div className="empty-state-main">
                                    <p>
                                        {(currentTab === "recent" &&
                                            selectedFolderDate ===
                                                BOOKMARKS_SENTINEL) ||
                                        (currentTab === "folders" &&
                                            selectedFolderId ===
                                                BOOKMARKS_SENTINEL)
                                            ? 'No bookmarked notes. Right-click a note and choose "Add to Bookmarks".'
                                            : "No notes in this folder"}
                                    </p>
                                </div>
                            ) : (
                                <div className="main-notes-list">
                                    {filteredAndSortedNotes.map((note) => {
                                        const isOpenInPip =
                                            openInPipNoteIds.includes(
                                                note.sessionId
                                            );
                                        const shouldDisable =
                                            openInPipActiveNoteId ===
                                                note.sessionId && pipIsOpen;
                                        const displayName =
                                            stripMarkdownForDisplay(
                                                note.displayName ||
                                                    note.title ||
                                                    "Untitled"
                                            );
                                        return (
                                            <div
                                                key={note.sessionId}
                                                className={`note-item ${
                                                    selectedNoteId ===
                                                    note.sessionId
                                                        ? "note-item-selected"
                                                        : ""
                                                } ${
                                                    isOpenInPip
                                                        ? "note-item-open-in-pip"
                                                        : ""
                                                }`}
                                                onClick={() =>
                                                    handleRowClick(note)
                                                }
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    setNoteContextMenuAnchor({
                                                        x: e.clientX,
                                                        y: e.clientY,
                                                        noteId: note.sessionId,
                                                    });
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => {
                                                    if (
                                                        e.key === "Enter" ||
                                                        e.key === " "
                                                    ) {
                                                        e.preventDefault();
                                                        handleRowClick(note);
                                                    }
                                                }}
                                            >
                                                <div className="note-header">
                                                    <div className="note-title">
                                                        {note.color && (
                                                            <span
                                                                className="note-list-color"
                                                                style={{
                                                                    backgroundColor:
                                                                        note.color,
                                                                }}
                                                            />
                                                        )}
                                                        <FileText
                                                            className="note-file-icon"
                                                            size={16}
                                                            aria-hidden
                                                        />
                                                        {searchQuery.trim() ? (
                                                            <span
                                                                dangerouslySetInnerHTML={{
                                                                    __html: highlightMatch(
                                                                        escapeHtml(
                                                                            `${displayName}.md`
                                                                        ),
                                                                        searchQuery.trim()
                                                                    ),
                                                                }}
                                                            />
                                                        ) : (
                                                            <span>
                                                                {displayName}.md
                                                            </span>
                                                        )}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className={`note-pip-icon ${
                                                            shouldDisable
                                                                ? "disabled"
                                                                : ""
                                                        }`}
                                                        onClick={(e) =>
                                                            handlePipIconClick(
                                                                e,
                                                                note
                                                            )
                                                        }
                                                        title={
                                                            shouldDisable
                                                                ? "Note is already open in editor"
                                                                : "Open editor"
                                                        }
                                                        aria-label={
                                                            shouldDisable
                                                                ? "Note is already open in editor"
                                                                : "Open editor"
                                                        }
                                                        disabled={shouldDisable}
                                                    >
                                                        <ExternalLink
                                                            size={14}
                                                        />
                                                    </button>
                                                </div>
                                                <div className="note-content">
                                                    {searchQuery.trim() ? (
                                                        <span
                                                            dangerouslySetInnerHTML={{
                                                                __html: highlightMatch(
                                                                    escapeHtml(
                                                                        note.content
                                                                            ? getContentPreview(
                                                                                  note.content,
                                                                                  150
                                                                              )
                                                                            : ""
                                                                    ),
                                                                    searchQuery.trim()
                                                                ),
                                                            }}
                                                        />
                                                    ) : note.content ? (
                                                        getContentPreview(
                                                            note.content,
                                                            150
                                                        )
                                                    ) : (
                                                        ""
                                                    )}
                                                </div>
                                                <div className="note-metadata">
                                                    <span>
                                                        {formatDate(
                                                            note.lastModified
                                                        )}
                                                    </span>
                                                    <span className="note-metadata-separator" />
                                                    <span>
                                                        {note.wordCount} words
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="main-content-spacer" aria-hidden />
                    </div>
                )}

                {currentView === "settings" && (
                    <div className="content-view" id="settingsView">
                        <SettingsView />
                        <div className="main-content-spacer" aria-hidden />
                    </div>
                )}

                {/* Share modal (paygate path: publish, copy, open, unpublish, 402 → Pro modal) */}
                {shareModalNoteId != null &&
                    notes[shareModalNoteId] != null &&
                    (() => {
                        const shareNote = notes[shareModalNoteId]!;
                        const published = !!shareNote.shareCode;
                        const shareUrl = shareNote.shareCode
                            ? `${SHARE_PUBLIC_BASE.replace(/\/$/, "")}/p/${
                                  shareNote.shareCode
                              }`
                            : "";
                        const isSignedIn = !!authUser;
                        return (
                            <div
                                className="modal-overlay show"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="share-modal-title"
                                onClick={() => setShareModalNoteId(null)}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape")
                                        setShareModalNoteId(null);
                                }}
                            >
                                <div
                                    className="modal modal-share"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="modal-header">
                                        <h3
                                            id="share-modal-title"
                                            className="modal-title"
                                        >
                                            Share
                                        </h3>
                                        <p className="modal-message">
                                            Anyone with the link can view this
                                            note (read-only).
                                        </p>
                                        {published && (
                                            <div className="share-link-row">
                                                <input
                                                    type="text"
                                                    className="share-link-input"
                                                    id="shareLinkInput"
                                                    value={shareUrl}
                                                    readOnly
                                                    aria-label="Share link"
                                                />
                                                <button
                                                    type="button"
                                                    className="modal-btn modal-btn-secondary share-copy-btn"
                                                    title="Copy link"
                                                    onClick={() => {
                                                        navigator.clipboard
                                                            .writeText(shareUrl)
                                                            .then(() =>
                                                                setShareToast(
                                                                    "Link copied"
                                                                )
                                                            );
                                                    }}
                                                >
                                                    <Copy
                                                        size={16}
                                                        aria-hidden
                                                    />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="modal-actions">
                                        {!published ? (
                                            <button
                                                type="button"
                                                className="modal-btn modal-btn-primary"
                                                id="sharePublishBtn"
                                                disabled={sharePublishLoading}
                                                onClick={async () => {
                                                    if (!isSignedIn) {
                                                        setShareToast(
                                                            "Sign in to share notes"
                                                        );
                                                        return;
                                                    }
                                                    setSharePublishLoading(
                                                        true
                                                    );
                                                    const result =
                                                        await publishNote(
                                                            db,
                                                            shareModalNoteId
                                                        );
                                                    if (
                                                        result &&
                                                        "paymentRequired" in
                                                            result &&
                                                        result.paymentRequired
                                                    ) {
                                                        setProRequiredModal({
                                                            title: "Pro required",
                                                            message:
                                                                "Publish to web is a Pro feature. Upgrade to share notes with a public link.",
                                                        });
                                                        setSharePublishLoading(
                                                            false
                                                        );
                                                        return;
                                                    }
                                                    if (
                                                        result &&
                                                        "shareCode" in result &&
                                                        typeof result.shareCode ===
                                                            "string"
                                                    ) {
                                                        updateNote(
                                                            shareModalNoteId,
                                                            {
                                                                shareCode:
                                                                    result.shareCode,
                                                            }
                                                        );
                                                        setSharePublishLoading(
                                                            false
                                                        );
                                                    } else {
                                                        setShareToast(
                                                            "Could not publish. Sign in and try again."
                                                        );
                                                        setSharePublishLoading(
                                                            false
                                                        );
                                                    }
                                                }}
                                            >
                                                {sharePublishLoading
                                                    ? "Publishing…"
                                                    : "Publish to web"}
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    type="button"
                                                    className="modal-btn modal-btn-secondary"
                                                    title="Open shared page"
                                                    onClick={() =>
                                                        window.open(
                                                            shareUrl,
                                                            "_blank",
                                                            "noopener,noreferrer"
                                                        )
                                                    }
                                                >
                                                    Open link
                                                </button>
                                                <button
                                                    type="button"
                                                    className="modal-btn modal-btn-secondary"
                                                    onClick={() =>
                                                        setShareUnpublishConfirm(
                                                            true
                                                        )
                                                    }
                                                >
                                                    Unpublish
                                                </button>
                                            </>
                                        )}
                                        <button
                                            type="button"
                                            className="modal-btn modal-btn-secondary"
                                            onClick={() =>
                                                setShareModalNoteId(null)
                                            }
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                {/* Unpublish confirm */}
                {shareUnpublishConfirm && shareModalNoteId != null && (
                    <div
                        className="modal-overlay show"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="unpublish-confirm-title"
                        onClick={() => setShareUnpublishConfirm(false)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape")
                                setShareUnpublishConfirm(false);
                        }}
                    >
                        <div
                            className="modal"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h3
                                    id="unpublish-confirm-title"
                                    className="modal-title"
                                >
                                    Unpublish note
                                </h3>
                                <p className="modal-message">
                                    The link will stop working. You can publish
                                    again anytime.
                                </p>
                            </div>
                            <div className="modal-actions">
                                <button
                                    type="button"
                                    className="modal-btn modal-btn-primary"
                                    onClick={async () => {
                                        const noteId = shareModalNoteId;
                                        setShareUnpublishConfirm(false);
                                        if (!noteId || !authUser) return;
                                        const result = await unpublishNote(
                                            db,
                                            noteId
                                        );
                                        if (result?.paymentRequired) {
                                            setProRequiredModal({
                                                title: "Pro required",
                                                message:
                                                    "Publish to web is a Pro feature. Upgrade to share and unpublish notes.",
                                            });
                                            return;
                                        }
                                        if (result?.ok) {
                                            updateNote(noteId, {
                                                shareCode: undefined,
                                            });
                                            setShareModalNoteId(null);
                                        } else {
                                            setShareToast(
                                                "Could not unpublish."
                                            );
                                        }
                                    }}
                                >
                                    Unpublish
                                </button>
                                <button
                                    type="button"
                                    className="modal-btn modal-btn-secondary"
                                    onClick={() =>
                                        setShareUnpublishConfirm(false)
                                    }
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Pro required (paygate) modal */}
                {proRequiredModal && (
                    <div
                        className="modal-overlay show"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="pro-required-title"
                        onClick={() => setProRequiredModal(null)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") setProRequiredModal(null);
                        }}
                    >
                        <div
                            className="modal"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header">
                                <h3
                                    id="pro-required-title"
                                    className="modal-title"
                                >
                                    {proRequiredModal.title}
                                </h3>
                                <p className="modal-message">
                                    {proRequiredModal.message}
                                </p>
                            </div>
                            <div className="modal-actions">
                                <button
                                    type="button"
                                    className="modal-btn modal-btn-cta-upgrade"
                                    onClick={() => {
                                        void openBillingPage(
                                            db,
                                            setToastMessage
                                        );
                                        setProRequiredModal(null);
                                    }}
                                >
                                    Upgrade
                                </button>
                                <button
                                    type="button"
                                    className="modal-btn modal-btn-secondary"
                                    onClick={() => setProRequiredModal(null)}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Share toast (e.g. "Link copied") – above modal overlay (10001) so visible over blur */}
                {shareToast != null && (
                    <div
                        className="toast-message"
                        role="status"
                        aria-live="polite"
                        style={{
                            position: "fixed",
                            bottom: 24,
                            left: "50%",
                            transform: "translateX(-50%)",
                            zIndex: 10002,
                        }}
                    >
                        {shareToast}
                    </div>
                )}
            </main>

            {/* Note context menu when opened from detail view "…" – same items as sidebar with PiP blocking */}
            {isDetailNoteMenuOpen &&
                (() => {
                    const menuNote = notes[noteContextMenuAnchor!.noteId];
                    if (!menuNote) return null;
                    const isNoteActiveInPipDetail =
                        (openInPipActiveNoteId === selectedNoteId &&
                            pipIsOpen) ||
                        detailEditNoteId === noteContextMenuAnchor!.noteId;
                    const isBookmarked = menuNote.isBookmarked === true;
                    return createPortal(
                        <div
                            className="pip-context-menu show"
                            data-context-menu-trigger
                            style={{
                                left: noteContextMenuAnchor!.x,
                                top: noteContextMenuAnchor!.y,
                            }}
                            onClick={(e) => e.stopPropagation()}
                            ref={(el) => {
                                if (!el) return;
                                const rect = el.getBoundingClientRect();
                                if (rect.right > window.innerWidth)
                                    el.style.left = `${
                                        window.innerWidth - rect.width - 10
                                    }px`;
                                if (rect.bottom > window.innerHeight)
                                    el.style.top = `${
                                        window.innerHeight - rect.height - 10
                                    }px`;
                            }}
                        >
                            <button
                                type="button"
                                className={`pip-context-menu-item${
                                    isNoteActiveInPipDetail
                                        ? " pip-context-menu-item-disabled"
                                        : ""
                                }`}
                                disabled={isNoteActiveInPipDetail}
                                title={
                                    isNoteActiveInPipDetail
                                        ? "Note is already open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipDetail) return;

                                    // Block note opening during tutorial until it's time
                                    if (
                                        tutorialInProgress &&
                                        !tutorialReadyForNoteOpen
                                    ) {
                                        setToastMessage(
                                            "Follow the tutorial steps in the floating window first"
                                        );
                                        setNoteContextMenuAnchor(null);
                                        return;
                                    }

                                    setSelectedNoteId(
                                        noteContextMenuAnchor!.noteId
                                    );
                                    addNoteToPip(
                                        noteContextMenuAnchor!.noteId,
                                        true
                                    );
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item${
                                    isNoteActiveInPipDetail
                                        ? " pip-context-menu-item-disabled"
                                        : ""
                                }`}
                                disabled={isNoteActiveInPipDetail}
                                title={
                                    isNoteActiveInPipDetail
                                        ? "Note is already open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipDetail) return;

                                    // Block note opening during tutorial until it's time
                                    if (
                                        tutorialInProgress &&
                                        !tutorialReadyForNoteOpen
                                    ) {
                                        setToastMessage(
                                            "Follow the tutorial steps in the floating window first"
                                        );
                                        setNoteContextMenuAnchor(null);
                                        return;
                                    }

                                    // Tutorial tracking: close tutorial PiP and show confetti before opening real editor
                                    if (
                                        tutorialInProgress &&
                                        tutorialReadyForNoteOpen
                                    ) {
                                        const pipWin = getPipWindow();
                                        if (pipWin && !pipWin.closed) {
                                            try {
                                                pipWin.close();
                                            } catch {}
                                        }
                                        setTutorialInProgress(false);
                                        setTutorialReadyForNoteOpen(false);
                                        setShowCelebration(true);
                                        setToastMessage(
                                            "Perfect! 🎉 You're ready to use Notic"
                                        );
                                        setTimeout(
                                            () => setShowCelebration(false),
                                            3000
                                        );
                                    }

                                    openNoteInPip(menuNote);
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Open
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    const willBeBookmarked = !isBookmarked;
                                    updateNote(noteContextMenuAnchor!.noteId, {
                                        isBookmarked: willBeBookmarked,
                                    });
                                    setNoteContextMenuAnchor(null);

                                    // Tutorial tracking: send message when user bookmarks a note (not unbookmark)
                                    if (
                                        tutorialInProgress &&
                                        willBeBookmarked
                                    ) {
                                        const pipWin = getPipWindow();
                                        if (pipWin && !pipWin.closed) {
                                            try {
                                                pipWin.postMessage(
                                                    {
                                                        type: "notic-pip-tutorial-note-bookmarked",
                                                    },
                                                    "*"
                                                );
                                            } catch {}
                                        }
                                    }
                                }}
                            >
                                {isBookmarked
                                    ? "Remove from Bookmarks"
                                    : "Add to Bookmarks"}
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    const newId = duplicateNote(
                                        noteContextMenuAnchor!.noteId
                                    );
                                    if (newId) setSelectedNoteId(newId);
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Copy
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item${
                                    isNoteActiveInPipDetail
                                        ? " pip-context-menu-item-disabled"
                                        : ""
                                }`}
                                disabled={isNoteActiveInPipDetail}
                                title={
                                    isNoteActiveInPipDetail
                                        ? "Cannot move note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipDetail) return;
                                    setMoveToFolderModal({
                                        sessionIdOrNull:
                                            noteContextMenuAnchor!.noteId,
                                        noteIds: [
                                            noteContextMenuAnchor!.noteId,
                                        ],
                                    });
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Move to folder
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item${
                                    isNoteActiveInPipDetail
                                        ? " pip-context-menu-item-disabled"
                                        : ""
                                }`}
                                disabled={isNoteActiveInPipDetail}
                                title={
                                    isNoteActiveInPipDetail
                                        ? "Cannot rename note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipDetail) return;
                                    const value = window.prompt(
                                        "Rename note",
                                        menuNote.displayName ??
                                            menuNote.title ??
                                            "Untitled"
                                    );
                                    if (value != null && value.trim()) {
                                        updateNote(
                                            noteContextMenuAnchor!.noteId,
                                            { displayName: value.trim() }
                                        );
                                    }
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Rename
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item danger${
                                    isNoteActiveInPipDetail
                                        ? " pip-context-menu-item-disabled"
                                        : ""
                                }`}
                                disabled={isNoteActiveInPipDetail}
                                title={
                                    isNoteActiveInPipDetail
                                        ? "Cannot delete note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipDetail) return;
                                    // Soft delete: move to trash (matches sidebar and extension - no confirmation, sync triggered by store)
                                    updateNote(noteContextMenuAnchor!.noteId, {
                                        deletedAt: Date.now(),
                                    });
                                    trackEvent("note_deleted");
                                    setNoteContextMenuAnchor(null);
                                    setToastMessage("Moved to trash");
                                }}
                            >
                                Delete
                            </button>
                        </div>,
                        document.body
                    );
                })()}
            {/* Delete confirmation modal */}
            {deleteConfirmModal && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setDeleteConfirmModal(null)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") setDeleteConfirmModal(null);
                    }}
                >
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">
                                {deleteConfirmModal.type === "emptyTrash"
                                    ? "Empty trash"
                                    : "Delete permanently"}
                            </h3>
                            <p className="modal-message">
                                {deleteConfirmModal.type === "emptyTrash"
                                    ? `Permanently delete all ${
                                          deleteConfirmModal.count
                                      } note${
                                          deleteConfirmModal.count === 1
                                              ? ""
                                              : "s"
                                      }? This cannot be undone.`
                                    : `Permanently delete "${deleteConfirmModal.noteName}"? This cannot be undone.`}
                            </p>
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="modal-btn modal-btn-secondary"
                                onClick={() => setDeleteConfirmModal(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="modal-btn pip-modal-btn-danger"
                                onClick={() => {
                                    if (
                                        deleteConfirmModal.type === "emptyTrash"
                                    ) {
                                        const count = deleteConfirmModal.count!;
                                        trashNotesInWorkspace.forEach((n) =>
                                            removeNote(n.sessionId)
                                        );
                                        if (count === 1)
                                            trackEvent("note_deleted");
                                        else
                                            trackEvent("note_deleted", {
                                                count,
                                            });
                                    } else {
                                        removeNote(deleteConfirmModal.noteId!);
                                        trackEvent("note_deleted");
                                    }
                                    setDeleteConfirmModal(null);
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bottom install bar - show when installable, not dismissed, and not already installed */}
            {installPromptEvent && !installBarDismissed && (
                <div className="install-bar">
                    <div className="install-bar-content">
                        <Download
                            className="install-bar-icon"
                            size={18}
                            aria-hidden
                        />
                        <span className="install-bar-text">
                            Install Notic for quick desktop access
                        </span>
                    </div>
                    <div className="install-bar-actions">
                        <button
                            type="button"
                            className="install-bar-btn install-bar-btn-primary"
                            onClick={handleInstall}
                        >
                            Install
                        </button>
                        <button
                            type="button"
                            className="install-bar-btn install-bar-btn-dismiss"
                            onClick={handleDismissInstallBar}
                            aria-label="Dismiss"
                            title="Dismiss"
                        >
                            <X size={16} aria-hidden />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
