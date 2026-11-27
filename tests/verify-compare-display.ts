// The Compare display seams: the angle-of-vanishing-stability cell, the
// overlay caption (`src/lib/compare.ts`) and the Difference block's stale note
// (`src/lib/compare-difference.ts`, rendered by `CompareDifference`).
//
// Both are pure TEXT that the table and the overlay render, and both were
// wrong in ways a browser check would not catch:
//
//   1. The AVS cell read "not within 0°" for a record whose run carried NO
//      GZ curve at all — an imported record whose document omits the
//      optional `gz_curve`. That is a stability claim ("the righting arm did
//      not vanish within 0°") about a curve that was never sampled, so the
//      cell must read "—" instead. A curve that WAS sampled and never had a
//      positive arm is a different case, and says so in its own words.
//
//   2. The overlay caption said "Both hulls sit on one shared waterline" over
//      an overlay that could hold one hull, or none — and a hull that was
//      loaded but not solved yet simply did not appear, with nothing on
//      screen saying why. It also counted a hull as solved from its RESULT
//      alone, so a record whose STL was not in memory (the state straight
//      after a reload, or after an import) read as two solved hulls over an
//      empty 3D view. The caption is now built from what the overlay DRAWS,
//      which needs BOTH an STL and a result.
//
//   3. And a DRAWN hull is not automatically a SOLVED one: a slot can keep a
//      record's snapshot on screen over a re-picked, different STL until the
//      new hull's own solve lands, so its picture was posed with numbers
//      solved from another hull while the caption said "the deeper hull
//      floats lower". The fifth state, `foreign-pose`, is drawn-but-not-
//      solved, and the shared-waterline line belongs to two SOLVED hulls
//      only.
//
//   4. That fifth state had a hole in it: the test required a NON-EMPTY mesh
//      hash, so a file the page could not hash at all (no `crypto.subtle` - a
//      plain-HTTP origin) fell through to `shown` and the caption claimed two
//      solved hulls on one waterline over an unidentified file. An empty hash
//      is not a match; `poseIsForeign` now owns the rule for both call sites,
//      and section 2d pins it.
//
//   5. The name over the numbers had the same shape of lie: after a "Use
//      anyway" re-pick the record stayed picked, so the table header and the
//      panel title kept the record's file name over a different hull's live
//      answer. `displayedName` / `displayedModelHash` own that rule for the
//      columns, the panel and the export, and section 3 pins it.
//
//   6. And the Difference block read the same lie in a whole sentence: its
//      bars, its two GZ curves, its A - B delta column and its verdict ("A
//      floats stiffer", "36.6 mm more initial stability") come from the two
//      answers on screen, which during every edit belong to a solve that has
//      already finished. The table's header said "(re-solving)" over those
//      very numbers while the block ahead of them presented them as the
//      current comparison, so the block now names the column that is behind
//      (`differenceStaleNote`, section 4). What the note CLAIMS follows what
//      else is on screen: one column behind does not mean the other slot is
//      empty, and with a second answer displayed the delta column and the
//      verdict are drawn from the pair - so the note has to claim them, and
//      to say they mix. Section 5 renders the real block, drives the flag the
//      table reads (`columnStale`) through it, and reads the call site,
//      because pinning a string factory proves nothing about the wiring that
//      puts it on screen: with the props deleted, or both wired to the same
//      column, every string check here still passes.
//
// Run: npm.cmd exec -- tsx tests/verify-compare-display.ts

import { readFileSync } from 'node:fs'
import * as React from 'react'
import {
  avsCellText,
  compareOverlayCaption,
  displayedModelHash,
  displayedName,
  poseIsForeign,
  recordConditionLabel,
} from '../src/lib/compare.js'
import { differenceStaleNote } from '../src/lib/compare-difference.js'
import { gzMarks } from '../src/lib/gz-marks.js'
import type { GZPoint, TrimSolveResult } from '../src/lib/hydrostatics.js'
import { SHA256_HEX_PATTERN } from '../src/lib/model-hash.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Curve from (angle, arm) pairs. */
const curve = (pairs: [number, number][]): GZPoint[] =>
  pairs.map(([heelDeg, GZ]) => ({ heelDeg, GZ }))

// --- 1. the angle-of-vanishing-stability cell --------------------------------

console.log('\n=== the AVS cell ===')

