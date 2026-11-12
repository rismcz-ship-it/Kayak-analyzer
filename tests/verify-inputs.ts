// The pure input + persistence surface that used to live inside App.tsx.
//
// Why this suite exists: `toNumber`, `parseInputs`, `readStoredInputs`,
// `scaleNotice` and the four range predicates were module-private functions of
// the component, and nothing in `tests/` ever imported that module — so the
// whole layer between a keystroke and a solve ran with ZERO assertions. That is
// the same defect class this repo has already paid for twice: Task 6 shipped
// three user-facing gates with no assertions at all, and Task 9's cross-review
// BLOCKER was a JSX safety condition no test could reach. The app's own lesson
// — a UI condition that makes a claim must live in a pure module with a suite
// behind it — is what is being applied to the input path here.
//
// Two defects from this repo's own history are pinned here, both able to return
// silently:
//
//  1. `Number('')` IS 0. Before `4b6ba2a` the three settings were numeric state
//     setters, so clearing a field "solved" a 0 kg kayak and returned a number.
//     `toNumber` is the one place that decides what counts as a number, and it
//     must never hand back 0 for an empty or blank string.
//
//  2. THE RANGES AND THE RESTORE PATH NOW SHARE ONE GATE. `parseInputs` and
//     `readStoredInputs` judge every value with the same `*Usable` predicate,
//     so a value the form rejects can never be one the restore offers - that
//     sharing is what stops a stored `kgMm: 0` booting the app with Calculate
//     permanently disabled. The suite asserts the sharing by driving each
//     boundary through both paths.
//
// The heel rules are the quiet ones and get their own sections: a heel only
// exists because the toggle was ON when it was saved, and what is persisted is
// the APPLIED heel, not the slider's leftover — otherwise switching the toggle
// off and reloading resurrects a heel the user had explicitly switched off.
//
// What this suite does NOT cover, and says so rather than pretending: the JSX.
// The banners, the disabled Calculate button, the toggle wiring, the per-field
// error placement and the slider are React inside `App.tsx`; they stay covered
// by typecheck, `biome check` and a read-through, exactly as the mount/update
// split is handled in `verify-viewer-scene.ts`.
//
// Run: npm.cmd exec -- tsx tests/verify-inputs.ts

import type { ScaleAdvice } from '../src/lib/geometry.js'
import {
  encodeStoredInputs,
  HEEL_MAX,
  HEEL_MIN,
  heelUsable,
  INPUTS_STORAGE_KEY,
  type InputFields,
  KG_MAX,
  KG_MIN,
  kgUsable,
  LCG_MAX,
  LCG_MIN,
  lcgUsable,
  parseInputs,
  readStoredInputs,
  type StorageReader,
  scaleNotice,
  toNumber,
  WEIGHT_MAX,
  WEIGHT_MIN,
  weightUsable,
} from '../src/lib/inputs.js'

