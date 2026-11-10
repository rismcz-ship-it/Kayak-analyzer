// Task 4 gate — the worker's message protocol, tested without a browser.
//
// A real Web Worker needs a browser and a bundler, so the protocol is driven in
// two pieces: `handleSolveRequest` directly (the worker's whole body, with the
// post function injected) and `SolverClient` against a fake `Worker` global that
// records what was posted and can emit a message back on command. Between them
// that is everything of Task 4 that carries logic. The `onmessage` wiring at
// the bottom of solver-worker.ts, and the real worker chunk the build emits,
// are the parts only a browser shows.
//
// What this proves:
//   1. no mutation — the request's positions survive the run bit-for-bit;
//   2. progress discipline — indices run 1..total contiguously and the last one
//      equals total, with phases Task 1 defines (coarse then fine), on the
//      ladder Task 1 documents: 19 coarse + 11 fine = 30;
//   3. parity — the worker adds no arithmetic of its own, so its result must be
//      a DIRECT solveTrim call's result exactly, not to a tolerance, with every
//      option it forwards carrying a value the solver's defaults differ from
//      (otherwise a dropped option would be invisible here);
//   4. the error path — a thrown solve maps to { ok: false } with a message,
//      instead of leaving the caller's promise hanging forever;
//   5. the client's lifecycle — a run settles (resolved or rejected), a cancel
//      or a replacement REJECTS the old promise with 'cancelled' instead of
//      leaving it pending, and each worker is terminated exactly once.

import { readFileSync } from 'node:fs'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { autoOrientToZUp, centerToOrigin, decimateMesh } from '../src/lib/geometry.js'
import type { TrimSolveResult } from '../src/lib/hydrostatics.js'
import { solveTrim } from '../src/lib/hydrostatics.js'
import { SolverClient } from '../src/lib/solver-client.js'
import type { SolveRequest, WorkerMessage } from '../src/lib/solver-worker.js'
import { handleSolveRequest } from '../src/lib/solver-worker.js'

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(38)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

// --- the hull: same pipeline as the other suites -----------------------------
const stlBuffer = readFileSync(new URL('./test-kayak.stl', import.meta.url))
// Node's readFileSync can hand back a view into a larger pooled ArrayBuffer,
// and a view's .buffer is still the whole pool, so slice the file's own bytes
// out of the Buffer itself (verify-trim-search, verify-clipper-perf).
const geometry = new STLLoader().parse(
  stlBuffer.buffer.slice(
    stlBuffer.byteOffset,
    stlBuffer.byteOffset + stlBuffer.byteLength,
  ) as ArrayBuffer,
)
let positions = geometry.getAttribute('position').array as Float32Array
autoOrientToZUp(positions)
centerToOrigin(positions)
// Decimated for runtime, not for strength: a full solve on the committed 2 MB
// mesh costs seconds and this suite runs it twice (once through the worker, once
// directly). Both sides of the parity check see the SAME array, so decimation
// changes which hull is under test, not how tightly the two paths are compared.
// verify-clipper-perf clips this same 12000-tri hull.
positions = decimateMesh(positions, 12000)

// Options that differ from the solver's own DEFAULT_KG_MM 280 / LCG 52% /
// heel 0 on purpose. The parity check compares this run against a direct
// solveTrim with the same options, so if the worker silently dropped one the
// two sides would still match — UNLESS the value changes the answer. kgMm is
// the one this repo already shipped a unit bug in, so it is the one that must
// never be silently dropped. trimStepDeg stays at the 0.1 default because the
// app only ever asks for 0.1 and the documented 19+11 ladder depends on it.
const REQUEST: SolveRequest = {
  positions,
  targetKg: 75,
  targetLcgPercentFromBow: 50,
  kgMm: 300,
  fixedHeelDeg: 4,
  maxTrimDeg: 4.5,
  trimStepDeg: 0.1,
}

// --- 1. the request buffer survives the run untouched ------------------------
//
// The client solves nothing: it hands the worker a transfer and the transferred
// buffer is the worker's own. This the end-to-end property that whatever happens
// inside the solve, the array it was given still reads the same afterwards —
// measured on the raw bytes, so any re-write counts. solveTrim is documented to
// copy before it pitches (hydrostatics.ts, beside the cheap sweep); if that ever
// stops being true, this check is what fails, and the fix belongs in the worker.

console.log('=== 1. the request buffer is not mutated ===')
const before = positions.slice()
const messages: WorkerMessage[] = []
const angleMessages: Extract<WorkerMessage, { type: 'angle' }>[] = []
const post = (msg: WorkerMessage) => {
  messages.push(msg)
  if (msg.type === 'angle') angleMessages.push(msg)
}
handleSolveRequest(REQUEST, post)

let sameBytes = before.length === positions.length
for (let i = 0; sameBytes && i < before.length; i++) {
  if (before[i] !== positions[i]) sameBytes = false
}
check('positions bit-identical after the run', sameBytes, `${positions.length} floats compared`)

