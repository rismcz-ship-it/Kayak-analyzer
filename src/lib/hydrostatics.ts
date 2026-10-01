// Waterplane (hydrostatics) solver — first pass: zero-trim draft.
//
// Conventions (shared with src/lib/geometry.ts):
// - Z-up, X = LOA (forward), Y = BOA (side). All STL units are millimetres.
// - "Draft" is measured upwards from the keel (bounding-box min Z).
// - Fresh water: rho = 1000 kg/m^3, so 1 kg <-> 1 L <-> 1_000_000 mm^3.
// - Zero trim means the waterplane is horizontal (no heel, no trim angle).

import {
  applyPitchY,
  applyRollX,
  computeBounds,
  computeVolumeAndCentroid,
  computeWaterlineBeamMm,
  computeWaterlineLengthMm,
  isMeshUsableForHydrostatics,
  decimateMesh,
  DEFAULT_SOLVER_TRIANGLES,
  findMaxSubmergedSection,
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
  /** Absolute waterline height (Z) in mesh coordinates, = minZ + draftMm. */
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
                                        }

          export interface GZPoint {
          /** Heel angle in degrees (+ = starboard/right heel) */
          heelDeg: number
          /** Righting arm in mm */
          GZ: number
          }

          export interface TrimSolveResult {
  /** Equilibrium trim angle in degrees (+ = bow up, - = bow down). */
  trimDeg: number
  /** Equilibrium draft at hull center (above keel) in mm. */
  draftMm: number
  /** Waterline Z at center in mesh coordinates. */
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
                        /** Bow freeboard: vertical distance from waterline to bow tip (+ = bow above water) */
                        bowFreeboardMm: number
                        /** Stern freeboard: vertical distance from waterline to stern tip (+ = stern above water) */
                        sternFreeboardMm: number
                        /** Fixed heel angle used in solver (degrees). + = starboard down. */
                        heelDeg: number
                      }

/** Standard heel angles to sample for the GZ curve (degrees). */
export const DEFAULT_GZ_HEEL_ANGLES_DEG = [0, 5, 10, 15, 20, 25, 30]

