// Task 5 gate — the Compare overlay scene seam (library only, no browser).
//
// Task 5 builds the overlay viewer: two solved hulls on ONE shared water
// surface, each semi-transparent in its own colour, each offset vertically by
// its own draft so the deeper hull visibly sits lower. Three additive exports
// in `Viewer3D.tsx` carry it, and this suite drives them against the same
// object graph the single viewer builds — `makeSlotScene` reuses `createLeader`
// and the mount-pass construction, so a check written in world space reads a
// real parented hull and quietly tests something.
//
// What this suite pins, and why each one earns its place:
//
//  1. THE SHARED SURFACE. `applySharedWaterSurface` puts each slot's wrapper
//     at z = -waterlineZ, so BOTH hulls' midship waterline points land on
//     world Z 0. A deeper hull therefore sits visibly lower — the whole point
//     of the overlay (Review Focus 2 of the design review: a hull that draws
//     30 mm more water must LOOK 30 mm deeper). A wrapper offset that is
//     signed the other way would float the deep hull above the shallow one.
//     Posing a hull lifts its midship point out of plane by the rotation
//     residual dz*(cos(theta)-1) — a translation datum, not a re-pose — so
//     sections 2 and 3 pin that analytic value: tenths of a millimetre at the
//     app's sweep, and a first-order error still fails the check.
//
//  2. THE DIVISION OF LABOUR. Two seams meet on one scene: the POSE seam
//     (`applySlotResultToScene`, the single-viewer math by deliberate
//     delegation) and the WATER seam (`applySharedWaterSurface`). Neither may
//     do the other's job: a pose seam that also wrote the wrapper would make
//     the shared water surface drift with the trim, and a water seam that also
//     rewrote the hull matrices would re-pose the hull from the water side.
//
//  3. THE SIGN TRANSLATION at the slot boundary. The frozen spec is unchanged:
//     solver trim + = bow up, solver heel + = the -Y side goes down, and the
//     one translation to Three.js lives in `viewer-conventions.ts` and is
//     applied inside the pose seam. A double negation here shows up as a hull
//     whose bow drops for a bow-up trim.
//
//  4. IDEMPOTENCE. The UI re-poses on every keystroke, and the water seam runs
//     again whenever either slot re-solves. Re-applying must equal a fresh
//     slot: a wrapper offset that accumulated would sink a hull without limit
//     over a session.
//
//  5. PURITY. Same contract as the single-viewer seam: no renderer, camera or
//     controls keys read, nothing returned.
//
// The plane's geometry is the UNIT square the seam scales — the harness builds
// `PlaneGeometry(1, 1)` and `applySharedWaterSurface` sizes it, exactly the
// split Task 6's compare mount makes.
//
// What this suite does NOT cover: Task 6's JSX (the slot panels, the roster
// picker) and the browser render itself — those are covered by typecheck,
// biome check and a read-through.
//
// Run: npm.cmd exec -- tsx tests/verify-compare-scene.ts

import { Box3, type BufferAttribute, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import {
  applySharedWaterSurface,
  applySlotResultToScene,
  makeSlotScene,
  SLOT_COLORS,
  type SlotScene,
  type ViewerView,
} from '../src/components/Viewer3D.js'

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(38)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

// --- the two test hulls -----------------------------------------------------
//
// Two boxes, both centred on the origin in x/y so the wrapper's x/y stay 0 and
// every world-space expectation is a one-axis number. Hull A is the longer,
// shallower one; hull B is shorter and deeper (keel -100 for both, deck 400),
// so a shared surface at each own waterline puts B 30 mm lower than A.

const A_MIN = [-1000, -250, -100] as const
const A_MAX = [1000, 250, 250] as const
const B_MIN = [-900, -200, -100] as const
const B_MAX = [900, 200, 400] as const
const A_CENTER = new Vector3(0, 0, 75)
const B_CENTER = new Vector3(0, 0, 150)
const WL_A = 100
const WL_B = 130

/** Axis-aligned closed box mesh from (minX,minY,minZ) to (maxX,maxY,maxZ). */
function boxPositions(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Float32Array {
  const corner = (i: number): [number, number, number] => [
    i & 4 ? maxX : minX,
    i & 2 ? maxY : minY,
    i & 1 ? maxZ : minZ,
  ]
  const faces: [number, number, number, number][] = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ]
  const v: number[] = []
  for (const [a, b, c, d] of faces) {
    v.push(...corner(a), ...corner(b), ...corner(c))
    v.push(...corner(a), ...corner(c), ...corner(d))
  }
  return new Float32Array(v)
}

/** A full ViewerView with the defaults spelled out, patched per case. */
const view = (patch: Partial<ViewerView> = {}): ViewerView => ({
  waterlineZ: null,
  trimDeg: 0,
  heelDeg: 0,
  lcg: null,
  lcb: null,
  pivot: null,
  ...patch,
})

/** One slot per hull, as Task 6 mounts them. */
function twoSlots(): { a: SlotScene; b: SlotScene } {
  return {
    a: makeSlotScene(boxPositions(...A_MIN, ...A_MAX), SLOT_COLORS[0], 0.45),
    b: makeSlotScene(boxPositions(...B_MIN, ...B_MAX), SLOT_COLORS[1], 0.45),
  }
}

/** The unit-square plane the water seam sizes, as Task 6's mount builds it. */
function unitPlane(): Mesh {
  return new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ transparent: true }))
}

