// Modular geometry helpers for the hull analyzer.
//
// Kept deliberately framework-free (no three / react imports) so a later
// hydrostatics solver can reuse them: waterplane slicing, wetted area,
// displaced volume at a draft, LCF/LCB, metacentric heights, righting arm, etc.
// All STL files are assumed to be in millimetres.
//
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