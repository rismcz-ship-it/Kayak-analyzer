# WebGL context loss - recover both viewers, don't just report it

Status: plan, reviewed and self-corrected; execution method chosen by Richard = NATIVE, this lane.
T1, T2, T3 implemented; T5 docs done; the known risk is checked and cleared (below). NOT yet
committed (repo rule is ask-first) and T4's browser pass is still Richard's step.
Baseline: `main` @ `bd1d9de` (1 ahead of `origin/main`, unpushed - unrelated to this work).

## Goal

A lost WebGL context must recover itself, in BOTH viewers. Today it does not recover at all: no
`webglcontextlost` listener exists anywhere in `src/`, so a GPU reset or a driver restart leaves a
black canvas, a keep-drawing loop aimed at a dead context, and no route back short of a reload.
The fix is automatic recovery - the stage tears down and rebuilds its GL resources and re-applies
the pose it had - with the existing "WebGL is unavailable" line as the terminal case when a rebuild
is not possible.

## The defect (evidence)

- `git grep -n "webglcontextlost" -- src` -> no matches (2026-11-27, `main` @ `bd1d9de`).
- Both renderers are created bare: `src/components/Viewer3D.tsx:462`,
  `src/components/CompareStage.tsx:198`. The `try/catch` around each covers CONSTRUCTION only
  (`Viewer3D.tsx:460-466`, `CompareStage.tsx:196-202`) and reports through `glFailed`; nothing
  watches the canvas afterwards.
- Consequence on Windows: a TDR or a driver update kills the context mid-session; the RAF loops
  (`Viewer3D.tsx:614-620`, `CompareStage.tsx:273-279`) keep calling `renderer.render` on a dead
  context and the user gets a dead stage with no explanation and no recovery.

## Architecture

Three additive pieces. No existing behaviour is rewritten.

1. **One shared seam**, `src/lib/viewer-context.ts` - the listener wiring and the recovery guard,
   used by both viewers, DOM-free and unit-tested. Mirrors `src/lib/viewer-conventions.ts`: one
   place for the two non-obvious browser rules.
2. **A context epoch** in each viewer - `const [contextEpoch, setContextEpoch] = useState(0)`
   added to the MOUNT effect's dependency array. A loss bumps the epoch, so React runs the
   existing teardown (which already disposes everything and removes the canvas) and re-runs the
   mount body: a fresh renderer, a fresh scene, and the pose restored, because the mount pass
   already applies the CURRENT view (`Viewer3D.tsx:447,572`).
3. **Downstream effects re-run off the same epoch** (CompareStage only, where slots and pose are
   separate effects: `CompareStage.tsx:310-332`, `335-384`): both gain `contextEpoch` in their dep
   arrays, so the hulls, the shared water surface and the floor are rebuilt into the new scene
   instead of being lost with it.

Why rebuild rather than restore in place: Three.js has no `forceContextRestore`, and the repo's
mount/teardown split already does exactly the right work in the right order. Re-running it is the
documented recipe and reuses tested code.

## Global constraints

- Pure frontend: no server, no new runtime dependency. `package.json` deps stay react, react-dom,
  recharts, three (0.186).
- The frozen spec is untouched: no solver, geometry, `viewer-conventions.ts` or scene-seam change.
  `applyResultToScene`, `makeSlotScene`, `applySlotResultToScene`, `applySharedWaterSurface` and
  `disposeSlotScene` keep their signatures and behaviour.
- `npm run ci` must exit 0 (typecheck -> biome -> the suites -> build). Windows: `npm.cmd`, and
  `npm.cmd exec -- tsx tests/<file>.ts`. Biome's summary is on stderr - judge by `$LASTEXITCODE`.
- Checkout starts from `main` @ `bd1d9de`. That commit is unpushed and needs the PR route; do not
  push anything without a go-ahead.

## Test strategy

- The seam gets a real assertion suite: `tests/verify-viewer-context.ts`, DOM-free, driven by a
  fake canvas object recording its listeners - the same trick `verify-worker-protocol.ts` uses for
  its fake `Worker` global.
- The React wiring (dep arrays, epoch bump, teardown order) is NOT unit-testable without a DOM/GL
  harness, which would be a new dependency. It is covered by typecheck + read-through, the same
  contract `tests/verify-viewer-scene.ts:49-53` already documents for the mount/update split. T5
  names exactly what to read.
- The recovery itself is verified in the browser (T4), with a DevTools snippet and acceptance
  criteria. That step is Richard's; I cannot run it.

