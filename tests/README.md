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

Runs all twenty-three in order and stops at the first failure.

| File                           | Validates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `verify-orientation.ts`        | The frozen conventions themselves: Z-up with X = LOA and bow at +X, trim `+` = bow up, heel `+` = the −Y side goes down, the solver → Three.js sign translation, and the published baseline numbers                                                                                                                                                                                                                                                                                                    |
| `verify-analytic.ts`           | Box and cylinder with closed-form answers: Cb/Cp/Cm, KB, BM, waterplane area at heel                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `verify-box-identity.ts`       | Box identity — BM = I/V, KB = draft/2, section clipping against the waterline                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `verify-coefficients.ts`       | Real-hull Cb in range, displacement closes on the target mass                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `verify-decimation.ts`         | QEM decimation is watertight, hits its triangle target, holds volume; plus an analytic subdivided cube                                                                                                                                                                                                                                                                                                                                                                                                 |
| `verify-gz.ts`                 | GZ curve: wall-sided closed form, the same box measured through the geometry path, sign convention, and real hull vs plotted curve                                                                                                                                                                                                                                                                                                                                                                     |
| `verify-gz-marks.ts`           | `gzMarks` - empty/single/all-zero/all-negative curves, max ties, peak-last, the scan starting after the peak, AVS as the interpolated zero crossing, the committed hull's real curve, and `endTipWetsBeforeVanishing` - the ordering the panel's "an end immerses first" warning depends on, asserted with both angles present, with a null AVS and with a null end-tip angle                                                                                                                          |
| `verify-heel-real.ts`          | Real hull: draft rises and BM falls monotonically with heel                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `verify-pose-truth.ts`         | The reported pose is a REAL equilibrium, measured without the solver: a 2 mm ray grid column-integrates the posed hull for displaced volume, centre of buoyancy X vs the reported LCG, centre of buoyancy Z vs the reported LCB Z (a height nothing else checks), and both stem-tip freeboards                                                                                                                                                                                                         |
| `verify-trim-search.ts`        | The cheap trim search returns exactly the same draft and LCB as the full solve, and the frozen mirror of the search half still matches the production `solveDraftLcb` — 80 cases per floatable hull (4 masses, 4 heel angles, 5 trim angles). Only `test-kayak.stl` is required; the local hulls are optional extras skipped when absent (e.g. on CI)                                                                                                                                                  |
| `verify-solve-extras.ts`       | Tier-1 extras against analytic box ground truth (Cwp, Iy/Ix axes, wetted area, TPC, loop count, LCF frame) plus `onAngle`'s coarse→fine ladder and `endTipImmersionDeg`'s three branches                                                                                                                                                                                                                                                                                                               |
| `verify-viewer-scene.ts`       | The `applyResultToScene` seam: solver trim/heel signs reach the scene, the `pivot ?? lcg ?? centre` chain, the mesh-vs-group frame rule for the waterline and both markers, `visible` gating, in-place leader writes, and the seam's purity                                                                                                                                                                                                                                                            |
| `verify-clipper-perf.ts`       | `clipBelowPlane` output identity against `tests/fixtures/clip-golden.json` (54 cases at heel 0/12°) plus a gross-regression wall-time trip-wire                                                                                                                                                                                                                                                                                                                                                        |
| `verify-worker-protocol.ts`    | `handleSolveRequest` purity and the coarse→fine progress ladder, `SolverClient` lifecycle (resolve/cancel/second run/dead worker) against a fake `Worker` global                                                                                                                                                                                                                                                                                                                                       |
| `verify-upload-scale.ts`       | Task 6's pure logic: `scaleAdviceFor`'s three bands, the watertight verdict as a property of the mesh rather than its units, and the mm→÷1000→×1000 round trip                                                                                                                                                                                                                                                                                                                                         |
| `verify-inputs.ts`             | The input layer extracted out of `App.tsx`: `toNumber` never turning an empty field into 0, per-field named errors, the localStorage restore's malformed/out-of-range/throwing fallbacks, the applied-heel rules, the persist payload and its round trip, the scale-notice wording, and the shared range predicates that keep the form and the restore on one gate                                                                                                                                     |
| `verify-model-hash.ts`         | `sha256Hex` — known digests, the digest taken at call time, the real STL bytes cross-checked against `node:crypto`, the non-secure-context refusal naming `SECURE_CONTEXT_ERROR` (per-call), and `rescaleMesh` carrying the hash through ×1000                                                                                                                                                                                                                                                         |
| `verify-compare-roster.ts`     | `recordFromSolve`'s storage, private copies and shared bounds gate; the encode→read round trip; hostile storage degrading to `[]`; entry validation filtering bad records with the valid siblings kept; `deepEqual`'s NaN handling; `deleteRecord`; `conditionsDiffer`; and the de-dup layer — `recordFingerprint`, `addRosterRecord` (a duplicate keeps its stored id, an id collision replaces in place, the rest goes to the front), `canonicalRecord` and the export→import fingerprint round trip |
| `verify-compare-conditions.ts` | The APPLIED-heel rule (`slotConditions`: toggle off solves at 0°, the slider kept as a leftover) plus `sameSlotInputs`, `liveAnswerIsCurrent` (the panel's "Live" gate) and `columnIsStale` (the table's stale marker, in flight AND through the debounce window) — 25 checks.                                                                                                                                                                                                                         |
| `verify-compare-display.ts`    | `avsCellText`'s four states (unsampled = em dash, no positive arm, "not within N°", the interpolated angle) and `compareOverlayCaption`, built from what the overlay DRAWS (mesh AND result), with a fifth `foreign-pose` state (an STL drawn under a record's pose, solved from a different hull — drawn, never solved) and a 25-combination invariant sweep — 42 checks.                                                                                                                             |
| `verify-run-records.ts`        | The amended `kayak_analyzer_solver.json` schema and the export answering to it field by field; the import's field mapping (carried offset/pivot, not re-derived) and its fail-loud-by-path errors; prototype-polluted documents; the round trip including the one-ulp volume drift staying put                                                                                                                                                                                                         |
| `verify-slot-solver.ts`        | Two slots resolving concurrently with one worker each and neither cancelling the other; the request carrying the slot inputs 1:1 (`kgMm` verbatim as a height) with the shared sweep constants; per-slot `cancel`; a re-solve dropping the stale run; a hostile request keeping exactly its seven keys                                                                                                                                                                                                 |
| `verify-compare-scene.ts`      | The two Compare scene seams: both midship waterlines on world Z 0, each wrapper at minus its own waterline (a wrapper signed the other way would float the deeper hull above the shallower one), the plane sized from the union, trim/heel posing leaving the plane alone, re-apply identity, dispose, purity                                                                                                                                                                                          |

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

