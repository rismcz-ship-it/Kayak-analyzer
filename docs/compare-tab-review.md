# UI review — the Compare tab (the real one)

**Date:** 2026-11-25 · **Method:** the live app, driven in a real browser, measured with
`getComputedStyle` + canvas-sampled colours — the same method as
[the measured UI audit](kayak-analyzer-ui-audit.md), and the same rules:
the [Kole Jain report](kole-jain-ui-with-ai-report.md) §3.1–3.9 and the
[mockup review](mockups/reviews/analyze-03-empty-review.md)'s scorecard.

**Scope:** the Compare tab as rebuilt from `docs/mockups/wip/compare-01.html` — the stage,
the slot cards, the Difference block, the righting-arm chart and the metrics table — plus
the two shared components the review touched (the Analyze tab's GZ chart and the status
dot in three panels).

---

## Verdict

The rebuild inherited the app's tokens and passed the checks that matter most —
**contrast, type floor and the surface ladder** — and failed the three that are easy to
break when a screen is built fast: **the 4 px grid**, **the type floor**, and **the
button states**. Two things the research forbids outright were there too: a **curved
chart line** and a **destructive action with no way back**.

All of it is fixed. Every number below was read off the running DOM.

---

## 1. What was already right

| Check | Rule | Result |
|---|---|---|
| Contrast | WCAG AA, 4.5:1 for body text | **0 failures** across 97 text nodes — the new `--text-3` (#8b97a3) clears 5.1:1 on `--surface-2` and 6.5:1 on the page |
| Dark-mode depth | surfaces get *lighter* as they elevate | page `#0a0d10` → panel `#151d25` → surface-2 `#1d272f`, ~4 % per step ✓ |
| Semantic colour | red means one thing only | `--good` / `--warn` / `--bad` each have one job; a good delta is green and a bad one red, never the reverse |
| Emphasis | relational, not decorative | the verdict is the only bold sentence on the panel |
| The receipt test | body hard-left, numbers hard-right | every metric row reads label → bars → delta, with the digits right-aligned in mono so they line up by place value |
| Showing, not telling | a visual over a label | the six metrics are paired bars; the reader sees *which way* it goes without reading a word |
| Progressive disclosure | secondary content one click away | the 23-row table behind "All metrics", the roster behind "Saved runs" |
| States | empty, loading, success, error | all four exist in the slot card: the drop zone, the solve progress bar, "Live — solved above.", the red error |

## 2. What failed, and what it cost

| # | Finding | Rule | Measured | Fix |
|---|---|---|---|---|
| F1 | 46 text nodes at **10 px**, 2 at **9 px** | §3.2 / the audit: the scale bottoms out at 11 px | 9, 10, 11, 12, 13, 16 px | everything at 11 px or above — the tab now uses **11 / 12 / 13 / 16** and nothing else |
| F2 | **143 spacing values off the 4 px grid** — 2 px ×29, 3 px ×12, 6 px ×77, 10 px ×25 | §3.3: "base grid 4 px or 8 px" | 2, 3, 6, 10 px | all on the grid — **0 off-grid values** left in the tab |
| F3 | the chart's curve was **curved** (`type="monotone"`) | §3.6: "straight lines, never curved — a curve makes it impossible to tell where the line's tip is" | both charts | removed, so the Compare chart and the Analyze chart draw the same straight segments |
| F4 | 8 buttons had **no press state** | §3.1: "every button needs at least four states: default, hover, active, disabled"; §3.4: "on press the button scales down slightly" | 8 of 21 | every button now transitions, hovers and presses (`active:scale-[0.98]`); the disabled state is on Export |
| F5 | the panel used **alpha tints** (`bg-panel/40`, `bg-panel/50`) instead of tokens | §3.1: four layers, not a fog of percentages | 2 tints | the aside is `--page`, the slot card is `--panel`, the fields are `--surface-2` — the same ladder the Analyze tab uses |
| F6 | the roster's delete was **irreversible** | §3.7: "delete and offer an undo toast, or move to a Recently Deleted list" | 1 destructive action, 0 ways back | the delete now raises an undo toast over the stage for 8 seconds; the record comes back with its id |
| F7 | the chart's tick labels at 10 px, and Recharts' default 10 px tooltip padding | the same grid and type rules | 2 sources | 11 px ticks; the tooltip's padding is 8 × 12 |

## 3. One structural change

The righting-arm curves moved **between the six metrics and the verdict**: metrics →
curves → what they mean → the caveat.

They were below the whole Difference block, which put them at y = 733 against a 701 px
scrollport — visible only by scrolling. The curves are the *shape behind* the six
numbers, so they belong directly under them; the verdict is the sentence that reads the
numbers, and it now reads the metrics and their curves together. The chart's head sits
at **y = 636**, inside the panel.

## 4. What I did not change, and why

- **The roster's delete has an undo now, but no "Recently Deleted" list.** The toast is
  the cheaper of the two rules and covers the mistake; a graveyard is a feature, not a
  fix.
- **The row dividers in the metrics table stay.** §3.5's receipt test says a receipt
  has no dividers, but it also says the rows are tight and held by two edges. The
  Compare table is a metrics table, not a receipt, and the divider is what makes 23
  rows scannable — which is the whole reason it is behind a button.
- **The verdict is 12 px while the rest of the small text is 11 px.** It is the one
  sentence the panel exists to deliver; at 11 px it would be the same weight as the
  labels around it.
- **The stage's side-by-side framing is gone.** The hulls are overlaid again, in the
  same place, on the same shared water surface: the old picture was the better one, and
  the mockup's schematic profile was never going to beat the real geometry.

## 5. After — the measurements

```
font sizes        11 px ×88   12 px ×30   13 px ×6   16 px ×142
off-grid spacing  none
contrast          0 failures (97 text nodes, WCAG AA)
buttons           21 controls, every one with default / hover / press, and a
                  disabled state where it can be disabled
chart             straight segments, horizontal gridlines, peak markers
surfaces          page → panel → surface-2, tokens only
destructive       delete → undo toast, 8 s
```

The Analyze tab was measured on the same pass: 0 contrast failures, a clean 11 / 13 /
16 / 24 type scale, and one off-grid value (`mt-[5px]` on a status dot, now 4 px).
