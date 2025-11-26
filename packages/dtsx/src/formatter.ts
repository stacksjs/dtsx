/**
 * Formatter module for pretty-printing generated declaration files
 * Supports Prettier integration and built-in formatting
 */

import { resolve, dirname } from 'node:path'

/**
 * Formatter configuration options
 */
export interface FormatterConfig {
  /** Use Prettier if available */
  usePrettier?: boolean
  /** Path to Prettier config file */
  prettierConfigPath?: string
  /** Prettier options override */
  prettierOptions?: PrettierOptions
  /** Built-in formatter options (used when Prettier unavailable) */
  builtIn?: BuiltInFormatterOptions
}

/**
 * Prettier-compatible options
 */
export interface PrettierOptions {
  /** Print width (default: 80) */
  printWidth?: number
  /** Tab width (default: 2) */
  tabWidth?: number
  /** Use tabs instead of spaces */
  useTabs?: boolean
  /** Add semicolons */
  semi?: boolean
  /** Use single quotes */
  singleQuote?: boolean
  /** Trailing commas: 'none' | 'es5' | 'all' */
  trailingComma?: 'none' | 'es5' | 'all'
  /** Bracket spacing in objects */
  bracketSpacing?: boolean
  /** Parser to use */
  parser?: string
}

/**
 * Built-in formatter options (when Prettier is not available)
 */
export interface BuiltInFormatterOptions {
  /** Indentation size */
  indentSize?: number
  /** Use tabs instead of spaces */
  useTabs?: boolean
  /** Maximum line width before wrapping */
  maxLineWidth?: number
  /** Add trailing newline */
  trailingNewline?: boolean
  /** Normalize whitespace */
  normalizeWhitespace?: boolean
  /** Sort imports */
  sortImports?: boolean
  /** Group imports by type */
  groupImports?: boolean
}

/**
 * Result of formatting operation
 */
export interface FormatResult {
  /** Formatted content */
  content: string
  /** Whether Prettier was used */
  usedPrettier: boolean
  /** Any warnings or notes */
  warnings?: string[]
}

// Cache for Prettier availability check
let prettierAvailable: boolean | null = null
let prettierModule: any = null

/**
 * Check if Prettier is available
 */
async function checkPrettierAvailable(): Promise<boolean> {
  if (prettierAvailable !== null) {
    return prettierAvailable
  }

  try {
    prettierModule = await import('prettier')
    prettierAvailable = true
    return true
  }
  catch {
    prettierAvailable = false
    return false
  }
}

/**
 * Load Prettier config from file or defaults
 */
async function loadPrettierConfig(
  configPath?: string,
  filePath?: string,
): Promise<PrettierOptions | null> {
  if (!prettierModule) return null

  try {
    // Try to resolve config from file path
    if (filePath && prettierModule.resolveConfig) {
      const config = await prettierModule.resolveConfig(filePath)
      if (config) return config
    }

    // Try explicit config path
    if (configPath && prettierModule.resolveConfig) {
      const config = await prettierModule.resolveConfig(configPath)
      if (config) return config
    }

    return null
  }
  catch {
    return null
  }
}

/**
 * Format content using Prettier
 */
async function formatWithPrettier(
  content: string,
  options: PrettierOptions,
): Promise<string> {
  if (!prettierModule) {
    throw new Error('Prettier is not available')
  }

  const formatOptions = {
    ...options,
    parser: options.parser || 'typescript',
  }

  return prettierModule.format(content, formatOptions)
}

/**
 * Built-in formatter for when Prettier is not available
 */
function formatBuiltIn(content: string, options: BuiltInFormatterOptions = {}): string {
  const {
    indentSize = 2,
    useTabs = false,
    maxLineWidth = 100,
    trailingNewline = true,
    normalizeWhitespace = true,
    sortImports = true,
    groupImports = true,
  } = options

  let result = content
  const indent = useTabs ? '\t' : ' '.repeat(indentSize)

  // Normalize line endings
  result = result.replace(/\r\n/g, '\n')

  // Normalize whitespace
  if (normalizeWhitespace) {
    // Remove trailing whitespace from lines
    result = result.replace(/[ \t]+$/gm, '')

    // Collapse multiple blank lines to maximum of 2
    result = result.replace(/\n{3,}/g, '\n\n')

    // Ensure consistent indentation
    result = normalizeIndentation(result, indent)
  }

  // Sort and group imports
  if (sortImports || groupImports) {
    result = formatImports(result, { sort: sortImports, group: groupImports })
  }

  // Handle long lines (basic wrapping for type definitions)
  if (maxLineWidth > 0) {
    result = wrapLongLines(result, maxLineWidth, indent)
  }

  // Ensure trailing newline
  if (trailingNewline && !result.endsWith('\n')) {
    result += '\n'
  }

  return result
}

