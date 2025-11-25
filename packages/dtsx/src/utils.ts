import type { DtsGenerationConfig } from './types'
import { readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { config } from './config'

/**
 * Exhaustive check helper for switch statements
 * This function should never be called if all cases are handled
 * TypeScript will error if a case is missing
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message || `Unexpected value: ${value}`)
}

export async function writeToFile(filePath: string, content: string): Promise<void> {
  // Normalize line endings to LF and ensure trailing newline
  let normalized = content.replace(/\r\n/g, '\n')
  if (!normalized.endsWith('\n')) {
    normalized += '\n'
  }
  await Bun.write(filePath, normalized)
}

export async function getAllTypeScriptFiles(directory?: string): Promise<string[]> {
  const dir = directory ?? config.root
  const entries = await readdir(dir, { withFileTypes: true })

  const files = await Promise.all(entries.map((entry) => {
    const res = join(dir, entry.name)
    return entry.isDirectory() ? getAllTypeScriptFiles(res) : res
  }))

  return Array.prototype.concat(...files).filter(file => extname(file) === '.ts')
}

// only checks for 2 potentially nested levels
export async function checkIsolatedDeclarations(options?: DtsGenerationConfig): Promise<boolean> {
  try {
    const cwd = options?.cwd || process.cwd()
    const tsconfigPath = options?.tsconfigPath || join(cwd, 'tsconfig.json')

    // Convert to file URL for import()
    const baseConfigPath = pathToFileURL(tsconfigPath).href
    const baseConfig = await import(baseConfigPath)

    if (baseConfig.compilerOptions?.isolatedDeclarations === true) {
      return true
    }

    // If there's an extends property, we need to check the extended config
    if (baseConfig.extends) {
      // Make the extended path absolute relative to the base config
      const extendedPath = makeAbsolute(tsconfigPath, baseConfig.extends)
      // Add .json if not present
      const fullExtendedPath = extendedPath.endsWith('.json') ? extendedPath : `${extendedPath}.json`
      const extendedConfigPath = pathToFileURL(fullExtendedPath).href
      const extendedConfig = await import(extendedConfigPath)

      // Recursively check extended configs
      if (extendedConfig.compilerOptions?.isolatedDeclarations === true) {
        return true
      }

      // If the extended config also extends another config, check that too
      if (extendedConfig.extends) {
        // Make the next extended path absolute relative to the previous extended config
        const nextExtendedPath = makeAbsolute(fullExtendedPath, extendedConfig.extends)
        const fullNextExtendedPath = nextExtendedPath.endsWith('.json') ? nextExtendedPath : `${nextExtendedPath}.json`
        const extendedExtendedConfigPath = pathToFileURL(fullNextExtendedPath).href
        const extendedExtendedConfig = await import(extendedExtendedConfigPath)

        if (extendedExtendedConfig.compilerOptions?.isolatedDeclarations === true) {
          return true
        }
      }
    }

    return false
  }
  catch {
    return false
  }
}

/**
 * Validation result for a .d.ts file
 */
export interface ValidationResult {
  isValid: boolean
  errors: Array<{ line: number, column: number, message: string }>
}

/**
 * Validate a .d.ts file content against TypeScript compiler
 */
export function validateDtsContent(content: string, filename: string): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
  }

  // Create a source file from the content
  const sourceFile = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )

  // Create a minimal compiler host
  const compilerHost: ts.CompilerHost = {
    getSourceFile: (name) => {
      if (name === filename) return sourceFile
      return undefined
    },
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === filename,
    readFile: () => undefined,
  }

  // Create program with declaration-focused options
  const program = ts.createProgram({
    rootNames: [filename],
    options: {
      noEmit: true,
      declaration: true,
      skipLibCheck: true,
      noLib: true,
    },
    host: compilerHost,
  })

  // Get diagnostics
  const diagnostics = [
    ...program.getSyntacticDiagnostics(sourceFile),
  ]

  for (const diagnostic of diagnostics) {
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      result.errors.push({
        line: line + 1,
        column: character + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      })
    }
    else {
      result.errors.push({
        line: 0,
        column: 0,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      })
    }
  }

  result.isValid = result.errors.length === 0
  return result
}

/**
 * Simple line-by-line diff between two strings
 * Returns formatted diff output with +/- prefixes
 */
export function createDiff(oldContent: string, newContent: string, filename: string): string {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // Simple diff: find added and removed lines
  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  const removed = oldLines.filter(line => !newSet.has(line))
  const added = newLines.filter(line => !oldSet.has(line))

  if (removed.length === 0 && added.length === 0) {
    return '' // No changes
  }

  const output: string[] = []
  output.push(`--- ${filename}`)
  output.push(`+++ ${filename}`)

  for (const line of removed) {
    output.push(`- ${line}`)
  }
  for (const line of added) {
    output.push(`+ ${line}`)
  }

  return output.join('\n')
}

function makeAbsolute(basePath: string, configPath: string): string {
  // If it's already absolute, return as is
  if (isAbsolute(configPath)) {
    return configPath
  }

  // If it starts with a dot, resolve relative to base path
  if (configPath.startsWith('.')) {
    return resolve(dirname(basePath), configPath)
  }

  // For node_modules paths, resolve from cwd
  return resolve(process.cwd(), 'node_modules', configPath)
}
