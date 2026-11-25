/**
 * Builds docs/mockups/index.html from the folders on disk.
 *
 * The folders are the provenance: <model>/<skill>/*.html. Re-run after any arm
 * adds files:  node docs/mockups/build-gallery.mjs
 */
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

// Folder order in the gallery; unknown arms sort after these, alphabetically.
const ARM_ORDER = ['deepseek-v4.1-flash-free', 'step-5-preview', 'mistral-large-4-1t-a52b', 'minimax-m3.1-flash']
const PROVIDER = {
  'deepseek-v4.1-flash-free': 'opencode Zen free',
  'step-5-preview': 'NIM',
  'mistral-large-4-1t-a52b': 'NIM',
  'minimax-m3.1-flash': 'local ACP',
}

const STUDIES = [
  ['a', 'Instrument', 'Dark marine plotter: dense, mono numerals, thin rules, no cards.'],
  ['b', 'Report', 'Light document: serif headings, numbered sections, print-first.'],
  ['c', 'Workbench', 'Dark CAD/IDE: resizable splits, tabbed detail dock.'],
  ['d', 'Editorial', 'Single column, large type, the answer written as prose.'],
  ['e', 'Blueprint', 'Technical drawing: grid paper, dimension lines, callouts.'],
  ['f', 'Minimal', 'Near-monochrome, three numbers, everything else on demand.'],
  ['g', 'Vibes', 'Open brief — whatever the design judges best.'],
  ['h', 'Chart', 'Nautical sea chart: soundings, depth contours, chart typography.'],
  ['i', 'Terminal', 'Keyboard-first TUI, monospace throughout.'],
  ['j', 'Cockpit', 'Analog gauges for draft, trim, GM.'],
  ['k', 'Control', 'Deliberately generic modern SaaS dashboard — the slop, as a control.'],
]

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dirs = (p) =>
  existsSync(p)
    ? readdirSync(p)
        .filter((n) => statSync(join(p, n)).isDirectory())
        .sort()
    : []

const files = (p) => (existsSync(p) ? readdirSync(p).filter((n) => n.endsWith('.html')) : [])

function card(rel, letter, name, thesis, pending) {
  if (pending) {
    return `    <article class="card pending">
      <div class="frame"><div class="empty"><b>${letter} · ${esc(name)}</b><span>not built</span></div></div>
      <div class="meta">
        <div class="meta-top"><span class="letter">${letter}</span><h2>${esc(name)}</h2></div>
        <p class="thesis">${esc(thesis)}</p>
      </div>
    </article>`
  }
  return `    <article class="card">
      <div class="frame"><iframe src="${esc(rel)}" title="Variant ${letter} — ${esc(name)}, live preview" loading="lazy"></iframe></div>
      <div class="meta">
        <div class="meta-top">
          <span class="letter">${letter}</span>
          <h2>${esc(name)}</h2>
          <a class="open" href="${esc(rel)}" target="_blank" rel="noopener">Open ↗</a>
        </div>
        <p class="thesis">${esc(thesis)}</p>
      </div>
    </article>`
}

const arms = []
for (const model of dirs(root)) {
  for (const skill of dirs(join(root, model))) {
    const dir = join(root, model, skill)
    const present = files(dir)
    if (!present.length) continue
    const byLetter = new Map()
    const extras = []
    for (const f of present) {
      const stem = f.replace(/\.html$/, '')
      const letter = stem[0]
      if (/^[a-k](-|$)/.test(stem) && stem.length > 2 && stem[1] === '-') byLetter.set(letter, f)
      else extras.push(f)
    }
    arms.push({ model, skill, dir, byLetter, extras })
  }
}

arms.sort((x, y) => {
  const ix = ARM_ORDER.indexOf(x.model)
  const iy = ARM_ORDER.indexOf(y.model)
  const rx = ix === -1 ? 99 : ix
  const ry = iy === -1 ? 99 : iy
  return rx - ry || x.model.localeCompare(y.model) || x.skill.localeCompare(y.skill)
})

let built = 0
let total = 0
const sections = arms
  .map(({ model, skill, byLetter, extras }) => {
    const cards = []
    for (const f of extras) {
      built++
      total++
      cards.push(card(`${model}/${skill}/${f}`, 'r0', 'First pass', 'The original concept, before the study was split into variants.', false))
    }
    let have = 0
    for (const [letter, name, thesis] of STUDIES) {
      total++
      const f = byLetter.get(letter)
      if (f) {
        have++
        built++
        cards.push(card(`${model}/${skill}/${f}`, letter, name, thesis, false))
      } else {
        cards.push(card(null, letter, name, thesis, true))
      }
    }
    const skillLabel = skill === 'none' ? 'no skill' : skill
    const provider = PROVIDER[model] ?? ''
    const meta = `${have} of ${STUDIES.length} built`
    return `  <!-- arm · ${esc(model)} × ${esc(skill)} -->
  <section class="arm" aria-label="${esc(model)}, ${esc(skillLabel)}">
    <div class="arm-head">
      <h2>${esc(model)} <span>${esc([provider, skillLabel].filter(Boolean).join(' · '))}</span></h2>
      <span class="arm-meta">${esc(meta)}</span>
    </div>
    <div class="grid">

${cards.join('\n\n')}

    </div>
  </section>`
  })
  .join('\n\n')

