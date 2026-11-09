// Task 3 gate — output identity of the clipper hot path.
//
// `clipBelowPlane` is the solver's hot loop: ~16 ms per plane over ~950 planes
// is essentially the whole 15.4 s solve. Task 3 rewrites its inner allocations
// (numeric weld buckets, scratch buffers, sqrt instead of hypot) WITHOUT
// changing the algorithm or the winding rules, so the only way to know the
// rewrite is safe is output identity against a golden fixture captured from
// the PRE-change code.
//
// The fixture records, per case: the clipped Float32Array's length, a byte
// digest of its contents, waterplaneAreaMm2, waterplaneIx, waterplaneIyyMm4,
// waterplaneCentroidX and waterplaneLoopCount. Any of those moving — including
// a loop that merges or splits — fails this suite.
//
// This suite is not an analytic check. Everything it asserts comes from the
// same implementation the task is changing, so it can only prove "the numbers
// are what the old code produced", never "these numbers are right". The
// geometric suites (verify-analytic, verify-box-identity, verify-solve-extras)
// carry that load, and verify-trim-search carries the strongest one available:
// the cheap search path must stay bit-identical to the full solve.
//
// Run: npm.cmd exec -- tsx tests/verify-clipper-perf.ts

import { readFileSync } from 'node:fs'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import {
  applyRollX,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  decimateMesh,
} from '../src/lib/geometry.js'
import { clipBelowPlane } from '../src/lib/hydrostatics.js'

interface GoldenCase {
  heelDeg: number
  caseIndex: number
  h: number
  clippedLength: number
  digest: string
  waterplaneAreaMm2: number
  waterplaneIx: number
  waterplaneIyyMm4: number
  waterplaneCentroidX: number
  waterplaneLoopCount: number
  ms: number
}

interface GoldenFixture {
  meshTriangles: number
  heelAnglesDeg: number[]
  caseCount: number
  clippedCases: GoldenCase[]
}

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(38)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

const fixtureJson = readFileSync(new URL('./fixtures/clip-golden.json', import.meta.url))
// The node shim's readFileSync has no encoding parameter, and Buffer here is
// just a Uint8Array — so its own toString() would return "123,45,67", not the
// text. Decode explicitly.
const fixture = JSON.parse(new TextDecoder().decode(fixtureJson)) as GoldenFixture

// --- rebuild the fixture's mesh, the same way the generator did ---------------
const buffer = readFileSync(new URL('./test-kayak.stl', import.meta.url))
const geometry = new STLLoader().parse(buffer.buffer as ArrayBuffer)
let positions = geometry.getAttribute('position').array as Float32Array
autoOrientToZUp(positions)
centerToOrigin(positions)
positions = decimateMesh(positions, 12000)

const bounds = computeBounds(positions)
check(
  'fixture was captured on this mesh',
  positions.length / 9 === fixture.meshTriangles,
  `${positions.length / 9} tris vs fixture ${fixture.meshTriangles}`,
)

