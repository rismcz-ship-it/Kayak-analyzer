// Waterplane (hydrostatics) solver — first pass: zero-trim draft.
//
// Conventions (shared with src/lib/geometry.ts):
// - Z-up, X = LOA (forward), Y = BOA (side). All STL units are millimetres.
// - "Draft" is measured upwards from the keel (bounding-box min Z).
// - Fresh water: rho = 1000 kg/m^3, so 1 kg <-> 1 L <-> 1_000_000 mm^3.
// - Zero trim means the waterplane is horizontal (no heel, no trim angle).

import {
  applyPitchY,
  computeBounds,
  computeVolumeAndCentroid,
  decimateMesh,
  DEFAULT_SOLVER_TRIANGLES,
  findMaxCrossSectionArea,
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
/** Quantisation for welding waterplane intersection points (0.001 mm). */
const WELD_QUANT = 1000

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

function weldKey(x: number, y: number): string {
  return `${Math.round(x * WELD_QUANT)}|${Math.round(y * WELD_QUANT)}`
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export interface ClippedBelow {
  /** Closed solid of the hull below z=h (side/bottom faces + waterplane cap). */
  clipped: Float32Array
  /** Waterplane area (sum of cap-loop |areas|), mm^2. */
  waterplaneAreaMm2: number
  /** Waterplane second moment of area about centerline (Y=0), mm^4. */
  waterplaneIx: number
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
    const t = (h - az) / (bz - az)
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

  if (segX1.length > 0) {
    // Weld endpoints, dedupe segments, build adjacency for loop walking.
    const coordOf = new Map<string, XY>()
    const adj = new Map<string, string[]>()
    const addAdj = (a: string, b: string) => {
      const list = adj.get(a)
      if (list) {
        if (!list.includes(b)) list.push(b)
      } else {
        adj.set(a, [b])
      }
    }
    const seenSeg = new Set<string>()
    for (let s = 0; s < segX1.length; s++) {
      const k1 = weldKey(segX1[s], segY1[s])
      const k2 = weldKey(segX2[s], segY2[s])
      if (k1 === k2) continue
      const canon = k1 <= k2 ? `${k1}~${k2}` : `${k2}~${k1}`
      if (seenSeg.has(canon)) continue
      seenSeg.add(canon)
      if (!coordOf.has(k1)) coordOf.set(k1, { x: segX1[s], y: segY1[s] })
      if (!coordOf.has(k2)) coordOf.set(k2, { x: segX2[s], y: segY2[s] })
      addAdj(k1, k2)
      addAdj(k2, k1)
    }

    // Match cap winding to the input solid: outward cap normal is +Z when the
    // source mesh has positive (outward) signed volume, -Z when it is wound
    // inward. (volumeBelowPlane re-derives this per call via signedVolumeMm3.)
    const outward = signedVolumeMm3(positions) >= 0

    // Walk every unvisited edge into ordered loops.
    const visited = new Set<string>()
    const canonOf = (a: string, b: string) => (a <= b ? `${a}~${b}` : `${b}~${a}`)
    const loops: XY[][] = []
    for (const seed of seenSeg) {
      if (visited.has(seed)) continue
      visited.add(seed)
      const [sa, sb] = seed.split('~')
      const loopKeys = [sa, sb]
      let prev = sa
      let cur = sb
      for (let guard = 0; guard < seenSeg.size + 2; guard++) {
        if (cur === sa) break // closed
        const nexts = adj.get(cur) ?? []
        let nxt: string | null = null
        for (const n of nexts) {
          if (n === prev) continue
          if (!visited.has(canonOf(cur, n))) {
            nxt = n
            break
          }
        }
        if (nxt === null) break // open chain / dead end
        visited.add(canonOf(cur, nxt))
        loopKeys.push(nxt)
        prev = cur
        cur = nxt
      }
      if (loopKeys.length >= 3) {
        const pts: XY[] = []
        // Drop the duplicated closing key if the walk returned to start.
        const closed = loopKeys[loopKeys.length - 1] === loopKeys[0]
        const keys = closed ? loopKeys.slice(0, -1) : loopKeys
        for (const k of keys) {
          const p = coordOf.get(k)
          if (p) pts.push(p)
        }
        if (pts.length >= 3) loops.push(pts)
      }
    }

    for (const pts of loops) {
          let signedArea = 0
          let cx = 0
          let cy = 0
          let Ix = 0 // second moment of area about centerline Y=0 (Iₜ)
          for (let k = 0; k < pts.length; k++) {
            const p = pts[k]
            const q = pts[(k + 1) % pts.length]
            const cross = p.x * q.y - q.x * p.y
            signedArea += cross
            cx += p.x
            cy += p.y
            // Iₜ contribution for this edge: (y₁² + y₁y₂ + y₂²) * (x₁y₂ - x₂y₁) / 12
            Ix += (p.y * p.y + p.y * q.y + q.y * q.y) * cross
          }
          signedArea /= 2
          if (Math.abs(signedArea) < 1e-9) continue
          waterplaneAreaMm2 += Math.abs(signedArea)
          // Iₜ = Ix / 12 for the polygon (about Y=0 axis)
          waterplaneIx += Ix / 12
          cx /= pts.length
          cy /= pts.length
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

  return { clipped: new Float32Array(out), waterplaneAreaMm2, waterplaneIx }
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
 * @throws when the target is non-positive or exceeds the hull's total volume.
 */
export function find_draft_0trim(mesh: MeshLike, target_kg: number, KG?: number): Draft0TrimResult {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('find_draft_0trim: empty mesh')
  if (!Number.isFinite(target_kg) || target_kg <= 0) {
    throw new Error(`find_draft_0trim: target_kg must be > 0 (got ${target_kg})`)
  }

  const bounds = computeBounds(positions)
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
  const upperV = volumeBelowPlane(positions, upperH)
  planesEvaluated++

  // Degenerate case: target equals total volume — floating at the deck edge.
              if (upperV <= targetVolumeMm3) {
                const { clipped, waterplaneAreaMm2, waterplaneIx } = clipBelowPlane(positions, upperH)
                const { centroid: lcb } = computeVolumeAndCentroid(clipped)
                                          const draftMm = maxZ - minZ
                                          const LWL = bounds.size.x
                                          const BWL = LWL > 0 ? waterplaneAreaMm2 / LWL : bounds.size.y
                                          const boxVolumeMm3 = LWL * BWL * draftMm
                                          const Cb = boxVolumeMm3 > 0 ? upperV / boxVolumeMm3 : 0
                                          // Max cross-section area (standard Cp/Cm definition uses Am_max)
                                          const midshipAreaMm2 = findMaxCrossSectionArea(positions, bounds.min.x, bounds.max.x)
                                          const Cp = (midshipAreaMm2 > 0 && LWL > 0) ? upperV / (midshipAreaMm2 * LWL) : 0
                                          // Midship coefficient: Cm = Am_max / (BWL × draft)
                                          const Cm = (midshipAreaMm2 > 0 && BWL > 0 && draftMm > 0) ? midshipAreaMm2 / (BWL * draftMm) : 0
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
                                                                                                                                                                                                                                                                                                      for (let i = 0; i < positions.length; i += 9) {
                                                                                                                                                                                                                                                                                                          for (const vx of [i, i + 3, i + 6]) {
                                                                                                                                                                                                                                                                                                              const x = positions[vx]
                                                                                                                                                                                                                                                                                                              const z = positions[vx + 2]
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        midshipAreaMm2: Number(midshipAreaMm2.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        Cp: Number(Cp.toFixed(4)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        Cm: Number(Cm.toFixed(4)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        KB: Number(KB.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        BM: Number(BM.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        KM: Number(KM.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        GM: Number(GM.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        bowFreeboardMm: Number(bowFreeboardMm.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        sternFreeboardMm: Number(sternFreeboardMm.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      }
                                                                                                                                                                                        }

  // Binary search: find waterline Z so volumeBelowPlane(positions, Z) ≈ target.
    // V(h) decreases monotonically as h drops from maxZ to minZ, so bisection
    // converges quickly. Bracket phase steps down in 10 mm increments, then bisects.
    let lo = minZ
    let hi = upperH
    let waterlineZ = upperH

    // Bracket: coarse scan to narrow the range to a 10mm window.
    for (let h = maxZ - 10; h >= minZ; h -= 10) {
      const v = volumeBelowPlane(positions, h)
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
      const v = volumeBelowPlane(positions, mid)
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
    const { clipped, waterplaneAreaMm2, waterplaneIx } = clipBelowPlane(positions, waterlineZ)
      const { volumeMm3: verifiedVolumeMm3, centroid: lcb } =
        computeVolumeAndCentroid(clipped)
      planesEvaluated += 1

      // Force transverse symmetry: LCB Y = hull centerline
      const boundsForLcb = computeBounds(positions)
      lcb.y = boundsForLcb.center.y

      const displacementKg = verifiedVolumeMm3 / MM3_PER_KG
        const relErr = Math.abs(verifiedVolumeMm3 - targetVolumeMm3) / targetVolumeMm3

        // Compute Block Coefficient (Cb): Cb = V / (LWL × BWL × draft)
              // LWL: length of submerged hull along X
              // BWL: mean waterline beam = waterplane area / LWL
              // draft: draft above keel
              const draftMm = waterlineZ - minZ
              const LWL = bounds.size.x // approximation for box/straight hull; matches length
                      const BWL = LWL > 0 ? waterplaneAreaMm2 / LWL : bounds.size.y
                      const boxVolumeMm3 = LWL * BWL * draftMm
                      const Cb = boxVolumeMm3 > 0 ? verifiedVolumeMm3 / boxVolumeMm3 : 0
                      // Midship section area and Prismatic Coefficient
                                      // Find max cross-section area (standard Cp/Cm definition uses Am_max)
                                      const midshipAreaMm2 = findMaxCrossSectionArea(positions, bounds.min.x, bounds.max.x)
                                      const Cp = (midshipAreaMm2 > 0 && LWL > 0) ? verifiedVolumeMm3 / (midshipAreaMm2 * LWL) : 0
                                      // Midship coefficient: Cm = Am_max / (BWL × draft)
                                      const Cm = (midshipAreaMm2 > 0 && BWL > 0 && draftMm > 0) ? midshipAreaMm2 / (BWL * draftMm) : 0
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                        for (let i = 0; i < positions.length; i += 9) {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                            for (const vx of [i, i + 3, i + 6]) {
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                const x = positions[vx]
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                const z = positions[vx + 2]
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
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              midshipAreaMm2: Number(midshipAreaMm2.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              Cp: Number(Cp.toFixed(4)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              Cm: Number(Cm.toFixed(4)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              KB: Number(KB.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              BM: Number(BM.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              KM: Number(KM.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              GM: Number(GM.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              bowFreeboardMm: Number(bowFreeboardMm.toFixed(1)),
                                                                                                                                                                                                                                                                                                                                                                                                                                                                              sternFreeboardMm: Number(sternFreeboardMm.toFixed(1)),
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
  },
): TrimSolveResult {
  const positions = toPositions(mesh)
  if (positions.length === 0) throw new Error('solve_trim: empty mesh')

  // Decimate once for the entire trim sweep — keeps solver fast.
    // Use decimated mesh for all hydrostatic evaluations; original mesh for display.
    const solveMesh = decimateMesh(positions, DEFAULT_SOLVER_TRIANGLES)

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

  let bestAngleDeg = 0
  let bestOffset = Infinity
  let bestResult: Draft0TrimResult | null = null
  let totalPlanes = 0

  // Working copy of positions to avoid mutating source mesh during pitch sweeps
  const workingPositions = new Float32Array(solveMesh.length)

  // --- Coarse sweep: 0.5° steps to find the neighborhood ---
  for (let deg = -maxTrimDeg; deg <= maxTrimDeg + 1e-6; deg += coarseStepDeg) {
    const rad = (deg * Math.PI) / 180
    workingPositions.set(solveMesh)
    applyPitchY(workingPositions, rad, targetLcgX, bounds.center.z)

    try {
          const res = find_draft_0trim(workingPositions, target_kg, lcg.z)
          totalPlanes += res.planesEvaluated

      const cosA = Math.cos(rad)
      const sinA = Math.sin(rad)
      const rx = res.lcb.x - targetLcgX
      const rz = res.lcb.z - bounds.center.z
      const origLcbX = rx * cosA + rz * sinA + targetLcgX
      const origLcbY = bounds.center.y
      const origLcbZ = -rx * sinA + rz * cosA + bounds.center.z

      const offset = Math.abs(origLcbX - targetLcgX)
      if (offset < bestOffset) {
        bestOffset = offset
        bestAngleDeg = deg
        bestResult = {
          ...res,
          lcb: { x: origLcbX, y: origLcbY, z: origLcbZ },
        }
      }
    } catch {
      // Continue if one extreme angle fails to bracket
    }
  }

  // --- Fine sweep: ±0.5° around best at 0.1° steps ---
  const fineStart = bestAngleDeg - coarseStepDeg
  const fineEnd = bestAngleDeg + coarseStepDeg
  for (let deg = fineStart; deg <= fineEnd + 1e-6; deg += fineStepDeg) {
    const rad = (deg * Math.PI) / 180
    workingPositions.set(solveMesh)
    applyPitchY(workingPositions, rad, targetLcgX, bounds.center.z)

    try {
          const res = find_draft_0trim(workingPositions, target_kg, lcg.z)
          totalPlanes += res.planesEvaluated

      const cosA = Math.cos(rad)
      const sinA = Math.sin(rad)
      const rx = res.lcb.x - targetLcgX
      const rz = res.lcb.z - bounds.center.z
      const origLcbX = rx * cosA + rz * sinA + targetLcgX
      const origLcbY = bounds.center.y
      const origLcbZ = -rx * sinA + rz * cosA + bounds.center.z

      const offset = Math.abs(origLcbX - targetLcgX)
      if (offset < bestOffset) {
        bestOffset = offset
        bestAngleDeg = deg
        bestResult = {
          ...res,
          lcb: { x: origLcbX, y: origLcbY, z: origLcbZ },
        }
      }
    } catch {
      // Continue if one angle fails
    }
  }

  if (!bestResult) {
                  const fallback = find_draft_0trim(solveMesh, target_kg, lcg.z)
                  bestResult = {
                    ...fallback,
                              lcb: { ...fallback.lcb, y: bounds.center.y }, // Force centerline
                              Cb: fallback.Cb,
                              midshipAreaMm2: fallback.midshipAreaMm2,
                              Cp: fallback.Cp,
                              Cm: fallback.Cm,
                              KB: fallback.KB,
                              BM: fallback.BM,
                              KM: fallback.KM,
                              GM: fallback.GM,
                              bowFreeboardMm: Number((bowTipZ - (fallback.waterlineZ - bowX * Math.tan(0))).toFixed(1)),
                              sternFreeboardMm: Number((sternTipZ - (fallback.waterlineZ - sternX * Math.tan(0))).toFixed(1)),
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
                                            }
  }
