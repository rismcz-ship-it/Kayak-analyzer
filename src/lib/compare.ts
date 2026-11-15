/**
 * The Compare roster: the records one hull analysis leaves behind for
 * side-by-side comparison, and the only Compare state that outlives a reload.
 *
 * Two rules hold this module together, both from the design spec:
 *
 *  1. **Records are immutable snapshots.** Adding and deleting are the only
 *     roster operations. A slot's live re-solve never rewrites the record it
 *     was picked from — a second slot may be showing it — and export captures
 *     what a slot DISPLAYS, never a stale record. So nothing here mutates a
 *     record after `recordFromSolve` builds it.
 *
 *  2. **A record carries numbers, never geometry.** The result is the full
 *     metric set the comparison table renders (`gzCurve` included, a few KB);
 *     the mesh itself lives in an in-memory cache keyed by `modelHash` and
 *     dies with the session, so a restored record shows its numbers and asks
 *     for its STL.
 *
 * The restore path shares one gate with the form: a record's inputs are
 * judged by the same `*Usable` predicates `inputs.ts` exports, so a stored
 * value the form rejects cannot enter the roster through the back door. And
 * like `readStoredInputs`, a hostile roster — absent key, non-JSON, a JSON
 * non-array, wrong-typed entries, a reader that throws — degrades to [] or a
 * filtered roster with the valid siblings kept. The Compare tab must render.
 *
 * Layering: the imports are the `TrimSolveResult` and `GZPoint` types (erased
 * at compile time), the `Vec3` type, one unit constant (`MM3_PER_KG`, fresh
 * water), one solver function (`endTipImmersionHeelDeg` — the only diagnostic
 * an import recomputes), the pattern `sha256Hex`'s own output is checked
 * against, and four value predicates from `inputs.ts`. Framework-free, so the
 * suite runs in Node with no browser shims.
 */

import type { Vec3 } from './geometry'
import {
  endTipImmersionHeelDeg,
  type GZPoint,
  MM3_PER_KG,
  type TrimSolveResult,
} from './hydrostatics'
import { heelUsable, kgUsable, lcgUsable, type StorageReader, weightUsable } from './inputs'
import { SHA256_HEX_PATTERN } from './model-hash'

/** One slot's conditions. Heel 0 is upright; + heels the −Y side down. */
export interface SlotInputs {
  weightKg: number
  /** Longitudinal centre of gravity, % of LWL from the bow. */
  lcgPctLwl: number
  /** Height of the centre of gravity above the keel, mm — never an absolute Z. */
  kgMm: number
  heelDeg: number
}

/** A saved comparison record: an immutable snapshot of one solved hull. */
export interface RunRecord {
  /** `rec_` + counter + timestamp — unique within a session and across reloads. */
  id: string
  /** Display name (the source STL's file name). */
  name: string
  /** SHA-256 of the raw STL bytes; the re-pick check compares against this. */
  modelHash: string
  inputs: SlotInputs
  /**
   * The solved metrics the comparison renders. A record built by
   * `recordFromSolve` carries the solver's whole result; one restored from
   * storage is guaranteed only the subset `readRoster` validates —
   * `RESULT_NUMBERS` plus the two vectors and `gzCurve`. The solve's
   * diagnostics (`planesEvaluated`, `wettedSurfaceAreaMm2` and the rest)
   * may be absent on such a record, so no Compare consumer may read them
   * off one; the comparison table's rows all sit inside the guaranteed
   * subset. The rotation `pivot` is the one diagnostic the run-record
   * format carries (`pivot_xyz`), so an IMPORTED record has the solver's
   * own rotation centre — the pivot a live solve used, not the LCG a
   * fallback would guess.
   */
  result: TrimSolveResult
  savedAt: number
}

/** Versioned so a future schema change can tell its own entries apart. */
export const COMPARE_STORAGE_KEY = 'kayak-analyzer.compare.v1'

let nextRecordId = 1