{
  // The imported-record case: the run-record format's `gz_curve` is optional,
  // so a document without one imports as a record with NO curve. There is
  // nothing to read, and "not within 0°" claims a sweep that never ran.
  const empty = avsCellText(gzMarks([]))
  check(empty === '—', 'a curve with no samples reads as an em dash', empty)
  check(!empty.includes('not within'), 'an unsampled curve claims no sweep', empty)

  // The interpolated crossing is the number the module computed.
  const crossing = avsCellText(
    gzMarks(
      curve([
        [0, 0],
        [5, 5],
        [10, 5],
        [15, -5],
      ]),
    ),
  )
  check(crossing === '12.5°', 'an interpolated vanishing angle is shown', crossing)

  // Stable at its last sample: the cell says HOW FAR the sweep went.
  const stable = avsCellText(
    gzMarks(
      curve([
        [0, 0],
        [5, 8.5],
        [10, 15.9],
        [45, 18],
      ]),
    ),
  )
  check(
    stable === 'not within 45°',
    'a curve still positive at its last sample says the range',
    stable,
  )

  // Sampled, but never a positive arm: there is no righting arm to vanish.
  const sinking = avsCellText(
    gzMarks(
      curve([
        [0, 0],
        [5, -1.1],
        [10, -2.7],
      ]),
    ),
  )
  check(sinking === 'no positive arm', 'a curve with no positive arm says so', sinking)

  // One sample at 0°: sampled, but with no arm either - the same wording as
  // the all-negative curve, and NOT the empty-curve em dash.
  const single = avsCellText(gzMarks(curve([[0, 0]])))
  check(single === 'no positive arm', 'a single 0° sample has no positive arm', single)
}

// --- 2. the overlay caption ---------------------------------------------------

console.log('\n=== the overlay caption ===')

/** Shorthand for the slot states the caption is built from. */
type Slot = 'empty' | 'loaded' | 'shown' | 'record-only' | 'foreign-pose'
const BOTH_LINE = 'Both hulls sit on one shared waterline — the deeper hull floats lower.'

{
  const empty = compareOverlayCaption({ a: 'empty', b: 'empty' })
  check(empty.includes('Load an STL'), 'an empty overlay says what to do', empty)
  check(!empty.includes('Both hulls'), 'an empty overlay does not claim two hulls', empty)

  // A loaded-but-unsolved hull is not a solved one, and it is named. The
  // sentence states what the picture holds (nothing for that slot), not what
  // a solve will do: after a FAILED solve no solve is coming, so promising
  // one is the same lie in the other direction.
  const loadedNotSolved = compareOverlayCaption({ a: 'loaded', b: 'empty' })
  check(loadedNotSolved.includes('Slot A'), 'an unsolved slot is named', loadedNotSolved)
  check(
    loadedNotSolved.includes('not drawn yet'),
    'an unsolved slot says it is not on screen',
    loadedNotSolved,
  )
  check(
    !loadedNotSolved.includes('not solved yet'),
    'an unsolved slot does not promise a solve that a failure will never deliver',
    loadedNotSolved,
  )
  check(
    loadedNotSolved.includes('Load an STL into Slot B'),
    'the empty slot is asked for its STL while something else is on screen',
    loadedNotSolved,
  )
  check(
    !loadedNotSolved.includes('Both hulls'),
    'one unsolved hull is not "both hulls"',
    loadedNotSolved,
  )

  const oneSolved = compareOverlayCaption({ a: 'shown', b: 'empty' })
  check(oneSolved.includes('One hull'), 'a single solved hull says one hull', oneSolved)
  check(
    oneSolved.includes('Load an STL into Slot B'),
    'a single solved hull asks for the other slot',
    oneSolved,
  )
  check(!oneSolved.includes('Both hulls'), 'a single solved hull is not "both hulls"', oneSolved)

  const bothSolved = compareOverlayCaption({ a: 'shown', b: 'shown' })
  check(bothSolved === BOTH_LINE, 'two solved hulls keep the shared-waterline caption', bothSolved)

  // One solved, one loaded but not solved: both facts have to be on screen.
  const mixed = compareOverlayCaption({ a: 'shown', b: 'loaded' })
  check(mixed.includes('Slot B'), 'the unsolved slot is named', mixed)
  check(mixed.includes('One hull'), 'the solved hull is counted honestly', mixed)
}

// --- 2b. the caption describes what is DRAWN, not what exists -----------------
//
// The overlay draws a hull only when a slot holds BOTH an STL and a result, so
// a record whose STL is not in memory — a reloaded roster, or a fresh import —
// contributes nothing to the picture. Counting it as solved put "Both hulls
// sit on one shared waterline" over an empty canvas, which is the exact claim
// this caption exists to stop.

console.log('\n=== the caption reads the drawn hulls ===')

