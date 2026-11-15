# Compare Hulls — Written Design

Date: 2026-11-14
Status: draft, pending builder check and Richard's approval

## Intent

kayak-analyzer solves one hull at a time and forgets it the moment another STL
loads. The real workflow is *design comparison*: two hulls, numbers side by
side, shapes overlaid in one 3D view. This feature adds a **Compare mode**:
two independent slots, each holding a hull with its own conditions, solved
live, compared in one table and one overlaid scene.

The solver is fast (seconds). The value is not saving calculations — it is the
app holding both hulls' results at once, with each slot re-solving when its
conditions change.

## Goals

1. **Two slots, A and B.** Each slot = a hull (mesh) + its own inputs (weight,
   LCG, KG, heel). Full independence: A at 75 kg while B runs at 85 kg is a
   legitimate, deliberate comparison, not an error to flag away.
2. **Live re-solve.** Editing a slot's inputs re-solves that slot only, and
   updates that slot's column and its hull in the overlay. No frozen
   snapshots, no re-pinning.
3. **Comparison panel.** Every metric is a row; the two slots' values sit side
   by side in the row. On top of each column: a hull picker, choosing from the
   roster of analyzed hulls. **Picking adopts the record's inputs and shows
   its stored numbers immediately**; solving starts when an input is edited
   (or the mesh arrives). This is how the flagship case — the same hull in
   both slots at different weights — is reached: pick the same record in both
   slots, change one slot's weight.
4. **Overlaid 3D.** Both hulls in one scene, semi-transparent so each is
   visible through the other, distinct colors. One **shared water surface**:
   both waterlines coincide at a single level, each hull offset vertically by
   its own draft, so a deeper-riding hull visibly sits lower — how a naval
   architect reads an overlay. Same view, not side-by-side — shape and size
   differences read better overlaid.
5. **Export / import.** A slot's record exports as JSON (portable by email);
   importing adds it to the roster.
6. **Reload behaviour.** The roster's numbers survive (localStorage). Meshes
   do not; a slot's mesh must be re-picked before that slot can re-solve or
   appear in the overlay.

## Non-goals

- No server, no login, no cloud. Pure frontend, unchanged.
- The existing single-hull flow stays untouched; Compare is an additional
  mode (a tab), not a replacement of the home view.
- No resistance prediction, no seakeeping (unchanged stance).
- No mesh storage in browser storage in v1 — IndexedDB mesh persistence is a
  possible step-two, not part of this build.
- No repair of non-watertight meshes (unchanged stance; open meshes are
  reported and rejected exactly as today).

## Constraints (from AGENTS.md, binding)

- Pure frontend; **no new runtime dependencies**.
- Units stay mm / mm³ / kg. Fresh water only (v1).
- Coordinate conventions frozen: Z-up, bow = +X; trim `+` = bow up (viewer
  negates via `viewer-conventions.ts`); heel `+` = −Y side down; KG is a
  height above the keel.
- Solving runs in the worker; request positions are immutable; progress
  indices contiguous (worker protocol is asserted by `verify-worker-protocol`
  and must not regress).
- Gate: `npm.cmd run ci` green (typecheck, Biome, tests, build). Biome
  formatting via `npm.cmd exec -- biome check --write` on touched files.
- Rule 2: a producer ships with its schema check. Per-slot records follow
  `references/kayak_analyzer_solver.json`, which requires `model_hash` —
  currently missing in `src/`; this build adds it (SHA-256 of the STL bytes
  via `crypto.subtle`, native). **This build also amends that schema**: the
  strict schema cannot hold heel (absent from `targets`), freeboards, GZ
  peak/AVS, Cwp/LCF/TPC, waterline Z or the STL file name this feature must
  round-trip — so the schema gains a `heel_deg` target, the missing result
  and coefficient fields, an optional `gz_curve`, and an optional `file_name`,
  together with its schema check. A conforming-strict export would silently
  lose the numbers this feature exists to compare.
- `references/kayak_analyzer_comparison.json` (a whole comparison export) is a
  possible step-two; v1 exports per-slot records only.

## Parts

