import { fmt, signed } from './format'
import { type GzMarks, gzMarks } from './gz-marks'
import type { TrimSolveResult } from './hydrostatics'

/**
 * The six metrics the Compare tab leads with, and the one sentence that reads
 * them.
 *
 * The full table is 23 rows of numbers; this is the handful that decides a
 * comparison. It lives in a module of its own because it is PURE - no React, no
 * scene - so the numbers it derives can be checked without a browser, and so
 * the panel, the verdict and the chart cannot drift apart about what "the
 * difference" is.
 *
 * Every metric here is one the comparison table carries: the handful that
 * decides it, plus a sentence that reads them.
 */

/** Which way round is better for a metric; null when it is not a judgement. */
export type Better = 'higher' | 'lower' | null

/** One side's number: the raw value for the bar, and the text it is read as. */
export interface DifferenceValue {
  /** null when this run has no number for the metric at all. */
  value: number | null
  /** The number as it is read, with its unit. */
  text: string
}

/** The A − B difference, in the metric's own unit. */
export interface DifferenceDelta {
  value: number
  /** The difference, formatted. */
  text: string
  /** The unit printed under the number. */
  unit: string
  /** good/bad when the metric knows which way is better; neutral otherwise. */
  tone: 'good' | 'bad' | 'neutral'
}

export interface DifferenceRow {
  key: string
  label: string
  a: DifferenceValue
  b: DifferenceValue
  /** null when a delta would mean nothing - one side has no number. */
  delta: DifferenceDelta | null
}

interface MetricSpec {
  key: string
  label: string
  /** The unit printed under the delta. */
  unit: string
  /** How the number in the bar's value slot is written. */
  text: (value: number) => string
  /** The number, or null when this run cannot answer the metric. */
  pick: (result: TrimSolveResult, marks: GzMarks) => number | null
  /** Which way is better, if the metric is a judgement at all. */
  better: Better
}

const METRICS: MetricSpec[] = [
  {
    key: 'draft',
    label: 'Draft',
    unit: 'mm',
    text: (v) => fmt(v),
    pick: (r) => r.draftMm,
    // Not a judgement: a deeper hull is not a worse hull.
    better: null,
  },
  {
    key: 'trim',
    label: 'Trim',
    unit: '°',
    text: (v) => `${signed(v, 1)}°`,
    pick: (r) => r.trimDeg,
    // Not a judgement: upright is not automatically the better trim.
    better: null,
  },
  {
    key: 'gm',
    label: 'Initial stability',
    unit: 'mm',
    text: (v) => fmt(v),
    pick: (r) => r.GM,
    better: 'higher',
  },
  {
    key: 'gzPeak',
    label: 'GZ peak',
    unit: 'mm',
    text: (v) => fmt(v),
    pick: (_r, marks) => marks.gzMax?.GZ ?? null,
    better: 'higher',
  },
  {
    key: 'avs',
    label: 'Vanishing angle',
    unit: '°',
    text: (v) => `${fmt(v)}°`,
    pick: (_r, marks) => marks.avsDeg,
    better: 'higher',
  },
  {
    key: 'lwl',
    label: 'Waterline length',
    unit: 'mm',
    text: (v) => fmt(v),
    pick: (r) => r.LWL,
    better: null,
  },
]

/**
 * Below this, two runs are the same number as far as the verdict is
 * concerned: 0.3 mm of draft or 0.4 mm of stability is not a difference a
 * sentence should be built on.
 */
const SIGNIFICANT = 0.5

/**
 * The six rows, from the two runs.
 *
 * A run with no number for a metric yields an empty cell, not a zero: the
 * difference is a claim about two numbers, and one of them missing makes the
 * claim impossible.
 */
