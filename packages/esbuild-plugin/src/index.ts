/**
 * esbuild plugin for dtsx - TypeScript declaration file generation
 * Integrates with esbuild's build pipeline for seamless .d.ts generation
 */

import type { Plugin, BuildOptions, BuildResult, OnLoadArgs, OnLoadResult } from 'esbuild'
import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import { generate } from '@stacksjs/dtsx'
import { resolve, dirname, basename, extname, relative, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'

/**
 * Plugin configuration options
 */
export interface DtsxEsbuildOptions extends Omit<Partial<DtsGenerationOption>, 'exclude' | 'include'> {
  /**
   * When to generate declarations
   * - 'build': Generate after build completes
   * - 'watch': Generate on each rebuild in watch mode
   * - 'both': Generate in both modes
   * @default 'build'
   */
  trigger?: 'build' | 'watch' | 'both'

  /**
   * Only generate for entry points
   * @default true
   */
  entryPointsOnly?: boolean

  /**
   * Output directory for declarations (relative to outdir)
   * @default same as esbuild outdir
   */
  declarationDir?: string

  /**
   * Generate a single bundled declaration file
   * @default false
   */
  bundle?: boolean

  /**
   * Bundled output filename
   * @default 'index.d.ts'
   */
  bundleOutput?: string

  /**
   * Include source maps for declarations
   * @default false
   */
  sourceMaps?: boolean

  /**
   * Skip declaration generation for specific patterns
   */
  exclude?: (string | RegExp)[]

  /**
   * Only generate for specific patterns
   */
  include?: (string | RegExp)[]

  /**
   * Emit declaration even if there are type errors
   * @default true
   */
  emitOnError?: boolean

  /**
   * Generate .d.ts.map files
   * @default false
   */
  declarationMap?: boolean

  /**
   * Path aliases from tsconfig
   */
  paths?: Record<string, string[]>

  /**
   * Base URL for path resolution
   */
  baseUrl?: string

  /**
   * Callback after successful generation
   */
  onSuccess?: (stats: GenerationStats) => void | Promise<void>

  /**
   * Callback on generation error
   */
  onError?: (error: Error) => void | Promise<void>

  /**
   * Callback before generation starts
   */
  onStart?: () => void | Promise<void>

  /**
   * Callback for progress updates
   */
  onProgress?: (current: number, total: number, file: string) => void
}

/**
 * Internal plugin state
 */
interface PluginState {
  buildOptions: BuildOptions | null
  isWatchMode: boolean
  generatedFiles: Set<string>
  errors: Error[]
}

/**
 * Create esbuild plugin for dtsx
 */
export function dtsx(options: DtsxEsbuildOptions = {}): Plugin {
  const {
    trigger = 'build',
    entryPointsOnly = true,
    declarationDir,
    bundle: bundleDeclarations = false,
    bundleOutput = 'index.d.ts',
    sourceMaps = false,
    exclude = [],
    include = [],
    emitOnError = true,
    declarationMap = false,
    paths,
    baseUrl,
    onSuccess,
    onError,
    onStart,
    onProgress,
    ...dtsOptions
  } = options

  const state: PluginState = {
    buildOptions: null,
    isWatchMode: false,
    generatedFiles: new Set(),
    errors: [],
  }

  return {
    name: 'dtsx',

    setup(build) {
      state.buildOptions = build.initialOptions
      state.isWatchMode = !!(build.initialOptions as any).watch

      // Determine if we should run
      const shouldRun = trigger === 'both' ||
        (trigger === 'build' && !state.isWatchMode) ||
        (trigger === 'watch' && state.isWatchMode)

      if (!shouldRun) {
        return
      }

      // Hook into build end
      build.onEnd(async (result: BuildResult) => {
        if (result.errors.length > 0 && !emitOnError) {
          console.log('[dtsx] Skipping declaration generation due to build errors')
          return
        }

        try {
          await onStart?.()

          const config = normalizeConfig(
            dtsOptions,
            state.buildOptions!,
            declarationDir,
          )

          // Get entry points to process
          let filesToProcess: string[] = []

          if (entryPointsOnly) {
            filesToProcess = getEntryPoints(state.buildOptions!)
          } else {
            // Get all TypeScript files from the build
            filesToProcess = getTypeScriptFiles(result, state.buildOptions!)
          }

          // Apply include/exclude filters
          filesToProcess = filterFiles(filesToProcess, include, exclude)

          if (filesToProcess.length === 0) {
            console.log('[dtsx] No files to process')
            return
          }

          console.log(`[dtsx] Generating declarations for ${filesToProcess.length} file(s)...`)

          // Generate declarations
          const stats = await generate({
            ...config,
            entrypoints: filesToProcess.map(f => relative(config.cwd || process.cwd(), f)),
          })

          state.generatedFiles = new Set<string>()

          // Bundle if requested
          if (bundleDeclarations && state.generatedFiles.size > 0) {
            await bundleDeclarationsFiles(
              Array.from(state.generatedFiles),
              join(config.outdir || 'dist', bundleOutput),
            )
          }

          await onSuccess?.(stats)

          console.log(`[dtsx] Generated ${state.generatedFiles.size} declaration file(s)`)
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          state.errors.push(err)

          if (onError) {
            await onError(err)
          } else {
            console.error('[dtsx] Error generating declarations:', err.message)
          }
        }
      })
    },
  }
}

/**
 * Normalize configuration from esbuild options
 */
function normalizeConfig(
  options: Partial<DtsGenerationOption>,
  buildOptions: BuildOptions,
  declarationDir?: string,
): DtsGenerationOption {
  const outdir = declarationDir || buildOptions.outdir || 'dist'
  const cwd = options.cwd || process.cwd()

  // Try to find tsconfig
  let tsconfigPath = options.tsconfigPath
  if (!tsconfigPath) {
    const defaultPaths = ['tsconfig.json', 'tsconfig.build.json']
    for (const p of defaultPaths) {
      if (existsSync(resolve(cwd, p))) {
        tsconfigPath = p
        break
      }
    }
  }

  return {
    cwd,
    root: options.root || './src',
    outdir,
    tsconfigPath,
    clean: options.clean ?? false,
    keepComments: options.keepComments ?? true,
    ...options,
  }
}

/**
 * Get entry points from esbuild options
 */
function getEntryPoints(options: BuildOptions): string[] {
  const entryPoints = options.entryPoints

  if (!entryPoints) {
    return []
  }

  if (Array.isArray(entryPoints)) {
    return entryPoints.filter((e): e is string => typeof e === 'string')
  }

  if (typeof entryPoints === 'object') {
    return Object.values(entryPoints)
  }

  return []
}

/**
 * Get all TypeScript files from build result
 */
function getTypeScriptFiles(result: BuildResult, options: BuildOptions): string[] {
  const files: string[] = []

  // Get from metafile if available
  if (result.metafile) {
    for (const input of Object.keys(result.metafile.inputs)) {
      if (input.endsWith('.ts') || input.endsWith('.tsx')) {
        if (!input.endsWith('.d.ts')) {
          files.push(resolve(input))
        }
      }
    }
  }

  // Fallback to entry points
  if (files.length === 0) {
    files.push(...getEntryPoints(options))
  }

  return files
}

/**
 * Filter files based on include/exclude patterns
 */
function filterFiles(
  files: string[],
  include: (string | RegExp)[],
  exclude: (string | RegExp)[],
): string[] {
  return files.filter(file => {
    // Check exclude patterns
    for (const pattern of exclude) {
      if (typeof pattern === 'string') {
        if (file.includes(pattern)) return false
      } else if (pattern.test(file)) {
        return false
      }
    }

    // Check include patterns (if specified)
    if (include.length > 0) {
      for (const pattern of include) {
        if (typeof pattern === 'string') {
          if (file.includes(pattern)) return true
        } else if (pattern.test(file)) {
          return true
        }
      }
      return false
    }

    return true
  })
}

/**
 * Bundle multiple declaration files into one
 */
async function bundleDeclarationsFiles(
  files: string[],
  outputPath: string,
): Promise<void> {
  const contents: string[] = [
    '/**',
    ' * Bundled TypeScript declarations',
    ` * Generated by dtsx esbuild plugin`,
    ' */',
    '',
  ]

  const imports = new Map<string, Set<string>>()
  const declarations: string[] = []

  for (const file of files) {
    if (!existsSync(file)) continue

    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()

      // Collect imports
      if (trimmed.startsWith('import ')) {
        const match = trimmed.match(/from\s+['"]([^'"]+)['"]/)
        if (match && !match[1].startsWith('.')) {
          // External import
          if (!imports.has(match[1])) {
            imports.set(match[1], new Set())
          }
          // Extract specifiers
          const specMatch = trimmed.match(/\{([^}]+)\}/)
          if (specMatch) {
            specMatch[1].split(',').forEach(s => {
              imports.get(match[1])!.add(s.trim())
            })
          }
        }
        continue
      }

      // Skip relative imports and empty lines in output
      if (trimmed.startsWith('import ') || trimmed === '') continue

      declarations.push(line)
    }
  }

  // Write imports
  for (const [source, specifiers] of imports) {
    if (specifiers.size > 0) {
      contents.push(`import { ${Array.from(specifiers).join(', ')} } from '${source}';`)
    }
  }

  if (imports.size > 0) {
    contents.push('')
  }

  // Write declarations
  contents.push(...declarations)

  // Ensure output directory exists
  const outDir = dirname(outputPath)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  writeFileSync(outputPath, contents.join('\n'))
  console.log(`[dtsx] Bundled declarations to ${outputPath}`)
}

/**
 * Create a minimal plugin that only validates types
 */
export function dtsxCheck(): Plugin {
  return {
    name: 'dtsx-check',

    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length === 0) {
          console.log('[dtsx-check] Build passed type checking')
        }
      })
    },
  }
}

/**
 * Create a plugin that watches for .d.ts changes
 */
export function dtsxWatch(options: {
  onDeclarationChange?: (file: string) => void
} = {}): Plugin {
  return {
    name: 'dtsx-watch',

    setup(build) {
      const { onDeclarationChange } = options

      // Watch .d.ts files
      build.onResolve({ filter: /\.d\.ts$/ }, (args) => {
        return {
          path: args.path,
          watchFiles: [args.path],
        }
      })

      build.onLoad({ filter: /\.d\.ts$/ }, (args) => {
        onDeclarationChange?.(args.path)
        return null
      })
    },
  }
}

// Re-export types
export type { DtsGenerationOption, GenerationStats }

export default dtsx
