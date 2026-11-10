// The hydrostatics solve, on its own thread.
//
// A full solve is seconds of solid JavaScript: the clipper runs ~950 plane cuts
// and nothing on the main thread can paint while it does, so the viewer freezes
// and the browser eventually shows its "page unresponsive" dialog. This module
// is the worker half of Task 4 — a thin seam over solveTrim that posts progress
// and a final result as small structured messages, so the UI thread only ever
// handles small objects.
//
// `handleSolveRequest` takes its post function as an argument so the protocol
// can be driven from Node (tests/verify-worker-protocol.ts): the message
// contract is the part of this task that can be wrong in a way no browser
// check catches cheaply. The wiring at the bottom is the browser half.

import type { TrimSolveResult } from './hydrostatics'
import { solveTrim } from './hydrostatics'

export type SolveRequest = {
  positions: Float32Array
  targetKg: number
  targetLcgPercentFromBow: number
  kgMm: number
  fixedHeelDeg: number
  maxTrimDeg: number
  trimStepDeg: number
}

export type SolveResponse =
  | { type: 'result'; ok: true; result: TrimSolveResult }
  | { type: 'result'; ok: false; error: string }

export type ProgressMessage = {
  type: 'angle'
  index: number
  total: number
  angleDeg: number
  phase: 'coarse' | 'fine'
}

export type WorkerMessage = ProgressMessage | SolveResponse

/** Node-testable core: run one request, posting progress + the final response. */
export function handleSolveRequest(req: SolveRequest, post: (msg: WorkerMessage) => void): void {
  try {
    // Solved in place, on the transferred buffer. solveTrim copies the mesh
    // itself before it pitches scratch over it (hydrostatics.ts, the
    // workingPositions beside the cheap sweep), so the request's own array is
    // never rewritten — check #1 in verify-worker-protocol.ts asserts exactly
    // that, and it is the guard: if the solver ever starts writing in place,
    // this suite fails and the fix is a copy here.
    const result = solveTrim(req.positions, req.targetKg, {
      targetLcgPercentFromBow: req.targetLcgPercentFromBow,
      kgMm: req.kgMm,
      fixedHeelDeg: req.fixedHeelDeg,
      maxTrimDeg: req.maxTrimDeg,
      trimStepDeg: req.trimStepDeg,
      onAngle: (info) => {
        post({
          type: 'angle',
          index: info.index,
          total: info.total,
          angleDeg: info.angleDeg,
          phase: info.phase,
        })
      },
    })
    post({ type: 'result', ok: true, result })
  } catch (err) {
    // Every throw becomes a message. A promise that never settles is the one
    // failure the UI cannot recover from, and the solver does throw (an
    // impossible KG, a mesh whose bounds it cannot read) — see the guard on
    // kgMm in solveTrim.
    post({ type: 'result', ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// --- browser wiring ----------------------------------------------------------
//
// Typed through a local cast rather than the webworker lib: that lib collides
// with DOM in a single tsconfig program, and this seam needs four members. The
// guard keeps the module importable under Node/tsx, where attaching nothing is
// the correct behaviour.
//
// It must be a *worker* test, not just "postMessage exists": a browser's window
// has a postMessage function too, so this module would otherwise install a
// handler that runs a full hydrostatics solve on any message posted to the
// page. `importScripts` exists only in a worker global — the DOM lib does not
// declare it, hence the optional member on the cast.

const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent<SolveRequest>) => void) | null
  postMessage: (msg: unknown) => void
  importScripts?: unknown
}
if (typeof ctx.importScripts === 'function' && !ctx.onmessage) {
  ctx.onmessage = (e) => handleSolveRequest(e.data, ctx.postMessage)
}
