import { type DragEvent, useCallback, useRef, useState } from 'react'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import type { BufferGeometry } from 'three'
import { analyzeMesh, centerToOrigin, computeBounds, type MeshStats } from '../lib/geometry'

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB cap, in-memory only

export interface LoadedMesh {
  id: number
  fileName: string
  sizeBytes: number
  geometry: BufferGeometry
  stats: MeshStats
  orientNote: string
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
        setError(
          `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is 25 MB`,
        )
        return
      }
      setError(null)
            setBusy(true)
            try {
              const buffer = await file.arrayBuffer()
              const geometry = new STLLoader().parse(buffer) // non-indexed, mm units

              const positions = geometry.getAttribute('position').array as Float32Array

              // NO auto-orient — keep raw STL axes so user can rotate manually with Rot buttons.
              // Just center at origin so the model loads in view.
              const preCenter = computeBounds(positions).center
              centerToOrigin(positions)
              const dx = -preCenter.x
              const dy = -preCenter.y
              const dz = -preCenter.z
              const orientNote = `Raw STL axes · centered by (${dx.toFixed(1)}, ${dy.toFixed(1)}, ${dz.toFixed(1)}) mm`
              geometry.computeVertexNormals()

              const stats = analyzeMesh(positions)
        onLoaded({
          id: Date.now(),
          fileName: file.name,
          sizeBytes: file.size,
          geometry,
          stats,
          orientNote,
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
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={openPicker}
      className={[
        'group flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors',
        dragging
          ? 'border-sky-400 bg-sky-400/10'
          : 'border-zinc-700 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-900/70',
        compact ? 'gap-1 px-4 py-5' : 'gap-2 px-6 py-14',
      ].join(' ')}
    >
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

      <svg
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
        <p className="text-sm text-zinc-300">Parsing…</p>
      ) : (
        <>
          <p className="text-sm font-medium text-zinc-200">
            {compact ? 'Load another hull' : 'Drop an STL hull here'}
          </p>
          <p className="text-xs text-zinc-500">
            or click to browse · ≤ 25 MB · parsed in memory, nothing is uploaded
          </p>
        </>
      )}

      {error && (
        <p className="max-w-xs text-xs text-rose-400" title={error}>
          {error}
        </p>
      )}
    </div>
  )
}