/**
 * Bun build plugin for dtsx
 * Generates TypeScript declaration files during Bun builds
 */

import type { DtsGenerationConfig, GenerationStats } from '../types'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
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

  /**
   * Whether declaration errors fail the Bun build
   * @default true
   */
  failOnError?: boolean
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
    failOnError = true,
    ...generateOptions
  } = options

  const runGenerate = async (config: Partial<DtsGenerationConfig>): Promise<void> => {
    try {
      const stats = await generate(config)
      onGenerated?.(stats)
    }
    catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      onError?.(err)
      if (!onError) {
        console.error('[dtsx] Generation failed:', err.message)
      }
      if (failOnError) throw err
    }
  }

  return {
    name: 'dtsx',

    async setup(build) {
      if (!preBuild && !postBuild) return

      const cwd = generateOptions.cwd || process.cwd()
      const buildEntrypoints = build.config.entrypoints || []
      const absoluteEntrypoints = buildEntrypoints.map(entrypoint => resolve(cwd, entrypoint))
      const root = generateOptions.root
        || build.config.root
        || (absoluteEntrypoints.length > 0 ? relative(cwd, commonParentDir(absoluteEntrypoints)) || '.' : './src')
      const resolvedRoot = resolve(cwd, root)
      const entrypoints = generateOptions.entrypoints || absoluteEntrypoints
        .filter(entrypoint => entrypoint === resolvedRoot || entrypoint.startsWith(`${resolvedRoot}${sep}`))
        .map(entrypoint => relative(resolvedRoot, entrypoint))

      await runGenerate({
        ...generateOptions,
        cwd,
        root,
        entrypoints: entrypoints.length > 0 ? entrypoints : ['index.ts'],
        outdir: generateOptions.outdir || build.config.outdir || './dist',
      })
    },
  }
}

function commonParentDir(paths: string[]): string {
  const directories = paths.map(path => dirname(path).split(sep))
  let common = directories[0]

  for (const parts of directories.slice(1)) {
    let index = 0
    while (index < common.length && index < parts.length && common[index] === parts[index]) index++
    common = common.slice(0, index)
  }

  return common.join(sep) || sep
}

/**
 * Alias for dts
 */
export const bunDts: typeof dts = dts

/**
 * Default export
 */
export default dts
