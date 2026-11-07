// Run in a separate process: inject OS failures without replacing generation,
// staging, publication, or rollback. Every successful operation uses real fs.
import * as fs from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { mock } from 'bun:test'

const [mode, serializedOptions] = process.argv.slice(2)
const options = JSON.parse(serializedOptions!)
const originalRename = fs.rename
const originalRm = fs.rm
const originalWrite = Bun.write
let stageWrites = 0
let backupMoves = 0
let installs = 0
let restores = 0
let injected = 0

function fail(operation: string): never {
  injected++
  throw Object.assign(new Error(`Injected publication ${operation} failure`), { code: 'EIO' })
}

if (mode === 'stage' || mode === 'short-write') {
  Bun.write = (async (...args: Parameters<typeof Bun.write>) => {
    if (typeof args[0] === 'string' && basename(dirname(args[0])) === 'staged') {
      stageWrites++
      if (stageWrites === 2) {
        if (mode === 'stage') fail('stage')
        // Actually persist an incomplete file and return its real byte count.
        // The publisher must reject it before replacing any final output.
        injected++
        const bytes = Buffer.from(String(args[1]), 'utf8')
        return originalWrite(args[0], bytes.subarray(0, bytes.length - 1))
      }
    }
    return originalWrite(...args)
  }) as typeof Bun.write
}

mock.module('node:fs/promises', () => ({
  ...fs,
  async rename(from: string, to: string) {
    if (basename(dirname(to)) === 'backups') {
      backupMoves++
      if (mode === 'backup' && backupMoves === 2) fail('backup')
    }
    if (basename(dirname(from)) === 'staged') {
      installs++
      if ((mode === 'install' || mode === 'rollback') && installs === 2) fail('install')
    }
    if (basename(dirname(from)) === 'backups') {
      restores++
      if (mode === 'rollback' && basename(to) === 'a-current.d.ts') fail('restore')
    }
    return originalRename(from, to)
  },
  async rm(path: string, options?: Parameters<typeof fs.rm>[1]) {
    if (mode === 'finalize' && basename(path) === '.dtsx-publication') fail('finalize')
    return originalRm(path, options)
  },
}))

const { generate } = await import('../../src/generator')
let failure: unknown
try { await generate(options) }
catch (error) { failure = error }
const detail = failure instanceof Error ? failure as Error & { code?: string, phase?: string, recoveryDirectory?: string, outputsCommitted?: boolean } : undefined
let retryFailure: unknown
if (mode === 'rollback' || mode === 'finalize') {
  try { await generate(options) }
  catch (error) { retryFailure = error }
}
console.log(JSON.stringify({
  failed: failure instanceof Error,
  message: detail?.message,
  code: detail?.code,
  phase: detail?.phase,
  recoveryDirectory: detail?.recoveryDirectory,
  outputsCommitted: detail?.outputsCommitted,
  retryMessage: retryFailure instanceof Error ? retryFailure.message : undefined,
  stageWrites, backupMoves, installs, restores, injected,
}))