1. **Roster** (`src/lib/compare.ts`): a record = `{ id, name, modelHash,
   inputs, result, savedAt }`. **Records are immutable snapshots**: adding and
   deleting are the only roster operations — a slot re-solve never rewrites
   the record it picked from (a second slot may be showing it). A slot holds
   its own live state (mesh reference, editable inputs, live solve result)
   separately; export captures what the slot displays, never a stale record.
   A successful single-hull analysis automatically adds itself to the roster.
   Persistence keeps the **full metric set the comparison table renders,
   including the `gzCurve` array** (a few KB) — a restored record feeds the
   table and delta column completely, no blank rows. Meshes live in an
   in-memory cache keyed by `modelHash` and die with the session.
2. **Model hash**: SHA-256 over the STL bytes, computed once at upload and
   reused as record identity (`model_hash` in the exported record).
3. **Compare UI**: a Compare tab. Two slot panels side by side — each with the
   picker (roster), its compact inputs (weight, LCG, KG, heel), and live
   solve status. Below/beside: the metric table, rows = the same metrics the
   results panel shows today (draft, trim, LWL, BWL, LCB/LCG, Cb/Cp/Cm/Cwp,
   KB/BM/KM/GM, freeboards, GZ peak/AVS), columns A | B (+ delta column where
   a delta is meaningful — my call), plus a note when the two slots run at
   different conditions (visible, but no longer an error).
4. **Overlay viewer**: the existing scene extended to two slot groups.
   Transparent materials (A blue, B orange, ~0.4 opacity), each hull posed by
   the existing seam logic (the `applyResultToScene`-style pose math, applied
   per slot), each with its own waterline plane while floating.
5. **Export / import**: per-record JSON download (Blob + object URL, native);
   import reads a JSON file, validates its shape before trusting it, and adds
   it to the roster. An imported record has no mesh — it shows its numbers and
   asks for its STL (by the stored file name) to solve or overlay.
   **Re-picking a mesh reuses the whole Upload pipeline** (orientation,
   centring, scale advice + explicit ×1000 Apply), never a thinner
   parse-and-go path — a metres STL must not re-enter the solver as
   millimetres. The re-picked file's SHA-256 (of the raw bytes) is checked
   against the record's `modelHash`; a mismatch warns and requires explicit
   confirmation rather than silently posing the wrong hull.
6. **Solve sessions**: one `SolverClient` per slot (two workers), or one
   shared worker with per-slot serialization — builder's call; the worker
   protocol itself is unchanged either way.
7. **Tests**: a new assertion suite per house style (roster round-trip,
   record shape vs the schema's fields, the hash, delta computation, import
   validation, overlay seam purity) wired into `npm test`; full
   `npm.cmd run ci` green at the end.

## What's left to the builder

- Exact UI placement and component breakdown in `src/components/`; how live
  re-solve is triggered (per-change with debounce vs explicit Calculate per
  slot); one vs two worker instances; how the two slot groups and waterline
  planes are keyed and posed in the scene; error and edge UX (open mesh,
  failed solve, missing mesh after reload, roster overflow); test naming and
  structure per house style.

## Calls already made (veto while reading)

- Compare lives in a separate tab; the home view is untouched.
- After reload: numbers survive, mesh re-pick per slot (no IndexedDB in v1).
- Delta column included where a delta is meaningful.
- Overlay colors blue/orange, opacity ≈ 0.4 (adjustable later).
- Export = per-record, `solver.json`-shaped; a whole-comparison export is
  step-two.
- The roster grows automatically on each analysis; deleting entries is a
  manual roster action, not automatic.
- **Shared water surface** in the overlay (both waterlines coincide; each
  hull offset by its own draft) — Richard's call, 2026-11-14.
- The reference schema is amended in this build (heel, freeboards, GZ
  peak/AVS, Cwp/LCF/TPC, waterline Z, file name) rather than conformed to
  strictly — builder-check finding 1, settled 2026-11-14.
- Roster records are immutable snapshots; slots hold live state; export
  captures the slot's displayed state — builder-check finding 3.
- Picking adopts the record's inputs and its stored snapshot; solving starts
  on edit — builder-check finding 4.
- Persistence keeps the full rendered metric set including the `gzCurve` —
  builder-check finding 5.
- Re-pick reuses the whole Upload pipeline and hash-checks with
  warn-and-confirm — builder-check finding 6.
