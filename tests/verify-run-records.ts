// Task 3 gate — the run-record export/import pair and the schema it answers to.
//
// Why this suite exists: a run record is the one Compare artifact meant to
// leave the browser (the Task 6 export download and the import file input),
// and `references/kayak_analyzer_solver.json` is the contract it must keep.
// Three failure classes are pinned here, all silent without a suite:
//
//  1. THE SCHEMA AND THE PRODUCER MUST AGREE (repo rule 2). Every path the
//     amended schema marks required must come OUT of `exportRunRecord`, every
//     property it names must be emitted apart from the three documented as
//     not-yet-available (waterline_polygon, stations_csv_path,
//     solver_time_ms), and the amended fields must still BE in the schema —
//     so removing heel_deg from the required list, or dropping
//     bow_freeboard_mm from the export, fails here rather than shipping a
//     file another reader rejects.
//
//  2. THE ROUND TRIP MUST BE LOSSLESS OVER EVERYTHING THE FORMAT CARRIES.
//     A hull saved on one machine must read the same on another, so
//     export → JSON.stringify → parseRunRecordImport reproduces the record's
//     numbers exactly, and re-exporting an imported record reproduces the
//     SAME bytes (no drift on a second pass). Volume crosses the boundary
//     through the fresh-water identity — 1 L = 1 kg = 1_000_000 mm3 — which
//     the test pins is applied, not approximated, and the frame-sensitive
//     numbers (waterline_z_mm, both freeboards) round-trip in the hull's own
//     frame.
//
//  3. A FOREIGN FILE MUST FAIL LOUD, NEVER HALF-RESTORE. Malformed JSON, a
//     missing or wrong-typed required field, a short vector or a
//     non-numeric coefficient returns {ok:false} naming the dotted path; a
//     target the form's range gate rejects is refused by the SAME gate
//     recordFromSolve uses, so a run the form could not have produced cannot
//     enter the roster through the import door either. Unknown fields — a
//     future waterline_polygon, solver_time_ms, a stray note — are
//     tolerated, so a newer export still imports on an older app.
//
// What this suite does NOT cover: the Blob download, the file input and the
// inline error display are JSX (Task 6), covered by typecheck, `biome check`
// and a read-through.
//
// Run: npm.cmd exec -- tsx tests/verify-run-records.ts

import { readFileSync } from 'node:fs'
import {
  exportRunRecord,
  parseRunRecordImport,
  type RunRecord,
  recordFromSolve,
  type SlotInputs,
} from '../src/lib/compare.js'
import type { TrimSolveResult } from '../src/lib/hydrostatics.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/**
 * Deep equality that knows NaN is a value, not null. JSON.stringify collapses
 * both to `null`, so a text comparison calls `{ gz_mm: NaN }` equal to
 * `{ gz_mm: null }` and passes a check that must fail; plain `===` fails on
 * structures that legitimately contain NaN. NaN equals itself here, and
 * nothing else does.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b) ? true : a === b
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  return (
    aKeys.length === Object.keys(bObj).length &&
    aKeys.every((key) => Object.hasOwn(bObj, key) && deepEqual(aObj[key], bObj[key]))
  )
}

