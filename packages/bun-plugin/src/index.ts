import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import type { BunPlugin } from 'bun'
import process from 'node:process'
import { generate } from '@stacksjs/dtsx'

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
  onError?: (error: Error) => void | Promise<void>

  /**
   * Whether to fail the build on generation error
   * @default true
   */
  failOnError?: boolean
}

/**
 * Creates a Bun plugin for generating TypeScript declaration files
 * @param options - Configuration options for DTS generation
 * @returns BunPlugin instance
 */
export function dts(options: PluginConfig = {}): BunPlugin {
  const { onSuccess, onError, failOnError = true, ...dtsOptions } = options

  return {
    name: 'bun-plugin-dtsx',

    async setup(build) {
      try {
        const config = normalizeConfig(dtsOptions, build)
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
          console.error('[bun-plugin-dtsx] Error generating declarations:', err.message)
        }

        if (failOnError) {
          throw err
        }
      }
    },
  }
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
    throw new Error('[bun-plugin-dtsx] Root directory is required')
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

export type { DtsGenerationOption, GenerationStats }

export default dts
