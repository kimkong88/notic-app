import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./useUIStore";
import {
    SIDEBAR_WIDTH_MIN,
    SIDEBAR_WIDTH_MAX,
    SIDEBAR_WIDTH_DEFAULT,
} from "./useUIStore";

function resetUIStore(): void {
    useUIStore.setState({
        isDarkMode: false,
        sidebarCollapsed: false,
        sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
        currentView: "notes",
        isTrashView: false,
        openInPipNoteIds: [],
        openInPipActiveNoteId: null,
        editorModalOpen: false,
        tutorialInProgress: false,
        tutorialReadyForNoteOpen: false,
        tutorialShowCreateHint: false,
    });
}

describe("useUIStore", () => {
    beforeEach(resetUIStore);

    describe("sidebar width clamping", () => {
        it("clamps setSidebarWidth to 0 when negative", () => {
            useUIStore.getState().setSidebarWidth(-50);
            expect(useUIStore.getState().sidebarWidth).toBe(0);
        });

        it("clamps setSidebarWidth to MAX when above max", () => {
            useUIStore.getState().setSidebarWidth(600);
            expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
        });

        it("accepts width within range", () => {
            useUIStore.getState().setSidebarWidth(300);
            expect(useUIStore.getState().sidebarWidth).toBe(300);
        });

        it("accepts exactly MIN and MAX", () => {
            useUIStore.getState().setSidebarWidth(SIDEBAR_WIDTH_MIN);
            expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN);
            useUIStore.getState().setSidebarWidth(SIDEBAR_WIDTH_MAX);
            expect(useUIStore.getState().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX);
        });
    });

    describe("UI setters", () => {
        it("setSidebarCollapsed updates state", () => {
            expect(useUIStore.getState().sidebarCollapsed).toBe(false);
            useUIStore.getState().setSidebarCollapsed(true);
            expect(useUIStore.getState().sidebarCollapsed).toBe(true);
        });

        it("setIsDarkMode updates state", () => {
            expect(useUIStore.getState().isDarkMode).toBe(false);
            useUIStore.getState().setIsDarkMode(true);
            expect(useUIStore.getState().isDarkMode).toBe(true);
        });

        it("setCurrentView updates state", () => {
            expect(useUIStore.getState().currentView).toBe("notes");
            useUIStore.getState().setCurrentView("settings");
            expect(useUIStore.getState().currentView).toBe("settings");
        });

        it("setIsTrashView updates state", () => {
            expect(useUIStore.getState().isTrashView).toBe(false);
            useUIStore.getState().setIsTrashView(true);
            expect(useUIStore.getState().isTrashView).toBe(true);
        });

        it("setOpenInPipNoteIds and setOpenInPipActiveNoteId update state", () => {
            expect(useUIStore.getState().openInPipNoteIds).toEqual([]);
            useUIStore.getState().setOpenInPipNoteIds(["n1", "n2"]);
            expect(useUIStore.getState().openInPipNoteIds).toEqual([
                "n1",
                "n2",
            ]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe("n1");
            useUIStore.getState().setOpenInPipActiveNoteId("n2");
            expect(useUIStore.getState().openInPipActiveNoteId).toBe("n2");
        });

        it("addNoteToPip and removeNoteFromPip update state", () => {
            useUIStore.getState().addNoteToPip("n1");
            expect(useUIStore.getState().openInPipNoteIds).toEqual(["n1"]);
            useUIStore.getState().addNoteToPip("n2");
            expect(useUIStore.getState().openInPipNoteIds).toEqual([
                "n1",
                "n2",
            ]);
            useUIStore.getState().removeNoteFromPip("n1");
            expect(useUIStore.getState().openInPipNoteIds).toEqual(["n2"]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe("n2");
        });

        it("setTutorialInProgress updates state", () => {
            expect(useUIStore.getState().tutorialInProgress).toBe(false);
            useUIStore.getState().setTutorialInProgress(true);
            expect(useUIStore.getState().tutorialInProgress).toBe(true);
            useUIStore.getState().setTutorialInProgress(false);
            expect(useUIStore.getState().tutorialInProgress).toBe(false);
        });
    });

    describe("editor modal state", () => {
        it("setEditorModalOpen updates state", () => {
            expect(useUIStore.getState().editorModalOpen).toBe(false);
            useUIStore.getState().setEditorModalOpen(true);
            expect(useUIStore.getState().editorModalOpen).toBe(true);
            useUIStore.getState().setEditorModalOpen(false);
            expect(useUIStore.getState().editorModalOpen).toBe(false);
        });

        it("editorModalOpen is independent from openInPipNoteIds", () => {
            useUIStore.getState().setEditorModalOpen(true);
            useUIStore.getState().addNoteToPip("n1");
            expect(useUIStore.getState().editorModalOpen).toBe(true);
            expect(useUIStore.getState().openInPipNoteIds).toEqual(["n1"]);
        });
    });

    describe("closeEditorModal (atomic action)", () => {
        /**
         * closeEditorModal() atomically clears editorModalOpen,
         * openInPipNoteIds, and openInPipActiveNoteId in a single
         * store update. This prevents the bug where calling
         * setEditorModalOpen(false) alone leaves stale pip state.
         */
        it("clears all three states atomically", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().addNoteToPip("n2");
            useUIStore.getState().setEditorModalOpen(true);

            useUIStore.getState().closeEditorModal();

            expect(useUIStore.getState().editorModalOpen).toBe(false);
            expect(useUIStore.getState().openInPipNoteIds).toEqual([]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe(null);
        });

        it("is safe to call when already closed", () => {
            useUIStore.getState().closeEditorModal();
            expect(useUIStore.getState().editorModalOpen).toBe(false);
            expect(useUIStore.getState().openInPipNoteIds).toEqual([]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe(null);
        });

        it("prevents stale sidebar indicators (regression)", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);
            expect(useUIStore.getState().openInPipNoteIds.includes("n1")).toBe(
                true
            );

            useUIStore.getState().closeEditorModal();

            // Sidebar indicator must be gone
            expect(useUIStore.getState().openInPipNoteIds.includes("n1")).toBe(
                false
            );
        });

        it("does not affect bottom sheet state", () => {
            useUIStore.getState().addNoteToBottomSheet("bs1", true);
            useUIStore.getState().setBottomSheetOpen(true);
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);

            useUIStore.getState().closeEditorModal();

            // Bottom sheet should be unaffected
            expect(useUIStore.getState().bottomSheetOpen).toBe(true);
            expect(useUIStore.getState().bottomSheetNoteIds).toEqual(["bs1"]);
            expect(useUIStore.getState().bottomSheetActiveNoteId).toBe("bs1");
        });
    });

    describe("editor modal close cleanup (regression)", () => {
        /**
         * Bug: closing editor modal set editorModalOpen=false but did NOT
         * clear openInPipNoteIds / openInPipActiveNoteId. Sidebar indicators
         * persisted because they check openInPipNoteIds.includes(noteId).
         *
         * Fix: closeEditorModal() atomically clears all PiP tab state.
         */
        it("closing modal must clear pip note ids to remove sidebar indicators", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);
            expect(useUIStore.getState().openInPipNoteIds).toEqual(["n1"]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe("n1");
            expect(useUIStore.getState().editorModalOpen).toBe(true);

            useUIStore.getState().closeEditorModal();

            expect(useUIStore.getState().openInPipNoteIds).toEqual([]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe(null);
            expect(useUIStore.getState().editorModalOpen).toBe(false);
        });

        it("closing modal with multiple tabs clears all pip note ids", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().addNoteToPip("n2");
            useUIStore.getState().addNoteToPip("n3");
            useUIStore.getState().setEditorModalOpen(true);
            expect(useUIStore.getState().openInPipNoteIds).toEqual([
                "n1",
                "n2",
                "n3",
            ]);

            useUIStore.getState().closeEditorModal();

            expect(useUIStore.getState().openInPipNoteIds).toEqual([]);
            expect(useUIStore.getState().openInPipActiveNoteId).toBe(null);
        });
    });

    describe("note active in editor check (regression)", () => {
        /**
         * Bug: detail view edit button and context menu actions only checked
         * pipIsOpen to disable. The editor modal was not considered.
         *
         * Fix: check (pipIsOpen || editorModalOpen) everywhere.
         * This helper mirrors the check used in MainContent and Sidebar.
         */
        function isNoteActiveInEditor(
            selectedNoteId: string,
            pipIsOpen: boolean
        ): boolean {
            const { openInPipActiveNoteId, editorModalOpen } =
                useUIStore.getState();
            return (
                openInPipActiveNoteId === selectedNoteId &&
                (pipIsOpen || editorModalOpen)
            );
        }

        /**
         * Sidebar uses openInPipNoteIds.includes() && (pipIsOpen || editorModalOpen)
         * to show indicator AND gate actions. This helper mirrors that.
         */
        function isNoteOpenInEditor(
            noteId: string,
            pipIsOpen: boolean
        ): boolean {
            const { openInPipNoteIds, editorModalOpen } = useUIStore.getState();
            return (
                openInPipNoteIds.includes(noteId) &&
                (pipIsOpen || editorModalOpen)
            );
        }

        it("returns true when note is active and editor modal is open", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);
            expect(isNoteActiveInEditor("n1", false)).toBe(true);
        });

        it("returns true when note is active and pip is open", () => {
            useUIStore.getState().addNoteToPip("n1");
            expect(isNoteActiveInEditor("n1", true)).toBe(true);
        });

        it("returns false when neither pip nor modal is open", () => {
            useUIStore.getState().addNoteToPip("n1");
            expect(isNoteActiveInEditor("n1", false)).toBe(false);
        });

        it("returns false when modal is open but different note is active", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);
            expect(isNoteActiveInEditor("n2", false)).toBe(false);
        });

        it("returns false after closeEditorModal()", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);
            expect(isNoteActiveInEditor("n1", false)).toBe(true);

            useUIStore.getState().closeEditorModal();
            expect(isNoteActiveInEditor("n1", false)).toBe(false);
        });

        it("isNoteOpenInEditor gates sidebar indicator correctly", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().addNoteToPip("n2");

            // Neither PiP nor modal open — indicator should be off
            expect(isNoteOpenInEditor("n1", false)).toBe(false);

            // Modal open — indicator should be on for both
            useUIStore.getState().setEditorModalOpen(true);
            expect(isNoteOpenInEditor("n1", false)).toBe(true);
            expect(isNoteOpenInEditor("n2", false)).toBe(true);

            // Unknown note — indicator off
            expect(isNoteOpenInEditor("n3", false)).toBe(false);

            // After close — all indicators off
            useUIStore.getState().closeEditorModal();
            expect(isNoteOpenInEditor("n1", false)).toBe(false);
            expect(isNoteOpenInEditor("n2", false)).toBe(false);
        });

        it("pip open alone still activates indicators (no regression)", () => {
            useUIStore.getState().addNoteToPip("n1");
            expect(isNoteOpenInEditor("n1", true)).toBe(true);
            expect(isNoteActiveInEditor("n1", true)).toBe(true);
        });
    });

    describe("sidebar open-in-editor indicator (regression)", () => {
        /**
         * The sidebar checks openInPipNoteIds.includes(noteId) to show
         * the "being edited" indicator. This verifies the state stays
         * consistent through open/close cycles.
         */
        it("note is indicated while modal is open", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);
            expect(useUIStore.getState().openInPipNoteIds.includes("n1")).toBe(
                true
            );
        });

        it("note is NOT indicated after closeEditorModal()", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().setEditorModalOpen(true);

            useUIStore.getState().closeEditorModal();

            expect(useUIStore.getState().openInPipNoteIds.includes("n1")).toBe(
                false
            );
        });

        it("closing a single tab removes only that indicator", () => {
            useUIStore.getState().addNoteToPip("n1");
            useUIStore.getState().addNoteToPip("n2");
            useUIStore.getState().setEditorModalOpen(true);

            // Close just n1
            useUIStore.getState().removeNoteFromPip("n1");
            expect(useUIStore.getState().openInPipNoteIds.includes("n1")).toBe(
                false
            );
            expect(useUIStore.getState().openInPipNoteIds.includes("n2")).toBe(
                true
            );
        });
    });
});
