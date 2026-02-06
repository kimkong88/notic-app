import { Check, Plus, X } from "lucide-react";
import "../dashboard.css";
import { useEffect, useState } from "react";

const NOTE_THEME_KEY = "notic_noteTheme";
const NOTE_THEME_VALUES = [
    "default",
    "sepia",
    "dark",
    "high-contrast",
] as const;
type NoteThemeId = (typeof NOTE_THEME_VALUES)[number];

function getStoredNoteTheme(): NoteThemeId {
    if (typeof window === "undefined") return "default";
    try {
        const stored = localStorage.getItem(NOTE_THEME_KEY);
        if (stored && NOTE_THEME_VALUES.includes(stored as NoteThemeId))
            return stored as NoteThemeId;
    } catch (_) {}
    return "default";
}

/**
 * Tutorial PiP content - static presentation in a real PiP window.
 * This is NOT the real editor, just a mockup to teach users about PiP.
 * No note objects, no database, no sync - purely visual.
 */
export function TutorialPipView() {
    const isDark =
        new URLSearchParams(window.location.search).get("dark") === "1";
    const [noteTheme, setNoteTheme] = useState<NoteThemeId>(getStoredNoteTheme);
    const [floatTestCompleted, setFloatTestCompleted] = useState(false);
    const [hasLeftTab, setHasLeftTab] = useState(false);
    const [showCelebration, setShowCelebration] = useState(false);

    // Tab tutorial task states
    const [tabMenuOpened, setTabMenuOpened] = useState(false);
    const [tabRenamed, setTabRenamed] = useState(false);
    const [tabColorChanged, setTabColorChanged] = useState(false);
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
    } | null>(null);
    const [renameValue, setRenameValue] = useState("Welcome Tutorial");
    const [tabColor, setTabColor] = useState("");
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [hoveredSubmenu, setHoveredSubmenu] = useState<"color" | null>(null);

    // Note creation/opening task states
    const [noteCreated, setNoteCreated] = useState(false);
    const [noteBookmarked, setNoteBookmarked] = useState(false);
    const [noteOpened, setNoteOpened] = useState(false);

    useEffect(() => {
        document.body.classList.add("pip-page");
        document.body.classList.toggle("dark-mode", isDark);
        return () => {
            document.body.classList.remove("pip-page");
        };
    }, [isDark]);

    useEffect(() => {
        if (noteTheme === "default") {
            document.body.removeAttribute("data-note-theme");
        } else {
            document.body.setAttribute("data-note-theme", noteTheme);
        }
    }, [noteTheme]);

    useEffect(() => {
        const handler = (e: MessageEvent) => {
            const d = e.data;

            if (import.meta.env.DEV) {
                console.log("[TutorialPiP] Message received:", d);
            }

            if (
                d &&
                d.type === "notic-note-theme-changed" &&
                typeof d.theme === "string" &&
                NOTE_THEME_VALUES.includes(d.theme as NoteThemeId)
            ) {
                setNoteTheme(d.theme as NoteThemeId);
                try {
                    localStorage.setItem(NOTE_THEME_KEY, d.theme);
                } catch (_) {}
            }
            // Listen for signal that user left the tab (step 1 of 2)
            if (d && d.type === "notic-pip-tutorial-tab-left" && !hasLeftTab) {
                if (import.meta.env.DEV) {
                    console.log(
                        "[TutorialPiP] User left tab, updating instructions"
                    );
                }
                setHasLeftTab(true);
            }

            // Listen for signal from main dashboard that user returned to Notic tab
            if (
                d &&
                d.type === "notic-pip-tutorial-tab-returned" &&
                !floatTestCompleted
            ) {
                if (import.meta.env.DEV) {
                    console.log(
                        "[TutorialPiP] Tab returned detected, marking task complete"
                    );
                }
                setFloatTestCompleted(true);
                setShowCelebration(true);
                setTimeout(() => setShowCelebration(false), 3000);
                // Notify main dashboard for celebration effect
                const parentWindow =
                    window.parent && window.parent !== window
                        ? window.parent
                        : window;
                try {
                    if (parentWindow.opener && !parentWindow.opener.closed) {
                        parentWindow.opener.postMessage(
                            {
                                type: "tutorial-task-completed",
                                taskId: "float-test",
                            },
                            "*"
                        );
                        if (import.meta.env.DEV) {
                            console.log(
                                "[TutorialPiP] Sent completion message to dashboard"
                            );
                        }
                    }
                } catch (e) {
                    if (import.meta.env.DEV) {
                        console.error(
                            "[TutorialPiP] Failed to send completion message:",
                            e
                        );
                    }
                }
            }

            // Listen for note creation (either toolbar or context menu)
            if (
                d &&
                d.type === "notic-pip-tutorial-note-created" &&
                !noteCreated
            ) {
                setNoteCreated(true);
            }

            // Listen for note bookmarked
            if (
                d &&
                d.type === "notic-pip-tutorial-note-bookmarked" &&
                !noteBookmarked
            ) {
                setNoteBookmarked(true);
            }

            // Listen for note opened in PiP (this completes the task!)
            if (
                d &&
                d.type === "notic-pip-tutorial-note-opened" &&
                !noteOpened
            ) {
                setNoteOpened(true);
                setShowCelebration(true);
                setTimeout(() => setShowCelebration(false), 3000);
            }
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [
        floatTestCompleted,
        hasLeftTab,
        tabMenuOpened,
        tabRenamed,
        tabColorChanged,
        noteCreated,
        noteBookmarked,
        noteOpened,
    ]);

    // Dynamic instruction based on progress for first task
    const currentInstruction = !hasLeftTab
        ? "Switch to another browser tab (0/2)"
        : !floatTestCompleted
        ? "Now come back to Notic (1/2)"
        : "Task complete! (2/2) 🎉";

    // Dynamic instruction for tab task
    const tabTaskInstruction = !tabMenuOpened
        ? "Right-click (or double-click) the tab above to open menu (0/3)"
        : !tabRenamed
        ? 'Select "Rename" and change the tab name (1/3)'
        : !tabColorChanged
        ? "Right-click the tab again and change its color (2/3)"
        : "Task complete! (3/3) 🎉";

    const tabTaskCompleted = tabMenuOpened && tabRenamed && tabColorChanged;
    const tabTaskActive = floatTestCompleted && !tabTaskCompleted;

    const noteTaskCompleted = noteCreated && noteBookmarked && noteOpened;
    const noteTaskReadyForOpen = noteCreated && noteBookmarked && !noteOpened;
    const showCreateNoteHint = tabTaskCompleted && !noteCreated;

    // Notify dashboard to show "create note" hint
    useEffect(() => {
        const parentWindow =
            window.parent && window.parent !== window ? window.parent : window;
        try {
            if (parentWindow.opener && !parentWindow.opener.closed) {
                parentWindow.opener.postMessage(
                    {
                        type: "tutorial-show-create-hint",
                        show: showCreateNoteHint,
                    },
                    "*"
                );
                if (import.meta.env.DEV) {
                    console.log(
                        "[TutorialPiP] Sent show-create-hint message to dashboard:",
                        showCreateNoteHint
                    );
                }
            }
        } catch (e) {
            if (import.meta.env.DEV) {
                console.error("[TutorialPiP] Failed to notify dashboard:", e);
            }
        }
    }, [showCreateNoteHint]);

    // Notify dashboard when ready for note opening (step 3)
    useEffect(() => {
        if (!noteTaskReadyForOpen) return;
        if (import.meta.env.DEV) {
            console.log("[TutorialPiP] Ready for note opening step");
        }

        // Notify main dashboard to enable note opening
        const parentWindow =
            window.parent && window.parent !== window ? window.parent : window;
        try {
            if (parentWindow.opener && !parentWindow.opener.closed) {
                parentWindow.opener.postMessage(
                    { type: "tutorial-ready-for-note-open" },
                    "*"
                );
                if (import.meta.env.DEV) {
                    console.log(
                        "[TutorialPiP] Sent ready-for-note-open message to dashboard"
                    );
                }
            }
        } catch (e) {
            if (import.meta.env.DEV) {
                console.error("[TutorialPiP] Failed to notify dashboard:", e);
            }
        }
    }, [noteTaskReadyForOpen]);

    // Notify dashboard when tab customization task is completed
    useEffect(() => {
        if (!tabTaskCompleted) return;
        if (import.meta.env.DEV) {
            console.log("[TutorialPiP] Tab customization task completed");
        }
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 3000);

        // Notify main dashboard for celebration effect
        const parentWindow =
            window.parent && window.parent !== window ? window.parent : window;
        try {
            if (parentWindow.opener && !parentWindow.opener.closed) {
                parentWindow.opener.postMessage(
                    {
                        type: "tutorial-task-completed",
                        taskId: "tab-customization",
                    },
                    "*"
                );
                if (import.meta.env.DEV) {
                    console.log(
                        "[TutorialPiP] Sent tab customization completion message to dashboard"
                    );
                }
            }
        } catch (e) {
            if (import.meta.env.DEV) {
                console.error("[TutorialPiP] Failed to notify dashboard:", e);
            }
        }
    }, [tabTaskCompleted]);

    // Dynamic instruction for note task
    const noteTaskInstruction = !noteCreated
        ? "Create a note (toolbar + or right-click folder) (0/3)"
        : !noteBookmarked
        ? "Bookmark it (right-click note → Add to Bookmarks) (1/3)"
        : !noteOpened
        ? "Open it in the editor (right-click note → Open) (2/3)"
        : "Task complete! (3/3) 🎉";

    const handleTabContextMenu = (e: React.MouseEvent) => {
        if (!tabTaskActive) return;
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY });
        if (!tabMenuOpened) {
            setTabMenuOpened(true);
        }
    };

    const handleTabDoubleClick = () => {
        if (!tabTaskActive) return;
        // Double-click counts as opening menu + opening rename
        setTabMenuOpened(true);
        setShowRenameModal(true);
    };

    const handleRenameOpen = () => {
        setContextMenu(null);
        setShowRenameModal(true);
    };

    const handleRenameSave = () => {
        if (renameValue.trim()) {
            setTabRenamed(true);
            setShowRenameModal(false);
        }
    };

    const handleColorChange = (color: string) => {
        // Only count color change if rename was already done
        if (!tabRenamed) {
            setContextMenu(null);
            setHoveredSubmenu(null);
            return;
        }
        setTabColor(color);
        setTabColorChanged(true);
        setContextMenu(null);
        setHoveredSubmenu(null);

        // Trigger confetti only when ALL steps are complete
        if (tabMenuOpened && tabRenamed) {
            setShowCelebration(true);
            setTimeout(() => setShowCelebration(false), 3000);
        }
    };

    const COLOR_OPTIONS: Array<{ label: string; value: string }> = [
        { label: "Color: Default", value: "" },
        { label: "Color: Blue", value: "#3b82f6" },
        { label: "Color: Green", value: "#22c55e" },
        { label: "Color: Purple", value: "#a855f7" },
        { label: "Color: Orange", value: "#f97316" },
    ];

    return (
        <>
            <div className="tutorial-pip-container">
                {/* Realistic tab bar (same design as real PiP) */}
                <div
                    className={`pip-tabs ${
                        tabTaskActive ? "tutorial-tabs-active" : ""
                    }`}
                >
                    <div
                        className={`pip-tab-item active ${
                            tabTaskActive
                                ? "tutorial-interactive tutorial-tab-highlight"
                                : ""
                        }`}
                        onContextMenu={handleTabContextMenu}
                        onDoubleClick={handleTabDoubleClick}
                        style={
                            tabTaskActive
                                ? { cursor: "context-menu" }
                                : undefined
                        }
                    >
                        {tabColor && (
                            <span
                                className="pip-tab-color"
                                style={{ backgroundColor: tabColor }}
                                aria-hidden
                            />
                        )}
                        <span className="pip-tab-label">{renameValue}</span>
                        <span className="pip-tab-close">
                            <X size={14} strokeWidth={2} />
                        </span>
                    </div>
                    <button
                        type="button"
                        className="pip-tab-new-btn"
                        disabled
                        style={{ opacity: 0.5, cursor: "not-allowed" }}
                    >
                        <Plus size={16} strokeWidth={2} />
                    </button>
                </div>

                <div className="tutorial-pip-content">
                    <h1 className="tutorial-pip-title">Welcome to Notic ✨</h1>
                    <p className="tutorial-pip-desc">
                        Let's verify this window floats:
                    </p>

                    <ul className="tutorial-pip-task-list">
                        <li
                            className={`tutorial-pip-task-item${
                                floatTestCompleted
                                    ? " tutorial-pip-task-checked"
                                    : ""
                            }`}
                        >
                            <div
                                className={`tutorial-pip-checkbox${
                                    floatTestCompleted
                                        ? " tutorial-pip-checkbox-checked"
                                        : ""
                                }`}
                            >
                                {floatTestCompleted && (
                                    <Check size={14} strokeWidth={3} />
                                )}
                            </div>
                            <div className="tutorial-pip-task-text">
                                <span className="tutorial-pip-task-label">
                                    Test the floating window
                                </span>
                                <span
                                    key={currentInstruction}
                                    className={`tutorial-pip-task-hint ${
                                        !floatTestCompleted
                                            ? "tutorial-pip-task-hint-active"
                                            : ""
                                    }`}
                                >
                                    {currentInstruction}
                                </span>
                            </div>
                        </li>
                        <li
                            className={`tutorial-pip-task-item${
                                tabTaskCompleted
                                    ? " tutorial-pip-task-checked"
                                    : ""
                            }${
                                !floatTestCompleted
                                    ? " tutorial-pip-task-disabled"
                                    : ""
                            }`}
                        >
                            <div
                                className={`tutorial-pip-checkbox${
                                    tabTaskCompleted
                                        ? " tutorial-pip-checkbox-checked tutorial-pip-checkbox-pulse"
                                        : ""
                                }`}
                            >
                                {tabTaskCompleted && (
                                    <Check size={14} strokeWidth={3} />
                                )}
                            </div>
                            <div className="tutorial-pip-task-text">
                                <span className="tutorial-pip-task-label">
                                    Customize the tab
                                </span>
                                {floatTestCompleted && (
                                    <span
                                        key={tabTaskInstruction}
                                        className={`tutorial-pip-task-hint ${
                                            !tabTaskCompleted
                                                ? "tutorial-pip-task-hint-active"
                                                : ""
                                        }`}
                                    >
                                        {tabTaskInstruction}
                                    </span>
                                )}
                            </div>
                        </li>
                        <li
                            className={`tutorial-pip-task-item${
                                noteTaskCompleted
                                    ? " tutorial-pip-task-checked"
                                    : ""
                            }${
                                !tabTaskCompleted
                                    ? " tutorial-pip-task-disabled"
                                    : ""
                            }`}
                        >
                            <div
                                className={`tutorial-pip-checkbox${
                                    noteTaskCompleted
                                        ? " tutorial-pip-checkbox-checked tutorial-pip-checkbox-pulse"
                                        : ""
                                }`}
                            >
                                {noteTaskCompleted && (
                                    <Check size={14} strokeWidth={3} />
                                )}
                            </div>
                            <div className="tutorial-pip-task-text">
                                <span className="tutorial-pip-task-label">
                                    Create and open a note
                                </span>
                                {tabTaskCompleted && (
                                    <span
                                        key={noteTaskInstruction}
                                        className={`tutorial-pip-task-hint ${
                                            !noteTaskCompleted
                                                ? "tutorial-pip-task-hint-active"
                                                : ""
                                        }`}
                                    >
                                        {noteTaskInstruction}
                                    </span>
                                )}
                            </div>
                        </li>
                    </ul>

                    <div className="tutorial-pip-note">
                        💡 When you create a real note, it will open here with
                        the full editor
                    </div>
                </div>
            </div>

            {/* Confetti celebration */}
            {showCelebration && (
                <div className="confetti-container">
                    {Array.from({ length: 30 }).map((_, i) => (
                        <div
                            key={i}
                            className="confetti-particle"
                            style={{
                                left: `${Math.random() * 100}%`,
                                animationDelay: `${Math.random() * 0.5}s`,
                                background: `hsl(${
                                    Math.random() * 360
                                }, 70%, 60%)`,
                            }}
                        />
                    ))}
                </div>
            )}

            {/* Context menu for tab (only during tutorial task) */}
            {contextMenu && tabTaskActive && (
                <div
                    className="pip-context-menu show"
                    style={{
                        left: `${contextMenu.x}px`,
                        top: `${contextMenu.y}px`,
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
                        onClick={handleRenameOpen}
                    >
                        Rename
                    </button>
                    <div
                        className="pip-context-menu-item pip-context-menu-item-has-submenu"
                        onMouseEnter={() => setHoveredSubmenu("color")}
                        onMouseLeave={() =>
                            setTimeout(() => setHoveredSubmenu(null), 150)
                        }
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
                                    onClick={() => handleColorChange(opt.value)}
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
                </div>
            )}

            {/* Rename modal (only during tutorial task) */}
            {showRenameModal && tabTaskActive && (
                <div
                    className="pip-modal-overlay show"
                    onClick={() => setShowRenameModal(false)}
                >
                    <div
                        className="pip-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="pip-modal-header">
                            <h3 className="pip-modal-title">Rename Tab</h3>
                        </div>
                        <input
                            type="text"
                            className="pip-modal-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameSave();
                                if (e.key === "Escape")
                                    setShowRenameModal(false);
                            }}
                            placeholder="Enter tab name"
                            autoFocus
                        />
                        <div className="pip-modal-actions">
                            <button
                                type="button"
                                className="pip-modal-btn"
                                onClick={() => setShowRenameModal(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="pip-modal-btn pip-modal-btn-primary"
                                onClick={handleRenameSave}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Click outside to close context menu */}
            {contextMenu && (
                <div
                    style={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 999,
                    }}
                    onClick={() => {
                        setContextMenu(null);
                        setHoveredSubmenu(null);
                    }}
                />
            )}
        </>
    );
}
