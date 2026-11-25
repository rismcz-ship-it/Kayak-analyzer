# Logo Design: Industry Principles & Research Report

**Purpose:** ground the logo for kayak-analyzer in the principles professional identity
designers actually use, rather than taste. Compiled 2026-11-24 from agency practice
guides, platform design systems (Apple HIG, Android, WCAG), and published research.

---

## 1. The five qualities every strong mark shares

Strip away style and trend, and effective logos share five qualities. A logo that scores
well on four but fails one will cause problems eventually — usually at the worst moment:
the banner that pixelates, the favicon that turns to mush, the rebrand forced five years
early.

1. **Simple** — processed and remembered quickly. "Complexity is usually indecision left
   in the artwork." Simplicity means *no more than is necessary for recognition*, not
   minimalism for its own sake.
2. **Distinctive** — cannot be confused with a competitor. Judged *in context*, against
   the visual landscape the brand lives in, not in isolation.
3. **Appropriate** — fits the audience and category without copying category clichés.
4. **Versatile** — one color, reversed on dark, embroidered, printed, on screen. A logo
   that only works in its ideal setting is a liability.
5. **Durable** — never built on a trend, so it doesn't date.

## 2. Why simplicity works (the psychology)

- **Processing fluency** (Adobe): a mark the brain can interpret easily "tends to support
  clearer and more favorable brand judgments." Simple marks are easier to recognize at a
  glance, remember later, and reproduce at any size.
- **The two-second test**: show the logo briefly to someone unfamiliar with it and ask
  what they saw. Vague or inconsistent answers = simplify.
- **The blur/squint test**: view it smaller or blurred. If the coherent whole disappears
  and only separate parts remain, the structure (Gestalt unity) needs work.
- **Memorability is a single distinctive shape**, not a complex one. The McDonald's arches
  and Target bullseye work as pure shapes — no text required.

## 3. Visual hierarchy

One element leads, the rest support. If every element competes equally, the viewer has no
entry point. Hierarchy is built through size, weight, contrast, and placement — and it
must survive at small sizes. A logo balanced at medium scale that loses its reading order
when reduced isn't strong enough yet.

Two rules that matter:
- Hierarchy must not rely on **color alone** to create hierarchy. If it only becomes
  clear in full color and disappears in black and white, the structure needs more work.
- In multi-word lockups, decide emphasis deliberately (size, weight, color per word).
  The eye likes being cued where to look; logos get a second or two of attention.

## 4. Distinctiveness — the hard one in tech

A University of Sydney study of ~1,500 Australian consumers (*Decoding Tech Brands*, 2022)
found roughly **50% of tech brands use blue** at every growth stage, and people now
associate "tech" with blue as a learned response. Key findings:

- Using blue makes you *fit the category* but earns **zero distinctiveness**; recall
  didn't differ by color at all. Their conclusion: "be brave and ditch the blue."
- **Representative marks** (visualizing the product or an attribute) appeared in ~50% of
  scaleup tech logos; abstract marks (e.g. a rocket for childcare software) don't relate
  to the product.
- Shape, color, and slogan did **not** drive recall — they drive *perception* of brand
  attributes. Cite: nothing in a logo makes people remember; the mark is judged in
  context.

The durable way to stand out is **structural, not stylistic**: a unique shape,
proportion, use of negative space, or relationship between symbol and type is harder to
imitate than a currently fashionable treatment.

**Generic motifs to avoid** (99designs/Canva): globes, cityscapes, swooshy marks, plain
initials-in-a-circle, anything that reads as a template.

## 5. Color

### Color does three jobs (in order of certainty)

1. **Separation from competitors** — the most certain.
2. **Setting tone** — associations, tendencies, context-dependent.
3. **Long-range recognition** — overrated in the literature.

### Honest state of the research

- Blue ↔ competence/reliability; red ↔ excitement (Labrecque & Milne, 2012).
- **Fit matters more than the color itself**: a color feels right when it matches what
  the product promises — "functional" colors for functional products (Bottomley & Doyle,
  2006). Industry expectations override general psychology.
