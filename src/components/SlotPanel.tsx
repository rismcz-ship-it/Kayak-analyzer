import { useCallback, useRef, useState } from 'react'
import {
  displayedModelHash,
  displayedName,
  liveAnswerIsCurrent,
  poseIsForeign,
  type RunRecord,
  type SlotInputs,
  slotConditions,
} from '../lib/compare'
import { DEFAULT_KG_MM } from '../lib/hydrostatics'
import { HEEL_MAX, HEEL_MIN, type NumericInputs, parseInputs, scaleNotice } from '../lib/inputs'
import type { SlotState } from './CompareView'
import Switch from './Switch'
import Upload, { type LoadedMesh, rescaleMesh, type UploadHandle } from './Upload'
import { SLOT_COLORS } from './Viewer3D'

/**
 * One Compare slot's controls: the conditions it solves at, its solve status,
 * and its re-pick path.
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
 * the panel's own conditions. That is the Compare tab's "add a model" path,
 * separate from the roster.
 *
 * One store-picked detail: a record's numbers are FROZEN (`compare.ts`), so
 * the slot's editable inputs live in CompareView and arrive here as
 * `slot.inputs`.
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
  /** Empty the slot completely: its record, its STL and its answer all go. */
  onClearSlot: () => void
}

function fieldStrings(record: RunRecord | null): NumericInputs {
  return {
    weightInput: String(record?.inputs.weightKg ?? 75),
    lcgInput: String(record?.inputs.lcgPctLwl ?? 52),
    kgInput: String(record?.inputs.kgMm ?? DEFAULT_KG_MM),
  }
}

/**
 * One condition: a label, the value, and its unit inside the field.
 *
 * The label sits BESIDE the field, not above it: the card is half a panel wide,
 * and three stacked fields cost 180 px - more than the whole comparison the
 * panel exists to show.
 */
function Field({
  id,
  label,
  unit,
  value,
  error,
  onChange,
}: {
  id: string
  label: string
  unit: string
  value: string
  error?: string | null
  onChange: (value: string) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="w-[64px] flex-none truncate text-[11px] text-ink-2">
          {label}
        </label>
        <div
          className={`flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border bg-panel-2 px-2 transition-colors ${
            error
              ? 'border-bad'
              : 'border-line-2 focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15'
          }`}
        >
          <input
            id={id}
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="w-full min-w-0 bg-transparent p-0 font-mono text-[12px] tabular-nums text-ink outline-none"
          />
          <span className="flex-none text-[11px] text-ink-3">{unit}</span>
        </div>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[11px] leading-snug text-bad" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function Note({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'warn' | 'bad'
  children: React.ReactNode
}) {
  const color = tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink-3'
  return (
    <p className={`mt-2 flex items-start gap-2 text-[11px] leading-snug ${color}`}>
      <i className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-current" />
      <span>{children}</span>
    </p>
  )
}

