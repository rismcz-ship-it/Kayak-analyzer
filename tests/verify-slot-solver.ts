// Task 4 gate, Compare half: one slot = one solve session.
//
// verify-worker-protocol.ts already pins the worker itself — no mutation of
// the request buffer, contiguous progress, parity with a direct solve, the
// error mapping and the client's lifecycle. What is left is the Compare seam
// on top: a SlotSolver that owns exactly one SolverClient per slot (so two
// slots never share a worker) and maps one SlotInputs into one SolveRequest.
//
// Four failure classes are pinned here, all silent without a suite:
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
//     dead worker must NOT revive it — neither the result (the UI would render
//     the first edit's numbers) nor a further progress tick (a progress bar
//     moving for a superseded solve). Sections 3-4.
//
//  4. THE REQUEST GROWS. SlotInputs is user-entered form data in the Compare
//     UI (Task 6); the mapping decides the posted request's KEY SET, so a
//     spread of the caller's inputs would ride a planted __proto__ or getter
//     straight into the worker message. Section 6.
//
// What this suite does NOT cover: the real worker chunk, the onmessage wiring
// at the bottom of solver-worker.ts, and the UI that consumes these sessions
// (Task 6) are browser-only — covered by typecheck, biome check and a
// read-through.

import type { SlotInputs } from '../src/lib/compare.js'
import type { TrimSolveResult } from '../src/lib/hydrostatics.js'
import { SlotSolver } from '../src/lib/slot-solver.js'
import { MAX_TRIM_DEG, TRIM_STEP_DEG } from '../src/lib/solve-params.js'

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
// always does — one progress tick, then the result — with BOTH derived from
// the request's own target kilogram, so a run can tell WHICH solve delivered
// WHICH message. No hydrostatics: this suite checks the wiring, not the
// numbers.

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
    const targetKg = (msg as { targetKg?: number }).targetKg ?? 0
    // The tick is derived from the request, never a fixed payload: two slots
    // echoing identical numbers would make a crossed progress callback
    // invisible — A's ticks and B's would be indistinguishable, so a wiring
    // swap in solve() would pass section 1 unchecked.
    const tick = {
      type: 'angle',
      index: (targetKg % 7) + 1,
      total: 30,
      angleDeg: -targetKg / 10,
      phase: 'coarse',
    }
    setTimeout(() => {
      this.onmessage?.({ data: tick })
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

/** Everything a run's promise ever delivered, and how it settled. */
type Settlement = { what: string; isError: boolean; values: unknown[] }

/**
 * Watch a promise without consuming it. `values` records EVERY delivery, so
 * "the stale result was never delivered" is an observed fact rather than a
 * re-read: a promise settles once, so re-reading a settled promise cannot
 * tell "dropped by the staleness guard" from "accepted and ignored because
 * the promise had already settled" — the reviewer proved that with a bare
 * resolve-after-reject, and it is the difference between pinning a guard and
 * pinning Promise semantics.
 */
const settlement = (p: Promise<unknown>): Settlement => {
  const out: Settlement = { what: 'PENDING', isError: false, values: [] }
  p.then(
    (v) => {
      out.what =
        v !== null && typeof v === 'object' && 'tag' in v
          ? String((v as { tag: unknown }).tag)
          : 'RESOLVED'
      out.values.push(v)
    },
    (e: unknown) => {
      out.what = e instanceof Error ? e.message : String(e)
      out.isError = e instanceof Error
      out.values.push(e)
    },
  )
  return out
}

/**
 * Wait for the real settlement — a watchdog ceiling rather than a fixed sleep,
 * so a slow box cannot read 'PENDING' as a failure. The settlement flag flips
 * from the handler above; this only waits for it.
 */
const settled = async (s: Settlement): Promise<string> => {
  const deadline = Date.now() + 2000
  while (s.what === 'PENDING' && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1))
  }
  return s.what
}

/**
 * The plan names Error('cancelled'); a bare string rejection passes a
 * message check (String('cancelled') === 'cancelled'), so the type is
 * asserted too.
 */
const expectCancelled = async (s: Settlement): Promise<boolean> =>
  (await settled(s)) === 'cancelled' && s.isError

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
 * helper rather than nine copied blocks, so every slot is held to the same
 * mapping. `which` only names the slot in the labels. `strict` adds the
 * "differs from every solver default" guard, which only holds for inputs
 * that really do differ (a deliberately upright 0° heel slot is checked with
 * strict === false — the equality itself still fails for an absent field,
 * because undefined !== 0).
 */
