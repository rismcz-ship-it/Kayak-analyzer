import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { autoOrientToZUp, centerToOrigin, decimateMesh, DEFAULT_SOLVER_TRIANGLES, computeBounds } from '../src/lib/geometry.js';
import * as fs from 'fs';

const buffer = fs.readFileSync('./tests/test-kayak.stl');
const loader = new STLLoader();
const geometry = loader.parse(buffer.buffer);
const positions = geometry.getAttribute('position').array;

const pos = new Float32Array(positions);
autoOrientToZUp(pos);
centerToOrigin(pos);

console.log('Original triangles:', pos.length / 9);
const bounds = computeBounds(pos);
console.log('Bounds:', bounds.size.x.toFixed(1), bounds.size.y.toFixed(1), bounds.size.z.toFixed(1));

// Test different target values
for (const target of [5000, 8000, 10000, 12000, 15000]) {
  const decimated = decimateMesh(pos, target);
  console.log(`Target ${target}: ${decimated.length / 9} triangles`);
}