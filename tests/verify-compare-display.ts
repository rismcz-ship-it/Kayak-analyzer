// The Compare display seams: the angle-of-vanishing-stability cell and the
// overlay caption (`src/lib/compare.ts`).
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
// Run: npm.cmd exec -- tsx tests/verify-compare-display.ts

import { avsCellText, compareOverlayCaption, poseIsForeign } from '../src/lib/compare.js'
import { gzMarks } from '../src/lib/gz-marks.js'
import type { GZPoint } from '../src/lib/hydrostatics.js'
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

console.log(
  failures === 0 ? '\nALL DISPLAY CHECKS PASSED' : `\n${failures} DISPLAY CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