## T1 - the shared seam, tests first

New file `src/lib/viewer-context.ts` (the whole module):

```ts
/**
 * WebGL context loss handling, shared by both viewers (`Viewer3D`, `CompareStage`).
 *
 * A GPU reset or a driver restart kills a canvas's context mid-session and fires
 * `webglcontextlost` on the canvas. Nothing in this app listened, so the
 * context died silently and the stage never came back. The rule this module
 * exists to keep in ONE place is the browser's: the event must be cancelled
 * (`preventDefault`), or the context can never be restored. We rebuild the
 * renderer rather than restoring it in place, so that rule has to be right once,
 * not re-implemented and re-verified twice.
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
```

TDD order: write the suite first and run it (it fails - the module does not exist), then add the
module, then watch it go green. A suite written after the module tends to restate it.

New file `tests/verify-viewer-context.ts` (header comment in the house style: one paragraph per
check saying why it earns its place; `process.exit(1)` on any failure). Its checks, in order:

The guard (this is the part that decides when the app stops trying, so it is asserted rather than
read):

1. A fresh guard allows the first three rebuilds: `onLoss()` -> true, true, true.
2. A fourth loss with no frame between them is refused, and stays refused.
3. `onFrame()` resets the count: three losses, one frame, then the next loss is allowed again.
4. A frame after every loss keeps recovery allowed indefinitely - 20 loss/frame pairs never refuse
   (this is the "a slow GPU is not a dead GPU" case).
5. A refused guard does not revive itself: only `onFrame()` brings it back.
6. Two guards are independent - one being refused says nothing about the other.

The listener:

7. `watchContextLoss` registers exactly ONE listener, typed `'webglcontextlost'` (a typo in the
    event name is the failure this catches - the listener would never fire and the suite would
    otherwise be green with a dead seam).
8. The function passed to `addEventListener` is the SAME reference later passed to
    `removeEventListener` (identity check, so a cleanup that removed nothing cannot pass).
9. Firing the event calls `event.preventDefault()` - the rule the whole recovery rests on.
10. `preventDefault()` runs BEFORE `onLost()` (a fake event/handler records the order).
11. `onLoss` is invoked exactly once per event.
12. The disposer removes that listener and leaves other listeners on the same target alone.
13. Firing the event after dispose does NOT call `onLost` (no listener left behind).
14. Two watchers on one target are independent: disposing the first leaves the second live.

Then wire the suite in: `package.json` `test` script gains
`tsx tests/verify-viewer-context.ts &&` immediately after the `verify-viewer-scene.ts` entry.
Scoped checks for T1: `npm.cmd run typecheck` and
`npm.cmd exec -- biome check --write src/lib/viewer-context.ts tests/verify-viewer-context.ts`,
then `npm.cmd exec -- tsx tests/verify-viewer-context.ts` (it must print all checks ok and exit 0).

## T2 - Viewer3D recovery

All edits in `src/components/Viewer3D.tsx`. Import first
(`import { createRecoveryGuard, watchContextLoss } from '../lib/viewer-context'`), then:

1. Next to `glFailed` (line 432), add:
   ```ts
   // A GL context that dies MID-SESSION (driver restart, TDR) gets no second
   // chance from the construction guard above, so the mount effect is re-run by
   // bumping this epoch instead. See `lib/viewer-context.ts`.
   const [contextEpoch, setContextEpoch] = useState(0)
   const recoveryRef = useRef(createRecoveryGuard())
   ```
   and extend the `glFailed` comment to say it now also reports a recovery that stopped retrying.
2. Immediately after `controls.enableDamping = true` (line 473), register the watch:
   ```ts
   const stopWatching: () => void = watchContextLoss(renderer.domElement, () => {
     if (!recoveryRef.current.onLoss()) {
       // Not recovering: stop the loop, drop the dead canvas, and answer with the
       // one line `glFailed` already renders. The scene is left for the unmount
       // cleanup, which still runs when the tab goes away.
       cancelAnimationFrame(raf)
       stopWatching()
       if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
       setGlFailed(true)
       return
     }
     setContextEpoch((n) => n + 1)
   })
   ```
   (`raf` is the `let raf = 0` declared at line 614; closing over it from the handler is fine -
   TS allows it, and it is initialised long before any event can fire. The explicit
   `() => void` annotation on `stopWatching` keeps the self-reference out of its own inferred
   type.)
