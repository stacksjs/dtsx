import type { ModuleResolver } from './module-graph'
import type { TypeMapper } from './type-mappings'
import type { DtsError, DtsGenerationConfig, GenerationStats, ProcessingContext } from './types'
import { mkdir } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import { planAugmentationImports } from './augmentation-graph'
import { linkBundle } from './bundle-linker'
import { BuildCache, ensureGitignore } from './cache'
import { file, isBun, readTextFile, spawnProcess } from './compat'
import { normalizeConcurrency } from './concurrency'
import { config as defaultConfig } from './config'
import { createDeclarationReferenceResolver, getDeclarationOutputPath, isExcluded, planDeclarationProject } from './declaration-project'
import { assertSafeOutputConfiguration, publishDeclarationOutputs } from './declaration-publication'
import { createDtsError, formatDtsError } from './errors'
import { extractDeclarations } from './extractor'
import { formatDts } from './formatter'
import { monomorphicImportFunctions } from './inferred-imports'
import { logger, setLogLevel } from './logger'
import { collectReachableViaReExports, createModuleResolver, rewriteModuleSpecifiers, scanReExportSpecifiers } from './module-graph'
import { normalizeOutput as normalizeDtsOutput } from './output-normalizer'
import { PluginManager } from './plugins'
import { processDeclarations } from './processor'
import { applyTypeMappings, createTypeMapper } from './type-mappings'
import { addSourceMapComment, checkIsolatedDeclarationsConfig, createDiff, generateDeclarationMap, sourceMapCommentPrefix, validateDtsContent, writeToFile } from './utils'

const moduleResolvers = new WeakMap<DtsGenerationConfig, Promise<ModuleResolver>>()
const emittedSources = new WeakMap<DtsGenerationConfig, Set<string>>()

function getModuleResolver(config: DtsGenerationConfig): Promise<ModuleResolver> {
  let pending = moduleResolvers.get(config)
  if (!pending) {
    pending = createModuleResolver(config)
    moduleResolvers.set(config, pending)
    void pending.catch(() => moduleResolvers.delete(config))
  }
  return pending
}

async function writeDeclarationMapFile(
  outputPath: string,
  sourcePath: string,
  dtsContent: string,
  sourceCode: string,
  cwd: string,
  write: (path: string, content: string) => Promise<void> = writeToFile,
): Promise<string> {
  const dtsFilename = basename(outputPath) || 'output.d.ts'
  const sourceFilename = relative(dirname(outputPath), sourcePath)
  const mapFilename = `${dtsFilename}.map`
  const mapCommentIndex = dtsContent.lastIndexOf(`\n${sourceMapCommentPrefix()}`)
  const contentToMap = mapCommentIndex === -1 ? dtsContent : dtsContent.slice(0, mapCommentIndex)
  const sourceMap = generateDeclarationMap(contentToMap, dtsFilename, sourceFilename, sourceCode)
  const mapPath = `${outputPath}.map`

  await write(mapPath, JSON.stringify(sourceMap))
  logger.debug(`  Generated source map: ${relative(cwd, mapPath)}`)
  return mapFilename
}

/**
 * Generate DTS files from TypeScript source files
 */
