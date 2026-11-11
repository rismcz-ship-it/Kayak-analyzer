import { type DragEvent, useCallback, useRef, useState } from 'react'
import { BufferAttribute, BufferGeometry } from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import {
  analyzeMesh,
  autoOrientToZUp,
  centerToOrigin,
  computeBounds,
  type MeshStats,
  rescalePositions,
  type ScaleAdvice,
  scaleAdviceFor,
} from '../lib/geometry'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB cap, in-memory only

/**
 * Unique per loaded mesh. `Date.now()` collides for two loads in the same
 * millisecond, which reused a React key; a counter cannot. The key only forces
 * the viewer to remount (its mount effect is keyed on the geometry), so this is
 * tidiness rather than a bug fix — but it is free.
 */
let nextMeshId = 1

export interface LoadedMesh {
  id: number
  fileName: string
  sizeBytes: number
  geometry: BufferGeometry
  stats: MeshStats
  orientNote: string
  /** Unit sanity flag from the oriented bounds; undefined when nothing is off. */
  scaleAdvice?: ScaleAdvice
}

/**
 * Rebuild a mesh at a new scale, for the explicit "Apply ×1000" path only.
 *
 * The position array is copied into a fresh buffer and a new geometry built from
 * it: rescaling the viewer's own array in place would rewrite the buffer it is
 * drawing from, mid-frame, and the new `id` remounts the viewer (its `key`).
 */
export function rescaleMesh(mesh: LoadedMesh, factor: number): LoadedMesh {
  const scaled = rescalePositions(
    mesh.geometry.getAttribute('position').array as Float32Array,
    factor,
  )
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(scaled, 3))
  geometry.computeVertexNormals()
  const stats = analyzeMesh(scaled)
  const fresh = scaleAdviceFor(stats.bounds.size)
  return {
    id: nextMeshId++,
    fileName: mesh.fileName,
    sizeBytes: mesh.sizeBytes,
    geometry,
    stats,
    // The rescaled mesh is mm by construction, so re-offering the ×1000 button
    // would be advice about a mesh this user has already corrected. `small` and
    // `large` describe the resulting geometry itself and are worth keeping: a
    // 0.9 m file really is a 900 mm hull after the conversion, and that is too
    // short for a boat.
    scaleAdvice: fresh?.kind === 'metres' ? undefined : fresh,
    orientNote: `${mesh.orientNote} · ×${factor} applied to reach mm`,
  }
}

interface UploadProps {
  onLoaded: (mesh: LoadedMesh) => void
  compact?: boolean
}

export default function Upload({ onLoaded, compact = false }: UploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.stl')) {
        setError(`${file.name} is not an .stl file`)
        return
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 25 MB`)
        return
      }
      setError(null)
      setBusy(true)
      try {
        const buffer = await file.arrayBuffer()
        const geometry = new STLLoader().parse(buffer) // non-indexed, mm units

        const positions = geometry.getAttribute('position').array as Float32Array

        // Auto-orient on load: longest → X (length), middle → Y (beam), shortest → Z (depth).
        // Detects keel-up and flips Z for deck-up. Rotates bow to +X via volume centroid.
        const orientNote = autoOrientToZUp(positions)

        // Center at origin so the model loads in view.
        const preCenter = computeBounds(positions).center
        centerToOrigin(positions)
        geometry.computeVertexNormals()

        const stats = analyzeMesh(positions)
        const scaleAdvice = scaleAdviceFor(stats.bounds.size)
        // The centring offsets are in the FILE's units. mm is the only one the
        // app can vouch for, and only when the bounds raise no flag; `metres`
        // names its own unit, and the rest are labelled unresolved instead of
        // quietly mislabelled mm.
        const unit =
          scaleAdvice === undefined ? 'mm' : scaleAdvice.kind === 'metres' ? 'm' : 'file units'
        const fullNote = `${orientNote} · centered by (${(-preCenter.x).toFixed(1)}, ${(-preCenter.y).toFixed(1)}, ${(-preCenter.z).toFixed(1)}) ${unit}`
        onLoaded({
          id: nextMeshId++,
          fileName: file.name,
          sizeBytes: file.size,
          geometry,
          stats,
          scaleAdvice,
          orientNote: fullNote,
        })
      } catch (err) {
        setError(
          `Could not parse ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`,
        )
      } finally {
        setBusy(false)
      }
    },
    [onLoaded],
  )

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  const openPicker = () => inputRef.current?.click()

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".stl"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={openPicker}
        className={[
          'group flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors',
          dragging
            ? 'border-sky-400 bg-sky-400/10'
            : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-900/70',
          compact ? 'gap-1 px-4 py-5' : 'gap-2 px-6 py-14',
        ].join(' ')}
      >
        <svg
          aria-hidden="true"
          className={compact ? 'h-6 w-6 text-zinc-500' : 'h-10 w-10 text-zinc-500'}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
          />
        </svg>

        {busy ? (
          <span className="block text-sm text-zinc-300">Parsing…</span>
        ) : (
          <>
            <span className="block text-sm font-medium text-zinc-200">
              {compact ? 'Load another hull' : 'Drop an STL hull here'}
            </span>
            <span className="block text-xs text-zinc-500">
              or click to browse · ≤ 25 MB · parsed in memory, nothing is uploaded
            </span>
          </>
        )}
        {error && (
          <span className="block max-w-xs text-xs text-rose-400" title={error}>
            {error}
          </span>
        )}
      </button>
    </>
  )
}
