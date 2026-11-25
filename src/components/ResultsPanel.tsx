import { type ReactNode, useEffect, useState } from 'react'
import { fmt, signed } from '../lib/format'
import { endTipWetsBeforeVanishing, gzMarks } from '../lib/gz-marks'
import type { TrimSolveResult } from '../lib/hydrostatics'
import GzChart from './GzChart'
import type { LoadedMesh } from './Upload'

interface ResultsPanelProps {
  result: TrimSolveResult | null
  mesh: LoadedMesh | null
  /** A solve is in flight: the numbers on screen would be stale, so show dashes. */
  solving: boolean
}

/**
 * A big magnitude in readable scientific form: 2.7896e11 reads as "2.79e11"
 * rather than the twelve-digit integer `fmt` would print. A waterplane moment
 * off a decimated mesh has nowhere near mm⁴ resolution, so those digits would
 * be noise pretending to be precision.
 */
function sci(value: number, digits = 3) {
  if (!Number.isFinite(value) || value === 0) return '0'
  const exp = Math.floor(Math.log10(Math.abs(value)))
  return `${(value / 10 ** exp).toFixed(digits - 1)}e${exp}`
}

interface KeyProps {
  label: string
  value: string
  unit?: string
  note?: string
  noteTone?: 'good' | 'warn' | 'bad'
  size?: 'lead' | 'sub'
}

function Key({ label, value, unit, note, noteTone = 'good', size = 'lead' }: KeyProps) {
  const tone = noteTone === 'warn' ? 'text-warn' : noteTone === 'bad' ? 'text-bad' : 'text-good'
  return (
    <div className="min-w-0">
      <span className="block text-[11px] text-ink-3">{label}</span>
      <span
        className={`mt-1 block whitespace-nowrap font-mono font-medium tabular-nums ${
          size === 'lead'
            ? 'text-2xl leading-[1.15] tracking-[-0.02em]'
            : 'text-base leading-tight tracking-[-0.01em]'
        } ${value === '—' ? 'text-ink-3' : ''}`}
      >
        {value}
        {unit && (
          <small className="ml-1 text-[11px] font-normal tracking-normal text-ink-3">{unit}</small>
        )}
      </span>
      {note && <span className={`mt-1 block text-[11px] ${tone}`}>{note}</span>}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] font-medium text-ink-3">{title}</p>
      <dl className="grid gap-1">{children}</dl>
    </div>
  )
}

function Row({
  label,
  value,
  accent = false,
}: {
  label: string
  value: ReactNode
  accent?: boolean
}) {
  return (
    <div className="flex items-baseline gap-3 text-[13px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className={`ml-auto font-mono tabular-nums ${accent ? 'text-accent-300' : 'text-ink'}`}>
        {value}
      </dd>
    </div>
  )
}

function Note({ tone = 'warn', children }: { tone?: 'warn' | 'bad'; children: ReactNode }) {
  return (
    <p
      className={`mt-2 flex items-start gap-2 text-[11px] leading-snug ${
        tone === 'bad' ? 'text-bad' : 'text-warn'
      }`}
    >
      <i className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-current" />
      <span>{children}</span>
    </p>
  )
}

/**
 * The empty chart keeps the panel's shape stable before a solve: axes, no
 * curve. It is a placeholder, not a result, so it carries no numbers.
 */
function EmptyChart() {
  return (
    <div className="relative h-[150px] rounded-lg border border-dashed border-line-2 bg-white/[0.01]">
      <span className="absolute left-3 top-2 text-[11px] text-ink-3">GZ (mm)</span>
      <div className="absolute inset-x-3 bottom-2 flex justify-between border-t border-line-2 pt-1 text-[11px] text-ink-3">
        <span>0</span>
        <span>15°</span>
        <span>30°</span>
        <span>45°</span>
      </div>
    </div>
  )
}

/**
 * The readout: three numbers a reader wants first, three that qualify them,
 * the balance the Compare tab exists for, then the righting-arm curve. The
 * full solve is one toggle away, grouped as a receipt.
 *
 * Every number is `—` when there is no current result. While a solve is in
 * flight the previous numbers are withheld rather than shown as if they
 * answered the conditions now on screen.
 */
