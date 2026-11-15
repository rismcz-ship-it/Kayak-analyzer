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
//  4. WHAT THE FORMAT STATES IS CARRIED, NOT RE-DERIVED. `lcb_lcg_offset_mm`
//     and `pivot_xyz` are the solver's own numbers; a reader's arithmetic
//     would produce a different one (|lcb-lcg| in the hull frame, or the LCG
//     standing in for the pivot), which is 6x out on the offset and a wrong
//     rotation centre for the viewer. The sample values are chosen to differ
//     from both guesses, so either re-derivation fails here.
//
//  5. A DOCUMENT MAY NOT BORROW A FIELD FROM Object.prototype. A parsed JSON
//     object still inherits `toString`, and a page whose prototype carries
//     `targets` (or anything else a required field is named) must not turn
//     "missing" into "found". Every lookup the importer makes is `hasOwn`,
//     and this suite proves it by polluting the prototype and insisting the
//     door stay shut.
//
//  6. IMPLAUSIBLE MAGNITUDES FAIL, NOT JUST IMPOSSIBLE TYPES. The schema
//     types every result field `number`, so a negative displacement, a zero
//     waterline length or a negative draft is schema-VALID and only a
//     magnitude gate catches it. One such value — a volume whose mm3
//     conversion overflows to Infinity — is worse than a wrong row: it
//     passes the read, is written by encodeRoster, and is then dropped by
//     readRoster at the next reload. A record that imports and vanishes.
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
import { SHA256_HEX_PATTERN } from '../src/lib/model-hash.js'

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
  // Deliberately NOT the LCG: the solver pitches about the bounding-box
  // centre (a z of 12.5 here against the LCG's 88.2), so a round trip through
  // the record proves the pivot is carried rather than silently guessed.
  pivot: { x: -14.1, y: 0, z: 12.5 },
  // Deliberately NOT |lcb.x - lcg.x| = 1.6: the posed-frame sweep residual is
  // its own number (0.9 here), because the hull pitches about the pivot.
  lcbLcgOffsetMm: 0.9,
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
    { heelDeg: 0, GZ: 0, minFreeboardMm: 107.3 },
    { heelDeg: 5, GZ: 12.25, minFreeboardMm: 92.8 },
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
  pattern?: string
  description?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
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
check(schema.required?.includes('coefficients') === true, 'coefficients is required at the root')
const COEFFICIENT_SCHEMA_KEYS = [
  'cb',
  'cp',
  'cm',
  'kb_mm',
  'bm_mm',
  'km_mm',
  'gm_mm',
  'cwp',
  'lcf_mm',
  'tpc',
]
for (const key of COEFFICIENT_SCHEMA_KEYS) {
  check(
    schemaCoefficients?.required?.includes(key) === true &&
      schemaCoefficients.properties?.[key] !== undefined,
    `coefficients.${key} is required and named`,
  )
}
check(
  schemaResults?.required?.includes('lcb_lcg_offset_mm') === true,
  'results requires the carried lcb_lcg_offset_mm',
)
check(
  schemaResults?.required?.includes('pivot_xyz') === true,
  'results requires the carried pivot_xyz',
)
check(schemaResults?.properties?.lcb_lcg_offset_mm !== undefined, 'lcb_lcg_offset_mm is named')
check(schemaResults?.properties?.pivot_xyz !== undefined, 'pivot_xyz is named')

// The bounds are the app's own form gate, so a document outside them is one
// the app could never have produced (F5).
check(schemaTargets?.properties?.weight_kg?.minimum === 20, 'weight_kg minimum is 20')
check(schemaTargets?.properties?.weight_kg?.maximum === 200, 'weight_kg maximum is 200')
check(schemaTargets?.properties?.kg_mm?.exclusiveMinimum === 0, 'kg_mm exclusiveMinimum is 0')
check(schemaTargets?.properties?.kg_mm?.maximum === 1000, 'kg_mm maximum is 1000')
check(schemaTargets?.properties?.heel_deg?.minimum === -30, 'heel_deg minimum is -30')
check(schemaTargets?.properties?.heel_deg?.maximum === 30, 'heel_deg maximum is 30')

// One definition of a hash, checked on both sides of the door (F11).
check(
  schema.properties?.model_hash?.pattern === SHA256_HEX_PATTERN.source,
  'model_hash is gated by sha256Hex own pattern',
  String(schema.properties?.model_hash?.pattern),
)
const hashPattern = new RegExp(schema.properties?.model_hash?.pattern ?? '$^')
check(
  hashPattern.test('f'.repeat(64)) &&
    !hashPattern.test('F'.repeat(64)) &&
    !hashPattern.test('z'.repeat(64)) &&
    !hashPattern.test('f'.repeat(63)),
  'the pattern admits 64 lowercase hex only',
)

