/**
 * The one sweep the app solves on: +-4.5 degrees at 0.1 degrees.
 *
 * Two call sites post these numbers to the worker - the single-viewer solve in
 * `App.tsx` and every Compare slot in `slot-solver.ts` - and they must never
 * drift apart. The solver's own fallbacks are NARROWER (+-3.5 degrees), so a
 * request that dropped a field would silently search a different ladder and
 * land on a different trim; and the app's published baseline (the test hull's
 * +3.60 degrees) is only reachable on the documented sweep. Both call sites
 * import the constants from here, and
 * `tests/verify-slot-solver.ts` asserts both the values and what the slot
 * request posts with them.
 */

export const MAX_TRIM_DEG = 4.5
export const TRIM_STEP_DEG = 0.1
