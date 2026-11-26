// Task 2 gate — the Compare roster: record shape, persistence round trip,
// hostile storage, the creation gate, snapshot immunity and the
// conditions-diff.
//
// Why this suite exists: the roster is the only part of Compare that outlives
// the session, and it is re-read from localStorage — a string any user, any
// older app version or any bug can have written. Three failure classes are
// pinned here, all able to break the Compare tab silently:
//
//  1. A MALFORMED OR STALE ROSTER MUST DEGRADE, NEVER CRASH. Absent key,
//     non-JSON, a JSON non-array, entries with wrong-typed, missing or
//     non-finite fields, and a reader that throws (private mode) must all
//     yield [] or a filtered roster with the valid siblings kept — the tab
//     renders, minus the junk. `readStoredInputs` established exactly this
//     contract for the home inputs; the roster keeps it.
//
//  2. THE ROUND TRIP MUST BE LOSSLESS. The spec promises a restored record
//     feeds the whole comparison table and delta column with no blank rows —
//     so `encodeRoster` → `readRoster` must return the records deep-equal,
//     `gzCurve` arrays included, or a reload would blank the stability rows.
//
//  3. A RECORD IS AN IMMUTABLE SNAPSHOT TAKEN AT CREATION. The creation gate
//     refuses inputs the form rejects (so a record storage would silently
//     drop can never exist in memory) and a hash-less record (which could
//     never be re-picked against its STL); the stored result is a defensive
//     copy of the caller's (so a later edit of what was passed in cannot
//     rewrite a saved record another slot may be showing); and the snapshot
//     is frozen, so an accidental in-place write throws rather than
//     rewriting it. `readRoster` freezes what it restores for the same
//     reason: a restored record is the one a slot shows after a reload, and
//     it used to be the only mutable copy in the app.
//
//  4. A LONG-LIVED ROSTER MUST STAY BOUNDED, AND A FAILED WRITE MUST NOT LIE.
//     Every home solve auto-adds a record, so growth is capped at
//     `ROSTER_LIMIT` (newest kept). When a write is refused, `rosterWriteRisk`
//     reports what was actually at risk from the ID SETS: a restored roster
//     that cannot be re-written lost nothing, while a new record or a refused
//     deletion did.
//
// Validation shares ONE gate with the form: a record's inputs are judged by
// the same `*Usable` predicates `verify-inputs.ts` drives, so a stored value
// the form rejects cannot enter the roster through the back door.
//
// One comparator note: `JSON.stringify` collapses NaN and null to the same
// text, so a sameJson-style equality cannot tell a non-finite field from a
// null one — it would pass exactly the check that must fail. The deepEqual
// below treats NaN as a value distinct from null.
//
// What this suite does NOT cover: the React wiring (roster state in the tab,
// the delete affordance, the auto-add after a home solve) is JSX, covered by
// typecheck, `biome check` and a read-through.
//
// Run: npm.cmd exec -- tsx tests/verify-compare-roster.ts

import {
  addRosterRecord,
  COMPARE_STORAGE_KEY,
  canonicalRecord,
  conditionsDiffer,
  deleteRecord,
  encodeRoster,
  ROSTER_LIMIT,
  type RunRecord,
  readRoster,
  recordFingerprint,
  recordFromSolve,
  rosterWriteRisk,
  type SlotInputs,
  writeRoster,
} from '../src/lib/compare.js'
import type { TrimSolveResult } from '../src/lib/hydrostatics.js'
import type { StorageReader, StorageWriter } from '../src/lib/inputs.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Deep equality that knows NaN is a value, not null. JSON.stringify collapses
 * both to `null`, so a text comparison calls `{ heelDeg: NaN }` equal to
 * `{ heelDeg: null }` and passes a check that must fail; plain `===` fails on
 * structures that legitimately contain NaN. NaN equals itself here, and
 * nothing else does.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b) ? true : a === b
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  return (
    aKeys.length === Object.keys(bObj).length &&
    aKeys.every((key) => Object.hasOwn(bObj, key) && deepEqual(aObj[key], bObj[key]))
  )
}

// --- a complete, table-rendering result -------------------------------------
// Every numeric field the table and the delta column need, built by hand so
// the suite runs without a solve. The required set is the module's contract;
// this sample satisfies all of it.

const sampleInputs: SlotInputs = { weightKg: 75, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }

