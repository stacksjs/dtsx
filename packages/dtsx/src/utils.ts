import type { DtsGenerationConfig } from './types'
import { readdir } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { write } from './compat'
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
  await write(filePath, normalized)
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
 * Validation error details
 */
export interface ValidationError {
  line: number
  column: number
  message: string
  code?: string
  suggestion?: string
}

/**
 * Validation result for a .d.ts file
 */
export interface ValidationResult {
  isValid: boolean
  errors: ValidationError[]
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
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    const code = `TS${diagnostic.code}`

    // Generate suggestions based on common error codes
    let suggestion: string | undefined
    switch (diagnostic.code) {
      case 1005: // ';' expected
        suggestion = 'Add a semicolon at the end of the statement.'
        break
      case 1109: // Expression expected
        suggestion = 'Check for missing or malformed expressions.'
        break
      case 1128: // Declaration or statement expected
        suggestion = 'Ensure proper declaration syntax is used.'
        break
      case 2304: // Cannot find name
        suggestion = 'Import or declare the missing type/value.'
        break
      case 2307: // Cannot find module
        suggestion = 'Check that the module exists and is installed.'
        break
      case 2322: // Type is not assignable
        suggestion = 'Check type compatibility between the values.'
        break
      case 2339: // Property does not exist
        suggestion = 'Add the missing property to the type definition.'
        break
      case 2345: // Argument type not assignable
        suggestion = 'Check the argument types match the expected parameters.'
        break
    }

    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      result.errors.push({
        line: line + 1,
        column: character + 1,
        message,
        code,
        suggestion,
      })
    }
    else {
      result.errors.push({
        line: 0,
        column: 0,
        message,
        code,
        suggestion,
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

/**
 * Source map for declaration files
 */
export interface DeclarationSourceMap {
  version: 3
  file: string
  sourceRoot: string
  sources: string[]
  sourcesContent: string[]
  mappings: string
}

/**
 * Generate a simple source map for a declaration file
 * This creates a basic 1:1 mapping since we're doing declaration extraction
 */
export function generateDeclarationMap(
  dtsContent: string,
  dtsFilename: string,
  sourceFilename: string,
  sourceContent: string,
): DeclarationSourceMap {
  // Generate simple line-to-line mappings
  // Each line in the output maps to a source position
  const dtsLines = dtsContent.split('\n')
  const mappings: string[] = []

  // VLQ encoding helpers
  function toVLQ(num: number): string {
    const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    let encoded = ''
    let value = num < 0 ? ((-num) << 1) | 1 : num << 1

    do {
      let digit = value & 0x1F
      value >>>= 5
      if (value > 0) {
        digit |= 0x20
      }
      encoded += VLQ_CHARS[digit]
    } while (value > 0)

    return encoded
  }

  // Track state for relative encoding
  let prevGeneratedCol = 0
  let prevSourceLine = 0
  let prevSourceCol = 0

  for (let i = 0; i < dtsLines.length; i++) {
    const line = dtsLines[i]

    if (line.trim() === '') {
      mappings.push('')
      continue
    }

    // Reset column for new line
    prevGeneratedCol = 0

    // Map to corresponding source line (simple 1:1 for declarations)
    // In a more sophisticated implementation, we'd track actual source positions
    const sourceLine = Math.min(i, sourceContent.split('\n').length - 1)

    const segments: string[] = []

    // Generate segment: [generatedCol, sourceIndex, sourceLine, sourceCol]
    const genColDelta = 0 - prevGeneratedCol
    const sourceIndexDelta = 0 // Always source index 0
    const sourceLineDelta = sourceLine - prevSourceLine
    const sourceColDelta = 0 - prevSourceCol

    segments.push(
      toVLQ(genColDelta)
      + toVLQ(sourceIndexDelta)
      + toVLQ(sourceLineDelta)
      + toVLQ(sourceColDelta),
    )

    prevGeneratedCol = 0
    prevSourceLine = sourceLine
    prevSourceCol = 0

    mappings.push(segments.join(','))
  }

  return {
    version: 3,
    file: dtsFilename,
    sourceRoot: '',
    sources: [sourceFilename],
    sourcesContent: [sourceContent],
    mappings: mappings.join(';'),
  }
}

/**
 * Add source map URL comment to declaration content
 */
export function addSourceMapComment(dtsContent: string, mapFilename: string): string {
  return `${dtsContent}\n//# sourceMappingURL=${mapFilename}\n`
}
