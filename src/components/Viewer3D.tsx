import { useEffect, useRef } from 'react'
import type { BufferAttribute, BufferGeometry, Group, Line, Mesh } from 'three'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { viewerHeelDeg, viewerTrimDeg } from '../lib/viewer-conventions'

interface Viewer3DProps {
  geometry: BufferGeometry
  /**
   * Absolute waterline height (mesh Z coords). Null hides the plane. Solver
   * frame — no viewer sign translation applies to a height.
   */
  waterlineZ?: number | null
  /** Trim angle in degrees, SOLVER convention (+ = bow up, - = bow down). */
  trimDeg?: number
  /**
   * Heel angle in degrees, SOLVER convention (+ = the -Y side goes down).
   * The sign translation for both lives in `viewer-conventions.ts` and is
   * applied inside {@link applyResultToScene} — never inline at the call site.
   */
  heelDeg?: number
  /** Center of Gravity (LCG) position in mesh coordinates. */
  lcg?: { x: number; y: number; z: number } | null
  /** Center of Buoyancy (LCB) position in mesh coordinates. */
  lcb?: { x: number; y: number; z: number } | null
  /** Rotation pivot point (X, Y, Z) in mesh coordinates. Matches solver's applyPitchY pivot. */
  pivot?: { x: number; y: number; z: number } | null
}

/**
 * The plain result subset the scene transform needs. Keeping it a separate
 * type from `Viewer3DProps` is what lets {@link applyResultToScene} run under
 * `tsx` with no DOM, no WebGL and no React — it is the test seam.
 */
export interface ViewerView {
  waterlineZ: number | null
  trimDeg: number
  heelDeg: number
  lcg: { x: number; y: number; z: number } | null
  lcb: { x: number; y: number; z: number } | null
  pivot: { x: number; y: number; z: number } | null
}

/**
 * The scene graph as the mount effect leaves it: everything built once per
 * mesh, with the pieces the update effect has to drive. Object transforms and
 * visibility only — no renderer, camera or controls, which is exactly why the
 * seam can be exercised without a browser.
 */
export interface ViewerRefs {
  hullGroup: Group
  hullMesh: Mesh
  /** Null only when the geometry carries no bounding box to size a plane with. */
  waterPlane: Mesh | null
  lcgSphere: Mesh | null
  lcgLine: Line | null
  lcbSphere: Mesh | null
  lcbLine: Line | null
  /** Keel Z from the geometry bounds — the lower end of the LCG/LCB leaders. */
  keelZ: number
  /** Geometry bounding-box centre in mesh coordinates. */
  hullCenter: THREE.Vector3
}

const EMPTY_VIEW: ViewerView = {
  waterlineZ: null,
  trimDeg: 0,
  heelDeg: 0,
  lcg: null,
  lcb: null,
  pivot: null,
}

/**
 * Write the two endpoints of an LCG/LCB leader line in place.
 *
 * The line is built once at mount, so a result update rewrites the existing
 * position attribute rather than allocating a new geometry per solve. The
 * endpoints are GROUP-local: the caller has already subtracted the pivot, so
 * `from` is the mesh coordinate expressed relative to the pivot, and the lower
 * end is the mesh-keel Z minus the pivot Z for the same reason.
 */
function setLeaderEnds(line: Line, from: { x: number; y: number; z: number }, keelZ: number): void {
  const attr = line.geometry.getAttribute('position') as BufferAttribute
  const a = attr.array as Float32Array
  a[0] = from.x
  a[1] = from.y
  a[2] = from.z
  a[3] = from.x
  a[4] = from.y
  a[5] = keelZ
  attr.needsUpdate = true
}

/**
 * Build one LCG/LCB leader line and parent it to the hull group.
 *
 * The line is built once at mount, so a result update rewrites the existing
 * position attribute rather than allocating a new geometry per solve. Shared
 * between the mount pass and `tests/verify-viewer-scene.ts`: the seam has to
 * be driven against the same object graph the app builds it for, or a check
 * written in world space reads an unparented line and quietly tests nothing.
 */
export function createLeader(hullGroup: THREE.Group, color: number): Line {
  const lineGeom = new THREE.BufferGeometry()
  lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
  const line = new THREE.Line(
    lineGeom,
    new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false }),
  )
  // The line must not be frustum culled: three.js computes a geometry's
  // bounding sphere once and never invalidates it when the position attribute
  // is rewritten, so the sphere frozen at the first render is the zeroed
  // buffer — centre (0,0,0), radius 0 — and the line then vanishes from view as
  // soon as the origin leaves the camera frustum.
  line.frustumCulled = false
  line.renderOrder = 1
  hullGroup.add(line)
  return line
}

