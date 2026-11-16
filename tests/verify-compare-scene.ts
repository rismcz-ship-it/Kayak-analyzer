// Task 5 gate — the Compare overlay scene seam (library only, no browser).
//
// Task 5 builds the overlay viewer: two solved hulls on ONE shared water
// surface, each semi-transparent in its own colour, each offset vertically by
// its own draft so the deeper hull visibly sits lower. Five additive exports
// in `Viewer3D.tsx` carry it - `SLOT_COLORS`, `makeSlotScene`,
// `applySlotResultToScene`, `applySharedWaterSurface` and `disposeSlotScene` -
// and this suite drives them against the same object graph the single viewer
// builds: `makeSlotScene` reuses `createLeader` and the mount-pass
// construction, so a check written in world space reads a real parented hull
// and quietly tests something.
//
// What this suite pins, and why each one earns its place:
//
//  1. THE SHARED SURFACE. `applySharedWaterSurface` drops each slot so its
//     hull's MIDSHIP WATERLINE POINT (x = y = 0, z = waterlineZ - the station
//     the solver reports its waterline at) lands exactly on world Z 0, under
//     ANY pose. A deeper hull therefore sits visibly lower - the whole point of
//     the overlay (Review Focus 2 of the design review: a hull that draws
//     30 mm more water must LOOK 30 mm deeper). A wrapper offset that is signed
//     the other way would float the deep hull above the shallow one. The drop
//     is POSE-AWARE because the pose seam rotates the hull about its pivot:
//     the plain `-waterlineZ` a first draft used leaves a FIRST-order
//     p.x*sin(trim) error (~31 mm at a 500 mm pivot X and 3.6 deg, ~50 mm at a
//     20 % LCG on the real hull) that is larger than the draft difference the
//     overlay exists to show, so sections 2 and 3 assert the exact landing and
//     pin that regression with a pivot offset of their own.
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
//  5. DISPOSE. Slots are rebuilt on every re-pick, so `disposeSlotScene` must
//     reach every geometry and material the slot owns.
//
//  6. PURITY. Same contract as the single-viewer seam: no renderer, camera or
//     controls keys read, nothing returned.
//
// The plane's geometry is the UNIT square by default, and the seam also accepts
// an already-sized plane: the scale is target / geometry extent, so Task 6's
// mount may build either shape.
//
// What this suite does NOT cover: Task 6's JSX (the slot panels, the roster
// picker) and the browser render itself — those are covered by typecheck,
// biome check and a read-through.
//
// Run: npm.cmd exec -- tsx tests/verify-compare-scene.ts

import {
  Box3,
  type BufferAttribute,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from 'three'
import {
  applySharedWaterSurface,
  applySlotResultToScene,
  disposeSlotScene,
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
// Two boxes, both centred on the origin in Z so each slot's wrapper stays a
// pure-Z translation and every world-space expectation is a one-axis number.
// Hull A is the longer, shallower one; hull B is shorter and deeper (keel -100
// for both, deck 400), so a shared surface at each own waterline puts B 30 mm
// lower than A.
//
// B is NOT centred in x/y on purpose: it reaches 1100 mm aft of A's forward end
// point and stops short of it forward, and it is narrower in beam. So the union
// of the two is strictly larger than EITHER box - a "sized from the union"
// check would be vacuous if A contained B, which is what the first draft of
// this fixture did.

const A_MIN = [-1000, -250, -100] as const
const A_MAX = [1000, 250, 250] as const
const B_MIN = [-900, -220, -100] as const
const B_MAX = [1100, 220, 400] as const
const A_CENTER = new Vector3(0, 0, 75)
const B_CENTER = new Vector3(100, 0, 150)
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
    plane.position.x === 50 && plane.position.y === 0 && plane.position.z === 0,
    plane.position.toArray().join(', '),
  )
  const world = new Box3().setFromObject(plane)
  const w = world.max.x - world.min.x
  const d = world.max.y - world.min.y
  check(
    'the plane covers both hulls (union, 1.2x)',
    world.min.x <= -1000 && world.max.x >= 1100 && world.min.y <= -250 && world.max.y >= 250,
    `x ${world.min.x.toFixed(1)}..${world.max.x.toFixed(1)}, y ${world.min.y.toFixed(1)}..${world.max.y.toFixed(1)}`,
  )
  check(
    'the plane is sized from the UNION, not one slot',
    // Union: x -1000..1100 (2100), y -250..250 (500), at the 1.2x margin.
    // A alone would give 2400 x 600 and B alone 2400 x 528, so this number
    // matches NEITHER hull's own extent - the first draft of this fixture had
    // A containing B, where the union was A's extent and the check could not
    // tell the two apart.
    Math.abs(w - 2520) < 1e-6 && Math.abs(d - 600) < 1e-6,
    `${w.toFixed(1)} x ${d.toFixed(1)} mm; A alone 2400 x 600, B alone 2400 x 528`,
  )
  // The plane's own geometry is respected, not assumed to be the unit square:
  // an already-sized plane must be scaled to the TARGET, not by it.
  const sized = new Mesh(new PlaneGeometry(2400, 600), new MeshBasicMaterial({ transparent: true }))
  applySharedWaterSurface(
    [
      { slot: a, waterlineZ: WL_A },
      { slot: b, waterlineZ: WL_B },
    ],
    sized,
  )
  const sizedWorld = new Box3().setFromObject(sized)
  check(
    'an already-sized plane is scaled to the same target',
    Math.abs(sizedWorld.max.x - sizedWorld.min.x - 2520) < 1e-6 &&
      Math.abs(sizedWorld.max.y - sizedWorld.min.y - 600) < 1e-6,
    `${(sizedWorld.max.x - sizedWorld.min.x).toFixed(1)} x ${(sizedWorld.max.y - sizedWorld.min.y).toFixed(1)} mm from a 2400 x 600 plane`,
  )
}