function asObject(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

/** A record's identity (id, savedAt) is fresh per import — everything else is data. */
function sameRecordIgnoringIdentity(a: RunRecord, b: RunRecord): boolean {
  return deepEqual({ ...a, id: '', savedAt: 0 }, { ...b, id: '', savedAt: 0 })
}

// --- a complete, table-rendering result -------------------------------------
// Hand-built, with values that are exact in binary floating point where the
// format converts them (volume 82_500_000 mm3 = 82.5 L), so the round-trip
// assertions below are exact rather than tolerant.

const sampleInputs: SlotInputs = { weightKg: 82.5, lcgPctLwl: 54, kgMm: 300, heelDeg: 0 }

const sampleResult: TrimSolveResult = {
  trimDeg: -1.25,
  draftMm: 141.3,
  waterlineZ: -28.75,
  displacedVolumeMm3: 82_500_000,
  displacementKg: 82.5,
  targetKg: 82.5,
  lcb: { x: -12.5, y: 3.25, z: -80.5 },
  lcg: { x: -14.1, y: 0, z: 88.2 },
  pivot: { x: -14.1, y: 0, z: 88.2 },
  lcbLcgOffsetMm: 1.6,
  waterplaneAreaMm2: 1_540_000,
  planesEvaluated: 991,
  converged: true,
  Cb: 0.4211,
  LWL: 2300.5,
  BWL: 600.25,
  midshipAreaMm2: 71_500,
  Cp: 0.5142,
  Cm: 0.8266,
  KB: 80.125,
  BM: 290.5,
  KM: 370.625,
  GM: 70.625,
  gzCurve: [
    { heelDeg: 0, GZ: 0 },
    { heelDeg: 5, GZ: 12.25 },
  ],
  bowFreeboardMm: 210.75,
  sternFreeboardMm: 31.5,
  heelDeg: 0,
  kgMm: 300,
  waterplaneLoopCount: 1,
  Cwp: 0.7124,
  wettedSurfaceAreaMm2: 1_540_000,
  waterplaneCentroidX: -95.5,
  waterplaneIyyMm4: 3.2e11,
  tpcTonnesPerCm: 0.0154,
  endTipImmersionDeg: null,
}

const sample = recordFromSolve('Sea Touring.stl', 'f'.repeat(64), sampleInputs, sampleResult)

// --- 1. the schema actually demands what the exporter emits ------------------

console.log('\n=== the amended schema ===')

interface SolverSchema {
  type?: string
  required?: string[]
  properties?: Record<string, SolverSchema>
  items?: SolverSchema
  enum?: unknown[]
}

const schema = JSON.parse(
  new TextDecoder().decode(
    readFileSync(new URL('../references/kayak_analyzer_solver.json', import.meta.url)),
  ),
) as SolverSchema

check(
  typeof schema === 'object' && schema !== null && schema.properties !== undefined,
  'the schema file parses',
)

const schemaTargets = schema.properties?.targets
const schemaResults = schema.properties?.results
const schemaCoefficients = schema.properties?.coefficients
check(schemaTargets?.required?.includes('heel_deg') === true, 'heel_deg is required in targets')
check(schemaTargets?.required?.includes('kg_mm') === true, 'kg_mm is still required in targets')
check(
  schemaResults?.required?.includes('bow_freeboard_mm') === true,
  'bow_freeboard_mm is required in results',
)
check(
  schemaResults?.required?.includes('stern_freeboard_mm') === true,
  'stern_freeboard_mm is required in results',
)
check(
  schemaResults?.required?.includes('waterline_z_mm') === true,
  'waterline_z_mm is required in results',
)
check(schemaCoefficients?.properties?.cwp !== undefined, 'cwp is named in coefficients')
check(schemaCoefficients?.properties?.lcf_mm !== undefined, 'lcf_mm is named in coefficients')
check(schemaCoefficients?.properties?.tpc !== undefined, 'tpc is named in coefficients')
check(
  schemaResults?.properties?.gz_curve?.type === 'array' &&
    schemaResults.properties.gz_curve.items?.required?.includes('heel_deg') === true &&
    schemaResults.properties.gz_curve.items?.required?.includes('gz_mm') === true,
  'gz_curve is an optional array of {heel_deg, gz_mm}',
)
check(schemaResults?.required?.includes('gz_curve') !== true, 'gz_curve is optional, not required')
check(schema.properties?.file_name !== undefined, 'file_name is named at the root')
check(schema.required?.includes('file_name') !== true, 'file_name is optional at the root')
check(
  schema.properties?.phase?.enum?.includes('full_coefficients') === true,
  'phase names full_coefficients',
)

// --- 2. the export answers to every path the schema demands -----------------

console.log('\n=== the export answers to the schema ===')

/** The schema's own required paths, root level and one level deep. */
function requiredPaths(root: SolverSchema): string[] {
  const paths: string[] = []
  for (const key of root.required ?? []) {
    paths.push(key)
    const child = root.properties?.[key]
    for (const inner of child?.required ?? []) paths.push(`${key}.${inner}`)
  }
  return paths
}

function nodeAtPath(root: SolverSchema, path: string): SolverSchema | undefined {
  let node: SolverSchema | undefined = root
  for (const key of path.split('.')) node = node?.properties?.[key]
  return node
}

function valueAtPath(root: unknown, path: string): unknown {
  let node: unknown = root
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = asObject(node)[key]
  }
  return node
}

