// The Compare half of Task 4: one slot's solve session.
//
// verify-worker-protocol.ts pins the worker and its client. This module is
// the seam the Compare UI (Task 6) drives instead, and it owns exactly two
// decisions, both of them silent without a suite:
//
//  1. **One SlotSolver per slot, each owning one SolverClient.** Compare
//     shows two hulls being edited independently. If both slots shared one
//     client, an input edit in slot A would terminate slot B's worker
//     mid-solve and reject its promise — B's panel would hang on "Solving…"
//     with nothing to recover from. Per-slot clients make "editing A never
//     cancels B" structural rather than something the UI has to remember.
//
//  2. **The request mapping is verbatim.** kgMm is a HEIGHT above the keel,
//     never an absolute Z (this repo already shipped that unit bug once), and
//     heelDeg is the marine sign, + = the -Y side down. Both cross to the
//     worker exactly as the slot's inputs carry them; the solver's own
//     fallbacks (KG 280, heel 0) and its narrower default ±3.5° sweep must
//     never be able to stand in for a slot's answer. The sweep pair comes from
//     the shared `solve-params` constants App.tsx also imports, so the slot
//     flow and the single-viewer flow can never drift apart onto different
//     trim ladders.
//
// It is tested from Node against a fake Worker global (all of
// tests/verify-slot-solver.ts), the same seam the protocol suite drives.

import type { SlotInputs } from './compare'
import type { TrimSolveResult } from './hydrostatics'
import { MAX_TRIM_DEG, TRIM_STEP_DEG } from './solve-params'
import { SolverClient } from './solver-client'
import type { SolveRequest } from './solver-worker'

export type SolveProgress = { done: number; total: number; angleDeg: number }

export class SlotSolver {
  private readonly client = new SolverClient()

  /**
   * Solve one slot's hull with that slot's inputs. The caller's positions are
   * copied by the client before being transferred, so the array the viewer
   * holds is still intact when this returns; a second call on the same slot
   * cancels the first (rejecting its promise with 'cancelled') and a result
   * from the dead run is never delivered.
   */
  solve(
    positions: Float32Array,
    inputs: SlotInputs,
    onProgress: (p: SolveProgress) => void,
  ): Promise<TrimSolveResult> {
    const request: SolveRequest = {
      targetKg: inputs.weightKg,
      targetLcgPercentFromBow: inputs.lcgPctLwl,
      // A height above the keel, verbatim (Review Focus 1).
      kgMm: inputs.kgMm,
      // + = the -Y side down, verbatim (Review Focus 3).
      fixedHeelDeg: inputs.heelDeg,
      // The documented +-4.5° / 0.1° sweep, from the shared constants - the
      // solver's own fallback is the narrower +-3.5°, and a request that
      // dropped these would search a different ladder.
      maxTrimDeg: MAX_TRIM_DEG,
      trimStepDeg: TRIM_STEP_DEG,
      positions,
    }
    return this.client.run(request, onProgress)
  }

  /** Terminate this slot's in-flight solve, rejecting its promise. */
  cancel(): void {
    this.client.cancel()
  }
}
