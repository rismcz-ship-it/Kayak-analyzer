import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import Upload, { type LoadedMesh, rescaleMesh } from './components/Upload'
import Viewer3D from './components/Viewer3D'
import type { ScaleAdvice } from './lib/geometry'
import { DEFAULT_KG_MM, type TrimSolveResult } from './lib/hydrostatics'
import { SolverClient } from './lib/solver-client'

const fmt = (v: number, digits = 1) => v.toLocaleString('en-US', { maximumFractionDigits: digits })

function statRow(label: string, value: string | ReactNode, accent = false) {
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

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array
}

/**
 * The scale notice wording, one line per band of `scaleAdviceFor`.
 *
 * Deliberately reports the extent in the file's own units rather than naming a
 * unit the app cannot know: an inch-authored hull (120 units) is caught by the
 * same rule as a metres-authored one, and printing "120.00 m" would state a
 * false magnitude.
 */
function scaleNotice(advice: ScaleAdvice, maxDim: number): string {
  if (advice.kind === 'metres') {
    return (
      `Largest axis ${fmt(maxDim, 2)} in the file's own units — a kayak is thousands of mm ` +
      'long, so this is probably a metres file: lengths would read 1000× too small and ' +
      'volumes 10⁹× too small.'
    )
  }
  if (advice.kind === 'small') {
    return (
      `Largest axis ${fmt(maxDim)} in the file's own units — too short for a kayak in mm, ` +
      'and too long to be metres. If the STL is in cm or inches its lengths read 10× / 25.4× ' +
      'too small; rescale the mesh to mm.'
    )
  }
  return (
    `Largest axis ${fmt(maxDim)} mm — larger than 10 m. Check the STL's units; the app ` +
    'assumes mm.'
  )
}

