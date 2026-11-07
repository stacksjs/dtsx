/**
 * Shared read-only declaration project planning, output layout and resolved
 * reference decisions. Planning never cleans, caches or publishes outputs.
 */
import type { ModuleResolver, ReachabilityResult } from './module-graph'
import type { DtsGenerationConfig } from './types'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { Glob } from 'bun'
import { logger } from './logger'
import { collectReachableViaReExports, createModuleResolver } from './module-graph'

export interface DeclarationProjectPlan {
  readonly entryFiles: readonly string[]
  readonly files: readonly string[]
  readonly outputBySource: ReadonlyMap<string, string>
  readonly resolver: ModuleResolver
  readonly reachability: ReachabilityResult | null
  /** Read the resolution fingerprint only when the caller needs a cache key. */
  getResolutionFingerprint: () => string | undefined
}

/**
 * Plan sources and intended declaration outputs from an effective config.
 * The optional resolver provider lets the generator retain its config-scoped
 * resolver lifecycle; it runs only after the existing entrypoint validation.
 */
export async function planDeclarationProject(
  config: DtsGenerationConfig,
  provideResolver?: () => Promise<ModuleResolver>,
): Promise<DeclarationProjectPlan> {
  // Find all TypeScript files based on entrypoints
  const entryFiles = await findFiles(config)
  assertEntrypointsResolve(config, entryFiles)

  let files = entryFiles.slice()
  const resolveSpecifier = await (provideResolver ? provideResolver() : createModuleResolver(config))

  // Auto-expand the file set through relative re-exports AND imports so:
  //   1. A barrel `export * from './x'` pulls in `./x.ts`. Otherwise the
  //      emitted `.d.ts` re-exports siblings dtsx never wrote, producing
  //      types that resolve to nothing for consumers (stacksjs/dtsx#3090).
  //   2. A type-position `import { Foo } from './foo'` pulls in `./foo.ts`.
  //      Otherwise the emitted `.d.ts` keeps that import statement
  //      (because `Foo` is referenced from a public declaration) but the
  //      target `.d.ts` is never written — `tsc --noEmit` then fails with
  //      `Cannot find module './foo'` for every consumer.
  // The walker chases all imports (not just type-only) since runtime
  // imports may still surface in declaration types via inferred returns.
  let reExportReachability: Awaited<ReturnType<typeof collectReachableViaReExports>> | null = null
  if (config.autoIncludeReExports !== false && files.length > 0) {
    reExportReachability = await collectReachableViaReExports(files, { includeImports: true, resolveSpecifier })

    const rootPath = resolve(config.cwd, config.root)
    const excludePatterns = config.exclude || []

    const additions: string[] = []
    for (const f of reExportReachability.reachable) {
      if (files.includes(f)) continue
      if (!isProcessableSourceFile(f)) continue
      if (f.endsWith('.d.ts')) continue
      if (f.includes('node_modules')) continue
      const localFlatSource = config.outputStructure === 'flat' && entryFiles.some(entry => resolveSpecifier.isPackageLocal?.(entry, f))
      if (!isWithinRoot(f, rootPath) && !localFlatSource) {
        logger.warn(`Skipping auto-included source outside root: ${relative(config.cwd, f)}`)
        continue
      }
      if (isExcluded(f, excludePatterns, rootPath)) continue
      additions.push(f)
    }

    if (additions.length > 0) {
      files = [...files, ...additions]
      logger.debug(`Auto-included ${additions.length} file(s) reached via relative re-exports`)
    }
  }

  const outputBySource = createOutputMap(files, config)

  return Object.freeze({
    entryFiles: Object.freeze(entryFiles),
    files: Object.freeze(files),
    outputBySource,
    resolver: resolveSpecifier,
    reachability: reExportReachability,
    getResolutionFingerprint: () => resolveSpecifier.cacheKey?.(files),
  })
}

/**
 * Cache for compiled Glob patterns to avoid re-creation per file
 * Bounded to prevent memory leaks from dynamic patterns
 */
const MAX_GLOB_CACHE_SIZE = 50
const compiledGlobCache = new Map<string, Glob>()

function getCompiledGlob(pattern: string): Glob {
  let glob = compiledGlobCache.get(pattern)
  if (!glob) {
    glob = new Glob(pattern)
    compiledGlobCache.set(pattern, glob)

    // Evict oldest entry if cache exceeds max size
    if (compiledGlobCache.size > MAX_GLOB_CACHE_SIZE) {
      const firstKey = compiledGlobCache.keys().next().value
      if (firstKey !== undefined) {
        compiledGlobCache.delete(firstKey)
      }
    }
  }
  return glob
}

/**
 * Check if a file matches any of the exclude patterns
 */
export function isExcluded(filePath: string, excludePatterns: string[], rootPath: string): boolean {
  if (!excludePatterns || excludePatterns.length === 0) {
    return false
  }

  const relativePath = relative(rootPath, filePath)

  for (const pattern of excludePatterns) {
    const glob = getCompiledGlob(pattern)
    if (glob.match(relativePath) || glob.match(filePath)) {
      return true
    }
  }

  return false
}

