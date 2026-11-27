import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { fmt } from '../lib/format'
import type { TrimSolveResult } from '../lib/hydrostatics'
import { createRecoveryGuard, watchContextLoss } from '../lib/viewer-context'
import type { LoadedMesh } from './Upload'
import {
  applySharedWaterSurface,
  applySlotResultToScene,
  disposeSlotScene,
  makeSlotScene,
  SLOT_COLORS,
  type SlotScene,
  type ViewerView,
} from './Viewer3D'

/**
 * The Compare stage: both hulls on ONE shared water surface, OVERLAID.
 *
 * The two hulls float on the same plane, at the same place, one inside the
 * other - which is what makes the comparison legible: the shared waterline is
 * the datum, so the hull that draws more water has its keel lower, and the
 * two shapes can be read against each other in one picture instead of being
 * two separate objects a reader has to hold in the head and compare.
 *
 * Each hull keeps its own waterline: the shared surface is the datum BOTH sit
 * on. That is the `applySharedWaterSurface` seam's contract, unchanged - this
 * module only decides where the camera looks from, and it puts a floor grid
 * under the hulls so the picture has a depth to read against (the single
 * viewer's ground, same grid and colours, sized from the posed hulls).
 *
 * The water itself is the single viewer's waterline ribbon and nothing more:
 * the seam's 1.2x of the hulls' union, with no extra depth stretched toward
 * the camera. Both tabs therefore draw the same water at the same size - the
 * floor, not a wider plane, is what gives this stage its ground.
 */

/** Both hulls are translucent by design (`makeSlotScene`). */
const SLOT_OPACITY = 0.55

/**
 * The single viewer's 3/4 bow direction, never mutated (addScaledVector).
 *
 * The same direction the Analyze tab's viewer uses, so the app speaks one
 * visual language: the hull is read from ahead, to the side and above, and
 * the deck and the waterline are both visible.
 */
const VIEW_DIR = new THREE.Vector3(1, -1.1, 0.55).normalize()

/**
 * The floor's span, as a multiple of the hulls' largest dimension.
 *
 * The single viewer builds its grid at `radius * 6` where `radius` is 0.6x the
 * hull's largest dimension - so 3.6x - and the Compare floor uses the same
 * number: one ground in both tabs, and cells that stay legible (24 divisions
 * over a 2714 mm hull gives ~407 mm squares in each viewer).
 */
const FLOOR_SPAN_FACTOR = 3.6

interface CompareStageProps {
  meshA: LoadedMesh | null
  meshB: LoadedMesh | null
  resultA: TrimSolveResult | null
  resultB: TrimSolveResult | null
  /** What the stage calls each hull; null when the slot is empty. */
  nameA: string | null
  nameB: string | null
  /** The sentence that describes what is drawn, for the canvas's alt text. */
  caption: string
  /** Swap the two slots; only offered when both hold something. */
  onSwap: () => void
}

function positionsOf(mesh: LoadedMesh): Float32Array {
  return mesh.geometry.getAttribute('position').array as Float32Array
}

/** A hull's dimensions, as the stage foot reads them. */
function dimensionsOf(mesh: LoadedMesh | null): string | null {
  if (!mesh) return null
  const { size } = mesh.stats.bounds
  return `${Math.round(size.x)} × ${Math.round(size.y)} × ${Math.round(size.z)} mm`
}

/**
 * A hull's enclosed volume in litres, as the stage foot reads it.
 *
 * The mesh's OWN geometry - the volume it displaces when it sinks to its deck
 * - not the water it displaces at the solved draft, which is the target weight
 * by definition (1 kg of fresh water is 1 L). It identifies the hull the way
 * the dimensions do, so it belongs beside them in the foot, not over the
 * picture.
 */
function volumeOf(mesh: LoadedMesh | null): string | null {
  if (!mesh) return null
  return `${fmt(mesh.stats.volumeLiters)} L`
}

/** The viewer-seam's view of a result: the pose fields and nothing else. */
function viewOf(result: TrimSolveResult | null): ViewerView {
  if (!result) {
    return {
      waterlineZ: null,
      trimDeg: 0,
      heelDeg: 0,
      lcg: null,
      lcb: null,
      pivot: null,
    }
  }
  return {
    waterlineZ: result.waterlineZ,
    trimDeg: result.trimDeg,
    heelDeg: result.heelDeg,
    lcg: result.lcg,
    lcb: result.lcb,
    pivot: result.pivot,
  }
}

