# AGENTS.md — Instructions for AI Agents in kayak-analyzer

## Project Overview

Local web app for static kayak hydrostatics analysis.

- **Frontend**: Vite + TypeScript + React 19 / Three.js (STL rendering, waterline plane, GZ chart via Recharts).
- **Solver**: Client-side TypeScript only. There is **no Python, no FastAPI, no backend, no server** in this repo. All math runs in the browser.
- **Goal**: Upload STL -> auto-orient -> set weight/LCG/KG/heel -> read draft, trim, LCB/LCG, form coefficients, and stability (KB/BM/KM/GM + GZ curve).

## Invariants & Math Conventions (FROZEN SPEC)

`tests/verify-orientation.ts` **asserts** the axis frame (bullet 1), the trim and heel
signs, the viewer sign translation, the KG threading (bullet "KG is a HEIGHT") and the
published baseline. If you change one of those, that suite fails until you change the
suite and these docs together. The Y-mirror rule and the trim-sweep shape are documented
behavior without a dedicated suite yet — verify by hand when touching them.

- **Coordinate System**: **Z-up, X = LOA (bow = +X, stern = -X), Y = beam.** This is the opposite of the "Bow = +Z, Up = +Y" convention some Fusion 360 exports use. `autoOrientToZUp()` normalizes any input into it; `src/lib/geometry.ts` and `src/lib/hydrostatics.ts` assume it everywhere.
- **Lateral sign is not fixed**: `autoOrientToZUp()` mirrors Y whenever the axis permutation is odd. Port/starboard is not stable across uploads. Do not depend on the sign of Y.
- **Trim sign**: `+ = bow UP` (marine convention). `applyPitchY(+rad)` pitches bow up; `solveTrim` returns `trimDeg` in the same convention. The viewer negates it, because Three.js rotates the other way round about +Y — the translation lives in `src/lib/viewer-conventions.ts` (`viewerTrimDeg`), and the scene seam `applyResultToScene` in `src/components/Viewer3D.tsx` calls that rather than negating inline.
- **Heel sign**: `+ = the −Y side goes down`. `applyRollX(+rad)` is the plain right-hand rotation about +X, so it lifts the +Y side and drops the −Y side; the solver applies it before trim. With bow = +X and up = +Z the paddler's right hand points along −Y, so −Y is starboard and the old "starboard down" wording is right _for an un-mirrored STL only_ — because `autoOrientToZUp` may mirror Y, prefer the "−Y side down" phrasing. The viewer needs no negation here (`viewerHeelDeg`).
- **Mesh Requirements**: STL in **mm**, closed deck required. Report non-watertight meshes; do not silently modify geometry.
- **Units**: The solver works in **mm, mm², mm³** — not meters. Fresh water `rho = 1000 kg/m³`, so `MM3_PER_KG = 1_000_000` and 1 kg = 1 L. All UI output is mm and kg.
- **Defaults**: Target weight 75 kg, LCG 52% of LWL from bow, KG 280 mm above the keel (`DEFAULT_KG_MM`), trim sweep ±4.5°, heel 0°. Weight/LCG/KG live in `src/App.tsx`; the solver's own fallbacks are LCG 52%, `maxTrimDeg` ±3.5°, `trimStepDeg` 0.1° and KG 280 mm (`src/lib/hydrostatics.ts`). The app always passes 4.5° explicitly.
- **Trim sweep shape**: the solver sweeps **coarse** at 5× the fine step (0.5° by default) across ±`maxTrimDeg`, then **fine** at `trimStepDeg` (0.1°) over ±0.5° around the winner. It is not a uniform 0.1° sweep — do not model its cost as one.
- **KG is a HEIGHT above the keel**, not an absolute Z. Passing an absolute Z to a KG argument was a real unit bug here (`src/lib/hydrostatics.ts`).
- **Upload cap**: 25 MB, enforced in `Upload.tsx`. Parsed in memory; nothing is uploaded anywhere.

## Workflow Rules & Seams

1. **Git Control**: Do not commit blindly. Follow the user's workflow. There is no in-app event log yet — `HistoryManager` is referenced in older plans but does not exist in `src/`.
2. **References & Schemas**: Event schemas live in `references/` — five of them, and **none of them is a description of current output**. Nothing in `src/` emits any of them yet; they are target formats for a future "save a run" feature.
   - `kayak_analyzer_solver.json` — one solve run. `lwl_mm` / `bwl_mm` are reachable (the solver returns them as `LWL` / `BWL`); `kg_mm` is now **required** (the UI exposes KG, so a run without it cannot be reproduced); `model_hash`, `phase`, `stations_csv_path` and the `coefficients` block have no implementation. `waterline_polygon` is not in `required` — the clipper discards the contour after measuring its area and second moment, so the points are not available.
   - `kayak_analyzer_model.json` — an uploaded STL.
   - `kayak_analyzer_config.json` — a weight/LCG/KG change.
   - `kayak_analyzer_comparison.json` — two models compared.
   - `kayak_analyzer_repo_sync.json` — a commit synced to a run.

   Do not invent new ad-hoc JSON formats. If you implement a producer, add the matching schema check with it.
