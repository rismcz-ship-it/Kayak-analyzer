// Task 6 gate — the scale advice, the weld quantum behind the watertight gate,
// and the ×1000 rescale path.
//
// Why this suite exists: Task 6 shipped three user-facing gates with zero
// assertions, and a green `npm run ci` proved nothing about them. All three
// failures the cross-review found are pinned here:
//
//  1. THE WELD QUANTUM WAS A UNIT BUG, NOT A LENGTH. `checkWatertight` welded
//     vertices on a grid of 0.001 in the ARRAY's own units. On a millimetre
//     file that is 0.001 mm; on the same hull authored in metres it is 1 mm,
//     which merges vertices that are genuinely distinct and made a closed hull
//     report 1730 phantom open edges — a hard block on a valid file, one banner
//     away from another saying "this looks like metres". The quantum is now a
//     fixed fraction of the mesh's own extent, so both spellings of the same
//     hull weld identically. The round-trip checks below are the ones that
//     would have caught it.
//
//  2. THE ADVICE FALSE-POSITIVED ON SUB-METRE HULLS AND RE-ARMED. A threshold
//     of "under 1000" told a real 900 mm kayak it was metres and offered a
//     ×1000 that made it a 900 m kayak; and a metre file scaled to 900 mm was
//     told so again, so a second Apply produced 900 000 mm. Both are pinned by
//     the truth table and by the rescale checks. The same threshold then went
//     SILENT on a centimetre file (a 540 cm tandem reads 540 units), which the
//     app would have analysed as a 540 mm kayak — lengths ten times too small,
//     volumes a thousand times too small. The `small` band covers that gap.
//
//  3. ZERO LOOPS WAS INVISIBLE. `waterplaneLoopCount === 0` leaves BM = 0 and
//     GM = KB − KG: a plausible number out of nothing. That is an App-level
//     banner condition, so it is not executed here; the solver contract that
//     makes 0 meaningful (`!== 1`, not `> 1`) is asserted against the analytic
//     box in `verify-solve-extras.ts`, whose waterplane at every draft is
//     exactly one loop.
//
// What this suite does NOT cover, and says so rather than pretending: the
// banners themselves, the disabled Calculate button, the Apply button's wiring
// and the orientNote wording are React/JSX in `App.tsx` and `Upload.tsx`. They
// are covered by typecheck, `biome check` and a read-through, exactly as the
// mount/update split is handled in `verify-viewer-scene.ts`.
//
// Run: npm.cmd exec -- tsx tests/verify-upload-scale.ts

import { readFileSync } from 'node:fs'
import { BufferAttribute, BufferGeometry } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { type LoadedMesh, rescaleMesh } from '../src/components/Upload.js'
import {
  analyzeMesh,
  autoOrientToZUp,
  centerToOrigin,
  checkWatertight,
  computeBounds,
  rescalePositions,
  scaleAdviceFor,
  type Vec3,
} from '../src/lib/geometry.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// --- helpers ---------------------------------------------------------------

/** An outward-wound closed box of size sx×sy×sz, centred on the origin. */
function boxPositions(sx: number, sy: number, sz: number): Float32Array {
  const half = [
    [-sx / 2, -sy / 2, -sz / 2],
    [sx / 2, -sy / 2, -sz / 2],
    [sx / 2, sy / 2, -sz / 2],
    [-sx / 2, sy / 2, -sz / 2],
    [-sx / 2, -sy / 2, sz / 2],
    [sx / 2, -sy / 2, sz / 2],
    [sx / 2, sy / 2, sz / 2],
    [-sx / 2, sy / 2, sz / 2],
  ]
  // Six quads, each listed counter-clockwise seen from outside.
  const quads = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [5, 1, 2, 6],
    [0, 4, 7, 3],
    [7, 6, 2, 3],
    [0, 1, 5, 4],
  ]
  const out: number[] = []
  for (const [a, b, c, d] of quads) {
    out.push(...half[a], ...half[b], ...half[c])
    out.push(...half[a], ...half[c], ...half[d])
  }
  return new Float32Array(out)
}

function asMesh(positions: Float32Array): LoadedMesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const stats = analyzeMesh(positions)
  return {
    id: 1,
    fileName: 'synthetic.stl',
    sizeBytes: 0,
    geometry,
    stats,
    orientNote: 'oriented · centered by (0.0, 0.0, 0.0) mm',
    scaleAdvice: scaleAdviceFor(stats.bounds.size),
  }
}

/** Same mesh, written a thousand times smaller, as a metre-authored STL is. */
function asMetres(positions: Float32Array): Float32Array {
  const m = new Float32Array(positions.length)
  for (let i = 0; i < positions.length; i++) m[i] = positions[i] / 1000
  return m
}

function maxDimOf(size: Vec3): number {
  return Math.max(size.x, size.y, size.z)
}

// --- 1. the advice truth table ---------------------------------------------

console.log('\n=== scaleAdviceFor truth table ===')
const advice = (maxDim: number) => scaleAdviceFor({ x: maxDim, y: maxDim, z: maxDim })

