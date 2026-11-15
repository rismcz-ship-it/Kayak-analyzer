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
 * Layering: the imports are the `TrimSolveResult` type (erased at compile
 * time) and four value predicates from `inputs.ts`. Framework-free, so the
 * suite runs in Node with no browser shims.
 */
import type { TrimSolveResult } from './hydrostatics'
import { heelUsable, kgUsable, lcgUsable, type StorageReader, weightUsable } from './inputs'

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
   * storage, or imported from a run record in Task 3, is guaranteed only the
   * subset `readRoster` validates — `RESULT_NUMBERS` plus the two vectors and
   * `gzCurve`. The solve's diagnostics (`planesEvaluated`, `pivot`,
   * `wettedSurfaceAreaMm2` and the rest) may be absent there, so no Compare
   * consumer may read them off a stored record; the comparison table's rows
   * all sit inside the guaranteed subset.
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