// --- 2. trim: the bow end goes UP ------------------------------------------
console.log('\n=== 2. a solver trim of +3.60 degrees lifts the bow ===')
{
  const { a } = twoSlots()
  const plane = unitPlane()
  const planeBefore = plane.position.clone()
  applySlotResultToScene(a, view({ waterlineZ: WL_A, trimDeg: 3.6 }))
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
  // The drop is POSE-AWARE, so the shared surface is exact under a pure trim,
  // not approximately held. A plain `-waterlineZ` wrapper would leave the
  // FIRST-order pivot term: the pose seam rotates about the pivot, and a point
  // at the midship station moves by p.x*sin(trim) in world Z - 31 mm at the
  // 500 mm pivot X used below, larger than the 30 mm draft difference this
  // overlay exists to show.
  const mid = worldOf(a, { x: 0, y: 0, z: WL_A })
  check(
    'the midship waterline sits exactly on the shared surface',
    Math.abs(mid.z) < 1e-9,
    `midship waterline at world Z ${mid.z.toFixed(12)} mm (the pose-blind wrapper misses by ${(500 * Math.sin(rad(3.6))).toFixed(3)} mm at the 500 mm pivot X below)`,
  )
  check(
    'the pose seam left the water plane alone',
    // Snapshotted BEFORE the pose seam ran - asserting the (0,0,0) the water
    // seam itself writes afterwards would test the water seam twice and the
    // pose seam not at all.
    Math.abs(plane.position.x - planeBefore.x) < 1e-12 &&
      Math.abs(plane.position.y - planeBefore.y) < 1e-12 &&
      Math.abs(plane.position.z - planeBefore.z) < 1e-12,
    `${planeBefore.toArray().join(', ')} -> ${plane.position.toArray().join(', ')}`,
  )
  check(
    'the water seam still puts its plane at world Z 0',
    Math.abs(plane.position.z) < 1e-9 && Math.abs(plane.position.y) < 1e-9,
    plane.position
      .toArray()
      .map((n) => n.toExponential(1))
      .join(', '),
  )

  // The same trim, but posed about a pivot 500 mm forward of the origin and
  // 25 mm above it - the shape `solveTrim` really hands the viewer
  // (`pivot = { x: lcgX, y: boundsCentreY, z: boundsCentreZ }`). This is the
  // check that fails on the pose-blind wrapper, and it cannot pass by the
  // zero-pivot accident of the fixture above.
  const pivot = { x: 500, y: 0, z: 25 }
  const { a: offset } = twoSlots()
  applySlotResultToScene(offset, view({ waterlineZ: WL_A, trimDeg: 3.6, pivot }))
  const plane2 = unitPlane()
  applySharedWaterSurface([{ slot: offset, waterlineZ: WL_A }], plane2)
  const offsetMid = worldOf(offset, { x: 0, y: 0, z: WL_A })
  check(
    'an off-centre pivot leaves the midship waterline exact too',
    Math.abs(offsetMid.z) < 1e-9 && Math.abs(offsetMid.y) < 1e-9,
    `midship waterline at world Z ${offsetMid.z.toFixed(12)} mm`,
  )
  // The same pose with the pose-BLIND wrapper, measured here so the check above
  // carries its own failing case: this is what the first draft's `-waterlineZ`
  // produced, and it is tens of millimetres - larger than the 30 mm draft
  // difference the overlay exists to show.
  const { a: blind } = twoSlots()
  applySlotResultToScene(blind, view({ waterlineZ: WL_A, trimDeg: 3.6, pivot }))
  blind.wrapper.position.z = -WL_A
  const blindMid = worldOf(blind, { x: 0, y: 0, z: WL_A })
  check(
    'the pose-blind wrapper would miss by tens of millimetres',
    Math.abs(blindMid.z) > 10,
    `pose-blind midship waterline at world Z ${blindMid.z.toFixed(3)} mm`,
  )
}

