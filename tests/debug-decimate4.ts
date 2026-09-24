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

// Debug: manually trace through decimateMesh
const bounds = computeBounds(pos);
const sizeX = bounds.max.x - bounds.min.x;
const sizeY = bounds.max.y - bounds.min.y;
const sizeZ = bounds.max.z - bounds.min.z;

const targetTriangles = DEFAULT_SOLVER_TRIANGLES;

let cellsX = 15
let cellsY = 12
let cellsZ = 8

const baseCells = 15 * 12 * 8
const targetCells = Math.min(5000, Math.max(1000, targetTriangles / 2))
const scale = Math.cbrt(targetCells / baseCells)
cellsX = Math.max(5, Math.round(cellsX * scale))
cellsY = Math.max(5, Math.round(cellsY * scale))
cellsZ = Math.max(5, Math.round(cellsZ * scale))

const maxCellsPerAxis = 50
cellsX = Math.min(cellsX, maxCellsPerAxis)
cellsY = Math.min(cellsY, maxCellsPerAxis)
cellsZ = Math.min(cellsZ, maxCellsPerAxis)

console.log('targetCells:', targetCells)
console.log('scale:', scale)
console.log('cells:', cellsX, cellsY, cellsZ)
console.log('Total cells:', cellsX * cellsY * cellsZ)

// Now trace what happens in the loop
for (let attempt = 0; attempt < 8; attempt++) {
  const dx = sizeX / cellsX
  const dy = sizeY / cellsY
  const dz = sizeZ / cellsZ

  const cellMap = new Map<string, { sx: number; sy: number; sz: number; cnt: number }>()

  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]
    const y = pos[i + 1]
    const z = pos[i + 2]

    const cx = Math.min(cellsX - 1, Math.floor((x - bounds.min.x) / dx))
    const cy = Math.min(cellsY - 1, Math.floor((y - bounds.min.y) / dy))
    const cz = Math.min(cellsZ - 1, Math.floor((z - bounds.min.z) / dz))

    const key = `${cx}|${cy}|${cz}`
    const entry = cellMap.get(key)
    if (entry) {
      entry.sx += x
      entry.sy += y
      entry.sz += z
      entry.cnt++
    } else {
      cellMap.set(key, { sx: x, sy: y, sz: z, cnt: 1 })
    }
  }

  console.log(`Attempt ${attempt}: cells=${cellsX}x${cellsY}x${cellsZ}=${cellsX*cellsY*cellsZ}, occupied=${cellMap.size}`)

  const cellCentroid = new Map<string, { x: number; y: number; z: number }>()
  for (const [key, v] of cellMap) {
    cellCentroid.set(key, { x: v.sx / v.cnt, y: v.sy / v.cnt, z: v.sz / v.cnt })
  }

  const out: number[] = []
  for (let i = 0; i < pos.length; i += 9) {
    const v0Key = `${Math.min(cellsX - 1, Math.floor((pos[i] - bounds.min.x) / dx))}|` +
                   `${Math.min(cellsY - 1, Math.floor((pos[i + 1] - bounds.min.y) / dy))}|` +
                   `${Math.min(cellsZ - 1, Math.floor((pos[i + 2] - bounds.min.z) / dz))}`
    const v1Key = `${Math.min(cellsX - 1, Math.floor((pos[i + 3] - bounds.min.x) / dx))}|` +
                   `${Math.min(cellsY - 1, Math.floor((pos[i + 4] - bounds.min.y) / dy))}|` +
                   `${Math.min(cellsZ - 1, Math.floor((pos[i + 5] - bounds.min.z) / dz))}`
    const v2Key = `${Math.min(cellsX - 1, Math.floor((pos[i + 6] - bounds.min.x) / dx))}|` +
                   `${Math.min(cellsY - 1, Math.floor((pos[i + 7] - bounds.min.y) / dy))}|` +
                   `${Math.min(cellsZ - 1, Math.floor((pos[i + 8] - bounds.min.z) / dz))}`

    const c0 = cellCentroid.get(v0Key)
    const c1 = cellCentroid.get(v1Key)
    const c2 = cellCentroid.get(v2Key)

    if (c0 && c1 && c2 && (v0Key !== v1Key || v1Key !== v2Key)) {
      out.push(c0.x, c0.y, c0.z, c1.x, c1.y, c1.z, c2.x, c2.y, c2.z)
    }
  }

  const newTriCount = out.length / 9
  console.log(`  -> ${newTriCount} triangles`)

  if (newTriCount > targetTriangles * 1.2) {
    const factor = Math.sqrt(newTriCount / targetTriangles)
    cellsX = Math.min(maxCellsPerAxis, Math.ceil(cellsX * factor))
    cellsY = Math.min(maxCellsPerAxis, Math.ceil(cellsY * factor))
    cellsZ = Math.min(maxCellsPerAxis, Math.ceil(cellsZ * factor))
  } else if (newTriCount < targetTriangles * 0.8) {
    const factor = Math.sqrt(targetTriangles / newTriCount)
    cellsX = Math.max(5, Math.floor(cellsX * factor))
    cellsY = Math.max(5, Math.floor(cellsY * factor))
    cellsZ = Math.max(5, Math.floor(cellsZ * factor))
  } else {
    console.log('  -> converged')
    break
  }
}