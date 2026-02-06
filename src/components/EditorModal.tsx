import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
    useNotesStore,
    useUIStore,
    useWorkspaceStore,
    useSubscriptionStore,
} from "../store";
import { NoteEditor } from "./NoteEditor";
import { Plus, X, Pin, GripHorizontal } from "lucide-react";
import { FREE_PIP_TAB_LIMIT } from "../constants";
import { triggerSyncAfterUserAction } from "../sync";
import { openBillingPage } from "../api/backend";
import { db } from "../db";

const SAVE_DEBOUNCE_MS = 700;
const COLOR_OPTIONS: Array<{ label: string; value: string }> = [
    { label: "Default", value: "" },
    { label: "Blue", value: "#3b82f6" },
    { label: "Green", value: "#22c55e" },
    { label: "Purple", value: "#a855f7" },
    { label: "Orange", value: "#f97316" },
];

// --- Position / size persistence ---
const MODAL_RECT_KEY = "notic_editorModalRect";
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 440;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 280;

interface ModalRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

function loadModalRect(): ModalRect {
    try {
        const s = localStorage.getItem(MODAL_RECT_KEY);
        if (s) {
            const p = JSON.parse(s) as Partial<ModalRect>;
            if (
                typeof p.x === "number" &&
                typeof p.y === "number" &&
                typeof p.w === "number" &&
                typeof p.h === "number"
            )
                return { x: p.x, y: p.y, w: p.w, h: p.h };
        }
    } catch (_) {}
    // center on screen
    const x = Math.max(0, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2));
    const y = Math.max(
        0,
        Math.round((window.innerHeight - DEFAULT_HEIGHT) / 2)
    );
    return { x, y, w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT };
}

function saveModalRect(rect: ModalRect): void {
    try {
        localStorage.setItem(MODAL_RECT_KEY, JSON.stringify(rect));
    } catch (_) {}
}

