/**
 * Bun build plugin for dtsx
 * Generates TypeScript declaration files during Bun builds
 */

import type { DtsGenerationConfig, GenerationStats } from '../types'
import { generate } from '../generator'

/**
 * Bun plugin options
 */
export interface BunPluginOptions extends Partial<DtsGenerationConfig> {
  /**
   * Generate declarations before build
   * @default false
   */
  preBuild?: boolean

  /**
   * Generate declarations after build
   * @default true
   */
  postBuild?: boolean

  /**
   * Callback after generation completes
   */
  onGenerated?: (stats: GenerationStats) => void

  /**
   * Callback on generation error
   */
  onError?: (error: Error) => void
}

/**
 * Bun plugin interface
 */
interface BunPlugin {
  name: string
  setup: (build: BunBuild) => void | Promise<void>
}

/**
 * Bun build interface (minimal type)
 */
interface BunBuild {
  onStart: (callback: () => void | Promise<void>) => void
  onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void
  config: {
    entrypoints: string[]
    outdir?: string
    root?: string
  }
}

/**
 * Create a Bun build plugin for dtsx
 *
 * @example
 * ```ts
 * // build.ts
 * import { dts } from '@stacksjs/dtsx/plugins/bun'
 *
 * await Bun.build({
 *   entrypoints: ['./src/index.ts'],
 *   outdir: './dist',
 *   plugins: [
 *     dts({
 *       root: './src',
 *       outdir: './dist',
 *     }),
 *   ],
 * })
 * ```
 */
export function dts(options: BunPluginOptions = {}): BunPlugin {
  const {
    preBuild = false,
    postBuild = true,
    onGenerated,
    onError,
    ...generateOptions
  } = options

  const runGenerate = async (): Promise<void> => {
    try {
      const stats = await generate(generateOptions)
      onGenerated?.(stats)
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      onError?.(err)
      if (!onError) {
        console.error('[dtsx] Generation failed:', err.message)
      }
    }
  }

  return {
    name: 'dtsx',

    async setup(build) {
      // Get config from build if not provided
      const config = build.config
      if (!generateOptions.entrypoints && config.entrypoints) {
        generateOptions.entrypoints = config.entrypoints
      }
      if (!generateOptions.outdir && config.outdir) {
        generateOptions.outdir = config.outdir
      }
      if (!generateOptions.root && config.root) {
        generateOptions.root = config.root
      }

      if (preBuild) {
        build.onStart(async () => {
          await runGenerate()
        })
      }

      if (postBuild) {
        // Bun doesn't have a native postBuild hook, so we use onLoad with a virtual module
        // that triggers at the end of the build process
        let hasRun = false
        build.onLoad({ filter: /.*/ }, async (_args) => {
          // This is a workaround - in practice, postBuild runs after all modules are loaded
          if (!hasRun) {
            // Schedule to run after build completes
            queueMicrotask(async () => {
              if (!hasRun) {
                hasRun = true
                await runGenerate()
              }
            })
          }
          return undefined
        })
      }
    },
  }
}

/**
 * Alias for dts
 */
export const bunDts: typeof dts = dts

/**
 * Default export
 */
export default dts
