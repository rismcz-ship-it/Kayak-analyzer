# Test Files

This folder contains test scripts and test data for the kayak-analyzer project.

## Test Scripts

### Solver Tests
| File | Purpose |
|------|---------|
| `test-solver.ts` | Main solver test with full trim solving and draft finding |
| `test-solver2.ts` | Secondary solver test variant |
| `test-solver-fast.ts` | Fast solver performance test |

### Trim Tests
| File | Purpose |
|------|---------|
| `test-trim-accurate.ts` | Accurate trim solving test |
| `test-trim-fast.ts` | Fast trim solving test |
| `test-trim-flip.ts` | Trim flip behavior test |
| `test-trim-flip-coarse.ts` | Coarse trim flip test |
| `test-trim-verify.ts` | Trim verification test |

### Geometry & Orientation Tests
| File | Purpose |
|------|---------|
| `test-auto-orient.ts` | Auto-orientation (STL loading + Z-up orientation) test |
| `test-box.ts` | Simple box hull test for geometry functions and trim solving |
| `test-lcb.mjs` | Longitudinal Center of Buoyancy test (ESM module) |

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