/**
 * A mesh point's position in WORLD space, after the wrapper graph is settled
 * with `updateMatrixWorld(true)`. Everything the overlay promises is only
 * observable through the world result: the wrapper offset, the pivot and the
 * group rotation all compose inside the matrices, and each one's own
 * `.position` hides the others.
 */
function worldOf(slot: SlotScene, p: { x: number; y: number; z: number }): Vector3 {
  slot.wrapper.updateMatrixWorld(true)
  return new Vector3(p.x, p.y, p.z).applyMatrix4(slot.refs.hullMesh.matrixWorld)
}

const rad = (deg: number) => (deg * Math.PI) / 180

// --- 1. the shared water surface -------------------------------------------
console.log('=== 1. both midship waterlines land on world Z 0 ===')
{
  check(
    'SLOT_COLORS holds two distinct colours',
    SLOT_COLORS.length === 2 && SLOT_COLORS[0] !== SLOT_COLORS[1],
    SLOT_COLORS.map((c) => `0x${c.toString(16)}`).join(', '),
  )

  const a = makeSlotScene(boxPositions(...A_MIN, ...A_MAX), SLOT_COLORS[0], 0.45)
  const attr = a.refs.hullMesh.geometry.getAttribute('position') as BufferAttribute
  check(
    'the hull mesh is built from the given positions',
    attr.count === 36,
    `${attr.count} vertices`,
  )

  const mat = a.refs.hullMesh.material as MeshBasicMaterial
  check(
    'the hull material is transparent and never depth-writes',
    mat.transparent === true && mat.depthWrite === false && mat.opacity === 0.45,
    `transparent ${mat.transparent}, depthWrite ${mat.depthWrite}, opacity ${mat.opacity}`,
  )
  check(
    'the hull carries the given slot colour',
    mat.color.getHex() === SLOT_COLORS[0],
    `0x${mat.color.getHex().toString(16)}`,
  )
  check(
    'the shared water plane is NOT part of a slot',
    a.refs.waterPlane === null,
    'refs.waterPlane is null, so the pose seam has no plane to hide or move',
  )
  check(
    'the hull group rides under the wrapper',
    a.refs.hullMesh.parent === a.refs.hullGroup && a.refs.hullGroup.parent === a.wrapper,
    'wrapper -> hullGroup -> hullMesh',
  )
  check(
    'keel and centre come from the geometry bounds',
    a.refs.keelZ === -100 && a.refs.hullCenter.distanceTo(A_CENTER) < 1e-9,
    `keel ${a.refs.keelZ}, centre ${a.refs.hullCenter.toArray().join(', ')}`,
  )
  check(
    'the leaders come from the component factory',
    a.refs.lcgLine?.parent === a.refs.hullGroup && a.refs.lcbLine?.parent === a.refs.hullGroup,
    'both lines are children of the hull group',
  )

  const { b } = twoSlots()
  check(
    "hull B's own bounds feed its refs",
    b.refs.keelZ === -100 && b.refs.hullCenter.distanceTo(B_CENTER) < 1e-9,
    `keel ${b.refs.keelZ}, centre ${b.refs.hullCenter.toArray().join(', ')}`,
  )
  applySlotResultToScene(a, view({ waterlineZ: WL_A }))
  applySlotResultToScene(b, view({ waterlineZ: WL_B }))
  const plane = unitPlane()
  applySharedWaterSurface(
    [
      { slot: a, waterlineZ: WL_A },
      { slot: b, waterlineZ: WL_B },
    ],
    plane,
  )

  const aWater = worldOf(a, { x: 0, y: 0, z: WL_A })
  check(
    "hull A's midship waterline point is at world Z 0",
    Math.abs(aWater.z) < 1e-9 && Math.abs(aWater.x) < 1e-9 && Math.abs(aWater.y) < 1e-9,
    aWater
      .toArray()
      .map((n) => n.toFixed(9))
      .join(', '),
  )
  const bWater = worldOf(b, { x: 0, y: 0, z: WL_B })
  check(
    "hull B's midship waterline point is at world Z 0",
    Math.abs(bWater.z) < 1e-9 && Math.abs(bWater.x) < 1e-9 && Math.abs(bWater.y) < 1e-9,
    bWater
      .toArray()
      .map((n) => n.toFixed(9))
      .join(', '),
  )

  check(
    'each wrapper sits exactly at minus its own waterline',
    a.wrapper.position.z === -WL_A && b.wrapper.position.z === -WL_B,
    `A ${a.wrapper.position.z}, B ${b.wrapper.position.z}`,
  )
  check(
    'the deeper hull sits 30 mm lower',
    b.wrapper.position.z === a.wrapper.position.z - 30,
    `B ${b.wrapper.position.z} vs A ${a.wrapper.position.z} (a wrapper signed the other way would put B above A)`,
  )

  check(
    'the plane is centred on the union at world Z 0',
    plane.position.x === 0 && plane.position.y === 0 && plane.position.z === 0,
    plane.position.toArray().join(', '),
  )
  const world = new Box3().setFromObject(plane)
  const w = world.max.x - world.min.x
  const d = world.max.y - world.min.y
  check(
    'the plane covers both hulls (union, 1.2x)',
    world.min.x <= -1000 && world.max.x >= 1000 && world.min.y <= -250 && world.max.y >= 250,
    `x ${world.min.x.toFixed(1)}..${world.max.x.toFixed(1)}, y ${world.min.y.toFixed(1)}..${world.max.y.toFixed(1)}`,
  )
  check(
    'the plane is sized from the UNION, not one slot',
    Math.abs(w - 2400) < 1e-6 && Math.abs(d - 600) < 1e-6,
    `${w.toFixed(1)} x ${d.toFixed(1)} mm; from B alone it would be 2160 x 480`,
  )
}

