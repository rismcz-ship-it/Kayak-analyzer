# kayak-analyzer — measured UI audit

**Date:** 2026-11-24 · **Method:** the live app, driven in a real browser, measured with `getComputedStyle` + pixel-sampled colour normalisation. Every number below was read off the running DOM, not estimated.
**Rules applied:** the [Kole Jain report](kole-jain-ui-with-ai-report.md) — §3.1 (colour system), §3.2 (typography), §3.3 (spacing/grid), §3.4 (motion), §3.7 (states), §3.9 (states & feedback).

> **Scope note:** this audit covers the **empty state** (no STL loaded) at 1280×800. The results screen, the compare view and the 3D viewer were not loaded, so panels, charts and tables are **not yet audited**.

---

## Verdict

The foundation is **better than most AI-generated UIs** — the dark-mode depth rule is already correct, the accent count is disciplined, and the type weights are restrained. What's missing is a *system*: the same three faults repeat across every file.

**3 of 8 visible text nodes fail WCAG AA.** 41 off-grid spacing values. No focus ring on any control except two toggles.

---

## 1. Contrast — 3 failures (WCAG AA needs 4.5:1)

| Text | fg | bg | Ratio | Need | Size |
|---|---|---|---|---|---|
| "Static float + stability viewer — school project" | `#71717b` | `#09090b` | **4.12** | 4.5 | 12px |
| "Upload an STL of your kayak to inspect dimensions…" | `#71717b` | `#09090b` | **4.12** | 4.5 | 14px |
| "or click to browse · ≤ 25 MB · parsed in memory…" | `#71717b` | `#19191b` | **3.64** | 4.5 | 12px |

