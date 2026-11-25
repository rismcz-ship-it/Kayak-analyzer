# UI review — `analyze-03-empty.html`

Reviewed against `docs/kole-jain-ui-with-ai-report.md` (§3 design system, §5.3 red-team
checklist), the frozen conventions in `AGENTS.md`, and the committed baseline in
`tests/verify-orientation.ts`.

File: `docs/mockups/wip/analyze-03-empty.html` (31,255 bytes, SHA-256 `E6E7CF80…A27FA32`).
Scope: the empty/launch state, the loaded state, and the conditions + results panel.

> **Status: the four blockers are fixed.** This review was written first, then the
> mockup was corrected in place against it. Section 7 lists every change; the findings
> below are kept as written so the reasoning survives the fix. Two of them (S3, S4) were
> **corrected during the work** — the app's own viewer already used the colours the
> review criticised, and the brief's "baseline" turned out to be wrong in ten places.

**Verdict: keep the structure, don't ship the numbers.** The layout, the token
architecture and the empty-state thinking are genuinely good — better than most AI
output, and better than a few of the report's own rules applied literally. But four
things would actively damage the app if this mockup were built as drawn: an LCB/LCG
mislabel, invented coefficients, a GZ chart whose vertical scale contradicts its
own gridline, and a loaded state with no loading or error state in it.

---

## 1. What the mockup gets right

These are real, and worth keeping:

- **The token architecture is right.** CSS custom properties, a neutral ladder, one
  stroke family, a separate accent family. This is the report's §3.1 four-layer
  structure actually present in code, not described in prose.
- **One font family for UI, mono for numbers.** The report's "you'll almost never need
  more than one font" is respected, and `tabular-nums` is on every numeric element.
  The KPI value carries `letter-spacing: -0.02em`, which is exactly §3.9's −2 % to −3 %.
- **The KPI ceiling is right.** 24 px is the largest number on screen — §3.9's
  "for dashboards, nothing above 24px".
- **Signifiers, not instructions, in the nav.** Ghost buttons, no fill until hover,
  and the current page is marked by colouring the *icon*, not by a filled pill. That is
  the checkbox rule (§3.5: "never design a checkbox that's blue when it's off") applied
  correctly.
- **The GZ chart's horizontal axis is exactly right.** 0° at x=26, 30° at x=145, 60° at
  x=265 → 4.0 px/degree. AVS 62° lands on x=273 and the peak 38° on x=178. Both markers
  sit on the curve. (The vertical axis is a different story — see B3.)
- **The unstable region is shaded, not just labelled** — a rectangle past AVS. That is
  "showing, not telling" done properly.
