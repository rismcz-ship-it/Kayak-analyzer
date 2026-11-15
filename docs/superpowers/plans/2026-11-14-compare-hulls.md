# Compare Hulls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Compare mode: two independent hull slots (own mesh, own weight/LCG/KG/heel), solved live, compared in a two-column table and a semi-transparent overlaid 3D view on a shared water surface, with per-record export/import and a persisted roster.

**Architecture:** A pure lib layer (`src/lib/compare.ts`, `src/lib/model-hash.ts`, `src/lib/slot-solver.ts`) owns records, hashing and per-slot solve sessions; the UI is three new components (`CompareView`, `SlotPanel`, `CompareTable`) plus scene-seam extensions in `Viewer3D.tsx`. The home single-hull flow is untouched; Compare is a second tab. Records are immutable snapshots in `localStorage`; meshes live in an in-memory cache keyed by SHA-256 and die with the session.

**Tech Stack:** React 19 + TypeScript + Vite, Three.js scene, existing worker-based solver (`SolverClient`/`solveTrim`), `crypto.subtle` for hashing. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-compare-hulls-design.md` (executors read both; the plan argues from the spec).

## Global Constraints

- Work on feature branch `compare-hulls` off `main` (first step of Task 1). Never push to `main`. Pushing the branch for a Vercel preview only after Richard's explicit go-ahead. Per-task commits on the branch are covered by his plan approval.
- **Richard-mandated review gate after EVERY task:** once a task's commit is in, load the `review-delegation` skill and cross-review that task's diff with MiniMax M3.1-Flash (thinking) — default interaction mode, per the skill's launch procedure. Fix every delivered finding, re-run the gate, commit fixes. The next task starts only after the review verdict. (If MiniMax is unavailable, follow the skill's fallback chain.)
- Gate for every task: `npm.cmd run ci` exits 0 (PowerShell — `npm.ps1` is blocked; Biome summary on stderr is noise, check the exit code). Format touched files with `npm.cmd exec -- biome check --write <files>`.
- No new runtime dependencies. No `@types/node` — extend `tests/node-shims.d.ts` if a suite needs more Node surface (a missing declaration must fail typecheck).
- Units: mm, mm², mm³, kg. Fresh water (`RHO_KG_PER_M3 = 1000`, `MM3_PER_KG = 1_000_000`).
- Frozen conventions: Z-up, bow = +X; trim `+` = bow up, viewer negates via `viewerTrimDeg`; heel `+` = −Y side down, viewer passes through via `viewerHeelDeg`; **KG is a height above the keel**, never an absolute Z.
- App solve parameters are fixed: `maxTrimDeg: 4.5`, `trimStepDeg: 0.1` (Task 4 passes the same).
- Worker protocol unchanged: request positions are immutable (copied, then transferred), progress indices contiguous 1..total. `verify-worker-protocol.ts` must stay green.
- Uploads ≤ 25 MB (`MAX_UPLOAD_BYTES`), parsed in memory, nothing uploaded anywhere.
- Storage: existing `INPUTS_STORAGE_KEY` untouched; new key `COMPARE_STORAGE_KEY = 'kayak-analyzer.compare.v1'`.
- Records follow the **amended** `references/kayak_analyzer_solver.json`; the producer ships with its schema check (repo rule 2).
- Pure frontend: no server, no login, no cloud.
- New assertion suites follow the house `verify-*` style (print `FAIL` lines, exit non-zero on failure) and are appended to the `npm test` chain in `package.json`, the `tests/README.md` table, and the AGENTS.md matrix (Task 7 collects the doc rows).

## Review Focus

Failure modes the spec implies but no single task's tests naturally cover — each pinned by the named test:

1. **KG as a height, not an absolute Z** (the historical unit bug): a slot solve must forward `inputs.kgMm` verbatim as `SolveRequest.kgMm`. Pinned by Task 4's field-mapping assertion.
2. **Trim sign reaching the overlay**: marine `+` = bow up must show the bow rising in world space (viewer negation lives once in `viewerTrimDeg`). Pinned by Task 5's world-space bow/stern assertion.
3. **Heel sign**: `+` = the −Y side goes down, forwarded verbatim as `fixedHeelDeg` and applied as a plain rotation about +X in the scene. Pinned by Task 4's field mapping + Task 5's world-space heel assertion.
4. **A metres STL re-picked for a record**: `modelHash` hashes the RAW file bytes (unchanged by ×1000 rescale), and the re-pick path must reuse the whole Upload pipeline (orient, centre, scale advice + explicit Apply) before any solve. Pinned by Task 1's `rescaleMesh` hash-carry assertion and Task 6's structural reuse + hash-mismatch confirm flow.
5. **Hostile data**: malformed roster JSON, wrong-typed stored records, a throwing storage reader, and import JSON missing required fields must degrade to empty/filtered rosters or explicit errors — never a crash. Pinned by Task 2 and Task 3 tests.

---

### Task 1: Model hash

**Files:**
- Create: `src/lib/model-hash.ts`
- Create: `tests/verify-model-hash.ts`
- Modify: `src/components/Upload.tsx` (`LoadedMesh` interface, load path, `rescaleMesh`)
- Modify: `package.json` (append suite to `npm test` chain)

**Interfaces:**
- Consumes: nothing new.
- Produces: `sha256Hex(bytes: ArrayBuffer): Promise<string>` (lowercase hex); `LoadedMesh.sha256Hex: string` (hash of the RAW file bytes — set at load, carried through `rescaleMesh` unchanged).

- [ ] **Step 1: Write the failing test** `tests/verify-model-hash.ts`:
  - `sha256Hex` of the UTF-8 bytes of `""` → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; of `"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - Hash is independent of input buffer mutations afterwards (it must not alias the caller's view).
