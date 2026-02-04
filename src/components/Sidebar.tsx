import {
    useRef,
    useEffect,
    useState,
    useCallback,
    useMemo,
    memo,
    startTransition,
} from "react";
import { createPortal } from "react-dom";
import { useUIStore, useWorkspaceStore, useNotesStore } from "../store";
import {
    getWorkspacesInDisplayOrder,
    DEFAULT_WORKSPACE_ID,
    WORKSPACE_NAME_MAX_LENGTH,
} from "../store/useWorkspaceStore";
import {
    isDocumentPipSupported,
    openPipWithNote,
    getPipWindow,
    sendNotesUpdateToPip,
} from "../pip/documentPip";
import { formatDateKey, parseDateKey } from "../utils/dateKeys";
import type { NoteData } from "../store/types";
import type { SortOption } from "../store/types";
import { BOOKMARKS_SENTINEL, ROOT_SENTINEL } from "../store/types";
import {
    ChevronDown,
    ExternalLink,
    Pencil,
    CirclePlus,
    FolderPlus,
    Folder as FolderIcon,
    FolderOpen,
    ArrowUpDown,
    ChevronsDown,
    ChevronsUp,
    Trash2,
    Moon,
    Sun,
    Settings,
    ChevronRight,
    ChevronDown as ChevronDownIcon,
    FileText,
    Bookmark,
    Info,
} from "lucide-react";
import {
    getFolderDepth,
    getFolderAncestorIds,
    getFolderNoteCountRecursive,
    canAcceptFolderDrop,
    MAX_FOLDER_DEPTH,
} from "../utils/folderUtils";
import { useAuthStore } from "../store/useAuthStore";
import { useSubscriptionStore, FREE_NOTE_LIMIT } from "../store/useSubscriptionStore";
import { FREE_PIP_TAB_LIMIT } from "../constants";
import {
    db,
    loadPartitionIntoStores,
    LOCAL_PARTITION,
    getStoragePartition,
    getLastUserId,
    setStoredUserId,
    currentWorkspaceIdKey,
} from "../db";
import { triggerFullSync, triggerSyncAfterUserAction, setSyncPaused, clearLastServerSnapshot, startPeriodicPullCheck, stopPeriodicPullCheck } from "../sync";
import { PREFS_KEYS } from "../db/prefs-keys";
import {
    persistLastUser,
    getGoogleClientId,
    fetchGoogleProfileFromToken,
} from "../auth";
import { authenticateWithGoogleToken, clearStoredTokens } from "../api/backend";
import { useGoogleLogin } from "@react-oauth/google";
import { getRangeSelection } from "../utils/selectionRange";
import { stripMarkdownForDisplay } from "../utils/noteUtils";
import {
    exportNoteAsMarkdownBlob,
    exportFolderAsZip,
    downloadExportBlob,
    sanitizeName,
} from "../utils/exportZip";
import type { Folder as FolderType } from "../store/types";
import type { GoogleUserProfile } from "../store/useAuthStore";
import { trackEvent } from "../analytics";

const TOOLBAR_POSITION_KEY = "notic_toolbarPosition";
const TOOLBAR_DEFAULT = { top: 60, right: -40 };
const TOOLBAR_MIN_RIGHT = -60;
const TOOLBAR_MAX_RIGHT = 20;
const TOOLBAR_MIN_TOP = 0;

function loadToolbarPosition(): { top: number; right: number } {
    try {
        const s = localStorage.getItem(TOOLBAR_POSITION_KEY);
        if (s) {
            const p = JSON.parse(s) as { top?: number; right?: number };
            if (typeof p.top === "number" && typeof p.right === "number")
                return { top: p.top, right: p.right };
        }
    } catch (_) {}
    return { ...TOOLBAR_DEFAULT };
}

function saveToolbarPosition(top: number, right: number): void {
    try {
        localStorage.setItem(
            TOOLBAR_POSITION_KEY,
            JSON.stringify({ top, right })
        );
    } catch (_) {}
}

/** Google "G" logo for Sign in (matches notic dashboard). */
function GoogleIcon() {
    return (
        <span className="auth-google-icon" aria-hidden>
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
            </svg>
        </span>
    );
}

interface RecentTabListProps {
    notes: NoteData[];
    sort: SortOption;
    selectedNoteId: string | null;
    setSelectedNoteId: (id: string | null) => void;
    selectedFolderDate: string | null;
    setSelectedFolderDate: (date: string | null) => void;
    expandedSidebarFolderIds: string[];
    toggleFolderExpanded: (folderId: string, inSidebar: boolean) => void;
    openInPipNoteIds: string[];
    addNoteToPip: (noteId: string, setActive?: boolean) => void;
    /** Open PiP with this note (add to tabs, set active, open or refresh window). Used by context menu "Open". */
    openNoteInPip: (noteId: string) => void;
    selectedNoteIds: string[];
    setSelection: (noteIds: string[], folderIds: string[]) => void;
    updateNote: (sessionId: string, patch: Partial<NoteData>) => void;
    duplicateNote: (sessionId: string) => string | null;
    onNewNote: () => void;
    /** When set, RecentTabList enters rename state for this note (e.g. after toolbar New Note). */
    pendingNoteRenameId: string | null;
    onConsumePendingNoteRename: () => void;
    currentTab: "recent" | "folders";
    /** PiP window is open (used to block Edit/Open/Move/Rename when note is active in PiP). */
    pipIsOpen: boolean;
}

/** Same color options as PipView for Change color submenu (exact same design). */
const NOTE_COLOR_OPTIONS: Array<{ label: string; value: string }> = [
    { label: "Color: Default", value: "" },
    { label: "Color: Blue", value: "#3b82f6" },
    { label: "Color: Green", value: "#22c55e" },
    { label: "Color: Purple", value: "#a855f7" },
    { label: "Color: Orange", value: "#f97316" },
];

