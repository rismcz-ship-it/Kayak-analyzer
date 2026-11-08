// Gate for the FROZEN conventions in AGENTS.md.
//
// Everything asserted here is stated in prose somewhere in the repo. Until this
// suite existed, none of it was enforced: a global sign flip, a swapped axis
// or a broken bow detection would leave `npm test` green.
//
//   - Z-up, X = LOA (bow = +X), Y = beam, Z = depth
//   - trim + = bow UP (marine convention)
//   - heel + = the -Y side goes down
//   - the viewer's rotation angles are the translation of the solver's
//   - the published baseline for the committed test hull
//
// The numbers in the BASELINE block are the ones AGENTS.md and README.md
// publish. If the hull or the solver legitimately changes, update the docs
// and this file together — that is the point of the suite.
//
// Run: npm exec -- tsx tests/verify-orientation.ts

import { readFileSync } from 'node:fs'
import { Euler, Vector3 } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import {
  applyPitchY,
  applyRollX,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  computeVolumeAndCentroid,
} from '../src/lib/geometry.js'
import { DEFAULT_KG_MM, solveTrim } from '../src/lib/hydrostatics.js'
import { viewerHeelDeg, viewerTrimDeg } from '../src/lib/viewer-conventions.js'

// The published baseline for tests/test-kayak.stl, after auto-orientation.
const BASELINE = {
  loaMm: 2714.4,
  beamMm: 613.1,
  depthMm: 325.1,
  trimDeg: -1.9,
  lcbLcgOffsetMm: 1.637,
  boundsTolMm: 0.5,
  trimTolDeg: 0.05,
  lcbLcgOffsetTolMm: 0.2,
}

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const buffer = readFileSync(new URL('./test-kayak.stl', import.meta.url))
const geometry = new STLLoader().parse(buffer.buffer as ArrayBuffer)
const positions = geometry.getAttribute('position').array as Float32Array

