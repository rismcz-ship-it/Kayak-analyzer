// Waterplane (hydrostatics) solver — first pass: zero-trim draft.
//
// Conventions (shared with src/lib/geometry.ts):
// - Z-up, X = LOA (forward), Y = BOA (side). All STL units are millimetres.
// - "Draft" is measured upwards from the keel (bounding-box min Z).
// - Fresh water: rho = 1000 kg/m^3, so 1 kg <-> 1 L <-> 1_000_000 mm^3.
// - Zero trim means the waterplane is horizontal (no heel, no trim angle).

import { computeBounds } from './geometry'

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
  /** Waterplane (cap) area at the waterline, mm^2. */
  waterplaneAreaMm2: number
  /** Sweep step used (1 mm planes, per spec). */
  stepMm: number
  /** Number of waterplane evaluations during the sweep. */
  planesEvaluated: number
  /** True when the bracket + verification volume closed on the target. */
  converged: boolean
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
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]
        const q = pts[(k + 1) % pts.length]
        signedArea += p.x * q.y - q.x * p.y
        cx += p.x
        cy += p.y
      }
      signedArea /= 2
      if (Math.abs(signedArea) < 1e-9) continue
      waterplaneAreaMm2 += Math.abs(signedArea)
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

  return { clipped: new Float32Array(out), waterplaneAreaMm2 }
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
 * @throws when the target is non-positive or exceeds the hull's total volume.
 */
export function find_draft_0trim(mesh: MeshLike, target_kg: number): Draft0TrimResult {
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

  // Sweep downwards: h = maxZ, maxZ-1, … — first plane already holds the full
  // volume, so V(h) decreases monotonically-ish as h drops.
  let upperH = maxZ
  let upperV = volumeBelowPlane(positions, upperH)
  planesEvaluated++

  // Degenerate case: target equals total volume — floating at the deck edge.
  if (upperV <= targetVolumeMm3) {
    const { waterplaneAreaMm2 } = clipBelowPlane(positions, upperH)
    return {
      draftMm: maxZ - minZ,
      waterlineZ: maxZ,
      displacedVolumeMm3: upperV,
      displacementKg: upperV / MM3_PER_KG,
      targetKg: target_kg,
      waterplaneAreaMm2,
      stepMm,
      planesEvaluated,
      converged: Math.abs(upperV - targetVolumeMm3) / targetVolumeMm3 < 1e-6,
    }
  }

  let lowerH = upperH
  let lowerV = upperV
  let bracketed = false

  for (let h = maxZ - stepMm; h >= minZ; h -= stepMm) {
    const v = volumeBelowPlane(positions, h)
    planesEvaluated++
    if (v <= targetVolumeMm3) {
      lowerH = h
      lowerV = v
      bracketed = true
      break
    }
    upperH = h
    upperV = v
  }

  if (!bracketed) {
    // Target smaller than the bottom 1 mm slice — sit just off the keel.
    lowerH = minZ
    lowerV = 0
    bracketed = true
  }

  // Linear interpolation between the bracketing 1 mm planes.
  let waterlineZ: number
  if (upperV <= lowerV || Math.abs(upperV - lowerV) < 1e-12) {
    waterlineZ = lowerH
  } else {
    const f = (targetVolumeMm3 - lowerV) / (upperV - lowerV)
    waterlineZ = lowerH + Math.max(0, Math.min(1, f)) * stepMm
  }

  // Verification pass: clip exactly at the interpolated waterline so the
  // returned displacement is a measured mesh volume, not the interpolation.
  const { clipped, waterplaneAreaMm2 } = clipBelowPlane(positions, waterlineZ)
  const verifiedVolumeMm3 = clipped.length === 0 ? 0 : Math.abs(signedVolumeMm3(clipped))
  planesEvaluated += 1

  const displacementKg = verifiedVolumeMm3 / MM3_PER_KG
  const relErr = Math.abs(verifiedVolumeMm3 - targetVolumeMm3) / targetVolumeMm3

  return {
    draftMm: waterlineZ - minZ,
    waterlineZ,
    displacedVolumeMm3: verifiedVolumeMm3,
    displacementKg,
    targetKg: target_kg,
    waterplaneAreaMm2,
    stepMm,
    planesEvaluated,
    converged: relErr < 0.01,
  }
}
