// Quick test with a simple box mesh to verify the logic
// Box: 2000 x 400 x 200 mm (length x beam x depth), bow at +X

// Create a simple asymmetric hull: finer bow, wider stern
function createTestHull(): Float32Array {
  const L = 2000; // length
  const B = 400;  // beam
  const D = 200;  // depth
  
  // Simple box but with asymmetric ends
  // Bow (x=+1000): narrow, Stern (x=-1000): wide
  // We'll create a wedge-like shape
  
  const tris = [];
  
  // Bottom
  tris.push(
    // stern
    -L/2, -B/2, -D/2,   -L/2, B/2, -D/2,   L/2, B/2, -D/2,
    -L/2, -B/2, -D/2,   L/2, B/2, -D/2,   L/2, -B/2, -D/2,
  );
  
  // Sides - stern wider
  tris.push(
    // port side
    -L/2, -B/2, -D/2,   -L/2, -B/2, D/2,   L/2, -B/4, D/2,
    -L/2, -B/2, -D/2,   L/2, -B/4, D/2,   L/2, -B/4, -D/2,
    // starboard side
    -L/2, B/2, -D/2,   L/2, B/4, -D/2,   L/2, B/4, D/2,
    -L/2, B/2, -D/2,   L/2, B/4, D/2,   -L/2, B/2, D/2,
  );
  
  // Deck
  tris.push(
    -L/2, -B/2, D/2,   L/2, -B/4, D/2,   -L/2, B/2, D/2,
    L/2, -B/4, D/2,   L/2, B/4, D/2,   -L/2, B/2, D/2,
  );
  
  // Bow (finer)
  tris.push(
    L/2, -B/4, -D/2,   L/2, B/4, D/2,   L/2, B/4, -D/2,
    L/2, -B/4, -D/2,   L/2, -B/4, D/2,   L/2, B/4, D/2,
  );
  
  // Stern (wider)
  tris.push(
    -L/2, -B/2, -D/2,   -L/2, B/2, D/2,   -L/2, B/2, -D/2,
    -L/2, -B/2, -D/2,   -L/2, -B/2, D/2,   -L/2, B/2, D/2,
  );
  
  const arr = new Float32Array(tris);
  return arr;
}

import { computeBounds, autoOrientToZUp, applyRotateZ180, centerToOrigin, computeVolumeAndCentroid } from '../src/lib/geometry.js';
import { solve_trim } from '../src/lib/hydrostatics.js';

const positions = createTestHull();
console.log(`Triangles: ${positions.length / 9}`);

console.log("\n=== TEST HULL (bow at +X, stern at -X) ===");
let bounds = computeBounds(positions);
console.log(`Bounds: ${bounds.size.x.toFixed(1)} x ${bounds.size.y.toFixed(1)} x ${bounds.size.z.toFixed(1)}`);
console.log(`maxX (bow): ${bounds.max.x.toFixed(1)}, minX (stern): ${bounds.min.x.toFixed(1)}`);
let vol = computeVolumeAndCentroid(positions);
console.log(`Volume: ${(vol.volumeMm3/1e6).toFixed(1)} L, Centroid X: ${vol.centroid.x.toFixed(1)}`);

// Test 1: As-is (bow at +X)
console.log("\n=== AS-IS (bow at +X) ===");
const p1 = new Float32Array(positions);
centerToOrigin(p1);
bounds = computeBounds(p1);
console.log(`maxX: ${bounds.max.x.toFixed(1)}, minX: ${bounds.min.x.toFixed(1)}`);
vol = computeVolumeAndCentroid(p1);
console.log(`Centroid X: ${vol.centroid.x.toFixed(1)}`);
const t1 = solve_trim(p1, 15, { maxTrimDeg: 5, trimStepDeg: 0.5 });
console.log(`Trim: ${t1.trimDeg.toFixed(2)}°, LCG: ${t1.lcg.x.toFixed(1)}, LCB: ${t1.lcb.x.toFixed(1)}`);

// Test 2: Rotate Z 180 (bow at -X)
console.log("\n=== ROT Z 180 (bow at -X) ===");
const p2 = new Float32Array(positions);
applyRotateZ180(p2);
centerToOrigin(p2);
bounds = computeBounds(p2);
console.log(`maxX (solver bow): ${bounds.max.x.toFixed(1)}, minX (solver stern): ${bounds.min.x.toFixed(1)}`);
vol = computeVolumeAndCentroid(p2);
console.log(`Centroid X: ${vol.centroid.x.toFixed(1)}`);
const t2 = solve_trim(p2, 15, { maxTrimDeg: 5, trimStepDeg: 0.5 });
console.log(`Trim: ${t2.trimDeg.toFixed(2)}°, LCG: ${t2.lcg.x.toFixed(1)}, LCB: ${t2.lcb.x.toFixed(1)}`);