const expectMapping = (worker: FakeWorker, inputs: SlotInputs, which: string, strict = true) => {
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
    strict ? req.kgMm === inputs.kgMm && req.kgMm !== 280 : req.kgMm === inputs.kgMm,
    String(req.kgMm),
  )
  // Review Focus 3: heel goes across verbatim; 0 here would be the solver's
  // own default, so the value is non-zero and signed.
  check(
    `${which}: fixedHeelDeg is the slot heel, verbatim`,
    strict
      ? req.fixedHeelDeg === inputs.heelDeg && req.fixedHeelDeg !== 0
      : req.fixedHeelDeg === inputs.heelDeg,
    String(req.fixedHeelDeg),
  )
  // The app always asks for the documented ±4.5° / 0.1° sweep; the solver's
  // own fallback is ±3.5°, so a request that dropped these would search a
  // different ladder and land on a different trim.
  // Through the SHARED constants, not a second copy of the numbers: comparing
  // against the imported values is what makes this check follow the parameter
  // table instead of pinning literals a future edit would silently skip.
  check(
    `${which}: maxTrimDeg is the shared MAX_TRIM_DEG`,
    req.maxTrimDeg === MAX_TRIM_DEG,
    String(req.maxTrimDeg),
  )
  check(
    `${which}: trimStepDeg is the shared TRIM_STEP_DEG`,
    req.trimStepDeg === TRIM_STEP_DEG,
    String(req.trimStepDeg),
  )
}

// --- the shared sweep parameters --------------------------------------------
//
// The app always asks for the documented sweep, through src/lib/solve-params.ts.
// The solver's own inline fallback is the narrower +3.5, so the shared values
// are checked to be the wider documented ones - and slot-solver.ts is checked
// to forward the imported constants rather than restate them (F8's finding:
// App.tsx and slot-solver.ts each carried their own literal copy of 4.5/0.1,
// and nothing tied them together).

console.log('=== the shared sweep parameters ===')

