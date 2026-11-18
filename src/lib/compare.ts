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
 * water), one solver function (`endTipImmersionHeelDeg` - the only diagnostic
 * an import recomputes), the pattern `sha256Hex`'s own output is checked
 * against, and four value predicates plus the two storage function types from
 * `inputs.ts`. Framework-free, so the suite runs in Node with no browser
 * shims.
 */

import { fmt } from './format'
import type { Vec3 } from './geometry'
import type { GzMarks } from './gz-marks'
import {
  endTipImmersionHeelDeg,
  type GZPoint,
  MM3_PER_KG,
  type TrimSolveResult,
} from './hydrostatics'
import {
  heelUsable,
  kgUsable,
  lcgUsable,
  type StorageReader,
  type StorageWriter,
  weightUsable,
} from './inputs'
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

/** The three numeric conditions a slot's form holds; the heel rule is separate. */
export interface SlotNumericInputs {
  weightKg: number
  lcgPctLwl: number
  kgMm: number
}

/**
 * The conditions a slot actually SOLVES at: the numeric fields as typed, plus
 * the APPLIED heel.
 *
 * The heel slider and its toggle are two different things, and the home tab
 * (`App.tsx`) has always applied the rule `showHeelInput ? inputs.heelDeg : 0`
 * - the slider's value is a LEFTOVER while the toggle is off, and an applied
 * angle only while it is on. The rule lives here so the slot panel cannot
 * express the wrong one: a numeric edit used to emit the slider's raw value,
 * so editing the weight with the toggle off silently re-applied an angle the
 * panel said was not applied, and the slot then solved heeled while the UI
 * claimed upright.
 */
export function slotConditions(
  numeric: SlotNumericInputs,
  showHeel: boolean,
  heelDeg: number,
): SlotInputs {
  return { ...numeric, heelDeg: showHeel ? heelDeg : 0 }
}

/**
 * True when two condition sets are the SAME solve.
 *
 * A live result answers to the conditions it was solved at, and the panel's
 * "Live - solved at the conditions above" claim and the table's "(re-solving)"
 * marker are both derived from this pair: the result's own conditions against
 * the ones now on screen. Comparing the fields being typed into instead would
 * let a stale answer describe itself as current.
 */
export function sameSlotInputs(a: SlotInputs, b: SlotInputs): boolean {
  return (
    a.weightKg === b.weightKg &&
    a.lcgPctLwl === b.lcgPctLwl &&
    a.kgMm === b.kgMm &&
    a.heelDeg === b.heelDeg
  )
}

/**
 * Is the live answer an answer to THESE conditions?
 *
 * A live result belongs to the conditions it was solved at, so a claim like
 * "Live — solved at the conditions above" may only be made while the two
 * agree: after an edit the panel re-renders once with the new conditions and
 * the old answer, and the claim would be a lie for that frame.
 *
 * `liveInputs` is null exactly when there is no live answer, so it carries
 * both facts and the panel cannot get the pairing wrong.
 */
export function liveAnswerIsCurrent(liveInputs: SlotInputs | null, shown: SlotInputs): boolean {
  return liveInputs !== null && sameSlotInputs(liveInputs, shown)
}

/**
 * Is this column's displayed answer out of date with its own conditions?
 *
 * Two ways to be out of date, and the table says so in both: a re-solve is in
 * flight, or the conditions have moved on and the new solve has not answered
 * yet (the ~300 ms debounce, and the frame before the solver even starts).
 * The test is the LIVE answer's own conditions against the slot's current
 * ones — never the numbers being typed into, which are the slot's `inputs`.
 */
export function columnIsStale(
  liveInputs: SlotInputs | null,
  solving: boolean,
  inputs: SlotInputs,
): boolean {
  if (liveInputs === null) return false
  if (solving) return true
  return !sameSlotInputs(liveInputs, inputs)
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
   * The solved metrics the comparison renders. A record carries the solver's
   * WHOLE result: `readRoster` validates the full field set (every number,
   * `converged`, the three vectors, `endTipImmersionDeg` and the curve, in
   * ascending heel order), so an entry missing a field a real solve emits is
   * filtered rather than restored half-alive. An IMPORTED record fills the
   * five fields the run-record format does not name (waterplane area, midship
   * area, wetted surface, second moment, loop count) with neutral zeros; no
   * Compare consumer may read them off one, and every row the table renders
   * sits inside the set the format carries. `converged` and `planesEvaluated`
   * ARE carried - they are named by the schema - so an imported record has
   * the truth about the run it came from.
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
 * True when every number in a plain-data snapshot (nested vectors and curve
 * arrays included) is finite. `NaN`/`Infinity` are the only values JSON
 * cannot represent losslessly, so they are the only ones worth walking for.
 */
function numbersAllFinite(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(numbersAllFinite)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every(numbersAllFinite)
  }
  return true
}

