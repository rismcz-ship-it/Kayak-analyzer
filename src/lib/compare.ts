/**
 * The Compare roster: the records one hull analysis leaves behind for
 * side-by-side comparison, and the only Compare state that outlives a reload.
 *
 * Two rules hold this module together, both from the design spec:
 *
 *  1. **Records are immutable snapshots.** Adding and deleting are the only
 *     roster operations. A slot's live re-solve never rewrites the record it
 *     was picked from — a second slot may be showing it — and a record
 *     captures what its solve reported, never a later edit. So nothing here
 *     mutates a record after `recordFromSolve` builds it.
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
 * at compile time), the pattern `sha256Hex`'s own output is checked against,
 * and four value predicates plus the two storage function types from
 * `inputs.ts`. Framework-free, so the suite runs in Node with no browser
 * shims.
 */

import { fmt, signed } from './format'
import type { GzMarks } from './gz-marks'
import type { GZPoint, TrimSolveResult } from './hydrostatics'
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

/**
 * Is the geometry in a slot posed with a result solved on a DIFFERENT hull?
 *
 * The overlay's slot state and the panel's warning both ask this, and they must
 * answer alike: it decides whether the numbers on screen describe the hull
 * being drawn. A slot showing a record with no live answer is displaying that
 * record's snapshot, and the hash is the only thing that can tie a mesh to the
 * hull the record was solved on.
 *
 * An EMPTY mesh hash is the case that looks like a match and is not one: it
 * means the page could not hash the file at all (no `crypto.subtle` — a
 * plain-HTTP origin), so the file is not known to be the record's hull either.
 * Letting it pass as a match is what put "Both hulls sit on one shared
 * waterline" over an unverified file, so it counts as foreign: drawn, but not
 * solved. It can only ever be the mesh's hash that is empty — `recordFromSolve`
 * gates `modelHash` on the SHA-256 pattern, so a stored record always carries
 * a real one and "two empty hashes" never arises. A live
 * answer always belongs to the mesh in memory, so a slot with one is never
 * foreign.
 */
export function poseIsForeign(
  meshSha256Hex: string | null,
  recordModelHash: string | null,
  hasLiveAnswer: boolean,
): boolean {
  return (
    meshSha256Hex !== null &&
    !hasLiveAnswer &&
    recordModelHash !== null &&
    meshSha256Hex !== recordModelHash
  )
}

/**
 * The name a column or a slot panel shows for a slot.
 *
 * A live answer describes the MESH in the slot, so that file names it even
 * when a record is still picked: the re-pick path's "Use anyway" keeps
 * `recordId` set, and preferring the record's name put "test-kayak.stl" over a
 * different hull's numbers. Export already reads the mesh first for the same
 * reason (`SlotPanel`'s `name`); this is that rule, in one place, for every
 * caption.
 */
export function displayedName(
  slot: { live: unknown; mesh: { fileName: string } | null },
  record: { name: string } | null,
): string | null {
  return slot.live !== null
    ? (slot.mesh?.fileName ?? record?.name ?? null)
    : (record?.name ?? slot.mesh?.fileName ?? null)
}

/** The hash that pairs with `displayedName`: the mesh's while its answer is live. */
export function displayedModelHash(
  slot: { live: unknown; mesh: { sha256Hex: string } | null },
  record: { modelHash: string } | null,
): string | null {
  return slot.live !== null
    ? (slot.mesh?.sha256Hex ?? record?.modelHash ?? null)
    : (record?.modelHash ?? slot.mesh?.sha256Hex ?? null)
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
   * filtered rather than restored half-alive. Every record comes from one
   * real solve, so there is no "half a result" to render: `converged` and
   * `planesEvaluated` are the truth about the run it came from.
   */
  result: TrimSolveResult
  savedAt: number
}

/** Versioned so a future schema change can tell its own entries apart. */
export const COMPARE_STORAGE_KEY = 'kayak-analyzer.compare.v1'

/**
 * How many runs the roster keeps.
 *
 * Every Analyze solve auto-adds one, and a record carries its 10-sample GZ
 * curve (~1 KB of JSON), while a localStorage origin gets ~5 MB. An uncapped
 * roster therefore ends in a failed write - exactly the state the roster
 * banner exists to report - so the cap is what keeps the banner reserved for
 * real refusals. Newest first, oldest dropped: that is the order the roster
 * already uses, and `addRosterRecord` prepends.
 */
export const ROSTER_LIMIT = 50

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
 * Freeze a record and every structure it owns, and return it.
 *
 * Both producers share this: `recordFromSolve` freezes the snapshot it built,
 * and `readRoster` freezes what it restores. "Records are immutable
 * snapshots" has to hold for the restored ones too - they are the records a
 * slot shows after a reload, and before this they were the only mutable
 * copies in the app.
 */
