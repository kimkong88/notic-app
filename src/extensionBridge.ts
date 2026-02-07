/**
 * Extension Bridge — handles messages from the Notic Chrome extension content script.
 *
 * The extension sends messages via `window.postMessage` through its content script.
 * This module listens for those messages and dispatches actions to the Zustand stores.
 *
 * Message types:
 *   notic-clip          — Create a new note from clipped content (context menu)
 *   notic-migrate       — Receive bulk notes/folders/workspaces from old extension storage
 *   notic-extension-ready — Content script is loaded and ready
 */

import { useNotesStore } from "./store/useNotesStore";
import { useWorkspaceStore } from "./store/useWorkspaceStore";
import { useUIStore } from "./store/useUIStore";
import { extractTitle } from "./utils/noteUtils";
import type { NoteData, Folder, WorkspaceInfo } from "./store/types";

// ── Extension ID (set via env or hard-coded after publishing) ──
export const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID as
    | string
    | undefined;

// ── Message types from extension content script ──

interface ClipMessage {
    type: "notic-clip";
    text: string;
    sourceUrl?: string;
    pageTitle?: string;
}

interface MigrateMessage {
    type: "notic-migrate";
    notes: MigrateNote[];
    folders: MigrateFolder[];
    workspaces: MigrateWorkspace[];
}

interface ExtensionReadyMessage {
    type: "notic-extension-ready";
}

/** Shape of notes coming from extension chrome.storage migration */
interface MigrateNote {
    sessionId: string;
    content: string;
    lastModified: number;
    createdAt: number;
    title?: string;
    wordCount?: number;
    folderId?: string;
    displayName?: string;
    workspaceId?: string;
    hasEverHadContent?: boolean;
    deletedAt?: number;
    color?: string;
    isBookmarked?: boolean;
    shareCode?: string;
}

interface MigrateFolder {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: number;
    displayName?: string;
    workspaceId?: string;
    color?: string;
}

interface MigrateWorkspace {
    id: string;
    name: string;
    isDefault: boolean;
    icon?: string;
    color?: string;
    lastModified?: number;
}

type ExtensionMessage = ClipMessage | MigrateMessage | ExtensionReadyMessage;

// ── Handlers ──

function handleClip(msg: ClipMessage): void {
    const { text, pageTitle } = msg;

    // Content is already fully formatted by the extension background script
    // (includes source links, markdown formatting, etc.)
    const content = text;

    // Get current workspace
    const workspaces = useWorkspaceStore.getState().workspaces;
    const currentWsId = useWorkspaceStore.getState().currentWorkspaceId;
    const firstWsId = Object.keys(workspaces)[0];
    const wsId = currentWsId ?? firstWsId ?? "workspace_1";

    // Create note via store
    const sessionId = useNotesStore.getState().addNote({ workspaceId: wsId });

    // Populate content
    const title = pageTitle || extractTitle(content) || "Clipped Note";
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

    useNotesStore.getState().updateNote(sessionId, {
        content,
        title,
        wordCount,
        hasEverHadContent: true,
    });

    // Select the new note so user sees it
    useNotesStore.getState().setSelectedNoteId(sessionId);

    // Show toast
    useUIStore.getState().setToastMessage("Saved to Notic");
}

function handleMigrate(msg: MigrateMessage): void {
    const {
        notes: incomingNotes,
        folders: incomingFolders,
        workspaces: incomingWorkspaces,
    } = msg;

    const notesStore = useNotesStore.getState();
    const wsStore = useWorkspaceStore.getState();
    const existingNotes = notesStore.notes;
    const existingFolders = notesStore.folders;
    const existingWorkspaces = wsStore.workspaces;

    let importedCount = 0;

    // Merge workspaces (skip duplicates by id)
    const newWorkspaces: Record<string, WorkspaceInfo> = {};
    for (const ws of incomingWorkspaces) {
        if (!existingWorkspaces[ws.id]) {
            newWorkspaces[ws.id] = {
                id: ws.id,
                name: ws.name,
                isDefault: ws.isDefault,
                icon: ws.icon,
                color: ws.color,
                lastModified: ws.lastModified,
            };
        }
    }
    if (Object.keys(newWorkspaces).length > 0) {
        wsStore.setWorkspaces({ ...existingWorkspaces, ...newWorkspaces });
    }

    // Merge folders (skip duplicates by id)
    const newFolders: Record<string, Folder> = {};
    for (const folder of incomingFolders) {
        if (!existingFolders[folder.id]) {
            newFolders[folder.id] = {
                id: folder.id,
                name: folder.name,
                parentId: folder.parentId,
                createdAt: folder.createdAt,
                displayName: folder.displayName,
                workspaceId: folder.workspaceId,
                color: folder.color,
            };
        }
    }
    if (Object.keys(newFolders).length > 0) {
        notesStore.setFolders({ ...existingFolders, ...newFolders });
    }

    // Merge notes (skip duplicates by sessionId)
    const newNotes: Record<string, NoteData> = {};
    for (const note of incomingNotes) {
        if (!existingNotes[note.sessionId]) {
            newNotes[note.sessionId] = {
                sessionId: note.sessionId,
                content: note.content,
                lastModified: note.lastModified,
                createdAt: note.createdAt,
                title: note.title || extractTitle(note.content) || "Untitled",
                wordCount: note.wordCount ?? 0,
                folderId: note.folderId,
                displayName: note.displayName,
                workspaceId: note.workspaceId,
                hasEverHadContent: note.hasEverHadContent,
                deletedAt: note.deletedAt,
                color: note.color,
                isBookmarked: note.isBookmarked,
                shareCode: note.shareCode,
            };
            importedCount++;
        }
    }
    if (Object.keys(newNotes).length > 0) {
        notesStore.setNotes({ ...existingNotes, ...newNotes });
    }

    // Confirm migration to extension
    window.postMessage({ type: "notic-migrate-done", importedCount }, "*");

    if (importedCount > 0) {
        useUIStore
            .getState()
            .setToastMessage(
                `Migrated ${importedCount} note${
                    importedCount === 1 ? "" : "s"
                } from extension`
            );
    }
}

