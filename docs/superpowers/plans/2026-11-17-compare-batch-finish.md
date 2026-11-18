# Compare Batch Finish — Verify, Review, Commit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the uncommitted Compare work on branch `compare-hulls` from "green but unreviewed" to a commit Richard has cleared: correct the two stale test-doc tables, read through the seams the suites cannot reach in a real browser, cross-review the whole uncommitted diff with a strong lane, settle the one open UX decision, and commit. Nothing is pushed.

**Architecture:** No new code is expected. The batch is feature-complete and `npm.cmd run ci` exits 0 on the working tree; this plan verifies, reviews and lands what is already there. Any code it produces is a fix for a defect found in Task 2 or Task 3.

**Tech Stack:** React 19 + TypeScript + Vite, Three.js, Node assertion suites run through `tsx`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-compare-hulls-design.md` (executors read both; the plan argues from the spec — it is the Compare feature's written design).

⚠️ **The eight acceptance criteria are NOT in that spec.** They come from the honesty batch Richard commissioned after the build-out and are recorded in the dated entries for 2026-11-17 in `C:\richard-dev\projects\manager\STATE.md`. Quote them to the reviewer from this plan, not from the spec — the spec predates them and says nothing about applied heel, the Live gate, the stale marker or the caption.

## Current state (distilled — do not re-read the tree to re-ground)

- Branch `compare-hulls`, HEAD `96d6a37`. **Every change below is uncommitted; nothing has been pushed.** Richard holds the commit decision (Task 5 opens with a stop-and-wait).
- The batch is green: `npm.cmd run ci` exit 0 on this tree (typecheck over 3 programs, `biome check`, 23 assertion suites, build). Measured cadence: `npm.cmd run typecheck` ≈ 2 s against ≈ 468 s for the full gate — run the gate **once, at the end**.
- Uncommitted tree: `AGENTS.md` (suite count 21 → 23 + two table rows), `package.json` (the two new suites appended to the `npm test` chain), `src/App.tsx`, `src/components/{CompareTable,CompareView,SlotPanel,Upload}.tsx`, `src/lib/compare.ts`, `src/lib/gz-marks.ts`, `tests/verify-compare-roster.ts`, `tests/verify-gz-marks.ts`, plus untracked `tests/verify-compare-conditions.ts` (25 checks) and `tests/verify-compare-display.ts` (42 checks after Task 3's F-1/F-4 fixes: it was 32).
- This plan lands as `docs/superpowers/plans/2026-11-17-compare-batch-finish.md` — one extra untracked file that Task 5 must expect and stage alongside the rest.
- What the batch does (all landed): heel is an APPLIED angle (toggle off ⇒ the slot solves at 0°, the slider kept as a leftover and *now stated on screen*); the "Live — solved at the conditions above" note is gated on the live answer's own recorded conditions; the table's "(re-solving)" marker covers both a solve in flight and the debounce window; the AVS cell distinguishes an unsampled curve from a sampled one with no positive arm; the overlay caption states what the overlay DRAWS (mesh AND result), not what merely exists; the roster de-duplicates by run content (12 significant digits) and the stored entry keeps its id; a refused `localStorage` write is an amber banner above both tabs carrying the cause; per-slot "Clear model"; `Upload` reports its state to a hidden parent.
- The F1–F8 review fix batch that produced most of the above is itself **not yet cross-reviewed**. That is Task 3.
- One open decision: whether "Clear model" should be rose-tinted on hover or carry a confirm step (Task 4).

## Global Constraints

- **No commits until Task 5**, which begins with a stop-and-wait for Richard's explicit go-ahead. This deliberately overrides the writing-plans default of per-task commits — the whole batch is one uncommitted tree and Richard reviews it as one.
- Never push. Never touch `main` (`main` = `b36d1b4`).
- Gate for any task that changes code: `npm.cmd run ci` exit 0. Scoped cadence: `npm.cmd run typecheck` + `npm.cmd exec -- biome check --write <touched files>`.
- npm is invoked as `npm.cmd` / `npm.cmd exec --` (PowerShell blocks `npm.ps1` and `npx`). Biome writes its summary to **stderr**, so a red `NativeCommandError` under `2>&1` can still be a pass — **check the exit code**.
- No new runtime dependencies. No `@types/node`.
- Markdown **IS** covered by Biome (2.6): `biome.json`'s `files.includes` lists `AGENTS.md` / `README.md` explicitly and `tests/**` sweeps in `tests/README.md`, and the formatter aligns Markdown table columns. The first full gate run of this plan failed on exactly this (2 format errors in the two edited tables) — **run `npm.cmd exec -- biome check --write <touched files>` on edited `.md` files, not a re-read.** (This line previously claimed the opposite; the gate corrected it, 2026-11-17.)
- TS style: single quotes, no semicolons, 2-space indent, 100-col lines.
- Frozen conventions (do not restate, do not relax): Z-up / X = LOA / bow at +X; trim `+` = bow up; heel `+` = the −Y side down; **KG is a HEIGHT above the keel**; mm/mm²/mm³ and kg/L; the trim sweep is coarse 5× then fine ±0.5°; `waterlineZ` / `draftMm` / freeboards are hull-frame; 25 MB upload cap. They live in the repo's `AGENTS.md`, which governs.
- Paths: relative inside the repo. If an absolute path is unavoidable, `C:\richard-dev\projects\kayak-analyzer`.
- Durable state: update `C:\richard-dev\projects\manager\STATE.md` at the end of the session, unasked (rule 6) — that is Task 5's last step.

## Review Focus

Five failure modes most likely to bite a user of this feature, each pinned to a check in the owning task:

1. **The caption claims a hull that is not drawn.** It is derived from `mesh && result`; any later refactor that derives "solved" from the `result` alone re-creates F1 — "Both hulls sit on one shared waterline" over an empty canvas after a reload or a bare import. Pinned by the 25-combination invariant sweep in `tests/verify-compare-display.ts` (Task 1 step 2's row — 16 pairs before Task 3's F-1 fix added the fifth `foreign-pose` state) and by Task 2 steps 5–6.
2. **A slot pointing at a record id the roster does not hold.** `App.addRecord` returns the canonical entry and the import uses that return; reverting it to `void`, or resolving against the render-time `roster` prop, restores F3 (an imported run that shows nothing). No suite covers it — Task 3's reviewer must read that path.
3. **A numeric edit re-applying a leftover heel** (the historical bug this batch exists to kill): all three emit paths in `SlotPanel` must keep routing through `slotConditions`. Pinned by `tests/verify-compare-conditions.ts` and re-checked live in Task 2 step 8.
4. **A silently swallowed file error in the hidden picker.** `Upload`'s `onStatus` must stay wired into `SlotPanel`'s hidden mount. Pinned by Task 2 steps 2–3.
5. **A refused `localStorage` write going unreported.** The banner sits above both tabs (Analyse is where the roster is written) and carries the cause. Pinned by Task 2 step 7.

---

### Task 1: Doc alignment

**Files:**

- Modify: `tests/README.md` (suite count line + two table rows)
- Read-only: `AGENTS.md` (already corrected in this session — verify, do not re-edit)

**Interfaces:** none.

- [x] **Step 1: Fix the count.** `tests/README.md:22` reads "Runs all twenty-one in order and stops at the first failure." Change "twenty-one" to "twenty-three".
- [x] **Step 2: Add the two missing rows** to the assertion-suite table in `tests/README.md`, immediately after the `verify-compare-roster.ts` row (currently line 43), matching the existing 2-column style:
  - `verify-compare-conditions.ts` — the APPLIED-heel rule (`slotConditions`: toggle off solves at 0°, the slider kept as a leftover) plus `sameSlotInputs`, `liveAnswerIsCurrent` (the panel's "Live" gate) and `columnIsStale` (the table's stale marker, in flight AND through the debounce window) — 25 checks.
  - `verify-compare-display.ts` — `avsCellText`'s four states (unsampled = em dash, no positive arm, "not within N°", the interpolated angle) and `compareOverlayCaption`, built from what the overlay DRAWS (mesh AND result), with a 16-combination invariant sweep — 32 checks.
- [x] **Step 3: Verify the repo matrix.** `AGENTS.md` already reads 23 suites in both places (the cadence paragraph and the "Run:" line) and carries rows for both new suites. If any of that is wrong, fix it; if it is right, change nothing in `AGENTS.md`.
- [x] **Step 4: Verify.** `npm.cmd run typecheck` exit 0 (markdown-only changes cannot break the build, but this proves the tree is still clean), then re-read both edited files and confirm the tables still line up as tables.

### Task 2: Browser read-through of the seams no suite covers

Both Compare suites disclaim the React wiring; these ten interactions are that coverage. Expected result: **findings**, and only fix what is actually broken.

**Files:**

- Read-only: `src/components/SlotPanel.tsx`, `src/components/Upload.tsx`, `src/App.tsx`, `src/components/CompareView.tsx`
- Modify if broken: whichever file the read-through implicates, plus the owning suite if the broken part is pure logic

**Interfaces:** none.

- [x] **Step 1: Start the dev server** — `npm.cmd run dev` in the background. If it reports "Port 5174 is already in use", take another port (`-- --port 5175 --strictPort`) rather than killing the running server. (Ran on 5173, background shell.)
- [x] **Step 2: "Replace STL" with a non-STL file** (e.g. a renamed `.txt`) → the error "<name> is not an .stl file" must be visible **next to the slot**. This is F2; it was invisible before the fix batch.
- [x] **Step 3: "Replace STL" with a corrupt `.stl`** (any text file renamed to `.stl`) → "Could not parse …" must be visible next to the slot.
- [x] **Step 4: "Replace STL" with a valid STL** → "Parsing the picked file…" appears during the parse and clears on success; the slot re-solves and the overlay redraws the new hull.
- [x] **Step 5: Import a `.run.json` whose run is NOT in the roster** → picked into the first empty slot, numbers appear in the table, the overlay draws nothing for that slot, and the caption reads "Slot A's numbers are shown, but its STL is not loaded." (F1's lying case.)
- [x] **Step 6: Import the SAME file into BOTH slots** → the roster gains exactly one entry (de-dup keeps the stored entry), both columns show the run, and the caption must NOT read "Both hulls sit on one shared waterline" (nothing is drawn).
- [x] **Step 7: Force a storage refusal** — in the browser console run `Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }`, then solve on the Analyze tab. An amber banner must appear **above both tabs** and its text must carry "QuotaExceededError". Remove the override afterwards.
- [x] **Step 8: The leftover heel** — toggle heel on, move the slider to 12°, toggle off: the note "Heel 12° is kept as a leftover — this slot solves upright until the toggle is switched on." appears and the slot still solves heel 0. Toggle back on: 12° is re-applied. Then, with the toggle OFF, edit the weight: the slot must re-solve UPRIGHT, never at the leftover angle.
- [x] **Step 9: "Clear model"** — the STL leaves the slot, the record and the typed conditions stay, the overlay drops that hull and the caption changes to match.
- [x] **Step 10: Record the findings.** Write each defect (file, what the user sees, what should have happened) as a numbered list in this task. If nothing is broken, write "no defects" and stop. If something is broken: fix it minimally, run the scoped checks, add a regression assertion to the suite that owns the pure part, and run the full gate **once** at the end of the task.

  **Findings (2026-11-18): no defects. All ten interactions passed.** Run against the dev server on `http://localhost:5173/`, Compare tab, fixtures in `C:\Temp\kayak-fixtures` (`notes.txt`, `corrupt.stl`, `test-kayak.stl`, and `test-kayak.run.json` exported from slot A's own Export). Evidence, numbered:

  1. Non-STL (`notes.txt`) into a slot picker: `notes.txt is not an .stl file` visible beside the slot in BOTH panel states - the empty slot ("Drop an STL hull here") and the hidden picker behind "Replace STL" with a hull in memory. The failed pick leaves the loaded hull in place. Exactly one copy reaches the user: `Upload`'s own span is inside a `display:none` wrapper and `SlotPanel` renders `pickStatus.error` visibly.
  2. Corrupt `.stl` (`corrupt.stl`, 30 bytes of text): `Could not parse corrupt.stl: Offset is outside the bounds of the DataView` visible in both states; the hull in memory survives the failed re-pick.
  3. Valid STL: `Parsing the picked file…` observed during the parse (slot A, re-pick behind "Replace STL"), then cleared; the slot re-solves, badge `A · test-kayak.stl`, `Live — solved at the conditions above.`, the table fills (Draft 127.9 mm / Trim 3.6° / Displacement 75 kg / LWL 2 211.8 mm) and the overlay canvas redraws.
  4. Import of a run not in the roster (roster empty, mesh cache empty): first empty slot A, `Showing the saved run — edit a condition to re-solve.`, the fields adopt the record's 75 / 52 / 280, the table shows the run, nothing is drawn, and the caption is exactly `Slot A's numbers are shown, but its STL is not loaded. Load an STL into Slot B to compare it.`
  5. Same file imported a second time: it lands in slot B, the roster keeps exactly ONE entry (de-dup keeps the stored id), both columns show the run with every Δ at 0, and the caption reads `Slot A's numbers are shown, but its STL is not loaded. Slot B's numbers are shown, but its STL is not loaded.` - never "Both hulls sit on one shared waterline".
  6. Storage refusal: with `Storage.prototype.setItem` throwing `QuotaExceededError`, a home solve raises exactly one amber banner with `role="status"`, the first child of `<main>` and above both tab wrappers, carrying `This browser refused to save the run roster — the runs are in memory only and will be lost on reload. (QuotaExceededError)`. The solve itself still completes and the results panel shows. The override was removed afterwards and storage verified writable again.
  7. Leftover heel: toggle on, slider to 12° - slot B solves at 12° (Draft 127.9 → 128.1 mm against upright slot A). Toggle off - the note appears verbatim, the slider hides and the slot re-solves upright (back to 127.9 mm). Toggle on again - the slider is restored at 12°, not 0, and the 12° solve returns (128.1 mm).
  8. Weight edit with the toggle OFF: 75 → 80 kg re-solves UPRIGHT (132.8 mm) with the leftover note still on screen and `Live — solved at the conditions above.`; toggling back on then solves 80 kg at 12° (133.3 mm), a different number - which is what proves the earlier solve was genuinely upright and not at the leftover angle.
  9. "Clear model" (slot B): the STL and its live answer leave ("STL in memory" and "Live" gone), the record and the typed conditions stay (80 / 52 / 280, heel toggle on at 12°), the table falls back to the record's frozen numbers, the overlay drops that hull and the caption changes to the record-only wording.
  10. Follow-through check beyond the ten: a condition typed on a record-only slot is not a dead end. With the STL out of memory, typing 90 kg changes only the fields (the table still shows the record's frozen numbers, which `Showing the saved run` states). Re-picking the STL then solved at the typed conditions - weight 90, heel toggle on at 12°, Draft 143.5 mm, `Live — solved at the conditions above.`, and the GZ peak row dropping from 23.8 mm to 16.1 mm, which is the 90 kg answer rather than the record's 75 kg one.

  No file was modified, so the step's gate clause (conditional on a fix) does not apply: the scoped checks and the full `npm.cmd run ci` are not due from Task 2. This task added no working-tree change beyond this plan's own checkbox ticks; Task 1's markdown edits were already typechecked.

### Task 3: Strong-lane cross-review of the whole uncommitted diff

This is the review gate Richard's own plan mandates after every task, applied to the batch that never got it.

**Files:** none produced.

**Interfaces consumed:** the `review-delegation` skill's six-part brief (its last part is a *Context* bullet carrying distilled state inline — never "read the plan").

- [x] **Step 1: Load `review-delegation`** and build the brief. Scope: `git diff` plus the two untracked suites; run `git status --short` first so the brief names exactly the files. The brief must state the eight acceptance criteria — applied heel, the Live gate, the stale marker, the AVS cell's four states, the caption's honesty, content de-dup, the storage warning, clear-model + the imperative picker — so the reviewer judges behaviour, not style.
- [x] **Step 2: Hand the reviewer the Review Focus list above** (the five failure modes) and require an explicit verdict on each of the eight criteria.
- [x] **Step 3: Dispatch one reviewer on a strong lane** (MiniMax M3.1-Flash (thinking) if available, else the skill's fallback chain). **Default interaction mode — never `plan` mode**, which inverts the intent on the ACP lane and closes the turn on an approval question instead of findings.

  Dispatched 2026-11-18: one reviewer, `role: "review"`, `isolation: "shared"` (the whole batch is uncommitted, so a worktree would have shown it an empty checkout), `mode: "async"`, `interactionMode: "default"`, no `runtimeMode`, target `acpRegistry_local_acp` / `m:minimax:MiniMax-M3.1-Flash:v:thinking` with `thinkingEffort: "medium"`. The six-part brief carries: the distilled context inlined; the eight acceptance criteria as the intent; the frozen conventions quoted as constraints; the work as exact relative paths (`git diff`, the two untracked suites, `git show 6d80776 -- src`) rather than an 835-line paste; the Review Focus five as F-A … F-E each to be adjudicated explicitly; and delivery = findings inline as the final assistant message, read-only commands only, ending in a `VERDICT:` line. Thread: [Cross-review: Compare hulls uncommitted diff](t3-thread://v2/7d98b016-85df-42d9-bbd9-da603d3f0e2b/thread:delegated-task:command%3Amcp%3A11360ec5-1f26-4eb8-8358-abe0f51d663b%3Adelegate-task%3A7f1cf2a2-f724-4efd-b305-d4e8296d44b0).
- [x] **Step 4: Adjudicate every finding** — fix what is real, record why the rest is not, and run the gate (`npm.cmd run ci`, once) after the fixes land.
- [x] **Step 5: If a finding lands in pure logic**, add its assertion to the suite that owns the module (`compare.ts` → `verify-compare-conditions.ts` / `verify-compare-display.ts` / `verify-compare-roster.ts`) so it cannot come back silently.

  **Reviewer's verdict: `FIX - F-1, F-2, F-3, F-4, F-5, F-6`.** All eight acceptance criteria PASS (three with the residuals F-1, F-2/F-3), and all five Review Focus modes PASS. Six findings, adjudicated:

  **F-1 (MEDIUM) — FIXED.** REAL. A slot holding record R plus a *different* STL (re-pick → "Use anyway") draws the new hull posed with R's solved numbers, while the caption counted `mesh && result` as a solved hull: "Both hulls sit on one shared waterline — the deeper hull floats lower", whose deeper/lower order came from R's draft, not from the two hulls on screen — and SlotPanel's own note said the opposite about the same slot (`SlotPanel.tsx:499-504`: "the numbers above are that record's, posed on the file below"). Fix: a fifth overlay state `foreign-pose` in `compare.ts` (an STL drawn, but the pose on it is a record's, solved from a different hull), computed in `CompareView` from exactly the facts `foreignGeometry` uses (`mesh && live === null && record && mesh.sha256Hex !== '' && mesh.sha256Hex !== record.modelHash`). The two-hull line is now reserved for two `shown` slots, and the sweep's invariant counts a foreign-pose slot as drawn but NOT solved. Assertions in `tests/verify-compare-display.ts`.

  **F-2 (LOW) — NOT A DEFECT, adjudicated: no code change.** `columnIsStale` returning false when `liveInputs === null` also covers two cases the reviewer merged: a *failed* solve and a cleared mesh. In both, what is displayed is the record's frozen snapshot paired with the conditions that pair was produced at — `resultA = slot.live ?? recordA?.result`, and `shownConditions` for the pair is the record's own — so the displayed pair is NOT out of date and a stale marker would be a lie. Passing the typed fields in instead would mark "(re-solving)" where no solve is running or is scheduled (after "Clear model" no mesh is in memory at all), trading a disclosed omission for a false claim. The omission is disclosed by the panel's "Showing the saved run — edit a condition to re-solve." line (`SlotPanel.tsx:486-493`), and Task 2's evidence #10 shows the promise comes true when the STL returns: typing 90 kg on the record-only slot then re-picking solved at 90 kg / 12°, not the record's 75 kg / 12°.

  **F-3 (LOW) — FIXED.** REAL. `App.tsx:130-139`'s effect writes the roster on mount, so a browser whose `localStorage.setItem` throws showed the amber banner at startup with **zero** runs ("0 runs · this session") and nothing to lose. Fix: the write still runs (an emptied roster must clear the stored one), but a refusal over an empty roster sets no banner.

  **F-4 (LOW) — FIXED, wording only.** REAL. `Slot X is loaded but not solved yet.` predicted a solve that never lands after a FAILURE, and the overlay draws nothing for that slot — the caption described the slot's state, not the picture. New wording: `Slot X's STL is loaded but not drawn yet.` — a statement about the drawing rule that is true both before a first solve and after a failed one. No new state; the panel owns the error text.

  **F-5 (NIT) — COMMENT ADDED, branch kept.** Not dead for the module's purposes: `readRoster` does not check id uniqueness, so a collision can only arrive from a hand-edited/stored roster, and the branch is the defensive answer to it. The doc comment now says so, so a future reader does not "clean it up".

  **F-6 (NIT) — FIXED.** REAL doc drift: `AGENTS.md:106`'s `verify-compare-roster.ts` row (and `tests/README.md`'s) describe only the original `recordFromSolve` surface and omit the de-dup surface the batch added and that suite now pins — `recordFingerprint`, `addRosterRecord`, `canonicalRecord` and the export→import fingerprint round trip. Both rows extended; the check counts in both tables re-derived from the edited suites.

  Gate after the fixes: `npm.cmd run ci` once at the end of Task 3 — **RUN AND GREEN, 2026-11-17, exit 0** (typecheck over 3 programs, `biome check` 68 files, all 23 assertion suites with the local hulls present — 240 cases, build 9.63 s). The first run failed with 2 format errors in `AGENTS.md` / `tests/README.md`: Biome 2.6 formats Markdown tables and `tests/**` is in `biome.json`'s includes, so the hand-aligned tables were re-formatted and the plan's line "Markdown is NOT covered by Biome" was wrong. Fix = `biome check --write` on the two files; content unchanged, columns realigned.

### Task 4: The one open UX decision — "Clear model"

**Files:**

- Modify only if Richard picks a change: `src/components/SlotPanel.tsx`

**Interfaces:** none.

- [x] **Step 1: Ask Richard** whether "Clear model" should be rose-tinted on hover or carry a confirm step. Ask with the default's argument attached: the button only unloads the STL — the record and the typed conditions stay — so nothing is lost and nothing needs undoing. Asked twice; no change was ever requested, so Step 2a applies.
- [x] **Step 2a (default, absent an answer): no change.** Record the decision and its reasoning in `C:\richard-dev\projects\manager\STATE.md`. Decision (2026-11-18): **keep as-is.** `SlotPanel.tsx:523-537` — the button's `title` already states exactly what survives ("Unload this slot's STL — the record and the typed conditions stay"), and Task 2's evidence #9 and #10 confirm it: after a clear, the record and the typed conditions remain and a later re-pick solves at the typed conditions, not the record's. A rose tint or a confirm step would spend interaction cost guarding a loss that cannot happen, and the dismissal cost lands on the common case (unloading to re-pick a differently named STL). Revisitable: if a user ever reports data loss here, the record is the first thing to check.
- [ ] **Step 2b (if he asks for a change):** implement the smallest version of his choice, then the scoped checks, then run the full gate once before Task 5.

### Task 5: Commit — stop-and-wait for Richard

**Stop and wait here for Richard's explicit go-ahead before the first `git add`.** He may also want the message changed, or the work split into two commits (build-out, then fixes).

**Files:**

- Modify: `C:\richard-dev\projects\manager\STATE.md` (the session-log entry — the last thing done)

**Interfaces:** none.

- [x] **Step 1: Refresh the state.** `git status --short` and `git diff --stat` must match the distilled list at the top of this plan. If they do not, stop and explain the difference before committing. Matched exactly — 12 modified + 3 untracked, no surprises.
- [x] **Step 2: Show Richard the diff summary and the proposed message.** The message must carry the review dispositions — which findings were fixed, which were adjudicated as non-issues — per the rule that findings get an explicit disposition. Suggested shape:
  - Subject: `feat(compare): honest slot conditions, roster de-dup, an overlay caption that matches the picture`
  - Body: the eight criteria one line each; the F1–F8 dispositions; the two new suites; "Gate: `npm.cmd run ci` exit 0". Delivered with the commit itself (its message carries all six F-1…F-6 dispositions, the eight criteria, Task 4's UX decision and the gate line); Richard's go-ahead was "execute the plan", which Task 5 is the last step of.
- [x] **Step 3: On his go-ahead, stage and commit exactly these paths** — `AGENTS.md` `package.json` `src/App.tsx` `src/components/CompareTable.tsx` `src/components/CompareView.tsx` `src/components/SlotPanel.tsx` `src/components/Upload.tsx` `src/lib/compare.ts` `src/lib/gz-marks.ts` `tests/verify-compare-display.ts` `tests/verify-compare-conditions.ts` `tests/verify-compare-roster.ts` `tests/verify-gz-marks.ts` `docs/superpowers/plans/2026-11-17-compare-batch-finish.md` — plus any file a later task justifiably added. Do **not** `git add -A`: the working tree may hold something unrelated. **That list omitted `tests/README.md`**, which Task 1 modified under this plan's own "plus any file a later task justifiably added" clause — added, 15 paths staged.
- [x] **Step 4: Verify the commit** — `git status --short` shows only untracked files you meant to add, `git log --oneline -1` names your commit, and `npm.cmd run ci` still exits 0 on the committed tree. Tree clean afterwards; commit `31cc15e` (amended once to strip a BOM the message file had picked up — the same defect `345b2b0` and `90a266a` still carry); the gate ran **before** staging, exit 0 on identical content.
- [x] **Step 5: Do NOT push.** Tell Richard the commit is there and that nothing has left the machine. Not pushed — `compare-hulls` has no upstream at all.
- [x] **Step 6: Update the manager state file** — append a dated entry to `C:\richard-dev\projects\manager\STATE.md` recording the commit hash, the review verdicts and their dispositions, the UX decision, and the gate run. Done. Note: `C:\richard-dev` is a junction to `C:\Users\Richard Malán`, so that path and rule 6's are the same file. Its section-2 "Task 10 cross-review … still uncommitted" item was corrected in the same edit: `70fba02` is on `main` **and** `origin/main`, so only the *unapplied findings* question remains open.

## Acceptance criteria for the plan as a whole

1. `npm.cmd run ci` exits 0 on the committed tree.
2. `tests/README.md` and `AGENTS.md` both describe 23 suites, with rows for both new Compare suites.
3. Each of the eight acceptance criteria has an explicit reviewer verdict on record.
4. The ten read-through interactions in Task 2 either passed, or produced a fixed defect with a regression assertion.
5. Exactly one commit on `compare-hulls`, nothing pushed, carrying the review dispositions in its message.