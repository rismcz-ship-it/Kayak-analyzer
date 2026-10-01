# Test Files

Assertion suites and diagnostic scripts for the kayak-analyzer solver.

## Two kinds of test

| | `verify-*.ts` | `test-*.ts` |
|---|---|---|
| What it does | Compares against known ground truth | Prints numbers |
| Exit code on failure | Non-zero | **Always 0** |
| How to read it | Trust the exit code | You must read the output |

`test-*` scripts report success even when the numbers are wrong, so they are for eyeballing, not
for gating a change. Use `verify-*` for that.

## Assertion suites — `npm test`

```bash
npm test
```

Runs all six in order and stops at the first failure.

| File | Validates |
|------|-----------|
| `verify-analytic.ts` | Box and cylinder with closed-form answers: Cb/Cp/Cm, KB, BM, waterplane area at heel |
| `verify-box-identity.ts` | Box identity — BM = I/V, KB = draft/2, section clipping against the waterline |
| `verify-coefficients.ts` | Real-hull Cb in range, displacement closes on the target mass |
| `verify-decimation.ts` | QEM decimation is watertight, hits its triangle target, holds volume; plus an analytic subdivided cube |
| `verify-heel-real.ts` | Real hull: draft rises and BM falls monotonically with heel |
| `verify-trim-search.ts` | The cheap trim search returns exactly the same draft and LCB as the full solve — 240 cases over 3 hulls, 4 masses, 4 heel angles, 5 trim angles |

## Diagnostic scripts — `npm run test:print`

```bash
npm run test:print
```

| File | Prints |
|------|--------|
| `test-auto-orient.ts` | `autoOrientToZUp()` — STL axes → Z-up, deck-up, bow/stern detection |
| `test-box.ts` | Geometry helpers + `solve_trim` on a synthetic hull with known ground truth |
| `test-solver.ts` | Full pipeline across four orientation cases (auto, bow-flip, manual, rotate 180°) |
| `test-lcb.mjs` | Raw mesh validation on `~/Downloads/Kayak v2.stl` — hardcoded local path, so it only works on this machine |

## Running a single file

```bash
npx tsx tests/verify-analytic.ts
node tests/test-lcb.mjs
```

## Test data

| File | Description |
|------|-------------|
| `test-kayak.stl` | Sample kayak hull, 2.0 MB, 40,212 triangles. Committed to the repo — `verify-*` and most `test-*` scripts read it, and they fail at import without it. |

## Notes

- Run from the project root; the scripts import from `../src/lib/`.
- They run through `tsx`, a declared devDependency — no global install needed.
- Expected after correct auto-orientation: bounds `2714.4 × 613.1 × 325.1 mm`, trim ≈ `-1.90°`,
  LCB–LCG offset under 1 mm. A large offset means orientation or bow detection broke.
- The two open-section STLs in `~/Downloads` (bow, stern) enclose no volume and cannot float;
  `verify-trim-search` loads them only to prove it is not silently passing on an empty case set.