const sampleResult: TrimSolveResult = {
  trimDeg: 3.6,
  draftMm: 127.94,
  waterlineZ: -34.57,
  displacedVolumeMm3: 74_967_000,
  displacementKg: 74.97,
  targetKg: 75,
  lcb: { x: -59.95, y: 0.1, z: -74.63 },
  lcg: { x: -61.62, y: 0, z: 97.47 },
  pivot: { x: 0, y: 0, z: 97.47 },
  lcbLcgOffsetMm: 1.678,
  waterplaneAreaMm2: 1_035_900,
  planesEvaluated: 991,
  converged: true,
  Cb: 0.4611,
  LWL: 2211.8,
  BWL: 612.9,
  midshipAreaMm2: 74_900,
  Cp: 0.5454,
  Cm: 0.8467,
  KB: 75.9,
  BM: 311,
  KM: 386.9,
  GM: 106.9,
  gzCurve: [
    { heelDeg: 0, GZ: 0 },
    { heelDeg: 5, GZ: 8.9 },
    { heelDeg: 10, GZ: 16.2 },
    { heelDeg: 45, GZ: -9.6 },
  ],
  bowFreeboardMm: 222.2,
  sternFreeboardMm: 22.3,
  heelDeg: 0,
  kgMm: 280,
  waterplaneLoopCount: 1,
  Cwp: 0.7641,
  wettedSurfaceAreaMm2: 1_214_300,
  waterplaneCentroidX: -106.8,
  waterplaneIyyMm4: 3.1431e11,
  tpcTonnesPerCm: 0.01036,
  endTipImmersionDeg: null,
}

function storage(payloads: Record<string, string | null>): StorageReader {
  return (key) => (key in payloads ? payloads[key] : null)
}

// --- 1. recordFromSolve ------------------------------------------------------

console.log('\n=== recordFromSolve ===')

const built = recordFromSolve('Test hull', 'a'.repeat(64), sampleInputs, sampleResult)
check(built.id.startsWith('rec_'), 'the id carries the rec_ prefix', built.id)
check(typeof built.id === 'string' && built.id.length > 4, 'the id is a real id', built.id)
check(built.name === 'Test hull', 'the name is stored verbatim')
check(built.modelHash === 'a'.repeat(64), 'the model hash is stored verbatim')
check(deepEqual(built.inputs, sampleInputs), 'the inputs are stored as given')
check(built.inputs !== sampleInputs, 'the stored inputs are a copy, not the caller object')
check(deepEqual(built.result, sampleResult), 'the stored result is deep-equal to the solve result')
check(built.result !== sampleResult, 'the stored result is a defensive copy, not the caller object')
check(
  Math.abs(built.savedAt - Date.now()) < 5000,
  'savedAt is now',
  `off by ${Date.now() - built.savedAt} ms`,
)

const built2 = recordFromSolve('Another', 'b'.repeat(64), sampleInputs, sampleResult)
check(
  built2.id !== built.id,
  'two records in one run get different ids',
  `${built.id} vs ${built2.id}`,
)

// --- 2. the round trip -------------------------------------------------------

console.log('\n=== encode → read round trip ===')

const written = encodeRoster([built, built2])
check(typeof written === 'string' && written.length > 0, 'encodeRoster serializes')
check(written.includes('"gzCurve"'), 'the gzCurve array is serialized with the record')

const back = readRoster(storage({ [COMPARE_STORAGE_KEY]: written }))
check(back.length === 2, 'both records survive the round trip', `got ${back.length}`)
check(deepEqual(back[0], built), 'the first record is deep-equal after the round trip')
check(back[1].result.gzCurve !== undefined, 'the gzCurve survives')
check(
  deepEqual(back[0].result.gzCurve, sampleResult.gzCurve),
  'the gzCurve is deep-equal after the round trip',
  JSON.stringify(back[0].result.gzCurve),
)
check(deepEqual(back, [built, built2]), 'the whole roster is deep-equal after the round trip')

// An empty roster round-trips to [] rather than null or a throw.
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: '[]' })), []),
  'an empty array reads back as []',
)

