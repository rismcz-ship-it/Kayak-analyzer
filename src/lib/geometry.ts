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
   * Compute the midship cross-section area (Am) at X = centerX.
   * Intersects all triangles with the plane X = centerX and computes
   * the resulting cross-section area using trapezoidal integration.
   * 
   * @param positions Flat interleaved xyz Float32Array
   * @param centerX X coordinate of the midship plane (usually bounds.center.x)
   * @returns Midship section area in mm²
   */
  export function computeMidshipAreaMm2(positions: Float32Array, centerX: number): number {
    let area = 0
  
    for (let i = 0; i < positions.length; i += 9) {
      const x0 = positions[i]
      const y0 = positions[i + 1]
      const z0 = positions[i + 2]
      const x1 = positions[i + 3]
      const y1 = positions[i + 4]
      const z1 = positions[i + 5]
      const x2 = positions[i + 6]
      const y2 = positions[i + 7]
      const z2 = positions[i + 8]
    
      // Check if triangle crosses the X = centerX plane
      const f0 = x0 - centerX
      const f1 = x1 - centerX
      const f2 = x2 - centerX
    
      // Count intersections
      const intersections: { y: number; z: number }[] = []
    
      // Edge 0-1
      if ((f0 <= 0 && f1 >= 0) || (f0 >= 0 && f1 <= 0)) {
        if (f1 !== f0) {
          const t = -f0 / (f1 - f0)
          intersections.push({ y: y0 + t * (y1 - y0), z: z0 + t * (z1 - z0) })
        }
      }
      // Edge 1-2
      if ((f1 <= 0 && f2 >= 0) || (f1 >= 0 && f2 <= 0)) {
        if (f2 !== f1) {
          const t = -f1 / (f2 - f1)
          intersections.push({ y: y1 + t * (y2 - y1), z: z1 + t * (z2 - z1) })
        }
      }
      // Edge 2-0
      if ((f2 <= 0 && f0 >= 0) || (f2 >= 0 && f0 <= 0)) {
        if (f0 !== f2) {
          const t = -f2 / (f0 - f2)
          intersections.push({ y: y2 + t * (y0 - y2), z: z2 + t * (z0 - z2) })
        }
      }
    
      // Triangle contributes a segment if it crosses the plane (2 intersections)
      if (intersections.length === 2) {
        const a = intersections[0]
        const b = intersections[1]
        // Area contribution = trapezoid under the segment in Y-Z plane
        const zAvg = (a.z + b.z) / 2
        const deltaY = Math.abs(b.y - a.y)
        area += zAvg * deltaY
      }
    }
  
    return Math.abs(area)
      }

      /**
       * Compute midship cross-section properties at X = centerX.
       * Returns area, beam (max Y extent), and draft (max Z extent) at that station.
       * 
       * @param positions Flat interleaved xyz Float32Array
       * @param centerX X coordinate of the midship plane
       * @returns { areaMm2, beamMm, draftMm }
       */
      export function computeMidshipSection(
        positions: Float32Array,
        centerX: number
      ): { areaMm2: number; beamMm: number; draftMm: number } {
        let area = 0
        let minY = Infinity
        let maxY = -Infinity
        let minZ = Infinity
        let maxZ = -Infinity
        let hasIntersection = false
    
        for (let i = 0; i < positions.length; i += 9) {
          const x0 = positions[i]
          const y0 = positions[i + 1]
          const z0 = positions[i + 2]
          const x1 = positions[i + 3]
          const y1 = positions[i + 4]
          const z1 = positions[i + 5]
          const x2 = positions[i + 6]
          const y2 = positions[i + 7]
          const z2 = positions[i + 8]
      
          const f0 = x0 - centerX
          const f1 = x1 - centerX
          const f2 = x2 - centerX
      
          const intersections: { y: number; z: number }[] = []
      
          if ((f0 <= 0 && f1 >= 0) || (f0 >= 0 && f1 <= 0)) {
            if (f1 !== f0) {
              const t = -f0 / (f1 - f0)
              intersections.push({ y: y0 + t * (y1 - y0), z: z0 + t * (z1 - z0) })
            }
          }
          if ((f1 <= 0 && f2 >= 0) || (f1 >= 0 && f2 <= 0)) {
            if (f2 !== f1) {
              const t = -f1 / (f2 - f1)
              intersections.push({ y: y1 + t * (y2 - y1), z: z1 + t * (z2 - z1) })
            }
          }
          if ((f2 <= 0 && f0 >= 0) || (f2 >= 0 && f0 <= 0)) {
            if (f0 !== f2) {
              const t = -f2 / (f0 - f2)
              intersections.push({ y: y2 + t * (y0 - y2), z: z2 + t * (z0 - z2) })
            }
          }
      
          if (intersections.length === 2) {
            hasIntersection = true
            const a = intersections[0]
            const b = intersections[1]
            const zAvg = (a.z + b.z) / 2
            const deltaY = Math.abs(b.y - a.y)
            area += zAvg * deltaY
            minY = Math.min(minY, a.y, b.y)
            maxY = Math.max(maxY, a.y, b.y)
            minZ = Math.min(minZ, a.z, b.z)
            maxZ = Math.max(maxZ, a.z, b.z)
          }
        }
    
        if (!hasIntersection) {
          return { areaMm2: 0, beamMm: 0, draftMm: 0 }
        }
    
        return {
          areaMm2: Math.abs(area),
          beamMm: maxY - minY,
          draftMm: maxZ - minZ,
        }
      }

      /**
       * Find the maximum cross-section area (Am) along the X axis.
       * Samples cross-sections at multiple X positions and returns the maximum area.
       * This is the standard definition for Prismatic Coefficient (Cp = V / (Am_max × L)).
       * 
       * @param positions Flat interleaved xyz Float32Array
       * @param minX Minimum X coordinate (bow)
       * @param maxX Maximum X coordinate (stern)
       * @param numSamples Number of cross-sections to sample (default: 50)
       * @returns Maximum cross-section area in mm²
       */
      export function findMaxCrossSectionArea(
        positions: Float32Array,
        minX: number,
        maxX: number,
        numSamples: number = 50
      ): number {
        let maxArea = 0
    
        for (let i = 0; i <= numSamples; i++) {
          const x = minX + (maxX - minX) * (i / numSamples)
          const area = computeMidshipAreaMm2(positions, x)
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
 * Decimate a mesh to approximately `targetTriangles` using spatial vertex clustering.
 * Groups vertices into a 3D grid and averages positions within each cell.
 * Preserves overall volume and shape well for hydrostatic calculations.
 * Uses a very coarse grid that forces strong merging for elongated hulls.
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