let checks = 0
let fails = 0
function check(ok: boolean, label: string, detail = ''): void {
  checks++
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    fails++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** A reader that answers from a literal bag of stored JSON strings. */
function storage(payloads: Record<string, string | null>): (key: string) => string | null {
  return (key) => (key in payloads ? payloads[key] : null)
}

/**
 * A store holding exactly one payload under the app's key: a record to
 * stringify (as the app's persist effect writes it), the JSON text itself, or
 * nothing at all.
 */
function oneStore(
  payload: Record<string, unknown> | string | null,
): (key: string) => string | null {
  const text = payload === null || typeof payload === 'string' ? payload : JSON.stringify(payload)
  return storage({ [INPUTS_STORAGE_KEY]: text })
}

/**
 * Parse a persist payload, reading "nothing was written" as an empty record so
 * a regression prints a FAIL line instead of throwing on `String(null)`.
 */
function record(payloadText: string | null): Record<string, unknown> {
  return payloadText === null ? {} : (JSON.parse(payloadText) as Record<string, unknown>)
}

/** A reader that stands in for a browser with storage disabled entirely. */
const storageThrows = (): string | null => {
  throw new Error('storage is disabled (private mode)')
}

/** The app's own persist payload, with the heel state as arguments. */
function payload(
  weightKg: number | null,
  lcgPercent: number | null,
  kgMm: number | null,
  heelDeg: number,
  showHeelInput: boolean,
): string | null {
  return encodeStoredInputs({ weightKg, lcgPercent, kgMm, heelDeg, showHeelInput })
}

/** A read that reports whether the throw escaped instead of being caught. */
function captureRead(read: StorageReader): { threw: boolean; fields: InputFields | null } {
  try {
    return { threw: false, fields: readStoredInputs(read) }
  } catch {
    return { threw: true, fields: null }
  }
}

// --- 1. toNumber: '' is not a number, and it is certainly not 0 ------------

console.log('=== 1. toNumber — the empty-string bug ===')
check(toNumber('') === null, 'an empty string is not a number')
check(toNumber('   ') === null, 'whitespace is not a number', JSON.stringify(toNumber('   ')))
check(toNumber('\t\n') === null, 'a blank line is not a number')
check(toNumber('abc') === null, 'text is not a number')
check(toNumber('NaN') === null, 'NaN is not a number')
check(toNumber('Infinity') === null, 'Infinity is not a number')
check(toNumber('-Infinity') === null, '-Infinity is not a number')
check(
  toNumber('0') === 0,
  'an explicit 0 IS a number — the fix must not make 0 unenterable',
  String(toNumber('0')),
)
check(toNumber(' 75 ') === 75, 'surrounding whitespace is trimmed', String(toNumber(' 75 ')))
check(toNumber('52.5') === 52.5, 'decimals parse')
check(toNumber('1e3') === 1000, 'exponential form parses')

// --- 2. parseInputs: each field stands alone ------------------------------

console.log('\n=== 2. parseInputs — per-field independence ===')
const good = parseInputs({ weightInput: '75', lcgInput: '52', kgInput: '280' })
check(good.weightKg === 75, 'the default weight parses')
check(good.lcgPercent === 52, 'the default LCG parses')
check(good.kgMm === 280, 'the default KG parses')
check(good.inputError === null, 'a valid form has no error')
check(
  good.weightError === null && good.lcgError === null && good.kgError === null,
  'no field error either',
)

const clearedWeight = parseInputs({ weightInput: '', lcgInput: '52', kgInput: '280' })
check(clearedWeight.weightKg === null, 'a cleared weight is null, not 0')
check(clearedWeight.lcgPercent === 52, 'a cleared weight does not blank the LCG')
check(clearedWeight.kgMm === 280, 'a cleared weight does not blank the KG')
check(
  clearedWeight.weightError === 'Target weight: enter a number.',
  'the cleared weight names itself',
  String(clearedWeight.weightError),
)
check(
  clearedWeight.inputError === clearedWeight.weightError,
  'the form-level error is the weight one',
)

const blankKg = parseInputs({ weightInput: '75', lcgInput: '52', kgInput: '   ' })
check(blankKg.kgMm === null, 'a blank KG is null, not the keel')
check(blankKg.weightKg === 75, 'a blank KG leaves the weight alone')
check(
  blankKg.kgError === 'KG: enter a number.',
  'the blank KG names itself',
  String(blankKg.kgError),
)

// --- 3. parseInputs: the bounds, closed or open on purpose ----------------

console.log('\n=== 3. parseInputs — the ranges ===')
const weight = (v: number) =>
  parseInputs({ weightInput: String(v), lcgInput: '52', kgInput: '280' })
check(weight(WEIGHT_MIN).weightKg === WEIGHT_MIN, `${WEIGHT_MIN} kg is the closed lower bound`)
check(weight(WEIGHT_MAX).weightKg === WEIGHT_MAX, `${WEIGHT_MAX} kg is the closed upper bound`)
check(
  weight(WEIGHT_MIN - 0.5).weightError === `Target weight must be ${WEIGHT_MIN}–${WEIGHT_MAX} kg.`,
  'under the lower bound carries the band',
)
check(
  weight(WEIGHT_MAX + 0.5).weightError === `Target weight must be ${WEIGHT_MIN}–${WEIGHT_MAX} kg.`,
  'over the upper bound carries the band',
)
check(weight(0).weightKg === null, '0 kg is rejected, not accepted as a number')
check(weight(0).weightError !== null, '0 kg carries a reason')

const lcg = (v: number) => parseInputs({ weightInput: '75', lcgInput: String(v), kgInput: '280' })
check(lcg(LCG_MIN).lcgPercent === LCG_MIN, `${LCG_MIN} % is the closed lower bound`)
check(lcg(LCG_MAX).lcgPercent === LCG_MAX, `${LCG_MAX} % is the closed upper bound`)
check(
  lcg(-1).lcgError === `LCG must be ${LCG_MIN}–${LCG_MAX} %.`,
  'a negative LCG carries the band',
)
check(
  lcg(120).lcgError === `LCG must be ${LCG_MIN}–${LCG_MAX} %.`,
  'an over-100 LCG carries the band',
)

const kg = (v: number) => parseInputs({ weightInput: '75', lcgInput: '52', kgInput: String(v) })
check(kg(KG_MAX).kgMm === KG_MAX, `${KG_MAX} mm is the closed upper bound`)
check(
  kg(KG_MAX + 1).kgError === `KG must be above ${KG_MIN} mm and at most ${KG_MAX} mm.`,
  'over the upper bound carries the band',
)
check(
  kg(KG_MIN).kgMm === null,
  '0 mm KG is excluded — that is the C of G in the keel',
  String(kg(KG_MIN).kgMm),
)
check(
  kg(KG_MIN).kgError === `KG must be above ${KG_MIN} mm and at most ${KG_MAX} mm.`,
  'the excluded 0 mm KG carries the band',
)

// --- 4. parseInputs: the first failure wins, in weight → LCG → KG order ----

console.log('\n=== 4. parseInputs — the reported error is the first one ===')
const weightFirst = parseInputs({ weightInput: '', lcgInput: '', kgInput: '0' })
check(
  weightFirst.inputError === 'Target weight: enter a number.',
  'weight is reported first when it is the one that is wrong',
  String(weightFirst.inputError),
)
check(weightFirst.lcgError !== null, 'the LCG still reports its own error underneath')

const lcgFirst = parseInputs({ weightInput: '75', lcgInput: '', kgInput: '0' })
check(lcgFirst.inputError === 'LCG: enter a number.', 'LCG is reported first when weight is fine')
check(lcgFirst.kgError !== null, 'the KG still reports its own error underneath')

// The third leg, without which the `?? kg.error` term could be deleted from
// parseInputs and this suite would stay green.
const kgFirst = parseInputs({ weightInput: '75', lcgInput: '52', kgInput: '' })
check(
  kgFirst.inputError === 'KG: enter a number.',
  'the KG is the reported one when weight and LCG are fine',
  String(kgFirst.inputError),
)
const kgRangeFirst = parseInputs({ weightInput: '75', lcgInput: '52', kgInput: '2000' })
check(
  kgRangeFirst.inputError === `KG must be above ${KG_MIN} mm and at most ${KG_MAX} mm.`,
  'the KG range error is the reported one too',
  String(kgRangeFirst.inputError),
)
check(kgRangeFirst.kgMm === null, 'that KG is not a usable number', String(kgRangeFirst.kgMm))

// --- 5. readStoredInputs: the restore path shares the same gates ----------

console.log('\n=== 5. readStoredInputs — one gate for form and restore ===')
check(
  INPUTS_STORAGE_KEY === 'kayak-analyzer.inputs.v1',
  'the storage key is versioned',
  INPUTS_STORAGE_KEY,
)

const fresh = readStoredInputs(oneStore(null))
check(fresh.weightInput === '75', 'no stored entry restores the default weight')
check(fresh.lcgInput === '52', 'no stored entry restores the default LCG')
check(fresh.kgInput === '280', 'no stored entry restores the default KG')
check(fresh.heelDeg === 0, 'no stored entry restores heel off')
check(fresh.showHeelInput === false, 'no stored entry leaves the toggle off')

const known = readStoredInputs(oneStore({ weightKg: 62, lcgPercent: 48, kgMm: 300 }))
check(known.weightInput === '62', 'a stored weight is restored')
check(known.lcgInput === '48', 'a stored LCG is restored')
check(known.kgInput === '300', 'a stored KG is restored')
check(known.showHeelInput === false, 'a restored form keeps the heel toggle off')

console.log('\n=== 5b. readStoredInputs — nothing untrustworthy may stop the boot ===')
// The Task 7 bug, pinned here: a stored KG of 0 must fall back, never disable
// the form.
const zeroKg = readStoredInputs(oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 0 }))
check(zeroKg.kgInput === '280', 'a stored kgMm 0 falls back to the default', zeroKg.kgInput)
check(zeroKg.weightInput === '75', 'the other fields survive that fallback')
check(kgUsable(0) === false, 'and the form itself rejects kgMm 0 — the two gates now agree')

