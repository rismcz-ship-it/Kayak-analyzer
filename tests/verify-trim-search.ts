/**
 * Gate for the cheap trim search.
 *
 * `solveTrim` now searches the trim angle with a waterline+LCB-only solve
 * (`solveDraftLcb`) and runs the full coefficient solve once on the winner.
 * The point of that split is speed, not accuracy — the draft and LCB that rank
 * the candidate angles must be the same numbers the full solve would produce,
 * or trim gets chosen against a waterline that is never reported.
 *
 * This test asserts EXACT equality on those fields, across hulls, masses and
 * heel angles. A tolerance would defeat the purpose: the split is a refactor,
 * so any difference at all means the two paths do not agree.
 *
 * There are two comparisons, and both matter:
 *
 *  1. the search half against the full solve — "the cheap solve agrees with
 *     the expensive one", and
 *  2. the frozen mirror of the search half against the PRODUCTION
 *     `solveDraftLcb` — "the production search half has not drifted".
 *
 * The second one is why the mirror exists at all. Without it, a change to
 * `solveDraftLcb` would go unnoticed here, because the test would only be
 * exercising its own copy of the code.
 *
 * Run: npm exec -- tsx tests/verify-trim-search.ts
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import {
  applyPitchY,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  computeVolumeAndCentroid,
  DEFAULT_SOLVER_TRIANGLES,
  decimateMesh,
  type Vec3,
} from '../src/lib/geometry.js'
import {
  clipBelowPlane,
  findDraft0Trim,
  solveDraftLcb,
  volumeBelowPlane,
} from '../src/lib/hydrostatics.js'

const MM3_PER_KG = 1_000_000

let checks = 0
let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  checks++
  if (ok) return
  failures++
  console.log(`  FAIL  ${label} ${detail}`)
}

/**
 * The search-half solve, mirrored from src/lib/hydrostatics.ts `solveDraftLcb`.
 *
 * It exists here as an independent copy on purpose: if the implementation is
 * ever changed to compute the waterline differently, this file must not change
 * with it, or the test would compare the new code against itself.
 *
 * Note the buffer: `new Float32Array(positions)` is a COPY. Using
 * `new Float32Array(positions.length)` allocates zeros, and applyRollX rotates
 * in place without reading the source, so a zero-filled buffer yields a flat
 * sliver at the origin — draft 0 for every case, with no error raised.
 */
function searchHalf(
  mesh: Float32Array,
  targetKg: number,
  heelRad: number,
): { draftMm: number; lcb: Vec3 } {
  let working = mesh
  if (heelRad && Math.abs(heelRad) > 1e-10) {
    const pivot = computeBounds(mesh)
    working = new Float32Array(mesh)
    applyRollXHelper(working, heelRad, pivot.center.y, pivot.center.z)
  }

  const bounds = computeBounds(working)
  const minZ = bounds.min.z
  const maxZ = bounds.max.z
  const target = targetKg * MM3_PER_KG

  if (volumeBelowPlane(working, maxZ) <= target) {
    const { clipped } = clipBelowPlane(working, maxZ)
    const { centroid } = computeVolumeAndCentroid(clipped)
    return { draftMm: maxZ - minZ, lcb: { ...centroid } }
  }

  let lo = minZ
  let hi = maxZ
  let waterlineZ = maxZ
  for (let h = maxZ - 10; h >= minZ; h -= 10) {
    if (volumeBelowPlane(working, h) <= target) {
      hi = h + 10
      lo = h
      break
    }
  }
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (volumeBelowPlane(working, mid) < target) lo = mid
    else hi = mid
    waterlineZ = mid
    if (hi - lo < 0.05) break
  }

  const { clipped } = clipBelowPlane(working, waterlineZ)
  const { centroid } = computeVolumeAndCentroid(clipped)
  return { draftMm: waterlineZ - minZ, lcb: { ...centroid } }
}

function applyRollXHelper(out: Float32Array, phiRad: number, pivotY: number, pivotZ: number): void {
  const c = Math.cos(phiRad)
  const s = Math.sin(phiRad)
  for (let i = 0; i < out.length; i += 3) {
    const y = out[i + 1] - pivotY
    const z = out[i + 2] - pivotZ
    out[i + 1] = y * c - z * s + pivotY
    out[i + 2] = y * s + z * c + pivotZ
  }
}

