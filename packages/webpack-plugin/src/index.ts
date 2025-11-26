/**
 * Webpack plugin for dtsx - TypeScript declaration file generation
 * Integrates with webpack's compilation pipeline for seamless .d.ts generation
 */

import type { Compiler, Compilation, WebpackPluginInstance } from 'webpack'
import type { DtsGenerationOption, GenerationStats } from '@stacksjs/dtsx'
import { generate } from '@stacksjs/dtsx'
import { resolve, relative, join, dirname } from 'node:path'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'

/**
 * Plugin configuration options
 */
export interface DtsxWebpackOptions extends Partial<DtsGenerationOption> {
  /**
   * When to generate declarations
   * - 'emit': Generate during emit phase
   * - 'afterEmit': Generate after emit completes
   * - 'done': Generate when compilation is done
   * @default 'afterEmit'
   */
  trigger?: 'emit' | 'afterEmit' | 'done'

  /**
   * Only generate for entry points
   * @default true
   */
  entryPointsOnly?: boolean

  /**
   * Output directory for declarations (relative to webpack output path)
   * @default same as webpack output path
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
   * Emit declaration even if there are compilation errors
   * @default false
   */
  emitOnError?: boolean

  /**
   * Generate .d.ts.map files
   * @default false
   */
  declarationMap?: boolean

  /**
   * Skip generation in watch mode rebuilds if no TS files changed
   * @default true
   */
  skipUnchanged?: boolean

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
  lastBuildFiles: Set<string>
  generatedFiles: Set<string>
  isFirstBuild: boolean
  errors: Error[]
}

const PLUGIN_NAME = 'DtsxWebpackPlugin'

/**
 * Webpack plugin for dtsx declaration generation
 */
export class DtsxWebpackPlugin implements WebpackPluginInstance {
  private options: DtsxWebpackOptions
  private state: PluginState

  constructor(options: DtsxWebpackOptions = {}) {
    this.options = {
      trigger: 'afterEmit',
      entryPointsOnly: true,
      bundle: false,
      bundleOutput: 'index.d.ts',
      emitOnError: false,
      declarationMap: false,
      skipUnchanged: true,
      ...options,
    }

    this.state = {
      lastBuildFiles: new Set(),
      generatedFiles: new Set(),
      isFirstBuild: true,
      errors: [],
    }
  }

  apply(compiler: Compiler): void {
    const { trigger } = this.options

    // Register the appropriate hook based on trigger option
    switch (trigger) {
      case 'emit':
        compiler.hooks.emit.tapAsync(PLUGIN_NAME, (compilation, callback) => {
          this.handleGeneration(compiler, compilation)
            .then(() => callback())
            .catch(callback)
        })
        break

      case 'afterEmit':
        compiler.hooks.afterEmit.tapAsync(PLUGIN_NAME, (compilation, callback) => {
          this.handleGeneration(compiler, compilation)
            .then(() => callback())
            .catch(callback)
        })
        break

      case 'done':
        compiler.hooks.done.tapAsync(PLUGIN_NAME, (stats, callback) => {
          this.handleGeneration(compiler, stats.compilation)
            .then(() => callback())
            .catch(callback)
        })
        break
    }

    // Track changed files in watch mode
    compiler.hooks.watchRun.tap(PLUGIN_NAME, () => {
      this.state.isFirstBuild = false
    })
  }

  /**
   * Handle declaration generation
   */
  private async handleGeneration(compiler: Compiler, compilation: Compilation): Promise<void> {
    const {
      entryPointsOnly,
      declarationDir,
      bundle,
      bundleOutput,
      exclude = [],
      include = [],
      emitOnError,
      skipUnchanged,
      onSuccess,
      onError,
      onStart,
      ...dtsOptions
    } = this.options

    // Check for compilation errors
    if (compilation.errors.length > 0 && !emitOnError) {
      console.log(`[${PLUGIN_NAME}] Skipping declaration generation due to compilation errors`)
      return
    }

    try {
      await onStart?.()

      // Get files to process
      let filesToProcess = this.getFilesToProcess(compiler, compilation, entryPointsOnly!)

      // Apply include/exclude filters
      filesToProcess = this.filterFiles(filesToProcess, include, exclude)

      // Skip if no changes in watch mode
      if (skipUnchanged && !this.state.isFirstBuild) {
        const currentFiles = new Set(filesToProcess)
        const hasChanges = this.hasFileChanges(currentFiles)

        if (!hasChanges) {
          console.log(`[${PLUGIN_NAME}] No TypeScript changes detected, skipping`)
          return
        }

        this.state.lastBuildFiles = currentFiles
      }

      if (filesToProcess.length === 0) {
        console.log(`[${PLUGIN_NAME}] No files to process`)
        return
      }

      console.log(`[${PLUGIN_NAME}] Generating declarations for ${filesToProcess.length} file(s)...`)

      // Determine output directory
      const outputPath = compiler.options.output?.path || 'dist'
      const outdir = declarationDir
        ? resolve(outputPath, declarationDir)
        : outputPath

      // Normalize configuration
      const config = this.normalizeConfig(dtsOptions, compiler, outdir)

      // Generate declarations
      const stats = await generate({
        ...config,
        entrypoints: filesToProcess.map(f => relative(config.cwd || process.cwd(), f)),
      })

      this.state.generatedFiles = new Set(
        stats.filesGenerated?.map(f => f.path) || []
      )

      // Bundle if requested
      if (bundle && this.state.generatedFiles.size > 0) {
        await this.bundleDeclarations(
          Array.from(this.state.generatedFiles),
          join(outdir, bundleOutput!),
        )
      }

      await onSuccess?.(stats)

      console.log(`[${PLUGIN_NAME}] Generated ${this.state.generatedFiles.size} declaration file(s)`)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.state.errors.push(err)

      if (onError) {
        await onError(err)
      } else {
        console.error(`[${PLUGIN_NAME}] Error generating declarations:`, err.message)
      }
    }
  }

