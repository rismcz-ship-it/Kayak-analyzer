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

**Corrected (2026-11-10, cross-review of `f2cd124`)** — two claims in this section, and in `f2cd124`'s
commit message, are overstated. Both are recorded here rather than deleted, so the record shows what
was claimed and why it was wrong.

- **F1 — "`verify-trim-search` stays bit-identical, which is the strongest end-to-end evidence that
  no solver number moved" is self-referential.** All three paths that suite compares — the mirrored
  `searchHalf`, `findDraft0Trim` and `solveDraftLcb` — clip through the *same* `clipBelowPlane`, so a
  change inside the clipper propagates identically to all of them and `dd === 0` stays true even if
  every solver number moved. The suite's own header makes the same point about its mirror. That suite
  therefore proves the mirror is faithful, NOT that solver output is unchanged. What does anchor "no
  solver number moved": the golden fixture, which is genuinely pre-change output, and the published
  baseline in `verify-orientation` (trim `-1.90°`, LCB–LCG `1.64 mm`, both ±tight) plus
  `verify-coefficients`' displacement closure. `verify-clipper-perf.ts`'s header now says this.
- **F3 — "`Math.sqrt` threshold truly equivalent" is false.** Both sides round, so
  `sqrt(nx²+ny²+nz²) < 1e-18` is not bit-identical to `hypot(...) < 1e-9`: a triangle whose
  cross-product magnitude lands within ~1 ULP (relative ~1e-16) of the threshold can flip.
  That is ~1e-25 mm² either side of the 1e-9 mm² threshold — a triangle degenerate to within
  double precision either way, and the real hull has no triangle near it (smallest measured
  cross-product magnitude on the decimated test hull: 3.95 mm², at both heel 0° and 12°). The
  code comment at the threshold now states that instead of claiming equivalence.
- **F2 — the fixture did not cover the boundary branches it was assumed to cover.** On the 40 sampled
  mid-range heights it recorded 0 degenerate-triangle rejects, a smallest cross-product magnitude of
  3.95 mm² against a 1e-9 mm² threshold, and 0 vertices within 1e-9 of a plane — so the accept/reject
  branch and the in-plane `|dz| < EPS` clamps were never executed, and the FNV-1a-over-float32 digest
  could not have seen a change confined to them. The fixture is extended to **54 cases** (20 midpoint
  heights, 4 cut exactly on a vertex z, minZ and maxZ, and 2 carrying a near-degenerate triangle pair
  straddling the threshold, at heel 0° and 12°), and the suite now *checks* that coverage from the
  fixture's own numbers rather than asserting it — including that the two slivers really do split
  one-rejected/one-accepted. `ms` is dropped from the fixture: a timing baseline recorded by the code
  under test cannot gate the code under test, so the budget is now the fixed constant 120 ms. That
  constant is a gross-regression trip-wire only — the pre-change worst clip of 9.84 ms was measured
  on the original 40 sampled heights, so there is no same-case baseline to scale from, and a hard gate
  closer than ~10× this machine's slowest clip would fail on loaded CI runners rather than on real
  damage.

**Second pass (2026-11-10, cross-review of `04b5a2d`, MiniMax M3.1-Flash)** — 12 findings, all
addressed; the reviewer's plan.md holds the line-level record. Two were genuine defects in the
remediation itself:

