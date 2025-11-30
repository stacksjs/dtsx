/**
 * esbuild plugin for dtsx
 * Generates TypeScript declaration files during esbuild builds
 */

import type { DtsGenerationConfig, GenerationStats } from '../types'
import { generate } from '../generator'

/**
 * esbuild plugin options
 */
export interface EsbuildPluginOptions extends Partial<DtsGenerationConfig> {
  /**
   * Generate declarations on build start
   * @default false
   */
  onStart?: boolean

  /**
   * Generate declarations on build end
   * @default true
   */
  onEnd?: boolean

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
 * esbuild plugin interface
 */
interface EsbuildPlugin {
  name: string
  setup: (build: EsbuildBuild) => void | Promise<void>
}

/**
 * esbuild build interface (minimal type)
 */
interface EsbuildBuild {
  onStart: (callback: () => { errors?: Array<{ text: string }> } | Promise<{ errors?: Array<{ text: string }> } | void> | void) => void
  onEnd: (callback: (result: { errors: unknown[] }) => void | Promise<void>) => void
  initialOptions: {
    entryPoints?: string[] | Record<string, string>
    outdir?: string
    outfile?: string
  }
}

/**
 * Create an esbuild plugin for dtsx
 *
 * @example
 * ```ts
 * // build.ts
 * import { dtsx } from '@stacksjs/dtsx/plugins/esbuild'
 * import * as esbuild from 'esbuild'
 *
 * await esbuild.build({
 *   entryPoints: ['./src/index.ts'],
 *   outdir: './dist',
 *   plugins: [
 *     dtsx({
 *       root: './src',
 *       outdir: './dist',
 *     }),
 *   ],
 * })
 * ```
 */
export function dtsx(options: EsbuildPluginOptions = {}): EsbuildPlugin {
  const {
    onStart = false,
    onEnd = true,
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

    setup(build) {
      // Get config from build if not provided
      const opts = build.initialOptions
      if (!generateOptions.entrypoints && opts.entryPoints) {
        if (Array.isArray(opts.entryPoints)) {
          generateOptions.entrypoints = opts.entryPoints
        }
        else {
          generateOptions.entrypoints = Object.values(opts.entryPoints)
        }
      }
      if (!generateOptions.outdir) {
        if (opts.outdir) {
          generateOptions.outdir = opts.outdir
        }
        else if (opts.outfile) {
          // Extract directory from outfile
          const lastSlash = opts.outfile.lastIndexOf('/')
          if (lastSlash !== -1) {
            generateOptions.outdir = opts.outfile.substring(0, lastSlash)
          }
        }
      }

      if (onStart) {
        build.onStart(async () => {
          await runGenerate()
        })
      }

      if (onEnd) {
        build.onEnd(async (result) => {
          // Only generate if build succeeded
          if (result.errors.length === 0) {
            await runGenerate()
          }
        })
      }
    },
  }
}

/**
 * Alias for dtsx
 */
export const esbuildDts: typeof dtsx = dtsx

/**
 * Alias matching common naming convention
 */
export const dts: typeof dtsx = dtsx

/**
 * Default export
 */
export default dtsx
