// Sign translation between the solver's conventions and the Three.js viewer.
//
// The solver works in a Z-up frame: X = LOA (bow = +X), Y = beam, Z = up.
// The viewer builds the same Z-up frame (its ground grid is laid into the XY
// plane by a +90° rotation about X), but Three.js rotates by the plain
// right-hand rule, which for a rotation about +Y points the OPPOSITE way
// compared with the solver's marine trim convention.
//
// These helpers are the single place where that translation lives, so the
// convention is testable without a browser. `tests/verify-orientation.ts`
// asserts them against Three.js' own Euler maths.

/**
 * Trim angle for the viewer, in degrees.
 *
 * The solver reports trim with the marine convention: positive = bow up.
 * `applyPitchY` implements that by flipping the sine term, so a positive trim
 * already carries the bow towards +Z. A plain Three.js `rotation.y` of the
 * same sign would carry the bow towards -Z instead, so the viewer's angle is
 * the negation of the solver's.
 */
export function viewerTrimDeg(trimDeg: number): number {
  return -trimDeg
}

/**
 * Heel angle for the viewer, in degrees.
 *
 * No negation is needed: the solver's `applyRollX` and Three.js' `rotation.x`
 * are both the plain right-hand rotation about +X, so they already agree. A
 * positive angle raises the +Y side and lowers the -Y side.
 */
export function viewerHeelDeg(heelDeg: number): number {
  return heelDeg
}