/**
 * The first slot input the form's range gate rejects, or null when the set is
 * one the form could have produced. `readRoster` judges stored inputs with
 * `isSlotInputs` below; `recordFromSolve` runs this same gate so a value the
 * form rejects cannot enter the roster in memory, get written by
 * `encodeRoster`, and then silently vanish at the next read — the back door
 * the shared gate exists to close.
 */
function slotInputsProblem(inputs: SlotInputs): string | null {
  if (!weightUsable(inputs.weightKg)) return `weightKg ${inputs.weightKg}`
  if (!lcgUsable(inputs.lcgPctLwl)) return `lcgPctLwl ${inputs.lcgPctLwl}`
  if (!kgUsable(inputs.kgMm)) return `kgMm ${inputs.kgMm}`
  if (!heelUsable(inputs.heelDeg)) return `heelDeg ${inputs.heelDeg}`
  return null
}

/**
 * A record's private copy of a solve result: the top level, the centre
 * vectors and the plotted curve. Taking the copy here is what makes
 * "immutable snapshot" true rather than aspirational — a caller (Task 6's
 * slot panel adopting a record's inputs, Task 7's auto-roster passing the
 * app's live objects) that goes on editing what it passed in cannot rewrite
 * a saved record.
 */
function cloneSolveResult(result: TrimSolveResult): TrimSolveResult {
  return {
    ...result,
    lcb: { ...result.lcb },
    lcg: { ...result.lcg },
    pivot: { ...result.pivot },
    gzCurve: result.gzCurve.map((point) => ({ ...point })),
  }
}

/**
 * Build a record from a fresh solve — the snapshot of what the solve
 * reported at these conditions, and nothing else may ever change it.
 *
 * Two guards run before the record exists. The inputs go through the same
 * range gate the form and `readRoster` use, so a value the form rejects
 * throws here instead of building a record that storage will drop on the
 * next reload; and the model hash must be a real one, because a record with
 * no hash can never be re-picked against its STL. Both throws name the
 * field, so the caller (the auto-add path) can surface the cause.
 *
 * The id mixes a counter with one captured timestamp, so two saves in the
 * same millisecond (two slots, or a fast double analysis) still differ and
 * the id's stamp agrees with `savedAt`. The record and its copies are
 * frozen: an accidental in-place write throws instead of silently
 * rewriting a snapshot another slot may be showing.
 */
export function recordFromSolve(
  name: string,
  modelHash: string,
  inputs: SlotInputs,
  result: TrimSolveResult,
): RunRecord {
  const problem = slotInputsProblem(inputs)
  if (problem) {
    throw new Error(`recordFromSolve: an input the form rejects cannot build a record (${problem})`)
  }
  if (typeof modelHash !== 'string' || modelHash.length === 0) {
    throw new Error('recordFromSolve: modelHash must be a non-empty SHA-256 hex string')
  }
  const savedAt = Date.now()
  const inputsSnapshot: SlotInputs = { ...inputs }
  const resultSnapshot = cloneSolveResult(result)
  Object.freeze(inputsSnapshot)
  Object.freeze(resultSnapshot)
  Object.freeze(resultSnapshot.lcb)
  Object.freeze(resultSnapshot.lcg)
  Object.freeze(resultSnapshot.pivot)
  for (const point of resultSnapshot.gzCurve) Object.freeze(point)
  return Object.freeze({
    id: `rec_${nextRecordId++}_${savedAt.toString(36)}`,
    name,
    modelHash,
    inputs: inputsSnapshot,
    result: resultSnapshot,
    savedAt,
  })
}

/** Serialize the roster for storage. Plain JSON: what comes back must deep-equal. */
export function encodeRoster(records: RunRecord[]): string {
  return JSON.stringify(records)
}

/**
 * Read the persisted roster, or [] — never a throw, never a partial crash.
 *
 * Anything untrustworthy falls back to nothing, exactly as
 * `readStoredInputs` does: a note written into the browser's storage must
 * never stop the Compare tab from rendering. Entries that fail validation
 * are dropped individually, so one corrupt record cannot take the valid
 * siblings with it.
 */
