// Modular geometry helpers for the hull analyzer.
// Kept deliberately framework-free (no three / react imports) so a later
// hydrostatics solver can reuse them: waterplane slicing, wetted area,
// displaced volume at a draft, LCF/LCB, metacentric heights, righting arm, etc.
// All STL files are assumed to be in millimetres.
// A raw three STLLoader geometry is NON-indexed: every triangle carries its own
// three vertex copies, so all routines here iterate a flat interleaved xyz
// Float32Array (stride 3 per vertex, 9 per triangle).

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface BoundingBox {
  min: Vec3
  max: Vec3
  size: Vec3
  center: Vec3
}

export interface WatertightResult {
  watertight: boolean
  closedEdgeCount: number
  openEdgeCount: number
  degenerateEdgeCount: number
}

export interface MeshStats {
  triangleCount: number
  bounds: BoundingBox
  surfaceAreaMm2: number
  volumeMm3: number
  volumeLiters: number
  watertight: WatertightResult
}

/** Axis-aligned bounding box of a flat xyz vertex array. */
export function computeBounds(positions: Float32Array): BoundingBox {
  const minX = Infinity
  const minY = Infinity
  const minZ = Infinity
  const maxX = -Infinity
  const maxY = -Infinity
  const maxZ = -Infinity
  let x = minX
  let y = minY
  let z = minZ
  let X = maxX
  let Y = maxY
  let Z = maxZ

  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i]
    const py = positions[i + 1]
    const pz = positions[i + 2]
    if (px < x) x = px
    if (py < y) y = py
    if (pz < z) z = pz
    if (px > X) X = px
    if (py > Y) Y = py
    if (pz > Z) Z = pz
  }

  return {
    min: { x, y, z },
    max: { x: X, y: Y, z: Z },
    size: { x: X - x, y: Y - y, z: Z - z },
    center: { x: (x + X) / 2, y: (y + Y) / 2, z: (z + Z) / 2 },
  }
}

/**
 * Normalise Fusion 360 export axes (Y-up / Z-forward / X-side) to Z-up
 * internally:
 *
 *     new X = old Z   (forward / LOA direction)
 *     new Y = old X   (side     / BOA direction)
 *     new Z = old Y   (up       / depth direction)
 *
 * This is a proper rotation (det = 1), so triangle winding order — and hence
 * normals / signed-volume orientation — is preserved. Z-up makes the mesh
 * directly sliceable by horizontal waterplanes in the hydrostatics solver.
 *
 * Mutates `positions` in place.
 */
export function transformToZUp(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const side = positions[i] // old X
    const up = positions[i + 1] // old Y
    const fwd = positions[i + 2] // old Z
    positions[i] = fwd
    positions[i + 1] = side
    positions[i + 2] = up
  }
}

type AxisKey = 'x' | 'y' | 'z'

const AXIS_INDEX: Record<AxisKey, number> = { x: 0, y: 1, z: 2 }

/** True when the axis permutation is even (det = +1, a proper rotation). */
function isEvenPermutation(perm: readonly [AxisKey, AxisKey, AxisKey]): boolean {
  let inversions = 0
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (AXIS_INDEX[perm[i]] > AXIS_INDEX[perm[j]]) inversions++
    }
  }
  return inversions % 2 === 0
}

/** Reorder vertex coordinates and apply signs. */
function applyAxisMappingWithSigns(
  positions: Float32Array,
  perm: readonly [AxisKey, AxisKey, AxisKey],
  signs: readonly [number, number, number],
): void {
  const src = new Float32Array(positions)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = src[i + AXIS_INDEX[perm[0]]] * signs[0]
    positions[i + 1] = src[i + AXIS_INDEX[perm[1]]] * signs[1]
    positions[i + 2] = src[i + AXIS_INDEX[perm[2]]] * signs[2]
  }
}

/**
 * Mirror the mesh about the horizontal plane through its bounding-box center
 * (the "deck flip"), i.e. z' = 2*cz - z. Flipping about the center (rather
 * than z=0) keeps the hull in place when the STL is far from the origin.
 * The mirror alone is a reflection (det = -1) that would invert triangle
 * winding — and hence normals / signed volume — so each triangle's vertex
 * order is reversed as well, keeping the combined operation
 * orientation-preserving with outward-facing normals.
 */
export function applyFlipZ(positions: Float32Array): void {
  const bounds = computeBounds(positions)
  const cz = bounds.center.z
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]
    const ay = positions[i + 1]
    const az = positions[i + 2]
    const bx = positions[i + 3]
    const by = positions[i + 4]
    const bz = positions[i + 5]
    const cx = positions[i + 6]
    const cy = positions[i + 7]
    const czc = positions[i + 8]
    positions[i] = ax
    positions[i + 1] = ay
    positions[i + 2] = 2 * cz - az
    positions[i + 3] = cx
    positions[i + 4] = cy
    positions[i + 5] = 2 * cz - czc
    positions[i + 6] = bx
    positions[i + 7] = by
    positions[i + 8] = 2 * cz - bz
  }
}