{
  // One record-only, one empty: the primary import state. Nothing is drawn.
  const recordOnly = compareOverlayCaption({ a: 'record-only', b: 'empty' })
  check(
    recordOnly.includes("Slot A's numbers are shown, but its STL is not loaded."),
    'a record with no STL says its numbers are shown without its hull',
    recordOnly,
  )
  check(
    !recordOnly.includes('One hull is solved'),
    'a record-only slot is not counted as a solved hull',
    recordOnly,
  )
  check(!recordOnly.includes('Both hulls'), 'one record-only slot is not "both hulls"', recordOnly)
  check(
    recordOnly.includes('Load an STL into Slot B'),
    'the empty slot is still asked for its STL',
    recordOnly,
  )

  // Both records, no STLs: the state right after a reload. An empty 3D view.
  const bothRecordOnly = compareOverlayCaption({ a: 'record-only', b: 'record-only' })
  check(
    bothRecordOnly.includes("Slot A's numbers are shown, but its STL is not loaded.") &&
      bothRecordOnly.includes("Slot B's numbers are shown, but its STL is not loaded."),
    'both record-only slots are described',
    bothRecordOnly,
  )
  check(
    bothRecordOnly !== BOTH_LINE,
    'two record-only slots NEVER claim the shared waterline',
    bothRecordOnly,
  )
  check(
    !bothRecordOnly.includes('Both hulls'),
    'two record-only slots do not claim "both hulls"',
    bothRecordOnly,
  )

  // A record-only slot beside a drawn one: one hull on screen, and the other's
  // numbers without its geometry.
  const mixed = compareOverlayCaption({ a: 'shown', b: 'record-only' })
  check(mixed.includes('One hull is solved'), 'the drawn hull is counted', mixed)
  check(
    mixed.includes("Slot B's numbers are shown, but its STL is not loaded."),
    'the record-only slot is described rather than counted',
    mixed,
  )

  const mirrored = compareOverlayCaption({ a: 'record-only', b: 'shown' })
  check(mirrored.includes('One hull is solved'), 'the drawn hull is counted in B', mirrored)
  check(
    mirrored.includes("Slot A's numbers are shown, but its STL is not loaded."),
    'the record-only slot is described rather than counted in A',
    mirrored,
  )

  // An empty slot beside a record-only one is still worth asking for.
  const emptyBesideRecord = compareOverlayCaption({ a: 'empty', b: 'record-only' })
  check(
    emptyBesideRecord.includes('Load an STL into Slot A'),
    'an empty slot is asked for its STL beside a record',
    emptyBesideRecord,
  )
  check(
    !emptyBesideRecord.includes('One hull is solved'),
    'a record beside an empty slot is not a solved hull',
    emptyBesideRecord,
  )
}

// --- 2d. drawn is not solved: a hull posed with ANOTHER hull's numbers ---------
//
// A slot holding record R can draw a DIFFERENT STL: the re-pick keeps the
// record's snapshot on screen until the new hull's own solve lands. The picture
// is real, but the pose on it was solved from R's hull - so counting that pair
// as two solved hulls would put "the deeper hull floats lower" over a
// comparison of one hull with another hull's answer, and it contradicted the
// slot's own note ("the numbers above are that record's, posed on the file
// below").

console.log('\n=== a drawn hull is not a solved hull ===')

{
  // One solved, one foreign: one hull's own solve beside one hull drawn under
  // another hull's numbers.
  const mixed = compareOverlayCaption({ a: 'shown', b: 'foreign-pose' })
  check(
    mixed.includes('One hull is solved'),
    'a foreign pose next to a solved hull counts only the solved one',
    mixed,
  )
  check(mixed.includes('Slot B'), 'the foreign slot is named', mixed)
  check(
    mixed.includes('not known to be'),
    'the foreign slot says its numbers are not known to describe this hull',
    mixed,
  )
  check(
    mixed !== BOTH_LINE && !mixed.includes('Both hulls'),
    'a foreign pose next to a solved hull is not "both hulls"',
    mixed,
  )

  // Two foreign poses: two hulls on screen, neither one's own answer, and the
  // shared-waterline line - whose order comes from the numbers - must stay off.
  const bothForeign = compareOverlayCaption({ a: 'foreign-pose', b: 'foreign-pose' })
  check(
    bothForeign.includes('Slot A') && bothForeign.includes('Slot B'),
    'both foreign slots are described',
    bothForeign,
  )
  check(
    bothForeign !== BOTH_LINE && !bothForeign.includes('Both hulls'),
    'two foreign poses never claim the shared waterline',
    bothForeign,
  )

  // A foreign pose is DRAWN, so it is not asked for its STL the way a
  // record-only slot is - the file is on screen, it is the numbers that are
  // someone else's.
  const foreignBesideRecord = compareOverlayCaption({ a: 'foreign-pose', b: 'record-only' })
  check(
    !foreignBesideRecord.includes('Load an STL into Slot A'),
    'a drawn foreign pose is not asked for an STL',
    foreignBesideRecord,
  )
  check(
    !foreignBesideRecord.includes('One hull is solved'),
    'a foreign pose is not counted as a solved hull',
    foreignBesideRecord,
  )
  check(
    foreignBesideRecord.includes("Slot B's numbers are shown, but its STL is not loaded."),
    'the record-only slot is still described beside a foreign pose',
    foreignBesideRecord,
  )
}

