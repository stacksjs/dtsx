/**
 * Run `tsc` over generated declarations, without needing Node installed.
 *
 * Several suites prove their output is real by type-checking it, and each one
 * used to spawn `node_modules/.bin/tsc` directly. That file is a shell script
 * beginning `#!/usr/bin/env node`, so on a Bun-only machine — which is what
 * this project targets — every one of those assertions failed with
 * `env: node: No such file or directory`. Twelve tests across three files, all
 * reporting a type error that was really a missing runtime.
 *
 * Bun can execute TypeScript's own entry point directly, so this resolves
 * `typescript/lib/tsc.js` and runs it under Bun instead.
 *
 * TypeScript is not a dependency of dtsx — it resolves to whatever the host
 * has hoisted, and may be absent entirely. When it is, `isAvailable` is false
 * and the caller should skip rather than fail: a type-check that cannot run is
 * not a type-check that failed.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Where TypeScript's CLI entry lives, or null if it is not installed. */
function findTscEntry(): string | null {
  const roots = [
    join(import.meta.dir, '..', '..', '..', '..', 'node_modules', 'typescript', 'lib', 'tsc.js'),
    join(import.meta.dir, '..', '..', '..', 'node_modules', 'typescript', 'lib', 'tsc.js'),
    join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js'),
  ]

  return roots.find(candidate => existsSync(candidate)) ?? null
}

const tscEntry = findTscEntry()

/** Whether `runTsc` can actually run. */
export const isAvailable: boolean = tscEntry !== null

export interface TscResult {
  ok: boolean
  /** Combined stdout and stderr, empty when the check passed. */
  output: string
}

/**
 * Type-check `files` inside `cwd` with `--noEmit --strict`.
 *
 * Returns rather than throws, so a caller can attach its own assertion message.
 */
export function runTsc(cwd: string, files: string[]): TscResult {
  if (!tscEntry)
    return { ok: true, output: '' }

  const proc = Bun.spawnSync(
    [process.execPath, tscEntry, '--noEmit', '--strict', ...files],
    { cwd },
  )

  const output = `${proc.stdout.toString()}${proc.stderr.toString()}`

  return { ok: proc.exitCode === 0, output }
}