- [ ] **Step 2: Run to verify it fails** — `npm.cmd exec -- tsx tests/verify-model-hash.ts` → module-not-found FAIL.
- [ ] **Step 3: Implement `sha256Hex`** in `src/lib/model-hash.ts` with `crypto.subtle.digest('SHA-256', bytes)` + hex encoding. (Node ≥19 exposes `globalThis.crypto.subtle`, so the suite runs under tsx.)
- [ ] **Step 4: Wire into `LoadedMesh`** — add required `sha256Hex` field; compute it in the upload load path from the raw `File` bytes; `rescaleMesh` copies it through unchanged (the hash describes the file, not the rescaled geometry). Fix every `LoadedMesh` construction site the typecheck names.
- [ ] **Step 5: Run test to verify it passes**; then `npm.cmd run ci` green.
- [ ] **Step 6: Append the suite to the `npm test` chain** in `package.json` (before `verify-upload-scale.ts`, order irrelevant), commit: `feat: model hash (SHA-256 of raw STL bytes) on LoadedMesh`.
- [ ] **Step 7: Review gate** — `review-delegation` skill → MiniMax M3.1-Flash (thinking) on this task's diff → fix findings → gate → fixup commit.

### Task 2: Roster module + persistence

**Files:**
- Create: `src/lib/compare.ts`
- Create: `tests/verify-compare-roster.ts`
- Modify: `package.json` (chain)

**Interfaces:**
- Consumes: `TrimSolveResult` (`src/lib/hydrostatics.ts`), `StorageReader` type (`src/lib/inputs.ts`).
- Produces (later tasks rely on exactly these):
```ts
export interface SlotInputs { weightKg: number; lcgPctLwl: number; kgMm: number; heelDeg: number }
export interface RunRecord {
  id: string; name: string; modelHash: string
  inputs: SlotInputs; result: TrimSolveResult; savedAt: number
}
export const COMPARE_STORAGE_KEY: string            // 'kayak-analyzer.compare.v1'
export function recordFromSolve(name: string, modelHash: string, inputs: SlotInputs, result: TrimSolveResult): RunRecord
export function readRoster(read: StorageReader): RunRecord[]      // absent/malformed/typed-wrong → [] or filtered
export function encodeRoster(records: RunRecord[]): string
export function deleteRecord(records: RunRecord[], id: string): RunRecord[]
export function conditionsDiffer(a: SlotInputs, b: SlotInputs): string[]  // human labels of differing fields
```