- **F3 restated wrongly.** The comment put the disagreement band in absolute terms ("within ~1e-18
  mm² of the threshold, i.e. an area of 5e-19 mm²"), which is false — a magnitude of 5e-19 mm² is
  rejected by *both* versions, so it can never disagree. Now stated in relative terms (~1 ULP →
  ~1e-25 mm² at the threshold).
- **F4's fix did not slice.** `new Uint8Array(buf.buffer, …).buffer` still returns the whole pooled
  ArrayBuffer, so the claimed protection did not exist. Replaced with the repo's
  `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)` idiom.

The rest were coverage, provenance and honesty fixes: `caseCount` said 27 against 54 cases and was
never read (it is now asserted against the case list); the (a) vertex-plane check counted *any* case
with a vertex within 1e-9 mm of `h`, so it passed with every vertexZ height broken and its comment
named the wrong branch (the `|dz| < EPS` clamps run per edge; the boundary value a vertex-on-plane
actually exercises is the classification `da <= EPS`); check (c) modelled the slivers in double
precision while the clipper sees float32 (`d = 2e-13` is ~6e-8 relative), so it now reads them back
out of the working `Float32Array`; the budget comment claimed a same-case baseline it did not have
and 30 ms left only 2.3× headroom on the author's machine; the fixture's provenance was prose-only
(the pre-change blob hash and commit are now in `note`, asserted non-empty — the generator is
deliberately *not* kept, since regenerating requires the old module and committing a stale copy of
`src/lib/hydrostatics.ts` under `tests/` would only rot); and the commit message's typing claim
overstated what a readonly tuple buys (the fixed-slot contract is enforced by the constructor and
by the callers reading the head/tail directly, not by the type system).

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

**Done (2026-11-10).** `884020f`'s successor on `main`, uncommitted at time of writing; gate green
(`npm.cmd run ci` exit 0): 12 suites, the worker-protocol suite 25 checks / 0 failed in ~11 s, full
CI ~215 s. Parity against a direct `solveTrim` on the same array is exact (deep-equal of the whole
result object, not a tolerance): `trimDeg -2.7`, `draftMm 124.54425048828125`, `GM 85.1`,
`displacementKg 75.03881900131594`, 974 planes. The run's options are deliberately NON-default
(LCG 50%, KG 300 mm, heel 4°) so that every option the worker forwards changes the answer and a
silently dropped one fails the parity check — with `kgMm: 280`, KG 280, LCG 52% and heel 0° the
worker could have dropped `kgMm` outright and still matched. `kgMm` is the parameter this repo
already shipped a unit bug in (the 272.9 GM in the published baseline), so that is the one that must
never be invisible. The other checks: 108 000 request floats bit-identical after the run; 30 progress
messages with indices 1..30 contiguous, 19 coarse + 11 fine, coarse-before-fine, |angle| <= 4.5°, final
index === total, exactly one result message and it is last; and a thrown solve maps to
`ok: false` — `"solveTrim: kgMm must be > 0 (got -1)"` — without escaping the handler.

Two corrections to this plan's own spec:

1. **The `onmessage` guard was wrong.** `typeof ctx.onmessage === 'undefined'` never fires inside a
   real worker: a `DedicatedWorkerGlobalScope` defines `onmessage` (defaulting to `null`), so the
   test is false and the handler would never attach. What shipped first was
   `typeof ctx.postMessage === 'function' && !ctx.onmessage` — true under Node/tsx (both absent) and
   inside a fresh worker — but that is *also* true on a fresh `window`, so the cross-review
   replaced it with a worker-only test: `typeof ctx.importScripts === 'function' && !ctx.onmessage`.
2. **The error-path trigger was wrong.** `targetKg = 1e9` does not throw: `solveTrim` catches a
   failed angle and falls back, so a 1e9 kg request never raises (it reaches the fallback path
   instead). The one deterministic throw is the `kgMm <= 0` guard, which fires *before* any sweep —
   so the error test uses `kgMm: -1`: no heavy solve to reach it, and it cannot be confused with a
   fallback the solver absorbed.

One documented deviation. Step 4 asks to confirm the build log lists a worker asset; it does not,
and cannot yet: nothing in the app graph imports `SolverClient` until Task 5 wires the App, and an
unused import is tree-shaken — so the check moves to Task 5, where the client is actually
instantiated. This task's build gate is the typecheck, which does cover both new files.
`worker.postMessage(msg, { transfer: [buf] })` (the `StructuredSerializeOptions` form — TS 7's DOM
lib accepts it) typechecks cleanly against the libs already in `tsconfig.app.json`; no `webworker`
lib was added.

`SolverClient` is no longer untested: section 5 of the protocol suite drives it against a fake
`Worker` global in Node (records what was posted, emits messages on command), covering the happy
path, cancel, replacement, a failed solve and a dying worker.

**Cross-review (MiniMax M3.1-Flash, 2026-11-10) — findings and dispositions.**

- **CRITICAL, fixed.** `cancel()` bumped `runId` *before* invoking the stored `cancel` closure, so
  the closure's staleness guard (`myRun !== this.runId`) was always true: **the promise was never
  settled** — it hung forever, on both the cancel path and the "a second `run()` replaced this one"
  path. The client now stores the raw `reject` in `pending` and calls it directly after retiring
  the run and terminating the worker. Proof the new suite bites: with the old client restored,
  section 5 goes RED (3 failed checks — cancel, the replaced run, and the late-message check);
  with the fix, green.
- **SIGNIFICANT, fixed (comment honesty).** The worker's second copy of `positions` was justified by
  "solveTrim rotates scratch over its input". It does not: `solveTrim` copies before pitching
  (`hydrostatics.ts`, beside the cheap sweep) and `decimateMesh` never mutates. The copy is gone and
  the worker solves its transferred buffer in place — which also makes check #1 bite again (with the
  copy, "the request survives the run" was true by construction and could never fail).
- **SIGNIFICANT, fixed.** The parity check could not see a dropped `kgMm`, `targetLcgPercentFromBow`
  or `fixedHeelDeg` because the request's values equalled the solver's defaults. The request now
  carries 50% / 300 mm / 4°, so each of those is pinned. `trimStepDeg` stays 0.1 (the app only ever
  asks for 0.1, and the documented 19 + 11 ladder depends on it); `maxTrimDeg` was already pinned
  at 4.5 against the solver's 3.5 fallback.
- **MINOR, fixed.** The phase-order predicate (`findIndex(fine) >= coarseCount - 1`) still passed a
  coarse message arriving after the first fine; it is now strict, and the ladder itself is pinned to
  19 coarse + 11 fine = 30 rather than read off the message under test (the old `total` was
  self-referential). `phase` is typed `'coarse' | 'fine'` rather than `string`; the unreachable
  "worker closed without a result" branch and the never-read `pending.runId` are gone.
- **MINOR, fixed.** The Node-importability guard (`typeof postMessage === 'function' && !onmessage`)
  is equally true on a browser *main thread*, where it would have hijacked `window.onmessage` and run
  a full solve on any posted message. It is now a worker-specific test (`importScripts` exists only
  in a worker global; the DOM lib does not declare it, hence the optional member on the local cast).
- **NIT, noted.** The working tree also touches `AGENTS.md` and this plan doc — documentation
  upkeep (the new suite row, the suite count, the two new `src/lib/` layout lines), not drift.

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

**Done (2026-11-10).** `884020f`'s successor on `main`; gate green (`npm.cmd run ci` exit 0): 12
suites with the worker-protocol suite at 25 checks / 0 failed, and — closing Task 4's documented
deviation — the build now emits the worker asset `dist/assets/solver-worker-CF7MvmHC.js` (21.53 kB),
because `SolverClient` is finally instantiated by the app graph. The main thread no longer solves:
`grep` over `src/` finds `solveTrim` imported only by `src/lib/solver-worker.ts`, and
`draftResult` / `Draft0TrimResult` / `findDraft0Trim` have no reader in `src/` outside the library
itself and the assertion suites, which keep `findDraft0Trim` as ground truth.

Deviations from this plan's own steps:

1. Step 2 says terminate the client on unmount. What ships is `mountedRef.current = false` plus
   `clientRef.current?.cancel()`, with the flag **re-armed** rather than set once: `<StrictMode>`
   mounts, unmounts and mounts again, so a one-shot effect would leave the dev-mode flag false and
   no result would ever be applied.
