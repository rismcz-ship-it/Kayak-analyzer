import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { autoOrientToZUp, centerToOrigin, decimateMesh, DEFAULT_SOLVER_TRIANGLES } from '../src/lib/geometry.js';
import { solve_trim } from '../src/lib/hydrostatics.js';
import * as fs from 'fs';

const buffer = fs.readFileSync('./tests/test-kayak.stl');
const loader = new STLLoader();
const geometry = loader.parse(buffer.buffer);
const positions = geometry.getAttribute('position').array;

const pos = new Float32Array(positions);
autoOrientToZUp(pos);
centerToOrigin(pos);

console.log('Original triangles:', pos.length / 9);

const decimated = decimateMesh(pos, DEFAULT_SOLVER_TRIANGLES);
console.log('Decimated triangles:', decimated.length / 9);

console.log('\n--- FULL MESH ---');
const start1 = Date.now();
const trim1 = solve_trim(pos, 75);
console.log('Time:', (Date.now() - start1) / 1000, 's');
console.log('Trim:', trim1.trimDeg.toFixed(2), '°');
console.log('Offset:', trim1.lcbLcgOffsetMm.toFixed(1), 'mm');
console.log('Draft:', trim1.draftMm.toFixed(1), 'mm');
console.log('Planes:', trim1.planesEvaluated);

console.log('\n--- DECIMATED MESH (10k) ---');
const start2 = Date.now();
const trim2 = solve_trim(decimated, 75);
console.log('Time:', (Date.now() - start2) / 1000, 's');
console.log('Trim:', trim2.trimDeg.toFixed(2), '°');
console.log('Offset:', trim2.lcbLcgOffsetMm.toFixed(1), 'mm');
console.log('Draft:', trim2.draftMm.toFixed(1), 'mm');
console.log('Planes:', trim2.planesEvaluated);

console.log('\n--- DELTA ---');
console.log('Trim delta:', (trim2.trimDeg - trim1.trimDeg).toFixed(2), '°');
console.log('Offset delta:', (trim2.lcbLcgOffsetMm - trim1.lcbLcgOffsetMm).toFixed(1), 'mm');
console.log('Draft delta:', (trim2.draftMm - trim1.draftMm).toFixed(1), 'mm');