// Hydrostatics solver: waterplane clipping, form coefficients, stability and trim.
//
// Conventions (shared with src/lib/geometry.ts):
// - Z-up, X = LOA (forward), Y = BOA (side). All STL units are millimetres.
// - "Draft" is measured upwards from the keel (bounding-box min Z).
// - Fresh water: rho = 1000 kg/m^3, so 1 kg <-> 1 L <-> 1_000_000 mm^3.
// - Zero trim means the waterplane is horizontal (no heel, no trim angle).
//
// Public entry points:
// - `findDraft0Trim`  — draft and displacement at a fixed trim/heel.
// - `solveTrim`       — full solve: trim sweep, form coefficients, stability, GZ curve.
// - `solveDraftLcb`   — the search half of `findDraft0Trim` (waterline + LCB only).

import {
  applyPitchY,
  applyRollX,
  computeBounds,
  computeSurfaceAreaMm2,
  computeVolumeAndCentroid,
  computeWaterlineBeamMm,
  computeWaterlineLengthMm,
  DEFAULT_SOLVER_TRIANGLES,
  decimateMesh,
  findMaxSubmergedSection,
  isMeshUsableForHydrostatics,
  type Vec3,
} from './geometry'

/** Minimal hull input: flat interleaved xyz Float32Array (stride 9 per tri). */
export interface Mesh {
  positions: Float32Array
}

/** Accepts either a {@link Mesh} or a raw positions array (e.g. three.js). */
export type MeshLike = Mesh | Float32Array

export interface Draft0TrimResult {
  /** Draft above keel (bbox min Z) in mm — linearly interpolated between planes. */
  draftMm: number
  /**
   * Absolute waterline height (Z) in the coordinates of the `positions` this
   * call was given — NOT necessarily the hull's own, because callers hand in a
   * rotated copy. `minZ` is that copy's lowest point, so this is
   * `minZ + draftMm` in the same frame. `solveTrim` rotates its reported
   * waterline back into the hull frame; see {@link TrimSolveResult.waterlineZ}.
   */
  waterlineZ: number
  /** Displaced volume at the interpolated waterline, mm^3. */
  displacedVolumeMm3: number
  /** displacedVolumeMm3 / 1e6 — should equal targetKg for fresh water. */
  displacementKg: number
  targetKg: number
  /** Center of Buoyancy (LCB) in mesh coordinates. */
  lcb: Vec3
  /** Waterplane (cap) area at the waterline, mm^2. */
  waterplaneAreaMm2: number
  /** Sweep step used (1 mm planes, per spec). */
  stepMm: number
  /** Number of waterplane evaluations during the sweep. */
  planesEvaluated: number
  /** True when the bracket + verification volume closed on the target. */
  converged: boolean
  /** Block coefficient: Cb = V / (LWL × BWL × draft) */
  Cb: number
  /**
   * Waterline length in mm, measured at the waterline. This is NOT the
   * bounding-box length: bow and stern sit clear of the water at any sane
   * load. Exposed because it is the denominator of Cb and Cp, and because a
   * saved run needs it recorded.
   */
  LWL: number
  /** Beam at the waterline in mm, measured the same way. Denominator of Cb and Cm. */
  BWL: number
  /** Midship section area at the waterline, mm^2. */
  midshipAreaMm2: number
  /** Prismatic coefficient: Cp = V / (Am × LWL) */
  Cp: number
  /** Midship coefficient: Cm = Am / (BWL × draft) */
  Cm: number
  /** Keel to Buoyancy center (KB = LCB_z - keel_z) in mm */
  KB: number
  /** Metacentric radius (BM = Iₜ / V) in mm */
  BM: number
  /** Keel to Metacenter (KM = KB + BM) in mm */
  KM: number
  /** Metacentric height (GM = KM - KG) in mm */
  GM: number
  /** Bow freeboard: vertical distance from waterline to bow tip (+ = bow above water) */
  bowFreeboardMm: number
  /** Stern freeboard: vertical distance from waterline to stern tip (+ = stern above water) */
  sternFreeboardMm: number
  /** Heel angle applied during solve (radians → degrees for consistency) */
  heelDeg: number
  /**
   * Number of closed loops the waterplane contour resolved into at the solved
   * waterline. 1 for a watertight hull; anything else means the waterplane
   * numbers on this result are not trustworthy.
   */
  waterplaneLoopCount: number
  /** Waterplane coefficient: Cwp = Awp / (LWL × BWL). */
  Cwp: number
  /**
   * Wetted surface area of the hull, mm² — the clipped solid's surface minus
   * the waterplane cap. Used for paint/area estimates and for normalising
   * resistance figures.
   */
  wettedSurfaceAreaMm2: number
  /** Longitudinal centre of flotation (waterplane centroid x), mm. */
  waterplaneCentroidX: number
  /**
   * Waterplane longitudinal second moment of area about its own centroidal
   * axis, mm⁴. The companion of `waterplaneIx`; do not substitute one for the
   * other.
   */
  waterplaneIyyMm4: number
  /**
   * Tonnes per centimetre immersion: the mass added by 1 cm of sinkage.
   * Awp[m²] / 100 for fresh water (ρ = 1000 kg/m³).
   */
  tpcTonnesPerCm: number
}

export interface GZPoint {
  /** Heel angle in degrees (+ = the -Y side goes down) */
  heelDeg: number
  /** Righting arm in mm */
  GZ: number
  /**
   * Draft at this heel (above the keel), mm. Present once the curve reports it;
   * absent for points produced by callers that only supply the arm.
   */
  draftMm?: number
  /**
   * Clearance from the waterline to the bow/stern STEM TIP at this heel, mm
   * (min of bow and stern, taken from the extreme-X vertex — see
   * `findDraft0Trim`). It is NOT a sheer or deck-edge distance: a kayak's stem
   * tip sits well below the highest point of the deck, so this wets earlier
   * than the deck edge does. The lower anchor of the
   * {@link TrimSolveResult.endTipImmersionDeg} interpolation; 0 is the waterline
   * reaching the stem tip. Like the whole curve it is sampled on the UPRIGHT,
   * untrimmed hull — it does not follow {@link TrimSolveResult.pivot}.
   */
  minFreeboardMm?: number
}

export interface TrimSolveResult {
  /** Equilibrium trim angle in degrees (+ = bow up, - = bow down). */
  trimDeg: number
  /**
   * Equilibrium draft at midship, in mm, measured from the hull's own keel
   * (its lowest, un-rotated Z — see `waterlineZ`).
   */
  draftMm: number
  /**
   * Height of the waterline at midship, in HULL coordinates: the mesh as
   * uploaded, not the trim-rotated copy the solver solved on. The keel is the
   * hull's lowest Z in that same frame, so `draftMm` is exactly
   * `waterlineZ - keel` and the two move together — a hull that floats deeper
   * raises its waterline by precisely the draft's increase. Anything the viewer
   * or a saved run compares against hull coordinates needs this number, not
   * the tilted-frame plane the solver clipped.
   */
  waterlineZ: number
  /** Displaced volume in mm^3. */
  displacedVolumeMm3: number
  /** Displaced mass in kg. */
  displacementKg: number
  targetKg: number
  /** Center of Buoyancy in hull coordinates. */
  lcb: Vec3
  /** Target Center of Gravity in hull coordinates. */
  lcg: Vec3
  /** Rotation pivot used by solver (X, Y, Z). Matches applyPitchY pivot. */
  pivot: { x: number; y: number; z: number }
  /** Longitudinal offset between LCB and LCG (|LCB_x - LCG_x|) in mm. */
  lcbLcgOffsetMm: number
  /** Waterplane area in mm^2. */
  waterplaneAreaMm2: number
  /** Total evaluations across trim sweep. */
  planesEvaluated: number
  converged: boolean
  /** Block coefficient: Cb = V / (LWL × BWL × draft) */
  Cb: number
  /**
   * Waterline length in mm, measured at the waterline. This is NOT the
   * bounding-box length: bow and stern sit clear of the water at any sane
   * load. Exposed because it is the denominator of Cb and Cp, and because a
   * saved run needs it recorded.
   */
  LWL: number
  /** Beam at the waterline in mm, measured the same way. Denominator of Cb and Cm. */
  BWL: number
  /** Midship section area at the waterline, mm^2. */
  midshipAreaMm2: number
  /** Prismatic coefficient: Cp = V / (Am × LWL) */
  Cp: number
  /** Midship coefficient: Cm = Am / (BWL × draft) */
  Cm: number
  /** Keel to Buoyancy center (KB = LCB_z - keel_z) in mm */
  KB: number
  /** Metacentric radius (BM = Iₜ / V) in mm */
  BM: number
  /** Keel to Metacenter (KM = KB + BM) in mm */
  KM: number
  /** Metacentric height (GM = KM - KG) in mm */
  GM: number
  /** Righting arm curve points at standard heel angles (0°, 5°, 10°, 15°, 20°, 25°, 30°) */
  gzCurve: GZPoint[]
  /**
   * Bow freeboard: the bow stem tip's height above the waterline, measured in
   * hull coordinates at the bow's own station (+ = bow above water). The
   * waterline is tilted in that frame, so a bow-down trim LOWERS this value and
   * raises the stern's.
   */
  bowFreeboardMm: number
  /** Stern freeboard, same frame and station convention as the bow's. */
  sternFreeboardMm: number
  /** Fixed heel angle used in solver (degrees). + = the -Y side goes down. */
  heelDeg: number
  /**
   * Height of the centre of gravity above the keel, in mm — the KG the
   * reported `GM` is based on. A run record must state this, otherwise the
   * GM cannot be reproduced.
   */
  kgMm: number
  /**
   * Number of closed loops the waterplane contour resolved into at the solved
   * waterline. 1 for a watertight hull; anything else means the waterplane
   * numbers on this result are not trustworthy.
   */
  waterplaneLoopCount: number
  /** Waterplane coefficient: Cwp = Awp / (LWL × BWL). */
  Cwp: number
  /** Wetted surface area of the hull, mm² (clipped surface minus the cap). */
  wettedSurfaceAreaMm2: number
  /**
   * Longitudinal centre of flotation (waterplane centroid x), mm, in the
   * UNTILTED hull frame — rotated back from the pitched solve frame by the same
   * transform applied to {@link lcb}, so LCF and LCB are directly comparable.
   * Without that correction the value sits in the tilted frame and disagrees
   * with the LCG/LCB pairing by ~1 mm at the ±4.5° sweep edges.
   */
  waterplaneCentroidX: number
  /**
   * Waterplane longitudinal second moment of area about its own centroidal
   * axis, mm⁴. Companion of the transverse `waterplaneIx` inside
   * {@link Draft0TrimResult}: Iy = ∫x²dA about the waterplane centroid, the
   * LCF term, while Ix = ∫y²dA is what feeds BM. Do not substitute one for the
   * other. The transverse/longitudinal wording follows this repo's existing
   * convention on `waterplaneIx` (the axis each quantity integrates y,x about),
   * not the I_L/I_T notation of naval handbooks.
   */
  waterplaneIyyMm4: number
  /**
   * Tonnes per centimetre immersion: Awp[m²] / 100, fresh water.
   */
  tpcTonnesPerCm: number
  /**
   * Heel angle in degrees at which a hull END (bow or stern STEM TIP) first
   * reaches the water, linearly interpolated between the {@link gzCurve}
   * samples (so it is approximate to about half a sample step). 0 when the stem
   * tip is already under at rest, and null when it stays clear across the whole
   * sampled range.
   *
   * What this is NOT: a sheer or deck-edge immersion angle. The stem tip of a
   * kayak sits far below the deck edge, so this reports immersion early — it is
   * the first water at the extremity, not the first water over the deck. It is
   * also measured on the UPRIGHT, untrimmed GZ curve (see {@link compute_gz_curve_geometric}),
   * so it does not follow `fixedHeelDeg` or the solved trim: a result trimmed
   * bow-down and heeled 20° still reports the upright value here. Read it as
   * "how far can this hull be heeled, upright, before an end dips". Both
   * properties are asserted by `tests/verify-solve-extras.ts` sections 8–9.
   *
   * It comes off the same decimated solve mesh as every other number on this
   * result, so a stem tip is only as precise as the decimation that kept it —
   * measured 38.4° on the decimated mesh against 40.2° on the original for the
   * committed test hull at 150 kg.
   */
  endTipImmersionDeg: number | null
}

