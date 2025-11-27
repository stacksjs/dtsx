/**
 * Watch mode for automatic .d.ts regeneration on source changes
 */

import type { FSWatcher } from 'node:fs'
import type { DtsGenerationConfig } from './types'
import { watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * Watch configuration
 */
export interface WatchConfig {
  /**
   * Root directory to watch
   */
  root: string

  /**
   * File patterns to watch (glob-like)
   * @default ['**\/*.ts', '**\/*.tsx']
   */
  include?: string[]

  /**
   * Patterns to exclude
   * @default ['**\/node_modules\/**', '**\/*.d.ts', '**\/dist\/**']
   */
  exclude?: string[]

  /**
   * Debounce delay in milliseconds
   * @default 100
   */
  debounce?: number

  /**
   * Initial build on start
   * @default true
   */
  initialBuild?: boolean

  /**
   * Clear console on rebuild
   * @default false
   */
  clearScreen?: boolean

  /**
   * Callback for file changes
   */
  onChange?: (event: WatchEvent) => void | Promise<void>

  /**
   * Callback for build start
   */
  onBuildStart?: () => void | Promise<void>

  /**
   * Callback for build complete
   */
  onBuildComplete?: (result: WatchBuildResult) => void | Promise<void>

  /**
   * Callback for errors
   */
  onError?: (error: Error) => void | Promise<void>
}

/**
 * Watch event
 */
export interface WatchEvent {
  type: 'add' | 'change' | 'unlink'
  path: string
  relativePath: string
}

/**
 * Build result from watch
 */
export interface WatchBuildResult {
  success: boolean
  duration: number
  filesProcessed: number
  errors: string[]
}

/**
 * Watcher instance
 */
export interface Watcher {
  /**
   * Start watching
   */
  start: () => Promise<void>

  /**
   * Stop watching
   */
  stop: () => void

  /**
   * Trigger a manual rebuild
   */
  rebuild: () => Promise<WatchBuildResult>

  /**
   * Check if currently watching
   */
  isWatching: () => boolean

  /**
   * Get watched files
   */
  getWatchedFiles: () => string[]
}

/**
 * Create a file watcher for .d.ts generation
 */
export function createWatcher(
  config: WatchConfig,
  buildFn: (files?: string[]) => Promise<WatchBuildResult>,
): Watcher {
  const {
    root,
    include = ['**/*.ts', '**/*.tsx'],
    exclude = ['**/node_modules/**', '**/*.d.ts', '**/dist/**'],
    debounce = 100,
    initialBuild = true,
    clearScreen = false,
    onChange,
    onBuildStart,
    onBuildComplete,
    onError,
  } = config

  const watchers: FSWatcher[] = []
  const watchedFiles = new Set<string>()
  let isActive = false
  const pendingChanges = new Map<string, WatchEvent>()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let isBuilding = false

  /**
   * Check if a path matches include/exclude patterns
   */
  function shouldWatch(filePath: string): boolean {
    const relPath = relative(root, filePath)

    // Check excludes first
    for (const pattern of exclude) {
      if (matchGlob(relPath, pattern)) {
        return false
      }
    }

    // Check includes
    for (const pattern of include) {
      if (matchGlob(relPath, pattern)) {
        return true
      }
    }

    return false
  }

  /**
   * Simple glob matching
   */
  function matchGlob(path: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '{{DOUBLESTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DOUBLESTAR\}\}/g, '.*')
      .replace(/\?/g, '.')

    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(path.replace(/\\/g, '/'))
  }

  /**
   * Process pending changes
   */
  async function processPendingChanges(): Promise<void> {
    if (isBuilding || pendingChanges.size === 0) {
      return
    }

    isBuilding = true
    const changes = Array.from(pendingChanges.values())
    pendingChanges.clear()

    try {
      // Notify about changes
      for (const event of changes) {
        await onChange?.(event)
      }

      if (clearScreen) {
        console.clear()
      }

      await onBuildStart?.()

      // Get changed files
      const changedFiles = changes
        .filter(e => e.type !== 'unlink')
        .map(e => e.path)

      // Run build
      const result = await buildFn(changedFiles.length > 0 ? changedFiles : undefined)

      await onBuildComplete?.(result)
    }
    catch (error) {
      await onError?.(error as Error)
    }
    finally {
      isBuilding = false

      // Process any changes that came in during build
      if (pendingChanges.size > 0) {
        scheduleBuild()
      }
    }
  }

  /**
   * Schedule a debounced build
   */
  function scheduleBuild(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null
      processPendingChanges()
    }, debounce)
  }

  /**
   * Handle file change event
   */
  function handleChange(eventType: string, filename: string | null, dir: string): void {
    if (!filename || !isActive) {
      return
    }

    const fullPath = join(dir, filename)

    if (!shouldWatch(fullPath)) {
      return
    }

    const event: WatchEvent = {
      type: eventType === 'rename' ? 'add' : 'change',
      path: fullPath,
      relativePath: relative(root, fullPath),
    }

    // Check if file was deleted
    stat(fullPath).catch(() => {
      event.type = 'unlink'
      watchedFiles.delete(fullPath)
    })

    pendingChanges.set(fullPath, event)
    watchedFiles.add(fullPath)

    scheduleBuild()
  }

  /**
   * Recursively find directories to watch
   */
  async function findDirectories(dir: string): Promise<string[]> {
    const dirs: string[] = [dir]

    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = join(dir, entry.name)
          const relPath = relative(root, fullPath)

          // Check if directory should be excluded
          let shouldExclude = false
          for (const pattern of exclude) {
            if (matchGlob(relPath, pattern) || matchGlob(`${relPath}/`, pattern)) {
              shouldExclude = true
              break
            }
          }

          if (!shouldExclude) {
            const subDirs = await findDirectories(fullPath)
            dirs.push(...subDirs)
          }
        }
      }
    }
    catch {
      // Directory doesn't exist or can't be read
    }

    return dirs
  }

  /**
   * Start watching
   */
  async function start(): Promise<void> {
    if (isActive) {
      return
    }

    isActive = true

    // Find all directories to watch
    const directories = await findDirectories(root)

    // Create watchers for each directory
    for (const dir of directories) {
      try {
        const watcher = watch(dir, { persistent: true }, (eventType, filename) => {
          handleChange(eventType, filename, dir)
        })

        watcher.on('error', (error) => {
          onError?.(error as Error)
        })

        watchers.push(watcher)
      }
      catch (error) {
        await onError?.(error as Error)
      }
    }

    // Run initial build
    if (initialBuild) {
      await onBuildStart?.()
      const result = await buildFn()
      await onBuildComplete?.(result)
    }
  }

  /**
   * Stop watching
   */
  function stop(): void {
    isActive = false

    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    for (const watcher of watchers) {
      watcher.close()
    }

    watchers.length = 0
    watchedFiles.clear()
    pendingChanges.clear()
  }

  /**
   * Manual rebuild
   */
  async function rebuild(): Promise<WatchBuildResult> {
    await onBuildStart?.()
    const result = await buildFn()
    await onBuildComplete?.(result)
    return result
  }

  return {
    start,
    stop,
    rebuild,
    isWatching: () => isActive,
    getWatchedFiles: () => Array.from(watchedFiles),
  }
}

