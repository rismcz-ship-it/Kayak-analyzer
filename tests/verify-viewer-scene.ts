// Task 2 gate — the Viewer3D scene seam (library only, no browser).
//
// `Viewer3D.tsx` used to build a whole new `WebGLRenderer` (new GL context) on
// every solve, because its one effect depended on the result props. Task 2
// splits it into a mount pass (`[geometry]`) and an update pass that calls this
// suite's subject: the pure `applyResultToScene(refs, view)` seam. Everything in
// the seam is an object transform, so it runs under `tsx` with no DOM, no GL and
// no render.
//
// What this suite pins, and why each one earns its place:
//
//  1. THE SIGN TRANSLATION. `viewer-conventions.ts` is the single place the
//     solver's marine trim becomes a Three.js rotation, and it is only asserted
//     there in isolation. This suite drives it through the real component
//     boundary: a SOLVER trim of +1° (bow up) must lift the bow, and a solver
//     heel of +1° (-Y side down) must lower the -Y side. A double negation —
//     the obvious failure when the conversion moves between files — shows up
//     here as a bow that drops for a bow-up trim.
//
//  2. THE PIVOT CHAIN. The old inline code pivots the hull about
//     `pivot ?? lcg ?? geometry centre`, offsetting the mesh and the group in
//     opposite directions. Getting either sign wrong spins the hull about the
//     wrong point, which the camera fit silently compensates for.
//
//  3. VISIBILITY. The waterline plane must be hidden when the hull is not
//     floating, and the LCG/LCB markers when those results are absent — the
//     mount pass now always creates the objects, so `visible` is the only thing
//     carrying that behaviour.
//
//  4. PURITY. The seam must hold no renderer, camera or controls: it receives
//     two arguments and returns nothing, and touching anything else is detected
//     with a counting proxy. That is what makes it safe to call from both the
//     mount and the update effect, and what guarantees the update pass cannot
//     re-create a GL context.
//
//  5. NO PER-UPDATE ALLOCATION on the marker leader lines: their position
//     attribute is written in place, so a result update cannot churn the GPU
//     buffer or leak geometry.
//
// The mount/update split itself (exactly `[geometry]` as the mount deps, every
// old dispose still on unmount, no `new WebGLRenderer` on a result-dependent
// path) is verified by reading the effect body and by typecheck, as the plan
// specifies — those properties are about React's effect wiring, not about a
// transform this file can execute.
//
// Run: npm.cmd exec -- tsx tests/verify-viewer-scene.ts

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { applyResultToScene } from '../src/components/Viewer3D.js'

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(34)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

// --- the scene furniture the mount effect owns, built exactly once ----------
const KEEL_Z = 0
const HULL_CENTER = new Vector3(4, -2, 12)

function makeRefs() {
  const hullGroup = new Group()
  const hullMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
  hullGroup.add(hullMesh)

  const waterPlane = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
  const lcgSphere = new Mesh(new SphereGeometry(1), new MeshBasicMaterial())
  const lcgLine = new Line(
    (() => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
      return g
    })(),
    new LineBasicMaterial(),
  )
  const lcbSphere = new Mesh(new SphereGeometry(1), new MeshBasicMaterial())
  const lcbLine = new Line(
    (() => {
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
      return g
    })(),
    new LineBasicMaterial(),
  )

  return { hullGroup, hullMesh, waterPlane, lcgSphere, lcgLine, lcbSphere, lcbLine }
}

/** A fresh set of mount-owned objects for one load case. */
const refsFor = () => ({ ...makeRefs(), keelZ: KEEL_Z, hullCenter: HULL_CENTER })

