// Task 9 gate — the pure GZ-curve marks the panel's warning and the chart's
// markers both read (`src/lib/gz-marks.ts`).
//
// Both consumers call it, so a wrong answer here is either a false safety
// statement in the warning box or a marker drawn where stability does not
// vanish. Three properties are pinned:
//
//   1. AVS is the INTERPOLATED zero crossing after the peak, not the first
//      sample at or below zero. Reporting the sample would overstate the
//      vanishing angle by up to one 5 deg step — the unsafe direction for a
//      stability number.
//   2. A curve with no positive arm has no peak. Its 0 deg anchor is GZ = 0 by
//      construction, so picking it as "GZ_max" would claim stability the hull
//      does not have.
//   3. The scan starts AFTER the peak. The 0 deg anchor is itself GZ = 0, so a
//      scan from the start would report zero heel as the vanishing angle.
//
// The committed hull supplies one real curve: at 75 kg it peaks at 20 deg and
// crosses zero between 40 and 45 deg.
//
// Run: npm.cmd exec -- tsx tests/verify-gz-marks.ts

import { readFileSync } from 'node:fs'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { autoOrientToZUp, centerToOrigin, decimateMesh } from '../src/lib/geometry.js'
import { gzMarks } from '../src/lib/gz-marks.js'
import type { GZPoint } from '../src/lib/hydrostatics.js'
import { DEFAULT_KG_MM, solveTrim } from '../src/lib/hydrostatics.js'

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(34)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

/** Curve from (angle, arm) pairs. */
const curve = (pairs: [number, number][]): GZPoint[] =>
  pairs.map(([heelDeg, GZ]) => ({ heelDeg, GZ }))

// ---------------------------------------------------------------------------
console.log('=== 1. the degenerate and empty curves ===')
{
  const empty = gzMarks([])
  check('empty curve -> no marks', empty.gzMax === null && empty.avsDeg === null, 'both null')
  check('empty curve -> maxHeelDeg 0', empty.maxHeelDeg === 0, `${empty.maxHeelDeg}`)

  const single = gzMarks(curve([[0, 0]]))
  check('single point -> no peak', single.gzMax === null, `${single.gzMax}`)
  check('single point -> maxHeelDeg 0', single.maxHeelDeg === 0, `${single.maxHeelDeg}`)

  const flat = gzMarks(
    curve([
      [0, 0],
      [5, 0],
      [10, 0],
    ]),
  )
  check('all-zero curve -> no peak', flat.gzMax === null, `${flat.gzMax}`)
  check('all-zero curve -> no AVS', flat.avsDeg === null, `${flat.avsDeg}`)
  check('all-zero curve -> maxHeelDeg 10', flat.maxHeelDeg === 10, `${flat.maxHeelDeg}`)

  // Every sample at or below zero: the hull has no righting arm at all.
  const sinking = gzMarks(
    curve([
      [0, 0],
      [5, -1.1],
      [10, -2.7],
    ]),
  )
  check('all-negative curve -> no peak', sinking.gzMax === null, `${sinking.gzMax}`)
  check('all-negative curve -> no AVS', sinking.avsDeg === null, `${sinking.avsDeg}`)
  check('all-negative curve -> maxHeelDeg 10', sinking.maxHeelDeg === 10, `${sinking.maxHeelDeg}`)
}

// ---------------------------------------------------------------------------
console.log('=== 2. the peak ===')
{
  // Two samples share the maximum: the first one wins, so the marker sits at
  // the leanest angle that reaches it.
  const tied = gzMarks(
    curve([
      [0, 0],
      [5, 10],
      [10, 10],
      [15, 4],
      [20, -1],
    ]),
  )
  check(
    'tie on the max -> the first',
    tied.gzMax?.heelDeg === 5,
    `peak at ${tied.gzMax?.heelDeg} deg`,
  )
  check('tie on the max -> the value', tied.gzMax?.GZ === 10, `GZ ${tied.gzMax?.GZ} mm`)

  // Peak as the last sample: nothing after it to vanish at.
  const monotone = gzMarks(
    curve([
      [0, 0],
      [5, 10],
      [10, 20],
    ]),
  )
  check('peak last -> GZ_max 20@10', monotone.gzMax?.GZ === 20, `GZ ${monotone.gzMax?.GZ} mm`)
  check('peak last -> no AVS', monotone.avsDeg === null, `${monotone.avsDeg}`)
}