export default function SlotPanel({
  label,
  slot,
  record,
  onInputs,
  onMesh,
  onClearMesh,
  onClearSlot,
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
    const parsedTriple =
      p.weightKg !== null && p.lcgPercent !== null && p.kgMm !== null
        ? { weightKg: p.weightKg, lcgPctLwl: p.lcgPercent, kgMm: p.kgMm }
        : slot.inputs
    onInputs(slotConditions(parsedTriple, showHeelNow, heelNow))
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

  // Named by what is on screen, not by what is merely picked: the same rule
  // the columns use (`displayedName`).
  const shownName = displayedName(slot, record) ?? 'empty slot'
  const shownHash = displayedModelHash(slot, record)
  const colour = `#${SLOT_COLORS[colorIndex].toString(16).padStart(6, '0')}`

  return (
    <section className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="rounded px-2 py-1 text-[11px] font-bold text-accent-ink"
          style={{ backgroundColor: colour }}
        >
          {label}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12px] text-ink"
          title={shownHash !== null ? `${shownName} · ${shownHash}` : undefined}
        >
          {shownName}
        </span>
        <button
          type="button"
          onClick={onClearSlot}
          title={`Clear slot ${label} — its hull, its record and its numbers`}
          aria-label={`Clear slot ${label}`}
          className="flex-none rounded px-1 text-[12px] text-ink-3 transition-colors hover:text-bad active:scale-[0.98]"
        >
          ✕
        </button>
      </div>

      <div className="grid gap-2">
        <Field
          id={`${label}-weight`}
          label="Weight"
          unit="kg"
          value={numeric.weightInput}
          error={parsed.weightError}
          onChange={(weightInput) => commitNumeric({ weightInput })}
        />
        <Field
          id={`${label}-lcg`}
          label="LCG from bow"
          unit="%"
          value={numeric.lcgInput}
          error={parsed.lcgError}
          onChange={(lcgInput) => commitNumeric({ lcgInput })}
        />
        <Field
          id={`${label}-kg`}
          label="KG above keel"
          unit="mm"
          value={numeric.kgInput}
          error={parsed.kgError}
          onChange={(kgInput) => commitNumeric({ kgInput })}
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={showHeel}
          onClick={() => toggleHeel(!showHeel)}
          className="flex items-center gap-2 text-[12px] text-ink-2 transition-colors hover:text-ink active:scale-[0.98]"
        >
          <Switch checked={showHeel} />
          <span>Fixed heel</span>
        </button>
      </div>

      {showHeel && (
        <div className="mt-2 flex items-center gap-2">
          <input
            id={`${label}-heel`}
            type="range"
            min={HEEL_MIN}
            max={HEEL_MAX}
            step={1}
            value={heelDeg}
            onChange={(e) => commitHeel(Number(e.target.value))}
            aria-label="Fixed heel angle in degrees"
            className="h-4 flex-1 accent-accent-500"
          />
          <output
            htmlFor={`${label}-heel`}
            className="min-w-8 text-right font-mono text-[12px] tabular-nums text-ink-2"
            title="+ = the −Y side goes down"
          >
            {heelDeg > 0 ? `+${heelDeg}` : heelDeg}°
          </output>
        </div>
      )}
      {/* The leftover is kept while the toggle is off, so it is SAYING so
          too: the slider is out of sight, and a hidden angle that silently
          comes back when the toggle is switched on is a trap. */}
      {!showHeel && heelDeg !== 0 && (
        <Note>
          Heel {heelDeg}° is kept as a leftover — this slot solves upright until the toggle is on.
        </Note>
      )}

      {slot.solving && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-150"
              style={{
                width:
                  slot.progress && slot.progress.total > 0
                    ? `${Math.min(100, Math.round((slot.progress.done / slot.progress.total) * 100))}%`
                    : '4%',
              }}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-2" role="status" aria-live="polite">
            {slot.progress
              ? `Solving… angle ${slot.progress.done}/${slot.progress.total}`
              : 'Starting solver…'}
          </p>
        </div>
      )}
      {slot.error && (
        <p
          className="mt-2 rounded-md border border-bad/40 bg-bad/10 px-2 py-1 text-[11px] text-bad"
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
          <span
            className="mt-2 block text-[11px] leading-snug text-ink-3"
            title="These numbers are a live solve at the conditions above."
          >
            Live — solved above.
          </span>
        )}
      {/* With a mesh in memory the slot's solve effect re-runs on every edit, so
          "edit a condition" really does re-solve. With no mesh it returns at the
          top (`useSlotSolve`), no solve is ever scheduled, and the typed
          conditions only take effect once an STL is loaded - the old wording
          promised a re-solve that could not happen. */}
      {!slot.solving && !slot.error && !slot.live && record !== null && (
        <Note>
          {slot.mesh
            ? 'Showing the saved run — edit a condition to re-solve.'
            : 'Showing the saved run — no STL is loaded, so the conditions above are solved when you load one.'}
        </Note>
      )}
      {foreignGeometry && (
        <Note tone="warn">
          The STL in memory is not known to be the hull this record was solved on — the numbers
          above are that record's, posed on the file below.
        </Note>
      )}

      {slot.mesh ? (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => uploadRef.current?.open()}
              title={`Choose another STL for this slot (${slot.mesh.fileName}) - the picker opens right here, and cancelling leaves the loaded hull in place.`}
              className="rounded-md border border-line-2 px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-panel-2 active:scale-[0.98]"
            >
              Replace STL
            </button>
            <button
              type="button"
              onClick={() => {
                setMismatch(null)
                onClearMesh()
              }}
              title="Unload this slot's STL and its live answer — the record and the typed conditions stay."
              className="rounded-md border border-line-2 px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-panel-2 active:scale-[0.98]"
            >
              Clear model
            </button>
          </div>
          {!slot.mesh.stats.watertight.watertight && (
            <Note tone="warn">
              {slot.mesh.stats.watertight.openEdgeCount} open edges — the solver needs a closed
              hull, so this slot is not solved.
            </Note>
          )}
          {slot.mesh.scaleAdvice && (
            <Note tone="warn">
              {scaleNotice(slot.mesh.scaleAdvice, maxDim)}
              {slot.mesh.scaleAdvice.kind === 'metres' && (
                <button
                  type="button"
                  onClick={applyScale}
                  className="ml-2 rounded border border-warn/60 px-2 py-1 text-[11px] text-warn transition-colors hover:bg-warn/10 active:scale-[0.98]"
                >
                  Apply ×1000
                </button>
              )}
            </Note>
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
          {pickStatus?.busy && <Note>Parsing the picked file…</Note>}
          {pickStatus?.error && (
            <p className="mt-2 text-[11px] text-bad" role="alert">
              {pickStatus.error}
            </p>
          )}
        </div>
      ) : record !== null ? (
        <div className="mt-2">
          <p className="mb-2 text-[11px] text-ink-3">
            This record's STL is not in memory — load it to see the hull on the stage.
          </p>
          <Upload ref={uploadRef} onLoaded={handleRepick} compact />
        </div>
      ) : (
        <div className="mt-2">
          <Upload ref={uploadRef} onLoaded={handleRepick} compact prompt="Drop a hull here" />
        </div>
      )}
      {/* The re-pick gate's answer, whichever state the pick happened in: a
          "Replace STL" click with a hull already in memory can pick a foreign
          file too, and that choice must render there exactly as it does on the
          record's own empty drop zone. */}
      {mismatch && record !== null && (
        <div
          className="mt-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn"
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
              className="rounded border border-warn/60 px-2 py-1 text-[11px] text-warn transition-colors hover:bg-warn/10 active:scale-[0.98]"
            >
              Use anyway
            </button>
            <button
              type="button"
              onClick={() => setMismatch(null)}
              className="rounded border border-line-2 px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-panel-2 active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
