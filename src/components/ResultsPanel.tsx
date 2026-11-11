import type { ReactNode } from 'react'
import { fmt, signed } from '../lib/format'
import { endTipWetsBeforeVanishing, gzMarks } from '../lib/gz-marks'
import type { TrimSolveResult } from '../lib/hydrostatics'
import GzChart from './GzChart'

/**
 * One stat row: label left, value right, optional accent. Exported because
 * App's Hull section draws the same row shape — the two panels should not end
 * up with two definitions of a stat row that have drifted apart.
 */
export function statRow(label: string, value: string | ReactNode, accent = false) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`font-medium ${accent ? 'text-sky-300' : 'text-zinc-100'}`}>{value}</dd>
    </div>
  )
}

function sectionTitle(title: string) {
  return (
    <div className="flex items-center gap-2 my-2">
      <span className="h-0.5 flex-1 bg-zinc-700" />
      <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">{title}</span>
      <span className="h-0.5 flex-1 bg-zinc-700" />
    </div>
  )
}

/**
 * A presentational warning, stated under the rows that caused it. Not the
 * App-level banner style: these two describe THIS result's numbers, and the
 * warnings that are about the mesh rather than the solution stay in App.
 */
function warnBox(text: string) {
  return (
    <div
      className="my-1 rounded border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-300"
      role="note"
    >
      {text}
    </div>
  )
}

/**
 * A big magnitude in readable scientific form: 2.7896e11 reads as "2.79e11"
 * rather than the twelve-digit integer `fmt` would print. A waterplane moment
 * off a decimated mesh has nowhere near mm4 resolution, so those digits would
 * be noise pretending to be precision.
 */
function sci(value: number, digits = 3) {
  if (!Number.isFinite(value) || value === 0) return '0'
  const exp = Math.floor(Math.log10(Math.abs(value)))
  return `${(value / 10 ** exp).toFixed(digits - 1)}e${exp}`
}

/**
 * The equilibrium / form / stability readout: what one solve produced, in the
 * order a reader wants it — equilibrium, form coefficients, stability, then
 * the righting-arm curve. It renders a result and nothing else: the waterplane
 * banners, the "No results yet." line and the polite live region stay in App,
 * which owns the question of whether a result belongs on screen at all.
 *
 * Each section is its own `<dl>` so the list stays valid markup — a `dl` may
 * hold only title/value pairs, and the section titles, warnings and chart are
 * siblings around the lists rather than children of one.
 */
interface ResultsPanelProps {
  result: TrimSolveResult
}

