import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { BufferGeometry } from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

interface Viewer3DProps {
  geometry: BufferGeometry
  /** Absolute waterline height (mesh Z coords). Null hides the plane. */
  waterlineZ?: number | null
}

export default function Viewer3D({ geometry, waterlineZ = null }: Viewer3DProps) {
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
    scene.add(mesh)

    // Waterline plane: translucent horizontal sheet at the solved draft so the
    // numeric result is visible in 3D. Sized from the hull footprint (+20%
    // margin) and centered on the hull XY center.
    let waterPlane: THREE.Mesh | null = null
    if (waterlineZ !== null && Number.isFinite(waterlineZ)) {
      geometry.computeBoundingBox()
      const wbb = geometry.boundingBox
      if (wbb) {
        const w = Math.max(wbb.max.x - wbb.min.x, 1) * 1.2
        const hgt = Math.max(wbb.max.y - wbb.min.y, 1) * 1.2
        const cx = (wbb.max.x + wbb.min.x) / 2
        const cy = (wbb.max.y + wbb.min.y) / 2
        waterPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(w, hgt),
          new THREE.MeshBasicMaterial({
            color: 0x0284c7,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        )
        waterPlane.position.set(cx, cy, waterlineZ)
        scene.add(waterPlane)
      }
    }

    // Frame camera around the hull, keep its real coordinates.
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    if (bb) {
      bb.getSize(size)
      bb.getCenter(center)
    }
    const radius = (Math.max(size.x, size.y, size.z) || 1) * 0.6

    // 3/4 bow view from above: length along X, beam along Y, up along Z.
    const dir = new THREE.Vector3(1, -1.1, 0.55).normalize()
    camera.position.copy(center).addScaledVector(dir, radius * 3)
    camera.near = Math.max(radius / 1000, 0.001)
    camera.far = radius * 1000
    camera.updateProjectionMatrix()
    controls.target.copy(center)
    controls.update()

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
      scene.remove(mesh)
      if (waterPlane) {
        waterPlane.geometry.dispose()
        ;(waterPlane.material as THREE.Material).dispose()
        scene.remove(waterPlane)
      }
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [geometry, waterlineZ])

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
    </div>
  )
}