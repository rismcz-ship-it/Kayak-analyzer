# Designing Better UI with AI — a report built from Kole Jain's channel

**Source:** [Kole Jain (@kolejain)](https://www.youtube.com/@kolejain) — 54 videos, ~79.8k subscribers.
**Coverage:** **all 54 videos transcribed and read.** The channel catalog was pulled in full (IDs, durations, view counts, upload dates), every video's transcript was fetched, and the corpus was analysed in seven parallel passes — the AI-specific videos read directly, the rest delegated for structured extraction of claims, exact numbers, named techniques and anti-patterns, then cross-checked against the raw transcripts.
**Compiled:** 2026-11-24 (rev. 2 — full coverage). Every rule below is traceable to a specific video (linked inline) — nothing is invented.

---

## 1. The thesis in one paragraph

AI writes *shockingly good code*. Design *is* code. So the reason every AI-built interface looks like every other AI-built interface is **not** a coding problem — it is a **decision** problem. AI copies the *result* of a design without the *reason* for it, so you get the average of everything it was trained on. Kole's framing: *"If you don't have an opinion, AI will give you one."* The whole channel is really one long argument for the same move: **the human supplies the opinion (the intent, the hierarchy, the trade-offs, the identity), and the AI supplies the execution.** The videos below are grouped into (a) the diagnosis, (b) the design system you should encode so AI stops guessing, (c) the AI workflow that produces good output, (d) a catalogue of the exact tells AI leaves behind, and (e) a prompt library you can paste.

---

## 2. The diagnosis: three tells of a vibe-coded UI

From [Why everyone can tell you're a vibe coder](https://www.youtube.com/watch?v=NHOCPS1G1xw) (118k views, Nov 2026) — the most important video on this list for your use case.

Kole shows three cards; one is AI-generated and you can spot it instantly. **Only the first tell is visual.** The other two are structural, which is exactly why a pure visual check misses them.

| # | The tell | What it looks like | Why AI does it | The fix |
|---|---|---|---|---|
| 1 | **Components copied without their reason** | A dropdown arrow pointing **down** while the popover opens **up**; an account popover that leads with the user's email (copied from Notion) when the email answers a question this product doesn't ask | AI reproduces the artefact of a pattern, not the logic behind it | Ask "what question does this element answer *here*?" before accepting it. If it answers nothing, cut it |
| 2 | **Simplicity chosen for the *creator*, not the *user*** | A date picker as three dropdowns (Month / Day / Year) instead of a calendar — the build is simpler, but the user must now mentally count days to reach "this Friday" | AI optimises for code brevity and for *your* build time | Apply **Tesler's Law**: complexity can't be removed, only relocated. Either the system carries it, or your user does. Make the system carry it |
| 3 | **Pages connect to the sidebar, never to each other** | Every prompt became a page; Tasks → Projects → Members are reachable only via the sidebar, so you burn 4 clicks and lose your place | Each feature was prompted in isolation | Link pages to pages the way Wikipedia does — nouns are links. Add hover previews so the answer surfaces without navigation |

Two more findings from the same video worth internalising:

- **Onboarding that explains is worthless.** NN/g ran the study: the group that sat through a modal onboarding succeeded **91%** of the time versus **94%** for the group that skipped it. A modal "doesn't remove complexity, it just explains your app". A good onboarding *builds* the product around what the user needs (ask what they'll use it for, walk them through creating their first real project, say explicitly that it's all editable later). Notion and Canva both start by asking what you'll use the product for.
- **The Magic Mouse test.** Apple's mouse chose form over function — clean, cordless, effortless — and people hated it. That's the point: they had an opinion they were willing to be disliked for. AI, by default, has none.

**Before you prompt, answer these four** (his closing questions):
1. Why would someone open this?
2. How are they actually using it?
3. What would they want to know next?
4. What are you willing to leave out?

---

## 3. The design system to encode (so AI stops guessing)

These are the concrete, implementable numbers from the channel. Encode them as tokens and hand them to the AI — then the AI's defaults stop mattering.

### 3.1 Colour — four layers, not 60-30-10

From [Why the 60-30-10 Rule is RUINING Your UI Designs](https://www.youtube.com/watch?v=66oOi9OLMCw) and [The 7 Color Mistakes that RUIN your UI Designs](https://www.youtube.com/watch?v=EOcY3hPMQkk).

60-30-10 is a landing-page rule. Product UI needs four layers: **neutrals → functional accent → semantic → theming**.

**Layer 1 — neutrals.** For a product: **4 background layers, 1 stroke (often 2), ~3 text variants** (excluding charts, hover states and interactivity). For a landing page, 3–5 neutrals is plenty.

- Real-world backgrounds: Linear 99% white, Notion 100%, Vercel 98%.
- The frame/sidebar is a slightly darker anchor — because it's large it only needs to be *very* slightly darker (Mercury adds just 2% blue to theirs).
- A card on a background should be defined by **~85% white**, not by a thin black border (explicitly discouraged) and not by a washed-out drop shadow.
- Button hierarchy: the more important a button, the darker it is — ghost → black-with-white-text. Most multi-purpose buttons sit around **90–95% white**.
- Text levels (light mode): headings ~11% white, body **15–20%**, subtext **30–40%**. Grey beats black; most secondary text should be dark grey, not black.

**Layer 2 — accent.** Treat the accent as a *scale*, not a colour. Light mode: link **400–500**, main **500–600**, hover **700**. Dark mode: main **300–400**, hover **400–500**.

> Tailwind shortcut from the video: light background → the **50** value as background and the matching **500** as accent; dark mode → **950** background with **300** as primary. ("Zero ways for you to screw that up.")

**Dark mode needs double the distance.** Light-mode neighbours sit ~2% white apart; dark mode wants **4–6%** apart, because dark colours are inherently closer together. Dark mode is also *not* the inverse of light mode: surfaces get **lighter** as they elevate, so raised cards need a lighter colour or a border; text becomes light grey rather than white; borders brighten; the logo desaturates slightly.

**Layer 3 — semantic.** Destructive actions are **red** — "it's pretty much a design sin to make destructive actions anything other than red", even when the brand is purple. Charts need a full spectrum, not the brand ramp, and the spectrum must share perceived brightness: use **OKLCH**, set lightness + chroma, then **increment hue by ~25–30°** per series.

**Layer 4 — theming.** For any neutral, plug the hex into OKLCH, **drop lightness by 0.03 and increase chroma by 0.02**, then move hue to hit a theme (red / green / blue). Kole notes the same trick works "maybe even better" for dark mode.

**Element states are colour states.** Hover = slightly lighter/brighter than base. Active/press = slightly darker (on mobile, a slightly darker grey on press makes it feel like you're pressing into something). Disabled = desaturate, or light grey fill with white text.

### 3.2 Typography — a scale you can compute

From [Mathematically Perfect Typography for Web Design](https://www.youtube.com/watch?v=7sUUzOCv47U).

- **Font count:** 1 is acceptable, **2 is the sweet spot**, 3 is pushing it, 4 is asking for problems. Display/handwritten fonts are **never** for paragraph text ("100% a design sin").
- **Scale:** base **16px**. Golden ratio **1.62** for a header off body, but 1.62 across four heading steps from 16px reaches a **110px** header — too fast. Use **√1.618 = 1.27** for a full style guide; **cube-root the golden ratio** for dashboards/mobile.
- **Fluid sizing without breakpoints:** `size = smallest + (largest − smallest) × (viewport − 320) / (1920 − 320)`, capped with `min()`/`max()` — `max()` adds the lower bound, `min()` adds the upper bound.
- **Line height:** paragraph ≈ **150%**, headings **110–130%**. Smaller text or longer line → more line height.
- **Hierarchy:** text colour sits at either 100% opacity or **40–70%**; avoid ultra-bold and ultra-thin for body text. A heading that's already large needs no extra weight or opacity.
- **Kerning** matters above ~**70–80px** type.

### 3.3 Spacing, grid, radius, elevation

From [The 8 UI/UX Cheat Codes](https://www.youtube.com/watch?v=c1TvOcKdBVE), [Upgrading 9 CRUCIAL UI Elements](https://www.youtube.com/watch?v=gKM6b2EnW1k), [8 Web Design Hacks](https://www.youtube.com/watch?v=Lp6ey4AyDzA), [7 UI/UX mistakes that SCREAM you're a beginner](https://www.youtube.com/watch?v=AH_ugxmLeUM).

- **Base grid 4px or 8px.** In Figma, change the nudge amount from the default 10 to 8. Bigger steps round to the nearest 5 or 10; if you must stay on 8, go exponential (the difference between 120 and 128 doesn't matter).
- **Nested corner radius = outer radius − the distance between the corners.** Outer 30px with a 10px gap → inner 20px. Pills need no correction. In Figma, max out **iOS corner smoothing** to taper the corner.
- **Chip padding: vertical = ½ or ¼ of horizontal** (20px horizontal → 10px or 5px vertical). Chips almost never take the primary CTA colour, and are always thinner vertically.
- **Shadows:** `x ≤ y`; **blur = 1.3–2× the y value**; drop Figma's default 25% opacity to **15–20%** (stronger shadow on darker backgrounds). Don't just lower opacity — change the shadow *colour* (usually light grey) and raise the blur a lot, or remove the shadow entirely.
- **Input fields:** off-white background, stroke at **40% opacity**. Sign-up modals: labels **above** the input so they stay visible while typing, real empty states with examples, and a "Create account" subheading so it can't be mistaken for login.
- **Form modals** stay on a **4px grid** religiously.
- **Footers:** assume **3–5 links**. Logo above, links centred, socials below and centred, copyright left / design credit right. Apple has ~23 links; do not copy that onto a 6-link site.
- **List rows:** space items far enough apart to be legible; if it must be tight, use alternating row backgrounds instead of divider lines.
- **Dark-mode depth without shadows:** layer cards by background colour — from the dark-blue base, bump **brightness +4 to +6** and **saturation −10 to −20** per layer.
- **HSB palette method** (for building a palette without a tool): base colour → next variant = **saturation +20, brightness −10**, repeat; slide hue ~20° toward blue for darker variants (blues/purples read darkest, yellows/reds lightest).

### 3.4 Motion — specific numbers, not vibes

From [11 Micro Animations](https://www.youtube.com/watch?v=ld1zhQMXxXU) and [Why the best software must LIE to you](https://www.youtube.com/watch?v=S8DcTJm8pYM).

- Tooltip delay: **1000ms** of hover before it appears (Obsidian's pattern), with a custom bounce easing.
- Figma smart-animate easing reference: **500ms, stiffness 636, dampening 24**.
- Hover name-tag: a second frame with fill changed to black, text to white, a slight tilt, resting frame at **opacity 0**.
- Card swipe: rotate the dragged card away, opacity → 0%, and the cards behind must **scale up and shift down while you drag** (this is what sells the effect).
- Button hover: masked two-line text slides up; on press the button scales down slightly.
- Shimmer/gradient stroke: angular gradient masked to a stroke outline, rotated — and give it a **pause/play toggle**.
- Progress bar: mask the stroke to a rectangle and slide it along so the line appears drawn.
- Buttons should **almost always have a small animation**; **scrolljacking should be used very sparingly, if ever** ([How to think like a GENIUS UI/UX designer](https://www.youtube.com/watch?v=HE4rLEQpiXY)).
- Give a continuous animation a way to stop. Nobody can pause a shimmer that doesn't stop.

### 3.5 Scannability — the "weirdly perfect" rules

From [The secret behind weirdly perfect UI designs](https://www.youtube.com/watch?v=neE6wOuBIP8) (230k views). This is the single most transferable principle in the channel.

- **The receipt test.** A receipt has *no* centre text except codes; body text is hard-left, prices hard-right, and the only things held together are two edges — no dividers, no whitespace. Most great receipt/checklist UIs do the same.
- **Lock elements to edges.** In compact UIs (chat inputs, Kanban cards, sidebars) every element should touch at least **two edges**. If you move a row onto a wider canvas and it falls apart, the density was doing the work.
- **The problem is never "too much content", it's "too much undifferentiated content."** Density becomes an asset when you differentiate: avatars for people, grouping by due date, icons instead of names, chips to categorise.
- **Showing, not telling.** The instinct when something is unclear is to add a label, a tooltip, a comparison — each adds information but makes the screen *harder to read*. Prefer a recognisable visual (a stop sign needs no label; a diagram beats a paragraph). Exception: a checkbox's placement already tells you what it does.
- **The checkbox rule.** Off = thin border, no colour, no icon (easy to skip). On = fill + checkmark. **Never design a checkbox that's blue when it's off** — the colour *is* the signal. Same trap: six chips all showing "default" state = six blue-off checkboxes.
- **Emphasis is relational.** "Emphasis isn't something an element has, it's the difference between it and its neighbours." To make one thing stand out, change its *surroundings*, not its colour. (In a settings menu, the only blue component should be the one trying to get you to resubscribe.)
- **Nobody reads a screen.** You land with a question and hunt for the answer. Every principle here is about making the hunt faster *without* telling the user where to start.
- **Cards are optional.** You get four edges free with a card, but "nobody actually builds just a card" — dissolve the cards into the interface with a single line: column edges, stacked rows, sections grouping content.

### 3.6 Dashboards: data drives the form

From [The 3 dashboard UI flaws that give away you've NEVER built one](https://www.youtube.com/watch?v=Ksx9C2-3yMo) (191k views) and [EVERYTHING you need to know to build a Dashboard UI](https://www.youtube.com/watch?v=B7k5rOgmOGY).

1. **Let the data pick the shape.** Categorical values with a small set of options → chips. Numbers → **right-aligned**, so digits line up by place value. Long text → truncate to give other columns room. Inactive rows → shade them out. A table whose nature is *time* is the wrong form: use a **timeline** instead, in a sidebar pop-out or a wider second column.
2. **Colour comes from the data, not from the palette.** A red chip because the action is urgent; an avatar because your eye associates a face with an actor faster than a name in a column; a chart to roll up a time-dimension into a summary instead of making you hunt through a timestamp column.
3. **Progressive disclosure.** Secondary actions (share, remove user) live in a popover, not on the table edge. Inside it: the **primary** action (search) is immediately visible at the top; secondary actions appear **on hover** with a tooltip. This is the *spectrum of explicitness* — a global share button sits high, a copy-icon-on-hover sits low. Apple Reminders does the same with swipe.
4. **Onboarding is progressive disclosure too.** One tooltip pointing at the most important action → then a second → then a small corner checklist. You're **sequencing** functionality, not hiding it. Compare with a six-bullet modal on first login.
5. **The invisible UI is not a small amount.** Copy chips on cells, comment triangles, tooltips (universally missing from beginner dashboards), hover/empty/loading/error states. *"UI is as much about what you can see as what you can't see."*
6. **Charts:** straight lines, never curved (a curve makes it impossible to tell where the line's tip is); horizontal gridlines + markers; vertical lines for the time scale; a timeframe switcher (dropdown if space is tight); previous period as a **grey line** with a legend; never stroke-out the most recent point; never show 16 bars for 7 days.

### 3.7 Product thinking: states, flows, and honest software

From [Stop Making Pretty UIs. Think Like a Product Designer](https://www.youtube.com/watch?v=ADaQuZS04Rc), [Why the best software must LIE to you](https://www.youtube.com/watch?v=S8DcTJm8pYM), [How to think like a GENIUS UI/UX designer](https://www.youtube.com/watch?v=HE4rLEQpiXY).

- **Design all the states, not the happy path.** Empty, loading, success, error, and the transitions between them.
- **Think in screens and sequences, not sections.** For each screen: how did the user get here, and what do they need next? Notion's flow is create space → name it → *immediately* offer to add members (with skip). A hiring tool chains three tiny decisions: reach out → pick an email template → confirm whether to add other applicants.
- **Design systems are trust and speed.** A macOS pop-up saves you because the primary colour is always the non-destructive action. In Linear, the same button/spacing/text styles appear in wildly different contexts. A system is a shared language; **you break it with intention, never by accident**.
- **Mechanism design — "lying" well.** Every interaction makes an assumption about what the user meant. Three families: **wait** (they might not have meant it), **infer** (we know), **act first** (they definitely meant it, give them a way back). The key question is whether actions **compete** (single-click opens a detail page vs. double-click edits — needs a delay) or **don't** (single-click highlights a cell — no delay needed).
  - AirPod's pause takes **700ms** vs. under **300ms** from the phone, because the tap must resolve pause / skip-next / skip-previous — three actions at one interaction point, while the phone uses three separate buttons.
  - Linear / Notion / Asana menus draw an **invisible triangle** from cursor to the top and bottom edges of the new menu — position *and speed* decide which item you meant.
  - First tooltip hover waits; adjacent links never wait again.
  - Drag-to-reorder shouldn't be binary: show the guess of where the item will land, with a gradient where closer-to-edge scrolls faster.
  - Destructive actions: delete and offer an **undo toast**, or move to a **"Recently Deleted"** list purged after **30 days** (Gmail). Gmail's send delay is **5 seconds ≈ 7× the AirPod delay** — it shows "sent" before it really sends. Reserve modals for genuinely novel/irreversible acts (emailing 10,000 recipients; sending money).
  - Buttons act on **release**, so every button has a built-in cancel (a camera shutter half-presses to focus). Buttons that open a popover break that rule so press-drag-release works in one motion. `Esc` cancels; ⌘-Tab commits on release.
- **Start with user intent.** "Search" intent → a search bar, augmented with destination / travellers / dates. "Browse" intent → listings + filters. Fonts, colours and icons change aesthetics; they barely change function. Respect existing layout expectations (top-to-bottom, left-to-right, nav on top, CTA easy to find) — that expectation is what makes a design integrable and responsive — then add **one** distinguishing thing.
- **Design around content in two steps:** decide *which* content to display (users scan location, rating and price before descriptions), then *structure* it (truncate long names; put a circle behind an icon on a bright image to guarantee contrast).
- **Prefer "load more" over infinite scroll** — it gives control and lets users reach the footer.

### 3.8 Layout & section rhythm

From [7 Modern UI Layouts from 50 Top Software Companies](https://www.youtube.com/watch?v=VPeTgU7la34), [The Formula Behind Truly Captivating UI Sections](https://www.youtube.com/watch?v=tNMAFjzapOk), [Everything you need to know about Mobile App UI's](https://www.youtube.com/watch?v=Gfsd8NNuD9g), [Redesigning a Finance Dashboard UI from SCRATCH](https://www.youtube.com/watch?v=Yr2uIcFZDDQ).

- **Logo walls:** 41 of 50 software sites had recognisable logos. Simple scatter, or a marquee sliding left-to-right with an edge gradient + progressive blur. Never repeat the logo row on the same page.
- **Hero:** big text, big image, lots of space. Add a subtle gradient or the background goes bland.
- **The "clickable multisection":** design **all** the tabs before handoff, or half the site ships missing.
- **Bento** — the "simple Bento" is what software uses; stay on simple grids so devs don't rip you a new one.
- **Nav:** even a small site looks professional with a mega-dropdown; **put images in nav menus** — people don't read all the copy and images give context.
- **Test yourself:** if you had **5 seconds** to scroll the page, would you understand the idea? Wireframe it with content removed; the easier one wins.
- **Motion should support clarity, not distract** — the boring side image morphing into the next section is good; animation that fires before the product appears is not. And a single well-built hover animation beats a pile of scroll effects.
- **Dashboard grid:** rank widgets into tiers; the highest-priority sits highest and farthest left; fill remaining gaps with a genuinely missing section rather than stretching others; keep card margins consistent across the grid.
- **Mobile:** no expansive sidebar — a floating bottom bar with **5 links maximum, 3–4 ideal**, **44px** targets, the primary action broken out. One direction per section (vertical stack *or* horizontal off-page, never both). **One screen, one job.** Don't nest cards inside cards. Bottom sheets for context-preserving pickers. Swipe right to go back (background shifts ~35% and animates back); bottom sheet up zooms the background out; long-press = right-click.
- **Footer:** 3–5 links (see above).

---

### 3.9 The fundamentals (the 571k-view primer)

From [Every UI/UX Concept Explained in Under 10 Minutes](https://www.youtube.com/watch?v=EcbgbKtOELY) — the channel's most-viewed video, and the shortest path to the whole system in ten minutes.

**Signifiers, not instructions.** A container around "drinks" and "food" says *these are related*; a container around only "drinks" says *this one is selected*; greyed-out text says *inactive, clicking probably won't do anything*. Nobody has to write instructions, because the UI is signifying. Signifiers are button press states, active nav highlights, hover states and tooltips.

**Hierarchy = size + position + colour.** The most important thing goes **large, bold, and at the top**. The price goes **top-right and blue** — different from everything else, so the eye goes there. The location goes **smaller and below**. Use **icons and alignment instead of words**: a from/to pair needs no "from"/"to" labels. And it's not exact science — the *principles* (important near the top, bigger and more colourful = more important, use images whenever possible) are what transfer.

**The 12-column grid is a guideline, not a law.** It's useful for structured, repeating content (galleries, blogs) because it gives you responsive behaviour — 8 columns on tablet, 4 on mobile. But "much more important than using excessive grids and layouts is **white space**, letting things breathe."

**Spacing recipe for a simple section:** large text and subtext with their own font size + line height, buttons below, an optional announcement bar on top, then **32 pixels between every item**. Group what goes together (announcement + heading, heading + subtext) — that grouping is itself hierarchy. The four-point grid isn't about looking better, it's that **you can always split things in half**, which creates consistency.

**Typography, simply:** you'll almost never need more than **one font** — find a good sans-serif and stick to it; don't spend your time here. For large text, tighten **letter spacing by −2% to −3%** and drop **line height to 110–120%** — it instantly makes large type look professional. For landing pages, **no more than six font sizes**; for dashboards, nothing above **24px** because of the density.

**Colour:** start with **one primary** (your brand colour), lighten it for backgrounds, darken it for text — you're already halfway to a **colour ramp**, which is what large companies use to build chips, states and charts. Then let the colour find you: **blue = trust, red = danger/urgency, yellow = warning, green = success.** Use colour for purpose, not decoration.

**Dark mode:** light borders create too much contrast — lower them. There are no shadows in dark mode, so depth comes from a **card lighter than the background**. Dim the chip's saturation and brightness and flip it for the text to build hierarchy. And there's more room than you think for deep purples, reds and greens — not just navy and grey.

**Shadows:** most are too strong — **reduce opacity and dial up the blur**. The strength depends on foreground and background: **cards need less, popovers need more** (content that sits *above* other content). Inner + outer shadows make raised, tactile buttons. The rule: **if the shadow is the first thing you notice, you're not using it right.**

**Icons:** most are too large — set the icon to the **font's line height** (24px in his example) and tighten the text. Sidebar links are **ghost buttons** (no background until hover); isolate one and centre it and you have a perfect standalone button. **Button padding: double the height for the width.**

**States — the single most-skipped thing:** *"When a user does anything, there should be a response."* Every button needs at least **four states: default, hover, active/pressed, disabled** — plus a loading state with a spinner when needed. Inputs need **focus**, **error** (red border + message) and sometimes **warning** states. Then loading spinners while data fetches, success messages when an action completes, micro-animations on scroll and swipe. Every interaction needs a response.

**Micro-interactions confirm.** A copy button with hover and click states still doesn't tell you *anything was copied* — a chip that slides up does. Micro-interactions are feedback, one notch higher.

**Overlays must not ruin the image or the text.** A flat full-screen overlay kills the photo — instead use a **linear gradient** that lets the image show and smoothly converge into a text-readable background, or add a **progressive blur** on top of the gradient for a more modern look.

---

## 4. The AI workflow — how to actually get good output

This is the operational answer to your question. It combines what Kole demonstrates in [Vibe Coding a Pro UI in SECONDS With AI](https://www.youtube.com/watch?v=xHD01_Onac0), [The one thing vibe coding CAN'T fix](https://www.youtube.com/watch?v=RCneB_MQ7qs), [5 SaaS UI/UX mistakes that SCREAM you Vibe Code](https://www.youtube.com/watch?v=PDcQJOPby1k), and the supporting videos.

### Stage 0 — Write the opinion before you prompt (5 minutes)

Produce a one-page brief answering Kole's four questions, plus:

- **User intent** for each screen (search? browse? act?).
- **What you are deliberately leaving out** — this is the part AI cannot invent. AI adds features; you subtract them.
- **Visual identity**: 1 moody hero image, 3–5 earthy tones pulled *from that image*, 2–3 accent colours, 1 serif/display pairing, a texture (noise / graph paper), and how the logo mark behaves.
- **Motion identity**: pick **two recurring motion themes** and repeat them throughout (Kole's example: a pull-away as you scroll past a section, and gradient transitions between sections). Animation is almost always an afterthought otherwise.

> **Rule:** if you can't write this page, the AI will write it for you — and it will write the average of the internet.

### Stage 1 — Feed it real reference, not vague adjectives

- **Mobbin MCP** — 600,000+ real screens pluggable directly into your AI tooling. (Kole shows a before/after sidebar built with it vs. without.)
- **Relume MCP** — 1,000+ designer-built components; describe "a hero for a restaurant SaaS" and it pulls matching blocks, saving tokens and avoiding generic AI patterns.
- **21st.dev** — a library of UI components built with/for AI: copy the plain code *or copy the prompt* straight into your tool.
- **siteinspire.com** for realistic site references, and real products (Linear) over Dribbble.

> **Important, from the video:** Claude (and vision models generally) **cannot read dense Dribbble layouts** — it misses the small details and quietly omits them. Feed it a clean, realistic reference instead. Upload a *self-made* reference if you want a specific result.

### Stage 2 — Generate with a structured prompt

Kole's prompt anatomy, from the video:

1. **State plainly that you want a design** ("occasionally it won't recognise that's what you want").
2. **Specify the purpose and intended use** — e.g. "a project-management dashboard UI to let users track ongoing projects and see tasks".
3. **List the specific elements** — "a sidebar with icons and a Gantt chart with colourful bars" — even though the model often infers them, stating them is free accuracy.
4. **Specify an icon library** — Phosphor, Lucide, Feather. Otherwise you get emojis, and emoji is tell #1 of a vibe-coded UI.
5. Ask for **HTML + CSS** if you intend to import into Figma later (code format otherwise blocks the import).

### Stage 3 — Import to Figma and do the human pass

Download the HTML, then Figma → **html to design** plugin → **File** tab → drag the file in → keep all defaults **except turn hover effects on**. You get a fully editable, functional Figma file (no glitchy image-of-a-website import).

Then the human pass — Kole's actual fixes, in order:

| Fix | What to change |
|---|---|
| Fonts | Swap the model's default for a considered pairing |
| Alignment | Line up the menu items, the card grid, the icon column |
| Colour | Push purples toward blue; make backgrounds darker and more purple-grey than blue-grey; fix contrast on chips |
| Layout | Raise the low-hanging line; put the user's name + icon + "switch account" chevron at the top of the account menu; move settings & help to the bottom; drop "menu"/"other" labels |
| States | If "completed" is a colour, make the *uncompleted* state clearly different — not the same colour for both; replace a label like "in progress" with an actual percentage |
| Detail | Add a subtle grid pattern; add icons where a plain chip is ambiguous |

**Note the division of labour:** small alignment and typography tweaks are *better left in Figma*, not in the prompt. Keep the model out of the detail work.

### Stage 4 — Fix the tells (the [5 SaaS mistakes](https://www.youtube.com/watch?v=PDcQJOPby1k) pass)

Run this checklist over whatever the AI produced:

1. **Kill the emojis** → a real icon library.
2. **Never let AI choose the colours** → it always picks bright colours that clash. Replace with your ramp.
3. **Never let AI choose the layout** → align the sidebar left, tighten the spacing, remove the "gradient profile circle with initials" for an account card.
4. **De-duplicate** — the same KPI row appearing three times in a small app is a dead giveaway.
5. **Collapse the busy bits** — secondary buttons → a `⋯` menu; chips → icons; keep the primary action.
6. **Replace the sparse flyout** with a modal when there's room to do real work; collapse "advanced" options by default.
7. **Pricing:** fewer plans; name + short description; **state the price plainly** ("$20 a month"); show the actual discount; show what the *next* plan adds that this one doesn't; and make the CTA actionable.
8. **Analytics:** don't repeat the same KPIs; add the cheap high-value features (a toggle to split into individual items, a map with shaded regions instead of a bar chart).
9. **Landing pages need graphics** — even skewed link cards beat another icon row. Landing pages aren't about complexity, they're about **presentation**, and presentation converts.

### Stage 5 — Ship it into real code without losing the system

- **Builder.io** — import Figma designs directly, or drop in a screenshot; a visual editor writes back into your codebase and respects your existing design system.
- Whatever you use: **the tokens in §3 are the contract.** Hand the AI the token file; never let it pick a hex code.

### Stage 6 — Review with a second opinion (and a red-team prompt)

The single best use of AI here is as an adversarial reviewer, because the failures are systematic and easy to check for. See the prompt in §5.

---

## 5. Prompt library (paste-ready)

### 5.1 The design-spec prompt (before generating anything)

```text
You are designing <PRODUCT> for <USER>. Do not start styling yet.

User intent for this screen: <search / browse / act>
The user arrives here from: <entry point> and needs next: <next step>
Deliberately excluded: <what is NOT on this screen>

Visual identity (do not deviate):
- moody hero image, cropped/darkened with noise overlay
- palette pulled from the image: <hexes>
- accents: <hexes>
- type pairing: <display/serif> for headings, <sans> for UI
- texture: <noise / graph paper>
- motion identity: two repeated themes only — <theme A>, <theme B>

Requirements:
- Use the <Phosphor|Lucide> icon library. No emojis, ever.
- 4px base grid; spacing in multiples of 4
- 4 neutral background layers, 1 stroke, 3 text variants
- accent scale: link 400 / main 500 / hover 700
- destructive actions are red, never the brand colour
- every control needs hover, active, disabled and focus states
- design the empty, loading, success and error states too

Output: HTML + CSS, semantic, with tokens as CSS custom properties.
```

### 5.2 The "make it feel designed" pass (identity, not code)

```text
Using the wireframe below, add visual identity only — do not change the layout or copy.
1. Background: one moody image, darkened, with a noise overlay.
2. Palette: pull 3–5 tones from that image; use 2 accents.
3. Type: swap the body face for a considered sans; use the serif/display for headings only.
4. Depth: darken the page edges so the centre reads first.
5. Scatter context elements (icons, amounts, chips) around the central message — they
   should trail off toward the edges, never crowd the text.
6. Motion: implement exactly two repeated themes across the page.
```

### 5.3 The red-team review prompt (use on every AI-built UI)

```text
Review this UI as a designer who has shipped products, not a designer's portfolio.
For each item, say what is wrong and give the specific fix:

1. AI tells: emojis, gradient avatars with initials, the same KPI row repeated,
   charts with curved lines, unlabelled axes, cards that do nothing when clicked.
2. Hierarchy: is there exactly one primary action per section? Are there more than
   two font weights and more than two text colours?
3. Colour: are destructive actions red? Does dark mode double the spacing between
   surface levels? Does the accent behave as a scale (400/500/700)?
4. Grid: is spacing on the 4px/8px grid? Are nested radii correct
   (inner = outer − gap)? Do chips have vertical padding of ¼–½ their horizontal?
5. Scannability: does every element lock to two edges? Is anything plain text that
   should be an icon or chip? Is anything labelled that should be recognised?
6. States: are empty / loading / error / success / disabled all designed?
   Are hover and pressed states defined? Is there a tooltip on every ambiguous icon?
7. Motion: does every animation have a purpose? Can a continuous animation be paused?
8. Product: does each screen do exactly one thing? Can the user get from any screen
   to the next without going back to the sidebar?
9. Content: are long names truncated? Is contrast guaranteed on bright images?
   Does the copy use plain language rather than corporate filler?
```

### 5.4 The token generator (hand this to the AI instead of letting it choose)

```text
Generate a complete design token set from this brand colour: <hex>.
Follow these rules exactly:
- Neutrals: 4 background layers + 1 stroke + 3 text variants, generated in OKLCH
  (lightness −0.03 and chroma +0.02 per step).
- Accent scale: 50 … 950; main = 500, hover = 700, link = 400.
- Dark mode: the same roles, but surface levels are 4–6% apart, not 2%, and
  surfaces get LIGHTER as they elevate.
- Semantic: destructive = red, independent of the brand colour.
- Chart spectrum: 8 series sharing perceived lightness, hue incremented 25–30°
  per series.
- Type scale: base 16px, ratio 1.27 (√1.618); headings 110–130% line height,
  body 150%.
- Spacing: 4px base, named steps 4/8/12/16/24/32/48.
- Radius: 10px for small components; nested = outer − gap.
- Shadow: x ≤ y, blur = 1.3–2× y, opacity 15–20%.
Output as CSS custom properties AND as a Tailwind-compatible scale.
```

---

## 6. The 28-day skill plan (adapted for AI-assisted work)

From [The stupid simple way to learn UI/UX design in exactly 10 minutes](https://www.youtube.com/watch?v=9WVt1CelBfg). Kole's biggest warning: **the biggest mistake a beginner makes is starting their portfolio now** — taste changes over the next one to two months.

| Week | Focus | Concrete output (with AI) |
|---|---|---|
| 1 | **Train the eye** | Build a swipe file of ~20 hero/feature sections. Annotate two for spacing, hierarchy and grouping. AI can annotate for you, but *you* must write the annotation |
| 2 | **Build the skill** | Clone the hero section of a site you love, exactly, measuring details; then its feature section; then a second site with a totally different layout. Use AI to speed up the clone, never to set the spacing |
| 3 | **Think like a designer** | Restyle one layout you've built twice — once warm/friendly, once modern/premium. Then design the two screens where an onboarding journey splits |
| 4 | **Ship with AI** | Take one of your builds, run the full Stage 0–6 pipeline from §4, and write up the before/after |

The grouping rules he teaches, worth memorising because they're how humans read: **subtext 8px** from the heading, **eyebrow 12px**, **buttons 32px** — proximity encodes grouping. Copy limits: **7 words** in a header, **14** below. Hierarchy via colour, not just size: two stats at the same **15px**, the second at **55% opacity**.

---

## 7. Tools and free resources

**Free Figma kits (26 of them, one per video)** — [kolejain.com/resources](https://kolejain.com/resources). Each entry links the matching video, a Figma file and a downloadable `.fig`. The most directly useful for AI work: *Vibe Coded SaaS*, *Vibe Coding Tells*, *Every UI Concept*, *Dashboard UI*, *Dashboard Flaws*, *Software colors*, *UI Elements*.

**MCP servers (the AI-native part of the channel):**

- **Mobbin MCP** — 600,000+ real screens; the one Kole credits with visibly better AI output.
- **Relume MCP** — 1,000+ designer components; plus Relume Publish, which turns a brief into a sitemap → wireframe → live site.

**Reference libraries:** [21st.dev](https://21st.dev) (copy code *or* the prompt), siteinspire.com, Coolors / UI Colors / oklch.com for palettes, Feather / Phosphor / Lucide for icons.

---

## 8. The landing-page maturity ladder

From [The 4 Levels of Landing Page UI/UX Design](https://www.youtube.com/watch?v=eMMiLeo_UGI). This is the most diagnostic tool in the channel: it names **four levels** with the defects, the fixes and — crucially — what each level is worth.

| | Level 1 — template | Level 2 — identity | Level 3 — cohesive | Level 4 — crafted |
|---|---|---|---|---|
| **Price** | ~$500 | ~$2,000 | ~$6,000–10,000 | >$10,000 |
| **Score** | 2/10 | 6/10 | 8/10 | 10/10 |
| **Layout** | Alternating text-left / image-right all the way down | Stacked hero, page breathes | Vertical rules framing content the **full length of the page**; Bento grid; multi-select | Content **moulded** into flexible shapes; fewer straight lines |
| **Imagery** | Unrelated stock photos | The **actual product** | Zoomed into the parts that matter | Crafted, not zoomed — placed, not captured |
| **Nav** | Flat; every item identical; heavy right-weight | Hierarchy: primary buttons get an outline, the rest centred | Mega menu — signals depth | Menu **stays open** and bumps content left/right instead of popping |
| **Colour** | Blue sprayed on anything clickable | Colour pops from the product itself | Threaded back through, but can *fall* as charts get zoomed away | Expertly threaded, plus a blur |
| **Copy** | Vague and far too long; repeats the company name next to the logo | Shorter, punchier, better subtext | Short and punchier — but hierarchy *overdone*, headline kills the sub-line | Shifts from **what it does** → **how it helps** ("analytics" → "turn data into decisions") |
| **Animation** | None (maybe a hover) | Simple load animations | Smoother; dashboard hovers; fluid slider | Blur, hover-revealed CTAs, menus that shift instead of pop |

**Level-1 tells** (check these first on any AI-built page): the same text-left/image-right pair repeated; stock photos unrelated to the product; **sharp-cornered images next to rounded-corner buttons** (never mix the two); copy so long nobody reads it; the company name repeated in body copy right next to the logo; flat nav with no hierarchy toward "Sign up"; nav weighted to the right.

**Two rules that generalise beyond landing pages:**
- **All CTAs that go to the same place must carry the same label.** Level 1 had a "Sign up" top-left and a differently-worded CTA in the hero; level 2 relabelled them so both imply the same destination.
- **Variety beats consistency of pattern.** Repeating one layout down the page is *the* template tell.

---

## 9. Redesign teardowns — the transferable rules

Four full rebuilds of real products, each a goldmine of rules you can apply to your own UI.

### 9.1 Google/Gemini landing page ([pGYLZyBE32o](https://www.youtube.com/watch?v=pGYLZyBE32o))

- **A type-in search in the hero is a stronger CTA than a button** — "the user is already engaged in an action and is more likely to see it through." (Borrowed from OpenAI.)
- **Put the product's live state in the hero.** The chatbot's loading animation was integrated into the bottom of the header "so it looks like the AI is actually thinking."
- **If brand colours fight the design, isolate the logo on a white background** rather than recolouring the logo.
- **Stuck on dark-mode colour? Set the background to a gradient of two brand colours** (baby blue + pink from the real Gemini site) and slide both down to darken them. Noise is optional — don't let it "end up looking like TV static."
- **Don't build a section title if the cards already have headers.**
- **Hover can carry a card's extra content:** blur the image, scale it up, reveal additional text — instead of a modal or popup.
- **Show the rare tier as a small button on all plans.** The Gemini Enterprise block wasn't useful for ~98% of people, so it became a tiny button rather than its own section.
- **Never ship two landing pages selling the same product** — consolidate and keep **three key points** (cost, better model, upload capability).
- **A section can extend off the page edge** to break the grid.
- **Iterate the CTA layout explicitly** — he went through four-to-five before landing on: prompts moved to the side + a gradient on them.
- He wrote one card's descriptions **by hand** — "never write marketing copy with AI assistance if the point is craft."
- He also notes the finished page was **not mobile optimised** — a reminder that desktop-first AI output often is.

### 9.2 Spotify Wrapped ([goWOAFqJHpA](https://www.youtube.com/watch?v=goWOAFqJHpA))

- **Don't remove features your users know.** 2025 dropped audio auras, city-taste and even top genres, replacing them with hyper-specific AI labels ("mul goth Rocco, metal core") — *"what is that."*
- **Scroll, don't click.** Clicking slide-by-slide is "pretty much the worst possible" for glancing at stats; Reddit's recap scrolls instead.
- **Put the primary action at the bottom** where the thumb is (share button bottom-right), and **pause playback automatically when it's tapped**.
- **Offer both a reel and a dashboard** of the same data — each chapter gets its own screen plus a "view summary" button.
- **Let users jump to a chapter** via a dropdown **at the bottom of the screen**.
- **Compare against last year** — 2,200 minutes vs 1,000 = "120% increase from last year"; a brand-new artist = "you two just met in April."
- **One share button with a scope chooser** (slide / chapter / everything) beats two share buttons; and shared content must show **whose it is**.
- **Use plain universal metaphors over invented taxonomies** (a fruit-pie chart over "mul goth Rocco") — and let users **swipe through every month**, or don't show months at all.

### 9.3 A failing EV startup's site ([V3Omp1hm0Sg](https://www.youtube.com/watch?v=V3Omp1hm0Sg), the Fisker teardown)

- **If a homepage exists only to redirect, delete it.** Fisker had one car in production, so the homepage was dropped and the page went straight to the car's perks.
- **Whitespace + giant type = disjointed.** Hierarchy comes from *proximity* — push elements closer so nothing floats alone.
- **When text overlaps a focal point, subtract the subject's shape** — he traced the top of the car in Figma and positioned the text *behind* it.
- **Choose zoomed-out imagery** so overlay bars don't collide with the subject.
- **Introduce a saturated accent colour only on hover** ("so it's not overpowering"), paired with the image zooming out.
- **Never repeat the same section layout twice in a row.**
- **Build a gradient into an image without AI:** duplicate it, flip it vertically, crop it down.
- **A CTA can be a search bar** — the final CTA was "find a dealer," not a button.

### 9.4 A skincare Dribbble design ([BvbFPzLjWcU](https://www.youtube.com/watch?v=BvbFPzLjWcU))

The most transferable lesson in the batch is a reality check:

> **Design to a real viewport: 1920px wide, but only ~1,000px of visible height with the browser bar.** Dribbble-style artboards assume a screen ~50% larger than reality — squish your design down to fit.

Other rules: delete nav items that don't belong (social links in the nav, a written testimonial in the header); fold favourites/notifications into a menu, turn the cart into an icon, profile → "Sign in"; **add a search bar "regardless of if it's really needed"** because it balances the header; if you can't show every product, make them a **slider** with a "new arrivals" chip; fix a too-bright photo with **a subtle overlay** rather than hunting for a better one; reuse one typeface across logo, packaging and body; and treat corner radius as a deliberate decision, not a default.

### 9.5 macOS apps, done like Apple ([Vy0KKvZJRH8](https://www.youtube.com/watch?v=Vy0KKvZJRH8))

- **An app should be a system element where the user already is, not a destination.** A quicksave palette on a keyboard shortcut (⌘⇧), no traffic lights, a drop area, keyboard-shortcut reminders. Enter collapses it into a toast that slides away; Escape dismisses it.
- **Optimistic UI:** assume success, confirm afterwards (Mail moves mail to trash before the server deletes it).
- **Reserve the top ~50px for window dragging**; put global actions below it, and **integrate the traffic-light buttons into the top bar or sidebar** as ordinary elements.
- **Dark mode is not the inverse of light mode** — compress the colours toward each other so dark mode is its own palette: "different but consistent."
- **Progressive disclosure:** a clear empty state, filters hidden until they're useful, data shown only on click. The question: *"What is the minimum UI needed to really let that content shine?"*
- **If you don't see a change, the user assumes something went wrong** — every shortcut needs a visible state change.
- **Support drag-and-drop in and out, anywhere.** (He described the Figma design to an AI dev tool — JetBrains' Matter — which built a live preview; the generated front-end code dropped straight into his native framework.)
- **Don't copy a landing page's component set into an app** — landing pages hold pre-generated content, apps hold user content.

### 9.6 The animated dashboard sidebar ([NtZeYmTMuo4](https://www.youtube.com/watch?v=NtZeYmTMuo4))

- **Use a very light grey for drop shadows on near-white surfaces — never transparent black.**
- Keep the palette **pure white or near-white** with a **very subtle outline** instead of heavy borders.
- **Animate hover reveals by a couple of pixels of offset** — that reads as a slide-up, where a pure fade reads as cheap.
- **Keep layer names stable across states** so Figma interpolates instead of cross-fading (a rectangle can literally *become* the search bar).
- **Give every icon-only control a hover label.**
- Loading state shows real progress: rotate a glyph **180°** per frame, trigger on a **300ms delay**, with one custom spring — **stiffness 550, damping 40** — for the whole flow.
- Success is a **state change**, not a text swap: the focus stroke changes from yellow to black, a check mark slides in **under a mask** (a rectangle of the exact same size and radius as the square, grouped as a mask).

---

## 10. Interaction craft

### 10.1 Swipes ([14h1VnkQvIc](https://www.youtube.com/watch?v=14h1VnkQvIc))

Three categories: **within a page** (card decks), **between pages**, and **gestures**.

- **Never use a linear ease.** Open the curve up so the cards carry momentum — the curve sets tone (snappy / springy / slow).
- **Make the motion follow the gesture's direction.** On swipe-up, the card underneath expands to full screen *while* the black tab expands, then content fades up and in, then an **elastic snap** settles it.
- **Animate the shared element so it *becomes* the next screen** (an image zooming into the new hero) instead of sliding a new page in.
- Skewing cards off the screen edge creates the illusion of a **3D ring** of cards.
- On overlays, the **background zooms out and moves down** — and reverses exactly on dismiss.
- **Every swipe gesture needs a visible button fallback**, and **slide-to-confirm** for irreversible actions (email resend, buying crypto) because "it's just much easier to accidentally click a button."

### 10.2 TikTok's UX ([ixUq4HM4FNg](https://www.youtube.com/watch?v=ixUq4HM4FNg))

- **Make the primary action's target huge and the thumb travel ~zero** (Hicks' Law). TikTok "literally couldn't have made it any easier."
- **Ship fewer options, then fewer still** — remove choice rather than adding a picker. Swipe up is the only interaction, "requires zero decision-making."
- **Weight early recommendations toward behaviour over stated preference:** only **30–50%** of the first 1,000 videos come from onboarding inputs. "Our job is to figure out what they're going to want before they do."
- **Every action needs an immediate visible response.**
- Put secondary controls on the **right** (70–80% of people are right-handed); keep primary nav in the bottom thumb zone.
- Pair consumption with a low-friction creation tool (CapCut) — users becoming creators makes the tool better, which makes creators.

### 10.3 Gamification ([jSxxAFxjxbU](https://www.youtube.com/watch?v=jSxxAFxjxbU))

- **One central currency + one premium currency.** XP can't be bought; Gems buy modifiers (extra time, more hearts). Losing a heart is the punishment.
- **Tie rewards to real user goals** or nobody cares — completing a savings goal earns bits *sized to the goal*.
- **Show both completed and remaining work explicitly** (the Exercism pattern: exactly how much is done, how much is left).
- **Segment the leaderboard locally** ("to account for currency and income differences") — a global leaderboard punishes users for their income.
- **Milestone achievements come with a gift**, not just a badge.
- **Protect the streak by defining a minimal daily action.**
- Honest build note: 4 screens took **3 whole days**, when he'd expected 4–6 hours.

### 10.4 Hostile UI ([BUDipdbKK7Y](https://www.youtube.com/watch?v=BUDipdbKK7Y))

A deliberately obnoxious redesign (Figma forcing you to rename every layer; Gmail unavailable outside Chrome behind a one-minute ad; an Uber chatty-rating popup) — and the one rule it teaches:

> **Any nagging, opt-in or punishing feature must expose a visible, easy off switch — and say where it is.** Never ship a blocking modal with no escape. Reserve friction for genuinely irreversible actions.

He also refuses to add a "change the goal" button to a guilt-tripping fitness popup, on the grounds that it would move it from passive-aggressive to aggressive.

### 10.5 Five animations to steal ([ZsP20PN14O0](https://www.youtube.com/watch?v=ZsP20PN14O0))

1. **Entrance/preloader** — the content *beneath* the loader moves too, and the background media moves slightly. Keep preloaders short; people are impatient.
2. **Hover/click** — a container masks the content; the text slides up while a circle scales to **2** and its radius reduces to become a rectangle (Linear's pattern).
3. **Highlight on scroll** — a two-colour gradient nearly stacked, the **text used as a mask**, and a rectangle animated across by scroll position; lines can move together or staggered.
4. **Looped** — an icon travels a semicircle, drawing the line behind it. **Keep looped motion slow enough to read.**
5. **Mouse** — the CTA comes to the cursor. **Ship a non-pointer fallback** for tablet and mobile.

---

## 11. Motion technique — buildable

### 11.1 The load animations, spec'd ([nl8OFGdx75w](https://www.youtube.com/watch?v=nl8OFGdx75w), [d4MF6pdAZNw](https://www.youtube.com/watch?v=d4MF6pdAZNw))

Three effects, prototyped in Figma then rebuilt in code with GSAP, with the timing reproduced 1:1.

**Loading screen** — Figma: delay **1,000ms**, duration **800ms**, custom bezier. Code: `gsap.timeline({ paused: true })`, logo fades in after a **1-second delay**, then the overlay slides up with `yPercent: -100, duration: 1.3, ease: "expo.inOut"` while the header rises **concurrently** (GSAP's `"<"` position parameter) — the default is sequential.

**Expanding navbar** — Figma: delay **800ms** instant, then **300ms** ease-in-out, then **400ms** on a hand-pulled exponential bezier, then **200ms** per element. Code: `gsap.getProperty(".nav-container", "height")` returns **27px** (his hardest problem) — the container animates `maxWidth: 0 → navHeight` (a circle) then `maxWidth: 0 → 500`; the three link groups fade in with `stagger: 0.2, duration: 0.6`.

**Text wipe** — Figma: delay **800ms**, then **700ms** on a custom bezier, twice. Code: a `.text-wipe` div at `position: absolute; width: 100%; height: 80%; top: 10%`, animating `width: "100%"` with `expo.inOut` while the big text fades in at the `"<"` marker; then re-anchor with `right: 0, left: "auto"` and wipe back out.

**The rules that generalise:**
- **One paused timeline per animation, `.play()` at the end** — timing stays editable in one place.
- **`expo.inOut` in GSAP is the code twin of a hand-pulled Figma bezier.** Use one easing vocabulary across design and code.
- **Drive layout-derived values with `gsap.getProperty`, not hard-coded** — but write the CSS end-state back to **0** first, or the `fromTo` fights it.
- **`yPercent` / `maxWidth` / `width`** keep things resolution-independent; percentage `y` is relative to the element, not the viewport.
- **Every frame changes exactly one property** (opacity, position, size) — otherwise Smart Animate can't morph it.
- **1ms delays** between chained animations so they fire in the same tick; reserve **800–1,000ms** for the initial beat before motion starts.
- A text wipe needs **no mask** — a coloured rectangle travels across and the text's opacity flips as it passes.

### 11.2 Figma effects ([MZSm6MA8bww](https://www.youtube.com/watch?v=MZSm6MA8bww))

- **Kaleidoscope** (cards, stickers, buttons): a circle with a radial gradient, plus an **angular gradient alternating black and white an even number of times** (8, 10 or 6), blend mode **Difference**; duplicate it, set the duplicate to **Screen**, and **stack it above everything** or it doesn't work.
- **Clay**: a **desaturated** rectangle (saturated colours kill the effect) + an inner shadow on the top/right edges + a second inner shadow on the bottom/left. That's the whole effect.
- **Metallic**: a linear gradient of mostly greys and dark blues with a **noticeable colour change in the middle**, a white radial gradient at **Overlay** for thickness, then two inner shadows. A 20%-opacity layer of the target colour gives rose gold / bronze / titanium.
- **Mesh gradient, no plugin**: blurred transparent ellipses with **Overlay** — **8 to 10 layers** is a normal budget. "More of an art than a science."

### 11.3 3D without code ([A_Ozpb0XDuw](https://www.youtube.com/watch?v=A_Ozpb0XDuw))

The pipeline: **logo in Figma → export SVG → import into a 3D tool → extrude → camera/lights/effects → export → assemble in a no-code builder.** Spline's UI "looks a lot like Figma" but **it only exports on paid plans**, so the free route is **Blender** (better materials, the metallic look). Budget hours, not days — "a couple of hours" for both assets. The hard asset is the 3D, not the page.

---

## 12. Presenting the work, and landing the client

Design that never ships is a design that doesn't count. These videos cover the part most AI tutorials skip.

### 12.1 Presenting UIs ([7cTdCu8HMgM](https://www.youtube.com/watch?v=7cTdCu8HMgM))

- **Showcase vs. professional mode.** Showcase (portfolio, social) is about impact; **professional mode (client meeting) is about building confidence** — present in a clear, realistic context so the client understands the product they'll receive. Use mock-ups; even a simple computer frame does a lot.
- **Light-mode presentation background:** take the accent colour, **darken and desaturate it to grey** so it doesn't out-pop the design, plus a faint shadow. **Dark mode:** large **blurred circles of the accent colour** behind the UI so it looks emissive.
- **Skew lightly** — his values were **2° vertical and −14° horizontal** ("don't skew too much, just enough to get the effect") — then offset and add a shadow to pop the UI out.
- **Never grid-align a multi-screen collage.** Offset them, rotate a few degrees, and pop the most important frame out.
- **Show dashboards zoomed into a section**, not full-frame — dashboard detail is too fine to see.
- **Use AI for mock-ups, not for UI.** His ~30-word prompt for a product shot: *"MacBook Air, green screen on screen on an orange faux leather padded chair, notebook and stool in background, background blurred, soft shadows, moody lighting, natural, lived in."* Then punch out the green and skew the design in — **2 minutes** to a custom mock-up.
- **"Don't describe, show"** — prototype the hidden interactions (a swipe action, how a modal animates in, the delete-confirm sequence). Static images can't communicate that polish.

### 12.2 Portfolio ([ToJiXPTNnLY](https://www.youtube.com/watch?v=ToJiXPTNnLY), [59XWYgN00nQ](https://www.youtube.com/watch?v=59XWYgN00nQ))

- **2–3 pages maximum** (home + contact, or a single page with anchor links). A head shot **above the fold** — a video of yourself works too. **Name and what you do in the first line**, no fluff.
- **Large, full-width imagery; text is secondary to the work.** A visual (image or GIF) roughly **every couple of paragraphs** — the case study should be understandable from the images alone.
- **End with what you learned and what you'd improve.**
- **Be genuinely human on the About page** — being forthcoming (the layoff, the trips, the illness) is what makes you memorable.
- **No clients yet? Build fake-but-realistic projects:** take a prompt from **Good Brief** or **Sharpen Design** → pick a **niche** ("by not having one and making websites for everyone, you target no one") → write a full brief in ChatGPT → inspiration from Dribbble/Pinterest → design it realistically → **absolutely no lorem ipsum**.
- **2–3 case studies is enough** (3–4 if you're only showing finished interfaces). A personal site reads more professional; a **Notion site** is the quick, personal alternative to Dribbble/Behance.

### 12.3 Case studies ([t7mpEDXzjCg](https://www.youtube.com/watch?v=t7mpEDXzjCg))

Eight steps: **problem + solution snapshot up front** (so nobody scrolls to the bottom to find it) → make it look good (presentation matters as much as content; title every graph, add axis titles, legends, annotations) → **personas from data** (goals and frustrations; skip photos and names) → **user flows** (mock in FigJam, colour-coded: orange = decision, blue = process, green = input/output, and keep them small) → **low-fi wireframes** (don't skip — they let you test assumptions before committing) → **final design + problems solved** (show images large, don't squish them) → **reflection** (brief) → **style** (tell it as a story, keep it readable in one sitting, **10–15 minutes**, skimmable chapter-style titles).

### 12.4 Landing clients ([5JxUJ1fuyO8](https://www.youtube.com/watch?v=5JxUJ1fuyO8))

- **Sell the result, not the website.** "Need a website" is the surface problem; business owners need **more customers**. Reframe: *"crazy amount of products and difficulty navigating, presumably leading to a drop in sales"* → *"a refined search system + recategorised products."*
- **Niche down** by client type *or* by problem type.
- **Add semi-related services:** SEO, CRO, social content, email, paid ads, a retainer. For a site already getting millions of visitors, **CRO beats SEO** — a marginal gain at that scale is worth paying extra for.
- **Present as:** services provided → problem defined → solution **with numerical evidence**. Numbers are the single best sales pitch.
- **Get analytics access** (admin or view-only) so you can show before/after; pre-launch UX tests have too small a sample size to be significant.
- **UX over UI** — clients say they care about UI; results come from UX.

### 12.5 Pricing ([2rtsoM2Dqrs](https://www.youtube.com/watch?v=2rtsoM2Dqrs))

- **Hourly** (misaligned incentives): US designer average ≈ **$50/hr**, India ≈ **$12/hr**. Charge **$20–30/hr** with 1–2 years' experience → **$35–50** after a few clients → **$60–100** after a year+.
- **Project pricing:** break-even = estimated time × your rate (including meetings and revisions), then **gross up ×1–2** depending on how interesting the project is. Example: $4,000 × 1.5 = **$6,000**.
- **Value-based ("the Holy Grail"):** take **5–10%** of the client's added profit. A client doing $2M/yr whose redesign adds 10% ($200K) → **$10,000–20,000**. Only for revenue-generating clients.

### 12.6 Six things to hear ([6CC8lLnqa28](https://www.youtube.com/watch?v=6CC8lLnqa28))

Your first designs are bad — that's expected; design is iterative. **Your palette is smaller than you think**: beginners live in the top-right corner of the hex picker; a 15-colour picker will suggest colours and you should pick one or two, taking inspiration from nature and artwork. **Less is more**: Google and Apple have **one** call to action and one main thing in the header — give people one or two things to click. **Simple ≠ amateur**: Linear, Huddle and Toa HQ convert; Prometheus Fuels' scrollytelling serves awareness, not conversion. And **good ideas don't exist in a vacuum** — build a mood board before opening Figma.

---

## 13. The complete channel map — all 54 videos, with the takeaway from each

Every row below comes from the video's own transcript.

| Views | Video | The takeaway |
|---:|---|---|
| 571k | [Every UI/UX Concept Explained in Under 10 Minutes](https://www.youtube.com/watch?v=EcbgbKtOELY) | The 10-minute primer: signifiers, hierarchy, grids, type, colour, dark mode, shadows, icons, states, micro-interactions, overlays — §3.9 |
| 506k | [7 UI/UX mistakes that SCREAM you're a beginner](https://www.youtube.com/watch?v=AH_ugxmLeUM) | Flow planning, consistent radii, one icon library, real interaction states, 4/8px grids |
| 399k | [EVERYTHING to build a Dashboard UI in 8 minutes](https://www.youtube.com/watch?v=B7k5rOgmOGY) | The dashboard foundation — §3.6 |
| 230k | [The secret behind weirdly perfect UI designs](https://www.youtube.com/watch?v=neE6wOuBIP8) | Edge-locking, differentiation, showing not telling, emphasis is relational — §3.5 |
| 226k | [Everything about Mobile App UI's in 8 minutes](https://www.youtube.com/watch?v=Gfsd8NNuD9g) | Bottom bar ≤5 links, 44px targets, one screen one job, bottom sheets, gestures |
| 212k | [5 SaaS UI/UX mistakes that SCREAM you Vibe Code](https://www.youtube.com/watch?v=PDcQJOPby1k) | The AI-tell teardown: icons, colour, layout, busy cards, pricing, landing pages — §4 Stage 4 |
| 191k | [The 3 dashboard UI flaws](https://www.youtube.com/watch?v=Ksx9C2-3yMo) | Data drives the form; progressive disclosure; the invisible UI — §3.6 |
| 178k | [How to think like a GENIUS UI/UX designer](https://www.youtube.com/watch?v=HE4rLEQpiXY) | Intent first, respect conventions, design around content, systems as language — §3.7 |
| 157k | [Why the best software must LIE to you](https://www.youtube.com/watch?v=S8DcTJm8pYM) | Waiting / inferring / acting-first; 700ms vs 300ms; undo vs. modal — §3.7 |
| 118k | [Why everyone can tell you're a vibe coder](https://www.youtube.com/watch?v=NHOCPS1G1xw) | The three tells; Tesler's Law; onboarding that builds vs. explains — §2 |
| 99k | [Redesigning a Finance Dashboard UI from SCRATCH](https://www.youtube.com/watch?v=Yr2uIcFZDDQ) | Priority tiers, honest charts, removing meaningless diagrams |
| 96k | [The 7 Color Mistakes that RUIN your UI Designs](https://www.youtube.com/watch?v=EOcY3hPMQkk) | Less colour; greys over black/white; dark mode is not inverted; red for destructive — §3.1 |
| 92k | [11 Micro Animations](https://www.youtube.com/watch?v=ld1zhQMXxXU) | The concrete motion recipes, with durations and easings — §3.4 |
| 63k | [The 8 UI/UX Cheat Codes](https://www.youtube.com/watch?v=c1TvOcKdBVE) | Kerning, nested radii, HSB palette method, 4/8px grid — §3.3 |
| 59k | [The stupid simple way to learn UI/UX design](https://www.youtube.com/watch?v=9WVt1CelBfg) | Train the eye → build the skill → think like a designer; the 28-day plan — §6 |
| 58k | [7 Modern UI Layouts from 50 Top Software Companies](https://www.youtube.com/watch?v=VPeTgU7la34) | Logo walls, bento, mega-nav, the clickable multisection — §3.8 |
| 55k | [Why the 60-30-10 Rule is RUINING Your UI Designs](https://www.youtube.com/watch?v=66oOi9OLMCw) | The four-layer colour system with all the numbers — §3.1 |
| 51k | [The one thing vibe coding CAN'T fix](https://www.youtube.com/watch?v=RCneB_MQ7qs) | Visual identity + Frankensteining + motion identity — §4 Stage 0–1 |
| 48k | [The 4 Levels of Landing Page UI/UX Design](https://www.youtube.com/watch?v=eMMiLeo_UGI) | The maturity ladder, with price bands and the defects at each level — §8 |
| 44k | [4 UI Design Hacks to KILL boring designs](https://www.youtube.com/watch?v=SfX43uIubj4) | Context density over emptiness; motion with purpose; friendly copy; the 404 page |
| 37k | [The Formula Behind Truly Captivating UI Sections](https://www.youtube.com/watch?v=tNMAFjzapOk) | The 5-second test; structure beats ornament — §3.8 |
| 36k | [Upgrading 9 CRUCIAL UI Elements](https://www.youtube.com/watch?v=gKM6b2EnW1k) | Tab bar, charts, cards, pricing, stickers, modals, footers, chips, carousels — §3.3 |
| 29k | [Design macOS Apps EXACTLY like Apple](https://www.youtube.com/watch?v=Vy0KKvZJRH8) | Out-of-window UI, optimistic UI, one-screen apps, progressive disclosure — §9.5 |
| 25k | [Master the 3 Types of CRAZY Mobile UI Swipe Interactions](https://www.youtube.com/watch?v=14h1VnkQvIc) | Never linear ease; motion follows the gesture; slide-to-confirm — §10.1 |
| 25k | [Vibe Coding a Pro UI in SECONDS With AI](https://www.youtube.com/watch?v=xHD01_Onac0) | The Claude→Figma pipeline and the prompt anatomy — §4 Stage 2–3 |
| 19k | [The DEFINITIVE process to present UIs like a pro](https://www.youtube.com/watch?v=7cTdCu8HMgM) | Showcase vs. professional mode; skew values; AI for mock-ups only — §12.1 |
| 19k | [Mathematically Perfect Typography](https://www.youtube.com/watch?v=7sUUzOCv47U) | Golden-ratio scales, fluid type, line-height rules — §3.2 |
| 16k | [8 Web Design Hacks](https://www.youtube.com/watch?v=Lp6ey4AyDzA) | Hierarchy via weight+colour, fewer containers, shadow maths, one primary CTA — §3.3 |
| 15k | [Website Layouts To Make A Professional Website Design](https://www.youtube.com/watch?v=P2ksReDwWkE) | Nine 2024 section patterns, each with the constraint that makes it work |
| 14k | [Stop Making Pretty UIs. Think Like a Product Designer](https://www.youtube.com/watch?v=ADaQuZS04Rc) | Design the states; screens and sequences; systems as trust — §3.7 |
| 14k | [7 UI design trends that are CRIMINALLY slept on](https://www.youtube.com/watch?v=EHwZzWd-OnQ) | Text swapping, hand-drawn marks, line dividers, morphing images, scroll diagrams |
| 13k | [The 7 UI Components to Design Like Unicorn AI Startups](https://www.youtube.com/watch?v=If7iCPDy2vk) | Prompt box, history, memory, inline editing, show-your-work, streaming, confidence |
| 13k | [20 Top Underrated Web Design Resources for 2025](https://www.youtube.com/watch?v=eeN7yUcIWbw) | Uiverse (copy to Figma), Fonty, Isocons, Photo Gradient, Relume's 54-page kit — §7, App. C |
| 8k | [How To Price Website Designs](https://www.youtube.com/watch?v=2rtsoM2Dqrs) | Hourly / project / value-based with the numbers — §12.5 |
| 7.9k | [Animated Dashboard Sidebar Tutorial in Figma](https://www.youtube.com/watch?v=NtZeYmTMuo4) | Subtle outline + near-white palette + light-grey shadow; spring 550/40 — §9.6 |
| 7.7k | [I Redesigned Spotify Wrapped Entirely From SCRATCH](https://www.youtube.com/watch?v=goWOAFqJHpA) | Scroll not click; share button at the bottom; don't remove known features — §9.2 |
| 7.7k | [5 Trendy Animations to Steal](https://www.youtube.com/watch?v=ZsP20PN14O0) | Entrance, hover, highlight-on-scroll, looped, mouse — with fallbacks — §10.5 |
| 7k | [I spent a week gamifying apps](https://www.youtube.com/watch?v=jSxxAFxjxbU) | Two currencies, rewards tied to real goals, segmented leaderboards — §10.3 |
| 6.9k | [I Redesigned Google's AI Website from SCRATCH](https://www.youtube.com/watch?v=pGYLZyBE32o) | Type-in search hero, hover-carried content, gradient dark mode — §9.1 |
| 4.9k | [Redesigning A Modern Skincare UI from SCRATCH](https://www.youtube.com/watch?v=BvbFPzLjWcU) | Design to a real viewport: 1920 × ~1000 visible, not a 50%-bigger artboard — §9.4 |
| 4.9k | [Awful To AMAZING Web Designs Easily](https://www.youtube.com/watch?v=ulSOdTgoGeY) | Variety: layout → break the box → visuals → size → depth |
| 4.6k | [TikTok's UX is so GOOD it should be ILLEGAL](https://www.youtube.com/watch?v=ixUq4HM4FNg) | Remove options; 30–50% onboarding weight; immediate feedback — §10.2 |
| 3.4k | [I Redesigned a Failing Tesla WANNABE Full Website To SAVE It](https://www.youtube.com/watch?v=V3Omp1hm0Sg) | Delete a homepage that only redirects; subtract the subject's shape — §9.3 |
| 3.1k | [Professional Portfolio Breakdown](https://www.youtube.com/watch?v=ToJiXPTNnLY) | 2–3 pages, head shot, visual every couple of paragraphs — §12.2 |
| 2.7k | [I Made The Most UNHINGED UI Upgrades](https://www.youtube.com/watch?v=BUDipdbKK7Y) | Every punishing feature needs a visible off switch — §10.4 |
| 2.5k | [Advanced FIGMA Web Design Effects](https://www.youtube.com/watch?v=MZSm6MA8bww) | Kaleidoscope, clay, metallic, mesh gradient — §11.2 |
| 2.1k | [Make A Perfect UX Case Study In 8 Steps](https://www.youtube.com/watch?v=t7mpEDXzjCg) | Problem up front, personas from data, wireframes, reflection — §12.3 |
| 1.8k | [How hard is it to REALLY make a no-code 3D animated website?](https://www.youtube.com/watch?v=A_Ozpb0XDuw) | SVG → extrude → Blender → no-code builder — §11.3 |
| 1.7k | [Prototyping Professional Load Animations in Figma: Part 1](https://www.youtube.com/watch?v=nl8OFGdx75w) | The Figma frame chains and timings — §11.1 |
| 1.6k | [Make ONE Design Change to Actually Land Clients](https://www.youtube.com/watch?v=5JxUJ1fuyO8) | Sell the business outcome, not the website — §12.4 |
| 1.5k | [6 Things You Probably Need to Hear (as a web designer)](https://www.youtube.com/watch?v=6CC8lLnqa28) | Your first designs are bad; one CTA; simple ≠ amateur — §12.6 |
| 1.4k | [Create A Portfolio With No Experience Needed](https://www.youtube.com/watch?v=59XWYgN00nQ) | Fake-but-realistic projects; 2–3 case studies; no lorem ipsum — §12.2 |
| 1k | [Developing Premium Load animations (HTML, CSS & JS): Part 2](https://www.youtube.com/watch?v=d4MF6pdAZNw) | The GSAP build with exact durations and easings — §11.1 |
| 439 | [Figma Update: Everything In Under 2 Minutes](https://www.youtube.com/watch?v=fL1X2Mw6s3w) | Multi-edit matches layers by **name and grouping position** — so name your layers |

---

## Appendix A — the pipeline, if you want to reproduce it

1. **Catalog** — pull the channel's `videos` tab via YouTube's browse API (or `yt-dlp --flat-playlist -J`) for IDs, durations, view counts and upload dates.
2. **Transcripts** — YouTube's plain `timedtext` endpoint rate-limits aggressively (HTTP 429). The working route is the **player API with a mobile client** (`clientName: ANDROID`, `clientVersion: 20.10.38`), which returns caption tracks with signed `baseUrl`s; fetch those and parse the `<p>`/`<s>` XML.
3. **Cleanup** — strip timing markup, drop consecutive duplicates (auto-captions roll windows), one `.txt` per video.
4. **Analysis** — read the AI-specific videos directly; delegate the rest in parallel batches, each returning *claims / exact numbers / named techniques / anti-patterns*, then cross-check the numbers against the raw transcripts before using them.

**All 54 transcripts** are saved next to this report in [`docs/kole-jain-transcripts/`](kole-jain-transcripts/) — one `.txt` per video headed with its title, plus `channel-catalog.json` (all 54 videos with views, dates and durations) — so you can re-read the source for any claim above.

## Appendix B — two notes on the corpus

**A typo in YouTube's own listing cost me a day.** The channel's video list reports the ID of the 571k-view video as `EcbgbKtOLEY`, but the working ID is **`EcbgbKtOELY`**. With the wrong ID every client returns *"This video is unavailable"*, which is indistinguishable from a members-only or geo-block. If a video looks unplayable, **suspect the ID before the paywall** — and cross-check the ID against the video's own watch page and the RSS feed, which carry the correct one.

**YouTube's `timedtext` endpoint is not the way in.** It returned HTTP 429 for every request from this machine, and `yt-dlp`'s subtitle downloader inherits the same limit. The player API's signed caption URLs work fine.

## Appendix C — resources

**Free Figma kits (26, one per video)** — [kolejain.com/resources](https://kolejain.com/resources). Each entry links the matching video, a Figma file and a downloadable `.fig`. The most relevant for AI work: *Vibe Coded SaaS*, *Vibe Coding Tells*, *Every UI Concept*, *Dashboard UI*, *Dashboard Flaws*, *Software colors*, *UI Elements*.

**MCP servers:** **Mobbin MCP** (600,000+ real screens; the one Kole credits with visibly better AI output) and **Relume MCP** (1,000+ designer components; plus Relume Publish, which turns a brief into sitemap → wireframe → live site).

**Reference libraries:** [21st.dev](https://21st.dev) (copy code *or* the prompt), siteinspire.com, **Uiverse** (copy-to-Figma), **Unsectioned** (real sites chopped into searchable sections), **Fonty** (one-click font pairing), **Isocons**, **Photo Gradient** (mesh-gradient presets + a colour guide that changes on refresh), Coolors / UI Colors / oklch.com, Feather / Phosphor / Lucide.

**Animation & code:** GSAP (`expo.inOut` ↔ Figma's hand-pulled bezier), Three Phase (in-browser animation editor), After Effects, Blender (free 3D; Spline only exports on paid plans), Wick Studio (no-code builder).

**Stock & assets:** Pexels, Pixabay, Shopify's free stock site (smaller than Pexels but better organised), logo.com, Logo Ipsum, minimalmockups.com, Flat Icons (filter for "interface icons").
