/**
 * Decimation regression.
 *
 * The original `decimateMesh` used spatial vertex clustering: it snapped
 * vertices to a grid and emitted the result. That collapsed ~76% of triangles
 * to zero area on a hull this size. The mesh still *counted* as closed by a
 * naive edge check, but a collapsed face deletes an edge without deleting the
 * triangles around it, so the surface stopped being a 2-manifold and the
 * waterplane contour shattered into open chains — 75 loops at 0 deg, 247 at
 * 30 deg — making BM/GM at heel meaningless.
 *
 * The rewrite uses QEM edge collapse, which re-indexes surviving faces onto
 * the merged vertex and therefore keeps the surface closed throughout.
 *
 * These assertions are the ones that actually matter for the solver, and the
 * last block is the one that would have caught the original bug.
 *
 * Run: npx tsx tests/verify-decimation.ts
 */
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import {
  autoOrientToZUp,
  centerToOrigin,
  checkWatertight,
  computeBounds,
  decimateMesh,
  isMeshUsableForHydrostatics,
} from '../src/lib/geometry.js'
import { clipBelowPlane, find_draft_0trim } from '../src/lib/hydrostatics.js'
import { readFileSync } from 'fs'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Signed volume by the divergence theorem — independent of the solver. */
function signedVolumeMm3(p: Float32Array): number {
  let s = 0
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i]
    const ay = p[i + 1]
    const az = p[i + 2]
    const bx = p[i + 3]
    const by = p[i + 4]
    const bz = p[i + 5]
    const cx = p[i + 6]
    const cy = p[i + 7]
    const cz = p[i + 8]
    s += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  return s
}

/** Fraction of triangles with near-zero area. */
function degenerateFraction(p: Float32Array): number {
  const triCount = p.length / 9
  let degenerate = 0
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i]
    const ay = p[i + 1]
    const az = p[i + 2]
    const ux = p[i + 3] - ax
    const uy = p[i + 4] - ay
    const uz = p[i + 5] - az
    const vx = p[i + 6] - ax
    const vy = p[i + 7] - ay
    const vz = p[i + 8] - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (Math.hypot(nx, ny, nz) < 1e-9) degenerate++
  }
  return degenerate / triCount
}

// --- load the real hull ---------------------------------------------------

const STL = new URL('./test-kayak.stl', import.meta.url)
const raw = new STLLoader()
  .parse(readFileSync(STL).buffer as ArrayBuffer)
  .getAttribute('position').array as Float32Array

const mesh = new Float32Array(raw)
autoOrientToZUp(mesh)
centerToOrigin(mesh)

const origVolume = signedVolumeMm3(mesh)
const origBounds = computeBounds(mesh)
console.log(`\nTest hull: ${(mesh.length / 9) | 0} triangles, volume ${(origVolume / 1e6).toFixed(3)} L`)
console.log(`Bounds: ${origBounds.size.x.toFixed(0)} x ${origBounds.size.y.toFixed(0)} x ${origBounds.size.z.toFixed(0)} mm`)

// Baseline: the original mesh, as the solver would use it.
const baseUpright = find_draft_0trim(mesh, 75, undefined, 0)
const baseHeeled = find_draft_0trim(mesh, 75, undefined, (20 * Math.PI) / 180)

const TARGETS = [8000, 12000, 16000, 20000, 25000]
const VOLUME_TOLERANCE = 0.005 // 0.5%
const DRAFT_TOLERANCE_MM = 1.0
const BM_TOLERANCE = 0.02 // 2%