export function readRoster(read: StorageReader): RunRecord[] {
  let parsed: unknown
  try {
    const raw = read(COMPARE_STORAGE_KEY)
    if (raw === null) return []
    parsed = JSON.parse(raw)
  } catch {
    // Private mode, a disabled storage API, hand-edited JSON: empty roster.
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter(isRunRecord)
}

/** Remove exactly the target id; anything else is returned unchanged. */
export function deleteRecord(records: RunRecord[], id: string): RunRecord[] {
  return records.filter((record) => record.id !== id)
}

/**
 * Human labels for the conditions two slots differ in — the table's
 * "these two run at different conditions" note names them. Empty when the
 * slots are directly comparable, which is the state the note should not
 * appear in (a flags-free comparison at the same conditions is the default
 * reading of the table).
 */
export function conditionsDiffer(a: SlotInputs, b: SlotInputs): string[] {
  const labels: string[] = []
  if (a.weightKg !== b.weightKg) labels.push('weight')
  if (a.lcgPctLwl !== b.lcgPctLwl) labels.push('LCG')
  if (a.kgMm !== b.kgMm) labels.push('KG')
  if (a.heelDeg !== b.heelDeg) labels.push('heel')
  return labels
}

// --- run-record export / import ----------------------------------------------

/** One `[x, y, z]`, in the hull's own frame, as the schema spells it. */
type Xyz = [number, number, number]

/**
 * The run-record document `references/kayak_analyzer_solver.json` describes:
 * the one Compare artifact meant to leave the browser, and the contract the
 * import trusts. Every field the schema names and the app can produce is
 * emitted; the three the schema documents as not-yet-available
 * (`waterline_polygon` — the clipper discards the contour after measuring
 * it, `stations_csv_path`, `solver_time_ms`) are not, because nothing in the
 * app produces them.
 *
 * The document CARRIES what the solver reported rather than what a reader
 * could re-derive: `lcb_lcg_offset_mm` is the sweep residual (not the
 * hull-frame `|lcb.x − lcg.x|`, which is a different quantity — see
 * `TrimSolveResult.lcbLcgOffsetMm`) and `pivot_xyz` is the rotation centre
 * the solve used (not the LCG). Each GZ sample carries the stem-tip
 * clearance that was measured for it, so a reader can recompute the end-tip
 * immersion angle instead of asserting "never immerses".
 *
 * Volume is the one unit that changes hands: the solver counts mm³, the
 * format records liters, and fresh water makes them the same measurement
 * (1 L = 1 kg = {@link MM3_PER_KG} mm³). The identity is applied exactly,
 * so a document this app wrote round-trips byte-stable. A FOREIGN document
 * can come back one ulp adrift: for a general double the multiply and the
 * divide each round, and the two compose — the suite pins that as a ≤ 1 ulp
 * bound rather than pretending it is exact.
 */
export interface RunRecordDocument {
  model_hash: string
  targets: {
    weight_kg: number
    lcg_pct_lwl: number
    kg_mm: number
    heel_deg: number
  }
  results: {
    draft_mm: number
    trim_deg: number
    lwl_mm: number
    bwl_mm: number
    volume_liters: number
    lcb_xyz: Xyz
    lcg_xyz: Xyz
    lcb_lcg_offset_mm: number
    pivot_xyz: Xyz
    bow_freeboard_mm: number
    stern_freeboard_mm: number
    waterline_z_mm: number
    gz_curve?: { heel_deg: number; gz_mm: number; min_freeboard_mm?: number }[]
  }
  coefficients: {
    cb: number
    cp: number
    cm: number
    kb_mm: number
    bm_mm: number
    km_mm: number
    gm_mm: number
    cwp: number
    lcf_mm: number
    tpc: number
  }
  /** The source STL's file name; optional in the schema, always emitted here. */
  file_name?: string
  /** Only `full_coefficients` is produced or read — the import refuses the rest. */
  phase: 'full_coefficients'
}

export function exportRunRecord(record: RunRecord): RunRecordDocument {
  const r = record.result
  const lcbXyz: Xyz = [r.lcb.x, r.lcb.y, r.lcb.z]
  const lcgXyz: Xyz = [r.lcg.x, r.lcg.y, r.lcg.z]
  const pivotXyz: Xyz = [r.pivot.x, r.pivot.y, r.pivot.z]
  return {
    model_hash: record.modelHash,
    targets: {
      weight_kg: record.inputs.weightKg,
      lcg_pct_lwl: record.inputs.lcgPctLwl,
      kg_mm: record.inputs.kgMm,
      heel_deg: record.inputs.heelDeg,
    },
    results: {
      draft_mm: r.draftMm,
      trim_deg: r.trimDeg,
      lwl_mm: r.LWL,
      bwl_mm: r.BWL,
      volume_liters: r.displacedVolumeMm3 / MM3_PER_KG,
      lcb_xyz: lcbXyz,
      lcg_xyz: lcgXyz,
      lcb_lcg_offset_mm: r.lcbLcgOffsetMm,
      pivot_xyz: pivotXyz,
      bow_freeboard_mm: r.bowFreeboardMm,
      stern_freeboard_mm: r.sternFreeboardMm,
      waterline_z_mm: r.waterlineZ,
      gz_curve: r.gzCurve.map((point) => ({
        heel_deg: point.heelDeg,
        gz_mm: point.GZ,
        min_freeboard_mm: point.minFreeboardMm,
      })),
    },
    coefficients: {
      cp: r.Cp,
      cm: r.Cm,
      cb: r.Cb,
      kb_mm: r.KB,
      bm_mm: r.BM,
      km_mm: r.KM,
      gm_mm: r.GM,
      cwp: r.Cwp,
      lcf_mm: r.waterplaneCentroidX,
      tpc: r.tpcTonnesPerCm,
    },
    file_name: record.name,
    phase: 'full_coefficients',
  }
}

/** A read that either carries the value or names the path that failed. */
type Read<T> = { ok: true; value: T } | { ok: false; error: string }

/** The document's `targets` keys, in the schema's own order. */
const TARGET_KEYS = ['weight_kg', 'lcg_pct_lwl', 'kg_mm', 'heel_deg'] as const

/** The document's scalar `results` keys, in the schema's own order. */
const RESULT_KEYS = [
  'draft_mm',
  'trim_deg',
  'lwl_mm',
  'bwl_mm',
  'volume_liters',
  'lcb_lcg_offset_mm',
  'bow_freeboard_mm',
  'stern_freeboard_mm',
  'waterline_z_mm',
] as const

/** The document's `coefficients` keys, in the schema's own order. */
const COEFFICIENT_KEYS = [
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
] as const

/**
 * The document's OWN field, or undefined when only the prototype has it.
 * Every read goes through this: a parsed JSON object still inherits
 * Object.prototype, and a page whose prototype carries `targets` (or
 * anything else a required field is named) must not turn "missing" into
 * "found" for a document that never wrote it.
 */
function ownField(parent: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(parent, key) ? parent[key] : undefined
}

function readObject(value: unknown, path: string): Read<Record<string, unknown>> {
  if (value === undefined) return { ok: false, error: `${path} is missing` }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: `${path} must be an object` }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

/**
 * The documented numbers of one object, first failure naming the dotted
 * path. NaN, Infinity and a text number are all "must be a number": a
 * hand-edited file that carried one would poison every row that reads it.
 */
function readNumbers(
  parent: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): Read<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const key of keys) {
    const read = readNumber(parent, key, path)
    if (!read.ok) return read
    out[key] = read.value
  }
  return { ok: true, value: out }
}

