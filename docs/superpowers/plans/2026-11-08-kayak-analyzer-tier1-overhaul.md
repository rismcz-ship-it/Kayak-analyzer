# Tier 1 Overhaul — kayak-analyzer (2026-11-08)

> Status: ready for execution · Author: prepared from a full-codebase research pass ·
> Scope fixed by Richard 2026-11-08: Tier 1 + 3D-scene-once-per-mesh + result-panel
> extraction + responsive layout + the "one line away" hydrostatics.

## Goal

Turn the app from a slow, silent, occasionally misleading calculator into a responsive,
honest analysis tool — without touching the frozen math conventions:

1. The solve runs in a **Web Worker** with progress and **Cancel** (no more ~16 s
   main-thread freeze; measured today: `solveTrim` 15.4 s / 958 planes + a redundant
   `findDraft0Trim` 0.95 s, both on the main thread).
2. The **3D scene is built once per mesh**; results only move objects.
3. The app **refuses to lie**: watertight / waterplane-contour / scale gates, bounded
   numeric inputs, persisted inputs.
4. The **GZ curve is annotated** (GZ_max, AVS, GM₀, end-tip immersion, current heel).
5. The **result panel is extracted** into components, the layout is **responsive**, and
   the extra hydrostatics that are one line away (Cwp, wetted area, LCF, TPC, I_y) are
   reported.

## Non-goals (explicitly out of scope)

Tier 2/3: JSON run export per `references/*.json`, run history/comparison/delta view,
heel-sweep table, unit toggle, Windows CI job, UI component test framework, moment-to-trim
(MCT), free-surface correction, `compute_gz_curve` removal.

## Global constraints

- **No new runtime dependencies.** Pure frontend. Vite + React 19 + Three.js + Recharts
  only. The Web Worker needs no dependency (`new Worker(new URL(...), { type: 'module' })`).
- **Frozen spec (`AGENTS.md`) must not move**: Z-up, X = LOA, bow at +X, trim `+` = bow up,
  heel `+` = the −Y side goes down, viewer sign translation in
  `src/lib/viewer-conventions.ts`, KG-as-height above the keel, and the published baseline
  (bounds `2714.4 × 613.1 × 325.1 mm`, trim `-1.90°`, LCB–LCG offset `1.64 mm`).
- **`npm.cmd run ci` exit 0** after **every** task (typecheck → `biome check .` → `npm test`
  → `vite build`). `npm test` chains the eight suites **by name in `package.json`** — a new
  suite must be appended to that string.
- Format with `npm.cmd exec -- biome check --write <touched files>`; Biome writes its
  summary to **stderr** (a successful run looks red under `2>&1`) — check the exit code.
- Windows/PowerShell: `npm.cmd` (not `npm.ps1`), no `npx`. Read repo files with
  `Get-Content -Encoding UTF8`; do not "fix" mojibake.
- Simplicity discipline: smallest change that fully does the job; no speculative options,
  no abstractions "for later".
- **No browser/console verification is possible from this session's toolset** (desktop
  browser lane is off machine-wide). UI tasks are verified by typecheck + build + Node
  seams; a manual headed smoke check is listed as an optional owner step.
- Commits: one per task, **only after Richard confirms the step** (he reviews per step).

## Existing code anchors (read before each task)

- `src/App.tsx` — ~500 lines. `findDraft0Trim` call (line 94) then `solveTrim` (99);
  `draftResult` UI branch (458–476); inputs (224–275); heel toggle (280–326); layout
  (173–201); GZ chart (400–456).
- `src/components/Viewer3D.tsx` — one effect (39–354) with deps
  `[geometry, waterlineZ, trimDeg, heelDeg, waterlineCenterY, lcg, lcb, rotateHull, pivot]`;
  rebuilds `WebGLRenderer` per result; dead `rotateHull={false}` branch.
- `src/lib/hydrostatics.ts` — `clipBelowPlane` (336–596; cap loop math 540–587, return
  590–596), `solveDraftLcb` (647–744), `findDraft0Trim` (746–1046),
  `compute_gz_curve_geometric` (1047–1092), `solveTrim` (1101–1342: decimate/validate
  1131–1138, `searchAngle` 1216–1245, coarse loop 1248–1250, fine loop 1255–1257, full
  solve 1260–1276, fallback 1278–1301, explicit return 1303–1341).
- `tests/verify-gz.ts` (479–495) touches only `gzCurve[i].GZ/.heelDeg` and asserts
  `gzCurve.length === DEFAULT_GZ_HEEL_ANGLES_DEG.length` — GZ point **fields may be added**,
  the **point count must not change**.
- `src/lib/geometry.ts` — `checkWatertight` (466), `computeSurfaceAreaMm2` (434),
  `isMeshUsableForHydrostatics` (1009), `decimateMesh` (1447).
- `tsconfig.app.json`: `lib ES2022 + DOM + DOM.Iterable`, `verbatimModuleSyntax`,
  `noUnusedLocals/Parameters`. Avoid worker-only libs.

---