export default function ResultsPanel({ result }: ResultsPanelProps) {
  // One scan, shared with the chart below: `gzMarks` is pure, so the warning
  // and the markers read the same angles from the same points.
  const marks = gzMarks(result.gzCurve)
  const { maxHeelDeg } = marks
  const endTip = result.endTipImmersionDeg
  // The ordering question, asked of the pure module and answered with the two
  // angles it compared: the warning below prints those, and they are non-null
  // because the rule that produced them says so — TypeScript can see that.
  const endTipFirst = endTipWetsBeforeVanishing(endTip, marks)
  return (
    <div>
      {sectionTitle('Equilibrium')}
      <dl className="space-y-1">
        {statRow('Trim', `${signed(result.trimDeg)}°`, true)}
        {statRow('Draft (center)', `${fmt(result.draftMm)} mm`)}
        {statRow('Waterline Z', `${fmt(result.waterlineZ)} mm`)}
        {statRow('Displacement', `${fmt(result.displacementKg)} kg`)}
        {statRow('Target', `${fmt(result.targetKg)} kg`)}
        {statRow('Waterplane area', `${fmt(result.waterplaneAreaMm2 / 1e6, 3)} m²`)}
        {statRow('Waterline length (LWL)', `${fmt(result.LWL)} mm`)}
        {statRow('Waterline beam (BWL)', `${fmt(result.BWL)} mm`)}
        {statRow('LCG X', `${fmt(result.lcg.x)} mm`)}
        {statRow('LCB X', `${fmt(result.lcb.x)} mm`)}
        {statRow('LCB–LCG offset', `${fmt(result.lcbLcgOffsetMm)} mm`, true)}
        {statRow('Bow freeboard', `${fmt(result.bowFreeboardMm)} mm`)}
        {statRow('Stern freeboard', `${fmt(result.sternFreeboardMm)} mm`)}
        {result.heelDeg !== 0 && statRow('Fixed heel angle', `${signed(result.heelDeg)}°`, true)}
        {statRow(
          'Converged',
          result.converged
            ? `yes (${result.planesEvaluated} planes)`
            : `approx (${result.planesEvaluated} planes)`,
        )}
      </dl>

      {sectionTitle('Form Coefficients')}
      <dl className="space-y-1">
        {statRow('Block Coeff (Cb)', fmt(result.Cb, 4))}
        {statRow('Prismatic Coeff (Cp)', fmt(result.Cp, 4))}
        {statRow('Midship Coeff (Cm)', fmt(result.Cm, 4))}
        {statRow('Waterplane Coeff (Cwp)', fmt(result.Cwp, 4))}
        {statRow('Wetted surface area', `${fmt(result.wettedSurfaceAreaMm2)} mm²`)}
        {/*
         * LCF, like the LCB/LCG pair above it, is a hull-frame X — the mesh is
         * centred on its bounding box at upload, so this is measured from that
         * centre and NOT from the waterplane's amidships. Label it as its
         * neighbours are labelled rather than claiming an origin it does not
         * have; the sign is printed because the direction is the point.
         */}
        {statRow('LCF X', `${signed(result.waterplaneCentroidX)} mm`)}
        {statRow('Tonnes per cm immersion (fresh water)', fmt(result.tpcTonnesPerCm, 4))}
      </dl>

      {sectionTitle('Stability')}
      <dl className="space-y-1">
        {statRow('KB (Keel→Buoyancy)', `${fmt(result.KB)} mm`)}
        {statRow('BM (Metacentric Radius)', `${fmt(result.BM)} mm`)}
        {statRow('KM (Keel→Metacenter)', `${fmt(result.KM)} mm`, true)}
        {statRow('KG (Keel→Gravity)', `${fmt(result.kgMm)} mm`)}
        {statRow('GM (Metacentric Height)', `${fmt(result.GM)} mm`, true)}
        {statRow(
          'Waterplane longitudinal second moment (I_y)',
          `${sci(result.waterplaneIyyMm4)} mm⁴`,
        )}
        {/*
         * The stem-tip immersion angle with its caveats on screen instead of in
         * a tooltip: what goes under is the stem TIP, not the deck edge; the
         * angle is interpolated between the 5° samples of the curve below; and
         * it is measured on the UPRIGHT, untrimmed hull — while the rows above
         * it are the trimmed solve's, so the two must not be read as one
         * condition. The caveat is carried inside the row's own value so it
         * stays valid inside a `<dl>` and stays next to the number it
         * qualifies.
         */}
        {statRow(
          'End-tip immersion ≈',
          <span>
            <span className="block">
              {endTip === null ? `not reached within ${fmt(maxHeelDeg)}°` : `${fmt(endTip)}°`}
            </span>
            <span className="block text-[10px] font-normal leading-snug text-zinc-500">
              {endTip === null
                ? 'no stem tip reaches the water at any sampled angle (upright, untrimmed hull)'
                : 'stem-tip clearance reaches 0 mm on the upright, untrimmed curve; ' +
                  'interpolated between its 5° samples'}
            </span>
          </span>,
          true,
        )}
      </dl>
      {result.GM < 100 &&
        warnBox(
          result.GM < 0
            ? `Negative GM ${fmt(result.GM)} mm — the hull does not right itself from upright.`
            : result.GM === 0
              ? `GM is 0 mm — neutrally stable: the hull holds upright but ` +
                'has no righting arm to return to.'
              : `Low initial stability — GM ${fmt(result.GM)} mm is under 100 mm.`,
        )}
      {/*
       * The ORDERING of the two angles, not merely their existence, and it is
       * asked of the pure module so the suite can assert it. This branch was
       * the cross-review's BLOCKER: it fired whenever both numbers existed,
       * so a hull whose end stayed dry well past its vanishing angle was
       * still told "an end immerses before the vanishing angle".
       */}
      {endTipFirst !== null &&
        warnBox(
          `An end immerses at ${fmt(endTipFirst.endTipDeg)}°, before the ` +
            `${fmt(endTipFirst.avsDeg)}° vanishing angle — the stem tip is ` +
            'at the waterline while the hull still has a righting arm to lose.',
        )}

      {sectionTitle('Righting Arm (GZ)')}
      <GzChart
        curve={result.gzCurve}
        marks={marks}
        currentHeelDeg={result.heelDeg}
        endTipImmersionDeg={endTip}
        gmMm={result.GM}
      />
    </div>
  )
}