- [ ] **Step 1: Write the failing test** `tests/verify-compare-roster.ts` (house style):
  - `recordFromSolve` builds a record with an id, `savedAt`, and stores `result` by reference shape (deep-equal).
  - Round trip: `readRoster` of a key written from `encodeRoster` returns deep-equal records **including `gzCurve` arrays**.
  - Absent key → `[]`; malformed JSON → `[]`; entries with wrong-typed/missing fields → filtered out, valid siblings kept; throwing reader → `[]`.
  - `deleteRecord` removes exactly the target id.
  - `conditionsDiffer({75,52,280,0},{80,52,280,0})` → `['weight']`-style labels; identical inputs → `[]`.
- [ ] **Step 2: Run to verify it fails** (`npm.cmd exec -- tsx tests/verify-compare-roster.ts`).
- [ ] **Step 3: Implement** `src/lib/compare.ts`. IDs: `rec_` + module counter + timestamp (pattern of `nextMeshId` in Upload.tsx). Validation mirrors `verify-inputs`'s restored-input rules. No mesh in a record — records never serialize geometry.
- [ ] **Step 4: Run test to verify it passes**; `npm.cmd run ci` green.
- [ ] **Step 5: Append to chain, commit:** `feat: compare roster records + localStorage persistence`.
- [ ] **Step 6: Review gate** — MiniMax review → fix → gate → fixup commit.

### Task 3: Export / import + schema amendment

**Files:**
- Create: `tests/verify-run-records.ts`
- Modify: `references/kayak_analyzer_solver.json`
- Modify: `src/lib/compare.ts`
- Modify: `package.json` (chain)

**Interfaces:**
- Consumes: `RunRecord` (Task 2).
- Produces:
```ts
export function exportRunRecord(record: RunRecord): unknown
// schema-shaped plain object: model_hash, targets{weight_kg, lcg_pct_lwl, kg_mm, heel_deg},
// results{draft_mm, trim_deg, lwl_mm, bwl_mm, volume_liters, lcb_xyz, lcg_xyz,
//         bow_freeboard_mm, stern_freeboard_mm, waterline_z_mm},
// coefficients{cp, cm, cb, kb_mm, bm_mm, km_mm, gm_mm, cwp, lcf_mm, tpc},
// gz_curve: [{heel_deg, gz_mm}], file_name, phase: 'full_coefficients'
export function parseRunRecordImport(text: string): { ok: true; record: RunRecord } | { ok: false; error: string }
```

- [ ] **Step 1: Amend the schema** `references/kayak_analyzer_solver.json`: add `heel_deg` (required, in `targets`, described like `kg_mm`: required because GM and the GZ curve depend on it); add to `results` (required): `bow_freeboard_mm`, `stern_freeboard_mm`, `waterline_z_mm` (hull-frame midship waterline height); add to `coefficients`: `cwp`, `lcf_mm`, `tpc`; add optional `gz_curve` (array of `{heel_deg, gz_mm}`) and optional root `file_name`. Keep draft-07 style and description voice.
- [ ] **Step 2: Write the failing test** `tests/verify-run-records.ts`:
  - **Schema check (rule 2):** `JSON.parse(readFileSync('<repo>/references/kayak_analyzer_solver.json'))` (via the `node:fs` shim) — assert every required path the schema demands is emitted by `exportRunRecord` on a sample record, and that the schema actually contains the amended fields (the check fails if someone later removes them).
  - Round trip: `exportRunRecord` → `JSON.stringify` → `parseRunRecordImport` → deep-equal record (new id/savedAt allowed to differ).
  - Malformed JSON → `{ok:false}`; missing `kg_mm`/`heel_deg` → error naming the field; wrong-typed number → error; unknown extra fields tolerated.