/** Standard heel angles to sample for the GZ curve (degrees). */
export const DEFAULT_GZ_HEEL_ANGLES_DEG = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45]

/**
 * Compute the righting arm (GZ) curve for a hull across a range of heel angles.
 *
 * This is the CLOSED-FORM wall-sided relation, kept for reference and for the
 * analytic test suites:
 *
 *     GZ(φ) = (GM + ½·BM·tan²φ) · sinφ
 *
 * It is exact for a hull whose sides stay vertical and dry, and it is verified
 * as such by tests/verify-gz.ts. It is NOT what the app plots: the relation
 * increases without bound, so it cannot represent the loss of stability that
 * capsizes a real hull. Use {@link compute_gz_curve_geometric} for output.
 *
 * @deprecated for display. Retained because it is the analytic reference the
 * geometric curve is validated against.
 */
export function compute_gz_curve(
  GM: number,
  BM: number,
  heelAnglesDeg: number[] = DEFAULT_GZ_HEEL_ANGLES_DEG,
): GZPoint[] {
  return heelAnglesDeg.map((deg) => {
    const rad = (deg * Math.PI) / 180
    const sinPhi = Math.sin(rad)
    const tanPhi = Math.tan(rad)
    // Wall-sided formula: GZ = (GM + 0.5 * BM * tan²(phi)) * sin(phi)
    const gz = (GM + 0.5 * BM * tanPhi * tanPhi) * sinPhi
    return {
      heelDeg: deg,
      GZ: Number(gz.toFixed(1)),
    }
  })
}

/** Fresh-water density: 1000 kg/m^3. */
export const RHO_KG_PER_M3 = 1000
/** mm^3 per kg of fresh-water displacement (1 kg <-> 1 L). */
export const MM3_PER_KG = 1_000_000
/**
 * Fallback height of the centre of gravity above the keel, in mm.
 *
 * Used when a caller does not supply `kgMm`. The UI exposes KG directly, so
 * this default only applies to library callers and to the test suites.
 */
export const DEFAULT_KG_MM = 280

const EPS = 1e-9
/**
 * Spatial-hash cell size (mm) used to weld coincident contour points.
 *
 * The old scheme keyed points by `round(v * WELD_QUANT)` and required an
 * EXACT string match. Two points that are coincident in space but land in
 * different 0.001 mm buckets never merged, which shattered one waterplane
 * contour into many open chains. Weld by actual distance instead, bucketed
 * into cells several times coarser than the tolerance so a true match can
 * only be in the point's own cell or an immediate neighbour.
 */
const WELD_TOL_MM = 1e-3
const WELD_CELL_MM = 1e-2

interface WeldNode {
  x: number
  y: number
  /** Adjacent contour segments (as welded node indices). */
  links: number[]
}

class WeldIndex {
  /** Numeric (cellX -> cellY -> node indices) instead of `${x}|${y}` strings. */
  private readonly buckets = new Map<number, Map<number, number[]>>()
  readonly nodes: WeldNode[] = []

  /**
   * Return the index of the node coincident with (x, y) within WELD_TOL_MM,
   * creating one if none exists. Call repeatedly with both endpoints of each
   * intersection segment to build a shared, welded adjacency graph.
   *
   * The search covers the 3x3 cell neighbourhood, but a candidate is only
   * accepted if it is the CLOSEST one found. Taking the first match instead
   * makes the result depend on insertion order, so a long contour collapses
   * into fewer nodes than a short one and coincident vertices land in
   * different buckets -- which splits the waterplane into open chains.
   *
   * The 3x3 sweep still runs dx outer / dy inner, so the candidate order --
   * and therefore which coincident point wins a distance tie -- is unchanged.
   */
  add(x: number, y: number): number {
    const cx = Math.floor(x / WELD_CELL_MM)
    const cy = Math.floor(y / WELD_CELL_MM)
    let best = -1
    let bestD = WELD_TOL_MM
    for (let dx = -1; dx <= 1; dx++) {
      const row = this.buckets.get(cx + dx)
      if (!row) continue
      for (let dy = -1; dy <= 1; dy++) {
        const list = row.get(cy + dy)
        if (!list) continue
        for (const idx of list) {
          const n = this.nodes[idx]
          const d = Math.max(Math.abs(n.x - x), Math.abs(n.y - y))
          if (d <= bestD) {
            bestD = d
            best = idx
          }
        }
      }
    }
    if (best >= 0) return best
    const idx = this.nodes.length
    this.nodes.push({ x, y, links: [] })
    let row = this.buckets.get(cx)
    if (!row) {
      row = new Map<number, number[]>()
      this.buckets.set(cx, row)
    }
    const list = row.get(cy)
    if (list) list.push(idx)
    else row.set(cy, [idx])
    return idx
  }
}

/**
 * Per-plane staging scratch for {@link clipBelowPlane}, reused across calls.
 * A straddling triangle used to build `[[x,y,z] x3]` + a flags array every time,
 * i.e. ~4 small allocations per clipped facet; at ~10k clipped facets that is
 * 40k throwaway objects per waterline and the garbage collector became the
 * second most expensive thing in the solve.
 *
 * Safe to share at module scope: the solver is single-threaded, and
 * clipBelowPlane never re-enters itself (it calls nothing but local helpers).
 * Both are fixed-length and fully rewritten on every use, so a stale slot can
 * never be read; the intersection tuple is deliberately NOT here (see ix).
 */
const CLIP_VERTS: [number, number, number, number, number, number, number, number, number] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0,
] // 3 vertices, xyz interleaved
const CLIP_FLAGS: [boolean, boolean, boolean] = [false, false, false] // vertex is in the below region

function toPositions(mesh: MeshLike): Float32Array {
  return mesh instanceof Float32Array ? mesh : mesh.positions
}

/** Signed divergence-theorem volume (winding-dependent sign, no abs). */
function signedVolumeMm3(positions: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]
    const ay = positions[i + 1]
    const az = positions[i + 2]
    const bx = positions[i + 3]
    const by = positions[i + 4]
    const bz = positions[i + 5]
    const cx = positions[i + 6]
    const cy = positions[i + 7]
    const cz = positions[i + 8]
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  }
  return sum / 6
}

