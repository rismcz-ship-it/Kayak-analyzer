# Kayak-Analyzer

Interactive 3D web tool for analyzing kayak hull hydrostatics, stability, and waterlines from STL models.

Everything runs in the browser. There is no server, no backend, and no Python — the solver is
TypeScript and all math happens client-side. Nothing you upload leaves your machine.

## Quick Start

```bash
npm install
npm run dev      # Vite dev server
```

Then open the URL Vite prints, load a `.stl` hull, set the paddler weight, and press **Draft
Calculation**.

## Features

**Hydrostatics** — for the solved waterplane:
- Draft, displacement, immersed volume
- Block (Cb), prismatic (Cp) and midship (Cm) coefficients
- Waterplane area, LCB (centre of buoyancy) and the LCB–LCG offset
- KB (keel → buoyancy), BM (metacentric radius), KM (keel → metacentre), GM (metacentric height)

**Stability**
- GZ righting-arm curve, plotted against heel
- Fixed heel-angle input, so you can see how draft and BM change as the hull heels over

**Trim**
- Automatic trim solve: the solver sweeps pitch angles and picks the one that brings LCB into
  line with LCG
- Bow and stern freeboard at that trim

**Hull handling**
- STL upload (25 MB cap, parsed in memory)
- Automatic reorientation to the app's axes: Z-up, X = length, Y = beam, whatever the file used
- 3D view with the waterline plane, rotating with trim and heel
- Bow/stern detection from the volume centroid

## Coordinates and units

Internal geometry is **Z-up, X = length (bow = +X), Y = beam**, in **millimetres**. Trim is
positive bow-up, heel is positive starboard-down. Fresh water: 1 kg = 1 L = 1,000,000 mm³.

Some STLs are mirrored on load, so the sign of Y is not stable between files. Don't depend on
it.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) then production build |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | Types only, no emit |
| `npm test` | The six assertion suites — see [tests/README.md](tests/README.md) |
| `npm run test:print` | Diagnostic scripts that only print numbers |

`npm test` needs `tests/test-kayak.stl`, which is committed to the repo.

## Known limitations

- **KG is hardcoded at 280 mm** above the keel. Weight and LCG have UI controls; KG does not, so
  absolute GM assumes that value. This is the main thing to know before trusting the numbers.
- A solve takes a few seconds on a 12,000-triangle mesh — the trim sweep evaluates ~800
  waterplane planes. It is correct, not fast.
- Hulls must be watertight with a closed deck. Open or partial sections cannot float and the
  solver rejects them.
- `references/*.json` describes a target event format that the solver does not yet emit.

## Layout

```
src/lib/geometry.ts      mesh utilities, orientation, decimation, section measurement
src/lib/hydrostatics.ts  the solver: clipping, coefficients, stability, trim sweep
src/components/          Upload, Viewer3D
tests/                   assertion suites + diagnostic scripts + the test mesh
references/              target schemas for saved runs
```