// --- 2. trim: the bow end goes UP ------------------------------------------
console.log('\n=== 2. a solver trim of +3.60 degrees lifts the bow ===')
{
  const { a } = twoSlots()
  applySlotResultToScene(a, view({ waterlineZ: WL_A, trimDeg: 3.6 }))
  const plane = unitPlane()
  applySharedWaterSurface([{ slot: a, waterlineZ: WL_A }], plane)

  const bow = worldOf(a, { x: 1000, y: 0, z: 75 })
  const stern = worldOf(a, { x: -1000, y: 0, z: 75 })
  const rise = bow.z - stern.z
  const expected = 2 * 1000 * Math.sin(rad(3.6))
  check(
    'the bow end is above the stern end',
    rise > 0,
    `bow ${bow.z.toFixed(3)} vs stern ${stern.z.toFixed(3)} mm`,
  )
  check(
    'the rise is the full-length heel of the trim',
    Math.abs(rise - expected) < 1e-6,
    `${rise.toFixed(6)} vs ${expected.toFixed(6)} mm (2000 * sin 3.6 deg)`,
  )
  // The shared surface survives a pure trim up to the rotation residual
  // dz*(cos(theta)-1): the wrapper offset is a TRANSLATION datum, so posing the
  // hull lifts its midship waterline point out of plane by that second-order
  // amount - tenths of a millimetre at the app's +/-4.5 deg sweep, and
  // invisible next to a 125 mm trim raise. Zero pose (section 1) is exact; the
  // check here pins the analytic value, so a seam that moved the datum by a
  // first-order amount fails.
  const mid = worldOf(a, { x: 0, y: 0, z: WL_A })
  const residual = (WL_A - A_CENTER.z) * (Math.cos(rad(3.6)) - 1)
  check(
    'the shared surface carries only the rotation residual under the trim',
    Math.abs(mid.z - residual) < 1e-9 && Math.abs(residual) < 1,
    `midship waterline at world Z ${mid.z.toFixed(9)} vs residual ${residual.toFixed(9)} mm`,
  )
  check(
    'the pose seam left the water plane alone',
    Math.abs(plane.position.x) < 1e-9 &&
      Math.abs(plane.position.y) < 1e-9 &&
      Math.abs(plane.position.z) < 1e-9,
    plane.position
      .toArray()
      .map((n) => n.toExponential(1))
      .join(', '),
  )
}