const outOfRange = readStoredInputs(oneStore({ weightKg: 500, lcgPercent: -3, kgMm: 2500 }))
check(outOfRange.weightInput === '75', 'a stored weight out of range falls back')
check(outOfRange.lcgInput === '52', 'a stored LCG out of range falls back')
check(outOfRange.kgInput === '280', 'a stored KG out of range falls back')

const wrongTypes = readStoredInputs(oneStore({ weightKg: '75', lcgPercent: null, kgMm: [1] }))
check(wrongTypes.weightInput === '75', 'a string where a number belongs falls back')
check(wrongTypes.lcgInput === '52', 'a null where a number belongs falls back')
check(wrongTypes.kgInput === '280', 'an array where a number belongs falls back')

const malformed = readStoredInputs(storage({ [INPUTS_STORAGE_KEY]: '{not json' }))
check(malformed.weightInput === '75', 'malformed JSON falls back entirely')
check(malformed.heelDeg === 0, 'malformed JSON restores heel off')

const primitive = readStoredInputs(storage({ [INPUTS_STORAGE_KEY]: '42' }))
check(primitive.weightInput === '75', 'a JSON primitive (not an object) falls back entirely')

// A JSON number that parses to Infinity: `1e999` is legal JSON, so without the
// `Number.isFinite` guard on the restore a stored payload could put Infinity in
// the weight field and hand the solver a NaN kayak.
const infinite = readStoredInputs(
  storage({ [INPUTS_STORAGE_KEY]: '{"weightKg":1e999,"lcgPercent":52,"kgMm":280}' }),
)
check(
  infinite.weightInput === '75',
  'a stored Infinity falls back to the default',
  infinite.weightInput,
)

