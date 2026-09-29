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
- **Defaults**: Target weight 75 kg (`App.tsx`), LCG 52% of LWL from bow, KG **hardcoded 280 mm** above keel (`hydrostatics.ts:737`), trim sweep ±4.5° in 0.1° steps (`App.tsx:97`). There is no KG input in the UI.
- **Upload cap**: 25 MB, enforced in `Upload.tsx`. Parsed in memory; nothing is uploaded anywhere.

## Workflow Rules & Seams
1. **Git Control**: Do not commit blindly. Follow the user's workflow or log events via `HistoryManager`.
2. **References & Schemas**: Event schemas live in `references/` (e.g. `kayak_analyzer_solver.json`). Do not invent new ad-hoc JSON formats. Note the schema expects `waterline_polygon` and `lwl_mm`/`bwl_mm`, which the solver does **not** currently return — the schema is ahead of the code.
3. **No External CAD Dependencies**: The core web viewer must run standalone without requiring Fusion 360 or FreeCAD to be open.
4. **Pure frontend**: Do not introduce a server, API route, or Python dependency. If a feature seems to need one, solve it in the browser first.

## Verification / Definition of Done
Before completing any task:
1. Run build/typecheck: `npm run build`. This runs `tsc -b` and must be clean — `strict`, `noUnusedLocals`, and `verbatimModuleSyntax` are all on.
2. For solver tasks: run the relevant script in `tests/` (see below) and **read the printed numbers** against the known ground truth. These scripts print, they do not assert.
3. For geometry/orientation tasks: confirm the notes string and the sign conventions still hold — several bugs in this repo came from a sign flip, not from wrong math.
4. Ensure no unhandled runtime errors in the browser console.

## Test Resources
Scripts in `tests/` — run when modifying the corresponding module. **These are `console.log` harnesses, not an assertion suite.** They exit 0 even when the numbers are wrong, so you must read the output.

| Test | Trigger | Validates |
|------|---------|-----------|
| `test-auto-orient.ts` | Geometry: orientation | `autoOrientToZUp()` — arbitrary STL axes → Z-up, deck-up, volume-centroid bow detection |
| `test-box.ts` | Geometry: primitives | All geometry helpers + `solve_trim` on synthetic hull with known ground truth |
| `test-solver.ts` | Solver: trim | Full pipeline: 4 orientation scenarios × trim sweep — catches orientation-dependent behavior |
| `test-lcb.mjs` | Mesh: external | Raw mesh validation on `~/Downloads/Kayak v2.stl` — hardcoded local path, will fail on any other machine |
| `test-kayak.stl` | — | Test mesh (2 MB) used by the above |

Run: `npx tsx tests/<file>.ts` or `node tests/test-lcb.mjs`

Expected on the test hull after correct auto-orientation: bounds `2714.4 x 613.1 x 325.1 mm`, trim ≈ -1.80°, LCB–LCG offset < 1 mm. A large offset means orientation or bow detection broke.

## Keep it simple
- simple but complete is efficient
- don't complicate it
