import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useNotesStore, useUIStore, useWorkspaceStore } from "../store";
import { NoteEditor } from "./NoteEditor";
import { Plus, X, Pin } from "lucide-react";
import { triggerSyncAfterUserAction } from "../sync";
import { db } from "../db";

const SAVE_DEBOUNCE_MS = 700;
const COLOR_OPTIONS: Array<{ label: string; value: string }> = [
    { label: "Default", value: "" },
    { label: "Blue", value: "#3b82f6" },
    { label: "Green", value: "#22c55e" },
    { label: "Purple", value: "#a855f7" },
    { label: "Orange", value: "#f97316" },
];

/**
 * Mobile bottom sheet editor with tabs — mirrors PiP functionality.
 * Visible only on mobile (controlled via CSS media query + store state).
 */
export function MobileBottomSheet() {
    const bottomSheetOpen = useUIStore((s) => s.bottomSheetOpen);
    const noteIds = useUIStore((s) => s.bottomSheetNoteIds);
    const activeNoteId = useUIStore((s) => s.bottomSheetActiveNoteId);
    const setBottomSheetOpen = useUIStore((s) => s.setBottomSheetOpen);
    const setBottomSheetNoteIds = useUIStore((s) => s.setBottomSheetNoteIds);
    const setBottomSheetActiveNoteId = useUIStore(
        (s) => s.setBottomSheetActiveNoteId
    );
    const removeNoteFromBottomSheet = useUIStore(
        (s) => s.removeNoteFromBottomSheet
    );
    const addNoteToBottomSheet = useUIStore((s) => s.addNoteToBottomSheet);

    const notes = useNotesStore((s) => s.notes);
    const updateNote = useNotesStore((s) => s.updateNote);
    const addNote = useNotesStore((s) => s.addNote);
    const removeNote = useNotesStore((s) => s.removeNote);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

    const contentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );
    const flushRef = useRef<(() => void) | null>(null);
    const [pinnedTabIds, setPinnedTabIds] = useState<Set<string>>(
        () => new Set()
    );
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        noteId: string;
    } | null>(null);
    const [renameState, setRenameState] = useState<{
        noteId: string;
        value: string;
    } | null>(null);

    const effectiveActiveId = noteIds.includes(activeNoteId ?? "")
        ? activeNoteId
        : noteIds[0] ?? null;
    const activeNote = effectiveActiveId ? notes[effectiveActiveId] : null;

    const sortedNoteIds = useMemo(() => {
        const pinned = noteIds.filter((id) => pinnedTabIds.has(id));
        const unpinned = noteIds.filter((id) => !pinnedTabIds.has(id));
        return [...pinned, ...unpinned];
    }, [noteIds, pinnedTabIds]);

    // Close context menu on outside click
    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [contextMenu]);

    // --- Handlers ---

    const handleAddNote = useCallback(() => {
        const newId = addNote({
            workspaceId: currentWorkspaceId,
            createdFromPip: true,
        });
        addNoteToBottomSheet(newId, true);
        triggerSyncAfterUserAction(db);
    }, [addNote, currentWorkspaceId, addNoteToBottomSheet]);

    const handleSwitchTab = useCallback(
        (noteId: string) => {
            if (effectiveActiveId != null && effectiveActiveId !== noteId) {
                if (contentTimeoutRef.current) {
                    clearTimeout(contentTimeoutRef.current);
                    contentTimeoutRef.current = null;
                }
                flushRef.current?.();
            }
            setBottomSheetActiveNoteId(noteId);
        },
        [effectiveActiveId, setBottomSheetActiveNoteId]
    );

    const handleCloseTab = useCallback(
        (e: React.MouseEvent, noteId: string) => {
            e.stopPropagation();
            // Flush if closing active tab
            if (effectiveActiveId === noteId) {
                if (contentTimeoutRef.current) {
                    clearTimeout(contentTimeoutRef.current);
                    contentTimeoutRef.current = null;
                }
                flushRef.current?.();
            }
            // Auto-delete empty notes created from bottom sheet (same as PiP)
            const noteAfterFlush = useNotesStore.getState().notes[noteId];
            if (
                noteAfterFlush &&
                noteAfterFlush.createdFromPip === true &&
                noteAfterFlush.hasEverHadContent !== true &&
                (noteAfterFlush.content?.trim() ?? "") === ""
            ) {
                removeNote(noteId);
            }
            removeNoteFromBottomSheet(noteId);
        },
        [effectiveActiveId, removeNote, removeNoteFromBottomSheet]
    );

    const handleContentChange = useCallback(
        (newContent: string) => {
            if (!effectiveActiveId) return;
            updateNote(effectiveActiveId, { content: newContent });
            if (contentTimeoutRef.current)
                clearTimeout(contentTimeoutRef.current);
            contentTimeoutRef.current = setTimeout(() => {
                contentTimeoutRef.current = null;
                triggerSyncAfterUserAction(db);
            }, SAVE_DEBOUNCE_MS);
        },
        [effectiveActiveId, updateNote]
    );

    const handleFlush = useCallback(
        (markdown: string) => {
            if (!effectiveActiveId) return;
            updateNote(effectiveActiveId, { content: markdown });
        },
        [effectiveActiveId, updateNote]
    );

    const handleMinimize = useCallback(() => {
        // Flush before closing
        if (contentTimeoutRef.current) {
            clearTimeout(contentTimeoutRef.current);
            contentTimeoutRef.current = null;
        }
        flushRef.current?.();
        setBottomSheetOpen(false);
    }, [setBottomSheetOpen]);

    const handleCloseAll = useCallback(() => {
        if (contentTimeoutRef.current) {
            clearTimeout(contentTimeoutRef.current);
            contentTimeoutRef.current = null;
        }
        flushRef.current?.();
        // Auto-delete empty notes
        noteIds.forEach((id) => {
            const n = useNotesStore.getState().notes[id];
            if (
                n &&
                n.createdFromPip === true &&
                n.hasEverHadContent !== true &&
                (n.content?.trim() ?? "") === ""
            ) {
                removeNote(id);
            }
        });
        setBottomSheetNoteIds([]);
        setBottomSheetActiveNoteId(null);
        setBottomSheetOpen(false);
    }, [
        noteIds,
        removeNote,
        setBottomSheetNoteIds,
        setBottomSheetActiveNoteId,
        setBottomSheetOpen,
    ]);

    // Context menu actions
    const handleTabContextMenu = useCallback(
        (e: React.MouseEvent, noteId: string) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, noteId });
        },
        []
    );

    const togglePin = useCallback((noteId: string) => {
        setContextMenu(null);
        setPinnedTabIds((prev) => {
            const next = new Set(prev);
            if (next.has(noteId)) next.delete(noteId);
            else next.add(noteId);
            return next;
        });
    }, []);

    const handleRenameOpen = useCallback(
        (noteId: string) => {
            const n = notes[noteId];
            setRenameState({
                noteId,
                value: n?.displayName || n?.title || "Untitled",
            });
            setContextMenu(null);
        },
        [notes]
    );

    const handleRenameSubmit = useCallback(() => {
        if (!renameState) return;
        const { noteId, value } = renameState;
        const trimmed = value.trim();
        if (trimmed) updateNote(noteId, { displayName: trimmed });
        setRenameState(null);
        triggerSyncAfterUserAction(db);
    }, [renameState, updateNote]);

    const handleSetColor = useCallback(
        (noteId: string, color: string) => {
            setContextMenu(null);
            updateNote(noteId, { color: color || undefined });
            triggerSyncAfterUserAction(db);
        },
        [updateNote]
    );

    const handleCloseOthers = useCallback(
        (noteId: string) => {
            setContextMenu(null);
            setBottomSheetNoteIds([noteId]);
            setBottomSheetActiveNoteId(noteId);
        },
        [setBottomSheetNoteIds, setBottomSheetActiveNoteId]
    );

    if (!bottomSheetOpen) return null;

    return (
        <div
            className="mobile-bottom-sheet"
            role="dialog"
            aria-label="Note editor"
        >
            {/* Drag handle */}
            <div className="mobile-bs-handle-row" aria-hidden>
                <div className="mobile-bs-drag-handle" />
            </div>
            {/* Header bar */}
            <div className="mobile-bs-header">
                <span className="mobile-bs-header-title">Notes</span>
                <button
                    type="button"
                    className="mobile-bs-header-btn"
                    onClick={handleMinimize}
                    aria-label="Close"
                    title="Close"
                >
                    <X size={18} />
                </button>
            </div>

            {/* Tab bar – only shown when there are tabs */}
            {noteIds.length > 0 && (
                <div className="mobile-bs-tabs">
                    <div className="mobile-bs-tabs-scroll">
                        {sortedNoteIds.map((id) => {
                            const n = notes[id];
                            const title =
                                n?.displayName ?? n?.title ?? "Untitled";
                            const tabColor = n?.color;
                            const isActive = id === effectiveActiveId;
                            const isPinned = pinnedTabIds.has(id);
                            return (
                                <div
                                    key={id}
                                    className={`mobile-bs-tab${
                                        isActive ? " active" : ""
                                    }${isPinned ? " pinned" : ""}`}
                                    onClick={() => handleSwitchTab(id)}
                                    onDoubleClick={() => handleRenameOpen(id)}
                                    onContextMenu={(e) =>
                                        handleTabContextMenu(e, id)
                                    }
                                    role="tab"
                                    aria-selected={isActive}
                                    title={title}
                                >
                                    {tabColor && (
                                        <span
                                            className="mobile-bs-tab-color"
                                            style={{
                                                backgroundColor: tabColor,
                                            }}
                                            aria-hidden
                                        />
                                    )}
                                    {isPinned && (
                                        <Pin
                                            size={12}
                                            className="mobile-bs-tab-pin-icon"
                                        />
                                    )}
                                    <span className="mobile-bs-tab-label">
                                        {title}
                                    </span>
                                    <button
                                        type="button"
                                        className="mobile-bs-tab-close"
                                        onClick={(e) => handleCloseTab(e, id)}
                                        aria-label="Close tab"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            );
                        })}
                        <button
                            type="button"
                            className="mobile-bs-tab-add"
                            onClick={handleAddNote}
                            aria-label="New note"
                            title="New note"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Editor area */}
            <div className="mobile-bs-content">
                {effectiveActiveId && activeNote ? (
                    <NoteEditor
                        key={effectiveActiveId}
                        editorKey={effectiveActiveId}
                        initialContent={activeNote.content ?? ""}
                        onChange={handleContentChange}
                        onFlush={handleFlush}
                        placeholder="Type / for commands…"
                        registerFlushRef={flushRef}
                    />
                ) : (
                    <div className="mobile-bs-empty">
                        <p>No notes open</p>
                        <button
                            type="button"
                            className="mobile-bs-empty-btn"
                            onClick={handleAddNote}
                        >
                            <Plus size={14} />
                            Add Note
                        </button>
                    </div>
                )}
            </div>

            {/* Context menu */}
            {contextMenu && (
                <div
                    className="pip-context-menu show"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
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
                        onClick={() => togglePin(contextMenu.noteId)}
                    >
                        {pinnedTabIds.has(contextMenu.noteId) ? "Unpin" : "Pin"}
                    </button>
                    <button
                        type="button"
                        className="pip-context-menu-item"
                        onClick={() => handleRenameOpen(contextMenu.noteId)}
                    >
                        Rename
                    </button>
                    <div className="pip-context-menu-item pip-context-menu-item-has-submenu">
                        <span className="pip-context-menu-item-label">
                            Change color
                        </span>
                        <span className="pip-context-menu-item-chevron">›</span>
                        <div className="pip-context-menu-submenu show">
                            {COLOR_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value || "default"}
                                    type="button"
                                    className="pip-context-menu-submenu-item"
                                    onClick={() => {
                                        handleSetColor(
                                            contextMenu.noteId,
                                            opt.value
                                        );
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
                                                ? { backgroundColor: opt.value }
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
                        className="pip-context-menu-item"
                        onClick={(e) => handleCloseTab(e, contextMenu.noteId)}
                    >
                        Close
                    </button>
                    <button
                        type="button"
                        className="pip-context-menu-item"
                        onClick={() => handleCloseOthers(contextMenu.noteId)}
                    >
                        Close others
                    </button>
                    <button
                        type="button"
                        className="pip-context-menu-item"
                        onClick={handleCloseAll}
                    >
                        Close all
                    </button>
                </div>
            )}

            {/* Rename modal */}
            {renameState && (
                <div
                    className="pip-modal-overlay show"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setRenameState(null)}
                >
                    <div
                        className="pip-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="pip-modal-header">
                            <h3 className="pip-modal-title">Rename note</h3>
                            <input
                                type="text"
                                className="pip-modal-input"
                                placeholder="Note name"
                                value={renameState.value}
                                onChange={(e) =>
                                    setRenameState((s) =>
                                        s
                                            ? { ...s, value: e.target.value }
                                            : null
                                    )
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Escape")
                                        setRenameState(null);
                                    if (e.key === "Enter") handleRenameSubmit();
                                }}
                                autoFocus
                            />
                        </div>
                        <div className="pip-modal-actions">
                            <button
                                type="button"
                                className="pip-modal-btn pip-modal-btn-secondary"
                                onClick={() => setRenameState(null)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="pip-modal-btn pip-modal-btn-primary"
                                onClick={handleRenameSubmit}
                            >
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