const css = `    :root {
      --bg: #0b0c0e;
      --panel: #111315;
      --rule: #22262a;
      --rule-2: #2e343a;
      --ink: #e8eaec;
      --ink-2: #9ba1a8;
      --ink-3: #666d75;
      --accent: #e2a34a;
      --mono: ui-monospace, "Cascadia Mono", "SFMono-Regular", Menlo, Consolas, monospace;
      --sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
      --s: 0.28;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font: 13px/1.5 var(--sans);
      -webkit-font-smoothing: antialiased;
    }
    a { color: inherit; }
    .page { max-width: 1240px; margin: 0 auto; padding: 40px 28px 72px; }

    .masthead {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 32px; padding-bottom: 18px; border-bottom: 1px solid var(--rule-2);
    }
    .wordmark { display: flex; align-items: baseline; gap: 9px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
    .wordmark span { font-size: 10px; font-weight: 400; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-3); }
    .masthead h1 { margin: 10px 0 0; font-size: 34px; font-weight: 300; letter-spacing: -0.025em; line-height: 1.1; }
    .masthead p { margin: 8px 0 0; max-width: 54ch; color: var(--ink-2); font-size: 13px; }
    .masthead-meta {
      text-align: right; font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--ink-3); line-height: 1.9; white-space: nowrap;
    }
    .masthead-meta b { color: var(--accent); font-weight: 500; }

    .arm + .arm { padding-top: 52px; }
    .arm-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 24px; padding-bottom: 14px; border-bottom: 1px solid var(--rule-2);
    }
    .arm-head h2 {
      display: flex; align-items: baseline; gap: 10px; margin: 0;
      font-family: var(--mono); font-size: 13px; font-weight: 500; letter-spacing: 0.02em; color: var(--ink);
    }
    .arm-head h2 span {
      font-family: var(--sans); font-size: 10px; font-weight: 400;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3);
    }
    .arm-head .arm-meta {
      font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--ink-3);
    }

    .grid {
      display: grid; grid-template-columns: repeat(auto-fill, 358px);
      justify-content: center; gap: 34px 26px; padding-top: 30px;
    }
    .card { min-width: 0; }
    .frame {
      position: relative; width: 358px; height: 224px; overflow: hidden;
      background: #050607; border: 1px solid var(--rule-2);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45);
    }
    .frame iframe {
      position: absolute; top: 0; left: 0; width: 1280px; height: 800px; border: 0;
      transform-origin: 0 0; transform: scale(var(--s)); background: #050607;
    }
    .frame::after {
      content: ""; position: absolute; inset: 0;
      border: 1px solid rgba(255, 255, 255, 0.05); pointer-events: none;
    }
    .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
      height: 100%;
      background: repeating-linear-gradient(-45deg, transparent 0 7px, rgba(255, 255, 255, 0.022) 7px 8px);
      font-family: var(--mono); font-size: 10px; letter-spacing: 0.2em;
      text-transform: uppercase; color: var(--ink-3);
    }
    .empty b { font-weight: 400; color: var(--ink-2); letter-spacing: 0.12em; }

    .meta { padding-top: 12px; }
    .meta-top { display: flex; align-items: baseline; gap: 8px; }
    .letter {
      font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--accent); padding-top: 1px;
    }
    .meta h2 { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.005em; }
    .open {
      margin-left: auto; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--ink-3); text-decoration: none;
      border-bottom: 1px solid transparent; padding-bottom: 1px;
    }
    .open:hover, .open:focus-visible { color: var(--accent); border-bottom-color: var(--accent); outline: none; }
    .thesis { margin: 5px 0 0; font-size: 12px; line-height: 1.5; color: var(--ink-2); }
    .pending .thesis { color: var(--ink-3); }

    .footnote {
      margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--rule);
      display: flex; justify-content: space-between; gap: 24px;
      font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--ink-3);
    }

    @media (prefers-reduced-motion: no-preference) {
      .card { transition: transform 160ms ease; }
      .card:hover { transform: translateY(-2px); }
    }`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Analyze screen — design studies</title>
<style>
${css}
</style>
</head>
<body>
<div class="page">

  <header class="masthead">
    <div>
      <div class="wordmark">kayak-analyzer <span>Analyze screen</span></div>
      <h1>One hull, eleven studies, ${arms.length} arms.</h1>
      <p>
        The same solved run — 75 kg, LCG 52 %, KG 280 mm — rendered eleven times per model.
        Each file is a self-contained 1280 × 800 screen. Previews are live.
        The folders record provenance: <b>model → skill</b>.
      </p>
    </div>
    <div class="masthead-meta">
      Baseline · trim +3.60° · GM +122 mm<br>
      <b>${built} of ${total} built</b><br>
      generated from the folders
    </div>
  </header>

  <main aria-label="Design variants">

${sections}

  </main>

  <footer class="footnote">
    <span>kayak-analyzer · docs/mockups</span>
    <span>folders = model → skill · static HTML · 1280 × 800</span>
  </footer>

</div>
</body>
</html>
`

writeFileSync(join(root, 'index.html'), html)
console.log(`index.html: ${built} of ${total} built across ${arms.length} arms`)
for (const a of arms) console.log(`  ${a.model}/${a.skill}: ${a.byLetter.size}/11`)