# Task 1 — Solver extras (library only, no UI)

**Purpose.** Get every new number out of the solver first, with analytic ground-truth
tests, so Tasks 5–9 only render. No UI change in this task; `verify-orientation`,
`verify-trim-search` and `verify-gz` must still pass untouched.

**Files**

- `src/lib/hydrostatics.ts`
- `tests/verify-solve-extras.ts` (new)
- `package.json` (append the new suite to the `test` chain)

**Interfaces**

```ts
// extended ClipResult
export interface ClipResult {
  clipped: Float32Array
  waterplaneAreaMm2: number
  waterplaneIx: number
  waterplaneIyyMm4: number          // NEW — centroidal, ∫x² dA about the waterplane centroid
  waterplaneCentroidX: number       // NEW — LCF, x coordinate
  waterplaneLoopCount: number
}

// extended Draft0TrimResult (add)
  waterplaneLoopCount: number       // from the winning clip
  Cwp: number                       // Awp / (LWL · BWL)
  wettedSurfaceAreaMm2: number      // surfaceArea(clipped) − Awp
  waterplaneCentroidX: number       // LCF
  waterplaneIyyMm4: number
  tpcTonnesPerCm: number            // Awp[m²] / 100, fresh water

// extended GZPoint (add OPTIONAL fields only)
  draftMm?: number
  minFreeboardMm?: number           // min(bowFreeboardMm, sternFreeboardMm) at this heel

// extended TrimSolveResult (add)
  waterplaneLoopCount: number
  Cwp: number
  wettedSurfaceAreaMm2: number
  waterplaneCentroidX: number
  waterplaneIyyMm4: number
  tpcTonnesPerCm: number
  endTipImmersionDeg: number | null  // interpolated heel where minFreeboard → 0

// solveTrim options (add)
  onAngle?: (info: {
    phase: 'coarse' | 'fine'
    angleDeg: number
    index: number    // 1-based
    total: number
  }) => void
```

**Math (exact, mirror existing code)**

- `Cwp = waterplaneAreaMm2 / (LWL * BWL)` — one line in `findDraft0Trim`.
- `wettedSurfaceAreaMm2 = computeSurfaceAreaMm2(clipped) - waterplaneAreaMm2` (the cap is
  inside `clipped`; import `computeSurfaceAreaMm2` from `geometry.ts`).
- In the cap loop (hydrostatics.ts:540–587), inside the existing `for (const pts of loops)`
  body, mirror the Ix expression exactly with `x`:
  `let Iy = 0; … Iy += (p.x*p.x + p.x*q.x + q.x*q.x) * cross;`
  then `waterplaneIyyMm4 += Math.max(0, Math.abs(Iy)/12 - A*cx*cx)` (paralleling
  `waterplaneIx` at line 577, using the already-computed `cx`).
  Accumulate `lcAreaSum += A` and `lcMomentSum += A*cx`; after the loop
  `waterplaneCentroidX = lcAreaSum > 0 ? lcMomentSum / lcAreaSum : 0`.
- `tpcTonnesPerCm = waterplaneAreaMm2 / 1_000_000 / 100` (fresh water, ρ = 1000 kg/m³).
- `endTipImmersionDeg` is derived in `solveTrim` from `gzCurve` after line 1338: scan the
  points, take the first index `i` (`i >= 1`) with `minFreeboardMm <= 0` and linearly
  interpolate the heel between `i-1` and `i`; if the first point is already `<= 0` return
  `0`; if no crossing exists return `null`. Do **not** add points to `gzCurve` (length is
  asserted). Round to 1 decimal. Label it approximate in the UI (5° samples).
- `onAngle` is called at the end of `searchAngle`, outside the per-angle try/catch, wrapped in
  its own try/catch so a broken handler cannot change the answer. Compute `total` before the
  loops, mirroring the epsilon the loops use **on the angle**, not on the quotient:
  `coarseCount = Math.floor((2*maxTrimDeg + 1e-6)/coarseStepDeg) + 1`,
  `fineCount = Math.floor((2*coarseStepDeg + 1e-6)/fineStepDeg) + 1` (30 at the app's
  defaults: 19 + 11). Add a `phase` parameter to `searchAngle` (internal only).
- `findDraft0Trim` must pass the new clip fields through (it already owns the winning
  `clipBelowPlane` call) — **trap: `solveTrim`'s final return (1303–1341) is an explicit
  field list; every new field must be listed there**, and the fallback path (1278–1298)
  already spreads `...fallback` so it inherits them, but `bowFreeboardMm`-style
  recomputation in the fallback must stay as-is.

**Steps**

