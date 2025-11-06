import type { DtsGenerationOption } from '@stacksjs/dtsx'
import type { BunPlugin } from 'bun'
import process from 'node:process'
import { generate } from '@stacksjs/dtsx'

/**
 * Configuration interface extending DtsGenerationOption with build-specific properties
 */
interface PluginConfig extends DtsGenerationOption {
  build?: {
    config: {
      root?: string
      outdir?: string
    }
  }
}

/**
 * Creates a Bun plugin for generating TypeScript declaration files
 * @param options - Configuration options for DTS generation
 * @returns BunPlugin instance
 */
export function dts(options: PluginConfig = {}): BunPlugin {
  return {
    name: 'bun-plugin-dtsx',

    async setup(build) {
      const config = normalizeConfig(options, build)
      await generate(config)
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

export type { DtsGenerationOption }

export default dts