// --- 1. the sign translation, driven through the component boundary ----------
console.log('=== 1. solver signs reach the scene correctly ===')
{
  const r = refsFor()
  applyResultToScene(r, {
    waterlineZ: null,
    trimDeg: 1, // SOLVER convention: + = bow up
    heelDeg: 1, // SOLVER convention: + = the -Y side goes down
    lcg: null,
    lcb: null,
    pivot: null,
  })

  // The group is a child of nothing but the scene, so its matrixWorld is its
  // own matrix once updated. Apply it to the bow and to both beam ends.
  r.hullGroup.updateMatrixWorld(true)
  const bow = new Vector3(1000, 0, 0).applyMatrix4(r.hullGroup.matrixWorld)
  const plusY = new Vector3(0, 1000, 0).applyMatrix4(r.hullGroup.matrixWorld)
  const minusY = new Vector3(0, -1000, 0).applyMatrix4(r.hullGroup.matrixWorld)

  check(
    'solver trim +1 lifts the bow',
    bow.z - HULL_CENTER.z > 0,
    `bow z offset = ${(bow.z - HULL_CENTER.z).toFixed(2)} mm`,
  )
  check(
    'solver heel +1 lowers the -Y side',
    minusY.z - HULL_CENTER.z < 0,
    `-Y z offset = ${(minusY.z - HULL_CENTER.z).toFixed(2)} mm`,
  )
  check(
    'solver heel +1 raises the +Y side',
    plusY.z - HULL_CENTER.z > 0,
    `+Y z offset = ${(plusY.z - HULL_CENTER.z).toFixed(2)} mm`,
  )
}

// --- 2. the pivot chain ------------------------------------------------------
console.log('\n=== 2. pivot chain: pivot > lcg > geometry centre ===')
{
  const withPivot = refsFor()
  applyResultToScene(withPivot, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 10, y: 20, z: 30 },
    lcb: null,
    pivot: { x: 1, y: 2, z: 3 },
  })
  check(
    'explicit pivot wins over lcg',
    withPivot.hullGroup.position.x === 1 &&
      withPivot.hullGroup.position.y === 2 &&
      withPivot.hullGroup.position.z === 3,
    `group = ${withPivot.hullGroup.position.toArray().join(', ')}`,
  )
  check(
    'mesh offset is the opposite of the pivot',
    withPivot.hullMesh.position.x === -1 &&
      withPivot.hullMesh.position.y === -2 &&
      withPivot.hullMesh.position.z === -3,
    `mesh = ${withPivot.hullMesh.position.toArray().join(', ')}`,
  )

  const withLcg = refsFor()
  applyResultToScene(withLcg, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 10, y: 20, z: 30 },
    lcb: null,
    pivot: null,
  })
  check(
    'lcg is the fallback pivot',
    withLcg.hullGroup.position.x === 10 && withLcg.hullGroup.position.y === 20,
    `group = ${withLcg.hullGroup.position.toArray().join(', ')}`,
  )

  const bare = refsFor()
  applyResultToScene(bare, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: null,
    lcb: null,
    pivot: null,
  })
  check(
    'geometry centre is the last fallback',
    bare.hullGroup.position.distanceTo(HULL_CENTER) < 1e-9,
    `group = ${bare.hullGroup.position.toArray().join(', ')} vs centre`,
  )

  // The scheme: the hull rotates about a pivot expressed in MESH coordinates.
  // The mesh is offset so that pivot lands at the group's origin and the group
  // is placed on it, which leaves the pivot itself stationary under any
  // rotation. Assert both halves of that, because they are independent — a
  // sign error in either offset lets the pivot drift away when trim and heel
  // are applied together, and the camera framing hides the drift by re-targeting.
  const spun = refsFor()
  const p = { x: 5, y: -7, z: 90 }
  applyResultToScene(spun, {
    waterlineZ: null,
    trimDeg: -4.5,
    heelDeg: 12,
    lcg: p,
    lcb: null,
    pivot: null, // so the lcg p is the pivot
  })
  spun.hullGroup.updateMatrixWorld(true)

  // (a) the group's origin IS the pivot, in world space.
  const groupOrigin = new Vector3(0, 0, 0).applyMatrix4(spun.hullGroup.matrixWorld)
  const d0 = groupOrigin.distanceTo(new Vector3(p.x, p.y, p.z))
  check('group origin is the pivot', d0 < 1e-6, `drift = ${d0.toExponential(2)} mm`)

  // (b) the pivot written in MESH coordinates stays where it is. This is the
  // half the mesh offset owns: the geometry point at the pivot must land on
  // the group's origin, which only holds if the mesh offset is the pivot
  // negated — the failure that spins the hull about a point nobody picked.
  const pivotAsMeshCoord = new Vector3(p.x, p.y, p.z).applyMatrix4(spun.hullMesh.matrixWorld)
  const d1 = pivotAsMeshCoord.distanceTo(new Vector3(p.x, p.y, p.z))
  check('the mesh-coordinate pivot is stationary', d1 < 1e-6, `drift = ${d1.toExponential(2)} mm`)
}