// ---------------------------------------------------------------------------
console.log('=== 3. AVS is the interpolated crossing ===')
{
  // Crossing exactly halfway between 10 (+5) and 15 (-5).
  const mid = gzMarks(
    curve([
      [0, 0],
      [5, 5],
      [10, 5],
      [15, -5],
    ]),
  )
  check('linear crossing at 12.5 deg', mid.avsDeg === 12.5, `AVS ${mid.avsDeg} deg`)

  // 1.5/(1.5 + 9.6) = 0.135 of the way from 40 to 45.
  const lean = gzMarks(
    curve([
      [0, 0],
      [5, 8.5],
      [40, 1.5],
      [45, -9.6],
    ]),
  )
  check(
    'lean crossing at 40.7 deg',
    Math.abs((lean.avsDeg ?? 0) - 40.6757) < 1e-3,
    `AVS ${lean.avsDeg}`,
  )

  // The crossing at the sample itself must not be pushed off by rounding.
  const exact = gzMarks(
    curve([
      [0, 0],
      [5, 5],
      [10, 0],
      [15, -5],
    ]),
  )
  check('zero exactly on a sample', exact.avsDeg === 10, `AVS ${exact.avsDeg} deg`)

  // A curve with no positive arm has no peak, so there is no AVS to report at
  // all: the null is the honest answer, not a skipped sample.
  const instant = gzMarks(
    curve([
      [0, 0],
      [5, -1.1],
    ]),
  )
  check('no positive arm -> no AVS', instant.avsDeg === null, `${instant.avsDeg}`)
}

// ---------------------------------------------------------------------------
console.log('=== 4. the scan starts after the peak ===')
{
  // The 0 deg anchor is GZ = 0. A scan from the start would report it as the
  // vanishing angle and every curve would look unstable at once.
  const normal = gzMarks(
    curve([
      [0, 0],
      [5, 8.5],
      [10, 15.9],
      [45, 18],
    ]),
  )
  check('0 deg anchor is not the AVS', normal.avsDeg === null, `AVS ${normal.avsDeg}`)
  check(
    'peak is the 18 mm sample',
    normal.gzMax?.heelDeg === 45,
    `peak at ${normal.gzMax?.heelDeg} deg`,
  )
}

// ---------------------------------------------------------------------------
console.log('=== 5. the committed hull, 75 kg ===')
{
  const buffer = readFileSync(new URL('./test-kayak.stl', import.meta.url))
  const geometry = new STLLoader().parse(buffer.buffer as ArrayBuffer)
  const oriented = geometry.getAttribute('position').array as Float32Array
  autoOrientToZUp(oriented)
  centerToOrigin(oriented)
  const mesh = decimateMesh(oriented, 12000)
  const result = solveTrim(mesh, 75, {
    targetLcgPercentFromBow: 52,
    kgMm: DEFAULT_KG_MM,
    fixedHeelDeg: 0,
  })
  const marks = gzMarks(result.gzCurve)

  const peak = result.gzCurve.reduce((a, b) => (b.GZ > a.GZ ? b : a))
  check(
    'GZ_max is the true peak',
    marks.gzMax?.heelDeg === peak.heelDeg,
    `${marks.gzMax?.heelDeg} deg`,
  )
  const afterPeak = result.gzCurve.filter((p) => p.heelDeg > (peak.heelDeg ?? 0))
  const firstNonPositive = afterPeak.find((p) => p.GZ <= 0)
  check(
    'AVS interpolated between the last two samples',
    firstNonPositive !== undefined &&
      (marks.avsDeg ?? 0) > (firstNonPositive.heelDeg ?? 0) - 5 &&
      (marks.avsDeg ?? 0) < (firstNonPositive.heelDeg ?? 0),
    `AVS ${marks.avsDeg} deg (first sample past the crossing at ${firstNonPositive?.heelDeg} deg)`,
  )
  check(
    'AVS < the sampled angle past the crossing',
    (marks.avsDeg ?? 0) < 45,
    `AVS ${marks.avsDeg}`,
  )
  check('maxHeelDeg is 45', marks.maxHeelDeg === 45, `${marks.maxHeelDeg}`)
}

console.log(fails === 0 ? `\nALL ${checks} CHECKS PASS` : `\n${fails} OF ${checks} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
