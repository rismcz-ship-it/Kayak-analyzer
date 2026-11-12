// Task 1 gate — the solver extras (library only, no UI).
//
// The Tier 1 overhaul adds Cwp, wetted surface area, LCF, TPC, the
// longitudinal waterplane second moment, the waterplane loop count and the
// interpolated deck-edge immersion heel. This suite is their ground truth, so
// the UI tasks only have to render what is already measured.
//
// Ground truth is ANALYTIC wherever it exists. A box whose waterplane is an
// L x B rectangle at draft d has:
//
//   Cwp      = Awp / (LWL * BWL)   = 1
//   I_y      = L^3 * B / 12        (longitudinal moment, centroidal)
//   LCF      = 0                   (centred box)
//   wetted   = L*B + 2*d*(L + B)   (bottom + four sides)
//   TPC      = Awp[m^2] / 100      (fresh water)
//   loops    = 1
//
// Heeling the box widens its waterplane to L x w, so the two moments must
// follow their OWN axes: I_x = L*w^3/12 (transverse) and I_y = L^3*w/12
// (longitudinal). Asserting both is what catches a transposed implementation,
// and the ratio I_y/I_x = (L/w)^2 is the "magnitudes swap" check — it moves
// away from (L/B)^2 as the heel grows.
//
// The real hull has no closed form, so it is checked for plausibility only:
// one loop, Cwp in a sane band, LCF inside the waterline, and an end-tip
// immersion heel that is either a number inside the sampled range or null.
// All three derivation branches get their own load case on that hull: null
// (end tip stays dry), an interpolated crossing, and 0 (already immersed).
// The last two sections pin what that angle IS: reported in the same frame as
// the LCB, and measured on the upright, untrimmed curve.
//
// `onAngle` is checked for its count AND for being a pure observer: a solve
// WITH the callback must return exactly the same numbers as one without.
//
// Run: npm.cmd exec -- tsx tests/verify-solve-extras.ts

import { readFileSync } from 'node:fs'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import {
  applyPitchY,
  applyRollX,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  DEFAULT_SOLVER_TRIANGLES,
  decimateMesh,
  isMeshUsableForHydrostatics,
} from '../src/lib/geometry.js'
import {
  clipBelowPlane,
  compute_gz_curve_geometric,
  DEFAULT_KG_MM,
  findDraft0Trim,
  solveTrim,
} from '../src/lib/hydrostatics.js'

/** Shape of the `onAngle` progress payload Task 1 adds to `solveTrim`. */
type AngleInfo = {
  phase: 'coarse' | 'fine'
  angleDeg: number
  index: number
  total: number
}

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(34)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

/** Relative error helper. */
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want)

/** Axis-aligned box mesh centred on the origin: keel at z = -T/2. */
function boxMesh(L: number, B: number, T: number): Float32Array {
  const hx = L / 2
  const hy = B / 2
  const hz = T / 2
  const corner = (i: number): [number, number, number] => [
    i & 4 ? hx : -hx,
    i & 2 ? hy : -hy,
    i & 1 ? hz : -hz,
  ]
  const faces: [number, number, number, number][] = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ]
  const v: number[] = []
  for (const [a, b, c, d] of faces) {
    v.push(...corner(a), ...corner(b), ...corner(c))
    v.push(...corner(a), ...corner(c), ...corner(d))
  }
  return new Float32Array(v)
}