check(advice(0) === undefined, 'zero extent is not metres', 'degenerate mesh ignored')
check(advice(499)?.kind === 'metres', '499 mm reads as metres')
// 500 … 999 cannot be metres (a 500 m hull is not a hull) yet too short for a
// millimetre one: that is where a cm- or inch-authored STL lands, so the notice
// names the gap instead of silently trusting the numbers.
check(advice(500)?.kind === 'small', '500 begins the small band', 'boundary is exclusive')
check(advice(540)?.kind === 'small', 'a 540 cm tandem is flagged small', 'was silently accepted')
check(
  advice(900)?.kind === 'small',
  '900 is too short for a mm kayak',
  'the old < 1000 said metres',
)
check(advice(999)?.kind === 'small', '999 is still the small band', 'boundary is exclusive')
check(advice(1000) === undefined, '1000 mm is the smallest silent size', 'boundary is exclusive')
check(advice(2714) === undefined, 'the test hull is not flagged')
check(advice(10_000) === undefined, '10 m is the last silent size', 'boundary is exclusive')
check(advice(10_001)?.kind === 'large', 'over 10 m is flagged large')

// The type is the contract: only `metres` may carry a factor to apply, and
// nothing may scale a mesh by zero.
const large = advice(12_345)
check(large?.kind === 'large', 'large carries no factor', JSON.stringify(large))
check(!('factor' in (large ?? {})), 'no factor key on the large variant')
const small = advice(540)
check(small?.kind === 'small', 'small carries no factor', JSON.stringify(small))
check(!('factor' in (small ?? {})), 'no factor key on the small variant')

// --- 2. the weld quantum is scale-free -------------------------------------

console.log('\n=== watertight verdict is a property of the mesh, not its units ===')

// The real hull, oriented and centred exactly as Upload.tsx does on load.
const STL = new URL('./test-kayak.stl', import.meta.url)
// Sliced out of the Buffer explicitly: Node's readFileSync can hand back a view
// into a larger pooled ArrayBuffer, whose tail a parser would then read.
const stlBytes = readFileSync(STL)
const stlBuffer = stlBytes.buffer.slice(
  stlBytes.byteOffset,
  stlBytes.byteOffset + stlBytes.byteLength,
) as ArrayBuffer
const raw = new STLLoader().parse(stlBuffer).getAttribute('position').array as Float32Array
const mm = new Float32Array(raw)
autoOrientToZUp(mm)
centerToOrigin(mm)
const metre = asMetres(mm)

const wtMm = checkWatertight(mm)
const wtMetre = checkWatertight(metre)
console.log(
  `  hull ${mm.length / 9} triangles; mm open=${wtMm.openEdgeCount}, metre open=${wtMetre.openEdgeCount}`,
)

check(wtMm.watertight, 'mm hull is watertight', `${wtMm.openEdgeCount} open edges`)
check(wtMm.openEdgeCount === 0, 'mm hull reports no open edges')
check(
  wtMetre.watertight && wtMetre.openEdgeCount === 0,
  'the same hull in metres reports no open edges',
  `${wtMetre.openEdgeCount} open edges — the quantum is still absolute`,
)
check(
  wtMetre.openEdgeCount === wtMm.openEdgeCount,
  'both spellings give the same count',
  `mm=${wtMm.openEdgeCount} metre=${wtMetre.openEdgeCount}`,
)

// The tighter quantum must still find a genuine hole: a box with one triangle
// deleted. A tolerance loose enough to miss this would make the gate vacuous.
const box = boxPositions(600, 300, 150)
const holed = box.slice(0, box.length - 9) // drop one triangle
const wtBox = checkWatertight(box)
const wtHoled = checkWatertight(holed)
check(wtBox.watertight && wtBox.openEdgeCount === 0, 'analytic box is watertight')
check(
  wtHoled.openEdgeCount === 3,
  'a box missing one triangle has exactly 3 open edges',
  `got ${wtHoled.openEdgeCount}`,
)
check(!wtHoled.watertight, 'the holed box is not watertight')

// And the same on the metre spelling, so the scale-free quantum is proven to
// still resolve a real defect at that scale.
const holedMetre = asMetres(holed)
check(
  checkWatertight(holedMetre).openEdgeCount === 3,
  'the hole is still 3 open edges at metre scale',
  `got ${checkWatertight(holedMetre).openEdgeCount}`,
)

// --- 3. the round trip -----------------------------------------------------

console.log('\n=== mm → ÷1000 → ×1000 round trip ===')

const round = rescalePositions(metre, 1000)
check(round.length === mm.length, 'round trip preserves the array shape')
check(
  round !== metre && round.buffer !== metre.buffer,
  'rescalePositions copies rather than mutating',
)