1. **Tests first.** Write `tests/verify-solve-extras.ts`:
   - analytic **box** (use the same box builder the other suites use): `Cwp === 1` within
     1e-6; `waterplaneIyyMm4 === L³·B/12` within 1e-6 relative; `waterplaneCentroidX === 0`
     for a centred box; `wettedSurfaceAreaMm2 === L·B + 2·d·(L + B)` within 1e-6 relative;
     `tpcTonnesPerCm === Awp_m2/100` within 1e-6; `waterplaneLoopCount === 1`.
   - a heel case: `Ix/Iy` swap magnitude, and `Cwp`/`Awp` at heel still plausible.
   - real committed hull: `waterplaneLoopCount === 1`, `Cwp` in 0.4–0.9,
     `endTipImmersionDeg` is a number in (0, 90] or null, `LCF` within ±LWL/2.
   - `onAngle`: called exactly `coarseCount + fineCount` times with the final `index ===
     total`, and a solve **with** the callback is identical to one **without** (compare
     `trimDeg`, `draftMm`, `LWL`, `GM`, `displacementKg`).
   Print `PASS` lines / `exit(1)` on failure, matching the existing suites' style.
2. Run it: `npm.cmd exec -- tsx tests/verify-solve-extras.ts` → read the failures.
3. Implement the changes above.
4. Re-run the new suite, then `npm.cmd test` (all nine), then `npm.cmd exec -- biome check
   --write src/lib/hydrostatics.ts tests/verify-solve-extras.ts`.
5. Append `&& tsx tests/verify-solve-extras.ts` to the `test` script in `package.json`.
6. Evidence check: publish baseline unchanged — `trimDeg -1.90°`, offset `1.64 mm`
   (`verify-orientation` must still pass).

**Review focus:** the Iy expression's sign/abs convention matches line 577 exactly; the
explicit return list in `solveTrim` includes every new field; `verify-trim-search` still
bit-identical (no change to `solveDraftLcb`); no new fields shifted any existing number.

**Proposed commit:** `feat(hydrostatics): report Cwp, wetted area, LCF, TPC, Iy, waterplane loop count and end-tip immersion`

---

# Task 2 — Viewer3D: build the scene once per mesh

**Purpose.** `Viewer3D.tsx` creates a new `WebGLRenderer` (new context) on every solve
because its single effect depends on result props. Split into a mount pass (per mesh) and
an update pass (per result).

**Files:** `src/components/Viewer3D.tsx` only.

**Steps**

1. Read the whole file first (354 lines). Catalogue, for each statement in the effect,
   whether it depends on `geometry`, on result props (`waterlineZ`, `trimDeg`, `heelDeg`,
   `waterlineCenterY`, `lcg`, `lcb`, `pivot`), on nothing, or on HUD markup.
2. **Write the test seam first**: extract the pure "result → object transforms" work into an
   exported function inside the same file, e.g.
   `export function applyResultToScene(refs: RefSet, view: ViewerView): void` where
   `ViewerView` is the plain subset of props it needs, using `viewerTrimDeg` /
   `viewerHeelDeg` from `src/lib/viewer-conventions.ts` (never negate the sign inline). No DOM,
   no WebGL in that function — only object transforms. Then the mount effect and the update
   effect both call it.
3. Split the effect:
   - **Mount effect** (deps `[geometry]` and nothing else): renderer, scene, lights, grid,
     axes, controls, hull `Mesh` + material, waterline plane + material, LCG/LCB markers and
     leader lines, initial camera fit, `ResizeObserver`/`resize` listener, animation loop,
     and a cleanup that disposes renderer/geometries/materials. Store everything in refs
     (`hullRef`, `waterlineRef`, `lcgRef`, `lcbRef`, `lineRef…`, `rendererRef`,
     `sceneRef`, `controlsRef`, `frameRef`).
   - **Update effect** (deps `[waterlineZ, trimDeg, heelDeg, waterlineCenterY, lcg, lcb,
     pivot]`): call `applyResultToScene` — set hull rotation (`viewerTrimDeg`/`viewerHeelDeg`
     and the pivot offset the current code applies), waterline position/visibility, marker
     positions/visibility, HUD text state (React state or a direct DOM text update).
4. Delete the dead `rotateHull` prop and its `false` branch (App always passes `true`).
   Remove `rotateHull` from the props type and from the `App.tsx` call site.
5. Behaviour to preserve: the waterline plane is hidden when the hull is not floating
   (today it is), the same hull material/grid/axis look, and the initial camera framing of
   a freshly loaded mesh. Camera position must **not** jump on a result update (the user
   may have orbited).
6. Verify: typecheck, `biome check --write src/components/Viewer3D.tsx`, and
   `npm.cmd run build`.

**Review focus:** mount effect deps are exactly `[geometry]` (add a temporary
`console.count`/comment review if unsure — or verify by reasoning: no result prop appears
in the mount body); every dispose from the old effect still happens on unmount; no
`new WebGLRenderer` inside a result-dependent path; the dead branch is gone.

**Proposed commit:** `refactor(viewer): build the WebGL scene once per mesh, drive results through refs`

