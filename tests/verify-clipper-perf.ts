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
// the cheap search path must stay bit-identical to the full solve. Neither of
// those exercises clipBelowPlane independently of itself — all three of
// verify-trim-search's paths clip through the same function — so the only real
// anchor for "no solver number moved" is this fixture plus the published
// baseline in verify-orientation.
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

type CaseKind = 'midpoint' | 'vertexZ' | 'extremeZ' | 'degenerate'

interface GoldenCase {
  heelDeg: number
  caseIndex: number
  kind: CaseKind
  h: number
  clippedLength: number
  digest: string
  waterplaneAreaMm2: number
  waterplaneIx: number
  waterplaneIyyMm4: number
  waterplaneCentroidX: number
  waterplaneLoopCount: number
  /** Extra xyz-interleaved triangles appended after the roll, if any. */
  extraTris?: number[]
}

interface GoldenFixture {
  note: string
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
// Node's readFileSync can return a buffer that is a view into a larger pooled
// ArrayBuffer. A view's .buffer is still the whole pool, so the file's own
// bytes have to be sliced out of the Buffer itself -- same idiom as
// verify-trim-search.ts. Handing STLLoader the pool can fail the parse whenever
// the file does not sit at pool offset 0.
const geometry = new STLLoader().parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
)
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
// The fixture's own header has to agree with its body. An earlier revision
// carried caseCount: 27 (the per-heel count) against 54 recorded cases, and
// nothing read either field, so the ambiguity in what "caseCount" meant stayed
// invisible. The note is also the only record of where these numbers came from
// -- the generator is not kept in the repo, and the values are unrecoverable
// without it -- so it is checked as well as relied on.
check(
  'fixture declares its own size and recipe',
  fixture.caseCount === fixture.clippedCases.length && fixture.note.length > 0,
  `${fixture.caseCount} declared vs ${fixture.clippedCases.length} cases, note ${fixture.note.length} chars`,
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

/**
 * The exact mesh the generator clipped for this case: the rolled base hull plus
 * the case's recorded extra triangles. Everything downstream (including the
 * cap-winding sign in signedVolumeMm3) sees the same input as it did then.
 */
function buildWorking(golden: GoldenCase): Float32Array {
  const working = rolledFor(golden.heelDeg)
  if (!golden.extraTris) return working
  return new Float32Array([...working, ...golden.extraTris])
}

/** The rolled mesh for one heel, without any recorded extra triangles. */
const rolledCache = new Map<number, Float32Array>()
function rolledFor(heelDeg: number): Float32Array {
  const cached = rolledCache.get(heelDeg)
  if (cached) return cached
  const working = Float32Array.from(positions)
  if (heelDeg !== 0) {
    applyRollX(working, (heelDeg * Math.PI) / 180, bounds.center.y, bounds.center.z)
  }
  rolledCache.set(heelDeg, working)
  return working
}

// --- 1. every recorded case still reproduces bit for bit ----------------------
console.log('=== 1. output identity against the golden fixture ===')

// Warm the JIT before the timed pass. This suite times every recorded case in a
// row, and a cold run spends most of the first few in compilation and heap
// growth -- which swamps the measurement this section exists to make. The
// identity checks below are exact either way; only the timing improves.
for (const golden of fixture.clippedCases) {
  clipBelowPlane(buildWorking(golden), golden.h)
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
  const working = buildWorking(golden)
  // The recorded h is the exact double the generator clipped at (the fixture
  // stores it at full round-trip precision), so using it directly reproduces
  // the clip height bit for bit.
  const t0 = performance.now()
  const clip = clipBelowPlane(working, golden.h)
  const ms = performance.now() - t0
  tally(golden.heelDeg, ms)

  const d = digest(clip.clipped)
  check(
    `heel ${golden.heelDeg}°  ${golden.kind} ${golden.caseIndex} digest`,
    d === golden.digest && clip.clipped.length === golden.clippedLength,
    `${d} (${clip.clipped.length / 9} tris) vs ${golden.digest} (${golden.clippedLength / 9})`,
  )
  check(
    `heel ${golden.heelDeg}°  ${golden.kind} ${golden.caseIndex} waterplane`,
    Math.abs(clip.waterplaneAreaMm2 - golden.waterplaneAreaMm2) < 1e-6 &&
      Math.abs(clip.waterplaneIx - golden.waterplaneIx) < 1e-3 &&
      Math.abs(clip.waterplaneIyyMm4 - golden.waterplaneIyyMm4) < 1e-3 &&
      Math.abs(clip.waterplaneCentroidX - golden.waterplaneCentroidX) < 1e-6,
    `A ${clip.waterplaneAreaMm2.toFixed(1)}, Ix ${clip.waterplaneIx.toFixed(3)}, Iy ${clip.waterplaneIyyMm4.toFixed(3)}, LCF ${clip.waterplaneCentroidX.toFixed(3)}`,
  )
  check(
    `heel ${golden.heelDeg}°  ${golden.kind} ${golden.caseIndex} loop count`,
    clip.waterplaneLoopCount === golden.waterplaneLoopCount,
    `${clip.waterplaneLoopCount} loop(s)`,
  )
}

// --- 2. the fixture covers what it claims to cover ----------------------------
//
// The first version of this fixture sampled 20 smooth mid-range heights and
// nothing else. On the decimated hull that meant 0 degenerate-triangle rejects,
// a smallest |cross product| of 3.95 mm^2 (the reject threshold is 1e-9 mm^2)
// and 0 vertices within 1e-9 of a plane — so the accept/reject branch and the
// in-plane clamps were never executed, and a change confined to them could not
// have been caught. These checks are computed from the fixture's own numbers,
// not from clipBelowPlane, so they stay meaningful if the implementation moves.
console.log('=== 2. the fixture exercises the branches it claims ===')

// (a) heights that are exactly a vertex z of the rolled mesh, so `h - az` is
//     exactly 0 for that vertex and the classification's `da <= EPS` boundary
//     runs instead of moving on. Keyed on kind rather than on "some vertex
//     happens to sit near h": at minZ/maxZ every vertex at the bound counts,
//     so a loose scan passed at 12 cases with the vertexZ heights broken.
const vertexZCases = fixture.clippedCases.filter((c) => c.kind === 'vertexZ')
let onPlaneCases = 0
let closestVertex = Infinity
for (const golden of vertexZCases) {
  const rolled = rolledFor(golden.heelDeg)
  let hits = 0
  for (let i = 2; i < rolled.length; i += 3) {
    const dz = Math.abs(rolled[i] - golden.h)
    if (dz < closestVertex) closestVertex = dz
    if (dz < 1e-9) hits++
  }
  if (hits > 0) onPlaneCases++
}
check(
  'vertexZ cases cut through a vertex',
  vertexZCases.length >= 8 && onPlaneCases === vertexZCases.length,
  `${onPlaneCases} of ${vertexZCases.length}, closest vertex ${closestVertex.toExponential(2)} mm off its plane`,
)

// (b) the top and bottom of the cut range, where the "fully above" / "fully
//     below" fast paths collapse onto a single plane.
let extremes = 0
for (const heelDeg of fixture.heelAnglesDeg) {
  const b = computeBounds(rolledFor(heelDeg))
  for (const golden of fixture.clippedCases) {
    if (golden.heelDeg !== heelDeg) continue
    if (golden.h === b.min.z || golden.h === b.max.z) extremes++
  }
}
check(
  'cases cut at the mesh minZ / maxZ',
  extremes >= 2 * fixture.heelAnglesDeg.length,
  `${extremes} of ${2 * fixture.heelAnglesDeg.length} expected`,
)

// (c) near-degenerate triangles, one either side of the 1e-9 mm^2 threshold.
//     Both slivers are within a decade of the threshold, so both the accept and
//     the reject branch run on an input that actually reaches the decision --
//     while staying ~8 orders of magnitude clear of the band where
//     sqrt(x^2+y^2+z^2) and hypot can disagree.
let rejectedSlivers = 0
let acceptedSlivers = 0
for (const golden of fixture.clippedCases) {
  if (!golden.extraTris) continue
  // Measure the slivers as the clipper sees them, not as the JSON spells them:
  // d = 2e-13 carries a ~6e-8 relative error on the way into a Float32Array,
  // and the recorded doubles describe a mesh the clipper never touches.
  const working = buildWorking(golden)
  const off = working.length - golden.extraTris.length
  for (let i = 0; i < golden.extraTris.length; i += 9) {
    const ax = working[off + i]
    const ay = working[off + i + 1]
    const az = working[off + i + 2]
    const bx = working[off + i + 3]
    const by = working[off + i + 4]
    const bz = working[off + i + 5]
    const cx = working[off + i + 6]
    const cy = working[off + i + 7]
    const cz = working[off + i + 8]
    const e1x = bx - ax
    const e1y = by - ay
    const e1z = bz - az
    const e2x = cx - ax
    const e2y = cy - ay
    const e2z = cz - az
    const mag = Math.sqrt(
      (e1y * e2z - e1z * e2y) ** 2 + (e1z * e2x - e1x * e2z) ** 2 + (e1x * e2y - e1y * e2x) ** 2,
    )
    if (mag >= 1e-9 && mag < 1e-8) acceptedSlivers++
    else if (mag >= 1e-10 && mag < 1e-9) rejectedSlivers++
  }
}
check(
  'slivers on both sides of 1e-9 mm^2',
  rejectedSlivers >= 1 && acceptedSlivers >= 1,
  `${acceptedSlivers} accepted-side, ${rejectedSlivers} rejected-side (as float32)`,
)

// ...and each such case really does take both branches. Testing the two slivers
// one at a time: one must be rejected outright (0 triangles contributed) and the
// other must reach the clipped solid as the 2-triangle quad an above-plane
// straddle emits. 0/0 or 2/2 would mean a branch went untested.
for (const golden of fixture.clippedCases) {
  if (!golden.extraTris) continue
  const bare = clipBelowPlane(rolledFor(golden.heelDeg), golden.h).clipped.length
  const contributed: number[] = []
  for (let i = 0; i < golden.extraTris.length; i += 9) {
    const working = buildWorking({ ...golden, extraTris: golden.extraTris.slice(i, i + 9) })
    contributed.push((clipBelowPlane(working, golden.h).clipped.length - bare) / 9)
  }
  check(
    `heel ${golden.heelDeg}°  slivers split on the threshold`,
    contributed.filter((n) => n === 0).length === 1 &&
      contributed.filter((n) => n === 2).length === 1,
    `triangles each sliver contributed: ${contributed.join(', ')}`,
  )
}

// (d) the recorded loop counts are what they are, not assumed ---------------
//
// The plan assumed a single mesh cut always yields one closed waterplane loop,
// and this fixture says otherwise: on the decimated test hull the contour
// resolves into 1, 2 or 3 loops depending on the height. That is existing
// behaviour recorded here so the perf rewrite cannot change it either way —
// the task must not merge loops, split loops, or "fix" the fragmentation while
// it is busy with allocations.
const loopTally = new Map<number, number>()
for (const c of fixture.clippedCases) {
  loopTally.set(c.waterplaneLoopCount, (loopTally.get(c.waterplaneLoopCount) ?? 0) + 1)
}
check(
  'fixture covers more loop counts than one',
  loopTally.size > 1,
  [...loopTally.entries()].map(([n, count]) => `${n} loop(s) x${count}`).join(', '),
)

// --- 3. gross-regression perf budget -----------------------------------------
console.log('=== 3. wall time for the recorded cases ===')
for (const [heelDeg, times] of Object.entries(perHeelMs)) {
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
  const slowest = Math.max(...times)
  console.log(
    `  heel ${heelDeg}°  median ${median.toFixed(2)} ms, slowest ${slowest.toFixed(2)} ms of ${times.length} clips`,
  )
}
// A hard gate, but sized to catch a typo (a rewrite that quietly goes quadratic
// costs seconds), not to police a tune-up. It is deliberately not derived from
// anything this run records: wall time is a property of the machine as much as
// of the code (this machine spreads 4x between repeats), and the pre-change
// baseline covers only the original 40 sampled heights -- the extremeZ and
// degenerate cases were never timed against the old clipper, so there is no
// same-case figure to scale from. 120 ms is ~10x the slowest clip seen here,
// which leaves room for a loaded CI runner while still failing a quadratic
// blow-up. The identity checks above are the real gate; this only keeps the
// next careless edit from reaching them at 100x the cost.
const BUDGET_MS = 120
check(
  `no clip exceeded the ${BUDGET_MS} ms gross-regression budget`,
  worstMs <= BUDGET_MS,
  `worst ${worstMs.toFixed(2)} ms (pre-change worst over the original 40 heights: 9.84 ms)`,
)

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the clipper hot path no longer reproduces the golden fixture')
  process.exit(1)
}
console.log('ALL CLIPPER IDENTITY CHECKS PASS')