2. Step 5 says the Cancel button calls `client.cancel()`. It calls `retireRun()` — bump `calcToken`,
   then cancel — because the token bump is what keeps a *late* `'cancelled'` rejection from clearing
   anything, while the button itself clears `progress` / `isCalculating` directly.
3. Step 4 asks for the `draftResult` UI branch to be deleted; the old `useEffect([mesh])` that cleared
   results went with it, because `setMesh` has exactly one caller (`handleLoaded`) which clears the
   same state — two paths doing one job is how they drift apart.

**Cross-review (MiniMax M3.1-Flash, 2026-11-10) — findings and dispositions.**

- **MINOR, fixed.** The `'cancelled'` rejection branch was unreachable dead code: every path that
  produces that rejection also invalidates its own guard (`retireRun` bumps the token *before*
  `cancel()` rejects; the unmount cleanup clears `mountedRef` first), so the branch never ran, while
  its comment claimed the "cancel leaves the previous result untouched" guarantee — a guarantee that
  in fact rested on the token bump. The branch now runs **before** the guard and is the single
  authority for "a cancelled run clears the in-progress UI and nothing else". No live bug: the state
  was already cleared directly by `cancelCalculation` / `handleLoaded`.
- **MINOR, fixed.** The bar width divided by `progress.total` with no guard, so a `total` of 0
  (impossible from the shipped worker: `coarseCount` and `fineCount` are each `Math.max(1, …)`) would
  render `width: "NaN%"`, which the CSSOM rejects, dropping the declaration and leaving the bar fully
  filled. Now guarded by `progress.total > 0` and clamped with `Math.min(100, …)`.
- **NIT, fixed.** The comment on the App-side `positions` copy claimed "the client transfers this
  buffer" — it does not: `SolverClient.run` copies again and transfers only its own copy (pinned by
  section 5 of `tests/verify-worker-protocol.ts`, "run() transfers a copy, not the request array").
  The copy stays (step 3 asks for it), but the comment now describes what actually happens; the cost
  is one extra memcpy against a seconds-long solve.
- **NIT, fixed.** `role="status" aria-live="polite"` wrapped the Cancel button along with text that
  changes ~30 times, so a screen reader announced a burst of near-identical updates. The live region
  moved onto the status `<span>`; the button sits beside it, outside it.
- **Verified without change:** exactly one solve per click (button `disabled={isCalculating || !mesh}`,
  one `client.run` call, and `SolverClient.run` cancels any previous run); cancel leaves the previous
  result on screen (`trimResult` is never touched on that path); no stale result after a new mesh
  (`handleLoaded` retires the run, then clears the hydrostatics); the viewer's position buffer is
  never detached; no promise left pending and no worker leaked on any exit; the closures/deps and the
  StrictMode double-mount are sound.

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

**Done (2026-11-10).** `727d0af`'s successor on `main`, committed as `5e2e311`; gate green
(`npm.cmd run ci` exit 0): typecheck, `biome check .` (46 files), all **thirteen** assertion suites
(721 trim-search checks over 240 cases, 64 solve-extras, 41 clipper-perf/clipper cases, 25
worker-protocol, 171 clipper identity checks, 30 in the new `tests/verify-upload-scale.ts`), build
emitting `dist/assets/solver-worker-BFu7GqHX.js` (21.61 kB). Baseline intact: bounds
`2714.4 × 613.1 × 325.1 mm`, trim `-1.90°`, LCB–LCG offset `1.637 mm`.

Deviations from this plan's own steps:

1. **Gate 3's thresholds are not the ones written above, and the rule is three bands, not two.**
   `maxDim < 1000` tells a real 900 mm kayak it is metres, and it re-arms after a correct Apply: a
   metre-authored 5.4 m tandem scales to 5400 mm and clears it, but anything under 1000 mm stays
   flagged, so a second Apply produced 900 000 mm. The shipped rule is `maxDim < 500` (no kayak is
   under half a metre long in mm — the committed test hull is 2714) with `> 10 000` unchanged. The
   second review pass then found the gap between them: a 540 cm tandem reads 540 units, over the
   metres threshold and under the plausible-mm one, so it was silent — and the app would have
   analysed a 540 mm kayak. That 500 … 999 band is `small` now: advisory, dismissible, and with no
   `factor`, because whether it is cm or inches (×10, ×25.4) is not knowable from the bounds. The
   no-re-arm rule changed with it: only `metres` is suppressed after an Apply (the mesh is mm by
   construction once the user has corrected it), while `small` and `large` survive — they describe
   the resulting geometry, and a 0.9 m file rescaled to 900 mm really is too short for a boat.
2. **`{ kind: 'large' }` carries no factor.** A variant whose job is "warn, do not fix" but which
   carries `factor: 0` is one `rescaleMesh(mesh, advice.factor)` away from scaling to zero. The
   discriminant only exists where it applies, and `applyScale` early-returns on anything that is
   not `metres`.
3. **The scale decision and its pure helpers live in `src/lib/geometry.ts`**, not `Upload.tsx`:
   that file's header says it stays framework-free and it is where the mm convention is written
   down, and the helpers had to be pure before they could be tested at all. `rescaleMesh` — three
   glue that builds the `BufferGeometry` — stays in `Upload.tsx`, which already owns parsing.
4. **`orientNote` labels the centring offsets in the file's units** rather than unconditionally
   `mm`; on a metres-authored file they are metres and the note says so, and a rescale appends
   `· ×1000 applied to reach mm` so the two statements cannot disagree. Once `small` existed the
   third case followed: bands other than `metres` print `file units`, because "mm" is a claim the
   bounds do not support.

**Cross-review (MiniMax M3.1-Flash, 2026-11-10) — findings and dispositions.**