// --- 2. progress discipline --------------------------------------------------
//
// The bar in Task 5 reads index/total off these messages, so the contract is
// the one Task 1 documents: index counts 1..total ACROSS both ladders, and the
// last message arrives after the final angle — not after the GZ curve, which
// runs after the last call and is deliberately not counted. The counts are
// pinned, not measured off the messages: a ladder change must fail here, or
// the bar in Task 5 is silently wrong.
console.log('=== 2. progress messages match Task 1 total ===')
const COARSE_CASES = 19
const FINE_CASES = 11
const TOTAL_CASES = COARSE_CASES + FINE_CASES
const total = angleMessages[0]?.total ?? 0
let contiguous = angleMessages.length > 0
angleMessages.forEach((m, i) => {
  if (m.index !== i + 1 || m.total !== total || m.index > m.total) contiguous = false
})
check(
  'indices run 1..total contiguously',
  contiguous,
  `${angleMessages.length} messages, total ${total}`,
)
check(
  'last progress index equals total',
  angleMessages[angleMessages.length - 1]?.index === total && total > 0,
  `final ${angleMessages[angleMessages.length - 1]?.index ?? 'none'} of ${total}`,
)
const coarse = angleMessages.filter((m) => m.phase === 'coarse')
const fine = angleMessages.filter((m) => m.phase === 'fine')
check(
  'phases are coarse then fine, each non-empty',
  angleMessages.length > 0 &&
    coarse.length === COARSE_CASES &&
    fine.length === FINE_CASES &&
    total === TOTAL_CASES &&
    // every coarse message precedes the first fine one: 19 + 11, nothing after
    fine.length > 0 &&
    angleMessages.indexOf(fine[0]) === coarse.length,
  `${coarse.length} coarse + ${fine.length} fine, total ${total}`,
)
check(
  'every progress angle is inside the sweep',
  angleMessages.every((m) => Math.abs(m.angleDeg) <= REQUEST.maxTrimDeg + 1e-9),
  `|deg| <= ${REQUEST.maxTrimDeg}°`,
)

// --- 3. parity with a direct solve ------------------------------------------
//
// Exact equality, not a tolerance: the worker's only job is transport, so any
// difference at all means it changed the inputs or ran a second solve. REQUEST
// deliberately carries values the solver's defaults (280 / 52% / 0°) do not, so
// an option the worker fails to forward changes this result and the check bites.

console.log('=== 3. the worker result is the solver result ===')
const results = messages.filter((m) => m.type === 'result')
check(
  'exactly one result message, posted last',
  results.length === 1 && messages[messages.length - 1].type === 'result',
  `${results.length} result message(s) of ${messages.length} total`,
)
const workerResult = results[0]
const direct = solveTrim(positions, REQUEST.targetKg, {
  targetLcgPercentFromBow: REQUEST.targetLcgPercentFromBow,
  kgMm: REQUEST.kgMm,
  fixedHeelDeg: REQUEST.fixedHeelDeg,
  maxTrimDeg: REQUEST.maxTrimDeg,
  trimStepDeg: REQUEST.trimStepDeg,
})
if (workerResult?.ok) {
  const r = workerResult.result
  const fields: [string, number][] = [
    ['trimDeg', r.trimDeg],
    ['draftMm', r.draftMm],
    ['GM', r.GM],
    ['displacementKg', r.displacementKg],
  ]
  let identical = true
  const detail: string[] = []
  for (const [name, value] of fields) {
    const expected = direct[name as 'trimDeg' | 'draftMm' | 'GM' | 'displacementKg']
    if (value !== expected) identical = false
    detail.push(`${name} ${value} vs ${expected}`)
  }
  check('trimDeg/draftMm/GM/displacementKg identical', identical, detail.join(', '))
  check(
    'the whole result object is identical',
    JSON.stringify(r) === JSON.stringify(direct),
    'deep-equal, not just the four reported fields',
  )
  check(
    'a solve actually ran (not a stub)',
    r.planesEvaluated > 0 && Number.isFinite(r.GM),
    `${r.planesEvaluated} planes evaluated`,
  )
} else {
  check('the happy path returns ok: true', false, `got ${JSON.stringify(workerResult)}`)
}

// --- 4. the error path -------------------------------------------------------
//
// kgMm <= 0 is the one guard solveTrim raises BEFORE any sweep, so it is the
// deterministic trigger: it needs no heavy solve to reach, and it cannot be
// confused with an unreasonable weight that the solver absorbs by falling back.
console.log('=== 4. a thrown solve maps to ok: false ===')
const badMessages: WorkerMessage[] = []
let threw = false
try {
  handleSolveRequest({ ...REQUEST, positions: positions.slice(), kgMm: -1 }, (msg) =>
    badMessages.push(msg),
  )
} catch {
  threw = true
}
check(
  'the throw does not escape the handler',
  !threw,
  threw ? 'handleSolveRequest rethrew' : 'caught internally',
)
const badResult = badMessages.find((m) => m.type === 'result')
check(
  'one error result, no progress, non-empty message',
  badMessages.length === 1 &&
    !!badResult &&
    badResult.ok === false &&
    typeof badResult.error === 'string' &&
    badResult.error.length > 0,
  badResult && badResult.ok === false ? `"${badResult.error}"` : JSON.stringify(badMessages),
)

