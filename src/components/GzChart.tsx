import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
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
 * it by — the vanishing angle and the band past it, the peak, the heel the
 * solve was fixed at and the angle where an end tip wets.
 *
 * The marks arrive ready-made from `gzMarks` rather than being scanned here:
 * the panel's warnings read the same object, so a warning and a marker cannot
 * disagree.
 */
interface GzChartProps {
  curve: GZPoint[]
  marks: GzMarks
  /**
   * The fixed heel the solve ran at, degrees. Its marker is skipped at 0: the
   * line would lie exactly on the y-axis and add nothing.
   */
  currentHeelDeg: number
  /**
   * Angle at which a stem tip first wets, degrees, or null when it stays clear
   * across the whole sampled range.
   */
  endTipImmersionDeg: number | null
}

const INK_2 = '#a8b4bf'
const INK_3 = '#8b97a3'
const LINE_2 = '#2b353f'
const ACCENT = '#4d9fe0'
const WARN = '#d3a154'
const BAD = '#cd6c70'

export default function GzChart({
  curve,
  marks,
  currentHeelDeg,
  endTipImmersionDeg,
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
  else parts.push(`no stem tip reaches the water within ${fmt(maxHeelDeg)}°`)
  // Recharts discards a reference line outside the axis domain, so a fixed heel
  // outside the curve's own range would vanish without a word. State it instead.
  if (currentHeelDeg < 0 || currentHeelDeg > maxHeelDeg) {
    parts.push(`fixed heel ${signed(currentHeelDeg)}° (outside this range)`)
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart
          data={curve.map((p) => ({
            angle: p.heelDeg,
            GZ: p.GZ,
          }))}
          margin={{ top: 14, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={LINE_2} vertical={false} />
          {/* The only red in the chart: the band past the vanishing angle. */}
          {avsDeg !== null && (
            <ReferenceArea
              x1={avsDeg}
              x2={maxHeelDeg}
              fill={BAD}
              fillOpacity={0.07}
              stroke="none"
            />
          )}
          <ReferenceLine y={0} stroke={LINE_2} strokeWidth={1} />
          {currentHeelDeg !== 0 && (
            <ReferenceLine
              x={currentHeelDeg}
              stroke={INK_2}
              strokeDasharray="4 3"
              label={{
                value: `fixed heel ${signed(currentHeelDeg)}°`,
                position: 'insideTopLeft',
                fill: INK_2,
                fontSize: 10,
              }}
            />
          )}
          {endTipImmersionDeg !== null && (
            <ReferenceLine
              x={endTipImmersionDeg}
              stroke={WARN}
              strokeDasharray="4 3"
              label={{
                value: `end tip ${fmt(endTipImmersionDeg)}°`,
                position: 'insideBottomRight',
                fill: WARN,
                fontSize: 10,
              }}
            />
          )}
          {gzMax && (
            <ReferenceDot
              x={gzMax.heelDeg}
              y={gzMax.GZ}
              r={4}
              fill={WARN}
              stroke="#0a0d10"
              label={{
                value: `${fmt(gzMax.GZ)} mm @ ${fmt(gzMax.heelDeg)}°`,
                position: 'top',
                fill: INK_2,
                fontSize: 10,
              }}
            />
          )}
          {avsDeg !== null && (
            <ReferenceDot
              x={avsDeg}
              y={0}
              r={3}
              fill={INK_2}
              stroke="#0a0d10"
              label={{
                value: `AVS ${fmt(avsDeg)}°`,
                position: 'bottom',
                fill: INK_2,
                fontSize: 10,
              }}
            />
          )}
          <XAxis
            dataKey="angle"
            type="number"
            tick={{ fill: INK_3, fontSize: 10 }}
            axisLine={{ stroke: LINE_2 }}
            label={{
              value: 'Heel (°)',
              position: 'insideRight',
              offset: -10,
              fill: INK_3,
              fontSize: 10,
            }}
          />
          <YAxis
            type="number"
            tick={{ fill: INK_3, fontSize: 10 }}
            axisLine={{ stroke: LINE_2 }}
            label={{
              value: 'GZ (mm)',
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              fill: INK_3,
              fontSize: 10,
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#151d25',
              border: '1px solid #2b353f',
              borderRadius: '6px',
              color: '#e8edf1',
            }}
            formatter={(value, name) => [value != null ? `${fmt(Number(value))} mm` : '—', name]}
          />
          <Line
            type="monotone"
            dataKey="GZ"
            stroke={ACCENT}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: ACCENT }}
          />
        </LineChart>
      </ResponsiveContainer>
      {/* The angles in words, so they survive a marker falling outside the
          plotted range and so the peak can be read without hovering. */}
      <p className="mt-2 text-[11px] leading-snug text-ink-3">{parts.join(' · ')}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-3">
        The curve is the upright, untrimmed hull re-floated at each heel.
      </p>
    </div>
  )
}
