/**
 * tsup plugin for dtsx - TypeScript declaration file generation
 * Integrates with tsup's build pipeline for seamless .d.ts generation
 */

import type { Options as TsupOptions } from 'tsup'
import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import { generate } from '@stacksjs/dtsx'
import { resolve, relative, join, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'

/**
 * Plugin configuration options
 */
export interface DtsxTsupOptions extends Omit<Partial<DtsGenerationOption>, 'exclude' | 'include'> {
  /**
   * When to generate declarations
   * - 'buildStart': Generate before build starts
   * - 'buildEnd': Generate after build completes
   * @default 'buildEnd'
   */
  trigger?: 'buildStart' | 'buildEnd'

  /**
   * Only generate for entry points
   * @default true
   */
  entryPointsOnly?: boolean

  /**
   * Output directory for declarations (relative to tsup outDir)
   * @default same as tsup outDir
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
   * Skip declaration generation for specific patterns
   */
  exclude?: (string | RegExp)[]

  /**
   * Only generate for specific patterns
   */
  include?: (string | RegExp)[]

  /**
   * Skip if tsup is already generating dts (dts: true)
   * @default true
   */
  skipIfTsupDts?: boolean

  /**
   * Generate .d.ts.map files
   * @default false
   */
  declarationMap?: boolean

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
  tsupOptions: TsupOptions | null
  generatedFiles: Set<string>
  errors: Error[]
}

const PLUGIN_NAME = 'dtsx'

/**
 * Create tsup plugin for dtsx declaration generation
 */
export function dtsxPlugin(options: DtsxTsupOptions = {}): any {
  const {
    trigger = 'buildEnd',
    entryPointsOnly = true,
    declarationDir,
    bundle: bundleDeclarations = false,
    bundleOutput = 'index.d.ts',
    exclude = [],
    include = [],
    skipIfTsupDts = true,
    declarationMap = false,
    onSuccess,
    onError,
    onStart,
    onProgress,
    ...dtsOptions
  } = options

  const state: PluginState = {
    tsupOptions: null,
    generatedFiles: new Set(),
    errors: [],
  }

  return {
    name: PLUGIN_NAME,

    // Capture tsup options
    esbuildOptions(esbuildOptions: any, context: any) {
      state.tsupOptions = context.options as TsupOptions
    },

    // Build start hook
    async buildStart() {
      if (trigger !== 'buildStart') return

      // Skip if tsup is generating dts
      if (skipIfTsupDts && state.tsupOptions?.dts) {
        console.log(`[${PLUGIN_NAME}] Skipping - tsup dts is enabled`)
        return
      }

      await generateDeclarations()
    },

    // Build end hook
    async buildEnd() {
      if (trigger !== 'buildEnd') return

      // Skip if tsup is generating dts
      if (skipIfTsupDts && state.tsupOptions?.dts) {
        console.log(`[${PLUGIN_NAME}] Skipping - tsup dts is enabled`)
        return
      }

      await generateDeclarations()
    },
  }

  /**
   * Generate declarations
   */
  async function generateDeclarations(): Promise<void> {
    try {
      await onStart?.()

      // Get entry points from tsup options
      let filesToProcess = getEntryPoints(state.tsupOptions)

      // Apply include/exclude filters
      filesToProcess = filterFiles(filesToProcess, include, exclude)

      if (filesToProcess.length === 0) {
        console.log(`[${PLUGIN_NAME}] No files to process`)
        return
      }

      console.log(`[${PLUGIN_NAME}] Generating declarations for ${filesToProcess.length} file(s)...`)

      // Determine output directory
      const outdir = declarationDir || state.tsupOptions?.outDir || 'dist'

      // Normalize configuration
      const config = normalizeConfig(dtsOptions, state.tsupOptions, outdir)

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
          join(outdir, bundleOutput),
        )
      }

      await onSuccess?.(stats)

      console.log(`[${PLUGIN_NAME}] Generated ${state.generatedFiles.size} declaration file(s)`)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      state.errors.push(err)

      if (onError) {
        await onError(err)
      } else {
        console.error(`[${PLUGIN_NAME}] Error generating declarations:`, err.message)
      }
    }
  }
}

/**
 * Get entry points from tsup options
 */
function getEntryPoints(options: TsupOptions | null): string[] {
  if (!options?.entry) return []

  const entry = options.entry

  if (typeof entry === 'string') {
    return [resolve(entry)]
  }

  if (Array.isArray(entry)) {
    return entry.map(e => resolve(e))
  }

  if (typeof entry === 'object') {
    return Object.values(entry).map(e => resolve(e))
  }

  return []
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
    // Must be TypeScript file
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) {
      return false
    }

    // Skip declaration files
    if (file.endsWith('.d.ts')) {
      return false
    }

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
 * Normalize configuration from tsup options
 */
function normalizeConfig(
  options: Partial<DtsGenerationOption>,
  tsupOptions: TsupOptions | null,
  outdir: string,
): DtsGenerationOption {
  const cwd = options.cwd || process.cwd()

  // Try to find tsconfig
  let tsconfigPath = options.tsconfigPath || tsupOptions?.tsconfig
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
 * Bundle multiple declaration files into one
 */
async function bundleDeclarationsFiles(
  files: string[],
  outputPath: string,
): Promise<void> {
  const contents: string[] = [
    '/**',
    ' * Bundled TypeScript declarations',
    ` * Generated by ${PLUGIN_NAME}`,
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
  console.log(`[${PLUGIN_NAME}] Bundled declarations to ${outputPath}`)
}

/**
 * Create a preset tsup config with dtsx integration
 */
export function createTsupConfig(
  entry: string | string[] | Record<string, string>,
  options: DtsxTsupOptions & {
    /** Additional tsup options */
    tsupOptions?: Partial<TsupOptions>
  } = {},
): TsupOptions {
  const { tsupOptions = {}, ...dtsxOptions } = options

  return {
    entry,
    format: ['esm', 'cjs'],
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: false, // Use dtsx instead
    esbuildPlugins: [
      // dtsx runs via tsup plugin hooks, not esbuild
    ],
    ...tsupOptions,
    plugins: [
      ...(tsupOptions.plugins || []),
      dtsxPlugin(dtsxOptions),
    ],
  } as TsupOptions
}

/**
 * Define tsup config with dtsx (helper for tsup.config.ts)
 */
export function defineConfig(
  options: TsupOptions & { dtsx?: DtsxTsupOptions },
): TsupOptions {
  const { dtsx: dtsxOptions, ...tsupOptions } = options

  if (dtsxOptions) {
    return {
      ...tsupOptions,
      dts: false, // Disable tsup dts when using dtsx
      plugins: [
        ...(tsupOptions.plugins || []),
        dtsxPlugin(dtsxOptions),
      ],
    }
  }

  return tsupOptions
}

// Re-export types
export type { DtsGenerationOption, GenerationStats }

// Default export
export default dtsxPlugin
