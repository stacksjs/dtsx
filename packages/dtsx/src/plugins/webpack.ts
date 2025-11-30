/**
 * webpack plugin for dtsx
 * Generates TypeScript declaration files during webpack builds
 */

import type { DtsGenerationConfig, GenerationStats } from '../types'
import { generate } from '../generator'

/**
 * webpack plugin options
 */
export interface WebpackPluginOptions extends Partial<DtsGenerationConfig> {
  /**
   * Generate declarations during compilation
   * @default false
   */
  onCompile?: boolean

  /**
   * Generate declarations after emit
   * @default true
   */
  afterEmit?: boolean

  /**
   * Generate declarations on watch run
   * @default false
   */
  onWatchRun?: boolean

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
 * webpack compiler interface (minimal type)
 */
interface WebpackCompiler {
  hooks: {
    compile: { tap: (name: string, callback: () => void) => void }
    afterEmit: { tapAsync: (name: string, callback: (compilation: unknown, done: () => void) => void) => void }
    watchRun: { tapAsync: (name: string, callback: (compiler: unknown, done: () => void) => void) => void }
  }
  options: {
    entry?: unknown
    output?: {
      path?: string
    }
    context?: string
  }
}

/**
 * webpack plugin for dtsx
 *
 * @example
 * ```ts
 * // webpack.config.js
 * const { DtsxWebpackPlugin } = require('@stacksjs/dtsx/plugins/webpack')
 *
 * module.exports = {
 *   entry: './src/index.ts',
 *   output: {
 *     path: path.resolve(__dirname, 'dist'),
 *   },
 *   plugins: [
 *     new DtsxWebpackPlugin({
 *       root: './src',
 *       outdir: './dist',
 *     }),
 *   ],
 * }
 * ```
 */
export class DtsxWebpackPlugin {
  private options: WebpackPluginOptions
  private generateOptions: Partial<DtsGenerationConfig>

  constructor(options: WebpackPluginOptions = {}) {
    const {
      onCompile = false,
      afterEmit = true,
      onWatchRun = false,
      onGenerated,
      onError,
      ...generateOptions
    } = options

    this.options = {
      onCompile,
      afterEmit,
      onWatchRun,
      onGenerated,
      onError,
    }
    this.generateOptions = generateOptions
  }

  apply(compiler: WebpackCompiler): void {
    const pluginName = 'DtsxWebpackPlugin'

    // Get config from compiler if not provided
    if (!this.generateOptions.outdir && compiler.options.output?.path) {
      this.generateOptions.outdir = compiler.options.output.path
    }
    if (!this.generateOptions.cwd && compiler.options.context) {
      this.generateOptions.cwd = compiler.options.context
    }

    // Extract entry points
    if (!this.generateOptions.entrypoints && compiler.options.entry) {
      const entry = compiler.options.entry
      if (typeof entry === 'string') {
        this.generateOptions.entrypoints = [entry]
      }
      else if (Array.isArray(entry)) {
        this.generateOptions.entrypoints = entry
      }
      else if (typeof entry === 'object' && entry !== null) {
        // Handle object entry format
        const entries: string[] = []
        for (const value of Object.values(entry)) {
          if (typeof value === 'string') {
            entries.push(value)
          }
          else if (Array.isArray(value)) {
            entries.push(...value.filter((v): v is string => typeof v === 'string'))
          }
          else if (typeof value === 'object' && value !== null && 'import' in value) {
            const imp = (value as { import: string | string[] }).import
            if (typeof imp === 'string') {
              entries.push(imp)
            }
            else if (Array.isArray(imp)) {
              entries.push(...imp)
            }
          }
        }
        if (entries.length > 0) {
          this.generateOptions.entrypoints = entries
        }
      }
    }

    if (this.options.onCompile) {
      compiler.hooks.compile.tap(pluginName, () => {
        this.runGenerate()
      })
    }

    if (this.options.afterEmit) {
      compiler.hooks.afterEmit.tapAsync(pluginName, async (_compilation, done) => {
        await this.runGenerate()
        done()
      })
    }

    if (this.options.onWatchRun) {
      compiler.hooks.watchRun.tapAsync(pluginName, async (_compiler, done) => {
        await this.runGenerate()
        done()
      })
    }
  }

  private async runGenerate(): Promise<void> {
    try {
      const stats = await generate(this.generateOptions)
      this.options.onGenerated?.(stats)
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.options.onError?.(err)
      if (!this.options.onError) {
        console.error('[dtsx] Generation failed:', err.message)
      }
    }
  }
}

/**
 * Factory function for creating webpack plugin
 */
export function dtsxWebpack(options: WebpackPluginOptions = {}): DtsxWebpackPlugin {
  return new DtsxWebpackPlugin(options)
}

/**
 * Alias matching common naming convention
 */
export const dts: typeof dtsxWebpack = dtsxWebpack

/**
 * Default export
 */
export default DtsxWebpackPlugin