const exported = exportRunRecord(sample) as Record<string, unknown>
const schemaPaths = requiredPaths(schema)
check(
  schemaPaths.length >= 16,
  'the schema names a real required set',
  `${schemaPaths.length} paths`,
)

for (const path of schemaPaths) {
  const node = nodeAtPath(schema, path)
  const value = valueAtPath(exported, path)
  const present = value !== undefined && value !== null
  const typed =
    node?.type === undefined ||
    (node.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : true) ||
    (node.type === 'string' ? typeof value === 'string' : true) ||
    (node.type === 'object' ? typeof value === 'object' && value !== null : true)
  check(present && typed, `the export emits the required path ${path}`, JSON.stringify(value))
}

// Every property the schema names is emitted, except the ones documented as
// not carried by the app yet — waterline_polygon (the clipper discards the
// contour after measuring it), stations_csv_path and solver_time_ms (no
// producer records them). The exclusion is by full path, so a nested
// waterline_polygon is skipped where a root-level one would be named.
const NOT_YET_EMITTED = [
  'waterline_polygon',
  'results.waterline_polygon',
  'stations_csv_path',
  'solver_time_ms',
]
const schemaNamed: string[] = []
for (const [top, node] of Object.entries(schema.properties ?? {})) {
  schemaNamed.push(top)
  for (const key of Object.keys(node.properties ?? {})) schemaNamed.push(`${top}.${key}`)
}
for (const path of schemaNamed) {
  if (NOT_YET_EMITTED.includes(path)) continue
  check(valueAtPath(exported, path) !== undefined, `the export emits the schema's ${path}`)
}

const emittedKeys = Object.keys(exported)
check(
  emittedKeys.every((key) => key in (schema.properties ?? {})),
  'the export emits nothing the schema does not name',
  emittedKeys.join(', '),
)

// --- 3. the export's field mapping ------------------------------------------

console.log('\n=== the export maps the record field by field ===')

const targets = asObject(exported.targets)
const results = asObject(exported.results)
const coefficients = asObject(exported.coefficients)

check(targets.weight_kg === sampleInputs.weightKg, 'targets.weight_kg is the slot weight')
check(targets.lcg_pct_lwl === sampleInputs.lcgPctLwl, 'targets.lcg_pct_lwl is the slot LCG')
check(targets.kg_mm === sampleInputs.kgMm, 'targets.kg_mm is the slot KG (a height)')
check(targets.heel_deg === sampleInputs.heelDeg, 'targets.heel_deg is the slot heel')

