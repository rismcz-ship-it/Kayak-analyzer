import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as fs from 'fs';

const buffer = fs.readFileSync('./test-kayak.stl');
const loader = new STLLoader();
const geometry = loader.parse(buffer.buffer);
const positions = geometry.getAttribute('position').array as Float32Array;

console.log(`Triangle count: ${positions.length / 9}`);
console.log(`Vertex count: ${positions.length / 3}`);