// ── Listener ──

function onExtensionMessage(event: MessageEvent): void {
    // Only accept messages from our own window (content script uses window.postMessage)
    if (event.source !== window) return;

    const data = event.data as ExtensionMessage | undefined;
    if (!data || typeof data.type !== "string") return;

    switch (data.type) {
        case "notic-clip":
            handleClip(data);
            break;
        case "notic-migrate":
            handleMigrate(data);
            break;
        case "notic-extension-ready":
            // Extension content script is ready — no action needed for now
            break;
    }
}

/**
 * Start listening for messages from the Notic Chrome extension.
 * Call once during app initialization (e.g., in main.tsx).
 */
export function initExtensionBridge(): void {
    window.addEventListener("message", onExtensionMessage);
}

/**
 * Handle URL parameters from the extension (or any external source).
 * Supports:
 *   ?action=new-note  — create and select a new note
 *   ?action=pip       — open the editor modal (PiP requires user gesture; modal is the fallback)
 *   ?search=...       — set search query
 *
 * Cleans URL params after handling via history.replaceState.
 */
export function handleUrlParams(): void {
    const params = new URLSearchParams(window.location.search);
    let handled = false;

    const action = params.get("action");
    const search = params.get("search");

    if (action === "new-note") {
        // Create a new note in the current workspace
        const wsId =
            useWorkspaceStore.getState().currentWorkspaceId ??
            Object.keys(useWorkspaceStore.getState().workspaces)[0] ??
            "workspace_1";
        const sessionId = useNotesStore
            .getState()
            .addNote({ workspaceId: wsId });
        useNotesStore.getState().setSelectedNoteId(sessionId);
        handled = true;
    }

    if (action === "pip") {
        // PiP requires user gesture — open editor modal as fallback
        useUIStore.getState().setEditorModalOpen(true);
        handled = true;
    }

    if (search) {
        useNotesStore.getState().setSearchQuery(search);
        handled = true;
    }

    // Clean URL params
    if (handled) {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState(null, "", cleanUrl);
    }
}

/**
 * Check if the Notic Chrome extension is installed.
 * Uses externally_connectable to send a ping to the extension.
 * Returns true if extension responds, false otherwise.
 */
export async function isExtensionInstalled(): Promise<boolean> {
    if (!EXTENSION_ID) return false;

    // chrome.runtime.sendMessage is only available on pages listed in externally_connectable
    type SendMessageFn = (
        id: string,
        msg: unknown,
        cb: (response: unknown) => void
    ) => void;
    const chromeRuntime = (
        globalThis as unknown as {
            chrome?: { runtime?: { sendMessage?: SendMessageFn } };
        }
    ).chrome?.runtime;
    const sendMessage = chromeRuntime?.sendMessage;
    if (!sendMessage) return false;

    return new Promise<boolean>((resolve) => {
        try {
            sendMessage(EXTENSION_ID!, { type: "ping" }, (response) => {
                // Access lastError to suppress "Unchecked runtime.lastError" console warning
                const _lastError = (globalThis as Record<string, unknown>)
                    .chrome as
                    | { runtime?: { lastError?: unknown } }
                    | undefined;
                void _lastError?.runtime?.lastError;
                resolve(!!response);
            });
        } catch {
            resolve(false);
        }
        // Timeout — extension didn't respond
        setTimeout(() => resolve(false), 1000);
    });
}
