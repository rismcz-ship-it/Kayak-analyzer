import { useCallback, useEffect, useRef, useState } from 'react'
import AnalyzeStage from './components/AnalyzeStage'
import CompareView from './components/CompareView'
import ConditionsPanel from './components/ConditionsPanel'
import Rail, { type TabKey } from './components/Rail'
import ResultsPanel from './components/ResultsPanel'
import { type LoadedMesh, rememberMesh, rescaleMesh } from './components/Upload'
import {
  addRosterRecord,
  canonicalRecord,
  deleteRecord,
  type RunRecord,
  readRoster,
  recordFromSolve,
  rosterWriteRisk,
  writeRoster,
} from './lib/compare'
import { fmt } from './lib/format'
import type { TrimSolveResult } from './lib/hydrostatics'
import {
  encodeStoredInputs,
  INPUTS_STORAGE_KEY,
  type InputFields,
  parseInputs,
  readStoredInputs,
} from './lib/inputs'
import { MAX_TRIM_DEG, TRIM_STEP_DEG } from './lib/solve-params'
import { SolverClient } from './lib/solver-client'

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array
}

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

  // Which surface is on screen. Both tabs stay MOUNTED for the whole session
  // (the main block below hides one with display:none): a tab's state - the
  // Compare slots above all - dies with its component, and a remount on every
  // switch wiped it. The price is deliberate: two live WebGL contexts, and a
  // hidden tab's render loop keeps running (painting the same frame) instead
  // of being torn down.
  const [tab, setTab] = useState<TabKey>('analyze')
  // The Compare tab's roster: the only Compare state that outlives a reload.
  // Records are immutable snapshots, and the roster de-duplicates by the run's
  // CONTENT: the same run arriving twice (a re-import, a re-solve of the same
  // conditions) keeps ONE entry, and the entry already there keeps its id.
  const [roster, setRoster] = useState<RunRecord[]>(() =>
    readRoster((key) => localStorage.getItem(key)),
  )
  // The same array in a ref, so `addRecord`/`removeRecord` can read it while
  // they are also replacing it. A `setRoster(prev => ...)` updater alone cannot
  // answer WITH the entry it stored — the updater's return is the next state,
  // not a value the caller can use — and the Compare import needs that answer
  // to point a slot at the record the roster actually kept. Keeping the ref in
  // step with the state (and the initial state with the ref) is what makes the
  // answer true.
  const rosterRef = useRef<RunRecord[]>(roster)

  const addRecord = useCallback((record: RunRecord) => {
    const next = addRosterRecord(rosterRef.current, record)
    rosterRef.current = next
    setRoster(next)
    // The entry the roster KEEPS: the stored one when this run is already
    // there (it keeps its id, so every slot that picked it still resolves).
    return canonicalRecord(next, record)
  }, [])

  const removeRecord = useCallback((id: string) => {
    const next = deleteRecord(rosterRef.current, id)
    rosterRef.current = next
    setRoster(next)
  }, [])

  /**
   * A roster write that failed (private mode, quota) is SURFACED, not
   * swallowed: the runs stay in memory and the app keeps working, but a saved
   * run that silently never persisted is a lie the user finds out about at the
   * next reload. The cause travels with the warning - a quota error and a
   * refused write mean very different things to whoever reads it.
   */
  const [rosterError, setRosterError] = useState<string | null>(null)
  // The ids the last SUCCESSFUL write put in storage, seeded from the restored
  // roster (which came out of storage). "Nothing to lose" is a question about
  // ids, not lengths: a restored roster that cannot be re-written is NOT lost
  // on reload, and the old length comparison said it was. A refusal right
  // after a REMOVAL is the opposite - `writeRoster` always writes, so the
  // deleted runs are still stored and come back on reload, and only this
  // banner can say so.
  const persistedIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    // First run: whatever `readRoster` restored is what storage holds.
    const known = persistedIds.current ?? new Set(roster.map((record) => record.id))
    persistedIds.current = known
    try {
      writeRoster(roster, (key, value) => localStorage.setItem(key, value))
      persistedIds.current = new Set(roster.map((record) => record.id))
      setRosterError(null)
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err)
      const risk = rosterWriteRisk(
        roster.map((record) => record.id),
        known,
      )
      if (risk.kind === 'deletion') {
        setRosterError(
          `This browser refused to save the run roster — the deletion did not stick, so the runs you removed are still stored and will come back on reload. (${cause})`,
        )
      } else if (risk.kind === 'volatile') {
        const which =
          risk.count === 1 ? 'the run you just added is' : `${risk.count} runs you just added are`
        setRosterError(
          `This browser refused to save the run roster — ${which} in memory only and will be lost on reload. (${cause})`,
        )
      } else {
        // Every record on screen is already stored, so a refusal lost nothing.
        setRosterError(null)
      }
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

  // The one gate the Calculate button and the run share: a hull, a closed one,
  // three usable numbers, and no solve already in flight.
  const canCalculate =
    mesh !== null && s?.watertight.watertight === true && inputError === null && !isCalculating

  return (
    <div className="flex h-full overflow-hidden">
      <Rail tab={tab} onTab={setTab} />
      <main className="flex min-w-0 flex-1 flex-col">
        {/*
          The roster warning sits ABOVE both tabs on purpose: it is raised by
          the ANALYZE tab (every home solve auto-rosters its run), so a Compare
          -only banner tells the user about a loss they have already caused,
          only once they happen to switch. */}
        {rosterError && (
          <p
            className="shrink-0 border-b border-warn/40 bg-warn/10 px-4 py-2 text-[11px] text-warn"
            role="status"
          >
            {rosterError}
          </p>
        )}
        {/*
          Both tabs stay MOUNTED for the whole session - switching only hides
          one. A tab's state dies with its component (the Compare slots, their
          loaded hulls and live solves, above all), so the old conditional
          render wiped everything on every switch. A hidden tab costs one
          idle render loop; its ResizeObserver re-fits it when shown again.
        */}
        <div className={tab === 'analyze' ? 'flex min-h-0 flex-1 flex-col lg:flex-row' : 'hidden'}>
          <AnalyzeStage
            mesh={mesh}
            result={trimResult}
            heelDeg={inputs.showHeelInput ? inputs.heelDeg : 0}
            onLoaded={handleLoaded}
          />
          <ConditionsPanel
            inputs={inputs}
            parsed={parsedInputs}
            onChange={(patch) => setInputs((prev) => ({ ...prev, ...patch }))}
            onCalculate={calculateDraft}
            onCancel={cancelCalculation}
            isCalculating={isCalculating}
            progress={progress}
            canCalculate={canCalculate}
            hasMesh={mesh !== null}
            watertight={s?.watertight.watertight ?? true}
            openEdgeCount={s?.watertight.openEdgeCount ?? 0}
            draftError={draftError}
            weightOverCapacity={weightOverCapacity}
            kgAboveDeck={kgAboveDeck}
            scaleAdvice={mesh?.scaleAdvice}
            maxDim={maxDim}
            onApplyScale={applyScale}
          >
            <ResultsPanel result={trimResult} mesh={mesh} solving={isCalculating} />
          </ConditionsPanel>
        </div>
        <div className={tab === 'compare' ? 'flex min-h-0 flex-1 flex-col p-4' : 'hidden'}>
          <CompareView
            roster={roster}
            onAddRecord={addRecord}
            onDeleteRecord={removeRecord}
            meshCache={meshCacheRef.current}
          />
        </div>
      </main>
    </div>
  )
}