check(results.draft_mm === sampleResult.draftMm, 'results.draft_mm is the draft')
check(results.trim_deg === sampleResult.trimDeg, 'results.trim_deg is the trim')
check(results.lwl_mm === sampleResult.LWL, 'results.lwl_mm is the waterline length')
check(results.bwl_mm === sampleResult.BWL, 'results.bwl_mm is the waterline beam')
check(
  Math.abs((results.volume_liters as number) - sampleResult.displacedVolumeMm3 / 1e6) < 1e-9,
  'results.volume_liters is the displaced volume in liters',
  String(results.volume_liters),
)
check(
  deepEqual(results.lcb_xyz, [sampleResult.lcb.x, sampleResult.lcb.y, sampleResult.lcb.z]),
  'results.lcb_xyz is the centre of buoyancy',
  JSON.stringify(results.lcb_xyz),
)
check(
  deepEqual(results.lcg_xyz, [sampleResult.lcg.x, sampleResult.lcg.y, sampleResult.lcg.z]),
  'results.lcg_xyz is the target centre of gravity',
  JSON.stringify(results.lcg_xyz),
)
check(
  results.bow_freeboard_mm === sampleResult.bowFreeboardMm,
  'results.bow_freeboard_mm is the hull-frame bow freeboard',
)
check(
  results.stern_freeboard_mm === sampleResult.sternFreeboardMm,
  'results.stern_freeboard_mm is the hull-frame stern freeboard',
)
check(
  results.waterline_z_mm === sampleResult.waterlineZ,
  'results.waterline_z_mm is the hull-frame midship waterline',
)
const emittedCurve = results.gz_curve as Array<Record<string, number>>
check(Array.isArray(emittedCurve), 'results.gz_curve is an array')
check(emittedCurve.length === sampleResult.gzCurve.length, 'the curve keeps every sample')
check(
  emittedCurve.every(
    (point, index) =>
      point.heel_deg === sampleResult.gzCurve[index].heelDeg &&
      point.gz_mm === sampleResult.gzCurve[index].GZ,
  ),
  'each sample maps GZPoint{heelDeg, GZ} to {heel_deg, gz_mm}',
  JSON.stringify(emittedCurve),
)

check(coefficients.cp === sampleResult.Cp, 'coefficients.cp is Cp')
check(coefficients.cm === sampleResult.Cm, 'coefficients.cm is Cm')
check(coefficients.cb === sampleResult.Cb, 'coefficients.cb is Cb')
check(coefficients.kb_mm === sampleResult.KB, 'coefficients.kb_mm is KB')
check(coefficients.bm_mm === sampleResult.BM, 'coefficients.bm_mm is BM')
check(coefficients.km_mm === sampleResult.KM, 'coefficients.km_mm is KM')
check(coefficients.gm_mm === sampleResult.GM, 'coefficients.gm_mm is GM')
check(coefficients.cwp === sampleResult.Cwp, 'coefficients.cwp is Cwp')
check(
  coefficients.lcf_mm === sampleResult.waterplaneCentroidX,
  'coefficients.lcf_mm is the waterplane centroid x',
)
check(coefficients.tpc === sampleResult.tpcTonnesPerCm, 'coefficients.tpc is tonnes per centimetre')

check(exported.model_hash === sample.modelHash, 'model_hash is the record hash')
check(exported.file_name === sample.name, 'file_name is the record name')
check(exported.phase === 'full_coefficients', 'phase is full_coefficients')

// The export is a fresh plain object: writing into it cannot rewrite the
// frozen snapshot it came from, and two calls do not alias each other.
const exportAgain = exportRunRecord(sample) as Record<string, unknown>
check(exportAgain !== exported, 'each export is a fresh object')
asObject(exportAgain.results).draft_mm = 0
check(sample.result.draftMm === 141.3, 'writing into an export cannot touch the record')
check(deepEqual(exportRunRecord(sample), exported), 'the export is deterministic across calls')

// --- 4. the import maps a document field by field ---------------------------

console.log('\n=== the import maps a document field by field ===')