function clampRect(rect: ModalRect): ModalRect {
    const w = Math.max(MIN_WIDTH, Math.min(rect.w, window.innerWidth));
    const h = Math.max(MIN_HEIGHT, Math.min(rect.h, window.innerHeight));
    const x = Math.max(0, Math.min(rect.x, window.innerWidth - 80));
    const y = Math.max(0, Math.min(rect.y, window.innerHeight - 40));
    return { x, y, w, h };
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null;

/**
 * Draggable, resizable editor modal — fallback for browsers without Document PiP.
 * Shares PiP store state (openInPipNoteIds / openInPipActiveNoteId).
 */
export function EditorModal() {
    const editorModalOpen = useUIStore((s) => s.editorModalOpen);
    const setEditorModalOpen = useUIStore((s) => s.setEditorModalOpen);
    const noteIds = useUIStore((s) => s.openInPipNoteIds);
    const activeNoteId = useUIStore((s) => s.openInPipActiveNoteId);
    const setOpenInPipNoteIds = useUIStore((s) => s.setOpenInPipNoteIds);
    const setOpenInPipActiveNoteId = useUIStore(
        (s) => s.setOpenInPipActiveNoteId
    );
    const addNoteToPip = useUIStore((s) => s.addNoteToPip);
    const removeNoteFromPip = useUIStore((s) => s.removeNoteFromPip);
    const setToastMessage = useUIStore((s) => s.setToastMessage);

    const notes = useNotesStore((s) => s.notes);
    const updateNote = useNotesStore((s) => s.updateNote);
    const addNote = useNotesStore((s) => s.addNote);
    const removeNote = useNotesStore((s) => s.removeNote);
    const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
    const isSubscribed = useSubscriptionStore((s) => s.isSubscribed);

    const [showTabLimitModal, setShowTabLimitModal] = useState(false);

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
    const [hoveredSubmenu, setHoveredSubmenu] = useState<"color" | null>(null);
    const submenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );

    // --- Position & size ---
    const [rect, setRect] = useState<ModalRect>(loadModalRect);
    const rectRef = useRef(rect);
    useEffect(() => {
        rectRef.current = rect;
    }, [rect]);

    // Drag state
    const isDraggingRef = useRef(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });

    // Resize state
    const isResizingRef = useRef(false);
    const resizeEdgeRef = useRef<ResizeEdge>(null);
    const resizeStartRef = useRef({ mx: 0, my: 0, x: 0, y: 0, w: 0, h: 0 });

    const modalRef = useRef<HTMLDivElement>(null);

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
        setHoveredSubmenu(null);
        if (submenuCloseTimerRef.current) {
            clearTimeout(submenuCloseTimerRef.current);
            submenuCloseTimerRef.current = null;
        }
        const close = () => setContextMenu(null);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [contextMenu]);

    // --- Drag handlers (title bar) ---
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        // Don't drag from buttons
        if ((e.target as HTMLElement).closest("button")) return;
        isDraggingRef.current = true;
        dragOffsetRef.current = {
            x: e.clientX - rectRef.current.x,
            y: e.clientY - rectRef.current.y,
        };
        e.preventDefault();
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingRef.current) {
                const nx = e.clientX - dragOffsetRef.current.x;
                const ny = e.clientY - dragOffsetRef.current.y;
                const clamped = clampRect({
                    ...rectRef.current,
                    x: nx,
                    y: ny,
                });
                setRect(clamped);
            }
            if (isResizingRef.current) {
                const edge = resizeEdgeRef.current;
                const s = resizeStartRef.current;
                const dx = e.clientX - s.mx;
                const dy = e.clientY - s.my;
                let { x, y, w, h } = { x: s.x, y: s.y, w: s.w, h: s.h };
                if (edge?.includes("e")) w = s.w + dx;
                if (edge?.includes("w")) {
                    w = s.w - dx;
                    x = s.x + dx;
                }
                if (edge?.includes("s")) h = s.h + dy;
                if (edge?.includes("n")) {
                    h = s.h - dy;
                    y = s.y + dy;
                }
                w = Math.max(MIN_WIDTH, w);
                h = Math.max(MIN_HEIGHT, h);
                setRect(clampRect({ x, y, w, h }));
            }
        };
        const handleMouseUp = () => {
            if (isDraggingRef.current || isResizingRef.current) {
                isDraggingRef.current = false;
                isResizingRef.current = false;
                resizeEdgeRef.current = null;
                saveModalRect(rectRef.current);
            }
        };
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    // --- Resize handlers (edge grips) ---
    const handleResizeStart = useCallback(
        (e: React.MouseEvent, edge: ResizeEdge) => {
            isResizingRef.current = true;
            resizeEdgeRef.current = edge;
            resizeStartRef.current = {
                mx: e.clientX,
                my: e.clientY,
                ...rectRef.current,
            };
            e.preventDefault();
            e.stopPropagation();
        },
        []
    );

    // --- Editor handlers (mirror MobileBottomSheet / PipView) ---
    const handleAddNote = useCallback(() => {
        const tabLimit = isSubscribed === true ? Infinity : FREE_PIP_TAB_LIMIT;
        if (noteIds.length >= tabLimit) {
            setShowTabLimitModal(true);
            return;
        }
        const newId = addNote({
            workspaceId: currentWorkspaceId,
            createdFromPip: true,
        });
        addNoteToPip(newId, true);
        triggerSyncAfterUserAction(db);
    }, [addNote, currentWorkspaceId, noteIds, addNoteToPip, isSubscribed]);

    const handleSwitchTab = useCallback(
        (noteId: string) => {
            if (effectiveActiveId != null && effectiveActiveId !== noteId) {
                if (contentTimeoutRef.current) {
                    clearTimeout(contentTimeoutRef.current);
                    contentTimeoutRef.current = null;
                }
                flushRef.current?.();
            }
            setOpenInPipActiveNoteId(noteId);
        },
        [effectiveActiveId, setOpenInPipActiveNoteId]
    );

    const handleCloseTab = useCallback(
        (e: React.MouseEvent, noteId: string) => {
            e.stopPropagation();
            if (effectiveActiveId === noteId) {
                if (contentTimeoutRef.current) {
                    clearTimeout(contentTimeoutRef.current);
                    contentTimeoutRef.current = null;
                }
                flushRef.current?.();
            }
            // Auto-delete empty notes
            const noteAfterFlush = useNotesStore.getState().notes[noteId];
            if (
                noteAfterFlush &&
                noteAfterFlush.createdFromPip === true &&
                noteAfterFlush.hasEverHadContent !== true &&
                (noteAfterFlush.content?.trim() ?? "") === ""
            ) {
                removeNote(noteId);
            }
            removeNoteFromPip(noteId);
        },
        [effectiveActiveId, removeNote, removeNoteFromPip]
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

    const handleClose = useCallback(() => {
        if (contentTimeoutRef.current) {
            clearTimeout(contentTimeoutRef.current);
            contentTimeoutRef.current = null;
        }
        flushRef.current?.();
        // Auto-delete empty notes created from editor
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
        setOpenInPipNoteIds([]);
        setOpenInPipActiveNoteId(null);
        setEditorModalOpen(false);
    }, [noteIds, removeNote, setOpenInPipNoteIds, setOpenInPipActiveNoteId, setEditorModalOpen]);

    const handleCloseAll = useCallback(() => {
        setContextMenu(null);
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
        setOpenInPipNoteIds([]);
        setOpenInPipActiveNoteId(null);
        setEditorModalOpen(false);
    }, [
        noteIds,
        removeNote,
        setOpenInPipNoteIds,
        setOpenInPipActiveNoteId,
        setEditorModalOpen,
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
            setOpenInPipNoteIds([noteId]);
            setOpenInPipActiveNoteId(noteId);
        },
        [setOpenInPipNoteIds, setOpenInPipActiveNoteId]
    );

    const handleCloseAfter = useCallback(
        (noteId: string) => {
            setContextMenu(null);
            const idx = noteIds.indexOf(noteId);
            const next = noteIds.slice(0, idx + 1);
            if (effectiveActiveId && !next.includes(effectiveActiveId)) {
                if (contentTimeoutRef.current) {
                    clearTimeout(contentTimeoutRef.current);
                    contentTimeoutRef.current = null;
                }
                flushRef.current?.();
            }
            setOpenInPipNoteIds(next);
            if (effectiveActiveId && !next.includes(effectiveActiveId)) {
                setOpenInPipActiveNoteId(next[0] ?? null);
            }
        },
        [
            noteIds,
            effectiveActiveId,
            setOpenInPipNoteIds,
            setOpenInPipActiveNoteId,
        ]
    );

    if (!editorModalOpen) return null;

    const clamped = clampRect(rect);

    return (
        <div
            ref={modalRef}
            className="editor-modal"
            role="dialog"
            aria-label="Note editor"
            style={{
                left: clamped.x,
                top: clamped.y,
                width: clamped.w,
                height: clamped.h,
            }}
        >
            {/* Resize grips */}
            <div
                className="editor-modal-resize editor-modal-resize-n"
                onMouseDown={(e) => handleResizeStart(e, "n")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-s"
                onMouseDown={(e) => handleResizeStart(e, "s")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-e"
                onMouseDown={(e) => handleResizeStart(e, "e")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-w"
                onMouseDown={(e) => handleResizeStart(e, "w")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-ne"
                onMouseDown={(e) => handleResizeStart(e, "ne")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-nw"
                onMouseDown={(e) => handleResizeStart(e, "nw")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-se"
                onMouseDown={(e) => handleResizeStart(e, "se")}
            />
            <div
                className="editor-modal-resize editor-modal-resize-sw"
                onMouseDown={(e) => handleResizeStart(e, "sw")}
            />

            {/* Title bar — draggable */}
            <div
                className="editor-modal-titlebar"
                onMouseDown={handleDragStart}
            >
                <GripHorizontal size={14} className="editor-modal-grip" />
                <span className="editor-modal-titlebar-text">Notes</span>
                <button
                    type="button"
                    className="editor-modal-close-btn"
                    onClick={handleClose}
                    title="Close"
                    aria-label="Close editor"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Tab bar */}
            {noteIds.length > 0 && (
                <div className="editor-modal-tabs">
                    <div className="editor-modal-tabs-scroll">
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
                                    className={`pip-tab-item${
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
                                            className="pip-tab-color"
                                            style={{
                                                backgroundColor: tabColor,
                                            }}
                                            aria-hidden
                                        />
                                    )}
                                    {isPinned && (
                                        <span
                                            className="pip-tab-pin"
                                            title="Pinned"
                                        >
                                            <Pin size={12} />
                                        </span>
                                    )}
                                    <span className="pip-tab-label">
                                        {title}
                                    </span>
                                    <button
                                        type="button"
                                        className="pip-tab-close"
                                        title="Close"
                                        aria-label="Close tab"
                                        onClick={(e) => handleCloseTab(e, id)}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            );
                        })}
                        <button
                            type="button"
                            className="pip-tab-new-btn"
                            title="New note"
                            aria-label="New note"
                            onClick={handleAddNote}
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Editor area */}
            <div className="editor-modal-content">
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
                    <div className="editor-modal-empty">
                        <p>No notes open</p>
                        <button
                            type="button"
                            className="pip-empty-state-button"
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
                    style={{
                        left: contextMenu.x - clamped.x,
                        top: contextMenu.y - clamped.y,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    ref={(el) => {
                        if (!el) return;
                        const r = el.getBoundingClientRect();
                        if (r.right > window.innerWidth)
                            el.style.left = `${
                                window.innerWidth - r.width - 10 - clamped.x
                            }px`;
                        if (r.bottom > window.innerHeight)
                            el.style.top = `${
                                window.innerHeight - r.height - 10 - clamped.y
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
                    <div
                        className="pip-context-menu-item pip-context-menu-item-has-submenu"
                        onMouseEnter={() => {
                            if (submenuCloseTimerRef.current) {
                                clearTimeout(submenuCloseTimerRef.current);
                                submenuCloseTimerRef.current = null;
                            }
                            setHoveredSubmenu("color");
                        }}
                        onMouseLeave={() => {
                            submenuCloseTimerRef.current = setTimeout(() => {
                                submenuCloseTimerRef.current = null;
                                setHoveredSubmenu(null);
                            }, 150);
                        }}
                    >
                        <span className="pip-context-menu-item-label">
                            Change color
                        </span>
                        <span className="pip-context-menu-item-chevron">›</span>
                        <div
                            className={`pip-context-menu-submenu ${
                                hoveredSubmenu === "color" ? "show" : ""
                            }`}
                        >
                            {COLOR_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value || "default"}
                                    type="button"
                                    className="pip-context-menu-submenu-item"
                                    onClick={() => {
                                        handleSetColor(
                                            contextMenu!.noteId,
                                            opt.value
                                        );
                                        setContextMenu(null);
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
                        onClick={() => handleCloseAfter(contextMenu.noteId)}
                    >
                        Close after
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

            {/* Tab limit modal */}
            {showTabLimitModal && (
                <div
                    className="pip-modal-overlay show"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setShowTabLimitModal(false)}
                >
                    <div
                        className="pip-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="pip-modal-header">
                            <h3 className="pip-modal-title">
                                {FREE_PIP_TAB_LIMIT} tabs on free plan
                            </h3>
                            <p className="pip-modal-message">
                                Upgrade to Pro to open more notes at once.
                            </p>
                        </div>
                        <div className="pip-modal-actions">
                            <button
                                type="button"
                                className="pip-modal-btn pip-modal-btn-primary"
                                onClick={() =>
                                    void openBillingPage(db, setToastMessage)
                                }
                            >
                                Upgrade
                            </button>
                            <button
                                type="button"
                                className="pip-modal-btn pip-modal-btn-secondary"
                                onClick={() => setShowTabLimitModal(false)}
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
