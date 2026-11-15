// Task 4 gate, Compare half: one slot = one solve session.
//
// verify-worker-protocol.ts already pins the worker itself — no mutation of
// the request buffer, contiguous progress, parity with a direct solve, the
// error mapping and the client's lifecycle. What is left is the Compare seam
// on top: a SlotSolver that owns exactly one SolverClient per slot (so two
// slots never share a worker) and maps one SlotInputs into one SolveRequest.
//
// Three failure classes are pinned here, all silent without a suite:
//
//  1. THE MAPPING SLIPS. kgMm is a HEIGHT above the keel (Review Focus 1,
//     the unit bug this repo already shipped once) and heelDeg is the marine
//     sign, + = the -Y side down (Review Focus 3), and both must reach the
//     worker VERBATIM. A request that re-derived either one, or let the
//     solver's own 280 / 52% / 0 / 3.5 defaults quietly stand in, returns a
//     confident wrong answer no other suite would catch. Every input below
//     therefore differs from every default the solver or the client carries.
//
//  2. SLOTS SHARE STATE. Two concurrent slots must each resolve with their
//     own results. A naive design with one shared client would have slot A's
//     edit terminate slot B's worker mid-solve and reject its promise — B's
//     panel would hang on "Solving…" forever, or worse, render A's numbers.
//
//  3. A STALE RESULT ARRIVES. A second solve() on the same slot rejects the
//     earlier promise with Error('cancelled'), and a late message from the
//     dead worker must NOT revive it — otherwise the UI's second edit renders
//     the first edit's numbers with no sign anything went wrong.
//
// What this suite does NOT cover: the real worker chunk, the onmessage wiring
// at the bottom of solver-worker.ts, and the UI that consumes these sessions
// (Task 6) are browser-only — covered by typecheck, biome check and a
// read-through.

import type { SlotInputs } from '../src/lib/compare.js'
import type { TrimSolveResult } from '../src/lib/hydrostatics.js'
import { SlotSolver } from '../src/lib/slot-solver.js'

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(38)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

// --- the fake worker: records what was posted, echoes on command ------------
//
// The same seam section 5 of the protocol suite uses, with one addition: on
// postMessage the fake schedules a reply itself, the way the real worker
// always does — one progress tick, then the result — tagged with the
// request's own target kilogram so a run can tell WHICH solve resolved it.
// No hydrostatics: this suite checks the wiring, not the numbers.

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
    const targetKg = (msg as { targetKg?: number }).targetKg
    setTimeout(() => {
      this.onmessage?.({
        data: { type: 'angle', index: 7, total: 30, angleDeg: -2.5, phase: 'coarse' },
      })
      // A stand-in result, cast through TrimSolveResult the way the protocol
      // suite's canned result is: this suite never reads its numbers.
      const result = { tag: `kg-${String(targetKg)}` } as unknown as TrimSolveResult
      this.onmessage?.({ data: { type: 'result', ok: true, result } })
    }, 0)
  }
  terminate(): void {
    this.terminated = true
  }
}

const realWorker = (globalThis as { Worker?: unknown }).Worker
;(globalThis as { Worker?: unknown }).Worker = FakeWorker

const lastInstance = () => FakeWorker.instances[FakeWorker.instances.length - 1]

/** What the promise settled to: the tag, the rejection message, or PENDING. */
const settled = async (p: Promise<unknown>): Promise<string> => {
  const state = { value: 'PENDING' }
  p.then(
    (v) => {
      state.value =
        v !== null && typeof v === 'object' && 'tag' in v
          ? String((v as { tag: unknown }).tag)
          : 'RESOLVED'
    },
    (e: unknown) => {
      state.value = e instanceof Error ? e.message : String(e)
    },
  )
  await new Promise((r) => setTimeout(r, 25))
  return state.value
}

type Progress = { done: number; total: number; angleDeg: number }
const tickRecorder = () => {
  const ticks: Progress[] = []
  return { ticks, onProgress: (p: Progress) => void ticks.push(p) }
}