export default function CompareStage({
  meshA,
  meshB,
  resultA,
  resultB,
  nameA,
  nameB,
  caption,
  onSwap,
}: CompareStageProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  // A WebGL-less machine (blocklisted driver, WebGL disabled, no GPU) makes the
  // construction below throw, and an unguarded one left this stage entirely
  // blank - so the mount pass reports it here and the JSX answers in one line.
  // It now ALSO reports a context loss that stopped recovering (see
  // `lib/viewer-context.ts`).
  const [glFailed, setGlFailed] = useState(false)
  // A GL context that dies MID-SESSION (driver restart, TDR) gets no second
  // chance from that construction guard, so the mount effect is re-run by
  // bumping this epoch instead: a fresh renderer, a fresh scene, and the slots
  // and pose rebuilt into it by the effects below.
  const [contextEpoch, setContextEpoch] = useState(0)
  // Per-viewer, so a refusal here says nothing about the Analyze viewer's own.
  const recoveryRef = useRef(createRecoveryGuard())
  const sceneRef = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    waterPlane: THREE.Mesh
    floor: THREE.GridHelper
  } | null>(null)
  const slotsRef = useRef<[SlotScene | null, SlotScene | null]>([null, null])

  // Memoized on the two mesh identities, so the effects below can name it in
  // their dependency lists: an array rebuilt per render would re-run them on
  // every render (every progress tick), rebuilding the slot scenes for nothing.
  // It carries the MESHES and deliberately not the results.
  const entries: Array<{ index: 0 | 1; mesh: LoadedMesh | null }> = useMemo(
    () => [
      { index: 0, mesh: meshA },
      { index: 1, mesh: meshB },
    ],
    [meshA, meshB],
  )

  /**
   * Frame the camera on the hulls that are drawn.
   *
   * The radius is the hulls' own largest dimension - the single viewer frames
   * on one hull, and the overlay has to cover whichever two it is showing -
   * and the camera sits three radii out along the shared 3/4 direction, aimed
   * at the origin, which is where the hulls' waterline crosses.
   */
  const fitView = useCallback(() => {
    const built = sceneRef.current
    if (!built) return
    built.scene.updateMatrixWorld(true)
    const union = new THREE.Box3()
    for (const slot of slotsRef.current) {
      if (!slot) continue
      const box = new THREE.Box3().setFromObject(slot.refs.hullMesh)
      if (!box.isEmpty()) union.union(box)
    }
    if (union.isEmpty()) return
    const size = union.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.y, size.z, 1)
    built.camera.position.set(VIEW_DIR.x, VIEW_DIR.y, VIEW_DIR.z).multiplyScalar(radius * 3)
    built.camera.near = Math.max(radius / 1000, 0.001)
    built.camera.far = radius * 1000
    built.camera.updateProjectionMatrix()
    built.controls.target.set(0, 0, 0)
    built.controls.update()
  }, [])

  // --- Mount pass: the context and the water plane, once ---------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: contextEpoch is a rebuild trigger, not a value this body reads
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0d10)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1_000_000)
    // Z-up world, exactly as the single viewer: data axes == display axes.
    camera.up.set(0, 0, 1)
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setGlFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = false
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    // Registered only once a renderer exists, and removed first in the teardown
    // below. `preventDefault` (inside the seam) is what keeps the context
    // restorable; the handler itself just asks for a rebuild.
    const stopWatching: () => void = watchContextLoss(renderer.domElement, () => {
      if (!recoveryRef.current.onLoss()) {
        // Not recovering: stop the loop, drop the dead canvas, and answer with the
        // one line `glFailed` already renders. The scene is left for the unmount
        // cleanup, which still runs when the tab goes away.
        cancelAnimationFrame(raf)
        stopWatching()
        if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
        setGlFailed(true)
        return
      }
      setContextEpoch((n) => n + 1)
    })

    // The same two lights the single viewer uses. The hull materials are flat
    // (`MeshBasicMaterial` in `makeSlotScene`), so lighting does not touch the
    // hulls - it is here for the grid and any future surface.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.1)
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(1.2, -1, 1.6)
    scene.add(hemi, key)

    // Each hull's slot goes into the scene; the water seam moves the wrapper
    // down to the surface, so the hull keeps its own waterline.
    // (The shared surface is the stage's datum plane: every hull is dropped so
    // its midship waterline point sits exactly on world Z 0.)

    // Built as a UNIT square: `applySharedWaterSurface` scales the plane from
    // the union of the hulls' own world bounds, so its size is a DERIVED
    // number, never a fixed one.
    const waterPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x0284c7,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    )
    // The shared surface is the stage's datum plane: every hull is dropped so
    // its midship waterline point sits exactly on world Z 0.
    waterPlane.position.set(0, 0, 0)
    waterPlane.visible = false
    scene.add(waterPlane)

    // The floor: the ground the hulls sit on, so the picture can be read in
    // depth - the single viewer has one and this stage did not, which left a
    // translucent hull hanging in a void with nothing to orient against.
    //
    // The SAME grid the single viewer uses, colours and rotation included
    // (zinc-700 on zinc-800, `rotation.x = PI/2` so its normal is +Z in this
    // Z-up world). It is built as a UNIT grid because the hulls are not known
    // yet at mount: the slots are built by the effect below, so span, height
    // and visibility are all derived by the pose pass from the Posed hulls'
    // union bounds. Hidden until then - a floor with nothing above it reads as
    // an empty stage.
    const floor = new THREE.GridHelper(1, 24, 0x3f3f46, 0x27272a)
    floor.rotation.x = Math.PI / 2
    floor.visible = false
    scene.add(floor)

    sceneRef.current = { scene, camera, controls, waterPlane, floor }

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
      // A frame drew, so the last recovery survived: the guard counts losses with
      // no successful frame between them (see createRecoveryGuard).
      recoveryRef.current.onFrame()
    }
    loop()

    return () => {
      stopWatching()
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      // Retire whatever slots are still mounted. The slot-build effect has no
      // cleanup of its own (a rebuild disposes its predecessor), so without
      // this the tab - not the scene - going away would leak each slot's
      // cloned hull buffer and its marker/leader materials.
      for (const slot of slotsRef.current) {
        if (!slot) continue
        slot.wrapper.parent?.remove(slot.wrapper)
        disposeSlotScene(slot)
      }
      slotsRef.current = [null, null]
      waterPlane.geometry.dispose()
      ;(waterPlane.material as THREE.Material).dispose()
      scene.remove(waterPlane)
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      scene.remove(floor)
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
      sceneRef.current = null
    }
    // The epoch is a rebuild trigger: a lost GL context bumps it, so React tears
    // this scene down and builds a new one in the same effect.
  }, [contextEpoch])

  // --- Slot build: whenever either slot's mesh changes -----------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: contextEpoch is a rebuild trigger, not a value this body reads
  useEffect(() => {
    const built = sceneRef.current
    if (!built) return
    for (let index = 0; index < 2; index++) {
      const slot = slotsRef.current[index]
      if (slot) {
        slot.wrapper.parent?.remove(slot.wrapper)
        disposeSlotScene(slot)
        slotsRef.current[index] = null
      }
    }
    // Each hull's slot goes straight into the scene: the two float in the same
    // place, one inside the other, and the water seam drops each one to its own
    // waterline on the shared surface.
    for (const entry of entries) {
      if (!entry.mesh) continue
      const slot = makeSlotScene(positionsOf(entry.mesh), SLOT_COLORS[entry.index], SLOT_OPACITY)
      slotsRef.current[entry.index] = slot
      built.scene.add(slot.wrapper)
    }

    fitView()
    // A context loss retires every slot in the mount teardown above, so the
    // epoch re-runs this pass and the hulls come back into the NEW scene.
  }, [entries, fitView, contextEpoch])

  // --- Pose + shared waterline: per result -----------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: contextEpoch is a rebuild trigger, not a value this body reads
  useEffect(() => {
    const built = sceneRef.current
    if (!built) return
    const posed: Array<{ slot: SlotScene; waterlineZ: number }> = []
    for (const entry of entries) {
      const slot = slotsRef.current[entry.index]
      if (!slot) continue
      const view = viewOf(entry.index === 0 ? resultA : resultB)
      // POSE first for BOTH slots ...
      applySlotResultToScene(slot, view)
      // A slot with no result to pose it with is NOT floating: drawn unposed
      // and at the origin it would sit in mid-air outside the shared surface
      // with nothing on screen saying why, so it stays hidden until a result
      // exists.
      slot.refs.hullGroup.visible = view.waterlineZ !== null
      if (view.waterlineZ !== null && Number.isFinite(view.waterlineZ)) {
        posed.push({ slot, waterlineZ: view.waterlineZ })
      }
    }
    // ... then the shared surface, which measures the posed hulls. The roots'
    // lateral offsets must be in the world matrices before it measures, so the
    // scene is updated first.
    built.scene.updateMatrixWorld(true)
    built.waterPlane.visible = posed.length > 0
    applySharedWaterSurface(posed, built.waterPlane)
    // No extra depth here: `applySharedWaterSurface` sizes the plane from the
    // hulls' union at the single viewer's own 1.2x, so the water is the
    // Analyze tab's waterline ribbon - the hull's beam - in both tabs. The
    // floor below gives the picture its depth instead of a water slab that
    // reaches toward the camera.

    // The floor reads the same union: it sits exactly under the DEEPEST point
    // of the posed hulls (the hull RESTING on it, as the single viewer's does
    // - a floor below that reads as water depth, not as a ground) and spans
    // the viewer's 3.6x the hulls' largest dimension. Measured from the posed
    // hulls, so a new mesh, a new pose or a slot going empty re-places it
    // instead of leaving it where the last hull was.
    const floorUnion = new THREE.Box3()
    for (const { slot } of posed) {
      const box = new THREE.Box3().setFromObject(slot.refs.hullMesh)
      if (!box.isEmpty()) floorUnion.union(box)
    }
    built.floor.visible = !floorUnion.isEmpty()
    if (!floorUnion.isEmpty()) {
      const floorSize = floorUnion.getSize(new THREE.Vector3())
      const floorCentre = floorUnion.getCenter(new THREE.Vector3())
      built.floor.position.set(floorCentre.x, floorCentre.y, floorUnion.min.z)
      built.floor.scale.setScalar(Math.max(floorSize.x, floorSize.y, 1) * FLOOR_SPAN_FACTOR)
    }
    // The pose, the shared water surface and the floor all describe the NEW
    // scene's hulls after a rebuild, so the epoch belongs here too.
  }, [entries, resultA, resultB, contextEpoch])

  const dimsA = dimensionsOf(meshA)
  const dimsB = dimensionsOf(meshB)
  const empty = meshA === null && meshB === null

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative min-h-0 flex-1">
        {/* The canvas is ALWAYS mounted: the scene, the water plane and the
            camera outlive every mesh and every result, and a canvas that
            appeared only with a hull would need its whole scene built twice. */}
        <div ref={mountRef} role="img" aria-label={caption} className="absolute inset-0" />

        {/*
          No labels over the picture: which hull is which is already said in
          the foot bar below - the colour chip, the name, the dimensions and
          the volume - and anything drawn on the canvas shadows the hulls it
          names.
        */}

        {glFailed && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-page px-6 text-center text-[12px] text-ink-3">
            WebGL is unavailable here, so the stage cannot be drawn — every number in the panel is
            still solved and correct.
          </div>
        )}

        {empty && !glFailed && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-page px-6 text-center">
            <div>
              <p className="text-[15px] text-ink">Drop a hull into A and B</p>
              <p className="mt-1 text-[12px] text-ink-3">or load two saved runs</p>
            </div>
          </div>
        )}
      </div>

      {/* The stage foot: what is in each slot, and the two view controls. */}
      <div className="flex items-center gap-4 border-t border-line px-4 py-2">
        {(['A', 'B'] as const).map((label, index) => {
          const name = index === 0 ? nameA : nameB
          const dims = index === 0 ? dimsA : dimsB
          const volume = volumeOf(index === 0 ? meshA : meshB)
          if (!name) return null
          return (
            <div key={label} className="flex min-w-0 items-center gap-2">
              <span
                className="rounded px-2 py-1 text-[11px] font-bold text-accent-ink"
                style={{ backgroundColor: `#${SLOT_COLORS[index].toString(16).padStart(6, '0')}` }}
              >
                {label}
              </span>
              <span className="truncate text-[11px] text-ink-2">{name}</span>
              {dims && (
                <span className="hidden font-mono text-[11px] tabular-nums text-ink-3 lg:inline">
                  {dims}
                </span>
              )}
              {/*
                The hull's volume, beside its dimensions: the one number that
                says how much boat there is, which is what the overlay used to
                try and failed to say (it showed a draft, which the table
                already gives in full). A slot restored from a saved RUN has
                no mesh in memory, so it shows neither.
              */}
              {volume && (
                <span className="hidden font-mono text-[11px] tabular-nums text-ink-3 lg:inline">
                  {volume}
                </span>
              )}
            </div>
          )
        })}
        <span className="flex-1" />
        {empty && <span className="text-[11px] text-ink-3">Nothing loaded</span>}
        {nameA && nameB && (
          <button
            type="button"
            onClick={onSwap}
            className="rounded-md border border-line-2 px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-panel-2 active:scale-[0.98]"
          >
            Swap A / B
          </button>
        )}
        <button
          type="button"
          onClick={fitView}
          className={`rounded-md border border-line-2 px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-panel-2 active:scale-[0.98] ${
            empty ? 'hidden' : ''
          }`}
        >
          Fit view
        </button>
      </div>
    </section>
  )
}
