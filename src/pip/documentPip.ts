/**
 * Chrome Document Picture-in-Picture API.
 * Opens a real PiP window and injects note content (same approach as notic extension).
 *
 * Difference from notic extension: extension loads pip.js IN the PiP window (editor runs in PiP
 * document, so drop events fire there). We load the app in an IFRAME; drop events fire in the PiP
 * document (parent of iframe), so we inject a script that handles dragover/drop and posts file
 * data to the iframe; the iframe uploads and inserts.
 */

declare global {
    interface Window {
        documentPictureInPicture?: {
            requestWindow(options: {
                width: number;
                height: number;
            }): Promise<Window>;
        };
    }
}

let pipWindowRef: Window | null = null;
let closeCheckInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Environments where Document PiP is known to break (e.g. blank page, disconnect).
 * We treat these as unsupported so we never call requestWindow() and always show the modal.
 */
function isPipUnsupportedEnvironment(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /cursor/i.test(ua) || /cursorbrowser/i.test(ua);
}

/**
 * True only if Document PiP API exists, requestWindow is callable, and we're not in a
 * known-bad environment (e.g. Cursor browser) where calling it would blank the page.
 */
export function isDocumentPipSupported(): boolean {
    if (typeof window === "undefined") return false;
    if (isPipUnsupportedEnvironment()) return false;
    const api = window.documentPictureInPicture;
    return Boolean(api && typeof api.requestWindow === "function");
}

export function getPipWindow(): Window | null {
    if (pipWindowRef != null && pipWindowRef.closed) {
        pipWindowRef = null;
    }
    return pipWindowRef;
}

export interface PipNoteData {
    title: string;
    content: string;
}

/**
 * Open tutorial PiP - separate from real notes.
 * Shows static tutorial content, no editor, no database.
 * Must be called from a user gesture (e.g. click).
 */
export async function openTutorialPip(options: {
    isDarkMode: boolean;
    onClose: () => void;
    onError?: () => void;
}): Promise<void> {
    if (!isDocumentPipSupported()) {
        options.onError?.();
        return;
    }

    const { isDarkMode, onClose, onError } = options;

    try {
        const requestedWindow =
            await window.documentPictureInPicture!.requestWindow({
                width: 420,
                height: 560,
            });

        pipWindowRef = requestedWindow;

        try {
            const { trackEvent } = await import("../analytics");
            trackEvent("tutorial_pip_opened");
        } catch {
            // ignore
        }

        requestedWindow.document.documentElement.innerHTML =
            "<head></head><body></body>";
        requestedWindow.document.title = "Notic – Tutorial";

        const style = requestedWindow.document.createElement("style");
        style.textContent = getPipIframeStyles();
        requestedWindow.document.head.appendChild(style);

        const iframe = requestedWindow.document.createElement("iframe");
        iframe.id = "notic-pip-iframe";
        iframe.setAttribute("title", "Notic tutorial");
        requestedWindow.document.body.appendChild(iframe);

        const script = requestedWindow.document.createElement("script");
        script.textContent = getPipIframeCloseScript();
        requestedWindow.document.body.appendChild(script);

        // Point to /pip-tutorial route
        const origin =
            typeof window !== "undefined" ? window.location.origin : "";
        const darkStr = isDarkMode ? "1" : "0";
        iframe.src = `${origin}/pip-tutorial?dark=${darkStr}`;

        if (closeCheckInterval) clearInterval(closeCheckInterval);
        closeCheckInterval = setInterval(() => {
            if (requestedWindow.closed) {
                if (closeCheckInterval) clearInterval(closeCheckInterval);
                closeCheckInterval = null;
                pipWindowRef = null;
                onClose();
            }
        }, 300);
    } catch (error) {
        onError?.();
    }
}

/**
 * Open Chrome Document PiP window with an iframe loading our app at /pip.
 * Must be called from a user gesture (e.g. click).
 * Pass noteIds (array) and activeId for multi-tab PiP (same pattern as notic).
 */
