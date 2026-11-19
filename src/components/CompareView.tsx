import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  type CompareOverlaySlot,
  columnIsStale,
  compareOverlayCaption,
  parseRunRecordImport,
  poseIsForeign,
  type RunRecord,
  type SlotInputs,
} from '../lib/compare'
import type { TrimSolveResult } from '../lib/hydrostatics'
import { DEFAULT_KG_MM } from '../lib/hydrostatics'
import {
  HEEL_MAX,
  HEEL_MIN,
  heelUsable,
  KG_MAX,
  KG_MIN,
  kgUsable,
  LCG_MAX,
  LCG_MIN,
  lcgUsable,
  WEIGHT_MAX,
  WEIGHT_MIN,
  weightUsable,
} from '../lib/inputs'
import { SlotSolver } from '../lib/slot-solver'
import CompareTable, { type CompareColumn } from './CompareTable'
import SlotPanel from './SlotPanel'
import { type LoadedMesh, rememberMesh } from './Upload'
import {
  applySharedWaterSurface,
  applySlotResultToScene,
  disposeSlotScene,
  makeSlotScene,
  SLOT_COLORS,
  type SlotScene,
  type ViewerView,
} from './Viewer3D'

/**
 * The Compare tab: two live slots over one shared waterline, the table that
 * compares their numbers, and the only Compare state that outlives a reload is
 * the roster, which its parent owns.
 *
 * What lives here rather than in the panels:
 *
 *  - the slot state itself, because two slots, the table and the overlay all
 *    read the same slot and must never hold two copies of it;
 *  - one `SlotSolver` per slot (`lib/slot-solver.ts`), so editing slot A can
 *    never cancel slot B's worker;
 *  - the slot logic over ONE session-wide geometry cache, which App owns and
 *    shares with the home tab (keyed by the STL's hash): a slot shows the
 *    overlay when it has its mesh, and shows its numbers and asks for the STL
 *    when it does not. It dies with the session, exactly as a record does.
 */
/**
 * Pinned here for Task 7's wire-in (the plan's Step 1 asks for the final
 * shape). App owns the roster, the storage writers and ONE session-wide
 * geometry cache; this component owns the slots and nothing above them.
 */
interface CompareViewProps {
  roster: RunRecord[]
  /**
   * Add a record to the roster and answer with the entry the roster KEEPS.
   *
   * The answer is the STORED entry when the run is already there (it keeps
   * its id), so the slot this fills always points at a record the roster
   * holds - never at the newcomer's id, which the roster may drop.
   */
  onAddRecord: (record: RunRecord) => RunRecord
  onDeleteRecord: (id: string) => void
  /**
   * The session's `modelHash -> mesh` cache, SHARED with the home tab.
   *
   * The Map object itself is stable for App's lifetime (it is never replaced),
   * so it is safe to name in a dependency list. A record's mesh is here when
   * its hull was solved at home this session; a re-pick adds to it through
   * `rememberMesh`, which also bounds its size.
   */
  meshCache: Map<string, LoadedMesh>
}

/** What one slot holds: which record it shows, its mesh, and its own solve. */
export interface SlotState {
  recordId: string | null
  /**
   * Present only when the mesh cache carries this record's modelHash.
   *
   * It may be a DIFFERENT file from the record's: the re-pick path's explicit
   * "Use anyway" choice, which is why every displayed pair records the
   * conditions it was actually solved at (`liveInputs`).
   */
  mesh: LoadedMesh | null
  /** Adopted (a copy) from the record on pick; editable afterwards. */
  inputs: SlotInputs
  /** The live solve result; null until a solve has answered this session. */
  live: TrimSolveResult | null
  /**
   * The conditions `live` was solved at - null exactly when `live` is null.
   *
   * An edit does not drop `live` (the table would go blank mid-typing), so
   * `inputs` move on while `live` still answers to the OLD ones. Every
   * consumer that shows the pair together - the table, the conditions note,
   * the export - reads the result's own conditions, never the edited ones.
   */
  liveInputs: SlotInputs | null
  solving: boolean
  progress: { done: number; total: number } | null
  error: string | null
  /**
   * Bumped on every pick so the panel remounts: re-picking the record a slot
   * already shows must reset its field strings to that record's own values,
   * and a key on the record id alone does not change on a re-pick.
   */
  pickSeq: number
}

