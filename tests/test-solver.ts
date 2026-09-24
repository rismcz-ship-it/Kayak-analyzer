import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { 
  computeBounds, 
  applyAxisMappingWithSigns, 
  applyFlipZ, 
  applyRotateZ180,
  autoOrientToZUp,
  centerToOrigin,
  isEvenPermutation,
  AXIS_INDEX,
  analyzeMesh,
  computeVolumeAndCentroid
} from '../src/lib/geometry.js';
import { solve_trim, find_draft_0trim } from '../src/lib/hydrostatics.js';
import * as THREE from 'three';
import * as fs from 'fs';

async function test() {
  // Load the STL
  const buffer = fs.readFileSync(new URL('./test-kayak.stl', import.meta.url));
  const loader = new STLLoader();
  const geometry = loader.parse(buffer.buffer);
  const positions = geometry.getAttribute('position').array as Float32Array;
  
  console.log("=== ORIGINAL STL ===");
  const origBounds = computeBounds(positions);
  console.log(`Bounds: ${origBounds.size.x.toFixed(1)} x ${origBounds.size.y.toFixed(1)} x ${origBounds.size.z.toFixed(1)} mm`);
  console.log(`Center: ${origBounds.center.x.toFixed(1)}, ${origBounds.center.y.toFixed(1)}, ${origBounds.center.z.toFixed(1)}`);
  
  // Test 1: Auto Orient
  console.log("\n=== AUTO ORIENT ===");
  const positions1 = new Float32Array(positions);
  const note1 = autoOrientToZUp(positions1);
  centerToOrigin(positions1);
  console.log(`Note: ${note1}`);
  const bounds1 = computeBounds(positions1);
  console.log(`Bounds: ${bounds1.size.x.toFixed(1)} x ${bounds1.size.y.toFixed(1)} x ${bounds1.size.z.toFixed(1)} mm`);
  console.log(`Center: ${bounds1.center.x.toFixed(1)}, ${bounds1.center.y.toFixed(1)}, ${bounds1.center.z.toFixed(1)}`);
  console.log(`maxX (solver bow): ${bounds1.max.x.toFixed(1)}, minX (solver stern): ${bounds1.min.x.toFixed(1)}`);
  
  // Check volume centroid vs geometric centroid for bow detection
  const vol = computeVolumeAndCentroid(positions1);
  console.log(`Volume centroid X: ${vol.centroid.x.toFixed(1)}`);
  console.log(`Geometric center X: ${bounds1.center.x.toFixed(1)}`);
  console.log(`Bow detection would flip: ${vol.centroid.x > bounds1.center.x ? "YES" : "NO"}`);
  
  // Run solver
  const trim1 = solve_trim(positions1, 75);
  console.log(`\nTrim result: ${trim1.trimDeg.toFixed(2)}°`);
  console.log(`LCG X: ${trim1.lcg.x.toFixed(1)}, LCB X: ${trim1.lcb.x.toFixed(1)}`);
  console.log(`Offset: ${trim1.lcbLcgOffsetMm.toFixed(1)} mm`);
  
  // Test 2: Auto Orient + Bow Flip
  console.log("\n=== AUTO ORIENT + BOW FLIP ===");
  const positions2 = new Float32Array(positions);
  autoOrientToZUp(positions2);
  applyRotateZ180(positions2);
  centerToOrigin(positions2);
  const bounds2 = computeBounds(positions2);
  console.log(`Bounds: ${bounds2.size.x.toFixed(1)} x ${bounds2.size.y.toFixed(1)} x ${bounds2.size.z.toFixed(1)} mm`);
  console.log(`maxX (solver bow): ${bounds2.max.x.toFixed(1)}, minX (solver stern): ${bounds2.min.x.toFixed(1)}`);
  
  const vol2 = computeVolumeAndCentroid(positions2);
  console.log(`Volume centroid X: ${vol2.centroid.x.toFixed(1)}`);
  console.log(`Geometric center X: ${bounds2.center.x.toFixed(1)}`);
  
  const trim2 = solve_trim(positions2, 75);
  console.log(`\nTrim result: ${trim2.trimDeg.toFixed(2)}°`);
  console.log(`LCG X: ${trim2.lcg.x.toFixed(1)}, LCB X: ${trim2.lcb.x.toFixed(1)}`);
  console.log(`Offset: ${trim2.lcbLcgOffsetMm.toFixed(1)} mm`);
  
  // Test 3: Manual - what if bow IS at +X from the start?
  console.log("\n=== MANUAL: Force bow at +X (if original had it at -X) ===");
  const positions3 = new Float32Array(positions);
  // Just center and run solver
  centerToOrigin(positions3);
  const bounds3 = computeBounds(positions3);
  console.log(`Bounds: ${bounds3.size.x.toFixed(1)} x ${bounds3.size.y.toFixed(1)} x ${bounds3.size.z.toFixed(1)} mm`);
  console.log(`maxX: ${bounds3.max.x.toFixed(1)}, minX: ${bounds3.min.x.toFixed(1)}`);
  
  const vol3 = computeVolumeAndCentroid(positions3);
  console.log(`Volume centroid X: ${vol3.centroid.x.toFixed(1)}`);
  
  const trim3 = solve_trim(positions3, 75);
  console.log(`\nTrim result: ${trim3.trimDeg.toFixed(2)}°`);
  console.log(`LCG X: ${trim3.lcg.x.toFixed(1)}, LCB X: ${trim3.lcb.x.toFixed(1)}`);
  console.log(`Offset: ${trim3.lcbLcgOffsetMm.toFixed(1)} mm`);
  
  // Test 4: Rotate Z 180 on original
  console.log("\n=== ORIGINAL + ROTATE Z 180 ===");
  const positions4 = new Float32Array(positions);
  applyRotateZ180(positions4);
  centerToOrigin(positions4);
  const bounds4 = computeBounds(positions4);
  console.log(`Bounds: ${bounds4.size.x.toFixed(1)} x ${bounds4.size.y.toFixed(1)} x ${bounds4.size.z.toFixed(1)} mm`);
  console.log(`maxX: ${bounds4.max.x.toFixed(1)}, minX: ${bounds4.min.x.toFixed(1)}`);
  
  const vol4 = computeVolumeAndCentroid(positions4);
  console.log(`Volume centroid X: ${vol4.centroid.x.toFixed(1)}`);
  
  const trim4 = solve_trim(positions4, 75);
  console.log(`\nTrim result: ${trim4.trimDeg.toFixed(2)}°`);
  console.log(`LCG X: ${trim4.lcg.x.toFixed(1)}, LCB X: ${trim4.lcb.x.toFixed(1)}`);
  console.log(`Offset: ${trim4.lcbLcgOffsetMm.toFixed(1)} mm`);
}

test().catch(console.error);