/**
 * One named number. `hasOwn`, not a plain read: a JSON object still inherits
 * Object.prototype, and a document that relies on an inherited `constructor`
 * to satisfy a required field must not pass as one that names it.
 */
function readNumber(parent: Record<string, unknown>, key: string, path: string): Read<number> {
  if (!Object.hasOwn(parent, key)) return { ok: false, error: `${path}.${key} is missing` }
  const field = parent[key]
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    return { ok: false, error: `${path}.${key} must be a number` }
  }
  return { ok: true, value: field }
}

/** One `[x, y, z]` array, exactly three finite numbers. */
function readVec3(parent: Record<string, unknown>, key: string, path: string): Read<Vec3> {
  if (!Object.hasOwn(parent, key)) return { ok: false, error: `${path}.${key} is missing` }
  const field = parent[key]
  if (!Array.isArray(field) || field.length !== 3) {
    return { ok: false, error: `${path}.${key} must be an array of three numbers` }
  }
  const parts: number[] = []
  for (const part of field) {
    if (typeof part !== 'number' || !Number.isFinite(part)) {
      return { ok: false, error: `${path}.${key} must be an array of three numbers` }
    }
    parts.push(part)
  }
  return { ok: true, value: { x: parts[0], y: parts[1], z: parts[2] } }
}

