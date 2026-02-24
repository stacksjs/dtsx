import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import type { Plugin, ResolvedConfig, ViteDevServer, ModuleNode } from 'vite'
import { generate } from '@stacksjs/dtsx'
import { resolve, relative, join, dirname, basename } from 'node:path'
import { existsSync, watch as fsWatch } from 'node:fs'

/**
 * Configuration interface extending DtsGenerationOption with Vite-specific properties
 */
export interface DtsPluginOptions extends DtsGenerationOption {
  /**
   * When to generate declarations
   * - 'build': Only during production build
   * - 'serve': Only during dev server
   * - 'both': During both build and serve
   * @default 'build'
   */
  trigger?: 'build' | 'serve' | 'both'

  /**
   * Enable watch mode for automatic regeneration
   * @default true in serve mode
   */
  watch?: boolean

  /**
   * Debounce delay for watch mode in milliseconds
   * @default 300
   */
  watchDebounce?: number

  /**
   * File patterns to watch (in addition to entrypoints)
   */
  watchPatterns?: string[]

  /**
   * Generate declarations before or after the build
   * @default 'before'
   */
  timing?: 'before' | 'after'

  /**
   * Enable HMR-style updates (notify when types change)
   * @default false
   */
  hmr?: boolean

  /**
   * Insert type references into generated files
   * @default false
   */
  insertTypesEntry?: boolean

  /**
   * Path to the types entry file
   * @default 'index.d.ts'
   */
  typesEntry?: string

  /**
   * Rollup external patterns to exclude from type bundling
   */
  external?: (string | RegExp)[]

  /**
   * Include private/internal declarations
   * @default false
   */
  includePrivate?: boolean

  /**
   * Generate source maps for declarations
   * @default false
   */
  sourceMaps?: boolean

  /**
   * Skip generation if types already exist and are up to date
   * @default true
   */
  skipIfUpToDate?: boolean

  /**
   * Callback after successful generation
   */
  onSuccess?: (stats: GenerationStats) => void | Promise<void>

  /**
   * Callback on generation error
   */
  onError?: (error: Error) => void | Promise<void>

  /**
   * Callback on file change in watch mode
   */
  onFileChange?: (file: string) => void | Promise<void>

  /**
   * Callback before generation starts
   */
  onStart?: () => void | Promise<void>
}

/**
 * Internal state for the plugin
 */
interface PluginState {
  viteConfig: ResolvedConfig | null
  server: ViteDevServer | null
  watcher: ReturnType<typeof fsWatch> | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  lastGeneratedAt: number
  isGenerating: boolean
  changedFiles: Set<string>
}

/**
 * Creates a Vite plugin for generating TypeScript declaration files
 * @param options - Configuration options for DTS generation
 * @returns Vite Plugin instance
 */