**Done (2026-11-09).** Split as specified: `applyResultToScene(refs, view)` is the pure seam,
the mount effect deps are exactly `[geometry]`, the update effect deps are
`[waterlineZ, trimDeg, heelDeg, lcg, lcb, pivot]`, and every old dispose still runs on
unmount (plus `grid`/`axesHelper`, which the old code leaked). Four deviations from the
literal step list, all reported to Richard: (a) `App.tsx` now passes **solver**-space
`trimDeg`/`heelDeg` and the sign translation happens once inside the seam — the old code
did it at the call site, where the prop JSDoc contradicted itself; (b) `waterlineCenterY`
went with `rotateHull`, since the dead `false` branch was its only consumer; (c) the
waterline plane and both markers are created at mount and toggled with `visible`, so the
update pass is transform-only; (d) `tsconfig.test.json` gained `"jsx": "react-jsx"`, because
the new suite imports the component module and the test program could not compile JSX.
`tests/verify-viewer-scene.ts` is a tenth assertion suite (26 checks, wired into `npm test`
and the AGENTS.md matrix). One latent pre-existing bug was found and **preserved verbatim**,
not fixed: the waterline-plane and camera centring use `hullGroup.matrixWorld` on the bbox
centre, but the centre is a *mesh* coordinate, so the correct transform is
`mesh.matrixWorld` (the group matrix omits the mesh's `-pivot` offset). Measured on the test
hull at 75 kg: 54.4 mm, 2.6 % of LWL — the plane and the camera aim at the pivot instead of
the hull's rotated centre. A behaviour change like that needs a go-ahead, so it is a
separate follow-up, not part of this refactor.

---

# Task 3 — Clipper hot path (numeric weld index · fewer allocations)

**Purpose.** `clipBelowPlane` is the solver's hot loop — ~16 ms per plane × ~950 planes
is essentially the whole 15.4 s. Three allocation-heavy costs are on every straddling
triangle; the *algorithm and winding rules must not change*, so the test is
output-identity against a golden snapshot plus a soft perf budget.

**Files:** `src/lib/hydrostatics.ts`, `tests/verify-clipper-perf.ts` (new),
`tests/fixtures/clip-golden.json` (new), `package.json`.

**Steps**

1. **Golden first.** Write a throwaway generator (then delete it, or keep it as a
   `codegen` comment in the test) that, for the committed hull at ~20 heights spanning
   keel→deck and at 2 heel angles, prints a digest of `clipBelowPlane`'s output: the
   `clipped` Float32Array's length, a float-sum/CRC-style hash of its values,
   `waterplaneAreaMm2`, `waterplaneIx`, `waterplaneLoopCount`. Commit that as
   `tests/fixtures/clip-golden.json` **before** touching the implementation.
   Write `tests/verify-clipper-perf.ts` asserting equality against the fixture **and**
   printing the wall time for 20 clips (fail only if it is more than 3× the fixture's
   recorded time — a soft budget, so CI noise cannot break the gate).
2. `WeldIndex.buckets` (`src/lib/hydrostatics.ts:232–275`): change
   `Map<string, number[]>` keyed by `` `${cx + dx}|${cy + dy}` `` to a two-level
   `Map<number, Map<number, number[]>>` keyed by the integer cell coordinates
   (`cx + dx`, `cy + dy`) — no string allocation, no packing bound to reason about. Do
   **not** touch the 3×3 search, the `bestD` closest-match rule, or `nodes` ordering.
3. Per-straddling-triangle allocations: hoist `P`/`flags` (lines 431–436) out of the loop
   as reused scratch buffers (a flat `[ax, ay, az, bx, by, bz, cx, cy, cz]` staged on the
   three vertices), keep `nxt`/`prv` arithmetic **identical**. Remove the `P`/`flags`
   closure allocations; keep `pushTri` and `pushSeg` as-is.
4. `ix()` (lines 359–375) returns a fresh `[number, number]` per crossing: make it write
   into a reused 2-slot buffer and return `void` (callers read `buf[0]`/`buf[1]`). Same
   clamps, same `lerp` calls.
5. Replace `Math.hypot(nx, ny, nz)` (line 403) with `Math.sqrt(nx*nx + ny*ny + nz*nz)`
   and test the squared value against `1e-18` (equivalent to `areaMag < 1e-9`).
   `Math.hypot` is a documented slow path; nothing else uses `areaMag`.
6. **Deliberately not done:** preallocating `out`/`seg*` into typed arrays — an exact
   upper bound would be ~4× the triangle count (5–6 MB per clip, ~950 clips per solve),
   which trades a real allocation for a bigger one. The wins above remove the per-triangle
   garbage, which is the dominant cost.
7. Run the new suite (it must pass against the **pre-change** fixture first — if the
   fixture was captured after the change it proves nothing), then `npm.cmd test`, append
   the suite to the `test` script, biome, and read the printed timing delta.

**Review focus:** golden fixture captured from the *old* code; `waterplaneLoopCount` still
1 on every sampled plane; no change to `solveDraftLcb`/`findDraft0Trim` so
`verify-trim-search` stays bit-identical; `Math.sqrt` threshold truly equivalent
(`1e-9²` = `1e-18`, and both sides are non-negative).

**Proposed commit:** `perf(clipper): numeric weld buckets, scratch buffers instead of per-triangle arrays`

### Done (2026-11-09)

**Committed:** `perf(clipper): numeric weld buckets, scratch buffers instead of
per-triangle arrays` — 6 files, and the gate (`npm.cmd run ci`) exits 0 with all
**eleven** assertion suites green.

**What changed** in `src/lib/hydrostatics.ts`:

1. `WeldIndex.buckets` is now a two-level `Map<number, Map<number, number[]>>` keyed by the
   integer cell coordinates. The 3×3 search order, the `bestD` closest-match rule and the
   `nodes` ordering are untouched — no string key is built per bucket probe.
2. Module-scope scratch `CLIP_VERTS` (9 slots) / `CLIP_FLAGS` (3) / `CLIP_POINT` (2) replace
   the per-straddling-triangle `P` / `flags` arrays and the `nxt`/`prv` closures. `nxt`/`prv`
   became flat indexes `((i+1)%3)*3` / `((i+2)%3)*3` — the same arithmetic.
3. `ix()` writes into `CLIP_POINT` and returns `readonly number[]` (see deviation b).
4. `Math.hypot(nx, ny, nz) < 1e-9` became the squared magnitude tested against `1e-18`.
   `areaMag` has no remaining reader and is gone.

**Measured** — a throwaway probe (20 heights spanning keel→deck on the 12 000-tri decimated
hull, 7 repeats per height after a 3-round warm-up) run against the **new** code, then
`git stash push -- src/lib/hydrostatics.ts` and the same probe against the old:

| | median of medians | total, 20 clips | worst single clip |
| --- | --- | --- | --- |
| old | 5.435 ms | 110.5 ms | 7.738 ms |
| new | 2.793 ms | 53.0 ms | 3.912 ms |

**2.1× faster**, total roughly halved. The stashed A/B was necessary: the suite's own timing
section first *looked* like a regression (median 5.62 → 7.42 ms) because it times a single
cold pass per case, and compilation plus heap growth over the first ~40 clips swamps the
measurement. The suite now runs a warm-up pass before the timed one, which is what makes its
printed medians (~3.7 ms) comparable run to run.

**Deviations from the plan:**

- **(a) The review focus's "`waterplaneLoopCount` still 1 on every sampled plane" is false.**
  The fixture records `1 loop ×30, 2 loops ×8, 3 loops ×2` — one mesh cut does not always
  yield a single waterplane on this hull. The suite therefore asserts identity against the
  recorded counts, and carries its own check that the fixture covers more than one count, so
  a future fixture that flattens the tally cannot silently relax the assertion.
- **(b) `ix()` returns the shared buffer (`readonly number[]`) rather than `void`**, with
  every call site destructuring immediately (`const [e1x, e1y] = ix(...)`). `void` + index
  reads is the same number of operations but reads worse at the call sites; the buffer is
  still single-assignment per crossing, so there is no aliasing hazard.
- **(c) The fixture stores `h` at full round-trip precision, not `Number(h.toFixed(6))`.**
  An earlier fixture rounded to 6 dp, which clips at a *slightly different plane* — the
  clipped lengths and loop counts still matched while every digest differed (~3e-8 relative
  on `Ix`). Storing the exact double makes the case reproducible.

Also: the fixture is JSON, so Biome formats it too (`biome check --write tests/fixtures/
clip-golden.json`); and `verify-clipper-perf` loads it with `new TextDecoder().decode(...)`
because `tests/node-shims.d.ts` declares `readFileSync(path): Buffer` with no encoding
parameter and `Buffer` is just a `Uint8Array` — whose own `toString()` would return
`"123,45,67"`, not the text.

Step 6's deliberate omission stands: `out`/`seg*` are not preallocated into typed arrays.

---

# Task 4 — Web Worker + client

**Purpose.** Move the solve off the main thread with progress and cancel.

**Files**

- `src/lib/solver-worker.ts` (new) — thin worker wiring.
- `src/lib/solver-client.ts` (new) — `SolverClient`.
- `tests/verify-worker-protocol.ts` (new) — Node-side parity test of the message handler.
- `package.json` (append to the `test` chain).

**Interfaces**

```ts
// src/lib/solver-worker.ts
export type SolveRequest = {
  positions: Float32Array     // transferred; a COPY owned by the worker
  targetKg: number
  targetLcgPercentFromBow: number
  kgMm: number
  fixedHeelDeg: number
  maxTrimDeg: number
  trimStepDeg: number
}
export type SolveResponse =
  | { type: 'result'; ok: true; result: TrimSolveResult }
  | { type: 'result'; ok: false; error: string }

/** Node-testable core: run one request, posting progress + the final response. */
export function handleSolveRequest(
  req: SolveRequest,
  post: (msg: { type: 'angle'; index: number; total: number; angleDeg: number; phase: string }
           | SolveResponse) => void,
): void

// worker wiring (bottom of the file) — typed WITHOUT the webworker lib:
const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent<SolveRequest>) => void) | null
  postMessage: (msg: unknown) => void
}
if (typeof ctx.onmessage === 'undefined' && typeof ctx.postMessage === 'function') {
  ctx.onmessage = (e) => handleSolveRequest(e.data, ctx.postMessage)
}
```

Note: `import.meta.url` and `new Worker(..., { type: 'module' })` are covered by the DOM lib
already present in `tsconfig.app.json`; do **not** add a `webworker` lib reference (it
collides with DOM in a single program).

```ts
// src/lib/solver-client.ts
export class SolverClient {
  /** Rejects with Error('cancelled') if cancel() runs, or the solver's message. */
  run(req: SolveRequest, onProgress: (p: { done: number; total: number; angleDeg: number })
      => void): Promise<TrimSolveResult>
  cancel(): void   // terminate the in-flight worker; the next run() recreates it
}
```

Implementation rules: one worker at a time, created lazily by `run`; a monotonically
increasing `runId` so a late response from a terminated worker is ignored; `cancel()`
terminates and rejects the current promise with `Error('cancelled')`; progress messages are
forwarded; `result`/`error` resolved/rejected. **The client copies positions before
transfer**: `const buf = new Float32Array(source); buf.buffer` transferred — because the
viewer shares the mesh's `Float32Array` and a transfer would detach it.

**Steps**

1. Create `src/lib/solver-worker.ts` with the types above; `handleSolveRequest` calls
   `solveTrim(positions, targetKg, { targetLcgPercentFromBow, kgMm, fixedHeelDeg,
   maxTrimDeg, trimStepDeg, onAngle })` and posts angle progress (Task 1's `onAngle`),
   then `{ type: 'result', ok: true, result }`; a `try/catch` posts
   `{ type: 'result', ok: false, error: message }`.
2. Create `src/lib/solver-client.ts` per the interface. `run` builds the request copy and
   posts it.
3. **Test first (write before wiring the App)**: `tests/verify-worker-protocol.ts` —
   a copy of the committed hull's auto-oriented positions (read the STL through the same
   loader the other suites use) →
   `handleSolveRequest(req, collected => …)`; assert: every progress message has
   `index <= total` and the final index equals total; the result's `trimDeg`, `draftMm`,
   `GM`, `displacementKg` are identical (to the same rounding) to a direct
   `solveTrim` call with the same options; the error path maps a thrown solve to
   `ok: false` with a non-empty message (e.g. `targetKg` = 1e9 → the solver throws).
4. Append the suite to `package.json`'s `test` chain; run it, then `npm.cmd test`,
   `biome check --write` on the three files, and `npm.cmd run build` (Vite must emit the
   worker chunk — confirm the build log lists a worker asset).

**Review focus:** no `self`/webworker types; a transferred buffer is never the viewer's
buffer; `cancel()` semantics (a cancelled run must reject, not hang); progress counts
match Task 1's `total`; the worker is constructed with `type: 'module'`.

**Proposed commit:** `feat(solver): run the hydrostatics solve in a Web Worker with progress and cancel`

---

# Task 5 — App wiring: solve in the worker, drop the redundant first solve

**Purpose:** App calls the worker, shows progress + Cancel, and stops running
`findDraft0Trim` just to get a draft (`solveTrim`'s full solve already provides it).

**Files:** `src/App.tsx`.

**Steps**

1. Read `runCalculation` / `handleLoaded` / the state block first. Note the existing
   `calcToken` stale-result guard — keep it.
2. Create a `SolverClient` in a `useRef` (lazily), terminate it on unmount
   (`useEffect(() => () => client.cancel(), [])`) and cancel the in-flight run when a new
   mesh loads.
3. Replace the body of `runCalculation`: no `findDraft0Trim`; build
   `{ positions: new Float32Array(positionsOf(mesh)), targetKg, targetLcgPercentFromBow,
   kgMm, fixedHeelDeg, maxTrimDeg: 4.5, trimStepDeg: 0.1 }`, call
   `client.run(req, onProgress)`, keep the `calcToken` check, and set the same result state.
4. Delete the `draftResult` state, its `findDraft0Trim` import/usage (App line 94), and the
   `draftResult` UI branch (458–476). Viewer props (`waterlineZ`, `waterlineCenterY`,
   freeboards, markers) are now sourced from `trimResult` alone; keep `min-h-0` layout
   intact.
5. Add `progress: { done: number; total: number } | null` state; render a progress bar /
   `Solving… angle 12/30` next to the button while a run is in flight, and a **Cancel**
   button that calls `client.cancel()` and clears the progress. A cancelled run must leave
   the previous results on screen unchanged (catch `'cancelled'` and return quietly).
6. Verify: `npm.cmd run typecheck`, `biome check --write src/App.tsx`, `npm.cmd run build`.

**Review focus:** exactly one solve per click; cancel leaves state consistent; no stale
result applied after cancel/new mesh; the removed branch has no other reader of
`draftResult`; `positionsOf(mesh)` copy is not the viewer's buffer.

**Proposed commit:** `perf(app): solve in the worker with progress and cancel; drop the redundant draft0 solve`

---

# Task 6 — Validation gates (watertight · waterplane contour · scale)

**Purpose:** stop the app from reporting numbers it cannot trust.

**Files:** `src/App.tsx`, `src/components/Upload.tsx`, `src/lib/geometry.ts` (only if a
helper is needed).

**Gates**

1. **Watertight upload**: `mesh.stats.watertight` is already computed by
   `analyzeMesh` at upload and displayed (App 211). If `!watertight.watertight` → a blocking
   banner ("N open edges — the solver needs a closed hull") above Calculate, Calculate
   disabled, and `runCalculation` refuses to start. Keep the Hull table row.
2. **Waterplane contour**: after a solve, if `result.waterplaneLoopCount > 1`, show a
   warning banner ("waterplane split into N loops — the mesh has holes; BM/GM are
   unreliable") and **do not block** (the numbers are still shown). This uses Task 1's new
   field, so `solveTrim` already returns it in both the full and fallback paths.
3. **Scale sanity** in `Upload.tsx` after orientation/centring (it owns parsing): look at
   the largest axis:
   - `maxDim < 1000 && maxDim > 0.01` → `scaleAdvice: { kind: 'metres', factor: 1000 }`
     ("this looks like metres, not mm").
   - `maxDim > 10_000` → `scaleAdvice: { kind: 'large', factor: 0 }` (warn, no fix).
   - otherwise `undefined`.
   `LoadedMesh` gains `scaleAdvice`. App renders a one-line notice; for `metres` an
   **Apply ×1000** button that rescales the position array in place, recomputes stats via
   the existing analysis path, builds a new geometry, and reloads with a **new mesh id**
   (so `key={mesh.id}` remounts the viewer). For `large`, the notice has no button.

**Steps**

1. Read `Upload.tsx`'s `analyzeMesh`/load path and `App.tsx:200–280`.
2. Implement the watertight gate + banner and the loop-count banner in `App.tsx`.
3. Implement `scaleAdvice` in `Upload.tsx` and the Apply path in `App.tsx`.
4. Verify: typecheck, biome on both files, `npm.cmd run build`.

**Review focus:** gates never silently change geometry (scale is applied **only** on an
explicit click); a bad mesh cannot reach `solveTrim`; the loop-count banner does not
disable anything (it is an advisory, per the "no silent modification" rule).

**Proposed commit:** `feat(app): gate on watertight meshes, fragmented waterplanes and implausible scale`

---

# Task 7 — Input handling + localStorage

**Purpose:** numeric inputs stop producing `0` from an empty field, and weight/LCG/KG/heel
survive a reload.

**Files:** `src/App.tsx`.

**Design**

- Keep the raw string in state (`weightInput`, `lcgInput`, `kgInput`) and derive
  `{ weightKg, lcgPercent, kgMm }`; a derived or memoised parse yields
  `inputError: string | null`.
- Empty/NaN → `inputError = 'Enter a number'`; ranges: weight 20–200 kg, LCG 0–100 %,
  KG 0–1000 mm (warn, don't clamp, when KG > hull depth — the depth is
  `mesh.bounds.size.z`; a KG above the deck makes GM meaningless).
- Calculate is disabled when `inputError` or a Task-6 gate blocks; the reason is rendered
  inline (`disabled` buttons still show the reason as text).
- Persist the **valid** values to `localStorage` under `kayak-analyzer.inputs.v1`
  (`{ weightKg, lcgPercent, kgMm, heelDeg }`), written on each valid change, read once at
  mount (lazy `useState` init) with a `try/catch` and a shape check (old/quota errors are
  ignored). Fixed heel is an existing toggle — keep its value and persist it too.

**Steps**

1. Read the input block (App 224–326) and the heel toggle.
2. Implement raw-string state, parse, ranges, inline error, persisted state.
3. Verify: typecheck, biome, build. (A `localStorage` round-trip cannot be unit-tested
   without a DOM; the `try/catch` + shape check is the reliability measure.)

**Review focus:** field never shows `0` when cleared; `Number('')` is never passed to the
solver; persisted values are only used when valid; hand-written malformed JSON does not
break boot.

**Proposed commit:** `feat(app): validate numeric inputs and persist them in localStorage`

---

# Task 8 — Extract the result panel + GZ chart + responsive layout

**Purpose:** App.tsx stops being a 500-line file and the layout works on a narrow window.

**Files:** `src/components/ResultsPanel.tsx` (new), `src/components/GzChart.tsx` (new),
`src/App.tsx`.

**Interfaces**

```tsx
// ResultsPanel.tsx
type ResultsPanelProps = {
  result: TrimSolveResult
  mesh: LoadedMesh | null
}
export function ResultsPanel(props: ResultsPanelProps)
```

**Steps**

1. Read App 340–476 (the `<dl>` block + GZ chart).
2. Create `ResultsPanel.tsx` containing the stat-row/section-title helpers plus the
   Equilibrium / Form / Stability sections — a pure move, **identical markup**, props are
   `result`, `mesh.bounds`, and the derived booleans it needs. Keep number formatting and
   units exactly as they are.
3. Create `GzChart.tsx` wrapping the existing Recharts `<ResponsiveContainer>` chart as-is
   (no annotations yet — Task 8 adds them). Props: `curve: GZPoint[]`, `currentHeelDeg`.
4. Replace the inline blocks in App with the two components.
5. **Responsive layout**: the main row (App 173–201) becomes `flex flex-col lg:flex-row`
   with the viewer `min-h-0 h-[45vh] lg:h-auto` and the aside `w-full lg:w-80 lg:shrink-0`
   (keep the existing padding/gap classes). Ensure the scroll container still works
   (`min-h-0`, `overflow-y-auto` on the aside).
6. Verify: typecheck (strict + `noUnusedLocals`), biome on all three files, build.

**Review focus:** the moved markup is byte-identical apart from indentation/props;
`verbatimModuleSyntax` forces `import type` for type-only imports; no behaviour change
(the diff should be a pure move); below `lg` the viewport gets a real height instead of
being squeezed to nothing.

**Proposed commit:** `refactor(ui): extract ResultsPanel and GzChart; stack the layout on narrow viewports`

---

# Task 9 — Render the new solver fields + annotate the GZ curve

**Purpose:** show the numbers Task 1 produces and the stability quantities a reviewer asks
for, with honest caveats.

**Files:** `src/components/ResultsPanel.tsx`, `src/components/GzChart.tsx`.

**Steps**

1. Add rows to the Form section: `Cwp`, `wettedSurfaceAreaMm2` (label
   "Wetted surface area", mm²), `LCF` (`waterplaneCentroidX`, reported as an x-offset from
   midship with its own label), `TPC` (`tpcTonnesPerCm`, label "Tonnes per cm immersion
   (fresh water)"), and `I_y` in the Stability section (mm⁴, labelled
   "Waterplane longitudinal second moment"). Every row follows the existing
   `StatRow` component and formatting style; no new units are invented.
2. Add "End-tip immersion ≈ X°" to Stability, from
   `result.endTipImmersionDeg`, with the label carrying the resolution caveat
   ("deck end freeboard reaches 0 mm; interpolated between 5° GZ samples"); render
   "not reached within 45°" when null.
3. Annotate `GzChart.tsx`:
   - `ReferenceLine y={0}` (labelled).
   - `ReferenceDot` at the **GZ_max** point with a label "GZ_max".
   - `ReferenceLine`/`ReferenceDot` at the **AVS** (first GZ ≤ 0 after GZ_max, if any) —
     "no AVS within 45°" when absent.
   - `ReferenceLine` at the **current fixed heel** (`result.heelDeg`) — dashed, muted.
   - `ReferenceLine` at `endTipImmersionDeg` when present — dashed, labelled.
   - A caption line under the chart: "GM₀ = {GM} mm is the small-angle initial stability;
     the curve above ~15–20° is the sinkage-limited wall-shape estimate." (Keep GM₀ as the
     solver's `result.GM` — do not recompute a slope.)
4. Stability warnings (presentational, in ResultsPanel): `GM < 100` → "low initial
   stability"; `endTipImmersionDeg !== null && endTipImmersionDeg < AVS` → "an end immerses
   before the vanishing angle — reserve buoyancy at that end is lost"; `waterplaneLoopCount >
   1` → the Task-6 banner text (keep the banner in App, not here).
5. Verify: typecheck, biome, build.

**Review focus:** every displayed field exists on the result type (Task 1) — no optional
chaining that hides a missing field in tests; Recharts `ReferenceDot` needs explicit
`x`/`y` props from the curve data; the AVS scan is over angles **after** GZ_max only.

**Proposed commit:** `feat(ui): show Cwp/LCF/TPC/wetted area/Iy and annotate the GZ curve`

---

## Verification summary (per task)

| Task | New test | Gate |
| --- | --- | --- |
| 1 | `verify-solve-extras.ts` (assert) | `npm test` (9 suites) + build |
| 2 | extracted pure `applyResultToScene` seam | typecheck + build |
| 3 | `verify-clipper-perf.ts` (assert) + golden fixture | `npm test` (11 suites) + build |
| 4 | `verify-worker-protocol.ts` (assert) | `npm test` (11 suites) + build (worker chunk emitted) |
| 5 | — | typecheck + build |
| 6 | — | typecheck + build |
| 7 | — | typecheck + build |
| 8 | — (pure move) | typecheck + build |
| 9 | — | typecheck + build |

Every task ends with `npm.cmd run ci` exit 0 (typecheck → biome → tests → build) before the
commit is proposed. Local hulls in `~/Downloads` are optional (`verify-trim-search` runs 80
cases without them, 240 with); CI never has them.

**Manual owner check (once, after Task 9):** load `tests/test-kayak.stl` in the dev server
and confirm — one WebGL context instead of a new one per solve, the progress bar advances
to 30, Cancel leaves the last result on screen, clearing the weight field shows an error
instead of `0`, and the GZ curve renders with the GZ_max/AVS/deck markers. This cannot be
run from this session's toolset (browser lane off), so it is Richard's to sign off.
