import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react'
import {
  type CompareOverlaySlot,
  columnIsStale,
  compareOverlayCaption,
  conditionsDiffer,
  displayedName,
  poseIsForeign,
  type RunRecord,
  recordConditionLabel,
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
import CompareDifference from './CompareDifference'
import CompareGzChart from './CompareGzChart'
import CompareStage from './CompareStage'
import CompareTable, { type CompareColumn } from './CompareTable'
import SlotPanel from './SlotPanel'
import { type LoadedMesh, rememberMesh } from './Upload'
import { SLOT_COLORS } from './Viewer3D'

/**
 * The Compare tab: two live slots over one shared water surface, the
 * difference between them, and the only Compare state that outlives a reload
 * is the roster, which its parent owns.
 *
 * What lives here rather than in the panels:
 *
 *  - the slot state itself, because two slots, the table and the stage all
 *    read the same slot and must never hold two copies of it;
 *  - one `SlotSolver` per slot (`lib/slot-solver.ts`), so editing slot A can
 *    never cancel slot B's worker;
 *  - the slot logic over ONE session-wide geometry cache, which App owns and
 *    shares with the home tab (keyed by the STL's hash): a slot shows the
 *    stage when it has its mesh, and shows its numbers and asks for the STL
 *    when it does not. It dies with the session, exactly as a record does.
 *
 * The LAYOUT is the Compare tab's argument: the stage owns the width, the
 * panel owns the numbers. The panel leads with the six metrics that decide a
 * comparison and keeps the full table behind one button, because a 23-row
 * table read as the page's headline makes the comparison unreadable.
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
   * the stage - reads the result's own conditions, never the edited ones.
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

/** How long a deleted run can be taken back. */
const UNDO_WINDOW_MS = 8000

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

/**
 * What one slot contributes to the stage, from the two facts the picture is
 * built from: an STL in memory and a result to pose it with.
 *
 * The stage draws a hull only with BOTH, so a slot holding a record but no
 * STL in memory shows its numbers in the panel and nothing at all here.
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
 *
 * Exported for the display suite: it drives real slot states through this and
 * renders the note the Difference block then shows, because the join between
 * the table's flag and the block's note is the thing a pinned string factory
 * cannot see. Two reads of one flag, not two derivations of it.
 */
export function columnStale(slot: SlotState): boolean {
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
    // many edges are open, keeping the record's snapshot on screen rather
    // than a clipped hull the solver could not close.
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
  /**
   * BOTH slots in ONE piece of state, so the stage's "Swap A / B" is a swap
   * and not a copy: two separate states would need their contents exchanged
   * one after the other, and a re-render in between would show the same hull
   * in both slots.
   */
  const [slots, setSlots] = useState<[SlotState, SlotState]>(() => [emptySlot(), emptySlot()])
  const [slotA, slotB] = slots
  // One solver per slot, created once: `SlotSolver` spawns no worker until it
  // solves, so an idle Compare tab costs nothing.
  const [solvers] = useState<[SlotSolver, SlotSolver]>(() => [new SlotSolver(), new SlotSolver()])
  // Stable per-index setters: the solve effect names its setter in its own
  // dependency list, so a setter rebuilt per render would re-solve on every
  // progress tick.
  const setSlot = useCallback((index: 0 | 1, update: SetStateAction<SlotState>) => {
    setSlots((prev) => {
      const next = [...prev] as [SlotState, SlotState]
      next[index] = typeof update === 'function' ? update(prev[index]) : update
      return next
    })
  }, [])
  const setSlotA = useCallback((update: SetStateAction<SlotState>) => setSlot(0, update), [setSlot])
  const setSlotB = useCallback((update: SetStateAction<SlotState>) => setSlot(1, update), [setSlot])
  // The roster is a disclosure: the comparison is the page's job, and a list of
  // saved runs must not push the difference below the fold.
  const [rosterOpen, setRosterOpen] = useState(false)
  // The full table is behind one button, exactly as "All values" is on the
  // Analyze tab.
  const [tableOpen, setTableOpen] = useState(false)

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
      setSlot(index, (prev) => ({
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
    [meshCache, setSlot],
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
      setSlot(index, (prev) => ({
        ...prev,
        mesh,
        live: null,
        liveInputs: null,
        solving: false,
        progress: null,
        error: null,
      }))
    },
    [meshCache, setSlot],
  )

  /**
   * Forget a slot's STL, on the panel's explicit "Clear model": the dropzone
   * comes back and the live answer goes, while the record and the typed
   * conditions stay. A hull is CHANGED through the re-pick path - the picker
   * "Replace STL" opens - so this is the unload, not the swap.
   */
  const clearMesh = useCallback(
    (index: 0 | 1) => {
      setSlot(index, (prev) => ({
        ...prev,
        mesh: null,
        live: null,
        liveInputs: null,
        solving: false,
        progress: null,
        error: null,
      }))
    },
    [setSlot],
  )

  /** Empty a slot completely: its record, its hull and its numbers all go. */
  const clearSlot = useCallback(
    (index: 0 | 1) => {
      setSlot(index, emptySlot())
    },
    [setSlot],
  )

  /** Exchange the two slots, hulls and all. */
  const swapSlots = useCallback(() => {
    setSlots((prev) => [prev[1], prev[0]])
  }, [])

  const editInputs = (index: 0 | 1, inputs: SlotInputs) => {
    setSlot(index, (prev) => ({ ...prev, inputs }))
  }

  /**
   * The run that was just deleted, kept so the delete can be taken back.
   *
   * A destructive action that cannot be undone is the one thing the product
   * research says to avoid: delete AND offer an undo, or move the entry to a
   * "Recently Deleted" list. The roster's delete is this tab's only
   * destructive action, so it gets the undo - the record comes back with the
   * id it had, because the roster keeps the entry it is handed.
   */
  const [deleted, setDeleted] = useState<RunRecord | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
    },
    [],
  )

  /** Delete a record, and clear any slot showing it: an orphaned pick is a lie. */
  const handleDeleteRecord = (id: string) => {
    const record = roster.find((entry) => entry.id === id) ?? null
    onDeleteRecord(id)
    if (slotA.recordId === id) setSlotA(emptySlot())
    if (slotB.recordId === id) setSlotB(emptySlot())
    if (!record) return
    setDeleted(record)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    // The offer expires: an undo that stays on screen forever is a second
    // thing to read, and a delete the user meant is a delete.
    undoTimer.current = setTimeout(() => setDeleted(null), UNDO_WINDOW_MS)
  }

  const undoDelete = () => {
    if (!deleted) return
    onAddRecord(deleted)
    setDeleted(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
  }

  const recordA = roster.find((entry) => entry.id === slotA.recordId) ?? null
  const recordB = roster.find((entry) => entry.id === slotB.recordId) ?? null
  // What each column DISPLAYS: the live solve when one has answered, else the
  // record's own snapshot. The stage reads the same pair.
  const resultA = slotA.live ?? recordA?.result ?? null
  const resultB = slotB.live ?? recordB?.result ?? null
  // The conditions that pair ANSWERS to - the live solve's own while it is
  // live (an edit moves `inputs` without invalidating the answer on screen),
  // and the record's own when its snapshot is what is being shown. Never the
  // edited fields: the note compares what is displayed, and pairing displayed
  // results with edited targets would assert a solve at conditions that never
  // ran.
  const shownInputs = (slot: SlotState, record: RunRecord | null): SlotInputs =>
    slot.live !== null ? (slot.liveInputs ?? slot.inputs) : (record?.inputs ?? slot.inputs)
  const columnA: CompareColumn = {
    // The live answer's own mesh names the column: after a "Use anyway"
    // re-pick the record is still picked but the numbers are a different
    // hull's, and the record's name over them would be a mislabel.
    name: displayedName(slotA, recordA),
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
    name: displayedName(slotB, recordB),
    result: resultB,
    inputs: resultB !== null ? shownInputs(slotB, recordB) : null,
    stale: columnStale(slotB),
  }

  // The conditions the two DISPLAYED results differ in. The note is a claim
  // about a comparison, so it only appears when both columns have numbers.
  const conditions =
    columnA.inputs && columnB.inputs ? conditionsDiffer(columnA.inputs, columnB.inputs) : []
  const caption = compareOverlayCaption({
    a: overlaySlot(slotA.mesh !== null, resultA !== null, foreignPose(slotA, recordA)),
    b: overlaySlot(slotB.mesh !== null, resultB !== null, foreignPose(slotB, recordB)),
  })
  const nameA = displayedName(slotA, recordA)
  const nameB = displayedName(slotB, recordB)
  const anyResult = resultA !== null || resultB !== null

  return (
    <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
      <CompareStage
        meshA={slotA.mesh}
        meshB={slotB.mesh}
        resultA={resultA}
        resultB={resultB}
        nameA={nameA}
        nameB={nameB}
        caption={caption}
        onSwap={swapSlots}
      />

      {/*
        The undo of a delete, over the stage: the offer appears where the eye
        already is, and it carries the one thing a delete needs - a way back.
      */}
      {deleted && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-24 left-4 z-30 flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-ink-2"
        >
          <span className="max-w-[220px] truncate">Deleted {deleted.name}.</span>
          <button
            type="button"
            onClick={undoDelete}
            className="rounded-md border border-line-2 px-2 py-1 text-[11px] text-ink transition-colors hover:bg-panel-2 active:scale-[0.98]"
          >
            Undo
          </button>
        </div>
      )}

      <aside className="flex w-full shrink-0 flex-col border-t border-line bg-page lg:w-[420px] lg:border-t-0 lg:border-l">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Conditions: the two slots, side by side. */}
          <p className="mb-2 text-[11px] font-medium text-ink-3">Conditions</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SlotPanel
              key={`A#${slotA.recordId ?? 'empty'}#${slotA.pickSeq}`}
              label="A"
              slot={slotA}
              record={recordA}
              onInputs={(inputs) => editInputs(0, inputs)}
              onMesh={(mesh) => attachMesh(0, mesh)}
              onClearMesh={() => clearMesh(0)}
              onClearSlot={() => clearSlot(0)}
            />
            <SlotPanel
              key={`B#${slotB.recordId ?? 'empty'}#${slotB.pickSeq}`}
              label="B"
              slot={slotB}
              record={recordB}
              onInputs={(inputs) => editInputs(1, inputs)}
              onMesh={(mesh) => attachMesh(1, mesh)}
              onClearMesh={() => clearMesh(1)}
              onClearSlot={() => clearSlot(1)}
            />
          </div>

          {/*
            ONE roster list for BOTH slots, not one inside each panel. Two copies
            made "click the file" ambiguous - the same button looked like the same
            control while it filled a different slot - and when the same record
            landed in both slots the two panels' React keys collided. Each entry
            now says exactly which slot it loads, so the same run can still go
            into A and B deliberately (same hull, two conditions) without either
            panel ever impersonating the other.
          */}
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRosterOpen((open) => !open)}
                aria-expanded={rosterOpen}
                className="flex items-center gap-2 text-[11px] text-ink-2 transition-colors hover:text-ink active:scale-[0.98]"
              >
                <span className="text-[11px]">{rosterOpen ? '▾' : '▸'}</span>
                Saved runs
              </button>
            </div>

            {rosterOpen && (
              <div className="mt-2">
                {roster.length === 0 ? (
                  <p className="text-[11px] leading-snug text-ink-3">
                    Nothing saved yet. Every Analyze solve is saved as a run.
                  </p>
                ) : (
                  <ul className="space-y-1" aria-label="Saved runs">
                    {roster.map((entry) => (
                      <li
                        key={entry.id}
                        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                          entry.id === slotA.recordId || entry.id === slotB.recordId
                            ? 'border-accent-700 bg-accent-500/10'
                            : 'border-line bg-panel-2/40'
                        }`}
                      >
                        <span
                          className="min-w-0 flex-1"
                          title={`${entry.name} - ${entry.modelHash}`}
                        >
                          <span className="block truncate text-ink-2">{entry.name}</span>
                          <span className="block truncate font-mono text-[11px] text-ink-3">
                            {recordConditionLabel(entry.inputs)} · {entry.modelHash.slice(0, 6)}
                          </span>
                        </span>
                        {([0, 1] as const).map((index) => (
                          <button
                            key={index}
                            type="button"
                            onClick={() => pickRecord(index, entry)}
                            aria-label={`Load ${entry.name} (${recordConditionLabel(entry.inputs)}) into slot ${index === 0 ? 'A' : 'B'}`}
                            title={`Load ${entry.name} - ${recordConditionLabel(entry.inputs)} - into slot ${index === 0 ? 'A' : 'B'}`}
                            className="rounded px-2 py-1 text-[11px] font-bold text-accent-ink"
                            style={{ backgroundColor: slotColorHex(index) }}
                          >
                            {index === 0 ? 'A' : 'B'}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(entry.id)}
                          aria-label={`Delete ${entry.name} (${recordConditionLabel(entry.inputs)})`}
                          title={`Delete ${entry.name} - ${recordConditionLabel(entry.inputs)}`}
                          className="rounded px-1 text-ink-3 transition-colors hover:text-bad active:scale-[0.98]"
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {anyResult ? (
            <CompareDifference
              a={resultA}
              b={resultB}
              conditions={conditions}
              staleA={columnA.stale}
              staleB={columnB.stale}
            >
              {/*
                The two righting-arm curves, drawn between the metrics and the
                sentence that reads them: the numbers say which is bigger, the
                curves show the shape behind it, and the verdict says what it
                means.
              */}
              <div className="mt-4">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-[11px] font-medium text-ink-3">Righting arm (GZ)</h2>
                  <span className="flex-1" />
                  <span className="flex items-center gap-3 text-[11px] text-ink-2">
                    <span className="flex items-center gap-1">
                      <i className="h-0.5 w-3 rounded-full bg-[#38bdf8]" />A
                    </span>
                    {resultB && (
                      <span className="flex items-center gap-1">
                        <i className="h-0.5 w-3 rounded-full bg-[#fb923c]" />B
                      </span>
                    )}
                  </span>
                </div>
                <CompareGzChart a={resultA} b={resultB} />
              </div>
            </CompareDifference>
          ) : (
            <p className="mt-4 text-[11px] leading-snug text-ink-3">
              Nothing to compare yet. Every Analyze solve is saved as a run.
            </p>
          )}

          {tableOpen && (
            <div className="mt-4 border-t border-line pt-3">
              <CompareTable a={columnA} b={columnB} />
            </div>
          )}
        </div>

        {/* The footer is OUTSIDE the scroll area, so nothing can slide under
            it - the same shape as the Analyze tab's "All values". */}
        <div className="border-t border-line px-5 py-2">
          <button
            type="button"
            onClick={() => setTableOpen((open) => !open)}
            aria-expanded={tableOpen}
            className="flex w-full items-center justify-between text-[12px] text-ink-2 transition-colors hover:text-ink active:scale-[0.98]"
          >
            <span>All metrics</span>
            <span className="text-[11px]">{tableOpen ? '▴' : '▾'}</span>
          </button>
        </div>
      </aside>
    </div>
  )
}