export function differenceRows(
  a: TrimSolveResult | null,
  b: TrimSolveResult | null,
): DifferenceRow[] {
  const marksA = a ? gzMarks(a.gzCurve) : null
  const marksB = b ? gzMarks(b.gzCurve) : null
  return METRICS.map((metric) => {
    const rawA = a && marksA ? metric.pick(a, marksA) : null
    const rawB = b && marksB ? metric.pick(b, marksB) : null
    const valueA = rawA !== null && Number.isFinite(rawA) ? rawA : null
    const valueB = rawB !== null && Number.isFinite(rawB) ? rawB : null
    let delta: DifferenceDelta | null = null
    if (valueA !== null && valueB !== null) {
      const value = valueA - valueB
      let tone: DifferenceDelta['tone'] = 'neutral'
      if (metric.better !== null && Math.abs(value) >= SIGNIFICANT) {
        const higherIsBetter = metric.better === 'higher'
        tone = value > 0 === higherIsBetter ? 'good' : 'bad'
      }
      delta = { value, text: signed(value, 1), unit: metric.unit, tone }
    }
    return {
      key: metric.key,
      label: metric.label,
      a: { value: valueA, text: valueA === null ? '—' : metric.text(valueA) },
      b: { value: valueB, text: valueB === null ? '—' : metric.text(valueB) },
      delta,
    }
  })
}

/**
 * The bar's length, as a percentage of the track.
 *
 * Both bars of a row are scaled by the LARGER of the two, so the bigger number
 * fills its track and the other reads as the proportion it is of it. A signed
 * metric is scaled by the larger MAGNITUDE, because the bar shows how much
 * trim there is, not which way it points.
 */
export function barWidth(value: number | null, scale: number): number {
  if (value === null || !Number.isFinite(value) || scale <= 0) return 0
  return Math.max(0, Math.min(100, (Math.abs(value) / scale) * 100))
}

/** The scale a row's two bars share: the larger of the two magnitudes. */
export function barScale(a: number | null, b: number | null): number {
  const values = [a, b].filter((v): v is number => v !== null && Number.isFinite(v))
  return values.length === 0 ? 0 : Math.max(...values.map((v) => Math.abs(v)))
}

/**
 * The verdict, in two pieces: the lead clause, which is the point, and the
 * body, which is the evidence.
 */
export interface DifferenceVerdict {
  /** "A floats stiffer." */
  lead: string
  /** "36.6 mm more initial stability, but A sits 15.3 mm shallower — B carries 20 kg more." */
  body: string
}

/**
 * One sentence that reads the six numbers.
 *
 * The bars say which number is bigger; this says what that MEANS. It is
 * deliberately one sentence and deliberately partial: each clause is dropped
 * when the two runs do not differ enough to carry it, so a comparison of two
 * near-identical hulls does not get a sentence about 0.3 mm of draft.
 *
 * Null when there is nothing to compare - one run, or none.
 */
export function differenceVerdict(
  a: TrimSolveResult | null,
  b: TrimSolveResult | null,
): DifferenceVerdict | null {
  if (!a || !b) return null
  const gmDelta = a.GM - b.GM
  const draftDelta = a.draftMm - b.draftMm
  const loadDelta = a.displacementKg - b.displacementKg

  const stiffer = gmDelta >= 0 ? 'A' : 'B'
  const lead =
    Math.abs(gmDelta) < SIGNIFICANT ? 'Both float about alike.' : `${stiffer} floats stiffer.`

  const clauses: string[] = []
  if (Math.abs(gmDelta) >= SIGNIFICANT) {
    clauses.push(`${fmt(Math.abs(gmDelta))} mm more initial stability`)
  }
  if (Math.abs(draftDelta) >= SIGNIFICANT) {
    const who = draftDelta < 0 ? 'A' : 'B'
    clauses.push(
      `${who} sits ${fmt(Math.abs(draftDelta))} mm ${draftDelta < 0 ? 'shallower' : 'deeper'}`,
    )
  }
  if (Math.abs(loadDelta) >= SIGNIFICANT) {
    const who = loadDelta < 0 ? 'A' : 'B'
    clauses.push(`${who} carries ${fmt(Math.abs(loadDelta))} kg ${loadDelta < 0 ? 'less' : 'more'}`)
  }

  if (clauses.length === 0) return { lead, body: '' }
  // "A floats stiffer. 36.6 mm more initial stability, but A sits 15.3 mm
  // shallower - B carries 20 kg more."
  const [first, ...rest] = clauses
  const body = rest.length > 0 ? `${first}, but ${rest.join(' — ')}` : first
  return { lead, body }
}