- Color-emotion links are largely shared across cultures (r ≈ .88 across 30 countries,
  Jonauskaite et al., 2020), but some flip (white = mourning in parts of East Asia;
  purple = expense in East Asia; red = luck in China).
- The famous "62–90% of assessment is based on color" and "color increases recognition
  80%" stats are unsourced/misattributed — don't repeat them.

### Common associations (tendencies, not laws)

| Color  | Associations                          | Watch out for                                        |
| ------ | ------------------------------------- | ---------------------------------------------------- |
| Blue   | Competence, reliability, calm         | **Crowded** in finance/insurance/software; cold      |
| Teal   | Precision, water, engineering         | — (a way to keep "water" without the blue crowd)     |
| Green  | Nature, health, growth                | Hard to distinguish from red for colour-blind users  |
| Red    | Excitement, passion, appetite         | Anger/danger; sales-and-warnings territory           |
| Yellow | Joy, optimism                         | Least legible color on white                          |
| Orange | Warmth, friendliness                  | Fails as text on white unless quite dark              |
| Purple | Luxury, creativity                    | Least stable meaning across cultures                  |
| Black  | Authority, luxury, power              | Grief in Western cultures                             |
| White  | Clarity, simplicity                   | Mourning in parts of East Asia                        |

### Application to a kayak hydrostatics tool

- Category convention is water → blue/teal. Following it costs distinctiveness; breaking
  it risks category fit. A defensible middle used by engineering tools: **a near-black or
  deep neutral base + one saturated accent** (Nvidia's black+green, Accenture's
  black+purple), which reads precise and technical rather than "another blue app."
- Design the mark **black-and-white first**. If the logo only works in color, it's not
  done. Color is added once the shape survives without it.
- Reproduce for print as well as screen (CMYK vs RGB) if physical mockups matter.

## 6. Typography (for wordmarks and lockups)

If the logo carries the name, typography *is* the logo.

- **Kerning** (per-pair spacing) vs **tracking** (uniform spacing). Kerning badness
  "can instantly ruin a logo or headline" while passing unnoticed in body text. Tight
  pairs that always need manual attention: AV, Ta, To, We; watch spaces inside rounded
  letters (O, C) and after diagonal stems.
- **Uppercase needs more tracking than lowercase; display sizes need less tracking than
  text sizes.** Slightly tighter tracking reads compact/premium; looser reads open/relaxed.
- **Case shifts perception**: all-caps = authority/formality (worse at tiny sizes);
  lowercase = friendly, digital-native; title case = balance.
- **Customization separates a logotype from "just typed"**: one distinctive letterform
  move (an extended crossbar, a cut, a shared terminal) beats a whole decorative font.
- **Test rhythm by squinting** (blur the letters, check grey balance), flipping
  horizontally (spot asymmetry), and covering parts of the word (spot clumping pairs).
- Avoid trendy display fonts; a typeface in fashion now dates the mark in 3–5 years.
- Default font spacing is never final — always refine, even from a "good" font.

## 7. Shape and geometry: honest grids vs. decorative grids

