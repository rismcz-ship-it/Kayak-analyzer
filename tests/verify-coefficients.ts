// Verify the coefficient fix against INDEPENDENT ground truth.
// The truth side slices the mesh itself; nothing here calls the app's
// section-area, waterline-length, or waterline-beam code.
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { autoOrientToZUp, centerToOrigin, computeBounds } from '../src/lib/geometry.js'
import { solve_trim } from '../src/lib/hydrostatics.js'
import * as fs from 'fs'

const buffer = fs.readFileSync(new URL('./test-kayak.stl', import.meta.url))
const geometry = new STLLoader().parse(buffer.buffer as ArrayBuffer)
const positions = geometry.getAttribute('position').array as Float32Array
autoOrientToZUp(positions)
centerToOrigin(positions)
const b = computeBounds(positions)

function sectionPts(p: Float32Array, xCut: number) {
  const ys: number[] = []
  const zs: number[] = []
  for (let i = 0; i < p.length; i += 9) {
    const vx = [p[i], p[i + 3], p[i + 6]]
    const vy = [p[i + 1], p[i + 4], p[i + 7]]
    const vz = [p[i + 2], p[i + 5], p[i + 8]]
    for (let e = 0; e < 3; e++) {
      const a = e
      const c = (e + 1) % 3
      const fa = vx[a] - xCut
      const fc = vx[c] - xCut
      if ((fa <= 0) === (fc <= 0)) continue
      const tt = fa / (fa - fc)
      ys.push(vy[a] + tt * (vy[c] - vy[a]))
      zs.push(vz[a] + tt * (vz[c] - vz[a]))
    }
  }
  return { ys, zs }
}

function subArea(p: Float32Array, xCut: number, h: number) {
  const { ys, zs } = sectionPts(p, xCut)
  const sy: number[] = []
  const sz: number[] = []
  for (let k = 0; k < ys.length; k++) if (zs[k] <= h) { sy.push(ys[k]); sz.push(zs[k]) }
  if (sy.length < 3) return { area: 0, beam: 0, depth: 0 }
  const my = sy.reduce((s, v) => s + v, 0) / sy.length
  const mz = sz.reduce((s, v) => s + v, 0) / sz.length
  const ord = sy.map((_, k) => k).sort((p1, q) => Math.atan2(sz[p1] - mz, sy[p1] - my) - Math.atan2(sz[q] - mz, sy[q] - my))
  let a2 = 0
  for (let k = 0; k < ord.length; k++) {
    const p1 = ord[k]; const q = ord[(k + 1) % ord.length]
    a2 += sy[p1] * sz[q] - sy[q] * sz[p1]
  }
  return {
    area: Math.abs(a2 / 2),
    beam: Math.max(...sy) - Math.min(...sy),
    depth: h - Math.min(...sz),
  }
}

function wlExtent(p: Float32Array, h: number) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < p.length; i += 9) {
    const vx = [p[i], p[i + 3], p[i + 6]]
    const vy = [p[i + 1], p[i + 4], p[i + 7]]
    const vz = [p[i + 2], p[i + 5], p[i + 8]]
    for (let e = 0; e < 3; e++) {
      const a = e; const c = (e + 1) % 3
      const fa = vz[a] - h; const fc = vz[c] - h
      if ((fa <= 0) === (fc <= 0)) continue
      const tt = fa / (fa - fc)
      const x = vx[a] + tt * (vx[c] - vx[a])
      const y = vy[a] + tt * (vy[c] - vy[a])
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
  }
  return { LWL: maxX - minX, BWL: maxY - minY }
}

const N = 400 // app uses 50; sampling-density difference is expected
let fails = 0
const check = (label: string, ok: boolean, detail: string) => {
  if (!ok) fails++
  console.log(`  ${label.padEnd(4)} ${detail}  ${ok ? 'ok' : '<<< MISMATCH'}`)
}

for (const kg of [55, 65, 75]) {
  const t = solve_trim(positions, kg)
  const wl = t.waterlineZ
  const draft = wl - b.min.z
  const V = t.displacedVolumeMm3

  let truthAm = 0, truthBeam = 0, truthDepth = 0
  for (let i = 0; i <= N; i++) {
    const x = b.min.x + (b.size.x * i) / N
    const s = subArea(positions, x, wl)
    if (s.area > truthAm) { truthAm = s.area; truthBeam = s.beam; truthDepth = s.depth }
  }
  const { LWL, BWL } = wlExtent(positions, wl)
  const CbT = V / (LWL * BWL * draft)
  const CpT = V / (truthAm * LWL)
  const CmT = truthAm / (truthBeam * truthDepth)

  console.log(`\n===== ${kg} kg =====  draft ${draft.toFixed(1)} mm | LWL ${LWL.toFixed(1)} | BWL ${BWL.toFixed(1)}`)
  check('Cb', Math.abs(t.Cb - CbT) <= 0.03, `app ${t.Cb.toFixed(4)}  truth ${CbT.toFixed(4)}`)
  check('Cp', Math.abs(t.Cp - CpT) <= 0.06, `app ${t.Cp.toFixed(4)}  truth ${CpT.toFixed(4)}`)
  check('Cm', Math.abs(t.Cm - CmT) <= 0.12, `app ${t.Cm.toFixed(4)}  truth ${CmT.toFixed(4)}`)
  check('Cm<=1', t.Cm > 0 && t.Cm <= 1, `app ${t.Cm.toFixed(4)}`)
  check('Cb range', t.Cb > 0 && t.Cb <= 1, `app ${t.Cb.toFixed(4)}`)
  console.log(`  disp ${t.displacementKg.toFixed(2)} kg | trim ${t.trimDeg} deg | KB/BM/KM/GM ${t.KB}/${t.BM}/${t.KM}/${t.GM}`)
}

console.log(fails === 0 ? '\nALL CHECKS PASS' : `\n${fails} CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
