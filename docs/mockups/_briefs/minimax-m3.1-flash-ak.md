You are building ELEVEN UI design mockups for the kayak-analyzer project (Vite/React app, but these mockups are standalone static HTML — no React, no build step). Letters a through k. You have no conversation history — everything you need is in this brief.

## Read this first: this is a BLIND run

The same lettered brief is being given to more than one model, and the results are compared. So:

- Do NOT open, read, grep, copy or paraphrase anything under `docs/mockups/deepseek-v4.1-flash-free/`, `docs/mockups/step-5-preview/` or `docs/mockups/mistral-large-4-1t-a52b/` — those are other models' output, and reading it would contaminate the comparison.
- Do NOT look for any existing variant files anywhere. Design from this brief only. If a file you need does not exist yet, you create it.
- The folder `docs/mockups/minimax-m3.1-flash/none/` does not exist yet — create it. Your eleven files go there and nowhere else.
- Do NOT touch `docs/mockups/index.html` or any other arm's folder. The gallery is wired up centrally after your run.
- This brief file itself is the only file you should read (plus files you create).

## House rules (every variant obeys these)

- One self-contained `.html` file per variant. No build step, no JS frameworks, no external requests of any kind: no CDN, no web fonts, no remote images. Inline CSS + inline SVG only. Zero or near-zero `<script>` — these are static pictures of a screen.
- The file IS a 1280 x 800 screen: html/body at height 100%, overflow hidden, layout designed for exactly 1280x800. A gallery previews each file in an iframe scaled to 0.28 (1280x800 -> 358x224 px), so anything overflowing 1280x800 is immediately visible. Never assume a browser window bigger than that.
- Design system per file: CSS custom properties for colours, `var(--mono)`/`var(--sans)` system font stacks, `font-variant-numeric: tabular-nums` on every number, small uppercase micro-labels.
- Real numbers only — use the baseline block below verbatim. Never invent precision or round differently.
- Same CONTENT in every variant: model identity + hull dimensions; the loading condition (75.0 kg, LCG 52.0 % from bow, KG 280 mm, heel 0 deg); the four headline answers (draft, trim, GM, LCB-LCG offset); detail groups (flotation, form coefficients, stability, curve); and the GZ righting-arm curve drawn as an inline SVG chart.
- Keep moving: every turn should contain a tool call. Do not narrate what you are about to write — write it. If a file is too large to emit in one go, split it into a few smaller writes rather than describing them.

## Baseline (the published test-hull run)

- File `kayak.stl` · watertight · 2 714.4 x 613.1 x 325.1 mm
- Draft 94.0 mm · LWL 2 384 mm · BWL 489 mm · waterplane area 0.412 m2 · TPC 0.0042 · wetted surface 1.842e6 mm2
- Trim +3.60 deg bow-up · bow freeboard 222.2 mm · stern freeboard 22.3 mm · LCB-LCG offset 1.68 mm · displacement 75.0 kg
- Cb 0.4721 · Cp 0.5813 · Cm 0.8120 · Cwp 0.6394
- KB 58 mm · BM 344 mm · KM 402 mm · KG 280 mm · GM +122 mm
- GZ max 61 mm at 38 deg · AVS 62 deg · end-tip immersion 41 deg · sweep +/-4.5 deg, fine step 0.1 deg

## The eleven variants (letters, names and theses are FIXED — the execution is entirely yours)

- `a-instrument.html` — "Instrument": dark marine plotter: dense, mono numerals, thin rules, no cards.
- `b-report.html` — "Report": light document: serif headings, numbered sections, print-first.
- `c-workbench.html` — "Workbench": dark CAD/IDE layout, resizable splits, tabbed detail dock.
- `d-editorial.html` — "Editorial": single column, large type, the answer written as prose.
- `e-blueprint.html` — "Blueprint": technical drawing: grid paper, dimension lines, callouts.
- `f-minimal.html` — "Minimal": near-monochrome, three numbers, everything else on demand.
- `g-vibes.html` — "Vibes": open brief — whatever you judge best.
- `h-chart.html` — "Chart": nautical sea chart: soundings, depth contours, chart typography.
- `i-terminal.html` — "Terminal": keyboard-first TUI, monospace throughout.
- `j-cockpit.html` — "Cockpit": analog gauges for draft, trim, GM.
- `k-control.html` — "Control": deliberately generic modern SaaS dashboard — rounded cards, pastel accents, oversized KPI tiles, gradient hero. This one SHOULD look like every other AI-generated dashboard: it is the slop, drawn honestly as a control.

## Where to write

`docs/mockups/minimax-m3.1-flash/none/` with exactly those filenames. Eleven files, letters a to k.

## Verify before you report

- Each of the eleven files opens as a full 1280x800 screen, no scrollbar or overflow in either axis, no external requests (grep your files for "http" — there should be none), all baseline numbers present and spelled as given.
- If you can take a headless screenshot at 1280x800, do it and actually look at each one.
- Do NOT run npm, npx, or any project gate (`npm run ci` / typecheck / tests) — `docs/` is not covered by them and these are not app files. Do NOT git add, commit or push anything. This is Windows: use PowerShell if you need a shell.

## Report back

The eleven file paths, one line each on what you actually drew, and how you verified the files.
