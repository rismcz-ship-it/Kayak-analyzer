import { useCallback, useRef, useState } from 'react'
import {
  exportRunRecord,
  liveAnswerIsCurrent,
  poseIsForeign,
  type RunRecord,
  recordFromSolve,
  type SlotInputs,
  slotConditions,
} from '../lib/compare'
import { DEFAULT_KG_MM } from '../lib/hydrostatics'
import { HEEL_MAX, HEEL_MIN, type NumericInputs, parseInputs, scaleNotice } from '../lib/inputs'
import type { SlotState } from './CompareView'
import Upload, { type LoadedMesh, rescaleMesh, type UploadHandle } from './Upload'
import { SLOT_COLORS } from './Viewer3D'

/**
 * One Compare slot's controls: the conditions it solves at, its solve status,
 * and the re-pick / export pair.
 *
 * The panel owns the four fields as RAW STRINGS the way App owns its form
 * (`lib/inputs.ts` — `Number('')` is 0, the historic bug), and reuses
 * `parseInputs` itself, so a slot is gated by exactly the predicate the home
 * form is. CompareView keys it on the slot label, the record id and a
 * per-pick counter, so a pick - including a re-pick of the record the slot
 * already shows - remounts it and the strings fall back to that record's own
 * values without a sync effect. The label is part of the key because the two
 * panels can legitimately hold the SAME record (one hull, two conditions),
 * and a key without it let the panels impersonate each other.
 *
 * The roster itself is NOT rendered here: it is one shared list in CompareView
 * above both panels, with a button per slot, so "click the file" always names
 * the slot it fills.
 *
 * A slot with NO record takes a fresh STL directly: the hull solves live at
 * the panel's own conditions and its Export writes a run record from that
 * live solve - there is no saved run behind it, so Export waits for one.
 * That is the Compare tab's "add a model" path, separate from the roster.
 *
 * Two store-picked details:
 *
 *  - A record's numbers are FROZEN (`compare.ts`), so the slot's editable
 *    inputs live in CompareView and arrive here as `slot.inputs`.
 *  - Export captures what the slot DISPLAYS - the result AND the conditions
 *    that pair was produced at (`slot.live` with `slot.liveInputs`, else the
 *    record's own). Pairing the record's results with the slot's edited
 *    targets would write a document asserting a solve at conditions that
 *    never ran.
 */
interface SlotPanelProps {
  /** Which slot this is: the badge, its overlay colour, and its input ids. */
  label: 'A' | 'B'
  slot: SlotState
  /** The record this slot shows, or null when nothing is picked. */
  record: RunRecord | null
  onInputs: (inputs: SlotInputs) => void
  /** A re-picked (or rescaled) STL for this slot. */
  onMesh: (mesh: LoadedMesh) => void
  /**
   * Unload this slot's STL: the mesh and the live answer it produced go, while
   * the record and the typed conditions stay. The explicit inverse of a
   * re-pick - the panel returns to asking for the file.
   */
  onClearMesh: () => void
}

function fieldStrings(record: RunRecord | null): NumericInputs {
  return {
    weightInput: String(record?.inputs.weightKg ?? 75),
    lcgInput: String(record?.inputs.lcgPctLwl ?? 52),
    kgInput: String(record?.inputs.kgMm ?? DEFAULT_KG_MM),
  }
}