/** FNV-1a 32-bit digest over the raw bytes — same as the generator's. */
function digest(values: Float32Array): string {
  let h = 0x811c9dc5
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// --- 1. every recorded case still reproduces bit for bit ----------------------
console.log('=== 1. output identity against the golden fixture ===')

// Warm the JIT before the timed pass. This suite times 40 single clips in a
// row, and a cold run spends most of the first few in compilation and heap
// growth -- which swamps the measurement this section exists to make. The
// identity checks below are exact either way; only the timing improves.
for (const golden of fixture.clippedCases) {
  const working = Float32Array.from(positions)
  if (golden.heelDeg !== 0) {
    applyRollX(working, (golden.heelDeg * Math.PI) / 180, bounds.center.y, bounds.center.z)
  }
  clipBelowPlane(working, golden.h)
}

const perHeelMs: Record<number, number[]> = {}
let worstMs = 0
const tally = (heelDeg: number, ms: number): void => {
  worstMs = Math.max(worstMs, ms)
  const bucket = perHeelMs[heelDeg]
  if (bucket) bucket.push(ms)
  else perHeelMs[heelDeg] = [ms]
}
for (const golden of fixture.clippedCases) {
  const working = Float32Array.from(positions)
  if (golden.heelDeg !== 0) {
    applyRollX(working, (golden.heelDeg * Math.PI) / 180, bounds.center.y, bounds.center.z)
  }
  // The recorded h is the exact double the generator clipped at (the fixture
  // stores it at full round-trip precision), so using it directly reproduces
  // the clip height bit for bit.
  const t0 = performance.now()
  const clip = clipBelowPlane(working, golden.h)
  const ms = performance.now() - t0
  tally(golden.heelDeg, ms)

  const d = digest(clip.clipped)
  check(
    `heel ${golden.heelDeg}°  digest`,
    d === golden.digest && clip.clipped.length === golden.clippedLength,
    `${d} (${clip.clipped.length / 9} tris) vs ${golden.digest} (${golden.clippedLength / 9})`,
  )
  check(
    `heel ${golden.heelDeg}°  waterplane numbers`,
    Math.abs(clip.waterplaneAreaMm2 - golden.waterplaneAreaMm2) < 1e-6 &&
      Math.abs(clip.waterplaneIx - golden.waterplaneIx) < 1e-3 &&
      Math.abs(clip.waterplaneIyyMm4 - golden.waterplaneIyyMm4) < 1e-3 &&
      Math.abs(clip.waterplaneCentroidX - golden.waterplaneCentroidX) < 1e-6,
    `A ${clip.waterplaneAreaMm2.toFixed(1)}, Ix ${clip.waterplaneIx.toFixed(3)}, Iy ${clip.waterplaneIyyMm4.toFixed(3)}, LCF ${clip.waterplaneCentroidX.toFixed(3)}`,
  )
  check(
    `heel ${golden.heelDeg}°  loop count`,
    clip.waterplaneLoopCount === golden.waterplaneLoopCount,
    `${clip.waterplaneLoopCount} loop(s)`,
  )
}

// --- 2. the recorded loop counts are what they are, not assumed ---------------
//
// The plan assumed a single mesh cut always yields one closed waterplane loop,
// and this fixture says otherwise: on the decimated test hull the contour
// resolves into 1, 2 or 3 loops depending on the height. That is existing
// behaviour recorded here so the perf rewrite cannot change it either way —
// the task must not merge loops, split loops, or "fix" the fragmentation while
// it is busy with allocations.
console.log('=== 2. the loop counts the fixture records ===')
const loopTally = new Map<number, number>()
for (const c of fixture.clippedCases) {
  loopTally.set(c.waterplaneLoopCount, (loopTally.get(c.waterplaneLoopCount) ?? 0) + 1)
}
check(
  'fixture covers more loop counts than one',
  loopTally.size > 1,
  [...loopTally.entries()].map(([n, count]) => `${n} loop(s) x${count}`).join(', '),
)

// --- 3. soft perf budget: fail only on a gross regression --------------------
console.log('=== 3. wall time for the recorded cases ===')
for (const [heelDeg, times] of Object.entries(perHeelMs)) {
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
  const slowest = Math.max(...times)
  console.log(
    `  heel ${heelDeg}°  median ${median.toFixed(2)} ms, slowest ${slowest.toFixed(2)} ms of ${times.length} clips`,
  )
}
// Budget is 3x the slowest recorded clip, floored at 20 ms so a fast case
// cannot fail on scheduler noise alone. The point is to catch a typo that
// turns the rewrite quadratic, not to police small deltas.
const slowestRecorded = Math.max(...fixture.clippedCases.map((c) => c.ms))
const budget = Math.max(slowestRecorded * 3, 20)
check(
  'no clip became > 3x the recorded slowest',
  worstMs <= budget,
  `worst ${worstMs.toFixed(2)} ms vs recorded slowest ${slowestRecorded.toFixed(2)} ms, budget ${budget.toFixed(2)} ms`,
)

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the clipper hot path no longer reproduces the golden fixture')
  process.exit(1)
}
console.log('ALL CLIPPER IDENTITY CHECKS PASS')