// --- 3. heel: the -Y side goes DOWN ----------------------------------------
console.log('\n=== 3. a solver heel of +10 degrees drops the -Y side ===')
{
  const { a } = twoSlots()
  applySlotResultToScene(a, view({ waterlineZ: WL_A, heelDeg: 10 }))
  const plane = unitPlane()
  applySharedWaterSurface([{ slot: a, waterlineZ: WL_A }], plane)

  const pos = worldOf(a, { x: 0, y: 250, z: 75 })
  const neg = worldOf(a, { x: 0, y: -250, z: 75 })
  const drop = pos.z - neg.z
  const expected = 2 * 250 * Math.sin(rad(10))
  check(
    'the -Y side is the lower one',
    neg.z < pos.z,
    `-Y side ${neg.z.toFixed(3)} vs +Y side ${pos.z.toFixed(3)} mm`,
  )
  check(
    'the drop is the full-beam heel',
    Math.abs(drop - expected) < 1e-6,
    `${drop.toFixed(6)} vs ${expected.toFixed(6)} mm (500 * sin 10 deg)`,
  )
  const mid = worldOf(a, { x: 0, y: 0, z: WL_A })
  const residual = (WL_A - A_CENTER.z) * (Math.cos(rad(10)) - 1)
  check(
    'the shared surface carries only the rotation residual under the heel',
    Math.abs(mid.z - residual) < 1e-9 && Math.abs(residual) < 1,
    `midship waterline at world Z ${mid.z.toFixed(9)} vs residual ${residual.toFixed(9)} mm`,
  )
  check(
    'the pose seam left the water plane alone',
    Math.abs(plane.position.x) < 1e-9 &&
      Math.abs(plane.position.y) < 1e-9 &&
      Math.abs(plane.position.z) < 1e-9,
    plane.position
      .toArray()
      .map((n) => n.toExponential(1))
      .join(', '),
  )
}

// --- 4. re-applying equals a fresh slot ------------------------------------
console.log('\n=== 4. a re-apply is identical to a fresh slot ===')
{
  const { a: twice } = twoSlots()
  const { a: once } = twoSlots()
  const first = view({ waterlineZ: WL_A, trimDeg: 1.5, heelDeg: 2 })
  applySlotResultToScene(twice, first)
  applySharedWaterSurface([{ slot: twice, waterlineZ: WL_A }], unitPlane())
  // The whole result, again, without touching the scene in between.
  applySlotResultToScene(twice, first)
  applySharedWaterSurface([{ slot: twice, waterlineZ: WL_A }], unitPlane())

  applySlotResultToScene(once, first)
  applySharedWaterSurface([{ slot: once, waterlineZ: WL_A }], unitPlane())

  const m1 = Array.from(twice.refs.hullMesh.matrixWorld.elements)
  const m2 = Array.from(once.refs.hullMesh.matrixWorld.elements)
  const drift = Math.max(...m1.map((v, i) => Math.abs(v - m2[i])))
  check(
    'two passes leave the hull exactly where one does',
    drift < 1e-12 && twice.wrapper.position.z === once.wrapper.position.z,
    `max element drift ${drift.toExponential(2)} mm, wrapper z ${twice.wrapper.position.z}`,
  )

  // A DIFFERENT result must move the wrapper to the new waterline exactly once:
  // an accumulating offset would sink the hull further on every re-solve.
  const zBefore = twice.wrapper.position.z
  applySharedWaterSurface([{ slot: twice, waterlineZ: 80 }], unitPlane())
  check(
    'a changed waterline moves the wrapper by exactly its delta',
    twice.wrapper.position.z === -80 && zBefore === -WL_A,
    `${zBefore} -> ${twice.wrapper.position.z}`,
  )
}

