import type { DtsError, DtsGenerationConfig, GenerationStats, ProcessingContext } from './types'
import { Glob } from 'bun'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { bundleDeclarations } from './bundler'
import { BuildCache, ensureGitignore } from './cache'
import { file, isBun, spawnProcess } from './compat'
import { config as defaultConfig } from './config'
import { createDtsError, formatDtsError } from './errors'
import { extractDeclarations } from './extractor'
import { formatDts } from './formatter'
import { logger, setLogLevel } from './logger'
import { PluginManager } from './plugins'
import { processDeclarations } from './processor'
import { addSourceMapComment, createDiff, generateDeclarationMap, validateDtsContent, writeToFile } from './utils'

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

  // Initialize incremental build cache if enabled
  let buildCache: BuildCache | null = null
  if (config.incremental) {
    buildCache = new BuildCache(config)

    if (config.clearCache) {
      logger.debug('Clearing build cache...')
      buildCache.clear()
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
    ensureGitignore(config.cwd)
  }

  // Statistics tracking
  const stats: GenerationStats = {
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
  logger.debug('Config:', config)

  // Find all TypeScript files based on entrypoints
  const files = await findFiles(config)

  // Prune cache of deleted files
  if (buildCache) {
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

  // Helper function to process a single file
  const processSingleFile = async (file: string): Promise<{
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
      const outputPath = getOutputPath(file, config)

      // Check cache for incremental builds
      if (buildCache) {
        const cachedContent = buildCache.getCachedIfValid(file, config.cwd)
        if (cachedContent) {
          await mkdir(dirname(outputPath), { recursive: true })
          await writeToFile(outputPath, cachedContent)
          logger.debug(`[cached] ${relative(config.cwd, outputPath)}`)
          return { success: true, file, declarationCount: 0, importCount: 0, exportCount: 0, cached: true, validationErrorCount: 0 }
        }
      }

      // Read source first for better error context
      sourceCode = await readFile(file, 'utf-8')
      const { content: dtsContent, declarationCount, importCount, exportCount } = await processFileWithStatsFromSource(file, sourceCode, config, pluginManager)

      let validationErrorCount = 0

      if (config.dryRun) {
        // Dry run - just show what would be generated
        logger.info(`[dry-run] Would generate: ${outputPath}`)
        logger.debug('--- Content preview ---')
        logger.debug(dtsContent.slice(0, 500) + (dtsContent.length > 500 ? '\n...' : ''))
        logger.debug('--- End preview ---')
      }
      else {
        // Show diff if enabled
        if (config.diff) {
          try {
            const existingContent = await readFile(outputPath, 'utf-8')
            const diffOutput = createDiff(existingContent, dtsContent, relative(config.cwd, outputPath))
            if (diffOutput) {
              logger.info(`\n${diffOutput}`)
            }
            else {
              logger.debug(`[no changes] ${outputPath}`)
            }
          }
          catch {
            // File doesn't exist yet, show as new file
            logger.info(`[new file] ${relative(config.cwd, outputPath)}`)
          }
        }

        // Ensure output directory exists
        await mkdir(dirname(outputPath), { recursive: true })

        // Generate declaration map if enabled
        let finalDtsContent = dtsContent
        if (config.declarationMap && sourceCode) {
          const dtsFilename = outputPath.split('/').pop() || 'output.d.ts'
          const sourceFilename = relative(dirname(outputPath), file)
          const mapFilename = `${dtsFilename}.map`

          // Generate the source map
          const sourceMap = generateDeclarationMap(dtsContent, dtsFilename, sourceFilename, sourceCode)

          // Write the source map file
          const mapPath = `${outputPath}.map`
          await writeToFile(mapPath, JSON.stringify(sourceMap))

          // Add source map comment to the declaration file
          finalDtsContent = addSourceMapComment(dtsContent, mapFilename)

          logger.debug(`  Generated source map: ${relative(config.cwd, mapPath)}`)
        }

        // Apply formatting if enabled
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
          if (formatted.warnings?.length) {
            for (const warn of formatted.warnings) {
              logger.warn(`[format] ${warn}`)
            }
          }
        }

        // Write the DTS file
        await writeToFile(outputPath, finalDtsContent)

        // Update cache for incremental builds
        if (buildCache && sourceCode) {
          buildCache.update(file, sourceCode, finalDtsContent, config.cwd)
        }

        // Validate if enabled
        if (config.validate) {
          const validation = validateDtsContent(dtsContent, outputPath)
          if (!validation.isValid) {
            validationErrorCount = validation.errors.length
            logger.warn(`[validation] ${relative(config.cwd, outputPath)} has ${validation.errors.length} error(s):`)
            for (const err of validation.errors) {
              let errMsg = `  Line ${err.line}:${err.column}`
              if (err.code) {
                errMsg += ` [${err.code}]`
              }
              errMsg += ` - ${err.message}`
              logger.warn(errMsg)
              if (err.suggestion) {
                logger.warn(`    Suggestion: ${err.suggestion}`)
              }
            }
          }
          else {
            logger.debug(`[validation] ${outputPath} - OK`)
          }
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

  // Process files either in parallel or sequentially
  if (config.parallel) {
    // Parallel processing with concurrency limit
    const concurrency = config.concurrency || 4
    const results: Array<Awaited<ReturnType<typeof processSingleFile>>> = []

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch.map(processSingleFile))
      results.push(...batchResults)

      // Update stats and show progress after each batch
      for (const result of batchResults) {
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

      if (config.progress) {
        const percent = Math.round((stats.filesProcessed / files.length) * 100)
        logger.info(`[${stats.filesProcessed}/${files.length}] ${percent}%`)
      }
    }
  }
  else {
    // Sequential processing (original behavior)
    for (const file of files) {
      const result = await processSingleFile(file)

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

        // Show progress
        if (config.progress) {
          const percent = Math.round((stats.filesProcessed / files.length) * 100)
          const status = result.cached ? '[cached]' : ''
          logger.info(`[${stats.filesProcessed}/${files.length}] ${percent}% - ${relative(config.cwd, file)} ${status}`)
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
  }

  // Save incremental build cache
  if (buildCache) {
    buildCache.save()
    logger.debug('Saved build cache')
  }

  // Bundle output if enabled
  if (config.bundle && (stats.filesGenerated > 0 || cacheHits > 0)) {
    try {
      logger.debug('Bundling declarations...')

      // Read all source files
      const sourceContents = new Map<string, string>()
      for (const file of files) {
        const content = await readFile(file, 'utf-8')
        sourceContents.set(file, content)
      }

      // Bundle all declarations
      const bundleResult = await bundleDeclarations(files, sourceContents, config)

      // Write bundled output
      const bundleFilename = config.bundleOutput || 'index.d.ts'
      const bundlePath = resolve(config.cwd, config.outdir, bundleFilename)

      await mkdir(dirname(bundlePath), { recursive: true })
      await writeToFile(bundlePath, bundleResult.content)

      logger.info(`Bundled ${bundleResult.files.length} files to: ${relative(config.cwd, bundlePath)}`)
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Bundle failed: ${errorMessage}`)
    }
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
function isExcluded(filePath: string, excludePatterns: string[], rootPath: string): boolean {
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

/**
 * Find all TypeScript files matching the entrypoints patterns
 */
async function findFiles(config: DtsGenerationConfig): Promise<string[]> {
  const files: string[] = []
  const rootPath = resolve(config.cwd, config.root)
  const excludePatterns = config.exclude || []

  for (const pattern of config.entrypoints) {
    // Check if pattern is an absolute path to a specific file
    if (pattern.startsWith('/') && pattern.endsWith('.ts')) {
      // It's an absolute file path
      if (!pattern.endsWith('.d.ts') && !pattern.includes('node_modules')) {
        if (!isExcluded(pattern, excludePatterns, rootPath)) {
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
        if (!file.endsWith('.d.ts') && !file.includes('node_modules')) {
          if (!isExcluded(file, excludePatterns, rootPath)) {
            files.push(file)
          }
        }
      }
    }
  }

  // Remove duplicates
  return [...new Set(files)]
}

/**
 * Get the output path for a given input file
 */
function getOutputPath(inputPath: string, config: DtsGenerationConfig): string {
  const rootPath = resolve(config.cwd, config.root)
  const relativePath = relative(rootPath, inputPath)
  const dtsPath = relativePath.replace(/\.ts$/, '.d.ts')

  if (config.outputStructure === 'mirror') {
    // Mirror the source structure
    return resolve(config.cwd, config.outdir, dtsPath)
  }
  else {
    // Flat structure - just use the filename
    const filename = dtsPath.split('/').pop()!
    return resolve(config.cwd, config.outdir, filename)
  }
}

/**
 * Process a single TypeScript file and generate its DTS
 */
export async function processFile(
  filePath: string,
  config: DtsGenerationConfig,
): Promise<string> {
  const result = await processFileWithStats(filePath, config)
  return result.content
}

/**
 * Process TypeScript source code from a string (for stdin support)
 * Re-exported from process-source.ts for backward compatibility
 */
export { processSource } from './process-source'

/**
 * Process a single TypeScript file and return DTS with statistics
 */
async function processFileWithStats(
  filePath: string,
  config: DtsGenerationConfig,
  pluginManager?: PluginManager,
): Promise<{ content: string, declarationCount: number, importCount: number, exportCount: number }> {
  // Read the source file
  const sourceCode = await readFile(filePath, 'utf-8')
  return processFileWithStatsFromSource(filePath, sourceCode, config, pluginManager)
}

/**
 * Process TypeScript source code and return DTS with statistics (for when source is already read)
 */
async function processFileWithStatsFromSource(
  filePath: string,
  sourceCode: string,
  config: DtsGenerationConfig,
  pluginManager?: PluginManager,
): Promise<{ content: string, declarationCount: number, importCount: number, exportCount: number }> {
  // Run onBeforeFile hooks (may modify source)
  let processedSource = sourceCode
  if (pluginManager) {
    processedSource = await pluginManager.runOnBeforeFile(filePath, sourceCode)
  }

  // Extract declarations
  let declarations = extractDeclarations(processedSource, filePath, config.keepComments)

  // Run onDeclarations hooks (may modify declarations)
  if (pluginManager) {
    declarations = await pluginManager.runOnDeclarations(filePath, processedSource, declarations)
  }

  // Count imports and exports
  const importCount = declarations.filter(d => d.kind === 'import').length
  const exportCount = declarations.filter(d => d.kind === 'export' || d.isExported).length

  // Create processing context
  const context: ProcessingContext = {
    filePath,
    sourceCode: processedSource,
    declarations,
  }

  // Process declarations to generate DTS
  let dtsContent = processDeclarations(declarations, context, config.keepComments, config.importOrder)

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
        const outputPath = getOutputPath(filePath, config)
        const { content: dtsContent } = await processFileWithStats(filePath, config)

        await mkdir(dirname(outputPath), { recursive: true })
        await writeToFile(outputPath, dtsContent)

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
      if (filename && filename.endsWith('.ts') && !filename.endsWith('.d.ts')) {
        console.log('CHANGED:' + filename);
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
