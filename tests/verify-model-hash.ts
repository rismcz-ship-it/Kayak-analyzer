// Task 1 gate — SHA-256 over the raw STL bytes, and its survival of rescaling.
//
// Why this suite exists: the Compare feature keys roster records and re-pick
// confirmation on `modelHash`, the one identity an uploaded mesh has that
// survives a reload. It is computed once, at upload, from the file's raw bytes
// — NOT from the parsed geometry — because the ×1000 "Apply" path rewrites
// every vertex and must not produce a new identity for the same file
// (Review Focus 4 in the plan). So this suite pins three things:
//
//  1. `sha256Hex` is the real SHA-256, lowercase hex, checked against the
//     FIPS-180 known answers for "" and "abc" — a digest that merely looks
//     like a hash cannot pass this.
//  2. Each call hashes the buffer as it stands at call time; nothing is
//     cached, and a hash already returned is unaffected by later mutations of
//     the caller's buffer.
//  3. `rescaleMesh` carries `sha256Hex` through unchanged: the hash describes
//     the FILE, and the Apply path is the user correcting the file's units,
//     not uploading a different hull.
//
// What this suite does NOT cover: the wiring of the hash into Upload.tsx's load
// path (computing it from `file.arrayBuffer()`) is a two-line call in JSX-
// adjacent code, covered by typecheck and a read-through. The byte semantics
// themselves are pinned below against node:crypto over the committed STL's
// real binary bytes.
//
// Run: npm.cmd exec -- tsx tests/verify-model-hash.ts

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { BufferAttribute, BufferGeometry } from 'three'
import { type LoadedMesh, rescaleMesh } from '../src/components/Upload.js'
import { analyzeMesh } from '../src/lib/geometry.js'
import { sha256Hex } from '../src/lib/model-hash.js'

let failures = 0
function check(ok: boolean, label: string, detail = ''): void {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function bytes(text: string): ArrayBuffer {
  const view = new TextEncoder().encode(text)
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
}

// --- 1. known-answer digests ------------------------------------------------

console.log('\n=== sha256Hex known answers ===')

const emptyHash = await sha256Hex(bytes(''))
check(
  emptyHash === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  'sha256Hex("") is the known empty digest',
  emptyHash,
)

const abcHash = await sha256Hex(bytes('abc'))
check(
  abcHash === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  'sha256Hex("abc") is the known digest',
  abcHash,
)

check(/^[0-9a-f]{64}$/.test(abcHash), 'the digest is 64 lowercase hex chars', abcHash)

// --- 2. call-time reads, no aliasing ----------------------------------------

console.log('\n=== the hash reads the buffer at call time ===')

// One buffer, hashed twice with a mutation in between. If the implementation
// cached the first hash or returned a view over the caller's memory, the second
// result would repeat the first; if it hashed a pooled copy taken before the
// call, the second would too.
const mutable = bytes('abc')
const before = await sha256Hex(mutable)
new Uint8Array(mutable)[0] = 0x78 // 'x'
const after = await sha256Hex(mutable)
check(before === abcHash, 'the pre-mutation hash is the digest of "abc"', before)
check(after !== before, 'mutating the buffer changes the hash', `both ${before.slice(0, 12)}…`)
check(after === (await sha256Hex(bytes('xbc'))), 'the post-mutation digest is sha256("xbc")', after)

// The strongest form of "at call time": mutate the buffer the instant the
// promise is returned, BEFORE awaiting it. An implementation that awaited
// anything before digesting would see 'x' and answer with the digest of "xbc";
// WebCrypto copies the buffer source at call time, so it cannot. The awaited
// form above alone would also pass a read-after-await implementation — this is
// the check that rules it out. (The other direction is already covered above:
// `before` was captured before the mutation and still equals the known digest
// when asserted after it, so a delivered hash is unaffected by later writes.)
const instant = bytes('abc')
const pending = sha256Hex(instant)
new Uint8Array(instant)[0] = 0x78 // 'x', synchronously, before any await
const snapshot = await pending
check(snapshot === abcHash, 'the digest is taken at call time, not after an await', snapshot)

// --- 2b. real binary content ------------------------------------------------

console.log('\n=== the hash over real STL bytes ===')

// Every digest above comes from TextEncoder text; an STL is binary, and the
// regression this feature most fears is hashing the wrong thing — the file
// name, the parsed geometry, a re-serialised buffer. So the byte semantics get
// pinned on the committed mesh's real bytes, against Node's own SHA-256 over
// the same slice. Node's readFileSync can hand back a view into a larger
// pooled ArrayBuffer, so slice the file's own bytes out of the Buffer itself
// (the pattern verify-worker-protocol.ts uses).
const stl = readFileSync(new URL('./test-kayak.stl', import.meta.url))
const raw = stl.subarray(0, 4096)
const sliced = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
const independent = createHash('sha256').update(raw).digest('hex')
const realHash = await sha256Hex(sliced)
check(realHash === independent, 'sha256Hex over real STL bytes matches node:crypto', realHash)
check(
  realHash !== abcHash && /^[0-9a-f]{64}$/.test(realHash),
  'the real-bytes digest is its own 64-hex value, not the text digests',
)

// --- 3. the hash survives rescaling -----------------------------------------

console.log('\n=== rescaleMesh carries the hash through ===')

// A minimal synthetic mesh, exactly as verify-upload-scale.ts builds one; the
// point here is LoadedMesh plumbing, not the geometry.
const unit = new Float32Array([
  -300, -150, -75, 300, -150, -75, 300, 150, -75, -300, -150, -75, 300, 150, -75, -300, 150, -75,
  -300, -150, 75, 300, -150, 75, 300, 150, 75, -300, -150, 75, 300, 150, 75, -300, 150, 75,
])
const geometry = new BufferGeometry()
geometry.setAttribute('position', new BufferAttribute(unit, 3))
const stats = analyzeMesh(unit)
const original: LoadedMesh = {
  id: 1,
  fileName: 'synthetic.stl',
  sizeBytes: 84 + unit.length * 4,
  geometry,
  stats,
  orientNote: 'oriented · centered by (0.0, 0.0, 0.0) mm',
  scaleAdvice: undefined,
  sha256Hex: await sha256Hex(bytes('synthetic file bytes')),
}

const rescaled = rescaleMesh(original, 1000)
check(
  rescaled.sha256Hex === original.sha256Hex,
  'Apply ×1000 keeps the file identity',
  `${original.sha256Hex.slice(0, 12)}… → ${rescaled.sha256Hex.slice(0, 12)}…`,
)
check(
  rescaled.stats.bounds.size.x === stats.bounds.size.x * 1000,
  'the rescale really scaled the geometry',
  `x ${stats.bounds.size.x} → ${rescaled.stats.bounds.size.x}`,
)
check(
  rescaled.sha256Hex === (await sha256Hex(bytes('synthetic file bytes'))),
  'the carried hash still matches the raw bytes',
  rescaled.sha256Hex,
)

console.log(
  failures === 0 ? '\nALL MODEL-HASH CHECKS PASSED' : `\n${failures} MODEL-HASH CHECK(S) FAILED`,
)
process.exit(failures === 0 ? 0 : 1)
