import { useCallback, useEffect, useRef, useState } from 'react'
import CompareView from './components/CompareView'
import ResultsPanel, { statRow } from './components/ResultsPanel'
import Upload, { type LoadedMesh, rememberMesh, rescaleMesh } from './components/Upload'
import Viewer3D from './components/Viewer3D'
import {
  deleteRecord,
  type RunRecord,
  readRoster,
  recordFromSolve,
  writeRoster,
} from './lib/compare'
import { fmt } from './lib/format'
import type { TrimSolveResult } from './lib/hydrostatics'
import {
  encodeStoredInputs,
  HEEL_MAX,
  HEEL_MIN,
  INPUTS_STORAGE_KEY,
  type InputFields,
  parseInputs,
  readStoredInputs,
  scaleNotice,
} from './lib/inputs'
import { MAX_TRIM_DEG, TRIM_STEP_DEG } from './lib/solve-params'
import { SolverClient } from './lib/solver-client'

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array
}

/** The two surfaces in this app; `analyze` is the home single-hull flow. */
const TABS = ['analyze', 'compare'] as const
type TabKey = (typeof TABS)[number]
const TAB_LABELS: Record<TabKey, string> = { analyze: 'Analyze', compare: 'Compare' }

export default function App() {
  const [mesh, setMesh] = useState<LoadedMesh | null>(null)
  const [trimResult, setTrimResult] = useState<TrimSolveResult | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // Raw strings: what the user typed is state, the numbers are derived from
  // it. That is what stops an empty field becoming 0. The reader is built here,
  // not inside the module, so a browser whose storage throws on ACCESS still
  // throws inside the module's own try/catch and the boot survives.
  const [inputs, setInputs] = useState<InputFields>(() =>
    readStoredInputs((key) => localStorage.getItem(key)),
  )
  const parsedInputs = parseInputs(inputs)
  const weightKg = parsedInputs.weightKg
  const lcgPercent = parsedInputs.lcgPercent
  const kgMm = parsedInputs.kgMm
  const inputError = parsedInputs.inputError

  // Persist the valid values whenever they change. An incomplete form keeps
  // the last good set rather than writing the empty one. Storage can throw
  // (private mode, quota) and the app works identically without it, so the
  // failure is swallowed here and nowhere else. What gets written — including
  // the applied heel rather than the slider's leftover — is `encodeStoredInputs`
  // in `lib/inputs.ts`, where `verify-inputs.ts` can reach it.
  useEffect(() => {
    const record = encodeStoredInputs({
      weightKg,
      lcgPercent,
      kgMm,
      heelDeg: inputs.heelDeg,
      showHeelInput: inputs.showHeelInput,
    })
    if (record === null) return
    try {
      localStorage.setItem(INPUTS_STORAGE_KEY, record)
    } catch {
      // No localStorage, or it is full: carry on without memory.
    }
  }, [weightKg, lcgPercent, kgMm, inputs.showHeelInput, inputs.heelDeg])

  const calcToken = useRef(0)
  const clientRef = useRef<SolverClient | null>(null)
  const mountedRef = useRef(true)

  // Which surface is on screen. Only one 3D canvas is ever mounted: the home
  // viewer and the compare overlay are alternatives, not neighbours, so
  // switching tabs tears the other context down instead of paying for two.
  const [tab, setTab] = useState<TabKey>('analyze')
  // The Compare tab's roster: the only Compare state that outlives a reload.
  // Records are immutable snapshots, so an id that arrives twice (a re-import
  // of a record already in the roster) replaces rather than duplicates.
  const [roster, setRoster] = useState<RunRecord[]>(() =>
    readRoster((key) => localStorage.getItem(key)),
  )

  const addRecord = useCallback((record: RunRecord) => {
    setRoster((prev) => [record, ...prev.filter((entry) => entry.id !== record.id)])
  }, [])

  const removeRecord = useCallback((id: string) => {
    setRoster((prev) => deleteRecord(prev, id))
  }, [])

  // Same swallow-the-throw rule as the inputs above: a browser with no usable
  // storage simply runs without a roster, and the Compare tab still works.
  useEffect(() => {
    try {
      writeRoster(roster, (key, value) => localStorage.setItem(key, value))
    } catch {
      // No localStorage, or it is full: carry on without memory.
    }
  }, [roster])

  /**
   * The session's `modelHash -> mesh` cache, SHARED by both tabs.
   *
   * The Map is created once and never replaced, so `meshCacheRef.current` is a
   * stable object for the component's whole life — safe to pass as a prop and
   * to name in a dependency list. It is filled on every successful home solve
   * (below) and on every Compare slot's re-pick (`rememberMesh` in both
   * places, which also bounds its size), and it dies with the session, exactly
   * as a record does: a reloaded roster shows its numbers and asks for its STL.
   */
  const meshCacheRef = useRef<Map<string, LoadedMesh>>(new Map())

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
              // The documented sweep, from the shared constants
              // (`src/lib/solve-params.ts`) the Compare slots import too: one
              // literal, so the two flows can never drift onto the solver's
              // narrower +-3.5 degrees fallback.
              maxTrimDeg: MAX_TRIM_DEG,
              trimStepDeg: TRIM_STEP_DEG,
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
              // The hull is now identified in the session cache, so picking
              // this solve's record in the Compare tab shows the overlay
              // without a re-upload.
              rememberMesh(meshCacheRef.current, current)
              // Auto-roster (design spec Part 1): every successful home solve
              // leaves a record behind; deleting stays manual. The inputs are
              // this run's OWN four values — the applied heel included — so
              // the record reproduces the result sitting beside it. An empty
              // hash means the page could not hash the file, so the record
              // could never be matched to its STL again and none is written.
              if (current.sha256Hex !== '') {
                try {
                  addRecord(
                    recordFromSolve(
                      current.fileName,
                      current.sha256Hex,
                      { weightKg, lcgPctLwl: lcgPercent, kgMm, heelDeg },
                      trim,
                    ),
                  )
                } catch {
                  // The roster is auxiliary: the solve succeeded and its
                  // numbers are on screen. The values reaching this path are
                  // the form's own parsed ones (Calculate is gated on them),
                  // so this only ever fires on a refusal the form already
                  // blocks — and an unwritten record costs nothing.
                }
              }
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
    [addRecord],
  )

  const calculateDraft = useCallback(() => {
    if (!mesh) {
      setDraftError('Load an STL hull first.')
      return
    }
    // Belt and braces with the disabled button. The values are non-null here
    // exactly when the button is enabled, so this branch only runs if the
    // form is called by something else.
    if (weightKg === null || lcgPercent === null || kgMm === null) {
      setDraftError(inputError ?? 'The inputs must be numbers.')
      return
    }
    const appliedHeel = inputs.showHeelInput ? inputs.heelDeg : 0
    runCalculation(weightKg, lcgPercent, kgMm, appliedHeel, mesh)
  }, [
    mesh,
    inputs.showHeelInput,
    inputs.heelDeg,
    weightKg,
    lcgPercent,
    kgMm,
    inputError,
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

  // Warnings, not errors: both still produce a solve, just one whose numbers
  // nobody should trust. Neither blocks Calculate, per the plan.
  const weightOverCapacity =
    weightKg !== null && maxKg !== null && weightKg > maxKg
      ? `Heavier than the hull's ${fmt(maxKg)} L volume — it would sink.`
      : null
  // KG is a height above the keel, so the hull's depth is the only ceiling
  // that means anything, and it is read from this mesh rather than assumed.
  const kgAboveDeck =
    kgMm !== null && s !== undefined && kgMm > s.bounds.size.z
      ? `KG ${fmt(kgMm)} mm is above the deck (${fmt(s.bounds.size.z)} mm of hull) — GM stops meaning anything up there.`
      : null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-100">kayak-analyzer</h1>
            <p className="text-xs text-zinc-500">
              Static float + stability viewer — school project
            </p>
          </div>
          <nav aria-label="Mode" className="flex items-center gap-1">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                aria-current={tab === key ? 'page' : undefined}
                onClick={() => setTab(key)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  tab === key
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                }`}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </nav>
        </div>
        <span className="hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          STL stays in memory · max 25 MB
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        {tab === 'compare' ? (
          <CompareView
            roster={roster}
            onAddRecord={addRecord}
            onDeleteRecord={removeRecord}
            meshCache={meshCacheRef.current}
          />
        ) : mesh && s ? (
          <div className="flex flex-col min-h-0 flex-1 gap-4 lg:flex-row">
            {/*
             * flex-none below lg, on purpose: in this column flex a non-auto basis (flex-1 =
             * 1 1 0%) overrides h-[45vh] and, with min-h-0, lets the viewer collapse to 0 px
             * once the aside fills the row. At lg the row is a flex-row again and lg:flex-1 +
             * lg:h-auto restore the old stretch-to-fill height.
             */}
            <section className="flex min-h-0 h-[45vh] min-w-0 flex-none flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 lg:h-auto lg:flex-1">
              <div className="min-h-0 flex-1">
                <Viewer3D
                  key={mesh.id}
                  geometry={mesh.geometry}
                  waterlineZ={trimResult?.waterlineZ ?? null}
                  trimDeg={trimResult?.trimDeg ?? 0}
                  heelDeg={trimResult?.heelDeg ?? (inputs.showHeelInput ? inputs.heelDeg : 0)}
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

            <aside className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto lg:w-80 lg:shrink-0">
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
                    type="text"
                    inputMode="decimal"
                    value={inputs.weightInput}
                    onChange={(e) =>
                      setInputs((prev) => ({ ...prev, weightInput: e.target.value }))
                    }
                    placeholder="Enter Target Weight (kg)"
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                  />
                  <button
                    type="button"
                    onClick={calculateDraft}
                    disabled={isCalculating || inputError !== null || !s.watertight.watertight}
                    className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCalculating ? 'Calculating…' : 'Calculate Draft'}
                  </button>
                </div>
                {/* A disabled button explains itself: each reason sits under
                    the control it names, not in a tooltip nobody can read. */}
                {parsedInputs.weightError && (
                  <p className="mb-3 text-xs text-rose-300" role="alert">
                    {parsedInputs.weightError}
                  </p>
                )}
                <label htmlFor="target-lcg" className="mb-1 block text-xs text-zinc-400">
                  LCG from bow (%) — 52% = midship
                </label>
                <div className="mb-4 flex items-center gap-2">
                  <input
                    id="target-lcg"
                    type="text"
                    inputMode="decimal"
                    value={inputs.lcgInput}
                    onChange={(e) => setInputs((prev) => ({ ...prev, lcgInput: e.target.value }))}
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                  />
                </div>
                {parsedInputs.lcgError && (
                  <p className="mb-3 -mt-2 text-xs text-rose-300" role="alert">
                    {parsedInputs.lcgError}
                  </p>
                )}
                <label htmlFor="target-kg" className="mb-1 block text-xs text-zinc-400">
                  KG above keel (mm) — sets GM
                </label>
                <div className="mb-4 flex items-center gap-2">
                  <input
                    id="target-kg"
                    type="text"
                    inputMode="decimal"
                    value={inputs.kgInput}
                    onChange={(e) => setInputs((prev) => ({ ...prev, kgInput: e.target.value }))}
                    className="w-32 rounded border border-zinc-700 bg-zinc-800 p-2 text-white"
                  />
                  <span className="text-xs text-zinc-500">
                    height above the keel, not an absolute Z
                  </span>
                </div>
                {parsedInputs.kgError && (
                  <p className="mb-3 -mt-2 text-xs text-rose-300" role="alert">
                    {parsedInputs.kgError}
                  </p>
                )}
                {kgAboveDeck && (
                  <p className="mb-3 -mt-2 text-xs text-amber-400" role="note">
                    {kgAboveDeck}
                  </p>
                )}

                <div className="mb-4 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div
                      className={`w-8 h-4 rounded-full transition-colors border border-zinc-700 ${inputs.showHeelInput ? 'bg-blue-600 border-blue-400' : 'bg-zinc-800'}`}
                    >
                      <div
                        className={`w-3 h-3 m-0.5 rounded-full bg-white transition-transform ${inputs.showHeelInput ? 'translate-x-4' : 'translate-x-0'}`}
                      />
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={inputs.showHeelInput}
                      onChange={(e) =>
                        setInputs((prev) => ({ ...prev, showHeelInput: e.target.checked }))
                      }
                    />
                    <span className="text-xs text-zinc-400 group-hover:text-zinc-300">
                      Set fixed heel angle
                    </span>
                  </label>

                  {inputs.showHeelInput && (
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
                          min={HEEL_MIN}
                          max={HEEL_MAX}
                          step={1}
                          value={inputs.heelDeg}
                          onChange={(e) =>
                            setInputs((prev) => ({ ...prev, heelDeg: Number(e.target.value) }))
                          }
                          className="flex-1 h-1.5 bg-zinc-700 appearance-none rounded-lg cursor-pointer accent-blue-500"
                        />
                        <span className="text-xs font-mono text-zinc-300 w-8 text-right">
                          {inputs.heelDeg}°
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
                {weightOverCapacity && (
                  <p className="mb-2 text-xs text-amber-400" role="note">
                    {weightOverCapacity}
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
                    <ResultsPanel result={trimResult} />
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