interface XY {
  x: number
  y: number
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export interface ClippedBelow {
  /** Closed solid of the hull below z=h (side/bottom faces + waterplane cap). */
  clipped: Float32Array
  /** Waterplane area (sum of cap-loop |areas|), mm^2. */
  waterplaneAreaMm2: number
  /** Waterplane second moment of area about the waterplane's own centroid, mm^4. */
  waterplaneIx: number
  /**
   * Waterplane second moment of area about the waterplane's own LONGITUDINAL
   * centroidal axis, mm^4. The companion of {@link waterplaneIx} on the other
   * axis: I_x is the transverse moment (it drives BM and GM), I_y is the
   * longitudinal one (trim metacentre, LCF context). On a slender hull I_y is
   * roughly (LWL/BWL)^2 times larger, so a transposed pair is easy to spot and
   * fatal to ship if it is not spotted.
   */
  waterplaneIyyMm4: number
  /**
   * Longitudinal centre of flotation: the x coordinate of the waterplane
   * centroid, in mesh coordinates. The trim rotates about this point, so it is
   * the reference every trim statement is measured from.
   */
  waterplaneCentroidX: number
  /**
   * Number of distinct closed loops the waterplane contour resolved into.
   * A watertight hull cut by a single plane must give exactly 1. More than
   * one means the contour was fragmented (bad welding, or a genuinely
   * multi-lobe waterplane), and *none* means the cut closed no contour at
   * all, so area and second moment are 0 and BM collapses to 0. Either way
   * the numbers below are not trustworthy — callers must warn on `!== 1`.
   */
  waterplaneLoopCount: number
}

/**
 * Clip a closed mesh to the half-space z <= h and close the cut with a
 * waterplane cap, returning a closed solid whose divergence-theorem volume is
 * the displaced volume below the waterline.
 *
 * Cap triangulation: intersection segments are welded (0.001 mm), walked into
 * ordered loop(s), then centroid fan-triangulated with winding matched to the
 * input mesh orientation. Accurate for the convex / single-loop sections a
 * hull waterplane normally produces; multi-lobe or highly concave sections
 * are approximated loop-by-loop.
 */
export function clipBelowPlane(positions: Float32Array, h: number): ClippedBelow {
  const out: number[] = []
  const segX1: number[] = []
  const segY1: number[] = []
  const segX2: number[] = []
  const segY2: number[] = []
  let waterplaneIx = 0
  let waterplaneIyyMm4 = 0

  const pushTri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }

  // One 2-tuple per clipBelowPlane call, not per crossing. A crossing result is
  // only valid until the next ix() call, so every call site destructures it
  // immediately; scoping the slot to the call keeps that constraint local to
  // this function instead of hiding it at module scope, where nothing at the
  // call site hints that the tuple is shared.
  const clipPoint: [number, number] = [0, 0]

  // Intersection of edge p->q with the plane z=h (caller guarantees straddle).
  // Writes into clipPoint and returns it, so the result stays valid only until
  // the next ix() call: destructure it at the call site before computing the
  // second intersection.
  const ix = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): readonly [number, number] => {
    // Both endpoints can sit exactly in the cutting plane (a facet coplanar
    // with the waterline, which happens routinely on a heeled hull). That
    // makes bz - az zero and t = inf/NaN, and a single NaN node poisons the
    // whole contour walk. Clamp t to the endpoints in that case.
    const dz = bz - az
    if (Math.abs(dz) < EPS) {
      clipPoint[0] = ax
      clipPoint[1] = ay
      return clipPoint
    }
    const t = (h - az) / dz
    clipPoint[0] = lerp(ax, bx, t)
    clipPoint[1] = lerp(ay, by, t)
    return clipPoint
  }

  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]
    const ay = positions[i + 1]
    const az = positions[i + 2]
    const bx = positions[i + 3]
    const by = positions[i + 4]
    const bz = positions[i + 5]
    const cx = positions[i + 6]
    const cy = positions[i + 7]
    const cz = positions[i + 8]

    // Skip zero-area triangles outright. Mesh decimation can collapse a
    // triangle's vertices onto one point; such a face has no volume and no
    // usable waterplane crossing, and letting it through emits a zero-length
    // contour segment that shatters the waterplane into open chains. They
    // are ignored here rather than stripped from the mesh, which would tear
    // holes in it and break watertightness.
    const e1x = bx - ax
    const e1y = by - ay
    const e1z = bz - az
    const e2x = cx - ax
    const e2y = cy - ay
    const e2z = cz - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    // Squared magnitude against the SQUARED threshold, instead of
    // Math.hypot() against the linear one. hypot is a non-inlined runtime call
    // that spends its effort defending against over/underflow this loop cannot
    // produce (hull coordinates are millimetres), and sqrt(x^2+y^2+z^2) is
    // equivalent to it to within one rounding step. That is NOT bit-identity:
    // the decision can differ only for a magnitude landing within ~1 ULP
    // (relative ~1e-16, so ~1e-25 mm^2 either side of the 1e-9 mm^2 threshold)
    // -- a triangle degenerate to within double precision anyway.
    const nx2 = nx * nx + ny * ny + nz * nz
    if (nx2 < 1e-18) continue

    // Fast reject/accept on the triangle Z-range before per-vertex work.
    const triMin = Math.min(az, bz, cz)
    const triMax = Math.max(az, bz, cz)
    if (triMin > h + EPS) continue // fully above
    if (triMax <= h + EPS) {
      pushTri(ax, ay, az, bx, by, bz, cx, cy, cz)
      continue
    }

    const da = az - h
    const db = bz - h
    const dc = cz - h
    const aIn = da <= EPS
    const bIn = db <= EPS
    const cIn = dc <= EPS
    const nIn = (aIn ? 1 : 0) + (bIn ? 1 : 0) + (cIn ? 1 : 0)
    if (nIn === 3) {
      pushTri(ax, ay, az, bx, by, bz, cx, cy, cz)
      continue
    }
    if (nIn === 0) continue

    // Straddle cases, dispatched on the odd vertex index so the emitted
    // triangles keep the original cyclic order (winding). Vertex i lives at
    // CLIP_VERTS[i*3], its cyclic successor at ((i+1)%3)*3 and its predecessor
    // at ((i+2)%3)*3 — the same index arithmetic nxt()/prv() used, over flat
    // shared storage instead of three freshly allocated arrays.
    CLIP_VERTS[0] = ax
    CLIP_VERTS[1] = ay
    CLIP_VERTS[2] = az
    CLIP_VERTS[3] = bx
    CLIP_VERTS[4] = by
    CLIP_VERTS[5] = bz
    CLIP_VERTS[6] = cx
    CLIP_VERTS[7] = cy
    CLIP_VERTS[8] = cz
    CLIP_FLAGS[0] = aIn
    CLIP_FLAGS[1] = bIn
    CLIP_FLAGS[2] = cIn

    if (nIn === 1) {
      // Below vertex i, crossings on both its outgoing edges.
      const i = CLIP_FLAGS[0] ? 0 : CLIP_FLAGS[1] ? 1 : 2
      const i3 = i * 3
      const n3 = ((i + 1) % 3) * 3
      const p3 = ((i + 2) % 3) * 3
      const [e1x, e1y] = ix(
        CLIP_VERTS[i3],
        CLIP_VERTS[i3 + 1],
        CLIP_VERTS[i3 + 2],
        CLIP_VERTS[n3],
        CLIP_VERTS[n3 + 1],
        CLIP_VERTS[n3 + 2],
      )
      const [e2x, e2y] = ix(
        CLIP_VERTS[i3],
        CLIP_VERTS[i3 + 1],
        CLIP_VERTS[i3 + 2],
        CLIP_VERTS[p3],
        CLIP_VERTS[p3 + 1],
        CLIP_VERTS[p3 + 2],
      )
      pushTri(CLIP_VERTS[i3], CLIP_VERTS[i3 + 1], CLIP_VERTS[i3 + 2], e1x, e1y, h, e2x, e2y, h)
      pushSeg(e1x, e1y, e2x, e2y)
    } else {
      // Above vertex i; below-region quad (F, PNext, PPrev, G) in cyclic
      // order, where F/G sit on the i→next / prev→i edges.
      const i = !CLIP_FLAGS[0] ? 0 : !CLIP_FLAGS[1] ? 1 : 2
      const i3 = i * 3
      const n3 = ((i + 1) % 3) * 3
      const p3 = ((i + 2) % 3) * 3
      const [fX, fY] = ix(
        CLIP_VERTS[i3],
        CLIP_VERTS[i3 + 1],
        CLIP_VERTS[i3 + 2],
        CLIP_VERTS[n3],
        CLIP_VERTS[n3 + 1],
        CLIP_VERTS[n3 + 2],
      )
      const [gX, gY] = ix(
        CLIP_VERTS[p3],
        CLIP_VERTS[p3 + 1],
        CLIP_VERTS[p3 + 2],
        CLIP_VERTS[i3],
        CLIP_VERTS[i3 + 1],
        CLIP_VERTS[i3 + 2],
      )
      pushTri(
        fX,
        fY,
        h,
        CLIP_VERTS[n3],
        CLIP_VERTS[n3 + 1],
        CLIP_VERTS[n3 + 2],
        CLIP_VERTS[p3],
        CLIP_VERTS[p3 + 1],
        CLIP_VERTS[p3 + 2],
      )
      pushTri(fX, fY, h, CLIP_VERTS[p3], CLIP_VERTS[p3 + 1], CLIP_VERTS[p3 + 2], gX, gY, h)
      pushSeg(fX, fY, gX, gY)
    }
  }

  function pushSeg(x1: number, y1: number, x2: number, y2: number): void {
    const dx = x2 - x1
    const dy = y2 - y1
    if (dx * dx + dy * dy < 1e-18) return // degenerate (vertex-on-plane sliver)
    segX1.push(x1)
    segY1.push(y1)
    segX2.push(x2)
    segY2.push(y2)
  }

  let waterplaneAreaMm2 = 0
  // Waterplane-centroid accumulators, summed over loops as unsigned areas so
  // the result does not depend on the winding of each loop.
  let lcAreaSum = 0
  let lcMomentSum = 0
  const loops: XY[][] = []

  if (segX1.length > 0) {
    // Weld endpoints by proximity, dedupe segments, build adjacency.
    const weld = new WeldIndex()
    const seenSeg = new Set<string>()
    for (let s = 0; s < segX1.length; s++) {
      const n1 = weld.add(segX1[s], segY1[s])
      const n2 = weld.add(segX2[s], segY2[s])
      if (n1 === n2) continue
      const canon = n1 <= n2 ? `${n1}~${n2}` : `${n2}~${n1}`
      if (seenSeg.has(canon)) continue
      seenSeg.add(canon)
      weld.nodes[n1].links.push(n2)
      weld.nodes[n2].links.push(n1)
    }

    // Match cap winding to the input solid: outward cap normal is +Z when the
    // source mesh has positive (outward) signed volume, -Z when it is wound
    // inward. (volumeBelowPlane re-derives this per call via signedVolumeMm3.)
    const outward = signedVolumeMm3(positions) >= 0

    // Walk every unvisited edge into ordered loops.
    const visited = new Set<string>()
    const canonOf = (a: number, b: number) => (a <= b ? `${a}~${b}` : `${b}~${a}`)
    for (const seed of seenSeg) {
      if (visited.has(seed)) continue
      visited.add(seed)
      const [sa, sb] = seed.split('~').map(Number)
      const loopNodes = [sa, sb]
      let prev = sa
      let cur = sb
      for (let guard = 0; guard < seenSeg.size + 2; guard++) {
        if (cur === sa) break // closed
        const nexts = weld.nodes[cur].links
        let nxt: number | null = null
        for (const n of nexts) {
          if (n === prev) continue
          if (!visited.has(canonOf(cur, n))) {
            nxt = n
            break
          }
        }
        if (nxt === null) break // open chain / dead end
        visited.add(canonOf(cur, nxt))
        loopNodes.push(nxt)
        prev = cur
        cur = nxt
      }
      if (loopNodes.length >= 3) {
        // An unterminated walk is an open chain, not a waterplane contour.
        // Capping it produces a phantom loop whose sliver area and noisy
        // second moment corrupt the BM sum -- discard it instead.
        if (loopNodes[loopNodes.length - 1] !== loopNodes[0]) continue
        const pts: XY[] = []
        const nodes = loopNodes.slice(0, -1) // drop the duplicated closing node
        for (const idx of nodes) {
          const n = weld.nodes[idx]
          pts.push({ x: n.x, y: n.y })
        }
        if (pts.length >= 3) loops.push(pts)
      }
    }

    for (const pts of loops) {
      let signedArea = 0
      let Ix = 0 // second moment of area about the X axis through Y=0
      let Iy = 0 // second moment of area about the Y axis through X=0
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]
        const q = pts[(k + 1) % pts.length]
        const cross = p.x * q.y - q.x * p.y
        signedArea += cross
        // I contribution for this edge: (y₁² + y₁y₂ + y₂²) * (x₁y₂ - x₂y₁) / 12
        Ix += (p.y * p.y + p.y * q.y + q.y * q.y) * cross
        // Same edge integral with the roles of x and y exchanged — this is the
        // OTHER axis, so the two moments cannot be transposed by accident.
        Iy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross
      }
      signedArea /= 2
      if (Math.abs(signedArea) < 1e-9) continue
      const A = Math.abs(signedArea)

      // Shoelace area centroid. Needed for the parallel-axis correction
      // below AND for the cap fan, so it must be computed before either.
      let mcx = 0
      let mcy = 0
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]
        const q = pts[(k + 1) % pts.length]
        const cross = p.x * q.y - q.x * p.y
        mcx += (p.x + q.x) * cross
        mcy += (p.y + q.y) * cross
      }
      const sixA = 6 * signedArea
      const cx = sixA !== 0 ? mcx / sixA : 0
      const cy = sixA !== 0 ? mcy / sixA : 0

      waterplaneAreaMm2 += A
      // Parallel axis theorem: I(Y=0) = I_c + A·y_c², so the centroidal
      // second moment is I(Y=0) − A·y_c². Without this the value carries a
      // spurious A·y_c² term whenever the waterplane sits off the
      // centreline — i.e. at heel, or on an asymmetric hull.
      // The shoelace cross product flips sign with the loop's winding, so
      // abs() each loop's Ix; the correction term is already unsigned.
      waterplaneIx += Math.max(0, Math.abs(Ix) / 12 - A * cy * cy)
      // The longitudinal companion: identical formula, x instead of y.
      // Keeping the sign/abs convention the same as Ix above is what makes the
      // pair comparable — see the parallel comment on `waterplaneIyyMm4`.
      waterplaneIyyMm4 += Math.max(0, Math.abs(Iy) / 12 - A * cx * cx)
      // LCF is an area-weighted mean of the loop centroids.
      lcAreaSum += A
      lcMomentSum += A * cx
      // Fan needs CCW order for a +Z (outward) cap, CW for inward.
      const wantCCW = outward
      const isCCW = signedArea > 0
      const ordered = wantCCW === isCCW ? pts : [...pts].reverse()
      for (let k = 0; k < ordered.length; k++) {
        const p = ordered[k]
        const q = ordered[(k + 1) % ordered.length]
        out.push(cx, cy, h, p.x, p.y, h, q.x, q.y, h)
      }
    }
  }

  return {
    clipped: new Float32Array(out),
    waterplaneAreaMm2,
    waterplaneIx,
    waterplaneIyyMm4,
    waterplaneCentroidX: lcAreaSum > 0 ? lcMomentSum / lcAreaSum : 0,
    waterplaneLoopCount: loops.length,
  }
}

