import { avsCellText, type SlotInputs } from '../lib/compare'
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
   * This column's answer is out of date with its own conditions: a re-solve
   * is in flight, or the conditions have moved on and the new solve has not
   * answered yet (the ~300 ms debounce, and the frame before the solver even
   * starts). Either way the numbers on screen still answer to the PREVIOUS
   * conditions, and the header says so rather than letting the delta imply
   * they are the current ones.
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
 * midship area, wetted surface, waterplane second moment, loop count) are not
 * shown: they are derived quantities the comparison does not need, and leaving
 * them out keeps one row set that fits on a phone-width screen without
 * collapsing the table into a scroll.
 *
 * `LCG X` and `LCB X` are IN, and `Waterline Z` stays out: both meshes are
 * centred on their own bounding box at upload (`Upload.tsx`), so each X is
 * that centre's distance from the hull's own midpoint - the same datum
 * `ResultsPanel` documents for the single hull, and comparable the way the
 * draft row is. `Waterline Z` is a height above each hull's own keel, and two
 * keels are not one datum.
 *
 * A slot with no run yet is a NULL column, not a missing section: the Compare
 * slots compute on their own (a hull that is loaded solves itself), so a single
 * hull's numbers are worth reading while the other slot is still empty - its
 * column and every delta wait for the second run. The caller only asks for
 * sections when at least one of the two has one.
 */
function buildSections(
  a: TrimSolveResult | null,
  b: TrimSolveResult | null,
  aMarks: GzMarks | null,
  bMarks: GzMarks | null,
) {
  const EMPTY = '—'
  const metric = (label: string, pick: (r: TrimSolveResult) => number, unit = '', digits = 1) => ({
    label,
    a: a === null ? EMPTY : `${fmt(pick(a), digits)}${unit}`,
    b: b === null ? EMPTY : `${fmt(pick(b), digits)}${unit}`,
    delta: a === null || b === null ? null : `${signed(pick(a) - pick(b), digits)}${unit}`,
  })

  const gzRow: MetricRow = {
    label: 'GZ peak',
    a: aMarks?.gzMax ? `${fmt(aMarks.gzMax.GZ)} mm @ ${fmt(aMarks.gzMax.heelDeg)}°` : EMPTY,
    b: bMarks?.gzMax ? `${fmt(bMarks.gzMax.GZ)} mm @ ${fmt(bMarks.gzMax.heelDeg)}°` : EMPTY,
    delta:
      aMarks?.gzMax && bMarks?.gzMax ? `${signed(aMarks.gzMax.GZ - bMarks.gzMax.GZ)} mm` : null,
  }

  const avsRow: MetricRow = {
    label: 'Angle of vanishing stability',
    a: aMarks === null ? EMPTY : avsCellText(aMarks),
    b: bMarks === null ? EMPTY : avsCellText(bMarks),
    delta:
      aMarks !== null && bMarks !== null && aMarks.avsDeg !== null && bMarks.avsDeg !== null
        ? `${signed(aMarks.avsDeg - bMarks.avsDeg)}°`
        : null,
  }

  // A non-converged sweep's numbers are a best estimate. The row marks them
  // as such instead of letting them sit beside a settled run's in every other
  // row and in the delta.
  const convergedCell = (r: TrimSolveResult | null): string =>
    r === null
      ? EMPTY
      : r.converged
        ? `yes (${r.planesEvaluated} planes)`
        : `approx (${r.planesEvaluated} planes)`

  const convergedRow: MetricRow = {
    label: 'Converged',
    a: convergedCell(a),
    b: convergedCell(b),
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
        metric('Initial stability (GM)', (r) => r.GM, ' mm'),
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

/**
 * The full table - every metric the format carries, behind the panel's footer.
 *
 * The Compare tab LEADS with the six metrics that decide a comparison; this is
 * the receipt behind "All metrics", and it is here rather than in the lead
 * because a 23-row table read as the page's headline makes the comparison
 * unreadable.
 */
export default function CompareTable({ a, b }: CompareTableProps) {
  const aMarks = a.result ? gzMarks(a.result.gzCurve) : null
  const bMarks = b.result ? gzMarks(b.result.gzCurve) : null
  const any = a.result !== null || b.result !== null
  const sections = any ? buildSections(a.result, b.result, aMarks, bMarks) : []

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="text-[11px] text-ink-3">
          <th scope="col" className="pb-1 text-left font-medium">
            Metric
          </th>
          <th scope="col" className="pb-1 text-right font-medium" style={columnStyle(0)}>
            A ·{' '}
            <span className="font-normal text-ink-3">
              {a.name ?? 'empty'}
              {a.stale ? ' (re-solving)' : ''}
            </span>
          </th>
          <th scope="col" className="pb-1 text-right font-medium" style={columnStyle(1)}>
            B ·{' '}
            <span className="font-normal text-ink-3">
              {b.name ?? 'empty'}
              {b.stale ? ' (re-solving)' : ''}
            </span>
          </th>
          <th scope="col" className="pb-1 text-right font-medium text-ink-3">
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
              className="pt-3 pb-1 text-left text-[11px] font-semibold tracking-[0.08em] text-ink-3 uppercase"
            >
              {section.title}
            </th>
          </tr>
          {section.rows.map((row) => (
            <tr key={row.label} className="border-t border-line">
              <th scope="row" className="py-1 pr-2 text-left text-[11px] font-normal text-ink-2">
                {row.label}
              </th>
              <td className="py-1 text-right font-mono text-[11px] tabular-nums text-ink">
                {row.a}
              </td>
              <td className="py-1 text-right font-mono text-[11px] tabular-nums text-ink">
                {row.b}
              </td>
              <td className="py-1 text-right font-mono text-[11px] tabular-nums text-accent-300">
                {row.delta ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  )
}