/**
 * The optional curve. Absent reads as empty (a trimmed record): the schema
 * marks the field optional, so its absence is not an error — but a present
 * one that is not an array of `{heel_deg, gz_mm}` pairs is. Each sample may
 * also carry its `min_freeboard_mm`, the stem-tip clearance the end-tip
 * immersion angle is recomputed from; it is optional, and a present one
 * must be a number.
 */
function readGzCurve(value: unknown): Read<GZPoint[]> {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'results.gz_curve must be an array of {heel_deg, gz_mm} samples' }
  }
  const points: GZPoint[] = []
  for (let index = 0; index < value.length; index++) {
    const element = value[index]
    if (typeof element !== 'object' || element === null) {
      return {
        ok: false,
        error: `results.gz_curve[${index}] must be an object with heel_deg and gz_mm`,
      }
    }
    const sample = element as Record<string, unknown>
    const heel = ownField(sample, 'heel_deg')
    const arm = ownField(sample, 'gz_mm')
    if (
      typeof heel !== 'number' ||
      !Number.isFinite(heel) ||
      typeof arm !== 'number' ||
      !Number.isFinite(arm)
    ) {
      return {
        ok: false,
        error: `results.gz_curve[${index}] must be an object with heel_deg and gz_mm`,
      }
    }
    const point: GZPoint = { heelDeg: heel, GZ: arm }
    const freeboard = ownField(sample, 'min_freeboard_mm')
    if (freeboard !== undefined) {
      if (typeof freeboard !== 'number' || !Number.isFinite(freeboard)) {
        return {
          ok: false,
          error: `results.gz_curve[${index}].min_freeboard_mm must be a number`,
        }
      }
      point.minFreeboardMm = freeboard
    }
    points.push(point)
  }
  return { ok: true, value: points }
}

/**
 * Numbers that must clear a plausibility bar, not merely be finite. The
 * schema types every result field `number`, so `readNumbers` stops at "is a
 * number"; without this pass a hand-edited document could state a negative
 * displacement, a zero waterline length or a negative draft straight into a
 * Compare row. The bar is per field group, and the failure names the dotted
 * path and the bar together.
 */
const RESULT_KEYS_POSITIVE = ['volume_liters', 'lwl_mm', 'bwl_mm'] as const
const RESULT_KEYS_NON_NEGATIVE = ['draft_mm', 'lcb_lcg_offset_mm'] as const
const COEFFICIENT_KEYS_NON_NEGATIVE = [
  'cb',
  'cp',
  'cm',
  'kb_mm',
  'bm_mm',
  'km_mm',
  'cwp',
  'tpc',
] as const

/**
 * The first field of this group outside its bar, as a `results.x …` message,
 * or null. Runs after `readNumbers` proved every listed field an own finite
 * number, and re-checks ownership rather than trusting that earlier pass.
 * GM is deliberately absent from every list: a negative GM is a real
 * (unstable) answer, not a corrupt input.
 */
