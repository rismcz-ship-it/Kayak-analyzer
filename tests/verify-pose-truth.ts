// Independent ground truth for the pose the solver reports.
//
// Every other suite checks the solver against itself: `solveTrim` finds a
// waterline where the displaced volume closes on the target and the LCB lines
// up with the LCG, and the clipper measures both — so a bug shared by the
// search and the measurement would pass every one of them. This suite answers
// a different question: is the reported pose a REAL equilibrium?
//
// The truth side never touches `clipBelowPlane`, `solveDraftLcb` or
// `findDraft0Trim`. It takes the trim and waterline `solveTrim` reports, poses
// the hull with `applyPitchY` (a pure rotation, gated separately in
// verify-orientation §2), walks a 2 mm grid over the XY footprint with
// vertical ray casts against an XY bucket grid, and column-integrates the
// submerged region:
//
//   - displaced volume      vs the 75 kg target
//   - centre of buoyancy X  vs the reported LCG   (the trim equilibrium)
//   - centre of buoyancy Z  vs the reported LCB Z (a height nothing else checks)
//   - stem-tip freeboards   vs the reported ones
//
// Discretisation is the only error source here: the grid reads ~0.06% high on
// volume on the committed hull, and the tolerances below sit well above that.
//
// Run: npm exec -- tsx tests/verify-pose-truth.ts

import { readFileSync } from 'node:fs'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import {
  applyPitchY,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  DEFAULT_SOLVER_TRIANGLES,
  decimateMesh,
  isMeshUsableForHydrostatics,
} from '../src/lib/geometry'
import { DEFAULT_KG_MM, solveTrim } from '../src/lib/hydrostatics'

// The solve the app runs (src/App.tsx): 75 kg, LCG 52% from the bow, +/-4.5 deg.
const APP_WINDOW = {
  targetLcgPercentFromBow: 52,
  maxTrimDeg: 4.5,
  trimStepDeg: 0.1,
  fixedHeelDeg: 0,
  kgMm: DEFAULT_KG_MM,
}
const MM3_PER_KG = 1_000_000 // 1 kg = 1 L = 1e6 mm^3
const PITCH_MM = 2

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// The independent measurement: submerged volume, its centre of buoyancy, and
// the end-tip heights, for a posed hull cut by a horizontal plane.
interface ColumnIntegral {
  volumeMm3: number
  cbX: number
  cbZ: number
  /** Highest vertex within `tipWindowMm` of either end (deck-edge freeboard). */
  highestBowZ: number
  highestSternZ: number
  /** First vertex at the extreme X (the app's stem-tip definition). */
  firstAtBowZ: number
  firstAtSternZ: number
  columns: number
}

