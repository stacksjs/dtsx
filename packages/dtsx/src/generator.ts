import type { DtsGenerationConfig, GenerationStats, ProcessingContext } from './types'
import { Glob } from 'bun'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { config as defaultConfig } from './config'
import { extractDeclarations } from './extractor'
import { logger, setLogLevel } from './logger'
import { processDeclarations } from './processor'
import { writeToFile } from './utils'

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

  // Process each file
  for (const file of files) {
    try {
      const outputPath = getOutputPath(file, config)
      const { content: dtsContent, declarationCount, importCount, exportCount } = await processFileWithStats(file, config)

      stats.filesProcessed++
      stats.declarationsFound += declarationCount
      stats.importsProcessed += importCount
      stats.exportsProcessed += exportCount

      if (config.dryRun) {
        // Dry run - just show what would be generated
        logger.info(`[dry-run] Would generate: ${outputPath}`)
        logger.debug('--- Content preview ---')
        logger.debug(dtsContent.slice(0, 500) + (dtsContent.length > 500 ? '\n...' : ''))
        logger.debug('--- End preview ---')
      }
      else {
        // Ensure output directory exists
        await mkdir(dirname(outputPath), { recursive: true })

        // Write the DTS file
        await writeToFile(outputPath, dtsContent)
        stats.filesGenerated++

        logger.debug(`Generated: ${outputPath}`)
      }
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      stats.filesFailed++
      stats.errors.push({ file, error: errorMessage })

      if (config.continueOnError) {
        logger.warn(`Error processing ${file}: ${errorMessage}`)
      }
      else {
        logger.error(`Error processing ${file}:`, error)
        throw error
      }
    }
  }

  stats.durationMs = Date.now() - startTime

  // Show stats if enabled
  if (config.stats) {
    logger.info('\n--- Generation Statistics ---')
    logger.info(`Files processed:     ${stats.filesProcessed}`)
    logger.info(`Files generated:     ${stats.filesGenerated}`)
    if (stats.filesFailed > 0) {
      logger.info(`Files failed:        ${stats.filesFailed}`)
    }
    logger.info(`Declarations found:  ${stats.declarationsFound}`)
    logger.info(`Imports processed:   ${stats.importsProcessed}`)
    logger.info(`Exports processed:   ${stats.exportsProcessed}`)
    logger.info(`Duration:            ${stats.durationMs}ms`)
    if (stats.errors.length > 0) {
      logger.info('\nErrors:')
      for (const { file, error } of stats.errors) {
        logger.info(`  - ${file}: ${error}`)
      }
    }
    logger.info('-----------------------------\n')
  }

  logger.debug('DTS generation complete!')

  return stats
}

/**
 * Find all TypeScript files matching the entrypoints patterns
 */
async function findFiles(config: DtsGenerationConfig): Promise<string[]> {
  const files: string[] = []
  const rootPath = resolve(config.cwd, config.root)

  for (const pattern of config.entrypoints) {
    // Check if pattern is an absolute path to a specific file
    if (pattern.startsWith('/') && pattern.endsWith('.ts')) {
      // It's an absolute file path
      if (!pattern.endsWith('.d.ts') && !pattern.includes('node_modules')) {
        files.push(pattern)
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
        // Skip .d.ts files and node_modules
        if (!file.endsWith('.d.ts') && !file.includes('node_modules')) {
          files.push(file)
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
 * Process a single TypeScript file and return DTS with statistics
 */
async function processFileWithStats(
  filePath: string,
  config: DtsGenerationConfig,
): Promise<{ content: string, declarationCount: number, importCount: number, exportCount: number }> {
  // Read the source file
  const sourceCode = await readFile(filePath, 'utf-8')

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
