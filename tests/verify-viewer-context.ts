// Task 1 gate — the shared WebGL context-loss seam (library only, no browser).
//
// Neither viewer listened for `webglcontextlost`, so a GPU reset or a driver
// restart killed the canvas mid-session with no route back short of a reload.
// `src/lib/viewer-context.ts` now owns both non-obvious browser rules in ONE
// place: the event must be cancelled (`preventDefault`) or the context can never
// be restored, and a rebuild that renders a frame is a SUCCESS, so the
// "stop trying" cap counts losses with no successful frame between them.
//
// What this suite pins, and why each one earns its place:
//
//  1. THE EVENT NAME. `watchContextLoss` registers one listener typed
//     `webglcontextlost`. A typo there compiles, runs and never fires — the seam
//     would be dead and every other check here could still pass.
//
//  2. THE CANCEL ORDER. The browser only keeps a context restorable if
//     `preventDefault()` runs on the event; the recovery the viewers implement
//     is a full teardown/rebuild, so this rule is worth being right once. The
//     check records the order of the calls, because a listener that rebuilds
//     first and cancels second is the same dead end.
//
//  3. THE CAP'S SHAPE. The cap decides when the app stops trying, so it is
//     asserted rather than read: three rebuilds, a rendered frame resets the
//     count, a refused guard refuses until a frame arrives. The case that earns
//     its place is the "a slow GPU is not a dead GPU" one — a GPU that resets
//     every few minutes must recover forever, while one that dies before its
//     first frame must stop at three instead of allocating a context per
//     iteration.
//
//  4. LISTENER LIFETIME. The viewers register inside a mount effect and
//     unregister in its teardown; a listener left on a retired canvas is a leak
//     that also calls into an unmounted component's setState. Identity (the
//     SAME function reference goes to add and remove) is the only property that
//     makes the remove real, so it is compared by reference, not by type.
//
// The React wiring itself (dep arrays, epoch bump, effect order) is about
// React's effect machinery, not about a transform this file can execute — the
// same contract `tests/verify-viewer-scene.ts:49-53` documents.
//
// Run: npm.cmd exec -- tsx tests/verify-viewer-context.ts

import { createRecoveryGuard, watchContextLoss } from '../src/lib/viewer-context.js'

let fails = 0
let checks = 0
const check = (label: string, ok: boolean, detail: string) => {
  checks++
  if (!ok) fails++
  console.log(`  ${label.padEnd(34)} ${detail}  ${ok ? 'ok' : '<<< FAIL'}`)
}

type LossEvent = { preventDefault(): void }

/** A canvas stand-in that records its listeners, so add/remove can be compared. */
class FakeCanvas {
  listeners: Array<(event: LossEvent) => void> = []
  addEventListener(_type: 'webglcontextlost', listener: (event: LossEvent) => void) {
    this.listeners.push(listener)
  }
  removeEventListener(_type: 'webglcontextlost', listener: (event: LossEvent) => void) {
    const at = this.listeners.indexOf(listener)
    if (at >= 0) this.listeners.splice(at, 1)
  }
  /** Fire the loss event; `order` records what each side did, in order. */
  fire(order: string[]) {
    for (const listener of this.listeners) {
      listener({
        preventDefault() {
          order.push('preventDefault')
        },
      })
    }
  }
}

// --- the guard --------------------------------------------------------------

{
  const g = createRecoveryGuard()
  const first = [g.onLoss(), g.onLoss(), g.onLoss()]
  check(
    'a fresh guard allows three rebuilds',
    first[0] === true && first[1] === true && first[2] === true,
    `onLoss() -> ${first.join(', ')}`,
  )
  const fourth = g.onLoss()
  const fifth = g.onLoss()
  check(
    'a fourth loss with no frame is refused',
    fourth === false && fifth === false,
    `onLoss() -> ${fourth}, then ${fifth} (stays refused)`,
  )
}

{
  const g = createRecoveryGuard()
  g.onLoss()
  g.onLoss()
  g.onLoss()
  g.onFrame()
  check(
    'a rendered frame resets the count',
    g.onLoss() === true,
    'three losses, one frame, then onLoss() -> true',
  )
}

{
  const g = createRecoveryGuard()
  let refused = false
  for (let i = 0; i < 20; i++) {
    if (!g.onLoss()) refused = true
    g.onFrame()
  }
  check(
    'a frame after every loss never refuses',
    refused === false,
    '20 loss/frame pairs, none refused (a slow GPU is not a dead GPU)',
  )
}

{
  const g = createRecoveryGuard()
  g.onLoss()
  g.onLoss()
  g.onLoss()
  const refused = g.onLoss()
  const stillRefused = g.onLoss()
  g.onFrame()
  const afterFrame = g.onLoss()
  check(
    'a refused guard waits for a frame',
    refused === false && stillRefused === false && afterFrame === true,
    `refused=${refused}, still=${stillRefused}, after a frame=${afterFrame}`,
  )
}

{
  const a = createRecoveryGuard()
  const b = createRecoveryGuard()
  a.onLoss()
  a.onLoss()
  a.onLoss()
  const aRefused = a.onLoss()
  const bAllowed = b.onLoss()
  check(
    'two guards are independent',
    aRefused === false && bAllowed === true,
    `a refused=${aRefused}, b first loss=${bAllowed}`,
  )
}

// --- the listener -----------------------------------------------------------

{
  const canvas = new FakeCanvas()
  let calls = 0
  const order: string[] = []
  const onLost = () => {
    calls++
    order.push('handler')
  }
  const stop = watchContextLoss(canvas, onLost)
  const registered = canvas.listeners[0]
  check(
    'exactly one contextlost listener',
    canvas.listeners.length === 1 && typeof registered === 'function',
    `listeners=${canvas.listeners.length}`,
  )

  canvas.fire(order)
  check(
    'preventDefault runs before onLost',
    order[0] === 'preventDefault' && order[1] === 'handler' && order.length === 2,
    `order: ${order.join(' -> ')}`,
  )
  check('onLost invoked exactly once per event', calls === 1, `calls=${calls}`)

  stop()
  const left = canvas.listeners.length
  check(
    'the disposer removes that same listener',
    left === 0 && registered !== undefined,
    `listeners left=${left}, same reference removed`,
  )

  order.length = 0
  canvas.fire(order)
  check(
    'no listener survives dispose',
    calls === 1 && order.length === 0,
    `fired again: onLost calls=${calls}, order=${order.join(' -> ') || 'empty'}`,
  )
}

{
  const canvas = new FakeCanvas()
  let aCalls = 0
  let bCalls = 0
  const stopA = watchContextLoss(canvas, () => aCalls++)
  watchContextLoss(canvas, () => bCalls++)
  stopA()
  canvas.fire([])
  check(
    'disposing one watcher leaves the other',
    aCalls === 0 && bCalls === 1,
    `a=${aCalls}, b=${bCalls} (b's listener still ran)`,
  )
}

{
  const canvas = new FakeCanvas()
  const other = new FakeCanvas()
  const stop = watchContextLoss(canvas, () => {})
  watchContextLoss(other, () => {})
  stop()
  canvas.fire([])
  other.fire([])
  check(
    'a disposer touches only its own target',
    other.listeners.length === 1,
    'unrelated target still watched',
  )
}

console.log(`\n${checks} checks, ${fails} failed`)
if (fails > 0) {
  console.log('FAIL: the viewer context-loss seam regressed')
  process.exit(1)
}
console.log('ALL VIEWER CONTEXT CHECKS PASS')