- **MAJOR, fixed — the weld quantum was a unit bug, not a length.** `checkWatertight` welded on
  a grid of 0.001 in the *array's* units: 0.001 mm on an mm file, 1 mm on the same hull authored
  in metres, where the coarser bucket merges genuinely distinct vertices. Measured on the
  committed hull, the metre spelling reported **1730 phantom open edges** — a hard block on a
  closed, valid file, one banner away from another banner calling the same hull metres. The
  quantum is now `maxDim × 1e-6` (0.0027 mm for the test hull, within a factor of three of the
  old 0.001 mm for mm files), so both spellings weld identically. A real hole still counts as
  exactly 3 open edges at either scale — the fix loosened the tolerance without making the check
  vacuous. `weldVertices` keeps its own 0.001 mm grid by design (decimation numbers are already
  published against it) and its comment now says so instead of claiming they match.
- **MAJOR, fixed — scale thresholds false-positived and re-armed** (`< 1000`, see deviation 1),
  and `large` carried `factor: 0` (see deviation 2). Both pinned by truth-table assertions at the
  500 and 10 000 boundaries.
- **MAJOR, fixed — `waterplaneLoopCount > 1` hid the worst case.** `=== 0` means the cut closed no
  contour at all: area and second moment are 0, `BM` is 0, and `GM` reads `KB − KG`, a plausible
  number out of nothing. The advisory is now `!== 1` with a distinct zero-loop message, lives in a
  `role="status"` region (so a screen reader hears it about the numbers it is about to display),
  and stays non-blocking, as the review focus requires. The solver's `ClippedBelow` doc now states
  the `!== 1` rule rather than describing only `> 1`.
- **MAJOR, fixed — Task 6 shipped with no assertions at all.** `tests/verify-upload-scale.ts`
  (30 checks) covers the pure logic: the truth table, the watertight verdict as a property of the
  mesh rather than its units, the 3-open-edge hole at both scales, the mm → ÷1000 → ×1000 round
  trip through `rescalePositions`/`rescaleMesh`, and the no-re-arm rule.
- **MINOR, fixed — `scaleAdviceFor` sat in a React component** and so was untestable and
  unreachable from the test suite; it moved to `src/lib/geometry.ts` (deviation 3).
- **MINOR, fixed — the metres notice understated the damage and mixed units.** It said "every
  result would read 1000× too small", but volumes are off by 10⁹×, and the axis was printed with
  no unit at all. Now `Largest axis 2.71 m — this looks like metres, not mm. Lengths would read
  1000× too small and volumes 10⁹× too small.` (The second pass then replaced the asserted `m`
  with "in the file's own units" — see below — because an inch-authored hull is caught by the
  same rule and 120 is not 120 m.)
- **MINOR, fixed — `orientNote` claimed mm on a file it had itself called metres**, and kept
  claiming it after the ×1000 applied (deviation 4).
- **NIT, fixed — `rescaleMesh` considered for `geometry.ts`**, but it builds a `BufferGeometry`,
  and the file that holds the mm convention forbids three imports. The pure half moved; the glue
  stayed.
- **NIT, fixed — `Date.now()` mesh ids** collide for two loads in the same millisecond, reusing a
  React `key`; a module-level counter cannot.
- **NIT, fixed** — the Apply button said `×1000` and the note said `x1000`; both use `×`.

### Second review pass (`884020f..HEAD`) — 0 MAJOR, 3 MINOR, 3 NIT, all fixed

Re-reviewed after the first pass's fixes, over Tasks 5 and 6 together, on the NIM MiniMax lane.

- **MINOR, fixed — the loop advisory named a cause the app has already excluded.** Both messages
  said "the mesh has holes". A holed mesh cannot reach `solveTrim` (the banner, the disabled
  button and the belt-and-braces throw in `runCalculation` all stop it first), and a closed
  twin hull or tunnel legitimately produces two loops — the solver's own doc says so. The copy
  now states what the numbers mean: zero loops reports `area and Ix are 0, so BM is 0 and GM
  reads KB − KG`; two-or-more reports that `BM and GM assume a single closed waterplane` and
  names the two-lobe case as legitimate. The zero-loop case is a degenerate or tangent cut
  (over-mass throws earlier), not a hole.
- **MINOR, fixed — `AGENTS.md` overstated the worker suite.** It claimed every forwarded option
  was set to a non-default value, but the suite sends `trimStepDeg: 0.1`, which **is** the
  solver default, so parity could not detect a dropped `trimStepDeg` and neither could the
  count assertion. The row now says `kgMm/LCG/heel` are non-default and that `trimStepDeg`
  stays at the app's 0.1, with the 19 + 11 ladder as what proves it is forwarded.
- **MINOR, fixed — the scale gate only knew about metres, so a centimetre file was silent and an
  inch file mislabelled.** A 540 cm tandem reads 540 units: over the 500 threshold, so no
  notice at all, and the app analysed a 540 mm kayak (lengths 10× too small, volumes 1000× too
  small). A 120-unit inch hull was flagged `metres` and printed `Largest axis 120.00 m` — a
  false magnitude — and Apply ×1000 left it at 120 m with only a `large` warning. Two changes:
  a third band, `small`, for 500 … 999 (too long for metres, too short for mm), which is
  advisory only and carries no factor; and the notice now reports the extent *in the file's own
  units* rather than asserting a unit the app cannot know. The rescale rule changed with it:
  only `metres` is suppressed after an Apply (the mesh is mm by construction), while `small`
  and `large` survive because they describe the resulting geometry — a 0.9 m file rescaled to
  900 mm is genuinely too short for a boat, and that is worth saying.
- **NIT, fixed — `geometry.dispose()` ran inside a state updater**, which must be pure and which
  StrictMode double-invokes in development. Moved to the `handleLoaded` call site; three.js's
  dispose is idempotent, so nothing was broken, but `Viewer3D` deliberately does not dispose
  the hull geometry, making this the only owner it has.