| File             | Description                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test-kayak.stl` | Sample kayak hull, 2.0 MB, 40,212 triangles. Committed to the repo — every `verify-*` suite reads it and fails at import without it, except `verify-analytic.ts`, `verify-box-identity.ts`, `verify-viewer-scene.ts` and `verify-inputs.ts`, which need no mesh |

## Notes

- Run from the project root; the scripts import from `../src/lib/`.
- They run through `tsx`, a declared devDependency — no global install needed.
- The suites are type-checked by `npm run typecheck` (`tsconfig.test.json`), so a type error in
  a suite fails the gate. The handful of Node APIs they use are declared in
  `tests/node-shims.d.ts` — the repo has no `@types/node` dependency.
- Expected after correct auto-orientation: bounds `2714.4 × 613.1 × 325.1 mm`, trim ≈ `+3.60°`,
  LCB–LCG offset ≈ `1.68 mm`, bow freeboard ≈ `222.2 mm`, stern freeboard ≈ `22.3 mm`. The offset
  is the residual of the 0.1° fine sweep, not an error; a _large_ offset means orientation or bow
  detection broke. `+X` is the bow because the mesh says so — `autoOrientToZUp` no longer guesses
  the bow from the volume centroid (see AGENTS.md). `verify-pose-truth.ts` checks the same pose
  against a ray grid that never touches the solver's clipper.
- The local hulls live in `$KAYAK_LOCAL_HULL_DIR` (default `~/Downloads`). The two open-section
  STLs there (bow, stern) enclose no volume and cannot float; they are optional local extras:
  when present, `verify-trim-search` loads them only to prove it is not silently passing on an
  empty case set. When absent (e.g. on CI) they are skipped without failing — a mesh that is
  _present but unreadable_ still fails, in either group.
