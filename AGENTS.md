# AGENTS.md — Instructions for AI Agents in kayak-analyzer

## Project Overview
Local web app for static kayak hydrostatics analysis.
- **Frontend**: Vite + TypeScript + React/Three.js (STL rendering, slice visualization).
- **Backend/Solver**: Python (FastAPI, trimesh, numpy, scipy) or client-side Three.js math.
- **Goal**: Upload STL -> calculate enclosed volume, draft at target weight, LCG/LCB, waterline polygon, ability to rerun with new trim settings.

## Invariants & Math Conventions (FROZEN SPEC)
- **Coordinate System**: Bow = +Z, Stern = -Z, Up = +Y, Starboard = +X.
- **Mesh Requirements**: STL dimensions in **mm**, closed deck required. Report non-watertight meshes; do not silently modify geometry.
- **Units**: Solvers compute in meters/kg internally; UI displays in **mm** and **kg**.
- **Defaults**: Target all-up weight: 75 kg; LCG target: 52% of LWL from bow.

## Workflow Rules & Seams
1. **Git Control**: Do not commit blindly. Follow the user's workflow or log events via `HistoryManager`.
2. **References & Schemas**: Event schemas live in `references/` (e.g. `kayak_analyzer_solver.json`). Do not invent new ad-hoc JSON formats.
3. **No External CAD Dependencies**: The core web viewer must run standalone without requiring Fusion 360 or FreeCAD to be open.

## Verification / Definition of Done
Before completing any task:
1. Run build/typecheck: `npm run build` (or TypeScript compile check).
2. For solver tasks: Verify against known test hulls (e.g. 100 mm box = 1,000,000 mm3 = 1 L).
3. Ensure no unhandled runtime errors in the browser console.

## Test Resources
Validation targets in `tests/` — run when modifying the corresponding module:

| Test | Trigger | Validates |
|------|---------|-----------|
| `test-auto-orient.ts` | Geometry: orientation | `autoOrientToZUp()` — arbitrary STL axes → Z-up, deck-up, volume-centroid bow detection |
| `test-box.ts` | Geometry: primitives | All geometry helpers + `solve_trim` on synthetic hull with known ground truth |
| `test-solver.ts` | Solver: trim | Full pipeline: 4 orientation scenarios × trim sweep — catches orientation-dependent behavior |
| `test-lcb.mjs` | Mesh: external | Raw mesh validation on `~/Downloads/Kayak v2.stl` — watertightness, volume, centroid (optional) |
| `test-kayak.stl` | — | Test mesh (2 MB) used by the above |

Run: `npx tsx tests/<file>.ts` or `node tests/test-lcb.mjs`

## Keep it simple
- simple but complete is efficient
- don't complicate it