- **NIT, fixed — the suite header pointed at an assertion that lives in another file.** The
  `!== 1` contract claim referenced the analytic box, whose `waterplaneLoopCount = 1` assertions
  are in `verify-solve-extras.ts`; the header now names that file.
- **NIT, fixed — `readFileSync(STL).buffer` was passed unsliced.** It is unpooled for this exact
  file (verified), so no defect, but the worker suite slices and this now matches, so a future
  small-fixture case cannot quietly parse a pool.
- Suite grew to 43 checks (truth table now pins the 500/540/900/999/1000 boundaries and that
  both `small` and `large` carry no factor; the rescale section pins the 0.9 m → 900 mm case
  where `small` survives an Apply while `metres` never does).

**Coverage note, stated plainly.** This suite executes the decision functions and the rescale
path. It does **not** execute the three gates as the user meets them: the banners, the disabled
Calculate button, the Apply button's wiring and the `orientNote` wording are JSX in `App.tsx` /
`Upload.tsx`, and `handleFile` needs a real `File` and an `STLLoader`. Those are covered by
typecheck, `biome check` and a read-through — the same split the project already accepts for
`verify-viewer-scene.ts` — and they need Richard's hands in the browser once before Task 7 lands:
blocking banner on a non-watertight STL, Calculate genuinely disabled, the zero-loop advisory
non-blocking, and Apply ×1000 remounting the viewer with corrected numbers.

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

**Done (2026-11-11).** Uncommitted at time of writing; gate green (`npm.cmd run ci` exit 0,
re-run after the cross-review fixes below): typecheck, `biome check .` (46 files), all thirteen
assertion suites, build. That is this task's own verification step — a `localStorage` round-trip
cannot be unit-tested without a DOM, so the `try/catch` plus the shape check is the reliability
measure. Baseline intact: bounds `2714.4 × 613.1 × 325.1 mm`, trim `-1.90°`, LCB–LCG offset
`1.637 mm`.

Deviations from this plan's own design:

1. **One message per field, printed under its own control.** The plan's wording is `'Enter a
   number'`; a bare string that way cannot say which of three fields is empty. `parseInputs` names
   the field — `'Target weight: enter a number.'` / `'LCG: enter a number.'` / `'KG: enter a
   number.'` — plus one range message per field, and each renders under the input it names instead
   of in one shared paragraph, so a KG message is not printed above the LCG control.
2. **`showHeelInput` is inferred from `heelDeg`, not stored.** The schema is the four documented
   keys, so a saved non-zero heel restores the toggle _on_ — restoring it _off_ would silently
   drop the value — and a saved 0° restores it _off_, which is the same solve either way. The
   value written is the **applied** heel (`showHeelInput ? heelDeg : 0`), not the slider's
   leftover: writing the slider would resurrect a heel the user had switched off.
3. **Over-capacity weight stays a warning, not an error.** `weightKg > volumeLiters` still gets
   an answer from the solver (a bad one), so it does not block Calculate; only the plan's own
   ranges and the Task-6 gates do.
4. **The three inputs are `type="text" inputMode="decimal"`, with no `min`/`max`.** A controlled
   `type="number"` input reports `""` while the user is typing `52.` — the browser sanitises it
   as an invalid float — so a raw-string design loses decimals exactly where it needs them (LCG's
   step is 0.1). Text with a decimal keypad keeps the string the truth, and the ranges are
   enforced by `parseInputs` alone, which is the rule the run actually uses.
5. **Validation is one pure function shared by every consumer.** `parseInputs` feeds the render,
   the disabled condition, the persist effect and the click handler, so the button and the run
   cannot disagree about what is valid. That now holds for the restore path too: the same four
   named predicates (`weightUsable`, `lcgUsable`, `kgUsable`, `heelUsable`) are passed to
   `readStoredInputs` instead of a hand-copied range check, so a stored value the form rejects —
   `kgMm: 0` — cannot boot the app with Calculate permanently disabled.
6. **Each field is parsed on its own.** The three values no longer null out together, so the
   KG-above-deck warning no longer disappears because the weight field is half-typed.

**Cross-review (MiniMax M3.1-Flash, 2026-11-11) — findings and dispositions.** 1 MAJOR / 2 MINOR /
4 NIT, all fixed, gate re-run green afterwards.

- **MAJOR, fixed — a stale heel could resurrect itself.** The effect persisted `inputs.heelDeg`,
  the slider's value, so switching the fixed heel off and reloading brought it back — a heel the
  user had explicitly disabled. Now the *applied* heel is written (`showHeelInput ? heelDeg : 0`)
  with `showHeelInput` in the dep list, which is the inverse of the restore's own inference.
- **MINOR, fixed — the restore accepted a value the form refuses.** `readStoredInputs` range-checked
  `kgMm` with `KG_MIN ≤ v` while `parseInputs` demanded `> KG_MIN`, so a stored `kgMm: 0` shipped
  a form that silently substituted the 280 mm default while the KG box read `0` and Calculate
  stayed dead with no reason on screen. Both sides now call one `kgUsable` predicate (deviation 5).
- **MINOR, fixed — the reason was printed away from the control it named** (deviation 1).
- **NITs, fixed:** the heel slider hard-coded `-30`/`30` next to `HEEL_MIN`/`HEEL_MAX` (now uses
  them); three `setInputs({ ...inputs, … })` calls read the closed-over state (now functional
  updaters); `type="number"` cannot hold a decimal point mid-typing, which is what switched the
  three inputs to `type="text" inputMode="decimal"` (deviation 4); and the KG-above-deck warning
  vanished whenever any of the three fields was momentarily invalid (deviation 6).
