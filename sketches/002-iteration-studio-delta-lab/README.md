## Variant: Iteration Studio & Delta Lab (v1)

### Design stance
Center the entire user experience on comparative analysis and design evolution (Baseline vs Target Candidate). Make delta metrics, resistance reductions, and visual overlays the primary focal point.

### Key choices
- **Layout**: Split comparison stage on the left (with Side-by-Side and Ghost Overlay blend modes) + comprehensive Hydrostatic Delta Matrix on the right.
- **Typography**: Clean modern sans-serif with a prominent tabular monospace font for metrics and deltas.
- **Color**: Dark modern studio theme with vivid functional badges (Emerald green for improvements, Amber/Red for trade-offs/warnings).
- **Interaction**:
  - Live scenario toggles (Light 55kg / Target 65kg / Heavy 75kg).
  - Mode switcher (Split Side-by-Side vs Ghost Overlay).
  - Interactive cross-fade slider controlling geometry opacity.
  - Michlet drag breakdown across multiple paddling speeds (cruising, race pace, sprint, hull speed).

### Trade-offs
- **Strong at**: Immediately seeing what changed between iterations, evaluating hydrodynamics trade-offs, and comparing hull geometry changes.
- **Weak at**: Initial raw STL mesh setup and low-level coordinate alignment.

### Best for
- Iterative hull shaping, comparing design candidates (e.g. Paname S vs Rip-R Evo 2 hybrid), and verifying hydrodynamic improvements.