/**
 * Normalize indentation throughout the content
 */
function normalizeIndentation(content: string, indent: string): string {
  const lines = content.split('\n')
  const result: string[] = []

  for (const line of lines) {
    // Count leading whitespace
    const match = line.match(/^(\s*)(.*)$/)
    if (!match) {
      result.push(line)
      continue
    }

    const [, whitespace, rest] = match

    if (!rest) {
      // Empty line
      result.push('')
      continue
    }

    // Calculate indent level (assuming 2-space base)
    const spaces = whitespace.replace(/\t/g, '  ').length
    const level = Math.floor(spaces / 2)

    result.push(indent.repeat(level) + rest)
  }

  return result.join('\n')
}

/**
 * Format and organize imports
 */
function formatImports(
  content: string,
  options: { sort?: boolean, group?: boolean },
): string {
  const lines = content.split('\n')
  const imports: { line: string, source: string, isType: boolean }[] = []
  const otherLines: string[] = []
  let inImportBlock = false
  let importBlockEnd = 0

  // Extract imports
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const importMatch = line.match(/^(import\s+(?:type\s+)?.*from\s+['"])([^'"]+)(['"].*)$/)

    if (importMatch) {
      inImportBlock = true
      importBlockEnd = i
      imports.push({
        line,
        source: importMatch[2],
        isType: line.includes('import type'),
      })
    }
    else if (inImportBlock && line.trim() === '') {
      // Skip blank lines in import block
      continue
    }
    else {
      if (inImportBlock) {
        inImportBlock = false
      }
      otherLines.push(line)
    }
  }

  if (imports.length === 0) {
    return content
  }

  // Sort imports
  if (options.sort) {
    imports.sort((a, b) => {
      // Type imports come after regular imports
      if (a.isType !== b.isType) {
        return a.isType ? 1 : -1
      }

      // Sort by source
      return compareImportSources(a.source, b.source)
    })
  }

  // Group imports
  let formattedImports: string[]
  if (options.group) {
    const nodeImports = imports.filter(i => i.source.startsWith('node:'))
    const builtinImports = imports.filter(i =>
      !i.source.startsWith('.') &&
      !i.source.startsWith('node:') &&
      !i.source.includes('/'),
    )
    const externalImports = imports.filter(i =>
      !i.source.startsWith('.') &&
      !i.source.startsWith('node:') &&
      i.source.includes('/') &&
      !i.source.startsWith('@'),
    )
    const scopedImports = imports.filter(i => i.source.startsWith('@'))
    const relativeImports = imports.filter(i => i.source.startsWith('.'))

    formattedImports = [
      ...nodeImports.map(i => i.line),
      ...(nodeImports.length > 0 && builtinImports.length > 0 ? [''] : []),
      ...builtinImports.map(i => i.line),
      ...((nodeImports.length > 0 || builtinImports.length > 0) && externalImports.length > 0 ? [''] : []),
      ...externalImports.map(i => i.line),
      ...(scopedImports.length > 0 && (nodeImports.length > 0 || builtinImports.length > 0 || externalImports.length > 0) ? [''] : []),
      ...scopedImports.map(i => i.line),
      ...(relativeImports.length > 0 ? [''] : []),
      ...relativeImports.map(i => i.line),
    ]
  }
  else {
    formattedImports = imports.map(i => i.line)
  }

  // Reconstruct content
  return [...formattedImports, '', ...otherLines].join('\n')
}

/**
 * Compare import sources for sorting
 */
function compareImportSources(a: string, b: string): number {
  // node: imports first
  const aNode = a.startsWith('node:')
  const bNode = b.startsWith('node:')
  if (aNode !== bNode) return aNode ? -1 : 1

  // Then external packages
  const aRelative = a.startsWith('.')
  const bRelative = b.startsWith('.')
  if (aRelative !== bRelative) return aRelative ? 1 : -1

  // Alphabetical within groups
  return a.localeCompare(b)
}

/**
 * Wrap long lines (basic implementation for type definitions)
 */