// The frame is written down, not left for the reader to assume (F8).
check(
  typeof schema.description === 'string' &&
    /hull'?s own frame|hull frame/i.test(schema.description),
  'the root description states the hull frame',
  String(schema.description).slice(0, 60),
)
check(
  typeof schemaCoefficients?.properties?.lcf_mm?.description === 'string' &&
    /absolute/i.test(schemaCoefficients.properties.lcf_mm.description),
  'lcf_mm is documented as an absolute hull-frame x',
)

// The per-sample freeboard the end-tip angle is recomputed from (F9).
check(
  schemaResults?.properties?.gz_curve?.items?.properties?.min_freeboard_mm !== undefined,
  'gz_curve samples name the optional min_freeboard_mm',
)
check(
  schemaResults?.properties?.gz_curve?.items?.required?.includes('min_freeboard_mm') !== true,
  'min_freeboard_mm is optional, not required',
)

// --- 2. the export answers to every path the schema demands -----------------

console.log('\n=== the export answers to the schema ===')

/**
 * The schema's own required paths, root level and one level deep.
 *
 * Every property lookup is `hasOwn`, not a bracket read: a JSON object still
 * inherits Object.prototype, so `properties['constructor']` would find
 * Function.prototype's `constructor` and report a required field the schema
 * never named. The importer is held to the same rule.
 */
function requiredPaths(root: SolverSchema): string[] {
  const paths: string[] = []
  for (const key of root.required ?? []) {
    paths.push(key)
    const child = root.properties
    const properties = child !== undefined && Object.hasOwn(child, key) ? child[key] : undefined
    for (const inner of properties?.required ?? []) paths.push(`${key}.${inner}`)
  }
  return paths
}

function nodeAtPath(root: SolverSchema, path: string): SolverSchema | undefined {
  let node: SolverSchema | undefined = root
  for (const key of path.split('.')) {
    const owned: Record<string, SolverSchema> | undefined = node?.properties
    node = owned !== undefined && Object.hasOwn(owned, key) ? owned[key] : undefined
  }
  return node
}

function valueAtPath(root: unknown, path: string): unknown {
  let node: unknown = root
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    const parent = asObject(node)
    node = Object.hasOwn(parent, key) ? parent[key] : undefined
  }
  return node
}