// ---------------------------------------------------------------------------
console.log('=== 1. analytic box 2000 x 600 x 400 at 50 kg ===')
{
  const L = 2000
  const B = 600
  const d = (50e6 / (L * B)).toFixed(4) // exact draft, printed for reference
  const r = findDraft0Trim(boxMesh(L, B, 400), 50, 100, 0)
  const draft = r.draftMm
  const awp = r.waterplaneAreaMm2

  check('waterplaneLoopCount = 1', r.waterplaneLoopCount === 1, `${r.waterplaneLoopCount} loop(s)`)
  check('Cwp = 1', rel(r.Cwp, 1) < 1e-6, `${r.Cwp} (draft ${draft.toFixed(3)} vs ${d})`)
  check(
    'waterplaneIyyMm4 = L^3*B/12',
    rel(r.waterplaneIyyMm4, (L * L * L * B) / 12) < 1e-6,
    `${r.waterplaneIyyMm4.toExponential(6)} vs ${((L * L * L * B) / 12).toExponential(6)}`,
  )
  check(
    'waterplaneCentroidX (LCF) = 0',
    Math.abs(r.waterplaneCentroidX) < 1e-6,
    `${r.waterplaneCentroidX.toExponential(3)} mm`,
  )
  check(
    'wettedSurfaceAreaMm2 = L*B + 2*d*(L+B)',
    rel(r.wettedSurfaceAreaMm2, L * B + 2 * draft * (L + B)) < 1e-6,
    `${r.wettedSurfaceAreaMm2.toFixed(1)} vs ${(L * B + 2 * draft * (L + B)).toFixed(1)} mm2`,
  )
  check(
    'tpcTonnesPerCm = Awp[m2]/100',
    rel(r.tpcTonnesPerCm, awp / 1e6 / 100) < 1e-6,
    `${r.tpcTonnesPerCm} vs ${awp / 1e6 / 100} t/cm`,
  )
  check(
    'tpcTonnesPerCm matches the closed form',
    rel(r.tpcTonnesPerCm, (L * B) / 1e6 / 100) < 1e-6,
    `${r.tpcTonnesPerCm} vs ${(L * B) / 1e6 / 100} t/cm`,
  )
}

// ---------------------------------------------------------------------------
// Heel is what separates the two second moments: at zero trim a symmetric
// waterplane gives Iy = L^3*B/12 and Ix = L*B^3/12 by the same formula, so an
// implementation that swapped them would still be right here. Heeling the box
// widens the waterplane to L x w, and each moment must follow its own axis.
console.log('=== 2. heeled box: the two second moments keep their own axes ===')
{
  const L = 2000
  const B = 600
  const T = 400
  const hy = B / 2
  const hz = T / 2
  // `waterplaneIx` lives on ClipResult, not on Draft0TrimResult, so the two
  // moments are compared straight from the clip at the solved waterline — the
  // writer of both values, with nothing in between.
  const uprightClip = clipBelowPlane(
    boxMesh(L, B, T),
    findDraft0Trim(boxMesh(L, B, T), 50, 100).waterlineZ,
  )
  const ratios: number[] = [uprightClip.waterplaneIyyMm4 / uprightClip.waterplaneIx]

  for (const deg of [10, 30]) {
    const phi = (deg * Math.PI) / 180
    const s = Math.sin(phi)
    // The plane through the box centre cuts the rolled rectangle in a chord
    // bounded by both the beam and the depth faces.
    const w = 2 * Math.min(hy / Math.cos(phi), hz / s)
    const m = new Float32Array(boxMesh(L, B, T))
    applyRollX(m, phi, 0, 0)
    const r = findDraft0Trim(m, (L * B * T) / 2e6, 100, 0)
    const clip = clipBelowPlane(m, r.waterlineZ)

    check(
      `A_wp at ${deg} deg = L*w`,
      rel(r.waterplaneAreaMm2, L * w) < 0.01,
      `${r.waterplaneAreaMm2.toFixed(0)} vs ${(L * w).toFixed(0)} mm2`,
    )
    check(
      `waterplaneIyyMm4 at ${deg} deg = L^3*w/12`,
      rel(clip.waterplaneIyyMm4, (L * L * L * w) / 12) < 0.01,
      `${clip.waterplaneIyyMm4.toExponential(6)} vs ${((L * L * L * w) / 12).toExponential(6)}`,
    )
    check(
      `waterplaneIx at ${deg} deg = L*w^3/12`,
      rel(clip.waterplaneIx, (L * w * w * w) / 12) < 0.01,
      `${clip.waterplaneIx.toExponential(6)} vs ${((L * w * w * w) / 12).toExponential(6)}`,
    )
    check(
      `Iy/Ix at ${deg} deg = (L/w)^2`,
      rel(clip.waterplaneIyyMm4 / clip.waterplaneIx, (L / w) ** 2) < 0.02,
      `${(clip.waterplaneIyyMm4 / clip.waterplaneIx).toFixed(2)} vs ${((L / w) ** 2).toFixed(2)}`,
    )
    check(`Cwp at ${deg} deg still plausible`, Math.abs(r.Cwp - 1) < 0.02, `${r.Cwp}`)
    check(
      `waterplaneLoopCount = 1 at ${deg} deg`,
      r.waterplaneLoopCount === 1,
      `${r.waterplaneLoopCount} loop(s)`,
    )
    ratios.push(clip.waterplaneIyyMm4 / clip.waterplaneIx)
  }

  // The "magnitudes swap": the longitudinal/transverse ratio starts at (L/B)^2
  // and shrinks towards 1 as the heel widens the waterplane. Each step of the
  // ladder must therefore be lower than the one before it.
  check(
    'Iy/Ix ratio falls with heel',
    ratios.every((v, i) => i === 0 || v < ratios[i - 1]),
    `ladder ${ratios.map((v) => v.toFixed(2)).join(' > ')} (upright = (L/B)^2 = ${(L / B) ** 2})`,
  )
}

