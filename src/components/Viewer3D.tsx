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
 * value is a hull-local coordinate: it rides with `hullGroup`, which is why the
 * lower end is the raw keel Z and not a world-transformed one.
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

  // Waterline plane: horizontal at waterlineZ in world coordinates, centred on
  // the ROTATED hull centre so it tracks the hull as it trims and heels.
  const waterlineZ = view.waterlineZ
  const floating = waterlineZ !== null && Number.isFinite(waterlineZ)
  if (refs.waterPlane) refs.waterPlane.visible = floating
  if (floating && waterlineZ !== null) {
    refs.hullGroup.updateMatrixWorld(true)
    const rotatedCenter = refs.hullCenter.clone().applyMatrix4(refs.hullGroup.matrixWorld)
    refs.waterPlane?.position.set(rotatedCenter.x, rotatedCenter.y, waterlineZ)
  }

  // LCG marker (red sphere + vertical line to the keel), in hull local coords.
  const lcg = view.lcg
  const hasLcg = lcg !== null && Number.isFinite(lcg.x)
  if (refs.lcgSphere) refs.lcgSphere.visible = hasLcg
  if (refs.lcgLine) refs.lcgLine.visible = hasLcg
  if (hasLcg && lcg) {
    if (refs.lcgSphere) refs.lcgSphere.position.set(lcg.x, lcg.y, lcg.z)
    if (refs.lcgLine) setLeaderEnds(refs.lcgLine, lcg, refs.keelZ)
  }

  // LCB marker (green sphere + vertical line to the keel), in hull local coords.
  const lcb = view.lcb
  const hasLcb = lcb !== null && Number.isFinite(lcb.x)
  if (refs.lcbSphere) refs.lcbSphere.visible = hasLcb
  if (refs.lcbLine) refs.lcbLine.visible = hasLcb
  if (hasLcb && lcb) {
    if (refs.lcbSphere) refs.lcbSphere.position.set(lcb.x, lcb.y, lcb.z)
    if (refs.lcbLine) setLeaderEnds(refs.lcbLine, lcb, refs.keelZ)
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

    // Markers ride with the hull, so their positions are hull-local and the
    // update pass only has to move them, never re-parent them.
    const markerMat = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false })
    const leaderMat = (color: number) =>
      new THREE.LineBasicMaterial({ color, linewidth: 2, depthTest: false })

    const buildLeader = (): Line => {
      const lineGeom = new THREE.BufferGeometry()
      lineGeom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3))
      const line = new THREE.Line(lineGeom, leaderMat(0xffffff))
      line.renderOrder = 1
      hullGroup.add(line)
      return line
    }

    const lcgSphere = new THREE.Mesh(
      new THREE.SphereGeometry(hullSizeX * 0.02),
      markerMat(0xef4444),
    )
    lcgSphere.renderOrder = 1
    hullGroup.add(lcgSphere)
    const lcgLine = buildLeader()
    lcgLine.material = leaderMat(0xef4444)

    const lcbSphere = new THREE.Mesh(
      new THREE.SphereGeometry(hullSizeX * 0.02),
      markerMat(0x22c55e),
    )
    lcbSphere.renderOrder = 1
    hullGroup.add(lcbSphere)
    const lcbLine = buildLeader()
    lcbLine.material = leaderMat(0x22c55e)

    // Add coordinate axes helper (Red=X, Green=Y, Blue=Z) - world axes
    const axesHelper = new THREE.AxesHelper(500)
    scene.add(axesHelper)

    const radius = (Math.max(size.x, size.y, size.z) || 1) * 0.6

    // 3/4 bow view from above: length along X, beam along Y, up along Z.
    const dir = new THREE.Vector3(1, -1.1, 0.55).normalize()

    // Apply the first result before framing: the camera targets the ROTATED
    // hull centre, so the transforms have to be settled first.
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
      axesHelper.geometry.dispose()
      ;(axesHelper.material as THREE.Material).dispose()

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