- **Confirmed sound:** KG stays a height above the keel (the deck ceiling is `bounds.size.z`, read
  from this mesh, and the messages say so); the heel sign reaches the viewer through the existing
  `viewerHeelDeg` identity rather than a new negation; the four schema keys and the plan's focus
  points are met; no new state, no new dependency, no leak of the raw-string wiring into the
  solver. Gate after the fixes: `npm.cmd run ci` exit 0 (typecheck, `biome check .` 46 files,
  thirteen assertion suites, build). Baseline unchanged.

---

# Task 8 — Extract the result panel + GZ chart + responsive layout

**Purpose:** App.tsx stops being a 500-line file and the layout works on a narrow window.

**Files:** `src/components/ResultsPanel.tsx` (new), `src/components/GzChart.tsx` (new),
`src/App.tsx`, `src/lib/format.ts` (new — `fmt` extracted from App, deviation 1).

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

**Done (2026-11-11).** Uncommitted at time of writing; gate green (`npm.cmd run ci` exit 0,
re-run after the cross-review fixes below): typecheck, `biome check .` (49 files), all thirteen
assertion suites, build. That is this task's own verification step — a pure move changes no
number, so no new suite is warranted (grep: no test references the moved markup). The move
itself was checked mechanically, with a throwaway script comparing HEAD's `<dl>` block against
the two new files whitespace- and trailing-comma-insensitively under the
`trimResult.` → `result.` / `trimResult.gzCurve` → `curve` renames: stat rows + section titles
"IDENTICAL", chart markup "IDENTICAL". Baseline untouched: bounds
`2714.4 × 613.1 × 325.1 mm`, trim `-1.90°`, LCB–LCG offset `1.637 mm`.

Deviations from this plan's own design:

1. **`fmt` left App for its own module** — a fourth file, not in the Files list above. Three
   consumers now (App's Hull line, ResultsPanel, GzChart's tooltip) and exactly one definition
   repo-wide; because the panels must read identically before and after the split, that has to
   be a property of the code rather than of a habit.
2. **The interfaces block's props were narrowed, not widened.** `ResultsPanel` takes
   `result: TrimSolveResult` only and `GzChart` takes `curve: GZPoint[]` only. No moved row
   reads a mesh-derived boolean — the waterplane-loop-count banner already lives in App, which
   is where Task 9 step 4 also says to keep it — and `currentHeelDeg` arrives in Task 9 together
   with the annotations that read it. Both props are now named `interface`s hoisted above the
   component (`ResultsPanelProps` / `GzChartProps`) to match `UploadProps` / `Viewer3DProps`.
3. **`statRow` is exported from ResultsPanel and imported by App** for the Hull section: one
   definition, so the two panels cannot drift. Task 9 step 1's "StatRow component" means this
   same helper; it is deliberately not renamed, and Task 9 does not add a second one.
4. **Step 5's recipe was itself the bug.** It carried the viewer's `flex-1` over from the old row
   layout into a `flex-col` — see cross-review finding 1. As built: viewer
   `min-h-0 h-[45vh] min-w-0 flex-none … lg:h-auto lg:flex-1`, row `flex flex-col min-h-0 flex-1
   gap-4 lg:flex-row`, aside `min-h-0 w-full … overflow-y-auto lg:w-80 lg:shrink-0` exactly as
   specified.

**Cross-review (MiniMax M3.1-Flash, 2026-11-11) — findings and dispositions.** 1 MAJOR / 2 MINOR /
2 NIT. The MAJOR and the NITs are fixed in code; the two MINORs are documentation drift and are
fixed by this block.

- **MAJOR, fixed — the viewer collapsed to 0 px below `lg`.** In the column row `flex-1` is
  `1 1 0%`, and a non-`auto` flex-basis overrides `height` on the main axis (CSS Flexbox §9.2),
  so `h-[45vh]` was inert while `min-h-0` removed the automatic minimum: once the aside's content
  exceeded the row — i.e. right after Calculate, on any viewport under 1024 px — the viewer's
  scaled shrink was `shrink × basis = 0` and the 3D hull vanished. Now `flex-none` (0 0 auto)
  keeps `h-[45vh]` as the real base size below `lg` and only `lg:flex-1` grows it at ≥1024 px,
  where `lg:h-auto` plus the cross-axis stretch restores the HEAD layout exactly. The aside, the
  only item that may shrink, absorbs the rest and scrolls internally; and since the row is
  `100vh − header − padding` while the viewer wants 45vh, the viewer can never outgrow the row,
  so the aside cannot be squeezed away either.
- **MINOR, fixed by this block — the plan was stale on its own interfaces** (deviation 2) and on
  its file list (deviation 1: `src/lib/format.ts`).
- **NITs, fixed:** the prop types are named and hoisted (deviation 2); Task 9 step 1's
  `StatRow component` wording now reads as the existing `statRow` helper (deviation 3), so
  nothing "adds a StatRow component" next to it.
- **Confirmed sound:** the moved markup is byte-identical apart from indentation and the two
  renames; every unit, per-field digit count and the `+` prefix for trim/heel survive; the live
  region (`<output id="draft-output" aria-live="polite">`), all four banners, the "No results
  yet." branch, the Hull section and the `Viewer3D` props are untouched; `verbatimModuleSyntax`
  is honoured with `import type` throughout; no new dependency, no schema change, and no frozen
  convention (trim `+` = bow up, heel `+` = the −Y side down, KG a height above the keel, mm
  units) altered. Above `lg` the layout is equivalent to HEAD. The responsive verdict is a
  static trace of the flex chain plus the ratio argument above — **not** an observed browser
  render, which this session did not do.

---

# Task 9 — Render the new solver fields + annotate the GZ curve

**Purpose:** show the numbers Task 1 produces and the stability quantities a reviewer asks
for, with honest caveats.