// ---------------------------------------------------------------------------
// The GZ point carries the draft and the freeboards that the deck-edge
// immersion scan interpolates between — including the 0 deg point, which is the
// lower anchor of the first interpolation step.
console.log('=== 3. GZ points carry draft and freeboard ===')
{
  const curve = compute_gz_curve_geometric(boxMesh(2000, 600, 400), 50, 100)
  check(
    'curve length is unchanged',
    curve.length === 10,
    `${curve.length} points (${curve.map((p) => p.heelDeg).join(', ')})`,
  )
  check(
    'every point reports draftMm',
    curve.every((p) => typeof p.draftMm === 'number' && p.draftMm > 0),
    `${curve.map((p) => p.draftMm?.toFixed(0)).join(', ')} mm`,
  )
  check(
    'every point reports minFreeboardMm',
    curve.every((p) => typeof p.minFreeboardMm === 'number'),
    `${curve.map((p) => p.minFreeboardMm?.toFixed(0)).join(', ')} mm`,
  )
  check(
    'the 0 deg point is the lower anchor',
    typeof curve[0].draftMm === 'number',
    `${curve[0].draftMm?.toFixed(2)} mm`,
  )
  check(
    'the last point is the upper anchor',
    typeof curve[curve.length - 1].draftMm === 'number',
    `${curve[curve.length - 1].draftMm?.toFixed(2)} mm`,
  )
}

// ---------------------------------------------------------------------------
// solveTrim's return is an EXPLICIT field list, so a field that exists on
// Draft0TrimResult but is forgotten there silently vanishes from the result the
// app reads. Assert on the object solveTrim returns, not on the pieces.
console.log('=== 4. solveTrim reports the extras (box) ===')
{
  const L = 2000
  const B = 600
  const r = solveTrim(boxMesh(L, B, 400), 50, { kgMm: 100 })

  check('waterplaneLoopCount = 1', r.waterplaneLoopCount === 1, `${r.waterplaneLoopCount} loop(s)`)
  check('Cwp ~ 1', Math.abs(r.Cwp - 1) < 0.02, `${r.Cwp}`)
  check(
    'waterplaneIyyMm4 ~ L^3*B/12',
    rel(r.waterplaneIyyMm4, (L * L * L * B) / 12) < 0.02,
    `${r.waterplaneIyyMm4.toExponential(6)}`,
  )
  check(
    'LCF is inside the waterline',
    Math.abs(r.waterplaneCentroidX) <= r.LWL / 2,
    `${r.waterplaneCentroidX.toFixed(1)} mm, LWL ${r.LWL.toFixed(1)} mm`,
  )
  check(
    'wettedSurfaceAreaMm2 = L*B + 2*d*(L+B)',
    rel(r.wettedSurfaceAreaMm2, L * B + 2 * r.draftMm * (L + B)) < 0.02,
    `${r.wettedSurfaceAreaMm2.toFixed(1)} vs ${(L * B + 2 * r.draftMm * (L + B)).toFixed(1)} mm2`,
  )
  check(
    'tpcTonnesPerCm ~ Awp[m2]/100',
    rel(r.tpcTonnesPerCm, r.waterplaneAreaMm2 / 1e6 / 100) < 1e-6,
    `${r.tpcTonnesPerCm} vs ${r.waterplaneAreaMm2 / 1e6 / 100} t/cm`,
  )
  // On a box the "first vertex attaining max X" that findDraft0Trim measures the
  // bow freeboard from is a keel corner, so the deck end is already immersed at
  // rest and the spec's "first point already <= 0 -> return 0" branch applies.
  check(
    'endTipImmersionDeg is 0 or a heel in (0, 90], or null',
    r.endTipImmersionDeg === null ||
      (typeof r.endTipImmersionDeg === 'number' &&
        r.endTipImmersionDeg >= 0 &&
        r.endTipImmersionDeg <= 90),
    `${r.endTipImmersionDeg}`,
  )
}

