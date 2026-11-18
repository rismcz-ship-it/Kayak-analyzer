import {
  type DragEvent,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
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
import { SECURE_CONTEXT_ERROR, sha256Hex } from '../lib/model-hash'

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
  /**
   * SHA-256 (lowercase hex) of the file's RAW bytes, computed at load before
   * orientation or centring. The mesh's identity: it survives the ×1000
   * rescale (same file, corrected units) and identifies re-picks. EMPTY when
   * the page could not hash (no `crypto.subtle` - a plain-http host, an older
   * runtime): the load still completes, because the viewer and the solve do
   * not need the hash, and `recordFromSolve` refuses the empty string so a
   * record with no identity can never enter the roster.
   */
  sha256Hex: string
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
    // The hash describes the file, not the vertices: the user correcting the
    // units of the same STL must not change its identity.
    sha256Hex: mesh.sha256Hex,
  }
}

/**
 * What a parent can do to a mounted Upload: open the OS file picker itself.
 *
 * Compare's "Replace STL" uses it so the picker comes up on that one click,
 * instead of emptying the slot first and asking for another click on a drop
 * zone. React 19 passes `ref` straight to a function component, so this is a
 * plain prop rather than `forwardRef`.
 */
export interface UploadHandle {
  open: () => void
}

interface UploadProps {
  onLoaded: (mesh: LoadedMesh) => void
  compact?: boolean
  /** Overrides the compact variant's "Load another hull" wording. */
  prompt?: string
  ref?: Ref<UploadHandle>
  /**
   * What the component is doing, for a parent that cannot show the component
   * itself.
   *
   * Compare's "Replace STL" mounts the picker behind a `display:none`
   * wrapper, so the button's own "Parsing…" and error text are invisible: a
   * file that failed to parse would vanish without a word. A parent that
   * mounts the Upload out of sight reports its state here instead.
   */
  onStatus?: (status: { busy: boolean; error: string | null }) => void
}

/**
 * The session's geometry cache ceiling. Every entry holds a whole geometry and
 * nothing else ever releases one, so an unbounded map is a slow leak on a
 * re-pick-heavy session.
 */
export const MESH_CACHE_MAX = 8

/**
 * Remember a mesh in the session cache, keyed by its file identity.
 *
 * Both tabs share ONE cache — App owns it, fills it on every successful home
 * solve, and hands it to the Compare tab — so a hull solved at home is already
 * there when its record is picked and the overlay appears without a re-upload.
 *
 * An EMPTY hash means the page could not hash the file (no `crypto.subtle`):
 * it identifies nothing, so it is not cached under a key no record will ever
 * look up (`recordFromSolve` refuses the empty string for the same reason).
 *
 * A re-remembered hash is refreshed, not left in place: `Map.set` on an
 * existing key keeps the original insertion position, so without the explicit
 * delete a hull that is re-solved every run would be the FIRST evicted — the
 * exact opposite of what its use should earn it. A slot already displaying
 * that mesh keeps it in its own state, so an eviction only costs a re-upload
 * the next time the record is picked.
 */
export function rememberMesh(cache: Map<string, LoadedMesh>, mesh: LoadedMesh): void {
  if (mesh.sha256Hex === '') return
  cache.delete(mesh.sha256Hex)
  cache.set(mesh.sha256Hex, mesh)
  while (cache.size > MESH_CACHE_MAX) {
    const oldest = cache.keys().next()
    if (oldest.done) return
    cache.delete(oldest.value)
  }
}

export default function Upload({ onLoaded, compact = false, prompt, ref, onStatus }: UploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Report the component's state to a parent that cannot show the component.
   *
   * The report is guarded by the last one sent, so a parent whose callback is
   * rebuilt on every render is not called back on every render — which would
   * be a render loop for a parent that stores the report in state.
   */
  const reportedRef = useRef<{ busy: boolean; error: string | null } | null>(null)
  useEffect(() => {
    if (!onStatus) return
    const last = reportedRef.current
    if (last && last.busy === busy && last.error === error) return
    reportedRef.current = { busy, error }
    onStatus({ busy, error })
  }, [busy, error, onStatus])

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
        // Identity of the RAW bytes, before any pipeline step can rewrite
        // them. Best-effort: a page that cannot hash still loads its mesh -
        // the viewer, the solve and the form do not read the hash - and
        // carries '' with a note, rather than losing the load to a
        // Compare-only capability. Anything else a hashing failure could be
        // still aborts here, as before. `recordFromSolve` refuses '' later, so
        // a record with no identity never enters the roster.
        let hash = ''
        try {
          hash = await sha256Hex(buffer)
        } catch (err) {
          if (err instanceof Error && err.message !== SECURE_CONTEXT_ERROR) throw err
          setError(`Loaded without a model hash: ${SECURE_CONTEXT_ERROR}`)
        }
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
          sha256Hex: hash,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error'
        // A secure-context refusal is about the page, not this file: "Could not
        // parse" would send the user hunting a corrupt STL that parses fine.
        setError(
          message === SECURE_CONTEXT_ERROR ? message : `Could not parse ${file.name}: ${message}`,
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

  // Stable: the imperative handle and the button share it, and a handle that
  // rebuilt its callback on every render would be a new handle every render.
  const openPicker = useCallback(() => inputRef.current?.click(), [])

  // The handle only opens the picker; the parse pipeline stays in the change
  // event, so both entry points behave identically.
  useImperativeHandle(ref, () => ({ open: openPicker }), [openPicker])

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
              {compact ? (prompt ?? 'Load another hull') : 'Drop an STL hull here'}
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
