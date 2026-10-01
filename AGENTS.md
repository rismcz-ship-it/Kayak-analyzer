# AGENTS.md — Instructions for AI Agents in kayak-analyzer

## Project Overview
Local web app for static kayak hydrostatics analysis.
- **Frontend**: Vite + TypeScript + React 19 / Three.js (STL rendering, waterline plane, GZ chart via Recharts).
- **Solver**: Client-side TypeScript only. There is **no Python, no FastAPI, no backend, no server** in this repo. All math runs in the browser.
- **Goal**: Upload STL -> auto-orient -> set weight/LCG/heel -> read draft, trim, LCB/LCG, form coefficients, and stability (KB/BM/KM/GM + GZ curve).

## Invariants & Math Conventions (FROZEN SPEC)
- **Coordinate System**: **Z-up, X = LOA (bow = +X, stern = -X), Y = beam.** This is the opposite of the "Bow = +Z, Up = +Y" convention some Fusion 360 exports use. `autoOrientToZUp()` normalizes any input into it; `src/lib/geometry.ts` and `src/lib/hydrostatics.ts` assume it everywhere.
- **Lateral sign is not fixed**: `autoOrientToZUp()` mirrors Y whenever the axis permutation is odd. Port/starboard is not stable across uploads. Do not depend on the sign of Y.
- **Trim sign**: `+ = bow UP` (marine convention). `applyPitchY(+rad)` pitches bow up; `solve_trim` returns `trimDeg` in the same convention. The viewer negates it (`trimDeg={-(trimResult?.trimDeg)}`) because Three.js rotation is the other way round.
- **Heel sign**: `+ = starboard down`. Applied as roll about X, before trim.
- **Mesh Requirements**: STL in **mm**, closed deck required. Report non-watertight meshes; do not silently modify geometry.
- **Units**: The solver works in **mm, mm², mm³** — not meters. Fresh water `rho = 1000 kg/m³`, so `MM3_PER_KG = 1_000_000` and 1 kg = 1 L. All UI output is mm and kg.
- **Defaults**: Target weight 75 kg (`App.tsx`), LCG 52% of LWL from bow, KG **hardcoded 280 mm** above keel (`hydrostatics.ts`), trim sweep ±4.5° in 0.1° steps (`App.tsx:97`). Note the solver's own fallback is ±3.5° — the app always passes 4.5° explicitly. There is no KG input in the UI.
- **Upload cap**: 25 MB, enforced in `Upload.tsx`. Parsed in memory; nothing is uploaded anywhere.

## Workflow Rules & Seams
1. **Git Control**: Do not commit blindly. Follow the user's workflow. There is no in-app event log yet — `HistoryManager` is referenced in older plans but does not exist in `src/`.
2. **References & Schemas**: Event schemas live in `references/` (e.g. `kayak_analyzer_solver.json`). Do not invent new ad-hoc JSON formats. **The schema is a target format, not a description of current output** — nothing in `src/` emits it yet. Two fields are now reachable (`lwl_mm` and `bwl_mm` are returned by the solver as `LWL` and `BWL`), but `model_hash`, `phase`, `stations_csv_path` and the `coefficients` block have no implementation, and `kg_mm` is optional in the schema only because the UI has no KG control. `waterline_polygon` was removed from `required` — the clipper discards the contour after measuring its area and second moment, so the points are not available.
3. **No External CAD Dependencies**: The core web viewer must run standalone without requiring Fusion 360 or FreeCAD to be open.
4. **Pure frontend**: Do not introduce a server, API route, or Python dependency. If a feature seems to need one, solve it in the browser first.

## Verification / Definition of Done
Before completing any task:
1. Run build/typecheck: `npm run build`. This runs `tsc -b` and must be clean — `strict`, `noUnusedLocals`, and `verbatimModuleSyntax` are all on.
2. For solver tasks: run `npm test` and confirm it exits 0. The `verify-*` suites assert against analytic ground truth; the `test-*` scripts only print, so read their numbers.
3. For geometry/orientation tasks: confirm the notes string and the sign conventions still hold — several bugs in this repo came from a sign flip, not from wrong math.
4. Ensure no unhandled runtime errors in the browser console.

## Test Resources
Scripts in `tests/` — run when modifying the corresponding module. **They fall into two groups, and the difference matters.**

`test-*.ts` are `console.log` harnesses. They print numbers and **always exit 0**, so a wrong result still reports success — you must read the output.

`verify-*.ts` are assertion suites. They compare against analytic ground truth or against the committed baseline, print `FAIL` lines, and **exit non-zero when a check fails** (all six verified by injecting a forced failure). Run them with `npm test`, which chains the six and stops at the first failure. A few end with only explicit `exit 1` branches and return 0 by normal termination on success — that is expected, not a gap.

All of them need `tests/test-kayak.stl` (2.0 MB, tracked in git). Without it they fail at import.

| Test | Group | Trigger | Validates |
|------|-------|---------|-----------|
| `verify-analytic.ts` | assert | Coefficients | Box + cylinder known answers: Cb/Cp/Cm, KB, BM, Awp at heel |
| `verify-box-identity.ts` | assert | Coefficients | Box identity — BM = I/V, KB = draft/2, section clipping |
| `verify-coefficients.ts` | assert | Coefficients | Real-hull Cb range, displacement closes on target |
| `verify-decimation.ts` | assert | Geometry | QEM output watertight, on target, volume error; analytic subdivided cube |
| `verify-heel-real.ts` | assert | Stability | Real-hull draft rises and BM falls monotonically with heel |
| `verify-trim-search.ts` | assert | Solver | Cheap trim search is bit-identical to the full solve (240 cases) |
| `test-auto-orient.ts` | print | Geometry: orientation | `autoOrientToZUp()` — arbitrary STL axes → Z-up, deck-up, bow detection |
| `test-box.ts` | print | Geometry: primitives | All geometry helpers + `solve_trim` on synthetic hull with known ground truth |
| `test-solver.ts` | print | Solver: trim | Full pipeline: 4 orientation scenarios × trim sweep |
| `test-lcb.mjs` | print | Mesh: external | Raw mesh validation on `~/Downloads/Kayak v2.stl` — hardcoded local path |
| `test-kayak.stl` | data | — | Test mesh (2.0 MB), required by all of the above |

Run: `npm test` (all six assertion suites, stops on first failure) · `npm run test:print` (the `console.log` harnesses) · or a single file with `npx tsx tests/<file>.ts` / `node tests/test-lcb.mjs`

Expected on the test hull after correct auto-orientation: bounds `2714.4 x 613.1 x 325.1 mm`, trim ≈ -1.90°, LCB–LCG offset < 1 mm. A large offset means orientation or bow detection broke.

## Keep it simple
- simple but complete is efficient
- don't complicate it
