/**
 * Vite plugin for dtsx
 * Generates TypeScript declaration files during Vite builds
 */

import type { DtsGenerationConfig, GenerationStats } from '../types'
import { generate } from '../generator'

/**
 * Vite plugin options
 */
export interface VitePluginOptions extends Partial<DtsGenerationConfig> {
  /**
   * Generate declarations on build start
   * @default true
   */
  buildStart?: boolean

  /**
   * Generate declarations on build end
   * @default false
   */
  buildEnd?: boolean

  /**
   * Generate declarations on writeBundle
   * @default false
   */
  writeBundle?: boolean

  /**
   * Apply plugin only in specific modes
   * @example ['production']
   */
  modes?: string[]

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
 * Vite plugin interface (minimal type for compatibility)
 */
interface VitePlugin {
  name: string
  apply?: 'build' | 'serve' | ((config: { mode: string }) => boolean)
  buildStart?: () => Promise<void> | void
  buildEnd?: () => Promise<void> | void
  writeBundle?: () => Promise<void> | void
}

/**
 * Create a Vite plugin for dtsx
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { dts } from '@stacksjs/dtsx/plugins/vite'
 *
 * export default {
 *   plugins: [
 *     dts({
 *       root: './src',
 *       outdir: './dist',
 *     }),
 *   ],
 * }
 * ```
 */
export function dts(options: VitePluginOptions = {}): VitePlugin {
  const {
    buildStart = true,
    buildEnd = false,
    writeBundle = false,
    modes,
    onGenerated,
    onError,
    ...generateOptions
  } = options

  let currentMode: string = 'production'

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

  const shouldRun = (): boolean => {
    if (!modes || modes.length === 0)
      return true
    return modes.includes(currentMode)
  }

  return {
    name: 'dtsx',

    apply(config) {
      currentMode = config.mode
      return true
    },

    async buildStart() {
      if (buildStart && shouldRun()) {
        await runGenerate()
      }
    },

    async buildEnd() {
      if (buildEnd && shouldRun()) {
        await runGenerate()
      }
    },

    async writeBundle() {
      if (writeBundle && shouldRun()) {
        await runGenerate()
      }
    },
  }
}

/**
 * Alias for dts
 */
export const viteDts: typeof dts = dts

/**
 * Default export
 */
export default dts
