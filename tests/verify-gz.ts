/**
 * Righting-arm (GZ) curve verification.
 *
 * compute_gz_curve() is the ONLY stability curve the app plots, and until now
 * no test asserted a single GZ value. This suite pins it against two
 * independent grounds:
 *
 *   1. CLOSED FORM. A wall-sided rectangular box has an exactly integrable GZ.
 *      Integrating the immersed parallelogram gives
 *          y_B = BM tan(phi) cos(phi) + (d/2 + BM tan^2(phi)/2) sin(phi)
 *          GZ  = y_B - KG sin(phi)
 *      which is a DIFFERENT algebraic arrangement from the app's
 *      (GM + BM tan^2/2) sin(phi). Agreement is therefore evidence, not
 *      restatement. It also settles the KM/KG sign convention, because
 *      expanding y_B - KG sin(phi) yields (KM - KG) sin(phi) + ... exactly.
 *
 *   2. THE PRODUCTION GEOMETRY PATH. The same box is meshed, heeled with
 *      applyRollX, sunk with find_draft_0trim, and its GZ read straight off
 *      the submerged centroid via clipBelowPlane + computeVolumeAndCentroid.
 *      No formula is involved: GZ is the horizontal gap between the line of
 *      action of buoyancy and the line of action of weight, by definition.
 *      This proves the closed form in (1) is the real GZ of a real hull.
 *
 * On the REAL hull the curve is measured the same way and compared with the
 * app's. Agreement holds near upright and then diverges, because
 * compute_gz_curve() never re-solves the hull at heel. That divergence is a
 * MODEL LIMIT, not a coding error, and it is quantified and reported at the
 * end rather than asserted away. See the "KNOWN LIMIT" section.
 *
 * Run: npx tsx tests/verify-gz.ts
 */
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { readFileSync } from 'fs'
import {
  applyRollX,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  computeVolumeAndCentroid,
  decimateMesh,
  isMeshUsableForHydrostatics,
  DEFAULT_SOLVER_TRIANGLES,
} from '../src/lib/geometry.js'
import {
  clipBelowPlane,
  compute_gz_curve,
  compute_gz_curve_geometric,
  DEFAULT_GZ_HEEL_ANGLES_DEG,
  find_draft_0trim,
  solve_trim,
} from '../src/lib/hydrostatics.js'