/**
 * Apply a solve result to an already-built scene: hull rotation about the
 * pivot, waterline position and visibility, LCG/LCB markers and their leaders.
 *
 * Pure with respect to everything a caller can observe — it touches only the
 * objects it is handed and returns nothing. No DOM, no WebGL context, no
 * renderer, camera or controls, so it is safe to call from both the mount pass
 * and the update pass, and it is the seam `tests/verify-viewer-scene.ts`
 * drives.
 *
 * Angles arrive in the SOLVER's convention; the sign translation to Three.js
 * happens here, once, through `viewer-conventions.ts`.
 */
export function applyResultToScene(refs: ViewerRefs, view: ViewerView): void {
  const trimRad = (viewerTrimDeg(view.trimDeg) * Math.PI) / 180
  const heelRad = (viewerHeelDeg(view.heelDeg) * Math.PI) / 180

  // Determine pivot point: pivot prop > LCG > hull centre. The mesh is offset
  // so the pivot sits at the group origin and the group is placed on the
  // pivot, which leaves the pivot itself stationary under any rotation.
  const p = view.pivot ?? view.lcg ?? refs.hullCenter
  refs.hullMesh.position.set(-p.x, -p.y, -p.z)
  refs.hullGroup.position.set(p.x, p.y, p.z)

  // Rotate around X (heel) then Y (trim).
  refs.hullGroup.rotation.x = heelRad
  refs.hullGroup.rotation.y = trimRad

  // Waterline plane: horizontal, centred on the ROTATED hull centre so it
  // tracks the hull as it trims and heels. The plane is a child of the scene,
  // so its position is a WORLD coordinate, and both the centre and the height
  // are MESH coordinates — the transform that carries one to the other is the
  // MESH's matrixWorld. The mesh is offset by -pivot inside the group, so using
  // the group's matrix drops that offset and displaces the plane by the pivot
  // vector (54.4 mm on the test hull, over a metre with the LCG slider at an
  // end).
  const waterlineZ = view.waterlineZ
  const floating = waterlineZ !== null && Number.isFinite(waterlineZ)
  if (refs.waterPlane) refs.waterPlane.visible = floating
  if (floating && waterlineZ !== null) {
    refs.hullGroup.updateMatrixWorld(true)
    const rotatedCenter = refs.hullCenter.clone().applyMatrix4(refs.hullMesh.matrixWorld)
    // The height is a MESH z too, so it takes the same rotation: the world Z is
    // the world Z of the mesh point on the waterline above the hull centre. At
    // rest the rotation is the identity and this is exactly `waterlineZ`, so
    // only the heeled/trimmed case changes.
    const atWaterline = refs.hullCenter
      .clone()
      .setZ(waterlineZ)
      .applyMatrix4(refs.hullMesh.matrixWorld)
    refs.waterPlane?.position.set(rotatedCenter.x, rotatedCenter.y, atWaterline.z)
  }

  // Markers and their leader lines are children of the hull group, so their
  // positions are GROUP-local. A group-local point c lands at world
  // pivot + R*c, and a mesh point m belongs at pivot + R*(m - pivot), so the
  // mesh coordinate is written to the child as m - pivot. Skipping that
  // subtraction displaces every marker (and the leader's keel end) by exactly
  // the pivot vector. Note the keel Z is a MESH z too, so it goes through the
  // same subtraction.
  const keelGroupZ = refs.keelZ - p.z

  // LCG marker (red sphere + vertical line to the keel), group coordinates.
  const lcg = view.lcg
  const hasLcg = lcg !== null && Number.isFinite(lcg.x)
  if (refs.lcgSphere) refs.lcgSphere.visible = hasLcg
  if (refs.lcgLine) refs.lcgLine.visible = hasLcg
  if (hasLcg && lcg) {
    if (refs.lcgSphere) {
      refs.lcgSphere.position.set(lcg.x - p.x, lcg.y - p.y, lcg.z - p.z)
    }
    if (refs.lcgLine) {
      setLeaderEnds(refs.lcgLine, { x: lcg.x - p.x, y: lcg.y - p.y, z: lcg.z - p.z }, keelGroupZ)
    }
  }

  // LCB marker (green sphere + vertical line to the keel), group coordinates.
  const lcb = view.lcb
  const hasLcb = lcb !== null && Number.isFinite(lcb.x)
  if (refs.lcbSphere) refs.lcbSphere.visible = hasLcb
  if (refs.lcbLine) refs.lcbLine.visible = hasLcb
  if (hasLcb && lcb) {
    if (refs.lcbSphere) {
      refs.lcbSphere.position.set(lcb.x - p.x, lcb.y - p.y, lcb.z - p.z)
    }
    if (refs.lcbLine) {
      setLeaderEnds(refs.lcbLine, { x: lcb.x - p.x, y: lcb.y - p.y, z: lcb.z - p.z }, keelGroupZ)
    }
  }
}

