# Test Files

This folder contains test scripts and test data for the kayak-analyzer project.

## Test Scripts

| File | Purpose |
|------|---------|
| `test-auto-orient.ts` | Tests `autoOrientToZUp()` — arbitrary STL axes → Z-up, deck-up, volume-centroid bow detection |
| `test-box.ts` | Synthetic hull (known geometry) — exercises all geometry helpers + `solve_trim` with ground truth |
| `test-solver.ts` | Full solver: 4 orientation scenarios × trim sweep — catches orientation-dependent behavior |
| `test-lcb.mjs` | (Optional) Raw mesh validation on `~/Downloads/Kayak v2.stl` — watertightness, volume, centroid |

## Test Data

| File | Description |
|------|-------------|
| `test-kayak.stl` | Sample kayak STL mesh (2.0 MB) used as input for tests |

## Running Tests

All test files are TypeScript/ESM modules. To run them:

```bash
# From the project root
npx tsx tests/test-box.ts
npx tsx tests/test-solver.ts
# etc.

# Or with node directly for .mjs files
node tests/test-lcb.mjs
```

Note: Tests import from `../src/lib/` so they must be run from the project root directory.