import { conditionsDiffer, type SlotInputs } from '../lib/compare'
import { fmt, signed } from '../lib/format'
import { type GzMarks, gzMarks } from '../lib/gz-marks'
import type { TrimSolveResult } from '../lib/hydrostatics'
import { SLOT_COLORS } from './Viewer3D'

/**
 * One column of the comparison: the record a slot shows, what it displays
 * (`live ?? record.result`), and the conditions THAT PAIR was produced at.
 *
 * `inputs` is deliberately not the slot's editable conditions: an edit moves
 * those without invalidating the answer on screen, so the note - and anything
 * else that puts numbers next to conditions - must read the ones the
 * DISPLAYED result answers to, never the ones being typed into the fields.
 */
export interface CompareColumn {
  /**
   * What the header calls this column: the record's name, or a fresh hull's
   * file name when the slot was loaded straight from an STL. null = the slot
   * is empty.
   */
  name: string | null
  result: TrimSolveResult | null
  /**
   * The conditions the displayed result was produced at; null when the slot
   * is empty.
   */
  inputs: SlotInputs | null
  /**
   * A re-solve is in flight: the numbers on screen still answer to the
   * previous conditions, and the column header says so rather than letting
   * the delta imply they are the current ones.
   */
  stale: boolean
}

interface CompareTableProps {
  a: CompareColumn
  b: CompareColumn
}

/** One metric row: the same number read off each result, plus A − B. */
interface MetricRow {
  label: string
  a: string
  b: string
  /** Formatted `A − B` in that row's own units; null when a delta means nothing. */
  delta: string | null
}

interface Section {
  title: string
  rows: MetricRow[]
}

/**
 * The rows of the table, in the order `ResultsPanel` reads a single result:
 * equilibrium, form, stability.
 *
 * Deliberately NOT every row of that panel. Five diagnostics (waterplane area,
 * midship area, wetted surface, waterplane second moment, loop count) are
 * fields an IMPORTED record fills with neutral zeros — the run-record format
 * does not carry them — so a row for one would show a live hull's real number
 * beside an imported record's 0 and call that a difference. Every row here sits
 * inside the set the format carries, which is the rule
 * `parseRunRecordImport` documents.
 *
 * `LCG X` and `LCB X` are IN, and `Waterline Z` stays out: both meshes are
 * centred on their own bounding box at upload (`Upload.tsx`), so each X is
 * that centre's distance from the hull's own midpoint - the same datum
 * `ResultsPanel` documents for the single hull, and comparable the way the
 * draft row is. `Waterline Z` is a height above each hull's own keel, and two
 * keels are not one datum.
 */
function buildSections(a: TrimSolveResult, b: TrimSolveResult, aMarks: GzMarks, bMarks: GzMarks) {
  const metric = (label: string, pick: (r: TrimSolveResult) => number, unit = '', digits = 1) => ({
    label,
    a: `${fmt(pick(a), digits)}${unit}`,
    b: `${fmt(pick(b), digits)}${unit}`,
    delta: `${signed(pick(a) - pick(b), digits)}${unit}`,
  })

  const gzRow: MetricRow = {
    label: 'GZ peak',
    a: aMarks.gzMax ? `${fmt(aMarks.gzMax.GZ)} mm @ ${fmt(aMarks.gzMax.heelDeg)}°` : '—',
    b: bMarks.gzMax ? `${fmt(bMarks.gzMax.GZ)} mm @ ${fmt(bMarks.gzMax.heelDeg)}°` : '—',
    delta: aMarks.gzMax && bMarks.gzMax ? `${signed(aMarks.gzMax.GZ - bMarks.gzMax.GZ)} mm` : null,
  }

  const avsRow: MetricRow = {
    label: 'Angle of vanishing stability',
    a: aMarks.avsDeg === null ? `not within ${fmt(aMarks.maxHeelDeg)}°` : `${fmt(aMarks.avsDeg)}°`,
    b: bMarks.avsDeg === null ? `not within ${fmt(bMarks.maxHeelDeg)}°` : `${fmt(bMarks.avsDeg)}°`,
    delta:
      aMarks.avsDeg !== null && bMarks.avsDeg !== null
        ? `${signed(aMarks.avsDeg - bMarks.avsDeg)}°`
        : null,
  }

  // A non-converged sweep's numbers are a best estimate. The row marks them
  // as such instead of letting them sit beside a settled run's in every other
  // row and in the delta. Both fields are carried by the run-record format, so
  // an imported record shows its own answer, not a live hull's.
  const convergedRow: MetricRow = {
    label: 'Converged',
    a: a.converged ? `yes (${a.planesEvaluated} planes)` : `approx (${a.planesEvaluated} planes)`,
    b: b.converged ? `yes (${b.planesEvaluated} planes)` : `approx (${b.planesEvaluated} planes)`,
    delta: null,
  }

  const sections: Section[] = [
    {
      title: 'Equilibrium',
      rows: [
        metric('Draft (center)', (r) => r.draftMm, ' mm'),
        metric('Trim', (r) => r.trimDeg, '°', 2),
        metric('Displacement', (r) => r.displacementKg, ' kg'),
        metric('Waterline length (LWL)', (r) => r.LWL, ' mm'),
        metric('Waterline beam (BWL)', (r) => r.BWL, ' mm'),
        metric('LCG X', (r) => r.lcg.x, ' mm'),
        metric('LCB X', (r) => r.lcb.x, ' mm'),
        metric('LCB–LCG offset', (r) => r.lcbLcgOffsetMm, ' mm'),
        metric('Bow freeboard', (r) => r.bowFreeboardMm, ' mm'),
        metric('Stern freeboard', (r) => r.sternFreeboardMm, ' mm'),
        convergedRow,
      ],
    },
    {
      title: 'Form Coefficients',
      rows: [
        metric('Block Coeff (Cb)', (r) => r.Cb, '', 4),
        metric('Prismatic Coeff (Cp)', (r) => r.Cp, '', 4),
        metric('Midship Coeff (Cm)', (r) => r.Cm, '', 4),
        metric('Waterplane Coeff (Cwp)', (r) => r.Cwp, '', 4),
        metric('Tonnes per cm immersion', (r) => r.tpcTonnesPerCm, '', 4),
      ],
    },
    {
      title: 'Stability',
      rows: [
        metric('KB (Keel→Buoyancy)', (r) => r.KB, ' mm'),
        metric('BM (Metacentric radius)', (r) => r.BM, ' mm'),
        metric('KM (Keel→Metacenter)', (r) => r.KM, ' mm'),
        metric('KG (Keel→Gravity)', (r) => r.kgMm, ' mm'),
        metric('GM (Metacentric height)', (r) => r.GM, ' mm'),
        gzRow,
        avsRow,
      ],
    },
  ]
  return sections
}