function magnitudeProblem(
  parent: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  passes: (value: number) => boolean,
  complaint: string,
): string | null {
  for (const key of keys) {
    if (!Object.hasOwn(parent, key)) return `${path}.${key} is missing`
    const field = parent[key]
    if (typeof field !== 'number' || !Number.isFinite(field)) {
      return `${path}.${key} must be a number`
    }
    if (!passes(field)) return `${path}.${key} ${complaint}`
  }
  return null
}

/**
 * Read a run-record document back into a record — the import half of the
 * export, and the only door a foreign file enters the roster through.
 *
 * The document is untrusted input: another machine's app version, another
 * tool, or a text editor may have written it. So the read fails LOUD on
 * anything the schema requires and the document lacks or mistypes, naming
 * the dotted path so the caller can show which field is wrong; and a target
 * the form's own range gate rejects is refused by `recordFromSolve`, whose
 * throw becomes the `{ok:false}` message — the import door must not open
 * where the creation door is shut. Unknown fields are tolerated: a newer
 * producer's `waterline_polygon` or `solver_time_ms` must not make its file
 * unreadable here.
 *
 * An imported record carries what the format states and nothing more. The
 * solve's diagnostics — planes evaluated, wetted surface, waterplane second
 * moment, loop count — are NOT part of the format and come back neutral; no
 * Compare consumer may read them off an imported record (the table's rows
 * all sit inside `RESULT_NUMBERS`).
 *
 * What the format states is CARRIED, never re-derived, because a reader's
 * arithmetic would change the number: `lcb_lcg_offset_mm` is the sweep
 * residual, not the hull-frame `|lcb.x - lcg.x|` (see
 * `TrimSolveResult.lcbLcgOffsetMm`); `pivot_xyz` is the rotation centre the
 * solve actually used, whose z is the bounding-box centre's, not the LCG's
 * KG height; and each GZ sample's `min_freeboard_mm` is the stem-tip
 * clearance the end-tip immersion angle is recomputed from — that one
 * diagnostic IS derived here, because the angle is a pure function of
 * freeboards the format already carries and the alternative is asserting
 * "never immerses" for every imported record.
 *
 * Two gates sit between a document and a record. The phase must be
 * `full_coefficients`: the schema's earlier phases carry no coefficients
 * block and the comparison table renders them, so an earlier run is a
 * different document, not a degraded one. And every magnitude the schema
 * merely types as a number must clear the bar its physical sense demands —
 * positive displacement and waterplane dimensions, non-negative draft,
 * offset and coefficients, and a derived mm³ volume that stays finite
 * (1e308 L is a valid double and an Infinity mm³, which passes every read
 * here and is then dropped by `readRoster` at the next reload).
 */