/** ~300 ms of quiet between an edit and the re-solve it triggers. */
const SOLVE_DEBOUNCE_MS = 300

/**
 * Both hulls are translucent by design (`makeSlotScene`): the overlay's whole
 * point is that each stays visible through the other.
 */
const SLOT_OPACITY = 0.55

/** The single viewer's 3/4 bow direction, never mutated (addScaledVector). */
const VIEW_DIR = new THREE.Vector3(1, -1.1, 0.55).normalize()

const EMPTY_VIEW: ViewerView = {
  waterlineZ: null,
  trimDeg: 0,
  heelDeg: 0,
  lcg: null,
  lcb: null,
  pivot: null,
}

function emptySlot(): SlotState {
  return {
    recordId: null,
    mesh: null,
    // The documented defaults: they only ever surface through a slot that has
    // no record, and no such slot has numbers to solve.
    inputs: { weightKg: 75, lcgPctLwl: 52, kgMm: DEFAULT_KG_MM, heelDeg: 0 },
    live: null,
    liveInputs: null,
    solving: false,
    progress: null,
    error: null,
    pickSeq: 0,
  }
}

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array
}

/** A slot badge's fill as a CSS colour, shared by the panels and the roster list. */
function slotColorHex(index: 0 | 1): string {
  return `#${SLOT_COLORS[index].toString(16).padStart(6, '0')}`
}

/**
 * The form's own gate, reused so a slot can never re-solve at a value the home
 * tab's Calculate button would refuse. The messages are the `parseInputs`
 * strings, so the two surfaces cannot disagree about the rules.
 */
function inputsProblem(inputs: SlotInputs): string | null {
  if (!weightUsable(inputs.weightKg)) return `Target weight must be ${WEIGHT_MIN}–${WEIGHT_MAX} kg.`
  if (!lcgUsable(inputs.lcgPctLwl)) return `LCG must be ${LCG_MIN}–${LCG_MAX} %.`
  if (!kgUsable(inputs.kgMm)) return `KG must be above ${KG_MIN} mm and at most ${KG_MAX} mm.`
  if (!heelUsable(inputs.heelDeg)) return `Heel must be ${HEEL_MIN}–${HEEL_MAX}°.`
  return null
}

/** The viewer-seam's view of a result: the pose fields and nothing else. */
function viewOf(result: TrimSolveResult | null): ViewerView {
  if (!result) return EMPTY_VIEW
  return {
    waterlineZ: result.waterlineZ,
    trimDeg: result.trimDeg,
    heelDeg: result.heelDeg,
    lcg: result.lcg,
    lcb: result.lcb,
    pivot: result.pivot,
  }
}

/**
 * What one slot contributes to the overlay, from the two facts the picture is
 * built from: an STL in memory and a result to pose it with.
 *
 * The overlay draws a hull only with BOTH, so a slot holding a record but no
 * STL in memory shows its numbers in the table and nothing at all here.
 *
 * And a drawn hull is not automatically a solved one: with a foreign STL in
 * memory the slot still DISPLAYS the record's snapshot over it until the new
 * hull's own solve lands, so that pair is `foreign-pose` — drawn, but posed
 * with numbers solved on a hull the file is not known to be.
 */
function overlaySlot(hasMesh: boolean, hasResult: boolean, foreign: boolean): CompareOverlaySlot {
  if (hasMesh && hasResult) return foreign ? 'foreign-pose' : 'shown'
  if (hasMesh) return 'loaded'
  if (hasResult) return 'record-only'
  return 'empty'
}

