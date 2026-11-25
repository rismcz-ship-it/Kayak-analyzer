import { useRef, useState } from 'react'
import { fmt } from '../lib/format'
import type { TrimSolveResult } from '../lib/hydrostatics'
import Upload, { type LoadedMesh, type UploadHandle } from './Upload'
import Viewer3D from './Viewer3D'

interface AnalyzeStageProps {
  mesh: LoadedMesh | null
  result: TrimSolveResult | null
  /** Applied heel for the viewer: the slider value only when the toggle is on. */
  heelDeg: number
  onLoaded: (mesh: LoadedMesh) => void
}

/**
 * The 3D stage and its foot bar.
 *
 * The stage is the whole left column: the viewer when a hull is loaded, the
 * drop card when it is not. The foot bar carries only what identifies the mesh
 * — name, extents, watertight verdict — and the one action that changes it.
 * Everything numeric that the solver produces lives in the right panel.
 */
export default function AnalyzeStage({ mesh, result, heelDeg, onLoaded }: AnalyzeStageProps) {
  const uploadRef = useRef<UploadHandle | null>(null)
  const [replace, setReplace] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  })
  const s = mesh?.stats

  return (
    <section className="flex h-[45vh] min-h-0 flex-none flex-col overflow-hidden lg:h-auto lg:flex-1">
      <div className="relative min-h-0 flex-1">
        {mesh ? (
          <Viewer3D
            key={mesh.id}
            geometry={mesh.geometry}
            waterlineZ={result?.waterlineZ ?? null}
            trimDeg={result?.trimDeg ?? 0}
            heelDeg={result?.heelDeg ?? heelDeg}
            lcg={result?.lcg ?? null}
            lcb={result?.lcb ?? null}
            pivot={result?.pivot ?? null}
          />
        ) : (
          <div className="stage-grid flex h-full items-center justify-center bg-page">
            <Upload onLoaded={onLoaded} />
          </div>
        )}
      </div>

      <div className="flex h-10 flex-none items-center gap-4 border-t border-line bg-page px-4 text-[11px] text-ink-3">
        {mesh && s ? (
          <>
            <span className="truncate font-mono text-ink-2" title={mesh.fileName}>
              {mesh.fileName}
            </span>
            <span className="hidden shrink-0 sm:inline">
              {fmt(s.bounds.size.x)} × {fmt(s.bounds.size.y)} × {fmt(s.bounds.size.z)} mm
            </span>
            {s.watertight.watertight ? (
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <i className="h-1.5 w-1.5 rounded-full bg-good" />
                watertight
              </span>
            ) : (
              <span className="inline-flex shrink-0 items-center gap-1.5 text-warn">
                <i className="h-1.5 w-1.5 rounded-full bg-warn" />
                {s.watertight.openEdgeCount} open edges
              </span>
            )}

            <span className="flex-1" />

            {replace.busy ? (
              <span className="shrink-0">Parsing…</span>
            ) : replace.error ? (
              <span className="max-w-[44ch] shrink-0 truncate text-bad" title={replace.error}>
                {replace.error}
              </span>
            ) : null}

            <button
              type="button"
              onClick={() => uploadRef.current?.open()}
              className="h-7 shrink-0 rounded-md border border-line-2 px-3 text-[11px] text-ink-2 transition-colors hover:border-ink-3 hover:bg-panel hover:text-ink"
            >
              Replace STL
            </button>
            <Upload ref={uploadRef} onLoaded={onLoaded} variant="hidden" onStatus={setReplace} />
          </>
        ) : (
          <span>No model loaded</span>
        )}
      </div>
    </section>
  )
}