3. In the RAF loop (lines 615-619), after `renderer.render(scene, camera)`:
   ```ts
   // A frame drew, so the last recovery survived: the guard counts losses with no
   // successful frame between them (see createRecoveryGuard).
   recoveryRef.current.onFrame()
   ```
4. Insert `stopWatching()` as the FIRST statement inside the teardown, before
   `cancelAnimationFrame(raf)` (line 623).
5. Mount effect deps (line 654): `[geometry]` -> `[geometry, contextEpoch]`, and reword the
   `--- Mount pass: once per mesh ---` comment to "once per mesh, and again if the GL context is
   lost".

The UPDATE effect (657-661) needs NO change: on the epoch bump the mount body re-runs and its own
`applyResultToScene(refs, initialView)` (line 572) re-applies the latest view from `viewRef`, so
the waterline plane and both markers come back posed.

## T3 - CompareStage recovery

All edits in `src/components/CompareStage.tsx`, same import.

1. Next to `glFailed` (line 135): the identical epoch + `recoveryRef` pair, and the same
   comment extension.
2. After `controls.enableDamping = true` (line 210): the identical `watchContextLoss` block (the
   `!recoveryRef.current.onLoss()` branch, same `cancelAnimationFrame(raf)`), where `raf` is the
   one declared at line 273. The guard is per-viewer: this stage keeps its OWN `recoveryRef`, so a
   Compare recovery being refused says nothing about the Analyze viewer's.
3. In the RAF loop (274-278): the same `recoveryRef.current.onFrame()` after `renderer.render`.
4. Insert `stopWatching()` as the FIRST statement inside the teardown, before
   `cancelAnimationFrame(raf)` (line 282).
5. Mount effect deps (line 307): `[]` -> `[contextEpoch]`.
6. Slot-build effect deps (line 332): `[entries, fitView]` -> `[entries, fitView, contextEpoch]`,
   with a one-line comment: a context loss retires every slot in the mount teardown
   (`CompareStage.tsx:289-294`), so this effect must rebuild them into the new scene.
7. Pose effect deps (line 384): `[entries, resultA, resultB]` ->
   `[entries, resultA, resultB, contextEpoch]`, comment: the pose, the shared water surface and
   the floor all describe the NEW scene's hulls and must be re-applied to it.

Effect ORDER is what makes this work: on the epoch bump React runs the cleanups in definition order
(mount tears down, `sceneRef.current = null`, `slotsRef.current = [null, null]`), then re-runs the
bodies in the same order - mount builds the new scene and sets `sceneRef`, slot build fills it,
pose applies to it. Do not reorder these three effects.

Scoped checks for T2+T3: `npm.cmd run typecheck` plus
`npm.cmd exec -- biome check --write src/components/Viewer3D.tsx src/components/CompareStage.tsx`.

## T4 - browser verification (Richard's step, cannot be automated here)

`npm.cmd run dev`, open the app, load `tests/test-kayak.stl` in the Analyze tab, press Calculate,
then paste this in DevTools:

```js
const canvas = document.querySelector('canvas')
const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
gl.getExtension('WEBGL_lose_context').loseContext()
```

Acceptance criteria:

- Analyze: the canvas blanks for at most a frame or two, then returns WITH the hull posed at the
  current waterline/trim/heel and both markers (LCG red, LCB green) in place. Orbit still works.
- Compare: load both slots, solve, repeat - both hulls, the shared water surface and the floor all
  return; the shared surface sits on both hulls' waterlines as before.
- Firing it repeatedly recovers every time (each successful frame resets the cap), and the page
  never becomes unresponsive. The CAP itself cannot be driven from the browser: any loss that
  recovers renders a frame, and a frame resets the count, so only a context that dies before its
  first frame reaches the limit. That branch is asserted by
  `tests/verify-viewer-context.ts` checks 2 and 5 and confirmed by read-through in T5.
- A reload leaves everything normal again (nothing persisted broken).

## T5 - docs and read-through

- `AGENTS.md`: repo layout gains `src/lib/viewer-context.ts` after `src/lib/viewer-conventions.ts`;
  the Test Resources table gains a `verify-viewer-context.ts` row (group `assert`, trigger
  "Viewer", validating the two contracts in that module: `createRecoveryGuard` - three rebuilds
  allowed, a rendered frame resets the count, a refused guard refuses until a frame - and
  `watchContextLoss` - the cancel-before-`onLost` order, one listener registered and the same one
  removed, none left after dispose, two watchers independent); line 117's "all twenty-two
  assertion suites" becomes "twenty-three".