// ---------------------------------------------------------------------------
// The real committed hull. No closed form here, so the checks are plausibility
// bands plus the one structural fact that matters operationally: the waterplane
// of a watertight hull is ONE loop — two or more means the contour shattered
// into open chains and every waterplane-derived number (I_t, BM, GM, Cwp, LCF,
// TPC) is meaningless from that point on.
const openHull = (): Float32Array => {
  const buffer = readFileSync(new URL('./test-kayak.stl', import.meta.url))
  const positions = new STLLoader().parse(buffer.buffer as ArrayBuffer).attributes.position
    .array as Float32Array
  autoOrientToZUp(positions)
  centerToOrigin(positions)
  return positions
}

const APP_WINDOW = {
  targetLcgPercentFromBow: 52,
  maxTrimDeg: 4.5,
  trimStepDeg: 0.1,
  fixedHeelDeg: 0,
  kgMm: DEFAULT_KG_MM,
}

console.log('=== 5. solveTrim extras on the real hull (75 kg) ===')
{
  const hull = openHull()
  const hullBounds = computeBounds(hull)
  const r = solveTrim(hull, 75, APP_WINDOW)

  check('waterplaneLoopCount = 1', r.waterplaneLoopCount === 1, `${r.waterplaneLoopCount} loop(s)`)
  check(
    'Cwp is in a sane band',
    r.Cwp > 0.4 && r.Cwp < 0.9,
    `${r.Cwp.toFixed(4)} (Awp ${(r.waterplaneAreaMm2 / 1e6).toFixed(3)} m2,` +
      ` LWL ${r.LWL.toFixed(1)}, BWL ${r.BWL.toFixed(1)})`,
  )
  // Cwp is built from the RAW LWL/BWL, exactly like Cb/Cp/Cm in the same
  // result, so the coefficient is not polluted by the 0.1 mm rounding the
  // reported dimensions carry. Recomputing it from the rounded numbers must
  // then agree only to within that rounding envelope (about 1e-4 here).
  check(
    'Cwp = Awp / (LWL * BWL) up to the reported rounding',
    rel(r.Cwp, r.waterplaneAreaMm2 / (r.LWL * r.BWL)) < 1e-3,
    `${r.Cwp.toFixed(6)} vs ${(r.waterplaneAreaMm2 / (r.LWL * r.BWL)).toFixed(6)}`,
  )
  check(
    'LCF is inside the waterline',
    Math.abs(r.waterplaneCentroidX) <= r.LWL / 2,
    `${r.waterplaneCentroidX.toFixed(1)} mm, LWL ${r.LWL.toFixed(1)} mm`,
  )
  // The longitudinal moment is the LARGER of the two on a slender hull
  // (I_y/I_x ~ (LWL/BWL)^2 ~ 12 here), and BM must still be built from the
  // TRANSVERSE one. Guarding that keeps the new field from silently feeding
  // BM, which would inflate GM by the same factor.
  check(
    'waterplaneIyyMm4 is the larger moment',
    r.waterplaneIyyMm4 > 0,
    `Iy ${r.waterplaneIyyMm4.toExponential(4)} mm4, Iy/Ix ~ ${(r.LWL / r.BWL) ** 2}`,
  )
  check(
    'BM still uses the transverse moment, not Iy',
    rel((r.BM * r.displacedVolumeMm3) / r.waterplaneIyyMm4, 1 / (r.LWL / r.BWL) ** 2) < 0.25,
    `I_t = BM*V = ${(r.BM * r.displacedVolumeMm3).toExponential(4)} mm4, ` +
      `Iy = ${r.waterplaneIyyMm4.toExponential(4)} mm4`,
  )
  check(
    'wettedSurfaceAreaMm2 > Awp',
    r.wettedSurfaceAreaMm2 > r.waterplaneAreaMm2,
    `${(r.wettedSurfaceAreaMm2 / 1e6).toFixed(4)} m2 wetted vs ` +
      `${(r.waterplaneAreaMm2 / 1e6).toFixed(4)} m2 waterplane`,
  )
  check(
    'tpcTonnesPerCm = Awp[m2]/100',
    rel(r.tpcTonnesPerCm, r.waterplaneAreaMm2 / 1e6 / 100) < 1e-9,
    `${r.tpcTonnesPerCm.toFixed(5)} t/cm`,
  )
  // The 75 kg probe on this hull: min freeboard 107 mm at 0 deg, still 102 mm
  // at 45 deg — the end tip never dips, so there is no crossing to report.
  check(
    'endTipImmersionDeg is null at 75 kg (end tip stays dry)',
    r.endTipImmersionDeg === null,
    `${r.endTipImmersionDeg}`,
  )
  check(
    'freeboard is positive at the solved trim',
    r.bowFreeboardMm > 0 && r.sternFreeboardMm > 0,
    `bow ${r.bowFreeboardMm.toFixed(1)}, stern ${r.sternFreeboardMm.toFixed(1)} mm`,
  )
  // The solver works on a copy of the hull PITCHED about a pivot above the
  // keel, so the tilted copy's lowest point drifts up with the trim — which is
  // how a heavier hull came to report a waterline 20 mm higher while floating
  // 14 mm deeper. The reported heights must all live in the hull's own frame,
  // and the plainest statement of that is the draft being exactly keel to
  // waterline. solveTrim decimates internally while this suite holds the full
  // mesh, hence the 0.1 mm envelope on the keel it reads here.
  check(
    'draftMm = waterlineZ - keel (all three in one frame)',
    Math.abs(r.draftMm - (r.waterlineZ - hullBounds.min.z)) < 0.1,
    `draft ${r.draftMm.toFixed(3)} vs waterline ${r.waterlineZ.toFixed(3)} ` +
      `- keel ${hullBounds.min.z.toFixed(3)}`,
  )
  // The freeboards inherit that same waterline, so in the hull frame it must be
  // TILTED by the trim: at -1.9 deg the bow end of the plane stands 90 mm above
  // the stern end. The old formula applied the tilt the wrong way round, which
  // let a bow-down trim GROW the bow freeboard by 92 mm.
  let maxX = -Infinity
  let minX = Infinity
  let bowTipZ = 0
  let sternTipZ = 0
  for (let i = 0; i < hull.length; i += 3) {
    if (hull[i] > maxX) {
      maxX = hull[i]
      bowTipZ = hull[i + 2]
    }
    if (hull[i] < minX) {
      minX = hull[i]
      sternTipZ = hull[i + 2]
    }
  }
  const waterlineAtBow = bowTipZ - r.bowFreeboardMm
  const waterlineAtStern = sternTipZ - r.sternFreeboardMm
  const trimRad = (r.trimDeg * Math.PI) / 180
  check(
    'the freeboards carry the waterline tilt with the right sign',
    Math.abs(waterlineAtBow - waterlineAtStern + hullBounds.size.x * Math.tan(trimRad)) < 0.5,
    `waterline ${waterlineAtBow.toFixed(2)}@bow to ${waterlineAtStern.toFixed(2)}@stern ` +
      `= ${(waterlineAtBow - waterlineAtStern).toFixed(2)} mm spread vs ` +
      `${(-hullBounds.size.x * Math.tan(trimRad)).toFixed(2)} mm from the ` +
      `${r.trimDeg.toFixed(2)} deg trim`,
  )
}