/**
 * Build a record from a fresh solve - the snapshot of what the solve
 * reported at these conditions, and nothing else may ever change it.
 *
 * Three guards run before the record exists. The inputs go through the same
 * range gate the form and `readRoster` use, so a value the form rejects
 * throws here instead of building a record that storage will drop on the
 * next reload; the model hash must be a real one, because a record with no
 * hash can never be re-picked against its STL; and the result must be all
 * finite, because JSON turns a NaN into null and `readRoster` would then
 * drop the whole record on the next reload without telling anyone - a record
 * that vanishes later is worse than one refused now. All three throws name
 * the field, so the caller (the auto-add path) can surface the cause.
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
  if (typeof modelHash !== 'string' || !SHA256_HEX_PATTERN.test(modelHash)) {
    throw new Error(
      'recordFromSolve: modelHash must be 64 lowercase hex characters (a SHA-256 of the raw STL bytes)',
    )
  }
  // A record outlives the session as JSON, and JSON collapses NaN/Infinity to
  // null — which `readRoster` then refuses, dropping the whole entry on the
  // next reload WITHOUT telling anyone. Refuse it here instead, where the
  // message names the reason, rather than letting a visible record silently
  // vanish later.
  if (!numbersAllFinite(result)) {
    throw new Error(
      'recordFromSolve: the solve result carries a non-finite number and cannot be recorded',
    )
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

/**
 * Persist the roster. The mirror of `readRoster`, injected for the same
 * reason: a module that reached for the storage global itself could not be
 * driven from a suite, and a browser page whose storage throws on ACCESS
 * (private mode, quota) would throw inside this module instead of inside its
 * caller's catch. The writer is one `setItem`; a throwing one propagates to
 * the caller, exactly as a throwing reader is handled inside `readRoster`.
 */