/**
 * Displaced volume (mm^3) of the hull below the horizontal plane z = h.
 * Thin wrapper over {@link clipBelowPlane} + divergence-theorem volume.
 */
export function volumeBelowPlane(positions: Float32Array, h: number): number {
  const { clipped } = clipBelowPlane(positions, h)
  if (clipped.length === 0) return 0
  return Math.abs(signedVolumeMm3(clipped))
}

/**
 * Draft at zero trim for a target mass.
 *
 * Sweeps the waterplane **downwards from the deck in 1 mm planes**, clipping
 * the mesh below each plane and measuring the capped volume, until the
 * displaced volume brackets the target (V_upper >= V_target >= V_lower).
 * The final draft is linearly interpolated between the two bracketing planes
 * for sub-millimetre accuracy, then re-verified by clipping exactly at the
 * interpolated waterline — so `displacementKg` confirms the weight balance.
 *
 * @param mesh Hull mesh (Z-up; draft measured from bbox min Z = keel).
 * @param target_kg Target displacement mass in kg (fresh water, 1 kg = 1 L).
 * @param KG Optional center of gravity height above keel (mm) for GM calculation.
 * @param heelRad Optional heel angle in radians. Positive = the -Y side goes down (see
 *   `applyRollX`); applied as an X-rotation before solving.
 * @throws when the target is non-positive or exceeds the hull's total volume.
 */
/**
 * Waterline + LCB only — the search half of {@link findDraft0Trim}.
 *
 * `solveTrim` sweeps the trim window coarse-then-fine (~30 candidate angles
 * on the app's ±4.5° window) and ranks them by how closely LCB tracks
 * LCG. The sweep reads only `draftMm` and `lcb.x`; everything else the full
 * solve computes — Cb, Cp, Cm, KB, BM, KM, GM, freeboard, the GZ curve — is
 * discarded for all but the winning angle. Deriving those on every trial
 * instead of once on the winner was the single largest cost in a solve,
 * dominated by `findMaxSubmergedSection` at 335 ms per call.
 *
 * This function performs the identical bracket (10 mm steps) and bisection
 * (16 iterations, 0.05 mm window) and returns the same draft and LCB. The
 * coefficient work happens only at the chosen waterline, after the sweep, in
 * the full function — so the numbers the user sees are still produced by one
 * code path.
 *
 * Verified bit-identical to the full solve across 4 masses, 4 heel angles and
 * 5 trim angles on three hulls; `tests/verify-trim-search.ts` holds that gate.
 *
 * @throws when the target is non-positive or exceeds the hull's total volume.
 */
