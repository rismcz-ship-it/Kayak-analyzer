import { useState } from 'react'
import { exportRunRecord, type RunRecord, recordFromSolve, type SlotInputs } from '../lib/compare'
import { DEFAULT_KG_MM } from '../lib/hydrostatics'
import { HEEL_MAX, HEEL_MIN, type NumericInputs, parseInputs, scaleNotice } from '../lib/inputs'
import type { SlotState } from './CompareView'
import Upload, { type LoadedMesh, rescaleMesh } from './Upload'
import { SLOT_COLORS } from './Viewer3D'

/**
 * One Compare slot's controls: the roster picker, the conditions it solves at,
 * its solve status, and the re-pick / export pair.
 *
 * The panel owns the four fields as RAW STRINGS the way App owns its form
 * (`lib/inputs.ts` — `Number('')` is 0, the historic bug), and reuses
 * `parseInputs` itself, so a slot is gated by exactly the predicate the home
 * form is. It is keyed on the record id by CompareView, so a pick remounts it
 * and the strings fall back to that record's own values without a sync effect.
 *
 * Two store-picked details:
 *
 *  - A record's numbers are FROZEN (`compare.ts`), so the slot's editable
 *    inputs live in CompareView and arrive here as `slot.inputs`.
 *  - Export captures what the slot DISPLAYS (`slot.live ?? record.result`),
 *    never the stale record a re-solved slot may have been picked from.
 */
interface SlotPanelProps {
  /** Which slot this is: the badge, its overlay colour, and its input ids. */
  label: 'A' | 'B'
  slot: SlotState
  /** The record this slot shows, or null when nothing is picked. */
  record: RunRecord | null
  roster: RunRecord[]
  onPick: (record: RunRecord) => void
  onDelete: (id: string) => void
  onInputs: (inputs: SlotInputs) => void
  /** A re-picked (or rescaled) STL for this slot. */
  onMesh: (mesh: LoadedMesh) => void
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
  roster,
  onPick,
  onDelete,
  onInputs,
  onMesh,
}: SlotPanelProps) {
  const colorIndex = label === 'A' ? 0 : 1
  const [numeric, setNumeric] = useState<NumericInputs>(() => fieldStrings(record))
  const [heelDeg, setHeelDeg] = useState(() => record?.inputs.heelDeg ?? 0)
  // The STL that does not hash to this record's, awaiting an explicit choice.
  const [mismatch, setMismatch] = useState<LoadedMesh | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const parsed = parseInputs(numeric)
  const allValid = parsed.weightKg !== null && parsed.lcgPercent !== null && parsed.kgMm !== null

  /**
   * Commit the three text fields and emit the set only when the whole set is
   * one the form's gate accepts — an intermediate "9" in the weight field must
   * never reach a solver, exactly as the home form never lets it reach its
   * Calculate button.
   */
  const commitNumeric = (patch: Partial<NumericInputs>) => {
    const next = { ...numeric, ...patch }
    setNumeric(next)
    const p = parseInputs(next)
    if (p.weightKg !== null && p.lcgPercent !== null && p.kgMm !== null) {
      onInputs({
        weightKg: p.weightKg,
        lcgPctLwl: p.lcgPercent,
        kgMm: p.kgMm,
        heelDeg,
      })
    }
  }

  /** The heel slider is bounded, so it is always a value the gate accepts. */
  const commitHeel = (value: number) => {
    setHeelDeg(value)
    const p = parseInputs(numeric)
    if (p.weightKg !== null && p.lcgPercent !== null && p.kgMm !== null) {
      onInputs({ weightKg: p.weightKg, lcgPctLwl: p.lcgPercent, kgMm: p.kgMm, heelDeg: value })
    }
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
    if (!record) return
    setExportError(null)
    // What the slot DISPLAYS. The name and the hash describe the geometry on
    // screen, which is the slot's own re-picked STL when it has one: exporting
    // the record's hash against a different hull's numbers would tag the run
    // with a model it was not solved from, and the re-import would then ask for
    // an STL that is sitting in memory right now. The result is the displayed
    // pair (`slot.live ?? record.result`); a slot with neither throws inside
    // recordFromSolve, which the catch below shows inline.
    const own = slot.mesh
    const name = own ? own.fileName : record.name
    const modelHash = own ? own.sha256Hex : record.modelHash
    try {
      const doc = exportRunRecord(
        recordFromSolve(name, modelHash, slot.inputs, slot.live ?? record.result),
      )
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = `${name}.run.json`
      link.click()
      URL.revokeObjectURL(url)
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
          {record ? record.name : 'empty slot'}
        </span>
        <button
          type="button"
          onClick={onExport}
          disabled={!record || !allValid}
          title={
            !record
              ? 'Pick a run first.'
              : !allValid
                ? 'Fix the highlighted conditions first.'
                : 'Download this run as a .run.json'
          }
          className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export
        </button>
      </div>

      {roster.length === 0 ? (
        <p className="mb-3 text-xs text-zinc-500">
          The roster is empty — import a run record (.run.json) above.
        </p>
      ) : (
        <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto pr-1">
          {roster.map((entry) => (
            <li
              key={entry.id}
              className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
                entry.id === slot.recordId
                  ? 'border-sky-700 bg-sky-950/40'
                  : 'border-zinc-800 bg-zinc-900/40'
              }`}
            >
              <button
                type="button"
                onClick={() => onPick(entry)}
                className="min-w-0 flex-1 truncate text-left text-zinc-200 hover:text-white"
                title={`${entry.name} — ${entry.modelHash}`}
              >
                {entry.name}
              </button>
              <span className="font-mono text-[10px] text-zinc-500" title={entry.modelHash}>
                {entry.modelHash.slice(0, 6)}
              </span>
              <button
                type="button"
                onClick={() => onDelete(entry.id)}
                aria-label={`Delete ${entry.name}`}
                title={`Delete ${entry.name}`}
                className="rounded px-1 text-zinc-500 hover:text-rose-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {record ? (
        <>
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
          {!slot.solving && !slot.error && slot.live && (
            <p className="mt-3 text-xs text-emerald-400">Live — solved at the conditions above.</p>
          )}
          {!slot.solving && !slot.error && !slot.live && (
            <p className="mt-3 text-xs text-zinc-500">
              Showing the saved run — edit a condition to re-solve.
            </p>
          )}

          {slot.mesh ? (
            <div className="mt-3">
              <p className="text-xs text-emerald-400" title={slot.mesh.orientNote}>
                STL in memory — {slot.mesh.fileName}
              </p>
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
            </div>
          ) : (
            <div className="mt-3">
              <p className="mb-2 text-xs text-zinc-500">
                This record's STL is not in memory — load it to see the hull in the overlay.
              </p>
              <Upload onLoaded={handleRepick} compact />
              {mismatch && (
                <div
                  className="mt-2 rounded border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-300"
                  role="note"
                >
                  <p className="mb-2">
                    This file hashes to{' '}
                    <span className="font-mono" title={mismatch.sha256Hex}>
                      {mismatch.sha256Hex === ''
                        ? 'nothing'
                        : `${mismatch.sha256Hex.slice(0, 12)}…`}
                    </span>
                    , but the record was saved from{' '}
                    <span className="font-mono" title={record.modelHash}>
                      {record.modelHash.slice(0, 12)}…
                    </span>
                    . It may be a different hull, or the same one edited — its numbers would be
                    posed on this file's geometry.
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
        </>
      ) : (
        <p className="text-xs text-zinc-500">
          Pick a run above — its conditions and its saved result load into this slot.
        </p>
      )}
    </section>
  )
}