/**
 * The two Compare slot colours — hull A blue, hull B orange, far apart in hue
 * so the overlay stays readable where the two hulls overlap.
 */
export const SLOT_COLORS: readonly [number, number] = [0x38bdf8, 0xfb923c]

/**
 * One slot in the Compare overlay: the hull and its markers, wrapped in a
 * group the water seam can move without touching the pose.
 */
export interface SlotScene {
  wrapper: Group
  refs: ViewerRefs
}

/**
 * Build one compare slot: hull mesh plus LCG/LCB markers and leaders, exactly
 * the construction the single-viewer mount pass makes, inside a wrapper group.
 *
 * The hull material is flat, transparent and never depth-writing: the
 * overlay's whole point is that BOTH hulls stay visible through each other,
 * and an opaque or depth-writing slot would hide whichever hull is drawn
 * first.
 *
 * `refs.waterPlane` is null on purpose: the shared water surface is a property
 * of the compare SCENE, not of a slot, so the pose seam's visibility branch has
 * nothing to write here and the two seams cannot fight over the plane.
 */
export function makeSlotScene(positions: Float32Array, color: number, opacity: number): SlotScene {
  const wrapper = new THREE.Group()
  const hullGroup = new THREE.Group()
  wrapper.add(hullGroup)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  const center = new THREE.Vector3()
  if (bb) bb.getCenter(center)
  const keelZ = bb ? bb.min.z : 0
  const hullSizeX = bb ? Math.max(bb.max.x - bb.min.x, 1) : 100

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  hullGroup.add(mesh)

  // The markers join the hull's TRANSPARENT pass. The hull is translucent by
  // design, and three.js draws every opaque object before every transparent
  // one - an opaque marker would therefore be blended OVER by the hull drawn
  // after it and come out dimmed. renderOrder 2 puts the markers after the
  // hull inside the transparent list; the single viewer gets away with the
  // mount pass's 1 because its hull is opaque, and `createLeader` (shared, so
  // untouched) sets exactly that 1, which is overridden here per line.
  const markerMat = (c: number) =>
    new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true })

  // Hidden until the first result: the mount pass calls the pose seam with an
  // empty view at mount, which hides them, and a fresh slot has no result yet
  // - two bright spheres at the origin would say otherwise.
  const lcgSphere = new THREE.Mesh(new THREE.SphereGeometry(hullSizeX * 0.02), markerMat(0xef4444))
  lcgSphere.renderOrder = 2
  lcgSphere.visible = false
  hullGroup.add(lcgSphere)
  const lcgLine = createLeader(hullGroup, 0xef4444)
  lcgLine.renderOrder = 2
  lcgLine.visible = false
  ;(lcgLine.material as THREE.Material).transparent = true

  const lcbSphere = new THREE.Mesh(new THREE.SphereGeometry(hullSizeX * 0.02), markerMat(0x22c55e))
  lcbSphere.renderOrder = 2
  lcbSphere.visible = false
  hullGroup.add(lcbSphere)
  const lcbLine = createLeader(hullGroup, 0x22c55e)
  lcbLine.renderOrder = 2
  lcbLine.visible = false
  ;(lcbLine.material as THREE.Material).transparent = true

  return {
    wrapper,
    refs: {
      hullGroup,
      hullMesh: mesh,
      waterPlane: null,
      lcgSphere,
      lcgLine,
      lcbSphere,
      lcbLine,
      keelZ,
      hullCenter: center,
    },
  }
}

/**
 * Pose one slot from its own solve result.
 *
 * Deliberately the SAME seam the single viewer uses, so the frozen sign
 * translation (`viewer-conventions.ts`) and the pivot chain are not
 * re-implemented per slot. It touches only `slot.refs`: the wrapper offset
 * belongs to {@link applySharedWaterSurface}, and a pose seam that also wrote
 * the wrapper would make the shared surface drift with the trim.
 */