const exported = asObject(exportRunRecord(sample))
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
  emittedKeys.every((key) => Object.hasOwn(schema.properties ?? {}, key)),
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
  results.lcb_lcg_offset_mm === sampleResult.lcbLcgOffsetMm &&
    results.lcb_lcg_offset_mm !== Math.abs(sampleResult.lcb.x - sampleResult.lcg.x),
  'results.lcb_lcg_offset_mm is the carried sweep residual, not |lcb-lcg|',
  String(results.lcb_lcg_offset_mm),
)
check(
  deepEqual(results.pivot_xyz, [sampleResult.pivot.x, sampleResult.pivot.y, sampleResult.pivot.z]),
  'results.pivot_xyz is the carried rotation centre',
  JSON.stringify(results.pivot_xyz),
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
      point.gz_mm === sampleResult.gzCurve[index].GZ &&
      point.min_freeboard_mm === sampleResult.gzCurve[index].minFreeboardMm,
  ),
  'each sample maps GZPoint to {heel_deg, gz_mm, min_freeboard_mm}',
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
const exportAgain = asObject(exportRunRecord(sample))
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
    // 3.4 against |lcb.x - lcg.x| = 2.5, so an import that re-derives fails.
    lcb_lcg_offset_mm: 3.4,
    // z -6.5 against the LCG's 89.5, so an import that guesses the LCG fails.
    pivot_xyz: [-13.75, 0.25, -6.5],
    bow_freeboard_mm: 205.25,
    stern_freeboard_mm: 29.75,
    waterline_z_mm: -31.25,
    // 40 to -8 over 0 to 10 degrees interpolates an end-tip immersion at 8.3.
    gz_curve: [
      { heel_deg: 0, gz_mm: 0, min_freeboard_mm: 40 },
      { heel_deg: 10, gz_mm: 21.5, min_freeboard_mm: -8 },
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
  check(record.result.heelDeg === 12, 'heel_deg reaches the result as well as the inputs')
  check(record.result.kgMm === 305, 'kg_mm reaches the result as well as the inputs')

  // What the format states is CARRIED, never re-derived (F2, F12): the
  // offset is the posed-frame sweep residual, not the hull-frame
  // |lcb.x - lcg.x| a reader could compute; and the pivot is the rotation
  // centre the solve actually used, whose z is NOT the LCG's KG height.
  check(record.result.displacementKg === 82.31, 'displacementKg is the liters (fresh water)')
  check(record.result.targetKg === 82.31, 'targetKg is the recorded weight')
  check(
    record.result.lcbLcgOffsetMm === 3.4,
    'lcbLcgOffsetMm is the CARRIED offset',
    String(record.result.lcbLcgOffsetMm),
  )
  check(
    record.result.lcbLcgOffsetMm !== Math.abs(record.result.lcb.x - record.result.lcg.x),
    'the carried offset is NOT re-derived from the recorded centres',
    `|lcb-lcg| = ${Math.abs(record.result.lcb.x - record.result.lcg.x)}`,
  )
  check(
    deepEqual(record.result.pivot, { x: -13.75, y: 0.25, z: -6.5 }),
    'pivot_xyz becomes the record pivot',
    JSON.stringify(record.result.pivot),
  )
  check(
    record.result.pivot.z !== record.result.lcg.z,
    'the pivot is NOT the LCG (its z is the bbox centre)',
    `pivot.z ${record.result.pivot.z} vs lcg.z ${record.result.lcg.z}`,
  )

  // The one diagnostic the import recomputes (F9): the format carries the
  // stem-tip clearance per sample, so the end-tip angle is a pure function of
  // data already in the document rather than a fixed "never immerses".
  check(
    record.result.endTipImmersionDeg === 8.3,
    'endTipImmersionDeg is recomputed from the carried freeboards',
    String(record.result.endTipImmersionDeg),
  )
  check(
    deepEqual(record.result.gzCurve, [
      { heelDeg: 0, GZ: 0, minFreeboardMm: 40 },
      { heelDeg: 10, GZ: 21.5, minFreeboardMm: -8 },
    ]),
    'gz_curve becomes the plotted curve, freeboards included',
    JSON.stringify(record.result.gzCurve),
  )

  // The solve's diagnostics are NOT part of the run-record format. An
  // imported record carries neutral values for them, and no Compare consumer
  // may read them (the table's rows all sit inside the guaranteed subset) —
  // pinned here so a future consumer cannot quietly depend on them.
  // endTipImmersionDeg is NOT here: the format carries the freeboards it is
  // computed from, so the import recomputes it rather than faking null.
  check(record.result.planesEvaluated === 0, 'planesEvaluated is neutral (not carried)')
  check(record.result.waterplaneAreaMm2 === 0, 'waterplaneAreaMm2 is neutral (not carried)')
  check(record.result.midshipAreaMm2 === 0, 'midshipAreaMm2 is neutral (not carried)')
  check(record.result.waterplaneLoopCount === 0, 'waterplaneLoopCount is neutral (not carried)')
  check(record.result.wettedSurfaceAreaMm2 === 0, 'wettedSurfaceAreaMm2 is neutral (not carried)')
  check(record.result.waterplaneIyyMm4 === 0, 'waterplaneIyyMm4 is neutral (not carried)')
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
    roundTripped.record.result.lcbLcgOffsetMm === sample.result.lcbLcgOffsetMm,
    'the carried offset survives the round trip',
    String(roundTripped.record.result.lcbLcgOffsetMm),
  )
  check(
    deepEqual(roundTripped.record.result.pivot, sample.result.pivot),
    'the carried pivot survives the round trip',
    JSON.stringify(roundTripped.record.result.pivot),
  )
  check(
    roundTripped.record.result.pivot.z !== roundTripped.record.result.lcg.z,
    'the pivot stays off the LCG across the round trip',
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

// --- 5b. a foreign volume drifts at most one ulp -------------------------------

console.log('\n=== a foreign volume drifts within one ulp ===')

// The app's own volumes are chosen exact in binary, so its round trip is
// byte-stable. A FOREIGN document's liters are arbitrary doubles, and for
// those the x1_000_000 and its inverse each round — the pair composes to a
// one-ulp drift that cannot be avoided without a decimal serialiser. The
// contract is therefore bounded, not exact: within one ulp, once, and then
// stable (a second pass emits the SAME bytes, so the drift never compounds).
const driftLiters = 121.21722797989892
const driftDoc: Record<string, unknown> = {
  ...importDocument,
  results: {
    ...(importDocument.results as Record<string, unknown>),
    volume_liters: driftLiters,
  },
}
const driftIn = parseRunRecordImport(JSON.stringify(driftDoc))
if (!driftIn.ok) {
  failures++
  console.log(`  FAIL a foreign volume was refused — ${driftIn.error}`)
} else {
  const driftDocument = exportRunRecord(driftIn.record)
  const drifted = asObject(asObject(driftDocument).results).volume_liters as number
  const drift = Math.abs(drifted - driftLiters)
  check(drift > 0, 'the multiply/divide pair really does drift', String(drift))
  check(
    drift <= driftLiters * Number.EPSILON,
    'the drift is bounded by one ulp',
    `${drift} <= ${driftLiters * Number.EPSILON}`,
  )
  const driftBack = parseRunRecordImport(JSON.stringify(driftDocument))
  check(
    driftBack.ok &&
      JSON.stringify(exportRunRecord(driftBack.record)) === JSON.stringify(driftDocument),
    'the drifted volume does not drift again on a second pass',
  )
  check(
    driftBack.ok && driftBack.record.result.displacementKg === drifted,
    'the liters stay the displaced mass (1 L = 1 kg)',
    String(driftBack.ok ? driftBack.record.result.displacementKg : drifted),
  )
}

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

// The phase gate (F6): only a run that reached the coefficients block is a
// document this app can render.
expectError('a missing phase', doc({ phase: undefined }), 'phase')
expectError('a draft_only phase', doc({ phase: 'draft_only' }), 'phase')
expectError('a trim_lcg_lcb phase', doc({ phase: 'trim_lcg_lcb' }), 'phase')
expectError('a nonsense phase', doc({ phase: 'complete' }), 'phase')

// The hash is one definition of a hash, not "some non-empty string" (F11).
expectError('a 32-character model_hash', doc({ model_hash: 'ab'.repeat(16) }), 'model_hash')
expectError('an uppercase model_hash', doc({ model_hash: 'A1'.repeat(32) }), 'model_hash')
expectError('a non-hex model_hash', doc({ model_hash: 'g1'.repeat(32) }), 'model_hash')
expectError('a non-string file_name', doc({ file_name: 42 }), 'file_name')

// The carried fields are required and must be readable (F2, F12).
expectError('a missing lcb_lcg_offset_mm', results_({ lcb_lcg_offset_mm: undefined }), 'results')
expectError('a missing pivot_xyz', results_({ pivot_xyz: undefined }), 'results.pivot_xyz')
expectError('a short pivot_xyz', results_({ pivot_xyz: [1, 2] }), 'results.pivot_xyz')
expectError(
  'a non-number min_freeboard_mm',
  results_({ gz_curve: [{ heel_deg: 5, gz_mm: 1, min_freeboard_mm: 'wet' }] }),
  'results.gz_curve',
)

// Magnitudes (F4): schema-valid numbers that describe no real hull.
expectError('a negative displacement', results_({ volume_liters: -82.31 }), 'volume_liters')
expectError('a zero waterline length', results_({ lwl_mm: 0 }), 'lwl_mm')
expectError('a zero waterline beam', results_({ bwl_mm: 0 }), 'bwl_mm')
expectError('a negative draft', results_({ draft_mm: -5 }), 'draft_mm')
expectError('a negative offset', results_({ lcb_lcg_offset_mm: -1 }), 'lcb_lcg_offset_mm')
expectError('a negative cb', coefficients_({ cb: -0.4 }), 'coefficients.cb')
expectError('a negative tpc', coefficients_({ tpc: -1 }), 'coefficients.tpc')
expectError('a missing coefficients.cb', coefficients_({ cb: undefined }), 'coefficients.cb')
// The one that imports and then vanishes (F1): 1e308 L is a finite double,
// and its mm3 conversion overflows to Infinity, which readRoster drops.
expectError('an overflowing displacement', results_({ volume_liters: 1e308 }), 'volume_liters')

// --- 7. the prototype is not a field ----------------------------------------

console.log('\n=== an inherited field is not a document field ===')

/**
 * Every required read the importer performs, planted on Object.prototype.
 * If any lookup were a plain `parent[key]` rather than `hasOwn`, the
 * document below — which never writes these fields — would satisfy them
 * from the prototype and import as a complete record.
 */
const PROTOTYPE_FIELDS: Record<string, unknown> = {
  model_hash: 'a1'.repeat(32),
  phase: 'full_coefficients',
  file_name: 'inherited.stl',
  targets: { weight_kg: 82.31, lcg_pct_lwl: 54.5, kg_mm: 305, heel_deg: 12 },
  results: 'inherited',
  coefficients: 'inherited',
  weight_kg: 82.31,
  lcg_pct_lwl: 54.5,
  kg_mm: 305,
  heel_deg: 12,
  volume_liters: 82.31,
  draft_mm: 152.75,
  lcb_lcg_offset_mm: 3.4,
  pivot_xyz: [-13.75, 0.25, -6.5],
  bow_freeboard_mm: 205.25,
  stern_freeboard_mm: 29.75,
  waterline_z_mm: -31.25,
  cb: 0.4381,
  cp: 0.5241,
  cm: 0.8366,
  gz_mm: 21.5,
  gz_curve: [{ heel_deg: 99, gz_mm: -999 }],
}

/** A JSON copy of the import document with these top-level keys deleted. */
const withoutKeys = (keys: string[]): Record<string, unknown> => {
  const copy = JSON.parse(JSON.stringify(importDocument)) as Record<string, unknown>
  for (const key of keys) delete copy[key]
  return copy
}

try {
  for (const [key, value] of Object.entries(PROTOTYPE_FIELDS)) {
    Object.defineProperty(Object.prototype, key, {
      value,
      configurable: true,
      enumerable: false,
      writable: true,
    })
  }

  check(
    (Object.prototype as Record<string, unknown>).weight_kg === 82.31,
    'the prototype is planted for this section',
  )

  // Root fields: each must read as missing, not as inherited.
  for (const key of ['model_hash', 'phase', 'targets', 'results', 'coefficients']) {
    expectError(`a document missing ${key} reads it off the prototype`, withoutKeys([key]), key)
  }

  // Nested fields: the parent objects are written, the field is not. A FRESH
  // parent per key, so deleting draft_mm cannot masquerade as deleting the
  // next field (the first failure the reader reports would be the earlier
  // delete, not the one under test).
  const withoutNested = (section: string, key: string): Record<string, unknown> => {
    const copy = JSON.parse(JSON.stringify(importDocument)) as Record<string, unknown>
    const parent = copy[section] as Record<string, unknown>
    delete parent[key]
    return copy
  }
  for (const key of [
    'draft_mm',
    'volume_liters',
    'lcb_xyz',
    'lcg_xyz',
    'lcb_lcg_offset_mm',
    'pivot_xyz',
    'bow_freeboard_mm',
    'stern_freeboard_mm',
    'waterline_z_mm',
  ]) {
    expectError(
      `a results missing ${key} reads it off the prototype`,
      withoutNested('results', key),
      `results.${key}`,
    )
  }
  for (const key of ['weight_kg', 'lcg_pct_lwl', 'kg_mm', 'heel_deg']) {
    expectError(
      `a targets missing ${key} reads it off the prototype`,
      withoutNested('targets', key),
      `targets.${key}`,
    )
  }
  for (const key of [
    'cb',
    'cp',
    'cm',
    'kb_mm',
    'bm_mm',
    'km_mm',
    'gm_mm',
    'cwp',
    'lcf_mm',
    'tpc',
  ]) {
    expectError(
      `a coefficients missing ${key} reads it off the prototype`,
      withoutNested('coefficients', key),
      `coefficients.${key}`,
    )
  }

  // A GZ sample missing its arm must not read one off the prototype either.
  const strippedCurve = results_({ gz_curve: [{ heel_deg: 10 }] })
  expectError(
    'a gz_curve sample missing gz_mm reads it off the prototype',
    strippedCurve,
    'results.gz_curve',
  )

  // An OPTIONAL field must not be adopted from the prototype either: an absent
  // gz_curve imports as the empty curve a trimmed record has, not the
  // inherited array.
  const absentCurve = parseRunRecordImport(JSON.stringify(withoutNested('results', 'gz_curve')))
  check(
    absentCurve.ok && deepEqual(absentCurve.record.result.gzCurve, []),
    'an absent gz_curve reads as empty, not as the prototype array',
    absentCurve.ok ? JSON.stringify(absentCurve.record.result.gzCurve) : absentCurve.error,
  )

  // file_name is OPTIONAL, so a prototype value for it must not be adopted:
  // the record takes the fallback name, not the inherited one.
  const inheritedName = parseRunRecordImport(JSON.stringify(withoutKeys(['file_name'])))
  check(
    inheritedName.ok && inheritedName.record.name === 'Imported run',
    'an absent file_name takes the fallback, not the prototype',
    inheritedName.ok ? inheritedName.record.name : inheritedName.error,
  )
} finally {
  for (const key of Object.keys(PROTOTYPE_FIELDS)) {
    delete (Object.prototype as Record<string, unknown>)[key]
  }
}

check(
  (Object.prototype as Record<string, unknown>).weight_kg === undefined,
  'the prototype is clean again',
)

console.log(
  failures === 0 ? '\nALL RUN-RECORD CHECKS PASSED' : `\n${failures} RUN-RECORD CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