/**
 * Is this slot's drawn geometry posed with a result solved from a DIFFERENT
 * hull? The same predicate the panel's own `foreignGeometry` note uses, from
 * `compare.ts` so the two cannot drift apart — including the empty-hash rule,
 * which the caption's "both hulls on one waterline" line depends on.
 */
function foreignPose(slot: SlotState, record: RunRecord | null): boolean {
  return poseIsForeign(slot.mesh?.sha256Hex ?? null, record?.modelHash ?? null, slot.live !== null)
}

/**
 * Is this slot's displayed answer out of date with its own conditions?
 *
 * Two ways to be out of date, and the table says so in both: a re-solve is in
 * flight, or the conditions have moved on and the new solve has not answered
 * yet (the ~300 ms debounce, and the frame before the solver even starts).
 * The test is the LIVE answer's own conditions against the slot's current
 * ones - never the numbers being typed into, which are the slot's `inputs`.
 */
function columnStale(slot: SlotState): boolean {
  return columnIsStale(slot.liveInputs, slot.solving, slot.inputs)
}

/**
 * One slot's live solve session.
 *
 * An edit schedules a re-solve ~300 ms later; the next edit cancels the run
 * that was in flight, and only THAT slot's — the other keeps its worker. A
 * `cancelled` rejection is swallowed rather than shown: it is this hook's own
 * supercession, and its replacement run already owns the status line.
 *
 * When the slot's inputs fall outside the form's gate the slot stops solving
 * and DROPS its live result, so what stays on screen is the record's own
 * labelled snapshot rather than a number that no longer answers to the
 * conditions being edited. An open (non-watertight) hull is the same kind of
 * stop, checked first: it names the open-edge count instead of an input.
 */
function useSlotSolve(
  slot: SlotState,
  setSlot: Dispatch<SetStateAction<SlotState>>,
  solver: SlotSolver,
) {
  // The four usable inputs, destructured so the effect's captures ARE its
  // dependency list: depending on `slot.inputs` (a fresh object per edit) or
  // on the whole object would re-solve on every write, and a progress tick
  // must never restart the debounce.
  const { mesh } = slot
  const { weightKg, lcgPctLwl, kgMm, heelDeg } = slot.inputs
  useEffect(() => {
    if (!mesh) return
    const conditions = { weightKg, lcgPctLwl, kgMm, heelDeg }
    // The hull's own gate comes first, exactly as the home flow's does (App
    // checks the open edges before it checks the inputs): an open hull must
    // not reach solveTrim on this path either. The slot stops and says how
    // many edges are open, keeping the record's labelled snapshot on screen
    // rather than exporting a clip of a hull the solver cannot close.
    const problem = mesh.stats.watertight.watertight
      ? inputsProblem(conditions)
      : `${mesh.stats.watertight.openEdgeCount} open edges — the solver needs a closed hull.`
    if (problem !== null) {
      setSlot((prev) =>
        prev.error === problem && prev.live === null && !prev.solving
          ? prev
          : {
              ...prev,
              error: problem,
              live: null,
              liveInputs: null,
              solving: false,
              progress: null,
            },
      )
      return
    }
    let alive = true
    setSlot((prev) => (prev.solving ? prev : { ...prev, solving: true, error: null }))
    const timer = setTimeout(() => {
      solver
        .solve(positionsOf(mesh), conditions, (p) => {
          if (!alive) return
          setSlot((prev) => ({ ...prev, progress: { done: p.done, total: p.total } }))
        })
        .then(
          (result) => {
            if (!alive) return
            setSlot((prev) => ({
              ...prev,
              live: result,
              // The conditions this answer belongs to, captured before any
              // later edit could move `inputs` out from under it.
              liveInputs: conditions,
              solving: false,
              progress: null,
              error: null,
            }))
          },
          (err: unknown) => {
            if (!alive) return
            if (err instanceof Error && err.message === 'cancelled') return
            setSlot((prev) => ({
              ...prev,
              solving: false,
              progress: null,
              live: null,
              liveInputs: null,
              error: err instanceof Error ? err.message : 'The solve failed.',
            }))
          },
        )
    }, SOLVE_DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
      solver.cancel()
    }
    // The four usable inputs, the mesh identity, and the stable setter and
    // solver are the whole trigger.
  }, [mesh, weightKg, lcgPctLwl, kgMm, heelDeg, setSlot, solver])
}

