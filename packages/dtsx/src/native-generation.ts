import type { DtsGenerationConfig } from './types'
import { spawn } from 'node:child_process'
import { config as defaults } from './config'
import { assertSafeOutputConfiguration, publishDeclarationOutputs } from './declaration-publication'
import { planNativeDeclarationProject } from './native-project'
import { checkIsolatedDeclarationsConfig } from './utils'

export type NativeProjectOptions = Partial<Pick<DtsGenerationConfig,
| 'cwd' | 'root' | 'outdir' | 'entrypoints' | 'include' | 'exclude'
| 'autoIncludeReExports' | 'outputStructure' | 'tsconfigPath'
| 'moduleSpecifierMode' | 'keepComments' | 'isolatedDeclarations' | 'clean' | 'lineEnding'
>>

export interface NativeProjectExecution {
  /** Deadline for the complete native batch, in milliseconds. Default: 30,000. */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface NativeGenerationResult {
  readonly filesGenerated: number
  readonly outputFiles: readonly string[]
}

const supportedOptions = new Set([
  'cwd', 'root', 'outdir', 'entrypoints', 'include', 'exclude', 'autoIncludeReExports',
  'outputStructure', 'tsconfigPath', 'moduleSpecifierMode', 'keepComments',
  'isolatedDeclarations', 'clean', 'lineEnding',
])

function runNativeBatch(executable: string, args: string[], source: string, cwd: string, execution: NativeProjectExecution): Promise<string> {
  const signal = execution.signal
  signal?.throwIfAborted()
  const timeoutMs = execution.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new RangeError('Native project timeoutMs must be an integer between 1 and 2147483647')
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let failure: Error | undefined
    let inputFailure: Error | undefined
    let settled = false
    const stop = (error: Error): void => { failure ??= error; child.kill() }
    const abort = (): void => stop(signal?.reason instanceof Error ? signal.reason : new Error('Native declaration project aborted', { cause: signal?.reason }))
    const deadline = setTimeout(() => stop(new Error(`Native declaration project exceeded ${timeoutMs}ms`)), timeoutMs)
    const finish = (error?: Error, content?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(content!)
    }
    child.once('error', error => finish(error))
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    child.stdout.once('error', stop)
    child.stderr.once('error', stop)
    // EPIPE can accompany a native validation error; its stderr/status are the
    // useful failure. Always handle the stream error to avoid an unhandled event.
    child.stdin.once('error', error => { inputFailure ??= error })
    child.once('close', (code, signal) => {
      if (code !== 0 && !failure) failure = new Error(`Native declaration project failed (${signal ?? code}): ${Buffer.concat(stderr).toString('utf8')}`)
      finish(failure ?? inputFailure, Buffer.concat(stdout).toString('utf8'))
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdin.end(Buffer.from(source, 'utf8'))
  })
}

/**
 * Plan actual source snapshots, emit one checked native batch, then publish its
 * declarations through the shared transaction owner. The caller selects an
 * actual zig-dtsx executable. There is no JS-emitter or legacy-binary fallback.
 */
export async function generateNativeDeclarationProject(
  executable: string,
  options: NativeProjectOptions = {},
  execution: NativeProjectExecution = {},
): Promise<NativeGenerationResult> {
  if (!executable || executable.includes('\0')) throw new Error('A native zig-dtsx executable is required')
  for (const key of Object.keys(options)) {
    if (!supportedOptions.has(key)) throw new Error(`Native declaration project does not support option: ${key}`)
  }
  execution.signal?.throwIfAborted()
  const config = { ...defaults, ...options }
  await assertSafeOutputConfiguration(config)
  if (config.isolatedDeclarations === undefined) config.isolatedDeclarations = await checkIsolatedDeclarationsConfig(config)
  const plan = await planNativeDeclarationProject(config)
  const args = ['--batch']
  if (!config.keepComments) args.push('--no-comments')
  if (config.isolatedDeclarations) args.push('--isolated-declarations')
  const request = JSON.stringify({ protocol: 'zig-dtsx-project', version: 1, files: plan.files.map(file => ({ source: file.source, context: file.context })) })
  const output = await runNativeBatch(executable, args, request, config.cwd, execution)
  let response: unknown
  try { response = JSON.parse(output) }
  catch (cause) { throw new Error('Native executable did not return a valid zig-dtsx project protocol response', { cause }) }
  if (!response || typeof response !== 'object' || !('protocol' in response) || response.protocol !== 'zig-dtsx-project'
    || !('version' in response) || response.version !== 1 || !('files' in response) || !Array.isArray(response.files)
    || response.files.length !== plan.files.length) throw new Error('Native executable returned an unsupported or incomplete project response')
  const pending = new Map<string, { content: string, lineEnding: DtsGenerationConfig['lineEnding'] }>()
  for (const [index, file] of plan.files.entries()) {
    const result: unknown = response.files[index]
    if (!result || typeof result !== 'object' || !('sourceFile' in result) || result.sourceFile !== file.sourceFile
      || !('outputFile' in result) || result.outputFile !== file.outputFile
      || !('sourceHash' in result) || result.sourceHash !== file.context.sourceHash
      || !('content' in result) || typeof result.content !== 'string') throw new Error(`Native executable returned a mismatched project result for ${file.sourceFile}`)
    pending.set(file.outputFile, { content: result.content, lineEnding: config.lineEnding })
  }
  execution.signal?.throwIfAborted()
  await publishDeclarationOutputs(config, pending)
  return Object.freeze({ filesGenerated: pending.size, outputFiles: Object.freeze([...pending.keys()]) })
}