/**
 * Result of trying to load one STL path. The distinction matters for the
 * guard at the bottom of this file: "missing" (the file is not there) can be
 * tolerated for optional hulls, but "invalid" (present on disk, unreadable,
 * too large, or not an STL) must always fail — a corrupted mesh cannot be
 * waved off as merely absent.
 */
function loadHull(
  path: string,
): { missing: true } | { invalid: true } | { positions: Float32Array } {
  try {
    if (statSync(path).size > 40e6) return { invalid: true }
    // Node's readFileSync can return a buffer that is a view into a larger
    // pooled ArrayBuffer, so slice out exactly the file's own bytes before
    // handing them to the parser. Passing the whole pool made the STL parse
    // fail on header offsets.
    const buf = readFileSync(path)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const raw = new STLLoader().parse(ab).getAttribute('position').array as Float32Array
    const p = new Float32Array(raw)
    autoOrientToZUp(p)
    centerToOrigin(p)
    return { positions: p }
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return { missing: true }
    return { invalid: true }
  }
}

interface HullSpec {
  label: string
  paths: string[]
  masses: number[]
  /**
   * Optional local extras (~/Downloads STLs on Richard's machine). When the
   * file is absent — e.g. on CI — the hull is skipped without failing: only
   * test-kayak.stl is required by the repo's test contract (AGENTS.md).
   * Hulls present on disk still must produce cases, so a corrupted or
   * unreadable optional mesh cannot be waved off as "not found".
   */
  optional?: boolean
  /**
   * Open / partial STL sections that enclose no volume. They are loaded to
   * prove the test does not silently pass on an empty case set, but they
   * cannot float, so they contribute no comparisons.
   */
  openSection?: boolean
}

/**
 * Where the optional local hulls live.
 *
 * Override with the `KAYAK_LOCAL_HULL_DIR` environment variable. The default
 * is the current user's Downloads folder, which is where these hulls were
 * originally kept; they are optional extras, so a missing directory is not an
 * error — the suites simply skip them.
 */
const LOCAL_HULL_DIR = process.env.KAYAK_LOCAL_HULL_DIR ?? `${homedir()}/Downloads`
const localHull = (fileName: string): string => `${LOCAL_HULL_DIR}/${fileName}`

const HULLS: HullSpec[] = [
  {
    label: 'test-kayak.stl',
    // Resolved relative to this file so it works from any working directory.
    // fileURLToPath decodes the %20 in "Richard Malán" and keeps the drive
    // letter; hand-rolling that with a regex dropped the drive and left an
    // unreadable path.
    paths: [fileURLToPath(new URL('./test-kayak.stl', import.meta.url))],
    masses: [55, 65, 75, 90],
  },
  {
    label: 'Body56.stl',
    paths: [localHull('Body56.stl')],
    masses: [55, 65, 75, 90],
    optional: true,
  },
  {
    label: 'Kayak v2.stl',
    paths: [localHull('Kayak v2.stl')],
    masses: [55, 65, 75, 90],
    optional: true,
  },
  {
    label: 'kayak model bow.stl',
    paths: [localHull('kayak model bow.stl')],
    masses: [12, 18, 25, 32],
    optional: true,
    openSection: true,
  },
  {
    label: 'kayak model stern.stl',
    paths: [localHull('kayak model stern.stl')],
    masses: [12, 18, 25, 32],
    optional: true,
    openSection: true,
  },
]

const HEELS_DEG = [0, 10, 20, 30]
const TRIMS_DEG = [-3, -1.5, 0, 1.5, 3]

let totalCases = 0
const skipped: string[] = []

