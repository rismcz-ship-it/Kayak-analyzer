import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as THREE from 'three';
import fs from 'fs';

// Load the actual test STL
const path = 'C:/Users/Richard Malán/Downloads/Kayak v2.stl';
const buffer = fs.readFileSync(path);
const geometry = new STLLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
const positions = geometry.getAttribute('position').array;

console.log('=== Kayak v2 STL Analysis ===');
console.log('Triangles:', positions.length / 9);

// Compute bounds
let minX = 1e9, minY = 1e9, minZ = 1e9;
let maxX = -1e9, maxY = -1e9, maxZ = -1e9;
for (let i = 0; i < positions.length; i += 3) {
  minX = Math.min(minX, positions[i]);
  maxX = Math.max(maxX, positions[i]);
  minY = Math.min(minY, positions[i + 1]);
  maxY = Math.max(maxY, positions[i + 1]);
  minZ = Math.min(minZ, positions[i + 2]);
  maxZ = Math.max(maxZ, positions[i + 2]);
}
console.log('Bounds:');
console.log('  X:', minX.toFixed(1), 'to', maxX.toFixed(1), 'size:', (maxX - minX).toFixed(1));
console.log('  Y:', minY.toFixed(1), 'to', maxY.toFixed(1), 'size:', (maxY - minY).toFixed(1));
console.log('  Z:', minZ.toFixed(1), 'to', maxZ.toFixed(1), 'size:', (maxZ - minZ).toFixed(1));

// Signed volume
let vol = 0;
for (let i = 0; i < positions.length; i += 9) {
  const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
  const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
  const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
  vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
}
const signedVol = vol / 6;
console.log('Signed volume (mm³):', signedVol.toFixed(1));
console.log('Volume (L):', (Math.abs(signedVol) / 1e6).toFixed(3));

// Centroid
let cx = 0, cy = 0, cz = 0;
for (let i = 2; i < positions.length; i += 3) {
  cx += positions[i - 2];
  cy += positions[i - 1];
  cz += positions[i];
}
cx /= positions.length / 3;
cy /= positions.length / 3;
cz /= positions.length / 3;
console.log('Vertex centroid:', cx.toFixed(1), cy.toFixed(1), cz.toFixed(1));
console.log('BBox center:', ((minX + maxX) / 2).toFixed(1), ((minY + maxY) / 2).toFixed(1), ((minZ + maxZ) / 2).toFixed(1));

// Check watertightness
const edges = new Map();
let open = 0, closed = 0, degenerate = 0;
for (let i = 0; i < positions.length; i += 9) {
  const pts = [
    [positions[i], positions[i + 1], positions[i + 2]],
    [positions[i + 3], positions[i + 4], positions[i + 5]],
    [positions[i + 6], positions[i + 7], positions[i + 8]],
  ];
  for (let e = 0; e < 3; e++) {
    const a = pts[e], b = pts[(e + 1) % 3];
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) { degenerate++; continue; }
    const key = `${a[0]}|${a[1]}|${a[2]}|${b[0]}|${b[1]}|${b[2]}`;
    const rev = `${b[0]}|${b[1]}|${b[2]}|${a[0]}|${a[1]}|${a[2]}`;
    if (edges.has(rev)) edges.delete(rev);
    else edges.set(key, true);
  }
}
console.log('Open edges:', edges.size);
console.log('Degenerate edges:', degenerate);
console.log('Watertight:', edges.size === 0 ? 'YES' : 'NO');
