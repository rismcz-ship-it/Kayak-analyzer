import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmt, signed } from '../lib/format'
import type { GzMarks } from '../lib/gz-marks'
import type { GZPoint } from '../lib/hydrostatics'

/**
 * The righting-arm curve: heel on X, GZ on Y, with the marks a reviewer reads
 * it by — the vanishing angle, the peak, the heel the solve was fixed at and
 * the angle where an end tip wets. The data drawn, and the shape of that data,
 * are unchanged from before Task 9; only the marks are new.
 *
 * The marks arrive ready-made from `gzMarks` rather than being scanned here:
 * the panel's "an end immerses first" warning reads the same object, so the
 * warning and these markers cannot disagree.
 */
interface GzChartProps {
  curve: GZPoint[]
  marks: GzMarks
  /**
   * The fixed heel the solve ran at, degrees. Its marker is skipped at 0: the
   * line would lie exactly on the y-axis and add nothing, mirroring how the
   * panel only lists the fixed heel when it is not zero.
   */
  currentHeelDeg: number
  /**
   * Angle at which a stem tip first wets, degrees, or null when it stays clear
   * across the whole sampled range.
   */
  endTipImmersionDeg: number | null
  /** Metacentric height in mm — the small-angle figure the caption names. */
  gmMm: number
}

const MUTED = '#a1a1aa'
const AMBER = '#f59e0b'
const ROSE = '#fb7185'

export default function GzChart({
  curve,
  marks,
  currentHeelDeg,
  endTipImmersionDeg,
  gmMm,
}: GzChartProps) {
  const { gzMax, avsDeg, maxHeelDeg } = marks
  // One line of words under the chart: the same numbers the markers carry, so
  // an angle is readable when its marker is off-scale or its label collides.
  const parts: string[] = []
  if (gzMax) parts.push(`GZ_max ${fmt(gzMax.GZ)} mm at ${fmt(gzMax.heelDeg)}°`)
  else parts.push(`no positive righting arm within ${fmt(maxHeelDeg)}°`)
  if (avsDeg !== null) parts.push(`AVS ≈ ${fmt(avsDeg)}°`)
  else if (gzMax) parts.push(`no AVS within ${fmt(maxHeelDeg)}°`)
  if (endTipImmersionDeg !== null) parts.push(`end tip wets at ${fmt(endTipImmersionDeg)}°`)
  // Recharts discards a reference line outside the axis domain, so a fixed heel
  // outside the curve's own range would vanish without a word. State it instead.
  // The ±30° slider can only leave the domain on its negative half, but the rule
  // is the domain and not the sign, so it reads as the domain here.
  if (currentHeelDeg < 0 || currentHeelDeg > maxHeelDeg) {
    parts.push(`fixed heel ${signed(currentHeelDeg)}° (outside this range)`)
  }
  const caption = parts.join(' · ')
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart
          data={curve.map((p) => ({
            angle: p.heelDeg,
            GZ: p.GZ,
          }))}
          margin={{ top: 14, right: 5, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
          <ReferenceLine
            y={0}
            stroke="#52525b"
            strokeWidth={1}
            label={{ value: 'GZ = 0', position: 'insideBottomLeft', fill: '#71717a', fontSize: 10 }}
          />
          {currentHeelDeg !== 0 && (
            <ReferenceLine
              x={currentHeelDeg}
              stroke={MUTED}
              strokeDasharray="4 3"
              label={{
                value: `fixed heel ${signed(currentHeelDeg)}°`,
                position: 'insideTopLeft',
                fill: MUTED,
                fontSize: 10,
              }}
            />
          )}
          {endTipImmersionDeg !== null && (
            <ReferenceLine
              x={endTipImmersionDeg}
              stroke={AMBER}
              strokeDasharray="4 3"
              label={{
                value: `end tip ${fmt(endTipImmersionDeg)}°`,
                position: 'insideBottomRight',
                fill: AMBER,
                fontSize: 10,
              }}
            />
          )}
          {gzMax && (
            <ReferenceDot
              x={gzMax.heelDeg}
              y={gzMax.GZ}
              r={4}
              fill={AMBER}
              stroke="#18181b"
              label={{ value: 'GZ_max', position: 'top', fill: AMBER, fontSize: 10 }}
            />
          )}
          {avsDeg !== null && (
            <ReferenceDot
              x={avsDeg}
              y={0}
              r={4}
              fill={ROSE}
              stroke="#18181b"
              label={{ value: 'AVS', position: 'bottom', fill: ROSE, fontSize: 10 }}
            />
          )}
          <XAxis
            dataKey="angle"
            type="number"
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={{ stroke: '#52525b' }}
            label={{
              value: 'Heel (°)',
              position: 'insideRight',
              offset: -10,
              fill: '#71717a',
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={{ stroke: '#52525b' }}
            label={{
              value: 'GZ (mm)',
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              fill: '#71717a',
              fontSize: 10,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '4px',
              color: '#fafafa',
            }}
            formatter={(value, name) => [value != null ? `${fmt(Number(value))} mm` : '—', name]}
          />
          <Line
            type="monotone"
            dataKey="GZ"
            stroke="#0ea5e9"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#0ea5e9' }}
          />
        </LineChart>
      </ResponsiveContainer>
      {/*
       * The angles in words, so they survive a marker falling outside the
       * plotted range (a fixed heel past the last sample is not drawn) and so
       * the peak can be read without hovering the tooltip.
       */}
      <p className="text-[10px] leading-snug text-zinc-500">{caption}</p>
      <p className="text-[10px] leading-snug text-zinc-500">
        {`GM₀ = ${fmt(gmMm)} mm is the small-angle initial stability of the trimmed solve; ` +
          'the curve is the upright, untrimmed hull re-floated at each heel — ' +
          'measured, not the wall-sided closed form — so past ~15–20° what ' +
          'limits the arm is sinkage, not the arm formula.'}
      </p>
    </div>
  )
}
