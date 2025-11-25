import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import type { Plugin, ResolvedConfig } from 'vite'
import { generate } from '@stacksjs/dtsx'

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
   * Callback after successful generation
   */
  onSuccess?: (stats: GenerationStats) => void | Promise<void>

  /**
   * Callback on generation error
   */
  onError?: (error: Error) => void | Promise<void>
}

/**
 * Creates a Vite plugin for generating TypeScript declaration files
 * @param options - Configuration options for DTS generation
 * @returns Vite Plugin instance
 */
export function dts(options: DtsPluginOptions = {}): Plugin {
  const { trigger = 'build', onSuccess, onError, ...dtsOptions } = options
  let viteConfig: ResolvedConfig

  return {
    name: 'vite-plugin-dtsx',

    configResolved(config) {
      viteConfig = config
    },

    async buildStart() {
      const shouldRun = trigger === 'both'
        || (trigger === 'build' && viteConfig.command === 'build')
        || (trigger === 'serve' && viteConfig.command === 'serve')

      if (!shouldRun) return

      try {
        const config = normalizeConfig(dtsOptions, viteConfig)
        const stats = await generate(config)

        if (onSuccess) {
          await onSuccess(stats)
        }
      }
      catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))

        if (onError) {
          await onError(err)
        }
        else {
          console.error('[vite-plugin-dtsx] Error generating declarations:', err.message)
          throw err
        }
      }
    },

    async closeBundle() {
      // Alternative hook for generating at the end of build
      // Currently not used, but could be enabled via option
    },
  }
}

/**
 * Normalizes and validates the configuration
 * @param options - User provided options
 * @param viteConfig - Vite's resolved configuration
 * @returns Normalized configuration
 */
function normalizeConfig(options: DtsGenerationOption, viteConfig: ResolvedConfig): DtsGenerationOption {
  const root = options.root || viteConfig.root || './src'
  const outdir = options.outdir || viteConfig.build?.outDir || './dist'

  return {
    ...options,
    cwd: options.cwd || viteConfig.root || process.cwd(),
    root,
    entrypoints: options.entrypoints || ['**/*.ts'],
    outdir,
    clean: options.clean,
    tsconfigPath: options.tsconfigPath,
  }
}

export type { DtsGenerationOption, GenerationStats }

export default dts