// --- 5. purity and the division of labour ----------------------------------
console.log('\n=== 5. purity: each seam touches only what it is handed ===')
{
  const { a } = twoSlots()
  const touched: string[] = []
  const spy = (target: object): object =>
    new Proxy(target, {
      get(t, prop: string) {
        if (/camera|controls|renderer|scene|domElement|requestAnimation/i.test(prop))
          touched.push(prop)
        return Reflect.get(t, prop)
      },
    })

  const proxied = { wrapper: spy(a.wrapper), refs: spy(a.refs) } as unknown as SlotScene
  applySlotResultToScene(
    proxied,
    view({
      waterlineZ: WL_A,
      trimDeg: 1,
      heelDeg: -2,
      lcg: { x: 1, y: 2, z: 3 },
      lcb: { x: 4, y: 5, z: 6 },
      pivot: { x: 7, y: 8, z: 9 },
    }),
  )
  check(
    'the pose seam reads no scene-graph escape hatches',
    touched.length === 0,
    touched.length === 0 ? 'none' : touched.join(', '),
  )

  const touchedWater: string[] = []
  const { a: w } = twoSlots()
  const proxiedSlot = { wrapper: spy(w.wrapper), refs: spy(w.refs) } as unknown as SlotScene
  applySharedWaterSurface([{ slot: proxiedSlot, waterlineZ: WL_A }], unitPlane())
  check(
    'the water seam reads no scene-graph escape hatches',
    touchedWater.length === 0,
    touchedWater.length === 0 ? 'none' : touchedWater.join(', '),
  )

  // Division of labour, directly: a sentinel wrapper Z survives the pose, and
  // the hull matrices survive the water seam. A seam that reached across would
  // show up here as a moved sentinel or a re-posed hull.
  const sentinel = -777
  const { a: s } = twoSlots()
  s.wrapper.position.z = sentinel
  applySlotResultToScene(s, view({ waterlineZ: WL_A, trimDeg: 4, heelDeg: 5 }))
  check(
    'the pose seam leaves the wrapper offset alone',
    s.wrapper.position.z === sentinel,
    `sentinel ${sentinel} survived a 4 deg trim and a 5 deg heel`,
  )
  // The pose INSIDE the wrapper: the wrapper translation is the water seam's
  // own job, so what must survive a water call is the hull's placement within
  // it - the group position, the group rotation and the mesh offset. Snapshotted
  // as numbers, because matrixWorld would also move by the wrapper change.
  const poseOf = (slot: SlotScene) => [
    slot.refs.hullGroup.position.x,
    slot.refs.hullGroup.position.y,
    slot.refs.hullGroup.position.z,
    slot.refs.hullGroup.rotation.x,
    slot.refs.hullGroup.rotation.y,
    slot.refs.hullGroup.rotation.z,
    slot.refs.hullMesh.position.x,
    slot.refs.hullMesh.position.y,
    slot.refs.hullMesh.position.z,
  ]
  const poseBefore = poseOf(s)
  applySharedWaterSurface([{ slot: s, waterlineZ: 40 }], unitPlane())
  const poseAfter = poseOf(s)
  const poseDrift = Math.max(...poseBefore.map((v, i) => Math.abs(v - poseAfter[i])))
  check(
    'the water seam leaves the hull pose alone',
    poseDrift === 0 && s.wrapper.position.z === -40,
    `max pose drift ${poseDrift.toExponential(2)} mm, wrapper moved to ${s.wrapper.position.z}`,
  )

  check(
    'both seams return nothing',
    applySlotResultToScene(s, view()) === undefined &&
      applySharedWaterSurface([], unitPlane()) === undefined,
    'void',
  )
}

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the compare scene seam regressed')
  process.exit(1)
}
console.log('ALL COMPARE SCENE CHECKS PASS')