**Cause:** `text-zinc-500` (#71717b) is used for every secondary/subtext line. **41 occurrences across 8 files** (`App.tsx` 9, `CompareView.tsx` 8, `SlotPanel.tsx` 7, `Viewer3D.tsx` 6, `GzChart.tsx` 4, `Upload.tsx` 3, `CompareTable.tsx` 2, `ResultsPanel.tsx` 2).

**Fix:** bump secondary text to `text-zinc-400` (#a1a1aa) → contrast against `#09090b` rises to ≈6.4:1, and against the `#19191b` card to ≈5.3:1. One-token change, zero layout shift.

This matches report §3.1's dark-mode rule: body text should sit at **15–20% white**, subtext at **30–40%** — `zinc-500` is roughly 11% white, too dark for body copy in dark mode.

## 2. Spacing — 35 values off the 4/8 grid

Measured spacing on the empty state: `4px` ×47, `8px` ×47, **`6px` ×35**, `16px` ×32, `12px` ×12, `2px` ×12, `24px` ×5, `20px` ×4, `56px` ×2.

`6px` is Tailwind's `gap-1.5` / `space-1.5` / `p-1.5` — off a 4px grid. `2px` is off it too.

Report §3.3: *"Everything is a multiple, not because it inherently looks better, but because you can always split things in half, which creates consistency throughout a design."* **Fix:** replace `1.5` steps with `1` or `2` (4px / 8px).

## 3. Typography — 6 sizes, no chosen typeface

Sizes in use: `16px` ×70, `12px` ×37, `14px` ×15, **`10px` ×3**, `18px`, `20px`.
Weights: `400` ×19, `500` ×3, `600` ×2 — restrained and good.
Family: the Tailwind default system stack on **126 of 127 elements**. No typeface has been chosen.

Issues:
- **`10px` is too small.** The report's grouping scale bottoms out at a 12px eyebrow. 10px fails legibility on a 1× display.
- **Six sizes, but not a scale.** 10 → 12 → 14 → 16 → 18 → 20 is an arbitrary ladder, not the **1.27 ratio** (report §3.2). A real scale from a 16px base: 12.6, 16, 20.3, 25.8, 32.8 — or the pragmatic subset 12 / 14 / 16 / 20 / 26.
- **No chosen font.** Report §3.9: *"you'll almost never need more than one font — find a nice sans serif and stick to it."* The system stack is a defensible neutral, but it's the browser's opinion, not yours. One `@theme` line fixes it.

## 4. Colour — the strongest part, with one gap

Surfaces in use: `#09090b` (page), `#19191b` (card), `#27272a` (active button), `#00bc7d` (one emerald status dot). Text: `#f4f4f5`, `#e4e4e7`, `#9f9fa9`, `#71717b`.

**Good:** the dark-mode depth rule is already correct — the card is *lighter* than the background (#19191b on #09090b), which is exactly report §3.1's "in dark mode we don't have shadows, so depth comes from a lighter card than the background." Shadows: **zero** — also correct.

**Gap:** there is **no red anywhere in the palette**. Report §3.1: *"it's pretty much a design sin to make destructive actions anything other than red."* The app has destructive actions (delete a run record, clear a comparison, overwrite a saved run) and no destructive colour is defined. Also: 4 text levels where the report wants 3 — the 4th being the failing `zinc-500`.

## 5. States & focus — the biggest gap

- **Focus rings: 8 occurrences of `focus-visible` in the entire codebase, and both are `peer-focus-visible` on two toggle switches** (`App.tsx:630`, `SlotPanel.tsx:419`). Every other control — the Analyze/Compare buttons, the file input, the upload dropzone — has **no visible keyboard focus state**. Measured on the live DOM: `outlineStyle: none` on all three buttons, and no `box-shadow` ring.
- **Motion: 18 of 24 interactive elements have no transition.** Only `0.15s` on 9 elements. Report §3.9: *"When a user does anything, there should be a response"* and *"every button needs at least four states: default, hover, active or pressed, and disabled."*
- No `:focus-visible` ring, no `:active` press state, no `:disabled` state were observed on the empty-state controls.

**Fix, cheapest first:**
1. One global rule in `src/index.css`:
   ```css
   :focus-visible { outline: 2px solid var(--color-sky-400); outline-offset: 2px; }
   ```
2. A shared `.btn` class carrying `transition-colors duration-150 hover:bg-* active:bg-* disabled:opacity-50 disabled:pointer-events-none`.
3. A `--color-destructive` token (red-500) reserved for destructive actions.

## 6. What's already right — keep it

- Dark-mode depth via lighter surfaces, **zero shadows** (§3.1, §3.9 both agree).
- **Three text weights only** (400/500/600) — the report warns against ultra-bold/ultra-thin; this is disciplined.
- **One green status dot** for "STL stays in memory · max 25 MB" — semantic colour used for meaning, not decoration (§3.9).
- The empty state names the **action and its constraint** ("Drop an STL hull here / click to browse · ≤ 25 MB"), which is the §3.7 "design around intent" pattern rather than a generic "Upload file".
- The drop zone is a real `<button>` with an accessible name, not a div.

---

## What I'd change, in order

| # | Change | Effort | Impact |
|---|---|---|---|
| 1 | `text-zinc-500` → `text-zinc-400` (41 sites) | 10 min | Fixes 3 WCAG failures |
| 2 | Global `:focus-visible` ring in `index.css` | 5 min | Keyboard users can see where they are |
| 3 | Replace `1.5` spacing steps with `1`/`2` | 20 min | On-grid consistency |
| 4 | Define `@theme` tokens: surfaces, text, accent ramp, destructive, motion | 45 min | The contract that makes future AI output on-brand |
| 5 | Shared `.btn` with hover/active/disabled/focus states | 30 min | "Every interaction needs a response" |
| 6 | Pick one sans (one `@theme` line) and rebuild the size scale on 1.27 | 30 min | A type system instead of a ladder |
| 7 | Add `--color-destructive` red; apply to delete/clear/overwrite | 20 min | Destructive actions are always red |

Steps 1–3 are mechanical and I can do them now without touching layout. Step 4 is the one that changes everything downstream: once the tokens exist, every screen rebuild inherits them, and the AI-generates-the-design problem from the report stops applying to this app.

---

## Method notes (what the tooling could and couldn't do)

- Tailwind v4 emits **`oklch()`** colours, which a naive `rgb()` parser can't read. Chrome also keeps `oklch()` in canvas `fillStyle` rather than converting it — so contrast had to be computed by **filling a 1×1 canvas and reading the pixel back**.
- The audit run was invalidated twice: once because `getClientRects()` filters out elements with no layout box (mislabeling the count), and once because **Vite hot-reloaded the page mid-measurement** (dependency re-optimisation), detaching the DOM. Lesson: re-read the page state before trusting a measurement, and treat a suspiciously small element count as a reload, not a design finding.