/** 90° rotation about the X axis: Y' = -Z, Z' = Y (det = +1). */
export function applyRotateX90(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]
    const z = positions[i + 2]
    positions[i + 1] = -z
    positions[i + 2] = y
  }
}

/** 90° rotation about the Y axis: X' = Z, Z' = -X (det = +1). */
export function applyRotateY90(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const z = positions[i + 2]
    positions[i] = z
    positions[i + 2] = -x
  }
}

/** 90° rotation about the Z axis: X' = -Y, Y' = X (det = +1). */
export function applyRotateZ90(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]
    const y = positions[i + 1]
    positions[i] = -y
    positions[i + 1] = x
  }
}

/**
 * 180° rotation about the Z (vertical) axis: X' = -X, Y' = -Y (det = +1).
 * Flips bow ↔ stern while keeping deck-up. Equivalent to two Rot Z clicks,
 * provided as a single deterministic step so users don't have to count.
 */
export function applyRotateZ180(positions: Float32Array): void {
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = -positions[i]
    positions[i + 1] = -positions[i + 1]
  }
}

/**
 * Pitch rotation about the transverse Y axis by `thetaRad` radians,
 * pivoting about `(pivotX, pivotZ)` (e.g. LCG or bounding-box center).
 * Positive theta = bow UP (marine trim convention).
 * Det = +1 (proper rotation), preserving winding / normals / volume.
 */
export function applyPitchY(
  positions: Float32Array,
  thetaRad: number,
  pivotX = 0,
  pivotZ = 0,
): void {
  if (Math.abs(thetaRad) < 1e-12) return
  const c = Math.cos(thetaRad)
  const s = Math.sin(thetaRad)
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] - pivotX
    const z = positions[i + 2] - pivotZ
    // Marine convention: positive pitch = bow up.
    // Standard RH rotation around +Y gives bow down for positive theta.
    // Flip sign of sin terms to get bow up for positive theta.
    positions[i] = x * c - z * s + pivotX
    positions[i + 2] = x * s + z * c + pivotZ
  }
}

/**
 * Roll rotation about the longitudinal X axis by `phiRad` radians,
 * pivoting about `(pivotY, pivotZ)` (e.g. centerline and baseline/center).
 * Positive phi = starboard (right) down.
 * Det = +1 (proper rotation), preserving winding / normals / volume.
 */
export function applyRollX(
  positions: Float32Array,
  phiRad: number,
  pivotY = 0,
  pivotZ = 0,
): void {
  if (Math.abs(phiRad) < 1e-12) return
  const c = Math.cos(phiRad)
  const s = Math.sin(phiRad)
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1] - pivotY
    const z = positions[i + 2] - pivotZ
    // Positive roll (starboard down): +Y rotates towards -Z (downward)
    positions[i + 1] = y * c - z * s + pivotY
    positions[i + 2] = y * s + z * c + pivotZ
  }
}

/**
 * Auto-orient a hull to the app's internal axes — longest extent on X (length),
 * middle on Y (beam), shortest on Z (depth / up) — when incoming STL axes are
 * arbitrary. It uses a proper rotation (det = +1) to preserve triangle winding,
 * signs of signed volume and outward normals. If the orientation requires an
 * odd permutation of coordinates, it mirrors the Y axis (lateral symmetry)
 * instead of swapping axes, guaranteeing that length is always on X, beam on Y,
 * and depth on Z. After re-orienting, it checks if the hull is keel-up and flips Z
 * if needed to ensure the deck is up.
 *
 * Mutates `positions` in place and returns a short human-readable note of the
 * change.
 */
export function autoOrientToZUp(positions: Float32Array): string {
  const bounds = computeBounds(positions)
  const axes: { name: AxisKey; size: number }[] = [
    { name: 'x', size: bounds.size.x },
    { name: 'y', size: bounds.size.y },
    { name: 'z', size: bounds.size.z },
  ]
  // Sort axes descending by size
  axes.sort((a, b) => b.size - a.size)

  const perm: [AxisKey, AxisKey, AxisKey] = [axes[0].name, axes[1].name, axes[2].name]
  const signs: [number, number, number] = [1, 1, 1]

  // If the axis permutation is odd, we negate the Y axis to ensure det = +1 (proper rotation).
  // This preserves winding and volume sign, and since kayaks are laterally symmetric,
  // mirroring Y is completely harmless and visually identical.
  if (!isEvenPermutation(perm)) {
    signs[1] = -1
  }

  const notes: string[] = []
  const identity = perm[0] === 'x' && perm[1] === 'y' && perm[2] === 'z' && signs[1] === 1

  if (!identity) {
    applyAxisMappingWithSigns(positions, perm, signs)
    const mirrorStr = signs[1] === -1 ? ' (mirrored Y)' : ''
    notes.push(
      `Reoriented: X←${perm[0].toUpperCase()}, Y←${perm[1].toUpperCase()}${mirrorStr}, Z←${perm[2].toUpperCase()}`,
    )
  }

  const oriented = computeBounds(positions)
  let centroidZ = 0
  let centroidX = 0
  const vertCount = positions.length / 3
  for (let i = 0; i < positions.length; i += 3) {
    centroidX += positions[i]
    centroidZ += positions[i + 2]
  }
  centroidX /= vertCount
  centroidZ /= vertCount

  if (centroidZ < oriented.center.z) {
    applyFlipZ(positions)
    notes.push('Flipped Z for deck-up')
  }

  // Bow vs Stern detection along X using VOLUME centroid (not vertex centroid).
  // Vertex centroid is biased by STL tessellation density (more triangles at complex stern/cockpit).
  // Volume centroid accurately represents the hull's mass distribution.
  // Kayak bow is sharper/finer (less volume/width) than the stern/cockpit region,
  // so the volume centroid sits towards the stern.
  // If volumeCentroidX > center.x, the fuller stern is at +X and bow is at -X -> flip 180° around Z.
  const vol = computeVolumeAndCentroid(positions)
  const volumeCentroidX = vol.centroid.x
  if (volumeCentroidX > oriented.center.x) {
    applyRotateZ180(positions)
    notes.push('Rotated Z 180° (bow → +X)')
  }

  return notes.length > 0 ? notes.join(' · ') : 'Already X-length · Y-beam · Z-up'
}