// --- 3. heel: the -Y side goes DOWN ----------------------------------------
console.log('\n=== 3. a solver heel of +10 degrees drops the -Y side ===')
{
  const { a } = twoSlots()
  const plane = unitPlane()
  const planeBefore = plane.position.clone()
  applySlotResultToScene(a, view({ waterlineZ: WL_A, heelDeg: 10 }))
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
  check(
    'the midship waterline sits exactly on the shared surface under the heel',
    Math.abs(mid.z) < 1e-9,
    `midship waterline at world Z ${mid.z.toFixed(12)} mm`,
  )
  check(
    'the pose seam left the water plane alone',
    // Again snapshotted before the pose ran, for the same reason as section 2.
    Math.abs(plane.position.x - planeBefore.x) < 1e-12 &&
      Math.abs(plane.position.y - planeBefore.y) < 1e-12 &&
      Math.abs(plane.position.z - planeBefore.z) < 1e-12,
    `${planeBefore.toArray().join(', ')} -> ${plane.position.toArray().join(', ')}`,
  )
  check(
    'the water seam still puts its plane at world Z 0',
    Math.abs(plane.position.z) < 1e-9 && Math.abs(plane.position.y) < 1e-9,
    plane.position
      .toArray()
      .map((n) => n.toExponential(1))
      .join(', '),
  )

  // Heel poses about the X axis, where the same first-order term is p.y: a
  // pivot 200 mm to starboard of the origin and a 10 deg heel must still land
  // the midship waterline exactly on the surface.
  const pivot = { x: 0, y: 200, z: 25 }
  const { a: offset } = twoSlots()
  applySlotResultToScene(offset, view({ waterlineZ: WL_A, heelDeg: 10, pivot }))
  const plane2 = unitPlane()
  applySharedWaterSurface([{ slot: offset, waterlineZ: WL_A }], plane2)
  const offsetMid = worldOf(offset, { x: 0, y: 0, z: WL_A })
  check(
    'an off-centre heel pivot leaves the midship waterline exact too',
    Math.abs(offsetMid.z) < 1e-9 && Math.abs(offsetMid.x) < 1e-9,
    `midship waterline at world Z ${offsetMid.z.toFixed(12)} mm`,
  )
  const { a: blind } = twoSlots()
  applySlotResultToScene(blind, view({ waterlineZ: WL_A, heelDeg: 10, pivot }))
  blind.wrapper.position.z = -WL_A
  const blindMid = worldOf(blind, { x: 0, y: 0, z: WL_A })
  check(
    'the pose-blind wrapper would miss by tens of millimetres here too',
    Math.abs(blindMid.z) > 10,
    `pose-blind midship waterline at world Z ${blindMid.z.toFixed(3)} mm`,
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
  // an accumulating offset would sink the hull further on every re-solve. The
  // claim is the LANDING (a zero-pose slot's wrapper is exactly -waterlineZ),
  // plus the wrapper having actually moved from where the first pass put it.
  const zBefore = twice.wrapper.position.z
  applySlotResultToScene(twice, view({ waterlineZ: 80 }))
  applySharedWaterSurface([{ slot: twice, waterlineZ: 80 }], unitPlane())
  const moved = worldOf(twice, { x: 0, y: 0, z: 80 })
  check(
    'a changed waterline lands the hull on the surface again',
    Math.abs(moved.z) < 1e-9 && twice.wrapper.position.z === -80 && zBefore !== -80,
    `wrapper ${zBefore} -> ${twice.wrapper.position.z}, waterline point now at world Z ${moved.z.toFixed(12)}`,
  )
}

// --- 5. disposing a slot ----------------------------------------------------
console.log('\n=== 5. disposing a slot releases every resource it owns ===')
{
  const watch = (obj: { dispose: () => void }, name: string, sink: string[]): void => {
    const original = obj.dispose.bind(obj)
    obj.dispose = () => {
      sink.push(name)
      original()
    }
  }
  const watchSlot = (slot: SlotScene, sink: string[]): void => {
    // A watch helper, not the suite's subject: `ViewerRefs` types the markers
    // nullable (the single-viewer mount builds it without a mesh), but
    // `makeSlotScene` always fills them - so the null branch is unreachable
    // here and the count below stays exactly ten.
    watch(slot.refs.hullMesh.geometry, 'hull geometry', sink)
    watch(slot.refs.hullMesh.material as Material, 'hull material', sink)
    for (const key of ['lcgSphere', 'lcbSphere', 'lcgLine', 'lcbLine'] as const) {
      const obj = slot.refs[key]
      if (!obj) continue
      watch(obj.geometry, `${key} geometry`, sink)
      watch(obj.material as Material, `${key} material`, sink)
    }
  }

  // A fresh slot owns a hull geometry and material, two spheres and two leaders,
  // each with a geometry and a material of its own: 2 + 4*2 = 10 resources, and
  // every one must go - Task 6 rebuilds a slot whenever its mesh hash changes,
  // so a missed one leaks GPU memory per re-pick for the whole session.
  const { a } = twoSlots()
  const released: string[] = []
  watchSlot(a, released)
  disposeSlotScene(a)
  check(
    'disposeSlotScene reaches every geometry and material',
    released.length === 10,
    released.length === 10 ? 'all 10 released' : `only ${released.length}: ${released.join(', ')}`,
  )

  // Only the slot handed over: a slot's rebuild must not strip its neighbour.
  const { a: owner, b: neighbour } = twoSlots()
  const releasedOwner: string[] = []
  const releasedNeighbour: string[] = []
  watchSlot(owner, releasedOwner)
  watchSlot(neighbour, releasedNeighbour)
  disposeSlotScene(owner)
  check(
    'dispose touches only the slot handed over',
    releasedOwner.length === 10 && releasedNeighbour.length === 0,
    `owner ${releasedOwner.length}, neighbour ${releasedNeighbour.length}`,
  )

  // Cleanup can run twice - a rebuild followed by an unmount, or React's
  // double-invoked effects in development - and three's dispose is only an
  // event dispatch, so a second call must simply not throw.
  let twiceSafe = true
  try {
    disposeSlotScene(owner)
    disposeSlotScene(owner)
  } catch {
    twiceSafe = false
  }
  check('dispose is safe to run twice', twiceSafe, 'two consecutive calls do not throw')
}

// --- 6. purity and the division of labour ----------------------------------
console.log('\n=== 6. purity: each seam touches only what it is handed ===')
{
  const { a } = twoSlots()
  // Each spy writes to ITS OWN sink. The first draft captured one array in the
  // closure and had the water seam assert a second array nothing ever wrote
  // to - a purity check that could never fail.
  const spy = (target: object, sink: string[]): object =>
    new Proxy(target, {
      get(t, prop: string) {
        if (/camera|controls|renderer|scene|domElement|requestAnimation/i.test(prop))
          sink.push(prop)
        return Reflect.get(t, prop)
      },
    })

  const touched: string[] = []
  const proxied = {
    wrapper: spy(a.wrapper, touched),
    refs: spy(a.refs, touched),
  } as unknown as SlotScene
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
  applySlotResultToScene(w, view({ waterlineZ: WL_A }))
  const proxiedSlot = {
    wrapper: spy(w.wrapper, touchedWater),
    refs: spy(w.refs, touchedWater),
  } as unknown as SlotScene
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
  // The wrapper's new offset is NOT -40 any more: the drop is pose-aware, so
  // under this 4 deg trim and 5 deg heel it is the pose-blind -40 plus the
  // pivot's own rotation terms. What the contract still guarantees exactly is
  // the LANDING - the midship waterline point on world Z 0 - and that nothing
  // about the hull's own pose moved.
  const waterPoint = worldOf(s, { x: 0, y: 0, z: 40 })
  check(
    'the water seam leaves the hull pose alone',
    poseDrift === 0 && Math.abs(waterPoint.z) < 1e-9,
    `max pose drift ${poseDrift.toExponential(2)} mm, wrapper at ${s.wrapper.position.z.toFixed(6)}, waterline point at world Z ${waterPoint.z.toExponential(1)}`,
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
