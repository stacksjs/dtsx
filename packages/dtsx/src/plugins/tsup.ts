/**
 * tsup plugin for dtsx
 * Generates TypeScript declaration files during tsup builds
 */

import type { DtsGenerationConfig, GenerationStats } from '../types'
import { generate } from '../generator'

/**
 * tsup plugin options
 */
export interface TsupPluginOptions extends Partial<DtsGenerationConfig> {
  /**
   * Generate declarations on build start
   * @default false
   */
  onBuildStart?: boolean

  /**
   * Generate declarations on build end
   * @default true
   */
  onBuildEnd?: boolean

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
 * tsup plugin interface
 */
interface TsupPlugin {
  name: string
  buildStart?: () => void | Promise<void>
  buildEnd?: (ctx: { writtenFiles: Array<{ name: string, size: number }> }) => void | Promise<void>
  esbuildOptions?: (options: Record<string, unknown>) => void
}

/**
 * Create a tsup plugin for dtsx
 *
 * @example
 * ```ts
 * // tsup.config.ts
 * import { dtsxPlugin } from '@stacksjs/dtsx/plugins/tsup'
 * import { defineConfig } from 'tsup'
 *
 * export default defineConfig({
 *   entry: ['./src/index.ts'],
 *   outDir: './dist',
 *   plugins: [
 *     dtsxPlugin({
 *       root: './src',
 *       outdir: './dist',
 *     }),
 *   ],
 * })
 * ```
 */
export function dtsxPlugin(options: TsupPluginOptions = {}): TsupPlugin {
  const {
    onBuildStart = false,
    onBuildEnd = true,
    onGenerated,
    onError,
    ...generateOptions
  } = options

  let esbuildOutdir: string | undefined
  let esbuildEntryPoints: string[] | undefined

  const runGenerate = async (): Promise<void> => {
    // Merge esbuild options if available
    const opts = { ...generateOptions }
    if (!opts.outdir && esbuildOutdir) {
      opts.outdir = esbuildOutdir
    }
    if (!opts.entrypoints && esbuildEntryPoints) {
      opts.entrypoints = esbuildEntryPoints
    }

    try {
      const stats = await generate(opts)
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

    esbuildOptions(esbuildOpts) {
      // Capture esbuild options for later use
      if (esbuildOpts.outdir && typeof esbuildOpts.outdir === 'string') {
        esbuildOutdir = esbuildOpts.outdir
      }
      if (esbuildOpts.entryPoints) {
        if (Array.isArray(esbuildOpts.entryPoints)) {
          esbuildEntryPoints = esbuildOpts.entryPoints as string[]
        }
        else if (typeof esbuildOpts.entryPoints === 'object') {
          esbuildEntryPoints = Object.values(esbuildOpts.entryPoints as Record<string, string>)
        }
      }
    },

    async buildStart() {
      if (onBuildStart) {
        await runGenerate()
      }
    },

    async buildEnd(_ctx) {
      if (onBuildEnd) {
        await runGenerate()
      }
    },
  }
}

/**
 * Alias for dtsxPlugin
 */
export const tsupDts: typeof dtsxPlugin = dtsxPlugin

/**
 * Alias matching common naming convention
 */
export const dts: typeof dtsxPlugin = dtsxPlugin

/**
 * Default export
 */
export default dtsxPlugin