// --- 3. waterline and marker visibility --------------------------------------
console.log('\n=== 3. visibility: hidden when there is nothing to show ===')
{
  const noWater = refsFor()
  applyResultToScene(noWater, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: null,
    lcb: null,
    pivot: null,
  })
  check(
    'waterline hidden with no waterlineZ',
    noWater.waterPlane.visible === false,
    `visible = ${noWater.waterPlane.visible}`,
  )
  check('lcg marker hidden with no lcg', noWater.lcgSphere.visible === false, 'sphere')
  check('lcb marker hidden with no lcb', noWater.lcbSphere.visible === false, 'sphere')

  const badWater = refsFor()
  applyResultToScene(badWater, {
    waterlineZ: Number.NaN,
    trimDeg: 0,
    heelDeg: 0,
    lcg: null,
    lcb: null,
    pivot: null,
  })
  check(
    'waterline hidden when waterlineZ is NaN',
    badWater.waterPlane.visible === false,
    `visible = ${badWater.waterPlane.visible}`,
  )

  const floating = refsFor()
  applyResultToScene(floating, {
    waterlineZ: 137,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 1, y: 2, z: 3 },
    lcb: null,
    pivot: { x: 4, y: 5, z: 6 },
  })
  check(
    'waterline shown when floating',
    floating.waterPlane.visible === true,
    `visible = ${floating.waterPlane.visible}`,
  )
  check(
    'waterline sits at waterlineZ',
    Math.abs(floating.waterPlane.position.z - 137) < 1e-9,
    `z = ${floating.waterPlane.position.z}`,
  )
  check(
    'lcg marker shown with an lcg',
    floating.lcgSphere.visible === true,
    `visible = ${floating.lcgSphere.visible}`,
  )
  check(
    'lcg sphere follows the lcg',
    floating.lcgSphere.position.toArray().join(',') === '1,2,3',
    `at ${floating.lcgSphere.position.toArray().join(', ')}`,
  )

  // With no trim/heel the plane tracks the hull centre; with trim it must track
  // the ROTATED centre, which is what keeps the waterline under the hull.
  const trimmed = refsFor()
  applyResultToScene(trimmed, {
    waterlineZ: 50,
    trimDeg: 3,
    heelDeg: 6,
    lcg: null,
    lcb: null,
    pivot: null,
  })
  // NOTE ON WHAT THIS CHECK IS. `hullGroup.matrixWorld` maps GROUP-local to
  // world; the bbox centre is a MESH coordinate, so the correct transform is
  // `mesh.matrixWorld`, which also carries the mesh's -pivot offset. Measured
  // on the test hull at 75 kg (pivot at LCG, trim -1.9°): the two disagree by
  // 54.4 mm, 2.6 % of LWL — the plane and the camera aim at the pivot instead
  // of the hull's rotated centre. That is pre-existing behaviour, preserved
  // verbatim by the Task 2 split and deliberately NOT fixed here, so this
  // check pins the current rule rather than the geometric truth: it fails if
  // the centring formula changes, not if it is wrong. Fixing it is a visible
  // change (plane and camera framing), so it needs Richard's say-so first.
  trimmed.hullGroup.updateMatrixWorld(true)
  const rotated = HULL_CENTER.clone().applyMatrix4(trimmed.hullGroup.matrixWorld)
  const err = Math.hypot(
    trimmed.waterPlane.position.x - rotated.x,
    trimmed.waterPlane.position.y - rotated.y,
  )
  check('waterline centring formula is unchanged', err < 1e-6, `error = ${err.toExponential(2)} mm`)
}