export function solveDraftLcb(
  mesh: MeshLike,
  target_kg: number,
  heelRad?: number,
): {
  draftMm: number
  waterlineZ: number
  displacedVolumeMm3: number
  lcb: Vec3
  planesEvaluated: number
} {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('solveDraftLcb: empty mesh')
  if (!Number.isFinite(target_kg) || target_kg <= 0) {
    throw new Error(`solveDraftLcb: target_kg must be > 0 (got ${target_kg})`)
  }

  // Heel first, about the hull bounding-box centre — identical to the block in
  // findDraft0Trim. Order matters: the bracket must use the *heeled* mesh's
  // bounds, because a 20 deg roll lifts the low deck corner and the unheeled
  // maxZ is the wrong ceiling.
  //
  // The buffer must be a COPY. `new Float32Array(n)` is zero-filled, and the
  // rotation below writes each result in place without reading the source, so
  // an uninitialised buffer rotates nothing and collapses the hull to a flat
  // sliver at the origin.
  let workingPositions = positions
  if (heelRad && Math.abs(heelRad) > 1e-10) {
    const pivot = computeBounds(positions)
    workingPositions = new Float32Array(positions)
    applyRollX(workingPositions, heelRad, pivot.center.y, pivot.center.z)
  }

  const bounds = computeBounds(workingPositions)
  const minZ = bounds.min.z
  const maxZ = bounds.max.z
  const targetVolumeMm3 = target_kg * MM3_PER_KG

  let planesEvaluated = 1
  const upperV = volumeBelowPlane(workingPositions, maxZ)
  if (upperV <= targetVolumeMm3) {
    const { clipped } = clipBelowPlane(workingPositions, maxZ)
    const { volumeMm3, centroid } = computeVolumeAndCentroid(clipped)
    planesEvaluated++
    return {
      draftMm: maxZ - minZ,
      waterlineZ: maxZ,
      displacedVolumeMm3: volumeMm3,
      // Force transverse symmetry: the hull is symmetric about its own
      // centreline, so a measured LCB_y is noise, not information.
      lcb: { x: centroid.x, y: bounds.center.y, z: centroid.z },
      planesEvaluated,
    }
  }

  // Bracket: coarse scan down from the deck until the target is bracketed.
  let lo = minZ
  let hi = maxZ
  let waterlineZ = maxZ
  for (let h = maxZ - 10; h >= minZ; h -= 10) {
    const v = volumeBelowPlane(workingPositions, h)
    planesEvaluated++
    if (v <= targetVolumeMm3) {
      hi = h + 10
      lo = h
      break
    }
  }

  // Bisect. volumeBelowPlane increases with Z, so too little volume needs a
  // higher plane (lo = mid) and too much needs a lower one (hi = mid).
  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2
    const v = volumeBelowPlane(workingPositions, mid)
    planesEvaluated++
    if (v < targetVolumeMm3) {
      lo = mid
    } else {
      hi = mid
    }
    waterlineZ = mid
    if (hi - lo < 0.05) break
  }

  const { clipped } = clipBelowPlane(workingPositions, waterlineZ)
  const { volumeMm3, centroid } = computeVolumeAndCentroid(clipped)
  planesEvaluated++

  return {
    draftMm: waterlineZ - minZ,
    waterlineZ,
    displacedVolumeMm3: volumeMm3,
    // Force transverse symmetry: the hull is symmetric about its own
    // centreline, so a measured LCB_y is noise, not information.
    lcb: { x: centroid.x, y: bounds.center.y, z: centroid.z },
    planesEvaluated,
  }
}

/**
 * Waterplane extras, shared by both of `findDraft0Trim`'s return paths.
 *
 * Cwp's denominator uses the RAW LWL/BWL, not the 0.1 mm-rounded values the
 * result reports, so the coefficient is not polluted by display rounding. The
 * cap is part of `clip.clipped`, so subtracting Awp from the clipped solid's
 * total surface leaves the wetted hull area.
 */
function waterplaneExtras(
  clip: ClippedBelow,
  lwlMm: number,
  bwlMm: number,
): {
  waterplaneLoopCount: number
  Cwp: number
  wettedSurfaceAreaMm2: number
  waterplaneCentroidX: number
  waterplaneIyyMm4: number
  tpcTonnesPerCm: number
} {
  const { clipped, waterplaneAreaMm2, waterplaneCentroidX, waterplaneIyyMm4, waterplaneLoopCount } =
    clip
  return {
    waterplaneLoopCount,
    Cwp: lwlMm > 0 && bwlMm > 0 ? waterplaneAreaMm2 / (lwlMm * bwlMm) : 0,
    wettedSurfaceAreaMm2: Math.max(0, computeSurfaceAreaMm2(clipped) - waterplaneAreaMm2),
    waterplaneCentroidX,
    waterplaneIyyMm4,
    // Fresh water (ρ = 1000 kg/m³): 1 cm of extra sinkage displaces Awp[m²]/100 t.
    tpcTonnesPerCm: waterplaneAreaMm2 / 1_000_000 / 100,
  }
}

