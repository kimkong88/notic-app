import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useUIStore, useWorkspaceStore, useNotesStore } from "../store";
import { DEFAULT_WORKSPACE_ID } from "../store/useWorkspaceStore";
import { ROOT_SENTINEL } from "../store/types";
import type { Folder as FolderType } from "../store/types";
import {
    canAcceptFolderDrop,
    getFlatFoldersWithPath,
} from "../utils/folderUtils";

/** Move to folder picker modal. Match notic showFolderPickerModal. */
export function MoveToFolderModal() {
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
                (f: FolderType) =>
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