export function writeRoster(records: RunRecord[], write: StorageWriter): void {
  write(COMPARE_STORAGE_KEY, encodeRoster(records))
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

// --- the display seams -------------------------------------------------------

/**
 * The angle-of-vanishing-stability cell: what the comparison table says about
 * a curve, in words that do not claim more than the curve carries.
 *
 * Three states, and the old cell conflated two of them:
 *
 *   1. **No samples at all** — an imported record whose document omitted the
 *      optional `gz_curve`. There is no curve to read, so the cell is an em
 *      dash. "not within 0°" (what the old cell said) is a STABILITY claim
 *      about a sweep that never ran.
 *   2. **Sampled, but never a positive arm** — the curve was measured and the
 *      hull never righted itself. That is its own sentence, and it is not the
 *      same as "we never looked".
 *   3. **Sampled and still positive at its last sample** — the sweep went as
 *      far as the curve does and the arm never came back to zero, so the cell
 *      says HOW FAR it went.
 */
export function avsCellText(marks: GzMarks): string {
  if (marks.sampleCount === 0) return '—'
  if (marks.avsDeg !== null) return `${fmt(marks.avsDeg)}°`
  if (marks.gzMax === null) return 'no positive arm'
  return `not within ${fmt(marks.maxHeelDeg)}°`
}

/**
 * What one slot contributes to the overlay.
 *
 * The overlay draws a hull only when the slot holds BOTH an STL and a result
 * to pose it with, so the caption is built from the same facts the picture is.
 * A slot holding a record but no STL in memory shows its NUMBERS in the table
 * and nothing at all in the 3D view — calling that a solved hull would put
 * "both hulls sit on one shared waterline" over an empty canvas.
 *
 * A DRAWN hull is not necessarily a SOLVED one, and the state that separates
 * them is the one thing this type exists to keep straight: a slot can draw an
 * STL posed with a record's result — the record's snapshot stayed on screen
 * over a re-picked, different file, because the new hull's own solve had not
 * landed yet. The picture is real (the STL really is there), but "the deeper
 * hull floats lower" is a claim about the numbers, and those numbers describe
 * a DIFFERENT hull. Counting that pair as two solved hulls put the shared
 * waterline caption over a comparison of one hull with another hull's answer.
 */
export type CompareOverlaySlot =
  /** Nothing in the slot: no STL, no numbers. */
  | 'empty'
  /** An STL is in memory but no solve has landed yet: nothing is drawn. */
  | 'loaded'
  /** An STL and ITS OWN solve: the hull is drawn on the shared surface. */
  | 'shown'
  /**
   * A record's numbers with no STL in memory: nothing is drawn.
   */
  | 'record-only'
  /**
   * An STL is drawn, but the pose on it is a RECORD's — the result was solved
   * from a different hull. Drawn, but not solved: this state carries a number
   * that describes geometry other than the one on screen.
   */
  | 'foreign-pose'

export interface CompareOverlayState {
  a: CompareOverlaySlot
  b: CompareOverlaySlot
}

/**
 * The caption under the overlay — one sentence about what is actually on
 * screen.
 *
 * The caption used to claim "Both hulls sit on one shared waterline" over an
 * overlay that could hold one hull or none, and a hull that was loaded but not
 * solved yet simply did not appear, with nothing on screen saying why. The
 * states are the facts the overlay itself is built from, so the sentence cannot
 * drift from the picture.
 *
 * The shared-waterline line belongs to two SOLVED hulls and to nothing else.
 * A `foreign-pose` slot is drawn, so the caption names it as drawn — but its
 * numbers are a different hull's, so it is not counted as solved and the
 * order the line predicts ("the deeper hull floats lower") is not claimed.
 */
export function compareOverlayCaption(state: CompareOverlayState): string {
  const slots: Array<{ label: 'A' | 'B'; view: CompareOverlaySlot }> = [
    { label: 'A', view: state.a },
    { label: 'B', view: state.b },
  ]
  const shown = slots.filter((slot) => slot.view === 'shown')
  if (shown.length === 2) {
    return 'Both hulls sit on one shared waterline — the deeper hull floats lower.'
  }
  const sentences: string[] = []
  if (shown.length === 1) sentences.push('One hull is solved.')
  for (const slot of slots) {
    if (slot.view === 'shown') continue
    if (slot.view === 'empty') {
      // Worth saying only when there is something else to compare with.
      if (slots.some((other) => other.view !== 'empty')) {
        sentences.push(`Load an STL into Slot ${slot.label} to compare it.`)
      }
      continue
    }
    if (slot.view === 'foreign-pose') {
      // Drawn, but posed with a record's numbers: those describe the record's
      // hull, not the file on screen. Say both halves - the panel's own note
      // says the same thing about the same slot, and they must agree.
      sentences.push(
        `Slot ${slot.label}'s STL is drawn, but the pose shown is its record's — solved from a different hull.`,
      )
      continue
    }
    sentences.push(
      slot.view === 'loaded'
        ? `Slot ${slot.label}'s STL is loaded but not drawn yet.`
        : `Slot ${slot.label}'s numbers are shown, but its STL is not loaded.`,
    )
  }
  if (sentences.length === 0) return 'Load an STL into a slot to compare hulls.'
  return sentences.join(' ')
}

// --- the roster's de-dup -----------------------------------------------------

/**
 * One number as text, rounded to TWELVE significant digits.
 *
 * The export/import round trip moves the last bit of the displacement: the
 * document carries liters, the solver counts mm³, and the two conversions
 * compose into a ≤1 ulp difference (~1e-16 relative). Twelve digits absorb
 * that with a wide margin, while still telling apart runs whose numbers differ
 * beyond the precision the physics has.
 *
 * The fingerprint is the DOCUMENT's content: the fields the run-record format
 * does not carry (the wetted area, the waterplane diagnostics) are not part of
 * it. They are derived from the same mesh and the same conditions, so two runs
 * that agree on everything the document carries are the same run.
 */
function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  return value.toPrecision(12)
}

/**
 * A stable text form of a JSON value: object keys sorted, numbers at twelve
 * significant digits, `undefined` members dropped. Two documents with the same
 * content therefore produce the same text whatever order their keys were
 * written in.
 */