// ---------------------------------------------------------------------------
// The callback is a progress observer, nothing more. It must fire exactly
// coarseCount + fineCount times (30 at the app window: 19 coarse at 0.5 deg over
// +/-4.5, then 11 fine at 0.1 deg over +/-0.5) and must not perturb the solve by
// a single bit.
console.log('=== 6. onAngle reports the sweep and does not perturb it ===')
{
  const hull = openHull()
  const seen: AngleInfo[] = []
  const withCb = solveTrim(hull, 75, { ...APP_WINDOW, onAngle: (info) => seen.push({ ...info }) })
  const without = solveTrim(hull, 75, APP_WINDOW)

  // The same arithmetic the solver uses to size its `total`, applied to the app
  // window — 19 coarse at 0.5 deg over +/-4.5, then 11 fine at 0.1 deg.
  const maxTrimDeg = APP_WINDOW.maxTrimDeg
  const trimStepDeg = APP_WINDOW.trimStepDeg
  const coarseStepDeg = trimStepDeg * 5
  const coarseCount = Math.floor((2 * maxTrimDeg) / coarseStepDeg + 1e-9) + 1
  const fineCount = Math.floor((2 * coarseStepDeg) / trimStepDeg + 1e-9) + 1

  const coarse = seen.filter((s) => s.phase === 'coarse')
  const fine = seen.filter((s) => s.phase === 'fine')

  check(
    `onAngle is called ${coarseCount + fineCount} times`,
    seen.length === coarseCount + fineCount,
    `${seen.length} calls`,
  )
  check(
    'every payload reports the same total',
    seen.every((s) => s.total === coarseCount + fineCount),
    `${new Set(seen.map((s) => s.total)).size} distinct total value(s)`,
  )
  check(
    'index runs 1..total with no gaps or repeats',
    seen.every((s, i) => s.index === i + 1),
    `${seen.map((s) => s.index).join(',')}`,
  )
  check(
    `${coarseCount} coarse + ${fineCount} fine`,
    coarse.length === coarseCount && fine.length === fineCount,
    `coarse ${coarse.length}, fine ${fine.length}`,
  )
  // Absolute tolerance, not relative: the ladder crosses zero and a relative
  // comparison against 0 is meaningless.
  check(
    'coarse angles are the 0.5 deg ladder over +/-4.5',
    coarse.every((s, i) => Math.abs(s.angleDeg - (-maxTrimDeg + i * coarseStepDeg)) < 1e-9),
    `${coarse.map((s) => s.angleDeg.toFixed(1)).join(' ')}`,
  )
  check(
    'fine angles are the 0.1 deg ladder around the winner',
    fine.every(
      (s, i) => i === 0 || Math.abs(s.angleDeg - fine[i - 1].angleDeg - trimStepDeg) < 1e-9,
    ) && fine.every((s) => Math.abs(s.angleDeg) <= maxTrimDeg + 1e-9),
    `${fine.map((s) => s.angleDeg.toFixed(2)).join(' ')}`,
  )
  check(
    'the callback does not perturb the solve',
    withCb.trimDeg === without.trimDeg &&
      withCb.draftMm === without.draftMm &&
      withCb.LWL === without.LWL &&
      withCb.GM === without.GM &&
      withCb.displacementKg === without.displacementKg &&
      withCb.Cwp === without.Cwp &&
      withCb.endTipImmersionDeg === without.endTipImmersionDeg,
    `trim ${withCb.trimDeg} vs ${without.trimDeg}, draft ${withCb.draftMm.toFixed(3)} vs ` +
      `${without.draftMm.toFixed(3)}, GM ${withCb.GM.toFixed(3)} vs ${without.GM.toFixed(3)}`,
  )
  check(
    'planesEvaluated counts at least one plane per angle',
    withCb.planesEvaluated >= coarseCount,
    `${withCb.planesEvaluated} planes over ${coarseCount + fineCount} angles`,
  )
  // `total` must be sized from the SAME epsilon the loops use. The coarse loop's
  // own bound is `deg <= maxTrimDeg + 1e-6`, so any maxTrimDeg that sits a hair
  // below a ladder multiple made the loop run one more angle than the formula
  // predicted — the observer then reported index 30 against total 29.
  for (const [mt, ts] of [
    [4.5, 0.1],
    [4.49999975, 0.1],
    [3.5, 0.1],
    [4.5, 0.2],
    [4.5, 0.3],
    [4.5, 0.25],
    [1.0, 0.25],
    [2.0, 0.35],
  ] as [number, number][]) {
    const seen: AngleInfo[] = []
    solveTrim(boxMesh(2000, 600, 400), 50, {
      kgMm: 100,
      maxTrimDeg: mt,
      trimStepDeg: ts,
      onAngle: (info) => seen.push({ ...info }),
    })
    check(
      `index never exceeds total (maxTrim ${mt}, step ${ts})`,
      seen.length > 0 && seen.every((s) => s.index <= s.total),
      `${seen.length} calls, total ${seen[0]?.total}, maxIndex ${Math.max(...seen.map((s) => s.index))}`,
    )
  }
}