/**
 * Compute the righting arm (GZ) curve for a hull across a range of heel angles.
 * For small-to-moderate angles, GZ(φ) = GM × sin(φ).
 * At higher heel, form stability dominates: GZ(φ) = (KM - KG) × sin(φ) + (BM/2) × tan²(φ) × sin(φ).
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
  private readonly buckets = new Map<string, number[]>()
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
   */
  add(x: number, y: number): number {
    const cx = Math.floor(x / WELD_CELL_MM)
    const cy = Math.floor(y / WELD_CELL_MM)
    let best = -1
    let bestD = WELD_TOL_MM
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.buckets.get(`${cx + dx}|${cy + dy}`)
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
    const key = `${cx}|${cy}`
    const list = this.buckets.get(key)
    if (list) list.push(idx)
    else this.buckets.set(key, [idx])
    return idx
  }
}

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
    sum +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx)
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
   * Number of distinct closed loops the waterplane contour resolved into.
   * A watertight hull cut by a single plane must give exactly 1. More than
   * one means the contour was fragmented (bad welding, or a genuinely
   * multi-lobe waterplane), and the area/second-moment sums below are then
   * not trustworthy.
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

  const pushTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }

  // Intersection of edge p->q with the plane z=h (caller guarantees straddle).
  const ix = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
  ): [number, number] => {
    // Both endpoints can sit exactly in the cutting plane (a facet coplanar
    // with the waterline, which happens routinely on a heeled hull). That
    // makes bz - az zero and t = inf/NaN, and a single NaN node poisons the
    // whole contour walk. Clamp t to the endpoints in that case.
    const dz = bz - az
    if (Math.abs(dz) < EPS) return [ax, ay]
    const t = (h - az) / dz
    return [lerp(ax, bx, t), lerp(ay, by, t)]
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
    const areaMag = Math.hypot(nx, ny, nz)
    if (areaMag < 1e-9) continue

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
    // triangles keep the original cyclic order (winding). PNext(i)/PPrev(i)
    // are the cyclic successor/predecessor of vertex i.
    const P = [
      [ax, ay, az],
      [bx, by, bz],
      [cx, cy, cz],
    ]
    const flags = [aIn, bIn, cIn]
    const nxt = (i: number) => P[(i + 1) % 3]
    const prv = (i: number) => P[(i + 2) % 3]

    if (nIn === 1) {
      // Below vertex i, crossings on both its outgoing edges.
      const i = flags[0] ? 0 : flags[1] ? 1 : 2
      const p = P[i]
      const qNext = nxt(i)
      const qPrev = prv(i)
      const [e1x, e1y] = ix(p[0], p[1], p[2], qNext[0], qNext[1], qNext[2])
      const [e2x, e2y] = ix(p[0], p[1], p[2], qPrev[0], qPrev[1], qPrev[2])
      pushTri(p[0], p[1], p[2], e1x, e1y, h, e2x, e2y, h)
      pushSeg(e1x, e1y, e2x, e2y)
    } else {
      // Above vertex i; below-region quad (F, PNext, PPrev, G) in cyclic
      // order, where F/G sit on the i→next / prev→i edges.
      const i = !flags[0] ? 0 : !flags[1] ? 1 : 2
      const pNext = nxt(i)
      const pPrev = prv(i)
      const pi = P[i]
      const [fX, fY] = ix(pi[0], pi[1], pi[2], pNext[0], pNext[1], pNext[2])
      const [gX, gY] = ix(pPrev[0], pPrev[1], pPrev[2], pi[0], pi[1], pi[2])
      pushTri(fX, fY, h, pNext[0], pNext[1], pNext[2], pPrev[0], pPrev[1], pPrev[2])
      pushTri(fX, fY, h, pPrev[0], pPrev[1], pPrev[2], gX, gY, h)
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
          for (let k = 0; k < pts.length; k++) {
            const p = pts[k]
            const q = pts[(k + 1) % pts.length]
            const cross = p.x * q.y - q.x * p.y
            signedArea += cross
            // I contribution for this edge: (y₁² + y₁y₂ + y₂²) * (x₁y₂ - x₂y₁) / 12
            Ix += (p.y * p.y + p.y * q.y + q.y * q.y) * cross
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

  return { clipped: new Float32Array(out), waterplaneAreaMm2, waterplaneIx, waterplaneLoopCount: loops.length }
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
 * @param heelRad Optional heel angle in radians (+ starboard down). Applied as X-rotation before solving.
 * @throws when the target is non-positive or exceeds the hull's total volume.
 */
/**
 * Waterline + LCB only — the search half of {@link find_draft_0trim}.
 *
 * `solve_trim` sweeps ~26 trim angles and ranks them by how closely LCB tracks
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
function solve_draft_lcb(mesh: MeshLike, target_kg: number, heelRad?: number): {
  draftMm: number
  waterlineZ: number
  displacedVolumeMm3: number
  lcb: Vec3
  planesEvaluated: number
} {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('solve_draft_lcb: empty mesh')
  if (!Number.isFinite(target_kg) || target_kg <= 0) {
    throw new Error(`solve_draft_lcb: target_kg must be > 0 (got ${target_kg})`)
  }

  // Heel first, about the hull bounding-box centre — identical to the block in
  // find_draft_0trim. Order matters: the bracket must use the *heeled* mesh's
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

export function find_draft_0trim(mesh: MeshLike, target_kg: number, KG?: number, heelRad?: number): Draft0TrimResult {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('find_draft_0trim: empty mesh')
  if (!Number.isFinite(target_kg) || target_kg <= 0) {
    throw new Error(`find_draft_0trim: target_kg must be > 0 (got ${target_kg})`)
  }

  // Apply heel rotation (X-axis) if specified.
  //
  // This function is the SINGLE owner of heel: `solve_trim` passes the angle
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
      workingPositions[i] = positions[i]                 // X unchanged
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
      `find_draft_0trim: target ${(targetVolumeMm3 / 1_000_000).toFixed(1)} L exceeds ` +
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
                  const { clipped, waterplaneAreaMm2, waterplaneIx } = clipBelowPlane(workingPositions, upperH)
                  const { centroid: lcb } = computeVolumeAndCentroid(clipped)
                                            const draftMm = maxZ - minZ
                                            const LWL = computeWaterlineLengthMm(workingPositions, upperH) || bounds.size.x
                                            const BWL = computeWaterlineBeamMm(workingPositions, upperH) || bounds.size.y
                                            const boxVolumeMm3 = LWL * BWL * draftMm
                                            const Cb = boxVolumeMm3 > 0 ? upperV / boxVolumeMm3 : 0
                                            // Max submerged section + the rectangle it fits in (station-matched)
                                            const maxSection = findMaxSubmergedSection(workingPositions, bounds.min.x, bounds.max.x, upperH)
                                            const midshipAreaMm2 = maxSection.areaMm2
                                            const Cp = (midshipAreaMm2 > 0 && LWL > 0) ? upperV / (midshipAreaMm2 * LWL) : 0
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
                                                                                                                                                                                                                                                                                                        const GM = (typeof KG === 'number') ? KM - KG : 0
                                                                                                                                                                                                                                                                                                        // Freeboard at bow/stern: find actual bow/stern tip Z from mesh vertices (zero trim)
                                                                                                                                                                                                                                                                                                        let bowX = -Infinity
                                                                                                                                                                                                                                                                                                        let sternX = Infinity
                                                                                                                                                                                                                                                                                                        let bowZ = 0
                                                                                                                                                                                                                                                                                                        let sternZ = 0
                                                                                                                                                                                                                                                                                                        for (let i = 0; i < workingPositions.length; i += 9) {
                                                                                                                                                                                                                                                                                                            for (const vx of [i, i + 3, i + 6]) {
                                                                                                                                                                                                                                                                                                                const x = workingPositions[vx]
                                                                                                                                                                                                                                                                                                                const z = workingPositions[vx + 2]
                                                                                                                                                                                                                                                                                                                if (x > bowX) { bowX = x; bowZ = z }
                                                                                                                                                                                                                                                                                                                if (x < sternX) { sternX = x; sternZ = z }
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                heelDeg: heelRad ? (heelRad * 180 / Math.PI) : 0,
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      lo = h     // lower bound (just below)
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  const { clipped, waterplaneAreaMm2, waterplaneIx } = clipBelowPlane(workingPositions, waterlineZ)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    const { volumeMm3: verifiedVolumeMm3, centroid: lcb } =
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      computeVolumeAndCentroid(clipped)
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
                                                            const maxSection = findMaxSubmergedSection(workingPositions, bounds.min.x, bounds.max.x, waterlineZ)
                                                            const midshipAreaMm2 = maxSection.areaMm2
                                      const Cp = (midshipAreaMm2 > 0 && LWL > 0) ? verifiedVolumeMm3 / (midshipAreaMm2 * LWL) : 0
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                        const GM = (typeof KG === 'number') ? KM - KG : 0
                                                                                                                                                                                                                                                                                                                                                                                                                                                                        // Freeboard at bow/stern: find actual bow/stern tip Z from mesh vertices (zero trim)
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                let bowX = -Infinity
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                let sternX = Infinity
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                let bowZ = 0
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                let sternZ = 0
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                for (let i = 0; i < workingPositions.length; i += 9) {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    for (const vx of [i, i + 3, i + 6]) {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        const x = workingPositions[vx]
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        const z = workingPositions[vx + 2]
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        if (x > bowX) { bowX = x; bowZ = z }
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        if (x < sternX) { sternX = x; sternZ = z }
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      heelDeg: heelRad ? (heelRad * 180 / Math.PI) : 0,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    }
}

/**
 * Trim & LCG/LCB equilibrium solver.
 *
 * Sweeps pitch angles between -maxTrimDeg and +maxTrimDeg in trimStepDeg increments.
 * For each candidate pitch angle, finds the equilibrium draft for targetKg,
 * computes the resulting Center of Buoyancy (LCB), and identifies the pitch angle
 * that aligns LCB longitudinally with the target LCG (minimizing |LCB_x - LCG_x|).
 */
export function solve_trim(
  mesh: MeshLike,
  target_kg: number,
  options?: {
    targetLcgPercentFromBow?: number // e.g. 52% default
    maxTrimDeg?: number // default 3 deg
    trimStepDeg?: number // default 0.1 deg
    fixedHeelDeg?: number // default 0 (no heel). + = starboard down
  },
): TrimSolveResult {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('solve_trim: empty mesh')

  // Decimate once for the entire trim sweep — keeps solver fast.
  //
  // Decimation is only safe if it leaves the mesh watertight. `decimateMesh`
  // snaps vertices to cell centroids, which collapses ~76% of triangles to
  // zero area on a hull this size; those faces carry no volume but their
  // edges still generate waterplane crossings that do not pair up, which
  // shattered the waterplane contour into open chains and produced
  // meaningless BM/GM at heel. Rather than patch holes downstream, fall back
  // to the original mesh whenever the decimation is not clean. The original
  // is only ~40k triangles, which the solver handles comfortably.
  const decimated = decimateMesh(positions, DEFAULT_SOLVER_TRIANGLES)
  const solveMesh = isMeshUsableForHydrostatics(decimated)
    ? decimated
    : positions
  if (solveMesh !== decimated) {
    console.warn(
      `solve_trim: decimation produced an unusable mesh; ` +
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
        if (x > maxX) { maxX = x; bowTipZ = z }
        if (x < minX) { minX = x; sternTipZ = z }
      }
    }

    const targetLcgPercent = options?.targetLcgPercentFromBow ?? 52
  // Bow is at max X; stern is at min X
  const targetLcgX = bowX - (targetLcgPercent / 100) * lengthX
  const lcg: Vec3 = {
    x: targetLcgX,
    y: bounds.center.y,
    z: bounds.min.z + 280, // Default KG 280mm above keel
  }

  const maxTrimDeg = options?.maxTrimDeg ?? 3.5
  const fineStepDeg = options?.trimStepDeg ?? 0.1
  const coarseStepDeg = fineStepDeg * 5 // 0.5° default
  const fixedHeelDeg = options?.fixedHeelDeg ?? 0
  const fixedHeelRad = (fixedHeelDeg * Math.PI) / 180

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
  // still come from find_draft_0trim, so this cannot alter the output —
  // verified bit-identical by tests/verify-trim-search.ts.
  const searchAngle = (deg: number): void => {
    const rad = (deg * Math.PI) / 180
    workingPositions.set(solveMesh)
    // Trim only. Heel is applied inside the solve, which owns it —
    // rolling here as well would apply the angle twice.
    applyPitchY(workingPositions, rad, targetLcgX, bounds.center.z)

    try {
      const res = solve_draft_lcb(workingPositions, target_kg, fixedHeelRad)
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
  }

  // --- Coarse sweep: 0.5° steps to find the neighborhood ---
  for (let deg = -maxTrimDeg; deg <= maxTrimDeg + 1e-6; deg += coarseStepDeg) {
    searchAngle(deg)
  }

  // --- Fine sweep: ±0.5° around best at 0.1° steps ---
  const fineStart = bestAngleDeg - coarseStepDeg
  const fineEnd = bestAngleDeg + coarseStepDeg
  for (let deg = fineStart; deg <= fineEnd + 1e-6; deg += fineStepDeg) {
    searchAngle(deg)
  }

  // One full solve on the winning angle: this is the result the user sees.
  if (hasBest && bestPitchedPositions) {
    try {
      const full = find_draft_0trim(bestPitchedPositions, target_kg, lcg.z, fixedHeelRad)
      const rx = full.lcb.x - targetLcgX
      const rz = full.lcb.z - bounds.center.z
      bestResult = {
        ...full,
        lcb: {
          x: rx * Math.cos(bestRad) + rz * Math.sin(bestRad) + targetLcgX,
          y: bounds.center.y,
          z: -rx * Math.sin(bestRad) + rz * Math.cos(bestRad) + bounds.center.z,
        },
      }
    } catch {
      // Fall through to the zero-trim fallback below.
    }
  }

  if (!bestResult) {
                    const fallback = find_draft_0trim(solveMesh, target_kg, lcg.z, fixedHeelRad)
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
                                bowFreeboardMm: Number((bowTipZ - (fallback.waterlineZ - bowX * Math.tan(0))).toFixed(1)),
                                sternFreeboardMm: Number((sternTipZ - (fallback.waterlineZ - sternX * Math.tan(0))).toFixed(1)),
                                heelDeg: fixedHeelDeg,
                              }
                              bestAngleDeg = 0
                              bestOffset = Math.abs(bestResult.lcb.x - targetLcgX)
                            }

                        return {
                                                trimDeg: Number(bestAngleDeg.toFixed(2)),
                                                                                              draftMm: bestResult.draftMm,
                                                                                              waterlineZ: bestResult.waterlineZ,
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
                                                                                              bowFreeboardMm: Number((bowTipZ - (bestResult.waterlineZ + bowX * Math.tan(bestAngleDeg * Math.PI / 180))).toFixed(1)),
                                                                                              sternFreeboardMm: Number((sternTipZ - (bestResult.waterlineZ + sternX * Math.tan(bestAngleDeg * Math.PI / 180))).toFixed(1)),
                                                                                              gzCurve: compute_gz_curve(bestResult.GM, bestResult.BM),
                                                                                              heelDeg: fixedHeelDeg,
                                              }
  }
