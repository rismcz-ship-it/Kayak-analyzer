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
- KG input (height above the keel), so GM reflects your own paddler's height

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
positive bow-up; heel is positive when the **−Y side goes down**. Fresh water:
1 kg = 1 L = 1,000,000 mm³.

Some STLs are mirrored on load, so the sign of Y is not stable between files. Don't depend on
it — in particular, don't read "starboard" as a fixed label; the −Y-side framing is the one
that always holds.

## Scripts

| Command              | What it does                                                                     |
| -------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`        | Vite dev server                                                                  |
| `npm run build`      | Typecheck (`tsc -b`) then production build                                       |
| `npm run preview`    | Serve the production build                                                       |
| `npm run typecheck`  | Types only, no emit — covers `src`, `vite.config.ts` and `tests`                 |
| `npm test`           | The eight assertion suites — see [tests/README.md](tests/README.md)              |
| `npm run test:print` | Diagnostic scripts that only print numbers                                       |
| `npm run ci`         | The full gate: typecheck → Biome (format + lint) → `npm test` → production build |

`npm test` needs `tests/test-kayak.stl`, which is committed to the repo.

Formatting and linting are enforced by [Biome](https://biomejs.dev) (`biome.json`): single
quotes, no semicolons, space indent, 100-col lines. `npm run ci` checks that everything
conforms; `npm exec -- biome check --write .` applies fixes to touched files. Text files are
LF in the repo and worktree (`.gitattributes`), which keeps the Biome line-ending check quiet.

### On Windows

- `npm.ps1` is blocked by the machine's execution policy — invoke npm as **`npm.cmd`**
  (`npm.cmd run ci`). `npx` is blocked too: run tools through npm, e.g.
  `npm.cmd exec -- tsx tests/verify-analytic.ts`.
- PowerShell 5.1's `Get-Content` defaults to the ANSI code page, so UTF-8 punctuation comes out
  as mojibake. Read files with `Get-Content -Encoding UTF8`; the files on disk are correct.
- `npm test` runs 80 cases with only the committed mesh, and 240 when the optional local hulls
  are present. Point `KAYAK_LOCAL_HULL_DIR` at the folder holding them (default:
  `~/Downloads`). CI never has them, so CI always runs the 80-case set.

## Known limitations

- **KG defaults to 280 mm** above the keel. Weight, LCG and KG all have UI controls now, but
  the default is still an assumption — set KG to your paddler's actual height before
  trusting an absolute GM.
- A solve takes a few seconds on a 12,000-triangle mesh — the trim sweep evaluates ~800
  waterplane planes. It is correct, not fast.
- Hulls must be watertight with a closed deck. Open or partial sections cannot float and the
  solver rejects them.
- `references/*.json` describes target event formats that the solver does not yet emit.

## Layout

```
src/lib/geometry.ts      mesh utilities, orientation, decimation, section measurement
src/lib/hydrostatics.ts  the solver: clipping, coefficients, stability, trim sweep
src/lib/viewer-conventions.ts  solver -> Three.js sign translation (trim, heel)
src/components/          Upload, Viewer3D
tests/                   assertion suites + diagnostic scripts + the test mesh
references/              target schemas for saved runs (nothing emits them yet)
sketches/                standalone HTML UI mockups — design references, not the app
.opencode/skills/        vendored third-party agent skill packs — not part of the app
```

`sketches/` and `.opencode/skills/` are not built, not shipped, and not covered by Biome or
the typecheck.
