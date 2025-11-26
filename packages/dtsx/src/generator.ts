import type { DtsError, DtsGenerationConfig, GenerationStats, ProcessingContext } from './types'
import { Glob } from 'bun'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { config as defaultConfig } from './config'
import { createDtsError, formatDtsError } from './errors'
import { extractDeclarations } from './extractor'
import { logger, setLogLevel } from './logger'
import { processDeclarations } from './processor'
import { addSourceMapComment, createDiff, generateDeclarationMap, validateDtsContent, writeToFile } from './utils'

/**
 * Generate DTS files from TypeScript source files
 */
export async function generate(options?: Partial<DtsGenerationConfig>): Promise<GenerationStats> {
  const startTime = Date.now()
  const config = { ...defaultConfig, ...options }

  // Configure logger based on options
  if (config.logLevel) {
    setLogLevel(config.logLevel)
  }
  else if (config.verbose) {
    setLogLevel('debug')
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

  // Log start
  logger.debug('Starting DTS generation...')
  logger.debug('Config:', config)

  // Find all TypeScript files based on entrypoints
  const files = await findFiles(config)

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
  }> => {
    let sourceCode: string | undefined
    try {
      const outputPath = getOutputPath(file, config)

      // Read source first for better error context
      sourceCode = await readFile(file, 'utf-8')
      const { content: dtsContent, declarationCount, importCount, exportCount } = await processFileWithStatsFromSource(file, sourceCode, config)

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

        // Write the DTS file
        await writeToFile(outputPath, finalDtsContent)

        // Validate if enabled
        if (config.validate) {
          const validation = validateDtsContent(dtsContent, outputPath)
          if (!validation.isValid) {
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

      return { success: true, file, declarationCount, importCount, exportCount }
    }
    catch (error) {
      const dtsError = createDtsError(error, file, sourceCode)
      return { success: false, file, declarationCount: 0, importCount: 0, exportCount: 0, dtsError }
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
          stats.filesGenerated++
          stats.declarationsFound += result.declarationCount
          stats.importsProcessed += result.importCount
          stats.exportsProcessed += result.exportCount
          if (config.validate) stats.filesValidated++
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
        stats.filesGenerated++
        stats.declarationsFound += result.declarationCount
        stats.importsProcessed += result.importCount
        stats.exportsProcessed += result.exportCount
        if (config.validate) stats.filesValidated++

        // Show progress
        if (config.progress) {
          const percent = Math.round((stats.filesProcessed / files.length) * 100)
          logger.info(`[${stats.filesProcessed}/${files.length}] ${percent}% - ${relative(config.cwd, file)}`)
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

  logger.debug('DTS generation complete!')

  return stats
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
    const glob = new Glob(pattern)
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
 */
export function processSource(
  sourceCode: string,
  filename: string = 'stdin.ts',
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
): string {
  // Extract declarations
  const declarations = extractDeclarations(sourceCode, filename, keepComments)

  // Create processing context
  const context: ProcessingContext = {
    filePath: filename,
    sourceCode,
    declarations,
    imports: new Map(),
    exports: new Set(),
    usedTypes: new Set(),
  }

  // Process declarations to generate DTS
  return processDeclarations(declarations, context, keepComments, importOrder)
}

/**
 * Process a single TypeScript file and return DTS with statistics
 */
async function processFileWithStats(
  filePath: string,
  config: DtsGenerationConfig,
): Promise<{ content: string, declarationCount: number, importCount: number, exportCount: number }> {
  // Read the source file
  const sourceCode = await readFile(filePath, 'utf-8')
  return processFileWithStatsFromSource(filePath, sourceCode, config)
}

/**
 * Process TypeScript source code and return DTS with statistics (for when source is already read)
 */
function processFileWithStatsFromSource(
  filePath: string,
  sourceCode: string,
  config: DtsGenerationConfig,
): { content: string, declarationCount: number, importCount: number, exportCount: number } {
  // Extract declarations
  const declarations = extractDeclarations(sourceCode, filePath, config.keepComments)

  // Count imports and exports
  const importCount = declarations.filter(d => d.kind === 'import').length
  const exportCount = declarations.filter(d => d.kind === 'export' || d.isExported).length

  // Create processing context
  const context: ProcessingContext = {
    filePath,
    sourceCode,
    declarations,
    imports: new Map(),
    exports: new Set(),
    usedTypes: new Set(),
  }

  // Process declarations to generate DTS
  const dtsContent = processDeclarations(declarations, context, config.keepComments, config.importOrder)

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
    if (state.isProcessing || state.pendingChanges.size === 0) return

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
        const file = Bun.file(filePath)
        if (!await file.exists()) {
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

  // Set up file watcher using Bun's watch API
  const watcher = Bun.spawn(['bun', '-e', `
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

  // Process watcher output
  const reader = watcher.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

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
