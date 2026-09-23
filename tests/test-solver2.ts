import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { 
  computeBounds, 
  applyAxisMappingWithSigns, 
  applyFlipZ, 
  applyRotateZ180,
  autoOrientToZUp,
  centerToOrigin,
  computeVolumeAndCentroid
} from '../src/lib/geometry.js';
import { solve_trim } from '../src/lib/hydrostatics.js';
import * as THREE from 'three';
import * as fs from 'fs';

async function test() {
  const buffer = fs.readFileSync('./test-kayak.stl');
  const loader = new STLLoader();
  const geometry = loader.parse(buffer.buffer);
  const positions = geometry.getAttribute('position').array as Float32Array;
  
  console.log("=== ORIGINAL STL ===");
  const origBounds = computeBounds(positions);
  console.log(`Bounds: ${origBounds.size.x.toFixed(1)} x ${origBounds.size.y.toFixed(1)} x ${origBounds.size.z.toFixed(1)} mm`);
  
  // Test: Auto Orient + Bow Flip (just this one with reduced solver range)
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
  
  // Test with limited trim range for speed
  const trim2 = solve_trim(positions2, 75, { maxTrimDeg: 5, trimStepDeg: 0.2 });
  console.log(`\nTrim result: ${trim2.trimDeg.toFixed(2)}°`);
  console.log(`LCG X: ${trim2.lcg.x.toFixed(1)}, LCB X: ${trim2.lcb.x.toFixed(1)}`);
  console.log(`Offset: ${trim2.lcbLcgOffsetMm.toFixed(1)} mm`);
}

test().catch(console.error);