// Distinct values from the sample above: a field mapped to the wrong place
// would still pass if both documents carried the same numbers.
const importDocument: Record<string, unknown> = {
  model_hash: 'a1'.repeat(32),
  targets: { weight_kg: 82.31, lcg_pct_lwl: 54.5, kg_mm: 305, heel_deg: 12 },
  results: {
    draft_mm: 152.75,
    trim_deg: -2.5,
    lwl_mm: 2450.25,
    bwl_mm: 605.5,
    volume_liters: 82.31,
    lcb_xyz: [-11.25, 4.5, -78.75],
    lcg_xyz: [-13.75, 0.25, 89.5],
    bow_freeboard_mm: 205.25,
    stern_freeboard_mm: 29.75,
    waterline_z_mm: -31.25,
    gz_curve: [
      { heel_deg: 0, gz_mm: 0 },
      { heel_deg: 10, gz_mm: 21.5 },
    ],
  },
  coefficients: {
    cp: 0.5241,
    cm: 0.8366,
    cb: 0.4381,
    kb_mm: 84.5,
    bm_mm: 295.25,
    km_mm: 379.75,
    gm_mm: 74.75,
    cwp: 0.7224,
    lcf_mm: -88.25,
    tpc: 0.0159,
  },
  file_name: 'Sea Touring.stl',
  // Unknown fields a newer producer may add: tolerated, never fatal.
  phase: 'full_coefficients',
  solver_time_ms: 812.5,
  stations_csv_path: 'stations.csv',
  waterline_polygon: [
    [1, 2],
    [3, 4],
  ],
  future_field: { anything: true },
}

