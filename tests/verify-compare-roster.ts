// Task 2 gate — the Compare roster: record shape, persistence round trip,
// hostile storage, and the conditions-diff.
//
// Why this suite exists: the roster is the only part of Compare that outlives
// the session, and it is re-read from localStorage — a string any user, any
// older app version or any bug can have written. Two failure classes are
// pinned here, both able to break the Compare tab silently:
//
//  1. A MALFORMED OR STALE ROSTER MUST DEGRADE, NEVER CRASH. Absent key,
//     non-JSON, a JSON non-array, entries with wrong-typed or missing fields,
//     and a reader that throws (private mode) must all yield [] or a filtered
//     roster with the valid siblings kept — the tab renders, minus the junk.
//     `readStoredInputs` established exactly this contract for the home
//     inputs; the roster keeps it.
//
//  2. THE ROUND TRIP MUST BE LOSSLESS. The spec promises a restored record
//     feeds the whole comparison table and delta column with no blank rows —
//     so `encodeRoster` → `readRoster` must return the records deep-equal,
//     `gzCurve` arrays included, or a reload would blank the stability rows.
//
// Validation shares ONE gate with the form: a record's inputs are judged by
// the same `*Usable` predicates `verify-inputs.ts` drives, so a stored value
// the form rejects cannot enter the roster through the back door.
//
// What this suite does NOT cover: the React wiring (roster state in the tab,
// the delete affordance, the auto-add after a home solve) is JSX, covered by
// typecheck, `biome check` and a read-through.
//
// Run: npm.cmd exec -- tsx tests/verify-compare-roster.ts

import {
  COMPARE_STORAGE_KEY,
  conditionsDiffer,
  deleteRecord,
  encodeRoster,
  type RunRecord,
  readRoster,
  recordFromSolve,
  type SlotInputs,
} from '../src/lib/compare.js'
import type { TrimSolveResult } from '../src/lib/hydrostatics.js'
import { type StorageReader, weightUsable } from '../src/lib/inputs.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// --- a complete, table-rendering result -------------------------------------
// Every numeric field the table, the delta column and the export round-trip
// need, built by hand so the suite runs without a solve. The required set is
// the module's contract; this sample satisfies all of it.

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
check(sameJson(built.inputs, sampleInputs), 'the inputs are stored as given')
check(
  built.result === sampleResult || sameJson(built.result, sampleResult),
  'the result is the solve result',
)
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
check(sameJson(back[0], built), 'the first record is deep-equal after the round trip')
check(back[1].result.gzCurve !== undefined, 'the gzCurve survives')
check(
  sameJson(back[0].result.gzCurve, sampleResult.gzCurve),
  'the gzCurve is deep-equal after the round trip',
  JSON.stringify(back[0].result.gzCurve),
)
check(sameJson(back, [built, built2]), 'the whole roster is deep-equal after the round trip')

// An empty roster round-trips to [] rather than null or a throw.
check(
  sameJson(readRoster(storage({ [COMPARE_STORAGE_KEY]: '[]' })), []),
  'an empty array reads back as []',
)

// --- 3. hostile storage ------------------------------------------------------

console.log('\n=== hostile storage ===')

check(sameJson(readRoster(storage({})), []), 'an absent key yields []')
check(
  sameJson(readRoster(storage({ [COMPARE_STORAGE_KEY]: null })), []),
  'a null payload yields []',
)
check(
  sameJson(readRoster(storage({ [COMPARE_STORAGE_KEY]: '{not json' })), []),
  'malformed JSON yields []',
)
check(
  sameJson(readRoster(storage({ [COMPARE_STORAGE_KEY]: '42' })), []),
  'a JSON primitive yields []',
)
check(
  sameJson(readRoster(storage({ [COMPARE_STORAGE_KEY]: '{"records": []}' })), []),
  'a JSON object yields []',
)
check(sameJson(readRoster(storage({ [COMPARE_STORAGE_KEY]: 'null' })), []), 'JSON null yields []')

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
check(sameJson(readRoster(storageThrows), []), 'a throwing reader yields []')

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
  sameJson(
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
  ['a missing result', entry({ result: undefined })],
  ['a non-object result', entry({ result: 5 })],
  ['a result missing gzCurve', entry({ result: { ...sampleResult, gzCurve: undefined } })],
  ['a gzCurve that is not an array', entry({ result: { ...sampleResult, gzCurve: {} } })],
  ['a missing inputs', entry({ inputs: undefined })],
  ['inputs with a wrong type', entry({ inputs: { ...sampleInputs, weightKg: '75' } })],
  ['inputs out of range', entry({ inputs: { ...sampleInputs, kgMm: 0 } })],
  ['a missing savedAt', entry({ savedAt: undefined })],
]
for (const [label, bad] of badEntries) {
  const kept = rosterWith(bad, valid).map((r) => r.id)
  check(
    sameJson(kept, ['rec_valid']),
    `${label} is filtered out, the valid sibling survives`,
    JSON.stringify(kept),
  )
}

// The weight bound is the shared gate with the form: whatever the form rejects
// cannot restore into the roster.
check(weightUsable(75) && !weightUsable(19), 'the shared weight predicate is in force')
const outOfRange = rosterWith(
  entry({ id: 'rec_oor', inputs: { ...sampleInputs, weightKg: 19 } }),
  valid,
)
check(
  sameJson(
    outOfRange.map((r) => r.id),
    ['rec_valid'],
  ),
  'a 19 kg record cannot enter the roster',
)

// --- 5. deleteRecord ---------------------------------------------------------

console.log('\n=== deleteRecord ===')

const three = [built, built2, { ...built2, id: 'rec_third' }]
check(sameJson(deleteRecord(three, 'nope'), three), 'deleting a missing id changes nothing')
check(
  sameJson(
    deleteRecord(three, built.id).map((r) => r.id),
    [built2.id, 'rec_third'],
  ),
  'the target is removed exactly',
)
check(sameJson(deleteRecord(three, 'rec_third')[1], built2), 'the other records are untouched')

// --- 6. conditionsDiffer -----------------------------------------------------

console.log('\n=== conditionsDiffer ===')

const same = { weightKg: 75, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }
check(sameJson(conditionsDiffer(same, sampleInputs), []), 'identical inputs produce no labels')
check(
  sameJson(conditionsDiffer(same, { ...same, weightKg: 80 }), ['weight']),
  'a differing weight is named',
  JSON.stringify(conditionsDiffer(same, { ...same, weightKg: 80 })),
)
check(
  sameJson(conditionsDiffer(same, { ...same, lcgPctLwl: 55 }), ['LCG']),
  'a differing LCG is named',
)
check(sameJson(conditionsDiffer(same, { ...same, kgMm: 300 }), ['KG']), 'a differing KG is named')
check(
  sameJson(conditionsDiffer(same, { ...same, heelDeg: 10 }), ['heel']),
  'a differing heel is named',
)
check(
  sameJson(conditionsDiffer(same, { weightKg: 80, lcgPctLwl: 55, kgMm: 300, heelDeg: 10 }), [
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

console.log(failures === 0 ? '\nALL ROSTER CHECKS PASSED' : `\n${failures} ROSTER CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