// Containers that survive `typeof === 'object'` but are not a stored form.
const arrayStore = readStoredInputs(oneStore('[]'))
check(arrayStore.weightInput === '75', 'a JSON array is not a stored form', arrayStore.weightInput)
const booleanStore = readStoredInputs(oneStore('true'))
check(
  booleanStore.weightInput === '75',
  'a JSON boolean is not a stored form',
  booleanStore.weightInput,
)

const disabled = captureRead(storageThrows)
check(!disabled.threw, 'a reader that throws does not escape the restore')
check(disabled.fields?.weightInput === '75', 'a throwing reader restores the defaults')
check(disabled.fields?.heelDeg === 0, 'a throwing reader leaves the heel off')

// --- 6. heel: the toggle follows the APPLIED heel, not the slider ----------

console.log('\n=== 6. heel — the toggle follows the applied heel ===')
const heelOn = readStoredInputs(oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 280, heelDeg: 20 }))
check(heelOn.heelDeg === 20, 'a stored heel is restored')
check(heelOn.showHeelInput === true, 'a stored non-zero heel restores the toggle ON')

const heelOff = readStoredInputs(oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 280, heelDeg: 0 }))
check(heelOff.heelDeg === 0, 'a stored 0 heel restores as 0')
check(heelOff.showHeelInput === false, 'a stored 0 heel restores the toggle OFF')

const heelNegative = readStoredInputs(
  oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 280, heelDeg: -20 }),
)
check(heelNegative.heelDeg === -20, 'a stored negative heel is restored, sign intact')
// Real symmetry, not "|HEEL_MIN| happens to sit inside the band": the band is
// symmetric about 0 only if HEEL_MIN === -HEEL_MAX.
check(HEEL_MIN === -HEEL_MAX, 'the heel bounds are symmetric about 0', `${HEEL_MIN}..${HEEL_MAX}`)

const heelBeyond = readStoredInputs(
  oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 280, heelDeg: 45 }),
)
check(
  heelBeyond.heelDeg === 0,
  'a heel past the slider range falls back to 0',
  String(heelBeyond.heelDeg),
)
check(heelBeyond.showHeelInput === false, 'that fallback also leaves the toggle off')

const heelAtMax = readStoredInputs(
  oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 280, heelDeg: HEEL_MAX }),
)
check(heelAtMax.heelDeg === HEEL_MAX, `${HEEL_MAX}° is the closed upper bound`)
const heelAtMin = readStoredInputs(
  oneStore({ weightKg: 75, lcgPercent: 52, kgMm: 280, heelDeg: HEEL_MIN }),
)
check(heelAtMin.heelDeg === HEEL_MIN, `${HEEL_MIN}° is the closed lower bound`)