export async function openPipWithNote(
    _note: PipNoteData | null,
    options: {
        isDarkMode: boolean;
        onClose: () => void;
        noteIds: string[];
        activeId: string | null;
        /** Called when PiP is unsupported or requestWindow fails; use to show "PiP not supported" modal */
        onError?: () => void;
    }
): Promise<void> {
    if (!isDocumentPipSupported()) {
        options.onError?.();
        return;
    }

    const { isDarkMode, onClose, noteIds, activeId, onError } = options;

    try {
        const requestedWindow =
            await window.documentPictureInPicture!.requestWindow({
                width: 420,
                height: 560,
            });

        pipWindowRef = requestedWindow;

        try {
            const { trackEvent } = await import("../analytics");
            trackEvent("pip_opened");
        } catch {
            // ignore
        }

        const isAlreadySetUp =
            requestedWindow.document.querySelector("#notic-pip-iframe") !==
            null;

        if (!isAlreadySetUp) {
            requestedWindow.document.documentElement.innerHTML =
                "<head></head><body></body>";
            requestedWindow.document.title = "Notic – Note";

            const style = requestedWindow.document.createElement("style");
            style.textContent = getPipIframeStyles();
            requestedWindow.document.head.appendChild(style);

            const iframe = requestedWindow.document.createElement("iframe");
            iframe.id = "notic-pip-iframe";
            iframe.setAttribute("title", "Notic note");
            requestedWindow.document.body.appendChild(iframe);

            const script = requestedWindow.document.createElement("script");
            script.textContent =
                getPipIframeCloseScript() + "\n" + getPipDropScript();
            requestedWindow.document.body.appendChild(script);
        }

        setPipIframeUrl(
            requestedWindow.document,
            isDarkMode,
            noteIds,
            activeId
        );

        const handleClose = () => {
            if (closeCheckInterval) {
                clearInterval(closeCheckInterval);
                closeCheckInterval = null;
            }
            pipWindowRef = null;
            onClose();
        };

        requestedWindow.addEventListener("pagehide", handleClose);
        requestedWindow.addEventListener("beforeunload", handleClose);

        closeCheckInterval = setInterval(() => {
            if (requestedWindow.closed) {
                if (closeCheckInterval) clearInterval(closeCheckInterval);
                closeCheckInterval = null;
                pipWindowRef = null;
                onClose();
            }
        }, 300);
    } catch (err) {
        console.error("Document PiP failed:", err);
        pipWindowRef = null;
        onError?.();
    }
}

/**
 * Build /pip URL with noteIds and activeId (same origin).
 */
function buildPipUrl(
    noteIds: string[],
    activeId: string | null,
    dark: boolean
): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const darkStr = dark ? "1" : "0";
    const ids = noteIds.length ? noteIds.join(",") : "";
    const active = activeId ?? "";
    return `${origin}/pip?noteIds=${encodeURIComponent(
        ids
    )}&activeId=${encodeURIComponent(active)}&dark=${darkStr}`;
}

/**
 * Set or update the PiP iframe src (call after opening or when note list/active changes).
 */
export function setPipIframeUrl(
    pipDocument: Document,
    isDarkMode: boolean,
    noteIds: string[],
    activeId: string | null
): void {
    const iframe = pipDocument.getElementById(
        "notic-pip-iframe"
    ) as HTMLIFrameElement | null;
    if (!iframe) return;
    const dark = isDarkMode;
    iframe.src = buildPipUrl(noteIds, activeId, dark);
}

/**
 * If PiP window is open, refresh its iframe URL (causes reload). Use only when opening PiP.
 */
export function refreshPipWindowUrl(
    noteIds: string[],
    activeId: string | null
): void {
    const win = getPipWindow();
    if (!win || win.closed) return;
    const dark = document.body.classList.contains("dark-mode");
    setPipIframeUrl(win.document, dark, noteIds, activeId);
}

/** Minimal note fields sent to PiP so it can populate its store when opening a note from main app (avoids empty/Untitled overwrite). */
export type PipNotePayload = {
    content?: string;
    title?: string;
    displayName?: string;
    color?: string;
    workspaceId?: string;
};

/**
 * Send notesUpdate to PiP window so the iframe updates in place (no reload, no flicker).
 * Step 1 single-source-of-truth: include noteTitles (and noteColors) from main store so PiP tab bar uses main as source of truth.
 * When opening a note from sidebar/main, pass notePayloads so PiP store has content/title before editor runs (prevents empty save overwriting main).
 */
export function sendNotesUpdateToPip(
    noteIds: string[],
    activeId: string | null,
    options?: {
        noteTitles?: Record<string, string>;
        noteColors?: Record<string, string>;
        notePayloads?: Record<string, PipNotePayload>;
    }
): void {
    const win = getPipWindow();
    if (!win || win.closed) return;
    const payload: {
        type: "notesUpdate";
        noteIds: string[];
        activeId: string | null;
        noteTitles?: Record<string, string>;
        noteColors?: Record<string, string>;
        notePayloads?: Record<string, PipNotePayload>;
    } = {
        type: "notesUpdate",
        noteIds,
        activeId,
    };
    if (options?.noteTitles != null) payload.noteTitles = options.noteTitles;
    if (options?.noteColors != null) payload.noteColors = options.noteColors;
    if (options?.notePayloads != null)
        payload.notePayloads = options.notePayloads;
    win.postMessage(payload, "*");
}

