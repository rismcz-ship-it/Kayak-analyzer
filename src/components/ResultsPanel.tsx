import type { ReactNode } from 'react'
import { fmt } from '../lib/format'
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
 * The equilibrium / form / stability readout, moved out of App unchanged —
 * same rows, same order, same formatting and units, and the GZ chart at the
 * bottom. It renders a result and nothing else: the waterplane banners, the
 * "No results yet." line and the polite live region stay in App, which owns
 * the question of whether a result belongs on screen at all.
 */
interface ResultsPanelProps {
  result: TrimSolveResult
}

export default function ResultsPanel({ result }: ResultsPanelProps) {
  return (
    <dl className="space-y-1">
      {sectionTitle('Equilibrium')}
      {statRow('Trim', `${result.trimDeg >= 0 ? '+' : ''}${fmt(result.trimDeg)}°`, true)}
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
      {result.heelDeg !== 0 &&
        statRow(
          'Fixed heel angle',
          `${result.heelDeg >= 0 ? '+' : ''}${fmt(result.heelDeg)}°`,
          true,
        )}
      {statRow(
        'Converged',
        result.converged
          ? `yes (${result.planesEvaluated} planes)`
          : `approx (${result.planesEvaluated} planes)`,
      )}

      {sectionTitle('Form Coefficients')}
      {statRow('Block Coeff (Cb)', fmt(result.Cb, 4))}
      {statRow('Prismatic Coeff (Cp)', fmt(result.Cp, 4))}
      {statRow('Midship Coeff (Cm)', fmt(result.Cm, 4))}

      {sectionTitle('Stability')}
      {statRow('KB (Keel→Buoyancy)', `${fmt(result.KB)} mm`)}
      {statRow('BM (Metacentric Radius)', `${fmt(result.BM)} mm`)}
      {statRow('KM (Keel→Metacenter)', `${fmt(result.KM)} mm`, true)}
      {statRow('KG (Keel→Gravity)', `${fmt(result.kgMm)} mm`)}
      {statRow('GM (Metacentric Height)', `${fmt(result.GM)} mm`, true)}

      {sectionTitle('Righting Arm (GZ)')}
      <GzChart curve={result.gzCurve} />
    </dl>
  )
}