/** Element-wise identity: no float formatting, no JSON round trip. */
const bitIdentical = (a: Float32Array, b: unknown): boolean => {
  if (!(b instanceof Float32Array) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const noProgress = () => {}

// Two distinct hulls and two distinct input sets. Every input differs from
// every default the solver carries (KG 280, LCG 52%, heel 0, ±3.5 trim), so
// a dropped or invented field fails the checks below instead of quietly
// agreeing with a fallback.
const positionsA = Float32Array.from({ length: 32 }, (_, i) => i)
const positionsB = Float32Array.from({ length: 32 }, (_, i) => 1000 + i)
const inputsA: SlotInputs = { weightKg: 75, lcgPctLwl: 47.3, kgMm: 312, heelDeg: -12.5 }
const inputsB: SlotInputs = { weightKg: 120, lcgPctLwl: 62.9, kgMm: 275, heelDeg: 8.25 }

/** Everything the client posted to one fake worker, as a request-shaped object. */
const postedRequest = (worker: FakeWorker) =>
  worker.posted[0] as
    | {
        targetKg?: number
        targetLcgPercentFromBow?: number
        kgMm?: number
        fixedHeelDeg?: number
        maxTrimDeg?: number
        trimStepDeg?: number
        positions?: unknown
      }
    | undefined

/**
 * The request each slot's worker received must be that slot's inputs, 1:1 — a
 * helper rather than nine copied blocks, so both slots are held to the same
 * mapping. `which` only names the slot in the labels.
 */
const expectMapping = (worker: FakeWorker, inputs: SlotInputs, which: 'A' | 'B') => {
  const req = postedRequest(worker)
  check(`${which}: the worker got one request`, req !== undefined, req ? 'one request' : 'nothing')
  if (!req) return
  check(
    `${which}: targetKg is the slot weight`,
    req.targetKg === inputs.weightKg,
    String(req.targetKg),
  )
  check(
    `${which}: targetLcgPercentFromBow is the slot LCG`,
    req.targetLcgPercentFromBow === inputs.lcgPctLwl,
    String(req.targetLcgPercentFromBow),
  )
  // Review Focus 1: KG is a height above the keel, never an absolute Z, so it
  // goes across verbatim — and the value is far from the 280 default, so a
  // dropped field cannot pass by matching the solver's fallback.
  check(
    `${which}: kgMm is the slot HEIGHT, verbatim`,
    req.kgMm === inputs.kgMm && req.kgMm !== 280,
    String(req.kgMm),
  )
  // Review Focus 3: heel goes across verbatim; 0 here would be the solver's
  // own default, so the value is non-zero and signed.
  check(
    `${which}: fixedHeelDeg is the slot heel, verbatim`,
    req.fixedHeelDeg === inputs.heelDeg && req.fixedHeelDeg !== 0,
    String(req.fixedHeelDeg),
  )
  // The app always asks for the documented ±4.5° / 0.1° sweep; the solver's
  // own fallback is ±3.5°, so a request that dropped these would search a
  // different ladder and land on a different trim.
  check(`${which}: maxTrimDeg is the app's 4.5`, req.maxTrimDeg === 4.5, String(req.maxTrimDeg))
  check(`${which}: trimStepDeg is the app's 0.1`, req.trimStepDeg === 0.1, String(req.trimStepDeg))
}

// --- 1. two slots, solved concurrently --------------------------------------
//
// Each slot owns its own SolverClient, so two SlotSolvers make two workers.
// The checks run while BOTH solves are in flight (both solves are issued
// synchronously before any reply is delivered), which is the only moment the
// isolation can be observed at all: if the slots shared a client, the second
// solve would cancel the first one's worker here.
console.log('=== 1. two slots resolve concurrently ===')

const slotA = new SlotSolver()
const slotB = new SlotSolver()
const tickA = tickRecorder()
const tickB = tickRecorder()
const runA = slotA.solve(positionsA, inputsA, tickA.onProgress)
const workerA = lastInstance()
const runB = slotB.solve(positionsB, inputsB, tickB.onProgress)
const workerB = lastInstance()
const stateA = settled(runA)
const stateB = settled(runB)

check(
  'two slots make two workers',
  workerA !== workerB && FakeWorker.instances.length === 2,
  `${FakeWorker.instances.length} worker(s)`,
)
check(
  'neither worker is cancelled by the other',
  !workerA.terminated && !workerB.terminated,
  `A ${String(workerA.terminated)}, B ${String(workerB.terminated)}`,
)
check('slot A resolves with its own result', (await stateA) === 'kg-75', await stateA)
check('slot B resolves with its own result', (await stateB) === 'kg-120', await stateB)
check(`A's worker is terminated after it resolves`, workerA.terminated, 'terminated')
check(`B's worker is terminated after it resolves`, workerB.terminated, 'terminated')
check(
  "progress reaches A's callback as done/total/angle",
  tickA.ticks.length === 1 &&
    tickA.ticks[0].done === 7 &&
    tickA.ticks[0].total === 30 &&
    tickA.ticks[0].angleDeg === -2.5,
  JSON.stringify(tickA.ticks),
)
check(
  "progress reaches B's callback as done/total/angle",
  tickB.ticks.length === 1 &&
    tickB.ticks[0].done === 7 &&
    tickB.ticks[0].total === 30 &&
    tickB.ticks[0].angleDeg === -2.5,
  JSON.stringify(tickB.ticks),
)

// --- 2. the request is the inputs, mapped 1:1 -------------------------------
//
// Both solves from section 1 are re-read for what they SENT, not just what
// they resolved to. Checking A against A's inputs and B against B's also
// proves no cross-slot leakage: a shared request object would show A's
// weight in B's worker.
console.log('=== 2. the request carries the slot inputs 1:1 ===')

expectMapping(workerA, inputsA, 'A')
expectMapping(workerB, inputsB, 'B')

const postedA = postedRequest(workerA)?.positions
const postedB = postedRequest(workerB)?.positions
check(
  "A's request carries A's positions, bit for bit",
  bitIdentical(positionsA, postedA),
  postedA instanceof Float32Array ? `a ${postedA.length}-float array` : 'not an array',
)
check(
  "B's request carries B's positions, bit for bit",
  bitIdentical(positionsB, postedB),
  postedB instanceof Float32Array ? `a ${postedB.length}-float array` : 'not an array',
)
// The client copies before it transfers: the caller's own array is still
// intact afterwards (transferring it would blank the viewer's mesh), so the
// posted array must be a distinct object holding the same bits.
check(
  'the posted array is a copy, not the caller own',
  postedA !== positionsA && postedB !== positionsB,
  'two distinct buffers',
)

// --- 3. cancel proxies to the client ----------------------------------------
//
// The interface promises cancel() as the slot's escape hatch: the UI's Cancel
// button and the tab teardown both call it, and a slot whose cancel is a
// no-op leaves a worker solving for a discarded mesh.
console.log('=== 3. cancel terminates the slot solve ===')

const slotC = new SlotSolver()
const runC = slotC.solve(positionsA, inputsA, noProgress)
const workerC = lastInstance()
slotC.cancel()
check('cancel rejects with Error(cancelled)', (await settled(runC)) === 'cancelled', 'rejected')
check('cancel terminates the worker', workerC.terminated, 'terminated')

// --- 4. a re-solve replaces, a stale message never revives ------------------
//
// Editing a slot's inputs and re-solving is the normal path (one call per
// input change, no cancel in between), and the section also isolates the two
// slots: A is re-solved while B is still in flight, and B must not care.
console.log('=== 4. a re-solve replaces the run; a stale result is dropped ===')

const slotD = new SlotSolver()
const slotE = new SlotSolver()
const inputsD2: SlotInputs = { weightKg: 82, lcgPctLwl: 50.1, kgMm: 260, heelDeg: 0 }
const runD1 = slotD.solve(positionsA, inputsA, noProgress)
const workerD1 = lastInstance()
const runE = slotE.solve(positionsB, inputsB, noProgress)
const workerE = lastInstance()
const stateD1 = settled(runD1)
const stateE = settled(runE)
const runD2 = slotD.solve(positionsA, inputsD2, noProgress)
const workerD2 = lastInstance()
const stateD2 = settled(runD2)
// Read in the synchronous window, before any auto-echo could fire: E's own
// retire would terminate its worker a moment later and the check would say
// nothing. What it pins is that D's EDIT did not do it — an edit that killed
// the other slot's worker would leave E hung here, and E would never resolve.
check('the edit does not touch the other slot worker', !workerE.terminated, 'still alive')
// The dead worker's late result: an actual message, delivered by hand, so the
// check is about the client's staleness guard and not about nothing arriving.
workerD1.onmessage?.({ data: { type: 'result', ok: true, result: { tag: 'stale' } } })

check(
  'a second solve rejects the first with cancelled',
  (await stateD1) === 'cancelled',
  await stateD1,
)
check(
  'a stale result never revives the cancelled run',
  (await stateD1) === 'cancelled',
  `still ${await stateD1}`,
)
check('the replacement resolves with its own result', (await stateD2) === 'kg-82', await stateD2)
const reqD2 = postedRequest(workerD2)
check('the replacement carries the edited inputs', reqD2?.kgMm === 260, String(reqD2?.kgMm))
check('the replaced worker is terminated', workerD1.terminated, 'terminated')
check('the other slot resolves with its own result', (await stateE) === 'kg-120', await stateE)

;(globalThis as { Worker?: unknown }).Worker = realWorker

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the slot solve session or its request mapping is wrong')
  process.exit(1)
}
console.log('ALL SLOT-SOLVER CHECKS PASSED')