// ---------------------------------------------------------------------------
console.log('=== 1. axis convention: X = LOA, Y = beam, Z = depth ===')
{
  autoOrientToZUp(positions)
  centerToOrigin(positions)
  const b = computeBounds(positions)

  check(
    'X carries the longest extent',
    b.size.x > b.size.y && b.size.x > b.size.z,
    `${b.size.x.toFixed(1)} mm`,
  )
  check(
    'Y is the beam, Z the depth',
    b.size.y > b.size.z,
    `beam ${b.size.y.toFixed(1)} > depth ${b.size.z.toFixed(1)}`,
  )

  const vol = computeVolumeAndCentroid(positions)
  // autoOrientToZUp rotates the hull so the bow points at +X whenever the
  // fuller stern sat at +X. The volume centroid sits towards the stern, so
  // after orientation it must be on the -X side of the bounding-box centre.
  check(
    'bow is at +X (volume centroid towards -X)',
    vol.centroid.x < b.center.x,
    `centroid x ${vol.centroid.x.toFixed(1)} < centre ${b.center.x.toFixed(1)}`,
  )
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. trim sign: positive = bow UP ===')
{
  const b = computeBounds(positions)
  const probe = new Float32Array(positions)
  const before = bowRegionMeanZ(probe)
  applyPitchY(probe, (5 * Math.PI) / 180, b.center.x, b.center.z)
  const after = bowRegionMeanZ(probe)

  check(
    'applyPitchY(+5°) raises the bow',
    after > before,
    `${before.toFixed(1)} -> ${after.toFixed(1)} mm`,
  )

  const negative = new Float32Array(positions)
  const beforeNeg = bowRegionMeanZ(negative)
  applyPitchY(negative, (-5 * Math.PI) / 180, b.center.x, b.center.z)
  const afterNeg = bowRegionMeanZ(negative)
  check(
    'applyPitchY(-5°) lowers the bow',
    afterNeg < beforeNeg,
    `${beforeNeg.toFixed(1)} -> ${afterNeg.toFixed(1)} mm`,
  )
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. heel sign: positive = the -Y side goes down ===')
{
  const probe = new Float32Array(positions)
  const before = meanZBySide(probe)
  applyRollX(probe, (5 * Math.PI) / 180, 0, 0)
  const after = meanZBySide(probe)

  check(
    'applyRollX(+5°) raises the +Y side',
    after.plus > before.plus,
    `${before.plus.toFixed(1)} -> ${after.plus.toFixed(1)} mm`,
  )
  check(
    'applyRollX(+5°) lowers the -Y side',
    after.minus < before.minus,
    `${before.minus.toFixed(1)} -> ${after.minus.toFixed(1)} mm`,
  )

  const negative = new Float32Array(positions)
  const beforeNeg = meanZBySide(negative)
  applyRollX(negative, (-5 * Math.PI) / 180, 0, 0)
  const afterNeg = meanZBySide(negative)
  check(
    'applyRollX(-5°) is the mirror image',
    afterNeg.plus < beforeNeg.plus && afterNeg.minus > beforeNeg.minus,
  )
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. the viewer translates the solver signs ===')
{
  // The viewer drives Three.js rotations on a Z-up scene: the ground grid is
  // laid into the XY plane by a +90° rotation about X, so the scene's up
  // axis is +Z, not Three's default +Y.
  check('viewerTrimDeg negates', viewerTrimDeg(1) === -1 && viewerTrimDeg(-2.5) === 2.5)
  check('viewerHeelDeg passes through', viewerHeelDeg(1) === 1 && viewerHeelDeg(-2.5) === -2.5)

  // Trim: the solver says +1° means bow up. The viewer must produce a
  // Three.js rotation about +Y that also lifts the bow.
  const bow = new Vector3(1, 0, 0)
  const trimUp = bow.clone().applyEuler(new Euler(0, (viewerTrimDeg(1) * Math.PI) / 180, 0))
  check('viewer trim lifts the bow for a +1° trim', trimUp.z > 0, `bow z = ${trimUp.z.toFixed(4)}`)

  const bowDown = bow.clone().applyEuler(new Euler(0, (viewerTrimDeg(-1) * Math.PI) / 180, 0))
  check(
    'viewer trim drops the bow for a -1° trim',
    bowDown.z < 0,
    `bow z = ${bowDown.z.toFixed(4)}`,
  )

  // Heel: the solver says +1° means the -Y side goes down. The viewer must
  // produce a Three.js rotation about +X that does exactly that, with no
  // extra negation.
  const plusY = new Vector3(0, 1, 0)
  const minusY = new Vector3(0, -1, 0)
  const heelRad = (viewerHeelDeg(1) * Math.PI) / 180
  const heelEuler = new Euler(heelRad, 0, 0)
  const plusYHeeled = plusY.clone().applyEuler(heelEuler)
  const minusYHeeled = minusY.clone().applyEuler(heelEuler)
  check('viewer heel raises the +Y side', plusYHeeled.z > 0, `+Y z = ${plusYHeeled.z.toFixed(4)}`)
  check('viewer heel lowers the -Y side', minusYHeeled.z < 0, `-Y z = ${minusYHeeled.z.toFixed(4)}`)
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. published baseline for the committed test hull ===')
{
  const b = computeBounds(positions)
  check(
    `LOA = ${BASELINE.loaMm} mm`,
    Math.abs(b.size.x - BASELINE.loaMm) <= BASELINE.boundsTolMm,
    `${b.size.x.toFixed(1)} mm`,
  )
  check(
    `beam = ${BASELINE.beamMm} mm`,
    Math.abs(b.size.y - BASELINE.beamMm) <= BASELINE.boundsTolMm,
    `${b.size.y.toFixed(1)} mm`,
  )
  check(
    `depth = ${BASELINE.depthMm} mm`,
    Math.abs(b.size.z - BASELINE.depthMm) <= BASELINE.boundsTolMm,
    `${b.size.z.toFixed(1)} mm`,
  )

  // The same solve the app runs: 75 kg, 52% LCG, +/-4.5 deg sweep.
  const solved = solveTrim(positions, 75, {
    targetLcgPercentFromBow: 52,
    maxTrimDeg: 4.5,
    trimStepDeg: 0.1,
    fixedHeelDeg: 0,
    kgMm: DEFAULT_KG_MM,
  })
  check(
    `trim = ${BASELINE.trimDeg} deg`,
    Math.abs(solved.trimDeg - BASELINE.trimDeg) <= BASELINE.trimTolDeg,
    `${solved.trimDeg} deg`,
  )
  check('the solve converged', solved.converged)
  check(
    'the trim solver really ran',
    solved.planesEvaluated > 0,
    `${solved.planesEvaluated} planes`,
  )

  // How closely the solved trim lines the LCB up with the LCG. The value
  // depends on the sweep window: the solver ranks candidate angles by the
  // LCB/LCB offset, so a wider window can land on a marginally different
  // angle. Both the app's window and the solver's own default are printed
  // so the published number below is traceable to one of them.
  const withDefaultWindow = solveTrim(positions, 75, {
    targetLcgPercentFromBow: 52,
    kgMm: DEFAULT_KG_MM,
  })
  console.log(
    `  info LCB-LCG offset: app window (+/-4.5 deg) ${solved.lcbLcgOffsetMm.toFixed(3)} mm` +
      ` | solver default (+/-3.5 deg) ${withDefaultWindow.lcbLcgOffsetMm.toFixed(3)} mm` +
      ` | trim ${solved.trimDeg} vs ${withDefaultWindow.trimDeg} deg`,
  )
  check(
    `LCB-LCG offset = ${BASELINE.lcbLcgOffsetMm} mm`,
    Math.abs(solved.lcbLcgOffsetMm - BASELINE.lcbLcgOffsetMm) <= BASELINE.lcbLcgOffsetTolMm,
    `${solved.lcbLcgOffsetMm.toFixed(3)} mm`,
  )
  check(
    'LCB-LCG offset stays under 2 mm',
    solved.lcbLcgOffsetMm < 2,
    `${solved.lcbLcgOffsetMm.toFixed(3)} mm`,
  )
}

// ---------------------------------------------------------------------------
console.log('\n=== 6. KG is threaded through the solve ===')
{
  const base = solveTrim(positions, 75, {
    targetLcgPercentFromBow: 52,
    maxTrimDeg: 4.5,
    trimStepDeg: 0.1,
    fixedHeelDeg: 0,
    kgMm: DEFAULT_KG_MM,
  })

  check('the solve reports the KG it used', base.kgMm === DEFAULT_KG_MM, `${base.kgMm} mm`)
  check(
    'GM = KM - KG',
    Math.abs(base.GM - (base.KM - base.kgMm)) < 0.01,
    `${base.GM} vs ${base.KM} - ${base.kgMm}`,
  )

  // Raising KG by 60 mm must lower GM by exactly 60 mm: GM is a difference of
  // heights, so the sensitivity is 1:1 and cannot drift unnoticed.
  const raised = solveTrim(positions, 75, {
    targetLcgPercentFromBow: 52,
    maxTrimDeg: 4.5,
    trimStepDeg: 0.1,
    fixedHeelDeg: 0,
    kgMm: DEFAULT_KG_MM + 60,
  })
  check(
    'raising KG by 60 mm lowers GM by 60 mm',
    Math.abs(base.GM - raised.GM - 60) < 0.01,
    `GM ${base.GM.toFixed(2)} -> ${raised.GM.toFixed(2)}`,
  )
  check('the raised-KG solve reports its own KG', raised.kgMm === DEFAULT_KG_MM + 60)
}

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

// ---------------------------------------------------------------------------
// Helpers

/**
 * Mean Z of the vertices in the forward 25% of the hull — the "bow region".
 *
 * A plain max-over-the-+X-half is useless here: the hull's tallest point sits
 * near x = 0, so that statistic barely moves when the hull is pitched and
 * hides the sign of the rotation.
 */
function bowRegionMeanZ(p: Float32Array): number {
  let maxX = -Infinity
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] > maxX) maxX = p[i]
  }
  const cutoff = maxX * 0.75
  let sum = 0
  let n = 0
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < cutoff) continue
    sum += p[i + 2]
    n++
  }
  return sum / Math.max(n, 1)
}

/** Mean Z of the vertices on the +Y side and on the -Y side. */
function meanZBySide(p: Float32Array): { plus: number; minus: number } {
  let sumPlus = 0
  let nPlus = 0
  let sumMinus = 0
  let nMinus = 0
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 1] >= 0) {
      sumPlus += p[i + 2]
      nPlus++
    } else {
      sumMinus += p[i + 2]
      nMinus++
    }
  }
  return { plus: sumPlus / Math.max(nPlus, 1), minus: sumMinus / Math.max(nMinus, 1) }
}
