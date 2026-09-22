import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { 
  computeBounds, 
  autoOrientToZUp,
  applyRotateZ180,
  centerToOrigin,
  computeVolumeAndCentroid
} from './src/lib/geometry.js';
import * as fs from 'fs';

const buffer = fs.readFileSync('./test-kayak.stl');
const loader = new STLLoader();
const geometry = loader.parse(buffer.buffer);
const positions = geometry.getAttribute('position').array as Float32Array;

console.log("=== ORIGINAL STL ===");
const origBounds = computeBounds(positions);
console.log(`Bounds: ${origBounds.size.x.toFixed(1)} x ${origBounds.size.y.toFixed(1)} x ${origBounds.size.z.toFixed(1)} mm`);

console.log("\n=== AUTO ORIENT (with volume centroid bow detection) ===");
const positions1 = new Float32Array(positions);
const note1 = autoOrientToZUp(positions1);
centerToOrigin(positions1);
console.log(`Note: ${note1}`);
const bounds1 = computeBounds(positions1);
console.log(`Bounds: ${bounds1.size.x.toFixed(1)} x ${bounds1.size.y.toFixed(1)} x ${bounds1.size.z.toFixed(1)} mm`);
console.log(`maxX (solver bow): ${bounds1.max.x.toFixed(1)}, minX (solver stern): ${bounds1.min.x.toFixed(1)}`);

const vol1 = computeVolumeAndCentroid(positions1);
console.log(`Volume centroid X: ${vol1.centroid.x.toFixed(1)}`);
console.log(`Geometric center X: ${bounds1.center.x.toFixed(1)}`);
console.log(`Volume centroid > center? ${vol1.centroid.x > bounds1.center.x ? "YES (flip)" : "NO (ok)"}`);

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