- [ ] **Step 3: Run to verify it fails.**
- [ ] **Step 4: Implement** `exportRunRecord`/`parseRunRecordImport` in `src/lib/compare.ts` (field-by-field mapping; validation fails loud, tolerates unknowns).
- [ ] **Step 5: Run test to verify it passes**; `npm.cmd run ci` green.
- [ ] **Step 6: Append to chain, commit:** `feat: run-record export/import + amended solver schema`.
- [ ] **Step 7: Review gate** — MiniMax review → fix → gate → fixup commit.

### Task 4: Slot solve orchestration

**Files:**
- Create: `src/lib/slot-solver.ts`
- Create: `tests/verify-slot-solver.ts`
- Modify: `package.json` (chain)

**Interfaces:**
- Consumes: `SolverClient`, `SolveRequest` (solver-worker), `SlotInputs` (Task 2).
- Produces:
```ts
export class SlotSolver {
  solve(positions: Float32Array, inputs: SlotInputs,
        onProgress: (p: { done: number; total: number; angleDeg: number }) => void
  ): Promise<TrimSolveResult>   // builds SolveRequest: targetKg = inputs.weightKg,
                                // targetLcgPercentFromBow = inputs.lcgPctLwl,
                                // kgMm = inputs.kgMm (height, verbatim — Review Focus 1),
                                // fixedHeelDeg = inputs.heelDeg (verbatim — Review Focus 3),
                                // maxTrimDeg: 4.5, trimStepDeg: 0.1
  cancel(): void                // proxies to the client's cancel
}
```
  One `SlotSolver` per slot (each owns one `SolverClient` = one worker; two slots never share a client, so editing A never cancels B).

- [ ] **Step 1: Write the failing test** `tests/verify-slot-solver.ts`, using the fake-`Worker`-global pattern of `verify-worker-protocol.ts` section 5:
  - Two `SlotSolver`s run concurrently and both resolve with their own results (fake worker echoes a canned `TrimSolveResult`).
  - The request posted carries each field mapped 1:1 from `SlotInputs` (kgMm as height; heel verbatim) and the fixed 4.5/0.1 sweep parameters.
  - Posted positions are bit-identical to the input array (no in-place writes).
  - A second `solve()` on the same slot rejects the first promise with `Error('cancelled')` and never delivers the stale result.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `SlotSolver` as a thin owner of one `SolverClient` + request mapping.
- [ ] **Step 4: Run test to verify it passes**; also run `tsx tests/verify-worker-protocol.ts` (protocol untouched); `npm.cmd run ci` green.
- [ ] **Step 5: Append to chain, commit:** `feat: per-slot solve sessions over the worker protocol`.
- [ ] **Step 6: Review gate** — MiniMax review → fix → gate → fixup commit.

### Task 5: Compare scene seam (overlay + shared water)

**Files:**
- Modify: `src/components/Viewer3D.tsx` (additive exports; `createLeader` reused, not moved — `verify-viewer-scene.ts` imports it from here)
- Create: `tests/verify-compare-scene.ts`
- Modify: `package.json` (chain)