// writeRoster is the injected MIRROR of readRoster: the caller owns the
// storage global (Task 7's auto-add after a home solve), so the pair can be
// driven without one - and a browser whose storage throws on access throws
// inside this module, not inside an unrelated render path.
const store: Record<string, string> = {}
const writeTo: StorageWriter = (key, value) => {
  store[key] = value
}
writeRoster([built, built2], writeTo)
check(
  Object.hasOwn(store, COMPARE_STORAGE_KEY),
  'writeRoster writes the compare key',
  Object.keys(store).join(', '),
)
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: store[COMPARE_STORAGE_KEY] })), [
    built,
    built2,
  ]),
  'writeRoster feeds readRoster a lossless round trip',
)
writeRoster([], writeTo)
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: store[COMPARE_STORAGE_KEY] })), []),
  'an empty roster written by writeRoster reads back as []',
)
let writerThrowEscaped = false
try {
  writeRoster([built], () => {
    throw new Error('storage is disabled (private mode)')
  })
} catch {
  writerThrowEscaped = true
}
check(writerThrowEscaped, 'a throwing writer propagates to its caller', 'no throw')

// --- 3. hostile storage ------------------------------------------------------

console.log('\n=== hostile storage ===')

check(deepEqual(readRoster(storage({})), []), 'an absent key yields []')
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: null })), []),
  'a null payload yields []',
)
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: '{not json' })), []),
  'malformed JSON yields []',
)
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: '42' })), []),
  'a JSON primitive yields []',
)
check(
  deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: '{"records": []}' })), []),
  'a JSON object yields []',
)
check(deepEqual(readRoster(storage({ [COMPARE_STORAGE_KEY]: 'null' })), []), 'JSON null yields []')

const storageThrows: StorageReader = () => {
  throw new Error('storage is disabled (private mode)')
}
let escaped = false
try {
  readRoster(storageThrows)
} catch {
  escaped = true
}
check(!escaped, 'a throwing reader does not escape readRoster')
check(deepEqual(readRoster(storageThrows), []), 'a throwing reader yields []')

// --- 4. entry validation filters, keeps siblings -----------------------------

console.log('\n=== entry validation ===')

function entry(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(built as unknown as Record<string, unknown>), ...patch }
}

// A valid sibling must survive each mutation below.
const valid = entry({ id: 'rec_valid' })

function rosterWith(...entries: Array<Record<string, unknown>>): RunRecord[] {
  return readRoster(storage({ [COMPARE_STORAGE_KEY]: JSON.stringify(entries) }))
}

check(
  deepEqual(
    rosterWith(valid).map((r) => r.id),
    ['rec_valid'],
  ),
  'a hand-written valid entry passes',
  JSON.stringify(rosterWith(valid).map((r) => r.id)),
)

