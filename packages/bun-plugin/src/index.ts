import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import type { BunPlugin } from 'bun'
import process from 'node:process'
import { dirname, relative, resolve, sep } from 'node:path'
import { clearBuildCache } from '@stacksjs/dtsx/cache'
import { generate } from '@stacksjs/dtsx/generator'

/**
 * Error codes for categorizing plugin errors
 */
export const PluginErrorCodes = {
  CONFIG_ERROR: 'CONFIG_ERROR',
  GENERATION_ERROR: 'GENERATION_ERROR',
  FILE_ERROR: 'FILE_ERROR',
  CACHE_ERROR: 'CACHE_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
} as const

export type PluginErrorCode = typeof PluginErrorCodes[keyof typeof PluginErrorCodes]

/**
 * Custom error class for bun-plugin-dtsx
 */
export class DtsxPluginError extends Error {
  readonly code: PluginErrorCode
  readonly context?: Record<string, unknown>
  readonly cause?: Error

  constructor(message: string, code: PluginErrorCode, context?: Record<string, unknown>, cause?: Error) {
    super(message)
    this.name = 'DtsxPluginError'
    this.code = code
    this.context = context
    this.cause = cause

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    }
  }
}

/**
 * Build event types
 */
export type BuildEventType = 'start' | 'progress' | 'file' | 'complete' | 'error'

/**
 * Build event payload
 */
export interface BuildEvent {
  type: BuildEventType
  timestamp: number
  data: BuildEventData
}

export type BuildEventData =
| { type: 'start', files: string[], config: DtsGenerationOption }
| { type: 'progress', processed: number, total: number, currentFile: string }
| { type: 'file', file: string, outputFile: string, duration: number, cached: boolean }
| { type: 'complete', stats: GenerationStats, duration: number, fromCache: number }
| { type: 'error', error: DtsxPluginError, file?: string }

/**
 * Event listener function
 */
export type BuildEventListener = (_event: BuildEvent) => void | Promise<void>

/**
 * Configuration interface extending DtsGenerationOption with build-specific properties
 */
export interface PluginConfig extends DtsGenerationOption {
  build?: {
    config: {
      root?: string
      outdir?: string
      entrypoints?: string[]
      target?: 'bun' | 'browser' | 'node'
    }
  }

  /**
   * Callback after successful generation
   */
  onSuccess?: (stats: GenerationStats) => void | Promise<void>

  /**
   * Callback on generation error
   */
  onError?: (error: DtsxPluginError) => void | Promise<void>

  /**
   * Whether to fail the build on generation error
   * @default true
   */
  failOnError?: boolean

  /**
   * Enable incremental mode - only regenerate changed files
   * @default false
   */
  incremental?: boolean

  /**
   * Cache directory for incremental builds
   * @default '.dtsx-cache'
   */
  cacheDir?: string

  /**
   * Event listeners for build events
   */
  on?: Partial<Record<BuildEventType, BuildEventListener>>

  /**
   * Timeout for generation in milliseconds
   * @default 60000 (1 minute)
   */
  timeout?: number

  /**
   * Continue generating other files if one fails
   * @default false
   */
  continueOnError?: boolean

  /**
   * Verbose logging
   * @default false
   */
  verbose?: boolean
}

/**
 * Event emitter for build events
 */
class BuildEventEmitter {
  private listeners: Map<BuildEventType, BuildEventListener[]> = new Map()