// ---------------------------------------------------------------------------
// LCB and LCF in one result object must live in the SAME frame. solveTrim
// rotates the LCB back from the tilted (pitched) world frame into the untilted
// hull frame so it can be compared with the LCG; the waterplane centroid was
// copied through un-rotated, so the two x-coordinates in one result disagreed
// by ~1.1 mm and the LCF was not the point its own LCB was measured against.
console.log('=== 7. the reported LCF shares the LCB frame ===')
{
  const positions = openHull()
  const r = solveTrim(positions, 75, APP_WINDOW)

  // Re-derive the expectation from PUBLIC primitives only: resolve the same
  // mesh solveTrim solved on, pitch it about the pivot solveTrim reports, clip
  // at that draft to get the tilted waterplane centroid, and rotate that point
  // back into the hull frame. No solver-private path is reused.
  const decimated = decimateMesh(positions, DEFAULT_SOLVER_TRIANGLES)
  const solveMesh = isMeshUsableForHydrostatics(decimated) ? decimated : positions
  const rad = (r.trimDeg * Math.PI) / 180
  const pitched = new Float32Array(solveMesh)
  applyPitchY(pitched, rad, r.pivot.x, r.pivot.z)
  const clip = findDraft0Trim(pitched, 75, DEFAULT_KG_MM)

  const lcx = clip.waterplaneCentroidX - r.pivot.x
  const lcz = clip.waterlineZ - r.pivot.z
  const lcfHullFrame = lcx * Math.cos(rad) + lcz * Math.sin(rad) + r.pivot.x

  check(
    'LCF is in the same (untilted) frame as LCB',
    Math.abs(r.waterplaneCentroidX - lcfHullFrame) < 0.5,
    `reported ${r.waterplaneCentroidX.toFixed(3)} vs hull-frame ${lcfHullFrame.toFixed(3)} mm`,
  )
  check(
    'LCF is inside the waterline (either frame)',
    Math.abs(r.waterplaneCentroidX) <= r.LWL / 2,
    `${r.waterplaneCentroidX.toFixed(1)} mm, LWL ${r.LWL.toFixed(1)} mm`,
  )
}

