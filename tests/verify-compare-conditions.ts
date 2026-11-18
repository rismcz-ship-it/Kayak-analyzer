// The Compare slot's CONDITION rule: which heel is actually applied, and the
// equality the panel's "Live" claim and the table's stale flag both rest on.
//
// Why this suite exists: the slot panel holds the heel slider's value and a
// toggle beside it, and the home tab (`App.tsx`) has always applied the rule
// `showHeelInput ? inputs.heelDeg : 0` — the slider is a LEFTOVER while the
// toggle is off, and an APPLIED angle only while it is on. The slot panel had
// no such rule: a numeric edit emitted the slider's raw value, so editing the
// weight with the toggle off silently re-applied an angle the UI said was not
// applied, and the slot then solved heeled while the panel claimed upright.
// The rule is pure, so it lives in `lib/compare.ts` where a suite can drive
// it, and the panel has no way to express the wrong one.
//
// The equality is the second half: a live result answers to the conditions it
// was solved at, and the panel's "Live — solved at the conditions above" and
// the table's "(re-solving)" marker must both be derived from that pair, not
// from the fields being typed into.
//
// The panel's "Live" gate and the table's stale marker are exported from the
// same module (`liveAnswerIsCurrent`, `columnIsStale`) so the criteria they
// serve are asserted here rather than being private to their components, where
// reverting the panel to a bare `slot.live` check would leave every suite
// green.
//
// What this suite does NOT cover: the React wiring (that the panel passes the
// toggle's own state into the rule, and the table passes each slot's live
// conditions) is JSX, checked by typecheck, `biome check` and a browser
// read-through.
//
// Run: npm.cmd exec -- tsx tests/verify-compare-conditions.ts

import {
  columnIsStale,
  liveAnswerIsCurrent,
  type SlotInputs,
  sameSlotInputs,
  slotConditions,
} from '../src/lib/compare.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const NUMERIC = { weightKg: 75, lcgPctLwl: 52, kgMm: 280 }

console.log('Compare slot conditions')

// 1. The toggle owns the applied heel.
const off = slotConditions(NUMERIC, false, 15)
check(
  off.heelDeg === 0,
  'a leftover slider angle is NOT applied while the toggle is off',
  `heelDeg=${off.heelDeg}`,
)
const on = slotConditions(NUMERIC, true, 15)
check(
  on.heelDeg === 15,
  'the slider angle IS applied while the toggle is on',
  `heelDeg=${on.heelDeg}`,
)
check(slotConditions(NUMERIC, true, 0).heelDeg === 0, 'the toggle on at 0° applies 0°')
check(slotConditions(NUMERIC, false, 0).heelDeg === 0, 'the toggle off at 0° applies 0°')

// 2. The numeric fields travel through untouched.
check(
  off.weightKg === 75 && off.lcgPctLwl === 52 && off.kgMm === 280,
  'the numeric conditions travel through untouched',
  JSON.stringify(off),
)

// 3. A negative slider value is still the value (the range gate owns it).
check(
  slotConditions(NUMERIC, true, -12).heelDeg === -12,
  'a negative slider angle is applied as typed',
)

// 4. The equality the live claim and the stale flag rest on.
const base: SlotInputs = { weightKg: 75, lcgPctLwl: 52, kgMm: 280, heelDeg: 15 }
check(sameSlotInputs(base, { ...base }), 'identical conditions are the same solve')
check(
  !sameSlotInputs(base, { ...base, heelDeg: 0 }),
  'a different applied heel is a different solve',
)
check(!sameSlotInputs(base, { ...base, weightKg: 90 }), 'a different weight is a different solve')
check(!sameSlotInputs(base, { ...base, lcgPctLwl: 50 }), 'a different LCG is a different solve')
check(!sameSlotInputs(base, { ...base, kgMm: 300 }), 'a different KG is a different solve')

// 5. The panel's claim: the live result answers to the conditions it was
//    solved at, so a slot whose leftover heel is not applied still compares
//    equal to its own live answer.
const liveAt = slotConditions(NUMERIC, false, 15)
check(
  sameSlotInputs({ ...liveAt }, { ...liveAt }),
  'a live answer at the applied conditions matches itself',
)

// 6. `liveAnswerIsCurrent` — the panel's "Live — solved at the conditions
//    above" gate. A live result belongs to the conditions it was solved at,
//    so after an edit the panel renders once with the new conditions and the
//    old answer, and the claim would be a lie for that frame. `liveInputs` is
//    null exactly when there is no live answer, so it carries both facts.
check(!liveAnswerIsCurrent(null, base), 'no live answer is not a current live answer')
check(liveAnswerIsCurrent({ ...base }, { ...base }), 'an answer at the shown conditions is current')
check(
  !liveAnswerIsCurrent({ ...base, weightKg: 90 }, base),
  'an answer at other conditions is not current',
)
check(
  !liveAnswerIsCurrent({ ...base, heelDeg: 15 }, { ...base, heelDeg: 0 }),
  'an answer at a different applied heel is not current',
)
// The toggle-off case the panel used to get wrong: a numeric edit emitted the
// slider's raw value, so the answer's own conditions carried the leftover.
check(
  liveAnswerIsCurrent(slotConditions(NUMERIC, true, 15), slotConditions(NUMERIC, true, 15)),
  'a heeled answer matches the same heeled conditions',
)
check(
  !liveAnswerIsCurrent(slotConditions(NUMERIC, true, 15), slotConditions(NUMERIC, false, 15)),
  'a heeled answer does not match the toggle-off (upright) conditions',
)

// 7. `columnIsStale` — the table's "(re-solving)" marker. Two ways to be out
//    of date, and both are reported: a re-solve in flight, and conditions that
//    have moved on while the debounce is still waiting.
check(!columnIsStale(null, false, base), 'a column with no live answer is not stale')
check(!columnIsStale({ ...base }, false, { ...base }), 'a current answer is not stale')
check(
  columnIsStale({ ...base }, true, { ...base }),
  'a re-solve in flight is stale even at unchanged conditions',
)
check(
  columnIsStale({ ...base }, false, { ...base, weightKg: 90 }),
  'edited conditions with no answer yet are stale',
)
check(
  columnIsStale({ ...base }, false, { ...base, heelDeg: 0 }),
  'toggling the heel off after the answer leaves the column stale',
)
check(!columnIsStale(null, true, base), 'an empty column is never stale, even mid-solve')
// The two rules are independent: a solve in flight for the SAME conditions is
// stale, and one for different conditions is stale without a solve in flight.
check(
  columnIsStale({ ...base }, true, { ...base, lcgPctLwl: 50 }),
  'a re-solve at new conditions is stale',
)

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nAll Compare condition checks passed')