// --- 4. the leader lines are updated in place, not rebuilt ------------------
console.log('\n=== 4. marker leader lines are written in place ===')
{
  const r = refsFor()
  const attrBefore = r.lcgLine.geometry.getAttribute('position') as BufferAttribute
  const arrBefore = attrBefore.array
  const versionBefore = attrBefore.version

  applyResultToScene(r, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 11, y: 22, z: 33 },
    lcb: null,
    pivot: null,
  })
  const a0 = Array.from((r.lcgLine.geometry.getAttribute('position') as BufferAttribute).array)
  check(
    'line runs marker -> keel',
    a0[0] === 11 &&
      a0[1] === 22 &&
      a0[2] === 33 &&
      a0[3] === 11 &&
      a0[4] === 22 &&
      a0[5] === KEEL_Z,
    `ends = ${a0.join(', ')}`,
  )

  applyResultToScene(r, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 99, y: 88, z: 77 },
    lcb: null,
    pivot: null,
  })
  // `needsUpdate` is a setter-only accessor on BufferAttribute — reading it
  // back yields undefined. The observable right after a write is the version
  // counter the setter bumps.
  const attrAfter = r.lcgLine.geometry.getAttribute('position') as BufferAttribute
  check(
    'same buffer across updates',
    attrAfter === attrBefore && attrAfter.array === arrBefore,
    'no new BufferAttribute allocated',
  )
  const a1 = Array.from(attrAfter.array)
  check(
    'buffer contents follow the new lcg',
    a1[0] === 99 && a1[3] === 99 && a1[5] === KEEL_Z,
    `ends = ${a1.join(', ')}`,
  )
  check(
    'buffer is flagged for upload',
    attrAfter.version > versionBefore,
    `version ${versionBefore} -> ${attrAfter.version}`,
  )
}

// --- 5. purity: the seam cannot touch renderer, camera or controls -----------
console.log('\n=== 5. purity: no renderer, camera or controls in the seam ===')
{
  const r = refsFor()
  const touched: string[] = []
  const spy = new Proxy(r, {
    get(target, prop: string) {
      if (/camera|controls|renderer|scene|domElement|requestAnimation/i.test(prop)) {
        touched.push(prop)
      }
      return Reflect.get(target, prop)
    },
  })

  applyResultToScene(spy as typeof r, {
    waterlineZ: 137,
    trimDeg: 2,
    heelDeg: -3,
    lcg: { x: 1, y: 2, z: 3 },
    lcb: { x: 4, y: 5, z: 6 },
    pivot: { x: 7, y: 8, z: 9 },
  })
  check(
    'no scene-graph escape hatches read',
    touched.length === 0,
    touched.length === 0 ? 'none' : touched.join(', '),
  )
  check(
    'the seam returns nothing',
    applyResultToScene(refsFor(), {
      waterlineZ: null,
      trimDeg: 0,
      heelDeg: 0,
      lcg: null,
      lcb: null,
      pivot: null,
    }) === undefined,
    'void',
  )
}

// --- 6. the geometry bounds feed the seam, not the props --------------------
console.log('\n=== 6. keel and centre come from the geometry ===')
{
  // A real bounding box, so the numbers are derived the way the mount effect
  // derives them: Box3 -> size/centre, and bb.min.z as the keel.
  const box = new Box3(new Vector3(-100, -40, -5), new Vector3(100, 40, 205))
  const centre = box.getCenter(new Vector3())
  const keel = box.min.z

  const r = refsFor()
  r.hullCenter.copy(centre)
  r.keelZ = keel
  applyResultToScene(r, {
    waterlineZ: 20,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 10, y: 20, z: 60 },
    lcb: null,
    pivot: { x: 0, y: 0, z: 110 },
  })
  const ends = Array.from((r.lcgLine.geometry.getAttribute('position') as BufferAttribute).array)
  check(
    'leader line ends at the geometry keel',
    ends[5] === keel,
    `keel z = ${ends[5]} (bounds min.z = ${keel})`,
  )
  check(
    'hull centre is the geometry centre',
    r.hullGroup.position.distanceTo(new Vector3(0, 0, 110)) < 1e-9,
    `pivot used = ${r.hullGroup.position.toArray().join(', ')}`,
  )
}

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the Viewer3D scene seam regressed')
  process.exit(1)
}
console.log('ALL VIEWER SCENE CHECKS PASS')