**Interfaces:**
- Consumes: `ViewerRefs`, `ViewerView`, `applyResultToScene` internals (pose math + `setLeaderEnds`), `viewerTrimDeg`/`viewerHeelDeg`.
- Produces (Task 6 mounts these):
```ts
export const SLOT_COLORS: readonly [number, number]        // [blue, orange]
export interface SlotScene { wrapper: Group; refs: ViewerRefs }
export function makeSlotScene(positions: Float32Array, color: number, opacity: number): SlotScene
//   builds the hull mesh + leaders exactly like the single-viewer mount pass
//   (pivot-centred per applyResultToScene), transparent material (opacity, depthWrite: false),
//   refs.waterPlane = null; hullGroup parented under wrapper.
export function applySlotResultToScene(slot: SlotScene, view: ViewerView): void
//   same pose math as applyResultToScene on slot.refs (heel about X, trim via viewerTrimDeg about Y).
export function applySharedWaterSurface(
  slots: Array<{ slot: SlotScene; waterlineZ: number }>,
  waterPlane: Mesh,
): void
//   sets wrapper.position.z = -waterlineZ per slot (both midship waterlines → world Z 0)
//   and positions waterPlane at world Z 0 sized from the union of slot bounds.
```

- [ ] **Step 1: Write the failing test** `tests/verify-compare-scene.ts` (world-space assertions after `updateMatrixWorld(true)`, mirroring `verify-viewer-scene.ts`):
  - Two slots with `waterlineZ` 100 and 130: each hull's midship waterline point maps to world Z ≈ 0 (shared surface — Review Focus 2's deeper hull visibly sits lower).
  - Trim `+3.60°`: the bow end's world Z is above the stern end's (marine sign through `viewerTrimDeg`).
  - Heel `+10°`: the −Y side of the hull is lower in world space.
  - Wrappers/pivots stationary across a re-apply with a changed result.
  - Seam purity: the functions touch only the objects handed to them (no renderer/camera/controls keys).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the three exports in `Viewer3D.tsx`, reusing the existing mount-pass construction and `applyResultToScene`'s pose math.
- [ ] **Step 4: Run test to verify it passes**; also `tsx tests/verify-viewer-scene.ts` (single-viewer seam untouched); `npm.cmd run ci` green.
- [ ] **Step 5: Append to chain, commit:** `feat: compare overlay scene seam — two posed slots on a shared waterline`.
- [ ] **Step 6: Review gate** — MiniMax review → fix → gate → fixup commit.

### Task 6: Compare UI (slots, table, import/export, re-pick)

**Files:**
- Create: `src/components/CompareView.tsx` (tab root: roster state, slot state, live-solve wiring)
- Create: `src/components/SlotPanel.tsx` (picker over roster, compact inputs, status, re-pick)
- Create: `src/components/CompareTable.tsx` (metric rows, A|B columns, delta column, conditions note)
- Modify: `src/App.tsx` (only: render CompareView in the compare tab — full tab wiring lands in Task 7; here it mounts behind the existing layout)

**Interfaces:**
- Consumes: everything from Tasks 1–5; `parseInputs` + bounds + `fmt`/`signed` from `inputs.ts`/`format.ts`; `Upload` (compact) for re-pick; `LoadedMesh.sha256Hex` for the hash check.
- Produces: props of `CompareView` (pinned for Task 7):
```ts
interface CompareViewProps {
  roster: RunRecord[]
  onAddRecord: (record: RunRecord) => void
  onDeleteRecord: (id: string) => void
}
```
  Slot state shape (CompareView-internal but pinned):
```ts
interface SlotState {
  recordId: string | null
  mesh: LoadedMesh | null          // present iff meshCache has this record's modelHash
  inputs: SlotInputs               // adopted from the record on pick; editable
  live: TrimSolveResult | null     // live solve result
  solving: boolean; progress: { done: number; total: number } | null; error: string | null
}
```