const parsed = parseRunRecordImport(JSON.stringify(importDocument))
if (!parsed.ok) {
  failures++
  console.log(`  FAIL the import refused a complete document — ${parsed.error}`)
} else {
  const record = parsed.record
  check(record.name === 'Sea Touring.stl', 'file_name becomes the record name')
  check(record.modelHash === 'a1'.repeat(32), 'model_hash becomes the record hash')
  check(
    deepEqual(record.inputs, { weightKg: 82.31, lcgPctLwl: 54.5, kgMm: 305, heelDeg: 12 }),
    'targets become the slot inputs',
    JSON.stringify(record.inputs),
  )
  check(record.result.trimDeg === -2.5, 'trim_deg becomes trimDeg')
  check(record.result.draftMm === 152.75, 'draft_mm becomes draftMm')
  check(record.result.LWL === 2450.25, 'lwl_mm becomes LWL')
  check(record.result.BWL === 605.5, 'bwl_mm becomes BWL')
  check(
    record.result.displacedVolumeMm3 === 82_310_000,
    'volume_liters becomes mm3',
    String(record.result.displacedVolumeMm3),
  )
  check(
    deepEqual(record.result.lcb, { x: -11.25, y: 4.5, z: -78.75 }),
    'lcb_xyz becomes the lcb vector',
    JSON.stringify(record.result.lcb),
  )
  check(
    deepEqual(record.result.lcg, { x: -13.75, y: 0.25, z: 89.5 }),
    'lcg_xyz becomes the lcg vector',
    JSON.stringify(record.result.lcg),
  )
  check(record.result.bowFreeboardMm === 205.25, 'bow_freeboard_mm becomes bowFreeboardMm')
  check(record.result.sternFreeboardMm === 29.75, 'stern_freeboard_mm becomes sternFreeboardMm')
  check(record.result.waterlineZ === -31.25, 'waterline_z_mm becomes waterlineZ')
  check(record.result.Cb === 0.4381, 'coefficients.cb becomes Cb')
  check(record.result.Cp === 0.5241, 'coefficients.cp becomes Cp')
  check(record.result.Cm === 0.8366, 'coefficients.cm becomes Cm')
  check(record.result.KB === 84.5, 'coefficients.kb_mm becomes KB')
  check(record.result.BM === 295.25, 'coefficients.bm_mm becomes BM')
  check(record.result.KM === 379.75, 'coefficients.km_mm becomes KM')
  check(record.result.GM === 74.75, 'coefficients.gm_mm becomes GM')
  check(record.result.Cwp === 0.7224, 'coefficients.cwp becomes Cwp')
  check(
    record.result.waterplaneCentroidX === -88.25,
    'coefficients.lcf_mm becomes waterplaneCentroidX',
  )
  check(record.result.tpcTonnesPerCm === 0.0159, 'coefficients.tpc becomes tpcTonnesPerCm')
  check(
    deepEqual(record.result.gzCurve, [
      { heelDeg: 0, GZ: 0 },
      { heelDeg: 10, GZ: 21.5 },
    ]),
    'gz_curve becomes the plotted curve',
    JSON.stringify(record.result.gzCurve),
  )
  check(record.result.heelDeg === 12, 'heel_deg reaches the result as well as the inputs')
  check(record.result.kgMm === 305, 'kg_mm reaches the result as well as the inputs')

  // Coherence the format implies and the import must honour: fresh water, so
  // liters ARE kilograms; the offset is the recorded pairing's own; and the
  // pose pivot is the LCG, which is what the scene seam falls back to.
  check(record.result.displacementKg === 82.31, 'displacementKg is the liters (fresh water)')
  check(record.result.targetKg === 82.31, 'targetKg is the recorded weight')
  check(
    Math.abs(record.result.lcbLcgOffsetMm - Math.abs(-11.25 - -13.75)) < 1e-9,
    'lcbLcgOffsetMm is the recorded centres own offset',
    String(record.result.lcbLcgOffsetMm),
  )
  check(
    deepEqual(record.result.pivot, record.result.lcg),
    'the pivot is the LCG (the seam fallback)',
    JSON.stringify(record.result.pivot),
  )

  // The solve's diagnostics are NOT part of the run-record format. An
  // imported record carries neutral values for them, and no Compare consumer
  // may read them (the table's rows all sit inside the guaranteed subset) —
  // pinned here so a future consumer cannot quietly depend on them.
  check(record.result.planesEvaluated === 0, 'planesEvaluated is neutral (not carried)')
  check(record.result.waterplaneAreaMm2 === 0, 'waterplaneAreaMm2 is neutral (not carried)')
  check(record.result.midshipAreaMm2 === 0, 'midshipAreaMm2 is neutral (not carried)')
  check(record.result.waterplaneLoopCount === 0, 'waterplaneLoopCount is neutral (not carried)')
  check(record.result.wettedSurfaceAreaMm2 === 0, 'wettedSurfaceAreaMm2 is neutral (not carried)')
  check(record.result.waterplaneIyyMm4 === 0, 'waterplaneIyyMm4 is neutral (not carried)')
  check(record.result.endTipImmersionDeg === null, 'endTipImmersionDeg is null (not carried)')
  check(
    record.result.converged === true,
    'converged is true: a full coefficient set only a completed solve emits',
  )

  check(record.id.startsWith('rec_'), 'the import builds a fresh id', record.id)
  check(
    Math.abs(record.savedAt - Date.now()) < 5000,
    'the import stamps savedAt now',
    `off by ${Date.now() - record.savedAt} ms`,
  )
  check(Object.isFrozen(record) && Object.isFrozen(record.inputs), 'the import snapshot is frozen')
}

// Absent optional parts: an empty curve and a missing file_name still import.
const minimal = parseRunRecordImport(
  JSON.stringify({
    ...importDocument,
    results: { ...(importDocument.results as Record<string, unknown>), gz_curve: undefined },
    file_name: undefined,
  }),
)
if (!minimal.ok) {
  failures++
  console.log(`  FAIL a document without gz_curve or file_name was refused — ${minimal.error}`)
} else {
  check(
    deepEqual(minimal.record.result.gzCurve, []),
    'an absent gz_curve imports as an empty curve',
  )
  check(
    typeof minimal.record.name === 'string' && minimal.record.name.length > 0,
    'an absent file_name still names the record',
    minimal.record.name,
  )
}

const importedTwice = parseRunRecordImport(JSON.stringify(importDocument))
check(
  importedTwice.ok && parsed.ok && importedTwice.record.id !== parsed.record.id,
  'two imports of one document get different ids',
)

// --- 5. the round trip -------------------------------------------------------

