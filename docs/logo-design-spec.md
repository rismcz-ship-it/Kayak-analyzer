# kayak-analyzer Logo — Design Spec & Style Guide

Status: proposal v1, 2026-11-24. Built against the principles in
`docs/logo-design-report.md`. Not yet wired into the app.

## The idea

An **equilibrium mark**: a hull floating on its waterplane. The hull above the waterline
is the boat; the wedge below it is the **displaced volume** — the one thing this app
exists to compute — rendered in a single accent color. The shallow notch in the deck is
the cockpit coaming: the one detail that makes the silhouette read "kayak" without
tracing a mesh outline. One waterplane rule extends past the hull, which is where the
GZ/stability arm lives conceptually.

It is abstract in form but representative in meaning: hull, water, displacement.

## Construction

- Grid: 120 × 84 units. The hull body is one symmetric cubic curve (bow and stern
  interchangeable — matches the app's own "which end is the bow is the mesh's answer"
  convention); the notch is a single quadratic; the waterline sits at y = 48.
- X-unit (for clear space and minimum sizes): **9 units** — half the width of one hull
  end (10 → 44).
- Strokes scale with the mark: waterline 4, hull outline 3. The icon and favicon
  variants thicken both rather than keeping the same weights.

## Colors

| Token          | Hex       | Use                                              | Contrast (vs white / vs ink) |
| -------------- | --------- | ------------------------------------------------ | --------------------------- |
| Ink            | `#12181F` | Hull and waterplane on light grounds             | 16.8 : 1                   |
| Paper          | `#EEF2F5` | Hull and waterplane on dark grounds              | 16.8 : 1 vs ink            |
| Accent (light) | `#0FA3B5` | Displaced wedge on light grounds                 | 3.0 : 1 vs white           |
| Accent (dark)  | `#2EC4D6` | Displaced wedge on dark grounds / icon           | 8.9 : 1 vs ink             |

Accent on light ground sits at exactly the WCAG 3:1 graphical-object floor — fine for
the mark, but don't use it for small UI text.

## Variants

| File                          | Use                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| `mark-color.svg`              | Primary mark, light backgrounds                             |
| `mark-color-dark.svg`         | Primary mark, dark backgrounds                              |
| `mark-mono.svg`               | One-color silhouette; **inline** it so `currentColor` works |
| `lockup-color.svg`            | Mark + wordmark, light backgrounds                          |
| `lockup-mono.svg`             | Mark + wordmark, one color; **inline** it                   |
| `icon.svg`                    | App icon / avatar, square unmasked, squircle-cropped        |
| `favicon.svg`                 | Designed at 16 px; solid ground, thick strokes              |

## Usage rules

- **Clear space:** 9 units (x-unit) on all sides, nothing enters it.
- **Minimum size:** mark 24 px wide digital / 12 mm print; lockup 120 px / 24 mm.
- **Backgrounds:** color variants need light or dark grounds respectively; use
  mono on busy or unknown grounds.
- **Do not:** recolor the wedge independently, rotate the mark, stretch it, add
  shadows/gradients, or place the light-ground variant on photography.

## Accessibility

- Never rely on the teal/ink pairing alone at tiny sizes — the silhouette carries the
  meaning, color only splits it.
- The wordmark in the lockups is set in a system geometric sans; for production,
  outline the type (or license a geometric grotesque such as Futura/Poppins) so the
  lockup doesn't depend on installed fonts.

## Production notes

- SVGs are the masters. Export PNGs at whatever size is needed **from** the SVG
  (`public/logo/*.svg`), never the reverse.
- Favicon: also emit `favicon.ico` (16+32) and, if the app is installable as a PWA, a
  512 maskable icon with `purpose: "maskable"` — the mark already sits inside the 40%
  safe zone in `icon.svg`.
- Nothing in `public/` is referenced by the app yet — wiring it into `App.tsx` /
  `index.html` is a follow-up step.