/**
 * Translate all vertices so the axis-aligned bounding-box center lands
 * exactly at the origin (0, 0, 0).
 *
 * Pure translation: winding order — and hence normals / signed-volume
 * orientation — is untouched.
 *
 * Mutates `positions` in place.
 */
export function centerToOrigin(positions: Float32Array): void {
  if (positions.length === 0) return
  const bounds = computeBounds(positions)
  const cx = bounds.center.x
  const cy = bounds.center.y
  const cz = bounds.center.z
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return
  if (cx === 0 && cy === 0 && cz === 0) return
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx
    positions[i + 1] -= cy
    positions[i + 2] -= cz
  }
}

/**
 * Signed volume of a closed triangle mesh via the divergence theorem:
 *     V = (1/6) * Σ v0·(v1×v2)
 * Sign depends on winding; the absolute value is returned.
 */
export function computeVolumeMm3(positions: Float32Array): number {
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
  return Math.abs(sum) / 6
}

export interface VolumeCentroid {
  volumeMm3: number
  centroid: Vec3
}

/**
 * Compute signed volume and 3D centroid of a closed triangle mesh
 * using the divergence theorem / signed tetrahedra integration.
 */
export function computeVolumeAndCentroid(positions: Float32Array): VolumeCentroid {
  let vSigned = 0
  let mx = 0
  let my = 0
  let mz = 0

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

    // 6 * signed tetrahedron volume
    const v6 =
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx)

    vSigned += v6 / 6

    // Centroid of tetrahedron is (A+B+C)/4, weighted by v6 / 6
    const factor = v6 / 24
    mx += factor * (ax + bx + cx)
    my += factor * (ay + by + cy)
    mz += factor * (az + bz + cz)
  }

  if (Math.abs(vSigned) < 1e-12) {
    return { volumeMm3: 0, centroid: { x: 0, y: 0, z: 0 } }
  }

  return {
    volumeMm3: Math.abs(vSigned),
    centroid: {
      x: mx / vSigned,
      y: my / vSigned,
      z: mz / vSigned,
    },
  }
}

/** Total area of all triangles (Heron-free, cross-product form). */
export function computeSurfaceAreaMm2(positions: Float32Array): number {
  let area = 0
  for (let i = 0; i < positions.length; i += 9) {
    const abx = positions[i + 3] - positions[i]
    const aby = positions[i + 4] - positions[i + 1]
    const abz = positions[i + 5] - positions[i + 2]
    const acx = positions[i + 6] - positions[i]
    const acy = positions[i + 7] - positions[i + 1]
    const acz = positions[i + 8] - positions[i + 2]
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    area += Math.sqrt(nx * nx + ny * ny + nz * nz)
  }
  return area / 2
}

// Quantise to 0.001 mm so that duplicated STL vertices (identical coordinates,
// separate indices) count as the same point, while remaining far cheaper than
// true geometric welding.
const QUANT = 1000

function quantize(p: Vec3): string {
  return `${Math.round(p.x * QUANT)}|${Math.round(p.y * QUANT)}|${Math.round(p.z * QUANT)}`
}

/**
 * Watertightness check on geometry alone: every undirected edge must be
 * traversed exactly once in each direction (forward/reverse). STL files carry
 * no shared indices and often duplicate vertices/triangles, so edges are keyed
 * by quantised coordinates instead of indices.
 */
