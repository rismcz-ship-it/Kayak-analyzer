# Test Files

Assertion suites and diagnostic scripts for the kayak-analyzer solver.

## Two kinds of test

|                      | `verify-*.ts`                       | `test-*.ts`              |
| -------------------- | ----------------------------------- | ------------------------ |
| What it does         | Compares against known ground truth | Prints numbers           |
| Exit code on failure | Non-zero                            | **Always 0**             |
| How to read it       | Trust the exit code                 | You must read the output |

`test-*` scripts report success even when the numbers are wrong, so they are for eyeballing, not
for gating a change. Use `verify-*` for that.

## Assertion suites — `npm test`

```bash
npm test
```

Runs all eight in order and stops at the first failure.

| File                     | Validates                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-orientation.ts`  | The frozen conventions themselves: Z-up with X = LOA and bow at +X, trim `+` = bow up, heel `+` = the −Y side goes down, the solver → Three.js sign translation, and the published baseline numbers                                                                                                                                                   |
| `verify-analytic.ts`     | Box and cylinder with closed-form answers: Cb/Cp/Cm, KB, BM, waterplane area at heel                                                                                                                                                                                                                                                                  |
| `verify-box-identity.ts` | Box identity — BM = I/V, KB = draft/2, section clipping against the waterline                                                                                                                                                                                                                                                                         |
| `verify-coefficients.ts` | Real-hull Cb in range, displacement closes on the target mass                                                                                                                                                                                                                                                                                         |
| `verify-decimation.ts`   | QEM decimation is watertight, hits its triangle target, holds volume; plus an analytic subdivided cube                                                                                                                                                                                                                                                |
| `verify-gz.ts`           | GZ curve: wall-sided closed form, the same box measured through the geometry path, sign convention, and real hull vs plotted curve                                                                                                                                                                                                                    |
| `verify-heel-real.ts`    | Real hull: draft rises and BM falls monotonically with heel                                                                                                                                                                                                                                                                                           |
| `verify-trim-search.ts`  | The cheap trim search returns exactly the same draft and LCB as the full solve, and the frozen mirror of the search half still matches the production `solveDraftLcb` — 80 cases per floatable hull (4 masses, 4 heel angles, 5 trim angles). Only `test-kayak.stl` is required; the local hulls are optional extras skipped when absent (e.g. on CI) |

## Diagnostic scripts — `npm run test:print`

```bash
npm run test:print
```

| File                  | Prints                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `test-auto-orient.ts` | `autoOrientToZUp()` — STL axes → Z-up, deck-up, bow/stern detection                                                |
| `test-box.ts`         | Geometry helpers + `solveTrim` on a synthetic hull with known ground truth                                         |
| `test-solver.ts`      | Full pipeline across four orientation cases (auto, bow-flip, manual, rotate 180°)                                  |
| `test-lcb.mjs`        | Raw mesh validation on a local hull — `$KAYAK_LOCAL_HULL_DIR`/`~/Downloads/Kayak v2.stl`; skips itself when absent |

## Running a single file

```bash
npm exec -- tsx tests/verify-analytic.ts
node tests/test-lcb.mjs
```

(`npx` is blocked by the PowerShell execution policy on this machine — use `npm exec --`.)

## Test data

| File             | Description                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test-kayak.stl` | Sample kayak hull, 2.0 MB, 40,212 triangles. Committed to the repo — `verify-*` and most `test-*` scripts read it, and they fail at import without it. |

## Notes

- Run from the project root; the scripts import from `../src/lib/`.
- They run through `tsx`, a declared devDependency — no global install needed.
- The suites are type-checked by `npm run typecheck` (`tsconfig.test.json`), so a type error in
  a suite fails the gate. The handful of Node APIs they use are declared in
  `tests/node-shims.d.ts` — the repo has no `@types/node` dependency.
- Expected after correct auto-orientation: bounds `2714.4 × 613.1 × 325.1 mm`, trim ≈ `-1.90°`,
  LCB–LCG offset ≈ `1.64 mm`. The offset is the residual of the 0.1° fine sweep, not an error;
  a _large_ offset means orientation or bow detection broke.
- The local hulls live in `$KAYAK_LOCAL_HULL_DIR` (default `~/Downloads`). The two open-section
  STLs there (bow, stern) enclose no volume and cannot float; they are optional local extras:
  when present, `verify-trim-search` loads them only to prove it is not silently passing on an
  empty case set. When absent (e.g. on CI) they are skipped without failing — a mesh that is
  _present but unreadable_ still fails, in either group.