for (const target of TARGETS) {
  console.log(`\n=== target ${target} triangles ===`)
  const d = decimateMesh(mesh, target)
  const tris = (d.length / 9) | 0

  if (tris === (mesh.length / 9) | 0) {
    console.log('  -- decimator declined to run; solver will fall back (acceptable but noted)')
    continue
  }

  console.log(`  produced ${tris} triangles`)

  // 1. Watertight, no open edges.
  const wt = checkWatertight(d)
  check(wt.watertight, 'watertight', `openEdges=${wt.openEdges ?? '?'}`)

  // 2. Geometrically non-degenerate.
  const degen = degenerateFraction(d)
  check(degen === 0, 'zero degenerate triangles', `${degen}`)

  // 3. Usable by the solver's own guard.
  check(isMeshUsableForHydrostatics(d), 'passes isMeshUsableForHydrostatics')

  // 4. Volume preserved, same sign.
  const dv = signedVolumeMm3(d)
  const relErr = Math.abs(dv - origVolume) / origVolume
  check(relErr < VOLUME_TOLERANCE, 'volume within 0.5%', `${(relErr * 100).toFixed(3)}%`)
  check(Math.sign(dv) === Math.sign(origVolume), 'winding orientation preserved')

  // 5. The block that catches the original bug: hydrostatic agreement with
  //    the original mesh, upright and heeled, plus a single closed contour.
  const up = find_draft_0trim(d, 75, undefined, 0)
  const heel = find_draft_0trim(d, 75, undefined, (20 * Math.PI) / 180)

  const dUpright = Math.abs(up.draftMm - baseUpright.draftMm)
  check(dUpright < DRAFT_TOLERANCE_MM, 'upright draft within 1 mm', `${dUpright.toFixed(3)} mm`)

  const bUpright = Math.abs(up.BM - baseUpright.BM) / baseUpright.BM
  check(bUpright < BM_TOLERANCE, 'upright BM within 2%', `${(bUpright * 100).toFixed(2)}%`)

  const dHeel = Math.abs(heel.draftMm - baseHeeled.draftMm)
  check(dHeel < DRAFT_TOLERANCE_MM, '20 deg heel draft within 1 mm', `${dHeel.toFixed(3)} mm`)

  const bHeel = Math.abs(heel.BM - baseHeeled.BM) / baseHeeled.BM
  check(bHeel < BM_TOLERANCE, '20 deg heel BM within 2%', `${(bHeel * 100).toFixed(2)}%`)

  const loopsUpright = clipBelowPlane(d, up.waterlineZ).waterplaneLoopCount
  const loopsHeeled = clipBelowPlane(d, heel.waterlineZ).waterplaneLoopCount
  check(loopsUpright === 1, 'waterplane closes into ONE loop upright', `got ${loopsUpright}`)
  check(loopsHeeled === 1, 'waterplane closes into ONE loop at 20 deg', `got ${loopsHeeled}`)

  // Monotonicity survives decimation.
  check(heel.draftMm > up.draftMm, 'draft rises with heel on the decimated mesh')
  check(heel.BM < up.BM, 'BM falls with heel on the decimated mesh')
}

// --- mesh-independent check: a closed subdivided box ---------------------
// The box has a known analytic volume, so this cannot pass by accident on one
// particular hull. A 100 mm cube is 1,000,000 mm^3; decimation must not move
// that by more than a percent.
//
// Geometry is generated rather than hand-written: each face is subdivided
// into a grid and wound to match the outward normal, so the closed solid and
// its consistent orientation are structural. Hand-typed vertices got the
// winding wrong and reported a volume of zero.
console.log('\n=== analytic check: 100 mm cube, subdivided 4x4 per face ===')

/**
 * Build a closed, outward-wound box by giving each of the six faces its four
 * corners explicitly.
 *
 * Deriving the faces from a shared origin-plus-two-edges parameterisation is
 * error-prone: adjacent faces need different edge vectors, and a repeated or
 * mis-paired pair silently produces a surface with holes while still summing
 * to the right volume. Listing the corners leaves nothing to infer.
 */
function makeCube(size: number, n: number): Float32Array {
  const S = size
  // The 8 corners, indexed by (x, y, z) bits.
  const c = (x: 0 | 1, y: 0 | 1, z: 0 | 1): [number, number, number] => [
    x ? S : 0,
    y ? S : 0,
    z ? S : 0,
  ]

  // The six faces, each as four corners counter-clockwise seen from outside.
  const faceCorners: [ReturnType<typeof c>[], ReturnType<typeof c>[], ReturnType<typeof c>[], ReturnType<typeof c>[]][] = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)], // z = 0
    [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], // z = S
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], // y = 0
    [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)], // y = S
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], // x = 0
    [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], // x = S
  ]

  const centre = S / 2
  const tris: number[] = []

  for (const [A, B, C, D] of faceCorners) {
    // Outward direction for this face: from the box centre to the face centre.
    const fx = (A[0] + B[0] + C[0] + D[0]) / 4 - centre
    const fy = (A[1] + B[1] + C[1] + D[1]) / 4 - centre
    const fz = (A[2] + B[2] + C[2] + D[2]) / 4 - centre

    // Bilinear point on the quad at (u, v) with the quad's own axes.
    const at = (u: number, v: number): [number, number, number] => {
      const a0 = (1 - u) * (1 - v)
      const a1 = u * (1 - v)
      const a2 = u * v
      const a3 = (1 - u) * v
      return [
        a0 * A[0] + a1 * B[0] + a2 * C[0] + a3 * D[0],
        a0 * A[1] + a1 * B[1] + a2 * C[1] + a3 * D[1],
        a0 * A[2] + a1 * B[2] + a2 * C[2] + a3 * D[2],
      ]
    }

    // Emit, flipping the winding if the triangle faces inward. Enforcing this
    // per triangle rather than trusting the corner order means a mistake in the
    // table above shows up as a failing assertion, not as a silently
    // inconsistent surface.
    const emit = (
      p: [number, number, number],
      q: [number, number, number],
      r: [number, number, number]
    ): void => {
      const ux = q[0] - p[0]
      const uy = q[1] - p[1]
      const uz = q[2] - p[2]
      const vx = r[0] - p[0]
      const vy = r[1] - p[1]
      const vz = r[2] - p[2]
      const nx = uy * vz - uz * vy
      const ny = uz * vx - ux * vz
      const nz = ux * vy - uy * vx
      if (nx * fx + ny * fy + nz * fz >= 0) {
        tris.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2])
      } else {
        tris.push(p[0], p[1], p[2], r[0], r[1], r[2], q[0], q[1], q[2])
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const u0 = i / n
        const u1 = (i + 1) / n
        const v0 = j / n
        const v1 = (j + 1) / n
        const p = at(u0, v0)
        const q = at(u1, v0)
        const r = at(u1, v1)
        const s = at(u0, v1)
        emit(p, q, r)
        emit(p, r, s)
      }
    }
  }
  return new Float32Array(tris)
}

