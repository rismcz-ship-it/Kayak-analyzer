# Compare hulls - merge-readiness fixes

Branch `compare-hulls` is 21 commits ahead of `main` on a clean fast-forward path, and the
R-1..R-5 review round landed as `51bd457` on top of `366acae`, so the gate is green on the
working tree. A third deep-dive pass over the branch found eight items - three medium, five low;
none of them blocks the feature, but two are stale docs that would mislead the next session,
one is a narrow misreport, and the branch should not land with them on it.
This plan fixes M1-M3 and L1-L5 in bounded slices with disjoint files, then runs the gate once.

## Lane discipline

Confirm first: instance `opencode_custom`, model `nvidia-nim/stepfun-ai/step-5-preview`. If the
model is anything else, stop - every ceiling below assumes step-5.

- **Default params only.** No `variant`, no `reasoning_effort`, no `chat_template_kwargs`: 4/4
  attempts stalled 270-300 s with zero tokens, while the identical default-param call answered in
  23-66 s.
- **Output is the scarce resource, not context.** ~7 tok/s generation against 8 s of prefill for
  114k tokens, so this plan carries every fact with its `file:line`. Read nothing it does not name,
  re-derive nothing, and do not re-read a file to confirm a line number it already gives you.
- **One tool call per step, payload <= 25 lines.** A multi-KB single `write` dies mid-stream
  (`OpenAI Chat stream ended without finish_reason`) and T3 then retries the TURN, not the write -
  on 2026-11-19 that produced twelve identical "writing the plan now" preambles and zero output in
  four hours. Chunk any long artifact: `write` the skeleton, then `edit` in <= 30-line blocks.
- **Stall rule.** No tokens for ~5 min -> retry the same step once -> hand back what you have and
  say you stalled. A slow stream is a bad backend instance, not a broken task.

## Slices

| Slice | Owned files | Outcome | Ceiling | Depends on |
| ----- | ----------- | ------- | ------- | ---------- |
| S1 (M1) | `src/App.tsx` | The roster-refusal banner picks its wording from whether the refused write was a save or a removal, so a failed delete stops claiming the runs are about to be lost. | <= 12 lines | - |
| S2 (L1, L5) | `src/components/CompareView.tsx`, `src/components/Viewer3D.tsx` | The roster header says where the roster actually lives (persisted in this browser, not "this session"), and both viewers' `WebGLRenderer` construction is guarded so a WebGL-less machine gets one line of text instead of a blank page. | <= 25 lines | - |
| S3 (L2, L3) | `src/lib/compare.ts`, `tests/verify-run-records.ts`, `tests/verify-compare-roster.ts` | The import refuses a non-integer `planes_evaluated` by JSON path the way it refuses a non-finite one, and a record's `gzCurve` array is frozen alongside its already-frozen points. | <= 30 lines + 2 assertions | - |
| S4 (M2, M3) - mechanical | `README.md`, `AGENTS.md` | The README counts 23 suites, documents the Compare feature and the one schema the Compare export now emits, and drops the `sketches/` directory deleted in `96d6a37`; `AGENTS.md` drops the `sketches/` row and narrows its vendored-packs paragraph to `.opencode/skills/` alone - that paragraph stays, it is a live rule. | <= 25 lines | - |
| S5 (L4) - mechanical | `docs/superpowers/plans/2026-11-17-compare-batch-finish.md`, `docs/superpowers/plans/2026-11-14-compare-hulls.md`, `docs/superpowers/specs/2026-11-14-compare-hulls-design.md` | Plan docs stop citing an unreachable commit (`31cc15e`), the 2026-11-14 plan's 44 unticked boxes get an as-built note instead of a retrospective tick, and the spec's `Status: draft` becomes the truth. | <= 20 lines | S1-S4 landed |

## Execution

- **Gate:** `npm.cmd run ci` once after S1-S5, exit 0. Scoped checks per touched file while working:
  `npm.cmd run typecheck` plus `npm.cmd exec -- biome check --write` on that file.
