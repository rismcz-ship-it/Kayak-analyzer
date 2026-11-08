// Minimal ambient declarations for the Node built-ins the test suites use.
//
// The repository has no `@types/node` dependency: the app itself is
// browser-only, and the suites only need a handful of Node APIs. Without
// these declarations `tsc` cannot see `node:fs`, `node:url` or `process` at
// all, and the test program would not type-check.
//
// This file declares exactly the surface the suites use. If a suite starts
// using more of Node, extend it here — a missing declaration fails the
// typecheck rather than silently passing.

/** The subset of Node's Buffer the suites rely on: a Uint8Array view. */
declare type Buffer = Uint8Array

declare module 'node:fs' {
  export function readFileSync(path: string | URL): Buffer
  export function statSync(path: string | URL): { size: number }
  export function existsSync(path: string | URL): boolean
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:os' {
  export function homedir(): string
}

declare const process: {
  exit(code?: number): never
  env: Record<string, string | undefined>
  argv: string[]
}