// --- 5. the client lifecycle -------------------------------------------------
//
// SolverClient is browser code, but its body is bookkeeping over a Worker: make
// one, transfer a copy, settle once, terminate. A fake Worker global is enough
// to drive that from Node, and it earns its keep: the failure it pins is a
// promise that NEVER settles, which a browser check only shows Richard by hand
// and which Task 5 would surface as a page stuck on "Solving…".
console.log('=== 5. SolverClient lifecycle (fake Worker) ===')

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  terminated = false
  readonly posted: unknown[] = []
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(msg: unknown): void {
    this.posted.push(msg)
  }
  terminate(): void {
    this.terminated = true
  }
}

const realWorker = (globalThis as { Worker?: unknown }).Worker
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const lastInstance = () => FakeWorker.instances[FakeWorker.instances.length - 1]

/** What the promise settled to, or 'PENDING' if it never settled in time. */
const settled = async (p: Promise<unknown>): Promise<string> => {
  const state = { value: 'PENDING' }
  p.then(
    () => {
      state.value = 'RESOLVED'
    },
    (e: unknown) => {
      state.value = e instanceof Error ? e.message : String(e)
    },
  )
  await new Promise((r) => setTimeout(r, 25))
  return state.value
}

// Only ever a transport payload: the client passes it straight back to the
// caller, so section 5 never compares its numbers to a real solve.
const FAKE_RESULT = { trimDeg: 0, draftMm: 0, GM: 0 } as unknown as TrimSolveResult

// 5a. the happy path
const clientA = new SolverClient()
let progressTicks = 0
const runA = clientA.run(REQUEST, () => {
  progressTicks++
})
const workerA = lastInstance()
const posted = workerA.posted[0] as { positions: Float32Array } | undefined
check(
  'run() transfers a copy, not the request array',
  !!posted && posted.positions !== positions && posted.positions.length === positions.length,
  posted ? `a fresh ${posted.positions.length}-float array` : 'nothing was posted',
)
check('a run creates exactly one worker', FakeWorker.instances.length === 1, 'one instance')
workerA.onmessage?.({
  data: { type: 'angle', index: 3, total: 30, angleDeg: -3, phase: 'coarse' },
})
check('progress messages reach the callback', progressTicks === 1, `${progressTicks} tick(s)`)
workerA.onmessage?.({ data: { type: 'result', ok: true, result: FAKE_RESULT } })
check('a result message resolves the run', (await settled(runA)) === 'RESOLVED', 'resolved')
check('the worker is terminated once it resolves', workerA.terminated, 'terminated')

// 5b. cancel — the one that must never hang
const clientB = new SolverClient()
const runB = clientB.run(REQUEST, () => {})
const workerB = lastInstance()
clientB.cancel()
check('cancel rejects with Error(cancelled)', (await settled(runB)) === 'cancelled', 'rejected')
check('cancel terminates the worker', workerB.terminated, 'terminated')
let lateOk = true
try {
  workerB.onmessage?.({ data: { type: 'result', ok: true, result: FAKE_RESULT } })
} catch {
  lateOk = false
}
check('a late message from the dead worker is dropped', lateOk, 'no crash on delivery')
check(
  'that late message did not settle the run',
  (await settled(runB)) === 'cancelled',
  'still cancelled',
)

// 5c. replacement
const clientC = new SolverClient()
const runC1 = clientC.run(REQUEST, () => {})
const workerC1 = lastInstance()
const runC2 = clientC.run(REQUEST, () => {})
const workerC2 = lastInstance()
check(
  'a second run rejects the first with cancelled',
  (await settled(runC1)) === 'cancelled',
  'rejected',
)
check(
  'the replaced worker is terminated, the new one alive',
  workerC1.terminated && !workerC2.terminated,
  `first terminated ${workerC1.terminated}, second ${workerC2.terminated}`,
)
workerC2.onmessage?.({ data: { type: 'result', ok: true, result: FAKE_RESULT } })
check('the replacement run still resolves', (await settled(runC2)) === 'RESOLVED', 'resolved')

// 5d. a failed solve, and a worker that dies outright
const clientD = new SolverClient()
const runD = clientD.run(REQUEST, () => {})
const workerD = lastInstance()
workerD.onmessage?.({ data: { type: 'result', ok: false, error: 'mesh not watertight' } })
check(
  'a failed solve rejects with the solver message',
  (await settled(runD)) === 'mesh not watertight',
  'rejected with the solver message',
)
const clientE = new SolverClient()
const runE = clientE.run(REQUEST, () => {})
lastInstance().onerror?.({ message: 'chunk failed to load' })
check(
  'a worker error rejects instead of hanging',
  (await settled(runE)).startsWith('solver worker failed'),
  'rejected',
)

;(globalThis as { Worker?: unknown }).Worker = realWorker

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the worker protocol or client lifecycle is wrong')
  process.exit(1)
}
console.log('ALL WORKER PROTOCOL CHECKS PASS')