// --- 7. encodeStoredInputs: what the app writes, and when it writes nothing -

console.log('\n=== 7. encodeStoredInputs — the applied heel, or nothing at all ===')
const toggleOff = payload(75, 52, 280, 25, false)
check(
  record(toggleOff).heelDeg === 0,
  'the APPLIED heel is stored — a toggle-off slider of 25° stores 0',
  String(toggleOff),
)
const toggleOn = payload(75, 52, 280, -20, true)
check(record(toggleOn).heelDeg === -20, 'a toggle-on slider stores its value', String(toggleOn))

const whole = record(toggleOff)
check(
  Object.keys(whole).join(',') === 'weightKg,lcgPercent,kgMm,heelDeg',
  'the record keeps its key order, not just its key count',
  Object.keys(whole).join(','),
)
check(Object.keys(whole).length === 4, 'exactly four keys are written')
check(
  whole.weightKg === 75 && whole.lcgPercent === 52 && whole.kgMm === 280,
  'the written record carries the three numbers',
)
check(payload(null, 52, 280, 0, false) === null, 'an incomplete weight writes nothing at all')
check(payload(75, null, 280, 0, false) === null, 'an incomplete LCG writes nothing at all')
check(payload(75, 52, null, 0, false) === null, 'an incomplete KG writes nothing at all')

// --- 8. the round trip: what is written is what comes back ----------------

console.log('\n=== 8. round trip — write, read back, same numbers ===')
const written = payload(88, 41, 310, 15, true)
const back = readStoredInputs(oneStore(String(written)))
check(back.weightInput === '88', 'the weight survives the round trip', back.weightInput)
check(back.lcgInput === '41', 'the LCG survives the round trip', back.lcgInput)
check(back.kgInput === '310', 'the KG survives the round trip', back.kgInput)
check(back.heelDeg === 15, 'the heel survives the round trip', String(back.heelDeg))
check(back.showHeelInput === true, 'the toggle state survives the round trip')

// The interesting case: stored as 0, restored with the toggle OFF.
const zeroWritten = payload(75, 52, 280, 12, false)
const zeroBack = readStoredInputs(oneStore(String(zeroWritten)))
check(zeroBack.heelDeg === 0, 'a stored 0 heel round-trips as 0', String(zeroBack.heelDeg))
check(
  zeroBack.showHeelInput === false,
  'and does not resurrect the toggle on the next boot',
  String(zeroBack.showHeelInput),
)

// The one place "the toggle was on" and "the applied heel" diverge: a toggle
// left ON with the slider at 0 still writes a record, and its 0 comes back with
// the toggle OFF — a stored 0 is never resurrected as a live heel input.
const zeroToggleOn = payload(75, 52, 280, 0, true)
check(zeroToggleOn !== null, 'a toggle-on 0 heel still writes a record', String(zeroToggleOn))
const zeroToggleBack = readStoredInputs(oneStore(String(zeroToggleOn)))
check(
  zeroToggleBack.heelDeg === 0,
  'that 0 heel survives the round trip',
  String(zeroToggleBack.heelDeg),
)
check(
  zeroToggleBack.showHeelInput === false,
  'and comes back with the toggle off',
  String(zeroToggleBack.showHeelInput),
)

// --- 9. scaleNotice: the wording, and what it refuses to claim -------------

console.log('\n=== 9. scaleNotice — the scale banners ===')
const metres: ScaleAdvice = { kind: 'metres', factor: 1000 }
const smallAdvice: ScaleAdvice = { kind: 'small' }
const largeAdvice: ScaleAdvice = { kind: 'large' }

const metresNotice = scaleNotice(metres, 2.34)
check(
  metresNotice.startsWith('Largest axis 2.34 in the file'),
  'the metres notice reports the extent at two digits',
  metresNotice,
)
check(
  metresNotice.includes("in the file's own units"),
  'the metres notice names no unit the app cannot know',
  metresNotice,
)
check(metresNotice.includes('1000×'), 'the metres notice states the length factor', metresNotice)
check(
  !metresNotice.includes('2.34 mm'),
  'and never labels the file\'s own extent "mm"',
  metresNotice,
)