export function findDraft0Trim(
  mesh: MeshLike,
  target_kg: number,
  KG?: number,
  heelRad?: number,
): Draft0TrimResult {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('findDraft0Trim: empty mesh')
  if (!Number.isFinite(target_kg) || target_kg <= 0) {
    throw new Error(`findDraft0Trim: target_kg must be > 0 (got ${target_kg})`)
  }

  // Apply heel rotation (X-axis) if specified.
  //
  // This function is the SINGLE owner of heel: `solveTrim` passes the angle
  // in here rather than rolling the mesh itself. Rolling in both places
  // composed the two rotations, so a requested 20 deg floated as 40 deg —
  // and because the two used different pivots (the hull centre vs the origin)
  // the result was not even a consistent 40 deg. The pivot is the hull's
  // bounding-box centre, so it is independent of where the mesh sits in world Z.
  let workingPositions = positions
  if (heelRad && Math.abs(heelRad) > 1e-10) {
    const pivot = computeBounds(positions)
    workingPositions = new Float32Array(positions.length)
    const cosH = Math.cos(heelRad)
    const sinH = Math.sin(heelRad)
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1] - pivot.center.y
      const z = positions[i + 2] - pivot.center.z
      workingPositions[i] = positions[i] // X unchanged
      workingPositions[i + 1] = y * cosH - z * sinH + pivot.center.y
      workingPositions[i + 2] = y * sinH + z * cosH + pivot.center.z
    }
  }

  const bounds = computeBounds(workingPositions)
  const minZ = bounds.min.z
  const maxZ = bounds.max.z
  const targetVolumeMm3 = target_kg * MM3_PER_KG

  const totalVolumeMm3 = Math.abs(signedVolumeMm3(positions))
  if (targetVolumeMm3 > totalVolumeMm3) {
    throw new Error(
      `findDraft0Trim: target ${(targetVolumeMm3 / 1_000_000).toFixed(1)} L exceeds ` +
        `hull volume ${(totalVolumeMm3 / 1_000_000).toFixed(1)} L — hull would sink`,
    )
  }

  const stepMm = 1
  let planesEvaluated = 0

  // Volume at the deck plane (h = maxZ) is the total hull volume.
  const upperH = maxZ
  const upperV = volumeBelowPlane(workingPositions, upperH)
  planesEvaluated++

  // Degenerate case: target equals total volume — floating at the deck edge.
  if (upperV <= targetVolumeMm3) {
    const clip = clipBelowPlane(workingPositions, upperH)
    const { clipped, waterplaneAreaMm2, waterplaneIx } = clip
    const { centroid: lcb } = computeVolumeAndCentroid(clipped)
    const draftMm = maxZ - minZ
    const LWL = computeWaterlineLengthMm(workingPositions, upperH) || bounds.size.x
    const BWL = computeWaterlineBeamMm(workingPositions, upperH) || bounds.size.y
    const boxVolumeMm3 = LWL * BWL * draftMm
    const Cb = boxVolumeMm3 > 0 ? upperV / boxVolumeMm3 : 0
    // Max submerged section + the rectangle it fits in (station-matched)
    const maxSection = findMaxSubmergedSection(workingPositions, bounds.min.x, bounds.max.x, upperH)
    const midshipAreaMm2 = maxSection.areaMm2
    const Cp = midshipAreaMm2 > 0 && LWL > 0 ? upperV / (midshipAreaMm2 * LWL) : 0
    // Cm = Am / (beam at that station x depth at that station)
    const cmRect = maxSection.beamMm * maxSection.depthMm
    const Cm = cmRect > 0 ? midshipAreaMm2 / cmRect : 0
    // Keel to Buoyancy center: KB = LCB_z - keel_z
    const KB = lcb.z - minZ
    // Metacentric radius: BM = Iₜ / V
    const BM = waterplaneIx > 0 ? waterplaneIx / upperV : 0
    // Keel to Metacenter: KM = KB + BM
    const KM = KB + BM
    // Metacentric height: GM = KM - KG (if KG provided)
    const GM = typeof KG === 'number' ? KM - KG : 0
    // Freeboard at bow/stern: find actual bow/stern tip Z from mesh vertices (zero trim)
    let bowX = -Infinity
    let sternX = Infinity
    let bowZ = 0
    let sternZ = 0
    for (let i = 0; i < workingPositions.length; i += 9) {
      for (const vx of [i, i + 3, i + 6]) {
        const x = workingPositions[vx]
        const z = workingPositions[vx + 2]
        if (x > bowX) {
          bowX = x
          bowZ = z
        }
        if (x < sternX) {
          sternX = x
          sternZ = z
        }
      }
    }
    const waterlineAtBow = maxZ - bowX * Math.tan(0)
    const waterlineAtStern = maxZ - sternX * Math.tan(0)
    const bowFreeboardMm = bowZ - waterlineAtBow
    const sternFreeboardMm = sternZ - waterlineAtStern
    return {
      draftMm,
      waterlineZ: maxZ,
      displacedVolumeMm3: upperV,
      displacementKg: upperV / MM3_PER_KG,
      targetKg: target_kg,
      lcb,
      waterplaneAreaMm2,
      stepMm,
      planesEvaluated,
      converged: Math.abs(upperV - targetVolumeMm3) / targetVolumeMm3 < 1e-6,
      Cb: Number(Cb.toFixed(4)),
      /** Waterline length in mm, measured at the waterline (not the bounding box). */
      LWL: Number(LWL.toFixed(1)),
      /** Beam at the waterline in mm. */
      BWL: Number(BWL.toFixed(1)),
      midshipAreaMm2: Number(midshipAreaMm2.toFixed(1)),
      Cp: Number(Cp.toFixed(4)),
      Cm: Number(Cm.toFixed(4)),
      KB: Number(KB.toFixed(1)),
      BM: Number(BM.toFixed(1)),
      KM: Number(KM.toFixed(1)),
      GM: Number(GM.toFixed(1)),
      bowFreeboardMm: Number(bowFreeboardMm.toFixed(1)),
      sternFreeboardMm: Number(sternFreeboardMm.toFixed(1)),
      heelDeg: heelRad ? (heelRad * 180) / Math.PI : 0,
      ...waterplaneExtras(clip, LWL, BWL),
    }
  }

  // Binary search: find waterline Z so volumeBelowPlane(workingPositions, Z) ≈ target.
  // V(h) decreases monotonically as h drops from maxZ to minZ, so bisection
  // converges quickly. Bracket phase steps down in 10 mm increments, then bisects.
  let lo = minZ
  let hi = upperH
  let waterlineZ = upperH

  // Bracket: coarse scan to narrow the range to a 10mm window.
  for (let h = maxZ - 10; h >= minZ; h -= 10) {
    const v = volumeBelowPlane(workingPositions, h)
    planesEvaluated++
    if (v <= targetVolumeMm3) {
      hi = h + 10 // upper bound (just above the crossing)
      lo = h // lower bound (just below)
      break
    }
    waterlineZ = h // keep stepping; still above target
  }

  // Bisect to sub-millimetre precision.
  // Note: volumeBelowPlane increases with higher Z (more of hull is submerged below plane).
  // So if v < targetVolume, we need higher Z (lo = mid).
  // If v > targetVolume, we need lower Z (hi = mid).
  for (let iter = 0; iter < 16; iter++) {
    const mid = (lo + hi) / 2
    const v = volumeBelowPlane(workingPositions, mid)
    planesEvaluated++
    if (v < targetVolumeMm3) {
      lo = mid
    } else {
      hi = mid
    }
    waterlineZ = mid
    if (hi - lo < 0.05) break // sub-mm convergence (0.05 mm window)
  }

  // Verification pass: clip exactly at the interpolated waterline so the
  // returned displacement is a measured mesh volume, not the interpolation.
  const clip = clipBelowPlane(workingPositions, waterlineZ)
  const { clipped, waterplaneAreaMm2, waterplaneIx } = clip
  const { volumeMm3: verifiedVolumeMm3, centroid: lcb } = computeVolumeAndCentroid(clipped)
  planesEvaluated += 1

  // Force transverse symmetry: LCB Y = hull centerline
  const boundsForLcb = computeBounds(workingPositions)
  lcb.y = boundsForLcb.center.y

  const displacementKg = verifiedVolumeMm3 / MM3_PER_KG
  const relErr = Math.abs(verifiedVolumeMm3 - targetVolumeMm3) / targetVolumeMm3

  // Compute Block Coefficient (Cb): Cb = V / (LWL × BWL × draft)
  // LWL: length of the ACTUAL waterline (x-extent at waterlineZ).
  //      Using the bounding box here overstates the length — the bow
  //      and stern sit clear of the water at any sane load.
  // BWL: mean waterline beam = waterplane area / LWL
  // draft: draft above keel
  const draftMm = waterlineZ - minZ
  const LWL = computeWaterlineLengthMm(workingPositions, waterlineZ) || bounds.size.x
  const BWL = computeWaterlineBeamMm(workingPositions, waterlineZ) || bounds.size.y
  const boxVolumeMm3 = LWL * BWL * draftMm
  const Cb = boxVolumeMm3 > 0 ? verifiedVolumeMm3 / boxVolumeMm3 : 0
  // Midship section area and Prismatic Coefficient
  // Max SUBMERGED section + the rectangle it fits in.
  // Cm's denominator must come from the same station as
  // the numerator, or Cm exceeds 1 (physically impossible).
  const maxSection = findMaxSubmergedSection(
    workingPositions,
    bounds.min.x,
    bounds.max.x,
    waterlineZ,
  )
  const midshipAreaMm2 = maxSection.areaMm2
  const Cp = midshipAreaMm2 > 0 && LWL > 0 ? verifiedVolumeMm3 / (midshipAreaMm2 * LWL) : 0
  // Midship coefficient: Am / (station beam x station depth)
  const cmRect = maxSection.beamMm * maxSection.depthMm
  const Cm = cmRect > 0 ? midshipAreaMm2 / cmRect : 0
  // Keel to Buoyancy center: KB = LCB_z - keel_z
  const KB = lcb.z - minZ
  // Metacentric radius: BM = Iₜ / V
  const BM = waterplaneIx > 0 ? waterplaneIx / verifiedVolumeMm3 : 0
  // Keel to Metacenter: KM = KB + BM
  const KM = KB + BM
  // Metacentric height: GM = KM - KG (if KG provided)
  const GM = typeof KG === 'number' ? KM - KG : 0
  // Freeboard at bow/stern: find actual bow/stern tip Z from mesh vertices (zero trim)
  let bowX = -Infinity
  let sternX = Infinity
  let bowZ = 0
  let sternZ = 0
  for (let i = 0; i < workingPositions.length; i += 9) {
    for (const vx of [i, i + 3, i + 6]) {
      const x = workingPositions[vx]
      const z = workingPositions[vx + 2]
      if (x > bowX) {
        bowX = x
        bowZ = z
      }
      if (x < sternX) {
        sternX = x
        sternZ = z
      }
    }
  }
  const waterlineAtBow = waterlineZ - bowX * Math.tan(0)
  const waterlineAtStern = waterlineZ - sternX * Math.tan(0)
  const bowFreeboardMm = bowZ - waterlineAtBow
  const sternFreeboardMm = sternZ - waterlineAtStern
  return {
    draftMm,
    waterlineZ,
    displacedVolumeMm3: verifiedVolumeMm3,
    displacementKg,
    targetKg: target_kg,
    lcb,
    waterplaneAreaMm2,
    stepMm,
    planesEvaluated,
    converged: relErr < 0.01,
    Cb: Number(Cb.toFixed(4)),
    /** Waterline length in mm, measured at the waterline (not the bounding box). */
    LWL: Number(LWL.toFixed(1)),
    /** Beam at the waterline in mm. */
    BWL: Number(BWL.toFixed(1)),
    midshipAreaMm2: Number(midshipAreaMm2.toFixed(1)),
    Cp: Number(Cp.toFixed(4)),
    Cm: Number(Cm.toFixed(4)),
    KB: Number(KB.toFixed(1)),
    BM: Number(BM.toFixed(1)),
    KM: Number(KM.toFixed(1)),
    GM: Number(GM.toFixed(1)),
    bowFreeboardMm: Number(bowFreeboardMm.toFixed(1)),
    sternFreeboardMm: Number(sternFreeboardMm.toFixed(1)),
    heelDeg: heelRad ? (heelRad * 180) / Math.PI : 0,
    ...waterplaneExtras(clip, LWL, BWL),
  }
}

/**
 * Measured righting-arm (GZ) curve — the curve the app plots.
 *
 * GZ is measured, not modelled: at each angle the hull is heeled, sunk to the
 * same displacement, and GZ is read off the centroid of the immersed volume.
 * That IS the definition of GZ — the horizontal gap between the line of action
 * of buoyancy and the line of action of weight — so no wall-sided assumption is
 * involved and the curve turns over when the hull really loses stability.
 *
 * Why not {@link compute_gz_curve}: the wall-sided closed form
 * `(GM + ½·BM·tan²φ)·sinφ` grows without bound, so it can only ever report a
 * more stable boat than exists. On the test hull it reads 76.9 mm at 30° where
 * the measured arm is 18.1 mm, and it never crosses zero. Substituting a
 * measured BM(φ) does not rescue it either — KM(φ) = KB(φ) + BM(φ) inherits
 * the rise in KB(φ), which pushes the other way. The shape is the problem.
 *
 * Cost: one heeled draft solve per angle. Callers should pass the mesh that
 * `solveTrim` already decimated — on the test hull that is 2.87x cheaper than
 * the raw mesh (353 ms vs 1013 ms per angle) and moves BM by <= 0.2 mm.
 *
 * @param solveMesh  Hull to float. Reuse the decimated mesh where possible.
 * @param target_kg  Displacement held constant across every angle.
 * @param KG         Height of the centre of gravity above the keel, in mm.
 * @param heelAnglesDeg  Angles to sample; defaults to {@link DEFAULT_GZ_HEEL_ANGLES_DEG}.
 */
export function compute_gz_curve_geometric(
  solveMesh: MeshLike,
  target_kg: number,
  KG: number,
  heelAnglesDeg: number[] = DEFAULT_GZ_HEEL_ANGLES_DEG,
): GZPoint[] {
  const positions = toPositions(solveMesh)
  if (positions.length === 0) throw new Error('compute_gz_curve_geometric: empty mesh')

  const bounds = computeBounds(positions)
  const heeled = new Float32Array(positions.length)

  return heelAnglesDeg.map((deg) => {
    const phi = (deg * Math.PI) / 180
    if (Math.abs(phi) < 1e-12) {
      // GZ is identically zero at zero heel, so the arm is not measured here.
      // The draft and deck freeboard still are: the 0° point is the lower
      // anchor of the deck-edge immersion interpolation in `solveTrim`, and
      // without it the first interpolation step has nothing to interpolate
      // from. One draft solve per curve is the price of that anchor.
      const r = findDraft0Trim(positions, target_kg, KG, 0)
      return {
        heelDeg: deg,
        GZ: 0,
        draftMm: r.draftMm,
        minFreeboardMm: Math.min(r.bowFreeboardMm, r.sternFreeboardMm),
      }
    }

    // Heel about the hull's own centre, matching how findDraft0Trim applies
    // roll internally. Reuse one buffer; each angle overwrites it.
    heeled.set(positions)
    applyRollX(heeled, phi, bounds.center.y, bounds.center.z)

    // Sink to the SAME displacement as the parent solve. findDraft0Trim owns
    // heel, so it is called with heelRad = 0 on an already-heeled mesh.
    const r = findDraft0Trim(heeled, target_kg, KG, 0)

    // Re-clip for the immersed centroid. findDraft0Trim forces lcb.y onto the
    // centreline, which is right for reporting LCB but destroys the very
    // off-centreline offset GZ depends on.
    const { clipped } = clipBelowPlane(heeled, r.waterlineZ)
    const yB = computeVolumeAndCentroid(clipped).centroid.y

    // G sits on the centreline, KG above the keel, before heel. Roll it by the
    // same matrix about the same pivot.
    const zG = bounds.min.z + KG - bounds.center.z
    const yG = -zG * Math.sin(phi) + bounds.center.y

    // applyRollX carries +Y toward +Z, so a vertical force at y produces
    // tau_x = +y·W about +X — the same +tau_x that produced the heel. Restoring
    // therefore requires tau_x < 0, i.e. GZ = y_G - y_B.
    const gz = yG - yB
    return {
      heelDeg: deg,
      GZ: Number((Number.isFinite(gz) ? gz : 0).toFixed(1)),
      draftMm: r.draftMm,
      minFreeboardMm: Math.min(r.bowFreeboardMm, r.sternFreeboardMm),
    }
  })
}