function wrapLongLines(content: string, maxWidth: number, indent: string): string {
  const lines = content.split('\n')
  const result: string[] = []

  for (const line of lines) {
    if (line.length <= maxWidth) {
      result.push(line)
      continue
    }

    // Don't wrap import statements (they're usually fine as-is)
    if (line.trimStart().startsWith('import ')) {
      result.push(line)
      continue
    }

    // Try to wrap at sensible points
    const currentIndent = line.match(/^(\s*)/)?.[1] || ''
    const nextIndent = currentIndent + indent

    // Try to break at commas in object/interface definitions
    if (line.includes('{') && line.includes('}')) {
      const wrapped = wrapObjectLiteral(line, maxWidth, currentIndent, nextIndent)
      result.push(...wrapped)
      continue
    }

    // Try to break at union types
    if (line.includes(' | ')) {
      const wrapped = wrapUnionType(line, maxWidth, currentIndent, nextIndent)
      result.push(...wrapped)
      continue
    }

    // Fall back to keeping long line
    result.push(line)
  }

  return result.join('\n')
}

/**
 * Wrap object literal / interface on multiple lines
 */
function wrapObjectLiteral(
  line: string,
  _maxWidth: number,
  currentIndent: string,
  nextIndent: string,
): string[] {
  // Simple heuristic: if it has multiple properties, split them
  const match = line.match(/^(\s*)(.*?)(\{)(.+)(\}.*)$/)
  if (!match) return [line]

  const [, , prefix, openBrace, content, suffix] = match

  // Split by semicolons or commas
  const parts = content.split(/;\s*|,\s*/).filter(p => p.trim())

  if (parts.length <= 1) return [line]

  const result = [
    `${currentIndent}${prefix}${openBrace}`,
    ...parts.map(p => `${nextIndent}${p.trim()};`),
    `${currentIndent}${suffix.trim()}`,
  ]

  return result
}

/**
 * Wrap union types on multiple lines
 */
function wrapUnionType(
  line: string,
  _maxWidth: number,
  currentIndent: string,
  nextIndent: string,
): string[] {
  const match = line.match(/^(\s*)(.*?=\s*)(.+)$/)
  if (!match) return [line]

  const [, , prefix, typeContent] = match

  // Split by union operator
  const parts = typeContent.split(/\s*\|\s*/).filter(p => p.trim())

  if (parts.length <= 2) return [line]

  const result = [
    `${currentIndent}${prefix}`,
    ...parts.map((p, i) => `${nextIndent}${i > 0 ? '| ' : '  '}${p.trim()}`),
  ]

  return result
}

/**
 * Format declaration file content
 */
export async function formatDts(
  content: string,
  config: FormatterConfig = {},
  filePath?: string,
): Promise<FormatResult> {
  const warnings: string[] = []

  // Check if Prettier should be used
  if (config.usePrettier !== false) {
    const hasPrettier = await checkPrettierAvailable()

    if (hasPrettier) {
      try {
        // Load Prettier config
        const prettierConfig = await loadPrettierConfig(
          config.prettierConfigPath,
          filePath,
        )

        const options: PrettierOptions = {
          ...prettierConfig,
          ...config.prettierOptions,
          parser: 'typescript',
        }

        const formatted = await formatWithPrettier(content, options)

        return {
          content: formatted,
          usedPrettier: true,
        }
      }
      catch (error) {
        warnings.push(`Prettier formatting failed: ${error}. Using built-in formatter.`)
      }
    }
    else if (config.usePrettier === true) {
      warnings.push('Prettier requested but not available. Using built-in formatter.')
    }
  }

  // Use built-in formatter
  const formatted = formatBuiltIn(content, config.builtIn)

  return {
    content: formatted,
    usedPrettier: false,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

/**
 * Format multiple files
 */
export async function formatFiles(
  files: Map<string, string>,
  config: FormatterConfig = {},
): Promise<Map<string, FormatResult>> {
  const results = new Map<string, FormatResult>()

  for (const [filePath, content] of files) {
    const result = await formatDts(content, config, filePath)
    results.set(filePath, result)
  }

  return results
}

/**
 * Create a formatter with preset configuration
 */
export function createFormatter(config: FormatterConfig = {}): {
  format: (content: string, filePath?: string) => Promise<FormatResult>
  formatMany: (files: Map<string, string>) => Promise<Map<string, FormatResult>>
} {
  return {
    format: (content: string, filePath?: string) => formatDts(content, config, filePath),
    formatMany: (files: Map<string, string>) => formatFiles(files, config),
  }
}

/**
 * Quick format with sensible defaults
 */
export async function quickFormat(content: string): Promise<string> {
  const result = await formatDts(content, {
    usePrettier: true,
    builtIn: {
      indentSize: 2,
      normalizeWhitespace: true,
      sortImports: true,
      trailingNewline: true,
    },
  })
  return result.content
}