// --- 2c. the sweep: every combination, one invariant -------------------------
//
// Whatever the pair of states, the caption may only claim a hull is solved when
// that hull's OWN answer is on screen. DRAWN and SOLVED are different counts -
// a `foreign-pose` slot is drawn - so the sweep keeps them apart: the count
// that licenses "One hull is solved" and the shared-waterline line is the
// SOLVED one, and every foreign pose is named as foreign so another hull's
// numbers can never pass as this one's.

console.log('\n=== the caption invariant sweep ===')

{
  const slots: Slot[] = ['empty', 'loaded', 'shown', 'record-only', 'foreign-pose']
  const solved = (view: Slot) => (view === 'shown' ? 1 : 0)
  const foreign = (view: Slot) => (view === 'foreign-pose' ? 1 : 0)
  let cases = 0
  let bad = 0
  for (const a of slots) {
    for (const b of slots) {
      const text = compareOverlayCaption({ a, b })
      const solvedCount = solved(a) + solved(b)
      const foreignCount = foreign(a) + foreign(b)
      cases++
      const claimsBoth = text.includes('Both hulls')
      const claimsOne = text.includes('One hull is solved')
      if (solvedCount === 2 && (!claimsBoth || text !== BOTH_LINE)) {
        bad++
        console.log(`  FAIL ${a}+${b} — two solved hulls must claim the shared waterline: ${text}`)
      }
      if (solvedCount !== 2 && claimsBoth) {
        bad++
        console.log(
          `  FAIL ${a}+${b} — the shared waterline needs two SOLVED hulls, caption says: ${text}`,
        )
      }
      if (solvedCount === 1 && (!claimsOne || claimsBoth)) {
        bad++
        console.log(`  FAIL ${a}+${b} — one solved hull, caption says: ${text}`)
      }
      if (solvedCount !== 1 && claimsOne) {
        bad++
        console.log(`  FAIL ${a}+${b} — nothing solved, caption says one hull is: ${text}`)
      }
      // A foreign pose IS drawn, so the caption names it; and it says the
      // numbers are not known to be this hull's, which is the whole point of
      // the state.
      for (const [label, view] of [
        ['A', a],
        ['B', b],
      ] as Array<[string, Slot]>) {
        if (view === 'foreign-pose' && !text.includes(`Slot ${label}'s STL is drawn`)) {
          bad++
          console.log(`  FAIL ${a}+${b} — Slot ${label} is foreign but unnamed: ${text}`)
        }
      }
      if (foreignCount === 0 && text.includes('not known to be')) {
        bad++
        console.log(`  FAIL ${a}+${b} — no foreign pose, caption says one: ${text}`)
      }
      if (text.trim() === '') {
        bad++
        console.log(`  FAIL ${a}+${b} — empty caption`)
      }
    }
  }
  failures += bad
  check(bad === 0, `all ${cases} slot combinations caption what they draw`, `${bad} bad`)
}

// --- 2d. the foreign-pose predicate: an unhashed mesh is not a match -------

console.log('\n=== the foreign-pose predicate ===')

{
  // The overlay's slot state and the panel's note both come from this one
  // predicate, and the EMPTY-hash rule is what keeps the shared-waterline line
  // honest. A page with no `crypto.subtle` (a plain-HTTP origin) cannot hash an
  // STL at all - `Upload.tsx` stores '' and raises SECURE_CONTEXT_ERROR - and
  // "the hashes agree" can never be established for such a file. Treating that
  // as a MATCH is the regression this section pins: import a run (its record
  // carries a real hash), load any STL into that slot, and the caption claimed
  // two solved hulls on one waterline over a file nothing identified.
  const A = 'a'.repeat(64)
  const B = 'b'.repeat(64)
  check(poseIsForeign(null, A, false) === false, 'no mesh in memory is not a foreign pose')
  check(poseIsForeign(A, A, false) === false, "the record's own hull is not a foreign pose")
  check(poseIsForeign(B, A, false), 'a different hash is a foreign pose')
  check(
    poseIsForeign('', A, false),
    "an unhashed mesh is NOT the record's hull either - an empty hash is not a match",
  )
  check(poseIsForeign('', null, false) === false, 'no record to mismatch means no foreign pose')
  check(
    poseIsForeign(B, A, true) === false,
    'a live answer belongs to the mesh in memory, so it is never foreign',
  )
  // The reason "two empty hashes" cannot happen: `recordFromSolve` and the
  // import both gate modelHash on the SHA-256 pattern, so a stored record
  // always carries a real one and only the MESH's hash can be empty.
  check(
    SHA256_HEX_PATTERN.test(A) && !SHA256_HEX_PATTERN.test(''),
    "a record's hash is never the empty one, so an empty match cannot arise",
  )
}