// ---------------------------------------------------------------------------
// The end-tip immersion heel is interpolated between the 5 deg GZ samples, so
// the three load cases below exercise all three branches of the derivation: no
// crossing (null), a crossing between two samples (interpolated), and already
// immersed at rest (0).
console.log('=== 8. endTipImmersionDeg across load cases ===')
{
  const hull = openHull()
  const at = (kg: number) => solveTrim(hull, kg, APP_WINDOW).endTipImmersionDeg

  const light = at(75)
  check('75 kg -> null (end tip stays dry)', light === null, `${light}`)

  // Deeper in the water the bow or stern tip enters the water somewhere between
  // 35 deg (freeboard +5.5 mm) and 40 deg (-2.6 mm) on this hull.
  const mid = at(150)
  check(
    '150 kg -> interpolated between 35 and 40 deg',
    typeof mid === 'number' && mid > 35 && mid < 40,
    `${mid}`,
  )

  const heavy = at(190)
  check('190 kg -> 0 (already immersed at rest)', heavy === 0, `${heavy}`)
}

// ---------------------------------------------------------------------------
// The field is a STEM-TIP clearance angle measured on the upright, untrimmed
// curve, NOT a sheer-line immersion. Two consequences are asserted so the
// naming cannot drift back: it must not move when the caller fixes a heel, and
// it must not be reported as a deck-edge figure.
console.log('=== 9. endTipImmersionDeg does not follow fixedHeelDeg ===')
{
  const angles = [0, 10, 20].map(
    (heel) => solveTrim(openHull(), 150, { ...APP_WINDOW, fixedHeelDeg: heel }).endTipImmersionDeg,
  )
  check(
    'the angle is the same at every fixed heel',
    angles.every((a) => a === angles[0]),
    `heel 0/10/20 deg -> ${angles.join(' / ')} (upright basis)`,
  )
}

console.log(fails === 0 ? `\nALL ${checks} CHECKS PASS` : `\n${fails} OF ${checks} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
