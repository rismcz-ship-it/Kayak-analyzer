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
  result: TrimSolveResult
  savedAt: number
}

/** Versioned so a future schema change can tell its own entries apart. */
export const COMPARE_STORAGE_KEY = 'kayak-analyzer.compare.v1'

let nextRecordId = 1

/**
 * Build a record from a fresh solve. The result is stored as given — the
 * snapshot of what the solve reported at these conditions — and the id mixes
 * a counter with the timestamp so two saves in the same millisecond (two
 * slots, or a fast double analysis) still differ.
 */
export function recordFromSolve(
  name: string,
  modelHash: string,
  inputs: SlotInputs,
  result: TrimSolveResult,
): RunRecord {
  return {
    id: `rec_${nextRecordId++}_${Date.now().toString(36)}`,
    name,
    modelHash,
    inputs,
    result,
    savedAt: Date.now(),
  }
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

function isSolveResultLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.gzCurve)) return false
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
    Number.isFinite(r.savedAt) &&
    isSlotInputs(r.inputs) &&
    isSolveResultLike(r.result)
  )
}