3. **No External CAD Dependencies**: The core web viewer must run standalone without requiring Fusion 360 or FreeCAD to be open.
4. **Pure frontend**: Do not introduce a server, API route, or Python dependency. If a feature seems to need one, solve it in the browser first.
5. **No new runtime dependencies** without asking. The repo deliberately has no `@types/node`; the test program gets the few Node globals it needs from `tests/node-shims.d.ts` instead.
6. **Project memory lives outside this repo**: ongoing session state and durable decisions are kept in `C:/Users/Richard Malán/projects/manager/STATE.md` (the manager project). Read it when work continues prior sessions or a hand-off; update it at the end of a work session when asked.

## Verification / Definition of Done

The single gate is **`npm run ci`** — `typecheck` → `biome check` (format + lint) →
`npm test` → `npm run build` — and it must exit 0. Formatting is enforced by Biome
(`biome.json`: single quotes, no semicolons, space indent, 100-col lines; LF line endings
via `.gitattributes`) — run `npm exec -- biome check --write` on your touched files
instead of hand-formatting (this machine blocks `npx` via PowerShell execution policy).

In detail, before completing any task:

1. Run build/typecheck: `npm run build`. This runs `tsc -b` and must be clean — `strict`, `noUnusedLocals`, and `verbatimModuleSyntax` are all on. `tsc -b` covers **three** programs: `src` (`tsconfig.app.json`), `vite.config.ts` (`tsconfig.node.json`) and `tests` (`tsconfig.test.json`). The test suite is type-checked — a type error in a suite fails the gate.
2. For solver tasks: run `npm test` and confirm it exits 0. The `verify-*` suites assert against analytic ground truth; the `test-*` scripts only print, so read their numbers.
3. For geometry/orientation tasks: confirm the notes string and the sign conventions still hold — several bugs in this repo came from a sign flip, not from wrong math. `tests/verify-orientation.ts` is the gate for those.
4. Ensure no unhandled runtime errors in the browser console.

## Environment Notes (Windows / PowerShell)

- `npm.ps1` is blocked by the machine's execution policy. Invoke npm as **`npm.cmd`** (`npm.cmd run ci`). `npx` is blocked too — run tools through npm instead: `npm.cmd exec -- tsx tests/verify-analytic.ts`.
- PowerShell 5.1's `Get-Content` defaults to the ANSI code page, so UTF-8 text (em dashes, `°`) comes out as mojibake. The files themselves are correct UTF-8 without BOM — **read them with `Get-Content -Encoding UTF8`** and do not "fix" what you see.
- Biome writes its summary to stderr, so `npm.cmd … 2>&1` renders a _successful_ run as a red `NativeCommandError` block. Check the exit code, not the colour.
- `npm test` runs 80 cases locally with only the committed mesh, but 240 when the optional local hulls are present. Point `KAYAK_LOCAL_HULL_DIR` at the folder holding them (default: `~/Downloads`). CI never has them, so CI runs the 80-case set.

## Test Resources

Scripts in `tests/` — run when modifying the corresponding module. **They fall into two groups, and the difference matters.**

`test-*.ts` are `console.log` harnesses. They print numbers and **always exit 0**, so a wrong result still reports success — you must read the output.

`verify-*.ts` are assertion suites. They compare against analytic ground truth or against the committed baseline, print `FAIL` lines, and **exit non-zero when a check fails**. Run them with `npm test`, which chains them and stops at the first failure. A few end with only explicit `exit 1` branches and return 0 by normal termination on success — that is expected, not a gap.