function measure(posed: Float32Array, plane: number, tipWindowMm = 60): ColumnIntegral {
  const n = posed.length / 3
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < posed.length; i += 3) {
    if (posed[i] < minX) minX = posed[i]
    if (posed[i] > maxX) maxX = posed[i]
    if (posed[i + 1] < minY) minY = posed[i + 1]
    if (posed[i + 1] > maxY) maxY = posed[i + 1]
  }

  // Bucket the triangles by XY bounding box. Decimated hull triangles are a
  // few mm across, so a 30 mm cell holds only a handful of them and a column
  // tests a handful of triangles instead of the whole mesh.
  //
  // Counting sort (CSR), not per-cell linked lists: a triangle may overlap
  // several cells, and a shared `next` array would break every chain but the
  // last — which silently drops most of the hull and reads ~13% of the volume.
  const CELL = 30
  const cx0 = Math.floor(minX / CELL)
  const cy0 = Math.floor(minY / CELL)
  const ncx = Math.floor(maxX / CELL) - cx0 + 1
  const ncy = Math.floor(maxY / CELL) - cy0 + 1
  const ncells = ncx * ncy

  const cxs0 = new Int32Array(n)
  const cxs1 = new Int32Array(n)
  const cys0 = new Int32Array(n)
  const cys1 = new Int32Array(n)
  const counts = new Int32Array(ncells)
  for (let t = 0; t < n; t++) {
    const i = t * 9
    let tminX = Infinity
    let tmaxX = -Infinity
    let tminY = Infinity
    let tmaxY = -Infinity
    for (const v of [i, i + 3, i + 6]) {
      if (posed[v] < tminX) tminX = posed[v]
      if (posed[v] > tmaxX) tmaxX = posed[v]
      if (posed[v + 1] < tminY) tminY = posed[v + 1]
      if (posed[v + 1] > tmaxY) tmaxY = posed[v + 1]
    }
    cxs0[t] = Math.max(Math.floor(tminX / CELL) - cx0, 0)
    cxs1[t] = Math.min(Math.floor(tmaxX / CELL) - cx0, ncx - 1)
    cys0[t] = Math.max(Math.floor(tminY / CELL) - cy0, 0)
    cys1[t] = Math.min(Math.floor(tmaxY / CELL) - cy0, ncy - 1)
    for (let gy = cys0[t]; gy <= cys1[t]; gy++) {
      for (let gx = cxs0[t]; gx <= cxs1[t]; gx++) counts[gy * ncx + gx]++
    }
  }
  const starts = new Int32Array(ncells + 1)
  for (let c = 0; c < ncells; c++) starts[c + 1] = starts[c] + counts[c]
  const entries = new Int32Array(starts[ncells])
  const cursor = starts.slice(0, ncells)
  for (let t = 0; t < n; t++) {
    for (let gy = cys0[t]; gy <= cys1[t]; gy++) {
      for (let gx = cxs0[t]; gx <= cxs1[t]; gx++) entries[cursor[gy * ncx + gx]++] = t
    }
  }

  // End tips, in the posed frame: the first vertex at each extreme X (what the
  // solver reports) and the highest vertex near each end (the deck edge).
  // The extremes are already known from the scan above, so match them exactly
  // — `x > maxX` can never be true, which would silently leave both tips at 0.
  let firstAtBowZ = 0
  let firstAtSternZ = 0
  let bowFound = false
  let sternFound = false
  let highestBowZ = -Infinity
  let highestSternZ = -Infinity
  for (let i = 0; i < posed.length; i += 3) {
    const x = posed[i]
    const z = posed[i + 2]
    if (!bowFound && x === maxX) {
      firstAtBowZ = z
      bowFound = true
    }
    if (!sternFound && x === minX) {
      firstAtSternZ = z
      sternFound = true
    }
    if (x >= maxX - tipWindowMm && z > highestBowZ) highestBowZ = z
    if (x <= minX + tipWindowMm && z > highestSternZ) highestSternZ = z
  }
  if (!bowFound || !sternFound) {
    throw new Error('measure: no vertex at an extreme X — the extremes cannot be right')
  }
  for (let i = 0; i < posed.length; i += 3) {
    const x = posed[i]
    const z = posed[i + 2]
    if (x >= maxX - tipWindowMm && z > highestBowZ) highestBowZ = z
    if (x <= minX + tipWindowMm && z > highestSternZ) highestSternZ = z
  }

  // Column integration. Submerged height is plane - lowest surface hit: below
  // the waterline a kayak cross-section is a single closed region, so the
  // lowest hit is the keel and the whole column between keel and plane is
  // inside the hull — the deck (and any cockpit depression above it) never
  // enters, which is why the ray grid ignores the highest hit entirely.
  const nx = Math.ceil((maxX - minX) / PITCH_MM)
  const ny = Math.ceil((maxY - minY) / PITCH_MM)
  const cellArea = PITCH_MM * PITCH_MM
  let volumeMm3 = 0
  let momentX = 0
  let momentZ = 0
  let columns = 0
  for (let iy = 0; iy < ny; iy++) {
    const y = minY + (iy + 0.5) * PITCH_MM
    const row = (Math.floor(y / CELL) - cy0) * ncx
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + (ix + 0.5) * PITCH_MM
      const ci = row + (Math.floor(x / CELL) - cx0)
      const end = starts[ci + 1]
      if (starts[ci] === end) continue

      let lowest = Infinity
      for (let e = starts[ci]; e < end; e++) {
        const i = entries[e] * 9
        const ax = posed[i]
        const ay = posed[i + 1]
        const det =
          (posed[i + 4] - posed[i + 7]) * (ax - posed[i + 6]) +
          (posed[i + 6] - posed[i + 3]) * (ay - posed[i + 7])
        if (det === 0) continue
        const l1 =
          ((posed[i + 4] - posed[i + 7]) * (x - posed[i + 6]) +
            (posed[i + 6] - posed[i + 3]) * (y - posed[i + 7])) /
          det
        if (l1 < -1e-9) continue
        const l2 =
          ((posed[i + 7] - posed[i + 1]) * (x - posed[i + 6]) +
            (ax - posed[i + 6]) * (y - posed[i + 7])) /
          det
        if (l2 < -1e-9) continue
        if (1 - l1 - l2 < -1e-9) continue
        const z = l1 * posed[i + 2] + l2 * posed[i + 5] + (1 - l1 - l2) * posed[i + 8]
        if (z < lowest) lowest = z
      }
      if (!(lowest < plane)) continue
      columns++
      const h = plane - lowest
      volumeMm3 += h * cellArea
      momentX += x * h * cellArea
      momentZ += (lowest + h / 2) * h * cellArea
    }
  }
  return {
    volumeMm3,
    cbX: momentX / volumeMm3,
    cbZ: momentZ / volumeMm3,
    highestBowZ,
    highestSternZ,
    firstAtBowZ,
    firstAtSternZ,
    columns,
  }
}