- **Construction grids** (circles at 1/2, 1/3 subdivisions; repeated radii; shared edge
  lines) give a mark defensible, reproducible proportions — same circle in two letters,
  same angle in two cuts. Clear space and minimum size are then measured in an **x-unit
  taken from the logo itself** (e.g., the stroke or the mark's height).
- **But**: much of the famous "golden ratio logo" material is retro-fitted nonsense. The
  Apple logo's celebrated golden-ratio diagram was drawn years later by fans; the Yahoo
  2013 "mathematical blueprint" was widely criticized. The profession's own guidance:
  "A grid explains a logo. It doesn't make one. Draw it from the finished shapes." A grid
  with three true circles beats twenty decorative ones.
- **Not every logo needs a grid.** A wordmark set in an existing typeface with careful
  spacing gets its rigour from the typeface itself. Use geometry as a **check**, not a
  religion — and record the one or two true relationships it has.

## 8. Scale: the version system (this is where logos usually fail)

A single file is not a logo. The deliverable is a system:

| Variant            | Used for                                                     |
| ------------------ | ------------------------------------------------------------ |
| Primary (full color, horizontal) | Website header, documents                        |
| Stacked/vertical   | Square spaces — social avatars, app store                    |
| Icon-only (mark)   | App icon, favicon, profile pictures                          |
| Wordmark-only      | When the symbol is illegible or too small                    |
| Monochrome (black) | Print, fax, stamps                                              |
| Reversed (white)   | Dark backgrounds, dark mode                                   |

**Clear space** on every side (commonly the height of a letter or stroke), and a
**minimum size** (roughly 120–150 px wide digital; 12 mm / 0.5 in print).

### App icon specifics (platform requirements, not taste)

- Design on a small grid and check strokes are thick enough: at 16 px, a stroke below
  ~1 px vanishes. Icon systems scale stroke *and* padding with size (e.g. IBM's grid:
  16 px → 1 px stroke, 1 px padding, 14 px live area; scale both together).
- **Maskable icons (PWA/Android)**: the mark must live inside a **central circle with
  radius 40% of icon width**; the outer 10% may be cropped. Supply a separate maskable
  file (background filled to all edges) plus a normal `any` icon.
- iOS/Android are supplied **square, unmasked** — the system applies corner rounding and
  shadows; pre-masked art looks jagged.
- Simplicity guidance from Apple HIG: "Find a concept or element that captures the
  essence of your app, and express it in a simple, unique way with a minimal number of
  shapes." Text in icons is discouraged (small, unlocalizable, cluttered); a first
  letter as a mnemonic is acceptable.
- **Favicon reality check**: it renders as small as 16×16 in a tab bar. One bold mark,
  two colors, high contrast, solid shape behind. Test in a dozen open tabs against
  competitors, light and dark theme.

### Vector discipline

Always keep a vector master (SVG). Raster exports come *from* the vector, never the
reverse. Do this even if the mark is only ever used on screen — the app icon and PWA
manifest want SVG-quality geometry, and a single mark will be re-exported at a dozen
sizes.

## 9. Accessibility

- **WCAG exempts logotypes** from contrast minimums (SC 1.4.3) — brand colors are
  "essential." **But** when a logo acts as a UI component (a link, an app header), the
  guidance encourages choosing a variant with sufficient contrast: 4.5:1 for text-like
  marks, 3:1 for graphical objects (SC 1.4.11), and to avoid very thin strokes, which
  anti-alias to a fainter color than specified.
- **~1 in 12 men and 1 in 200 women are color-blind**: never let the mark depend on a
  red/green (or similar-luminance) distinction. Convey everything in luminance
  difference too. Run the mark through a color-blindness simulator.
- Design **light and dark variants** from the start; a logo that only works on one
  background fails WCAG's "distinguishable" guidance in practice and looks broken in
  dark mode.

## 10. The professional process (steal this workflow)

1. **Discovery brief** — what the thing does, who it's for, where the logo will live (at
   what sizes, on what surfaces), references you hate. This is the contract; without it
   the work drifts toward personal taste.
2. **Research** — map the category's visual conventions to find the white space (the
   blue sea, above). Competitor audit: if your mark would look at home on a rival's van,
   it's not doing its job.
3. **Sketching, dozens of thumbnails, on paper** — separates ideas from execution, forces
   quantity, avoids falling in love with the first decent option. Narrow to 3–5.
4. **Digital execution — black and white first**, then color. Rebuild as clean vectors.
   Grid and optical corrections ("round characters overshoot the baseline slightly").
5. **Present 2–3 polished concepts with rationale**, mocked up in real contexts (app
   header, app icon, dark mode). Present 10 options and you advertise indecision.
6. **Refinement rounds** (2–3): round 1 major (shape, type), round 2 color/proportions/
   spacing, round 3 polish. Precision, not reinvention.