export default function App() {
  const [mesh, setMesh] = useState<LoadedMesh | null>(null)
  const [trimResult, setTrimResult] = useState<TrimSolveResult | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [targetWeight, setTargetWeight] = useState(75) // kg, fresh water 1 kg = 1 L
  const [targetLcgPercent, setTargetLcgPercent] = useState(52) // % from bow
  const [targetKgMm, setTargetKgMm] = useState(DEFAULT_KG_MM) // mm above the keel
  const [showHeelInput, setShowHeelInput] = useState(false) // toggle for fixed heel input
  const [heelInputDeg, setHeelInputDeg] = useState(0) // fixed heel angle in degrees
  const calcToken = useRef(0)
  const clientRef = useRef<SolverClient | null>(null)
  const mountedRef = useRef(true)

  /**
   * Retire whatever is in flight: bump the token so its late continuation is
   * dropped, and stop its worker. The promise rejects with 'cancelled', which
   * the stale token check above discards.
   */
  const retireRun = useCallback(() => {
    calcToken.current++
    clientRef.current?.cancel()
  }, [])

  const handleLoaded = useCallback(
    (next: LoadedMesh) => {
      // A solve in flight now answers for a mesh that is no longer on screen.
      retireRun()
      // Released at the call site rather than inside the updater below. Updaters
      // must be pure, and React double-invokes them under StrictMode, so a
      // release in there runs twice per load in development. three.js dispose
      // is idempotent, so nothing is broken today — but Viewer3D deliberately
      // leaves the hull geometry alone, so this is the only owner it has.
      if (mesh) mesh.geometry.dispose()
      setMesh(next)
      // Invalidate stale hydrostatics immediately. No auto-calculation here —
      // the user must orient the hull then click "Calculate Draft".
      setTrimResult(null)
      setDraftError(null)
      setProgress(null)
      setIsCalculating(false)
    },
    [retireRun, mesh],
  )

  // The client owns the worker, so the worker dies with the component. The
  // flag is re-armed on every mount because StrictMode mounts, unmounts and
  // mounts again — without that, development would never apply a result.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clientRef.current?.cancel()
    }
  }, [])

  const runCalculation = useCallback(
    (weightKg: number, lcgPercent: number, kgMm: number, heelDeg: number, current: LoadedMesh) => {
      const token = ++calcToken.current
      setIsCalculating(true)
      setProgress(null)
      setDraftError(null)
      try {
        const positions = positionsOf(current)
        if (positions.length === 0) {
          throw new Error('Empty mesh — the STL contained no triangles.')
        }
        // Belt and braces with the disabled Calculate button: a hull with open
        // edges cannot reach solveTrim, whatever path calls this.
        if (!current.stats.watertight.watertight) {
          throw new Error(
            `${current.stats.watertight.openEdgeCount} open edges — the solver needs a closed hull.`,
          )
        }
        if (!Number.isFinite(weightKg) || weightKg <= 0) {
          throw new Error(`Target weight must be > 0 kg (got ${String(weightKg)}).`)
        }
        if (!Number.isFinite(kgMm) || kgMm <= 0) {
          throw new Error(`KG must be > 0 mm (got ${String(kgMm)}).`)
        }
        // The solve runs in a worker: the main thread stays free to render the
        // hull and the progress bar while the waterplane sweep works.
        if (!clientRef.current) clientRef.current = new SolverClient()
        const client = clientRef.current
        client
          .run(
            {
              // Copied so this seam never hands the viewer's live buffer to the
              // client; SolverClient copies again inside run() and transfers
              // only its own copy (pinned by section 5 of
              // tests/verify-worker-protocol.ts), so the geometry's array is
              // never detached and the viewer keeps rendering.
              positions: new Float32Array(positions),
              targetKg: weightKg,
              targetLcgPercentFromBow: lcgPercent,
              kgMm,
              fixedHeelDeg: heelDeg,
              maxTrimDeg: 4.5,
              trimStepDeg: 0.1,
            },
            (p) => {
              if (calcToken.current === token) setProgress({ done: p.done, total: p.total })
            },
          )
          .then(
            (trim) => {
              if (calcToken.current !== token || !mountedRef.current) return
              setTrimResult(trim)
              setIsCalculating(false)
              setProgress(null)
            },
            (err: unknown) => {
              // Tested before the guard below, so it stays the single authority:
              // a cancelled run clears the in-progress UI and nothing else —
              // neither an error panel nor the previous result on screen.
              // (retireRun also bumps the token, so this usually discards it
              // earlier still; that redundancy is deliberate, not a bug.)
              if (err instanceof Error && err.message === 'cancelled') {
                if (calcToken.current === token && mountedRef.current) {
                  setIsCalculating(false)
                  setProgress(null)
                }
                return
              }
              if (calcToken.current !== token || !mountedRef.current) return
              setTrimResult(null)
              setDraftError(err instanceof Error ? err.message : 'Draft calculation failed.')
              setIsCalculating(false)
              setProgress(null)
            },
          )
      } catch (err) {
        if (!mountedRef.current) return
        setTrimResult(null)
        setDraftError(err instanceof Error ? err.message : 'Draft calculation failed.')
        setIsCalculating(false)
        setProgress(null)
      }
    },
    [],
  )

  const calculateDraft = useCallback(() => {
    if (!mesh) {
      setDraftError('Load an STL hull first.')
      return
    }
    const appliedHeel = showHeelInput ? heelInputDeg : 0
    runCalculation(targetWeight, targetLcgPercent, targetKgMm, appliedHeel, mesh)
  }, [
    mesh,
    targetWeight,
    targetLcgPercent,
    targetKgMm,
    showHeelInput,
    heelInputDeg,
    runCalculation,
  ])

  const cancelCalculation = useCallback(() => {
    retireRun()
    setProgress(null)
    setIsCalculating(false)
  }, [retireRun])

  /**
   * The only path that ever changes geometry: an explicit Apply on the
   * metres notice. rescaleMesh copies into a new buffer (the viewer keeps
   * drawing the old one until handleLoaded swaps it), and handleLoaded
   * disposes that old geometry — so nothing is mutated in place, and the new
   * mesh id remounts the viewer.
   */
  const applyScale = useCallback(() => {
    const advice = mesh?.scaleAdvice
    if (!mesh || !advice || advice.kind !== 'metres') return
    handleLoaded(rescaleMesh(mesh, advice.factor))
  }, [mesh, handleLoaded])

  const s = mesh?.stats
  const maxKg = s ? s.volumeLiters : null
  // Largest extent in mm — the Hull section's unit notice reads this.
  const maxDim = s ? Math.max(s.bounds.size.x, s.bounds.size.y, s.bounds.size.z) : 0
  const weightInvalid =
    !Number.isFinite(targetWeight) || targetWeight <= 0
      ? 'Enter a weight above 0 kg.'
      : maxKg !== null && targetWeight > maxKg
        ? `Heavier than the hull's ${fmt(maxKg)} L volume — it would sink.`
        : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">kayak-analyzer</h1>
          <p className="text-xs text-zinc-500">Static float + stability viewer — school project</p>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          STL stays in memory · max 25 MB
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        {mesh && s ? (
          <div className="flex min-h-0 flex-1 gap-4">
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
              <div className="min-h-0 flex-1">
                <Viewer3D
                  key={mesh.id}
                  geometry={mesh.geometry}
                  waterlineZ={trimResult?.waterlineZ ?? null}
                  trimDeg={trimResult?.trimDeg ?? 0}
                  heelDeg={trimResult?.heelDeg ?? (showHeelInput ? heelInputDeg : 0)}
                  lcg={trimResult?.lcg ?? null}
                  lcb={trimResult?.lcb ?? null}
                  pivot={trimResult?.pivot ?? null}
                />
              </div>
              <div className="flex items-center justify-end px-1 pb-1 pt-2">
                <span className="truncate text-xs text-zinc-500" title={mesh.fileName}>
                  {mesh.fileName} · {fmt(s.bounds.size.x)} × {fmt(s.bounds.size.y)} ×{' '}
                  {fmt(s.bounds.size.z)} mm
                </span>
              </div>
            </section>

            <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="mb-1 text-sm font-semibold text-zinc-200">Hull</h2>
                <dl className="space-y-1 text-sm">
                  {statRow('Length (X)', `${fmt(s.bounds.size.x)} mm`)}
                  {statRow('Beam (Y)', `${fmt(s.bounds.size.y)} mm`)}
                  {statRow('Depth (Z)', `${fmt(s.bounds.size.z)} mm`)}
                  {statRow('Volume', `${fmt(s.volumeLiters)} L`, true)}
                  {statRow(
                    'Watertight',
                    s.watertight.watertight ? 'yes' : `${s.watertight.openEdgeCount} open edges`,
                  )}
                </dl>
                <p className="mt-2 text-xs text-zinc-500" title={mesh.orientNote}>
                  {mesh.orientNote}
                </p>
                {mesh.scaleAdvice && (
                  <p className="mt-2 text-xs text-amber-400" role="note">
                    {scaleNotice(mesh.scaleAdvice, maxDim)}
                    {mesh.scaleAdvice.kind === 'metres' && (
                      <button
                        type="button"
                        onClick={applyScale}
                        className="ml-2 rounded border border-amber-600/60 px-2 py-0.5 text-xs text-amber-300 hover:bg-amber-950/40"
                      >
                        Apply ×1000
                      </button>
                    )}
                  </p>
                )}
                <div className="mt-3">
                  <Upload onLoaded={handleLoaded} compact />
                </div>
              </section>

              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-zinc-200">Draft Calculation</h2>
                {!s.watertight.watertight && (
                  <p
                    className="mb-2 rounded border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-300"
                    role="note"
                  >
                    {s.watertight.openEdgeCount} open edges — the solver needs a closed hull, so
                    Calculate is disabled.
                  </p>
                )}
                <label htmlFor="target-weight" className="mb-1 block text-xs text-zinc-400">
                  Target weight (kg) — paddler + gear + boat
                </label>
                <div className="mb-2 flex items-center gap-2">
                  <input
                    id="target-weight"
                    type="number"
                    min={0}
                    step="any"
                    value={Number.isFinite(targetWeight) ? targetWeight : ''}
                    onChange={(e) => setTargetWeight(Number(e.target.value))}
                    placeholder="Enter Target Weight (kg)"
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                  />
                  <button
                    type="button"
                    onClick={calculateDraft}
                    disabled={isCalculating || !mesh || !s.watertight.watertight}
                    className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCalculating ? 'Calculating…' : 'Calculate Draft'}
                  </button>
                </div>
                <label htmlFor="target-lcg" className="mb-1 block text-xs text-zinc-400">
                  LCG from bow (%) — 52% = midship
                </label>
                <div className="mb-4 flex items-center gap-2">
                  <input
                    id="target-lcg"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={Number.isFinite(targetLcgPercent) ? targetLcgPercent : ''}
                    onChange={(e) => setTargetLcgPercent(Number(e.target.value))}
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                  />
                </div>
                <label htmlFor="target-kg" className="mb-1 block text-xs text-zinc-400">
                  KG above keel (mm) — sets GM
                </label>
                <div className="mb-4 flex items-center gap-2">
                  <input
                    id="target-kg"
                    type="number"
                    min={0}
                    step={1}
                    value={Number.isFinite(targetKgMm) ? targetKgMm : ''}
                    onChange={(e) => setTargetKgMm(Number(e.target.value))}
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                  />
                  <span className="text-xs text-zinc-500">
                    height above the keel, not an absolute Z
                  </span>
                </div>

                <div className="mb-4 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div
                      className={`w-8 h-4 rounded-full transition-colors border border-zinc-700 ${showHeelInput ? 'bg-blue-600 border-blue-400' : 'bg-zinc-800'}`}
                    >
                      <div
                        className={`w-3 h-3 m-0.5 rounded-full bg-white transition-transform ${showHeelInput ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={showHeelInput}
                      onChange={(e) => setShowHeelInput(e.target.checked)}
                    />
                    <span className="text-xs text-zinc-400 group-hover:text-zinc-300">
                      Set fixed heel angle
                    </span>
                  </label>

                  {showHeelInput && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                      <label
                        htmlFor="heel-input"
                        className="mb-1 block text-xs text-zinc-400"
                        title="A positive angle lowers the -Y side of the hull. Which physical side that is depends on how the STL was mirrored on load, so read it as 'the hull leans to one side'."
                      >
                        Heel angle (°) — positive = the −Y side goes down
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          id="heel-input"
                          type="range"
                          min={-30}
                          max={30}
                          step={1}
                          value={heelInputDeg}
                          onChange={(e) => setHeelInputDeg(Number(e.target.value))}
                          className="flex-1 h-1.5 bg-zinc-700 appearance-none rounded-lg cursor-pointer accent-blue-500"
                        />
                        <span className="text-xs font-mono text-zinc-300 w-8 text-right">
                          {heelInputDeg}°
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                {maxKg !== null && (
                  <p className="mb-2 text-xs text-zinc-500">
                    Hull capacity ≈ {fmt(maxKg)} kg (volume {fmt(maxKg)} L).
                  </p>
                )}
                {weightInvalid && (
                  <p className="mb-2 text-xs text-amber-400" role="note">
                    {weightInvalid}
                  </p>
                )}
                {isCalculating && (
                  <div className="mb-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
                        style={{
                          width:
                            progress && progress.total > 0
                              ? `${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`
                              : '4%',
                        }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-zinc-400">
                      {/* Live region on the text only: the bar ticks ~30 times,
                          and the button belongs outside a polite live region. */}
                      <span role="status" aria-live="polite">
                        {progress
                          ? `Solving… angle ${progress.done}/${progress.total}`
                          : 'Starting solver…'}
                      </span>
                      <button
                        type="button"
                        onClick={cancelCalculation}
                        className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {draftError && (
                  <p
                    className="mb-2 rounded border border-rose-900 bg-rose-950/50 p-2 text-xs text-rose-300"
                    role="alert"
                  >
                    {draftError}
                  </p>
                )}
                {/* Anything other than exactly one loop leaves the waterplane
                    sums untrustworthy: several loops means the contour
                    fragmented, and NONE means the cut produced no closed water
                    plane at all, so area and Ix are 0, BM is 0, and GM reads
                    KB − KG — a plausible number out of nothing.

                    Neither branch may blame holes: a holed mesh cannot reach
                    the solver (Calculate is disabled and runCalculation throws),
                    and a closed twin hull or a tunnel legitimately splits the
                    waterplane into two. The wording states the numbers, not a
                    cause the app has already excluded. */}
                {trimResult && trimResult.waterplaneLoopCount !== 1 && (
                  <p
                    className="mb-2 rounded border border-amber-800 bg-amber-950/50 p-2 text-xs text-amber-300"
                    role="status"
                  >
                    {trimResult.waterplaneLoopCount === 0
                      ? 'no closed waterplane contour at this waterline — its area and Ix are 0, so BM is 0 and GM reads KB − KG.'
                      : `waterplane contour split into ${trimResult.waterplaneLoopCount} loops — BM and GM assume a single closed waterplane, so treat them as unreliable. A genuinely two-lobed waterplane (twin hull, tunnel) does this legitimately.`}
                  </p>
                )}
                <output className="block text-sm" id="draft-output" aria-live="polite">
                  {trimResult ? (
                    <dl className="space-y-1">
                      {sectionTitle('Equilibrium')}
                      {statRow(
                        'Trim',
                        `${trimResult.trimDeg >= 0 ? '+' : ''}${fmt(trimResult.trimDeg)}°`,
                        true,
                      )}
                      {statRow('Draft (center)', `${fmt(trimResult.draftMm)} mm`)}
                      {statRow('Waterline Z', `${fmt(trimResult.waterlineZ)} mm`)}
                      {statRow('Displacement', `${fmt(trimResult.displacementKg)} kg`)}
                      {statRow('Target', `${fmt(trimResult.targetKg)} kg`)}
                      {statRow(
                        'Waterplane area',
                        `${fmt(trimResult.waterplaneAreaMm2 / 1e6, 3)} m²`,
                      )}
                      {statRow('Waterline length (LWL)', `${fmt(trimResult.LWL)} mm`)}
                      {statRow('Waterline beam (BWL)', `${fmt(trimResult.BWL)} mm`)}
                      {statRow('LCG X', `${fmt(trimResult.lcg.x)} mm`)}
                      {statRow('LCB X', `${fmt(trimResult.lcb.x)} mm`)}
                      {statRow('LCB–LCG offset', `${fmt(trimResult.lcbLcgOffsetMm)} mm`, true)}
                      {statRow('Bow freeboard', `${fmt(trimResult.bowFreeboardMm)} mm`)}
                      {statRow('Stern freeboard', `${fmt(trimResult.sternFreeboardMm)} mm`)}
                      {trimResult.heelDeg !== 0 &&
                        statRow(
                          'Fixed heel angle',
                          `${trimResult.heelDeg >= 0 ? '+' : ''}${fmt(trimResult.heelDeg)}°`,
                          true,
                        )}
                      {statRow(
                        'Converged',
                        trimResult.converged
                          ? `yes (${trimResult.planesEvaluated} planes)`
                          : `approx (${trimResult.planesEvaluated} planes)`,
                      )}

                      {sectionTitle('Form Coefficients')}
                      {statRow('Block Coeff (Cb)', fmt(trimResult.Cb, 4))}
                      {statRow('Prismatic Coeff (Cp)', fmt(trimResult.Cp, 4))}
                      {statRow('Midship Coeff (Cm)', fmt(trimResult.Cm, 4))}

                      {sectionTitle('Stability')}
                      {statRow('KB (Keel→Buoyancy)', `${fmt(trimResult.KB)} mm`)}
                      {statRow('BM (Metacentric Radius)', `${fmt(trimResult.BM)} mm`)}
                      {statRow('KM (Keel→Metacenter)', `${fmt(trimResult.KM)} mm`, true)}
                      {statRow('KG (Keel→Gravity)', `${fmt(trimResult.kgMm)} mm`)}
                      {statRow('GM (Metacentric Height)', `${fmt(trimResult.GM)} mm`, true)}

                      {sectionTitle('Righting Arm (GZ)')}
                      <ResponsiveContainer width="100%" height={180}>
                        <LineChart
                          data={trimResult.gzCurve.map((p) => ({
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
                            formatter={(value, name) => [
                              value != null ? `${fmt(Number(value))} mm` : '—',
                              name,
                            ]}
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
                    </dl>
                  ) : !draftError && !isCalculating ? (
                    <span className="text-zinc-500">No results yet.</span>
                  ) : null}
                </output>
              </section>
            </aside>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-md">
              <div className="mb-6 text-center">
                <h2 className="text-xl font-semibold text-zinc-200">No hull loaded yet</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Upload an STL of your kayak to inspect dimensions, volume and build quality before
                  hydrostatics.
                </p>
              </div>
              <Upload onLoaded={handleLoaded} />
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
