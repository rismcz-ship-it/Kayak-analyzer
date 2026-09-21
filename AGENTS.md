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

## Keep it simple
- simple but complete is efficient
- don't complicate it