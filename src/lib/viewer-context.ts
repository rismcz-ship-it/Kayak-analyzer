/**
 * WebGL context loss handling, shared by both viewers (`Viewer3D`, `CompareStage`).
 *
 * A GPU reset or a driver restart kills a canvas's context mid-session and fires
 * `webglcontextlost` on the canvas. Nothing in this app listened, so the context
 * died silently and the stage never came back. The two browser rules this module
 * exists to keep in ONE place:
 *
 *  - the event MUST be cancelled (`preventDefault`), or the context can never be
 *    restored. Both viewers rebuild the renderer rather than restoring in place,
 *    so the rule has to be right once, not re-implemented and re-verified twice.
 *  - a rebuild that renders a frame is a SUCCESS, so the "stop trying" cap counts
 *    losses with no successful frame between them.
 */

/**
 * How many rebuilds may fail before the app stops trying. Module-private on
 * purpose: the viewers ask the guard, they never read the number.
 */
const MAX_CONTEXT_RECOVERIES = 3

/**
 * One guard per viewer - when may it rebuild again?
 *
 * A frame that actually RENDERED proves the last rebuild worked, so `onFrame`
 * resets the count: a GPU that resets every few minutes recovers indefinitely.
 * A context that dies before its first frame is a different failure, and three
 * of those in a row stop the app instead of looping forever and allocating a
 * context per iteration.
 */
export function createRecoveryGuard(): {
  /** A frame rendered: whatever the last loss did, the stage is alive again. */
  onFrame(): void
  /** The context was lost. False once the cap is reached. */
  onLoss(): boolean
} {
  let losses = 0
  return {
    onFrame() {
      losses = 0
    },
    onLoss() {
      if (losses >= MAX_CONTEXT_RECOVERIES) return false
      losses += 1
      return true
    },
  }
}

/** The one property of the DOM event the wiring needs. */
export interface ContextLossEventLike {
  preventDefault(): void
}

/**
 * A canvas, or anything shaped like one. Both viewers pass `renderer.domElement`.
 * These are declared as METHODS, not function-typed properties, so parameter
 * bivariance lets a real `HTMLCanvasElement` satisfy the interface; converting
 * them to `addEventListener: (...) => void` makes `strictFunctionTypes` demand
 * contravariance and `tsc` rejects the canvas.
 */
export interface ContextLossTarget {
  addEventListener(type: 'webglcontextlost', listener: (event: ContextLossEventLike) => void): void
  removeEventListener(
    type: 'webglcontextlost',
    listener: (event: ContextLossEventLike) => void,
  ): void
}

/**
 * Watch a canvas for context loss. Returns the disposer.
 *
 * `preventDefault()` runs FIRST, so the browser keeps the context restorable;
 * `onLost` runs second - the viewer captures nothing here, it bumps its epoch and
 * lets React re-run its mount effect.
 */
export function watchContextLoss(target: ContextLossTarget, onLost: () => void): () => void {
  const listener = (event: ContextLossEventLike) => {
    event.preventDefault()
    onLost()
  }
  target.addEventListener('webglcontextlost', listener)
  return () => target.removeEventListener('webglcontextlost', listener)
}