console.log('\n=== the round trip ===')

const roundTripped = parseRunRecordImport(JSON.stringify(exportRunRecord(sample)))
if (!roundTripped.ok) {
  failures++
  console.log(`  FAIL the exported sample would not import — ${roundTripped.error}`)
} else {
  check(
    roundTripped.record.result.planesEvaluated === 0 &&
      roundTripped.record.result.waterplaneAreaMm2 === 0 &&
      roundTripped.record.result.wettedSurfaceAreaMm2 === 0 &&
      sample.result.planesEvaluated === 991,
    'the diagnostics the format omits are not fabricated on import',
    `planesEvaluated ${roundTripped.record.result.planesEvaluated}`,
  )
  check(deepEqual(roundTripped.record.inputs, sample.inputs), 'the inputs survive the round trip')
  check(
    deepEqual(roundTripped.record.result.lcb, sample.result.lcb) &&
      deepEqual(roundTripped.record.result.lcg, sample.result.lcg),
    'both centres survive the round trip',
  )
  check(
    deepEqual(roundTripped.record.result.gzCurve, sample.result.gzCurve),
    'the GZ curve survives the round trip',
    JSON.stringify(roundTripped.record.result.gzCurve),
  )
  check(
    roundTripped.record.result.displacedVolumeMm3 === 82_500_000,
    'the volume survives the liters round trip exactly',
    String(roundTripped.record.result.displacedVolumeMm3),
  )
  check(
    roundTripped.record.result.waterlineZ === sample.result.waterlineZ &&
      roundTripped.record.result.bowFreeboardMm === sample.result.bowFreeboardMm &&
      roundTripped.record.result.sternFreeboardMm === sample.result.sternFreeboardMm,
    'the hull-frame numbers survive the round trip',
  )
  check(
    roundTripped.record.result.heelDeg === sampleInputs.heelDeg &&
      roundTripped.record.result.kgMm === sampleInputs.kgMm,
    'the reproducibility numbers (heel, KG) survive the round trip',
  )
  check(
    deepEqual(exportRunRecord(roundTripped.record), exportRunRecord(sample)),
    're-exporting an imported record gives the same document',
  )
  check(
    JSON.stringify(exportRunRecord(roundTripped.record)) ===
      JSON.stringify(exportRunRecord(sample)),
    're-export is byte-stable (no drift on a second pass)',
  )
  check(
    roundTripped.record.id !== sample.id,
    'the round trip is a fresh snapshot, not the same record',
  )
}

// A hand-written document survives a second round trip unchanged too.
const firstPass = parseRunRecordImport(JSON.stringify(importDocument))
const secondPass = parseRunRecordImport(
  JSON.stringify(exportRunRecord(firstPass.ok ? firstPass.record : sample)),
)
check(
  firstPass.ok && secondPass.ok && sameRecordIgnoringIdentity(firstPass.record, secondPass.record),
  'a foreign document round-trips to itself',
)

// --- 6. a bad file fails loud -------------------------------------------------

console.log('\n=== a bad file fails loud ===')