**Files:** `src/components/ResultsPanel.tsx`, `src/components/GzChart.tsx`, `src/App.tsx` (the
current-heel reference line), plus the solver files only if a field turns out not to be on
`TrimSolveResult` yet.

**Steps**

1. Add rows to the Form section: `Cwp`, `wettedSurfaceAreaMm2` (label
   "Wetted surface area", mm²), `LCF` (`waterplaneCentroidX`, reported as an x-offset from
   midship with its own label), `TPC` (`tpcTonnesPerCm`, label "Tonnes per cm immersion
   (fresh water)"), and `I_y` in the Stability section (mm⁴, labelled
   "Waterplane longitudinal second moment"). Every row follows the existing
   `statRow` helper and formatting style; no new units are invented.
2. Add "End-tip immersion ≈ X°" to Stability, from
   `result.endTipImmersionDeg`, with the label carrying the resolution caveat
   ("deck end freeboard reaches 0 mm; interpolated between 5° GZ samples"); render
   "not reached within 45°" when null.
3. Annotate `GzChart.tsx`:
   - `ReferenceLine y={0}` (labelled).
   - `ReferenceDot` at the **GZ_max** point with a label "GZ_max".
   - `ReferenceLine`/`ReferenceDot` at the **AVS** (first GZ ≤ 0 after GZ_max, if any) —
     "no AVS within 45°" when absent.
   - `ReferenceLine` at the **current fixed heel** (`result.heelDeg`, threaded in as a prop by
      App — Task 8 deferred it) — dashed, muted.
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
| 9 | `verify-gz-marks.ts` (assert) | `npm test` (14 suites) + build |

Every task ends with `npm.cmd run ci` exit 0 (typecheck → biome → tests → build) before the
commit is proposed. Local hulls in `~/Downloads` are optional (`verify-trim-search` runs 80
cases without them, 240 with); CI never has them.

**Manual owner check (once, after Task 9):** load `tests/test-kayak.stl` in the dev server
and confirm — one WebGL context instead of a new one per solve, the progress bar advances
to 30, Cancel leaves the last result on screen, clearing the weight field shows an error
instead of `0`, and the GZ curve renders with the GZ_max/AVS/deck markers. This cannot be
run from this session's toolset (browser lane off), so it is Richard's to sign off.
---

# Task 9 — Done

**Verification (re-run after the cross-review fixes below):** typecheck (`tsc -b`, three programs),
`biome check .`, all fourteen assertion suites — the new `verify-gz-marks.ts` (24 checks) included,
the other thirteen unchanged — then the Vite build. The gate is `npm.cmd run ci` exit 0.

Deviations from this plan's own design:

1. **A fourth file, `src/lib/gz-marks.ts`.** Step 3's markers and step 4's "an end immerses first"
   warning read the same two angles off the same points. Scanning twice in two components lets them
   drift, so the scan is one pure function that both call. `npm test` gained a fourteenth suite for
   it, because the branchy cases are exactly the ones the cross-review found wrong.
2. **App.tsx is unchanged; ResultsPanel threads the chart props.** App renders ResultsPanel, not
   GzChart, and the result already carries `heelDeg` / `endTipImmersionDeg` / `GM`, so the props
   pass down from the panel that holds them instead of being copied through App.
3. **AVS is the interpolated zero crossing, and its marker sits on the GZ = 0 line.** Step 3's
   "first GZ ≤ 0 after GZ_max" says where to look; reporting that SAMPLE as the angle overstates
   the vanishing angle by up to one 5° step (45° reported against a 40.7° crossing on this hull),
   which is the unsafe direction for a stability number, and the dot was drawn at an arbitrary
   negative arm below the zero line. The crossing is now linearly interpolated between the last
   positive and the first non-positive sample, and drawn at y = 0.
4. **A curve with no positive arm reports that instead of a peak.** Its 0° anchor is GZ = 0 by
   construction, so the sample-based peak rule labelled a sinking hull "GZ_max 0 mm". `gzMax` is
   null there, and the caption reads "no positive righting arm within 45°".
5. **LCF is labelled "LCF X", not "from midship".** `waterplaneCentroidX` is hull-frame X, and the
   mesh is centred on its BOUNDING box at upload (`centerToOrigin`) — 50 % from the bow, not the
   app's 52 % midship and not the waterplane's amidships. The claim in step 1 cannot be made
   honestly, so the row is labelled like its LCB/LCG neighbours.
6. **The end-tip caveat names the stem tip, not the deck edge.** The solver documents
   `endTipImmersionDeg` as a stem-tip clearance and states "What this is NOT: a sheer or deck-edge
   immersion angle"; step 2's wording would have told the reader a deck edge submerges at 38.4° when
   it is the stem tip. The caveat also only renders alongside a non-null value, because
   "not reached within 45°" and "freeboard reaches 0 mm" contradict each other.
7. **I_y is printed in scientific form (2.79e11 mm⁴).** `fmt(v, 0)` printed twelve significant
   digits — false precision for a moment taken off a decimated mesh.
8. **A non-positive GM gets its own wording.** "Low initial stability — GM −18.7 mm is under
   100 mm" understates a hull that does not right itself.
