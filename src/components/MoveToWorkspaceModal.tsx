import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useUIStore, useWorkspaceStore, useNotesStore } from "../store";
import {
    getWorkspacesInDisplayOrder,
    DEFAULT_WORKSPACE_ID,
} from "../store/useWorkspaceStore";
import type { Folder as FolderType } from "../store/types";
import { getFlatFoldersWithPath } from "../utils/folderUtils";

/** Move to workspace picker modal. Match notic showWorkspacePickerModal. */
export function MoveToWorkspaceModal() {
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
            (f: FolderType) =>
                String(f.workspaceId ?? DEFAULT_WORKSPACE_ID) === targetId
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
