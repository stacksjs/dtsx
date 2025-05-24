/* eslint-disable no-console */

import type { DtsGenerationConfig, ProcessingContext } from './types'
import { Glob } from 'bun'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { config as defaultConfig } from './config'
import { extractDeclarations } from './extractor'
import { processDeclarations } from './processor'
import { writeToFile } from './utils'

/**
 * Generate DTS files from TypeScript source files
 */
export async function generate(options?: Partial<DtsGenerationConfig>): Promise<void> {
  const config = { ...defaultConfig, ...options }

  // Log start if verbose
  if (config.verbose) {
    console.log('Starting DTS generation...')
    console.log('Config:', config)
  }

  // Find all TypeScript files based on entrypoints
  const files = await findFiles(config)

  if (config.verbose) {
    console.log(`Found ${files.length} TypeScript files`)
  }

  // Process each file
  for (const file of files) {
    try {
      const outputPath = getOutputPath(file, config)
      const dtsContent = await processFile(file, config)

      // Ensure output directory exists
      await mkdir(dirname(outputPath), { recursive: true })

      // Write the DTS file
      await writeToFile(outputPath, dtsContent)

      if (config.verbose) {
        console.log(`Generated: ${outputPath}`)
      }
    }
    catch (error) {
      console.error(`Error processing ${file}:`, error)
      throw error
    }
  }

  if (config.verbose) {
    console.log('DTS generation complete!')
  }
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
  // Read the source file
  const sourceCode = await readFile(filePath, 'utf-8')

  // Extract declarations
  const declarations = extractDeclarations(sourceCode, filePath)

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
  const dtsContent = processDeclarations(declarations, context)

  return dtsContent
}