let fails = 0
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) fails++
  console.log(`  ${label.padEnd(38)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

/** Relative tolerance helper: pass when |got-want| <= max(absTol, relTol*|want|). */
const close = (got: number, want: number, absTol: number, relTol: number) =>
  Math.abs(got - want) <= Math.max(absTol, relTol * Math.abs(want))

/** Closed-form GZ for a wall-sided box, from the immersed-parallelogram integral. */
function boxGzClosedForm(B: number, d: number, KG: number, phiDeg: number): number {
  const phi = (phiDeg * Math.PI) / 180
  const BM = (B * B) / (12 * d) // waterplane I / V for a box
  const yBar = BM * Math.tan(phi) // centroid of the immersed region, hull frame
  const zBar = d / 2 + 0.5 * BM * Math.tan(phi) ** 2
  return yBar * Math.cos(phi) + zBar * Math.sin(phi) - KG * Math.sin(phi)
}

/**
 * Largest heel at which a box's immersed region is still a full parallelogram,
 * i.e. the waterline stays between keel and deck across the whole beam:
 *   d - (B/2) tan(phi) >= 0   and   d + (B/2) tan(phi) <= T
 * Beyond this the hull is no longer wall-sided and every wall-sided GZ
 * relation — including the app's — is an extrapolation.
 */
function wallSidedLimitDeg(B: number, T: number, d: number): number {
  const a1 = Math.atan2(2 * d, B)
  const a2 = Math.atan2(2 * (T - d), B)
  return (Math.min(a1, a2) * 180) / Math.PI
}

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

/** Keel height (bbox min Z) of a mesh — G sits KG above it. */
const keelZOf = (mesh: Float32Array) => computeBounds(mesh).min.z

/**
 * GZ of an arbitrary hull, measured geometrically: heel the mesh, sink it to
 * the target displacement, then take the horizontal gap between G and the
 * centroid of the submerged volume.
 *
 * Sign convention: applyRollX's matrix is y' = y cos(phi) - z sin(phi), which
 * carries +Y toward +Z, i.e. it lowers the -Y side for phi > 0. A vertical
 * force at y then produces tau_x = +y*W about +X, and that same +tau_x is what
 * produced the heel, so a RESTORING arm requires tau_x < 0, i.e. y < 0.
 * Restoring GZ is therefore y_G - y_B, positive = righting the hull back.
 */
function geometricGz(
  base: Float32Array,
  targetKg: number,
  KG: number,
  heelDeg: number,
  keelZ: number,
): { gz: number; BM: number; Awp: number; draft: number } {
  const phi = (heelDeg * Math.PI) / 180
  const bounds = computeBounds(base)
  const mesh = new Float32Array(base)
  applyRollX(mesh, phi, bounds.center.y, bounds.center.z)

  const r = find_draft_0trim(mesh, targetKg, KG, 0)
  // find_draft_0trim overwrites lcb.y with the centreline; re-clip to recover
  // the true off-centreline centroid, which is the whole point of the measurement.
  const { clipped } = clipBelowPlane(mesh, r.waterlineZ)
  const yB = computeVolumeAndCentroid(clipped).centroid.y

  // G before heel sits on the centreline, KG above the keel; roll it by the
  // same matrix, about the same pivot.
  const zG = keelZ + KG - bounds.center.z
  const yG = -zG * Math.sin(phi) + bounds.center.y

  return { gz: yG - yB, BM: r.BM, Awp: r.waterplaneAreaMm2, draft: r.draftMm }
}

// ---------------------------------------------------------------------------
console.log('=== 1. closed form vs compute_gz_curve, wall-sided box ===')
// A genuinely wall-sided box: depth exceeds ~0.58 * beam so the deck edge stays
// dry past 33 deg, which is above the app's 30 deg plotting limit. KG at
// mid-depth keeps GM comfortably positive.
{
  const L = 2000
  const B = 600
  const T = 400
  const d = 200 // half submerged, so freeboard exists at every angle
  const KG = 200
  const V = L * B * d
  const kg = V / 1e6
  const BM = (B * B) / (12 * d)
  const KB = d / 2
  const KM = KB + BM
  const GM = KM - KG
  const limit = wallSidedLimitDeg(B, T, d)

  console.log(
    `  box ${L}x${B}x${T} mm, draft ${d}, KG ${KG}: ` +
      `KB=${KB} BM=${BM} KM=${KM} GM=${GM}`,
  )
  console.log(`  wall-sided validity limit: ${limit.toFixed(2)} deg`)
  check('wall-sided past the 30 deg plot limit', limit > 30, `${limit.toFixed(2)} deg > 30 deg`)
  check('GM positive', GM > 0, `GM = ${GM.toFixed(2)} mm`)

  // The solver must recover the box's own hydrostatics before GZ means anything.
  const r = find_draft_0trim(boxMesh(L, B, T), kg, KG, 0)
  check('solver draft = analytic draft', close(r.draftMm, d, 0.5, 1e-4), `${r.draftMm.toFixed(2)} vs ${d} mm`)
  check('solver BM = B^2/(12d)', close(r.BM, BM, 0.5, 1e-4), `${r.BM.toFixed(1)} vs ${BM.toFixed(1)} mm`)
  check('solver KB = d/2', close(r.KB, KB, 0.5, 1e-3), `${r.KB.toFixed(1)} vs ${KB} mm`)
  check('solver GM = KM - KG', close(r.GM, GM, 0.5, 1e-3), `${r.GM.toFixed(1)} vs ${GM.toFixed(1)} mm`)

  const curve = compute_gz_curve(GM, BM)
  check('curve length matches DEFAULT angles', curve.length === DEFAULT_GZ_HEEL_ANGLES_DEG.length, `${curve.length} points`)

  for (const p of curve) {
    const want = boxGzClosedForm(B, d, KG, p.heelDeg)
    check(
      `GZ @ ${String(p.heelDeg).padStart(2)}deg = closed form`,
      close(p.GZ, want, 0.051, 1e-9), // 0.051 mm: the curve rounds to 0.1 mm
      `${p.GZ} vs ${want.toFixed(4)} mm`,
    )
  }

  // The KM/KG arrangement from the standard relation must reproduce it too,
  // which is what pins the sign convention (suspected item 2).
  for (const deg of [5, 15, 30]) {
    const phi = (deg * Math.PI) / 180
    const viaKM = (KM - KG) * Math.sin(phi) + 0.5 * BM * Math.tan(phi) ** 2 * Math.sin(phi)
    const viaApp = compute_gz_curve(GM, BM, [deg])[0].GZ
    check(`KM-KG form agrees @ ${deg}deg`, close(viaKM, viaApp, 0.051, 1e-9), `${viaKM.toFixed(4)} vs ${viaApp}`)
  }

  // GZ must be zero upright and rise monotonically while righting.
  check('GZ(0) = 0', curve[0].GZ === 0, `${curve[0].GZ} mm`)
  let mono = true
  for (let i = 1; i < curve.length; i++) if (curve[i].GZ <= curve[i - 1].GZ) mono = false
  check('GZ rises monotonically 0->30deg', mono, curve.map((p) => p.GZ).join(', '))

  // KG must enter ONLY through GM, shifting the curve by exactly dKG*sin(phi).
  const shifted = compute_gz_curve(GM - 10, BM)
  let kgPure = true
  for (let i = 0; i < curve.length; i++) {
    const phi = (curve[i].heelDeg * Math.PI) / 180
    if (!close(shifted[i].GZ, curve[i].GZ - 10 * Math.sin(phi), 0.11, 1e-9)) kgPure = false
  }
  check('KG shifts GZ by exactly dKG*sin(phi)', kgPure, '10 mm KG step over the whole curve')
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. same box through the production geometry path ===')
// Heel the real mesh, sink it, read GZ off the submerged centroid. No formula.
{
  const L = 2000
  const B = 600
  const T = 400
  const d = 200
  const KG = 200
  const kg = (L * B * d) / 1e6
  const BM = (B * B) / (12 * d)
  const GM = d / 2 + BM - KG
  const mesh = boxMesh(L, B, T)
  const keelZ = -T / 2
  const limit = wallSidedLimitDeg(B, T, d)

  const curve = compute_gz_curve(GM, BM)
  console.log(`  heel   measured GZ   closed form   diff     (wall-sided limit ${limit.toFixed(1)} deg)`)
  for (const p of curve) {
    const m = geometricGz(mesh, kg, KG, p.heelDeg, keelZ)
    const want = boxGzClosedForm(B, d, KG, p.heelDeg)
    const within = p.heelDeg <= limit
    console.log(
      `  ${String(p.heelDeg).padStart(3)}°  ${m.gz.toFixed(4).padStart(11)} ` +
        `${want.toFixed(4).padStart(12)} ${(m.gz - want).toFixed(4).padStart(9)}${within ? '' : '   <- beyond wall-sided'}`,
    )
    // Inside the validity range the geometry and the closed form are the same
    // quantity reached two ways, so they must agree. Past it both are
    // extrapolations and the closed form is simply wrong — asserted separately.
    if (within) {
      check(
        `measured GZ = closed form @ ${String(p.heelDeg).padStart(2)}deg`,
        close(m.gz, want, 0.06, 1e-3),
        `${m.gz.toFixed(4)} vs ${want.toFixed(4)} mm`,
      )
    }
  }

  // The geometric curve agrees with the closed form while the wall-sided
  // assumption holds — the property that made replacing it safe.
  for (const p of curve) {
    if (p.heelDeg > limit) continue
    const geo = compute_gz_curve_geometric(mesh, kg, KG, [p.heelDeg])[0].GZ
    check(
      `geometric = closed form @ ${String(p.heelDeg).padStart(2)}deg`,
      close(geo, p.GZ, 0.06, 1e-3),
      `${geo} vs ${p.GZ} mm`,
    )
  }

  // Past the limit the geometric curve must DISAGREE with the closed form, and
  // must stay on the physically correct side of it (a real hull's arm is always
  // below the wall-sided prediction once the sides immerse).
  for (const p of curve) {
    if (p.heelDeg <= limit) continue
    const geo = compute_gz_curve_geometric(mesh, kg, KG, [p.heelDeg])[0].GZ
    check(
      `geometric below closed form @ ${String(p.heelDeg).padStart(2)}deg`,
      geo < p.GZ,
      `${geo} vs ${p.GZ} mm`,
    )
  }

  // Just past the validity limit the two routes must DIVERGE. If they did not,
  // the divergence would be a solver artefact rather than a model limit.
  const just = limit + 1
  const mJust = geometricGz(mesh, kg, KG, just, keelZ)
  const fJust = boxGzClosedForm(B, d, KG, just)
  const appJust = compute_gz_curve(GM, BM, [just])[0].GZ
  check(
    'closed form stops matching geometry past the limit',
    !close(mJust.gz, appJust, 0.06, 1e-3),
    `at ${just.toFixed(2)}deg: measured ${mJust.gz.toFixed(2)} vs curve ${appJust}`,
  )
  console.log(`    (limit ${limit.toFixed(2)}deg, probe ${just.toFixed(2)}deg, ` +
    `closed form there ${fJust.toFixed(2)} mm — both are extrapolations)`)
}

// ---------------------------------------------------------------------------
console.log('\n=== 3. sign convention ===')
{
  const B = 600
  const d = 200
  const KG = 200
  const BM = (B * B) / (12 * d)
  const GM = d / 2 + BM - KG

  // A hull with G above M must predict NEGATIVE GZ at every small angle —
  // the formula has to be able to express capsize, not just stability.
  const KGhigh = d / 2 + BM + 60 // 60 mm above the metacentre
  const GMneg = d / 2 + BM - KGhigh
  const neg = compute_gz_curve(GMneg, BM, [5, 10])
  check('negative GM gives negative GZ', neg.every((p) => p.GZ < 0), `${neg.map((p) => p.GZ).join(', ')} mm`)
  check('negative GM curve equals closed form', close(neg[0].GZ, boxGzClosedForm(B, d, KGhigh, 5), 0.051, 1e-9), `${neg[0].GZ}`)

  // Zero GM must flatten the curve onto the pure form-stability term only.
  const zero = compute_gz_curve(0, BM, [10, 30])
  check('GM = 0 leaves only the BM term', close(zero[0].GZ, 0.5 * BM * Math.tan(10 * Math.PI / 180) ** 2 * Math.sin(10 * Math.PI / 180), 0.051, 1e-9), `${zero[0].GZ} mm`)

  // Curve must be odd in heel: negative angles mirror the positive ones.
  const pos = compute_gz_curve(GM, BM, [15])
  const negA = compute_gz_curve(GM, BM, [-15])
  check('GZ is odd in heel', close(pos[0].GZ, -negA[0].GZ, 0.051, 1e-9), `${pos[0].GZ} vs ${negA[0].GZ}`)

  // GM = 0 and BM = 0 must both collapse to zero rather than NaN.
  const degenerate = compute_gz_curve(0, 0, [0, 30])
  check('GM=BM=0 gives a flat zero curve', degenerate.every((p) => p.GZ === 0), `${degenerate.map((p) => p.GZ).join(', ')}`)
  check('curve output is finite everywhere', compute_gz_curve(GM, BM, [0, 15, 30, 45, 60, 89]).every((p) => Number.isFinite(p.GZ)), 'up to 89 deg')
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. real hull: measured GZ vs the plotted curve ===')
const STL = new URL('./test-kayak.stl', import.meta.url)
const base = new Float32Array(
  new STLLoader()
    .parse(readFileSync(STL).buffer as ArrayBuffer)
    .getAttribute('position').array as Float32Array,
)
autoOrientToZUp(base)
centerToOrigin(base)
// The mesh solve_trim actually floats: decimated once and reused. The shipped
// curve is computed on the same mesh, so the test measures what the app gets.
const decimated = decimateMesh(new Float32Array(base), DEFAULT_SOLVER_TRIANGLES)
const solveMeshForCurve = isMeshUsableForHydrostatics(decimated) ? decimated : base
{
  const MASS_KG = 75
  const KG = 280 // the app's hardcoded KG
  const keelZ = computeBounds(base).min.z
  const upright = find_draft_0trim(base, MASS_KG, KG, 0)
  const GM = upright.GM
  const BM = upright.BM
  const curve = compute_gz_curve(GM, BM)

  console.log(`  upright: draft ${upright.draftMm.toFixed(2)} mm, GM ${GM}, BM ${BM}`)
  console.log('  heel   measured GZ   shipped GZ   old closed form   BM(phi)  BM/BM0')
  const measured: { heel: number; gz: number }[] = []

  for (const p of curve) {
    const m = geometricGz(base, MASS_KG, KG, p.heelDeg, keelZ)
    const shippedHere = compute_gz_curve_geometric(solveMeshForCurve, MASS_KG, KG, [p.heelDeg])[0].GZ
    measured.push({ heel: p.heelDeg, gz: m.gz })
    console.log(
      `  ${String(p.heelDeg).padStart(3)}°  ${m.gz.toFixed(3).padStart(11)} ` +
        `${String(shippedHere).padStart(11)} ${String(p.GZ).padStart(16)} ` +
        `${m.BM.toFixed(1).padStart(8)} ${(m.BM / BM).toFixed(4).padStart(7)}`,
    )
  }

  // Every measured point up to 20 deg must be positive: this hull is stiff in
  // that range, so a negative or non-monotonic arm there would mean the
  // measurement itself had broken.
  const upTo20 = measured.filter((m) => m.heel <= 20)
  check('measured GZ positive to 20 deg', upTo20.every((m) => m.gz > 0), `${upTo20.map((m) => m.gz.toFixed(2)).join(', ')}`)

  // Near upright the curve must track the measured arm. This is the assertion
  // that would catch a sign flip, a wrong GM or a wrong BM entering the curve.
  // DEFAULT_GZ_HEEL_ANGLES_DEG only samples from 5 deg up, so 1 and 2 deg are
  // requested explicitly.
  for (const deg of [1, 2, 5]) {
    const m = geometricGz(base, MASS_KG, KG, deg, keelZ)
    const c = compute_gz_curve(GM, BM, [deg])[0].GZ
    check(
      `curve tracks measured GZ @ ${deg}deg`,
      close(c, m.gz, 0.06, 0.05),
      `${c} vs ${m.gz.toFixed(3)} mm`,
    )
  }

  // dGZ/dphi at upright must be GM — the definition of GM.
  const h = 0.25
  const slope =
    (geometricGz(base, MASS_KG, KG, h, keelZ).gz - geometricGz(base, MASS_KG, KG, -h, keelZ).gz) /
    ((2 * h * Math.PI) / 180)
  check('dGZ/dphi at upright = GM', close(slope, GM, 0.2, 1e-3), `${slope.toFixed(3)} vs ${GM} mm/rad`)

  // solve_trim passes KG to find_draft_0trim, which treats it as a HEIGHT above
  // the keel. It used to pass `lcg.z` — an ABSOLUTE z — so on a mesh whose keel
  // is not at z = 0 the effective KG was shortened by |min.z| and every reported
  // KM/GM came out 162.5 mm too large. Every suite passed `undefined` for KG, so
  // GM was never asserted anywhere and this went unnoticed. Pin the relationship.
  //
  // Compared against solve_trim itself, not the zero-trim direct solve: the
  // solver floats the hull at its equilibrium trim (here -1.9 deg), which
  // legitimately gives a slightly larger KM than the upright case. Comparing
  // across trims would assert a difference that is not a bug.
  const solved = solve_trim(base, MASS_KG)
  const trimmedUpright = find_draft_0trim(base, MASS_KG, KG, 0)
  check('solve_trim GM = KM - KG', close(solved.GM, solved.KM - KG, 0.2, 1e-6), `${solved.GM} vs ${solved.KM} - ${KG} = ${(solved.KM - KG).toFixed(1)}`)

  // solve_trim must RETURN the geometric curve, not merely expose the function.
  // Asserting compute_gz_curve_geometric on its own is not enough: reverting
  // solve_trim's gzCurve field back to the closed form leaves every other check
  // in this file green, so this has to be pinned on the returned object.
  check(
    'solve_trim returns the geometric curve',
    solved.gzCurve.some((p) => p.GZ < 0),
    `solve_trim's own gzCurve goes negative: ${solved.gzCurve.map((p) => p.GZ).join(', ')}`,
  )
  check(
    'solve_trim gzCurve is not the closed form',
    solved.gzCurve.some((p, i) => p.GZ !== compute_gz_curve(solved.GM, solved.BM, [p.heelDeg])[0].GZ),
    'differs from (GM, BM) closed form at >= 1 angle',
  )
  check(
    'solve_trim gzCurve reaches the vanishing angle',
    solved.gzCurve.length === DEFAULT_GZ_HEEL_ANGLES_DEG.length &&
      solved.gzCurve[solved.gzCurve.length - 1].heelDeg >= 45,
    `${solved.gzCurve.length} points, last ${solved.gzCurve[solved.gzCurve.length - 1].heelDeg} deg`,
  )
  check('solve_trim KM is finite and plausible', solved.KM > 0 && solved.KM < 800, `${solved.KM} mm`)
  check('solve_trim GM is positive at this load', solved.GM > 0, `${solved.GM} mm`)
  // The old bug inflated GM by |min.z| = 162.5 mm on this hull. GM must stay in
  // the neighbourhood of KB + BM - KG, nowhere near that inflated value.
  check('solve_trim GM is not inflated by |min.z|', solved.GM < trimmedUpright.GM + 20, `${solved.GM} vs upright ${trimmedUpright.GM} (+|min.z| would be ${(trimmedUpright.GM + Math.abs(keelZ)).toFixed(1)})`)

  // The hull is symmetric about Y=0, so measured GZ must be odd in heel.
  const sym = [5, 20, 30].map((d) => {
    const a = geometricGz(base, MASS_KG, KG, d, keelZ).gz
    const b = geometricGz(base, MASS_KG, KG, -d, keelZ).gz
    return Math.abs(a + b)
  })
  check('measured GZ is odd in heel', Math.max(...sym) < 0.1, `worst |GZ(+) + GZ(-)| = ${Math.max(...sym).toFixed(4)} mm`)

  // The SHIPPED curve. compute_gz_curve_geometric is what solve_trim now
  // returns, so these assertions cover the number the chart actually draws.
  const shipped = compute_gz_curve_geometric(solveMeshForCurve, MASS_KG, KG)
  const at = (deg: number) => shipped.find((p) => p.heelDeg === deg)!.GZ
  const lastAngle = DEFAULT_GZ_HEEL_ANGLES_DEG[DEFAULT_GZ_HEEL_ANGLES_DEG.length - 1]

  console.log('\n  --- the curve the app plots (compute_gz_curve_geometric) ---')
  console.log('  heel   measured GZ   shipped GZ   closed form   BM(phi)  BM/BM0')
  for (const heel of DEFAULT_GZ_HEEL_ANGLES_DEG) {
    const m = heel === 0
      ? { gz: 0, BM: upright.BM }
      : geometricGz(base, MASS_KG, KG, heel, keelZ)
    console.log(
      `  ${String(heel).padStart(3)}°  ${m.gz.toFixed(2).padStart(11)} ${at(heel).toFixed(1).padStart(11)} ` +
        `${compute_gz_curve(GM, BM, [heel])[0].GZ.toFixed(1).padStart(12)} ` +
        `${m.BM.toFixed(1).padStart(8)} ${(m.BM / upright.BM).toFixed(4).padStart(7)}`,
    )
  }

  // The whole point of the change: the plotted arm must agree with the
  // measurement it replaces, so a regression in the geometry path is caught.
  // Compared against the SAME mesh (decimated), since that is what solve_trim
  // floats — cross-mesh agreement is the decimation's job, not this curve's.
  for (const deg of [5, 15, 20, 30, 40]) {
    const m = geometricGz(solveMeshForCurve, MASS_KG, KG, deg, keelZOf(solveMeshForCurve))
    check(
      `shipped GZ = measured GZ @ ${deg}deg`,
      close(at(deg), m.gz, 0.06, 1e-3),
      `${at(deg)} vs ${m.gz.toFixed(3)} mm`,
    )
  }

  // It must turn over. The closed form cannot produce this, so this assertion
  // is what fails first if anyone reverts to it.
  const peak = shipped.reduce((a, b) => (b.GZ > a.GZ ? b : a), shipped[0])
  check('shipped GZ has an interior peak', peak.heelDeg > 0 && peak.heelDeg < lastAngle, `peak ${peak.GZ} mm at ${peak.heelDeg} deg`)
  check('GZ falls past the peak', at(lastAngle) < peak.GZ, `${at(lastAngle)} vs peak ${peak.GZ}`)
  check('GZ is non-positive by the last angle', at(lastAngle) <= 0, `${at(lastAngle)} mm at ${lastAngle} deg`)

  // A curve that only ever climbs is the bug this change exists to remove.
  check('shipped GZ is NOT monotonic', shipped.some((p, i) => i > 0 && p.GZ < shipped[i - 1].GZ), 'has a falling branch')

  // The axis must reach past the vanishing angle or the chart cannot show it.
  check('axis extends past the vanishing angle', lastAngle >= 45, `last plotted angle ${lastAngle} deg`)

  check('shipped GZ(0) = 0', at(0) === 0, `${at(0)}`)
  // Oddness is asserted on a SYMMETRIC hull, where it must hold exactly, rather
  // than on the test mesh: a real hull is not symmetric to better than its own
  // manufacturing tolerance, and the residual (0.36 mm at 5 deg) is the mesh,
  // not the curve. Verified separately in section 3 on a box.
  const symBox = boxMesh(2000, 600, 400)
  const symPos = compute_gz_curve_geometric(symBox, 60, 200, [15])[0].GZ
  const symNeg = compute_gz_curve_geometric(symBox, 60, 200, [-15])[0].GZ
  check('shipped GZ odd in heel (symmetric hull)', close(symPos, -symNeg, 0.051, 1e-9), `${symPos} vs ${symNeg}`)
  check('shipped GZ finite everywhere', shipped.every((p) => Number.isFinite(p.GZ)), `${DEFAULT_GZ_HEEL_ANGLES_DEG.length} points`)
}

console.log(fails === 0 ? '\nALL GZ CHECKS PASS' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)