import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Upload, { type LoadedMesh } from './components/Upload'
import Viewer3D from './components/Viewer3D'
import {
  find_draft_0trim,
  solve_trim,
  type Draft0TrimResult,
  type TrimSolveResult,
} from './lib/hydrostatics'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const fmt = (v: number, digits = 1) =>
  v.toLocaleString('en-US', { maximumFractionDigits: digits });

function statRow(label: string, value: string | ReactNode, accent = false) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`font-medium ${accent ? 'text-sky-300' : 'text-zinc-100'}`}>{value}</dd>
    </div>
  );
}

function sectionTitle(title: string) {
  return (
    <div className="flex items-center gap-2 my-2">
      <span className="h-0.5 flex-1 bg-zinc-700" />
      <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">{title}</span>
      <span className="h-0.5 flex-1 bg-zinc-700" />
    </div>
  );
}

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array;
}

export default function App() {
  const [mesh, setMesh] = useState<LoadedMesh | null>(null);
  const [draftResult, setDraftResult] = useState<Draft0TrimResult | null>(null);
  const [trimResult, setTrimResult] = useState<TrimSolveResult | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [targetWeight, setTargetWeight] = useState(75); // kg, fresh water 1 kg = 1 L
  const [targetLcgPercent, setTargetLcgPercent] = useState(52); // % from bow
  const [showHeelInput, setShowHeelInput] = useState(false); // toggle for fixed heel input
  const [heelInputDeg, setHeelInputDeg] = useState(0); // fixed heel angle in degrees
  const calcToken = useRef(0);

  const handleLoaded = useCallback((next: LoadedMesh) => {
    setMesh((prev) => {
      if (prev) prev.geometry.dispose();
      return next;
    });
    // Invalidate stale hydrostatics immediately. No auto-calculation here —
    // the user must orient the hull then click "Calculate Draft".
    setDraftResult(null);
    setTrimResult(null);
    setDraftError(null);
  }, []);

  const runCalculation = useCallback(
    (weightKg: number, lcgPercent: number, heelDeg: number, current: LoadedMesh) => {
      const token = ++calcToken.current;
      setIsCalculating(true);
      setDraftError(null);
      // Yield one frame so the loading state paints before the (sync, heavy)
      // 1 mm sweep blocks the main thread.
      window.setTimeout(() => {
        if (calcToken.current !== token) return;
        try {
          const positions = positionsOf(current);
          if (positions.length === 0) {
            throw new Error('Empty mesh — the STL contained no triangles.');
          }
          if (!Number.isFinite(weightKg) || weightKg <= 0) {
            throw new Error(`Target weight must be > 0 kg (got ${String(weightKg)}).`);
          }
          const heelRad = (heelDeg * Math.PI) / 180;
          // First run zero-trim draft (with heel if set)
          const draft = find_draft_0trim(positions, weightKg, undefined, heelRad);
          if (calcToken.current !== token) return;
          setDraftResult(draft);

          // Then run full trim solver
          const trim = solve_trim(positions, weightKg, {
            targetLcgPercentFromBow: lcgPercent,
            maxTrimDeg: 4.5,
            trimStepDeg: 0.1,
            fixedHeelDeg: heelDeg,
          });
          if (calcToken.current !== token) return;
          setTrimResult(trim);
          setDraftError(null);
        } catch (err) {
          if (calcToken.current !== token) return;
          setDraftResult(null);
          setTrimResult(null);
          setDraftError(err instanceof Error ? err.message : 'Draft calculation failed.');
        } finally {
          if (calcToken.current === token) setIsCalculating(false);
        }
      }, 30);
    },
    [],
  );

  // Clear stale results when hull changes — DO NOT auto-calculate.
  // User must click "Calculate Draft" after rotating / setting weight / LCG.
  const meshId = mesh?.id;
  useEffect(() => {
    if (!mesh) return;
    setDraftResult(null);
    setTrimResult(null);
    setDraftError(null);
    // NOTE: no auto-run here. User must click "Calculate Draft" after rotating.
  }, [meshId, mesh]);

  const calculateDraft = useCallback(() => {
    if (!mesh) {
      setDraftError('Load an STL hull first.');
      return;
    }
    const appliedHeel = showHeelInput ? heelInputDeg : 0;
    runCalculation(targetWeight, targetLcgPercent, appliedHeel, mesh);
  }, [mesh, targetWeight, targetLcgPercent, showHeelInput, heelInputDeg, runCalculation]);

    const s = mesh?.stats;
  const maxKg = s ? s.volumeLiters : null;
  const weightInvalid =
    !Number.isFinite(targetWeight) || targetWeight <= 0
      ? 'Enter a weight above 0 kg.'
      : maxKg !== null && targetWeight > maxKg
        ? `Heavier than the hull's ${fmt(maxKg)} L volume — it would sink.`
        : null;

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
                                  waterlineZ={trimResult?.waterlineZ ?? draftResult?.waterlineZ ?? null}
                                  trimDeg={-(trimResult?.trimDeg ?? 0)}
                                  heelDeg={trimResult?.heelDeg ?? draftResult?.heelDeg ?? (showHeelInput ? heelInputDeg : 0)}
                                  waterlineCenterY={trimResult?.lcg.y ?? 0}
                                  lcg={trimResult?.lcg ?? null}
                                  lcb={trimResult?.lcb ?? draftResult?.lcb ?? null}
                                  pivot={trimResult?.pivot ?? null}
                                  rotateHull={true}
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
                <div className="mt-3">
                  <Upload onLoaded={handleLoaded} compact />
                </div>
              </section>

              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-zinc-200">Draft Calculation</h2>
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
                    onClick={calculateDraft}
                    disabled={isCalculating || !mesh}
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

                <div className="mb-4 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div className={`w-8 h-4 rounded-full transition-colors border border-zinc-700 ${showHeelInput ? 'bg-blue-600 border-blue-400' : 'bg-zinc-800'}`}>
                      <div className={`w-3 h-3 m-0.5 rounded-full bg-white transition-transform ${showHeelInput ? 'translate-x-4' : 'translate-x-0'}`} />
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={showHeelInput}
                      onChange={(e) => setShowHeelInput(e.target.checked)}
                    />
                    <span className="text-xs text-zinc-400 group-hover:text-zinc-300">Set fixed heel angle</span>
                  </label>

                  {showHeelInput && (
                    <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                      <label htmlFor="heel-input" className="mb-1 block text-xs text-zinc-400">
                        Heel angle (°) — positive = starboard down
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
                        <span className="text-xs font-mono text-zinc-300 w-8 text-right">{heelInputDeg}°</span>
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
                  <p className="mb-2 text-xs text-zinc-400" role="status" aria-live="polite">
                    Sweeping waterplanes in 1 mm steps…
                  </p>
                )}
                {draftError && (
                  <p
                    className="mb-2 rounded border border-rose-900 bg-rose-950/50 p-2 text-xs text-rose-300"
                    role="alert"
                  >
                    {draftError}
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
                                      {statRow('Waterplane area', `${fmt(trimResult.waterplaneAreaMm2 / 1e6, 3)} m²`)}
                                      {statRow('Waterline length (LWL)', `${fmt(trimResult.LWL)} mm`)}
                                      {statRow('Waterline beam (BWL)', `${fmt(trimResult.BWL)} mm`)}
                                                                            {statRow('LCG X', `${fmt(trimResult.lcg.x)} mm`)}
                                                                            {statRow('LCB X', `${fmt(trimResult.lcb.x)} mm`)}
                                                                            {statRow('LCB–LCG offset', `${fmt(trimResult.lcbLcgOffsetMm)} mm`, true)}
                                                                            {statRow('Bow freeboard', `${fmt(trimResult.bowFreeboardMm)} mm`)}
                                                                                                                                                                                                                                    {statRow('Stern freeboard', `${fmt(trimResult.sternFreeboardMm)} mm`)}
                                                                                                                                                                                                                                    {trimResult.heelDeg !== 0 && statRow('Fixed heel angle', `${trimResult.heelDeg >= 0 ? '+' : ''}${fmt(trimResult.heelDeg)}°`, true)}
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
                                            label={{ value: 'Heel (°)', position: 'insideRight', offset: -10, fill: '#71717a', fontSize: 10 }}
                                          />
                                          <YAxis
                                            type="number"
                                            tick={{ fill: '#71717a', fontSize: 10 }}
                                            axisLine={{ stroke: '#52525b' }}
                                            label={{ value: 'GZ (mm)', angle: -90, position: 'insideLeft', offset: 10, fill: '#71717a', fontSize: 10 }}
                                          />
                                          <Tooltip
                                                                      contentStyle={{
                                                                        backgroundColor: '#18181b',
                                                                        border: '1px solid #3f3f46',
                                                                        borderRadius: '4px',
                                                                        color: '#fafafa',
                                                                      }}
                                                                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                                                      formatter={(value: any, name: any) => [value != null ? `${fmt(value)} mm` : '—', name]}
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
                                  ) : draftResult ? (
                                    <dl className="space-y-1">
                                      {statRow('Draft', `${fmt(draftResult.draftMm)} mm`, true)}
                                      {statRow('Waterline Z', `${fmt(draftResult.waterlineZ)} mm`)}
                                      {statRow('Displacement', `${fmt(draftResult.displacementKg)} kg`)}
                                      {statRow('Target', `${fmt(draftResult.targetKg)} kg`)}
                                      {statRow(
                                                                              'Waterplane area',
                                                                              `${fmt(draftResult.waterplaneAreaMm2 / 1e6, 3)} m²`,
                                                                            )}
                                                                            {statRow('Bow freeboard', `${fmt(draftResult.bowFreeboardMm)} mm`)}
                                                                            {statRow('Stern freeboard', `${fmt(draftResult.sternFreeboardMm)} mm`)}
                                                                            {statRow(
                                        'Converged',
                                        draftResult.converged
                                          ? `yes (${draftResult.planesEvaluated} planes)`
                                          : `approx (${draftResult.planesEvaluated} planes)`,
                                      )}
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
                  Upload an STL of your kayak to inspect dimensions, volume and build quality
                  before hydrostatics.
                </p>
              </div>
              <Upload onLoaded={handleLoaded} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