/**
 * Heel at which a hull END (bow or stern stem tip) reaches the water,
 * interpolated from a GZ curve.
 *
 * The curve samples the stem-tip clearance (see {@link GZPoint.minFreeboardMm})
 * at fixed heel angles (5° apart by default), so the crossing between two
 * samples is found by linear interpolation — accurate to roughly half a sample
 * step, and cheap. Returns 0 when the stem tip is already under at rest, and
 * null when it stays clear over the whole sampled range (the usual light-load
 * case: there is no crossing to report, and inventing one by extrapolating
 * would be a lie).
 *
 * The measured clearance is the stem tip, not the sheer/deck edge, so the
 * number this returns is "first water at an extremity", not "first water over
 * the deck". Callers that label it must choose their wording accordingly.
 */
function endTipImmersionHeelDeg(curve: GZPoint[]): number | null {
  const freeboard = (i: number): number | undefined => curve[i]?.minFreeboardMm
  if (curve.length === 0 || freeboard(0) === undefined) return null

  const first = freeboard(0) as number
  if (first <= 0) return 0

  // Track the last point that DID carry a freeboard: a curve where interior
  // points omit it (callers that only supply the arm) must still interpolate
  // from the nearest known neighbour, not skip the crossing entirely.
  let last = 0
  for (let i = 1; i < curve.length; i++) {
    const here = freeboard(i)
    if (here === undefined) continue
    if (here > 0) {
      last = i
      continue
    }
    const prev = freeboard(last) as number
    const j = last
    if (prev === here) continue
    // Linear interpolation of the heel at which freeboard hits zero.
    const t = prev / (prev - here)
    const heel = curve[j].heelDeg + t * (curve[i].heelDeg - curve[j].heelDeg)
    return Number(Math.max(0, heel).toFixed(1))
  }
  return null
}

/**
 * Trim & LCG/LCB equilibrium solver.
 *
 * For each candidate pitch angle, finds the equilibrium draft for targetKg,
 * computes the resulting Center of Buoyancy (LCB), and identifies the pitch angle
 * that aligns LCB longitudinally with the target LCG (minimizing |LCB_x - LCG_x|).
 *
 * The sweep is not a uniform fine ladder: coarse angles step 5× the fine step
 * (0.5° by default) across ±maxTrimDeg, then fine angles step by trimStepDeg
 * over ±one coarse step around the winner. So a ±3.5° sweep is 15 + 11 = 26
 * solves, not 71 — do not model its cost as a uniform 0.1° sweep.
 */