/** Glob metacharacters — a pattern without any of these names exactly one file. */
const GLOB_META_RE = /[*?[\]{}!]/

/**
 * Fail when an entrypoint names nothing.
 *
 * Producing no declarations is never what the caller meant, and saying
 * nothing about it is worse than failing: the run reports success, the
 * package publishes its `.js`, and consumers get no types at all. Two shapes
 * of that were reachable — every entrypoint missing (a mistyped root, or the
 * comma form `--entrypoints "a.ts,b.ts"` read as one literal path), and one
 * of several missing, which quietly emitted declarations for the survivors.
 *
 * A literal path that resolves to no file is unambiguously a mistake and is
 * reported on its own. A glob is not: `**\/*.vue` legitimately matches
 * nothing in a project with no Vue files, so a glob only counts toward the
 * all-entrypoints-missing case.
 */
function assertEntrypointsResolve(config: DtsGenerationConfig, entryFiles: string[]): void {
  const rootPath = resolve(config.cwd, config.root)
  const context = `  root:        ${rootPath}\n`
  + `  entrypoints: ${config.entrypoints.map(p => JSON.stringify(p)).join(', ') || '(none)'}\n`
  + (config.exclude?.length ? `  exclude:     ${config.exclude.map(p => JSON.stringify(p)).join(', ')}\n` : '')
  + `Entrypoints are resolved relative to --root. Pass several by repeating `
  + `--entrypoints or separating them with commas.`

  if (entryFiles.length === 0) {
    // An entrypoint outside the root is dropped on purpose and warned about
    // one by one, so a run that consists only of those has already said what
    // happened — re-reporting it as a hard failure would be wrong.
    const droppedOutsideRoot = config.entrypoints.filter(pattern =>
      isAbsolute(pattern) && existsSync(pattern) && !isWithinRoot(pattern, rootPath),
  )
  if (droppedOutsideRoot.length === config.entrypoints.length) return

  throw new Error(`No source files matched. Nothing was generated.\n${context}`)
}

const missing = config.entrypoints.filter((pattern) => {
  if (GLOB_META_RE.test(pattern)) return false
  return !existsSync(isAbsolute(pattern) ? pattern : resolve(rootPath, pattern))
})

if (missing.length > 0) {
  throw new Error(
    `Entrypoint${missing.length > 1 ? 's' : ''} not found: ${missing.map(p => JSON.stringify(p)).join(', ')}\n${context}`,
  )
}
}

/**
 * Find all TypeScript files matching the entrypoints patterns
 */
async function findFiles(config: DtsGenerationConfig): Promise<string[]> {
  const files: string[] = []
  const rootPath = resolve(config.cwd, config.root)
  const excludePatterns = config.exclude || []

  const patterns = [...config.entrypoints, ...(config.include ?? [])]

  for (const pattern of patterns) {
    // Check if pattern is an absolute path to a specific source file.
    if (isAbsolute(pattern) && isProcessableSourceFile(pattern)) {
      // It's an absolute file path
      if (!pattern.includes('node_modules')) {
        if (!isWithinRoot(pattern, rootPath) && config.outputStructure !== 'flat') {
          logger.warn(`Skipping entrypoint outside root: ${relative(config.cwd, pattern)}`)
        }
        else if (!isExcluded(pattern, excludePatterns, rootPath)) {
          files.push(pattern)
        }
      }
    }
    else {
      // It's a glob pattern
      const glob = new Glob(pattern)

      // Scan for matching files
      for await (const file of glob.scan({
        cwd: rootPath,
        absolute: true,
        onlyFiles: true,
      })) {
        // Skip .d.ts files, node_modules, and excluded patterns
        if (isProcessableSourceFile(file) && !file.includes('node_modules')) {
          if (!isExcluded(file, excludePatterns, rootPath)) {
            files.push(file)
          }
        }
      }
    }
  }

  // Bun globs may return forward slashes on Windows while explicit entries and
  // re-export resolution use native separators. Normalize before comparing paths.
  return [...new Set(files.map(file => resolve(file)))].sort()
}

export function isWithinRoot(filePath: string, rootPath: string): boolean {
  const relativePath = relative(rootPath, filePath)
  return relativePath !== '..' && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(relativePath)
}

function createOutputMap(files: string[], config: DtsGenerationConfig): ReadonlyMap<string, string> {
  const sourceByOutput = new Map<string, string>()
  const outputBySource = new Map<string, string>()
  for (const sourcePath of files) {
    const outputPath = getDeclarationOutputPath(sourcePath, config)
    const existingSource = sourceByOutput.get(outputPath)
    if (existingSource && existingSource !== sourcePath) {
      throw new Error(`Output path collision: ${relative(config.cwd, existingSource)} and ${relative(config.cwd, sourcePath)} both emit ${relative(config.cwd, outputPath)}`)
    }
    sourceByOutput.set(outputPath, sourcePath)
    outputBySource.set(sourcePath, outputPath)
  }
  return outputBySource
}