Behavior pinned by the spec (JSX verified by typecheck + Biome + read-through, per house precedent):
- Picker per slot adopts the record's inputs + stored snapshot immediately; live solve starts on edit (debounced ~300 ms, cancel prior per slot via `SlotSolver`).
- Both slots solved independently; progress per slot; errors surfaced per slot.
- Re-pick: when `mesh` is null the slot shows `<Upload compact>`; a loaded file whose `sha256Hex` ≠ the record's `modelHash` shows a warning with explicit "Use anyway"/"Cancel" (Review Focus 4 — the Upload pipeline is reused wholesale, so scale advice and ×1000 Apply behave exactly as on the home tab).
- Export: `Blob` download of `JSON.stringify(exportRunRecord(...))` as `<name>.run.json`, capturing the slot's **displayed** state (inputs + live result).
- Import: file input → `parseRunRecordImport` → `onAddRecord`; errors shown inline.
- Table: rows for the metrics `ResultsPanel` shows today (draft, trim, LWL, BWL, LCB/LCG, Cb/Cp/Cm/Cwp, KB/BM/KM/GM, bow/stern freeboard, GZ peak/AVS via `gzMarks`), columns A | B | delta (`signed(A − B)` where meaningful); a note when `conditionsDiffer` is non-empty (visible, not an error).
- Roster delete: each picker entry carries a small delete affordance calling `onDeleteRecord` (records are removed only manually — spec call).
- Overlay: `CompareViewer`-equivalent mount inside `CompareView` using `makeSlotScene`/`applySlotResultToScene`/`applySharedWaterSurface` + `SLOT_COLORS`; one OrbitControls; mounts keyed on the slots' mesh hashes.

- [ ] **Step 1: Implement** the three components + `App.tsx` mount.
- [ ] **Step 2: Gate** — `npm.cmd run ci` green (typecheck covers the JSX; the pure logic was pinned in Tasks 2–5).
- [ ] **Step 3: Read-through** against this task's behavior list; fix anything that diverges.
- [ ] **Step 4: Commit:** `feat: compare mode UI — two live slots, table, overlay, import/export`.
- [ ] **Step 5: Review gate** — MiniMax review → fix → gate → fixup commit.

### Task 7: Wire-in, roster growth, docs, final review

**Files:**
- Modify: `src/App.tsx` (tab state `analyze | compare`; auto-roster on home solve; mesh cache)
- Modify: `package.json` (chain — confirm all five new suites present)
- Modify: `AGENTS.md` (test matrix row + repo-layout rows), `tests/README.md` (rows)

**Interfaces:**
- Consumes: `CompareViewProps` (Task 6), `recordFromSolve` (Task 2), `LoadedMesh.sha256Hex` (Task 1).
- Produces: the finished feature.

- [ ] **Step 1: Tab wiring** — `analyze` renders the existing home UI unchanged; `compare` renders `<CompareView roster onAddRecord onDeleteRecord>`; the mesh cache (`Map<modelHash, LoadedMesh>` in a ref) is filled on every successful home solve and on every slot re-pick, and passed down via `CompareView`'s slot logic (extend props if Task 6's shape needs it — pin the final props in a comment here).
- [ ] **Step 2: Auto-roster** — after a successful home-tab solve, `recordFromSolve(mesh.fileName, mesh.sha256Hex, inputs, result)` is added automatically (spec Part 1; deleting stays manual).
- [ ] **Step 3: Docs** — `package.json` chain complete; AGENTS.md matrix rows for `verify-model-hash`, `verify-compare-roster`, `verify-run-records`, `verify-slot-solver`, `verify-compare-scene` + layout rows for the new files; `tests/README.md` rows.
- [ ] **Step 4: Full gate** — `npm.cmd run ci` exits 0 (240+ cases locally; CI sees the tracked-mesh set).
- [ ] **Step 5: Browser smoke checklist** (dev server, by hand): two STLs through home → both in roster; compare tab: pick A and B, edit weights, both columns update live, overlay shows the deeper hull sitting lower on the shared waterline; reload → roster numbers survive, re-pick restores a slot; export → import round trip; import of a foreign record shows numbers and asks for its STL.
- [ ] **Step 6: Commit:** `feat: compare mode wired in — tabs, auto-roster, docs`.
- [ ] **Step 7: Final review gate** — `review-delegation` skill → MiniMax whole-branch review (not just the last task) → fix findings → gate → fixup commit. Only then report done.