const columnStyle = (index: 0 | 1) => ({
  color: `#${SLOT_COLORS[index].toString(16).padStart(6, '0')}`,
})

export default function CompareTable({ a, b }: CompareTableProps) {
  const aMarks = a.result ? gzMarks(a.result.gzCurve) : null
  const bMarks = b.result ? gzMarks(b.result.gzCurve) : null
  const both = a.result !== null && b.result !== null && aMarks !== null && bMarks !== null
  const sections =
    a.result && b.result && aMarks && bMarks
      ? buildSections(a.result, b.result, aMarks, bMarks)
      : []

  // A visible note, not an error: the two runs may legitimately be at
  // different conditions (that is often WHY they are being compared), but the
  // numbers then describe different loadings, not one comparison. It reads the
  // conditions the DISPLAYED results were produced at, so an edit that has not
  // re-solved yet raises no false difference - and two columns really were
  // solved differently says so.
  const conditions = a.inputs && b.inputs ? conditionsDiffer(a.inputs, b.inputs) : []

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-zinc-200">Comparison</h2>
      {!both && (
        <p className="mb-2 text-xs text-zinc-500">Both slots need a run with numbers to compare.</p>
      )}
      {conditions.length > 0 && (
        <p
          className="mb-3 rounded border border-zinc-700 bg-zinc-800/50 p-2 text-xs text-zinc-400"
          role="note"
        >
          Different conditions: {conditions.join(', ')} — the runs are not directly comparable.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-zinc-400">
            <th scope="col" className="py-1 text-left font-medium">
              Metric
            </th>
            <th scope="col" className="py-1 text-right font-medium" style={columnStyle(0)}>
              A ·{' '}
              <span className="font-normal text-zinc-400">
                {a.name ?? 'empty'}
                {a.stale ? ' (re-solving)' : ''}
              </span>
            </th>
            <th scope="col" className="py-1 text-right font-medium" style={columnStyle(1)}>
              B ·{' '}
              <span className="font-normal text-zinc-400">
                {b.name ?? 'empty'}
                {b.stale ? ' (re-solving)' : ''}
              </span>
            </th>
            <th scope="col" className="py-1 text-right font-medium text-zinc-400">
              Δ (A − B)
            </th>
          </tr>
        </thead>
        {sections.map((section) => (
          <tbody key={section.title}>
            <tr>
              <th
                scope="colgroup"
                colSpan={4}
                className="pt-3 pb-1 text-left text-xs font-semibold uppercase tracking-wider text-zinc-300"
              >
                {section.title}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label} className="border-t border-zinc-800/60">
                <th scope="row" className="py-1 pr-2 text-left font-normal text-zinc-400">
                  {row.label}
                </th>
                <td className="py-1 text-right font-mono text-zinc-100">{row.a}</td>
                <td className="py-1 text-right font-mono text-zinc-100">{row.b}</td>
                <td className="py-1 text-right font-mono text-sky-300">{row.delta ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  )
}