export function applySlotResultToScene(slot: SlotScene, view: ViewerView): void {
  applyResultToScene(slot.refs, view)
}

/**
 * Put every slot on ONE shared water surface.
 *
 * Each slot is dropped so that its hull's MIDSHIP WATERLINE POINT — the mesh
 * point at x = y = 0, z = waterlineZ, the station the solver reports its
 * waterline height at — lands exactly on world Z 0. The deeper hull therefore
 * visibly sits lower, which is the whole point of the overlay, and both hulls
 * sit on the same plane however they are posed.
 *
 * The drop is POSE-AWARE, not the plain `-waterlineZ` a first draft used. The
 * pose seam rotates the hull about its pivot `p`, so the world Z of that point
 * is `p.z + p.x*sin(trim) - p.y*sin(heel) + (waterlineZ - p.z)*cos(...)` — the
 * `p.x*sin(trim)` term alone is FIRST order and reaches ~50 mm on this hull at
 * a 20 % LCG, which is larger than the 30 mm draft difference the overlay
 * exists to show. Measuring the point through the hull's own matrixWorld and
 * cancelling its Z makes the contract exact under any pose; at zero pose the
 * measurement is `waterlineZ` itself and this is the same number the draft
 * code produced.
 *
 * Idempotent by construction: the wrapper is returned to the origin before the
 * measurement and the offset is then WRITTEN, never accumulated, so a re-solve
 * REPLACES the waterline instead of drifting the hull.
 *
 * The plane is centred on the union of the hulls' world bounds at world Z 0 and
 * scaled 1.2x past them (the single-viewer margin). Its size is derived from
 * the plane's OWN geometry, so a unit square and an already-sized plane both
 * work — the scale is `target / geometry extent`, not the target itself.
 *
 * Preconditions, all the caller's: call AFTER the pose seams have run (the
 * union and the measurement read the posed hull); the plane must be a direct
 * child of the scene, because this seam writes world coordinates to it; the
 * plane's visibility is the caller's — an empty or all-non-finite list leaves
 * the plane exactly as it was; and each entry's `waterlineZ` should be the
 * same one handed to that slot's pose seam (Task 6 reads it from the slot's
 * own last result, one source for both).
 */
export function applySharedWaterSurface(
  slots: Array<{ slot: SlotScene; waterlineZ: number }>,
  waterPlane: Mesh,
): void {
  const union = new THREE.Box3()
  for (const { slot, waterlineZ } of slots) {
    if (!Number.isFinite(waterlineZ)) continue
    // Measure with the wrapper at the origin so the hull's own pose shows
    // through the matrices undisturbed, then drop the whole slot by exactly
    // the height its waterline point reached.
    slot.wrapper.position.set(0, 0, 0)
    slot.wrapper.updateMatrixWorld(true)
    const onWater = new THREE.Vector3(0, 0, waterlineZ).applyMatrix4(slot.refs.hullMesh.matrixWorld)
    slot.wrapper.position.z = -onWater.z
    slot.wrapper.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(slot.refs.hullMesh)
    if (!box.isEmpty()) union.union(box)
  }
  if (union.isEmpty()) return
  const size = union.getSize(new THREE.Vector3())
  const centre = union.getCenter(new THREE.Vector3())
  waterPlane.geometry.computeBoundingBox()
  const geomBox = waterPlane.geometry.boundingBox
  const geomSize = geomBox ? geomBox.getSize(new THREE.Vector3()) : new THREE.Vector3(1, 1, 0)
  waterPlane.position.set(centre.x, centre.y, 0)
  waterPlane.scale.set(
    (Math.max(size.x, 1) * 1.2) / (geomSize.x || 1),
    (Math.max(size.y, 1) * 1.2) / (geomSize.y || 1),
    1,
  )
}

/**
 * Release a slot's GPU resources: the hull geometry this module built, the
 * marker and leader geometries and their materials, and the hull material.
 * The single viewer's mount cleanup is the model. Slots are rebuilt whenever
 * their mesh hash changes, so without this a session of re-picks leaks a
 * geometry and four materials per rebuild.
 */
export function disposeSlotScene(slot: SlotScene): void {
  const { hullMesh, lcgSphere, lcbSphere, lcgLine, lcbLine } = slot.refs
  hullMesh.geometry.dispose()
  const hullMat = hullMesh.material
  if (Array.isArray(hullMat)) for (const m of hullMat) m.dispose()
  else hullMat.dispose()
  for (const obj of [lcgSphere, lcbSphere, lcgLine, lcbLine]) {
    if (!obj) continue
    obj.geometry.dispose()
    const mat = obj.material
    if (Array.isArray(mat)) for (const m of mat) m.dispose()
    else mat.dispose()
  }
}

