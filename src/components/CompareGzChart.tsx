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
import { fmt } from '../lib/format'
import { gzMarks } from '../lib/gz-marks'
import type { TrimSolveResult } from '../lib/hydrostatics'
import { SLOT_COLORS } from './Viewer3D'

/**
 * The two righting-arm curves on ONE pair of axes.
 *
 * The bars in the Difference block say which number is bigger. This says WHY:
 * two hulls of the same initial stability can have very different curves, and
 * the shape - where the arm peaks, how fast it falls away, where it runs out
 * of range - is what a paddler actually feels.
 *
 * Sharing the axes is the whole point: a curve drawn on its own scale would
 * make every hull look equally stiff.
 */
interface CompareGzChartProps {
  a: TrimSolveResult | null
  b: TrimSolveResult | null
}

const INK_3 = '#8b97a3'
const LINE_2 = '#2b353f'
const SLOT_A = `#${SLOT_COLORS[0].toString(16).padStart(6, '0')}`
const SLOT_B = `#${SLOT_COLORS[1].toString(16).padStart(6, '0')}`

interface ChartPoint {
  angle: number
  a: number | null
  b: number | null
}

/**
 * Both curves on one x-axis.
 *
 * The angles are the UNION of the two curves' samples, sorted: the solver
 * samples the same ladder for both hulls, but an imported record carries
 * whatever its own sweep sampled, and the two need not agree. A point a curve
 * does not have is null, and a null breaks its line rather than joining it -
 * a curve that stops at 45° must not be drawn on to the other hull's 60°.
 */
function mergeCurves(a: TrimSolveResult | null, b: TrimSolveResult | null): ChartPoint[] {
  const angles = new Set<number>()
  for (const curve of [a?.gzCurve ?? [], b?.gzCurve ?? []]) {
    for (const point of curve) angles.add(point.heelDeg)
  }
  const sorted = [...angles].sort((x, y) => x - y)
  const at = (curve: TrimSolveResult | null, angle: number): number | null => {
    if (!curve) return null
    const hit = curve.gzCurve.find((p) => p.heelDeg === angle)
    return hit ? hit.GZ : null
  }
  return sorted.map((angle) => ({ angle, a: at(a, angle), b: at(b, angle) }))
}

export default function CompareGzChart({ a, b }: CompareGzChartProps) {
  const data = mergeCurves(a, b)
  const marksA = a ? gzMarks(a.gzCurve) : null
  const marksB = b ? gzMarks(b.gzCurve) : null
  const maxHeel = Math.max(marksA?.maxHeelDeg ?? 0, marksB?.maxHeelDeg ?? 0)

  if (data.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={190}>
      <LineChart data={data} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE_2} vertical={false} />
        {/* The waterline of the chart: above it the hull rights itself. */}
        <ReferenceLine y={0} stroke={LINE_2} strokeWidth={1} />
        <XAxis
          dataKey="angle"
          type="number"
          domain={[0, maxHeel]}
          tick={{ fill: INK_3, fontSize: 11 }}
          axisLine={{ stroke: LINE_2 }}
          label={{
            value: 'Heel (°)',
            position: 'insideRight',
            offset: -10,
            fill: INK_3,
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          tick={{ fill: INK_3, fontSize: 11 }}
          axisLine={{ stroke: LINE_2 }}
          label={{
            value: 'GZ (mm)',
            angle: -90,
            position: 'insideLeft',
            offset: 10,
            fill: INK_3,
            fontSize: 11,
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#151d25',
            border: '1px solid #2b353f',
            padding: '8px 12px',
            borderRadius: '6px',
            color: '#e8edf1',
          }}
          formatter={(value, name) => [
            value != null ? `${fmt(Number(value))} mm` : '—',
            name === 'a' ? 'A' : 'B',
          ]}
        />
        <Line
          dataKey="a"
          name="a"
          stroke={SLOT_A}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
          activeDot={{ r: 4, fill: SLOT_A }}
        />
        <Line
          dataKey="b"
          name="b"
          stroke={SLOT_B}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
          activeDot={{ r: 4, fill: SLOT_B }}
        />
        {marksA?.gzMax && (
          <ReferenceDot
            x={marksA.gzMax.heelDeg}
            y={marksA.gzMax.GZ}
            r={3}
            fill={SLOT_A}
            stroke="#0a0d10"
          />
        )}
        {marksB?.gzMax && (
          <ReferenceDot
            x={marksB.gzMax.heelDeg}
            y={marksB.gzMax.GZ}
            r={3}
            fill={SLOT_B}
            stroke="#0a0d10"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}