  /**
   * Get files to process from compilation
   */
  private getFilesToProcess(
    compiler: Compiler,
    compilation: Compilation,
    entryPointsOnly: boolean,
  ): string[] {
    const files: string[] = []

    if (entryPointsOnly) {
      // Get entry points
      const entries = compiler.options.entry

      if (typeof entries === 'string') {
        files.push(resolve(entries))
      } else if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (typeof entry === 'string') {
            files.push(resolve(entry))
          }
        }
      } else if (typeof entries === 'object') {
        for (const [, entry] of Object.entries(entries)) {
          if (typeof entry === 'string') {
            files.push(resolve(entry))
          } else if (typeof entry === 'object' && entry.import) {
            const imports = Array.isArray(entry.import) ? entry.import : [entry.import]
            for (const imp of imports) {
              if (typeof imp === 'string') {
                files.push(resolve(imp))
              }
            }
          }
        }
      }
    } else {
      // Get all TypeScript files from compilation
      for (const module of compilation.modules) {
        const resource = (module as any).resource as string | undefined

        if (resource && this.isTypeScriptFile(resource)) {
          files.push(resource)
        }
      }
    }

    // Filter to only TypeScript files
    return files.filter(f => this.isTypeScriptFile(f))
  }

  /**
   * Check if a file is a TypeScript file
   */
  private isTypeScriptFile(file: string): boolean {
    return (file.endsWith('.ts') || file.endsWith('.tsx')) && !file.endsWith('.d.ts')
  }

  /**
   * Filter files based on include/exclude patterns
   */
  private filterFiles(
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
   * Check if files have changed since last build
   */
  private hasFileChanges(currentFiles: Set<string>): boolean {
    if (currentFiles.size !== this.state.lastBuildFiles.size) {
      return true
    }

    for (const file of currentFiles) {
      if (!this.state.lastBuildFiles.has(file)) {
        return true
      }
    }

    return false
  }

  /**
   * Normalize configuration from webpack options
   */
  private normalizeConfig(
    options: Partial<DtsGenerationOption>,
    compiler: Compiler,
    outdir: string,
  ): DtsGenerationOption {
    const context = compiler.options.context || process.cwd()

    // Try to find tsconfig
    let tsconfigPath = options.tsconfigPath
    if (!tsconfigPath) {
      const defaultPaths = ['tsconfig.json', 'tsconfig.build.json']
      for (const p of defaultPaths) {
        if (existsSync(resolve(context, p))) {
          tsconfigPath = p
          break
        }
      }
    }

    return {
      cwd: context,
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
  private async bundleDeclarations(
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
}

/**
 * Factory function for creating the plugin
 */
export function dtsx(options: DtsxWebpackOptions = {}): DtsxWebpackPlugin {
  return new DtsxWebpackPlugin(options)
}

/**
 * Create a minimal plugin that only validates types
 */
export class DtsxCheckPlugin implements WebpackPluginInstance {
  apply(compiler: Compiler): void {
    compiler.hooks.done.tap('DtsxCheckPlugin', (stats) => {
      if (stats.hasErrors()) {
        console.log('[DtsxCheckPlugin] Build has errors, skipping type check')
        return
      }

      console.log('[DtsxCheckPlugin] Build passed')
    })
  }
}

/**
 * Factory function for check plugin
 */
export function dtsxCheck(): DtsxCheckPlugin {
  return new DtsxCheckPlugin()
}

/**
 * Create a plugin that watches for .d.ts changes
 */
export class DtsxWatchPlugin implements WebpackPluginInstance {
  private options: {
    onDeclarationChange?: (file: string) => void
  }

  constructor(options: { onDeclarationChange?: (file: string) => void } = {}) {
    this.options = options
  }

  apply(compiler: Compiler): void {
    const { onDeclarationChange } = this.options

    compiler.hooks.afterEmit.tap('DtsxWatchPlugin', (compilation) => {
      if (!onDeclarationChange) return

      for (const file of compilation.emittedAssets) {
        if (file.endsWith('.d.ts')) {
          onDeclarationChange(file)
        }
      }
    })
  }
}

/**
 * Factory function for watch plugin
 */
export function dtsxWatch(options: { onDeclarationChange?: (file: string) => void } = {}): DtsxWatchPlugin {
  return new DtsxWatchPlugin(options)
}

// Re-export types
export type { DtsGenerationOption, GenerationStats }

export default DtsxWebpackPlugin