export function solveTrim(
  mesh: MeshLike,
  target_kg: number,
  options?: {
    targetLcgPercentFromBow?: number // e.g. 52% default
    maxTrimDeg?: number // default 3.5 deg
    trimStepDeg?: number // default 0.1 deg
    fixedHeelDeg?: number // default 0 (no heel). + = the -Y side goes down
    /**
     * Height of the centre of gravity ABOVE THE KEEL, in mm. Default 280 mm.
     * This is a height, not an absolute Z — see the note on `KG_MM` below.
     */
    kgMm?: number
    /**
     * Progress observer for the trim sweep. Called once per candidate angle,
     * after that angle has been evaluated, with `index` counting 1..`total`
     * across BOTH sweeps so a progress bar has one continuous scale. `total`
     * counts ONLY the candidate angles (coarse + fine ladders), not the final
     * full solve or the GZ curve, which run after the last call.
     *
     * It is an observer only: a solve with the callback returns exactly the
     * same numbers as one without (asserted in tests/verify-solve-extras.ts).
     *
     * An exception thrown inside the callback is swallowed, so a broken progress
     * handler cannot change the answer the solver returns.
     */
    onAngle?: (info: {
      phase: 'coarse' | 'fine'
      angleDeg: number
      /** 1-based position across the whole sweep. */
      index: number
      total: number
    }) => void
  },
): TrimSolveResult {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('solveTrim: empty mesh')

  // Decimate once for the entire trim sweep — keeps solver fast.
  //
  // `decimateMesh` is a QEM edge-collapse (see geometry.ts): it keeps the mesh
  // watertight and preserves winding, which is what the waterplane clipper
  // needs. An EARLIER clustering-based implementation snapped vertices to cell
  // centroids and collapsed ~76% of the triangles to zero area; those faces
  // carried no volume but their edges still generated waterplane crossings
  // that did not pair up, which shattered the waterplane contour into open
  // chains and produced meaningless BM/GM at heel. Rather than patch holes
  // downstream, the solver still falls back to the original mesh whenever the
  // decimation is not clean. The original is only ~40k triangles, which the
  // solver handles comfortably.
  const decimated = decimateMesh(positions, DEFAULT_SOLVER_TRIANGLES)
  const solveMesh = isMeshUsableForHydrostatics(decimated) ? decimated : positions
  if (solveMesh !== decimated) {
    console.warn(
      `solveTrim: decimation produced an unusable mesh; ` +
        `solving on the original ${(positions.length / 9) | 0} triangles instead.`,
    )
  }

  const bounds = computeBounds(solveMesh)
  const lengthX = bounds.size.x
  const bowX = bounds.max.x
  const sternX = bounds.min.x

  // Find bow/stern tip Z from ORIGINAL mesh (before decimation)
  let bowTipZ = 0
  let sternTipZ = 0
  let maxX = -Infinity
  let minX = Infinity
  for (let i = 0; i < positions.length; i += 9) {
    for (const vx of [i, i + 3, i + 6]) {
      const x = positions[vx]
      const z = positions[vx + 2]
      if (x > maxX) {
        maxX = x
        bowTipZ = z
      }
      if (x < minX) {
        minX = x
        sternTipZ = z
      }
    }
  }

  const targetLcgPercent = options?.targetLcgPercentFromBow ?? 52
  // Bow is at max X; stern is at min X
  const targetLcgX = bowX - (targetLcgPercent / 100) * lengthX
  // KG is a HEIGHT above the keel, which is what findDraft0Trim expects
  // (it computes KM - KG). LCG's world-Z is the same point expressed as an
  // absolute coordinate, so it is bounds.min.z + KG.
  //
  // Passing `lcg.z` here as the KG argument was a unit bug: it handed the
  // absolute height (117.47 on the test hull) to a function expecting a
  // height above the keel (280). That silently shortened KG by |min.z|, which
  // inflated every reported KM/GM by 162.5 mm — GM read 272.9 instead of
  // 110.4, and no test caught it because every suite passed `undefined` for
  // KG, leaving GM = 0.
  //
  // DEFAULT_KG_MM is the fallback for callers that do not supply one. The UI
  // now exposes KG (App.tsx) and passes it explicitly, so a run's GM always
  // reflects the value the user entered.
  const KG_MM = options?.kgMm ?? DEFAULT_KG_MM
  if (!Number.isFinite(KG_MM) || KG_MM <= 0) {
    throw new Error(`solveTrim: kgMm must be > 0 (got ${KG_MM})`)
  }
  const lcg: Vec3 = {
    x: targetLcgX,
    y: bounds.center.y,
    z: bounds.min.z + KG_MM, // KG is a height above the keel
  }

  const maxTrimDeg = options?.maxTrimDeg ?? 3.5
  const fineStepDeg = options?.trimStepDeg ?? 0.1
  const coarseStepDeg = fineStepDeg * 5 // 0.5° default
  const fixedHeelDeg = options?.fixedHeelDeg ?? 0
  const fixedHeelRad = (fixedHeelDeg * Math.PI) / 180
  const onAngle = options?.onAngle

  // Sweep size, derived from the same ladder the loops below walk, so the
  // progress observer can report a total that matches the call count exactly.
  // Both loops close with `deg <= <bound> + 1e-6` ON THE ANGLE, so the epsilon
  // has to be carried inside the division here. Using a small `+1e-9` on the
  // quotient instead under-counted by one whenever 2*maxTrimDeg/coarseStepDeg
  // landed a hair below an integer (maxTrimDeg = 4.49999975 reported 29 against
  // 30 real calls), which left index == total + 1 and a progress bar that could
  // not finish.
  const coarseCount = Math.max(1, Math.floor((2 * maxTrimDeg + 1e-6) / coarseStepDeg) + 1)
  const fineCount = Math.max(1, Math.floor((2 * coarseStepDeg + 1e-6) / fineStepDeg) + 1)
  const angleTotal = coarseCount + fineCount
  let angleIndex = 0

  let bestAngleDeg = 0
  let bestOffset = Infinity
  let bestResult: Draft0TrimResult | null = null
  let totalPlanes = 0
  // The winning angle is stored as positions + rotation so the full solve can
  // run once on it after the cheap search has finished.
  let bestPitchedPositions: Float32Array | null = null
  let bestRad = 0
  let hasBest = false

  // Working copy of positions to avoid mutating source mesh during pitch sweeps
  const workingPositions = new Float32Array(solveMesh.length)

  // Search the trim angle with the cheap waterline+LCB solve. Only the winning
  // angle is re-solved in full afterwards, so Cb/Cp/Cm/KB/BM/GM/GZ and the
  // freeboards are derived once rather than ~26 times. The reported numbers
  // still come from findDraft0Trim, so this cannot alter the output —
  // verified bit-identical by tests/verify-trim-search.ts.
  const searchAngle = (deg: number, phase: 'coarse' | 'fine'): void => {
    const rad = (deg * Math.PI) / 180
    workingPositions.set(solveMesh)
    // Trim only. Heel is applied inside the solve, which owns it —
    // rolling here as well would apply the angle twice.
    applyPitchY(workingPositions, rad, targetLcgX, bounds.center.z)

    try {
      const res = solveDraftLcb(workingPositions, target_kg, fixedHeelRad)
      totalPlanes += res.planesEvaluated

      const cosA = Math.cos(rad)
      const sinA = Math.sin(rad)
      const rx = res.lcb.x - targetLcgX
      const rz = res.lcb.z - bounds.center.z
      const origLcbX = rx * cosA + rz * sinA + targetLcgX

      const offset = Math.abs(origLcbX - targetLcgX)
      if (offset < bestOffset) {
        bestOffset = offset
        bestAngleDeg = deg
        // Remember where the winner is; the full result is computed below.
        bestPitchedPositions = new Float32Array(workingPositions)
        bestRad = rad
        hasBest = true
      }
    } catch {
      // Continue if one extreme angle fails to bracket
    }
    // Outside the try: a failed angle still consumed a slot of the sweep, so
    // the index must advance either way.
    angleIndex++
    try {
      onAngle?.({ phase, angleDeg: deg, index: angleIndex, total: angleTotal })
    } catch {
      // A broken progress handler must not be able to change the answer.
    }
  }

  // --- Coarse sweep: 0.5° steps to find the neighborhood ---
  for (let deg = -maxTrimDeg; deg <= maxTrimDeg + 1e-6; deg += coarseStepDeg) {
    searchAngle(deg, 'coarse')
  }

  // --- Fine sweep: ±0.5° around best at 0.1° steps ---
  const fineStart = bestAngleDeg - coarseStepDeg
  const fineEnd = bestAngleDeg + coarseStepDeg
  for (let deg = fineStart; deg <= fineEnd + 1e-6; deg += fineStepDeg) {
    searchAngle(deg, 'fine')
  }

  // One full solve on the winning angle: this is the result the user sees.
  if (hasBest && bestPitchedPositions) {
    try {
      const full = findDraft0Trim(bestPitchedPositions, target_kg, KG_MM, fixedHeelRad)
      const rx = full.lcb.x - targetLcgX
      const rz = full.lcb.z - bounds.center.z
      // The waterplane centroid comes out of the clip in the PITCHED frame, the
      // same as LCB, so it needs the same rotation back into the hull frame —
      // otherwise LCF and LCB on one result object live in different frames and
      // disagree with the LCG pairing. The centroid lies in the cut plane, so
      // its z is exactly the waterline the clip used.
      const lcx = full.waterplaneCentroidX - targetLcgX
      const lcz = full.waterlineZ - bounds.center.z
      bestResult = {
        ...full,
        lcb: {
          x: rx * Math.cos(bestRad) + rz * Math.sin(bestRad) + targetLcgX,
          y: bounds.center.y,
          z: -rx * Math.sin(bestRad) + rz * Math.cos(bestRad) + bounds.center.z,
        },
        waterplaneCentroidX: lcx * Math.cos(bestRad) + lcz * Math.sin(bestRad) + targetLcgX,
      }
    } catch {
      // Fall through to the zero-trim fallback below.
    }
  }

  if (!bestResult) {
    const fallback = findDraft0Trim(solveMesh, target_kg, KG_MM, fixedHeelRad)
    bestResult = {
      ...fallback,
      lcb: { ...fallback.lcb, y: bounds.center.y }, // Force centerline
      Cb: fallback.Cb,
      LWL: fallback.LWL,
      BWL: fallback.BWL,
      midshipAreaMm2: fallback.midshipAreaMm2,
      Cp: fallback.Cp,
      Cm: fallback.Cm,
      KB: fallback.KB,
      BM: fallback.BM,
      KM: fallback.KM,
      GM: fallback.GM,
      heelDeg: fixedHeelDeg,
    }
    bestAngleDeg = 0
    bestOffset = Math.abs(bestResult.lcb.x - targetLcgX)
  }

  // Hoisted out of the return so the end-tip immersion heel can read it: the
  // curve is the only source of clearance-at-heel in this function.
  //
  // Cost note: this curve carries an extra full draft solve for the 0° anchor
  // (the equilibrium solve above cannot supply it — that one is trimmed, this
  // one must be level), which measured ~0.7 s of a ~10 s solve. It is the part
  // of the solve a worker/progress-bar task should absorb, not something to
  // shave off by reusing a wrong-basis anchor.
  const gzCurve = compute_gz_curve_geometric(solveMesh, target_kg, KG_MM)

  // --- Report in the hull's own frame ---------------------------------------
  // The solve above ran on a copy of the hull pitched by bestRad about
  // (targetLcgX, bounds.center.y, bounds.center.z), so findDraft0Trim's
  // `minZ`, `draftMm` and `waterlineZ` all belong to that tilted copy: the
  // draft is measured from the tilted hull's lowest point and the waterline is
  // that point plus the draft. Rotating a hull about a pivot that sits above the
  // keel lifts the keel by (x_keel - pivot.x) * |sin(trim)| — the tilted hull's
  // lowest point sits 5.8 mm above the keel at -1.90 deg on the test hull, and
  // it climbs as the trim deepens — so the datum the draft is measured from
  // moves with the answer. On this hull at 75 kg that made the reported draft
  // 7.6 mm short of the true keel-to-waterline distance. It also drifts between
  // loads: the lift is proportional to sin(trim), so a hull that trims further
  // under a heavier load carries the extra lift on top of its real sinkage and
  // reports a waterline that climbed while it floated deeper — which is how
  // this looked wrong to begin with. The viewer's waterline plane is placed
  // from that number, so it rode along. LCB and LCF above are already rotated
  // back into the hull frame; the waterplane needs the same inverse, evaluated
  // at the station it is reported from:
  //     z' = (z - pz) * c + (x - px) * s + pz  =>  z = pz + (W - pz - (x - px) * s) / c
  const sinT = Math.sin(bestRad)
  const cosT = Math.cos(bestRad)
  const hullWaterlineAt = (stationX: number): number =>
    bounds.center.z +
    (bestResult.waterlineZ - bounds.center.z - (stationX - targetLcgX) * sinT) / cosT

  // Waterline at midship, and the draft referenced to the hull's keel
  // (bounds.min.z) in the same frame, so the pair is additive: the waterline
  // moves by exactly the draft's increase.
  const waterlineZ = hullWaterlineAt(bounds.center.x)
  const draftMm = waterlineZ - bounds.min.z

  // The freeboards read the waterline at each end's own station, so they
  // inherit the tilt: at a bow-down trim the plane stands higher at the bow end
  // and the bow freeboard DROPS. The old form shifted the plane the opposite
  // way round (`waterlineZ + x * tan(trim)`), putting it 45 mm too low at the
  // bow end here, which let a bow-down trim GROW the bow freeboard to 153 mm
  // against the true 61 mm.

  return {
    trimDeg: Number(bestAngleDeg.toFixed(2)),
    draftMm,
    waterlineZ,
    displacedVolumeMm3: bestResult.displacedVolumeMm3,
    displacementKg: bestResult.displacementKg,
    targetKg: target_kg,
    lcb: bestResult.lcb,
    lcg,
    pivot: { x: targetLcgX, y: bounds.center.y, z: bounds.center.z },
    lcbLcgOffsetMm: bestOffset,
    waterplaneAreaMm2: bestResult.waterplaneAreaMm2,
    planesEvaluated: totalPlanes,
    converged: bestOffset < 15.0, // within 15mm alignment or best reachable
    Cb: bestResult.Cb,
    LWL: bestResult.LWL,
    BWL: bestResult.BWL,
    midshipAreaMm2: bestResult.midshipAreaMm2,
    Cp: bestResult.Cp,
    Cm: bestResult.Cm,
    KB: bestResult.KB,
    BM: bestResult.BM,
    KM: bestResult.KM,
    GM: bestResult.GM,
    bowFreeboardMm: Number((bowTipZ - hullWaterlineAt(bowX)).toFixed(1)),
    sternFreeboardMm: Number((sternTipZ - hullWaterlineAt(sternX)).toFixed(1)),
    gzCurve,
    heelDeg: fixedHeelDeg,
    kgMm: KG_MM,
    waterplaneLoopCount: bestResult.waterplaneLoopCount,
    Cwp: bestResult.Cwp,
    wettedSurfaceAreaMm2: bestResult.wettedSurfaceAreaMm2,
    waterplaneCentroidX: bestResult.waterplaneCentroidX,
    waterplaneIyyMm4: bestResult.waterplaneIyyMm4,
    tpcTonnesPerCm: bestResult.tpcTonnesPerCm,
    endTipImmersionDeg: endTipImmersionHeelDeg(gzCurve),
  }
}