export async function generate(options?: Partial<DtsGenerationConfig>): Promise<GenerationStats> {
  const startTime = Date.now()
  let config = { ...defaultConfig, ...options }

  // Configure logger based on options
  if (config.logLevel) {
    setLogLevel(config.logLevel)
  }
  else if (config.verbose) {
    setLogLevel('debug')
  }

  // Initialize plugin manager and register plugins
  const pluginManager = new PluginManager()
  if (config.plugins && config.plugins.length > 0) {
    for (const plugin of config.plugins) {
      pluginManager.register(plugin)
      logger.debug(`Registered plugin: ${plugin.name}`)
    }
    // Run onStart hooks (may modify config)
    config = await pluginManager.runOnStart(config)
  }

  if (config.moduleSpecifierMode !== undefined && config.moduleSpecifierMode !== 'preserve' && config.moduleSpecifierMode !== 'node') {
    throw new Error('moduleSpecifierMode must be preserve or node')
  }

  await assertSafeOutputConfiguration(config)

  if (config.isolatedDeclarations === undefined) {
    config.isolatedDeclarations = await checkIsolatedDeclarationsConfig(config)
  }
  const typeMapper = config.typeMappings ? createTypeMapper(config.typeMappings) : undefined

  // Initialize incremental build cache if enabled
  let buildCache: BuildCache | null = null

  // Statistics tracking
  const stats: GenerationStats = {
    generationMode: config.isolatedDeclarations ? 'isolated' : 'semantic',
    filesProcessed: 0,
    filesGenerated: 0,
    filesFailed: 0,
    filesValidated: 0,
    validationErrors: 0,
    declarationsFound: 0,
    importsProcessed: 0,
    exportsProcessed: 0,
    durationMs: 0,
    errors: [],
  }

  // Track cache hits for stats
  let cacheHits = 0

  // Log start
  logger.debug('Starting DTS generation...')
  logger.debug(`Using ${stats.generationMode} declaration generation path`)
  logger.debug('Config:', config)

  const project = await planDeclarationProject(config, () => getModuleResolver(config))
  const entryFiles = project.entryFiles
  const files = [...project.files]
  const resolveSpecifier = project.resolver
  const reExportReachability = project.reachability
  emittedSources.set(config, new Set(files))

  if (config.incremental) {
    buildCache = new BuildCache(config, project.getResolutionFingerprint())

    if (config.clearCache) {
      logger.debug('Clearing build cache...')
      if (!config.dryRun) buildCache.clear()
    }
    else {
      const loaded = buildCache.load()
      if (loaded) {
        const cacheStats = buildCache.getStats()
        logger.debug(`Loaded build cache with ${cacheStats.entries} entries`)
      }
      else {
        logger.debug('No existing build cache found, starting fresh')
      }
    }

    // Ensure .dtsx-cache is in .gitignore
    if (!config.dryRun) ensureGitignore(config.cwd)
  }

  // Prune cache of deleted files
  if (buildCache && !config.dryRun) {
    const pruned = buildCache.prune(new Set(files), config.cwd)
    if (pruned > 0) {
      logger.debug(`Pruned ${pruned} deleted files from cache`)
    }
  }

  logger.debug(`Found ${files.length} TypeScript files`)

  // Show initial progress if enabled
  if (config.progress && files.length > 0) {
    const mode = config.parallel ? 'parallel' : 'sequential'
    logger.info(`Processing ${files.length} files (${mode})...`)
  }

  // Declarations generated per file, kept for `bundle: true`, which links
  // them into one file per entrypoint.
  const generatedDts = new Map<string, string>()
  const pendingOutputs = new Map<string, { content: string, lineEnding: DtsGenerationConfig['lineEnding'] }>()
  const queueOutput = async (path: string, content: string, lineEnding: DtsGenerationConfig['lineEnding'] = 'lf'): Promise<void> => {
    pendingOutputs.set(path, { content, lineEnding })
  }

  // Helper function to process a single file
  // Accepts optional pre-read source to avoid redundant I/O when files are batch-read
  const processSingleFile = async (file: string, preReadSource?: string): Promise<{
    success: boolean
    file: string
    declarationCount: number
    importCount: number
    exportCount: number
    dtsError?: DtsError
    cached?: boolean
    validationErrorCount?: number
  }> => {
    let sourceCode: string | undefined
    try {
      const outputPath = getDeclarationOutputPath(file, config)

      const showDiff = async (content: string): Promise<void> => {
        if (!config.diff) return
        try {
          const existingContent = await readTextFile(outputPath)
          const diffOutput = createDiff(existingContent, content, relative(config.cwd, outputPath))
          if (diffOutput) logger.info(`\n${diffOutput}`)
          else logger.debug(`[no changes] ${outputPath}`)
        }
        catch {
          logger.info(`[new file] ${relative(config.cwd, outputPath)}`)
        }
      }

      const validateContent = (content: string): number => {
        if (!config.validate) return 0
        const validation = validateDtsContent(content, outputPath)
        if (validation.isValid) {
          logger.debug(`[validation] ${outputPath} - OK`)
          return 0
        }

        logger.warn(`[validation] ${relative(config.cwd, outputPath)} has ${validation.errors.length} error(s):`)
        for (const err of validation.errors) {
          let errMsg = `  Line ${err.line}:${err.column}`
          if (err.code) errMsg += ` [${err.code}]`
          errMsg += ` - ${err.message}`
          logger.warn(errMsg)
          if (err.suggestion) logger.warn(`    Suggestion: ${err.suggestion}`)
        }
        return validation.errors.length
      }

      const previewDryRun = (content: string): void => {
        logger.info(`[dry-run] Would generate: ${outputPath}`)
        logger.debug('--- Content preview ---')
        logger.debug(content.slice(0, 500) + (content.length > 500 ? '\n...' : ''))
        logger.debug('--- End preview ---')
      }

      // Check cache for incremental builds
      if (buildCache) {
        const cachedContent = buildCache.getCachedIfValid(file, config.cwd)
        if (cachedContent) {
          if (config.bundle) generatedDts.set(file, cachedContent)
          await showDiff(cachedContent)
          const validationErrorCount = validateContent(cachedContent)

          if (config.dryRun) {
            previewDryRun(cachedContent)
          }
          else {
            if (config.declarationMap) {
              sourceCode = preReadSource ?? await readTextFile(file)
              await writeDeclarationMapFile(outputPath, file, cachedContent, sourceCode, config.cwd, queueOutput)
            }
            await queueOutput(outputPath, cachedContent, config.lineEnding)
          }
          logger.debug(`[cached] ${relative(config.cwd, outputPath)}`)
          return { success: true, file, declarationCount: 0, importCount: 0, exportCount: 0, cached: true, validationErrorCount }
        }
      }

      // Use pre-read source if available, otherwise read from disk
      sourceCode = preReadSource ?? await readTextFile(file)
      const { content: dtsContent, declarationCount, importCount, exportCount } = await processFileWithStatsFromSource(file, sourceCode, config, pluginManager, typeMapper, project.augmentationImports.get(file))
      if (config.bundle) generatedDts.set(file, dtsContent)

      let finalDtsContent = dtsContent

      // Formatting must happen before source-map generation so mappings describe
      // the bytes that are actually written.
      if (config.prettier || config.indentStyle || config.indentSize) {
        const formatted = await formatDts(finalDtsContent, {
          usePrettier: config.prettier,
          builtIn: {
            indentSize: config.indentSize || 2,
            useTabs: config.indentStyle === 'tabs',
            normalizeWhitespace: true,
            sortImports: true,
            trailingNewline: true,
          },
        }, outputPath)
        finalDtsContent = formatted.content
        for (const warning of formatted.warnings ?? []) logger.warn(`[format] ${warning}`)
      }

      if (config.declarationMap) {
        const mapFilename = `${basename(outputPath) || 'output.d.ts'}.map`
        finalDtsContent = addSourceMapComment(finalDtsContent, mapFilename)
      }

      await showDiff(finalDtsContent)
      const validationErrorCount = validateContent(finalDtsContent)

      if (config.dryRun) {
        previewDryRun(finalDtsContent)
      }
      else {
        if (config.declarationMap && sourceCode) {
          await writeDeclarationMapFile(outputPath, file, finalDtsContent, sourceCode, config.cwd, queueOutput)
        }

        await queueOutput(outputPath, finalDtsContent, config.lineEnding)

        // Update cache for incremental builds
        if (buildCache && sourceCode) {
          buildCache.update(file, sourceCode, finalDtsContent, config.cwd)
        }

        logger.debug(`Generated: ${outputPath}`)
      }

      return { success: true, file, declarationCount, importCount, exportCount, validationErrorCount }
    }
    catch (error) {
      const dtsError = createDtsError(error, file, sourceCode)
      // Run onError hooks
      if (config.plugins && config.plugins.length > 0) {
        await pluginManager.runOnError(error instanceof Error ? error : new Error(String(error)), file, sourceCode || '')
      }
      return { success: false, file, declarationCount: 0, importCount: 0, exportCount: 0, dtsError, validationErrorCount: 0 }
    }
  }

  // Auto-enable parallel processing for multiple files (unless explicitly set to false)
  const useParallel = config.parallel || (config.parallel !== false && files.length >= 10)
  const concurrency = normalizeConcurrency(config.concurrency, availableParallelism?.() ?? 8)

  // Pre-read all file sources in parallel for faster I/O
  // This allows overlapping disk reads instead of sequential read-process-write
  const preReadSources = new Map<string, string>()
  if (useParallel && files.length > 1) {
    const readPromises = files.map(async (f) => {
      try {
        const src = await readTextFile(f)
        return { file: f, source: src }
      }
      catch {
        return { file: f, source: null }
      }
    })
    for (const result of await Promise.all(readPromises)) {
      if (result.source !== null) preReadSources.set(result.file, result.source)
    }
  }

  // Helper to update stats from a result
  const updateStats = (result: Awaited<ReturnType<typeof processSingleFile>>) => {
    stats.filesProcessed++
    if (result.success) {
      if (result.cached) {
        cacheHits++
      }
      else {
        stats.filesGenerated++
        stats.declarationsFound += result.declarationCount
        stats.importsProcessed += result.importCount
        stats.exportsProcessed += result.exportCount
      }
      if (config.validate) {
        stats.filesValidated++
        if (result.validationErrorCount) {
          stats.validationErrors += result.validationErrorCount
        }
      }
    }
    else {
      stats.filesFailed++
      if (result.dtsError) {
        stats.errors.push(result.dtsError)
        const errorMsg = formatDtsError(result.dtsError)
        if (config.continueOnError) {
          logger.warn(errorMsg)
        }
        else {
          logger.error(errorMsg)
          throw new Error(result.dtsError.message)
        }
      }
    }
  }

  // Process files either in parallel or sequentially
  if (useParallel) {
    // Parallel processing with concurrency limit
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      const batchResults = await Promise.all(
        batch.map(f => processSingleFile(f, preReadSources.get(f))),
      )

      for (const result of batchResults) {
        updateStats(result)
      }

      if (config.progress) {
        const percent = Math.round((stats.filesProcessed / files.length) * 100)
        logger.info(`[${stats.filesProcessed}/${files.length}] ${percent}%`)
      }
    }
  }
  else {
    // Sequential processing (single file or explicitly disabled)
    for (const file of files) {
      const result = await processSingleFile(file)
      updateStats(result)

      // Show progress
      if (config.progress) {
        const percent = Math.round((stats.filesProcessed / files.length) * 100)
        const status = result.cached ? '[cached]' : ''
        logger.info(`[${stats.filesProcessed}/${files.length}] ${percent}% - ${relative(config.cwd, file)} ${status}`)
      }
    }
  }

  // Warn about re-exports that point at siblings dtsx didn't emit.
  // Two cases produce broken consumer types:
  //   1. The relative path doesn't exist on disk at all.
  //   2. The path exists, but auto-include was disabled and the user's
  //      entrypoint config didn't pull it into the build.
  // We skip this entirely for `bundle: true`, where re-exports get inlined.
  if (!config.bundle) {
    const broken: Array<{ from: string, specifier: string, reason: 'missing' | 'not-emitted' }> = []

    if (reExportReachability) {
      for (const u of reExportReachability.unresolved) {
        broken.push({ from: u.from, specifier: u.specifier, reason: 'missing' })
      }
    }

    if (config.autoIncludeReExports === false && files.length > 0) {
      const fileSet = new Set(files)
      for (const f of files) {
        let src: string
        try { src = await readTextFile(f) }
        catch { continue }
        for (const ref of scanReExportSpecifiers(src)) {
          const r = resolveSpecifier(ref.specifier, f)
          if (!r.isRelative) continue
          if (!r.resolved) {
            broken.push({ from: f, specifier: ref.specifier, reason: 'missing' })
          }
          else if (!/\.d\.(?:ts|mts|cts)$/.test(r.resolved) && !fileSet.has(r.resolved)) {
            broken.push({ from: f, specifier: ref.specifier, reason: 'not-emitted' })
          }
        }
      }
    }

    if (broken.length > 0) {
      const lines: string[] = []
      lines.push(`Found ${broken.length} re-export(s) pointing at siblings that won't be in the output:`)
      for (const b of broken) {
        const rel = relative(config.cwd, b.from)
        if (b.reason === 'missing') {
          lines.push(`  ${rel} → '${b.specifier}' (path not found on disk)`)
        }
        else {
          lines.push(`  ${rel} → '${b.specifier}' (resolved but not in entrypoints; set autoIncludeReExports: true or add to entrypoints)`)
        }
      }
      const message = lines.join('\n')
      if (config.failOnUnresolvedReExport) {
        throw new Error(message)
      }
      logger.warn(message)
      logger.warn('Generated .d.ts files reference modules that were not emitted — consumers will see "has no exported member" errors.')
    }
  }

  // Bundle output if enabled.
  //
  // Each user-declared entrypoint becomes one self-contained `.d.ts`: we
  // walk imports + re-exports from that entry and link the declarations
  // already generated for the reachable files. Relative imports and
  // re-exports are resolved rather than dropped, so renamed, default and
  // namespace re-exports survive (#3090).
  if (config.bundle && (stats.filesGenerated > 0 || cacheHits > 0) && entryFiles.length > 0) {
    try {
      logger.debug('Bundling declarations...')

      // Single-entry + explicit bundleOutput keeps the legacy semantic
      // (one combined file at outdir/<bundleOutput>).
      const useLegacyOutput = entryFiles.length === 1 && !!config.bundleOutput

      for (const entry of entryFiles) {
        // Reachable file set for this entry: follow re-exports AND imports.
        // Imports matter for bundling because exported declarations may
        // reference imported types.
        const reachability = await collectReachableViaReExports([entry], { includeImports: true, resolveSpecifier })
        const reachable = new Set<string>()
        for (const r of reachability.reachable) {
          if (r.endsWith('.d.ts')) continue
          if (r.includes('node_modules')) continue
          reachable.add(r)
        }
        // Constrain to files we're actually processing — anything else
        // would be unreachable from the project's source tree.
        const filesForEntry = files.filter(f => reachable.has(f))
        if (!filesForEntry.includes(entry)) filesForEntry.push(entry)

        const bundleResult = linkBundle(entry, filesForEntry, generatedDts, { cwd: config.cwd, keepComments: config.keepComments })
        for (const warning of new Set(bundleResult.warnings)) logger.warn(`[bundle] ${warning}`)

        const bundlePath = useLegacyOutput
          ? resolve(config.cwd, config.outdir, config.bundleOutput!)
          : getDeclarationOutputPath(entry, config)

        if (config.dryRun) {
          logger.info(`[dry-run] Would bundle ${bundleResult.files.length} files to: ${relative(config.cwd, bundlePath)}`)
        }
        else {
          await queueOutput(bundlePath, bundleResult.content, config.lineEnding)
          logger.debug(`Prepared ${bundleResult.files.length} bundled files for: ${relative(config.cwd, bundlePath)}`)
        }

        if (useLegacyOutput) break
      }
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Bundle failed: ${errorMessage}`)
      throw error
    }
  }

  // Prepare linked bundle bytes too before the sole publication commit. A
  // bundle preparation or destination failure must preserve every prior output.
  if (!config.dryRun) {
    await publishDeclarationOutputs(config, pendingOutputs)
  }

  // Cache entries describe a successfully published project, including bundles.
  if (buildCache && !config.dryRun) {
    buildCache.save()
    logger.debug('Saved build cache')
  }

  stats.durationMs = Date.now() - startTime

  // Show stats if enabled
  if (config.stats) {
    if (config.outputFormat === 'json') {
      // JSON output for machine consumption
      console.log(JSON.stringify(stats, null, 2))
    }
    else {
      // Human-readable output
      logger.info('\n--- Generation Statistics ---')
      logger.info(`Files processed:     ${stats.filesProcessed}`)
      logger.info(`Files generated:     ${stats.filesGenerated}`)
      if (cacheHits > 0) {
        logger.info(`Files cached:        ${cacheHits}`)
      }
      if (stats.filesFailed > 0) {
        logger.info(`Files failed:        ${stats.filesFailed}`)
      }
      logger.info(`Declarations found:  ${stats.declarationsFound}`)
      logger.info(`Imports processed:   ${stats.importsProcessed}`)
      logger.info(`Exports processed:   ${stats.exportsProcessed}`)
      if (stats.filesValidated > 0) {
        logger.info(`Files validated:     ${stats.filesValidated}`)
        if (stats.validationErrors > 0) {
          logger.info(`Validation errors:   ${stats.validationErrors}`)
        }
      }
      logger.info(`Duration:            ${stats.durationMs}ms`)
      if (stats.errors.length > 0) {
        logger.info('\nErrors:')
        for (const err of stats.errors) {
          let errLine = `  - ${err.file}`
          if (err.location) {
            errLine += `:${err.location.line}:${err.location.column}`
          }
          if (err.code) {
            errLine += ` [${err.code}]`
          }
          errLine += `: ${err.message}`
          logger.info(errLine)
          if (err.suggestion) {
            logger.info(`    Suggestion: ${err.suggestion}`)
          }
        }
      }
      logger.info('-----------------------------\n')
    }
  }

  // Run onEnd hooks
  if (config.plugins && config.plugins.length > 0) {
    await pluginManager.runOnEnd(stats)
  }

  logger.debug('DTS generation complete!')

  return stats
}

async function rewriteRelativeDeclarationSpecifiers(content: string, filePath: string, config: DtsGenerationConfig): Promise<string> {
  const resolveSpecifier = await getModuleResolver(config)
  const resolveReference = createDeclarationReferenceResolver(filePath, config, resolveSpecifier, emittedSources.get(config))

  return rewriteModuleSpecifiers(content, specifier => resolveReference(specifier).emittedSpecifier)
}

/**
 * Process a single TypeScript file and generate its DTS
 */
export async function processFile(
  filePath: string,
  config: DtsGenerationConfig,
): Promise<string> {
  // A standalone call is a new generation boundary, even if the caller reuses
  // its options object after editing the tsconfig or package metadata.
  moduleResolvers.delete(config)
  emittedSources.delete(config)
  const resolver = await getModuleResolver(config)
  const reachability = await collectReachableViaReExports([filePath], { includeImports: true, resolveSpecifier: resolver })
  const augmentationImports = await planAugmentationImports([...reachability.sources.keys()], resolver, config.isolatedDeclarations ?? false, reachability.sources)
  const result = await processFileWithStats(filePath, config, undefined, augmentationImports.get(resolve(filePath)))
  return result.content
}

/**
 * Process TypeScript source code from a string (for stdin support)
 * Re-exported from process-source.ts for backward compatibility
 */
export { clearResultCache, processSource, processSourceIsolated, processSourceSemantic } from './process-source'

/**
 * Process a single TypeScript file and return DTS with statistics
 */
async function processFileWithStats(
  filePath: string,
  config: DtsGenerationConfig,
  pluginManager?: PluginManager,
  augmentationImports?: ReadonlySet<string>,
): Promise<{ content: string, declarationCount: number, importCount: number, exportCount: number }> {
  // Read the source file
  const sourceCode = await readTextFile(filePath)
  const typeMapper = config.typeMappings ? createTypeMapper(config.typeMappings) : undefined
  return processFileWithStatsFromSource(filePath, sourceCode, config, pluginManager, typeMapper, augmentationImports)
}

/**
 * Process TypeScript source code and return DTS with statistics (for when source is already read)
 */
async function processFileWithStatsFromSource(
  filePath: string,
  sourceCode: string,
  config: DtsGenerationConfig,
  pluginManager?: PluginManager,
  typeMapper?: TypeMapper,
  augmentationImports?: ReadonlySet<string>,
): Promise<{ content: string, declarationCount: number, importCount: number, exportCount: number }> {
  // Run onBeforeFile hooks (may modify source)
  let processedSource = sourceCode
  if (pluginManager) {
    processedSource = await pluginManager.runOnBeforeFile(filePath, sourceCode)
  }

  // Extract declarations
  const inferenceSources = new Map<string, string>()
  if (!config.isolatedDeclarations) {
    const resolver = await getModuleResolver(config)
    for (const reference of scanReExportSpecifiers(processedSource, { includeImports: true })) {
      const resolved = resolver(reference.specifier, filePath).resolved
      if (resolved && !resolved.split(/[/\\]/).includes('node_modules')) inferenceSources.set(reference.specifier, await readTextFile(resolved))
    }
  }
  const importedFunctions = inferenceSources.size ? monomorphicImportFunctions(processedSource, inferenceSources) : undefined
  let declarations = extractDeclarations(processedSource, filePath, config.keepComments, config.isolatedDeclarations ?? false, importedFunctions)

  // Run onDeclarations hooks (may modify declarations)
  if (pluginManager) {
    declarations = await pluginManager.runOnDeclarations(filePath, processedSource, declarations)
  }

  // Count imports and exports (single pass, no temporary arrays)
  let importCount = 0
  let exportCount = 0
  for (let i = 0; i < declarations.length; i++) {
    const d = declarations[i]
    if (d.kind === 'import') importCount++
    if (d.kind === 'export' || d.isExported) exportCount++
  }

  // Create processing context
  const context: ProcessingContext = {
    filePath,
    sourceCode: processedSource,
    declarations,
    augmentationImports,
  }

  // Process declarations to generate DTS
  let dtsContent = processDeclarations(declarations, context, config.keepComments, config.importOrder)
  dtsContent = await rewriteRelativeDeclarationSpecifiers(dtsContent, filePath, config)

  if (typeMapper) {
    dtsContent = applyTypeMappings(dtsContent, typeMapper, { filePath })
  }
  if (config.normalizeOutput === true || config.declarationOrder) {
    dtsContent = normalizeDtsOutput(dtsContent, {
      lineEnding: 'lf',
      declarationOrder: config.declarationOrder,
      indent: {
        style: config.indentStyle ?? 'spaces',
        size: config.indentSize ?? 2,
      },
    })
  }

  // Run onAfterFile hooks (may modify output)
  if (pluginManager) {
    dtsContent = await pluginManager.runOnAfterFile(filePath, processedSource, dtsContent)
  }

  return {
    content: dtsContent,
    declarationCount: declarations.length,
    importCount,
    exportCount,
  }
}

/**
 * Watch mode configuration
 */
interface WatchState {
  pendingChanges: Set<string>
  debounceTimer: ReturnType<typeof setTimeout> | null
  isProcessing: boolean
  errorCount: number
  lastErrorTime: number
}

/**
 * Watch mode - regenerate DTS files on source changes
 */
export async function watch(options?: Partial<DtsGenerationConfig>): Promise<void> {
  const config = { ...defaultConfig, ...options }

  // Configure logger
  if (config.logLevel) {
    setLogLevel(config.logLevel)
  }

  const rootPath = resolve(config.cwd, config.root)
  const debounceMs = 150 // Slightly longer debounce for batching multiple saves
  const maxErrorsBeforePause = 5
  const errorCooldownMs = 10000

  // Watch state for better change batching and error recovery
  const state: WatchState = {
    pendingChanges: new Set(),
    debounceTimer: null,
    isProcessing: false,
    errorCount: 0,
    lastErrorTime: 0,
  }

  logger.info(`Watching for changes in ${rootPath}...`)
  logger.info('Press Ctrl+C to stop\n')

  // Initial generation
  try {
    await generate(config)
    logger.info('[watch] Initial generation complete\n')
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`[watch] Initial generation failed: ${errorMessage}`)
    logger.info('[watch] Continuing to watch for changes...\n')
  }

  // Process batched changes
  async function processPendingChanges() {
    if (state.isProcessing || state.pendingChanges.size === 0)
      return

    // Check if we should pause due to too many errors
    const now = Date.now()
    if (state.errorCount >= maxErrorsBeforePause) {
      if (now - state.lastErrorTime < errorCooldownMs) {
        logger.warn(`[watch] Too many errors, pausing for ${Math.ceil((errorCooldownMs - (now - state.lastErrorTime)) / 1000)}s...`)
        return
      }
      // Reset error count after cooldown
      state.errorCount = 0
    }

    state.isProcessing = true
    const filesToProcess = Array.from(state.pendingChanges)
    state.pendingChanges.clear()

    const timestamp = new Date().toLocaleTimeString()

    if (filesToProcess.length === 1) {
      logger.info(`\n[${timestamp}] File changed: ${filesToProcess[0]}`)
    }
    else {
      logger.info(`\n[${timestamp}] ${filesToProcess.length} files changed`)
    }

    let successCount = 0
    let errorCount = 0

    for (const filename of filesToProcess) {
      const filePath = resolve(rootPath, filename)

      try {
        // Check if file should be processed
        const excludePatterns = config.exclude || []
        if (isExcluded(filePath, excludePatterns, rootPath)) {
          logger.debug(`  Skipping excluded file: ${filename}`)
          continue
        }

        // Check if file still exists (might have been deleted)
        const fileHandle = file(filePath)
        if (!await fileHandle.exists()) {
          logger.debug(`  Skipping deleted file: ${filename}`)
          continue
        }

        // Process just this file
        const outputPath = getDeclarationOutputPath(filePath, config)
        const { content: dtsContent } = await processFileWithStats(filePath, config)

        await mkdir(dirname(outputPath), { recursive: true })
        await writeToFile(outputPath, dtsContent, config.lineEnding)

        logger.info(`  ✓ ${relative(config.cwd, outputPath)}`)
        successCount++
      }
      catch (error) {
        errorCount++
        state.errorCount++
        state.lastErrorTime = Date.now()

        const dtsError = createDtsError(error, filePath)
        logger.error(`  ✗ ${filename}: ${dtsError.message}`)
        if (dtsError.suggestion) {
          logger.error(`    Suggestion: ${dtsError.suggestion}`)
        }
      }
    }

    if (filesToProcess.length > 1) {
      logger.info(`  Done: ${successCount} generated, ${errorCount} failed`)
    }

    // Reset error count on success
    if (errorCount === 0) {
      state.errorCount = 0
    }

    state.isProcessing = false

    // Process any changes that came in while we were processing
    if (state.pendingChanges.size > 0) {
      state.debounceTimer = setTimeout(processPendingChanges, debounceMs)
    }
  }

  // Queue a file change with debouncing
  function queueChange(filename: string) {
    state.pendingChanges.add(filename)

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
    }

    state.debounceTimer = setTimeout(processPendingChanges, debounceMs)
  }

  // Set up file watcher using cross-runtime spawn
  const runtime = isBun ? 'bun' : 'node'
  const watcher = spawnProcess([runtime, '-e', `
    const fs = require('fs');

    const rootPath = '${rootPath}';

    fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
      if (filename && /\.(?:[cm]?[jt]sx?|vue|stx)$/.test(filename) && !/\.d\.(?:ts|mts|cts)$/.test(filename)) {
        console.log(\`CHANGED:\${filename}\`);
      }
    });

    // Keep process alive
    setInterval(() => {}, 1000);
  `], {
  stdout: 'pipe',
  stderr: 'inherit',
})

// Process watcher output - handle both Bun (ReadableStream) and Node (Readable) streams
if (isBun) {
  // Bun uses ReadableStream with getReader()
  const reader = (watcher.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('CHANGED:')) {
        const filename = line.slice(8)
        queueChange(filename)
      }
    }
  }
}
else {
  // Node.js uses Readable stream with 'data' events
  const stdout = watcher.stdout as NodeJS.ReadableStream
  let buffer = ''

  stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('CHANGED:')) {
        const filename = line.slice(8)
        queueChange(filename)
      }
    }
  })

  // Keep the async function running until process exits
  await watcher.exited
}
}