Every `verify-*` suite needs `tests/test-kayak.stl` (2.0 MB, tracked in git). Without it they fail at import. The two exceptions: `verify-viewer-scene.ts` drives a library seam and needs no mesh, and `test-lcb.mjs` reads a local hull that is _not_ in the repo and skips itself when it is absent. `verify-clipper-perf.ts` additionally needs `tests/fixtures/clip-golden.json`, the fixture it asserts identity against (regenerate with the `tests/fixtures/` note's recipe).

| Test                     | Group  | Trigger               | Validates                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-orientation.ts`  | assert | Conventions           | The frozen spec itself: Z-up / X = LOA / bow at +X, trim `+` = bow up, heel `+` = −Y side down, the viewer sign translation, and the published baseline numbers                                                                                                                                                                                                                                         |
| `verify-analytic.ts`     | assert | Coefficients          | Box + cylinder known answers: Cb/Cp/Cm, KB, BM, Awp at heel                                                                                                                                                                                                                                                                                                                                             |
| `verify-box-identity.ts` | assert | Coefficients          | Box identity — BM = I/V, KB = draft/2, section clipping                                                                                                                                                                                                                                                                                                                                                 |
| `verify-coefficients.ts` | assert | Coefficients          | Real-hull Cb range, displacement closes on target                                                                                                                                                                                                                                                                                                                                                       |
| `verify-decimation.ts`   | assert | Geometry              | QEM output watertight, on target, volume error; analytic subdivided cube                                                                                                                                                                                                                                                                                                                                |
| `verify-gz.ts`           | assert | Stability             | GZ curve vs analytic box closed form and vs the production geometry path                                                                                                                                                                                                                                                                                                                                |
| `verify-heel-real.ts`    | assert | Stability             | Real-hull draft rises and BM falls monotonically with heel                                                                                                                                                                                                                                                                                                                                              |
| `verify-trim-search.ts`  | assert | Solver                | Cheap trim search is bit-identical to the full solve **and** to the production `solveDraftLcb` (80 cases with only the tracked mesh; +80 per present local floatable STL, 0 for the open sections)                                                                                                                                                                                                      |
| `verify-solve-extras.ts` | assert | Solver: extras        | Tier-1 extras against analytic box ground truth (Cwp, Iy/Ix axes, wetted area, TPC, loop count, LCF frame) plus `onAngle`'s total and `endTipImmersionDeg`'s three branches                                                                                                                                                                                                                             |
| `verify-viewer-scene.ts` | assert | Viewer                | The `applyResultToScene` seam: solver trim/heel signs reach the scene, the `pivot ?? lcg ?? centre` chain and its stationary pivot, the mesh-vs-group-vs-world frame rule for the waterline plane and both marker sets (asserted in world space), `visible` gating when not floating, in-place leader-line writes, and the seam's purity (no renderer/camera/controls keys read)                        |
| `verify-clipper-perf.ts` | assert | Solver: clipper       | `clipBelowPlane` output identity against `tests/fixtures/clip-golden.json` (40 cases: 20 heights x heel 0/12 deg on the 12000-tri decimated hull) — byte digest of the clipped solid, waterplane area/Ix/Iy, LCF, loop count — plus a soft 3x wall-time budget. Not an analytic check: it pins the numbers the pre-optimisation code produced, so the allocation rewrite could not quietly change them. |
| `test-auto-orient.ts`    | print  | Geometry: orientation | `autoOrientToZUp()` — arbitrary STL axes → Z-up, deck-up, bow detection                                                                                                                                                                                                                                                                                                                                 |
| `test-box.ts`            | print  | Geometry: primitives  | All geometry helpers + `solveTrim` on synthetic hull with known ground truth                                                                                                                                                                                                                                                                                                                            |
| `test-solver.ts`         | print  | Solver: trim          | Full pipeline: 4 orientation scenarios × trim sweep                                                                                                                                                                                                                                                                                                                                                     |
| `test-lcb.mjs`           | print  | Mesh: external        | Raw mesh validation on a local hull — `KAYAK_LOCAL_HULL_DIR` / `~/Downloads/Kayak v2.stl`; skips itself when absent                                                                                                                                                                                                                                                                                     |
| `test-kayak.stl`         | data   | —                     | Test mesh (2.0 MB), required by every `verify-*` suite                                                                                                                                                                                                                                                                                                                                                  |

Run: `npm test` (all eleven assertion suites, stops on first failure) · `npm run test:print` (the `console.log` harnesses) · or a single file with `npm exec -- tsx tests/<file>.ts` / `node tests/test-lcb.mjs`

**Published baseline** for the test hull after correct auto-orientation, asserted by `verify-orientation.ts`:
bounds `2714.4 x 613.1 x 325.1 mm` (±0.5 mm), trim `-1.90°` (±0.05°), LCB–LCG offset `1.64 mm`.
The offset is the residual left by the 0.1° fine sweep, not an error — a _large_ offset means
orientation or bow detection broke.

## Repository Layout

```
src/lib/geometry.ts          mesh utilities, orientation, decimation, section measurement
src/lib/hydrostatics.ts      the solver: clipping, coefficients, stability, trim sweep
src/lib/viewer-conventions.ts  solver -> Three.js sign translation (trim, heel)
src/components/               Upload, Viewer3D
tests/                        assertion suites + diagnostic scripts + the test mesh
references/                   five target schemas for saved runs (nothing emits them yet)
sketches/                     standalone HTML UI mockups — design references, not the app
.opencode/skills/             vendored third-party agent skill packs (MIT) — not part of the app
```

`sketches/` and `.opencode/skills/` are **not** built, **not** shipped and **not** covered by
Biome or the typecheck. The skill packs are upstream content: the `threejs-*` ones are by
OpenAEC-Foundation, `naval-architect` by K-Dense. Do not treat them as application code, and
do not "fix" their contents to match this repo.

## Keep it simple

- simple but complete is efficient
- don't complicate it
