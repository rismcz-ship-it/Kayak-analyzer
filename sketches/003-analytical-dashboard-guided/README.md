## Variant: Analytical Dashboard & Guided Flow

### Design stance
Provide a clean, modern web dashboard with progressive disclosure, guided wizards, and card-based KPIs so users understand hydrostatic results through clear information hierarchy rather than raw data.

### Key choices
- **Layout**: Card-based dashboard with a left navigation sidebar, hero KPI stat grid, and a responsive two-column main area (large 3D viewport + side data panel).
- **Typography**: Clean sans-serif with large, legible hero stats and subtle monospace for technical labels.
- **Color**: Light-neutral professional palette with a sky-blue accent. (Dark mode supported via data-theme attribute.)
- **Interaction**:
  - Guided wizard bar (Step 1: Upload Mesh → Step 4: Review) with skip option.
  - Interactive payload form (weight, LCG%, KG height sliders).
  - One-click "Solve Draft" button.
  - Collapsible comparison panel showing baseline deltas.

### Trade-offs
- **Strong at**: Clarity, accessibility, and presentation quality for reports or sharing results.
- **Weak at**: Maximum density — more clicks to see everything compared to the CAD workbench.

### Best for
- Generating shareable reports, presenting findings to stakeholders, and guiding new users through the analysis workflow.