export default function Viewer3D({
  geometry,
  waterlineZ = null,
  trimDeg = 0,
  heelDeg = 0,
  lcg = null,
  lcb = null,
  pivot = null,
}: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const refsRef = useRef<ViewerRefs | null>(null)

  // The latest result view, mirrored for the mount pass. The mount pass owns
  // the GL context and therefore depends on the MESH alone, but its initial
  // camera framing depends on the first RESULT — so it reads this mirror
  // instead of closing over the props, which would put them in its dependency
  // list and rebuild the whole scene on every solve.
  const viewRef = useRef<ViewerView>(EMPTY_VIEW)
  viewRef.current = { waterlineZ, trimDeg, heelDeg, lcg, lcb, pivot }

  // --- Mount pass: once per mesh -------------------------------------------
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const initialView = viewRef.current

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x09090b) // zinc-950

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1_000_000)
    // Mesh data is Z-up (X = LOA, Y = beam, Z = depth/up) but three.js
    // defaults to Y-up. Tell the camera (and OrbitControls) that +Z is up so
    // a correctly oriented hull displays deck-up instead of lying on its side.
    // This keeps data axes == display axes (equivalent alternative: leave the
    // camera Y-up and rotate the displayed mesh -90° about X).
    camera.up.set(0, 0, 1)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)) // cap DPR
    renderer.shadowMap.enabled = false // no shadows by design
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    // Lights (no shadow casters since shadows are disabled).
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1)
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(1.2, -1, 1.6) // from front-side-above in Z-up space
    scene.add(hemi, key)

    // Pre-compute bounding box for marker sizing and pivot
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox
    const hullSizeX = bb ? Math.max(bb.max.x - bb.min.x, 1) : 100

    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    if (bb) {
      bb.getSize(size)
      bb.getCenter(center)
    }
    const keelZ = bb ? bb.min.z : 0

    // Create a group for the hull so we can rotate it as a unit (mesh + markers)
    const hullGroup = new THREE.Group()
    scene.add(hullGroup)

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.05,
        roughness: 0.55,
        flatShading: true,
        side: THREE.DoubleSide,
      }),
    )
    hullGroup.add(mesh)

    // Waterline plane: built once and toggled by the update pass. Sized from
    // the geometry bounds, so its size is a mesh property, not a result one.
    const waterPlane =
      bb === null
        ? null
        : new THREE.Mesh(
            new THREE.PlaneGeometry(
              Math.max(bb.max.x - bb.min.x, 1) * 1.2,
              Math.max(bb.max.y - bb.min.y, 1) * 1.2,
            ),
            new THREE.MeshBasicMaterial({
              color: 0x0284c7,
              transparent: true,
              opacity: 0.35,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          )
    waterPlane?.position.set(center.x, center.y, keelZ)
    if (waterPlane) scene.add(waterPlane)

    // Markers ride with the hull, so their update-pass positions are GROUP
    // coordinates (mesh minus the pivot), not mesh ones — and they are never
    // re-parented.
    const markerMat = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false })

    const lcgSphere = new THREE.Mesh(
      new THREE.SphereGeometry(hullSizeX * 0.02),
      markerMat(0xef4444),
    )
    lcgSphere.renderOrder = 1
    hullGroup.add(lcgSphere)
    const lcgLine = createLeader(hullGroup, 0xef4444)

    const lcbSphere = new THREE.Mesh(
      new THREE.SphereGeometry(hullSizeX * 0.02),
      markerMat(0x22c55e),
    )
    lcbSphere.renderOrder = 1
    hullGroup.add(lcbSphere)
    const lcbLine = createLeader(hullGroup, 0x22c55e)

    const radius = (Math.max(size.x, size.y, size.z) || 1) * 0.6

    // 3/4 bow view from above: length along X, beam along Y, up along Z.
    const dir = new THREE.Vector3(1, -1.1, 0.55).normalize()

    // Apply the first result before framing: the waterline transform has to be
    // settled before the camera is placed, and the marker positions depend on
    // the pivot the first result picks.
    const refs: ViewerRefs = {
      hullGroup,
      hullMesh: mesh,
      waterPlane,
      lcgSphere,
      lcgLine,
      lcbSphere,
      lcbLine,
      keelZ,
      hullCenter: center,
    }
    refsRef.current = refs
    applyResultToScene(refs, initialView)

    // Camera framing, once, at mount. It transforms the bbox centre by the
    // GROUP matrix, so the target is `pivot + R*centre` — which is the hull
    // centre only when `R` is the identity AND the mesh is centred at the
    // origin. Both hold here, for a different reason than the mesh being
    // centred: `App.tsx` clears the results when a mesh loads, so at mount the
    // view is empty and the seam falls back to `hullCentre` as the pivot, the
    // group sits on that centre untranslated, and for a centred mesh the centre
    // is the origin — target = origin = hull centre, exactly. It is mount-only
    // and re-evaluated on every new mesh, so it is documented rather than
    // changed: there is no visible error to correct in this app. Do NOT copy
    // this transform onto the waterline plane (above) — that one must use the
    // MESH's matrix, because it is re-evaluated on every result.
    hullGroup.updateMatrixWorld(true)
    const rotatedCenter = center.clone().applyMatrix4(hullGroup.matrixWorld)
    camera.position.copy(rotatedCenter).addScaledVector(dir, radius * 3)
    camera.near = Math.max(radius / 1000, 0.001)
    camera.far = radius * 1000
    camera.updateProjectionMatrix()
    controls.target.copy(rotatedCenter)
    controls.update()

    // GridHelper builds in the XZ plane (Y-up normal); rotate it into the XY
    // plane so its normal is +Z and it sits under the hull at min Z.
    const grid = new THREE.GridHelper(radius * 6, 24, 0x3f3f46, 0x27272a)
    grid.rotation.x = Math.PI / 2
    grid.position.z = keelZ
    scene.add(grid)

    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(mount)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      mesh.material.dispose()
      hullGroup.remove(mesh)
      scene.remove(hullGroup)

      waterPlane?.geometry.dispose()
      waterPlane?.material.dispose()
      if (waterPlane) scene.remove(waterPlane)

      for (const obj of [lcgSphere, lcbSphere]) {
        obj.geometry.dispose()
        ;(obj.material as THREE.Material).dispose()
        hullGroup.remove(obj)
      }
      for (const line of [lcgLine, lcbLine]) {
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
        hullGroup.remove(line)
      }

      grid.geometry.dispose()
      ;(grid.material as THREE.Material).dispose()

      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
      refsRef.current = null
    }
  }, [geometry])

  // --- Update pass: per result ---------------------------------------------
  useEffect(() => {
    const refs = refsRef.current
    if (!refs) return
    applyResultToScene(refs, { waterlineZ, trimDeg, heelDeg, lcg, lcb, pivot })
  }, [waterlineZ, trimDeg, heelDeg, lcg, lcb, pivot])

  return (
    <div ref={mountRef} className="relative h-full min-h-0 w-full overflow-hidden rounded-lg">
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-zinc-950/70 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
        Z&thinsp;↑ up · X&thinsp;→ forward (LOA) · Y side (BOA)
      </div>
      {waterlineZ !== null && Number.isFinite(waterlineZ) && (
        <div className="pointer-events-none absolute right-2 top-2 rounded bg-sky-950/80 px-2 py-1 font-mono text-[10px] tracking-wide text-sky-300">
          waterline Z = {waterlineZ.toFixed(1)} mm
        </div>
      )}
      {Math.abs(trimDeg) > 1e-6 && (
        <div className="pointer-events-none absolute right-2 top-20 rounded bg-amber-950/80 px-2 py-1 font-mono text-[10px] tracking-wide text-amber-300">
          trim = {trimDeg >= 0 ? '+' : ''}
          {trimDeg.toFixed(2)}°
        </div>
      )}
      {Math.abs(heelDeg) > 1e-6 && (
        <div className="pointer-events-none absolute right-2 top-40 rounded bg-violet-950/80 px-2 py-1 font-mono text-[10px] tracking-wide text-violet-300">
          heel = {heelDeg >= 0 ? '+' : ''}
          {heelDeg.toFixed(2)}°
        </div>
      )}
      {lcg && lcb && (
        <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-zinc-950/70 px-2 py-1 font-mono text-[10px] tracking-wide text-zinc-300">
          <div className="text-[#ef4444]">
            ● LCG: ({lcg.x.toFixed(1)}, {lcg.y.toFixed(1)}, {lcg.z.toFixed(1)})
          </div>
          <div className="text-[#22c55e]">
            ● LCB: ({lcb.x.toFixed(1)}, {lcb.y.toFixed(1)}, {lcb.z.toFixed(1)})
          </div>
        </div>
      )}
    </div>
  )
}
