import {
  barScale,
  barWidth,
  type DifferenceRow,
  differenceRows,
  differenceStaleNote,
  differenceVerdict,
} from '../lib/compare-difference'
import type { TrimSolveResult } from '../lib/hydrostatics'
import { SLOT_COLORS } from './Viewer3D'

/**
 * The Difference block: the six metrics that decide a comparison, each drawn as
 * a pair of bars so the reader sees WHICH WAY it goes, not just which number
 * is bigger.
 *
 * The bars are scaled by the larger of the two values in the row, so the bigger
 * number fills its track and the other reads as the proportion it is of it.
 * The delta on the right is A − B, and it is coloured only where the metric
 * knows which way is better - a difference in draft is not a verdict.
 */
interface CompareDifferenceProps {
  a: TrimSolveResult | null
  b: TrimSolveResult | null
  /** The conditions the two runs differ in; empty when they are comparable. */
  conditions: string[]
  /**
   * Each column's answer is out of date with its own conditions - a re-solve
   * is in flight, or the conditions have moved on and the new solve has not
   * answered yet. That column's bars and curve on screen then belong to its
   * last completed solve, not to what is in the fields now, so the block says
   * which column is behind rather than presenting its numbers as current. The
   * same `columnIsStale` the table's "(re-solving)" header reads, computed by
   * the caller and passed down - never re-derived here, so the two markers
   * cannot disagree.
   */
  staleA: boolean
  staleB: boolean
  /**
   * Drawn between the metrics and the sentence that reads them - the two
   * righting-arm curves, which are the shape behind these numbers.
   */
  children?: React.ReactNode
}

const SLOT_A = `#${SLOT_COLORS[0].toString(16).padStart(6, '0')}`
const SLOT_B = `#${SLOT_COLORS[1].toString(16).padStart(6, '0')}`

function Delta({ row }: { row: DifferenceRow }) {
  if (!row.delta) {
    return <span className="text-right font-mono text-[13px] tabular-nums text-ink-3">—</span>
  }
  const tone =
    row.delta.tone === 'good' ? 'text-good' : row.delta.tone === 'bad' ? 'text-bad' : 'text-ink'
  return (
    <span className={`text-right font-mono text-[13px] leading-tight tabular-nums ${tone}`}>
      {row.delta.text}
      <small className="block text-[11px] leading-none text-ink-3">{row.delta.unit}</small>
    </span>
  )
}

function Row({ row }: { row: DifferenceRow }) {
  const scale = barScale(row.a.value, row.b.value)
  const bar = (value: number | null, colour: string, text: string) => (
    <div className="flex items-center gap-2">
      <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-panel-2">
        <i
          className="block h-full rounded-full"
          style={{ width: `${barWidth(value, scale)}%`, backgroundColor: colour }}
        />
      </span>
      <span className="w-11 text-right font-mono text-[11px] leading-[1.15] tabular-nums text-ink-2">
        {text}
      </span>
    </div>
  )
  return (
    <div className="grid grid-cols-[104px_1fr_58px] items-center gap-3 border-b border-line py-1 last:border-b-0">
      <span className="text-[12px] leading-tight text-ink-2">{row.label}</span>
      <div className="grid gap-1">
        {bar(row.a.value, SLOT_A, row.a.text)}
        {bar(row.b.value, SLOT_B, row.b.text)}
      </div>
      <Delta row={row} />
    </div>
  )
}

export default function CompareDifference({
  a,
  b,
  conditions,
  staleA,
  staleB,
  children,
}: CompareDifferenceProps) {
  const rows = differenceRows(a, b)
  const verdict = differenceVerdict(a, b)
  // Two answers on screen is what draws the A − B heading, the delta column
  // and the verdict sentence, so it is also what widens the stale note's
  // scope: a stale column beside an EMPTY slot has no delta and no verdict
  // below it to claim.
  const both = a !== null && b !== null
  const staleNote = differenceStaleNote(staleA, staleB, both)

  return (
    <div className="mt-4">
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-[11px] font-medium text-ink-3">Difference</h2>
        <span className="flex-1" />
        {both && <span className="text-[11px] text-ink-3">A − B</span>}
      </div>

      {/*
        Under the heading rather than beside it, and above the dimmed rows: it
        qualifies the numbers below it, and the heading is the one place they
        all sit under.

        MOUNTED ALWAYS, with the styling applied only when there is a note to
        style: a live region is announced for what CHANGES inside it, so one
        inserted together with its first text - the slot's own solving line
        does exactly that - is not reliably announced. An empty note leaves
        this node in place with no classes and no children, which is a
        zero-height box (the preflight resets the paragraph's margins), so the
        persistent region costs nothing on screen. This is the one disclosure
        that has to reach a screen-reader user mid-edit.
      */}
      <p
        role="status"
        className={
          staleNote
            ? 'mb-2 rounded-lg border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] leading-snug text-warn'
            : ''
        }
      >
        {staleNote}
      </p>

      <div className={both ? '' : 'opacity-40'}>
        {rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
      </div>

      {!b && a && (
        <p className="mt-2 rounded-lg border border-line bg-panel px-2 py-2 text-[11px] leading-snug text-ink-3">
          Load a second run into slot B.
        </p>
      )}

      {/*
        The righting-arm curves, drawn between the numbers and the sentence
        that reads them: the metrics say which number is bigger, the curves
        show the shape behind it, and the verdict says what it means. The
        caller passes them in so this block owns one order.
      */}
      {children}

      {verdict && (
        <p className="mt-2 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] leading-relaxed text-ink-2">
          <b className="font-semibold text-ink">{verdict.lead}</b> {verdict.body}
          {verdict.body.endsWith('.') ? '' : '.'}
        </p>
      )}

      {conditions.length > 0 && (
        <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] leading-snug text-warn">
          Different conditions: {conditions.join(', ')}. Not directly comparable.
        </p>
      )}
    </div>
  )
}
