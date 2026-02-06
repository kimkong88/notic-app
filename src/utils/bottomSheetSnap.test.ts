import { describe, it, expect } from "vitest";
import {
    resolveSnapTarget,
    SNAP_CLOSED,
    SNAP_DEFAULT,
    SNAP_FULL,
    VELOCITY_THRESHOLD,
} from "./bottomSheetSnap";

describe("resolveSnapTarget", () => {
    // -------------------------------------------------------
    // Positional snapping (velocity ≈ 0)
    // -------------------------------------------------------
    describe("positional snapping (slow drag)", () => {
        const slow = 0; // no velocity

        it("snaps to CLOSED when height is very low (< 0.35)", () => {
            expect(resolveSnapTarget(0.1, slow)).toBe(SNAP_CLOSED);
            expect(resolveSnapTarget(0.2, slow)).toBe(SNAP_CLOSED);
            expect(resolveSnapTarget(0.34, slow)).toBe(SNAP_CLOSED);
        });

        it("snaps to DEFAULT when height is in the mid range (0.35 – 0.85)", () => {
            expect(resolveSnapTarget(0.36, slow)).toBe(SNAP_DEFAULT);
            expect(resolveSnapTarget(0.5, slow)).toBe(SNAP_DEFAULT);
            expect(resolveSnapTarget(0.7, slow)).toBe(SNAP_DEFAULT);
            expect(resolveSnapTarget(0.84, slow)).toBe(SNAP_DEFAULT);
        });

        it("snaps to FULL when height is high (> 0.85)", () => {
            expect(resolveSnapTarget(0.86, slow)).toBe(SNAP_FULL);
            expect(resolveSnapTarget(0.95, slow)).toBe(SNAP_FULL);
            expect(resolveSnapTarget(1.0, slow)).toBe(SNAP_FULL);
        });

        it("snaps to CLOSED at exactly 0", () => {
            expect(resolveSnapTarget(0, slow)).toBe(SNAP_CLOSED);
        });

        it("snaps to DEFAULT at the exact midpoint between closed and default (0.35)", () => {
            expect(resolveSnapTarget(0.35, slow)).toBe(SNAP_CLOSED);
        });

        it("snaps to DEFAULT at the exact midpoint between default and full (0.85)", () => {
            expect(resolveSnapTarget(0.85, slow)).toBe(SNAP_DEFAULT);
        });
    });

    // -------------------------------------------------------
    // Velocity-based snapping (fast swipe)
    // -------------------------------------------------------
    describe("fast downward swipe (positive velocity)", () => {
        const fast = VELOCITY_THRESHOLD + 0.1;

        it("closes the sheet when swiped down from default height", () => {
            expect(resolveSnapTarget(0.7, fast)).toBe(SNAP_CLOSED);
        });

        it("closes the sheet when swiped down from below default", () => {
            expect(resolveSnapTarget(0.5, fast)).toBe(SNAP_CLOSED);
        });

        it("snaps to DEFAULT when swiped down from full-screen", () => {
            expect(resolveSnapTarget(0.95, fast)).toBe(SNAP_DEFAULT);
        });

        it("snaps to DEFAULT when swiped down from just above midpoint", () => {
            expect(resolveSnapTarget(0.86, fast)).toBe(SNAP_DEFAULT);
        });
    });

    describe("fast upward swipe (negative velocity)", () => {
        const fast = -(VELOCITY_THRESHOLD + 0.1);

        it("snaps to FULL when swiped up from default height", () => {
            expect(resolveSnapTarget(0.7, fast)).toBe(SNAP_FULL);
        });

        it("snaps to FULL when swiped up from low height", () => {
            expect(resolveSnapTarget(0.4, fast)).toBe(SNAP_FULL);
        });

        it("stays FULL when swiped up from near-full", () => {
            expect(resolveSnapTarget(0.9, fast)).toBe(SNAP_FULL);
        });
    });

    // -------------------------------------------------------
    // Edge: velocity exactly at threshold (not fast enough)
    // -------------------------------------------------------
    describe("velocity at exactly threshold (falls back to positional)", () => {
        it("positive threshold velocity → positional snap", () => {
            // velocity = threshold exactly → not > threshold → positional
            expect(resolveSnapTarget(0.7, VELOCITY_THRESHOLD)).toBe(
                SNAP_DEFAULT
            );
            expect(resolveSnapTarget(0.2, VELOCITY_THRESHOLD)).toBe(
                SNAP_CLOSED
            );
            expect(resolveSnapTarget(0.9, VELOCITY_THRESHOLD)).toBe(SNAP_FULL);
        });

        it("negative threshold velocity → positional snap", () => {
            expect(resolveSnapTarget(0.7, -VELOCITY_THRESHOLD)).toBe(
                SNAP_DEFAULT
            );
            expect(resolveSnapTarget(0.2, -VELOCITY_THRESHOLD)).toBe(
                SNAP_CLOSED
            );
        });
    });
});