function RecentTabList({
    notes,
    sort,
    selectedNoteId,
    setSelectedNoteId,
    selectedFolderDate,
    setSelectedFolderDate,
    expandedSidebarFolderIds,
    toggleFolderExpanded,
    openInPipNoteIds: _openInPipNoteIds,
    addNoteToPip,
    openNoteInPip,
    selectedNoteIds,
    setSelection,
    updateNote,
    duplicateNote,
    onNewNote: _onNewNote,
    pendingNoteRenameId,
    onConsumePendingNoteRename,
    currentTab,
    pipIsOpen: pipIsOpenRecentProp,
}: RecentTabListProps) {
    const lastClickedIndexRef = useRef(-1);
    const initialExpandDoneRef = useRef(false);
    const submenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    const noteContextMenuAnchor = useUIStore((s) => s.noteContextMenuAnchor);
    const setNoteContextMenuAnchor = useUIStore(
        (s) => s.setNoteContextMenuAnchor
    );
    const openInPipActiveNoteId = useUIStore((s) => s.openInPipActiveNoteId);
    const openInPipNoteIdsFromStore = useUIStore((s) => s.openInPipNoteIds);
    const detailEditNoteIdRecent = useUIStore((s) => s.detailEditNoteId);
    const isNoteActiveInPip =
        Boolean(noteContextMenuAnchor) &&
        pipIsOpenRecentProp &&
        noteContextMenuAnchor!.noteId === openInPipActiveNoteId;
    const isNoteEditedInMainRecent =
        Boolean(noteContextMenuAnchor) &&
        noteContextMenuAnchor!.noteId === detailEditNoteIdRecent;
    const setShareModalNoteId = useUIStore((s) => s.setShareModalNoteId);
    const setMoveToFolderModal = useUIStore((s) => s.setMoveToFolderModal);
    const setMoveToWorkspaceModal = useUIStore(
        (s) => s.setMoveToWorkspaceModal
    );
    const selectedFolderIds = useNotesStore((s) => s.selectedFolderIds);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const [renameState, setRenameState] = useState<{
        noteId: string;
        value: string;
    } | null>(null);
    const [hoveredSubmenu, setHoveredSubmenu] = useState<"color" | null>(null);

    useEffect(() => {
        if (currentTab !== "recent") setRenameState(null);
    }, [currentTab]);

    useEffect(() => {
        if (!renameState) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                target &&
                document.body.contains(target) &&
                !(target as HTMLElement).closest?.(".note-rename-input")
            ) {
                const note = notes.find(
                    (n) => n.sessionId === renameState.noteId
                );
                const original = note?.displayName ?? note?.title ?? "Untitled";
                const trimmed = renameState.value.trim();
                if (trimmed && trimmed !== original)
                    updateNote(renameState.noteId, { displayName: trimmed });
                setRenameState(null);
            }
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [renameState, notes, updateNote]);

    useEffect(() => {
        if (!pendingNoteRenameId) return;
        const id = pendingNoteRenameId;
        setRenameState({ noteId: id, value: "Untitled" });
        const tid = setTimeout(() => onConsumePendingNoteRename(), 0);
        return () => clearTimeout(tid);
    }, [pendingNoteRenameId, onConsumePendingNoteRename]);

    const sorted = sortNotes(notes, sort);
    const bookmarkedNotes = sorted.filter((n) => n.isBookmarked);
    const notesByDate = new Map<string, NoteData[]>();
    const dateField =
        sort === "created-asc" || sort === "created-desc"
            ? "createdAt"
            : "lastModified";
    sorted.forEach((n) => {
        const key = formatDateKey(n[dateField]);
        if (!notesByDate.has(key)) notesByDate.set(key, []);
        notesByDate.get(key)!.push(n);
    });
    const dateKeys = Array.from(notesByDate.keys()).sort((a, b) => {
        if (sort === "created-asc" || sort === "modified-asc")
            return parseDateKey(a) - parseDateKey(b);
        return parseDateKey(b) - parseDateKey(a);
    });
    const sidebarDateKeys = dateKeys.slice(0, SIDEBAR_RECENT_DATE_GROUPS);

    /** Ordered list for shift+click range selection: bookmarks first, then date folders (match notic). */
    const recentOrderedList = useMemo(() => {
        const items: Array<{ type: "note"; id: string }> = [];
        bookmarkedNotes.forEach((n) =>
            items.push({ type: "note", id: n.sessionId })
        );
        sidebarDateKeys.forEach((dateKey) => {
            (notesByDate.get(dateKey) ?? []).forEach((n) =>
                items.push({ type: "note", id: n.sessionId })
            );
        });
        return items;
    }, [bookmarkedNotes, sidebarDateKeys, notesByDate]);

    // Initial expand: first date folder expanded and selected (once, match notic)
    useEffect(() => {
        if (initialExpandDoneRef.current || sidebarDateKeys.length === 0)
            return;
        initialExpandDoneRef.current = true;
        toggleFolderExpanded(sidebarDateKeys[0], true);
        setSelectedFolderDate(sidebarDateKeys[0]);
    }, [sidebarDateKeys, toggleFolderExpanded, setSelectedFolderDate]);

    const handleNoteClick = useCallback(
        (
            e: React.MouseEvent,
            noteId: string,
            dateKey: string,
            index: number
        ) => {
            e.stopPropagation();
            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.shiftKey) {
                    const from =
                        lastClickedIndexRef.current >= 0
                            ? lastClickedIndexRef.current
                            : index;
                    const lo = Math.min(from, index);
                    const hi = Math.max(from, index);
                    const ids = recentOrderedList
                        .slice(lo, hi + 1)
                        .map((item) => item.id);
                    setSelection(ids, []);
                } else {
                    const ids = selectedNoteIds.includes(noteId)
                        ? selectedNoteIds.filter((id) => id !== noteId)
                        : [...selectedNoteIds, noteId];
                    setSelection(ids, []);
                }
                lastClickedIndexRef.current = index;
                return;
            }
            lastClickedIndexRef.current = index;
            setSelection([noteId], []);
            setSelectedNoteId(noteId);
            setSelectedFolderDate(dateKey);
        },
        [
            recentOrderedList,
            selectedNoteIds,
            setSelection,
            setSelectedNoteId,
            setSelectedFolderDate,
        ]
    );

    /** Finish inline rename: save if changed, then exit (match notic inline rename). */
    const handleRenameBlur = useCallback(
        (noteId: string, value: string, originalDisplayName: string) => {
            const trimmed = value.trim();
            if (trimmed && trimmed !== originalDisplayName) {
                updateNote(noteId, { displayName: trimmed });
            }
            setRenameState(null);
        },
        [updateNote]
    );

    const handleRenameKeyDown = useCallback(
        (
            e: React.KeyboardEvent,
            noteId: string,
            value: string,
            originalDisplayName: string
        ) => {
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                const trimmed = value.trim();
                if (trimmed && trimmed !== originalDisplayName) {
                    updateNote(noteId, { displayName: trimmed });
                }
                setRenameState(null);
            } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRenameState(null);
            }
        },
        [updateNote]
    );

    // Close note context menu on outside click (ignore click that opened the menu – e.g. More button has data-context-menu-trigger)
    useEffect(() => {
        if (!noteContextMenuAnchor) return;
        const close = (e: MouseEvent) => {
            if (
                (e.target as HTMLElement)?.closest?.(
                    "[data-context-menu-trigger]"
                )
            )
                return;
            setNoteContextMenuAnchor(null);
            setHoveredSubmenu(null);
        };
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [noteContextMenuAnchor, setNoteContextMenuAnchor]);

    // Close note context menu on Escape
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setNoteContextMenuAnchor(null);
                setHoveredSubmenu(null);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [setNoteContextMenuAnchor]);


    const isNoteSelected = (sessionId: string) =>
        selectedNoteIds.includes(sessionId);

    return (
        <div className="recent-tab-list">
            {/* Bookmarks row (always show, match notic) */}
            <div
                className="sidebar-date-folder"
                data-date-key={BOOKMARKS_SENTINEL}
            >
                <div
                    className={`sidebar-folder-header ${
                        selectedFolderDate === BOOKMARKS_SENTINEL
                            ? "active"
                            : ""
                    }`}
                    data-date-key={BOOKMARKS_SENTINEL}
                    onClick={() => {
                        toggleFolderExpanded(BOOKMARKS_SENTINEL, true);
                        setSelectedFolderDate(BOOKMARKS_SENTINEL);
                        setSelectedNoteId(null);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleFolderExpanded(BOOKMARKS_SENTINEL, true);
                            setSelectedFolderDate(BOOKMARKS_SENTINEL);
                        }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={expandedSidebarFolderIds.includes(
                        BOOKMARKS_SENTINEL
                    )}
                >
                    <Bookmark
                        size={14}
                        className="sidebar-folder-header-icon"
                        aria-hidden
                    />
                    <span className="sidebar-folder-name">Bookmarks</span>
                    <span className="sidebar-folder-count">
                        {bookmarkedNotes.length}
                    </span>
                </div>
                <div
                    className={`sidebar-folder-content ${
                        expandedSidebarFolderIds.includes(BOOKMARKS_SENTINEL)
                            ? "expanded"
                            : ""
                    }`}
                >
                    <div className="sidebar-folder-content-inner">
                        {bookmarkedNotes.map((note, idx) => {
                            const isNoteActive =
                                selectedNoteId === note.sessionId;
                            const isOpenInPip =
                                openInPipNoteIdsFromStore.includes(
                                    note.sessionId
                                );
                            const displayName =
                                note.displayName || note.title || "Untitled";
                            const index = idx;
                            return (
                                <div
                                    key={note.sessionId}
                                    className={`sidebar-note-item ${
                                        isNoteActive
                                            ? "sidebar-note-item-active"
                                            : ""
                                    } ${
                                        isNoteSelected(note.sessionId)
                                            ? "sidebar-note-item-selected"
                                            : ""
                                    } ${
                                        isOpenInPip
                                            ? "sidebar-note-item-open-in-pip"
                                            : ""
                                    }`}
                                    data-session-id={note.sessionId}
                                    onClick={(e) =>
                                        handleNoteClick(
                                            e,
                                            note.sessionId,
                                            BOOKMARKS_SENTINEL,
                                            index
                                        )
                                    }
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setNoteContextMenuAnchor({
                                            x: e.clientX,
                                            y: e.clientY,
                                            noteId: note.sessionId,
                                        });
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            e.preventDefault();
                                            handleNoteClick(
                                                e as unknown as React.MouseEvent,
                                                note.sessionId,
                                                BOOKMARKS_SENTINEL,
                                                index
                                            );
                                        }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                >
                                    {note.color ? (
                                        <span
                                            className="sidebar-note-color"
                                            style={{
                                                backgroundColor: note.color,
                                            }}
                                            aria-hidden
                                        />
                                    ) : (
                                        <span
                                            className="sidebar-note-color"
                                            aria-hidden
                                        />
                                    )}
                                    <FileText
                                        size={14}
                                        className="sidebar-note-icon"
                                    />
                                    {renameState?.noteId === note.sessionId ? (
                                        <input
                                            type="text"
                                            className="note-rename-input"
                                            value={renameState.value}
                                            onChange={(e) =>
                                                setRenameState((s) =>
                                                    s
                                                        ? {
                                                              ...s,
                                                              value: e.target
                                                                  .value,
                                                          }
                                                        : null
                                                )
                                            }
                                            onBlur={() =>
                                                handleRenameBlur(
                                                    note.sessionId,
                                                    renameState.value,
                                                    displayName
                                                )
                                            }
                                            onKeyDown={(e) => {
                                                handleRenameKeyDown(
                                                    e,
                                                    note.sessionId,
                                                    renameState.value,
                                                    displayName
                                                );
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) =>
                                                e.stopPropagation()
                                            }
                                            autoFocus
                                            aria-label="Rename note"
                                        />
                                    ) : (
                                        <span className="sidebar-note-title">
                                            {stripMarkdownForDisplay(
                                                displayName
                                            )}
                                            .md
                                        </span>
                                    )}
                                    {isOpenInPip && (
                                        <span
                                            className="sidebar-note-open-indicator"
                                            aria-hidden
                                            title="Open in editor"
                                        >
                                            <ExternalLink size={12} />
                                        </span>
                                    )}
                                    {detailEditNoteIdRecent === note.sessionId && (
                                        <span
                                            className="sidebar-note-open-indicator sidebar-note-editing-indicator"
                                            aria-hidden
                                            title="Editing in main view"
                                        >
                                            <Pencil size={12} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Date folders (limit to most recent 5) */}
            {sidebarDateKeys.map((dateKey) => {
                const groupNotes = notesByDate.get(dateKey) ?? [];
                const isExpanded = expandedSidebarFolderIds.includes(dateKey);
                const isActive = selectedFolderDate === dateKey;
                const [y, m, d] = dateKey.split("-").map(Number);
                const label = new Date(
                    y,
                    (m ?? 1) - 1,
                    d ?? 1
                ).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                });
                return (
                    <div
                        key={dateKey}
                        className="sidebar-date-folder"
                        data-date-key={dateKey}
                    >
                        <div
                            className={`sidebar-folder-header ${
                                isActive ? "active" : ""
                            }`}
                            data-date-key={dateKey}
                            onClick={(e) => {
                                if (
                                    (e.target as HTMLElement).closest(
                                        ".sidebar-folder-chevron"
                                    )
                                )
                                    return;
                                const nextExpanded =
                                    !expandedSidebarFolderIds.includes(dateKey);
                                toggleFolderExpanded(dateKey, true);
                                setSelectedFolderDate(dateKey);
                                if (!nextExpanded) setSelectedNoteId(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleFolderExpanded(dateKey, true);
                                    setSelectedFolderDate(dateKey);
                                }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                        >
                            <span
                                className="sidebar-folder-chevron"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFolderExpanded(dateKey, true);
                                }}
                                role="button"
                                tabIndex={-1}
                                aria-hidden
                            >
                                {isExpanded ? (
                                    <ChevronDownIcon
                                        size={12}
                                        strokeWidth={2}
                                    />
                                ) : (
                                    <ChevronRight size={12} strokeWidth={2} />
                                )}
                            </span>
                            <span className="sidebar-folder-name">{label}</span>
                            <span className="sidebar-folder-count">
                                {groupNotes.length}
                            </span>
                        </div>
                        <div
                            className={`sidebar-folder-content ${
                                isExpanded ? "expanded" : ""
                            }`}
                        >
                            <div className="sidebar-folder-content-inner">
                                {groupNotes.map((note, idx) => {
                                    const isNoteActive =
                                        selectedNoteId === note.sessionId;
                                    const isOpenInPipDate =
                                        openInPipNoteIdsFromStore.includes(
                                            note.sessionId
                                        );
                                    const displayName =
                                        note.displayName ||
                                        note.title ||
                                        "Untitled";
                                    const index =
                                        bookmarkedNotes.length +
                                        sidebarDateKeys
                                            .slice(
                                                0,
                                                sidebarDateKeys.indexOf(dateKey)
                                            )
                                            .reduce(
                                                (acc, k) =>
                                                    acc +
                                                    (notesByDate.get(k)
                                                        ?.length ?? 0),
                                                0
                                            ) +
                                        idx;
                                    return (
                                        <div
                                            key={note.sessionId}
                                            className={`sidebar-note-item ${
                                                isNoteActive
                                                    ? "sidebar-note-item-active"
                                                    : ""
                                            } ${
                                                isNoteSelected(note.sessionId)
                                                    ? "sidebar-note-item-selected"
                                                    : ""
                                            } ${
                                                isOpenInPipDate
                                                    ? "sidebar-note-item-open-in-pip"
                                                    : ""
                                            }`}
                                            data-session-id={note.sessionId}
                                            onClick={(e) =>
                                                handleNoteClick(
                                                    e,
                                                    note.sessionId,
                                                    dateKey,
                                                    index
                                                )
                                            }
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setNoteContextMenuAnchor({
                                                    x: e.clientX,
                                                    y: e.clientY,
                                                    noteId: note.sessionId,
                                                });
                                            }}
                                            onKeyDown={(e) => {
                                                if (
                                                    e.key === "Enter" ||
                                                    e.key === " "
                                                ) {
                                                    e.preventDefault();
                                                    handleNoteClick(
                                                        e as unknown as React.MouseEvent,
                                                        note.sessionId,
                                                        dateKey,
                                                        index
                                                    );
                                                }
                                            }}
                                            role="button"
                                            tabIndex={0}
                                        >
                                            {note.color ? (
                                                <span
                                                    className="sidebar-note-color"
                                                    style={{
                                                        backgroundColor:
                                                            note.color,
                                                    }}
                                                    aria-hidden
                                                />
                                            ) : (
                                                <span
                                                    className="sidebar-note-color"
                                                    aria-hidden
                                                />
                                            )}
                                            <FileText
                                                size={14}
                                                className="sidebar-note-icon"
                                            />
                                            {renameState?.noteId ===
                                            note.sessionId ? (
                                                <input
                                                    type="text"
                                                    className="note-rename-input"
                                                    value={renameState.value}
                                                    onChange={(e) =>
                                                        setRenameState((s) =>
                                                            s
                                                                ? {
                                                                      ...s,
                                                                      value: e
                                                                          .target
                                                                          .value,
                                                                  }
                                                                : null
                                                        )
                                                    }
                                                    onBlur={() =>
                                                        handleRenameBlur(
                                                            note.sessionId,
                                                            renameState.value,
                                                            displayName
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        handleRenameKeyDown(
                                                            e,
                                                            note.sessionId,
                                                            renameState.value,
                                                            displayName
                                                        );
                                                    }}
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    onMouseDown={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                    autoFocus
                                                    aria-label="Rename note"
                                                />
                                            ) : (
                                                <span className="sidebar-note-title">
                                                    {stripMarkdownForDisplay(
                                                        displayName
                                                    )}
                                                    .md
                                                </span>
                                            )}
                                            {isOpenInPipDate && (
                                                <span
                                                    className="sidebar-note-open-indicator"
                                                    aria-hidden
                                                    title="Open in editor"
                                                >
                                                    <ExternalLink size={12} />
                                                </span>
                                            )}
                                            {detailEditNoteIdRecent === note.sessionId && (
                                                <span
                                                    className="sidebar-note-open-indicator sidebar-note-editing-indicator"
                                                    aria-hidden
                                                    title="Editing in main view"
                                                >
                                                    <Pencil size={12} />
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                );
            })}

            {sidebarDateKeys.length === 0 && (
                <div className="empty-state">
                    <p>No notes yet</p>
                </div>
            )}

            {/* Note context menu – same design as PiP; from sidebar or detail More; portal so visible when Folders tab active. Skip when menu is for selected note (opened from detail "…") so MainContent can show its menu with correct PiP blocking. */}
            {noteContextMenuAnchor &&
                noteContextMenuAnchor.noteId !== selectedNoteId &&
                createPortal(
                    (() => {
                        const menuNote = notes.find(
                            (n) => n.sessionId === noteContextMenuAnchor.noteId
                        );
                        const isBookmarked = menuNote?.isBookmarked === true;
                        return (
                            <div
                                className="pip-context-menu show"
                                style={{
                                    left: noteContextMenuAnchor.x,
                                    top: noteContextMenuAnchor.y,
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
                                            window.innerHeight -
                                            rect.height -
                                            10
                                        }px`;
                                }}
                            >
                                <button
                                    type="button"
                                    className={`pip-context-menu-item${isNoteActiveInPip || isNoteEditedInMainRecent ? " pip-context-menu-item-disabled" : ""}`}
                                    disabled={isNoteActiveInPip || isNoteEditedInMainRecent}
                                    title={
                                        isNoteEditedInMainRecent
                                            ? "Already editing in main view"
                                            : isNoteActiveInPip
                                            ? "Note is already open in editor"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (isNoteActiveInPip || isNoteEditedInMainRecent) return;
                                        setSelectedNoteId(
                                            noteContextMenuAnchor.noteId
                                        );
                                        addNoteToPip(
                                            noteContextMenuAnchor.noteId,
                                            true
                                        );
                                        setNoteContextMenuAnchor(null);
                                    }}
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    className={`pip-context-menu-item${isNoteActiveInPip || isNoteEditedInMainRecent ? " pip-context-menu-item-disabled" : ""}`}
                                    disabled={isNoteActiveInPip || isNoteEditedInMainRecent}
                                    title={
                                        isNoteEditedInMainRecent
                                            ? "Finish editing in main view first"
                                            : isNoteActiveInPip
                                            ? "Note is already open in editor"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (isNoteActiveInPip || isNoteEditedInMainRecent) return;
                                        openNoteInPip(noteContextMenuAnchor.noteId);
                                        setNoteContextMenuAnchor(null);
                                    }}
                                >
                                    Open
                                </button>
                                <button
                                    type="button"
                                    className="pip-context-menu-item"
                                    onClick={() => {
                                        updateNote(
                                            noteContextMenuAnchor.noteId,
                                            { isBookmarked: !isBookmarked }
                                        );
                                        setNoteContextMenuAnchor(null);
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
                                            noteContextMenuAnchor.noteId
                                        );
                                        if (newId) {
                                            setSelectedNoteId(newId);
                                            triggerSyncAfterUserAction(db);
                                        }
                                        setNoteContextMenuAnchor(null);
                                    }}
                                >
                                    Copy
                                </button>
                                <button
                                    type="button"
                                    className={`pip-context-menu-item${isNoteActiveInPip ? " pip-context-menu-item-disabled" : ""}`}
                                    disabled={isNoteActiveInPip}
                                    title={
                                        isNoteActiveInPip
                                            ? "Cannot move note open in editor"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (isNoteActiveInPip) return;
                                        const isMulti =
                                            selectedNoteIds.length > 1 &&
                                            selectedNoteIds.includes(
                                                noteContextMenuAnchor.noteId
                                            );
                                        setNoteContextMenuAnchor(null);
                                        setMoveToFolderModal({
                                            sessionIdOrNull:
                                                noteContextMenuAnchor.noteId,
                                            noteIds: isMulti
                                                ? [...selectedNoteIds]
                                                : undefined,
                                            folderIds: isMulti
                                                ? [...selectedFolderIds]
                                                : undefined,
                                        });
                                    }}
                                >
                                    Move to folder…
                                </button>
                                <button
                                    type="button"
                                    className={`pip-context-menu-item${isNoteActiveInPip || Object.keys(workspaces).length <= 1 ? " pip-context-menu-item-disabled" : ""}`}
                                    disabled={
                                        isNoteActiveInPip ||
                                        Object.keys(workspaces).length <= 1
                                    }
                                    title={
                                        isNoteActiveInPip
                                            ? "Cannot move note open in editor"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (isNoteActiveInPip) return;
                                        const isMulti =
                                            selectedNoteIds.length > 1 &&
                                            selectedNoteIds.includes(
                                                noteContextMenuAnchor.noteId
                                            );
                                        setNoteContextMenuAnchor(null);
                                        setMoveToWorkspaceModal({
                                            sessionIdOrNull:
                                                noteContextMenuAnchor.noteId,
                                            noteIds: isMulti
                                                ? [...selectedNoteIds]
                                                : undefined,
                                        });
                                    }}
                                >
                                    Move to workspace…
                                </button>
                                <button
                                    type="button"
                                    className="pip-context-menu-item"
                                    onClick={() => {
                                        if (menuNote) {
                                            const blob =
                                                exportNoteAsMarkdownBlob(
                                                    menuNote
                                                );
                                            downloadExportBlob(
                                                blob,
                                                `${sanitizeName(
                                                    menuNote.displayName ??
                                                        menuNote.title
                                                )}.md`
                                            );
                                            trackEvent("export_completed", {
                                                format: "markdown",
                                            });
                                        }
                                        setNoteContextMenuAnchor(null);
                                    }}
                                >
                                    Export
                                </button>
                                <button
                                    type="button"
                                    className="pip-context-menu-item"
                                    onClick={() => {
                                        if (noteContextMenuAnchor) {
                                            setSelectedNoteId(
                                                noteContextMenuAnchor.noteId
                                            );
                                            setShareModalNoteId(
                                                noteContextMenuAnchor.noteId
                                            );
                                        }
                                        setNoteContextMenuAnchor(null);
                                    }}
                                >
                                    Share
                                </button>
                                <div
                                    className="pip-context-menu-item pip-context-menu-item-has-submenu"
                                    onMouseEnter={() => {
                                        if (submenuCloseTimerRef.current) {
                                            clearTimeout(
                                                submenuCloseTimerRef.current
                                            );
                                            submenuCloseTimerRef.current = null;
                                        }
                                        setHoveredSubmenu("color");
                                    }}
                                    onMouseLeave={() => {
                                        submenuCloseTimerRef.current =
                                            setTimeout(() => {
                                                submenuCloseTimerRef.current =
                                                    null;
                                                setHoveredSubmenu(null);
                                            }, 150);
                                    }}
                                >
                                    <span className="pip-context-menu-item-label">
                                        Change color
                                    </span>
                                    <span className="pip-context-menu-item-chevron">
                                        ›
                                    </span>
                                    <div
                                        className={`pip-context-menu-submenu ${
                                            hoveredSubmenu === "color"
                                                ? "show"
                                                : ""
                                        }`}
                                    >
                                        {NOTE_COLOR_OPTIONS.map((opt) => (
                                            <button
                                                key={opt.value || "default"}
                                                type="button"
                                                className="pip-context-menu-submenu-item"
                                                onClick={() => {
                                                    updateNote(
                                                        noteContextMenuAnchor.noteId,
                                                        {
                                                            color:
                                                                opt.value ||
                                                                undefined,
                                                        }
                                                    );
                                                    setNoteContextMenuAnchor(
                                                        null
                                                    );
                                                    setHoveredSubmenu(null);
                                                }}
                                            >
                                                <span
                                                    className={`pip-context-menu-color-swatch ${
                                                        !opt.value
                                                            ? "pip-context-menu-color-swatch-default"
                                                            : ""
                                                    }`}
                                                    style={
                                                        opt.value
                                                            ? {
                                                                  backgroundColor:
                                                                      opt.value,
                                                              }
                                                            : undefined
                                                    }
                                                />
                                                <span className="pip-context-menu-submenu-item-label">
                                                    {opt.label}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    className={`pip-context-menu-item${isNoteActiveInPip ? " pip-context-menu-item-disabled" : ""}`}
                                    disabled={isNoteActiveInPip}
                                    title={
                                        isNoteActiveInPip
                                            ? "Cannot rename note open in editor"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (isNoteActiveInPip) return;
                                        setRenameState({
                                            noteId: noteContextMenuAnchor.noteId,
                                            value:
                                                menuNote?.displayName ||
                                                menuNote?.title ||
                                                "Untitled",
                                        });
                                        setNoteContextMenuAnchor(null);
                                    }}
                                >
                                    Rename
                                </button>
                                <button
                                    type="button"
                                    className={`pip-context-menu-item danger${isNoteActiveInPip ? " pip-context-menu-item-disabled" : ""}`}
                                    disabled={isNoteActiveInPip}
                                    title={
                                        isNoteActiveInPip
                                            ? "Cannot delete note open in editor"
                                            : undefined
                                    }
                                    onClick={() => {
                                        if (isNoteActiveInPip) return;
                                        const isMulti =
                                            selectedNoteIds.length > 1 &&
                                            selectedNoteIds.includes(
                                                noteContextMenuAnchor.noteId
                                            );
                                        // Immediate soft delete (matches extension - no confirmation modal)
                                        const toDelete = isMulti
                                            ? selectedNoteIds
                                            : [noteContextMenuAnchor.noteId];
                                        toDelete.forEach((id) => updateNote(id, { deletedAt: Date.now() }));
                                        if (toDelete.length === 1) trackEvent("note_deleted");
                                        else trackEvent("note_deleted", { count: toDelete.length });
                                        setSelection([], []);
                                        const remaining =
                                            notes.find((n) => !toDelete.includes(n.sessionId))?.sessionId ??
                                            null;
                                        setSelectedNoteId(remaining);
                                        setNoteContextMenuAnchor(null);
                                        useUIStore.getState().setToastMessage(
                                            toDelete.length === 1 ? "Moved to trash" : `${toDelete.length} items moved to trash`
                                        );
                                        triggerSyncAfterUserAction(db);
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        );
                    })(),
                    document.body
                )}

            {/* Empty area context menu */}
        </div>
    );
}

const RecentTabListMemo = memo(RecentTabList);

interface SidebarProps {
    collapsed: boolean;
    width: number;
}

export const OPEN_NOTES_EMPTY_ID = "__open_notes__";

const SIDEBAR_RECENT_DATE_GROUPS = 5;

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

const FOLDER_COLOR_OPTIONS: Array<{ label: string; value: string }> = [
    { label: "Default", value: "" },
    { label: "Blue", value: "#3b82f6" },
    { label: "Green", value: "#22c55e" },
    { label: "Purple", value: "#a855f7" },
    { label: "Orange", value: "#f97316" },
];

interface FoldersTabListProps {
    notes: Record<string, NoteData>;
    folders: Record<string, FolderType>;
    foldersInWorkspace: FolderType[];
    notesInWorkspace: NoteData[];
    sort: SortOption;
    selectedNoteId: string | null;
    selectedFolderId: string | null;
    setSelectedNoteId: (id: string | null) => void;
    setSelectedFolderId: (id: string | null) => void;
    selectedNoteIds: string[];
    selectedFolderIds: string[];
    setSelection: (noteIds: string[], folderIds: string[]) => void;
    clearSelection: () => void;
    expandedSidebarFolderIds: string[];
    setExpandedSidebarFolderIds: (ids: string[]) => void;
    toggleFolderExpanded: (folderId: string, inSidebar: boolean) => void;
    openInPipNoteIds: string[];
    addNoteToPip: (noteId: string, setActive?: boolean) => void;
    /** Open PiP with this note (add to tabs, set active, open or refresh window). Used by context menu "Open". */
    openNoteInPip: (noteId: string) => void;
    pipIsOpen: boolean;
    setIsTrashView: (v: boolean) => void;
    currentWorkspaceId: string | null;
    addNote: (options?: {
        workspaceId?: string | null;
        folderId?: string | null;
    }) => string;
    addFolder: (options: {
        name?: string;
        parentId?: string | null;
        workspaceId?: string | null;
    }) => string;
    updateFolder: (
        folderId: string,
        patch: Partial<
            Pick<FolderType, "name" | "displayName" | "color" | "parentId">
        >
    ) => void;
    removeFolder: (folderId: string) => void;
    /** When set, FoldersTabList enters rename state for this folder (e.g. after toolbar New Folder). */
    pendingFolderRenameId: string | null;
    onConsumePendingFolderRename: () => void;
    /** When set, FoldersTabList enters rename state for this note (e.g. after toolbar New Note on Folders tab). */
    pendingNoteRenameId: string | null;
    onConsumePendingNoteRename: () => void;
    updateNote: (sessionId: string, patch: Partial<NoteData>) => void;
    duplicateNote: (sessionId: string) => string | null;
    currentTab: "recent" | "folders";
}

const DND_TYPE_FOLDER = "application/x-notic-folder-id";
const DND_TYPE_MULTI = "application/x-notic-multi";

function FoldersTabList({
    notes,
    folders,
    foldersInWorkspace,
    notesInWorkspace,
    sort,
    selectedNoteId,
    selectedFolderId,
    setSelectedNoteId,
    setSelectedFolderId,
    selectedNoteIds,
    selectedFolderIds,
    setSelection,
    expandedSidebarFolderIds,
    setExpandedSidebarFolderIds,
    toggleFolderExpanded,
    openInPipNoteIds: _openInPipNoteIds,
    addNoteToPip,
    openNoteInPip,
    pipIsOpen: _pipIsOpen,
    setIsTrashView,
    currentWorkspaceId,
    addNote,
    addFolder,
    updateFolder,
    removeFolder,
    clearSelection,
    pendingFolderRenameId,
    onConsumePendingFolderRename,
    pendingNoteRenameId,
    onConsumePendingNoteRename,
    updateNote,
    duplicateNote,
    currentTab,
}: FoldersTabListProps) {
    const folderContextMenuSubmenuTimerRef = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);
    const lastClickedSelectableIndexRef = useRef(-1);
    const draggedFolderIdRef = useRef<string | null>(null);
    const noteContextMenuAnchor = useUIStore((s) => s.noteContextMenuAnchor);
    const setNoteContextMenuAnchor = useUIStore(
        (s) => s.setNoteContextMenuAnchor
    );
    const openInPipActiveNoteIdFolders = useUIStore(
        (s) => s.openInPipActiveNoteId
    );
    const detailEditNoteIdFolders = useUIStore((s) => s.detailEditNoteId);
    const isNoteActiveInPipFolders =
        Boolean(noteContextMenuAnchor) &&
        _pipIsOpen &&
        noteContextMenuAnchor!.noteId === openInPipActiveNoteIdFolders;
    const isNoteEditedInMainFolders =
        Boolean(noteContextMenuAnchor) &&
        noteContextMenuAnchor!.noteId === detailEditNoteIdFolders;
    const setMoveToFolderModal = useUIStore((s) => s.setMoveToFolderModal);
    const setMoveToWorkspaceModal = useUIStore(
        (s) => s.setMoveToWorkspaceModal
    );
    const setShareModalNoteId = useUIStore((s) => s.setShareModalNoteId);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const [noteMenuHoveredSubmenu, setNoteMenuHoveredSubmenu] = useState<
        "color" | null
    >(null);
    const noteMenuSubmenuTimerRef = useRef<ReturnType<
        typeof setTimeout
    > | null>(null);

    const clearDragOverClass = useCallback(() => {
        document
            .querySelectorAll(
                ".sidebar-folder-header.drag-over, .sidebar-root-drop-zone.drag-over"
            )
            .forEach((el) => el.classList.remove("drag-over"));
        document
            .querySelectorAll(
                ".sidebar-folder-container.dragging, .sidebar-note-item.dragging"
            )
            .forEach((el) => el.classList.remove("dragging"));
    }, []);

    const hasMultiSelection =
        selectedNoteIds.length > 0 || selectedFolderIds.length > 0;
    const handleFolderDragStart = useCallback(
        (folderId: string, e: React.DragEvent) => {
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                if (hasMultiSelection && selectedFolderIds.includes(folderId)) {
                    e.dataTransfer.setData(
                        DND_TYPE_MULTI,
                        JSON.stringify({
                            noteIds: selectedNoteIds,
                            folderIds: selectedFolderIds,
                        })
                    );
                } else {
                    e.dataTransfer.setData(DND_TYPE_FOLDER, folderId);
                }
                e.dataTransfer.setData("text/plain", "");
                draggedFolderIdRef.current = folderId;
                const container = (e.target as HTMLElement).closest(
                    ".sidebar-folder-container"
                );
                if (container) container.classList.add("dragging");
            }
        },
        [hasMultiSelection, selectedNoteIds, selectedFolderIds]
    );
    const handleFolderDragEnd = useCallback(() => {
        draggedFolderIdRef.current = null;
        clearDragOverClass();
    }, [clearDragOverClass]);
    const handleFolderDragOver = useCallback(
        (folderId: string, e: React.DragEvent) => {
            const types = e.dataTransfer?.types ?? [];
            if (types.includes(DND_TYPE_FOLDER)) {
                const dragged = draggedFolderIdRef.current;
                if (
                    dragged &&
                    canAcceptFolderDrop(dragged, folderId, folders)
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                    (e.currentTarget as HTMLElement).classList.add("drag-over");
                }
            } else {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                (e.currentTarget as HTMLElement).classList.add("drag-over");
            }
        },
        [folders]
    );
    const handleFolderDragLeave = useCallback((e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove("drag-over");
    }, []);
    const handleFolderDrop = useCallback(
        (targetFolderId: string, e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLElement).classList.remove("drag-over");
            const multiRaw = e.dataTransfer?.getData(DND_TYPE_MULTI);
            if (multiRaw) {
                try {
                    const { noteIds, folderIds } = JSON.parse(multiRaw) as {
                        noteIds: string[];
                        folderIds: string[];
                    };
                    (noteIds || []).forEach((sid) =>
                        updateNote(sid, { folderId: targetFolderId })
                    );
                    (folderIds || []).forEach((fid) => {
                        if (
                            fid !== targetFolderId &&
                            canAcceptFolderDrop(fid, targetFolderId, folders)
                        ) {
                            updateFolder(fid, { parentId: targetFolderId });
                        }
                    });
                    clearSelection();
                } catch (_) {}
                return;
            }
            const droppedFolderId = e.dataTransfer?.getData(DND_TYPE_FOLDER);
            if (
                droppedFolderId &&
                canAcceptFolderDrop(droppedFolderId, targetFolderId, folders)
            ) {
                updateFolder(droppedFolderId, { parentId: targetFolderId });
                return;
            }
            const sessionId = e.dataTransfer?.getData("text/plain");
            if (sessionId) {
                updateNote(sessionId, { folderId: targetFolderId });
            }
        },
        [updateNote, updateFolder, clearSelection, folders]
    );

    const handleNoteDragStart = useCallback(
        (sessionId: string, e: React.DragEvent) => {
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                if (hasMultiSelection && selectedNoteIds.includes(sessionId)) {
                    e.dataTransfer.setData(
                        DND_TYPE_MULTI,
                        JSON.stringify({
                            noteIds: selectedNoteIds,
                            folderIds: selectedFolderIds,
                        })
                    );
                } else {
                    e.dataTransfer.setData("text/plain", sessionId);
                }
                (e.currentTarget as HTMLElement).classList.add("dragging");
            }
        },
        [hasMultiSelection, selectedNoteIds, selectedFolderIds]
    );
    const handleNoteDragEnd = useCallback(() => {
        clearDragOverClass();
    }, [clearDragOverClass]);

    const handleRootZoneDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).classList.add("drag-over");
    }, []);
    const handleRootZoneDragLeave = useCallback((e: React.DragEvent) => {
        (e.currentTarget as HTMLElement).classList.remove("drag-over");
    }, []);
    const handleRootZoneDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLElement).classList.remove("drag-over");
            const multiRaw = e.dataTransfer?.getData(DND_TYPE_MULTI);
            if (multiRaw) {
                try {
                    const { noteIds, folderIds } = JSON.parse(multiRaw) as {
                        noteIds: string[];
                        folderIds: string[];
                    };
                    (noteIds || []).forEach((sid) =>
                        updateNote(sid, { folderId: undefined })
                    );
                    (folderIds || []).forEach((fid) =>
                        updateFolder(fid, { parentId: null })
                    );
                    clearSelection();
                } catch (_) {}
                return;
            }
            const droppedFolderId = e.dataTransfer?.getData(DND_TYPE_FOLDER);
            if (droppedFolderId) {
                updateFolder(droppedFolderId, { parentId: null });
                return;
            }
            const sessionId = e.dataTransfer?.getData("text/plain");
            if (sessionId) {
                updateNote(sessionId, { folderId: undefined });
            }
        },
        [updateNote, updateFolder, clearSelection]
    );

    const [folderContextMenuAnchor, setFolderContextMenuAnchor] = useState<{
        x: number;
        y: number;
        folderId: string;
    } | null>(null);
    const [folderRenameState, setFolderRenameState] = useState<{
        folderId: string;
        value: string;
    } | null>(null);
    const [noteRenameState, setNoteRenameState] = useState<{
        noteId: string;
        value: string;
    } | null>(null);
    const [folderColorSubmenu, setFolderColorSubmenu] = useState<
        "color" | null
    >(null);
    const [folderDeleteConfirm, setFolderDeleteConfirm] = useState<{
        folderId: string;
        displayName: string;
    } | null>(null);

    useEffect(() => {
        if (currentTab !== "folders") {
            setFolderRenameState(null);
            setNoteRenameState(null);
        }
    }, [currentTab]);

    useEffect(() => {
        const active = folderRenameState ?? noteRenameState;
        if (!active) return;
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (
                target &&
                document.body.contains(target) &&
                !(target as HTMLElement).closest?.(".note-rename-input")
            ) {
                if (folderRenameState) {
                    const folder = folders[folderRenameState.folderId];
                    const original =
                        folder?.displayName ?? folder?.name ?? "Untitled";
                    const trimmed = folderRenameState.value.trim();
                    if (trimmed && trimmed !== original) {
                        updateFolder(folderRenameState.folderId, {
                            name: trimmed,
                            displayName: undefined,
                        });
                    }
                    setFolderRenameState(null);
                }
                if (noteRenameState) {
                    const note = notes[noteRenameState.noteId];
                    const original =
                        note?.displayName ?? note?.title ?? "Untitled";
                    const trimmed = noteRenameState.value.trim();
                    if (trimmed && trimmed !== original) {
                        updateNote(noteRenameState.noteId, {
                            displayName: trimmed,
                        });
                    }
                    setNoteRenameState(null);
                }
            }
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [
        folderRenameState,
        noteRenameState,
        folders,
        notes,
        updateFolder,
        updateNote,
    ]);

    useEffect(() => {
        if (!pendingNoteRenameId) return;
        const id = pendingNoteRenameId;
        setNoteRenameState({ noteId: id, value: "Untitled" });
        const tid = setTimeout(() => onConsumePendingNoteRename(), 0);
        return () => clearTimeout(tid);
    }, [pendingNoteRenameId, onConsumePendingNoteRename]);

    useEffect(() => {
        if (!pendingFolderRenameId) return;
        const id = pendingFolderRenameId;
        setFolderRenameState({ folderId: id, value: "Untitled" });
        // Defer consume so rename state is committed and input mounts (with autoFocus) before clearing pending
        const tid = setTimeout(() => onConsumePendingFolderRename(), 0);
        return () => clearTimeout(tid);
    }, [pendingFolderRenameId, onConsumePendingFolderRename]);

    useEffect(() => {
        if (!folderContextMenuAnchor) return;
        const close = (e: MouseEvent) => {
            if (
                (e.target as HTMLElement)?.closest?.(
                    "[data-folder-context-menu]"
                )
            )
                return;
            setFolderContextMenuAnchor(null);
            setFolderColorSubmenu(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setFolderContextMenuAnchor(null);
                setFolderColorSubmenu(null);
            }
        };
        window.addEventListener("click", close);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("click", close);
            window.removeEventListener("keydown", onKey);
        };
    }, [folderContextMenuAnchor]);

    useEffect(() => {
        if (!noteContextMenuAnchor) return;
        const close = (e: MouseEvent) => {
            if (
                (e.target as HTMLElement)?.closest?.(
                    "[data-context-menu-trigger]"
                )
            )
                return;
            if ((e.target as HTMLElement)?.closest?.(".pip-context-menu"))
                return;
            setNoteContextMenuAnchor(null);
            setNoteMenuHoveredSubmenu(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setNoteContextMenuAnchor(null);
                setNoteMenuHoveredSubmenu(null);
            }
        };
        window.addEventListener("click", close);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("click", close);
            window.removeEventListener("keydown", onKey);
        };
    }, [noteContextMenuAnchor, setNoteContextMenuAnchor]);


    const bookmarkedNotes = sortNotes(
        notesInWorkspace.filter((n) => n.isBookmarked),
        sort
    );
    const bookmarksExpanded =
        expandedSidebarFolderIds.includes(BOOKMARKS_SENTINEL);
    const bookmarksActive = selectedFolderId === BOOKMARKS_SENTINEL;

    const rootFolders = foldersInWorkspace
        .filter((f) => f.parentId === null)
        .sort((a, b) =>
            (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
        );
    const folderlessNotes = sortNotes(
        notesInWorkspace.filter((n) => !n.folderId || !folders[n.folderId]),
        sort
    );
    const rootCount = rootFolders.length + folderlessNotes.length;
    const rootExpanded = expandedSidebarFolderIds.includes(ROOT_SENTINEL);
    const rootActive =
        selectedFolderId === ROOT_SENTINEL || selectedFolderId === null;

    type SelectableItem =
        | { type: "note"; id: string }
        | { type: "folder"; id: string };
    const foldersOrderedSelectables = useMemo((): SelectableItem[] => {
        const result: SelectableItem[] = [];
        const bookmarksExpanded =
            expandedSidebarFolderIds.includes(BOOKMARKS_SENTINEL);
        const rootExpanded = expandedSidebarFolderIds.includes(ROOT_SENTINEL);
        if (bookmarksExpanded) {
            bookmarkedNotes.forEach((n) =>
                result.push({ type: "note", id: n.sessionId })
            );
        }
        if (rootExpanded) {
            const addFolderAndChildren = (folder: FolderType) => {
                result.push({ type: "folder", id: folder.id });
                if (!expandedSidebarFolderIds.includes(folder.id)) return;
                const subfolders = foldersInWorkspace
                    .filter((f) => f.parentId === folder.id)
                    .sort((a, b) =>
                        (a.displayName ?? a.name).localeCompare(
                            b.displayName ?? b.name
                        )
                    );
                subfolders.forEach(addFolderAndChildren);
                const folderNotes = sortNotes(
                    notesInWorkspace.filter(
                        (n) => (n.folderId ?? null) === folder.id
                    ),
                    sort
                );
                folderNotes.forEach((n) =>
                    result.push({ type: "note", id: n.sessionId })
                );
            };
            rootFolders.forEach(addFolderAndChildren);
            folderlessNotes.forEach((n) =>
                result.push({ type: "note", id: n.sessionId })
            );
        }
        return result;
    }, [
        expandedSidebarFolderIds,
        bookmarkedNotes,
        rootFolders,
        folderlessNotes,
        foldersInWorkspace,
        notesInWorkspace,
        sort,
    ]);

    const handleSelectableClick = useCallback(
        (
            item: SelectableItem,
            index: number,
            shiftKey: boolean,
            ctrlKey: boolean
        ) => {
            if (shiftKey) {
                const { noteIds, folderIds } = getRangeSelection(
                    foldersOrderedSelectables,
                    lastClickedSelectableIndexRef.current,
                    index
                );
                setSelection(noteIds, folderIds);
            } else if (ctrlKey) {
                const noteIds =
                    item.type === "note"
                        ? selectedNoteIds.includes(item.id)
                            ? selectedNoteIds.filter((id) => id !== item.id)
                            : [...selectedNoteIds, item.id]
                        : selectedNoteIds;
                const folderIds =
                    item.type === "folder"
                        ? selectedFolderIds.includes(item.id)
                            ? selectedFolderIds.filter((id) => id !== item.id)
                            : [...selectedFolderIds, item.id]
                        : selectedFolderIds;
                setSelection(noteIds, folderIds);
            } else {
                if (item.type === "note") {
                    setSelection([item.id], []);
                    setSelectedNoteId(item.id);
                    setSelectedFolderId(ROOT_SENTINEL);
                } else {
                    setSelection([], [item.id]);
                    setSelectedNoteId(null);
                    setSelectedFolderId(item.id);
                }
                setIsTrashView(false);
            }
            lastClickedSelectableIndexRef.current = index;
        },
        [
            foldersOrderedSelectables,
            setSelection,
            setSelectedNoteId,
            setSelectedFolderId,
            selectedNoteIds,
            selectedFolderIds,
            addNoteToPip,
            setIsTrashView,
        ]
    );

    const handleFolderHeaderClick = (
        folderId: string,
        index?: number,
        e?: React.MouseEvent
    ) => {
        if (
            e &&
            (e.shiftKey || e.ctrlKey || e.metaKey) &&
            index !== undefined
        ) {
            e.preventDefault();
            e.stopPropagation();
            handleSelectableClick(
                { type: "folder", id: folderId },
                index,
                e.shiftKey,
                e.ctrlKey || e.metaKey
            );
            return;
        }
        setIsTrashView(false);
        toggleFolderExpanded(folderId, true);
        setSelectedFolderId(folderId);
        setSelectedNoteId(null);
        if (index !== undefined) lastClickedSelectableIndexRef.current = index;
    };

    const handleNoteClick = (
        noteId: string,
        folderId: string | null,
        index?: number,
        e?: React.MouseEvent
    ) => {
        if (
            e &&
            (e.shiftKey || e.ctrlKey || e.metaKey) &&
            index !== undefined
        ) {
            e.preventDefault();
            e.stopPropagation();
            handleSelectableClick(
                { type: "note", id: noteId },
                index,
                e.shiftKey,
                e.ctrlKey || e.metaKey
            );
            return;
        }
        setIsTrashView(false);
        setSelection([noteId], []);
        setSelectedNoteId(noteId);
        setSelectedFolderId(folderId ?? ROOT_SENTINEL);
        if (index !== undefined) lastClickedSelectableIndexRef.current = index;
    };

    const handleFolderRenameBlur = (
        folderId: string,
        value: string,
        originalName: string
    ) => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== originalName) {
            updateFolder(folderId, { name: trimmed, displayName: undefined });
            triggerSyncAfterUserAction(db);
        }
        setFolderRenameState(null);
    };

    const handleFolderRenameKeyDown = (
        e: React.KeyboardEvent,
        folderId: string,
        value: string,
        originalName: string
    ) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const trimmed = value.trim();
            if (trimmed && trimmed !== originalName) {
                updateFolder(folderId, {
                    name: trimmed,
                    displayName: undefined,
                });
            }
            setFolderRenameState(null);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setFolderRenameState(null);
        }
    };

    const handleNoteRenameBlur = (
        noteId: string,
        value: string,
        originalDisplayName: string
    ) => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== originalDisplayName) {
            updateNote(noteId, { displayName: trimmed });
        }
        setNoteRenameState(null);
    };

    const handleNoteRenameKeyDown = (
        e: React.KeyboardEvent,
        noteId: string,
        value: string,
        originalDisplayName: string
    ) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            const trimmed = value.trim();
            if (trimmed && trimmed !== originalDisplayName) {
                updateNote(noteId, { displayName: trimmed });
            }
            setNoteRenameState(null);
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setNoteRenameState(null);
        }
    };

    const renderFolderRecursive = (folder: FolderType) => {
        const isExpanded = expandedSidebarFolderIds.includes(folder.id);
        const isActive = selectedFolderId === folder.id;
        const subfolders = foldersInWorkspace
            .filter((f) => f.parentId === folder.id)
            .sort((a, b) =>
                (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
            );
        const folderNotes = sortNotes(
            notesInWorkspace.filter((n) => (n.folderId ?? null) === folder.id),
            sort
        );
        const count = getFolderNoteCountRecursive(folder.id, notes, folders);
        const displayName = folder.displayName ?? folder.name;
        const isRenaming = folderRenameState?.folderId === folder.id;

        const depth = getFolderDepth(folder.id, folders);
        return (
            <div
                key={folder.id}
                className="sidebar-folder-container"
                data-folder-id={folder.id}
                data-depth={Math.min(depth, 6)}
            >
                <button
                    type="button"
                    className={`sidebar-folder-header ${
                        isActive ? "active" : ""
                    } ${
                        selectedFolderIds.includes(folder.id)
                            ? "sidebar-folder-header-selected"
                            : ""
                    }`}
                    data-folder-id={folder.id}
                    draggable
                    onDragStart={(e) => handleFolderDragStart(folder.id, e)}
                    onDragEnd={handleFolderDragEnd}
                    onDragOver={(e) => handleFolderDragOver(folder.id, e)}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={(e) => handleFolderDrop(folder.id, e)}
                    onClick={(e) =>
                        handleFolderHeaderClick(
                            folder.id,
                            foldersOrderedSelectables.findIndex(
                                (i) => i.type === "folder" && i.id === folder.id
                            ),
                            e
                        )
                    }
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setFolderContextMenuAnchor({
                            x: e.clientX,
                            y: e.clientY,
                            folderId: folder.id,
                        });
                    }}
                    aria-expanded={isExpanded}
                >
                    {/* Always reserve space for color (match extension: same indent with or without color) */}
                    <span
                        className="sidebar-folder-color"
                        style={
                            folder.color
                                ? { backgroundColor: folder.color }
                                : undefined
                        }
                        aria-hidden
                    />
                    {isExpanded ? (
                        <FolderOpen
                            className="sidebar-folder-header-icon"
                            size={14}
                            aria-hidden
                        />
                    ) : (
                        <FolderIcon
                            className="sidebar-folder-header-icon"
                            size={14}
                            aria-hidden
                        />
                    )}
                    {isRenaming ? (
                        <input
                            type="text"
                            className="note-rename-input"
                            value={folderRenameState!.value}
                            onChange={(e) =>
                                setFolderRenameState((s) =>
                                    s ? { ...s, value: e.target.value } : null
                                )
                            }
                            onBlur={() =>
                                handleFolderRenameBlur(
                                    folder.id,
                                    folderRenameState!.value,
                                    displayName
                                )
                            }
                            onKeyDown={(e) => {
                                handleFolderRenameKeyDown(
                                    e,
                                    folder.id,
                                    folderRenameState!.value,
                                    displayName
                                );
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            autoFocus
                            aria-label="Rename folder"
                        />
                    ) : (
                        <span className="sidebar-folder-name">
                            {displayName}
                        </span>
                    )}
                    <span className="sidebar-folder-count">{count}</span>
                </button>
                <div
                    className={`sidebar-folder-content ${
                        isExpanded ? "expanded" : ""
                    }`}
                >
                    <div className="sidebar-folder-content-inner">
                        {subfolders.map((f) => renderFolderRecursive(f))}
                        {folderNotes.map((note) => {
                            const displayName =
                                note.displayName ?? note.title ?? "Untitled";
                            const isRenaming =
                                noteRenameState?.noteId === note.sessionId;
                            const noteIndex =
                                foldersOrderedSelectables.findIndex(
                                    (i) =>
                                        i.type === "note" &&
                                        i.id === note.sessionId
                                );
                            const isOpenInPipFolder =
                                _openInPipNoteIds.includes(note.sessionId);
                            /* Notes align with parent folder (same indent), not one level deeper */
                            const noteDepth = Math.min(depth, 6);
                            return (
                                <div
                                    key={note.sessionId}
                                    className={`sidebar-note-item ${
                                        selectedNoteId === note.sessionId
                                            ? "sidebar-note-item-active"
                                            : ""
                                    } ${
                                        selectedNoteIds.includes(note.sessionId)
                                            ? "sidebar-note-item-selected"
                                            : ""
                                    } ${
                                        isOpenInPipFolder
                                            ? "sidebar-note-item-open-in-pip"
                                            : ""
                                    }`}
                                    data-session-id={note.sessionId}
                                    data-depth={noteDepth}
                                    role="button"
                                    tabIndex={0}
                                    draggable
                                    onDragStart={(e) =>
                                        handleNoteDragStart(note.sessionId, e)
                                    }
                                    onDragEnd={handleNoteDragEnd}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleNoteClick(
                                            note.sessionId,
                                            folder.id,
                                            noteIndex,
                                            e
                                        );
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            e.preventDefault();
                                            handleNoteClick(
                                                note.sessionId,
                                                folder.id,
                                                noteIndex
                                            );
                                        }
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setNoteContextMenuAnchor({
                                            x: e.clientX,
                                            y: e.clientY,
                                            noteId: note.sessionId,
                                        });
                                    }}
                                >
                                    {note.color ? (
                                        <span
                                            className="sidebar-note-color"
                                            style={{
                                                backgroundColor: note.color,
                                            }}
                                            aria-hidden
                                        />
                                    ) : (
                                        <span
                                            className="sidebar-note-color"
                                            aria-hidden
                                        />
                                    )}
                                    <FileText
                                        className="sidebar-note-icon"
                                        size={14}
                                        aria-hidden
                                    />
                                    {isRenaming ? (
                                        <input
                                            type="text"
                                            className="note-rename-input"
                                            value={noteRenameState!.value}
                                            onChange={(e) =>
                                                setNoteRenameState((s) =>
                                                    s
                                                        ? {
                                                              ...s,
                                                              value: e.target
                                                                  .value,
                                                          }
                                                        : null
                                                )
                                            }
                                            onBlur={() =>
                                                handleNoteRenameBlur(
                                                    note.sessionId,
                                                    noteRenameState!.value,
                                                    displayName
                                                )
                                            }
                                            onKeyDown={(e) => {
                                                handleNoteRenameKeyDown(
                                                    e,
                                                    note.sessionId,
                                                    noteRenameState!.value,
                                                    displayName
                                                );
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) =>
                                                e.stopPropagation()
                                            }
                                            autoFocus
                                            aria-label="Rename note"
                                        />
                                    ) : (
                                        <span className="sidebar-note-title">
                                            {stripMarkdownForDisplay(
                                                displayName
                                            )}
                                            .md
                                        </span>
                                    )}
                                    {isOpenInPipFolder && (
                                        <span
                                            className="sidebar-note-open-indicator"
                                            aria-hidden
                                            title="Open in editor"
                                        >
                                            <ExternalLink size={12} />
                                        </span>
                                    )}
                                    {detailEditNoteIdFolders === note.sessionId && (
                                        <span
                                            className="sidebar-note-open-indicator sidebar-note-editing-indicator"
                                            aria-hidden
                                            title="Editing in main view"
                                        >
                                            <Pencil size={12} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Bookmarks (virtual folder) */}
            <div
                className="sidebar-folder-container"
                data-folder-id={BOOKMARKS_SENTINEL}
            >
                <button
                    type="button"
                    className={`sidebar-folder-header ${
                        bookmarksActive ? "active" : ""
                    }`}
                    data-folder-id={BOOKMARKS_SENTINEL}
                    onClick={() => handleFolderHeaderClick(BOOKMARKS_SENTINEL)}
                    aria-expanded={bookmarksExpanded}
                >
                    <Bookmark
                        className="sidebar-folder-header-icon"
                        size={14}
                        aria-hidden
                    />
                    <span className="sidebar-folder-name">Bookmarks</span>
                    <span className="sidebar-folder-count">
                        {bookmarkedNotes.length}
                    </span>
                </button>
                <div
                    className={`sidebar-folder-content ${
                        bookmarksExpanded ? "expanded" : ""
                    }`}
                >
                    <div className="sidebar-folder-content-inner">
                        {bookmarkedNotes.map((note) => {
                            const displayName =
                                note.displayName ?? note.title ?? "Untitled";
                            const isRenaming =
                                noteRenameState?.noteId === note.sessionId;
                            const isOpenInPipBm =
                                _openInPipNoteIds.includes(note.sessionId);
                            const noteIndex =
                                foldersOrderedSelectables.findIndex(
                                    (i) =>
                                        i.type === "note" &&
                                        i.id === note.sessionId
                                );
                            return (
                                <div
                                    key={note.sessionId}
                                    className={`sidebar-note-item ${
                                        selectedNoteId === note.sessionId
                                            ? "sidebar-note-item-active"
                                            : ""
                                    } ${
                                        selectedNoteIds.includes(note.sessionId)
                                            ? "sidebar-note-item-selected"
                                            : ""
                                    } ${
                                        isOpenInPipBm
                                            ? "sidebar-note-item-open-in-pip"
                                            : ""
                                    }`}
                                    data-session-id={note.sessionId}
                                    data-depth="1"
                                    role="button"
                                    tabIndex={0}
                                    draggable
                                    onDragStart={(e) =>
                                        handleNoteDragStart(note.sessionId, e)
                                    }
                                    onDragEnd={handleNoteDragEnd}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleNoteClick(
                                            note.sessionId,
                                            BOOKMARKS_SENTINEL,
                                            noteIndex,
                                            e
                                        );
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setNoteContextMenuAnchor({
                                            x: e.clientX,
                                            y: e.clientY,
                                            noteId: note.sessionId,
                                        });
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            e.preventDefault();
                                            handleNoteClick(
                                                note.sessionId,
                                                BOOKMARKS_SENTINEL,
                                                noteIndex
                                            );
                                        }
                                    }}
                                >
                                    {note.color ? (
                                        <span
                                            className="sidebar-note-color"
                                            style={{
                                                backgroundColor: note.color,
                                            }}
                                            aria-hidden
                                        />
                                    ) : (
                                        <span
                                            className="sidebar-note-color"
                                            aria-hidden
                                        />
                                    )}
                                    <FileText
                                        className="sidebar-note-icon"
                                        size={14}
                                        aria-hidden
                                    />
                                    {isRenaming ? (
                                        <input
                                            type="text"
                                            className="note-rename-input"
                                            value={noteRenameState!.value}
                                            onChange={(e) =>
                                                setNoteRenameState((s) =>
                                                    s
                                                        ? {
                                                              ...s,
                                                              value: e.target
                                                                  .value,
                                                          }
                                                        : null
                                                )
                                            }
                                            onBlur={() =>
                                                handleNoteRenameBlur(
                                                    note.sessionId,
                                                    noteRenameState!.value,
                                                    displayName
                                                )
                                            }
                                            onKeyDown={(e) => {
                                                handleNoteRenameKeyDown(
                                                    e,
                                                    note.sessionId,
                                                    noteRenameState!.value,
                                                    displayName
                                                );
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) =>
                                                e.stopPropagation()
                                            }
                                            autoFocus
                                            aria-label="Rename note"
                                        />
                                    ) : (
                                        <span className="sidebar-note-title">
                                            {stripMarkdownForDisplay(
                                                displayName
                                            )}
                                            .md
                                        </span>
                                    )}
                                    {isOpenInPipBm && (
                                        <span
                                            className="sidebar-note-open-indicator"
                                            aria-hidden
                                            title="Open in editor"
                                        >
                                            <ExternalLink size={12} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Root (virtual folder) – header is also a drop zone to move items to root */}
            <div
                className="sidebar-folder-container"
                data-folder-id={ROOT_SENTINEL}
            >
                <button
                    type="button"
                    className={`sidebar-folder-header ${
                        rootActive ? "active" : ""
                    }`}
                    data-folder-id={ROOT_SENTINEL}
                    onClick={() => handleFolderHeaderClick(ROOT_SENTINEL)}
                    onDragOver={handleRootZoneDragOver}
                    onDragLeave={handleRootZoneDragLeave}
                    onDrop={handleRootZoneDrop}
                    aria-expanded={rootExpanded}
                >
                    {rootExpanded ? (
                        <FolderOpen
                            className="sidebar-folder-header-icon"
                            size={14}
                            aria-hidden
                        />
                    ) : (
                        <FolderIcon
                            className="sidebar-folder-header-icon"
                            size={14}
                            aria-hidden
                        />
                    )}
                    <span className="sidebar-folder-name">Root</span>
                    <span className="sidebar-folder-count">{rootCount}</span>
                </button>
                <div
                    className={`sidebar-folder-content ${
                        rootExpanded ? "expanded" : ""
                    }`}
                >
                    <div className="sidebar-folder-content-inner">
                        {rootFolders.map((f) => renderFolderRecursive(f))}
                        {folderlessNotes.map((note) => {
                            const displayName =
                                note.displayName ?? note.title ?? "Untitled";
                            const isRenaming =
                                noteRenameState?.noteId === note.sessionId;
                            const isOpenInPipRoot =
                                _openInPipNoteIds.includes(note.sessionId);
                            const noteIndex =
                                foldersOrderedSelectables.findIndex(
                                    (i) =>
                                        i.type === "note" &&
                                        i.id === note.sessionId
                                );
                            return (
                                <div
                                    key={note.sessionId}
                                    className={`sidebar-note-item folderless-note-item ${
                                        selectedNoteId === note.sessionId
                                            ? "sidebar-note-item-active"
                                            : ""
                                    } ${
                                        selectedNoteIds.includes(note.sessionId)
                                            ? "sidebar-note-item-selected"
                                            : ""
                                    }`}
                                    data-session-id={note.sessionId}
                                    data-depth="1"
                                    role="button"
                                    tabIndex={0}
                                    draggable
                                    onDragStart={(e) =>
                                        handleNoteDragStart(note.sessionId, e)
                                    }
                                    onDragEnd={handleNoteDragEnd}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleNoteClick(
                                            note.sessionId,
                                            null,
                                            noteIndex,
                                            e
                                        );
                                    }}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setNoteContextMenuAnchor({
                                            x: e.clientX,
                                            y: e.clientY,
                                            noteId: note.sessionId,
                                        });
                                    }}
                                    onKeyDown={(e) => {
                                        if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                        ) {
                                            e.preventDefault();
                                            handleNoteClick(
                                                note.sessionId,
                                                null,
                                                noteIndex
                                            );
                                        }
                                    }}
                                >
                                    {note.color ? (
                                        <span
                                            className="sidebar-note-color"
                                            style={{
                                                backgroundColor: note.color,
                                            }}
                                            aria-hidden
                                        />
                                    ) : (
                                        <span
                                            className="sidebar-note-color"
                                            aria-hidden
                                        />
                                    )}
                                    <FileText
                                        className="sidebar-note-icon"
                                        size={14}
                                        aria-hidden
                                    />
                                    {isRenaming ? (
                                        <input
                                            type="text"
                                            className="note-rename-input"
                                            value={noteRenameState!.value}
                                            onChange={(e) =>
                                                setNoteRenameState((s) =>
                                                    s
                                                        ? {
                                                              ...s,
                                                              value: e.target
                                                                  .value,
                                                          }
                                                        : null
                                                )
                                            }
                                            onBlur={() =>
                                                handleNoteRenameBlur(
                                                    note.sessionId,
                                                    noteRenameState!.value,
                                                    displayName
                                                )
                                            }
                                            onKeyDown={(e) => {
                                                handleNoteRenameKeyDown(
                                                    e,
                                                    note.sessionId,
                                                    noteRenameState!.value,
                                                    displayName
                                                );
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) =>
                                                e.stopPropagation()
                                            }
                                            autoFocus
                                            aria-label="Rename note"
                                        />
                                    ) : (
                                        <span className="sidebar-note-title">
                                            {stripMarkdownForDisplay(
                                                displayName
                                            )}
                                            .md
                                        </span>
                                    )}
                                    {isOpenInPipRoot && (
                                        <span
                                            className="sidebar-note-open-indicator"
                                            aria-hidden
                                            title="Open in editor"
                                        >
                                            <ExternalLink size={12} />
                                        </span>
                                    )}
                                    {detailEditNoteIdFolders === note.sessionId && (
                                        <span
                                            className="sidebar-note-open-indicator sidebar-note-editing-indicator"
                                            aria-hidden
                                            title="Editing in main view"
                                        >
                                            <Pencil size={12} />
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                        {/* Root drop zone: drop notes/folders here to move to root */}
                        <div
                            className="sidebar-root-drop-zone"
                            onDragOver={handleRootZoneDragOver}
                            onDragLeave={handleRootZoneDragLeave}
                            onDrop={handleRootZoneDrop}
                            data-drop-target="root"
                        />
                    </div>
                </div>
            </div>

            {/* Folder context menu – matches notic extension (Rename, New Note, New Folder, Change color, Export, Delete) */}
            {folderContextMenuAnchor &&
                (() => {
                    const folder = folders[folderContextMenuAnchor.folderId];
                    if (!folder) return null;
                    const depth = getFolderDepth(
                        folderContextMenuAnchor.folderId,
                        folders
                    );
                    const canCreateSubfolder = depth < MAX_FOLDER_DEPTH;
                    const displayName = folder.displayName ?? folder.name;
                    const wsId = currentWorkspaceId ?? "workspace_1";
                    return createPortal(
                        <div
                            className="pip-context-menu show"
                            data-folder-context-menu
                            style={{
                                left: folderContextMenuAnchor.x,
                                top: folderContextMenuAnchor.y,
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
                                className="pip-context-menu-item"
                                onClick={() => {
                                    setFolderRenameState({
                                        folderId: folder.id,
                                        value: displayName,
                                    });
                                    setFolderContextMenuAnchor(null);
                                }}
                            >
                                Rename
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    setExpandedSidebarFolderIds(
                                        expandedSidebarFolderIds.includes(
                                            folder.id
                                        )
                                            ? expandedSidebarFolderIds
                                            : [
                                                  ...expandedSidebarFolderIds,
                                                  folder.id,
                                              ]
                                    );
                                    const newId = addNote({
                                        workspaceId: wsId,
                                        folderId: folder.id,
                                    });
                                    triggerSyncAfterUserAction(db);
                                    setSelectedFolderId(folder.id);
                                    setSelectedNoteId(newId);
                                    triggerSyncAfterUserAction(db);
                                    trackEvent("note_created");
                                    setFolderContextMenuAnchor(null);
                                }}
                            >
                                New Note
                            </button>
                            {canCreateSubfolder && (
                                <button
                                    type="button"
                                    className="pip-context-menu-item"
                                    onClick={() => {
                                        setExpandedSidebarFolderIds(
                                            expandedSidebarFolderIds.includes(
                                                folder.id
                                            )
                                                ? expandedSidebarFolderIds
                                                : [
                                                      ...expandedSidebarFolderIds,
                                                      folder.id,
                                                  ]
                                        );
                                        const newFolderId = addFolder({
                                            name: "Untitled",
                                            parentId: folder.id,
                                            workspaceId: wsId,
                                        });
                                        triggerSyncAfterUserAction(db);
                                        trackEvent("folder_created");
                                        setExpandedSidebarFolderIds([
                                            ...expandedSidebarFolderIds,
                                            folder.id,
                                            newFolderId,
                                        ]);
                                        setSelectedFolderId(newFolderId);
                                        setFolderRenameState({
                                            folderId: newFolderId,
                                            value: "Untitled",
                                        });
                                        setFolderContextMenuAnchor(null);
                                    }}
                                >
                                    New Folder
                                </button>
                            )}
                            <div
                                className="pip-context-menu-item pip-context-menu-item-has-submenu"
                                onMouseEnter={() => {
                                    if (
                                        folderContextMenuSubmenuTimerRef.current
                                    ) {
                                        clearTimeout(
                                            folderContextMenuSubmenuTimerRef.current
                                        );
                                        folderContextMenuSubmenuTimerRef.current =
                                            null;
                                    }
                                    setFolderColorSubmenu("color");
                                }}
                                onMouseLeave={() => {
                                    folderContextMenuSubmenuTimerRef.current =
                                        setTimeout(() => {
                                            folderContextMenuSubmenuTimerRef.current =
                                                null;
                                            setFolderColorSubmenu(null);
                                        }, 150);
                                }}
                            >
                                <span className="pip-context-menu-item-label">
                                    Change color
                                </span>
                                <span className="pip-context-menu-item-chevron">
                                    ›
                                </span>
                                <div
                                    className={`pip-context-menu-submenu ${
                                        folderColorSubmenu === "color"
                                            ? "show"
                                            : ""
                                    }`}
                                >
                                    {FOLDER_COLOR_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value || "default"}
                                            type="button"
                                            className="pip-context-menu-submenu-item"
                                            onClick={() => {
                                                updateFolder(
                                                    folderContextMenuAnchor.folderId,
                                                    {
                                                        color:
                                                            opt.value ||
                                                            undefined,
                                                    }
                                                );
                                                setFolderContextMenuAnchor(
                                                    null
                                                );
                                                setFolderColorSubmenu(null);
                                            }}
                                        >
                                            <span
                                                className={`pip-context-menu-color-swatch ${
                                                    !opt.value
                                                        ? "pip-context-menu-color-swatch-default"
                                                        : ""
                                                }`}
                                                style={
                                                    opt.value
                                                        ? {
                                                              backgroundColor:
                                                                  opt.value,
                                                          }
                                                        : undefined
                                                }
                                            />
                                            <span className="pip-context-menu-submenu-item-label">
                                                {opt.value
                                                    ? `Color: ${opt.label}`
                                                    : "Color: Default"}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    const blob = exportFolderAsZip(
                                        folderContextMenuAnchor.folderId,
                                        notes,
                                        folders,
                                        currentWorkspaceId
                                    );
                                    downloadExportBlob(
                                        blob,
                                        `${sanitizeName(displayName)}.zip`
                                    );
                                    trackEvent("export_completed", {
                                        format: "zip",
                                    });
                                    setFolderContextMenuAnchor(null);
                                }}
                            >
                                Export folder
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item danger"
                                onClick={() => {
                                    setFolderDeleteConfirm({
                                        folderId: folder.id,
                                        displayName,
                                    });
                                    setFolderContextMenuAnchor(null);
                                }}
                            >
                                Delete
                            </button>
                        </div>,
                        document.body
                    );
                })()}

            {/* Note context menu (Folders tab) – portal so it shows when right-clicking a note in folder view. Skip when menu is for selected note (opened from detail "…") so MainContent can show its menu with correct PiP blocking. */}
            {noteContextMenuAnchor &&
                noteContextMenuAnchor.noteId !== selectedNoteId &&
                (() => {
                    const menuNote = notes[noteContextMenuAnchor.noteId];
                    if (!menuNote) return null;
                    const isBookmarked = menuNote.isBookmarked === true;
                    return createPortal(
                        <div
                            className="pip-context-menu show"
                            data-context-menu-trigger
                            style={{
                                left: noteContextMenuAnchor.x,
                                top: noteContextMenuAnchor.y,
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
                                className={`pip-context-menu-item${isNoteActiveInPipFolders || isNoteEditedInMainFolders ? " pip-context-menu-item-disabled" : ""}`}
                                disabled={isNoteActiveInPipFolders || isNoteEditedInMainFolders}
                                title={
                                    isNoteEditedInMainFolders
                                        ? "Already editing in main view"
                                        : isNoteActiveInPipFolders
                                        ? "Note is already open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipFolders || isNoteEditedInMainFolders) return;
                                    setSelectedNoteId(
                                        noteContextMenuAnchor.noteId
                                    );
                                    addNoteToPip(
                                        noteContextMenuAnchor.noteId,
                                        true
                                    );
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Edit
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item${isNoteActiveInPipFolders || isNoteEditedInMainFolders ? " pip-context-menu-item-disabled" : ""}`}
                                disabled={isNoteActiveInPipFolders || isNoteEditedInMainFolders}
                                title={
                                    isNoteEditedInMainFolders
                                        ? "Finish editing in main view first"
                                        : isNoteActiveInPipFolders
                                        ? "Note is already open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipFolders || isNoteEditedInMainFolders) return;
                                    openNoteInPip(noteContextMenuAnchor.noteId);
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Open
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    updateNote(noteContextMenuAnchor.noteId, {
                                        isBookmarked: !isBookmarked,
                                    });
                                    setNoteContextMenuAnchor(null);
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
                                        noteContextMenuAnchor.noteId
                                    );
                                    if (newId) {
                                        setSelectedNoteId(newId);
                                        triggerSyncAfterUserAction(db);
                                    }
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Copy
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item${isNoteActiveInPipFolders ? " pip-context-menu-item-disabled" : ""}`}
                                disabled={isNoteActiveInPipFolders}
                                title={
                                    isNoteActiveInPipFolders
                                        ? "Cannot move note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipFolders) return;
                                    const isMulti =
                                        selectedNoteIds.length > 1 &&
                                        selectedNoteIds.includes(
                                            noteContextMenuAnchor.noteId
                                        );
                                    setNoteContextMenuAnchor(null);
                                    setMoveToFolderModal({
                                        sessionIdOrNull:
                                            noteContextMenuAnchor.noteId,
                                        noteIds: isMulti
                                            ? [...selectedNoteIds]
                                            : undefined,
                                        folderIds: isMulti
                                            ? [...selectedFolderIds]
                                            : undefined,
                                    });
                                }}
                            >
                                Move to folder…
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item${isNoteActiveInPipFolders || Object.keys(workspaces).length <= 1 ? " pip-context-menu-item-disabled" : ""}`}
                                disabled={
                                    isNoteActiveInPipFolders ||
                                    Object.keys(workspaces).length <= 1
                                }
                                title={
                                    isNoteActiveInPipFolders
                                        ? "Cannot move note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipFolders) return;
                                    const isMulti =
                                        selectedNoteIds.length > 1 &&
                                        selectedNoteIds.includes(
                                            noteContextMenuAnchor.noteId
                                        );
                                    setNoteContextMenuAnchor(null);
                                    setMoveToWorkspaceModal({
                                        sessionIdOrNull:
                                            noteContextMenuAnchor.noteId,
                                        noteIds: isMulti
                                            ? [...selectedNoteIds]
                                            : undefined,
                                    });
                                }}
                            >
                                Move to workspace…
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    const blob =
                                        exportNoteAsMarkdownBlob(menuNote);
                                    downloadExportBlob(
                                        blob,
                                        `${sanitizeName(
                                            menuNote.displayName ??
                                                menuNote.title
                                        )}.md`
                                    );
                                    trackEvent("export_completed", {
                                        format: "markdown",
                                    });
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Export
                            </button>
                            <button
                                type="button"
                                className="pip-context-menu-item"
                                onClick={() => {
                                    setSelectedNoteId(
                                        noteContextMenuAnchor.noteId
                                    );
                                    setShareModalNoteId(
                                        noteContextMenuAnchor.noteId
                                    );
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Share
                            </button>
                            <div
                                className="pip-context-menu-item pip-context-menu-item-has-submenu"
                                onMouseEnter={() => {
                                    if (noteMenuSubmenuTimerRef.current) {
                                        clearTimeout(
                                            noteMenuSubmenuTimerRef.current
                                        );
                                        noteMenuSubmenuTimerRef.current = null;
                                    }
                                    setNoteMenuHoveredSubmenu("color");
                                }}
                                onMouseLeave={() => {
                                    noteMenuSubmenuTimerRef.current =
                                        setTimeout(() => {
                                            noteMenuSubmenuTimerRef.current =
                                                null;
                                            setNoteMenuHoveredSubmenu(null);
                                        }, 150);
                                }}
                            >
                                <span className="pip-context-menu-item-label">
                                    Change color
                                </span>
                                <span className="pip-context-menu-item-chevron">
                                    ›
                                </span>
                                <div
                                    className={`pip-context-menu-submenu ${
                                        noteMenuHoveredSubmenu === "color"
                                            ? "show"
                                            : ""
                                    }`}
                                >
                                    {NOTE_COLOR_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value || "default"}
                                            type="button"
                                            className="pip-context-menu-submenu-item"
                                            onClick={() => {
                                                updateNote(
                                                    noteContextMenuAnchor.noteId,
                                                    {
                                                        color:
                                                            opt.value ||
                                                            undefined,
                                                    }
                                                );
                                                setNoteContextMenuAnchor(null);
                                                setNoteMenuHoveredSubmenu(null);
                                            }}
                                        >
                                            <span
                                                className={`pip-context-menu-color-swatch ${
                                                    !opt.value
                                                        ? "pip-context-menu-color-swatch-default"
                                                        : ""
                                                }`}
                                                style={
                                                    opt.value
                                                        ? {
                                                              backgroundColor:
                                                                  opt.value,
                                                          }
                                                        : undefined
                                                }
                                            />
                                            <span className="pip-context-menu-submenu-item-label">
                                                {opt.label}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <button
                                type="button"
                                className={`pip-context-menu-item${isNoteActiveInPipFolders ? " pip-context-menu-item-disabled" : ""}`}
                                disabled={isNoteActiveInPipFolders}
                                title={
                                    isNoteActiveInPipFolders
                                        ? "Cannot rename note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipFolders) return;
                                    setNoteRenameState({
                                        noteId: noteContextMenuAnchor.noteId,
                                        value:
                                            menuNote.displayName ??
                                            menuNote.title ??
                                            "Untitled",
                                    });
                                    setNoteContextMenuAnchor(null);
                                }}
                            >
                                Rename
                            </button>
                            <button
                                type="button"
                                className={`pip-context-menu-item danger${isNoteActiveInPipFolders ? " pip-context-menu-item-disabled" : ""}`}
                                disabled={isNoteActiveInPipFolders}
                                title={
                                    isNoteActiveInPipFolders
                                        ? "Cannot delete note open in editor"
                                        : undefined
                                }
                                onClick={() => {
                                    if (isNoteActiveInPipFolders) return;
                                    const isMulti =
                                        selectedNoteIds.length > 1 &&
                                        selectedNoteIds.includes(
                                            noteContextMenuAnchor.noteId
                                        );
                                    // Immediate soft delete (matches extension - no confirmation)
                                    const ids = isMulti
                                        ? selectedNoteIds
                                        : [noteContextMenuAnchor.noteId];
                                    ids.forEach((id) => updateNote(id, { deletedAt: Date.now() }));
                                    if (ids.length === 1) trackEvent("note_deleted");
                                    else trackEvent("note_deleted", { count: ids.length });
                                    if (ids.includes(selectedNoteId ?? "")) setSelectedNoteId(null);
                                    setSelection(
                                        selectedNoteIds.filter((id) => !ids.includes(id)),
                                        selectedFolderIds
                                    );
                                    setNoteContextMenuAnchor(null);
                                    useUIStore.getState().setToastMessage(
                                        ids.length === 1 ? "Moved to trash" : `${ids.length} items moved to trash`
                                    );
                                    triggerSyncAfterUserAction(db);
                                }}
                            >
                                Delete
                            </button>
                        </div>,
                        document.body
                    );
                })()}

            {folderDeleteConfirm && (
                <div
                    className="modal-overlay"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setFolderDeleteConfirm(null)}
                >
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 className="modal-title">Delete Folder</h3>
                            <p className="modal-message">
                                Delete &quot;{folderDeleteConfirm.displayName}&quot; and any
                                subfolders? All notes inside will be moved to Trash. You can
                                restore them from Trash before emptying.
                            </p>
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="modal-btn modal-btn-secondary"
                                onClick={() => setFolderDeleteConfirm(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="modal-btn pip-modal-btn-danger"
                            onClick={() => {
                                removeFolder(folderDeleteConfirm.folderId);
                                setFolderDeleteConfirm(null);
                                triggerSyncAfterUserAction(db);
                            }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

/** Flat list of folders with path (roots first, then children). Match notic getFlatFolders. */
function getFlatFoldersWithPath(
    foldersList: FolderType[]
): { id: string; name: string; path: string }[] {
    const result: { id: string; name: string; path: string }[] = [];
    const folderMap = new Map<string, FolderType>();
    foldersList.forEach((f) => folderMap.set(f.id, f));
    const roots = foldersList
        .filter((f) => f.parentId == null)
        .sort((a, b) =>
            (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
        );
    function add(folder: FolderType, parentPath: string): void {
        const name = folder.displayName ?? folder.name;
        const path = parentPath ? `${parentPath}/${name}` : name;
        result.push({ id: folder.id, name, path });
        const children = foldersList
            .filter((f) => f.parentId === folder.id)
            .sort((a, b) =>
                (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
            );
        children.forEach((c) => add(c, path));
    }
    roots.forEach((r) => add(r, ""));
    return result;
}

/** Move to folder picker modal. Match notic showFolderPickerModal. */
function MoveToFolderModal() {
    const moveToFolderModal = useUIStore((s) => s.moveToFolderModal);
    const setMoveToFolderModal = useUIStore((s) => s.setMoveToFolderModal);
    const notes = useNotesStore((s) => s.notes);
    const folders = useNotesStore((s) => s.folders);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const selectedNoteId = useNotesStore((s) => s.selectedNoteId);
    const selectedSidebarContext = useNotesStore(
        (s) => s.selectedSidebarContext
    );
    const updateNote = useNotesStore((s) => s.updateNote);
    const updateFolder = useNotesStore((s) => s.updateFolder);
    const clearSelection = useNotesStore((s) => s.clearSelection);
    const setSelectedSidebarContext = useNotesStore(
        (s) => s.setSelectedSidebarContext
    );
    const wsId = currentWorkspaceId ?? DEFAULT_WORKSPACE_ID;
    const wsIdStr = String(wsId);
    const foldersInWorkspace = useMemo(
        () =>
            Object.values(folders).filter(
                (f) =>
                    String(f.workspaceId ?? DEFAULT_WORKSPACE_ID) === wsIdStr
            ),
        [folders, wsIdStr]
    );
    const flatFolders = useMemo(
        () => getFlatFoldersWithPath(foldersInWorkspace),
        [foldersInWorkspace]
    );
    const [search, setSearch] = useState("");
    const currentFolderId =
        moveToFolderModal?.sessionIdOrNull != null
            ? notes[moveToFolderModal.sessionIdOrNull]?.folderId
            : undefined;
    /** Exclude current folder from list so user cannot "move" to same folder. */
    const foldersExcludingCurrent = useMemo(
        () =>
            currentFolderId != null
                ? flatFolders.filter((f) => f.id !== currentFolderId)
                : flatFolders,
        [flatFolders, currentFolderId]
    );
    const filteredFolders = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q
            ? foldersExcludingCurrent.filter((f) =>
                  f.path.toLowerCase().includes(q)
              )
            : foldersExcludingCurrent;
    }, [foldersExcludingCurrent, search]);

    const noteIds =
        moveToFolderModal?.noteIds ??
        (moveToFolderModal?.sessionIdOrNull
            ? [moveToFolderModal.sessionIdOrNull]
            : []);
    const folderIds = moveToFolderModal?.folderIds ?? [];
    const isMulti = noteIds.length + folderIds.length > 1;

    const handleSelect = useCallback(
        (targetFolderId: string | null) => {
            const now = Date.now();
            noteIds.forEach((sid) => {
                updateNote(sid, {
                    folderId: targetFolderId ?? undefined,
                    lastModified: now,
                });
            });
            folderIds.forEach((fid) => {
                if (
                    targetFolderId &&
                    !canAcceptFolderDrop(fid, targetFolderId, folders)
                )
                    return;
                updateFolder(fid, { parentId: targetFolderId });
            });
            clearSelection();
            if (
                noteIds.length === 1 &&
                selectedNoteId === noteIds[0] &&
                selectedSidebarContext !== (targetFolderId ?? ROOT_SENTINEL)
            ) {
                setSelectedSidebarContext(targetFolderId ?? ROOT_SENTINEL);
            }
            if (
                folderIds.length === 1 &&
                selectedSidebarContext === folderIds[0]
            ) {
                setSelectedSidebarContext(targetFolderId ?? ROOT_SENTINEL);
            }
            setMoveToFolderModal(null);
        },
        [
            noteIds,
            folderIds,
            updateNote,
            updateFolder,
            clearSelection,
            selectedNoteId,
            selectedSidebarContext,
            setSelectedSidebarContext,
            setMoveToFolderModal,
            folders,
        ]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMoveToFolderModal(null);
        };
        if (moveToFolderModal) {
            document.addEventListener("keydown", onKey);
            return () => document.removeEventListener("keydown", onKey);
        }
    }, [moveToFolderModal, setMoveToFolderModal]);

    if (!moveToFolderModal) return null;
    return createPortal(
        <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="moveToFolderTitle"
            onClick={(e) => {
                if (e.target === e.currentTarget) setMoveToFolderModal(null);
            }}
        >
            <div
                className="modal modal-folder-picker"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 id="moveToFolderTitle" className="modal-title">
                        Move to folder
                    </h3>
                    <p className="modal-message">
                        {isMulti
                            ? "Choose a folder for the selected items."
                            : "Choose a folder for this note."}
                    </p>
                    <input
                        type="text"
                        className="modal-folder-picker-search"
                        placeholder="Search folders…"
                        aria-label="Search folders"
                        autoComplete="off"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div
                    className="modal-folder-picker-list scrollbar-branded"
                    id="modalFolderPickerList"
                >
                    <button
                        type="button"
                        className="modal-folder-picker-item"
                        data-folder-id=""
                        onClick={() => handleSelect(null)}
                    >
                        Root
                    </button>
                    {filteredFolders.map((f) => (
                        <button
                            key={f.id}
                            type="button"
                            className="modal-folder-picker-item"
                            data-folder-id={f.id}
                            onClick={() => handleSelect(f.id)}
                        >
                            {f.path}
                        </button>
                    ))}
                </div>
                <div className="modal-actions">
                    <button
                        type="button"
                        className="modal-btn modal-btn-secondary"
                        onClick={() => setMoveToFolderModal(null)}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

/** Move to workspace picker modal. Match notic showWorkspacePickerModal. */
function MoveToWorkspaceModal() {
    const moveToWorkspaceModal = useUIStore((s) => s.moveToWorkspaceModal);
    const setMoveToWorkspaceModal = useUIStore(
        (s) => s.setMoveToWorkspaceModal
    );
    const folders = useNotesStore((s) => s.folders);
    const updateNote = useNotesStore((s) => s.updateNote);
    const clearSelection = useNotesStore((s) => s.clearSelection);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const otherWorkspaces = useMemo(
        () =>
            getWorkspacesInDisplayOrder(workspaces).filter(
                (w) => w.id !== (currentWorkspaceId ?? DEFAULT_WORKSPACE_ID)
            ),
        [workspaces, currentWorkspaceId]
    );
    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");

    /** When modal opens, always sync to first other workspace so folder list shows that workspace's folders. */
    useEffect(() => {
        if (moveToWorkspaceModal && otherWorkspaces.length > 0) {
            setSelectedWorkspaceId(otherWorkspaces[0].id);
        }
    }, [moveToWorkspaceModal, otherWorkspaces]);

    const effectiveWorkspaceId =
        (selectedWorkspaceId || otherWorkspaces[0]?.id) ?? "";
    const foldersForWorkspace = useMemo(() => {
        if (!effectiveWorkspaceId) return [];
        const targetId = String(effectiveWorkspaceId);
        return Object.values(folders).filter(
            (f) => String(f.workspaceId ?? DEFAULT_WORKSPACE_ID) === targetId
        );
    }, [folders, effectiveWorkspaceId]);
    const flatFolders = useMemo(
        () => getFlatFoldersWithPath(foldersForWorkspace),
        [foldersForWorkspace]
    );

    const noteIds =
        moveToWorkspaceModal?.noteIds?.length ?? 0
            ? moveToWorkspaceModal!.noteIds!
            : moveToWorkspaceModal?.sessionIdOrNull
            ? [moveToWorkspaceModal.sessionIdOrNull]
            : [];
    const isMulti = noteIds.length > 1;

    const handleSelect = useCallback(
        (targetFolderId: string | null) => {
            const wsId = effectiveWorkspaceId;
            if (!wsId) return;
            const now = Date.now();
            noteIds.forEach((sid) => {
                updateNote(sid, {
                    workspaceId: wsId,
                    folderId: targetFolderId ?? undefined,
                    lastModified: now,
                });
            });
            clearSelection();
            setMoveToWorkspaceModal(null);
        },
        [
            noteIds,
            effectiveWorkspaceId,
            updateNote,
            clearSelection,
            setMoveToWorkspaceModal,
        ]
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setMoveToWorkspaceModal(null);
        };
        if (moveToWorkspaceModal) {
            document.addEventListener("keydown", onKey);
            return () => document.removeEventListener("keydown", onKey);
        }
    }, [moveToWorkspaceModal, setMoveToWorkspaceModal]);

    if (!moveToWorkspaceModal || otherWorkspaces.length === 0) return null;
    return createPortal(
        <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="moveToWorkspaceTitle"
            onClick={(e) => {
                if (e.target === e.currentTarget) setMoveToWorkspaceModal(null);
            }}
        >
            <div
                className="modal modal-folder-picker"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <h3 id="moveToWorkspaceTitle" className="modal-title">
                        Move to workspace
                    </h3>
                    <p className="modal-message">
                        {isMulti
                            ? "Choose a workspace and folder for the selected notes."
                            : "Choose a workspace and folder for this note."}
                    </p>
                    <label
                        className="modal-workspace-label"
                        htmlFor="modalWorkspaceSelect"
                    >
                        Workspace
                    </label>
                    <select
                        id="modalWorkspaceSelect"
                        className="modal-workspace-select"
                        aria-label="Workspace"
                        value={effectiveWorkspaceId}
                        onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                    >
                        {otherWorkspaces.map((w) => (
                            <option key={w.id} value={w.id}>
                                {w.name}
                            </option>
                        ))}
                    </select>
                    <label
                        className="modal-workspace-label"
                        htmlFor="modalWorkspaceFolderList"
                    >
                        Folder in workspace
                    </label>
                    <div
                        className="modal-folder-picker-list scrollbar-branded modal-workspace-folder-list"
                        id="modalWorkspaceFolderList"
                        role="listbox"
                    >
                        <button
                            type="button"
                            className="modal-folder-picker-item"
                            data-folder-id=""
                            onClick={() => handleSelect(null)}
                        >
                            Root
                        </button>
                        {flatFolders.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                className="modal-folder-picker-item"
                                data-folder-id={f.id}
                                onClick={() => handleSelect(f.id)}
                            >
                                {f.path}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="modal-actions">
                    <button
                        type="button"
                        className="modal-btn modal-btn-secondary"
                        onClick={() => setMoveToWorkspaceModal(null)}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}

const FoldersTabListMemo = memo(FoldersTabList);

export function Sidebar({ collapsed, width }: SidebarProps) {
    const isDarkMode = useUIStore((s) => s.isDarkMode);
    const setIsDarkMode = useUIStore((s) => s.setIsDarkMode);
    const openInPipNoteIds = useUIStore((s) => s.openInPipNoteIds);
    const setOpenInPipNoteIds = useUIStore((s) => s.setOpenInPipNoteIds);
    const setOpenInPipActiveNoteId = useUIStore(
        (s) => s.setOpenInPipActiveNoteId
    );
    const addNoteToPip = useUIStore((s) => s.addNoteToPip);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const workspaces = useWorkspaceStore((s) => s.workspaces);
    const currentTab = useNotesStore((s) => s.currentTab);
    const setCurrentTab = useNotesStore((s) => s.setCurrentTab);
    const notes = useNotesStore((s) => s.notes);
    const sort = useNotesStore((s) => s.sort);
    const setSort = useNotesStore((s) => s.setSort);
    const selectedNoteId = useNotesStore((s) => s.selectedNoteId);
    const setSelectedNoteId = useNotesStore((s) => s.setSelectedNoteId);
    const selectedSidebarContext = useNotesStore(
        (s) => s.selectedSidebarContext
    );
    const setSelectedSidebarContext = useNotesStore(
        (s) => s.setSelectedSidebarContext
    );
    const expandedSidebarFolderIds = useNotesStore(
        (s) => s.expandedSidebarFolderIds
    );
    const toggleFolderExpanded = useNotesStore((s) => s.toggleFolderExpanded);
    const addNote = useNotesStore((s) => s.addNote);
    const addFolder = useNotesStore((s) => s.addFolder);
    const updateNote = useNotesStore((s) => s.updateNote);
    const updateFolder = useNotesStore((s) => s.updateFolder);
    const removeFolder = useNotesStore((s) => s.removeFolder);
    const duplicateNote = useNotesStore((s) => s.duplicateNote);
    const selectedNoteIds = useNotesStore((s) => s.selectedNoteIds);
    const selectedFolderIds = useNotesStore((s) => s.selectedFolderIds);
    const setSelection = useNotesStore((s) => s.setSelection);
    const setExpandedSidebarFolderIds = useNotesStore(
        (s) => s.setExpandedSidebarFolderIds
    );
    const folders = useNotesStore((s) => s.folders);
    const setSearchQuery = useNotesStore((s) => s.setSearchQuery);
    const clearSelection = useNotesStore((s) => s.clearSelection);
    const deleteNotesAndFoldersByWorkspace = useNotesStore(
        (s) => s.deleteNotesAndFoldersByWorkspace
    );
    const setCurrentWorkspaceId = useWorkspaceStore(
        (s) => s.setCurrentWorkspaceId
    );
    const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
    const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
    const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const workspaceBtnRef = useRef<HTMLButtonElement>(null);

    const [toolbarPosition, setToolbarPosition] = useState(loadToolbarPosition);
    const [sortMenuOpen, setSortMenuOpen] = useState(false);
    const [sortMenuAnchor, setSortMenuAnchor] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(false);
    const [workspaceRenameId, setWorkspaceRenameId] = useState<string | null>(
        null
    );
    const [authMenuOpen, setAuthMenuOpen] = useState(false);
    const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
    const [infoModal, setInfoModal] = useState<{
        title: string;
        message: string;
    } | null>(null);
    const [avatarImageFailed, setAvatarImageFailed] = useState(false);
    const [isOnline, setIsOnline] = useState(
        () => typeof navigator !== "undefined" && navigator.onLine
    );
    const authUserWrapperRef = useRef<HTMLDivElement>(null);
    const [workspaceDeleteConfirm, setWorkspaceDeleteConfirm] = useState<{
        id: string;
        name: string;
    } | null>(null);
    const [emptyContextMenu, setEmptyContextMenu] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const workspaceRenameInputRef = useRef<HTMLInputElement>(null);
    const isDraggingRef = useRef(false);
    const dragInitialRef = useRef({ x: 0, y: 0 });
    const toolbarPositionRef = useRef(toolbarPosition);
    toolbarPositionRef.current = toolbarPosition;
    const previousTabRef = useRef<"recent" | "folders">(currentTab);

    const isTrashView = useUIStore((s) => s.isTrashView);
    const setIsTrashView = useUIStore((s) => s.setIsTrashView);
    const currentView = useUIStore((s) => s.currentView);
    const setCurrentView = useUIStore((s) => s.setCurrentView);
    const setSyncLimitModalOpen = useUIStore((s) => s.setSyncLimitModalOpen);
    const authUser = useAuthStore((s) => s.user);
    const setAuthUser = useAuthStore((s) => s.setUser);
    const authSignOut = useAuthStore((s) => s.signOut);
    const isSubscribed = useSubscriptionStore((s) => s.isSubscribed);

    /** Restore session from last user id (extension: restoreOfflineWithLastUser). Returns true if restored. */
    const restoreOfflineWithLastUser =
        useCallback(async (): Promise<boolean> => {
            const lastId = await getLastUserId(db);
            if (!lastId) return false;
            await setStoredUserId(db, lastId);
            const row = await db.prefs.get(PREFS_KEYS.authLastUser);
            const last = row?.value as GoogleUserProfile | undefined;
            const profile =
                last &&
                typeof last === "object" &&
                typeof last.sub === "string" &&
                typeof last.name === "string"
                    ? {
                          sub: last.sub,
                          name: last.name,
                          picture:
                              typeof last.picture === "string"
                                  ? last.picture
                                  : "",
                          email:
                              typeof last.email === "string"
                                  ? last.email
                                  : undefined,
                      }
                    : null;
            if (profile) setAuthUser(profile);
            await loadPartitionIntoStores(db, lastId);
            await useSubscriptionStore.getState().refresh(db);
            setInfoModal({
                title: "Continuing in offline mode",
                message:
                    "Your notes are available. Sign in when you're back online to sync.",
            });
            return true;
        }, []);

    const onAuthSuccess = useCallback(
        async (tokenResponse: { access_token: string }) => {
            const profile = await fetchGoogleProfileFromToken(
                tokenResponse.access_token
            );
            try {
                const linked = await authenticateWithGoogleToken(
                    tokenResponse.access_token,
                    db
                );
                if (linked) {
                    trackEvent("sign_in_completed");
                    if (profile) {
                        setAuthUser(profile);
                        await persistLastUser(db, profile);
                    }
                    const partition = await getStoragePartition(db);
                    await loadPartitionIntoStores(db, partition);
                    await useSubscriptionStore.getState().refresh(db);
                    await setSyncPaused(db, false);
                    startPeriodicPullCheck(db);
                    try {
                        await triggerFullSync(db, { ignorePaused: true });
                    } catch (_) {
                        // Sync may fail (e.g. offline); no manual sync – full sync runs on sign-in only
                    }
                    return;
                }
                const restored = await restoreOfflineWithLastUser();
                if (!restored) {
                    clearLastServerSnapshot();
                    await clearStoredTokens(db);
                    setAuthUser(null);
                    useSubscriptionStore.getState().setSubscribed(null);
                    setInfoModal({
                        title: "Sign in failed",
                        message:
                            "Could not reach the server. Staying in local mode. Check your connection or try again later.",
                    });
                }
            } catch {
                const restored = await restoreOfflineWithLastUser();
                if (!restored) {
                    clearLastServerSnapshot();
                    await clearStoredTokens(db);
                    setAuthUser(null);
                    useSubscriptionStore.getState().setSubscribed(null);
                    setInfoModal({
                        title: "Sign in failed",
                        message:
                            "Could not reach the server. Staying in local mode. Check your connection or try again later.",
                    });
                }
            }
        },
        [restoreOfflineWithLastUser]
    );

    const googleLogin = useGoogleLogin({
        flow: "implicit",
        scope: "openid email profile",
        onSuccess: onAuthSuccess,
    });

    /** When signed in, refresh subscription status from backend (on load and after sign-in). */
    useEffect(() => {
        if (authUser) void useSubscriptionStore.getState().refresh(db);
    }, [authUser]);

    /** Free user over 10 notes: switch to Local mode (pause sync). Only when we know they're free (isSubscribed === false), not when still loading (null). Match notic extension updateQuotaWarning. */
    useEffect(() => {
        if (isSubscribed !== false) return;
        const totalNoteCount = Object.keys(notes).length;
        if (totalNoteCount > FREE_NOTE_LIMIT) {
            void setSyncPaused(db, true);
        }
    }, [isSubscribed, notes]);

    const defaultWsId = currentWorkspaceId ?? "workspace_1";
    const defaultWsIdStr = String(defaultWsId);
    const foldersInWorkspace = useMemo(
        () =>
            Object.values(folders).filter(
                (f) =>
                    String(f.workspaceId ?? "workspace_1") === defaultWsIdStr
            ),
        [folders, defaultWsIdStr]
    );
    const notesInWorkspace = useMemo(
        () =>
            Object.values(notes).filter(
                (n) =>
                    !n.deletedAt &&
                    String(n.workspaceId ?? "workspace_1") === defaultWsIdStr
            ),
        [notes, defaultWsIdStr]
    );

    const firstNoteId =
        notesInWorkspace.length > 0 ? notesInWorkspace[0].sessionId : null;

    const pipWindow = getPipWindow();
    const pipIsOpen = pipWindow != null && !pipWindow.closed;

    /** Folders tab: only current workspace's notes and folders (no fallback to all data). */
    const notesForFoldersTab = notesInWorkspace;
    const foldersForFoldersTab = foldersInWorkspace;

    /** All folder/date ids that can be expanded in sidebar (for expand/collapse all). Per-workspace for both tabs. */
    const allSidebarFolderIds = useMemo(() => {
        if (currentTab === "recent") {
            const dateKeys = Array.from(
                new Set(
                    notesInWorkspace.map((n) => formatDateKey(n.lastModified))
                )
            );
            dateKeys.sort((a, b) => parseDateKey(b) - parseDateKey(a));
            return [BOOKMARKS_SENTINEL, ...dateKeys];
        }
        return [
            BOOKMARKS_SENTINEL,
            ROOT_SENTINEL,
            ...foldersInWorkspace.map((f) => f.id),
        ];
    }, [currentTab, notesInWorkspace, foldersInWorkspace]);
    const isAllExpanded =
        allSidebarFolderIds.length > 0 &&
        allSidebarFolderIds.every((id) =>
            expandedSidebarFolderIds.includes(id)
        );
    const hasSidebarItems = allSidebarFolderIds.length > 0;

    const setPipUnsupportedModalOpen = useUIStore(
        (s) => s.setPipUnsupportedModalOpen
    );

    /** Click outside selectables: clear multi-select (match notic extension). */
    useEffect(() => {
        const onDocumentClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (
                target.closest(".sidebar-note-item") ||
                target.closest(".sidebar-folder-header")
            )
                return;
            if (selectedNoteIds.length > 0 || selectedFolderIds.length > 0)
                setSelection([], []);
        };
        document.addEventListener("click", onDocumentClick);
        return () => document.removeEventListener("click", onDocumentClick);
    }, [selectedNoteIds.length, selectedFolderIds.length, setSelection]);

    const handleOpenNotesClick = () => {
        if (!isDocumentPipSupported()) {
            setPipUnsupportedModalOpen(true);
            return;
        }
        const noteIds = firstNoteId ? [firstNoteId] : [];
        const activeId = firstNoteId ?? null;
        setOpenInPipNoteIds(noteIds);
        setOpenInPipActiveNoteId(activeId);
        void openPipWithNote(null, {
            isDarkMode,
            onClose: () => {
                const ids = useUIStore.getState().openInPipNoteIds;
                const notes = useNotesStore.getState().notes;
                const removeNote = useNotesStore.getState().removeNote;
                ids.forEach((id) => {
                    const n = notes[id];
                    if (n?.createdFromPip === true && n.hasEverHadContent !== true)
                        removeNote(id);
                });
                useUIStore.getState().setOpenInPipNoteIds([]);
                useUIStore.getState().setOpenInPipActiveNoteId(null);
            },
            noteIds,
            activeId,
            onError: () => setPipUnsupportedModalOpen(true),
        });
    };

    const openNoteInPip = useCallback(
        (noteId: string) => {
            if (!isDocumentPipSupported()) {
                setPipUnsupportedModalOpen(true);
                return;
            }
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
            const pipWin = getPipWindow();
            if (pipWin && !pipWin.closed) {
                const state = useUIStore.getState();
                const notes = useNotesStore.getState().notes;
                const noteTitles: Record<string, string> = {};
                const noteColors: Record<string, string> = {};
                const notePayloads: Record<string, { content?: string; title?: string; displayName?: string; color?: string; workspaceId?: string }> = {};
                state.openInPipNoteIds.forEach((id) => {
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
                sendNotesUpdateToPip(state.openInPipNoteIds, state.openInPipActiveNoteId, { noteTitles, noteColors, notePayloads });
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
                        if (n?.createdFromPip === true && n.hasEverHadContent !== true)
                            removeNote(id);
                    });
                    useUIStore.getState().setOpenInPipNoteIds([]);
                    useUIStore.getState().setOpenInPipActiveNoteId(null);
                },
                noteIds: state.openInPipNoteIds,
                activeId: state.openInPipActiveNoteId,
                onError: () => setPipUnsupportedModalOpen(true),
            });
        },
        [
            addNoteToPip,
            setOpenInPipActiveNoteId,
            isDarkMode,
            setPipUnsupportedModalOpen,
        ]
    );

    const [pendingNoteRenameId, setPendingNoteRenameId] = useState<
        string | null
    >(null);
    const onConsumePendingNoteRename = useCallback(
        () => setPendingNoteRenameId(null),
        []
    );

    const handleNewNote = () => {
        const effectiveWorkspaceId = currentWorkspaceId ?? "workspace_1";
        const newId = addNote({ workspaceId: effectiveWorkspaceId });
        setSelectedNoteId(newId);
        triggerSyncAfterUserAction(db);
        if (currentTab === "recent") {
            setSelectedSidebarContext(formatDateKey(Date.now()));
        }
        if (currentTab === "folders") {
            setSelectedSidebarContext(ROOT_SENTINEL);
            if (!expandedSidebarFolderIds.includes(ROOT_SENTINEL)) {
                setExpandedSidebarFolderIds([
                    ...expandedSidebarFolderIds,
                    ROOT_SENTINEL,
                ]);
            }
        }
        setPendingNoteRenameId(newId);
    };

    const [pendingFolderRenameId, setPendingFolderRenameId] = useState<
        string | null
    >(null);
    const onConsumePendingFolderRename = useCallback(
        () => setPendingFolderRenameId(null),
        []
    );

    const handleNewFolder = () => {
        const effectiveWorkspaceId = currentWorkspaceId ?? "workspace_1";
        const newId = addFolder({
            name: "Untitled",
            parentId: null,
            workspaceId: effectiveWorkspaceId,
        });
        setSelectedSidebarContext(newId);
        triggerSyncAfterUserAction(db);
        setExpandedSidebarFolderIds([
            ...expandedSidebarFolderIds,
            ROOT_SENTINEL,
            newId,
        ]);
        setPendingFolderRenameId(newId);
        setEmptyContextMenu(null);
    };

    /** Keep sidebar selection consistent with detail view: only when switching tabs, set context from selectedNoteId or default (most recent date when switching to Recent). */
    useEffect(() => {
        if (currentTab === previousTabRef.current) return;
        previousTabRef.current = currentTab;

        if (currentTab === "recent") {
            const note = selectedNoteId ? notes[selectedNoteId] : null;
            const inList =
                selectedNoteId &&
                notesInWorkspace.some((n) => n.sessionId === selectedNoteId);
            if (inList && note && !note.deletedAt) {
                const dateField =
                    sort === "created-asc" || sort === "created-desc"
                        ? "createdAt"
                        : "lastModified";
                const dateKey = note.isBookmarked
                    ? BOOKMARKS_SENTINEL
                    : formatDateKey(note[dateField]);
                setSelectedSidebarContext(dateKey);
                if (!expandedSidebarFolderIds.includes(dateKey)) {
                    setExpandedSidebarFolderIds([
                        ...expandedSidebarFolderIds,
                        dateKey,
                    ]);
                }
            } else {
                const dateField =
                    sort === "created-asc" || sort === "created-desc"
                        ? "createdAt"
                        : "lastModified";
                const dateKeys = [
                    ...new Set(
                        notesInWorkspace.map((n) => formatDateKey(n[dateField]))
                    ),
                ].sort((a, b) =>
                    sort === "created-asc" || sort === "modified-asc"
                        ? parseDateKey(a) - parseDateKey(b)
                        : parseDateKey(b) - parseDateKey(a)
                );
                const mostRecentDateKey = dateKeys[0] ?? null;
                setSelectedSidebarContext(mostRecentDateKey);
                if (
                    mostRecentDateKey &&
                    !expandedSidebarFolderIds.includes(mostRecentDateKey)
                ) {
                    setExpandedSidebarFolderIds([
                        ...expandedSidebarFolderIds,
                        mostRecentDateKey,
                    ]);
                }
            }
        } else {
            if (!selectedNoteId) return;
            const note = notes[selectedNoteId];
            if (!note || note.deletedAt) return;
            const inWorkspace = notesInWorkspace.some(
                (n) => n.sessionId === selectedNoteId
            );
            if (!inWorkspace) return;
            const folderId = note.folderId ?? null;
            const effectiveFolderId = folderId ?? ROOT_SENTINEL;
            setSelectedSidebarContext(effectiveFolderId);
            const toExpand =
                folderId != null
                    ? [
                          ROOT_SENTINEL,
                          ...getFolderAncestorIds(folderId, folders),
                          folderId,
                      ]
                    : [ROOT_SENTINEL];
            const next = new Set([...expandedSidebarFolderIds, ...toExpand]);
            if (toExpand.some((id) => !expandedSidebarFolderIds.includes(id))) {
                setExpandedSidebarFolderIds(Array.from(next));
            }
        }
    }, [
        currentTab,
        selectedNoteId,
        notes,
        notesInWorkspace,
        sort,
        folders,
        expandedSidebarFolderIds,
        setSelectedSidebarContext,
        setExpandedSidebarFolderIds,
    ]);

    /** When the open note (detail view) changes, expand all its parent nodes so it is visible in the sidebar. */
    useEffect(() => {
        if (!selectedNoteId) return;
        const note = notes[selectedNoteId];
        if (!note || note.deletedAt) return;

        if (currentTab === "recent") {
            const inList = notesInWorkspace.some(
                (n) => n.sessionId === selectedNoteId
            );
            if (!inList) return;
            const dateField =
                sort === "created-asc" || sort === "created-desc"
                    ? "createdAt"
                    : "lastModified";
            const dateKey = note.isBookmarked
                ? BOOKMARKS_SENTINEL
                : formatDateKey(note[dateField]);
            if (!expandedSidebarFolderIds.includes(dateKey)) {
                setExpandedSidebarFolderIds([
                    ...expandedSidebarFolderIds,
                    dateKey,
                ]);
            }
            return;
        }

        if (currentTab === "folders") {
            const inWorkspace = notesInWorkspace.some(
                (n) => n.sessionId === selectedNoteId
            );
            if (!inWorkspace) return;
            const folderId = note.folderId ?? null;
            const toExpand =
                folderId != null
                    ? [
                          ROOT_SENTINEL,
                          ...getFolderAncestorIds(folderId, folders),
                          folderId,
                      ]
                    : [ROOT_SENTINEL];
            const next = new Set([...expandedSidebarFolderIds, ...toExpand]);
            if (toExpand.some((id) => !expandedSidebarFolderIds.includes(id))) {
                setExpandedSidebarFolderIds(Array.from(next));
            }
        }
    }, [
        selectedNoteId,
        currentTab,
        notes,
        notesInWorkspace,
        sort,
        folders,
        expandedSidebarFolderIds,
        setExpandedSidebarFolderIds,
    ]);

    // Close empty context menu on outside click or Escape
    useEffect(() => {
        if (!emptyContextMenu) return;
        const close = (e: MouseEvent) => {
            if (
                (e.target as HTMLElement)?.closest?.(
                    "[data-sidebar-empty-menu]"
                )
            )
                return;
            setEmptyContextMenu(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setEmptyContextMenu(null);
        };
        window.addEventListener("click", close);
        window.addEventListener("keydown", onKey);
        return () => {
            window.removeEventListener("click", close);
            window.removeEventListener("keydown", onKey);
        };
    }, [emptyContextMenu]);

    const workspaceName =
        currentWorkspaceId && workspaces[currentWorkspaceId]
            ? workspaces[currentWorkspaceId].name
            : "Workspace 1";
    const currentWorkspace = currentWorkspaceId
        ? workspaces[currentWorkspaceId]
        : null;
    const workspaceDisplayList = useMemo(
        () => getWorkspacesInDisplayOrder(workspaces),
        [workspaces]
    );

    /** Exit settings/trash, switch to Recent tab, clear selection and search. Match extension when switching workspace. */
    const resetToRecentView = useCallback(() => {
        setCurrentView("notes");
        setIsTrashView(false);
        setCurrentTab("recent");
        setSelectedNoteId(null);
        setSelectedSidebarContext(null);
        setSearchQuery("");
        clearSelection();
    }, [
        setCurrentView,
        setIsTrashView,
        setCurrentTab,
        setSelectedNoteId,
        setSelectedSidebarContext,
        setSearchQuery,
        clearSelection,
    ]);

    const closeWorkspaceDropdown = useCallback(() => {
        setWorkspaceDropdownOpen(false);
        setWorkspaceRenameId(null);
    }, []);

    useEffect(() => {
        if (!workspaceDropdownOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeWorkspaceDropdown();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [workspaceDropdownOpen, closeWorkspaceDropdown]);

    useEffect(() => {
        if (!workspaceDropdownOpen) return;
        const onClick = () => closeWorkspaceDropdown();
        const t = setTimeout(
            () => document.addEventListener("click", onClick),
            0
        );
        return () => {
            clearTimeout(t);
            document.removeEventListener("click", onClick);
        };
    }, [workspaceDropdownOpen, closeWorkspaceDropdown]);

    useEffect(() => {
        if (!authMenuOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setAuthMenuOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [authMenuOpen]);

    useEffect(() => {
        if (!authMenuOpen) return;
        const onClick = (e: MouseEvent) => {
            const el = authUserWrapperRef.current;
            if (el && !el.contains(e.target as Node)) setAuthMenuOpen(false);
        };
        const t = setTimeout(
            () => document.addEventListener("click", onClick),
            0
        );
        return () => {
            clearTimeout(t);
            document.removeEventListener("click", onClick);
        };
    }, [authMenuOpen]);

    useEffect(() => {
        if (!signOutConfirmOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSignOutConfirmOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [signOutConfirmOpen]);

    useEffect(() => {
        if (!infoModal) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setInfoModal(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [infoModal]);

    useEffect(() => {
        setAvatarImageFailed(false);
    }, [authUser?.sub]);

    useEffect(() => {
        const onOnline = () => setIsOnline(true);
        const onOffline = () => setIsOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    useEffect(() => {
        if (workspaceRenameId && workspaceRenameInputRef.current) {
            workspaceRenameInputRef.current.focus();
            workspaceRenameInputRef.current.select();
        }
    }, [workspaceRenameId]);

    const handleSwitchWorkspace = useCallback(
        (wsId: string) => {
            if (wsId === currentWorkspaceId) {
                closeWorkspaceDropdown();
                return;
            }
            resetToRecentView();
            setCurrentWorkspaceId(wsId);
            // Persist current workspace to IndexedDB immediately (match extension persistCurrentWorkspaceId)
            void getStoragePartition(db).then((partition) =>
                db.prefs.put({
                    key: currentWorkspaceIdKey(partition),
                    value: wsId,
                })
            );
            closeWorkspaceDropdown();
        },
        [
            currentWorkspaceId,
            closeWorkspaceDropdown,
            resetToRecentView,
            setCurrentWorkspaceId,
        ]
    );

    const handleRenameSubmit = useCallback(
        (wsId: string, currentName: string, value: string) => {
            const trimmed = value.trim().slice(0, WORKSPACE_NAME_MAX_LENGTH);
            if (trimmed && trimmed !== currentName)
                renameWorkspace(wsId, trimmed);
            setWorkspaceRenameId(null);
        },
        [renameWorkspace]
    );

    const handleAddWorkspace = useCallback(() => {
        const newWs = addWorkspace();
        resetToRecentView();
        setCurrentWorkspaceId(newWs.id);
        closeWorkspaceDropdown();
    }, [
        addWorkspace,
        resetToRecentView,
        setCurrentWorkspaceId,
        closeWorkspaceDropdown,
    ]);

    const handleDeleteWorkspaceConfirm = useCallback(() => {
        if (!workspaceDeleteConfirm) return;
        const { id } = workspaceDeleteConfirm;
        deleteNotesAndFoldersByWorkspace(id);
        deleteWorkspace(id);
        setWorkspaceDeleteConfirm(null);
        triggerSyncAfterUserAction(db);
        closeWorkspaceDropdown();
    }, [
        workspaceDeleteConfirm,
        deleteNotesAndFoldersByWorkspace,
        deleteWorkspace,
        closeWorkspaceDropdown,
    ]);

    const workspaceIconChar =
        (currentWorkspace as { icon?: string } | undefined)?.icon
            ?.trim()
            .slice(0, 1) ||
        (workspaceName.trim().charAt(0) || "W").toUpperCase();
    const workspaceIconColor =
        (currentWorkspace as { color?: string } | undefined)?.color ?? "";

    // Draggable toolbar – match extension dashboard-toolbar.ts (position relative to sidebar, constrain, persist)
    const handleToolbarMouseDown = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest(".toolbar-btn")) return;
        const el = toolbarRef.current;
        const sidebar = sidebarRef.current;
        if (!el || !sidebar) return;
        isDraggingRef.current = true;
        const rect = el.getBoundingClientRect();
        dragInitialRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
        e.preventDefault();
        e.stopPropagation();
    }, []);

    useEffect(() => {
        const drag = (e: MouseEvent) => {
            if (!isDraggingRef.current) return;
            const sidebar = sidebarRef.current;
            const el = toolbarRef.current;
            if (!sidebar || !el) return;
            const sidebarRect = sidebar.getBoundingClientRect();
            const newLeft =
                e.clientX - sidebarRect.left - dragInitialRef.current.x;
            const newTop =
                e.clientY - sidebarRect.top - dragInitialRef.current.y;
            const toolbarWidth = el.offsetWidth;
            const newRight = sidebarRect.width - newLeft - toolbarWidth;
            const constrainedRight = Math.max(
                TOOLBAR_MIN_RIGHT,
                Math.min(TOOLBAR_MAX_RIGHT, newRight)
            );
            const maxTop = Math.max(TOOLBAR_MIN_TOP, window.innerHeight - 200);
            const constrainedTop = Math.max(
                TOOLBAR_MIN_TOP,
                Math.min(maxTop, newTop)
            );
            setToolbarPosition({
                top: constrainedTop,
                right: constrainedRight,
            });
            e.preventDefault();
            e.stopPropagation();
        };
        const stopDrag = () => {
            if (!isDraggingRef.current) return;
            isDraggingRef.current = false;
            const { top, right } = toolbarPositionRef.current;
            saveToolbarPosition(top, right);
        };
        document.addEventListener("mousemove", drag);
        document.addEventListener("mouseup", stopDrag);
        return () => {
            document.removeEventListener("mousemove", drag);
            document.removeEventListener("mouseup", stopDrag);
        };
    }, []);

    // Sync toolbar position from state to DOM (ref may not be set on first render)
    useEffect(() => {
        if (!toolbarRef.current) return;
        toolbarRef.current.style.top = `${toolbarPosition.top}px`;
        toolbarRef.current.style.right = `${toolbarPosition.right}px`;
    }, [toolbarPosition]);

    const sortOptions: Array<{ label: string; value: SortOption }> =
        currentTab === "recent"
            ? [
                  { label: "Created (Newest First)", value: "created-desc" },
                  { label: "Created (Oldest First)", value: "created-asc" },
                  { label: "Modified (Newest First)", value: "modified-desc" },
                  { label: "Modified (Oldest First)", value: "modified-asc" },
              ]
            : [
                  { label: "Created (Newest First)", value: "created-desc" },
                  { label: "Created (Oldest First)", value: "created-asc" },
                  { label: "Modified (Newest First)", value: "modified-desc" },
                  { label: "Modified (Oldest First)", value: "modified-asc" },
                  { label: "Alphabetical (A-Z)", value: "alphabetical-asc" },
                  { label: "Alphabetical (Z-A)", value: "alphabetical-desc" },
              ];

    const openSortMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        setSortMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
        setSortMenuOpen(true);
    }, []);

    useEffect(() => {
        if (!sortMenuOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSortMenuOpen(false);
                setSortMenuAnchor(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [sortMenuOpen]);

    const handleTrashClick = useCallback(() => {
        if (isTrashView) {
            setIsTrashView(false);
            return;
        }
        setIsTrashView(true);
        setSelectedNoteId(null);
        setSelectedSidebarContext(null);
    }, [
        isTrashView,
        setIsTrashView,
        setSelectedNoteId,
        setSelectedSidebarContext,
    ]);

    const handleExpandCollapseAll = useCallback(() => {
        setExpandedSidebarFolderIds(isAllExpanded ? [] : allSidebarFolderIds);
    }, [isAllExpanded, allSidebarFolderIds, setExpandedSidebarFolderIds]);

    return (
        <aside
            ref={sidebarRef}
            className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}
            style={{
                width: collapsed ? 0 : width > 0 ? width : 280,
                minWidth: collapsed ? 0 : 200,
                maxWidth: collapsed ? 0 : 480,
            }}
        >
            {collapsed ? null : (
                <>
                    <MoveToFolderModal />
                    <MoveToWorkspaceModal />
                    {/* Workspace selector + dropdown (match extension exactly) */}
                    <div className="workspace-selector">
                        <button
                            ref={workspaceBtnRef}
                            type="button"
                            id="workspaceBtn"
                            className="workspace-btn"
                            aria-haspopup="true"
                            aria-expanded={workspaceDropdownOpen}
                            title="Click to open workspace menu"
                            onClick={(e) => {
                                e.stopPropagation();
                                setWorkspaceDropdownOpen((open) => !open);
                            }}
                        >
                            <span
                                className="workspace-icon"
                                aria-hidden
                                style={
                                    workspaceIconColor
                                        ? {
                                              backgroundColor:
                                                  workspaceIconColor,
                                              color: "var(--on-accent)",
                                          }
                                        : undefined
                                }
                            >
                                {workspaceIconChar}
                            </span>
                            <span className="workspace-name">
                                {workspaceName}
                            </span>
                            <ChevronDown
                                className="workspace-arrow"
                                size={16}
                            />
                        </button>
                    </div>
                    {/* Workspace dropdown (fixed position under button) */}
                    {workspaceDropdownOpen &&
                        workspaceBtnRef.current &&
                        createPortal(
                            <div
                                className="workspace-dropdown"
                                role="menu"
                                style={(() => {
                                    const rect =
                                        workspaceBtnRef.current!.getBoundingClientRect();
                                    const dropdownMinWidth = 280;
                                    return {
                                        top: rect.bottom + 6,
                                        left: rect.left,
                                        minWidth: Math.max(
                                            rect.width,
                                            dropdownMinWidth
                                        ),
                                    };
                                })()}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {workspaceDisplayList.map((ws) => {
                                    if (workspaceRenameId === ws.id) {
                                        const currentName = ws.name;
                                        return (
                                            <input
                                                key={ws.id}
                                                ref={workspaceRenameInputRef}
                                                type="text"
                                                className="workspace-dropdown-rename-input"
                                                defaultValue={currentName}
                                                maxLength={
                                                    WORKSPACE_NAME_MAX_LENGTH
                                                }
                                                aria-label="Workspace name"
                                                onClick={(e) =>
                                                    e.stopPropagation()
                                                }
                                                onBlur={(e) =>
                                                    handleRenameSubmit(
                                                        ws.id,
                                                        currentName,
                                                        e.target.value
                                                    )
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        handleRenameSubmit(
                                                            ws.id,
                                                            currentName,
                                                            (
                                                                e.target as HTMLInputElement
                                                            ).value
                                                        );
                                                        (
                                                            e.target as HTMLInputElement
                                                        ).blur();
                                                    } else if (
                                                        e.key === "Escape"
                                                    ) {
                                                        e.preventDefault();
                                                        setWorkspaceRenameId(
                                                            null
                                                        );
                                                    }
                                                }}
                                            />
                                        );
                                    }
                                    const iconChar =
                                        (ws as { icon?: string }).icon
                                            ?.trim()
                                            .slice(0, 1) ||
                                        (
                                            ws.name.trim().charAt(0) || "W"
                                        ).toUpperCase();
                                    const color = (ws as { color?: string })
                                        .color;
                                    const isActive =
                                        ws.id === currentWorkspaceId;
                                    return (
                                        <button
                                            key={ws.id}
                                            type="button"
                                            className={`workspace-dropdown-item ${
                                                isActive
                                                    ? "workspace-dropdown-item-active"
                                                    : ""
                                            }`}
                                            role="menuitem"
                                            data-workspace-id={ws.id}
                                            title={
                                                isActive
                                                    ? `Current: ${ws.name}`
                                                    : `Switch to ${ws.name}`
                                            }
                                            onClick={() =>
                                                handleSwitchWorkspace(ws.id)
                                            }
                                        >
                                            <span
                                                className="workspace-dropdown-item-icon"
                                                style={
                                                    color
                                                        ? {
                                                              backgroundColor:
                                                                  color,
                                                              color: "var(--on-accent)",
                                                          }
                                                        : undefined
                                                }
                                            >
                                                {iconChar}
                                            </span>
                                            <span className="workspace-dropdown-item-name">
                                                {ws.name}
                                            </span>
                                        </button>
                                    );
                                })}
                                <div
                                    className="workspace-dropdown-sep"
                                    aria-hidden
                                />
                                <button
                                    type="button"
                                    className="workspace-dropdown-item"
                                    role="menuitem"
                                    title="Rename current workspace"
                                    onClick={() =>
                                        currentWorkspaceId &&
                                        setWorkspaceRenameId(currentWorkspaceId)
                                    }
                                >
                                    Rename
                                </button>
                                <button
                                    type="button"
                                    className="workspace-dropdown-item"
                                    role="menuitem"
                                    title="Create a new workspace"
                                    onClick={handleAddWorkspace}
                                >
                                    Add workspace
                                </button>
                                {(() => {
                                    const isDefault =
                                        currentWorkspace?.isDefault ??
                                        currentWorkspaceId ===
                                            DEFAULT_WORKSPACE_ID;
                                    return (
                                        <button
                                            type="button"
                                            className={`workspace-dropdown-item workspace-dropdown-item-danger ${
                                                isDefault
                                                    ? "workspace-dropdown-item-disabled"
                                                    : ""
                                            }`}
                                            role="menuitem"
                                            disabled={isDefault}
                                            title={
                                                isDefault
                                                    ? "Default workspace cannot be deleted"
                                                    : "Delete this workspace and all notes and folders in it"
                                            }
                                            onClick={() => {
                                                if (
                                                    isDefault ||
                                                    !currentWorkspace
                                                )
                                                    return;
                                                setWorkspaceDeleteConfirm({
                                                    id: currentWorkspaceId!,
                                                    name: currentWorkspace.name,
                                                });
                                            }}
                                        >
                                            Delete workspace
                                        </button>
                                    );
                                })()}
                            </div>,
                            document.body
                        )}
                    {/* Delete workspace confirm modal */}
                    {workspaceDeleteConfirm && (
                        <div
                            className="modal-overlay"
                            role="dialog"
                            aria-modal="true"
                            onClick={() => setWorkspaceDeleteConfirm(null)}
                        >
                            <div
                                className="modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="modal-header">
                                    <h3 className="modal-title">
                                        Delete workspace?
                                    </h3>
                                    <p className="modal-message">
                                        &quot;{workspaceDeleteConfirm.name}
                                        &quot; and all notes and folders in it
                                        will be permanently deleted.
                                    </p>
                                </div>
                                <div className="modal-actions">
                                    <button
                                        type="button"
                                        className="modal-btn modal-btn-secondary"
                                        onClick={() =>
                                            setWorkspaceDeleteConfirm(null)
                                        }
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="modal-btn pip-modal-btn-danger"
                                        onClick={handleDeleteWorkspaceConfirm}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Sign out confirm modal (same as extension) */}
                    {signOutConfirmOpen && (
                        <div
                            className="modal-overlay"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="signout-modal-title"
                            onClick={() => setSignOutConfirmOpen(false)}
                        >
                            <div
                                className="modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="modal-header">
                                    <h3
                                        id="signout-modal-title"
                                        className="modal-title"
                                    >
                                        Sign out?
                                    </h3>
                                    <p className="modal-message">
                                        Notes stored only on this device may not
                                        sync to the cloud. Sign out anyway?
                                    </p>
                                </div>
                                <div className="modal-actions">
                                    <button
                                        type="button"
                                        className="modal-btn modal-btn-secondary"
                                        onClick={() =>
                                            setSignOutConfirmOpen(false)
                                        }
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        className="modal-btn pip-modal-btn-danger"
                                        onClick={async () => {
                                            setSignOutConfirmOpen(false);
                                            authSignOut();
                                            useSubscriptionStore
                                                .getState()
                                                .setSubscribed(null);
                                            setSelectedNoteId(null);
                                            setSelection([], []);
                                            stopPeriodicPullCheck();
                                            useUIStore.getState().setServerNewerBannerVisible(false);
                                            clearLastServerSnapshot();
                                            await clearStoredTokens(db);
                                            await loadPartitionIntoStores(
                                                db,
                                                LOCAL_PARTITION
                                            );
                                        }}
                                    >
                                        Sign out
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Info modal (offline, sign-in failed, continuing in offline mode) */}
                    {infoModal && (
                        <div
                            className="modal-overlay"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="info-modal-title"
                            onClick={() => setInfoModal(null)}
                        >
                            <div
                                className="modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="modal-header">
                                    <h3
                                        id="info-modal-title"
                                        className="modal-title"
                                    >
                                        {infoModal.title}
                                    </h3>
                                    <p className="modal-message">
                                        {infoModal.message}
                                    </p>
                                </div>
                                <div className="modal-actions">
                                    <button
                                        type="button"
                                        className="modal-btn modal-btn-primary"
                                        onClick={() => setInfoModal(null)}
                                    >
                                        OK
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Tabs (Recent / Folders) + Open Notes */}
                    <div className="segmented-control">
                        <div className="segmented-control-inner">
                            <button
                                type="button"
                                className={`segmented-control-button ${
                                    currentTab === "recent" ? "active" : ""
                                }`}
                                data-tab="recent"
                                title="Recent"
                                onClick={() => setCurrentTab("recent")}
                            >
                                <span className="segmented-control-label">
                                    Recent
                                </span>
                            </button>
                            <button
                                type="button"
                                className={`segmented-control-button ${
                                    currentTab === "folders" ? "active" : ""
                                }`}
                                data-tab="folders"
                                title="Folders"
                                onClick={() => {
                                    startTransition(() =>
                                        setCurrentTab("folders")
                                    );
                                    if (!selectedNoteId)
                                        setSelectedSidebarContext(
                                            ROOT_SENTINEL
                                        );
                                }}
                            >
                                <span className="segmented-control-label">
                                    Folders
                                </span>
                            </button>
                        </div>
                        <button
                            type="button"
                            className="open-notes-btn"
                            title="Open Notes"
                            aria-label="Open Notes"
                            onClick={handleOpenNotesClick}
                        >
                            <ExternalLink size={14} />
                        </button>
                    </div>

                    {/* Toolbar (floating island, draggable – match notic extension) */}
                    <div
                        ref={toolbarRef}
                        className="sidebar-toolbar"
                        id="sidebarToolbar"
                        style={{
                            top: toolbarPosition.top,
                            right: toolbarPosition.right,
                        }}
                        onMouseDown={handleToolbarMouseDown}
                        role="toolbar"
                        aria-label="Sidebar actions"
                    >
                        <button
                            type="button"
                            className="toolbar-btn"
                            title="New Note"
                            onClick={handleNewNote}
                            aria-label="New Note"
                        >
                            <CirclePlus size={12} />
                        </button>
                        <button
                            type="button"
                            className="toolbar-btn"
                            title="New Folder"
                            disabled={currentTab === "recent"}
                            aria-label="New Folder"
                            onClick={
                                currentTab === "folders"
                                    ? handleNewFolder
                                    : undefined
                            }
                        >
                            <FolderPlus size={12} />
                        </button>
                        <button
                            type="button"
                            className="toolbar-btn"
                            title="Sort"
                            onClick={openSortMenu}
                            aria-label="Sort"
                            aria-haspopup="true"
                            aria-expanded={sortMenuOpen}
                        >
                            <ArrowUpDown size={12} />
                        </button>
                        <button
                            type="button"
                            className="toolbar-btn"
                            title={
                                isAllExpanded ? "Collapse All" : "Expand All"
                            }
                            disabled={!hasSidebarItems}
                            onClick={handleExpandCollapseAll}
                            aria-label={
                                isAllExpanded ? "Collapse All" : "Expand All"
                            }
                        >
                            {isAllExpanded ? (
                                <ChevronsUp size={12} />
                            ) : (
                                <ChevronsDown size={12} />
                            )}
                        </button>
                        <button
                            type="button"
                            className={`toolbar-btn ${
                                isTrashView ? "active" : ""
                            }`}
                            title="Trash"
                            onClick={handleTrashClick}
                            aria-label="Trash"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>

                    {/* Sort menu (same design as context menu); overlay closes on outside click, no dim/blur */}
                    {sortMenuOpen && sortMenuAnchor && (
                        <>
                            <div
                                className="dropdown-overlay"
                                onClick={() => setSortMenuOpen(false)}
                                onContextMenu={(e) => e.preventDefault()}
                                aria-hidden
                            />
                            <div
                                className="pip-context-menu show"
                                style={{
                                    left: sortMenuAnchor.x,
                                    top: sortMenuAnchor.y,
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                {sortOptions.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        className="pip-context-menu-item"
                                        onClick={() => {
                                            setSort(opt.value);
                                            setSortMenuOpen(false);
                                            setSortMenuAnchor(null);
                                        }}
                                    >
                                        {opt.label}
                                        {sort === opt.value ? " ✓" : ""}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {/* Quota warning: free user over note limit (matches notic extension updateQuotaWarning) */}
                    <div
                        className={`quota-warning-slot ${isSubscribed === false && Object.keys(notes).length > FREE_NOTE_LIMIT ? "quota-warning-visible" : ""}`}
                        id="quotaWarningSlot"
                        aria-live="polite"
                    >
                        {isSubscribed === false && Object.keys(notes).length > FREE_NOTE_LIMIT && (
                            <div className="quota-warning" role="status">
                                <p className="quota-warning-text">
                                    Sync limit reached: Notic is in Private Local Mode. Upgrade to Pro to sync all {Object.keys(notes).length} notes.
                                </p>
                                <button
                                    type="button"
                                    className="quota-warning-info"
                                    title="More info"
                                    aria-label="More info about free plan limit"
                                    onClick={() => setSyncLimitModalOpen(true)}
                                >
                                    <Info size={16} aria-hidden />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Empty area context menu: entire sidebar when right-click not on note/folder (Recent = New Note only; Folders = New Note + New Folder – matches notic extension) */}
                    {emptyContextMenu &&
                        createPortal(
                            <div
                                className="pip-context-menu show"
                                style={{
                                    left: emptyContextMenu.x,
                                    top: emptyContextMenu.y,
                                }}
                                data-sidebar-empty-menu
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button
                                    type="button"
                                    className="pip-context-menu-item"
                                    onClick={() => {
                                        handleNewNote();
                                        setEmptyContextMenu(null);
                                    }}
                                >
                                    New Note
                                </button>
                                {currentTab === "folders" && (
                                    <button
                                        type="button"
                                        className="pip-context-menu-item"
                                        onClick={() => {
                                            handleNewFolder();
                                            setEmptyContextMenu(null);
                                        }}
                                    >
                                        New Folder
                                    </button>
                                )}
                            </div>,
                            document.body
                        )}

                    {/* Notes list: empty-area context menu when right-click on empty space only; Root header also triggers it (create under root). Exclude: note, non-Root folder header, date folder. */}
                    <div
                        className="sidebar-content"
                        id="sidebarContent"
                        onContextMenu={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest(".sidebar-note-item") || target.closest(".sidebar-date-folder") || target.closest("[data-context-menu-trigger]")) return;
                            const folderHeader = target.closest(".sidebar-folder-header");
                            if (folderHeader && folderHeader.getAttribute("data-folder-id") !== ROOT_SENTINEL) return;
                            e.preventDefault();
                            setEmptyContextMenu({ x: e.clientX, y: e.clientY });
                        }}
                    >
                        {currentTab === "recent" ? (
                            <div className="notes-list" id="recentNotesList">
                                <RecentTabListMemo
                                    notes={notesInWorkspace}
                                    sort={sort}
                                    selectedNoteId={selectedNoteId}
                                    setSelectedNoteId={setSelectedNoteId}
                                    selectedFolderDate={selectedSidebarContext}
                                    setSelectedFolderDate={
                                        setSelectedSidebarContext
                                    }
                                    expandedSidebarFolderIds={
                                        expandedSidebarFolderIds
                                    }
                                    toggleFolderExpanded={toggleFolderExpanded}
                                    openInPipNoteIds={openInPipNoteIds}
                                    addNoteToPip={addNoteToPip}
                                    openNoteInPip={openNoteInPip}
                                    selectedNoteIds={selectedNoteIds}
                                    setSelection={setSelection}
                                    updateNote={updateNote}
                                    duplicateNote={duplicateNote}
                                    onNewNote={handleNewNote}
                                    pendingNoteRenameId={pendingNoteRenameId}
                                    onConsumePendingNoteRename={
                                        onConsumePendingNoteRename
                                    }
                                    currentTab={currentTab}
                                    pipIsOpen={pipIsOpen}
                                />
                            </div>
                        ) : (
                            <div className="notes-list" id="foldersNotesList">
                                <FoldersTabListMemo
                                    notes={notes}
                                    folders={folders}
                                    foldersInWorkspace={foldersForFoldersTab}
                                    notesInWorkspace={notesForFoldersTab}
                                    sort={sort}
                                    selectedNoteId={selectedNoteId}
                                    selectedFolderId={selectedSidebarContext}
                                    setSelectedNoteId={setSelectedNoteId}
                                    setSelectedFolderId={
                                        setSelectedSidebarContext
                                    }
                                    selectedNoteIds={selectedNoteIds}
                                    selectedFolderIds={selectedFolderIds}
                                    setSelection={setSelection}
                                    expandedSidebarFolderIds={
                                        expandedSidebarFolderIds
                                    }
                                    setExpandedSidebarFolderIds={
                                        setExpandedSidebarFolderIds
                                    }
                                    toggleFolderExpanded={toggleFolderExpanded}
                                    openInPipNoteIds={openInPipNoteIds}
                                    addNoteToPip={addNoteToPip}
                                    openNoteInPip={openNoteInPip}
                                    pipIsOpen={pipIsOpen}
                                    setIsTrashView={setIsTrashView}
                                    currentWorkspaceId={currentWorkspaceId}
                                    addNote={addNote}
                                    addFolder={addFolder}
                                    updateFolder={updateFolder}
                                    removeFolder={removeFolder}
                                    clearSelection={clearSelection}
                                    pendingFolderRenameId={
                                        pendingFolderRenameId
                                    }
                                    onConsumePendingFolderRename={
                                        onConsumePendingFolderRename
                                    }
                                    pendingNoteRenameId={pendingNoteRenameId}
                                    onConsumePendingNoteRename={
                                        onConsumePendingNoteRename
                                    }
                                    updateNote={updateNote}
                                    duplicateNote={duplicateNote}
                                    currentTab={currentTab}
                                />
                            </div>
                        )}
                    </div>

                    {/* Footer: auth slot (avatar + dropdown like extension), Settings, Theme */}
                    <div className="sidebar-footer">
                        <div className="auth-footer-slot" id="authFooterSlot">
                            {authUser ? (
                                <div
                                    className="auth-user-wrapper"
                                    ref={authUserWrapperRef}
                                >
                                    <button
                                        type="button"
                                        className="auth-user-block"
                                        title="Account"
                                        aria-label="Account menu"
                                        aria-haspopup="true"
                                        aria-expanded={authMenuOpen}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setAuthMenuOpen((open) => !open);
                                        }}
                                    >
                                        {avatarImageFailed ? (
                                            <span
                                                className="auth-user-avatar auth-user-avatar-letter"
                                                aria-hidden
                                                style={{
                                                    backgroundColor: `hsl(${
                                                        authUser.sub
                                                            ?.split("")
                                                            .reduce(
                                                                (a, c) =>
                                                                    a +
                                                                    c.charCodeAt(
                                                                        0
                                                                    ),
                                                                0
                                                            ) % 360
                                                    }, 50%, 45%)`,
                                                }}
                                            >
                                                {(
                                                    authUser.name
                                                        ?.trim()
                                                        .charAt(0) ||
                                                    authUser.email
                                                        ?.trim()
                                                        .charAt(0) ||
                                                    "?"
                                                ).toUpperCase()}
                                            </span>
                                        ) : (
                                            <img
                                                className="auth-user-avatar"
                                                src={authUser.picture}
                                                alt=""
                                                referrerPolicy="no-referrer"
                                                onError={() =>
                                                    setAvatarImageFailed(true)
                                                }
                                            />
                                        )}
                                        <span className="auth-user-name">
                                            {authUser.name ||
                                                authUser.email ||
                                                "Account"}
                                        </span>
                                        <span
                                            className={
                                                !isOnline
                                                    ? "auth-offline-badge"
                                                    : isSubscribed === true
                                                    ? "auth-premium-badge"
                                                    : "auth-free-badge"
                                            }
                                        >
                                            {!isOnline
                                                ? "Offline"
                                                : isSubscribed === true
                                                ? "Pro"
                                                : "Free"}
                                        </span>
                                    </button>
                                    <div
                                        className={`auth-user-menu${
                                            authMenuOpen ? " show" : ""
                                        }`}
                                        role="menu"
                                    >
                                        <button
                                            type="button"
                                            className="context-menu-item danger"
                                            role="menuitem"
                                            onClick={() => {
                                                setAuthMenuOpen(false);
                                                setSignOutConfirmOpen(true);
                                            }}
                                        >
                                            Sign out
                                        </button>
                                    </div>
                                </div>
                            ) : getGoogleClientId() ? (
                                <button
                                    type="button"
                                    className="auth-sign-in-btn"
                                    title="Connect Google account (for sync)"
                                    aria-label="Connect for sync"
                                    onClick={() => {
                                        if (!navigator.onLine) {
                                            setInfoModal({
                                                title: "You're offline",
                                                message:
                                                    "Sign in when you're back online to connect your account and sync.",
                                            });
                                            return;
                                        }
                                        googleLogin();
                                    }}
                                >
                                    <GoogleIcon />
                                    <span className="auth-sign-in-label">
                                        Connect for sync
                                    </span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="auth-sign-in-btn"
                                    title="Connect Google account (for sync)"
                                    aria-label="Connect for sync"
                                    disabled
                                >
                                    <GoogleIcon />
                                    <span className="auth-sign-in-label">
                                        Connect for sync
                                    </span>
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            className={`settings-btn-icon-only ${
                                currentView === "settings" ? "active" : ""
                            }`}
                            id="settingsBtn"
                            title="Settings"
                            aria-label="Settings"
                            aria-pressed={currentView === "settings"}
                            onClick={() => {
                                if (currentView === "settings") {
                                    setCurrentView("notes");
                                } else {
                                    setCurrentView("settings");
                                    setIsTrashView(false);
                                }
                            }}
                        >
                            <Settings size={18} />
                        </button>
                        <button
                            type="button"
                            className="theme-toggle"
                            id="themeToggle"
                            onClick={() => setIsDarkMode(!isDarkMode)}
                            title={isDarkMode ? "Light mode" : "Dark mode"}
                            aria-label={isDarkMode ? "Light mode" : "Dark mode"}
                        >
                            {isDarkMode ? (
                                <Sun size={18} />
                            ) : (
                                <Moon size={18} />
                            )}
                        </button>
                    </div>
                </>
            )}
        </aside>
    );
}