const stMm = analyzeMesh(mm)
const stRound = analyzeMesh(round)
const sizeMm = stMm.bounds.size
const sizeRound = stRound.bounds.size
const dBound = Math.max(
  Math.abs(sizeRound.x - sizeMm.x),
  Math.abs(sizeRound.y - sizeMm.y),
  Math.abs(sizeRound.z - sizeMm.z),
)
check(
  dBound < 1e-3,
  'round-tripped bounds match the mm bounds',
  `off by ${dBound.toExponential(2)}`,
)
check(
  stRound.triangleCount === stMm.triangleCount,
  'triangle count survives',
  `${stMm.triangleCount} → ${stRound.triangleCount}`,
)
const volRel = Math.abs(stRound.volumeMm3 - stMm.volumeMm3) / stMm.volumeMm3
check(volRel < 1e-9, 'volume survives the round trip', `rel err ${volRel.toExponential(2)}`)
const areaRel = Math.abs(stRound.surfaceAreaMm2 - stMm.surfaceAreaMm2) / stMm.surfaceAreaMm2
check(areaRel < 1e-9, 'surface area survives', `rel err ${areaRel.toExponential(2)}`)
check(
  stRound.watertight.watertight && stRound.watertight.openEdgeCount === 0,
  'the round-tripped hull is watertight',
  `${stRound.watertight.openEdgeCount} open edges`,
)

// --- 4. the Apply ×1000 path ----------------------------------------------

console.log('\n=== Apply ×1000 ===')

const metreMesh = asMesh(metre)
check(metreMesh.scaleAdvice?.kind === 'metres', 'the metre mesh is flagged metres')

const rescaled = rescaleMesh(metreMesh, 1000)
const bMm = computeBounds(mm)
const bRescaled = computeBounds(rescaled.geometry.getAttribute('position').array as Float32Array)
const maxOff = Math.max(
  Math.abs(maxDimOf(bRescaled.size) - maxDimOf(bMm.size)),
  Math.abs(bRescaled.size.x - bMm.size.x),
)
check(
  maxOff < 1e-3,
  'Apply ×1000 restores the real dimensions',
  `largest extent ${maxDimOf(bRescaled.size).toFixed(3)} vs ${maxDimOf(bMm.size).toFixed(3)} mm`,
)
check(
  rescaled.stats.watertight.watertight && rescaled.stats.watertight.openEdgeCount === 0,
  'Apply ×1000 leaves a watertight hull',
  `${rescaled.stats.watertight.openEdgeCount} open edges`,
)
check(rescaled.scaleAdvice === undefined, 'a mm kayak raises no flag after Apply')
check(
  rescaled.geometry !== metreMesh.geometry,
  'Apply ×1000 builds a new geometry, so the viewer is remounted',
)
check(
  (rescaled.geometry.getAttribute('position').array as Float32Array).buffer !==
    (metreMesh.geometry.getAttribute('position').array as Float32Array).buffer,
  'the source buffer is not reused',
)

// The re-arm case the truth table alone cannot catch: a model-sized kayak
// authored in metres (0.4 m) rescales to 400 mm, which is still under the
// metres threshold. It must NOT be flagged metres again — the mesh is in mm by
// construction once the user has applied the fix, and offering ×1000 a second
// time would make it 400 000 mm.
const smallMetre = asMesh(asMetres(boxPositions(400, 200, 100)))
check(smallMetre.scaleAdvice?.kind === 'metres', 'a 0.4 m mesh is flagged metres')
const smallRescaled = rescaleMesh(smallMetre, 1000)
check(
  smallRescaled.scaleAdvice === undefined,
  'the advice does not re-arm after a correct Apply',
  `still advising ${JSON.stringify(smallRescaled.scaleAdvice)}`,
)
check(
  smallRescaled.stats.watertight.watertight,
  'the small metre mesh stays watertight through the rescale',
  `${smallRescaled.stats.watertight.openEdgeCount} open edges`,
)

// The other half of the same rule: a 0.9 m file rescales to 900 mm, which is
// too short for a boat. That is a true statement about the mesh the user now
// has, so `small` survives the Apply while `metres` does not — and no button is
// offered, because which factor a 900 mm hull needs is not knowable here.
const underMetre = asMesh(asMetres(boxPositions(900, 400, 150)))
check(underMetre.scaleAdvice?.kind === 'metres', 'a 0.9 m mesh is flagged metres')
const underRescaled = rescaleMesh(underMetre, 1000)
check(
  underRescaled.scaleAdvice?.kind === 'small',
  'a 900 mm rescaled mesh is still told it is too short for a kayak',
  `advising ${JSON.stringify(underRescaled.scaleAdvice)}`,
)
check(
  !('factor' in (underRescaled.scaleAdvice ?? {})),
  'the surviving small advice offers no Apply button',
  JSON.stringify(underRescaled.scaleAdvice),
)
check(
  underRescaled.stats.watertight.watertight,
  'the 0.9 m mesh stays watertight through the rescale',
  `${underRescaled.stats.watertight.openEdgeCount} open edges`,
)

console.log(
  failures === 0 ? '\nALL SCALE/WELD CHECKS PASSED' : `\n${failures} SCALE/WELD CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
