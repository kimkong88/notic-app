/**
 * Bottom sheet snap-point calculation.
 *
 * Snap points (expressed as fraction of viewport height the sheet occupies):
 *   0   = closed
 *   0.7 = default  (70 vh)
 *   1   = full-screen
 *
 * The function decides which snap point to land on given the current
 * sheet height fraction and the swipe velocity.
 */

/** Snap targets as fractions of viewport height. */
export const SNAP_CLOSED = 0;
export const SNAP_DEFAULT = 0.7;
export const SNAP_FULL = 1;

/** Velocity threshold (px/ms). A fast flick overrides positional snapping. */
export const VELOCITY_THRESHOLD = 0.5;

/**
 * Given the current sheet height (as a 0-1 fraction of the viewport) and
 * the vertical velocity of the drag (positive = dragging **down**), return
 * the snap target the sheet should animate to.
 *
 * @param heightFraction – current sheet height / viewport height  (0–1)
 * @param velocity       – px/ms, positive = moving down (closing)
 * @returns one of SNAP_CLOSED, SNAP_DEFAULT, or SNAP_FULL
 */
export function resolveSnapTarget(
    heightFraction: number,
    velocity: number
): number {
    // --- Fast swipe shortcuts (override positional logic) ---
    if (velocity > VELOCITY_THRESHOLD) {
        // Fast downward swipe
        // If currently near full → snap to default; if near/below default → close
        if (heightFraction > (SNAP_DEFAULT + SNAP_FULL) / 2) {
            return SNAP_DEFAULT;
        }
        return SNAP_CLOSED;
    }

    if (velocity < -VELOCITY_THRESHOLD) {
        // Fast upward swipe
        // If currently near default or below → snap to default; if above mid → full
        if (heightFraction < (SNAP_DEFAULT + SNAP_FULL) / 2) {
            return SNAP_FULL;
        }
        return SNAP_FULL;
    }

    // --- Positional snapping (slow drag / release) ---
    // Midpoints between snap targets
    const midClosedDefault = SNAP_DEFAULT / 2; // 0.35
    const midDefaultFull = (SNAP_DEFAULT + SNAP_FULL) / 2; // 0.85

    if (heightFraction <= midClosedDefault) return SNAP_CLOSED;
    if (heightFraction <= midDefaultFull) return SNAP_DEFAULT;
    return SNAP_FULL;
}