export function parseRunRecordImport(
  text: string,
): { ok: true; record: RunRecord } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the file is not valid JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'the record is not a JSON object' }
  }
  const doc = raw as Record<string, unknown>

  const phase = ownField(doc, 'phase')
  if (phase === undefined) return { ok: false, error: 'phase is missing' }
  if (phase !== 'full_coefficients') {
    return { ok: false, error: `phase must be 'full_coefficients', not '${String(phase)}'` }
  }

  const modelHash = ownField(doc, 'model_hash')
  if (typeof modelHash !== 'string' || !SHA256_HEX_PATTERN.test(modelHash)) {
    return {
      ok: false,
      error: 'model_hash must be 64 lowercase hex characters (a SHA-256 of the STL bytes)',
    }
  }
  const fileNameField = ownField(doc, 'file_name')
  if (fileNameField !== undefined && typeof fileNameField !== 'string') {
    return { ok: false, error: 'file_name must be a string' }
  }
  const fileName =
    typeof fileNameField === 'string' && fileNameField.length > 0 ? fileNameField : 'Imported run'

  const targets = readObject(ownField(doc, 'targets'), 'targets')
  if (!targets.ok) return { ok: false, error: targets.error }
  const targetFields = readNumbers(targets.value, TARGET_KEYS, 'targets')
  if (!targetFields.ok) return { ok: false, error: targetFields.error }

  const results = readObject(ownField(doc, 'results'), 'results')
  if (!results.ok) return { ok: false, error: results.error }
  const resultFields = readNumbers(results.value, RESULT_KEYS, 'results')
  if (!resultFields.ok) return { ok: false, error: resultFields.error }
  const lcb = readVec3(results.value, 'lcb_xyz', 'results')
  if (!lcb.ok) return { ok: false, error: lcb.error }
  const lcg = readVec3(results.value, 'lcg_xyz', 'results')
  if (!lcg.ok) return { ok: false, error: lcg.error }
  const pivot = readVec3(results.value, 'pivot_xyz', 'results')
  if (!pivot.ok) return { ok: false, error: pivot.error }

  const coefficients = readObject(ownField(doc, 'coefficients'), 'coefficients')
  if (!coefficients.ok) return { ok: false, error: coefficients.error }
  const coefficientFields = readNumbers(coefficients.value, COEFFICIENT_KEYS, 'coefficients')
  if (!coefficientFields.ok) return { ok: false, error: coefficientFields.error }

  // Magnitudes. The schema types these `number`, so `readNumbers` stops at
  // "is a number"; a negative displacement or a zero waterline length would
  // sail through that and render as a plausible Compare row.
  const positiveResults = magnitudeProblem(
    results.value,
    RESULT_KEYS_POSITIVE,
    'results',
    (value) => value > 0,
    'must be greater than zero',
  )
  if (positiveResults) return { ok: false, error: positiveResults }
  const nonNegativeResults = magnitudeProblem(
    results.value,
    RESULT_KEYS_NON_NEGATIVE,
    'results',
    (value) => value >= 0,
    'must not be negative',
  )
  if (nonNegativeResults) return { ok: false, error: nonNegativeResults }
  const nonNegativeCoefficients = magnitudeProblem(
    coefficients.value,
    COEFFICIENT_KEYS_NON_NEGATIVE,
    'coefficients',
    (value) => value >= 0,
    'must not be negative',
  )
  if (nonNegativeCoefficients) return { ok: false, error: nonNegativeCoefficients }

  // ownField, not a plain read: an inherited `gz_curve` would satisfy an
  // optional field the document never wrote.
  const curve = readGzCurve(ownField(results.value, 'gz_curve'))
  if (!curve.ok) return { ok: false, error: curve.error }

  const inputs: SlotInputs = {
    weightKg: targetFields.value.weight_kg,
    lcgPctLwl: targetFields.value.lcg_pct_lwl,
    kgMm: targetFields.value.kg_mm,
    heelDeg: targetFields.value.heel_deg,
  }
  const r = resultFields.value
  const c = coefficientFields.value
  // The derived displacement must itself be finite. `volume_liters` is read
  // as a finite double, but 1e308 of it overflows on the x1_000_000 — and
  // Infinity passes every read here, is written by `encodeRoster`, and is
  // then dropped by `readRoster` at the next reload: an accepted record
  // that silently vanishes from the roster it was just added to.
  const displacedVolumeMm3 = r.volume_liters * MM3_PER_KG
  if (!Number.isFinite(displacedVolumeMm3)) {
    return { ok: false, error: 'results.volume_liters is too large to convert to mm3' }
  }
  const result: TrimSolveResult = {
    trimDeg: r.trim_deg,
    draftMm: r.draft_mm,
    waterlineZ: r.waterline_z_mm,
    displacedVolumeMm3,
    displacementKg: r.volume_liters,
    targetKg: inputs.weightKg,
    lcb: lcb.value,
    lcg: lcg.value,
    pivot: pivot.value,
    lcbLcgOffsetMm: r.lcb_lcg_offset_mm,
    waterplaneAreaMm2: 0,
    planesEvaluated: 0,
    converged: true,
    Cb: c.cb,
    LWL: r.lwl_mm,
    BWL: r.bwl_mm,
    midshipAreaMm2: 0,
    Cp: c.cp,
    Cm: c.cm,
    KB: c.kb_mm,
    BM: c.bm_mm,
    KM: c.km_mm,
    GM: c.gm_mm,
    gzCurve: curve.value,
    bowFreeboardMm: r.bow_freeboard_mm,
    sternFreeboardMm: r.stern_freeboard_mm,
    heelDeg: inputs.heelDeg,
    kgMm: inputs.kgMm,
    waterplaneLoopCount: 0,
    Cwp: c.cwp,
    wettedSurfaceAreaMm2: 0,
    waterplaneCentroidX: c.lcf_mm,
    waterplaneIyyMm4: 0,
    tpcTonnesPerCm: c.tpc,
    endTipImmersionDeg: endTipImmersionHeelDeg(curve.value),
  }
  try {
    return { ok: true, record: recordFromSolve(fileName, modelHash, inputs, result) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

// --- validation --------------------------------------------------------------

function isVec3(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.x === 'number' &&
    Number.isFinite(v.x) &&
    typeof v.y === 'number' &&
    Number.isFinite(v.y) &&
    typeof v.z === 'number' &&
    Number.isFinite(v.z)
  )
}

/** The slot's conditions, judged by the same predicates as the form. */
function isSlotInputs(value: unknown): value is SlotInputs {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.weightKg === 'number' &&
    Number.isFinite(v.weightKg) &&
    weightUsable(v.weightKg) &&
    typeof v.lcgPctLwl === 'number' &&
    Number.isFinite(v.lcgPctLwl) &&
    lcgUsable(v.lcgPctLwl) &&
    typeof v.kgMm === 'number' &&
    Number.isFinite(v.kgMm) &&
    kgUsable(v.kgMm) &&
    typeof v.heelDeg === 'number' &&
    Number.isFinite(v.heelDeg) &&
    heelUsable(v.heelDeg)
  )
}