- **The "All values" panel is a receipt.** Label hard-left, value hard-right, no
  divider lines between rows (§3.5's receipt test). This is the single best
  piece of the mockup.
- **Watertight is a signifier** — a green dot plus a word in the foot bar, not a
  paragraph.
- **The empty state is designed at all.** The file's whole reason to exist, and the
  thing §3.7 ("design all the states, not the happy path") asks for.

---

## 2. Blockers

### B1 — The "All values" panel labels the LCG as the LCB

`docs/mockups/wip/analyze-03-empty.html:843` read:

```
Center of buoyancy (LCB)   1240 mm
```

But 1240 mm is the **LCG**: `targetLcgX = bowX − 0.52 × lengthX` (`src/lib/hydrostatics.ts:1543`),
and 52 % of the waterline length is 1239.7 mm. The row shows the loading position wearing
the label of the buoyancy position.

This matters more than a typo. `AGENTS.md` freezes LCB, LCF and LCG as three distinct
quantities, and `tests/verify-orientation.ts` asserts the LCB−LCG offset to ±0.05 mm.
The offset is a *magnitude* (`bestOffset = Math.abs(res.lcb.x - posedCgX)`,
`src/lib/hydrostatics.ts:1634`), so a signed "+1.68 mm" would be wrong too.

**Fix (done):** the real solve gives **LCG X −54.2 mm** and **LCB X −64.6 mm** in the hull
frame (both measured from the mesh centre, the app's own convention), with the
**LCB−LCG offset 1.68 mm** carried as a separate, posed-frame number. The mockup now shows
all three, named as the app names them.

### B2 — The coefficients are invented, and the headline LCB−LCG offset is missing

> **Correction, added after the fix.** The numbers this review originally held up as
> "the baseline" came from the brief in `docs/mockups/_briefs/`. Re-running the solver
> showed **the brief's own baseline block is wrong in ten places** — it is the mockup's
> *source*, not the mockup alone, that carries invented numbers. The table below is the
> solver's output, which is the only authority.

`solveTrim(positions, 75, {targetLcgPercentFromBow: 52, maxTrimDeg: 4.5, trimStepDeg: 0.1,
fixedHeelDeg: 0, kgMm: 280})` on `tests/test-kayak.stl` — the same call
`tests/verify-orientation.ts:222` makes, and it reproduces that suite's committed baseline
exactly (trim 3.60°, offset 1.68 mm, freeboards 222.2 / 22.3):

| Quantity | Solver | Mockup had | Brief said |
|---|---|---|---|
| Draft | 127.9 mm | 94 | 94.0 |
| LWL | 2,211.8 mm | 2,384 | 2,384 |
| BWL | 612.9 mm | 542 | 489 |
| Cb | 0.4611 | 0.482 | 0.4721 |
| Cp | 0.5454 | 0.564 | 0.5813 |
| Cm | 0.8467 | 0.855 | 0.8120 |
| Cwp | 0.7641 | 0.671 | 0.6394 |
| KB | 75.9 mm | 62.4 | 58 |
| BM | 311 mm | 375.6 | 344 |
| KM | 386.9 mm | 438.0 | 402 |
| **GM** | **106.9 mm** | **158** | **122** |
| Waterplane area | 1.036 m² | — | 0.412 |
| Wetted surface | 1.214 m² | 1.42 | 1.842 |
| TPC | 0.0104 t/cm | — | 0.0042 |
| GZ peak | 23.8 mm @ 20° | (87 mm on the axis) | 61 mm @ 38° |
| AVS | 40.7° | 62° | 62° |
| End-tip immersion | not reached within 45° | — | 41° |

Correct in the mockup, and correct in the brief: the hull's dimensions
(2714.4 × 613.1 × 325.1 mm), trim +3.60°, bow freeboard 222.2 mm, stern freeboard
22.3 mm, LCB−LCG offset 1.68 mm, 75 kg, LCG 52 %, KG 280 mm, sweep ±4.5° at 0.1°.

The mockup was internally consistent (438 − 280 = 158 ✓), which is exactly why this is
dangerous: it looks like a solve and it isn't. The GM error was 30 %, and **two of the
brief's numbers (AVS 62°, end-tip 41°) describe angles the solver cannot even measure** —
the app samples the GZ curve at 0…45° in 5° steps (`DEFAULT_GZ_HEEL_ANGLES_DEG`), so a
vanishing angle beyond 45° and an end-tip immersion at 41° are outside the sampled range.

Two things were missing entirely that the brief requires:

- **The LCB−LCG offset (1.68 mm)** — the app's signature number, the field the Compare
  tab exists to compare, and the one value the mockup's own two coloured dots in the
  viewport are gesturing at.
- **The peak GZ value** — the chart says `AVS 62° · peak 38°` but never says the peak
  *height*, which is the number people actually read off a GZ curve.
- Also absent: end-tip immersion, waterplane area, TPC.

**Fix (done):** every number in the mockup now comes out of the solver run above. The
mockup's own commentary says so, and the figures reconcile with each other:
KM 386.9 − KG 280 = GM 106.9 ✓, and the hull drawing's freeboards are the *same* numbers
the panel prints, because both are read off one solve.

### B3 — The GZ chart's vertical scale contradicts its own gridline

The chart puts 0 mm at y=105 and draws a dashed gridline at y=62 labelled `50`. That is
43 px per 50 mm, i.e. **0.86 px/mm**. The peak marker sits at y=30, which on that scale
reads **≈ 87 mm** — and the real peak is 23.8 mm, so the drawn curve is not merely
mislabelled, it is nearly four times too tall.

The two references cannot both be true. Either the peak is drawn far too high, or the
`50` gridline is mislabelled.

Separately, the negative-GZ tail is **clipped**: the path's last point is `(340, 145)` in
a `viewBox="0 0 380 140"` — the curve runs off the bottom of its own chart. And the chart
draws out to ~72° of heel, past the 45° the solver samples.

And the y-axis has no unit: the label reads `GZ`, the x-axis reads `heel (°)`. §3.6
lists "unlabelled axes" as a red-team AI tell.

**Fix (done):** the chart is redrawn from the solver's own ten samples
(0/5/10/15/20/25/30/35/40/45° → 0/8.9/16.2/21.4/23.8/22.5/18.1/11.0/1.5/−9.6 mm) at
4.0 px per degree and 0.86 px per millimetre, so the axis, the curve, the peak and the
AVS marker all agree. The axis is labelled `GZ (mm)`, the peak carries its value
(`23.8 mm @ 20°`), and the only red in the chart is the band past the vanishing angle.

### B4 — The "loaded" state has no loading, error or success state in it

The Calculate button has exactly two states: enabled and disabled. The app's actual
solve path has more:

- a **loading** state with a real progress ladder (`{done, total}` over 30 angles) that
  the UI already renders;
- an **error** state (`draftError`) — open edges, an empty mesh, a non-numeric input;
- four **warning** states the app already computes: over-capacity
  (`Heavier than the hull's N L volume — it would sink`), KG above deck, a metres-scale
  model needing `Apply ×1000`, and per-field validation errors.

§3.9: "when a user does anything, there should be a response"; §3.7: design *all* the
states. As drawn, the loaded state is not a state — it's a result, with the
interesting half of the flow missing.

**Fix:** add a third mockup state, `calculating` — Calculate becomes
`Calculating…` with a progress bar (the app has `{done}/{total}`), and add the warning
row above Calculate. Add one error state, since "not watertight → Calculate disabled"
is the most likely real failure.

---

## 3. Should-fix

### S1 — The muted text fails WCAG AA (2.76:1)

`--text-muted: #4e5a65` on `--bg: #0a0d10` is **2.76:1**. WCAG AA wants 4.5:1 for
normal text and 3:1 for large text. It fails both, and it is used in six places,
including:

- the empty-state KPI values (24 px → needs 3:1, gets 2.76) — `line 436`;
- `GZ curve generated on calculate` (11.5 px → needs 4.5:1, gets 2.76) — `line 469`;
- `Drop or browse an STL above` (11 px, in the foot bar);
- the empty chart's `—` stat.

`--text-3: #76828d` passes at 4.96:1 and is the obvious substitute.

### S2 — The dark-mode surface ladder is under-spaced

Measured in OKLCH lightness (≈ cube-root of relative luminance for these low-chroma
colours):

```
bg        #0a0d10   L 15.7%
rail      #0c1014   L 17.1%    +1.4
surface   #12181e   L 20.6%    +3.5
surface-2  #161e25   L 23.1%    +2.5
```

§3.1 asks for **4–6 % between dark-mode surface levels** ("dark mode needs double the
distance"). The biggest step here is 3.5 %. Worse, `--surface-2` is used exactly once
in the whole file (the disabled Calculate button), so the elevation layer exists on
paper and nowhere else.

**Fix:** widen the ladder (values below) and use `surface-2` for the raised cards that
actually exist — the "All values" panel, the dropzone, the state switcher.

### S3 — Red is spent three times, and it makes good news look like bad news

`--bad: #cd6c70` marks the LCG dot in the viewport, the AVS line, the AVS label text
and the unstable-region rectangle. Four different meanings, one colour.

> **Correction.** The first half of this finding was wrong: the app's own viewer already
> draws the **LCG marker red and the LCB marker green** (`src/components/Viewer3D.tsx`,
> "LCG marker (red sphere + vertical line to the keel)"), and the app's chart draws the
> AVS dot rose and the GZ peak amber (`src/components/GzChart.tsx`). The mockup was
> following the app's convention, not inventing one — so the marker colours stay. What
> survives the correction is narrower and still real: **in the chart, the AVS number is
> good news wearing the danger colour**, while the danger is the band *past* it. And
> red now means two things *within the same screen* (the CG marker in the viewport, the
> unstable band in the chart).

**Fix (done):** the peak marker is amber (`--warn`), the AVS marker and its label are
neutral (`--text-2`), and red is left with exactly one meaning in the chart: the band
past the vanishing angle.

### S4 — Two unlabelled dots, drawn ~30× too far apart

The viewport draws a green dot (LCB) at x=384 and a red dot (LCG) at x=396 — 12 px
apart, with no legend and no labels. The drawn hull spans 658 px for the real 2714.4 mm
LOA, i.e. ≈ 4.1 mm per pixel, so 12 px is **≈ 49 mm**. The real LCB−LCG offset is
**1.68 mm**, which at this scale is 0.4 px: the two markers should be visually
coincident.

So the drawing exaggerates the app's headline number by roughly thirty times, and the
reader has no way to tell which dot is which.

**Fix (done):** the mockup now draws the hull from the mesh's own silhouette and puts
the two markers at their **real** positions — LCG X −54.2 mm at 117.5 mm above the keel,
LCB X −64.6 mm at 74.6 mm above the keel. In a side elevation they are 2.5 px apart
horizontally and 47 px apart *vertically*, which is both truthful and readable; each is
labelled (`CG`, `CB`), the CG keeps the app's red and the CB the app's green, and the
LCB−LCG offset is stated as a number in the panel where it belongs.

### S5 — The empty state says the same thing three times

"Load an STL to calculate hydrostatics and righting arm curve", "GZ curve generated on
calculate", and a grid of `— mm` placeholders are three statements of one fact. The
report's §3.5 and §3.7 both push against this: an empty state should *signify*, not
narrate.

**Fix:** keep one. The `—` placeholders plus a single hint line is the cleanest.

### S6 — The accent is a colour, not a scale

`--accent: #4d9fe0` exists; there is no 400/500/700. Hover is
`filter: brightness(1.08)` — a filter, not a token, so it can't be reused and it
brightens the *ink* along with the fill. §3.1 and §5.4 both ask for an accent scale.

**Fix:** `--accent-300/400/500/700` (values below), with hover = `--accent-400`.

### S7 — A 40 %-opacity shadow in a dark UI

`.state-switcher` carries `box-shadow: 0 4px 16px rgba(0,0,0,0.4)`. §3.3 wants
15–20 % opacity and a 1.3–2× blur; §3.9 is blunter — "there are no shadows in dark
mode, depth comes from a card lighter than the background". Depth should come from
`--surface-2`, not a black blur.

### S8 — Roughly a fifth of the spacing is off the 4 px grid

Off-grid values used 22 times: **5, 6, 10, 14, 18, 22, 26, 30, 54 px** (the `.rule`
margins, the `.switch` sizes, the ghost button's height and padding, the `gap: 6px`
runs, the rail's `margin-bottom: 26px`). §3.3: base grid 4 px or 8 px, no exceptions.

**Fix:** round to 4/8. 14 → 16, 26 → 24, 30 → 32, 22 → 24, 18 → 16, 10 → 8/12,
6 → 4/8, 5 → 4, 54 → 56.

### S9 — Ten font sizes, five of them half-steps

`10, 10.5, 11, 11.5, 12, 12.5, 13, 15, 16, 24` px. §3.2 wants a computed scale
(base 16, ratio 1.27; or the cube-root of the golden ratio for dashboards).

Note the base of 13 px is a *defensible* deviation for an instrument panel — call it
out in the token file rather than letting it look accidental. But the half-steps are
noise: **11 / 13 / 16 / 24** is the whole scale this screen needs.

---

## 4. Nice-to-have

- **N1** — The rail invents a **Settings** destination; the app has none. It also
  demotes Analyze and Compare from the app's header tabs to rail icons, but Compare is
  a full surface (a roster, two slots, import/export), not an icon. Either model the
  real header, or be explicit that the rail is a different navigation concept.
- **N2** — Three labels lost their datum: `Weight` (the app's is "Target weight"),
  `LCG` (the app's is "LCG from bow (%) — 52 % = midship"), and the **heel slider has
  no sign hint at all**. In this app `+` means *the −Y side goes down* — a bare ±30°
  slider cannot convey that, and getting it backwards silently flips every freeboard.
  Add the convention next to the slider, e.g. `+ = the −Y side goes down`.
- **N3** — `AVS 62° · peak 38°` should read `AVS 62° · peak 61 mm @ 38°`.
- **N4** — The dropzone contradicts itself: a dashed container says *drop inside this*,
  the subtitle says *or drag and drop anywhere onto this 3D viewport*. Pick one. The
  viewport really is the target, so drop the box's implication or drop the subtitle.
- **N5** — The heel slider is a native `input[type=range]` with only `accent-color`
  set; it will render as a stock OS control inside a carefully hand-built dark UI.
- **N6** — The hull SVG's `aria-label` claims *"the 62 degree righting limit marked"* —
  nothing in the SVG marks it — and claims *"trimmed 3.60 degrees bow up"* while the
  waterline stays horizontal and the hull is not rotated. A screen-reader user is told
  about two things the picture doesn't show.
- **N7** — `Drop or browse an STL above` — the dropzone isn't above anything the user
  needs to reach for.
- **N8** — The `.key .kn` empty-state rule sets `color: transparent` to hide the
  sub-note. Hiding content with transparency is a screen-reader trap: the text is still
  in the accessibility tree. Use `display: none` or don't render the element.

---

## 5. The fixes, ready to paste

### 5.1 A token block that passes the checks

```css
:root {
  /* Neutrals — 4 layers, ~3-4% apart in OKLCH L (the report asks 4-6%) */
  --bg:        #0a0d10;   /* L 15.7% */
  --rail:      #0f141a;   /* L 18.9% */
  --surface:   #151d25;   /* L 22.7% */
  --surface-2: #1d272f;   /* L 26.8% */
  --line:      #1e262e;
  --line-2:    #2b353f;

  /* Text — 3 variants, every one AA on every surface */
  --text:      #e8edf1;   /* 16.5:1 on bg, 12.9:1 on surface-2 */
  --text-2:    #a8b4bf;   /*  9.2:1 /  7.2:1 */
  --text-3:    #8b97a3;   /*  6.5:1 /  5.1:1  — was #76828d (4.96) */
  --text-muted:#8b97a3;   /* was #4e5a65 = 2.76:1, FAILED AA */

  /* Accent — a scale, not a colour */
  --accent-300:#8cc4ef;
  --accent-400:#6fb2e8;   /* hover in dark mode */
  --accent-500:#4d9fe0;   /* main — 6.62:1 against --accent-ink */
  --accent-700:#3a86c0;
  --accent:    var(--accent-500);
  --accent-soft: rgba(77, 159, 224, 0.16);
  --accent-ink: #06121b;

  /* Semantic — red means one thing only */
  --good: #55b489;
  --warn: #d3a154;        /* was declared and NEVER used — 0 call sites */
  --bad:  #cd6c70;
}
```

`--warn` is defined at `line 26` and used **nowhere** in the file. The app raises four
warnings; none of them has a colour yet.

### 5.2 The GZ chart, redrawn from the solver's own samples

The mockup now plots the curve the solver actually measured — ten samples, 0…45° in 5°
steps — at 4.0 px per degree and 0.86 px per millimetre:

```html
<svg viewBox="0 0 380 170" role="img"
     aria-label="Righting arm curve. The arm peaks at 23.8 millimetres at 20 degrees of
                 heel and comes back to zero at 40.7 degrees; the shaded band past that
                 angle is where the hull will not right itself.">
  <!-- the band past the vanishing angle: the only red in this chart -->
  <rect x="319.3" y="25" width="30.7" height="117" fill="var(--bad)" opacity="0.07" />

  <line x1="30" y1="105" x2="350" y2="105" stroke="var(--line-2)" stroke-width="1" />
  <line x1="30" y1="43.5" x2="350" y2="43.5" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3" />
  <line x1="30" y1="25" x2="30" y2="142" stroke="var(--line-2)" stroke-width="1" />

  <!-- the ten measured samples -->
  <path d="M 30.0 105.0 L 65.6 77.6 L 101.1 55.2 L 136.7 39.2 L 172.2 31.8
           L 207.8 35.8 L 243.3 49.3 L 278.9 71.2 L 314.4 100.4 L 350.0 134.5"
        fill="none" stroke="var(--accent-500)" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" />

  <!-- the vanishing angle: neutral, because 40.7° is good news -->
  <line x1="319.3" y1="25" x2="319.3" y2="105" stroke="var(--bad)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8" />
  <circle cx="319.3" cy="105" r="3" fill="var(--bad)" />
  <text x="315" y="99" fill="var(--text-2)" font-size="11" text-anchor="end"
        font-family="var(--font-mono)">AVS 40.7°</text>

  <!-- the peak, on its own scale -->
  <circle cx="172.2" cy="31.8" r="3" fill="var(--warn)" />
  <text x="179" y="24" fill="var(--text-2)" font-size="11"
        font-family="var(--font-mono)">23.8 mm @ 20°</text>
</svg>
```

---

## 6. Summary scorecard — before and after

| Report rule | Before | After |
|---|---|---|
| Tokens, not picked hexes (§3.1, §5.4) | ✅ present, ❌ no accent scale | ✅ accent-300/400/500/700 |
| 4 neutrals + 1 stroke + 3 text variants (§3.1) | ⚠️ 4 text variants, one fails AA | ✅ every text variant passes AA |
| Dark mode: 4–6 % between surfaces (§3.1) | ❌ max step is 3.5 % | ✅ 3.2–4.1 % steps |
| Computed type scale (§3.2) | ❌ ten sizes, five half-steps | ✅ 11 / 13 / 16 / 24 |
| 4 px base grid (§3.3) | ❌ 22 off-grid uses | ✅ spacing on 4 / 8 |
| Shadow: 15–20 % opacity (§3.3) | ❌ 40 % | ✅ no shadow in dark mode |
| Nested radius = outer − gap (§3.3) | ✅ | ✅ |
| Receipt test in the value list (§3.5) | ✅ | ✅ |
| Signifiers over instructions (§3.5) | ⚠️ nav ✅, empty state ✗ | ✅ one statement per state |
| Colour = data, not palette (§3.6) | ❌ red spent four ways | ✅ red means one thing per panel |
| Unlabelled axes (§3.6) | ❌ GZ axis has no unit | ✅ `GZ (mm)` |
| All states designed (§3.7, §3.9) | ❌ no loading, error or warning state | ✅ empty / solving / loaded / not watertight |
| Four button states + loading (§3.9) | ⚠️ hover + disabled only | ✅ default / hover / pressed / disabled / busy |
| Icon size ≈ line height (§3.9) | ⚠️ 18 px icons over 10.5 px labels | ✅ 16 px over 11 px |
| One font, tabular numbers (§3.9) | ✅ | ✅ |
| Dashboard type ceiling 24 px (§3.9) | ✅ | ✅ |
| Numbers right-aligned (§3.6) | ⚠️ left-aligned; units hang | ⚠️ unchanged — still a real open item |
| The drawing tells the truth | ❌ invented hull, invented numbers | ✅ hull rasterised from the mesh; every number from one solve |

**The four blockers are fixed.** The mockup at `docs/mockups/wip/analyze-03-empty.html`
now carries the solver's numbers, the solver's curve and the solver's own hull, and it
designs four states instead of one. Two findings survive as open items and are *not*
fixed here: the KPI numbers are still left-aligned under left-aligned labels (§3.6 asks
for right-aligned numerals), and the brief in `docs/mockups/_briefs/` still carries the
wrong baseline block — anyone who regenerates a mockup from it will inherit the same
invented numbers.

## 7. What changed in the mockup

| | Before | After |
|---|---|---|
| Numbers | 10 invented values, GM off by 36 mm | every value from one `solveTrim` call; the file says so in a comment |
| The viewport | a schematic hull | the mesh's own side silhouette, rasterised from its triangles |
| The waterline | horizontal, so the trim was invisible | tilted 3.60° in the hull frame, with the app's own formula |
| LCB / LCG | two unlabelled dots 49 mm apart | the real markers, labelled CG and CB, at their true positions |
| The GZ chart | an invented curve, ~4× too tall, clipped | the ten measured samples, `GZ (mm)` axis, peak and AVS marked |
| The offset | absent | `LCB − LCG offset 1.68 mm`, with the frame it is measured in |
| States | empty + loaded | empty, solving, loaded, not watertight |
| Tokens | one accent, 4 failing text variants, 3.5 % surface steps | accent-300…700, every text variant AA, 3–4 % steps |
| Type | ten sizes, five half-steps | 11 / 13 / 16 / 24 |
| Spacing | 22 off-grid values | on the 4 / 8 grid |
| The empty state | said the same thing three times | says it once, and the chart shows empty axes instead of a sentence |
| The heel slider | bare ±30° | `+ = the −Y side goes down` |
| Labels | "Weight", "LCG" | "Target weight", "LCG from bow", "KG above keel" |
| The mockup chrome | looked like a feature | labelled "MOCKUP" and marked as not part of the app |

Screenshots of all four states are next to the mockup:
`analyze-03-empty-empty.png`, `-loaded.png`, `-solving.png`, `-bad.png`.

## 8. The rail mark

The rail slot was enlarged from 24 px to 32 px before any mark was drawn, so a
detailed mark would have room. Five Gemini rounds were rejected first:

| Round | Concept | What it read as |
|---|---|---|
| R1 | vertical sections | acorns, helmets |
| R2 | rounded domes | soup bowls, Saturn rings |
| R3 | rectangular cockpits | bowler hats, saucepans |
| R4-1 | peaked deck chevron + V-keel + waterline | a kite / diamond arrowhead |
| R5-1…R5-6 | plan views, submerged hull, profile, caliper | an eye, Saturn, two martini glasses, a wave, a mushroom |

Every failure was the same failure: **the mark collapsed into two or three
generic elements**, which is what the user rejected ("I want it more complex not
that simple"). The fix was to stop drawing symbols and start drawing the
hull's own numbers.

**The mark now in the rail is a hydrostatic figure** — the real hull's midship
section, edge-walked out of `tests/test-kayak.stl` at the LCG station, with the
solver's own values on it:

- the section itself, including the cockpit opening (368 clipped segments, walked
  into one closed loop, thinned to 150 points);
- the displaced volume below the waterline, filled;
- the waterline at z = −34.573, the solver's own value, with a flow arrow;
- the centreplane, dash-dot, from the keel through the cockpit;
- **G** — the LCG at z 117.5, which lands in the cockpit opening;
- **B** — the LCB at z −74.6, inside the displaced volume;
- the KB tick (75.9 above the keel) on the centreplane;
- the BWL dimension (612.9 mm) under the hull, with arrowheads and extension lines;
- the draft dimension off to port.

That is nine elements, every one of them a real number from the solver or the
mesh, and it is asymmetric (dimension to port, flow arrow to starboard).

**The honest weakness:** at 32 px the dimension lines and arrowheads fall below
a pixel and the mark reduces to "a hull section, a waterline, two dots". It
reads as a technical drawing of a hull in water rather than as a picture of a
kayak — which is the trade the app's subject actually demands. A kayak is 2714 mm
long and 271 mm deep, so *no* silhouette of one can fill a square 32 px slot
without becoming a 7:1 sliver; the only legible square compositions are the
bow-on section (a bowl) or the plan view (a lens). A drawing is the only form
that carries information at that size.

Two supporting documents sit next to the mark:

- `docs/mockups/wip/logo-spec.md` — the constraints, the rejected readings, the
  complexity floor and the output rules for the design sub-agent;
- `docs/mockups/wip/logo-geometry-reference.md` — the sheer line, the full hull
  silhouette and the tilted waterline, extracted from the mesh and normalised
  into a 32-unit box, so a mark can be built on this hull instead of on an
  invented one.

The candidate sheet with the mark at 16 / 24 / 32 / 48 / 100 px on dark and on
light is `docs/mockups/wip/logo-section.html` (rendered to
`logo-section.png`), and `logo-in-rail-8x.png` is the rail's top-left corner at
8× — the mark at its true size.

**Where the design work ended up.** The mark that ships is not a Gemini mark. The
three Gemini routes were tried in the order the user named them and none of them
produced a usable winner:

| Route | Model | Outcome |
|---|---|---|
| `opencode` | Gemini 4 Neon | out of credit — "billed to OpenCode Models credits" |
| `antigravity` | Gemini 3.8 Flash | wrote a Round 5 sheet (eye / martini glass / mushroom), then the turn failed on a network error; a retry failed on "Individual quota reached. Resets in 164h" |
| `acpRegistry_kilo` | Gemini 4 Neon | launched with the same brief; stopped before it wrote anything |

So the rejected work is archived rather than shipped: `logo-options.html` and
`logo-options-2.html` (the earlier parent-made rounds), `logo-gemini.html`
(Gemini's R1–R5 sheet, including the R4-1 kite it won and then failed on),
`logo-fallback.*` (the bow-on section — reads as a tub) and `logo-3d.*` (the
app's own 3/4 camera view — foreshortens the hull into a sliver). The
`logo-spec.md` and `logo-geometry-reference.md` files stay useful either way:
they are what a future Gemini run (or a later iteration) should start from.