// --- 3. the caption's NAME rule: the live answer's own mesh names it ---------

console.log('\n=== the displayed name is the hull the numbers describe ===')

{
  // The re-pick path's "Use anyway" keeps the record picked while a DIFFERENT
  // mesh is in the slot. Once that mesh's live answer lands, the column and
  // the panel show ITS numbers, so they must carry ITS name and hash - the
  // record's name over them was a real mislabel (a box hull's draft under
  // "test-kayak.stl"). Export already read the mesh first; these helpers are
  // that rule for every caption.
  const rec = { name: 'test-kayak.stl', modelHash: 'a'.repeat(64) }
  const own = { fileName: 'box-hull.stl', sha256Hex: 'b'.repeat(64) }
  const empty = { live: null, mesh: null }

  check(displayedName({ live: {}, mesh: own }, rec) === 'box-hull.stl', 'live: the mesh names it')
  check(
    displayedModelHash({ live: {}, mesh: own }, rec) === own.sha256Hex,
    'live: the mesh hash pairs with it',
  )
  check(
    displayedName({ live: null, mesh: own }, rec) === 'test-kayak.stl',
    'record-only: the record names it',
  )
  check(
    displayedModelHash({ live: null, mesh: own }, rec) === rec.modelHash,
    'record-only: the record hash pairs with it',
  )
  check(displayedName(empty, null) === null, 'empty slot: no name')
  check(displayedModelHash(empty, null) === null, 'empty slot: no hash')
  check(
    displayedName({ live: null, mesh: own }, null) === 'box-hull.stl',
    'mesh only: its file name',
  )

  // F3: the picker's second line. Two runs of one hull used to render
  // identically, so the conditions are what tells them apart.
  check(
    recordConditionLabel({ weightKg: 75, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }) ===
      '75 kg · LCG 52% · KG 280 mm',
    'the roster label carries the conditions',
  )
  check(
    recordConditionLabel({ weightKg: 85, lcgPctLwl: 52, kgMm: 280, heelDeg: 10 }) ===
      '85 kg · LCG 52% · KG 280 mm · heel +10°',
    'two runs of one hull differ in their label',
  )
}

// --- 4. the Difference block's stale note -------------------------------------

console.log('\n=== the Difference block names the column that is behind ===')