function freezeRecord(record: RunRecord): RunRecord {
  Object.freeze(record.inputs)
  Object.freeze(record.result)
  Object.freeze(record.result.lcb)
  Object.freeze(record.result.lcg)
  Object.freeze(record.result.pivot)
  // The ARRAY beside its points: frozen points in a mutable array still let an
  // in-place push or index write rewrite the plotted curve, and the array is
  // what every reader walks.
  for (const point of record.result.gzCurve) Object.freeze(point)
  Object.freeze(record.result.gzCurve)
  return Object.freeze(record)
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
  return freezeRecord({
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
  // Frozen on the way in, like a created record, and capped like one: a
  // hand-edited or older oversized roster must not restore more than the
  // write path would keep.
  return parsed.filter(isRunRecord).slice(0, ROSTER_LIMIT).map(freezeRecord)
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
 * What a failed roster write actually put at risk.
 *
 * The old banner inferred it from the roster's LENGTH, so the first mount of a
 * restored roster that could not be re-written warned that runs already in
 * storage were "in memory only and will be lost on reload" - untrue, they
 * came out of storage and will come back. Comparing ID SETS answers the real
 * question: which of the records on screen has storage never accepted?
 *
 *   - `deletion` - a stored id is gone from the roster. `writeRoster` always
 *     writes, so the removed runs are still stored and only the banner can say
 *     they will return.
 *   - `volatile` - records the last successful write never saw; those really
 *     do exist only in memory (`count` of them).
 *   - `none` - every record on screen is already stored, so nothing was lost.
 *
 * A write that both deleted and added reports `deletion`: it is the bigger
 * lie, because the user asked for that change and did not get it.
 */
export type RosterWriteRisk =
  | { kind: 'none' }
  | { kind: 'deletion' }
  | { kind: 'volatile'; count: number }

export function rosterWriteRisk(
  recordIds: readonly string[],
  persistedIds: ReadonlySet<string>,
): RosterWriteRisk {
  if ([...persistedIds].some((id) => !recordIds.includes(id))) return { kind: 'deletion' }
  const count = recordIds.filter((id) => !persistedIds.has(id)).length
  return count === 0 ? { kind: 'none' } : { kind: 'volatile', count }
}

/**
 * The one line the roster picker shows under a run's file name.
 *
 * Two runs of the SAME hull at different weights used to render identically
 * (same name, same six hash characters), so a slot's pick could not be told
 * apart from its sibling and choosing the wrong one silently changed the
 * comparison. The conditions are what actually differ between them.
 */
export function recordConditionLabel(inputs: SlotInputs): string {
  const heel = inputs.heelDeg === 0 ? '' : ` · heel ${signed(inputs.heelDeg, 0)}°`
  return `${fmt(inputs.weightKg)} kg · LCG ${fmt(inputs.lcgPctLwl)}% · KG ${fmt(inputs.kgMm)} mm${heel}`
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
 *   1. **No samples at all** — a curve with nothing in it. There is no curve
 *      to read, so the cell is an em dash. "not within 0°" (what the old cell said) is a STABILITY claim
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
   * on a hull this file is not known to be (a different one, or an unhashable
   * page that cannot tell). Drawn, but not solved: the numbers on screen
   * describe geometry other than the one being drawn.
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
 * numbers are not known to describe the file on screen, so it is not counted as
 * solved and the order the line predicts ("the deeper hull floats lower") is
 * not claimed.
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
      // hull, not the file on screen - and where the hash cannot tie the two
      // together, that is said as unknown rather than assumed either way. The
      // panel's own note says the same thing about the same slot.
      sentences.push(
        `Slot ${slot.label}'s STL is drawn, but the pose shown is its record's — solved on a hull this file is not known to be.`,
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
 * Twelve digits absorb the last-bit wobble of a re-solve while still telling
 * apart runs whose numbers differ beyond the precision the physics has.
 */
function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'
  return value.toPrecision(12)
}

/**
 * A stable text form of a JSON value: object keys sorted, numbers at twelve
 * significant digits, `undefined` members dropped. Two records with the same
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
 * A record's `id` and `savedAt` are minted per CREATION, so the same run
 * arriving twice — a re-solve of the same hull at the same conditions, an
 * undone delete — would otherwise sit in the roster as two entries for one
 * run. Everything else a record carries IS the run: the hull it names, the
 * conditions it was solved at, and the metrics that solve reported.
 */
export function recordFingerprint(record: RunRecord): string {
  return canonicalJson({
    name: record.name,
    modelHash: record.modelHash,
    inputs: record.inputs,
    result: record.result,
  })
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
  // Newest first, so the cap drops the oldest; the duplicate and id branches
  // above can never grow the roster and never reach this slice.
  return [record, ...roster].slice(0, ROSTER_LIMIT)
}

/**
 * The roster entry that REPRESENTS a run: the stored one when the run is
 * already there, the record itself otherwise.
 *
 * A run that arrives again — a re-solve of the same conditions, an undone
 * delete — must not mint a second copy of it: the slot then shows the stored
 * entry, so the roster list and the slot's pick name one run.
 */
export function canonicalRecord(roster: RunRecord[], record: RunRecord): RunRecord {
  const fingerprint = recordFingerprint(record)
  return roster.find((entry) => recordFingerprint(entry) === fingerprint) ?? record
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
 * "restored" mean restored, and it costs nothing: every record comes from one
 * live solve, which produces the complete result anyway.
 *
 * `converged` is validated beside it as a boolean, `endTipImmersionDeg` as a
 * number-or-null, the three vectors as Vec3, and the curve in ascending heel
 * order. The five diagnostics (`waterplaneAreaMm2`, `midshipAreaMm2`,
 * `wettedSurfaceAreaMm2`, `waterplaneIyyMm4`, `waterplaneLoopCount`) are
 * validated here too: a record that carries them renders them truthfully.
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
  // documents the ordering contract the solver keeps).
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
    // The same gate as the creation: a hash is 64 lowercase hex
    // characters, or it is not a hash the re-pick could ever match.
    typeof r.modelHash === 'string' &&
    SHA256_HEX_PATTERN.test(r.modelHash) &&
    typeof r.savedAt === 'number' &&
    r.savedAt > 0 &&
    isSlotInputs(r.inputs) &&
    isSolveResultLike(r.result)
  )
}