const smallNotice = scaleNotice(smallAdvice, 540)
check(smallNotice.includes('540'), 'the small notice reports the extent', smallNotice)
check(
  smallNotice.includes('10× / 25.4×'),
  'the small notice names both possible factors',
  smallNotice,
)
check(smallNotice.includes('rescale the mesh to mm'), 'the small notice says what to do')

const largeNotice = scaleNotice(largeAdvice, 12000)
check(largeNotice.includes('12,000 mm'), 'the large notice reports mm with grouping', largeNotice)
check(largeNotice.includes('larger than 10 m'), 'the large notice states the band', largeNotice)

// Why the metres band is the only one formatted to two digits:
// `maximumFractionDigits` pads nothing, so 2.34 reads as '2.34' at two digits
// and '2.3' at the one the other bands use. That is a property of
// `src/lib/format.ts` rather than of the input layer, so it is recorded here as
// a comment and not asserted: what this suite checks is the observable
// consequence above — the metres notice starts 'Largest axis 2.34', and every
// other band reports the extent at one digit.

// --- 10. the shared gates: form and restore cannot drift apart again -------

console.log('\n=== 10. the shared range predicates ===')
// The frozen bands as literals. Every other bound assertion in this suite is
// written against the same constants the implementation imports, so without
// this one the band could move (20 → 25 kg, 1000 → 1200 mm) and all of them
// would stay green.
check(
  WEIGHT_MIN === 20 &&
    WEIGHT_MAX === 200 &&
    LCG_MIN === 0 &&
    LCG_MAX === 100 &&
    KG_MIN === 0 &&
    KG_MAX === 1000 &&
    HEEL_MIN === -30 &&
    HEEL_MAX === 30,
  'the input bounds are the frozen ones',
)
check(
  weightUsable(75) && !weightUsable(WEIGHT_MIN - 0.01) && !weightUsable(WEIGHT_MAX + 0.01),
  'weightUsable is the band, closed at both ends',
)
check(
  lcgUsable(52) && lcgUsable(LCG_MIN) && lcgUsable(LCG_MAX) && !lcgUsable(LCG_MIN - 0.01),
  'lcgUsable is the band, closed at both ends',
)
check(
  kgUsable(280) &&
    kgUsable(KG_MAX) &&
    !kgUsable(KG_MIN) &&
    !kgUsable(KG_MIN - 1) &&
    !kgUsable(KG_MAX + 1),
  'kgUsable excludes 0 — the keel it would mean',
)
check(
  heelUsable(0) &&
    heelUsable(HEEL_MAX) &&
    heelUsable(HEEL_MIN) &&
    !heelUsable(HEEL_MIN - 1) &&
    !heelUsable(HEEL_MAX + 1),
  'heelUsable is the slider range, closed at both ends',
)

// The exact defect that cost Task 7 a review pass, stated as one check: the
// value the FORM rejects is the value the RESTORE rejects, for every field.
const badForm = parseInputs({ weightInput: '0', lcgInput: '-1', kgInput: '0' })
const badRestore = readStoredInputs(
  storage({ [INPUTS_STORAGE_KEY]: '{"weightKg":0,"lcgPercent":-1,"kgMm":0}' }),
)
check(
  badForm.weightKg === null && badRestore.weightInput !== '0',
  '0 kg is rejected by both gates',
  badRestore.weightInput,
)
check(
  badForm.lcgPercent === null && badRestore.lcgInput !== '-1',
  '-1 % is rejected by both gates',
  badRestore.lcgInput,
)
check(
  badForm.kgMm === null && badRestore.kgInput !== '0',
  '0 mm KG is rejected by both gates',
  badRestore.kgInput,
)

const storable = parseInputs({ weightInput: '75', lcgInput: '52', kgInput: '280' })
const validWrite = payload(storable.weightKg, storable.lcgPercent, storable.kgMm, 0, false)
check(validWrite !== null, 'a valid parsed form has something to persist', String(validWrite))
const validBack = readStoredInputs(oneStore(String(validWrite)))
check(
  validBack.weightInput === '75' && validBack.lcgInput === '52' && validBack.kgInput === '280',
  'and it comes back identical',
  `${validBack.weightInput}/${validBack.lcgInput}/${validBack.kgInput}`,
)

console.log(fails === 0 ? `\nALL ${checks} CHECKS PASS` : `\n${fails} OF ${checks} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