export default function SlotPanel({
  label,
  slot,
  record,
  onInputs,
  onMesh,
  onClearMesh,
}: SlotPanelProps) {
  const colorIndex = label === 'A' ? 0 : 1
  const [numeric, setNumeric] = useState<NumericInputs>(() => fieldStrings(record))
  const [heelDeg, setHeelDeg] = useState(() => record?.inputs.heelDeg ?? 0)
  // The Analyze tab's fixed-heel toggle: heel is an APPLIED angle, so with the
  // toggle off the slot solves at 0 whatever the slider last read. A restored
  // record picks the toggle up from its own heel - a non-zero one could only
  // have been written with the toggle on, which is the same rule
  // `readStoredInputs` boots the home form with.
  const [showHeel, setShowHeel] = useState(() => (record?.inputs.heelDeg ?? 0) !== 0)
  // The STL that does not hash to this record's, awaiting an explicit choice.
  const [mismatch, setMismatch] = useState<LoadedMesh | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  /**
   * What the HIDDEN picker is doing.
   *
   * With a hull in memory the picker is mounted behind a `display:none`
   * wrapper (the "Replace STL" button opens it), so its own "Parsing…" and
   * error text are invisible: a file that failed to parse would vanish
   * without a word. The Upload reports its state here instead.
   */
  const [pickStatus, setPickStatus] = useState<{ busy: boolean; error: string | null } | null>(null)
  const reportPickStatus = useCallback((status: { busy: boolean; error: string | null }) => {
    setPickStatus(status)
  }, [])
  // All three panel states mount exactly one Upload, so this one ref always
  // has a mounted input behind it: with a hull in memory that mount is hidden
  // behind the "Replace STL" button, which opens its picker on its own click.
  const uploadRef = useRef<UploadHandle | null>(null)

  const parsed = parseInputs(numeric)
  const allValid = parsed.weightKg !== null && parsed.lcgPercent !== null && parsed.kgMm !== null
  /**
   * The conditions the panel is showing RIGHT NOW: the typed numbers (or the
   * slot's own last valid triple while a field is momentarily invalid) and the
   * APPLIED heel.
   */
  const shownConditions = slotConditions(
    parsed.weightKg !== null && parsed.lcgPercent !== null && parsed.kgMm !== null
      ? { weightKg: parsed.weightKg, lcgPctLwl: parsed.lcgPercent, kgMm: parsed.kgMm }
      : slot.inputs,
    showHeel,
    heelDeg,
  )
  /**
   * Is the live answer an answer to THESE conditions? A live result belongs to
   * the conditions it was solved at, so the claim below may only be made while
   * the two agree: after an edit the panel re-renders once with the new
   * conditions and the old answer, and "Live - solved at the conditions above"
   * would be a lie for that frame.
   */
  const liveIsCurrent = liveAnswerIsCurrent(slot.liveInputs, shownConditions)

  /**
   * Commit the three text fields and emit the set only when the whole set is
   * one the form's gate accepts — an intermediate "9" in the weight field must
   * never reach a solver, exactly as the home form never lets it reach its
   * Calculate button.
   *
   * The heel travels with the set under the toggle's rule (`slotConditions`):
   * the slider's value is applied only while the toggle is on, so editing the
   * weight with the toggle off must not quietly re-apply a leftover angle the
   * panel says is not applied.
   */
  const commitNumeric = (patch: Partial<NumericInputs>) => {
    const next = { ...numeric, ...patch }
    setNumeric(next)
    const p = parseInputs(next)
    if (p.weightKg !== null && p.lcgPercent !== null && p.kgMm !== null) {
      onInputs(
        slotConditions(
          { weightKg: p.weightKg, lcgPctLwl: p.lcgPercent, kgMm: p.kgMm },
          showHeel,
          heelDeg,
        ),
      )
    }
  }

  /**
   * Push one condition set into the slot: the numeric triple as typed (or the
   * slot's own last valid triple while a text field is momentarily invalid) and
   * the heel under the toggle's rule.
   */
  const emitConditions = (showHeelNow: boolean, heelNow: number) => {
    const p = parseInputs(numeric)
    const parsed =
      p.weightKg !== null && p.lcgPercent !== null && p.kgMm !== null
        ? { weightKg: p.weightKg, lcgPctLwl: p.lcgPercent, kgMm: p.kgMm }
        : slot.inputs
    onInputs(slotConditions(parsed, showHeelNow, heelNow))
  }

  /**
   * Moving the slider REPLACES the applied angle outright - it is already
   * revealed, so there is no leftover to preserve. `emitConditions` carries the
   * value past a momentarily invalid text field, so a slider move is never
   * dropped by an unrelated keystroke.
   */
  const commitHeel = (value: number) => {
    setHeelDeg(value)
    emitConditions(showHeel, value)
  }

  /**
   * The fixed-heel toggle. Turning it OFF solves at 0 - the slider's value is
   * kept as the leftover exactly as the home form does, so turning it back on
   * re-applies the same angle rather than jumping to 0.
   */
  const toggleHeel = (on: boolean) => {
    setShowHeel(on)
    emitConditions(on, heelDeg)
  }

  /**
   * The re-pick gate. A file whose hash IS the record's is the same STL the
   * record was built from and is adopted directly; anything else — a different
   * hull, an edited file, or a page with no `crypto.subtle` whose hash is the
   * empty string — is shown with both hashes and an explicit choice, because
   * posing the wrong geometry on a record's numbers is a silent lie.
   */
  const handleRepick = (loaded: LoadedMesh) => {
    setExportError(null)
    // With no record picked there is no expected hash to check against, so
    // whatever arrives simply becomes this slot's own mesh.
    if (record === null || loaded.sha256Hex === record.modelHash) {
      setMismatch(null)
      onMesh(loaded)
      return
    }
    setMismatch(loaded)
  }

  /**
   * The metres advice's Apply path, identical to the home tab's: a copy into a
   * new buffer (`rescaleMesh`), adopted as a fresh mesh whose hash is the
   * SAME file's — the hash describes the bytes, not the units.
   */
  const applyScale = () => {
    const advice = slot.mesh?.scaleAdvice
    if (!slot.mesh || !advice || advice.kind !== 'metres') return
    setMismatch(null)
    onMesh(rescaleMesh(slot.mesh, advice.factor))
  }

  const onExport = () => {
    setExportError(null)
    // What the slot DISPLAYS. The name and the hash must come from the SAME
    // source as the numbers: a live result was solved from the slot's own
    // re-picked STL, so it carries the mesh's identity; the record's snapshot
    // came from the record's hull, so it must keep the record's name and hash
    // even while a foreign STL waits for its own solve. Mixing the two stamps
    // the document with a model its numbers never came from, and the re-import
    // would then ask for an STL that is not the one that produced them.
    //
    // The conditions travel WITH the result for the same reason: the live
    // solve's own while it has one, the record's own when its snapshot is what
    // is on screen. Pairing the displayed results with the slot's EDITED
    // targets instead would write a document whose reproduction inputs never
    // produced its numbers (`exportRunRecord` copies `record.inputs` into
    // `targets` verbatim) - and a slot whose STL is not in memory has no live
    // solve at all, so that was the default state of every imported record.
    const own = slot.mesh
    // Captured in a local const before anything branches on it: narrowing the
    // `slot.live` property through a boolean alias does not survive to the
    // uses below, so the value itself is what gets compared.
    const liveSolve = slot.live
    const displayed = liveSolve ?? record?.result ?? null
    // A live solve from a mesh the page could not hash names no model at all:
    // `recordFromSolve` would refuse it with a developer-only message, so the
    // panel says it in plain language instead. Checked BEFORE the
    // nothing-to-export gate below: with no hash, modelHash IS '' here, so
    // that gate would return first and leave an enabled Export click with no
    // answer at all.
    if (liveSolve !== null && own && own.sha256Hex === '') {
      setExportError(
        'This page cannot hash STLs (no secure context), so this hull cannot be exported as a run record.',
      )
      return
    }
    const conditions =
      liveSolve !== null ? (slot.liveInputs ?? slot.inputs) : (record?.inputs ?? slot.inputs)
    const name = liveSolve !== null && own ? own.fileName : (record?.name ?? own?.fileName ?? '')
    const modelHash =
      liveSolve !== null && own ? own.sha256Hex : (record?.modelHash ?? own?.sha256Hex ?? '')
    // A fresh slot exports only its own live solve of its own mesh - there is
    // no saved run to fall back to. The button is disabled before then; this
    // is the same gate in code.
    if (displayed === null || name === '' || modelHash === '') return
    try {
      const doc = exportRunRecord(recordFromSolve(name, modelHash, conditions, displayed))
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
      )
      // `kayak.stl` downloads as `kayak.run.json`, not `kayak.stl.run.json`.
      const base = name.replace(/\.stl$/i, '')
      const link = document.createElement('a')
      link.href = url
      link.download = `${base}.run.json`
      // Appended, clicked, removed: Chromium downloads a detached link, other
      // engines do not. The URL is revoked on the next task rather than in
      // this tick, which some browsers read as cancelling the download.
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'The export failed.')
    }
  }

  const maxDim = slot.mesh
    ? Math.max(
        slot.mesh.stats.bounds.size.x,
        slot.mesh.stats.bounds.size.y,
        slot.mesh.stats.bounds.size.z,
      )
    : 0

  // The record's snapshot is on screen over a DIFFERENT file's geometry: the
  // numbers describe a hull that is not the one being drawn. The shared
  // predicate - the same one the overlay caption counts its solved hulls with -
  // so the two cannot drift apart, and so an unhashable page (no crypto.subtle)
  // is reported as not-known rather than waved through as a match.
  const foreignGeometry = poseIsForeign(
    slot.mesh?.sha256Hex ?? null,
    record?.modelHash ?? null,
    slot.live !== null,
  )

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-2 flex items-center gap-2 border-b border-zinc-800 pb-2">
        <span
          className="rounded px-1.5 py-0.5 text-xs font-bold text-zinc-950"
          style={{ backgroundColor: `#${SLOT_COLORS[colorIndex].toString(16).padStart(6, '0')}` }}
        >
          {label}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm text-zinc-200"
          title={record ? `${record.name} · ${record.modelHash}` : undefined}
        >
          {record?.name ?? slot.mesh?.fileName ?? 'empty slot'}
        </span>
        <button
          type="button"
          onClick={onExport}
          disabled={!allValid || (record === null && (slot.live === null || slot.mesh === null))}
          title={
            record === null && (slot.live === null || slot.mesh === null)
              ? 'Load an STL and let its solve finish first.'
              : !allValid
                ? 'Fix the highlighted conditions first.'
                : 'Download this run as a .run.json'
          }
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${label}-weight`} className="mb-1 block text-xs text-zinc-400">
            Weight (kg)
          </label>
          <input
            id={`${label}-weight`}
            type="text"
            inputMode="decimal"
            value={numeric.weightInput}
            onChange={(e) => commitNumeric({ weightInput: e.target.value })}
            className="w-full rounded border border-zinc-700 bg-zinc-800 p-1.5 text-sm text-white"
          />
          {parsed.weightError && (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {parsed.weightError}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`${label}-lcg`} className="mb-1 block text-xs text-zinc-400">
            LCG from bow (%)
          </label>
          <input
            id={`${label}-lcg`}
            type="text"
            inputMode="decimal"
            value={numeric.lcgInput}
            onChange={(e) => commitNumeric({ lcgInput: e.target.value })}
            className="w-full rounded border border-zinc-700 bg-zinc-800 p-1.5 text-sm text-white"
          />
          {parsed.lcgError && (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {parsed.lcgError}
            </p>
          )}
        </div>
        <div>
          <label htmlFor={`${label}-kg`} className="mb-1 block text-xs text-zinc-400">
            KG above keel (mm)
          </label>
          <input
            id={`${label}-kg`}
            type="text"
            inputMode="decimal"
            value={numeric.kgInput}
            onChange={(e) => commitNumeric({ kgInput: e.target.value })}
            className="w-full rounded border border-zinc-700 bg-zinc-800 p-1.5 text-sm text-white"
          />
          {parsed.kgError && (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {parsed.kgError}
            </p>
          )}
        </div>
        <div>
          {/* The Analyze tab's fixed-heel toggle: heel is an APPLIED angle,
              so off means this slot solves at 0 and the slider stays out of
              the way until it is asked for. */}
          <label className="mb-1 flex cursor-pointer items-center gap-2 group">
            <div
              className={`w-8 h-4 rounded-full border border-zinc-700 transition-colors ${showHeel ? 'border-sky-400 bg-sky-600' : 'bg-zinc-800'}`}
            >
              <div
                className={`h-3 w-3 m-0.5 rounded-full bg-white transition-transform ${showHeel ? 'translate-x-4' : 'translate-x-0'}`}
              />
            </div>
            <input
              type="checkbox"
              className="hidden"
              checked={showHeel}
              onChange={(e) => toggleHeel(e.target.checked)}
            />
            <span className="text-xs text-zinc-400 group-hover:text-zinc-300">
              Set fixed heel angle
            </span>
          </label>
          {showHeel && (
            <>
              <label htmlFor={`${label}-heel`} className="mb-1 block text-xs text-zinc-400">
                Heel (°) — + = −Y side down
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`${label}-heel`}
                  type="range"
                  min={HEEL_MIN}
                  max={HEEL_MAX}
                  step={1}
                  value={heelDeg}
                  onChange={(e) => commitHeel(Number(e.target.value))}
                  className="h-1.5 flex-1 appearance-none rounded-lg bg-zinc-700 accent-sky-500"
                />
                <span className="w-8 text-right font-mono text-xs text-zinc-300">{heelDeg}°</span>
              </div>
            </>
          )}
          {/* The leftover is kept while the toggle is off, so it is SAYING so
              too: the slider is out of sight, and a hidden angle that silently
              comes back when the toggle is switched on is a trap. */}
          {!showHeel && heelDeg !== 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              Heel {heelDeg}° is kept as a leftover — this slot solves upright until the toggle is
              switched on.
            </p>
          )}
        </div>
      </div>

      {slot.solving && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-sky-500 transition-[width] duration-150"
              style={{
                width:
                  slot.progress && slot.progress.total > 0
                    ? `${Math.min(100, Math.round((slot.progress.done / slot.progress.total) * 100))}%`
                    : '4%',
              }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-400" role="status" aria-live="polite">
            {slot.progress
              ? `Solving… angle ${slot.progress.done}/${slot.progress.total}`
              : 'Starting solver…'}
          </p>
        </div>
      )}
      {slot.error && (
        <p
          className="mt-3 rounded border border-rose-900 bg-rose-950/50 p-2 text-xs text-rose-300"
          role="alert"
        >
          {slot.error}
        </p>
      )}
      {/* Honest prose: the claim "at the conditions above" only holds while
          every field parses AND the live answer belongs to those conditions -
          a field holding garbage leaves slot.inputs at the last valid values,
          and its own error message says so instead; and an edited condition
          makes the answer on screen the PREVIOUS solve's, which the solver
          status says instead. */}
      {!slot.solving &&
        !slot.error &&
        liveIsCurrent &&
        !parsed.weightError &&
        !parsed.lcgError &&
        !parsed.kgError && (
          <p className="mt-3 text-xs text-emerald-400">Live — solved at the conditions above.</p>
        )}
      {/* With a mesh in memory the slot's solve effect re-runs on every edit, so
          "edit a condition" really does re-solve. With no mesh it returns at the
          top (`useSlotSolve`), no solve is ever scheduled, and the typed
          conditions only take effect once an STL is loaded - the old wording
          promised a re-solve that could not happen. */}
      {!slot.solving && !slot.error && !slot.live && record !== null && (
        <p className="mt-3 text-xs text-zinc-500">
          {slot.mesh
            ? 'Showing the saved run — edit a condition to re-solve.'
            : 'Showing the saved run — no STL is loaded, so the conditions above are solved when you load one.'}
        </p>
      )}
      {foreignGeometry && (
        <p className="mt-1 text-xs text-amber-400" role="note">
          The STL in memory is not known to be the hull this record was solved on — the numbers
          above are that record's, posed on the file below.
        </p>
      )}

      {slot.mesh ? (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate text-xs text-emerald-400"
              title={slot.mesh.orientNote}
            >
              STL in memory - {slot.mesh.fileName}
            </p>
            <button
              type="button"
              onClick={() => uploadRef.current?.open()}
              title="Choose another STL for this slot - the picker opens right here, and cancelling leaves the loaded hull in place."
              className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Replace STL
            </button>
            <button
              type="button"
              onClick={() => {
                // Both describe the mesh that is leaving: a pending mismatch
                // gate for a file that was never adopted, and an export error
                // from a hull that is gone.
                setMismatch(null)
                setExportError(null)
                onClearMesh()
              }}
              title="Unload this slot's STL and its live answer — the record and the typed conditions stay."
              className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Clear model
            </button>
          </div>
          {!slot.mesh.stats.watertight.watertight && (
            <p className="mt-1 text-xs text-amber-400" role="note">
              {slot.mesh.stats.watertight.openEdgeCount} open edges — the solver needs a closed
              hull, so this slot is not solved.
            </p>
          )}
          {slot.mesh.scaleAdvice && (
            <p className="mt-1 text-xs text-amber-400" role="note">
              {scaleNotice(slot.mesh.scaleAdvice, maxDim)}
              {slot.mesh.scaleAdvice.kind === 'metres' && (
                <button
                  type="button"
                  onClick={applyScale}
                  className="ml-2 rounded border border-amber-600/60 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-950/40"
                >
                  Apply ×1000
                </button>
              )}
            </p>
          )}
          {/* The page could not hash the file (no secure context), so this hull
              has no model identity: it cannot be exported as a run record.
              Said HERE, as soon as the file is loaded — the Export click used
              to be the only place the user found out, and the click produced
              no file at all. */}
          {slot.mesh.sha256Hex === '' && (
            <p className="mt-1 text-xs text-amber-400" role="note">
              This page cannot hash STLs (no secure context), so this hull cannot be exported as a
              run record.
            </p>
          )}
          {/* The picker behind "Replace STL": hidden, because the button above
              is this state's whole loading affordance. Mounted here so
              `uploadRef` always has an input to open, whichever state the slot
              is in - a pick in any state reaches the same `handleRepick`.
              Its own "Parsing…" and error text live inside its button, so it
              REPORTS them here instead - otherwise a file that failed to parse
              would disappear without a word. */}
          <div className="hidden">
            <Upload ref={uploadRef} onLoaded={handleRepick} compact onStatus={reportPickStatus} />
          </div>
          {pickStatus?.busy && (
            <p className="mt-1 text-xs text-zinc-400" role="status">
              Parsing the picked file…
            </p>
          )}
          {pickStatus?.error && (
            <p className="mt-1 text-xs text-rose-300" role="alert">
              {pickStatus.error}
            </p>
          )}
        </div>
      ) : record !== null ? (
        <div className="mt-3">
          <p className="mb-2 text-xs text-zinc-500">
            This record's STL is not in memory — load it to see the hull in the overlay.
          </p>
          <Upload ref={uploadRef} onLoaded={handleRepick} compact />
        </div>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-xs text-zinc-500">
            Drop an STL here to solve it fresh — its numbers stay live in this slot, and its Export
            writes a run record once the solve lands.
          </p>
          <Upload ref={uploadRef} onLoaded={handleRepick} compact prompt="Drop an STL hull here" />
        </div>
      )}
      {/* The re-pick gate's answer, whichever state the pick happened in: a
          "Replace STL" click with a hull already in memory can pick a foreign
          file too, and that choice must render there exactly as it does on the
          record's own empty drop zone. */}
      {mismatch && record !== null && (
        <div
          className="mt-2 rounded border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-300"
          role="note"
        >
          <p className="mb-2">
            This file hashes to{' '}
            <span className="font-mono" title={mismatch.sha256Hex}>
              {mismatch.sha256Hex === '' ? 'nothing' : `${mismatch.sha256Hex.slice(0, 12)}…`}
            </span>
            , but the record was saved from{' '}
            <span className="font-mono" title={record.modelHash}>
              {record.modelHash.slice(0, 12)}…
            </span>
            . It may be a different hull, or the same one edited — its numbers would be posed on
            this file's geometry.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                onMesh(mismatch)
                setMismatch(null)
              }}
              className="rounded border border-amber-600/60 px-2 py-0.5 text-amber-200 hover:bg-amber-950/40"
            >
              Use anyway
            </button>
            <button
              type="button"
              onClick={() => setMismatch(null)}
              className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {exportError && (
        <p
          className="mt-2 rounded border border-rose-900 bg-rose-950/50 p-2 text-xs text-rose-300"
          role="alert"
        >
          {exportError}
        </p>
      )}
    </section>
  )
}
