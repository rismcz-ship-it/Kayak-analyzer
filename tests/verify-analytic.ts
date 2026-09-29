// Analytic verification — shapes whose hydrostatics are known by hand.
//
// This deliberately does NOT reimplement any slicing. Every expected value
// below is a closed-form textbook number, so agreement is real evidence rather
// than two implementations of the same mistake agreeing with each other.
//
//   Box      Cb = Cp = Cm = 1,  KB = T/2,  BM = (L*B^3/12)/V
//   Cylinder Cm = 1,  BM = 2r/(3*pi)  (independent of draft)
//
// The cylinder is the important one: its cross-section is a curved closed
// curve, so it exercises the contour loop-walking rather than a 4-point polygon.

import {
  checkWatertight,
  computeBounds,
  computeSubmergedSectionAreaMm2,
  computeWaterlineBeamMm,
  computeWaterlineLengthMm,
} from '../src/lib/geometry.js'
import { find_draft_0trim } from '../src/lib/hydrostatics.js'

let fails = 0
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) fails++
  console.log(`  ${label.padEnd(30)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

// ---------------------------------------------------------------- box
console.log('=== BOX 2000 x 600 x 300 mm ===')
{
  const L = 2000, B = 600, T = 300
  const hx = L / 2, hy = B / 2, hz = T / 2
  const corner = (i: number): [number, number, number] => [
    i & 4 ? hx : -hx, i & 2 ? hy : -hy, i & 1 ? hz : -hz,
  ]
  const faces: [number, number, number, number][] = [
    [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4],
    [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5],
  ]
  const v: number[] = []
  for (const [a, b, c, d] of faces) {
    v.push(...corner(a), ...corner(b), ...corner(c))
    v.push(...corner(a), ...corner(c), ...corner(d))
  }
  const box = new Float32Array(v)
  const wl = 0 // half draft
  check('watertight', checkWatertight(box).watertight, `${checkWatertight(box).openEdgeCount} open edges`)

  const sec = computeSubmergedSectionAreaMm2(box, 0, wl)
  check('submerged section = B*T/2', Math.abs(sec - (B * T) / 2) < 1, `${sec.toFixed(1)} vs ${((B * T) / 2).toFixed(1)} mm2`)
  check('LWL = L', Math.abs(computeWaterlineLengthMm(box, wl) - L) < 0.01, `${computeWaterlineLengthMm(box, wl).toFixed(2)} mm`)
  check('BWL = B', Math.abs(computeWaterlineBeamMm(box, wl) - B) < 0.01, `${computeWaterlineBeamMm(box, wl).toFixed(2)} mm`)

  const V = 50e6
  const r = find_draft_0trim(box, 50, 100, 0)
  const d = V / (L * B)
  check('draft = V/(L*B)', Math.abs(r.draftMm - d) < 0.5, `${r.draftMm.toFixed(2)} vs ${d.toFixed(2)} mm`)
  check('Cb = 1', Math.abs(r.Cb - 1) < 1e-3, `${r.Cb}`)
  check('Cp = 1', Math.abs(r.Cp - 1) < 0.01, `${r.Cp}`)
  check('Cm = 1', Math.abs(r.Cm - 1) < 0.01, `${r.Cm}`)
  check('KB = draft/2', Math.abs(r.KB - r.draftMm / 2) < 1, `${r.KB} vs ${(r.draftMm / 2).toFixed(1)}`)
  const bmBox = (L * Math.pow(B, 3) / 12) / V
  check('BM = (L*B^3/12)/V', Math.abs(r.BM - bmBox) < 1, `${r.BM} vs ${bmBox.toFixed(1)} mm`)
}

// ---------------------------------------------------------------- cylinder
console.log('\n=== CYLINDER along X, r = 300, L = 2000 mm ===')
{
  const r = 300, L = 2000
  const N = 96
  const v: number[] = []
  const ring = (x: number) =>
    Array.from({ length: N }, (_, k) => {
      const a = (2 * Math.PI * k) / N
      return [x, r * Math.cos(a), r * Math.sin(a)] as [number, number, number]
    })
  const front = ring(L / 2)
  const back = ring(-L / 2)
  // Side wall quads, wound so outward normals point away from the axis.
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N
    v.push(...front[k], ...back[k], ...back[k2])
    v.push(...front[k], ...back[k2], ...front[k2])
  }
  // End caps: fan about the circle CENTRE, wound outward (+X at the front ring).
  const frontC: [number, number, number] = [L / 2, 0, 0]
  const backC: [number, number, number] = [-L / 2, 0, 0]
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N
    v.push(...frontC, ...front[k], ...front[k2])
    v.push(...backC, ...back[k2], ...back[k])
  }
  const cyl = new Float32Array(v)
  const wt = checkWatertight(cyl)
  check('watertight', wt.watertight, `${wt.openEdgeCount} open edges`)

  // Float at draft d: submerged volume = L * (r^2 * acos((r-d)/r) - (r-d)*sqrt(2rd - d^2))
  // pick d = r (half submerged) => V = L * r^2 * pi/2
  const d = r
  const V = L * r * r * Math.PI / 2
  const kg = V / 1e6
  const res = find_draft_0trim(cyl, kg, 100, 0)
  check('draft = r (half)', Math.abs(res.draftMm - d) < d * 0.02, `${res.draftMm.toFixed(1)} vs ${d} mm`)

  // Analytic at half draft (waterline through the axis):
  //   submerged section = half disc  = pi*r^2/2
  //   Cm = (pi r^2/2) / (2r * r)   = pi/4
  //   Cb = V/(LWL*BWL*d)            = pi/4
  //   waterplane is a full L x 2r rectangle, so BM = (L*(2r)^3/12) / V = 4r/(3*pi)
  check('LWL = L', Math.abs(computeWaterlineLengthMm(cyl, 0) - L) < 1, `${computeWaterlineLengthMm(cyl, 0).toFixed(1)} mm`)
  check('BWL = 2r', Math.abs(computeWaterlineBeamMm(cyl, 0) - 2 * r) < 1, `${computeWaterlineBeamMm(cyl, 0).toFixed(1)} vs ${2 * r} mm`)
  const am = computeSubmergedSectionAreaMm2(cyl, 0, 0)
  const amExpect = (Math.PI * r * r) / 2
  check('submerged section = pi r^2/2', Math.abs(am - amExpect) < amExpect * 0.01, `${am.toFixed(0)} vs ${amExpect.toFixed(0)} mm2`)

  check('Cm = pi/4', Math.abs(res.Cm - Math.PI / 4) < 0.02, `${res.Cm} vs ${(Math.PI / 4).toFixed(4)}`)
  const bmCyl = (4 * r) / (3 * Math.PI)
  check('BM = 4r/(3*pi)', Math.abs(res.BM - bmCyl) < 5, `${res.BM} vs ${bmCyl.toFixed(1)} mm`)
  check('Cb = pi/4', Math.abs(res.Cb - Math.PI / 4) < 0.02, `${res.Cb} vs ${(Math.PI / 4).toFixed(4)}`)
}

console.log(fails === 0 ? '\nALL CHECKS PASS' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