/**
 * The result fields a stored record must carry: every number the comparison
 * table and the delta column render, plus the two the run-record export
 * round-trips back in (`waterlineZ`, `displacedVolumeMm3`) and the two that
 * make a restored GM reproducible (`heelDeg`, `kgMm`). A result missing any
 * of them cannot render completely — the spec's "no blank rows" — so the
 * entry is filtered rather than restored half-alive.
 *
 * Fields outside this list (`planesEvaluated`, `pivot`, `wettedSurfaceAreaMm2`
 * and the rest of the solve's diagnostics) are carried when a live solve
 * produced the record and absent on an imported one; neither path renders
 * them, so their absence is not a defect.
 */
const RESULT_NUMBERS: readonly (keyof TrimSolveResult)[] = [
  'trimDeg',
  'draftMm',
  'waterlineZ',
  'displacedVolumeMm3',
  'LWL',
  'BWL',
  'Cb',
  'Cp',
  'Cm',
  'Cwp',
  'KB',
  'BM',
  'KM',
  'GM',
  'bowFreeboardMm',
  'sternFreeboardMm',
  'waterplaneCentroidX',
  'tpcTonnesPerCm',
  'heelDeg',
  'kgMm',
]

const RESULT_VECTORS: readonly (keyof TrimSolveResult)[] = ['lcb', 'lcg']

/** One plotted curve sample: an angle and a GZ, both finite. */
function isGzPoint(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.heelDeg === 'number' &&
    Number.isFinite(p.heelDeg) &&
    typeof p.GZ === 'number' &&
    Number.isFinite(p.GZ)
  )
}

function isSolveResultLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.gzCurve)) return false
  // Element shape, not just array-ness: a null or text element would
  // otherwise survive here and raise a TypeError in gzMarks/GzChart later.
  for (const point of v.gzCurve) {
    if (!isGzPoint(point)) return false
  }
  for (const key of RESULT_NUMBERS) {
    const field = v[key]
    if (typeof field !== 'number' || !Number.isFinite(field)) return false
  }
  for (const key of RESULT_VECTORS) {
    if (!isVec3(v[key])) return false
  }
  return true
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.name === 'string' &&
    typeof r.modelHash === 'string' &&
    r.modelHash.length > 0 &&
    typeof r.savedAt === 'number' &&
    r.savedAt > 0 &&
    isSlotInputs(r.inputs) &&
    isSolveResultLike(r.result)
  )
}