const badEntries: Array<[string, Record<string, unknown>]> = [
  ['a missing id', entry({ id: undefined })],
  ['a non-string id', entry({ id: 7 })],
  ['a missing name', entry({ name: undefined })],
  ['a missing modelHash', entry({ modelHash: undefined })],
  ['an empty modelHash', entry({ modelHash: '' })],
  // One definition of a hash, at the storage door too: 'abc' is not 64
  // lowercase hex characters, so it could never match the STL it claims.
  ['a modelHash that is not a SHA-256 hash', entry({ modelHash: 'abc' })],
  ['a missing result', entry({ result: undefined })],
  ['a non-object result', entry({ result: 5 })],
  ['a result missing gzCurve', entry({ result: { ...sampleResult, gzCurve: undefined } })],
  ['a gzCurve that is not an array', entry({ result: { ...sampleResult, gzCurve: {} } })],
  ['a gzCurve with a null element', entry({ result: { ...sampleResult, gzCurve: [null] } })],
  ['a gzCurve with an empty-object element', entry({ result: { ...sampleResult, gzCurve: [{}] } })],
  ['a gzCurve with a numeric element', entry({ result: { ...sampleResult, gzCurve: [42] } })],
  ['a gzCurve with a string element', entry({ result: { ...sampleResult, gzCurve: ['x'] } })],
  [
    'a gzCurve element missing GZ',
    entry({ result: { ...sampleResult, gzCurve: [{ heelDeg: 5 }] } }),
  ],
  [
    'a gzCurve element with a NaN',
    entry({ result: { ...sampleResult, gzCurve: [{ heelDeg: NaN, GZ: 0 }] } }),
  ],
  [
    'a result missing a required number',
    entry({ result: { ...sampleResult, draftMm: undefined } }),
  ],
  [
    'a result with a wrong-typed required number',
    entry({ result: { ...sampleResult, draftMm: '127.94' } }),
  ],
  ['a result with a NaN required number', entry({ result: { ...sampleResult, draftMm: NaN } })],
  // The WHOLE result is validated, not a projection of it: a record missing
  // any field a real solve emits is filtered rather than restored half-alive
  // (F3's finding - the old subset check let displacementKg, the pivot and
  // the sweep verdict through, and every consumer reading one then saw
  // undefined off a "restored" record).
  [
    'a result missing displacementKg',
    entry({ result: { ...sampleResult, displacementKg: undefined } }),
  ],
  ['a result missing targetKg', entry({ result: { ...sampleResult, targetKg: undefined } })],
  [
    'a result missing lcbLcgOffsetMm',
    entry({ result: { ...sampleResult, lcbLcgOffsetMm: undefined } }),
  ],
  [
    'a result missing planesEvaluated',
    entry({ result: { ...sampleResult, planesEvaluated: undefined } }),
  ],
  ['a result missing the pivot', entry({ result: { ...sampleResult, pivot: undefined } })],
  ['a missing converged flag', entry({ result: { ...sampleResult, converged: undefined } })],
  // A real boolean, not truthiness: the text 'true' and the number 1 are
  // documents that mean yes from a producer that did not write a boolean.
  ['a text converged flag', entry({ result: { ...sampleResult, converged: 'true' } })],
  ['a numeric converged flag', entry({ result: { ...sampleResult, converged: 1 } })],
  // The one NULLABLE number: a hull whose ends immerse at some heel carries
  // an angle, one that never immerses carries null - and text or undefined is
  // neither.
  ['a text endTipImmersionDeg', entry({ result: { ...sampleResult, endTipImmersionDeg: 'null' } })],
  [
    'a missing endTipImmersionDeg',
    entry({ result: { ...sampleResult, endTipImmersionDeg: undefined } }),
  ],
  // The curve is sampled in ASCENDING heel order - gzMarks' peak scan walks
  // forward and its vanishing-stability angle interpolates between
  // neighbours, so a shuffled curve breaks both (F5).
  [
    'a gzCurve out of ascending heel order',
    entry({
      result: {
        ...sampleResult,
        gzCurve: [
          { heelDeg: 5, GZ: 8.9 },
          { heelDeg: 0, GZ: 0 },
        ],
      },
    }),
  ],
  ['an lcb missing its z', entry({ result: { ...sampleResult, lcb: { x: -59.95, y: 0.1 } } })],
  ['a wrong-typed lcb', entry({ result: { ...sampleResult, lcb: 'centre' } })],
  ['a missing inputs', entry({ inputs: undefined })],
  ['inputs with a wrong type', entry({ inputs: { ...sampleInputs, weightKg: '75' } })],
  ['inputs with a null field', entry({ inputs: { ...sampleInputs, weightKg: null } })],
  ['inputs out of range', entry({ inputs: { ...sampleInputs, kgMm: 0 } })],
  ['a missing savedAt', entry({ savedAt: undefined })],
]
for (const [label, bad] of badEntries) {
  const kept = rosterWith(bad, valid).map((r) => r.id)
  check(
    deepEqual(kept, ['rec_valid']),
    `${label} is filtered out, the valid sibling survives`,
    JSON.stringify(kept),
  )
}

// The gate is not over-tight in the other direction either: the one nullable
// number in the result is null for a hull whose ends never immerse, and that
// record must be KEPT - `endTipImmersionDeg: null` is the normal case, not a
// defect the validator should filter.
check(
  rosterWith(entry({ id: 'rec_never_immerses' })).length === 1,
  'a null endTipImmersionDeg (ends never immerse) is kept',
  JSON.stringify(rosterWith(entry({ id: 'rec_never_immerses' })).length),
)

// --- 5. the shared bounds gate, at both doors ---------------------------------

console.log('\n=== the bounds gate ===')