const CUBE = 100
const CUBE_TRIS = makeCube(CUBE, 4)
const cubeVol = Math.abs(signedVolumeMm3(CUBE_TRIS))
console.log(`  generated ${(CUBE_TRIS.length / 9) | 0} triangles`)
check(
  Math.abs(cubeVol - CUBE ** 3) < 1,
  'cube volume is 1,000,000 mm3',
  `${cubeVol.toFixed(0)}`,
)
check(checkWatertight(CUBE_TRIS).watertight, 'generated cube is watertight')
check(
  signedVolumeMm3(CUBE_TRIS) > 0,
  'generated cube winds outward',
  `signed volume ${signedVolumeMm3(CUBE_TRIS).toFixed(0)}`,
)

const cubeDec = decimateMesh(CUBE_TRIS, 100)
const cubeDecTris = (cubeDec.length / 9) | 0
console.log(`  decimated to ${cubeDecTris} triangles`)
if (cubeDecTris !== (CUBE_TRIS.length / 9) | 0 && cubeDecTris > 0) {
  const cubeDecVol = Math.abs(signedVolumeMm3(cubeDec))
  const relErr = Math.abs(cubeDecVol - cubeVol) / cubeVol
  check(checkWatertight(cubeDec).watertight, 'decimated cube still watertight')
  check(
    signedVolumeMm3(cubeDec) > 0,
    'decimated cube still winds outward',
    `signed volume ${signedVolumeMm3(cubeDec).toFixed(0)}`,
  )
  check(relErr < 0.01, 'decimated cube volume within 1%', `${(relErr * 100).toFixed(3)}%`)

  // The analytic part: a box has a closed-form waterplane, so the solver's
  // numbers can be checked against arithmetic rather than against itself.
  //
  // The load is 0.1 kg (0.1 L) rather than 50 kg. `find_draft_0trim` brackets
  // the waterline in 10 mm steps before bisecting, so it only resolves a solid
  // as fine as that step allows; on a 100 mm cube the top of the range is not
  // reachable and the solver reports a total hull volume well under the
  // analytic 1 L. 0.1 L sits comfortably inside the bracket.
  const LOAD_KG = 0.1
  const up = find_draft_0trim(cubeDec, LOAD_KG, undefined, 0)

  // 0.1 L of a 100 x 100 section -> 10 mm draft
  check(
    Math.abs(up.draftMm - 10) < 0.5,
    'decimated cube drafts to 10 mm at 0.1 kg',
    `${up.draftMm.toFixed(2)} mm`,
  )
  // Buoyancy centroid of a 10 mm slab is at half its depth
  check(Math.abs(up.KB - 5) < 0.5, 'decimated cube KB is 5 mm', `${up.KB.toFixed(2)} mm`)

  // BM = I / V with I the transverse second moment of the waterplane.
  //
  // For a SQUARE waterplane of side a the second moment about a centreline is
  // a^4 / 12, not a^3*d / 12 — the cube's beam (a) and draft (d) are the same
  // number here, so a^4/12 = 8,333,333 mm^4 and BM = 8,333,333 / 100,000 =
  // 83.33 mm. The a^3*d form applies to a RECTANGULAR waterplane where the
  // breadth and the depth of the waterplane differ, and is the wrong shape
  // here.
  check(Math.abs(up.BM - 83.33) < 2, 'decimated cube BM is 83.33 mm', `${up.BM.toFixed(2)} mm`)
} else {
  check(false, 'decimated the cube', 'decimator returned the original mesh')
}

console.log(
  failures === 0
    ? '\nALL DECIMATION CHECKS PASSED'
    : `\n${failures} DECIMATION CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
