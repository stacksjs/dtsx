import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import type { BunPlugin } from 'bun'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { generate } from '@stacksjs/dtsx'

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
 * Incremental cache entry
 */
interface CacheEntry {
  hash: string
  outputFile: string
  timestamp: number
}

/**
 * Incremental cache manifest
 */
interface CacheManifest {
  version: string
  configHash: string
  entries: Record<string, CacheEntry>
}

/**
 * Configuration interface extending DtsGenerationOption with build-specific properties
 */
export interface PluginConfig extends DtsGenerationOption {
  build?: {
    config: {
      root?: string
      outdir?: string
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
 * Incremental cache manager
 */
class IncrementalCache {
  private manifest: CacheManifest
  private cacheDir: string
  private manifestPath: string

  constructor(cacheDir: string, configHash: string) {
    this.cacheDir = cacheDir
    this.manifestPath = join(cacheDir, 'manifest.json')
    this.manifest = this.loadManifest(configHash)
  }

  private loadManifest(configHash: string): CacheManifest {
    try {
      if (existsSync(this.manifestPath)) {
        const data = JSON.parse(readFileSync(this.manifestPath, 'utf-8'))
        // Invalidate cache if config changed
        if (data.configHash === configHash && data.version === '1.0') {
          return data
        }
      }
    }
    catch {
      // Ignore cache read errors
    }

    return {
      version: '1.0',
      configHash,
      entries: {},
    }
  }

  save(): void {
    try {
      const { mkdirSync } = require('node:fs')
      mkdirSync(this.cacheDir, { recursive: true })
      writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2))
    }
    catch {
      // Ignore cache write errors
    }
  }

  getEntry(filePath: string): CacheEntry | undefined {
    return this.manifest.entries[filePath]
  }

  setEntry(filePath: string, entry: CacheEntry): void {
    this.manifest.entries[filePath] = entry
  }

  isValid(filePath: string, currentHash: string): boolean {
    const entry = this.getEntry(filePath)
    return entry?.hash === currentHash
  }

  clear(): void {
    this.manifest.entries = {}
    this.save()
  }
}

/**
 * Compute hash of file content
 */
function computeFileHash(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8')
    return createHash('md5').update(content).digest('hex')
  }
  catch {
    return ''
  }
}

/**
 * Compute hash of config for cache invalidation
 */
function computeConfigHash(config: DtsGenerationOption): string {
  const relevantConfig = {
    root: config.root,
    outdir: config.outdir,
    entrypoints: config.entrypoints,
    clean: config.clean,
    tsconfigPath: config.tsconfigPath,
  }
  return createHash('md5').update(JSON.stringify(relevantConfig)).digest('hex')
}

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
      let cache: IncrementalCache | null = null
      const fromCache = 0

      try {
        const config = normalizeConfig(dtsOptions, build)
        const configHash = computeConfigHash(config)

        // Initialize incremental cache
        if (incremental) {
          cache = new IncrementalCache(resolve(cacheDir), configHash)
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

        // Save cache
        if (cache) {
          cache.save()
        }

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
 * Normalizes and validates the configuration
 * @param options - User provided options
 * @param build - Build configuration
 * @returns Normalized configuration
 */
function normalizeConfig(options: PluginConfig, build: PluginConfig['build']): DtsGenerationOption {
  const root = options.root || options.build?.config.root || build?.config.root || './src'
  const outdir = options.outdir || options.build?.config.outdir || build?.config.outdir || './dist'

  if (!root) {
    throw new DtsxPluginError(
      'Root directory is required',
      'CONFIG_ERROR',
      { providedRoot: root },
    )
  }

  return {
    ...options,
    cwd: options.cwd || process.cwd(),
    root,
    entrypoints: options.entrypoints || ['**/*.ts'],
    outdir,
    clean: options.clean,
    tsconfigPath: options.tsconfigPath,
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
  const cache = new IncrementalCache(resolve(cacheDir), '')
  cache.clear()
}

export type { DtsGenerationOption, GenerationStats }

export default dts