// The form's own bounds, checked at BOTH doors: a stored record carrying one
// is filtered, and a fresh one cannot even be built — the creation gate the
// back door would otherwise leave open.
const boundsLadder: Array<[string, string, Partial<SlotInputs>]> = [
  ['a 19 kg weight', 'weightKg', { weightKg: 19 }],
  ['a 101 % LCG', 'lcgPctLwl', { lcgPctLwl: 101 }],
  ['a 31 degree heel', 'heelDeg', { heelDeg: 31 }],
  ['a 1001 mm KG', 'kgMm', { kgMm: 1001 }],
]
for (const [label, field, patch] of boundsLadder) {
  const kept = rosterWith(
    entry({ id: 'rec_bound', inputs: { ...sampleInputs, ...patch } }),
    valid,
  ).map((r) => r.id)
  check(
    deepEqual(kept, ['rec_valid']),
    `${label} is filtered out of a stored roster`,
    JSON.stringify(kept),
  )
  let message = ''
  try {
    recordFromSolve('bound', 'a'.repeat(64), { ...sampleInputs, ...patch }, sampleResult)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  check(message !== '', `${label} is refused by recordFromSolve`, 'no throw')
  check(message.includes(field), `${label} names the field it refused`, message)
}

// And the in-range edges still build and restore: the gate is not over-tight.
const edgeInputs: SlotInputs = { weightKg: 20, lcgPctLwl: 100, kgMm: 1000, heelDeg: 30 }
const edgeRecord = recordFromSolve('Edges', 'c'.repeat(64), edgeInputs, sampleResult)
check(
  readRoster(storage({ [COMPARE_STORAGE_KEY]: encodeRoster([edgeRecord]) })).length === 1,
  'the in-range edges (20 kg, 100 %, 1000 mm, 30 degrees) build and restore',
)

// A record with no hash can never be re-picked against its STL, so creation
// refuses it too.
let hashMessage = ''
try {
  recordFromSolve('No hash', '', sampleInputs, sampleResult)
} catch (error) {
  hashMessage = error instanceof Error ? error.message : String(error)
}
check(hashMessage !== '', 'an empty modelHash is refused by recordFromSolve', 'no throw')
check(hashMessage.includes('modelHash'), 'the refusal names modelHash', hashMessage)

// One definition of a hash, held at the CREATION door (not just storage):
// 'abc' is not 64 lowercase hex characters, so a hash no re-pick could ever
// match is refused here too, and the refusal says so.
let badHashMessage = ''
try {
  recordFromSolve('Bad hash', 'abc', sampleInputs, sampleResult)
} catch (error) {
  badHashMessage = error instanceof Error ? error.message : String(error)
}
check(badHashMessage !== '', 'a malformed modelHash is refused by recordFromSolve', 'no throw')
check(/hex|SHA-256/i.test(badHashMessage), 'the refusal names the hash rule', badHashMessage)

// --- 6. snapshot immunity -----------------------------------------------------

console.log('\n=== snapshot immunity ===')

// The caller's objects keep moving after the record exists — Task 6's slot
// panel edits the inputs it adopted, Task 7's auto-roster holds the app's
// live solve result — and neither may rewrite a saved record another slot
// may be showing.
const looseInputs: SlotInputs = { ...sampleInputs }
const looseResult: TrimSolveResult = {
  ...sampleResult,
  lcb: { ...sampleResult.lcb },
  lcg: { ...sampleResult.lcg },
  pivot: { ...sampleResult.pivot },
  gzCurve: sampleResult.gzCurve.map((point) => ({ ...point })),
}
const snapshot = recordFromSolve('Snapshot', 'a'.repeat(64), looseInputs, looseResult)
looseInputs.weightKg = 90
looseInputs.kgMm = 500
looseResult.trimDeg = -3.6
looseResult.lcb.x = 999
looseResult.gzCurve[1] = { heelDeg: 5, GZ: 0 }
check(
  snapshot.inputs.weightKg === 75 && snapshot.inputs.kgMm === 280,
  'editing the caller inputs does not rewrite the record',
  JSON.stringify(snapshot.inputs),
)
check(snapshot.result.trimDeg === 3.6, 'editing the caller result does not rewrite the record')
check(snapshot.result.lcb.x === -59.95, 'the centre vectors are private copies')
check(
  deepEqual(snapshot.result.gzCurve[1], { heelDeg: 5, GZ: 8.9 }),
  'the gzCurve points are private copies',
)

// Frozen: an accidental in-place write throws instead of silently rewriting.
const frozenTop = snapshot.result as { trimDeg: number }
const frozenVec = snapshot.result.lcb as { x: number }
let topWriteThrew = false
let vecWriteThrew = false
try {
  frozenTop.trimDeg = 0
} catch {
  topWriteThrew = true
}
try {
  frozenVec.x = 1
} catch {
  vecWriteThrew = true
}
check(topWriteThrew, 'the snapshot is frozen — an in-place write throws')
check(vecWriteThrew, 'the nested centre vector is frozen too')
check(snapshot.result.trimDeg === 3.6, 'the refused write leaves the value intact')
// The ARRAY beside its points: frozen points in a mutable array still let an
// in-place push or index write rewrite the plotted curve, and the array is
// what every reader of it walks.
check(Object.isFrozen(snapshot.result.gzCurve), 'the gzCurve array is frozen alongside its points')

// Purity: the roster functions hand back new containers, never their input.
const purityRoster = [built, built2]
const purityOut = deleteRecord(purityRoster, built.id)
check(purityOut !== purityRoster, 'deleteRecord returns a new array')
check(
  purityRoster.length === 2 && purityRoster[0] === built,
  'deleteRecord leaves its input array untouched',
)
check(purityOut[0] === built2, 'the surviving records are carried over, not re-cloned')

const freshA = readRoster(storage({ [COMPARE_STORAGE_KEY]: written }))
const freshB = readRoster(storage({ [COMPARE_STORAGE_KEY]: written }))
check(freshA[0] !== freshB[0], 'each read parses fresh objects — reads do not share')
check(
  freshA[0].inputs !== freshB[0].inputs && freshA[0].result.gzCurve !== freshB[0].result.gzCurve,
  'two reads share no nested structure either',
)
// The independence above is now structural AND enforced: a restored record is
// frozen like a created one, so neither read can be rewritten through the
// other's state (the old check proved it by mutating the copy).
check(
  Object.isFrozen(freshA[0]) && Object.isFrozen(freshB[0]),
  'restored records come back frozen, like created ones',
)

// --- 7. non-finite values -----------------------------------------------------

console.log('\n=== non-finite values ===')

// The comparator itself, first: JSON cannot tell NaN from null, so a text
// comparison would wave the junk through.
check(deepEqual({ v: Number.NaN }, { v: Number.NaN }), 'deepEqual matches a NaN against itself')
check(!deepEqual({ v: Number.NaN }, { v: null }), 'deepEqual tells NaN from null')
check(
  JSON.stringify({ v: Number.NaN }) === JSON.stringify({ v: null }),
  'JSON text really does collapse the two — the reason deepEqual exists',
)

// What storage does with a NaN: JSON writes null, and null is not a number,
// so the record drops and its valid sibling survives. A hand-written entry
// stands in for the record here, because the create gate below refuses to
// build one in the first place.
const nanResult: TrimSolveResult = { ...sampleResult, trimDeg: Number.NaN }
const nanStored = entry({ id: 'rec_nan_stored', result: nanResult })
const nanText = JSON.stringify([nanStored, valid])
check(
  nanText.includes('"trimDeg":null'),
  'encodeRoster writes a NaN as null',
  nanText.slice(0, 120),
)
const afterNan = readRoster(storage({ [COMPARE_STORAGE_KEY]: nanText }))
check(
  afterNan.length === 1,
  'the NaN record is dropped, its valid sibling survives',
  `got ${afterNan.length}`,
)
check(afterNan[0].id === 'rec_valid', 'the surviving sibling is the valid one')

// The create gate that keeps such a record out of the roster at all: a
// refused record names its reason where a read-time drop leaves a visible
// record silently vanishing on the next reload.
let nanRefusal = ''
try {
  recordFromSolve('NaN hull', 'd'.repeat(64), sampleInputs, nanResult)
} catch (err) {
  nanRefusal = err instanceof Error ? err.message : String(err)
}
check(nanRefusal !== '', 'a result with a NaN is refused at creation', nanRefusal)
check(nanRefusal.includes('non-finite'), 'the refusal names the reason', nanRefusal)

let infRefusal = ''
try {
  recordFromSolve('Inf hull', 'e'.repeat(64), sampleInputs, {
    ...sampleResult,
    GM: Number.POSITIVE_INFINITY,
  })
} catch (err) {
  infRefusal = err instanceof Error ? err.message : String(err)
}
check(infRefusal !== '', 'a result with an Infinity is refused at creation', infRefusal)

let curveRefusal = ''
try {
  recordFromSolve('Curve hull', 'f'.repeat(64), sampleInputs, {
    ...sampleResult,
    gzCurve: [
      { heelDeg: 0, GZ: 0 },
      { heelDeg: 5, GZ: Number.NaN },
    ],
  })
} catch (err) {
  curveRefusal = err instanceof Error ? err.message : String(err)
}
check(curveRefusal !== '', 'a NaN inside the GZ curve is refused too', curveRefusal)

// The inputs are no different: a NaN input restores as null and is filtered.
const nanInputsText = JSON.stringify([
  entry({ id: 'rec_nan_inputs', inputs: { ...sampleInputs, weightKg: Number.NaN } }),
  valid,
])
check(nanInputsText.includes('"weightKg":null'), 'JSON writes a NaN input as null too')
check(
  readRoster(storage({ [COMPARE_STORAGE_KEY]: nanInputsText })).length === 1,
  'a NaN input is filtered, the valid sibling survives',
)

// --- 8. deleteRecord ---------------------------------------------------------

console.log('\n=== deleteRecord ===')

const three = [built, built2, { ...built2, id: 'rec_third' }]
check(deepEqual(deleteRecord(three, 'nope'), three), 'deleting a missing id changes nothing')
check(
  deepEqual(
    deleteRecord(three, built.id).map((r) => r.id),
    [built2.id, 'rec_third'],
  ),
  'the target is removed exactly',
)
check(deepEqual(deleteRecord(three, 'rec_third')[1], built2), 'the other records are untouched')

// --- 9. conditionsDiffer -----------------------------------------------------

console.log('\n=== conditionsDiffer ===')

const same = { weightKg: 75, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }
check(deepEqual(conditionsDiffer(same, sampleInputs), []), 'identical inputs produce no labels')
check(
  deepEqual(conditionsDiffer(same, { ...same, weightKg: 80 }), ['weight']),
  'a differing weight is named',
  JSON.stringify(conditionsDiffer(same, { ...same, weightKg: 80 })),
)
check(
  deepEqual(conditionsDiffer(same, { ...same, lcgPctLwl: 55 }), ['LCG']),
  'a differing LCG is named',
)
check(deepEqual(conditionsDiffer(same, { ...same, kgMm: 300 }), ['KG']), 'a differing KG is named')
check(
  deepEqual(conditionsDiffer(same, { ...same, heelDeg: 10 }), ['heel']),
  'a differing heel is named',
)
check(
  deepEqual(conditionsDiffer(same, { weightKg: 80, lcgPctLwl: 55, kgMm: 300, heelDeg: 10 }), [
    'weight',
    'LCG',
    'KG',
    'heel',
  ]),
  'differing inputs name every field',
  JSON.stringify(conditionsDiffer(same, { weightKg: 80, lcgPctLwl: 55, kgMm: 300, heelDeg: 10 })),
)
// Zero vs a real heel IS a difference: comparing a heeled slot against an
// upright one at the same weight is exactly the flagship case.
check(
  conditionsDiffer({ ...same, heelDeg: 0 }, { ...same, heelDeg: 0 }).length === 0,
  'two upright slots do not differ',
)

// --- 10. the roster's de-dup -------------------------------------------------

console.log('\n=== roster de-dup ===')

// A record's id is minted per creation, so the SAME run arriving twice gets
// two ids: solving the same hull at the same conditions twice would otherwise
// fill the roster with copies of one run. The run's CONTENT is what
// identifies it.
const runA = recordFromSolve('Hull', 'a'.repeat(64), sampleInputs, sampleResult)
const runACopy = recordFromSolve('Hull', 'a'.repeat(64), sampleInputs, sampleResult)
check(
  runA.id !== runACopy.id,
  'the same run built twice gets two ids',
  `${runA.id} vs ${runACopy.id}`,
)
check(
  recordFingerprint(runA) === recordFingerprint(runACopy),
  'the same run has one fingerprint',
  `${recordFingerprint(runA)} vs ${recordFingerprint(runACopy)}`,
)

const afterDuplicate = addRosterRecord([runA], runACopy)
check(afterDuplicate.length === 1, 'the same run is not duplicated', `got ${afterDuplicate.length}`)
check(afterDuplicate[0].id === runA.id, 'the entry already in the roster keeps its identity')
check(
  canonicalRecord([runA], runACopy).id === runA.id,
  'the canonical record of a duplicate is the one already stored',
)

// A DIFFERENT run stays a separate entry: same hull, different conditions,
// and the same conditions on a different hull are three different runs.
const heavier = recordFromSolve(
  'Hull',
  'a'.repeat(64),
  { ...sampleInputs, weightKg: 90 },
  sampleResult,
)
const otherHull = recordFromSolve('Other hull', 'b'.repeat(64), sampleInputs, sampleResult)
check(
  addRosterRecord([runA], heavier).length === 2,
  'the same hull at different conditions is a separate entry',
)
check(
  addRosterRecord([runA], otherHull).length === 2,
  'a different hull at the same conditions is a separate entry',
)
check(
  recordFingerprint(runA) !== recordFingerprint(heavier),
  'different conditions are a different fingerprint',
)

// The roster functions hand back new containers and never their input.
const rosterInput = [runA]
const rosterOutput = addRosterRecord(rosterInput, otherHull)
check(rosterOutput !== rosterInput, 'addRosterRecord returns a new array')
check(rosterInput.length === 1 && rosterInput[0] === runA, 'addRosterRecord leaves its input alone')
check(rosterOutput[0] === otherHull, 'the new record is carried over, not re-cloned')
check(rosterOutput[1] === runA, 'the older entries are carried over in order')

// --- the cap, the failed-write report and frozen restored records -----------

console.log('\n=== the roster cap, write risk and restored snapshots ===')

{
  // F4: every home solve auto-adds a record and nothing pruned them, so the
  // roster grew until a write hit the origin quota - the state the banner
  // reports. The cap keeps the newest runs, which is the order the list and
  // `addRosterRecord` already use.
  let grown: RunRecord[] = []
  for (let i = 0; i < ROSTER_LIMIT + 5; i++) {
    grown = addRosterRecord(
      grown,
      recordFromSolve(
        `hull-${i}.stl`,
        'a'.repeat(64),
        { ...sampleInputs, weightKg: 60 + i },
        sampleResult,
      ),
    )
  }
  check(
    grown.length === ROSTER_LIMIT,
    `the roster stops at ${ROSTER_LIMIT} runs`,
    `got ${grown.length}`,
  )
  check(grown[0]?.name === `hull-${ROSTER_LIMIT + 4}.stl`, 'the newest run is kept at the front')
  check(grown[ROSTER_LIMIT - 1]?.name === 'hull-5.stl', 'the oldest runs are the ones dropped')

  // A stored roster larger than the cap (an older app, a hand-edited value)
  // restores to the same size the write path would keep.
  const oversized = JSON.stringify([
    ...grown,
    recordFromSolve('older.stl', 'a'.repeat(64), { ...sampleInputs, weightKg: 40 }, sampleResult),
  ])
  const restored = readRoster((key) => (key === COMPARE_STORAGE_KEY ? oversized : null))
  check(restored.length === ROSTER_LIMIT, 'readRoster drops the overflow instead of restoring it')

  // F6: restored records were the only mutable copies in the app, so the
  // "immutable snapshot" claim covered created records only.
  const first = restored[0]
  check(Object.isFrozen(first), 'a restored record is frozen like a created one')
  check(Object.isFrozen(first?.inputs), 'its inputs are frozen')
  check(Object.isFrozen(first?.result.gzCurve), 'its GZ curve array is frozen')
  check(Object.isFrozen(first?.result.gzCurve[0]), 'its GZ curve points are frozen')
  let refused = false
  try {
    ;(first as { name: string }).name = 'rewritten'
  } catch {
    refused = true
  }
  check(refused, 'an in-place write to a restored record throws')

  // F2: what a failed write actually put at risk, judged by id SETS. The old
  // banner compared lengths, so a restored roster that could not be
  // re-written claimed to be "in memory only" - although it came from storage.
  const nothing = new Set<string>()
  const storedIds = new Set(['a', 'b'])
  check(
    rosterWriteRisk(['a', 'b'], storedIds).kind === 'none',
    'a refusal over records storage already has loses nothing',
  )
  check(
    rosterWriteRisk([], nothing).kind === 'none',
    'an empty roster over empty storage loses nothing',
  )
  check(
    rosterWriteRisk([], storedIds).kind === 'deletion',
    'a refused deletion is reported as a deletion',
  )
  const oneNew = rosterWriteRisk(['a', 'b', 'c'], storedIds)
  check(
    oneNew.kind === 'volatile' && oneNew.count === 1,
    'a refused new run is reported as one volatile record',
  )
  const twoNew = rosterWriteRisk(['c', 'd', 'a', 'b'], storedIds)
  check(
    twoNew.kind === 'volatile' && twoNew.count === 2,
    'two refused new runs are counted, not guessed from the length',
  )
  check(
    rosterWriteRisk(['a', 'c'], storedIds).kind === 'deletion',
    'a deletion plus a new run reports the deletion',
  )
}

console.log(failures === 0 ? '\nALL ROSTER CHECKS PASSED' : `\n${failures} ROSTER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