function expectError(label: string, document: unknown, needle: string): void {
  let outcome: { ok: boolean; error?: string }
  try {
    outcome = parseRunRecordImport(
      typeof document === 'string' ? document : JSON.stringify(document),
    )
  } catch (error) {
    failures++
    console.log(
      `  FAIL ${label} — threw: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }
  if (outcome.ok) {
    failures++
    console.log(`  FAIL ${label} — the import accepted it`)
    return
  }
  check(outcome.error?.includes(needle) === true, `${label} names ${needle}`, outcome.error)
}

const doc = (patch: Record<string, unknown>): Record<string, unknown> => ({
  ...importDocument,
  ...patch,
})
const targets_ = (patch: Record<string, unknown>): Record<string, unknown> =>
  doc({ targets: { ...(importDocument.targets as Record<string, unknown>), ...patch } })
const results_ = (patch: Record<string, unknown>): Record<string, unknown> =>
  doc({ results: { ...(importDocument.results as Record<string, unknown>), ...patch } })
const coefficients_ = (patch: Record<string, unknown>): Record<string, unknown> =>
  doc({ coefficients: { ...(importDocument.coefficients as Record<string, unknown>), ...patch } })

expectError('an empty file', '', 'JSON')
expectError('text that is not JSON', 'draft_mm: 152.75', 'JSON')
expectError('a truncated JSON object', '{"model_hash": "abc"', 'JSON')
expectError('a JSON number', '42', 'object')
expectError('a JSON array', '[]', 'object')
expectError('JSON null', 'null', 'object')
expectError('a missing model_hash', doc({ model_hash: undefined }), 'model_hash')
expectError('a non-string model_hash', doc({ model_hash: 42 }), 'model_hash')
expectError('an empty model_hash', doc({ model_hash: '' }), 'model_hash')
expectError('a missing targets', doc({ targets: undefined }), 'targets')
expectError('a non-object targets', doc({ targets: 'sea kayak' }), 'targets')
expectError('a missing targets.kg_mm', targets_({ kg_mm: undefined }), 'targets.kg_mm')
expectError('a null targets.kg_mm', targets_({ kg_mm: null }), 'targets.kg_mm')
expectError('a missing targets.heel_deg', targets_({ heel_deg: undefined }), 'targets.heel_deg')
expectError('a text targets.weight_kg', targets_({ weight_kg: '82.31' }), 'targets.weight_kg')
expectError('a missing results', doc({ results: undefined }), 'results')
expectError('an empty results', doc({ results: {} }), 'results.draft_mm')
expectError('a null results.draft_mm', results_({ draft_mm: null }), 'results.draft_mm')
expectError('a short lcb_xyz', results_({ lcb_xyz: [1, 2] }), 'results.lcb_xyz')
expectError('a text lcb_xyz', results_({ lcb_xyz: 'centre' }), 'results.lcb_xyz')
expectError('a non-number in lcb_xyz', results_({ lcb_xyz: [1, 2, 'three'] }), 'results.lcb_xyz')
expectError('a non-array lcg_xyz', results_({ lcg_xyz: { x: 0, y: 0, z: 0 } }), 'results.lcg_xyz')
expectError('a missing coefficients', doc({ coefficients: undefined }), 'coefficients')
expectError('a coefficients missing tpc', coefficients_({ tpc: undefined }), 'coefficients.tpc')
expectError('a null gm_mm', coefficients_({ gm_mm: null }), 'coefficients.gm_mm')
expectError('a non-array gz_curve', results_({ gz_curve: { heel_deg: 0 } }), 'results.gz_curve')
expectError('a null gz_curve element', results_({ gz_curve: [null] }), 'results.gz_curve')
expectError(
  'a gz_curve element missing gz_mm',
  results_({ gz_curve: [{ heel_deg: 5 }] }),
  'results.gz_curve',
)
expectError(
  'a NaN gz_curve sample',
  results_({ gz_curve: [{ heel_deg: 0, gz_mm: null }] }),
  'results.gz_curve',
)

// A target outside the form's range is refused by the SAME gate the form
// uses — the import door must not open where the creation door is shut. That
// gate's message names the SlotInputs field it refused (weightKg, lcgPctLwl…),
// which is the field the caller would have to fix.
expectError('a 500 kg weight', targets_({ weight_kg: 500 }), 'weight')
expectError('a 150 % LCG', targets_({ lcg_pct_lwl: 150 }), 'lcgPctLwl')
expectError('a 0 mm KG', targets_({ kg_mm: 0 }), 'kgMm')
expectError('a 45 degree heel', targets_({ heel_deg: 45 }), 'heel')

console.log(
  failures === 0 ? '\nALL RUN-RECORD CHECKS PASSED' : `\n${failures} RUN-RECORD CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
