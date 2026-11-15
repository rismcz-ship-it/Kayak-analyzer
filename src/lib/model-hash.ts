/**
 * SHA-256 of a file's raw bytes, as lowercase hex — the identity an uploaded
 * mesh carries everywhere: roster record keys, the re-pick hash check, and the
 * `model_hash` of an exported run record.
 *
 * Over the RAW bytes, never the parsed geometry: the ×1000 "Apply" path
 * rewrites every vertex of a metre-authored STL into its millimetre spelling,
 * and that same file must keep one identity — otherwise a re-pick after Apply
 * would fail its own hash check. Hash the bytes once, at upload, before any
 * orientation, centring or scaling touches them.
 *
 * `crypto.subtle` is native in secure contexts (https, or http on localhost) in
 * every browser this app runs in, and in Node ≥ 19 — so the suites run it under
 * tsx with no dependency and no shim. Outside a secure context (a dev server
 * bound to a LAN IP, a plain-http preview of dist/ on a phone) it is absent, and
 * the throw below names that, rather than the opaque TypeError a bare
 * `crypto.subtle.digest` would produce there.
 */
/** Thrown when the page is not a secure context, so `crypto.subtle` is missing. */
export const SECURE_CONTEXT_ERROR =
  'This page must be served over https or localhost to hash the model (crypto.subtle is unavailable)'

/**
 * The shape every hash this module issues has: 64 lowercase hex characters
 * (`toString(16)` never emits uppercase, and SHA-256 is 32 bytes). The
 * run-record import judges an incoming `model_hash` by this same pattern, so
 * the identity a document claims is checked against the one definition of a
 * hash rather than a second copy free to drift from the first.
 */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error(SECURE_CONTEXT_ERROR)
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0')
  }
  return hex
}