7. **Handoff package**: vector master (SVG), raster exports (transparent PNG at needed
   sizes), color variants, horizontal + stacked lockups, favicon/social versions, and a
   one-page style guide (clear space, minimum size, approved colors with HEX/RGB, do's
   and don'ts).

## 11. The test protocol (before calling it done)

A logo passes only when it survives all of these:

1. **Shrink it** to favicon size (16–32 px). If the shape blurs or details vanish,
   simplify.
2. **Strip the color** to one color. If meaning or legibility is lost, the design leans
   on color instead of shape.
3. **Flip the background**: solid light and solid dark. Both legible, or build a reversed
   variant.
4. **Busy background**: over a photo/texture (e.g. the 3D hull screenshot) — fine details
   and thin strokes die here.
5. **Phone screen at real size**, no zoom: header, app icon, avatar.
6. **Print at business-card size** — physical proofs catch what screens hide.
7. **Blow it up** to banner/signage size — exposes distortion and stretched parts.
8. **Compare to competitors** side by side — checks distinctiveness in context.
9. **The two-second/blur tests** from §2.
10. **Color-blind simulator + dark mode** (§9).

## 12. Anti-patterns (the failure list)

- Detail that dies at small sizes; traced/complex outlines instead of simplified shapes.
- Color-only meaning; designs that collapse to grey mush in monochrome.
- Generic category clichés (globes, swooshes, plain initials-in-circles) — instant
  "template" read.
- Trend-chasing: gradients/3D/effects-heavy marks date fastest; the debranding trend is
  the industry correcting itself. Note the counterweight: total simplicity can sacrifice
  personality — the target is *reduced*, not *empty*.
- Retro-fitting a mathematical grid to justify a finished mark.
- Presenting everything at once; gold-plating with dozens of lockups — 1–2 core layouts,
  committed.

## 13. Recommended direction for this project (summary brief)

- **Mark type**: a single simplified geometric idea tied to what the app *does*
  (equilibrium — hull meets waterline, the vertical G–B relationship), not a literal
  traced hull outline. Representative in meaning, abstract in form.
- **Personality**: precision instrument, engineering tool. Trustworthy but not
  corporate-blue.
- **Structure**: draw on a small grid with repeated radii; one distinctive feature.
- **Palette**: one neutral (near-black/off-white base) + one accent; verify ≥4.5:1
  against both UI grounds; dark and light variants; plan for the dark app theme already
  used in the mockups family.
- **System from day one**: primary horizontal + stacked + icon-only + monochrome +
  reversed; SVG master; 16/32 px favicon test; maskable PWA icon with the 40% safe zone
  if the app is installable.
- **Gate**: pass all ten tests in §11 before adoption.

## Sources

- Adobe Express — *Logo design principles* (simplicity/processing fluency, hierarchy,
  distinctiveness, appropriateness, timelessness)
- Design.com — *What Makes a Good Logo? 10 Principles* (incl. the 8-step testing protocol)
- Canva — *Logo design principles* (avoiding generic motifs)
- 99designs — *Psychology of Color: Technology* (palette data, 1,000+ tech logos)
- University of Sydney / Hotwire — *Decoding Tech Brands* (2022; sea-of-blue,
  distinctiveness, recall findings)
- Labrecque & Milne (2012), Bottomley & Doyle (2006), Jonauskaite et al. (2020) — via
  logodesign.co *Logo Colors* (incl. the debunking of the unsourced color statistics)
- Smashing Magazine — *Mastering Typography in Logo Design* (kerning/tracking/case)
- Shopify & Logo.app — wordmark craft: spacing, ligatures, customization, grids/baselines
- Brandfile, Creative Bloq, Inkbot — grid construction and the honest-vs-decorative grid
  critique
- DRIC Designs / MarkAge360 — agency workflow: brief → research → sketch → execute →
  present → refine → handoff
- Apple HIG — *App icons*; Android Developers — *Adaptive icons*; web.dev — *Maskable
  icons* (safe zone = 40% radius); IBM Design Language — icon grid/stroke scaling
- W3C WCAG 2.2 SC 1.4.3 (Contrast — logo exemption), SC 1.4.11 (Non-text contrast),
  Section508.gov — color accessibility; National Eye Institute — color-blindness
  prevalence