  on(type: BuildEventType, listener: BuildEventListener): void {
    const existing = this.listeners.get(type) || []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  async emit(type: BuildEventType, data: BuildEventData): Promise<void> {
    const event: BuildEvent = {
      type,
      timestamp: Date.now(),
      data,
    }

    const listeners = this.listeners.get(type) || []
    for (const listener of listeners) {
      await listener(event)
    }
  }
}

/**
 * Outdirs whose stale declarations were already cleaned by a dts build in
 * this process. Tracked at module level because Bun plugins are stateless
 * across builds.
 */
const cleanedOutdirs = new Set<string>()

/**
 * Creates a Bun plugin for generating TypeScript declaration files
 * @param options - Configuration options for DTS generation
 * @returns BunPlugin instance
 */
export function dts(options: PluginConfig = {}): BunPlugin {
  const {
    onSuccess,
    onError,
    failOnError = true,
    incremental = false,
    cacheDir = '.dtsx-cache',
    on,
    timeout = 60000,
    continueOnError = false,
    verbose = false,
    ...dtsOptions
  } = options

  const emitter = new BuildEventEmitter()

  // Register event listeners
  if (on) {
    for (const [type, listener] of Object.entries(on)) {
      if (listener) {
        emitter.on(type as BuildEventType, listener)
      }
    }
  }

  return {
    name: 'bun-plugin-dtsx',

    async setup(build) {
      const startTime = Date.now()

      try {
        const config = normalizeConfig({ ...dtsOptions, incremental, cacheDir }, build)

        // Sequential Bun.build calls in one process frequently share an
        // outdir (one build per entrypoint). Cleaning on every call would
        // delete the declarations previous builds in the same process just
        // wrote — within a single process, nothing written this run can be
        // stale. Only the first build for a given outdir performs the clean.
        if (config.clean) {
          const outdirPath = resolve(config.cwd ?? process.cwd(), config.outdir ?? './dist')
          if (cleanedOutdirs.has(outdirPath)) {
            config.clean = false
          }
          else {
            cleanedOutdirs.add(outdirPath)
          }
        }

        // Emit start event
        await emitter.emit('start', {
          type: 'start',
          files: config.entrypoints || [],
          config,
        })

        if (verbose) {
          console.log('[bun-plugin-dtsx] Starting declaration generation...')
          if (incremental) {
            console.log('[bun-plugin-dtsx] Incremental mode enabled')
          }
        }

        // Wrap generation with timeout
        const generateWithTimeout = async (): Promise<GenerationStats> => {
          return new Promise((resolvePromise, rejectPromise) => {
            const timeoutId = setTimeout(() => {
              rejectPromise(new DtsxPluginError(
                `Generation timed out after ${timeout}ms`,
                'TIMEOUT_ERROR',
                { timeout },
              ))
            }, timeout)

            generate(config)
              .then((stats) => {
                clearTimeout(timeoutId)
                resolvePromise(stats)
              })
              .catch((err) => {
                clearTimeout(timeoutId)
                rejectPromise(err)
              })
          })
        }

        const stats = await generateWithTimeout()
        const duration = Date.now() - startTime

        const fromCache = Math.max(0, stats.filesProcessed - stats.filesGenerated - stats.filesFailed)

        // Emit complete event
        await emitter.emit('complete', {
          type: 'complete',
          stats,
          duration,
          fromCache,
        })

        if (verbose) {
          console.log(`[bun-plugin-dtsx] Generation complete in ${duration}ms`)
          if (fromCache > 0) {
            console.log(`[bun-plugin-dtsx] ${fromCache} files served from cache`)
          }
        }

        if (onSuccess) {
          await onSuccess(stats)
        }
      }
      catch (error) {
        const pluginError = wrapError(error)

        // Emit error event
        await emitter.emit('error', {
          type: 'error',
          error: pluginError,
        })

        if (onError) {
          await onError(pluginError)
        }
        else {
          console.error('[bun-plugin-dtsx] Error generating declarations:')
          console.error(`  Code: ${pluginError.code}`)
          console.error(`  Message: ${pluginError.message}`)
          if (pluginError.context) {
            console.error(`  Context: ${JSON.stringify(pluginError.context)}`)
          }
          if (verbose && pluginError.stack) {
            console.error(`  Stack: ${pluginError.stack}`)
          }
        }

        if (failOnError && !continueOnError) {
          throw pluginError
        }
      }
    },
  }
}

/**
 * Wrap an unknown error in DtsxPluginError
 */
function wrapError(error: unknown): DtsxPluginError {
  if (error instanceof DtsxPluginError) {
    return error
  }

  if (error instanceof Error) {
    // Categorize error based on message
    let code: PluginErrorCode = 'GENERATION_ERROR'
    if (error.message.includes('config') || error.message.includes('Config')) {
      code = 'CONFIG_ERROR'
    }
    else if (error.message.includes('file') || error.message.includes('File') || error.message.includes('ENOENT')) {
      code = 'FILE_ERROR'
    }

    return new DtsxPluginError(
      error.message,
      code,
      { originalError: error.name },
      error,
    )
  }

  return new DtsxPluginError(
    String(error),
    'GENERATION_ERROR',
  )
}

/**
 * The deepest directory containing every given (absolute) path — the same
 * rule Bun.build uses to root its outputs when multiple entrypoints are given.
 */
function commonParentDir(paths: string[]): string {
  const dirs = paths.map(p => dirname(p).split(sep))
  let common = dirs[0]
  for (const parts of dirs.slice(1)) {
    let i = 0
    while (i < common.length && i < parts.length && common[i] === parts[i])
      i++
    common = common.slice(0, i)
  }
  return common.join(sep) || sep
}

/**
 * Normalizes and validates the configuration
 * @param options - User provided options
 * @param build - Build configuration
 * @returns Normalized configuration
 */
function normalizeConfig(options: PluginConfig, build: PluginConfig['build']): DtsGenerationOption {
  const cwd = options.cwd || process.cwd()
  const bunEntrypoints = build?.config?.entrypoints
  const outdir = options.outdir || options.build?.config.outdir || build?.config.outdir || './dist'

  // When no root is given, mirror Bun.build's output layout: Bun roots JS
  // outputs at the common ancestor directory of the entrypoints. Declarations
  // must use the same root, or the two dist trees diverge — e.g. entrypoints
  // ['src/index.ts', 'bin/cli.ts'] put JS at dist/src/index.js while a './src'
  // root would emit dist/index.d.ts, breaking the package.json `types` paths.
  let root = options.root || options.build?.config.root || build?.config.root
  if (!root && bunEntrypoints?.length) {
    const ancestor = commonParentDir(bunEntrypoints.map((ep: string) => resolve(cwd, ep)))
    root = relative(cwd, ancestor) || '.'
  }
  root = root || './src'

  // Derive entrypoints from Bun's build config if not explicitly provided.
  // Using '**/*.ts' as default causes dtsx to process every .ts file individually,
  // which hangs on large codebases. Instead, derive from Bun's entrypoints
  // or fall back to 'index.ts'.
  let entrypoints = options.entrypoints
  if (!entrypoints) {
    if (bunEntrypoints?.length) {
      const resolvedRoot = resolve(cwd, root)
      const inside: string[] = []
      for (const ep of bunEntrypoints) {
        const resolved = resolve(cwd, ep)
        if (resolved === resolvedRoot || resolved.startsWith(resolvedRoot + sep)) {
          inside.push(relative(resolvedRoot, resolved))
        }
        else {
          // An entrypoint outside the root cannot be emitted at a matching
          // path — surface it instead of silently mapping it to its basename.
          console.warn(`[bun-plugin-dtsx] Skipping entrypoint outside root "${root}": ${ep}`)
        }
      }
      entrypoints = inside.length ? inside : ['index.ts']
    }
    else {
      entrypoints = ['index.ts']
    }
  }

  return {
    ...options,
    cwd,
    root,
    entrypoints,
    outdir,
    clean: options.clean ?? true,
    tsconfigPath: options.tsconfigPath,
    moduleSpecifierMode: options.moduleSpecifierMode ?? ((build?.config.target ?? options.build?.config.target) === 'node' ? 'node' : 'preserve'),
  }
}

/**
 * Create a watch mode plugin that regenerates on file changes
 */
export function dtsWatch(options: PluginConfig = {}): BunPlugin {
  return dts({
    ...options,
    incremental: true,
    verbose: options.verbose ?? true,
  })
}

/**
 * Create a plugin that only validates types without generating
 */
export function dtsCheck(options: Omit<PluginConfig, 'outdir'>): BunPlugin {
  return {
    name: 'bun-plugin-dtsx-check',
    async setup(build) {
      // Type checking only - no output
      const config = normalizeConfig({ ...options, outdir: '' }, build)

      try {
        // Just validate, don't write
        await generate({ ...config, clean: false })
      }
      catch (error) {
        const pluginError = wrapError(error)
        if (options.onError) {
          await options.onError(pluginError)
        }
        if (options.failOnError !== false) {
          throw pluginError
        }
      }
    },
  }
}

/**
 * Clear the incremental cache
 */
export function clearCache(cacheDir = '.dtsx-cache'): void {
  clearBuildCache(resolve(cacheDir))
}

export type { DtsGenerationOption, GenerationStats }

export default dts
