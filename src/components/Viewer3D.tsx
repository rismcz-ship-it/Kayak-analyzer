import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { BufferGeometry } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

interface Viewer3DProps {
  geometry: BufferGeometry
  /** Absolute waterline height (mesh Z coords). Null hides the plane. */
  waterlineZ?: number | null
  /** Trim angle in degrees (+ bow up, - bow down). */
  trimDeg?: number
  /** Heel angle in degrees (+ starboard/right heel). */
  heelDeg?: number
  /** Waterline center Y for trimming pivot. */
  waterlineCenterY?: number
  /** Center of Gravity (LCG) position in mesh coordinates. */
  lcg?: { x: number; y: number; z: number } | null
  /** Center of Buoyancy (LCB) position in mesh coordinates. */
    lcb?: { x: number; y: number; z: number } | null
    /** Rotation pivot point (X, Y, Z) in mesh coordinates. Matches solver's applyPitchY pivot. */
    pivot?: { x: number; y: number; z: number } | null
    /** Rotate hull to show trim/heel (true = real life, false = rotate waterline). Default true. */
    rotateHull?: boolean
  }

export default function Viewer3D({
  geometry,
  waterlineZ = null,
  trimDeg = 0,
  heelDeg = 0,
  waterlineCenterY = 0,
  lcg = null,
  lcb = null,
  pivot = null,
  rotateHull = true,
}: Viewer3DProps) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

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

        // Add coordinate axes helper (Red=X, Green=Y, Blue=Z) - world axes
        const axesHelper = new THREE.AxesHelper(500)
        scene.add(axesHelper)

        // Determine pivot point: pivot prop > LCG > hull center
                const pivotVec = pivot
                  ? new THREE.Vector3(pivot.x, pivot.y, pivot.z)
                  : lcg
                    ? new THREE.Vector3(lcg.x, lcg.y, lcg.z)
                    : center.clone()

                // Apply hull rotation (trim + heel) if rotateHull=true
                if (rotateHull) {
                  const trimRad = (trimDeg * Math.PI) / 180
                  const heelRad = (heelDeg * Math.PI) / 180

                  // Offset mesh so pivot sits at group origin
                  mesh.position.set(-pivotVec.x, -pivotVec.y, -pivotVec.z)

                  // Move group so pivot is at world pivot position
                  hullGroup.position.copy(pivotVec)

                  // Rotate around X (heel) then Y (trim). Order: heel first, then trim.
                  hullGroup.rotation.x = heelRad
                                    hullGroup.rotation.y = trimRad
                                  }

                                // Waterline plane: horizontal at waterlineZ (world coords).
                                                                              // If rotateHull=true, hull rotates and waterline stays horizontal.
                                                                              // If rotateHull=false, hull stays fixed and waterline rotates opposite (legacy).
                                                                              let waterPlaneMesh: THREE.Mesh | null = null
                                                                              let waterPlaneGroup: THREE.Group | null = null
                                                                              if (waterlineZ !== null && Number.isFinite(waterlineZ)) {
                                                const wbb = geometry.boundingBox
                                                if (wbb) {
                                                  const w = Math.max(wbb.max.x - wbb.min.x, 1) * 1.2
                                                  const hgt = Math.max(wbb.max.y - wbb.min.y, 1) * 1.2

                                                  waterPlaneMesh = new THREE.Mesh(
                                                    new THREE.PlaneGeometry(w, hgt),
                                                    new THREE.MeshBasicMaterial({
                                                      color: 0x0284c7,
                                                      transparent: true,
                                                      opacity: 0.35,
                                                      side: THREE.DoubleSide,
                                                      depthWrite: false,
                                                    }),
                                                  )

                                                  if (rotateHull) {
                                                    // Real life: hull rotates, waterline stays horizontal at waterlineZ
                                                    // Waterline should be centered at the ROTATED hull center
                                                    hullGroup.updateMatrixWorld(true)
                                                    const rotatedCenter = center.clone().applyMatrix4(hullGroup.matrixWorld)
                                                    waterPlaneMesh.position.set(rotatedCenter.x, rotatedCenter.y, waterlineZ)
                                                    scene.add(waterPlaneMesh)
                                                  } else {
                                                    // Legacy: hull fixed, waterline rotates opposite to trim
                                                    const cx = (wbb.max.x + wbb.min.x) / 2
                                                    const cy = waterlineCenterY !== null ? waterlineCenterY : (wbb.max.y + wbb.min.y) / 2
                                                    const pivotX = lcg ? lcg.x : cx
                                                    const pivotY = cy
                                                    const pivotZ = center.z
                                                    waterPlaneMesh.position.set(cx - pivotX, cy - pivotY, waterlineZ - pivotZ)
                                                    waterPlaneGroup = new THREE.Group()
                                                    waterPlaneGroup.position.set(pivotX, pivotY, pivotZ)
                                                    waterPlaneGroup.add(waterPlaneMesh)
                                                    if (Math.abs(trimDeg) > 1e-6) {
                                                      waterPlaneGroup.rotation.y = (trimDeg * Math.PI) / 180
                                                    }
                                                    scene.add(waterPlaneGroup)
                                                  }
                                                }
                                              }

              // LCG marker (red sphere + vertical line to keel) - in hull local coords
    let lcgSphere: THREE.Mesh | null = null
    let lcgLine: THREE.Line | null = null
    if (lcg && Number.isFinite(lcg.x)) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false })
      lcgSphere = new THREE.Mesh(new THREE.SphereGeometry(hullSizeX * 0.02), mat)
      lcgSphere.position.set(lcg.x, lcg.y, lcg.z)
      lcgSphere.renderOrder = 1
      if (rotateHull) {
        hullGroup.add(lcgSphere)
      } else {
        scene.add(lcgSphere)
      }

      // Vertical line down to keel (in hull coords)
      const lineGeom = new THREE.BufferGeometry()
      const keelZ = bb ? bb.min.z : 0
      lineGeom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([lcg.x, lcg.y, lcg.z, lcg.x, lcg.y, keelZ], 3),
      )
      const lineMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 2, depthTest: false })
      lcgLine = new THREE.Line(lineGeom, lineMat)
      lcgLine.renderOrder = 1
      if (rotateHull) {
        hullGroup.add(lcgLine)
      } else {
        scene.add(lcgLine)
      }
    }

    // LCB marker (green sphere + vertical line to keel) - in hull local coords
    let lcbSphere: THREE.Mesh | null = null
    let lcbLine: THREE.Line | null = null
    if (lcb && Number.isFinite(lcb.x)) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false })
      lcbSphere = new THREE.Mesh(new THREE.SphereGeometry(hullSizeX * 0.02), mat)
      lcbSphere.position.set(lcb.x, lcb.y, lcb.z)
      lcbSphere.renderOrder = 1
      if (rotateHull) {
        hullGroup.add(lcbSphere)
      } else {
        scene.add(lcbSphere)
      }

      const lineGeom = new THREE.BufferGeometry()
      const keelZ = bb ? bb.min.z : 0
      lineGeom.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([lcb.x, lcb.y, lcb.z, lcb.x, lcb.y, keelZ], 3),
      )
      const lineMat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2, depthTest: false })
      lcbLine = new THREE.Line(lineGeom, lineMat)
      lcbLine.renderOrder = 1
      if (rotateHull) {
        hullGroup.add(lcbLine)
      } else {
        scene.add(lcbLine)
      }
    }

    const radius = (Math.max(size.x, size.y, size.z) || 1) * 0.6

        // 3/4 bow view from above: length along X, beam along Y, up along Z.
        const dir = new THREE.Vector3(1, -1.1, 0.55).normalize()
        // Camera target: rotated hull center in world coordinates
                if (rotateHull && pivotVec) {
                  // World matrix already updated above for waterplane; reuse rotatedCenter
                  const rotatedCenter = center.clone().applyMatrix4(hullGroup.matrixWorld)
                  camera.position.copy(rotatedCenter).addScaledVector(dir, radius * 3)
                  camera.near = Math.max(radius / 1000, 0.001)
                  camera.far = radius * 1000
                  camera.updateProjectionMatrix()
                  controls.target.copy(rotatedCenter)
                  controls.update()
                } else {
                          // Camera target: unrotated hull center
                          camera.position.copy(center).addScaledVector(dir, radius * 3)
                          camera.near = Math.max(radius / 1000, 0.001)
                          camera.far = radius * 1000
                          camera.updateProjectionMatrix()
                          controls.target.copy(center)
                          controls.update()
                        }

                    // GridHelper builds in the XZ plane (Y-up normal); rotate it into the XY
    // plane so its normal is +Z and it sits under the hull at min Z.
    const grid = new THREE.GridHelper(radius * 6, 24, 0x3f3f46, 0x27272a)
    grid.rotation.x = Math.PI / 2
    grid.position.z = bb ? bb.min.z : 0
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
          
              // Cleanup waterline mesh (both modes)
              if (waterPlaneMesh) {
                waterPlaneMesh.geometry.dispose()
                ;(waterPlaneMesh.material as THREE.Material).dispose()
                if (rotateHull) {
                  scene.remove(waterPlaneMesh)
                } else if (waterPlaneGroup) {
                  waterPlaneGroup.remove(waterPlaneMesh)
                }
              }
              if (waterPlaneGroup) {
                scene.remove(waterPlaneGroup)
              }
      if (lcgSphere) {
        lcgSphere.geometry.dispose()
        ;(lcgSphere.material as THREE.Material).dispose()
        if (rotateHull) {
          hullGroup.remove(lcgSphere)
        } else {
          scene.remove(lcgSphere)
        }
      }
      if (lcgLine) {
        lcgLine.geometry.dispose()
        ;(lcgLine.material as THREE.Material).dispose()
        if (rotateHull) {
          hullGroup.remove(lcgLine)
        } else {
          scene.remove(lcgLine)
        }
      }
      if (lcbSphere) {
        lcbSphere.geometry.dispose()
        ;(lcbSphere.material as THREE.Material).dispose()
        if (rotateHull) {
          hullGroup.remove(lcbSphere)
        } else {
          scene.remove(lcbSphere)
        }
      }
      if (lcbLine) {
        lcbLine.geometry.dispose()
        ;(lcbLine.material as THREE.Material).dispose()
        if (rotateHull) {
          hullGroup.remove(lcbLine)
        } else {
          scene.remove(lcbLine)
        }
      }
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [geometry, waterlineZ, trimDeg, heelDeg, waterlineCenterY, lcg, lcb, rotateHull])

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
          trim = {trimDeg >= 0 ? '+' : ''}{trimDeg.toFixed(2)}°
        </div>
      )}
      {Math.abs(heelDeg) > 1e-6 && (
        <div className="pointer-events-none absolute right-2 top-40 rounded bg-violet-950/80 px-2 py-1 font-mono text-[10px] tracking-wide text-violet-300">
          heel = {heelDeg >= 0 ? '+' : ''}{heelDeg.toFixed(2)}°
        </div>
      )}
      {lcg && lcb && (
        <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-zinc-950/70 px-2 py-1 font-mono text-[10px] tracking-wide text-zinc-300">
          <div className="text-[#ef4444]">● LCG: ({lcg.x.toFixed(1)}, {lcg.y.toFixed(1)}, {lcg.z.toFixed(1)})</div>
          <div className="text-[#22c55e]">● LCB: ({lcb.x.toFixed(1)}, {lcb.y.toFixed(1)}, {lcb.z.toFixed(1)})</div>
          <div className="text-amber-300 mt-1">ΔX = {(lcb.x - lcg.x).toFixed(1)} mm</div>
        </div>
      )}
    </div>
  )
}