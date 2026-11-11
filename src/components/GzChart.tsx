import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { fmt } from '../lib/format'
import type { GZPoint } from '../lib/hydrostatics'

/**
 * The righting-arm curve, lifted out of App verbatim: heel on X, GZ on Y,
 * same margins, colours and tooltip formatting. Task 9 annotates this — the
 * data it draws, and the shape of that data, are unchanged here.
 */
interface GzChartProps {
  curve: GZPoint[]
}

export default function GzChart({ curve }: GzChartProps) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart
        data={curve.map((p) => ({
          angle: p.heelDeg,
          GZ: p.GZ,
        }))}
        margin={{ top: 5, right: 5, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
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
  )
}