{
  // The block's bars, its two righting-arm curves, its delta column and its
  // verdict sentence are all derived from the two answers on screen, and while
  // a column is stale those belong to its LAST COMPLETED solve:
  // `columnIsStale` is true from the first keystroke until the new answer
  // lands (the ~300 ms debounce, then the sweep). For roughly a second per
  // edit the delta column and "A floats stiffer" were that comparison
  // presented as the current one, with nothing on screen saying so - the
  // table's header had said "(re-solving)" over the very same numbers. The
  // note is the block's own version of that, and the wording is pinned here so
  // a bare "show the note whenever the solve is running" cannot drop the
  // column it names, or the scope it covers. That scope is what else is on
  // screen: with the other slot empty the block draws the stale column's own
  // bars and curve and nothing else, while with two answers displayed it also
  // draws the delta column and the verdict, both computed from the stale
  // column's numbers - so the one-sided wording is pinned in BOTH shapes.
  const note = differenceStaleNote

  check(note(false, false, false) === null, 'no stale column: no note at all')
  check(note(false, false, true) === null, 'no stale column: none with two results either')

  // One column behind, the OTHER SLOT EMPTY. The block then draws only the
  // stale column's own numbers: `differenceVerdict` is null without both
  // results and the block hides its `A - B` heading, so there is no delta
  // column and no verdict on screen to claim.
  const onlyA = note(true, false, false)
  check(onlyA !== null, 'A stale, B empty: a note appears')
  check(onlyA?.includes('A is re-solving') === true, 'A stale, B empty: A is named', onlyA ?? '')
  check(
    onlyA?.includes('B') !== true,
    'A stale, B empty: B is not named - nothing of its is on screen',
    onlyA ?? '',
  )
  check(
    onlyA?.includes('A and B') !== true,
    'A stale, B empty: not the both-columns wording',
    onlyA ?? '',
  )

  const onlyB = note(false, true, false)
  check(onlyB?.includes('B is re-solving') === true, 'B stale, A empty: B is named', onlyB ?? '')
  check(onlyB?.includes('A') !== true, 'B stale, A empty: A is not named', onlyB ?? '')
  check(
    onlyB?.includes('A and B') !== true,
    'B stale, A empty: not the both-columns wording',
    onlyB ?? '',
  )

  // One column behind, the OTHER SIDE HOLDING AN ANSWER - the common
  // comparison: edit a condition in slot A while slot B holds a solve. Both
  // answers are on screen, so the block draws the delta column and the
  // verdict sentence, and BOTH are computed from the stale column's numbers.
  // The narrowing wording - "the other side is current, and with the other
  // slot empty there is nothing else on screen to claim" - is false exactly
  // here, and it left the delta column and the verdict, the two artifacts
  // that visibly change when the new solve lands, reading as the current
  // comparison. The note now claims them, and says they MIX.
  const mixedA = note(true, false, true)
  check(mixedA !== null, 'A stale beside B: a note appears')
  check(mixedA?.includes('A is re-solving') === true, 'A stale beside B: A is named', mixedA ?? '')
  check(
    mixedA?.includes("B's current answer") === true,
    'A stale beside B: the other column is named as current',
    mixedA ?? '',
  )
  check(
    mixedA?.includes('delta') === true,
    'A stale beside B: the delta column is claimed',
    mixedA ?? '',
  )
  check(
    mixedA?.includes('verdict') === true,
    'A stale beside B: the verdict is claimed',
    mixedA ?? '',
  )
  check(
    mixedA?.includes('mix') === true,
    'A stale beside B: the mixing is said, not implied',
    mixedA ?? '',
  )

  const mixedB = note(false, true, true)
  check(mixedB?.includes('B is re-solving') === true, 'B stale beside A: B is named', mixedB ?? '')
  check(
    mixedB?.includes("A's current answer") === true,
    'B stale beside A: the other column is named as current',
    mixedB ?? '',
  )

  const both = note(true, true, true)
  check(both?.includes('A and B are re-solving') === true, 'both stale: both are named', both ?? '')
  check(both?.includes('their') === true, 'both stale: plural possessive', both ?? '')

  // PROVENANCE, not recency. `columnIsStale` has two legs and only one of them
  // means the numbers are out of date: a value edited and then edited BACK
  // leaves the answer on screen being the answer to the current conditions
  // while a solve is still in flight, so "previous answers" would be a lie in
  // that window. "Last completed solve" is true of every case the flag
  // covers, because `live` is only ever written by a solve that finished.
  for (const [label, text] of [
    ['A', onlyA],
    ['B', onlyB],
    ['A beside B', mixedA],
    ['B beside A', mixedB],
    ['both', both],
  ] as const) {
    check(
      text?.includes('last completed solve') === true,
      `${label}: the numbers are attributed to the solve that produced them`,
      text ?? '',
    )
    check(
      text?.includes('previous answer') !== true,
      `${label}: it does not claim the numbers are old - they may be current`,
      text ?? '',
    )
  }

  // SCOPE. What the note claims is what the block draws beside the stale
  // column, so the one-sided wording is TWO cases, not one: with the other
  // slot empty the block draws that column's own bars and curve and nothing
  // else, while with two answers on screen it also draws the delta column and
  // the verdict - and both are computed from the stale column's numbers.
  for (const [label, text] of [
    ['A', onlyA],
    ['B', onlyB],
  ] as const) {
    check(text?.includes('its ') === true, `${label}: the scope is that column's own`, text ?? '')
    check(text?.includes('their') !== true, `${label}: not the both-columns possessive`, text ?? '')
    check(text?.includes('bars') === true, `${label}: the bars are in scope`, text ?? '')
    check(text?.includes('curve') === true, `${label}: that column's curve is in scope`, text ?? '')
    check(
      text?.includes('curves') !== true,
      `${label}: it claims no second curve - one is on screen`,
      text ?? '',
    )
    check(
      text?.includes('delta') !== true,
      `${label}: no delta column with the other slot empty`,
      text ?? '',
    )
    check(
      text?.includes('verdict') !== true,
      `${label}: no verdict with the other slot empty`,
      text ?? '',
    )
  }
  for (const [label, text] of [
    ['A beside B', mixedA],
    ['B beside A', mixedB],
  ] as const) {
    check(
      text?.includes('its ') === true,
      `${label}: the scope opens with that column's own`,
      text ?? '',
    )
    check(text?.includes('their') !== true, `${label}: not the both-columns possessive`, text ?? '')
    check(text?.includes('bars') === true, `${label}: the bars are in scope`, text ?? '')
    check(text?.includes('curve') === true, `${label}: that column's curve is in scope`, text ?? '')
    check(
      text?.includes('curves') !== true,
      `${label}: it claims no second curve of its - one is on screen`,
      text ?? '',
    )
    check(text?.includes('delta') === true, `${label}: the delta column is in scope`, text ?? '')
    check(text?.includes('verdict') === true, `${label}: the verdict is in scope`, text ?? '')
  }

  check(
    both?.includes('bars, curves, delta and verdict') === true,
    'both: all four are in scope',
    both ?? '',
  )
  check(
    mixedA?.includes(' — ') === true,
    'the separator is the em dash the verdict sentence uses',
    mixedA ?? '',
  )
  check(onlyA?.includes(' — ') === true, 'the same separator in the one-sided wording', onlyA ?? '')
}