// ---------------------------------------------------------------------------
const buffer = readFileSync(new URL('./test-kayak.stl', import.meta.url))
const positions = new STLLoader().parse(buffer.buffer as ArrayBuffer).getAttribute('position')
  .array as Float32Array

console.log('=== the reported pose is a real equilibrium ===')
{
  // Exactly the app path: pass the undecimated mesh, `solveTrim` decimates it
  // internally; decimate the same way for the ray grid so both sides measure
  // the same solid.
  autoOrientToZUp(positions)
  centerToOrigin(positions)
  const solved = solveTrim(positions, 75, APP_WINDOW)
  const decimated = decimateMesh(positions, DEFAULT_SOLVER_TRIANGLES)
  const solveMesh = isMeshUsableForHydrostatics(decimated) ? decimated : positions
  const bounds = computeBounds(solveMesh)

  const rad = (solved.trimDeg * Math.PI) / 180
  const px = solved.pivot.x
  const pz = solved.pivot.z
  const midX = bounds.center.x
  // `solveTrim` reports `waterlineZ` as the plane's height at MIDSHIP in the
  // hull's own frame and pitches the hull about (LCG x, keel-level centre z).
  // The world height of that plane, so the ray grid can cut it horizontally:
  // inverting the pitch of the hull-frame point (stationX, waterlineZ) gives
  //     W = pz + (Whull - pz) * c + (stationX - px) * s
  const plane = pz + (solved.waterlineZ - pz) * Math.cos(rad) + (midX - px) * Math.sin(rad)

  const posed = new Float32Array(solveMesh)
  applyPitchY(posed, rad, px, pz)
  const m = measure(posed, plane)

  // The pose transform, written out here from the definition instead of being
  // read back out of the solver: the hull-frame point (x, z) pitched by `rad`
  // about (px, pz) lands at
  //     x' = (x - px) * c - (z - pz) * s + px
  //     z' = (x - px) * s + (z - pz) * c + pz
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const toPosedX = (x: number, z: number) => px + (x - px) * cos - (z - pz) * sin
  const toPosedZ = (x: number, z: number) => pz + (x - px) * sin + (z - pz) * cos

  console.log(
    `  solver: trim ${solved.trimDeg} deg, waterlineZ ${solved.waterlineZ.toFixed(2)} mm,` +
      ` draft ${solved.draftMm.toFixed(2)} mm, displacement ${solved.displacementKg.toFixed(3)} kg`,
  )
  console.log(`  ray grid: ${m.columns} columns at ${PITCH_MM} mm over the posed footprint`)

  // The grid must actually walk the hull, or a bucketing bug would silently
  // measure nothing and pass everything.
  check('the ray grid sampled the submerged footprint', m.columns > 100000, `${m.columns} columns`)

  // 1. The waterline level: the volume below the reported plane is the target
  // displacement. The solver's own displacement is printed alongside because a
  // small deficit there is the decimated mesh, not the pose.
  const measuredKg = m.volumeMm3 / MM3_PER_KG
  console.log(
    `  volume: ray grid ${m.volumeMm3.toFixed(0)} mm3 = ${measuredKg.toFixed(3)} kg` +
      ` | solver ${solved.displacedVolumeMm3.toFixed(0)} mm3 = ${solved.displacementKg.toFixed(3)} kg`,
  )
  check(
    'the reported waterline holds the target displacement',
    Math.abs(measuredKg - 75) < 1,
    `${measuredKg.toFixed(3)} kg vs 75 kg target (${(((measuredKg - 75) / 75) * 100).toFixed(3)}%)`,
  )
  check(
    'the ray grid agrees with the solver on the displaced volume',
    Math.abs(m.volumeMm3 - solved.displacedVolumeMm3) / solved.displacedVolumeMm3 < 0.01,
    `${(((m.volumeMm3 - solved.displacedVolumeMm3) / solved.displacedVolumeMm3) * 100).toFixed(3)}% apart`,
  )

  // 2. The trim: the centre of buoyancy sits at the LCG, so there is no
  // residual longitudinal moment and the reported trim is an equilibrium.
  //
  // Both sides must be in the POSE frame: `m.cbX` is measured on the pitched
  // hull, while `solved.lcg` and `solved.lcb` are reported in the hull's own
  // frame. Transforming the latter through the same pitch is what makes the
  // comparison physical — comparing the measured CB against the un-transformed
  // LCG would hide the CG's lever above the pivot ((lcg.z - pz) * sin, 7.4 mm
  // at the reported trim) and could pass a pose that is 8 mm out of trim. The
  // solver's own sweep minimises this same posed-frame residual.
  const posedLcgX = toPosedX(solved.lcg.x, solved.lcg.z)
  const posedLcbX = toPosedX(solved.lcb.x, solved.lcb.z)
  const cbToLcg = m.cbX - posedLcgX
  const cbToSolverLcb = m.cbX - posedLcbX
  console.log(
    `  CB x ${m.cbX.toFixed(2)} mm (posed) | solver LCB x ${solved.lcb.x.toFixed(2)}` +
      ` -> ${posedLcbX.toFixed(2)} mm | LCG x ${solved.lcg.x.toFixed(2)} ->` +
      ` ${posedLcgX.toFixed(2)} mm (solver's own residual` +
      ` ${solved.lcbLcgOffsetMm.toFixed(3)} mm)`,
  )
  check(
    'the centre of buoyancy sits at the LCG (trim is an equilibrium)',
    Math.abs(cbToLcg) < 5,
    `${Math.abs(cbToLcg).toFixed(2)} mm off the LCG`,
  )
  check(
    'the centre of buoyancy matches the solver LCB',
    Math.abs(cbToSolverLcb) < 5,
    `${Math.abs(cbToSolverLcb).toFixed(2)} mm off`,
  )

  // 3. The height of that centre: LCB z is reported, CB z is not, so this is
  // the only independent check on it. Same frame rule as the CB x above —
  // `solved.lcb` is hull-frame, `m.cbZ` is posed.
  const posedLcbZ = toPosedZ(solved.lcb.x, solved.lcb.z)
  const cbZDiff = m.cbZ - posedLcbZ
  console.log(
    `  CB z ${m.cbZ.toFixed(2)} mm (posed) | solver LCB z ${solved.lcb.z.toFixed(2)}` +
      ` -> ${posedLcbZ.toFixed(2)} mm`,
  )
  check(
    'the centre of buoyancy height matches the solver LCB z',
    Math.abs(cbZDiff) < 10,
    `${Math.abs(cbZDiff).toFixed(2)} mm off`,
  )

  // 4. The freeboards: stem tip (first vertex at the extreme X) minus the
  // waterline at that end's station, measured in the posed frame.
  const bowFb = m.firstAtBowZ - plane
  const sternFb = m.firstAtSternZ - plane
  const bowDelta = bowFb - solved.bowFreeboardMm
  const sternDelta = sternFb - solved.sternFreeboardMm
  console.log(
    `  freeboards: ray grid bow ${bowFb.toFixed(2)} mm (${bowDelta >= 0 ? '+' : ''}${bowDelta.toFixed(2)}),` +
      ` stern ${sternFb.toFixed(2)} mm (${sternDelta >= 0 ? '+' : ''}${sternDelta.toFixed(2)})` +
      ` | solver bow ${solved.bowFreeboardMm.toFixed(2)} mm, stern ${solved.sternFreeboardMm.toFixed(2)} mm`,
  )
  check(
    'the bow freeboard is the stem tip above the waterline',
    Math.abs(bowDelta) < 1.5,
    `${Math.abs(bowDelta).toFixed(2)} mm off the reported value`,
  )
  check(
    'the stern freeboard is the stem tip above the waterline',
    Math.abs(sternDelta) < 1.5,
    `${Math.abs(sternDelta).toFixed(2)} mm off the reported value`,
  )

  // Definitional, not a defect: the app measures the STEM TIP (the first
  // vertex at the extreme X). The deck 60 mm behind each stem is higher, and
  // that is the other number a reader might have in mind.
  console.log(
    `  info deck-edge freeboard (highest vertex within 60 mm of the end):` +
      ` bow ${(m.highestBowZ - plane).toFixed(2)} mm, stern ${(m.highestSternZ - plane).toFixed(2)} mm`,
  )
}

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