/** Ask PiP to flush current note save so content is persisted before main app changes selection (match notic). */
export function requestPipFlushSave(): void {
    const win = getPipWindow();
    if (win && !win.closed) win.postMessage({ type: "flushSave" }, "*");
}

function getPipIframeStyles(): string {
    return [
        "* { box-sizing: border-box; }",
        "html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }",
        "#notic-pip-iframe { display: block; width: 100%; height: 100%; border: none; }",
        "* { scrollbar-width: thin; scrollbar-color: rgba(128, 128, 128, 0.3) transparent; }",
        "*::-webkit-scrollbar { width: 8px; height: 8px; }",
        "*::-webkit-scrollbar-track { background: transparent; }",
        "*::-webkit-scrollbar-thumb { background: rgba(128, 128, 128, 0.3); border-radius: 4px; }",
        "*::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.5); }",
    ].join("\n");
}

function getPipIframeCloseScript(): string {
    return [
        'window.addEventListener("message", function(e) {',
        "  var d = e.data;",
        '  if (e.source === window.opener && d && typeof d === "object" && d.type === "notesUpdate") {',
        '    var iframe = document.getElementById("notic-pip-iframe");',
        '    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(d, "*");',
        "    return;",
        "  }",
        '  if (e.source === window.opener && d && typeof d === "object" && d.type === "flushSave") {',
        '    var iframe = document.getElementById("notic-pip-iframe");',
        '    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(d, "*");',
        "    return;",
        "  }",
        '  if (e.source === window.opener && d && typeof d === "object" && d.type === "notic-pip-tutorial-tab-left") {',
        '    var iframe = document.getElementById("notic-pip-iframe");',
        '    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(d, "*");',
        "    return;",
        "  }",
        '  if (e.source === window.opener && d && typeof d === "object" && d.type === "notic-pip-tutorial-tab-returned") {',
        '    var iframe = document.getElementById("notic-pip-iframe");',
        '    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(d, "*");',
        "    return;",
        "  }",
        '  if (e.source === window.opener && d && typeof d === "object" && (d.type === "notic-pip-tutorial-note-created" || d.type === "notic-pip-tutorial-note-bookmarked" || d.type === "notic-pip-tutorial-note-opened" || d.type === "tutorial-ready-for-note-open" || d.type === "tutorial-show-create-hint")) {',
        '    var iframe = document.getElementById("notic-pip-iframe");',
        '    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(d, "*");',
        "    return;",
        "  }",
        '  if (d === "notic-pip-close") {',
        "    try { if (document.exitPictureInPicture) document.exitPictureInPicture(); } catch (err) {}",
        "    window.close();",
        "    return;",
        "  }",
        '  if (d && typeof d === "object" && d.type && typeof d.type === "string" && d.type.indexOf("notic-pip") === 0 && window.opener && !window.opener.closed) {',
        '    window.opener.postMessage(d, "*");',
        "  }",
        "});",
    ].join("\n");
}

/** Script run in PiP window: catch drop on PiP document, prevent "open in new tab", post file to iframe. */
function getPipDropScript(): string {
    return [
        "(function() {",
        "  var doc = document;",
        '  doc.addEventListener("dragover", function(e) {',
        '    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf("Files") !== -1) {',
        "      e.preventDefault();",
        '      e.dataTransfer.dropEffect = "copy";',
        "    }",
        "  }, true);",
        '  doc.addEventListener("drop", function(e) {',
        "    var files = e.dataTransfer && e.dataTransfer.files;",
        "    var file = null;",
        '    if (files && files.length) { for (var i = 0; i < files.length; i++) { if (files[i].type.indexOf("image/") === 0) { file = files[i]; break; } } }',
        "    if (!file) return;",
        "    e.preventDefault();",
        "    e.stopPropagation();",
        "    if (e.stopImmediatePropagation) e.stopImmediatePropagation();",
        "    file.arrayBuffer().then(function(ab) {",
        '      var iframe = doc.getElementById("notic-pip-iframe");',
        '      if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: "insertImageFromDrop", data: ab, mimeType: file.type, fileName: file.name || "image" }, "*", [ab]);',
        "    }).catch(function() {});",
        "  }, true);",
        "})();",
    ].join("\n");
}