function isProcessableSourceFile(filePath: string): boolean {
  return /\.(m?tsx?|cts|jsx?|mjs|cjs|vue|stx)$/.test(filePath) && !/\.d\.(?:ts|mts|cts)$/.test(filePath)
}

export type DeclarationReference =
| { kind: 'unchanged', reason: 'external' | 'unresolved' | 'preserved-declaration', specifier: string, emittedSpecifier: string }
| { kind: 'local', specifier: string, resolvedSource: string, declarationOutput: string, emittedSpecifier: string }

/** Get the declaration output path without accessing or changing the filesystem. */
export function getDeclarationOutputPath(inputPath: string, config: DtsGenerationConfig): string {
  const rootPath = resolve(config.cwd, config.root)
  const relativePath = relative(rootPath, inputPath)
  const dtsPath = /\.d\.(?:ts|mts|cts)$/.test(relativePath)
    ? relativePath
    : relativePath.replace(/\.(m?tsx?|cts|jsx?|mjs|cjs|vue|stx)$/, (ext) => {
    if (ext === '.mts' || ext === '.mjs') return '.d.mts'
    if (ext === '.cts' || ext === '.cjs') return '.d.cts'
    return '.d.ts'
  })

  if (config.outputStructure === 'mirror') {
    // Mirror the source structure
    return resolve(config.cwd, config.outdir, dtsPath)
  }
  else {
    // Flat structure - just use the filename
    const filename = basename(dtsPath)
    return resolve(config.cwd, config.outdir, filename)
  }
}

export function getDeclarationSpecifier(fromOutputPath: string, toOutputPath: string, runtimeExtension = ''): string {
  let specifier = relative(dirname(fromOutputPath), toOutputPath).replace(/\\/g, '/')
  specifier = specifier
    .replace(/\.d\.mts$/, '')
    .replace(/\.d\.cts$/, '')
    .replace(/\.d\.ts$/, '')

  if (runtimeExtension) specifier += runtimeExtension

  if (!specifier.startsWith('.')) {
    specifier = `./${specifier}`
  }

  return specifier
}

/**
 * Resolve one reference encountered in declaration output. A supplied delivery
 * set identifies the current project boundary; omitting it retains standalone
 * transform behavior and does not establish package delivery.
 */
export function createDeclarationReferenceResolver(
  filePath: string,
  config: DtsGenerationConfig,
  resolveSpecifier: ModuleResolver,
  delivered?: ReadonlySet<string>,
): (specifier: string) => DeclarationReference {
  const outputPath = getDeclarationOutputPath(filePath, config)

  return (specifier: string): DeclarationReference => {
    const resolved = resolveSpecifier(specifier, filePath)
    if (!resolved.isRelative || !resolved.resolved) {
      return { kind: 'unchanged', reason: resolved.isRelative ? 'unresolved' : 'external', specifier, emittedSpecifier: specifier }
    }

    if (/\.d\.(?:ts|mts|cts)$/.test(resolved.resolved)) {
      if (config.moduleSpecifierMode !== 'node') return { kind: 'unchanged', reason: 'preserved-declaration', specifier, emittedSpecifier: specifier }
      if (delivered && !delivered.has(resolved.resolved))
        throw new Error(`Local declaration ${JSON.stringify(specifier)} from ${filePath} targets an authored declaration not emitted by this package build: ${resolved.resolved}. Declaration-only dependencies must be delivered with the package before this importer can be emitted.`)
    }
    if (resolved.isAlias && delivered && !delivered.has(resolved.resolved))
      throw new Error(`Local alias ${JSON.stringify(specifier)} from ${filePath} targets a declaration excluded from this package build: ${resolved.resolved}`)

    const suffix = resolved.isAlias ? resolved.suffix ?? '' : specifier.match(/[?#].*$/)?.[0] ?? ''
    const pathSpecifier = suffix ? specifier.slice(0, -suffix.length) : specifier
    const writtenExtension = extname(pathSpecifier)
    let runtimeExtension = /^(?:\.js|\.jsx|\.mjs|\.cjs)$/.test(writtenExtension) ? writtenExtension : ''
    if (!runtimeExtension && config.moduleSpecifierMode === 'node') {
      const targetExtension = extname(resolved.resolved)
      runtimeExtension = targetExtension === '.mts' || targetExtension === '.mjs'
        ? '.mjs'
        : targetExtension === '.cts' || targetExtension === '.cjs' ? '.cjs' : '.js'
    }
    const declarationOutput = getDeclarationOutputPath(resolved.resolved, config)
    return {
      kind: 'local',
      specifier,
      resolvedSource: resolved.resolved,
      declarationOutput,
      emittedSpecifier: getDeclarationSpecifier(outputPath, declarationOutput, runtimeExtension) + suffix,
    }
  }
}