// --- 5. the wiring: the block renders it, and the caller passes the flags -----

console.log('\n=== the note reaches the screen, and the flags are the ones the table reads ===')

// A pinned string factory proves nothing about the wiring. Delete the props,
// or wire both to the same column, and every string check in section 4 still
// passes - which is exactly the regression this change exists to prevent. So
// render the real block, then read the real call site - and this time drive
// the block with the flag the table actually reads, computed by `columnStale`
// over real slot states, so the join between the two is exercised at runtime
// rather than inferred from source text.
//
// tsx compiles the src components with the CLASSIC JSX transform, which emits
// `React.createElement`, so the imported component module looks for a global
// `React` when it is evaluated. It has to exist before that, hence the
// dynamic imports rather than top-level ones. `CompareDifference` pulls in
// `Viewer3D` for `SLOT_COLORS`, and three loads fine in Node as long as
// nothing calls into a renderer - nothing here does. `CompareView` loads the
// same way; importing it costs the rest of the Compare module graph (the
// panels, the stage, the chart) and touches no browser global at import time.
;(globalThis as { React?: unknown }).React = React
const { renderToStaticMarkup } = await import('react-dom/server')
const { default: CompareDifference } = await import('../src/components/CompareDifference.js')
const { columnStale } = await import('../src/components/CompareView.js')

// Stand-in runs. Only the fields the block reads are filled in: the six bars
// pick draft/trim/GM/GZ-peak/AVS/LWL, and the verdict sentence reads GM, draft
// and displacement. Nothing the note describes reads anything else.
const staleResult = {
  trimDeg: 1.2,
  draftMm: 128,
  displacementKg: 75,
  GM: 107,
  LWL: 2212,
  gzCurve: [
    { heelDeg: 0, GZ: 0 },
    { heelDeg: 5, GZ: 8.9 },
    { heelDeg: 45, GZ: -9.6 },
  ],
} as unknown as TrimSolveResult

// The OTHER column's answer, current: different enough for the verdict to
// have something to say, so "the verdict sentence really is on screen" is a
// claim about the rendered markup rather than about an empty box.
const liveResult = {
  ...staleResult,
  draftMm: 120,
  displacementKg: 70,
  GM: 130,
} as unknown as TrimSolveResult

const renderBlock = (
  staleA: boolean,
  staleB: boolean,
  a: TrimSolveResult,
  b: TrimSolveResult | null,
) =>
  renderToStaticMarkup(
    React.createElement(CompareDifference, {
      a,
      b,
      conditions: [],
      staleA,
      staleB,
    }),
  )

const cleanMarkup = renderBlock(false, false, staleResult, null)
check(cleanMarkup.includes('re-solving') !== true, 'rendered: nothing said when nothing is stale')
// The live region is mounted permanently, not with its first text: a region
// inserted together with its content is not reliably announced, and this is
// the disclosure that has to reach a screen-reader user mid-edit. An empty
// note therefore leaves an EMPTY region behind, with no styling to show.
check(cleanMarkup.includes('role="status"') === true, 'rendered: the live region is always mounted')
check(/<p role="status"[^>]*><\/p>/.test(cleanMarkup), 'rendered: the empty region holds no text')
check(cleanMarkup.includes('border-warn') !== true, 'rendered: an empty note carries no styling')

const staleMarkup = renderBlock(true, false, staleResult, null)
check(staleMarkup.includes('A is re-solving') === true, 'rendered: the note reaches the markup')
check(
  (staleMarkup.match(/role="status"/g) ?? []).length === 1,
  'rendered: one note, not one per row',
)
check(staleMarkup.includes('border-warn') === true, 'rendered: a note is styled as a warning')
// Above the dimmed rows, not inside them: it qualifies those numbers, so
// dimming it with them would dim the disclosure about them.
check(
  staleMarkup.indexOf('role="status"') < staleMarkup.indexOf('opacity-40'),
  'rendered: the note sits outside the dimmed rows it describes',
)
check(
  staleMarkup.includes('delta') !== true,
  'rendered: with the other slot empty the note claims no delta',
)
check(
  staleMarkup.includes('verdict') !== true,
  'rendered: with the other slot empty the note claims no verdict',
)
// React's static markup escapes the apostrophe into its HTML entity, so the
// string the DOM sees is not the plain one. The wording itself is pinned
// unescaped in section 4, once; the checks below read the markup as it is
// rendered.
check(
  staleMarkup.includes('B&#x27;s current answer') !== true,
  'rendered: with the other slot empty B is not named',
)