- `README.md:71` already says "The twenty-three assertion suites" and becomes TRUE with this work -
  no edit needed there, but confirm the sentence still reads correctly.
- `tests/README.md`: the suite table gains the same row; keep any suite count in step.
- Read-through of the wiring (the part no suite covers), confirming by eye: no listener is
  registered before a renderer exists; no listener survives a teardown; `contextEpoch` appears in
  the mount deps of both viewers and in CompareStage's slot-build and pose deps and NOWHERE else
  (no result-dependent effect may gain it); no `new THREE.WebGLRenderer` on a result-dependent
  path; `viewer-conventions.ts` and the five scene seams are byte-identical.

## Deliberate cuts (each vetoable)

- **The camera viewpoint is not preserved.** The mount pass re-frames deterministically
  (`Viewer3D.tsx:586-593`) and CompareStage's `fitView()` re-frames; one drag restores anything
  else. Preserving it needs a pose ref, a geometry-identity guard so a NEW mesh does not inherit
  the lost view, and tests for both - real complexity for a cosmetic gain.
- **No "recovering..." notice.** The gap is one frame. A banner is new state, JSX and copy for a
  blink, and it would be the most-tested, least-seen line in the app.
- **No in-place context restoration** (re-initialising GL state on `webglcontextrestored`).
  Rebuilding the renderer is the documented Three.js path and reuses this repo's teardown.
- **No automated WebGL test**: that needs a DOM/GL harness, i.e. a new dependency (banned).

## Known risk — CHECKED AND CLEARED at implementation time

The unmount cleanup still calls `renderer.dispose()` on a context that died. Checked against the
pinned `three` 0.186 (`node_modules/three/build/three.module.js`): `dispose()` makes **no GL call**
at all - it removes three's own canvas listeners and frees CPU-side caches
(`programCache`, `renderStates`, `properties`, `xr`, the animation loop). **No `try/catch`
needed**, no teardown restructure, and no `forceContextLoss()` was added.

Two facts the same read settled, both about three itself:

- three already registers `webglcontextlost` on the canvas and calls `event.preventDefault()`
  itself, so the context was already restorable before this change. The seam's own
  `preventDefault` is therefore idempotent belt-and-braces; what was genuinely missing was any
  listener in `src/` that did anything about the loss.
- `render()` early-returns when `_isContextLost` is set, so a lost context never threw in the RAF
  loop - the loop just silently drew nothing. That is why the defect presented as a frozen canvas
  rather than a crash, and why the epoch bump (a rebuild) is the right fix rather than an
  exception path.

One consequence worth stating plainly: each rebuild creates a brand-new canvas
(`new THREE.WebGLRenderer()` with no `canvas:` argument), and both viewers' teardowns already
remove the previous one (`mount.removeChild(renderer.domElement)` guarded by the parent check), so
a rebuild leaves no dead canvas behind.
## Review focus

- Dep arrays: the epoch reaches the mount effect in both viewers and CompareStage's slot-build and
  pose effects, and nothing else.
- Leaks/ordering: a listener registered only after a renderer exists; none surviving a teardown;
  the exhaustion branch stops the loop, unwatches and drops the canvas before showing the message.
- The guard: a rendered frame resets the count, so a slow GPU is never mistaken for a dead one and
  a genuinely dead one stops at three, and each viewer holds its OWN guard so one stage's refusal
  never takes the other down.
- Frozen spec and existing contracts untouched: `viewer-conventions.ts` byte-identical; the five
  scene seams byte-identical; the `glFailed` wording unchanged.
- Proportion: ~85 lines of component edit (most of it comment), a 50-line module, a ~110-line
  suite, small doc edits.

## Gate, commits, and execution choice

- **Gate:** `npm.cmd run ci` once, at the end, exit 0. Scoped checks per task as listed above.
- **Session end:** record the outcome in `C:/Users/Richard Malán/projects/manager/STATE.md`
  (what landed, the gate result, the commit SHAs, and whether T4's browser pass is still pending).
- **Commits:** repo rule is ask-first. Proposed landing points: after T1 (seam + suite), after T3
  (both viewers), after T5 (docs) - or one commit at the end. Richard picks.
- **Execution method** - pick one and I start:
  1. **Native, this lane (recommended).** The whole change is one subsystem, ~250 lines across 6
     files, and the snippets above are exact; delegating buys nothing and costs an integration
     pass.
  2. **Subagent-driven.** I dispatch implementer children per task group (T1 / T2+T3 / T4+T5) with
     these exact snippets, then run the gate myself.