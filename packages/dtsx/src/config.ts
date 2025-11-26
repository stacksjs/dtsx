import type { DtsGenerationConfig } from './types'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { loadConfig } from 'bunfig'

export const defaultConfig: DtsGenerationConfig = {
  cwd: process.cwd(),
  root: './src',
  entrypoints: ['**/*.ts'],
  outdir: './dist',
  keepComments: true,
  clean: true,
  tsconfigPath: './tsconfig.json',
  outputStructure: 'mirror',
  verbose: false,
  importOrder: ['bun'],
  declarationMap: false,
}

/**
 * Configuration file names in order of priority
 */
const CONFIG_FILES = [
  'dtsx.config.ts',
  'dtsx.config.js',
  'dtsx.config.mjs',
  'dtsx.config.mts',
  'dts.config.ts',
  'dts.config.js',
]

/**
 * Find and load a dtsx config file
 */
async function loadDtsxConfig(cwd: string = process.cwd()): Promise<DtsGenerationConfig | null> {
  for (const filename of CONFIG_FILES) {
    const configPath = resolve(cwd, filename)

    if (existsSync(configPath)) {
      try {
        // Import the config file
        const configUrl = pathToFileURL(configPath).href
        const module = await import(configUrl)

        // Support both default export and named export
        const userConfig = module.default || module.config || module

        // If it's a function, call it (allows async config)
        const resolvedConfig = typeof userConfig === 'function'
          ? await userConfig()
          : userConfig

        return { ...defaultConfig, ...resolvedConfig, cwd }
      }
      catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.warn(`Warning: Failed to load config from ${filename}: ${errorMessage}`)
      }
    }
  }

  return null
}

// Get loaded config
// Lazy-loaded config to avoid top-level await (enables bun --compile)
let _config: DtsGenerationConfig | null = null

/**
 * Get the configuration, loading from config file if available
 */
export async function getConfig(cwd?: string): Promise<DtsGenerationConfig> {
  if (!_config) {
    // Try to load dtsx.config.ts first
    const dtsxConfig = await loadDtsxConfig(cwd)
    if (dtsxConfig) {
      _config = dtsxConfig
    }
    else {
      // Fall back to bunfig
      _config = await loadConfig({
        name: 'dts',
        defaultConfig,
      })
    }
  }
  return _config
}

/**
 * Reset the cached config (useful for testing)
 */
export function resetConfig(): void {
  _config = null
}

/**
 * Define a dtsx configuration with full type support
 * Use this in your dtsx.config.ts file
 *
 * @example
 * ```ts
 * // dtsx.config.ts
 * import { defineConfig } from 'dtsx'
 *
 * export default defineConfig({
 *   root: './src',
 *   outdir: './dist',
 *   entrypoints: ['**\/*.ts'],
 *   keepComments: true,
 * })
 * ```
 */
export function defineConfig(config: Partial<DtsGenerationConfig>): DtsGenerationConfig {
  return { ...defaultConfig, ...config }
}

/**
 * Define a dtsx configuration with async support
 * Allows loading plugins or other async dependencies
 *
 * @example
 * ```ts
 * // dtsx.config.ts
 * import { defineConfigAsync } from 'dtsx'
 *
 * export default defineConfigAsync(async () => ({
 *   root: './src',
 *   outdir: './dist',
 *   plugins: [await loadPlugin()],
 * }))
 * ```
 */
export function defineConfigAsync(
  configFn: () => Promise<Partial<DtsGenerationConfig>>,
): () => Promise<DtsGenerationConfig> {
  return async () => {
    const userConfig = await configFn()
    return { ...defaultConfig, ...userConfig }
  }
}

// For backwards compatibility - synchronous access with default fallback
export const config: DtsGenerationConfig = defaultConfig