// The one-sided case with the other side HOLDING an answer - the shape the
// old wording got wrong. The rendered block really does draw the delta column
// and the verdict sentence in this state, both computed from the stale
// column's numbers, so the note has to claim them; naming them as absent
// here would be the same lie the block exists to stop.
const mixedMarkup = renderBlock(true, false, staleResult, liveResult)
check(
  mixedMarkup.includes('A is re-solving') === true,
  'rendered: a stale column beside a live one still names itself',
)
check(mixedMarkup.includes('A − B') === true, 'rendered: the delta column really is on screen')
check(mixedMarkup.includes('floats stiffer') === true, 'rendered: the verdict really is on screen')
check(mixedMarkup.includes('delta') === true, 'rendered: the note claims the delta column')
check(mixedMarkup.includes('verdict') === true, 'rendered: the note claims the verdict')

check(
  mixedMarkup.includes('B&#x27;s current answer') === true,
  'rendered: the note says whose answer it is mixed with',
)

const bMarkup = renderBlock(false, true, liveResult, staleResult)
check(bMarkup.includes('B is re-solving') === true, 'rendered: B naming B')
check(bMarkup.includes('A is re-solving') !== true, 'rendered: and not A')
check(
  bMarkup.includes('A&#x27;s current answer') === true,
  'rendered: the mirrored mixed case names A as current',
)

const bothMarkup = renderBlock(true, true, staleResult, liveResult)
check(bothMarkup.includes('A and B are re-solving') === true, 'rendered: both stale names both')
check(
  bothMarkup.includes('bars, curves, delta and verdict') === true,
  'rendered: the both-case claims the delta and the verdict too',
)

// The join the regexes below cannot see. The flags the table reads are
// `columnStale`'s, computed once in `columnA` / `columnB`; the note is
// rendered from those two values and nothing else. Slot A has answered at
// 75 kg and its weight field now reads 90 (the edit); slot B has answered at
// the conditions it shows.
const inputs75 = { weightKg: 75, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }
const inputs80 = { weightKg: 80, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }
const inputs90 = { weightKg: 90, lcgPctLwl: 52, kgMm: 280, heelDeg: 0 }
const slotA = {
  recordId: null,
  mesh: null,
  inputs: inputs90,
  live: staleResult,
  liveInputs: inputs75,
  solving: false,
  progress: null,
  error: null,
  pickSeq: 0,
}
const slotB = {
  recordId: null,
  mesh: null,
  inputs: inputs80,
  live: liveResult,
  liveInputs: inputs80,
  solving: false,
  progress: null,
  error: null,
  pickSeq: 0,
}
check(columnStale(slotA) === true, 'columnStale: an edited column is behind')
check(columnStale(slotB) === false, 'columnStale: an unedited column is current')
// The in-flight leg: a solve running with the fields UNCHANGED still marks
// the column, and the note still says its numbers are the last completed
// solve's - true there too, and the reason the wording is provenance rather
// than recency.
check(columnStale({ ...slotB, solving: true }) === true, 'columnStale: an in-flight solve is stale')
// A slot with no live answer at all is never stale: `columnIsStale` reads
// false without one, so a record snapshot on screen carries no marker.
check(
  columnStale({ ...slotB, live: null, liveInputs: null }) === false,
  'columnStale: a record snapshot with no live answer is not stale',
)
const wiredMarkup = renderBlock(columnStale(slotA), columnStale(slotB), staleResult, liveResult)
check(
  wiredMarkup.includes('B&#x27;s current answer') === true,
  "rendered: the table's own flags produce the mixed-case note",
)
check(wiredMarkup.includes('A is re-solving') === true, 'rendered: and name the edited column')

// The call site: the block is handed the same `columnIsStale` the table header
// reads, computed once in `columnA` / `columnB` and never re-derived here.
const viewSource = new TextDecoder().decode(
  readFileSync(new URL('../src/components/CompareView.tsx', import.meta.url)),
)
check(/staleA=\{columnA\.stale\}/.test(viewSource), 'the call site passes column A staleness')
check(/staleB=\{columnB\.stale\}/.test(viewSource), 'the call site passes column B staleness')
check(
  (viewSource.match(/staleA=\{/g) ?? []).length === 1 &&
    (viewSource.match(/staleB=\{/g) ?? []).length === 1,
  'the call site passes each flag exactly once',
)

const blockSource = new TextDecoder().decode(
  readFileSync(new URL('../src/components/CompareDifference.tsx', import.meta.url)),
)
check(
  /const staleNote = differenceStaleNote\(staleA, staleB, both\)/.test(blockSource),
  'the block derives the note from its two props and what is on screen',
)

console.log(
  failures === 0 ? '\nALL DISPLAY CHECKS PASSED' : `\n${failures} DISPLAY CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
