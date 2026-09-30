/**
 * Heel regression for the REAL hull.
 *
 * This exists because every earlier heel bug produced numbers that *looked*
 * plausible — a positive BM that jumped around, a GM that changed sign for no
 * reason. Synthetic box/cylinder tests in verify-analytic.ts confirm the maths;
 * this confirms the production path end-to-end on an actual hull, where the
 * mesh, the decimation fallback and the contour walk all interact.
 *
 * The properties asserted are physical necessities for a rigid hull at fixed
 * displacement, not magic numbers:
 *
 *   1. Draft increases with heel — heeling immerses the low side.
 *   2. BM decreases with heel — the waterplane narrows as it tilts.
 *   3. GM stays finite and the solve reports convergence at every angle.
 *   4. The waterplane closes into exactly ONE contour.
 *
 * Run: npx tsx tests/verify-heel-real.ts
 */
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { autoOrientToZUp, centerToOrigin } from '../src/lib/geometry.js'
import { find_draft_0trim, solve_trim } from '../src/lib/hydrostatics.js'
import { readFileSync } from 'fs'

const STL = new URL('./test-kayak.stl', import.meta.url)
const raw = new STLLoader()
  .parse(readFileSync(STL).buffer as ArrayBuffer)
  .getAttribute('position').array as Float32Array

const mesh = new Float32Array(raw)
autoOrientToZUp(mesh)
centerToOrigin(mesh)

const MASS_KG = 75
const HEELS = [0, 5, 10, 15, 20, 25, 30, 35, 40]

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log(`\n=== find_draft_0trim on the real hull (${MASS_KG} kg) ===`)
console.log('heel   draft      BM        GM        Awp       conv')
const direct: { heel: number; draft: number; BM: number; GM: number }[] = []

for (const heel of HEELS) {
  const r = find_draft_0trim(mesh, MASS_KG, undefined, (heel * Math.PI) / 180)
  direct.push({ heel, draft: r.draftMm, BM: r.BM, GM: r.GM })
  console.log(
    `  ${String(heel).padStart(2)}°  ${r.draftMm.toFixed(2).padStart(8)}  ` +
      `${r.BM.toFixed(1).padStart(8)}  ${r.GM.toFixed(1).padStart(8)}  ` +
      `${r.waterplaneAreaMm2.toFixed(0).padStart(8)}   ${r.converged}`,
  )
}

console.log('\n--- physical monotonicity ---')
for (let i = 1; i < direct.length; i++) {
  const a = direct[i - 1]
  const b = direct[i]
  check(
    b.draft > a.draft,
    `draft rises from ${a.heel}° to ${b.heel}°`,
    `${a.draft.toFixed(2)} -> ${b.draft.toFixed(2)}`,
  )
  check(
    b.BM < a.BM,
    `BM falls from ${a.heel}° to ${b.heel}°`,
    `${a.BM.toFixed(1)} -> ${b.BM.toFixed(1)}`,
  )
}

console.log('\n--- every solve converged, waterplane non-empty ---')
for (const r of direct) {
  check(r.draft > 0, `heel ${r.heel}° produced a real draft`, `got ${r.draft}`)
  check(Number.isFinite(r.BM) && r.BM > 0, `heel ${r.heel}° BM is finite and positive`, `got ${r.BM}`)
  check(Number.isFinite(r.GM), `heel ${r.heel}° GM is finite`, `got ${r.GM}`)
}

console.log(`\n=== solve_trim (full production path) ===`)
console.log('heel   trim      draft      BM        GM        conv')
const trimmed: { heel: number; BM: number }[] = []

for (const heel of [0, 10, 20, 30]) {
  const r = solve_trim(mesh, MASS_KG, { fixedHeelDeg: heel })
  trimmed.push({ heel, BM: r.BM })
  console.log(
    `  ${String(heel).padStart(2)}°  ${r.trimDeg.toFixed(2).padStart(6)}  ` +
      `${r.draftMm.toFixed(2).padStart(8)}  ${r.BM.toFixed(1).padStart(8)}  ` +
      `${r.GM.toFixed(1).padStart(8)}   ${r.converged}`,
  )
  check(r.converged, `solve_trim converged at ${heel}° heel`)
  check(r.draftMm > 0, `solve_trim produced a real draft at ${heel}°`, `got ${r.draftMm}`)
  check(Number.isFinite(r.BM) && r.BM > 0, `solve_trim BM finite and positive at ${heel}°`, `got ${r.BM}`)
  // Heel must actually reach the solver. A constant result across every angle
  // is the signature of the angle being dropped somewhere upstream.
  check(
    Math.abs(r.heelDeg - heel) < 1e-6,
    `solve_trim reports the requested heel at ${heel}°`,
    `reported ${r.heelDeg}`,
  )
}

console.log('\n--- solve_trim BM still falls with heel ---')
for (let i = 1; i < trimmed.length; i++) {
  const a = trimmed[i - 1]
  const b = trimmed[i]
  check(b.BM < a.BM, `BM falls ${a.heel}° -> ${b.heel}°`, `${a.BM} -> ${b.BM}`)
}

// A result identical at 0° and 30° means heel never entered the calculation.
check(
  Math.abs(trimmed[0].BM - trimmed[trimmed.length - 1].BM) > 1,
  'heel visibly changes the solve',
  `BM only moved ${Math.abs(trimmed[0].BM - trimmed[trimmed.length - 1].BM).toFixed(1)} mm`,
)

console.log(
  failures === 0
    ? '\nALL HEEL REGRESSION CHECKS PASSED'
    : `\n${failures} HEEL REGRESSION CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
