import { describe, it, expect } from "vitest";
import { isEmptyPipNote, sortTabsByPinned } from "./tabUtils";

// ---------------------------------------------------------------------------
// isEmptyPipNote
// ---------------------------------------------------------------------------

describe("isEmptyPipNote", () => {
    it("returns false for null / undefined", () => {
        expect(isEmptyPipNote(null)).toBe(false);
        expect(isEmptyPipNote(undefined)).toBe(false);
    });

    it("returns false when createdFromPip is not set", () => {
        expect(isEmptyPipNote({ content: "" })).toBe(false);
        expect(isEmptyPipNote({ createdFromPip: false, content: "" })).toBe(
            false
        );
    });

    it("returns true when createdFromPip is true and content is empty", () => {
        expect(isEmptyPipNote({ createdFromPip: true, content: "" })).toBe(
            true
        );
    });

    it("returns true when content is whitespace-only", () => {
        expect(
            isEmptyPipNote({ createdFromPip: true, content: "   \n\t  " })
        ).toBe(true);
    });

    it("returns true when content is undefined", () => {
        expect(isEmptyPipNote({ createdFromPip: true })).toBe(true);
        expect(
            isEmptyPipNote({ createdFromPip: true, content: undefined })
        ).toBe(true);
    });

    it("returns false when createdFromPip is true but content has text", () => {
        expect(
            isEmptyPipNote({ createdFromPip: true, content: "Hello" })
        ).toBe(false);
    });

    it("returns false for a normal note with content", () => {
        expect(isEmptyPipNote({ content: "Some content here" })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// sortTabsByPinned
// ---------------------------------------------------------------------------

describe("sortTabsByPinned", () => {
    it("returns empty array for empty input", () => {
        expect(sortTabsByPinned([], new Set())).toEqual([]);
    });

    it("returns same order when nothing is pinned", () => {
        expect(sortTabsByPinned(["a", "b", "c"], new Set())).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    it("returns same order when everything is pinned", () => {
        expect(
            sortTabsByPinned(["a", "b", "c"], new Set(["a", "b", "c"]))
        ).toEqual(["a", "b", "c"]);
    });

    it("moves pinned tabs to front while preserving relative order", () => {
        expect(
            sortTabsByPinned(["a", "b", "c", "d"], new Set(["c", "a"]))
        ).toEqual(["a", "c", "b", "d"]);
    });

    it("preserves relative order within unpinned group", () => {
        expect(
            sortTabsByPinned(["x", "y", "z"], new Set(["z"]))
        ).toEqual(["z", "x", "y"]);
    });

    it("ignores pinned IDs not present in noteIds", () => {
        expect(
            sortTabsByPinned(["a", "b"], new Set(["c", "a"]))
        ).toEqual(["a", "b"]);
    });
});
