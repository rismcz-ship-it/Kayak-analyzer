// Main-thread half of Task 4: one worker, progress, and cancel.
//
// The client owns the worker's lifetime. `run` creates it lazily and terminates
// the previous one first, so at most one solve is ever in flight — the viewer
// shares the main thread with this, and a solve is seconds of solid JS.
//
// The positions are copied before they are transferred. A transfer detaches the
// buffer from the sender, so handing the viewer's own Float32Array over would
// blank the mesh for every frame drawn afterwards; the copy costs one memcpy
// against a seconds-long solve.
//
// It is tested from Node with a fake Worker global (section 5 of
// tests/verify-worker-protocol.ts): the lifecycle is the part of this file that
// can be wrong in a way a browser check only shows Richard by hand.

import type { TrimSolveResult } from './hydrostatics'
import type { SolveRequest, WorkerMessage } from './solver-worker'

export class SolverClient {
  private worker: Worker | null = null
  /** Increments per run: a message from an older run is a late message. */
  private runId = 0
  private pending: { reject: (err: Error) => void } | null = null

  /**
   * Rejects with `Error('cancelled')` if `cancel()` runs or another `run()`
   * replaces this one, and with the solver's own message on a failed solve.
   */
  run(
    req: SolveRequest,
    onProgress: (p: { done: number; total: number; angleDeg: number }) => void,
  ): Promise<TrimSolveResult> {
    // One solve at a time: starting a second run cancels the first, with the
    // same 'cancelled' rejection the Cancel button produces, so a caller never
    // has to guard against a stale result arriving after a new request.
    if (this.pending) this.cancel()

    const buffer = new Float32Array(req.positions)
    const myRun = ++this.runId
    const worker = new Worker(new URL('./solver-worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker

    return new Promise<TrimSolveResult>((resolve, reject) => {
      /** Retire this run and stop its worker, whatever settled it. */
      const retire = () => {
        this.pending = null
        if (this.worker === worker) this.worker = null
        worker.terminate()
      }

      this.pending = { reject }

      // The staleness guard in both handlers: a message from a run that has
      // since been cancelled or replaced is dropped rather than delivered.
      // terminate() does not guarantee a queued message died with it either.
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        if (myRun !== this.runId) return
        const msg = e.data
        if (msg.type === 'angle') {
          onProgress({ done: msg.index, total: msg.total, angleDeg: msg.angleDeg })
        } else if (msg.ok) {
          retire()
          resolve(msg.result)
        } else {
          retire()
          reject(new Error(msg.error))
        }
      }
      // Without this, a worker that dies (a module that fails to load, an
      // uncaught error) leaves the promise pending forever and the UI stuck.
      worker.onerror = (e: ErrorEvent) => {
        if (myRun !== this.runId) return
        retire()
        reject(new Error(`solver worker failed: ${e.message || 'unknown error'}`))
      }

      worker.postMessage({ ...req, positions: buffer }, { transfer: [buffer.buffer] })
    })
  }

  /** Terminate the in-flight worker and reject its promise with 'cancelled'. */
  cancel(): void {
    if (!this.pending) return
    const { reject } = this.pending
    // Retire the run first: anything already in flight from it is stale by
    // definition, and terminate() does not guarantee no message was queued.
    this.runId++
    this.pending = null
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    // Reject directly, not through the message handlers: they all read the
    // staleness guard above, so a cancel routed through them would find
    // myRun !== runId and leave the promise unsettled forever. That exact bug
    // is what section 5 of the protocol suite pins.
    reject(new Error('cancelled'))
  }
}
