import type { ReactNode } from 'react'
import { fmt } from '../lib/format'
import type { ScaleAdvice } from '../lib/geometry'
import { HEEL_MAX, HEEL_MIN, type InputFields, type ParsedInputs, scaleNotice } from '../lib/inputs'
import { MAX_TRIM_DEG, TRIM_STEP_DEG } from '../lib/solve-params'
import Switch from './Switch'

interface ConditionsPanelProps {
  inputs: InputFields
  parsed: ParsedInputs
  onChange: (patch: Partial<InputFields>) => void
  onCalculate: () => void
  onCancel: () => void
  isCalculating: boolean
  progress: { done: number; total: number } | null
  canCalculate: boolean
  hasMesh: boolean
  watertight: boolean
  openEdgeCount: number
  draftError: string | null
  weightOverCapacity: string | null
  kgAboveDeck: string | null
  scaleAdvice: ScaleAdvice | undefined
  maxDim: number
  onApplyScale: () => void
  children: ReactNode
}

interface FieldProps {
  id: string
  label: string
  unit: string
  value: string
  error: string | null
  onChange: (value: string) => void
}

function Field({ id, label, unit, value, error, onChange }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-ink-2">
        {label}
      </label>
      <div
        className={`flex h-8 items-center gap-1 rounded-md border bg-panel px-2 transition-colors ${
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
          className="w-full min-w-0 bg-transparent p-0 font-mono text-[13px] tabular-nums text-ink outline-none"
        />
        <span className="text-[11px] text-ink-3">{unit}</span>
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
  children: ReactNode
}) {
  const color = tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-ink-3'
  return (
    <p className={`mt-2 flex items-start gap-2 text-[11px] leading-snug ${color}`}>
      <i className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-current" />
      <span>{children}</span>
    </p>
  )
}

/**
 * The right-hand column: the three conditions, the one action that solves
 * them, and — through `children` — the results the solve produced.
 *
 * The column itself does not scroll. The conditions sit in a fixed band at the
 * top and the results own their own scroll area, so the "All values" control
 * can be a real footer: pinned to the bottom edge of the panel, with nothing
 * able to slide underneath it.
 */
export default function ConditionsPanel({
  inputs,
  parsed,
  onChange,
  onCalculate,
  onCancel,
  isCalculating,
  progress,
  canCalculate,
  hasMesh,
  watertight,
  openEdgeCount,
  draftError,
  weightOverCapacity,
  kgAboveDeck,
  scaleAdvice,
  maxDim,
  onApplyScale,
  children,
}: ConditionsPanelProps) {
  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col border-line bg-page lg:w-[420px] lg:flex-none lg:border-l">
      <div className="max-h-[55%] shrink-0 overflow-y-auto px-5 pb-4 pt-4">
        <p className="mb-2 text-[11px] font-medium text-ink-3">Conditions</p>

        <div className="grid grid-cols-3 gap-2">
          <Field
            id="target-weight"
            label="Target weight"
            unit="kg"
            value={inputs.weightInput}
            error={parsed.weightError}
            onChange={(weightInput) => onChange({ weightInput })}
          />
          <Field
            id="target-lcg"
            label="LCG from bow"
            unit="%"
            value={inputs.lcgInput}
            error={parsed.lcgError}
            onChange={(lcgInput) => onChange({ lcgInput })}
          />
          <Field
            id="target-kg"
            label="KG above keel"
            unit="mm"
            value={inputs.kgInput}
            error={parsed.kgError}
            onChange={(kgInput) => onChange({ kgInput })}
          />
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={inputs.showHeelInput}
            onClick={() => onChange({ showHeelInput: !inputs.showHeelInput })}
            className="flex items-center gap-2 text-[13px] text-ink-2 transition-colors hover:text-ink"
          >
            <Switch checked={inputs.showHeelInput} />
            <span>Fixed heel</span>
          </button>

          <button
            type="button"
            onClick={onCalculate}
            disabled={!canCalculate}
            className="ml-auto h-8 rounded-md bg-accent-500 px-4 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:border disabled:border-line-2 disabled:bg-panel-2 disabled:text-ink-3"
          >
            {isCalculating ? 'Calculating…' : 'Calculate'}
          </button>
        </div>

        {inputs.showHeelInput && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input
                id="heel-input"
                type="range"
                min={HEEL_MIN}
                max={HEEL_MAX}
                step={1}
                value={inputs.heelDeg}
                onChange={(e) => onChange({ heelDeg: Number(e.target.value) })}
                aria-label="Fixed heel angle in degrees"
                className="h-4 flex-1 accent-accent-500"
              />
              <output
                htmlFor="heel-input"
                className="min-w-8 text-right font-mono text-[13px] tabular-nums text-ink-2"
                title="+ = the −Y side goes down"
              >
                {inputs.heelDeg > 0 ? `+${inputs.heelDeg}` : inputs.heelDeg}°
              </output>
            </div>
          </div>
        )}

        {!hasMesh && <Note>Load an STL hull to enable the solve.</Note>}
        {hasMesh && !watertight && (
          <Note tone="warn">
            {openEdgeCount} open edges — the solver needs a closed hull, so Calculate is disabled.
          </Note>
        )}
        {scaleAdvice && (
          <Note tone="warn">
            {scaleNotice(scaleAdvice, maxDim)}
            {scaleAdvice.kind === 'metres' && (
              <button
                type="button"
                onClick={onApplyScale}
                className="ml-2 rounded border border-warn/60 px-2 py-0.5 text-[11px] text-warn transition-colors hover:bg-warn/10"
              >
                Apply ×1000
              </button>
            )}
          </Note>
        )}
        {weightOverCapacity && <Note tone="warn">{weightOverCapacity}</Note>}
        {kgAboveDeck && <Note tone="warn">{kgAboveDeck}</Note>}
        {draftError && <Note tone="bad">{draftError}</Note>}

        {isCalculating && (
          <div className="mt-3">
            <div className="h-1 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-accent-500 transition-[width] duration-150"
                style={{
                  width:
                    progress && progress.total > 0
                      ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`
                      : '4%',
                }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-3">
              <span role="status" aria-live="polite" className="font-mono tabular-nums">
                {progress ? `angle ${progress.done} / ${progress.total}` : 'starting solver…'}
              </span>
              <span className="hidden font-mono tabular-nums sm:inline">
                sweeping ±{fmt(MAX_TRIM_DEG)}° at {fmt(TRIM_STEP_DEG)}°
              </span>
              <button
                type="button"
                onClick={onCancel}
                className="rounded border border-line-2 px-2 py-0.5 text-[11px] text-ink-2 transition-colors hover:bg-panel hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mx-5 h-px shrink-0 bg-line" />

      {/*
        The results own their own scroll area and their own footer, so this
        column does not scroll as a whole: the conditions stay put at the top
        and the "All values" bar stays put at the bottom.
      */}
      {children}
    </aside>
  )
}