export default function ResultsPanel({ result, mesh, solving }: ResultsPanelProps) {
  const shown = solving ? null : result
  const [showAll, setShowAll] = useState(false)

  // A new hull clears the result; an open receipt with nothing to receipt
  // would be an empty state pretending to be a panel.
  useEffect(() => {
    if (!result) setShowAll(false)
  }, [result])

  const marks = shown ? gzMarks(shown.gzCurve) : null
  const endTip = shown?.endTipImmersionDeg ?? null
  const endTipFirst =
    shown && marks ? endTipWetsBeforeVanishing(shown.endTipImmersionDeg, marks) : null

  const trimNote = shown
    ? Math.abs(shown.trimDeg) < 0.05
      ? 'level'
      : shown.trimDeg > 0
        ? 'bow up'
        : 'bow down'
    : undefined
  const gmNote = shown
    ? shown.GM >= 100
      ? 'stable'
      : shown.GM >= 0
        ? 'low'
        : 'negative'
    : undefined
  const gmTone = shown ? (shown.GM >= 100 ? 'good' : shown.GM >= 0 ? 'warn' : 'bad') : 'good'

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid grid-cols-3 gap-3 border-b border-line pb-4">
        <Key
          label="Draft"
          value={shown ? fmt(shown.draftMm) : '—'}
          unit="mm"
          note={shown ? 'at midship' : undefined}
        />
        <Key label="Trim" value={shown ? signed(shown.trimDeg) : '—'} unit="°" note={trimNote} />
        <Key
          label="GM"
          value={shown ? fmt(shown.GM) : '—'}
          unit="mm"
          note={gmNote}
          noteTone={gmTone}
        />
      </div>

      <div className="grid grid-cols-3 gap-3 pt-4">
        <Key label="Waterline length" value={shown ? fmt(shown.LWL) : '—'} unit="mm" size="sub" />
        <Key
          label="Bow freeboard"
          value={shown ? fmt(shown.bowFreeboardMm) : '—'}
          unit="mm"
          size="sub"
        />
        <Key
          label="Stern freeboard"
          value={shown ? fmt(shown.sternFreeboardMm) : '—'}
          unit="mm"
          size="sub"
        />
      </div>

      {shown && (
        <>
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-3">
            <span className="text-[11px] text-ink-3">LCB − LCG offset</span>
            <span className="font-mono text-base tabular-nums text-accent-300">
              {fmt(shown.lcbLcgOffsetMm)} mm
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-3">
            The longitudinal balance of this pose — the number Compare compares.
          </p>

          {shown.GM < 100 && (
            <Note tone={shown.GM < 0 ? 'bad' : 'warn'}>
              {shown.GM < 0
                ? `Negative GM ${fmt(shown.GM)} mm — the hull does not right itself from upright.`
                : shown.GM === 0
                  ? 'GM is 0 mm — neutrally stable: the hull holds upright but has no righting arm to return to.'
                  : `Low initial stability — GM ${fmt(shown.GM)} mm is under 100 mm.`}
            </Note>
          )}
          {endTipFirst !== null && (
            <Note>
              An end immerses at {fmt(endTipFirst.endTipDeg)}°, before the {fmt(endTipFirst.avsDeg)}
              ° vanishing angle — the stem tip is at the waterline while the hull still has a
              righting arm to lose.
            </Note>
          )}
          {shown.waterplaneLoopCount !== 1 && (
            <Note>
              {shown.waterplaneLoopCount === 0
                ? 'no closed waterplane contour at this waterline — its area and Ix are 0, so BM is 0 and GM reads KB − KG.'
                : `waterplane contour split into ${shown.waterplaneLoopCount} loops — BM and GM assume a single closed waterplane, so treat them as unreliable. A genuinely two-lobed waterplane (twin hull, tunnel) does this legitimately.`}
            </Note>
          )}
        </>
      )}

      <div className="mt-4">
        <div className="mb-2 flex items-baseline gap-2">
          <p className="text-[11px] font-medium text-ink-3">Righting arm (GZ)</p>
          {marks && (
            <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">
              {marks.avsDeg !== null
                ? `AVS ${fmt(marks.avsDeg)}°`
                : `no AVS within ${fmt(marks.maxHeelDeg)}°`}
            </span>
          )}
        </div>
        {shown && marks ? (
          <GzChart
            curve={shown.gzCurve}
            marks={marks}
            currentHeelDeg={shown.heelDeg}
            endTipImmersionDeg={shown.endTipImmersionDeg}
            gmMm={shown.GM}
          />
        ) : (
          <EmptyChart />
        )}
      </div>

      <div className="mt-auto" />
      {/*
        A button, not a switch. The switch used to sit flush against the panel's
        right edge, where the panel's own border and the scrollbar lane clip it —
        the control was visible but its hit area fell outside the panel, so the
        second click (to close the receipt) never landed. A plain text button
        carries the whole label as its target and states its own state, so it
        cannot be half-out of reach.

        Sticky, not merely last: the panel scrolls, and a control at the end of
        the content is below the fold whenever the results are tall. Pinned to
        the scrollport's bottom it is always reachable, and the expanded receipt
        (which follows it in flow) scrolls up beneath the opaque bar. `mt-auto`
        still parks it at the foot when the content is shorter than the panel.
      */}
      <button
        type="button"
        onClick={() => setShowAll((open) => !open)}
        disabled={!shown}
        aria-expanded={showAll}
        className="sticky bottom-0 z-10 mt-4 flex w-full items-center gap-2 border-t border-line bg-page pb-1 pt-3 text-left text-[13px] text-ink-2 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="font-medium text-ink">{showAll ? 'Hide values' : 'All values'}</span>
        <span
          aria-hidden="true"
          className={`ml-auto text-[11px] transition-transform ${showAll ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {showAll && shown && (
        <div>
          {mesh && (
            <>
              <Group title="Hull">
                <Row label="Length (X)" value={`${fmt(mesh.stats.bounds.size.x)} mm`} />
                <Row label="Beam (Y)" value={`${fmt(mesh.stats.bounds.size.y)} mm`} />
                <Row label="Depth (Z)" value={`${fmt(mesh.stats.bounds.size.z)} mm`} />
                <Row label="Volume" value={`${fmt(mesh.stats.volumeLiters)} L`} accent />
                <Row
                  label="Watertight"
                  value={
                    mesh.stats.watertight.watertight
                      ? 'yes'
                      : `${mesh.stats.watertight.openEdgeCount} open edges`
                  }
                />
              </Group>
              <p className="mt-2 text-[11px] leading-snug text-ink-3" title={mesh.orientNote}>
                {mesh.orientNote}
              </p>
            </>
          )}

          <Group title="Equilibrium">
            <Row label="Displacement" value={`${fmt(shown.displacementKg)} kg`} />
            <Row label="Target" value={`${fmt(shown.targetKg)} kg`} />
            <Row label="Waterplane area" value={`${fmt(shown.waterplaneAreaMm2 / 1e6, 3)} m²`} />
            <Row label="Waterline length (LWL)" value={`${fmt(shown.LWL)} mm`} />
            <Row label="Waterline beam (BWL)" value={`${fmt(shown.BWL)} mm`} />
            <Row label="Waterline Z" value={`${fmt(shown.waterlineZ)} mm`} />
            <Row label="LCG X" value={`${signed(shown.lcg.x)} mm`} />
            <Row label="LCB X" value={`${signed(shown.lcb.x)} mm`} />
            <Row label="LCF X" value={`${signed(shown.waterplaneCentroidX)} mm`} />
            <Row label="Tonnes per cm immersion" value={fmt(shown.tpcTonnesPerCm, 4)} />
            <Row
              label="Converged"
              value={
                shown.converged
                  ? `yes (${shown.planesEvaluated} planes)`
                  : `approx (${shown.planesEvaluated} planes)`
              }
            />
            {shown.heelDeg !== 0 && (
              <Row label="Fixed heel angle" value={`${signed(shown.heelDeg)}°`} accent />
            )}
          </Group>

          <Group title="Form coefficients">
            <Row label="Block (Cb)" value={fmt(shown.Cb, 4)} />
            <Row label="Prismatic (Cp)" value={fmt(shown.Cp, 4)} />
            <Row label="Midship (Cm)" value={fmt(shown.Cm, 4)} />
            <Row label="Waterplane (Cwp)" value={fmt(shown.Cwp, 4)} />
            <Row
              label="Wetted surface area"
              value={`${fmt(shown.wettedSurfaceAreaMm2 / 1e6, 3)} m²`}
            />
          </Group>

          <Group title="Stability">
            <Row label="KB (keel→buoyancy)" value={`${fmt(shown.KB)} mm`} />
            <Row label="BM (metacentric radius)" value={`${fmt(shown.BM)} mm`} />
            <Row label="KM (keel→metacenter)" value={`${fmt(shown.KM)} mm`} />
            <Row label="KG (keel→gravity)" value={`${fmt(shown.kgMm)} mm`} />
            <Row label="GM (metacentric height)" value={`${fmt(shown.GM)} mm`} accent />
            <Row
              label="Waterplane I_y (longitudinal)"
              value={`${sci(shown.waterplaneIyyMm4)} mm⁴`}
            />
            <Row
              label="End-tip immersion ≈"
              value={
                endTip === null
                  ? `not reached within ${fmt(marks?.maxHeelDeg ?? 0)}°`
                  : `${fmt(endTip)}°`
              }
            />
          </Group>
          <p className="mt-2 text-[11px] leading-snug text-ink-3">
            End-tip immersion is the stem tip on the upright, untrimmed hull, interpolated between
            the GZ curve's 5° samples.
          </p>
          <p className="mt-2 text-[11px] leading-snug text-ink-3">
            X values are measured from the mesh centre; the LCB−LCG offset above is the residual of
            the trim solve, measured in the posed frame.
          </p>
        </div>
      )}
    </div>
  )
}