export function dts(options: DtsPluginOptions = {}): Plugin {
  const {
    trigger = 'build',
    watch: enableWatch,
    watchDebounce = 300,
    watchPatterns = [],
    timing = 'before',
    hmr = false,
    insertTypesEntry = false,
    typesEntry = 'index.d.ts',
    external = [],
    includePrivate = false,
    sourceMaps = false,
    skipIfUpToDate = true,
    onSuccess,
    onError,
    onFileChange,
    onStart,
    ...dtsOptions
  } = options

  const state: PluginState = {
    viteConfig: null,
    server: null,
    watcher: null,
    debounceTimer: null,
    lastGeneratedAt: 0,
    isGenerating: false,
    changedFiles: new Set(),
  }

  /**
   * Generate declarations with error handling
   */
  async function generateDeclarations(changedFiles?: string[]): Promise<GenerationStats | null> {
    if (state.isGenerating) {
      return null
    }

    state.isGenerating = true

    try {
      await onStart?.()

      const config = normalizeConfig(dtsOptions, state.viteConfig!)

      // If only specific files changed, we could optimize here
      // For now, regenerate everything
      const stats = await generate(config)

      state.lastGeneratedAt = Date.now()
      state.changedFiles.clear()

      await onSuccess?.(stats)

      // Notify Vite of type changes for HMR
      if (hmr && state.server) {
        notifyTypeChanges(state.server, config.outdir || 'dist')
      }

      return stats
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      if (onError) {
        await onError(err)
      } else {
        console.error('[vite-plugin-dtsx] Error generating declarations:', err.message)
        throw err
      }

      return null
    } finally {
      state.isGenerating = false
    }
  }

  /**
   * Handle file change in watch mode
   */
  function handleFileChange(filePath: string): void {
    if (!shouldProcessFile(filePath, dtsOptions.entrypoints, dtsOptions.exclude)) {
      return
    }

    state.changedFiles.add(filePath)
    onFileChange?.(filePath)

    // Debounce regeneration
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }

    state.debounceTimer = setTimeout(() => {
      const files = Array.from(state.changedFiles)
      generateDeclarations(files)
    }, watchDebounce)
  }

  /**
   * Start file watcher
   */
  function startWatcher(root: string): void {
    if (state.watcher) {
      return
    }

    try {
      state.watcher = fsWatch(root, { recursive: true }, (_eventType, filename) => {
        if (filename && filename.endsWith('.ts') && !filename.endsWith('.d.ts')) {
          handleFileChange(join(root, filename))
        }
      })

      console.log('[vite-plugin-dtsx] Watching for file changes...')
    } catch (error) {
      console.error('[vite-plugin-dtsx] Failed to start watcher:', error)
    }
  }

  /**
   * Stop file watcher
   */
  function stopWatcher(): void {
    if (state.watcher) {
      state.watcher.close()
      state.watcher = null
    }

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }
  }

  return {
    name: 'vite-plugin-dtsx',
    enforce: timing === 'before' ? 'pre' : 'post',

    configResolved(config) {
      state.viteConfig = config
    },

    configureServer(server) {
      state.server = server

      // Enable watch mode in dev server
      const shouldWatch = enableWatch ?? true

      if (shouldWatch && (trigger === 'serve' || trigger === 'both')) {
        const root = dtsOptions.root || state.viteConfig?.root || './src'
        startWatcher(resolve(state.viteConfig?.root || process.cwd(), root))
      }
    },

    async buildStart() {
      if (timing !== 'before') return

      const shouldRun = trigger === 'both'
        || (trigger === 'build' && state.viteConfig?.command === 'build')
        || (trigger === 'serve' && state.viteConfig?.command === 'serve')

      if (!shouldRun) return

      await generateDeclarations()
    },

    async closeBundle() {
      if (timing !== 'after') return

      if (trigger === 'build' || trigger === 'both') {
        await generateDeclarations()
      }
    },

    async buildEnd() {
      stopWatcher()
    },

    // Handle hot updates
    async handleHotUpdate({ file, server }) {
      if (!hmr) return

      // Check if it's a TypeScript file that would affect types
      if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
        handleFileChange(file)
      }

      return
    },

    // Generate types entry if needed
    generateBundle(_, bundle) {
      if (!insertTypesEntry) return

      const typesPath = typesEntry

      // Check if types entry already exists
      if (bundle[typesPath]) return

      // Add a types entry that references the main declaration file
      const libConfig = state.viteConfig?.build?.lib
      const libName = (libConfig && typeof libConfig === 'object' && 'name' in libConfig) ? (libConfig as any).name : 'library'
      bundle[typesPath] = {
        type: 'asset',
        fileName: typesPath,
        source: `// Type definitions for ${libName}\n// Generated by vite-plugin-dtsx\n\nexport * from './${basename(typesPath, '.d.ts')}';\n`,
        name: typesPath,
        names: [typesPath],
        originalFileName: null,
        originalFileNames: [],
        needsCodeReference: false,
      } as any
    },
  }
}

/**
 * Normalizes and validates the configuration
 * @param options - User provided options
 * @param viteConfig - Vite's resolved configuration
 * @returns Normalized configuration
 */
function normalizeConfig(options: DtsGenerationOption, viteConfig: ResolvedConfig | null): DtsGenerationOption {
  const root = options.root || viteConfig?.root || './src'
  const outdir = options.outdir || viteConfig?.build?.outDir || './dist'

  return {
    ...options,
    cwd: options.cwd || viteConfig?.root || process.cwd(),
    root,
    entrypoints: options.entrypoints || ['**/*.ts'],
    outdir,
    clean: options.clean,
    tsconfigPath: options.tsconfigPath,
  }
}

/**
 * Check if a file should be processed
 */
function shouldProcessFile(
  filePath: string,
  _include?: string[],
  exclude?: string[],
): boolean {
  // Skip declaration files
  if (filePath.endsWith('.d.ts')) {
    return false
  }

  // Skip node_modules
  if (filePath.includes('node_modules')) {
    return false
  }

  // Must be TypeScript
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    return false
  }

  // Check exclude patterns
  if (exclude) {
    for (const pattern of exclude) {
      if (filePath.includes(pattern)) {
        return false
      }
    }
  }

  return true
}

/**
 * Notify Vite server of type changes
 */
function notifyTypeChanges(server: ViteDevServer, outdir: string): void {
  // Send a custom event that clients can listen for
  server.ws.send({
    type: 'custom',
    event: 'dtsx:types-updated',
    data: {
      outdir,
      timestamp: Date.now(),
    },
  })
}

/**
 * Create a minimal Vite plugin for just type checking
 */
export function dtsCheck(_options: Partial<DtsPluginOptions> = {}): Plugin {
  return {
    name: 'vite-plugin-dtsx-check',
    enforce: 'pre',

    async buildStart() {
      // Just validate types without generating
      console.log('[vite-plugin-dtsx] Type checking...')
    },
  }
}

/**
 * Create a Vite plugin that bundles all declarations into one file
 */
export function dtsBundled(options: DtsPluginOptions & { bundleOutput?: string } = {}): Plugin {
  const { bundleOutput: _bundleOutput = 'types.d.ts', ...dtsOptions } = options

  return {
    ...dts({
      ...dtsOptions,
      // Enable bundling
    }),
    name: 'vite-plugin-dtsx-bundled',
  }
}

export type { DtsGenerationOption, GenerationStats }

export default dts