export default function CompareView({
  roster,
  onAddRecord,
  onDeleteRecord,
  meshCache,
}: CompareViewProps) {
  const [slotA, setSlotA] = useState<SlotState>(emptySlot)
  const [slotB, setSlotB] = useState<SlotState>(emptySlot)
  // One solver per slot, created once: `SlotSolver` spawns no worker until it
  // solves, so an idle Compare tab costs nothing.
  const [solvers] = useState<[SlotSolver, SlotSolver]>(() => [new SlotSolver(), new SlotSolver()])
  // Stable setState setters, indexed by slot. Memoized rather than rebuilt per
  // render so the callbacks below can name it in their own dependency lists.
  const setters = useMemo<Array<Dispatch<SetStateAction<SlotState>>>>(
    () => [setSlotA, setSlotB],
    [],
  )
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  useSlotSolve(slotA, setSlotA, solvers[0])
  useSlotSolve(slotB, setSlotB, solvers[1])

  // Unmount retires both in-flight solves. The solve effect's own cleanup does
  // the same on every re-run, so this only covers the whole tab going away;
  // StrictMode's double mount is harmless because cancelling a solver that is
  // not solving is a no-op (`SlotSolver` spawns no worker until it solves).
  useEffect(() => {
    return () => {
      for (const solver of solvers) solver.cancel()
    }
  }, [solvers])

  /**
   * Pick a record into a slot: its inputs (a copy) and its mesh if cached.
   *
   * `pickSeq` advances on EVERY pick, including a re-pick of the record the
   * slot already shows: the panel is keyed on it, so its field strings fall
   * back to this record's own values instead of keeping whatever was typed
   * into them while the slot showed the previous pick.
   */
  const pickRecord = useCallback(
    (index: 0 | 1, record: RunRecord) => {
      const cached = meshCache.get(record.modelHash) ?? null
      setters[index]((prev) => ({
        recordId: record.id,
        mesh: cached,
        // A record's inputs are frozen; the slot adopts a copy it may edit.
        inputs: { ...record.inputs },
        live: null,
        liveInputs: null,
        solving: false,
        progress: null,
        error: null,
        pickSeq: prev.pickSeq + 1,
      }))
    },
    [setters, meshCache],
  )

  /** A re-picked (or rescaled) STL becomes this slot's mesh, cached by hash. */
  const attachMesh = useCallback(
    (index: 0 | 1, mesh: LoadedMesh) => {
      // Same cache the home tab fills: `rememberMesh` refuses the empty hash
      // (it identifies nothing) and bounds the session's growth.
      rememberMesh(meshCache, mesh)
      // The new geometry invalidates the live answer: until its own solve
      // lands, the slot displays the record's snapshot - which is fine,
      // because every consumer reads the conditions that pair belongs to.
      setters[index]((prev) => ({
        ...prev,
        mesh,
        live: null,
        liveInputs: null,
        solving: false,
        progress: null,
        error: null,
      }))
    },
    [setters, meshCache],
  )

  /**
   * Forget a slot's STL, on the panel's explicit "Clear model": the dropzone
   * comes back and the live answer goes, while the record and the typed
   * conditions stay. A hull is CHANGED through the re-pick path - the picker
   * "Replace STL" opens - so this is the unload, not the swap.
   */
  const clearMesh = useCallback(
    (index: 0 | 1) => {
      setters[index]((prev) => ({
        ...prev,
        mesh: null,
        live: null,
        liveInputs: null,
        solving: false,
        progress: null,
        error: null,
      }))
    },
    [setters],
  )

  const editInputs = (index: 0 | 1, inputs: SlotInputs) => {
    setters[index]((prev) => ({ ...prev, inputs }))
  }

  /** Delete a record, and clear any slot showing it: an orphaned pick is a lie. */
  const handleDeleteRecord = (id: string) => {
    onDeleteRecord(id)
    if (slotA.recordId === id) setSlotA(emptySlot())
    if (slotB.recordId === id) setSlotB(emptySlot())
  }

  const handleImportFile = async (file: File) => {
    setImportError(null)
    try {
      const parsed = parseRunRecordImport(await file.text())
      if (!parsed.ok) {
        setImportError(parsed.error)
        return
      }
      // The run may already be in the roster: importing the same file twice
      // must not mint a second copy of one run. The roster answers with the
      // entry it KEEPS, so the slot, the roster list and the exported document
      // all name one run - and the slot's id is one the roster holds.
      const record = onAddRecord(parsed.record)
      // Drop the import into the first empty slot: its numbers show at once
      // and its missing STL is asked for, which is what an import is for.
      if (slotA.recordId === null) pickRecord(0, record)
      else if (slotB.recordId === null) pickRecord(1, record)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not read the file.')
    }
  }

  const recordA = roster.find((entry) => entry.id === slotA.recordId) ?? null
  const recordB = roster.find((entry) => entry.id === slotB.recordId) ?? null
  // What each column DISPLAYS: the live solve when one has answered, else the
  // record's own snapshot. Export and the overlay read the same pair.
  const resultA = slotA.live ?? recordA?.result ?? null
  const resultB = slotB.live ?? recordB?.result ?? null
  // The conditions that pair ANSWERS to - the live solve's own while it is
  // live (an edit moves `inputs` without invalidating the answer on screen),
  // and the record's own when its snapshot is what is being shown. Never the
  // edited fields: the note and the export compares what is displayed, and a
  // document that pairs the recorded results with the edited targets asserts
  // a solve at conditions that never ran.
  const shownInputs = (slot: SlotState, record: RunRecord | null): SlotInputs =>
    slot.live !== null ? (slot.liveInputs ?? slot.inputs) : (record?.inputs ?? slot.inputs)
  const columnA: CompareColumn = {
    // A slot loaded straight from an STL is called by its file name.
    name: recordA?.name ?? slotA.mesh?.fileName ?? null,
    result: resultA,
    // Conditions only when the column has numbers to pair them with: a mesh
    // whose solve has not landed (or failed) has no result, and a "different
    // conditions" note about a column without numbers asserts a comparison
    // that does not exist.
    inputs: resultA !== null ? shownInputs(slotA, recordA) : null,
    // A re-solve is in flight, or the conditions have moved on and the new
    // solve has not answered yet: the numbers on screen still answer to the
    // previous conditions, and the table says so instead of letting the delta
    // column imply they are the current ones.
    stale: columnStale(slotA),
  }
  const columnB: CompareColumn = {
    name: recordB?.name ?? slotB.mesh?.fileName ?? null,
    result: resultB,
    inputs: resultB !== null ? shownInputs(slotB, recordB) : null,
    stale: columnStale(slotB),
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto lg:flex-row">
      <div className="flex min-h-0 shrink-0 flex-col gap-3 lg:w-[26rem]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-500">
            {roster.length} run{roster.length === 1 ? '' : 's'} · saved in this browser
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              Import run record
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".run.json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleImportFile(file)
                e.target.value = ''
              }}
            />
          </div>
        </div>
        {importError && (
          <p
            className="rounded border border-rose-900 bg-rose-950/50 p-2 text-xs text-rose-300"
            role="alert"
          >
            {importError}
          </p>
        )}
        {/*
          ONE roster list for BOTH slots, not one inside each panel. Two copies
          made "click the file" ambiguous - the same button looked like the same
          control while it filled a different slot - and when the same record
          landed in both slots the two panels' React keys collided. Each entry
          now says exactly which slot it loads, so the same run can still go
          into A and B deliberately (same hull, two conditions) without either
          panel ever impersonating the other.
        */}
        {roster.length === 0 ? (
          <p className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500">
            The roster is empty - import a run record (.run.json), solve at the Analyze tab to add
            one automatically, or drop an STL straight into a slot below.
          </p>
        ) : (
          <ul className="max-h-52 space-y-1 overflow-y-auto pr-1" aria-label="Saved runs">
            {roster.map((entry) => (
              <li
                key={entry.id}
                className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${
                  entry.id === slotA.recordId || entry.id === slotB.recordId
                    ? 'border-sky-700 bg-sky-950/40'
                    : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <span
                  className="min-w-0 flex-1 truncate text-zinc-200"
                  title={`${entry.name} - ${entry.modelHash}`}
                >
                  {entry.name}
                </span>
                <span className="font-mono text-[10px] text-zinc-500" title={entry.modelHash}>
                  {entry.modelHash.slice(0, 6)}
                </span>
                {([0, 1] as const).map((index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => pickRecord(index, entry)}
                    aria-label={`Load ${entry.name} into slot ${index === 0 ? 'A' : 'B'}`}
                    title={`Load into slot ${index === 0 ? 'A' : 'B'}`}
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-zinc-950 hover:opacity-80"
                    style={{ backgroundColor: slotColorHex(index) }}
                  >
                    {index === 0 ? 'A' : 'B'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => handleDeleteRecord(entry.id)}
                  aria-label={`Delete ${entry.name}`}
                  title={`Delete ${entry.name}`}
                  className="rounded px-1 text-zinc-500 hover:text-rose-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <SlotPanel
          key={`A#${slotA.recordId ?? 'empty'}#${slotA.pickSeq}`}
          label="A"
          slot={slotA}
          record={recordA}
          onInputs={(inputs) => editInputs(0, inputs)}
          onMesh={(mesh) => attachMesh(0, mesh)}
          onClearMesh={() => clearMesh(0)}
        />
        <SlotPanel
          key={`B#${slotB.recordId ?? 'empty'}#${slotB.pickSeq}`}
          label="B"
          slot={slotB}
          record={recordB}
          onInputs={(inputs) => editInputs(1, inputs)}
          onMesh={(mesh) => attachMesh(1, mesh)}
          onClearMesh={() => clearMesh(1)}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {/*
          The overlay is `shrink-0` on purpose: as a shrinking flex item it
          surrendered its height to the table below it, which is content-sized
          and taller than most windows, so the 3D view collapsed to zero and
          the Compare tab showed no hull at all. The table takes the slack and
          scrolls inside its own area instead.
        */}
        <section className="flex h-[45vh] min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <CompareOverlay
            meshA={slotA.mesh}
            meshB={slotB.mesh}
            resultA={resultA}
            resultB={resultB}
          />
          <div className="px-1 pb-1 pt-2 text-center text-xs text-zinc-500">
            {compareOverlayCaption({
              a: overlaySlot(slotA.mesh !== null, resultA !== null, foreignPose(slotA, recordA)),
              b: overlaySlot(slotB.mesh !== null, resultB !== null, foreignPose(slotB, recordB)),
            })}
          </div>
        </section>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CompareTable a={columnA} b={columnB} />
        </div>
      </div>
    </div>
  )
}

/**
 * The overlay renderer: both posed hulls on ONE shared water surface.
 *
 * It mirrors the single viewer's mount pass (renderer `up = (0,0,1)`, the same
 * lights, one OrbitControls, a ResizeObserver, a render loop) and then does
 * what the compare tab actually adds: two {@link makeSlotScene}s, one shared
 * {@link applySharedWaterSurface} call, and a `key`-less rebuild driven by the
 * two mesh hashes, because React keys cannot be conditional on a prop's
 * contents.
 *
 * Seam order is fixed and deliberate: the POSE seams run first for both slots,
 * then the water seam, because `applySharedWaterSurface` measures each hull's
 * midship waterline point THROUGH the matrices the pose seam has just written
 * (`tests/verify-compare-scene.ts` asserts that order). The plane is a direct
 * child of the scene — the seam writes world coordinates to it — and its
 * visibility is decided HERE, not by the pose seam: a slot's own `waterPlane`
 * is null by construction, so the two seams cannot fight over it.
 */
function CompareOverlay({
  meshA,
  meshB,
  resultA,
  resultB,
}: {
  meshA: LoadedMesh | null
  meshB: LoadedMesh | null
  resultA: TrimSolveResult | null
  resultB: TrimSolveResult | null
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  // A WebGL-less machine (blocklisted driver, WebGL disabled, no GPU) makes the
  // construction below throw, and an unguarded one left this tab entirely blank
  // - so the mount pass reports it here and the JSX answers in one line.
  const [glFailed, setGlFailed] = useState(false)
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    waterPlane: THREE.Mesh
  } | null>(null)
  const slotsRef = useRef<[SlotScene | null, SlotScene | null]>([null, null])

  // Memoized on the two mesh identities, so the effects below can name it in
  // their dependency lists: an array rebuilt per render would re-run them on
  // every render (every progress tick), rebuilding the slot scenes for nothing.
  // It carries the MESHES and deliberately not the results: a memo that closed
  // over the results would have to be rebuilt per solve, and one that did not
  // would hand the pose effect a stale one.
  const entries: Array<{ index: 0 | 1; mesh: LoadedMesh | null }> = useMemo(
    () => [
      { index: 0, mesh: meshA },
      { index: 1, mesh: meshB },
    ],
    [meshA, meshB],
  )

  /**
   * Frame the camera on the union of the loaded hulls: the single viewer frames
   * on one hull, and the overlay has to cover whichever two it is showing.
   * Falls back to a nominal radius when nothing is loaded yet (the slot-build
   * effect re-frames as soon as a mesh appears).
   */
  const frameOn = useCallback(
    (camera: THREE.PerspectiveCamera, controls: OrbitControls, radius: number) => {
      const r = Math.max(radius, 1)
      camera.position.set(VIEW_DIR.x, VIEW_DIR.y, VIEW_DIR.z).multiplyScalar(r * 3)
      camera.near = Math.max(r / 1000, 0.001)
      camera.far = r * 1000
      camera.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
    },
    [],
  )

  // --- Mount pass: the context and the water plane, once ---------------------
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x09090b) // zinc-950, the single viewer's
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1_000_000)
    // Z-up world, exactly as the single viewer: data axes == display axes.
    camera.up.set(0, 0, 1)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setGlFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // cap DPR
    renderer.shadowMap.enabled = false // no shadows by design
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    // The same two lights the single viewer uses. The hull materials are flat
    // (`MeshBasicMaterial` in `makeSlotScene`), so lighting does not even touch
    // the hulls — it is here for the grid and any future surface.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1)
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(1.2, -1, 1.6) // from front-side-above in Z-up space
    scene.add(hemi, key)

    // Built as a UNIT square: `applySharedWaterSurface` scales the plane from
    // the union of the hulls' own world bounds, so its size is a DERIVED
    // number, never a fixed one, and the shared surface covers both hulls
    // whatever their size.
    // Framing is (re)done as each slot is built (below), because the camera has
    // to cover the UNION of the two hulls.
    const waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    // The shared surface is the overlay's datum plane: every hull is dropped so
    // its midship waterline point sits exactly on world Z 0, and the plane lives
    // there with it.
    waterPlane.position.set(0, 0, 0)
    waterPlane.visible = false
    scene.add(waterPlane)
    sceneRef.current = { scene, camera, controls, waterPlane }
    frameOn(camera, controls, 1)

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      // Retire whatever slots are still mounted. The slot-build effect has no
      // cleanup of its own (a rebuild disposes its predecessor), so without
      // this the tab - not the scene - going away would leak each slot's
      // cloned hull buffer and its marker/leader materials.
      for (const slot of slotsRef.current) {
        if (!slot) continue
        scene.remove(slot.wrapper)
        disposeSlotScene(slot)
      }
      slotsRef.current = [null, null]
      waterPlane.geometry.dispose()
      ;(waterPlane.material as THREE.Material).dispose()
      scene.remove(waterPlane)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
      sceneRef.current = null
    }
    // Once: the GL context outlives every mesh and every result. The scenes it
    // renders are rebuilt by the effect below, keyed on the mesh hashes, and
    // `frameOn` is a stable callback, so this pass runs exactly once.
  }, [frameOn])

  // --- Slot build: whenever either slot's mesh changes -----------------------
  useEffect(() => {
    for (let index = 0; index < 2; index++) {
      const slot = slotsRef.current[index]
      if (slot) {
        sceneRef.current?.scene.remove(slot.wrapper)
        disposeSlotScene(slot)
        slotsRef.current[index] = null
      }
    }
    for (const entry of entries) {
      if (!entry.mesh) continue
      const slot = makeSlotScene(positionsOf(entry.mesh), SLOT_COLORS[entry.index], SLOT_OPACITY)
      slotsRef.current[entry.index] = slot
      sceneRef.current?.scene.add(slot.wrapper)
    }
    // Frame to whatever is loaded now (the mount pass framed an empty overlay).
    const built = sceneRef.current
    if (built) {
      // The radius comes from the MESH STATS, not `geometry.boundingBox`:
      // nothing on the upload path computes that box (`STLLoader.parse` and
      // `Upload` do not), so it is null for every mesh loaded here - the
      // single viewer never hits this because it computes it in its own mount
      // pass. A null box made the radius collapse to 1 mm and put the camera
      // inside the hull, so the overlay showed a solid wash of hull colour.
      const radius = Math.max(
        ...entries
          .filter((e) => e.mesh !== null)
          .flatMap((e) => {
            const size = e.mesh?.stats.bounds.size
            if (!size) return [1]
            return [Math.max(size.x, size.y, size.z)]
          }),
        1,
      )
      frameOn(built.camera, built.controls, radius)
    }
  }, [entries, frameOn])

  // --- Pose + shared waterline: per result -----------------------------------
  useEffect(() => {
    const built = sceneRef.current
    if (!built) return
    const posed: Array<{ slot: SlotScene; waterlineZ: number }> = []
    for (const entry of entries) {
      const slot = slotsRef.current[entry.index]
      if (!slot) continue
      const view = viewOf(entry.index === 0 ? resultA : resultB)
      // POSE first for BOTH slots ...
      applySlotResultToScene(slot, view)
      // A slot with no result to pose it with is NOT floating: drawn unposed
      // and at the origin it would sit in mid-air outside the shared surface
      // with nothing on screen saying why, so it stays hidden until a result
      // exists. Every real solve reports a finite waterline height, so this
      // only ever fires on the empty view.
      slot.refs.hullGroup.visible = view.waterlineZ !== null
      if (view.waterlineZ !== null && Number.isFinite(view.waterlineZ)) {
        posed.push({ slot, waterlineZ: view.waterlineZ })
      }
    }
    // ... then the shared surface, which measures the posed hulls. A slot whose
    // result is not floating keeps its last pose but leaves the plane's
    // visibility to the list below.
    built.waterPlane.visible = posed.length > 0
    applySharedWaterSurface(posed, built.waterPlane)
  }, [entries, resultA, resultB])

  // role="img" is what makes an aria-label legal on a div, and it is honest:
  // the canvas is one picture of both hulls, and the caption below it is the
  // text description of that picture.
  if (glFailed) {
    return (
      <p className="grid h-full place-items-center px-3 text-center text-xs text-zinc-500">
        WebGL is unavailable here, so the overlay cannot be drawn — every number in the table below
        is still solved and correct.
      </p>
    )
  }

  return (
    <div
      ref={mountRef}
      role="img"
      aria-label="Compare overlay — both hulls on one shared water surface"
      className="relative h-full min-h-0 w-full overflow-hidden rounded-lg"
    />
  )
}