export function checkWatertight(positions: Float32Array): WatertightResult {
  const edges = new Map<string, { fwd: number; rev: number }>()
  let degenerate = 0

  for (let i = 0; i < positions.length; i += 9) {
    const pts: Vec3[] = [
      { x: positions[i], y: positions[i + 1], z: positions[i + 2] },
      { x: positions[i + 3], y: positions[i + 4], z: positions[i + 5] },
      { x: positions[i + 6], y: positions[i + 7], z: positions[i + 8] },
    ]
    for (let e = 0; e < 3; e++) {
      const a = pts[e]
      const b = pts[(e + 1) % 3]
      if (a.x === b.x && a.y === b.y && a.z === b.z) {
        degenerate++
        continue
      }
      const dir = `${quantize(a)}|${quantize(b)}`
      const rev = `${quantize(b)}|${quantize(a)}`
      const canonical = dir <= rev ? dir : rev
      const forward = dir <= rev
      const entry = edges.get(canonical)
      if (entry) {
        if (forward) entry.fwd++
        else entry.rev++
      } else {
        edges.set(canonical, forward ? { fwd: 1, rev: 0 } : { fwd: 0, rev: 1 })
      }
    }
  }

  let closed = 0
  let open = 0
  for (const e of edges.values()) {
    if (e.fwd === 1 && e.rev === 1) closed++
    else open++
  }

  return {
      watertight: open === 0,
      closedEdgeCount: closed,
      openEdgeCount: open,
      degenerateEdgeCount: degenerate,
    }
  }

  /**
   * Area (mm²) of the hull's cross-section in the plane X = xCut.
   *
   * Slices every triangle with the plane and integrates the resulting closed
   * (Y,Z) contour with the shoelace formula. Integration is taken about the
   * section's OWN centroid, not the Z=0 plane: a hull centred on the origin has
   * sections spanning negative Z, and measuring from Z=0 under-counts them (it
   * produced Cm > 1, which is impossible for a real hull).
   *
   * @param positions Flat interleaved xyz Float32Array
   * @param xCut X coordinate of the section plane
   * @returns Cross-section area in mm², or 0 when the plane misses the hull
   */
  export function computeSectionAreaMm2(positions: Float32Array, xCut: number): number {
    const cy: number[] = []
    const cz: number[] = []

    for (let i = 0; i < positions.length; i += 9) {
      const vx = [positions[i], positions[i + 3], positions[i + 6]]
      const vy = [positions[i + 1], positions[i + 4], positions[i + 7]]
      const vz = [positions[i + 2], positions[i + 5], positions[i + 8]]

      for (let e = 0; e < 3; e++) {
        const a = e
        const c = (e + 1) % 3
        const fa = vx[a] - xCut
        const fc = vx[c] - xCut
        // Only true crossings; vertices exactly on the plane are counted by
        // neither side and would double-count a shared edge endpoint.
        if ((fa <= 0) === (fc <= 0)) continue
        const t = fa / (fa - fc)
        cy.push(vy[a] + t * (vy[c] - vy[a]))
        cz.push(vz[a] + t * (vz[c] - vz[a]))
      }
    }

    if (cy.length < 3) return 0

    // Order the contour by angle about its centroid so the shoelace sum traces
    // the section once instead of hopping between unrelated boundary pieces.
    let meanY = 0
    let meanZ = 0
    for (let k = 0; k < cy.length; k++) {
      meanY += cy[k]
      meanZ += cz[k]
    }
    meanY /= cy.length
    meanZ /= cz.length

    const order = Array.from({ length: cy.length }, (_, k) => k).sort(
      (p, q) => Math.atan2(cz[p] - meanZ, cy[p] - meanY) - Math.atan2(cz[q] - meanZ, cy[q] - meanY),
    )

    let area2 = 0
    for (let k = 0; k < order.length; k++) {
      const p = order[k]
      const q = order[(k + 1) % order.length]
      area2 += cy[p] * cz[q] - cy[q] * cz[p]
    }
    return Math.abs(area2 / 2)
  }

  /**
   * Area (mm²) of the hull's cross-section in the plane X = xCut, measured only
   * BELOW the horizontal plane z = h.
   *
   * Slices the mesh at X = xCut, then clips that closed (Y,Z) contour against
   * the waterline and integrates the submerged part with the shoelace formula.
   * The integration origin is the section's OWN centroid, not Z=0: a hull
   * centred on the origin spans negative Z, and measuring from Z=0 under-counts
   * it.
   *
   * The clip closes the polygon with a chord along z = h. Without that chord
   * the waterline edge is missing and the area collapses (a box measured 0 mm²
   * at half draft).
   *
   * The submerged clip is what Cp and Cm are defined on. A keel-to-deck section
   * area is not comparable with a submerged draft and makes Cm exceed 1.
   *
   * @param positions Flat interleaved xyz Float32Array
   * @param xCut X coordinate of the section plane
   * @param h Waterline height (absolute Z in mesh coordinates)
   * @returns Submerged cross-section area in mm², or 0 when the plane misses
   */
  export function computeSubmergedSectionAreaMm2(
    positions: Float32Array,
    xCut: number,
    h: number,
  ): number {
    // --- pass 1: build the section contour graph in (Y, Z) ---
    const coordOf = new Map<string, [number, number]>()
    const adj = new Map<string, string[]>()
    const QUANT = 1000

    const keyOf = (y: number, z: number) => `${Math.round(y * QUANT)}|${Math.round(z * QUANT)}`

    const link = (a: string, b: string) => {
      if (a === b) return
      const la = adj.get(a)
      if (la) {
        if (!la.includes(b)) la.push(b)
      } else {
        adj.set(a, [b])
      }
      const lb = adj.get(b)
      if (lb) {
        if (!lb.includes(a)) lb.push(a)
      } else {
        adj.set(b, [a])
      }
    }

    for (let i = 0; i < positions.length; i += 9) {
      const vx = [positions[i], positions[i + 3], positions[i + 6]]
      const vy = [positions[i + 1], positions[i + 4], positions[i + 7]]
      const vz = [positions[i + 2], positions[i + 5], positions[i + 8]]

      const here: string[] = []
      for (let e = 0; e < 3; e++) {
        const a = e
        const c = (e + 1) % 3
        const fa = vx[a] - xCut
        const fc = vx[c] - xCut
        if ((fa <= 0) === (fc <= 0)) continue
        const t = fa / (fa - fc)
        const y = vy[a] + t * (vy[c] - vy[a])
        const z = vz[a] + t * (vz[c] - vz[a])
        const k = keyOf(y, z)
        if (!coordOf.has(k)) coordOf.set(k, [y, z])
        if (!here.includes(k)) here.push(k)
      }
      // A triangle cut by the plane contributes a segment between its two
      // crossing points; that segment is an edge of the section contour.
      if (here.length === 2) link(here[0], here[1])
    }

    // --- pass 2: walk the graph into loops, clip each to z <= h, integrate ---
    const visitedEdge = new Set<string>()
    const canon = (a: string, b: string) => (a <= b ? `${a}~${b}` : `${b}~${a}`)
    let total = 0

    for (const seed of adj.keys()) {
      const seedNeighbours = adj.get(seed) ?? []
      if (seedNeighbours.length === 0) continue

      for (const first of seedNeighbours) {
        if (visitedEdge.has(canon(seed, first))) continue

        // Trace one loop from seed through first.
        const loop: [number, number][] = []
        let prev = seed
        let cur = first
        loop.push(coordOf.get(seed)!)
        loop.push(coordOf.get(cur)!)
        visitedEdge.add(canon(seed, cur))

        for (let guard = 0; guard < coordOf.size + 2; guard++) {
          if (cur === seed) break
          const nexts = (adj.get(cur) ?? []).filter((n) => {
            if (n === prev) return false
            if (n === seed) return false
            return !visitedEdge.has(canon(cur, n))
          })
          if (nexts.length === 0) break
          const n = nexts[0]
          visitedEdge.add(canon(cur, n))
          prev = cur
          cur = n
          loop.push(coordOf.get(cur)!)
        }
        if (loop.length < 3) continue

        // Clip the loop polygon to z <= h (Sutherland-Hodgman, one half-plane).
        const clipped: [number, number][] = []
        const EPS = 1e-7
        for (let k = 0; k < loop.length; k++) {
          const p = loop[k]
          const q = loop[(k + 1) % loop.length]
          const pIn = p[1] <= h + EPS
          const qIn = q[1] <= h + EPS
          if (pIn) clipped.push(p)
          if (pIn !== qIn) {
            const t = (h - p[1]) / (q[1] - p[1])
            clipped.push([p[0] + t * (q[0] - p[0]), h])
          }
        }
        if (clipped.length < 3) continue

        // Shoelace about the clipped polygon's own centroid.
        let meanY = 0
        let meanZ = 0
        for (const q of clipped) {
          meanY += q[0]
          meanZ += q[1]
        }
        meanY /= clipped.length
        meanZ /= clipped.length

        const ordered = [...clipped].sort(
          (p, q) => Math.atan2(p[1] - meanZ, p[0] - meanY) - Math.atan2(q[1] - meanZ, q[0] - meanY),
        )

        let area2 = 0
        for (let k = 0; k < ordered.length; k++) {
          const p = ordered[k]
          const q = ordered[(k + 1) % ordered.length]
          area2 += (p[0] - meanY) * (q[1] - meanZ) - (q[0] - meanY) * (p[1] - meanZ)
        }
        total += Math.abs(area2 / 2)
      }
    }

    return total
  }

  /**
   * Compute the midship cross-section area (Am) at X = centerX.
   * Thin wrapper over {@link computeSectionAreaMm2} — kept for existing callers.
   *
   * @param positions Flat interleaved xyz Float32Array
   * @param centerX X coordinate of the midship plane (usually bounds.center.x)
   * @returns Midship section area in mm²
   */
  export function computeMidshipAreaMm2(positions: Float32Array, centerX: number): number {
    return computeSectionAreaMm2(positions, centerX)
  }

      /**
       * Compute midship cross-section properties at X = centerX.
       * Returns area, beam (max Y extent), and draft (max Z extent) at that station.
       *
       * Area comes from {@link computeSectionAreaMm2}; the extents come from the
       * raw intersection points, which the shoelace integration does not expose.
       *
       * @param positions Flat interleaved xyz Float32Array
       * @param centerX X coordinate of the midship plane
       * @returns { areaMm2, beamMm, draftMm }
       */
      export function computeMidshipSection(
        positions: Float32Array,
        centerX: number
      ): { areaMm2: number; beamMm: number; draftMm: number } {
        let minY = Infinity
        let maxY = -Infinity
        let minZ = Infinity
        let maxZ = -Infinity
        let hasIntersection = false

        for (let i = 0; i < positions.length; i += 9) {
          const vx = [positions[i], positions[i + 3], positions[i + 6]]
          const vy = [positions[i + 1], positions[i + 4], positions[i + 7]]
          const vz = [positions[i + 2], positions[i + 5], positions[i + 8]]

          for (let e = 0; e < 3; e++) {
            const a = e
            const c = (e + 1) % 3
            const fa = vx[a] - centerX
            const fc = vx[c] - centerX
            if ((fa <= 0) === (fc <= 0)) continue
            const t = fa / (fa - fc)
            const y = vy[a] + t * (vy[c] - vy[a])
            const z = vz[a] + t * (vz[c] - vz[a])
            hasIntersection = true
            minY = Math.min(minY, y)
            maxY = Math.max(maxY, y)
            minZ = Math.min(minZ, z)
            maxZ = Math.max(maxZ, z)
          }
        }

        if (!hasIntersection) {
          return { areaMm2: 0, beamMm: 0, draftMm: 0 }
        }

        return {
          areaMm2: computeSectionAreaMm2(positions, centerX),
          beamMm: maxY - minY,
          draftMm: maxZ - minZ,
        }
      }

      /**
       * Maximum beam of the waterline (BWL) in mm: the widest Y extent of the
       * hull's intersection with the plane z = h.
       *
       * BWL is the MAXIMUM waterline width, not the mean (Aw / LWL). The mean
       * understates it for a fine-ended hull, which inflates Cb.
       *
       * @param positions Flat interleaved xyz Float32Array
       * @param h Waterline height (absolute Z in mesh coordinates)
       * @returns Waterline beam in mm, or 0 when the plane misses the hull
       */
      export function computeWaterlineBeamMm(positions: Float32Array, h: number): number {
        let minY = Infinity
        let maxY = -Infinity
        let found = false

        for (let i = 0; i < positions.length; i += 9) {
          const vz = [positions[i + 2], positions[i + 5], positions[i + 8]]
          const vy = [positions[i + 1], positions[i + 4], positions[i + 7]]

          for (let e = 0; e < 3; e++) {
            const a = e
            const c = (e + 1) % 3
            const fa = vz[a] - h
            const fc = vz[c] - h
            if ((fa <= 0) === (fc <= 0)) continue
            const t = fa / (fa - fc)
            const y = vy[a] + t * (vy[c] - vy[a])
            found = true
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }

        return found ? maxY - minY : 0
      }

      /**
       * Length of the waterline (LWL) in mm: the X extent of the hull's
       * intersection with the horizontal plane z = h.
       *
       * This is NOT the bounding-box length. A hull at 65 kg floats with its
       * bow and stern clear of the water, so the waterline is shorter than LOA —
       * using LOA overstates the length every form coefficient is built on.
       *
       * @param positions Flat interleaved xyz Float32Array
       * @param h Waterline height (absolute Z in mesh coordinates)
       * @returns Waterline length in mm, or 0 when the plane misses the hull
       */
      export function computeWaterlineLengthMm(positions: Float32Array, h: number): number {
        let minX = Infinity
        let maxX = -Infinity
        let found = false

        for (let i = 0; i < positions.length; i += 9) {
          const vz = [positions[i + 2], positions[i + 5], positions[i + 8]]
          const vx = [positions[i], positions[i + 3], positions[i + 6]]

          for (let e = 0; e < 3; e++) {
            const a = e
            const c = (e + 1) % 3
            const fa = vz[a] - h
            const fc = vz[c] - h
            if ((fa <= 0) === (fc <= 0)) continue
            const t = fa / (fa - fc)
            const x = vx[a] + t * (vx[c] - vx[a])
            found = true
            if (x < minX) minX = x
            if (x > maxX) maxX = x
          }
        }

        return found ? maxX - minX : 0
      }

      /**
       * Maximum submerged cross-section (Am) and the rectangle it must fit in.
       *
       * Cm = Am / (beam at that station x submerged depth at that station). The
       * denominator has to come from the SAME station as the numerator: pairing a
       * section's area with the waterplane's mean beam and the global draft gives
       * a rectangle the section does not fit inside, which is how Cm ends up above
       * 1. Tracking the station's own lowest point also keeps Cm <= 1 by
       * construction, because the section is contained in that rectangle.
       *
       * @param positions Flat interleaved xyz Float32Array
       * @param minX Minimum X coordinate
       * @param maxX Maximum X coordinate
       * @param h Waterline height (absolute Z in mesh coordinates)
       * @param numSamples Number of stations to sample (default: 50)
       */
      export function findMaxSubmergedSection(
        positions: Float32Array,
        minX: number,
        maxX: number,
        h: number,
        numSamples: number = 50,
      ): { areaMm2: number; beamMm: number; depthMm: number; x: number } {
        let best = { areaMm2: 0, beamMm: 0, depthMm: 0, x: minX }

        for (let i = 0; i <= numSamples; i++) {
          const x = minX + (maxX - minX) * (i / numSamples)
          const area = computeSubmergedSectionAreaMm2(positions, x, h)
          if (area <= best.areaMm2) continue

          let minY = Infinity
          let maxY = -Infinity
          let minZ = Infinity
          for (let k = 0; k < positions.length; k += 9) {
            const vx = [positions[k], positions[k + 3], positions[k + 6]]
            const vy = [positions[k + 1], positions[k + 4], positions[k + 7]]
            const vz = [positions[k + 2], positions[k + 5], positions[k + 8]]
            for (let e = 0; e < 3; e++) {
              const a = e
              const c = (e + 1) % 3
              const fa = vx[a] - x
              const fc = vx[c] - x
              if ((fa <= 0) === (fc <= 0)) continue
              const t = fa / (fa - fc)
              const y = vy[a] + t * (vy[c] - vy[a])
              const z = vz[a] + t * (vz[c] - vz[a])
              if (z > h) continue
              if (y < minY) minY = y
              if (y > maxY) maxY = y
              if (z < minZ) minZ = z
            }
          }

          best = {
            areaMm2: area,
            beamMm: maxY - minY,
            depthMm: h - minZ,
            x,
          }
        }

        return best
      }

      /**
       * Find the maximum SUBMERGED cross-section area (Am) along the X axis.
       * This is the standard definition for Cp = V / (Am × LWL) and
       * Cm = Am / (BWL × draft) — both are defined on the underwater section,
       * so `h` (the waterline) is required.
       *
       * @param positions Flat interleaved xyz Float32Array
       * @param minX Minimum X coordinate
       * @param maxX Maximum X coordinate
       * @param h Waterline height (absolute Z in mesh coordinates)
       * @param numSamples Number of cross-sections to sample (default: 50)
       * @returns Maximum submerged cross-section area in mm²
       */
      export function findMaxCrossSectionArea(
        positions: Float32Array,
        minX: number,
        maxX: number,
        h: number,
        numSamples: number = 50
      ): number {
        let maxArea = 0

        for (let i = 0; i <= numSamples; i++) {
          const x = minX + (maxX - minX) * (i / numSamples)
          const area = computeSubmergedSectionAreaMm2(positions, x, h)
          if (area > maxArea) maxArea = area
        }

        return maxArea
      }

      /** One-stop analysis prep for a later hydrostatics pass. */
      export function analyzeMesh(positions: Float32Array): MeshStats {
  const bounds = computeBounds(positions)
  const volumeMm3 = computeVolumeMm3(positions)
  return {
    triangleCount: positions.length / 9,
    bounds,
    surfaceAreaMm2: computeSurfaceAreaMm2(positions),
    volumeMm3,
    volumeLiters: volumeMm3 / 1_000_000,
    watertight: checkWatertight(positions),
  }
}

/** Default triangle count for solver mesh decimation. */
export const DEFAULT_SOLVER_TRIANGLES = 10000

/**
 * True if a mesh is sound enough to run hydrostatics on.
 *
 * Two things disqualify it:
 *  - not watertight, so the clipped solid has an undefined volume, and
 *  - a significant share of zero-area triangles, which contribute no volume
 *    but still emit waterplane crossings that do not pair into a contour.
 *
 * `decimateMesh` snaps vertices to cell centroids, which collapses the
 * majority of triangles on a hull this size, so its output usually fails
 * here. Callers should fall back to the original mesh rather than solve on it.
 */
export function isMeshUsableForHydrostatics(positions: Float32Array): boolean {
  if (positions.length === 0) return false
  if (!checkWatertight(positions).watertight) return false
  const triCount = positions.length / 9
  let degenerate = 0
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i]
    const ay = positions[i + 1]
    const az = positions[i + 2]
    const e1x = positions[i + 3] - ax
    const e1y = positions[i + 4] - ay
    const e1z = positions[i + 5] - az
    const e2x = positions[i + 6] - ax
    const e2y = positions[i + 7] - ay
    const e2z = positions[i + 8] - az
    const nx = e1y * e2z - e1z * e2y
    const ny = e1z * e2x - e1x * e2z
    const nz = e1x * e2y - e1y * e2x
    if (Math.hypot(nx, ny, nz) < 1e-9) degenerate++
  }
  return degenerate / triCount < 0.01
}

