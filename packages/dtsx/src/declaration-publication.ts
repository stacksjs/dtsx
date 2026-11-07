/** Shared declaration-only publication, with staging and detected-error rollback. */
import type { Stats } from 'node:fs'
import type { DtsGenerationConfig } from './types'
import { chmod, lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, parse, relative, resolve } from 'node:path'
import { isWithinRoot } from './declaration-project'
import { writeToFile } from './utils'

export interface DeclarationOutput {
  content: string
  lineEnding?: 'lf' | 'crlf' | 'auto'
}

interface PublicationTarget {
  path: string
  existing?: Stats
  backup: string
  staged?: string
  stagedIdentity?: Stats
}

interface InstalledOutput {
  path: string
  identity: Stats
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

async function inspect(path: string): Promise<Stats | undefined> {
  try { return await lstat(path) }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    throw error
  }
}

/** Resolve existing ancestors too, including when the final path is not created. */
async function getCanonicalPath(path: string): Promise<string> {
  const absolute = resolve(path)
  try { return await realpath(absolute) }
  catch (error) {
    if (!hasCode(error, 'ENOENT') || dirname(absolute) === absolute) throw error
    return resolve(await getCanonicalPath(dirname(absolute)), basename(absolute))
  }
}

/** Keep the generator's existing early configuration checks in their owner. */
export async function assertSafeOutputConfiguration(config: DtsGenerationConfig): Promise<void> {
  const outdir = resolve(config.cwd, config.outdir)
  if (config.bundle && config.bundleOutput) {
    if (isAbsolute(config.bundleOutput)) throw new Error('bundleOutput must be relative to outdir')
    if (!isWithinRoot(resolve(outdir, config.bundleOutput), outdir)) throw new Error('bundleOutput must stay within outdir')
  }
  if (!config.clean || config.dryRun) return
  if (outdir === parse(outdir).root) throw new Error('Refusing to clean declarations from the filesystem root')
  const [canonicalOutdir, canonicalRoot] = await Promise.all([
    getCanonicalPath(outdir), getCanonicalPath(resolve(config.cwd, config.root)),
  ])
  if (isWithinRoot(canonicalRoot, canonicalOutdir)) throw new Error('Refusing to clean an outdir that contains the source root')
}

function isDeclarationOutput(path: string): boolean {
  return ['.d.ts', '.d.mts', '.d.cts', '.d.ts.map', '.d.mts.map', '.d.cts.map'].some(suffix => path.endsWith(suffix))
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

/** Track only directories this operation actually creates. */
async function ensureDirectory(path: string, created: string[]): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) throw new Error(`Declaration output parent is not a directory: ${path}`)
    return
  }
  catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error
  }
  const parent = dirname(path)
  if (parent === path) throw new Error(`Cannot create declaration output directory: ${path}`)
  await ensureDirectory(parent, created)
  try { await mkdir(path); created.push(path) }
  catch (error) {
    if (!hasCode(error, 'EEXIST') || !(await stat(path)).isDirectory()) throw error
  }
}

async function collectDeclarationOutputs(directory: string, lock: string, targets: Map<string, Stats>): Promise<void> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name)
    if (path === lock) continue
    if (entry.isDirectory()) await collectDeclarationOutputs(path, lock, targets)
    else if (isDeclarationOutput(entry.name)) {
      // Never follow an asset symlink while walking. A stale declaration
      // symlink itself can be backed up by rename without touching its target.
      const existing = await inspect(path)
      if (!existing) throw new Error(`Declaration output changed during inventory: ${path}`)
      targets.set(path, existing)
    }
  }
}

function publicationFailure(message: string, errors: unknown[], phase: string, recoveryDirectory: string | undefined, outputsCommitted: boolean): AggregateError {
  return Object.assign(new AggregateError(errors, message), {
    code: 'DTSX_PUBLICATION_FAILED', phase, recoveryDirectory, outputsCommitted,
  })
}

/**
 * Stage all normalized declaration/map bytes, then commit with reversible
 * renames. This protects detected preparation/commit failures, not atomic
 * visibility to concurrent readers or process/power-loss crash recovery.
 * Callers prepare bundles before publication; cache saving and processFile
 * remain separate caller operations.
 */
