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
//  6. THE FRAME RULE. Two different coordinate frames meet inside the seam:
//     the waterline plane is a child of the SCENE and so lives in WORLD
//     coordinates, while the markers are children of the hull GROUP and live in
//     GROUP coordinates. The pivot is a MESH coordinate. Getting any of those
//     three wrong puts the plane or the markers the pivot vector away from the
//     hull — 54.4 mm on the test hull, and 1357 mm with the LCG slider at an
//     end — and it is invisible to every check that only looks at the object's
//     own `.position`, so each one is asserted in WORLD space.
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
  type BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  SphereGeometry,
  Vector3,
} from 'three'
import { applyResultToScene, createLeader } from '../src/components/Viewer3D.js'

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

/**
 * Build the mount-owned objects for one load case.
 *
 * The graph has to be the one the mount pass builds, or checks written in world
 * space read unparented objects and quietly test nothing: the markers ride with
 * the hull (children of `hullGroup`, exactly as in the mount pass), the water
 * plane is a scene child with no parent, and the leader lines come from the
 * component's own factory so `frustumCulled` and `renderOrder` are the shipped
 * values. The use of the real factories is what makes this a regression suite
 * for the component rather than a restatement of it.
 */
function makeRefs() {
  const hullGroup = new Group()
  const hullMesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
  hullGroup.add(hullMesh)

  const waterPlane = new Mesh(new BufferGeometry(), new MeshBasicMaterial())
  const lcgSphere = new Mesh(new SphereGeometry(1), new MeshBasicMaterial())
  hullGroup.add(lcgSphere)
  const lcgLine = createLeader(hullGroup, 0xef4444)
  const lcbSphere = new Mesh(new SphereGeometry(1), new MeshBasicMaterial())
  hullGroup.add(lcbSphere)
  const lcbLine = createLeader(hullGroup, 0x22c55e)

  return { hullGroup, hullMesh, waterPlane, lcgSphere, lcgLine, lcbSphere, lcbLine }
}

/** A fresh set of mount-owned objects for one load case. */
const refsFor = () => ({ ...makeRefs(), keelZ: KEEL_Z, hullCenter: HULL_CENTER })

/**
 * An object's position in WORLD space, after the group matrices are settled
 * with `updateMatrixWorld(true)`. The seam's transforms are only meaningful
 * through their world result: a marker written into a group child with a mesh
 * coordinate lands the pivot vector away from where it belongs, and that is
 * invisible to the child's own `.position` — only the world position sees it.
 */
function worldPosition(o: Object3D): Vector3 {
  return new Vector3().setFromMatrixPosition(o.matrixWorld)
}

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
  // The sphere is a GROUP child, so `.position` holds a group coordinate (mesh
  // minus pivot), and the marker must land on the LCG point in WORLD space.
  // Writing the mesh coordinate straight into the child — the bug this used to
  // pin — displaces it by exactly the pivot vector: 54.4 mm on the test hull at
  // the default LCG, and 1357 mm (half the LOA) with the LCG slider at an end.
  floating.hullGroup.updateMatrixWorld(true)
  const lcgAt = worldPosition(floating.lcgSphere)
  check(
    'lcg sphere sits on the lcg in world space',
    lcgAt.distanceTo(new Vector3(1, 2, 3)) < 1e-6,
    `${lcgAt.toArray().join(', ')} vs lcg 1, 2, 3`,
  )
  check(
    'lcg sphere holds the pivot-relative coordinate',
    floating.lcgSphere.position.toArray().join(',') === '-3,-3,-3',
    `group-local = ${floating.lcgSphere.position.toArray().join(', ')} (lcg 1,2,3 minus pivot 4,5,6)`,
  )
  check(
    'lcg leader line is not frustum culled',
    floating.lcgLine.frustumCulled === false,
    `frustumCulled = ${floating.lcgLine.frustumCulled}`,
  )
  check(
    'lcb leader line is not frustum culled',
    floating.lcbLine.frustumCulled === false,
    `frustumCulled = ${floating.lcbLine.frustumCulled}`,
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
  // THE FRAME RULE, made explicit. The waterline plane is a child of the SCENE
  // while the hull centre is a coordinate of the MESH, so the transform that
  // carries one to the other is the MESH's matrixWorld — the mesh sits offset
  // by -pivot inside the group, and the group's matrixWorld drops that offset.
  // Using the group displaced the plane by the pivot vector (54.4 mm on the
  // test hull at 75 kg, 2.6 % of LWL), and the LCG markers carried the same
  // error by the same route. Both are fixed and asserted here, in world space.
  trimmed.hullGroup.updateMatrixWorld(true)
  const rotated = HULL_CENTER.clone().applyMatrix4(trimmed.hullMesh.matrixWorld)
  const err = Math.hypot(
    trimmed.waterPlane.position.x - rotated.x,
    trimmed.waterPlane.position.y - rotated.y,
  )
  check(
    'waterline centres on the rotated hull centre',
    err < 1e-6,
    `error = ${err.toExponential(2)} mm`,
  )

  // Proof the check above can actually fail: the group matrix gives a
  // different answer, so a regression to it is caught rather than tolerated.
  const viaGroup = HULL_CENTER.clone().applyMatrix4(trimmed.hullGroup.matrixWorld)
  const gap = Math.hypot(
    trimmed.waterPlane.position.x - viaGroup.x,
    trimmed.waterPlane.position.y - viaGroup.y,
  )
  check(
    'the group matrix does not give this answer',
    gap > 0.1,
    `would differ by ${gap.toFixed(2)} mm`,
  )
}

