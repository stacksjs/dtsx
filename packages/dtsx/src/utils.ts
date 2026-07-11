import type { DtsGenerationConfig } from './types'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, extname, isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { write } from './compat'
import { config } from './config'
import { validateTypeScriptSyntax } from './syntax-validator'

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

  // .flat() avoids the spread+concat pattern, which can stack-overflow on huge directories.
  return (files as (string | string[])[]).flat(Infinity).filter((file): file is string => typeof file === 'string' && extname(file) === '.ts')
}

interface TypeScriptConfigFile {
  extends?: string | string[]
  compilerOptions?: {
    isolatedDeclarations?: boolean
  }
}

/** Remove JSONC comments and trailing commas without changing string contents. */
function normalizeJsonConfig(_jsonText: string): string {
  let result = ''
  let position = 0
  let stringQuote = 0

  while (position < _jsonText.length) {
    const char = _jsonText.charCodeAt(position)
    if (stringQuote) {
      result += _jsonText[position]
      if (char === 92 /* \\ */ && position + 1 < _jsonText.length) {
        result += _jsonText[position + 1]
        position += 2
        continue
      }
      if (char === stringQuote) stringQuote = 0
      position++
      continue
    }

    if (char === 34 /* " */) {
      stringQuote = char
      result += _jsonText[position++]
      continue
    }
    if (char === 47 /* / */ && _jsonText.charCodeAt(position + 1) === 47 /* / */) {
      position += 2
      while (position < _jsonText.length && _jsonText.charCodeAt(position) !== 10 /* \n */) position++
      continue
    }
    if (char === 47 /* / */ && _jsonText.charCodeAt(position + 1) === 42 /* * */) {
      position += 2
      while (position + 1 < _jsonText.length && !(_jsonText.charCodeAt(position) === 42 && _jsonText.charCodeAt(position + 1) === 47)) {
        if (_jsonText.charCodeAt(position) === 10) result += '\n'
        position++
      }
      position = Math.min(position + 2, _jsonText.length)
      continue
    }
    if (char === 44 /* , */) {
      let next = position + 1
      while (next < _jsonText.length && _jsonText.charCodeAt(next) <= 32) next++
      const nextChar = _jsonText.charCodeAt(next)
      if (nextChar === 93 /* ] */ || nextChar === 125 /* } */) {
        position++
        continue
      }
    }

    result += _jsonText[position++]
  }

  return result
}

function findConfigFile(path: string): string | null {
  const candidates = [path]
  if (!path.endsWith('.json')) candidates.push(`${path}.json`)
  candidates.push(join(path, 'tsconfig.json'))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolveExtendedConfig(specifier: string, configPath: string): string | null {
  if (isAbsolute(specifier) || specifier.startsWith('.')) {
    return findConfigFile(resolve(dirname(configPath), specifier))
  }

  const require = createRequire(configPath)
  for (const candidate of [specifier, `${specifier}/tsconfig.json`]) {
    try {
      const resolvedPath = findConfigFile(require.resolve(candidate))
      if (resolvedPath) return resolvedPath
    }
    catch {
      // Try the package's conventional tsconfig.json subpath next.
    }
  }
  return null
}

async function readIsolatedDeclarationsOption(configPath: string, visited: Set<string>): Promise<boolean | undefined> {
  const resolvedPath = findConfigFile(configPath)
  if (!resolvedPath || visited.has(resolvedPath)) return undefined
  visited.add(resolvedPath)

  const source = await readFile(resolvedPath, 'utf8')
  const config = JSON.parse(normalizeJsonConfig(source)) as TypeScriptConfigFile
  const extendedConfigs = typeof config.extends === 'string' ? [config.extends] : config.extends ?? []
  let inheritedValue: boolean | undefined

  for (const specifier of extendedConfigs) {
    const extendedPath = resolveExtendedConfig(specifier, resolvedPath)
    if (!extendedPath) continue
    const value = await readIsolatedDeclarationsOption(extendedPath, visited)
    if (value !== undefined) inheritedValue = value
  }

  return config.compilerOptions?.isolatedDeclarations ?? inheritedValue
}

/** Resolve the effective isolatedDeclarations option across a tsconfig hierarchy. */
export async function checkIsolatedDeclarationsConfig(options?: Pick<DtsGenerationConfig, 'cwd' | 'tsconfigPath'>): Promise<boolean> {
  try {
    const cwd = options?.cwd || process.cwd()
    const configuredPath = options?.tsconfigPath || 'tsconfig.json'
    const tsconfigPath = isAbsolute(configuredPath) ? configuredPath : resolve(cwd, configuredPath)
    return await readIsolatedDeclarationsOption(tsconfigPath, new Set()) ?? false
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
 * Validate declaration syntax with the dtsx scanner
 */
// eslint-disable-next-line pickier/no-unused-vars
export function validateDtsContent(content: string, filename: string): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
  }

  for (const diagnostic of validateTypeScriptSyntax(content)) {
    result.errors.push({
      line: diagnostic.line,
      column: diagnostic.column,
      message: diagnostic.message,
      code: diagnostic.code,
    })
  }

  result.isValid = result.errors.length === 0
  return result
}

/**
 * Simple line-by-line diff between two strings
 * Returns formatted diff output with +/- prefixes
 */
export function createDiff(oldContent: string, newContent: string, filename: string): string {
  // Equality fast-path avoids split/scan entirely.
  if (oldContent === newContent) return ''

  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  // Multiset-aware diff: count occurrences so duplicate lines (e.g. multiple `}`)
  // are reported correctly when only some of them are removed/added.
  const oldCounts = new Map<string, number>()
  const newCounts = new Map<string, number>()
  for (let i = 0; i < oldLines.length; i++) oldCounts.set(oldLines[i], (oldCounts.get(oldLines[i]) ?? 0) + 1)
  for (let i = 0; i < newLines.length; i++) newCounts.set(newLines[i], (newCounts.get(newLines[i]) ?? 0) + 1)

  const removed: string[] = []
  const added: string[] = []
  for (const [line, count] of oldCounts) {
    const surplus = count - (newCounts.get(line) ?? 0)
    for (let i = 0; i < surplus; i++) removed.push(line)
  }
  for (const [line, count] of newCounts) {
    const surplus = count - (oldCounts.get(line) ?? 0)
    for (let i = 0; i < surplus; i++) added.push(line)
  }

  if (removed.length === 0 && added.length === 0) return ''

  const output: string[] = [`--- ${filename}`, `+++ ${filename}`]
  for (let i = 0; i < removed.length; i++) output.push(`- ${removed[i]}`)
  for (let i = 0; i < added.length; i++) output.push(`+ ${added[i]}`)
  return output.join('\n')
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

  // Hoist line count out of the loop — previously O(N²) (split per iteration)
  const sourceLineCount = sourceContent.split('\n').length

  for (let i = 0; i < dtsLines.length; i++) {
    const line = dtsLines[i]

    if (line.trim() === '') {
      mappings.push('')
      continue
    }

    // Reset column for new line
    prevGeneratedCol = 0

    // Map to corresponding source line (simple 1:1 for declarations)
    const sourceLine = Math.min(i, sourceLineCount - 1)

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