check('MAX_TRIM_DEG is 4.5', MAX_TRIM_DEG === 4.5, String(MAX_TRIM_DEG))
check('TRIM_STEP_DEG is 0.1', TRIM_STEP_DEG === 0.1, String(TRIM_STEP_DEG))
check(
  'MAX_TRIM_DEG is wider than the solver inline fallback',
  MAX_TRIM_DEG > 3.5,
  `4.5 against 3.5 (${String(MAX_TRIM_DEG)})`,
)

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
const stateA = settlement(runA)
const stateB = settlement(runB)

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
check(
  'slot A resolves with its own result',
  (await settled(stateA)) === 'kg-75',
  await settled(stateA),
)
check(
  'slot B resolves with its own result',
  (await settled(stateB)) === 'kg-120',
  await settled(stateB),
)
// The next two are CLIENT-level regression guards, not module properties: the
// protocol suite already pins them for SolverClient. They are restated here
// because a slot request that leaked a worker would read as a Compare bug,
// not as the client bug it is.
check(`A's worker is terminated after it resolves`, workerA.terminated, 'terminated')
check(`B's worker is terminated after it resolves`, workerB.terminated, 'terminated')
// The ticks are request-derived (75kg -> index 6 at -7.5°, 120kg -> index 2
// at -12°), so a crossed progress callback shows up as the WRONG numbers
// rather than passing because both slots happened to tick alike.
check(
  "progress reaches A's callback as A's own tick",
  tickA.ticks.length === 1 &&
    tickA.ticks[0].done === 6 &&
    tickA.ticks[0].total === 30 &&
    tickA.ticks[0].angleDeg === -7.5,
  JSON.stringify(tickA.ticks),
)
check(
  "progress reaches B's callback as B's own tick",
  tickB.ticks.length === 1 &&
    tickB.ticks[0].done === 2 &&
    tickB.ticks[0].total === 30 &&
    tickB.ticks[0].angleDeg === -12,
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
// posted array must be a distinct object holding the same bits. Client-level
// guard, restated from the protocol suite: a slot request that detached the
// viewer's buffer would read as a mesh bug, not a solver bug.
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
const stateC = settlement(runC)
const workerC = lastInstance()
slotC.cancel()
check('cancel rejects with Error(cancelled)', await expectCancelled(stateC), await settled(stateC))
check('cancel terminates the worker', workerC.terminated, 'terminated')

// --- 4. a re-solve replaces, a stale message never revives ------------------
//
// Editing a slot's inputs and re-solving is the normal path (one call per
// input change, no cancel in between), and the section also isolates the two
// slots: D is re-solved while E is still in flight, and E must not care.
console.log('=== 4. a re-solve replaces the run; a stale message is dropped ===')

const slotD = new SlotSolver()
const slotE = new SlotSolver()
// The edited slot, held against the same mapping as section 2: kgMm 260 and
// LCG 50.1 differ from every default, and heelDeg 0 is a CHOSEN upright slot
// — 0 also happens to be the solver's default, so the equality check must
// fail for an ABSENT field (undefined !== 0) rather than lean on a
// "differs from the default" guard.
const inputsD2: SlotInputs = { weightKg: 82, lcgPctLwl: 50.1, kgMm: 260, heelDeg: 0 }
// D1 gets a tick recorder: the only observable side effect of a stale DELIVERY
// is its progress callback, because a promise settles once and an accepted
// stale result would leave no trace on it.
const tickD1 = tickRecorder()
const runD1 = slotD.solve(positionsA, inputsA, tickD1.onProgress)
const workerD1 = lastInstance()
const runE = slotE.solve(positionsB, inputsB, noProgress)
const workerE = lastInstance()
const stateD1 = settlement(runD1)
const stateE = settlement(runE)
const runD2 = slotD.solve(positionsA, inputsD2, noProgress)
const workerD2 = lastInstance()
const stateD2 = settlement(runD2)
// Read in the synchronous window, before any auto-echo could fire: E's own
// retire would terminate its worker a moment later and the check would say
// nothing. What it pins is that D's EDIT did not do it — an edit that killed
// the other slot's worker would leave E hung here, and E would never resolve.
check('the edit does not touch the other slot worker', !workerE.terminated, 'still alive')
// The dead worker's late messages, delivered BY HAND: a progress tick and a
// result. Either one reaching the caller is the UI moving a progress bar for
// a superseded solve, or rendering the first edit's numbers.
workerD1.onmessage?.({
  data: { type: 'angle', index: 3, total: 30, angleDeg: 1, phase: 'coarse' },
})
workerD1.onmessage?.({ data: { type: 'result', ok: true, result: { tag: 'stale' } } })

check(
  'a second solve rejects the first with cancelled',
  await expectCancelled(stateD1),
  await settled(stateD1),
)
check(
  'a stale tick never reaches the cancelled run',
  tickD1.ticks.length === 0,
  JSON.stringify(tickD1.ticks),
)
// The observable version of "the stale result is never delivered": the
// settlement's values array holds everything the promise's handlers ever
// received, so an accepted stale result lands here as a 'stale' tag. With the
// client's staleness guard removed this check fails; with it, it passes.
check(
  'a stale result is never delivered',
  stateD1.values.every((v) => v !== 'stale' && (v as { tag?: unknown }).tag !== 'stale'),
  `${String(stateD1.values.length)} value(s) delivered`,
)
check(
  'the replacement resolves with its own result',
  (await settled(stateD2)) === 'kg-82',
  await settled(stateD2),
)
// The replacement's inputs go through the same 1:1 helper, so an edit path
// that dropped the LCG or substituted the default heel cannot pass on the
// one field the old check happened to sample.
expectMapping(workerD2, inputsD2, 'the replacement', false)
check('the replaced worker is terminated', workerD1.terminated, 'terminated')
check(
  'the other slot resolves with its own result',
  (await settled(stateE)) === 'kg-120',
  await settled(stateE),
)

// --- 5. cancel is per-slot, and an idle slot cancels nothing -----------------
//
// Section 4 pins that a re-solve leaves the other slot alone; this pins the
// same for the Compare UI's explicit Cancel button — cancelling H while G is
// mid-solve must not touch G. cancel() on a slot with nothing in flight is
// the tab-teardown path: it must be a quiet no-op, not a throw, because the
// UI fires it on unmount whether or not a solve was running.
console.log('=== 5. cancel is per-slot and safe when idle ===')

const slotG = new SlotSolver()
const slotH = new SlotSolver()
const runG = slotG.solve(positionsB, inputsB, noProgress)
const workerG = lastInstance()
const runH = slotH.solve(positionsA, inputsA, noProgress)
const workerH = lastInstance()
const stateG = settlement(runG)
const stateH = settlement(runH)
slotH.cancel()
// Both isolation reads happen in the synchronous window, before either slot's
// auto-echo could fire: G's own retire terminates its worker a moment later,
// so a late read would see H's cancel as guilty of a terminate it never did.
const hLeftGAlone = !workerG.terminated
const hTerminatedH = workerH.terminated
check(
  'cancelling H rejects H with Error(cancelled)',
  await expectCancelled(stateH),
  await settled(stateH),
)
check("cancelling H terminates H's own worker", hTerminatedH, 'terminated')
check("cancelling H leaves G's worker alive", hLeftGAlone, 'still alive')
check(
  'G still resolves with its own result',
  (await settled(stateG)) === 'kg-120',
  await settled(stateG),
)

const workersBefore = FakeWorker.instances.length
const slotI = new SlotSolver()
let quietCancelThrew = false
try {
  slotI.cancel()
} catch {
  quietCancelThrew = true
}
check('cancel on an idle slot does not throw', !quietCancelThrew, 'no throw')
check(
  'cancel on an idle slot starts no worker',
  FakeWorker.instances.length === workersBefore,
  `${String(FakeWorker.instances.length - workersBefore)} worker(s)`,
)

// --- 6. the request shape is fixed; hostile inputs cannot widen it -----------
//
// SlotInputs is user-entered form data in the Compare UI (Task 6); this module
// does not parse it, so the mapping decides the posted request's KEY SET. If a
// future change spread the caller's inputs into the request, a planted own
// property — the __proto__ an import file could carry, or a getter-bearing
// field — would ride straight into the worker message. The house style asks
// for a planted case wherever untrusted data can reach a module; this is it.
console.log('=== 6. the posted request keeps exactly seven keys ===')

/** The SolveRequest key set, sorted: what every slot must post. */
const REQUEST_KEYS = [
  'fixedHeelDeg',
  'kgMm',
  'maxTrimDeg',
  'positions',
  'targetKg',
  'targetLcgPercentFromBow',
  'trimStepDeg',
].sort()
const keysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((k, i) => k === b[i])

// The inputs are planted the way a saved-run import would carry them: an own
// enumerable __proto__ (which a spread copies as a data property) and a
// getter-bearing extra field.
const hostile = {
  weightKg: 90,
  lcgPctLwl: 55,
  kgMm: 300,
  heelDeg: 5,
} as unknown as SlotInputs
Object.defineProperty(hostile, '__proto__', { value: { polluted: true }, enumerable: true })
Object.defineProperty(hostile, 'getter', { get: () => 42, enumerable: true })
const slotJ = new SlotSolver()
const runJ = slotJ.solve(positionsA, hostile, noProgress)
const stateJ = settlement(runJ)
const workerJ = lastInstance()
const reqJ = postedRequest(workerJ)

check(
  'an earlier request has exactly the seven keys',
  keysEqual(Object.keys(postedRequest(workerA) ?? {}).sort(), REQUEST_KEYS),
  Object.keys(postedRequest(workerA) ?? {})
    .sort()
    .join(','),
)
check(
  'the hostile solve still resolves',
  (await settled(stateJ)) === 'kg-90',
  await settled(stateJ),
)
check(
  'the hostile request has exactly the seven keys',
  reqJ !== undefined && keysEqual(Object.keys(reqJ).sort(), REQUEST_KEYS),
  reqJ ? Object.keys(reqJ).sort().join(',') : 'nothing',
)
check(
  'no __proto__ rides into the request',
  reqJ !== undefined && !Object.hasOwn(reqJ, '__proto__'),
  reqJ ? String(Object.hasOwn(reqJ, '__proto__')) : 'nothing',
)
check(
  'no extra field rides into the request',
  reqJ !== undefined && !Object.hasOwn(reqJ, 'getter'),
  reqJ ? String(Object.hasOwn(reqJ, 'getter')) : 'nothing',
)
check(
  'the hostile inputs are still mapped verbatim',
  reqJ?.kgMm === 300 && reqJ?.targetKg === 90 && reqJ?.fixedHeelDeg === 5,
  `kg ${String(reqJ?.kgMm)}, w ${String(reqJ?.targetKg)}, heel ${String(reqJ?.fixedHeelDeg)}`,
)

;(globalThis as { Worker?: unknown }).Worker = realWorker

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the slot solve session or its request mapping is wrong')
  process.exit(1)
}
console.log('ALL SLOT-SOLVER CHECKS PASSED')