for (const spec of HULLS) {
  let positions: Float32Array | null = null
  // Every candidate path was absent. If any path was present but unreadable
  // ("invalid"), the hull fails below regardless of `optional`.
  let allMissing = true
  for (const p of spec.paths) {
    const load = loadHull(p)
    if ('positions' in load) {
      positions = load.positions
      break
    }
    if ('invalid' in load) {
      allMissing = false
      break
    }
  }
  if (!positions) {
    if (allMissing) {
      console.log(
        `${spec.label.padEnd(20)} SKIPPED (not found${spec.optional ? ', optional local hull — fine on CI' : ''})`,
      )
      if (!spec.optional) skipped.push(spec.label)
      continue
    }
    // Present on disk but unreadable, too large, or not an STL. Fails even
    // for optional hulls — corruption is not absence.
    console.log(`${spec.label.padEnd(20)} PRESENT BUT UNREADABLE`)
    check(`${spec.label} readable as an STL`, false, 'file exists but could not be loaded')
    continue
  }

  const dm = decimateMesh(positions, DEFAULT_SOLVER_TRIANGLES)
  const bounds = computeBounds(dm)
  const targetLcgX = bounds.max.x - 0.52 * bounds.size.x
  const totalL = volumeBelowPlane(dm, bounds.max.z) / MM3_PER_KG

  const label = spec.label
  let cases = 0
  let worstDraft = 0
  let worstLcb = 0
  let worstProdDraft = 0
  let worstProdLcb = 0

  for (const mass of spec.masses) {
    if (mass > totalL * 0.9) continue
    for (const heelDeg of HEELS_DEG) {
      const heelRad = (heelDeg * Math.PI) / 180
      for (const trimDeg of TRIMS_DEG) {
        const w = new Float32Array(dm)
        applyPitchY(w, (trimDeg * Math.PI) / 180, targetLcgX, bounds.center.z)

        let full: ReturnType<typeof findDraft0Trim>
        try {
          full = findDraft0Trim(w, mass, undefined, heelRad)
        } catch {
          continue
        }
        if (!full.converged) continue

        const half = searchHalf(w, mass, heelRad)
        const dd = Math.abs(full.draftMm - half.draftMm)
        const dl = Math.abs(full.lcb.x - half.lcb.x)
        if (dd > worstDraft) worstDraft = dd
        if (dl > worstLcb) worstLcb = dl

        check(
          `${label} mass=${mass} heel=${heelDeg} trim=${trimDeg} draft`,
          dd === 0,
          `full ${full.draftMm} vs search ${half.draftMm} (diff ${dd})`,
        )
        check(
          `${label} mass=${mass} heel=${heelDeg} trim=${trimDeg} lcb.x`,
          dl === 0,
          `full ${full.lcb.x} vs search ${half.lcb.x} (diff ${dl})`,
        )

        // The frozen mirror against the PRODUCTION search half. Without this,
        // a change to `solveDraftLcb` would go unnoticed: the test above only
        // exercises this file's own copy of the code.
        const prod = solveDraftLcb(w, mass, heelRad)
        const pd = Math.abs(prod.draftMm - half.draftMm)
        const pl = Math.abs(prod.lcb.x - half.lcb.x)
        if (pd > worstProdDraft) worstProdDraft = pd
        if (pl > worstProdLcb) worstProdLcb = pl
        check(
          `${label} mass=${mass} heel=${heelDeg} trim=${trimDeg} production search`,
          pd === 0 && pl === 0,
          `production ${prod.draftMm}/${prod.lcb.x} vs mirror ${half.draftMm}/${half.lcb.x}`,
        )
        cases++
        totalCases++
      }
    }
  }

  if (cases === 0) {
    if (spec.openSection) {
      console.log(
        `${label.padEnd(20)} open section (0 L enclosed) — loads OK, cannot float, no cases`,
      )
    } else {
      console.log(`${label.padEnd(20)} SKIPPED (no valid mass/case)`)
      check(`${label} produced cases`, false, 'no case ran')
    }
    continue
  }
  console.log(
    `${label.padEnd(20)} ${String((dm.length / 9) | 0).padStart(6)} tris  ${String(cases).padStart(4)} cases  ` +
      `worst draft ${worstDraft.toExponential(1).padStart(9)}  worst lcb ${worstLcb.toExponential(1).padStart(9)}  ` +
      `prod-vs-mirror ${worstProdDraft.toExponential(1)} / ${worstProdLcb.toExponential(1)}`,
  )
}

// Every required hull must have actually contributed cases, otherwise the
// test can pass while verifying nothing. Optional local hulls (see
// KAYAK_LOCAL_HULL_DIR) are skipped without failing when the file is absent —
// e.g. on CI — but a hull that IS on disk still must produce cases, so its
// failure is caught above even when optional. Open sections are excluded
// deliberately — they enclose no volume and cannot float.
console.log()
check('every required hull produced cases', skipped.length === 0, `skipped: ${skipped.join(', ')}`)

console.log(`\n${checks} checks, ${failures} failed, ${totalCases} cases`)
if (skipped.length) console.log(`skipped hulls: ${skipped.join(', ')}`)

if (failures > 0) {
  console.log('\nFAIL: the cheap trim search does not reproduce the full solve.')
  process.exit(1)
}
if (totalCases === 0) {
  console.log('\nFAIL: no cases ran — the test verified nothing.')
  process.exit(1)
}
console.log(
  '\nPASS: search half is bit-identical to the full solve, and to production, on every case.',
)
