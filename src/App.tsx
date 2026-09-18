import { useCallback, useEffect, useRef, useState } from 'react';
import Upload, { type LoadedMesh } from './components/Upload';
import Viewer3D from './components/Viewer3D';
import {
  analyzeMesh,
  centerToOrigin,
} from './lib/geometry';
import {
  find_draft_0trim,
  type Draft0TrimResult,
} from './lib/hydrostatics';

const fmt = (v: number, digits = 1) =>
  v.toLocaleString('en-US', { maximumFractionDigits: digits });

function statRow(label: string, value: string, accent = false) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-400">{label}</dt>
      <dd className={`font-medium ${accent ? 'text-sky-300' : 'text-zinc-100'}`}>{value}</dd>
    </div>
  );
}

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array;
}

export default function App() {
  const [mesh, setMesh] = useState<LoadedMesh | null>(null);
  const [draftResult, setDraftResult] = useState<Draft0TrimResult | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [targetWeight, setTargetWeight] = useState(75); // kg, fresh water 1 kg = 1 L
  const calcToken = useRef(0);

  const handleLoaded = useCallback((next: LoadedMesh) => {
    setMesh((prev) => {
      if (prev) prev.geometry.dispose();
      return next;
    });
    // Invalidate stale hydrostatics immediately; the effect below recomputes.
    setDraftResult(null);
    setDraftError(null);
  }, []);

  const clear = useCallback(() => {
    setMesh((prev) => {
      prev?.geometry.dispose();
      return null;
    });
    setDraftResult(null);
    setDraftError(null);
  }, []);

  const runCalculation = useCallback(
    (weightKg: number, current: LoadedMesh) => {
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
            throw new Error(
              `Target weight must be > 0 kg (got ${String(weightKg)}).`,
            );
          }
          // Dynamic import would complicate types; call synchronously here.
          // find_draft_0trim throws on non-positive / over-capacity targets.
          const result = find_draft_0trim(positions, weightKg);
          if (calcToken.current !== token) return;
          setDraftResult(result);
          setDraftError(null);
        } catch (err) {
          if (calcToken.current !== token) return;
          setDraftResult(null);
          setDraftError(
            err instanceof Error ? err.message : 'Draft calculation failed.',
          );
        } finally {
          if (calcToken.current === token) setIsCalculating(false);
        }
      }, 30);
    },
    [],
  );

  // Reactivity: recompute (debounced) whenever the hull or target weight changes.
  const meshId = mesh?.id;
  useEffect(() => {
    if (!mesh) return;
    setDraftResult(null);
    setDraftError(null);
    const t = window.setTimeout(() => runCalculation(targetWeight, mesh), 350);
    return () => window.clearTimeout(t);
  }, [meshId, targetWeight, runCalculation]); // eslint-disable-line react-hooks/exhaustive-deps

  const calculateDraft = useCallback(() => {
    if (!mesh) {
      setDraftError('Load an STL hull first.');
      return;
    }
    runCalculation(targetWeight, mesh);
  }, [mesh, targetWeight, runCalculation]);

  const handleCenter = useCallback(() => {
    setMesh((prev) => {
      if (!prev) return prev;
      const positions = positionsOf(prev);
      centerToOrigin(positions);
      prev.geometry.getAttribute('position').needsUpdate = true;
      prev.geometry.computeVertexNormals();
      prev.geometry.computeBoundingBox();
      // Stats + bounds shown in the sidebar must reflect the moved vertices,
      // and the draft effect re-runs on the new id.
      const stats = analyzeMesh(positions);
      return { ...prev, id: Date.now(), stats };
    });
  }, []);

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
                  waterlineZ={draftResult?.waterlineZ ?? null}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 px-1 pb-1 pt-2">
                <span className="text-xs text-zinc-500">Orientation:</span>
                <button
                  type="button"
                  onClick={handleCenter}
                  className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100">
                  Center
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="rounded border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-zinc-100">
                  Clear hull
                </button>
                <span className="ml-auto truncate text-xs text-zinc-500" title={mesh.fileName}>
                  {mesh.fileName} · {fmt(s.bounds.size.x)} × {fmt(s.bounds.size.y)} × {fmt(s.bounds.size.z)} mm
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
                  {statRow('Triangles', `${fmt(s.triangleCount, 0)}`)}
                  {statRow(
                    'Watertight',
                    s.watertight.watertight ? 'yes' : `${s.watertight.openEdgeCount} open edges`,
                  )}
                </dl>
                <p className="mt-2 text-xs text-zinc-500" title={mesh.orientNote}>{mesh.orientNote}</p>
                <div className="mt-3">
                  <Upload onLoaded={handleLoaded} compact />
                </div>
              </section>

              <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <h2 className="mb-3 text-sm font-semibold text-zinc-200">Draft Calculation</h2>
                <label htmlFor="target-weight" className="mb-1 block text-xs text-zinc-400">
                  Target weight (kg) — paddler + gear + boat
                </label>
                <div className="flex items-center gap-2 mb-2">
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
                    className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
                    {isCalculating ? 'Calculating…' : 'Calculate Draft'}
                  </button>
                </div>
                {maxKg !== null && (
                  <p className="mb-2 text-xs text-zinc-500">
                    Hull capacity ≈ {fmt(maxKg)} kg (volume {fmt(maxKg)} L).
                  </p>
                )}
                {weightInvalid && (
                  <p className="mb-2 text-xs text-amber-400" role="note">{weightInvalid}</p>
                )}
                {isCalculating && (
                  <p className="mb-2 text-xs text-zinc-400" role="status" aria-live="polite">
                    Sweeping waterplanes in 1 mm steps…
                  </p>
                )}
                {draftError && (
                  <p className="mb-2 rounded border border-rose-900 bg-rose-950/50 p-2 text-xs text-rose-300" role="alert">
                    {draftError}
                  </p>
                )}
                <output className="block text-sm" id="draft-output" aria-live="polite">
                  {draftResult ? (
                    <dl className="space-y-1">
                      {statRow('Draft', `${fmt(draftResult.draftMm)} mm`, true)}
                      {statRow('Waterline Z', `${fmt(draftResult.waterlineZ)} mm`)}
                      {statRow('Displacement', `${fmt(draftResult.displacementKg)} kg`)}
                      {statRow('Target', `${fmt(draftResult.targetKg)} kg`)}
                      {statRow('Waterplane area', `${fmt(draftResult.waterplaneAreaMm2 / 1e6, 3)} m²`)}
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
                  Upload an STL of your kayak to inspect dimensions, volume and build quality before hydrostatics.
                </p>
              </div>
              <Upload onLoaded={handleLoaded} />
              <div className="mx-auto mt-4 max-w-md rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                <label htmlFor="target-weight-empty" className="mb-1 block text-xs text-zinc-400">
                  Target weight (kg) — applied once a hull is loaded
                </label>
                <input
                  id="target-weight-empty"
                  type="number"
                  min={0}
                  step="any"
                  value={Number.isFinite(targetWeight) ? targetWeight : ''}
                  onChange={(e) => setTargetWeight(Number(e.target.value))}
                  placeholder="e.g. 95"
                  className="w-full rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