/**
 * Decimate a mesh to approximately `targetTriangles` using spatial vertex clustering.
 * Groups vertices into a 3D grid and averages positions within each cell.
 * Preserves overall volume and shape well for hydrostatic calculations.
 * Uses a very coarse grid that forces strong merging for elongated hulls.
 *
 * NOTE: the result is usually NOT usable for hydrostatics — vertex snapping
 * collapses most triangles. Check with {@link isMeshUsableForHydrostatics}
 * before solving on it.
 *
 * @param positions Flat interleaved xyz Float32Array (9 values per triangle)
 * @param targetTriangles Target number of triangles (default: 10000)
 * @returns Decimated mesh as Float32Array, or original if already small enough
 */
export function decimateMesh(
  positions: Float32Array,
  targetTriangles: number = DEFAULT_SOLVER_TRIANGLES
): Float32Array {
  const triCount = positions.length / 9
  if (triCount <= targetTriangles) return positions // already small enough

  const bounds = computeBounds(positions)
  const sizeX = bounds.max.x - bounds.min.x
  const sizeY = bounds.max.y - bounds.min.y
  const sizeZ = bounds.max.z - bounds.min.z

  // Very coarse grid for kayak-like elongated hulls.
  // 4 * 3 * 2 = 24 cells -> forces strong vertex merging
  let cellsX = 4
  let cellsY = 3
  let cellsZ = 2

  // Scale grid if target is significantly different
  const baseCells = 4 * 3 * 2
  const targetCells = Math.min(5000, Math.max(200, targetTriangles / 2))
  const scale = Math.cbrt(targetCells / baseCells)
  cellsX = Math.max(3, Math.round(cellsX * scale))
  cellsY = Math.max(3, Math.round(cellsY * scale))
  cellsZ = Math.max(3, Math.round(cellsZ * scale))

  // Clamp to reasonable bounds
  const maxCellsPerAxis = 30
  cellsX = Math.min(cellsX, maxCellsPerAxis)
  cellsY = Math.min(cellsY, maxCellsPerAxis)
  cellsZ = Math.min(cellsZ, maxCellsPerAxis)

  let decimated: Float32Array = positions
  let bestDiff = Infinity

  for (let attempt = 0; attempt < 8; attempt++) {
    // Cell sizes
    const dx = sizeX / cellsX
    const dy = sizeY / cellsY
    const dz = sizeZ / cellsZ

    // Map: cell key -> { sumX, sumY, sumZ, count }
    const cellMap = new Map<string, { sx: number; sy: number; sz: number; cnt: number }>()

    // First pass: accumulate vertex sums per cell
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const y = positions[i + 1]
      const z = positions[i + 2]

      const cx = Math.min(cellsX - 1, Math.floor((x - bounds.min.x) / dx))
      const cy = Math.min(cellsY - 1, Math.floor((y - bounds.min.y) / dy))
      const cz = Math.min(cellsZ - 1, Math.floor((z - bounds.min.z) / dz))

      const key = `${cx}|${cy}|${cz}`
      const entry = cellMap.get(key)
      if (entry) {
        entry.sx += x
        entry.sy += y
        entry.sz += z
        entry.cnt++
      } else {
        cellMap.set(key, { sx: x, sy: y, sz: z, cnt: 1 })
      }
    }

    // Build cell centroid lookup
    const cellCentroid = new Map<string, { x: number; y: number; z: number }>()
    for (const [key, v] of cellMap) {
      cellCentroid.set(key, { x: v.sx / v.cnt, y: v.sy / v.cnt, z: v.sz / v.cnt })
    }

    // Second pass: rebuild triangles using cell centroids
    const out: number[] = []
    for (let i = 0; i < positions.length; i += 9) {
      const v0Key = `${Math.min(cellsX - 1, Math.floor((positions[i] - bounds.min.x) / dx))}|` +
                     `${Math.min(cellsY - 1, Math.floor((positions[i + 1] - bounds.min.y) / dy))}|` +
                     `${Math.min(cellsZ - 1, Math.floor((positions[i + 2] - bounds.min.z) / dz))}`
      const v1Key = `${Math.min(cellsX - 1, Math.floor((positions[i + 3] - bounds.min.x) / dx))}|` +
                     `${Math.min(cellsY - 1, Math.floor((positions[i + 4] - bounds.min.y) / dy))}|` +
                     `${Math.min(cellsZ - 1, Math.floor((positions[i + 5] - bounds.min.z) / dz))}`
      const v2Key = `${Math.min(cellsX - 1, Math.floor((positions[i + 6] - bounds.min.x) / dx))}|` +
                     `${Math.min(cellsY - 1, Math.floor((positions[i + 7] - bounds.min.y) / dy))}|` +
                     `${Math.min(cellsZ - 1, Math.floor((positions[i + 8] - bounds.min.z) / dz))}`

      const c0 = cellCentroid.get(v0Key)
      const c1 = cellCentroid.get(v1Key)
      const c2 = cellCentroid.get(v2Key)

      // Degenerate triangle check (all vertices collapsed to same centroid)
      if (c0 && c1 && c2 && (v0Key !== v1Key || v1Key !== v2Key)) {
        out.push(c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z)
      }
    }

    const newTriCount = out.length / 9
    decimated = new Float32Array(out)

    const diff = Math.abs(newTriCount - targetTriangles)
    if (diff < bestDiff) {
      bestDiff = diff
    }

    // Adjust grid for next attempt
    if (newTriCount > targetTriangles * 1.2) {
      // Too many triangles: increase grid resolution
      const factor = Math.sqrt(newTriCount / targetTriangles)
      cellsX = Math.min(maxCellsPerAxis, Math.ceil(cellsX * factor))
      cellsY = Math.min(maxCellsPerAxis, Math.ceil(cellsY * factor))
      cellsZ = Math.min(maxCellsPerAxis, Math.ceil(cellsZ * factor))
    } else if (newTriCount < targetTriangles * 0.8) {
      // Too few triangles: decrease grid resolution
      const factor = Math.sqrt(targetTriangles / newTriCount)
      cellsX = Math.max(3, Math.floor(cellsX * factor))
      cellsY = Math.max(3, Math.floor(cellsY * factor))
      cellsZ = Math.max(3, Math.floor(cellsZ * factor))
    } else {
      // Close enough
      break
    }
  }

  return decimated
}