function canonicalJson(value: unknown): string {
  if (typeof value === 'number') return canonicalNumber(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * A run's CONTENT identity: what it measured, at what conditions, from which
 * mesh.
 *
 * A record's `id` is minted per CREATION, so the same run arriving twice gets
 * two ids — importing the same `.run.json` twice, or solving the same hull at
 * the same conditions twice, would otherwise fill the roster with copies of
 * one run. The fingerprint is built from the exported document, so it is the
 * run that is identified, not the record object that carries it.
 */
export function recordFingerprint(record: RunRecord): string {
  return canonicalJson(exportRunRecord(record))
}

/**
 * Add a record to the roster, without duplicating a run that is already there.
 *
 * A run whose fingerprint is already stored is NOT added again: the entry
 * already in the roster keeps its identity (its id, and therefore whatever a
 * slot picked by that id), and the newcomer is dropped. A record carrying an
 * id the roster already holds replaces that entry in place — same creation,
 * refreshed content — and anything else goes to the front, newest first.
 *
 * The id branch is NOT dead code, though nothing in-app can reach it: ids are
 * minted per creation (`rec_${nextRecordId++}_${savedAt36}`), so two records
 * created by the app never share one. Only a hand-edited or externally seeded
 * roster can hold a duplicate, and `readRoster` does not check id uniqueness -
 * so this branch is the defensive answer to that, not an oversight. Dropping
 * it would turn a duplicate id into two entries a slot cannot tell apart.
 */
export function addRosterRecord(roster: RunRecord[], record: RunRecord): RunRecord[] {
  const fingerprint = recordFingerprint(record)
  if (roster.some((entry) => recordFingerprint(entry) === fingerprint)) return [...roster]
  const sameId = roster.findIndex((entry) => entry.id === record.id)
  if (sameId >= 0) {
    const next = [...roster]
    next[sameId] = record
    return next
  }
  return [record, ...roster]
}

/**
 * The roster entry that REPRESENTS a run: the stored one when the run is
 * already there, the record itself otherwise.
 *
 * An import that lands on a run the roster already holds must not mint a
 * second copy of it — the slot then shows the stored entry, so the roster
 * list, the slot's pick and the exported document all name one run.
 */
export function canonicalRecord(roster: RunRecord[], record: RunRecord): RunRecord {
  const fingerprint = recordFingerprint(record)
  return roster.find((entry) => recordFingerprint(entry) === fingerprint) ?? record
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
  /** The only shape this app writes. The import refuses any other version. */
  format_version: number
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
    /**
     * How many waterplane heights the trim sweep evaluated, an integer.
     * Carried rather than re-derived: a reader cannot know how much work a
     * foreign solve did, and the number says whether the answer was hard won.
     */
    planes_evaluated: number
    /**
     * Whether the trim sweep reached equilibrium before exhausting the sweep.
     * Carried rather than assumed: a non-converged answer is a best estimate,
     * and a reader that assumed true would present it as a solved one.
     */
    converged: boolean
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
    format_version: 1,
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
      planes_evaluated: r.planesEvaluated,
      converged: r.converged,
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
  'planes_evaluated',
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

/**
 * One named boolean, own-field checked like {@link readNumber}. The format
 * carries `converged` as a real boolean: a text "true", a 1 or an empty string
 * is a document some other producer wrote, and reading it as truthy would let
 * a non-converged run claim it solved.
 */
function readBoolean(parent: Record<string, unknown>, key: string, path: string): Read<boolean> {
  if (!Object.hasOwn(parent, key)) return { ok: false, error: `${path}.${key} is missing` }
  const field = parent[key]
  if (typeof field !== 'boolean') {
    return { ok: false, error: `${path}.${key} must be a boolean` }
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
 * marks the field optional, so its absence is not an error - but a present
 * one that is not an array of `{heel_deg, gz_mm}` pairs is. Each sample may
 * also carry its `min_freeboard_mm`, the stem-tip clearance the end-tip
 * immersion angle is recomputed from; it is optional, and a present one
 * must be a number.
 *
 * The samples must arrive in ASCENDING heel order. Every reader of the curve
 * (the peak scan in `gzMarks`, the angle-of-vanishing-stability interpolation
 * between neighbouring samples, the chart's polyline) walks it in order, so a
 * shuffled curve is not a tidy-up away from being usable - it is a different
 * curve whose marks and interpolations would all be wrong.
 */
function readGzCurve(value: unknown): Read<GZPoint[]> {
  if (value === undefined) return { ok: true, value: [] }
  if (!Array.isArray(value)) {
    return { ok: false, error: 'results.gz_curve must be an array of {heel_deg, gz_mm} samples' }
  }
  const points: GZPoint[] = []
  let previousHeel = Number.NEGATIVE_INFINITY
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
    if (!(heel > previousHeel)) {
      return {
        ok: false,
        error: `results.gz_curve[${index}].heel_deg must be greater than the previous sample`,
      }
    }
    previousHeel = heel
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
const RESULT_KEYS_NON_NEGATIVE = ['draft_mm', 'lcb_lcg_offset_mm', 'planes_evaluated'] as const
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
 * schema names `converged` and `planes_evaluated`, so those two come back as
 * the DOCUMENT stated them - never as what a completed solve would emit. The
 * remaining diagnostics the format does not name (waterplane area, midship
 * area, wetted surface, waterplane second moment, loop count) come back
 * neutral; no Compare consumer may read them off an imported record, and
 * every row the table renders sits inside the set the format carries.
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

  // The document's shape version, the second "which document is this" gate.
  // This app writes 1 and reads 1: a future format change (a new field, a
  // changed datum) must be refused loudly rather than read by a reader that
  // assumes today's meaning of every key. `ownField` like every other read -
  // an inherited `format_version` must not pass for a written one.
  const formatVersion = ownField(doc, 'format_version')
  if (formatVersion === undefined) return { ok: false, error: 'format_version is missing' }
  if (formatVersion !== 1) {
    return { ok: false, error: `format_version must be 1, not '${String(formatVersion)}'` }
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
  const converged = readBoolean(results.value, 'converged', 'results')
  if (!converged.ok) return { ok: false, error: converged.error }
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
    // Carried, not fabricated: the format names both, so an imported record
    // reports whether its run converged and how much work it did.
    planesEvaluated: r.planes_evaluated,
    converged: converged.value,
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
 * The WHOLE number set of a `TrimSolveResult` - the full {@link isSolveResultLike}
 * contract, not a projection of it. A validator that checked a subset let a
 * half-written, hand-edited or future-versioned entry through as "valid",
 * and every Compare consumer that reached for a field outside the subset
 * then read undefined off a restored record. Checking the full set makes
 * "restored" mean restored, and it costs nothing: the importer and the live
 * solve both produce the complete result anyway.
 *
 * `converged` is validated beside it as a boolean, `endTipImmersionDeg` as a
 * number-or-null, the three vectors as Vec3, and the curve in ascending heel
 * order. The five diagnostics the run-record format does not carry
 * (`waterplaneAreaMm2`, `midshipAreaMm2`, `wettedSurfaceAreaMm2`,
 * `waterplaneIyyMm4`, `waterplaneLoopCount`) are still validated here: an
 * imported record fills them with the neutral 0, and an anything-but-0 entry
 * is a live record that renders them truthfully.
 */
const RESULT_NUMBERS: readonly (keyof TrimSolveResult)[] = [
  'trimDeg',
  'draftMm',
  'waterlineZ',
  'displacedVolumeMm3',
  'displacementKg',
  'targetKg',
  'lcbLcgOffsetMm',
  'waterplaneAreaMm2',
  'planesEvaluated',
  'Cb',
  'LWL',
  'BWL',
  'midshipAreaMm2',
  'Cp',
  'Cm',
  'KB',
  'BM',
  'KM',
  'GM',
  'bowFreeboardMm',
  'sternFreeboardMm',
  'heelDeg',
  'kgMm',
  'waterplaneLoopCount',
  'Cwp',
  'wettedSurfaceAreaMm2',
  'waterplaneCentroidX',
  'waterplaneIyyMm4',
  'tpcTonnesPerCm',
]

const RESULT_VECTORS: readonly (keyof TrimSolveResult)[] = ['lcb', 'lcg', 'pivot']

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
  // Element shape AND order, not just array-ness: a null or text element
  // would otherwise survive here and raise a TypeError in gzMarks/GzChart
  // later, and a curve sampled out of heel order would break the peak scan
  // and the angle-of-vanishing-stability interpolation (`gz-marks.ts`
  // documents the ordering contract the solver and the import both keep).
  let previousHeel = Number.NEGATIVE_INFINITY
  for (const point of v.gzCurve) {
    if (!isGzPoint(point)) return false
    const sample = point as GZPoint
    if (!(sample.heelDeg > previousHeel)) return false
    previousHeel = sample.heelDeg
  }
  for (const key of RESULT_NUMBERS) {
    const field = v[key]
    if (typeof field !== 'number' || !Number.isFinite(field)) return false
  }
  for (const key of RESULT_VECTORS) {
    if (!isVec3(v[key])) return false
  }
  // A real boolean, not truthiness: 'false' and 0 are both docs that mean no.
  if (typeof v.converged !== 'boolean') return false
  // The one nullable number in the result: a hull whose ends never immerse
  // carries null, and anything else must be a finite angle.
  const endTip = v.endTipImmersionDeg
  if (endTip !== null && (typeof endTip !== 'number' || !Number.isFinite(endTip))) return false
  return true
}

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.name === 'string' &&
    // The same gate as the import and the creation: a hash is 64 lowercase hex
    // characters, or it is not a hash the re-pick could ever match.
    typeof r.modelHash === 'string' &&
    SHA256_HEX_PATTERN.test(r.modelHash) &&
    typeof r.savedAt === 'number' &&
    r.savedAt > 0 &&
    isSlotInputs(r.inputs) &&
    isSolveResultLike(r.result)
  )
}
