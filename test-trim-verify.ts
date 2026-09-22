import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { 
  computeBounds, 
  autoOrientToZUp,
  applyRotateZ180,
  centerToOrigin,
  computeVolumeAndCentroid
} from './src/lib/geometry.js';
import { solve_trim } from './src/lib/hydrostatics.js';
import * as fs from 'fs';

const buffer = fs.readFileSync('./test-kayak.stl');
const loader = new STLLoader();
const geometry = loader.parse(buffer.buffer);
const positions = geometry.getAttribute('position').array as Float32Array;

console.log("=== AUTO ORIENT (with volume centroid bow detection) ===");
const positions1 = new Float32Array(positions);
const note1 = autoOrientToZUp(positions1);
centerToOrigin(positions1);
console.log(`Note: ${note1}`);
const bounds1 = computeBounds(positions1);
console.log(`maxX (solver bow): ${bounds1.max.x.toFixed(1)}, minX (solver stern): ${bounds1.min.x.toFixed(1)}`);

const vol1 = computeVolumeAndCentroid(positions1);
console.log(`Volume centroid X: ${vol1.centroid.x.toFixed(1)}`);

const trim1 = solve_trim(positions1, 75, { maxTrimDeg: 5, trimStepDeg: 0.5 });
console.log(`\nTrim result: ${trim1.trimDeg.toFixed(2)}°`);
console.log(`LCG X: ${trim1.lcg.x.toFixed(1)}, LCB X: ${trim1.lcb.x.toFixed(1)}`);

console.log("\n=== AUTO ORIENT + BOW FLIP ===");
const positions2 = new Float32Array(positions);
autoOrientToZUp(positions2);
applyRotateZ180(positions2);
centerToOrigin(positions2);
const bounds2 = computeBounds(positions2);
console.log(`maxX (solver bow): ${bounds2.max.x.toFixed(1)}, minX (solver stern): ${bounds2.min.x.toFixed(1)}`);

const vol2 = computeVolumeAndCentroid(positions2);
console.log(`Volume centroid X: ${vol2.centroid.x.toFixed(1)}`);

const trim2 = solve_trim(positions2, 75, { maxTrimDeg: 5, trimStepDeg: 0.5 });
console.log(`\nTrim result: ${trim2.trimDeg.toFixed(2)}°`);
console.log(`LCG X: ${trim2.lcg.x.toFixed(1)}, LCB X: ${trim2.lcb.x.toFixed(1)}`);