export async function publishDeclarationOutputs(config: DtsGenerationConfig, pending: ReadonlyMap<string, DeclarationOutput>): Promise<void> {
  if (config.dryRun || pending.size === 0 && !config.clean) return
  await assertSafeOutputConfiguration(config)
  const outdir = resolve(config.cwd, config.outdir)
  if (pending.size === 0 && !await inspect(outdir)) return

  const lock = resolve(outdir, '.dtsx-publication')
  const outputs = new Map<string, DeclarationOutput>()
  for (const [path, output] of pending) {
    const normalized = resolve(path)
    if (!isAbsolute(path) || normalized === outdir || !isWithinRoot(normalized, outdir) || isWithinRoot(normalized, lock) || !isDeclarationOutput(normalized)) {
      throw new Error(`Invalid declaration publication target: ${path}`)
    }
    if (outputs.has(normalized)) throw new Error(`Duplicate declaration publication target: ${path}`)
    outputs.set(normalized, output)
  }

  const created: string[] = []
  const backups: PublicationTarget[] = []
  const installed: InstalledOutput[] = []
  let lockAcquired = false
  let lockIdentity: Stats | undefined
  let canonicalOutdir: string | undefined
  let committed = false

  async function containedParent(path: string, canonicalOutdir: string): Promise<void> {
    const parent = await getCanonicalPath(dirname(path))
    if (!isWithinRoot(parent, canonicalOutdir)) throw new Error(`Declaration publication parent escapes outdir: ${path}`)
    if (isWithinRoot(parent, resolve(canonicalOutdir, '.dtsx-publication'))) throw new Error(`Declaration publication target overlaps its transaction directory: ${path}`)
  }

  async function removeTransaction(): Promise<void> {
    if (!lockAcquired) return
    if (!lockIdentity) throw new Error(`Cannot verify declaration publication ownership: ${lock}`)
    const current = await inspect(lock)
    if (!current || !sameIdentity(current, lockIdentity)) throw new Error(`Declaration publication ownership changed: ${lock}`)
    if (canonicalOutdir && await getCanonicalPath(lock) !== resolve(canonicalOutdir, '.dtsx-publication')) throw new Error(`Declaration publication location changed: ${lock}`)
    // Only this exclusively created transaction directory, never outdir.
    await rm(lock, { recursive: true })
  }

  try {
    await ensureDirectory(outdir, created)
    try { await mkdir(lock) }
    catch (error) {
      if (hasCode(error, 'EEXIST')) throw new Error(`Declaration publication is active or requires recovery at ${lock}`, { cause: error })
      throw error
    }
    lockAcquired = true
    lockIdentity = await lstat(lock)
    canonicalOutdir = await getCanonicalPath(outdir)
    const existing = new Map<string, Stats>()
    if (config.clean) await collectDeclarationOutputs(outdir, lock, existing)
    for (const path of outputs.keys()) {
      await containedParent(path, canonicalOutdir)
      const current = await inspect(path)
      if (current && !current.isFile()) throw new Error(`Declaration publication target is not a regular file: ${path}`)
      if (current) existing.set(path, current)
    }
    for (const path of existing.keys()) await containedParent(path, canonicalOutdir)

    await mkdir(resolve(lock, 'staged'))
    await mkdir(resolve(lock, 'backups'))
    const targets = new Map<string, PublicationTarget>()
    for (const path of new Set([...existing.keys(), ...outputs.keys()])) {
      const index = targets.size.toString()
      targets.set(path, { path, existing: existing.get(path), backup: resolve(lock, 'backups', index), staged: outputs.has(path) ? resolve(lock, 'staged', index) : undefined })
    }
    // A recovery mapping exists before the first final rename. Its presence
    // does not imply a durable crash journal or automatic recovery support.
    await writeFile(resolve(lock, 'manifest.json'), JSON.stringify({ version: 1, outdir, targets: [...targets.values()].map(target => ({ path: relative(outdir, target.path), backup: relative(lock, target.backup), hadPrevious: !!target.existing })) }))
    for (const [path, output] of outputs) {
      const target = targets.get(path)!
      const staged = target.staged!
      await writeToFile(staged, output.content, output.lineEnding)
      if (!config.clean && target.existing) await chmod(staged, target.existing.mode & 0o777)
      target.stagedIdentity = await lstat(staged)
    }

    for (const target of targets.values()) {
      if (!target.existing) continue
      await containedParent(target.path, canonicalOutdir)
      const current = await inspect(target.path)
      if (!current || !sameIdentity(current, target.existing)) throw new Error(`Declaration output changed before commit: ${target.path}`)
      await rename(target.path, target.backup)
      backups.push(target)
    }
    for (const target of targets.values()) {
      if (!target.staged || !target.stagedIdentity) continue
      await containedParent(target.path, canonicalOutdir)
      await ensureDirectory(dirname(target.path), created)
      await containedParent(target.path, canonicalOutdir)
      if (await inspect(target.path)) throw new Error(`Declaration output appeared during commit: ${target.path}`)
      await rename(target.staged, target.path)
      installed.push({ path: target.path, identity: target.stagedIdentity })
    }
    committed = true
    try { await removeTransaction() }
    catch (error) {
      throw publicationFailure(`Declaration outputs committed, but transaction cleanup failed at ${lock}`, [error], 'finalize', lock, true)
    }
  }
  catch (error) {
    if (committed) throw error
    const rollbackErrors: unknown[] = []
    for (const output of installed.toReversed()) {
      try {
        if (canonicalOutdir) await containedParent(output.path, canonicalOutdir)
        const current = await inspect(output.path)
        if (!current) continue
        if (!sameIdentity(current, output.identity)) throw new Error(`Installed declaration changed before rollback: ${output.path}`)
        await rm(output.path)
      }
      catch (failure) { rollbackErrors.push(failure) }
    }
    for (const target of backups.toReversed()) {
      try {
        if (canonicalOutdir) await containedParent(target.path, canonicalOutdir)
        if (await inspect(target.path)) throw new Error(`Cannot restore declaration over an existing path: ${target.path}`)
        await rename(target.backup, target.path)
      }
      catch (failure) { rollbackErrors.push(failure) }
    }
    if (rollbackErrors.length > 0) {
      throw publicationFailure(`Declaration rollback failed; recovery data retained at ${lock}`, [error, ...rollbackErrors], 'rollback', lock, false)
    }
    const cleanupErrors: unknown[] = []
    try { await removeTransaction() }
    catch (failure) { cleanupErrors.push(failure) }
    for (const directory of created.toReversed()) {
      try { await rmdir(directory) }
      catch (failure) {
        // Another actor's entries must never be recursively removed.
        if (!hasCode(failure, 'ENOENT') && !hasCode(failure, 'ENOTEMPTY') && !hasCode(failure, 'EEXIST')) cleanupErrors.push(failure)
      }
    }
    if (cleanupErrors.length > 0) {
      throw publicationFailure(`Prior declarations retained, but publication cleanup failed at ${lock}`, [error, ...cleanupErrors], 'cleanup', lockAcquired ? lock : undefined, false)
    }
    throw error
  }
}