9. **The fixed-heel marker's absence is stated in words.** Recharts discards a reference line
   outside the axis domain, so a negative fixed heel (the slider's lower half) vanished silently;
   the caption line now names it.
10. **The panel's markup is now valid `<dl>`.** Each section is its own list, with the titles, the
    warnings and the chart as siblings, so no `<p>` or `<div>` sits inside a `<dl>`, which admits
    only title/value pairs.
11. **Mixed area units, and TPC in tonnes, accepted on purpose.** Waterplane area stays in m² (the
    existing row) while wetted surface is mm² (step 1); TPC stays in tonnes/cm (step 1), the one
    deliberate exception to AGENTS.md's "all UI output is mm and kg". Recorded here so a later task
    does not flip one of them by accident.
12. **No opposite-case warning.** The review suggested a second box for an end that immerses AFTER
    the vanishing angle; step 4 defines only the "<" case and the row itself states both numbers, so
    the extra box was left out.

**Cross-review (MiniMax M3.1-Flash, 2026-11-11) — findings and dispositions.** 1 BLOCKER / 4 MAJOR /
8 MINOR / 6 NIT, all raised against the first working-tree draft of this task. Every one is fixed in
the code above except the three recorded as decisions (items 5, 6, 11) and the one NIT accepted
below.

- **BLOCKER, fixed — the end-tip warning never compared the two angles.** Step 4's condition
  (`endTipImmersionDeg < AVS`) had been coded as "the end-tip angle is not null and an AVS exists",
  so at 150 kg the panel printed "An end immerses at 38.4°, before the 5° vanishing angle" — a
  self-contradicting false safety claim about a hull that was already unstable well before it. The
  comparison is now made.
- **MAJOR, fixed — LCF's origin and the code comment behind it (item 5).**
- **MAJOR, fixed — the AVS sample angle, and a marker drawn below the zero line (item 3).**
- **MAJOR, fixed — the 0° anchor promoted to GZ_max on a hull with no positive arm (item 4).**
- **MAJOR, fixed — the caveat said "deck end freeboard" for a stem-tip measurement (item 6).**
- **MINOR, fixed —** I_y false precision (7); the caveat under "not reached" (6); the GM₀ caption,
  which now states that the curve is the upright, untrimmed hull while the GM is the trimmed
  solve's, so the two are not read as one condition; the silently discarded negative-heel marker
  (9); the negative-GM wording (8); the duplicated scan, now one shared object with a comment that
  no longer claims the chart sits "above" the panel it is rendered under; and the `<p>`-inside-
  `<dl>` markup (10).
- **NIT, fixed —** the over-long caption line is wrapped; the chart's top margin gives the dot
  labels headroom; the end-tip label moved to the opposite vertical anchor from the fixed-heel
  label, so the two cannot collide; and GZ_max's number is stated in the caption instead of only in
  the tooltip.
- **NIT, fixed by this commit —** `src/lib/gz-marks.ts` was untracked and is added with it.
- **NIT, addressed by item 1 —** `gzMarks` is new pure branchy logic, so it now has
  `verify-gz-marks.ts` (24 checks: empty, single-point, all-zero and all-negative curves, a tie on
  the maximum, a peak as the last sample, the scan starting after the peak, the interpolated
  crossing, and the committed hull's real curve).
- **NIT, accepted —** the `GZ = 0` line keeps its `insideBottomLeft` label. The zero line sits above
  the axis whenever the curve goes negative, and the "Heel (°)" axis label is anchored
  insideRight, so the two do not overlap in the normal case.

**Second pass, post-push (MiniMax M3.1-Flash, NIM lane, 2026-11-11) — findings and dispositions.**
Verdict SHIP, 4 minor + 3 nit against the committed `2032268`/`6573f3f` tree. All seven adjudicated
as real and fixed at `db6a4bc`; none rebutted. The pass also REBUTted a stale section-3 comment
finding of its own, correctly — that wording was already corrected before the commits.

- **minor, fixed — the end-tip warning claimed "reserve buoyancy at that end is lost"** for a
  measurement the solver defines as *stem-tip* clearance, and explicitly not the sheer/deck-edge
  immersion angle (`src/lib/hydrostatics.ts`, `endTipImmersionDeg`). The warning now states what was
  measured — the stem tip is at the waterline while the hull still has a righting arm — rather than
  the consequence it could not support.
- **minor, fixed — the chart caption called the plotted curve "the sinkage-limited wall-shape
  estimate."** The curve is `compute_gz_curve_geometric`, whose doc says *no* wall-sided assumption
  is involved, so the caption described a model the solver rejects; the wording was inherited from
  this plan's step-2 caption and was shown to the user as fact. It now names the measured curve,
  sinkage-limited past ~15–20°, with no wall-sided formula.
- **minor, fixed — `GM <= 0` labelled GM of exactly 0 "Negative GM 0 mm".** `verify-gz.ts` reaches
  GM = 0, so the branch is live. Split into `< 0` negative / `=== 0` neutral / `> 0` low.
- **minor, fixed — the BLOCKER's condition was untestable JSX.** It now lives in
  `src/lib/gz-marks.ts` as `endTipWetsBeforeVanishing`, returning the `EndTipFirst` pair it compared;
  the panel formats that pair, so TypeScript enforces the non-null narrowing the old branch faked
  (which is what the first gate run on the change caught). Pinned by `verify-gz-marks.ts` section 6,
  including both null cases, so the suite is now 30 checks.
- **nit, fixed — the chart's fixed-heel label dropped the sign the panel row prints, and the
  out-of-range note only tested the negative half of the axis domain.** `signed()` was added to
  `src/lib/format.ts` and now carries the sign for trim, fixed heel, LCF X and the chart label
  (three copies of the ternary collapsed into one definition); the note tests the domain.
- **nit, fixed — `maxHeelDeg` seeded from 0** clamped a curve whose samples all sit below zero to an
  angle it never measured. Seeded from the first sample, empty case guarded.
- **nit, fixed — the end-tip row's caveat did not say the angle is measured on the upright,
  untrimmed hull**, while the rows beside it carry the trimmed solve's numbers. The row says so now.

Evidence: `npm.cmd run ci` exit 0 on the remediated tree; `verify-gz-marks.ts` 30 checks; a
throwaway probe on the real hull showed the new rule silent at 75 / 150 / 190 kg and the false claim
arising only where a curve keeps an arm past the wetting angle — the shape section 6 now pins, so
that regression cannot return silently.

**Still Richard's to sign off:** the manual owner check above — it needs a browser, which this
session does not have.