/**
 * Watch and generate .d.ts files
 */
export async function watchAndGenerate(
  config: DtsGenerationConfig & WatchConfig,
  generator: (config: DtsGenerationConfig) => Promise<{ filesProcessed: number, errors: string[] }>,
): Promise<Watcher> {
  const buildFn = async (_files?: string[]): Promise<WatchBuildResult> => {
    const startTime = Date.now()

    try {
      const result = await generator(config)

      return {
        success: result.errors.length === 0,
        duration: Date.now() - startTime,
        filesProcessed: result.filesProcessed,
        errors: result.errors,
      }
    }
    catch (error) {
      return {
        success: false,
        duration: Date.now() - startTime,
        filesProcessed: 0,
        errors: [(error as Error).message],
      }
    }
  }

  const watcher = createWatcher(
    {
      root: config.root || config.cwd || process.cwd(),
      include: config.include,
      exclude: config.exclude,
      debounce: config.debounce,
      initialBuild: config.initialBuild,
      clearScreen: config.clearScreen,
      onChange: config.onChange,
      onBuildStart: config.onBuildStart,
      onBuildComplete: config.onBuildComplete,
      onError: config.onError,
    },
    buildFn,
  )

  await watcher.start()

  return watcher
}

/**
 * Format watch build result for display
 */
export function formatWatchResult(result: WatchBuildResult): string {
  const status = result.success ? '✓' : '✗'
  const duration = `${result.duration}ms`

  if (result.success) {
    return `${status} Built ${result.filesProcessed} file(s) in ${duration}`
  }
  else {
    return `${status} Build failed in ${duration}\n${result.errors.map(e => `  - ${e}`).join('\n')}`
  }
}

/**
 * Create a simple console logger for watch mode
 */
export function createWatchLogger(): {
  onChange: (event: WatchEvent) => void
  onBuildStart: () => void
  onBuildComplete: (result: WatchBuildResult) => void
  onError: (error: Error) => void
} {
  return {
    onChange: (event: WatchEvent): void => {
      const icon = event.type === 'add' ? '+' : event.type === 'unlink' ? '-' : '~'
      console.log(`[${icon}] ${event.relativePath}`)
    },

    onBuildStart: (): void => {
      console.log('\nRebuilding...')
    },

    onBuildComplete: (result: WatchBuildResult): void => {
      console.log(formatWatchResult(result))
    },

    onError: (error: Error): void => {
      console.error(`Error: ${error.message}`)
    },
  }
}