- **Integrator:** this lane. No fan-out. S1-S4 are four disjoint slices, which is the skill's
  4-child case, but the whole diff is ~200 lines (~1 400 output tokens, ~3-4 min of generation at
  7 tok/s): parallelising buys seconds and costs an integration pass, and S5 depends on S1-S4
  anyway. No children spawn, so the Integrate model check has nothing to inspect - if a slice ever
  does spawn one, confirm `thread.model` is `nvidia-nim/stepfun-ai/step-5-preview` before reading
  its output, and say so if it is not.
- **Show and wait:** S4 edits `AGENTS.md`, which is durable state - the gate is not the only judge
  there and the global rules make it a cross-review case. So: run S1-S3, the README half of S4 and
  then S5 (which depends on landed slices, not on the AGENTS.md wording), and stop before the
  `AGENTS.md` edit - show that diff and wait for Richard's go.
- **Abort condition:** if L2's integer check or L3's freeze needs a signature change that ripples
  past `src/lib/compare.ts`, stop and report - that means the finding was mis-scoped, not that the
  plan grows. Same for any slice that overruns its ceiling: a ceiling overrun is a mis-scoped
  slice, not a bigger edit. The stall rule ends the turn, never the plan.

## Per-finding fix notes

- **M1** `src/App.tsx:138-159`: widen `deletedToEmpty = roster.length === 0 && before > 0` to a
  removal test that also covers a delete leaving records behind (`before > roster.length`); the
  "deletion did not stick" line is right for both delete branches, "in memory only" only for a save
  storage never took. Refresh the stale `"0 runs - this session"` comment while in there.
- **L1** `src/components/CompareView.tsx:517`: `{n} runs · this session` becomes `· saved in this
  browser` - the roster is restored from `localStorage` at mount (`src/App.tsx:95-97`).
- **L5** `src/App.tsx:85-89` already calls two live WebGL contexts the deliberate keep-mounted price,
  so the startup cost is not a defect and gets no code; what is real is the unguarded
  `new THREE.WebGLRenderer` at `CompareView.tsx:739` and `Viewer3D.tsx:455` - try/catch each, return
  early behind a state flag, render one line of fallback text.
- **L2** `src/lib/compare.ts:1096`, directly after the non-negative pass, reusing the helper that
  already formats the JSON path: `magnitudeProblem(results.value, ['planes_evaluated'], 'results',
  Number.isInteger, 'must be an integer')`. No new helper, no new error shape - `magnitudeProblem`
  (`compare.ts:930` region) already takes a predicate and a complaint. Assert in
  `verify-run-records.ts` that `12.5` fails naming `results.planes_evaluated` and an integer still
  imports.
- **L3** `src/lib/compare.ts:309`: freeze the curve array beside its already-frozen points -
  `Object.freeze(resultSnapshot.gzCurve)` needs no cast because the return value is discarded;
  assert `Object.isFrozen(record.gzCurve)` in `verify-compare-roster.ts`.
- **M2/M3** `README.md`: line 65 "sixteen" -> "twenty-three"; a short Compare section (two slots, a
  worker each, a roster that survives reload, the shared waterline, run-record export/import); line
  96 -> the Compare export emits `kayak_analyzer_solver.json`, the other four schemas still have no
  producer; layout block gets the full component list plus that references truth, and both
  `sketches/` lines go (`96d6a37` removed the directory; `.opencode/skills/` stays). `AGENTS.md`:
  delete only the `sketches/` row (147). At 151-153, keep the paragraph and narrow it to
  `.opencode/skills/` alone - it carries the "vendored, not application code, do not fix it" rule
  and the OpenAEC-Foundation / K-Dense attribution, neither of which is a ghost line.
- **S5/L4**: `31cc15e` -> `366acae` at the finish plan's line 162. `31cc15e` is not nonexistent: it
  is an unreachable dangling object, the pre-BOM-amend version whose subject is identical to
  `366acae`'s, so cite `366acae` and do not claim the old hash never existed. Note that `366acae`'s
  message still reads 42 checks where `51bd457` supersedes it with 49; the 2026-11-14 plan's 44
  unticked boxes stay unticked, as history, under an as-built note; the spec's `Status: draft`
  becomes implemented on `compare-hulls`, unmerged.

Landing sequence after the gate: `git checkout main && git merge --ff-only compare-hulls`, push only
on Richard's word.