// --- 4. the leader lines are updated in place, not rebuilt ------------------
console.log('\n=== 4. marker leader lines are written in place ===')
{
  const r = refsFor()
  const attrBefore = r.lcgLine.geometry.getAttribute('position') as BufferAttribute
  const arrBefore = attrBefore.array
  const versionBefore = attrBefore.version

  // A pivot distinct from the lcg, so the two are not accidentally equal and
  // the pivot subtraction is forced to show up in the buffer.
  const piv = { x: 1, y: 2, z: 3 }
  applyResultToScene(r, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 11, y: 22, z: 33 },
    lcb: null,
    pivot: piv,
  })
  const a0 = Array.from((r.lcgLine.geometry.getAttribute('position') as BufferAttribute).array)
  check(
    'line runs marker -> keel',
    a0[0] === 10 && a0[1] === 20 && a0[2] === 30 && a0[3] === 10 && a0[4] === 20 && a0[5] === -3,
    `ends = ${a0.join(', ')} (lcg 11,22,33 minus pivot 1,2,3; keel 0 minus 3)`,
  )
  // The whole point of the pivot subtraction: in world space the leader's ends
  // land on the LCG point and on the keel point below it.
  r.hullGroup.updateMatrixWorld(true)
  const top0 = r.lcgLine.localToWorld(new Vector3(a0[0], a0[1], a0[2]))
  const bottom0 = r.lcgLine.localToWorld(new Vector3(a0[3], a0[4], a0[5]))
  check(
    'leader top is the lcg in world space',
    top0.distanceTo(new Vector3(11, 22, 33)) < 1e-6,
    `${top0.toArray().join(', ')} vs lcg 11, 22, 33`,
  )
  check(
    'leader foot is the keel under the lcg',
    bottom0.distanceTo(new Vector3(11, 22, KEEL_Z)) < 1e-6,
    `${bottom0.toArray().join(', ')} vs keel 11, 22, ${KEEL_Z}`,
  )

  applyResultToScene(r, {
    waterlineZ: null,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 99, y: 88, z: 77 },
    lcb: null,
    pivot: piv,
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
    a1[0] === 98 && a1[3] === 98 && a1[5] === -3,
    `ends = ${a1.join(', ')} (lcg 99,88,77 minus pivot 1,2,3; keel 0 minus 3)`,
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
  // The proxy is SHALLOW: it records `refs.<key>` reads, not `<key>.<nested>`
  // ones. The seam already reaches one level deep (`hullGroup.matrixWorld`,
  // which is a transform it must read) and could walk further without this
  // proxy noticing. The mount parents `hullGroup` to a real THREEN.Scene, so
  // the one property that hands out a scene handle is `.parent`; the harness
  // therefore gives the group no parent at all, so a seam that walks up for a
  // scene gets null here and the world-position checks above come apart rather
  // than silently passing. (A read-recording trap on `.parent` was rejected:
  // three.js's own `updateMatrixWorld` reads it internally, so the trap cannot
  // tell the seam's read from the library's.)
  check(
    'the seam cannot walk up to a scene',
    spy.hullGroup.parent === null && spy.hullMesh.parent === spy.hullGroup,
    `hullGroup.parent = ${spy.hullGroup.parent}, hullMesh.parent is the group`,
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
  const piv = { x: 0, y: 0, z: 110 }
  applyResultToScene(r, {
    waterlineZ: 20,
    trimDeg: 0,
    heelDeg: 0,
    lcg: { x: 10, y: 20, z: 60 },
    lcb: null,
    pivot: piv,
  })
  r.hullGroup.updateMatrixWorld(true)
  const ends = Array.from((r.lcgLine.geometry.getAttribute('position') as BufferAttribute).array)
  // The keel Z is a MESH z, so it goes through the same pivot subtraction as
  // the marker; in world space the leader foot lands on the geometry keel.
  check(
    'leader line ends at the geometry keel',
    ends[5] === keel - piv.z,
    `group-local keel z = ${ends[5]} (mesh keel ${keel} minus pivot z ${piv.z})`,
  )
  const foot = r.lcgLine.localToWorld(new Vector3(ends[3], ends[4], ends[5]))
  check(
    'leader foot lands on the keel in world space',
    foot.distanceTo(new Vector3(10, 20, keel)) < 1e-6,
    `${foot.toArray().join(', ')} vs keel point 10, 20, ${keel}`,
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
