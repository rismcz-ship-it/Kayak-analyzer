// Closed-box identity test: a rectangular box must give Cb = Cp = Cm = 1.
// A box is the only hull whose coefficients are known analytically, so it is
// the one case that can prove the measurement code is right without a second
// implementation to compare against.
import { find_draft_0trim } from '../src/lib/hydrostatics.js'
import { checkWatertight, computeVolumeMm3, computeSectionAreaMm2, computeSubmergedSectionAreaMm2, computeWaterlineBeamMm, computeWaterlineLengthMm } from '../src/lib/geometry.js'

const L = 2000, B = 600, T = 300
const hx = L / 2, hy = B / 2, hz = T / 2
const corner = (i: number): [number, number, number] => [i & 4 ? hx : -hx, i & 2 ? hy : -hy, i & 1 ? hz : -hz]
const faces: [number, number, number, number][] = [
  [0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4],
  [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5],
]
const verts: number[] = []
for (const [a, b, c, d] of faces) {
  verts.push(...corner(a), ...corner(b), ...corner(c))
  verts.push(...corner(a), ...corner(c), ...corner(d))
}
const box = new Float32Array(verts)

let fails = 0
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) fails++
  console.log(`  ${label.padEnd(26)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

const wt = checkWatertight(box)
const vol = computeVolumeMm3(box)
console.log(`box ${L}x${B}x${T} mm: watertight=${wt.watertight}, volume ${(vol / 1e6).toFixed(3)} L (expect ${((L * B * T) / 1e6).toFixed(3)} L)\n`)
check('test mesh watertight', wt.watertight, `${wt.openEdgeCount} open edges`)
check('test mesh volume', Math.abs(vol - L * B * T) / (L * B * T) < 1e-6, `${(vol / 1e6).toFixed(3)} L`)

if (!wt.watertight) {
  console.log('\ntest mesh invalid — aborting')
  process.exit(1)
}

// Half draft: waterline at the box's mid-height.
const halfWl = 0
console.log('--- direct geometry measurements at half draft (wl = 0) ---')
const fullSec = computeSectionAreaMm2(box, 0)
const subSec = computeSubmergedSectionAreaMm2(box, 0, halfWl)
const lwl = computeWaterlineLengthMm(box, halfWl)
const bwl = computeWaterlineBeamMm(box, halfWl)
check('full section = B*T', Math.abs(fullSec - B * T) < 1, `${fullSec.toFixed(1)} vs ${(B * T).toFixed(1)} mm2`)
check('submerged = B*T/2', Math.abs(subSec - (B * T) / 2) < 1, `${subSec.toFixed(1)} vs ${((B * T) / 2).toFixed(1)} mm2`)
check('LWL = L', Math.abs(lwl - L) < 0.01, `${lwl.toFixed(2)} vs ${L} mm`)
check('BWL = B', Math.abs(bwl - B) < 0.01, `${bwl.toFixed(2)} vs ${B} mm`)

console.log('\n--- solver on the box (50 kg) ---')
const res = find_draft_0trim(box, 50, 100, 0)
const expectDraft = 50e6 / (L * B)
console.log(`  draft ${res.draftMm.toFixed(3)} mm (expect ${expectDraft.toFixed(3)} mm)`)
check('draft', Math.abs(res.draftMm - expectDraft) < 0.5, `${res.draftMm.toFixed(3)} mm`)
check('Cb == 1', Math.abs(res.Cb - 1) < 1e-3, `${res.Cb}`)
check('Cp == 1', Math.abs(res.Cp - 1) < 0.01, `${res.Cp}`)
check('Cm == 1', Math.abs(res.Cm - 1) < 0.01, `${res.Cm}`)
check('KB == draft/2', Math.abs(res.KB - res.draftMm / 2) < 1, `${res.KB} vs ${(res.draftMm / 2).toFixed(1)}`)
const expectBM = ((L * Math.pow(B, 3)) / 12) / 50e6
check('BM == I/V (L*B^3/12)/V', Math.abs(res.BM - expectBM) < 1, `${res.BM} vs ${expectBM.toFixed(1)} mm`)

console.log(fails === 0 ? '\nALL CHECKS PASS' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
