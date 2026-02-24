/**
 * Output normalizer for consistent, high-quality declaration file output
 * Handles newlines, whitespace, declaration ordering, import grouping, and comment preservation
 */

import type { DeclarationKind } from './types'

/**
 * Line ending style
 */
export type LineEnding = 'lf' | 'crlf' | 'auto'

/**
 * Declaration ordering configuration
 */
export interface DeclarationOrder {
  /** Order of declaration kinds */
  kinds?: DeclarationKind[]
  /** Sort alphabetically within kinds */
  alphabetize?: boolean
  /** Group by export status */
  groupExports?: boolean
}

/**
 * Import grouping configuration
 */
export interface ImportGrouping {
  /** Enable import grouping */
  enabled?: boolean
  /** Group order */
  groups?: ImportGroupType[]
  /** Add blank lines between groups */
  separateGroups?: boolean
  /** Sort alphabetically within groups */
  alphabetize?: boolean
}

export type ImportGroupType =
  | 'builtin' // node:* modules
  | 'external' // npm packages
  | 'scoped' // @org/* packages
  | 'internal' // @/* or ~/* aliases
  | 'parent' // ../* imports
  | 'sibling' // ./* imports
  | 'index' // . or ./index
  | 'type' // import type

/**
 * Output normalizer configuration
 */
export interface OutputNormalizerConfig {
  /** Line ending style (default: 'lf') */
  lineEnding?: LineEnding
  /** Ensure file ends with newline (default: true) */
  trailingNewline?: boolean
  /** Maximum consecutive blank lines (default: 1) */
  maxBlankLines?: number
  /** Remove trailing whitespace from lines (default: true) */
  trimTrailingWhitespace?: boolean
  /** Normalize indentation (default: true) */
  normalizeIndentation?: boolean
  /** Indentation style */
  indent?: {
    style?: 'spaces' | 'tabs'
    size?: number
  }
  /** Declaration ordering configuration */
  declarationOrder?: DeclarationOrder
  /** Import grouping configuration */
  importGrouping?: ImportGrouping
  /** Preserve original comment formatting (default: true) */
  preserveComments?: boolean
  /** Insert final newline after last declaration (default: true) */
  insertFinalNewline?: boolean
}

/**
 * Default declaration order
 */
export const DEFAULT_DECLARATION_ORDER: DeclarationKind[] = [
  'import',
  'type',
  'interface',
  'enum',
  'class',
  'function',
  'variable',
  'export',
  'module',
  'namespace',
  'unknown',
]

/**
 * Default import group order
 */
export const DEFAULT_IMPORT_GROUP_ORDER: ImportGroupType[] = [
  'builtin',
  'external',
  'scoped',
  'internal',
  'parent',
  'sibling',
  'index',
  'type',
]

/**
 * Parsed line information
 */
interface _ParsedLine {
  content: string
  indent: string
  isBlank: boolean
  isComment: boolean
  isImport: boolean
  isExport: boolean
  isDeclaration: boolean
  declarationKind?: DeclarationKind
  importSource?: string
  importGroup?: ImportGroupType
}

/**
 * Normalize output content
 */
export function normalizeOutput(
  content: string,
  config: OutputNormalizerConfig = {},
): string {
  const {
    lineEnding = 'lf',
    trailingNewline = true,
    maxBlankLines = 1,
    trimTrailingWhitespace = true,
    normalizeIndentation = true,
    indent = { style: 'spaces', size: 2 },
    declarationOrder,
    importGrouping,
    preserveComments: _preserveComments = true,
    insertFinalNewline = true,
  } = config

  let result = content

  // Step 1: Normalize line endings
  result = normalizeLineEndings(result, lineEnding)

  // Step 2: Process imports (grouping and sorting)
  if (importGrouping?.enabled !== false) {
    result = processImports(result, importGrouping || {})
  }

  // Step 3: Order declarations
  if (declarationOrder) {
    result = orderDeclarations(result, declarationOrder)
  }

  // Step 4: Normalize whitespace
  if (trimTrailingWhitespace) {
    result = removeTrailingWhitespace(result)
  }

  // Step 5: Normalize blank lines
  result = normalizeBlankLines(result, maxBlankLines)

  // Step 6: Normalize indentation
  if (normalizeIndentation) {
    result = normalizeIndent(result, indent)
  }

  // Step 7: Ensure trailing newline
  if (trailingNewline || insertFinalNewline) {
    result = ensureTrailingNewline(result)
  }

  return result
}

/**
 * Normalize line endings
 */
export function normalizeLineEndings(content: string, style: LineEnding): string {
  // First normalize all to LF
  let result = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Convert to target style
  if (style === 'crlf') {
    result = result.replace(/\n/g, '\r\n')
  }
  // 'lf' and 'auto' both result in LF (auto detects and normalizes)

  return result
}

/**
 * Detect current line ending style
 */
export function detectLineEnding(content: string): LineEnding {
  const crlfCount = (content.match(/\r\n/g) || []).length
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length

  if (crlfCount > lfCount) {
    return 'crlf'
  }
  return 'lf'
}

/**
 * Remove trailing whitespace from all lines
 */
export function removeTrailingWhitespace(content: string): string {
  return content
    .split('\n')
    .map(line => line.replace(/[\t ]+$/, ''))
    .join('\n')
}

/**
 * Normalize blank lines (limit consecutive blank lines)
 */
export function normalizeBlankLines(content: string, max: number): string {
  const pattern = new RegExp(`\\n{${max + 2},}`, 'g')
  return content.replace(pattern, '\n'.repeat(max + 1))
}

/**
 * Ensure content ends with exactly one newline
 */
export function ensureTrailingNewline(content: string): string {
  // Remove trailing whitespace and newlines
  const result = content.replace(/\s+$/, '')
  // Add single newline
  return `${result}\n`
}

/**
 * Normalize indentation
 */
export function normalizeIndent(
  content: string,
  config: { style?: 'spaces' | 'tabs', size?: number },
): string {
  const { style = 'spaces', size = 2 } = config
  const targetIndent = style === 'tabs' ? '\t' : ' '.repeat(size)

  const lines = content.split('\n')
  const result: string[] = []

  for (const line of lines) {
    // Match leading whitespace
    const match = line.match(/^([\t ]*)(.*)$/)
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

    // Calculate indent level
    // Convert tabs to spaces for calculation (assume 2-space tabs)
    const spacesEquivalent = whitespace.replace(/\t/g, '  ')
    const level = Math.floor(spacesEquivalent.length / 2)

    // Apply new indentation
    result.push(targetIndent.repeat(level) + rest)
  }

  return result.join('\n')
}

/**
 * Process and organize imports
 */
export function processImports(content: string, config: ImportGrouping): string {
  const {
    groups = DEFAULT_IMPORT_GROUP_ORDER,
    separateGroups = true,
    alphabetize = true,
  } = config

  const lines = content.split('\n')
  const imports: { line: string, source: string, group: ImportGroupType, isType: boolean }[] = []
  const otherLines: string[] = []
  let importBlockEnd = -1

  // Extract imports
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const importInfo = parseImportLine(line)

    if (importInfo) {
      imports.push({
        line,
        source: importInfo.source,
        group: importInfo.group,
        isType: importInfo.isType,
      })
      importBlockEnd = i
    }
    else if (imports.length > 0 && line.trim() === '') {
      // Skip blank lines within import block
      continue
    }
    else if (imports.length > 0 || line.trim() !== '') {
      if (imports.length === 0 || i > importBlockEnd + 1) {
        otherLines.push(line)
      }
    }
  }

  if (imports.length === 0) {
    return content
  }

  // Group imports
  const grouped = new Map<ImportGroupType, typeof imports>()
  for (const group of groups) {
    grouped.set(group, [])
  }

  for (const imp of imports) {
    const groupList = grouped.get(imp.group) || grouped.get('external') || []
    groupList.push(imp)
  }

  // Sort within groups
  if (alphabetize) {
    for (const [, groupImports] of grouped) {
      groupImports.sort((a, b) => {
        // Type imports last within group
        if (a.isType !== b.isType) {
          return a.isType ? 1 : -1
        }
        return a.source.localeCompare(b.source)
      })
    }
  }

  // Build result
  const sortedImports: string[] = []
  let lastGroup: ImportGroupType | null = null

  for (const group of groups) {
    const groupImports = grouped.get(group) || []
    if (groupImports.length === 0)
      continue

    // Add blank line between groups
    if (separateGroups && lastGroup !== null) {
      sortedImports.push('')
    }

    for (const imp of groupImports) {
      sortedImports.push(imp.line)
    }

    lastGroup = group
  }

  // Reconstruct content
  const beforeImports = lines.slice(0, lines.findIndex(l => parseImportLine(l) !== null))
  const afterImports = otherLines

  // Ensure blank line after imports
  while (afterImports.length > 0 && afterImports[0].trim() === '') {
    afterImports.shift()
  }

  return [
    ...beforeImports,
    ...sortedImports,
    '',
    ...afterImports,
  ].join('\n')
}

/**
 * Parse an import line
 */
function parseImportLine(line: string): { source: string, group: ImportGroupType, isType: boolean } | null {
  const trimmed = line.trim()

  // Match import statements
  const importMatch = trimmed.match(/^import\s+(type\s+)?.*from\s+['"]([^'"]+)['"]/)
  if (!importMatch) {
    // Side-effect import
    const sideEffectMatch = trimmed.match(/^import\s+['"]([^'"]+)['"]/)
    if (sideEffectMatch) {
      return {
        source: sideEffectMatch[1],
        group: detectImportGroup(sideEffectMatch[1]),
        isType: false,
      }
    }
    return null
  }

  const isType = !!importMatch[1]
  const source = importMatch[2]

  return {
    source,
    group: isType ? 'type' : detectImportGroup(source),
    isType,
  }
}

/**
 * Detect the group for an import source
 */
function detectImportGroup(source: string): ImportGroupType {
  // Node.js built-in
  if (source.startsWith('node:')) {
    return 'builtin'
  }

  // Check for built-in modules without node: prefix
  const builtins = [
    'assert',
    'buffer',
    'child_process',
    'cluster',
    'crypto',
    'dgram',
    'dns',
    'events',
    'fs',
    'http',
    'https',
    'net',
    'os',
    'path',
    'querystring',
    'readline',
    'stream',
    'url',
    'util',
    'zlib',
  ]
  if (builtins.includes(source) || builtins.includes(source.split('/')[0])) {
    return 'builtin'
  }

  // Relative imports
  if (source === '.' || source === './index' || source === './index.js' || source === './index.ts') {
    return 'index'
  }

  if (source.startsWith('./')) {
    return 'sibling'
  }

  if (source.startsWith('../')) {
    return 'parent'
  }

  // Internal aliases
  if (source.startsWith('@/') || source.startsWith('~/') || source.startsWith('#')) {
    return 'internal'
  }

  // Scoped packages
  if (source.startsWith('@')) {
    return 'scoped'
  }

  // External packages
  return 'external'
}

/**
 * Order declarations by kind
 */
export function orderDeclarations(content: string, config: DeclarationOrder): string {
  const {
    kinds = DEFAULT_DECLARATION_ORDER,
    alphabetize = false,
    groupExports = true,
  } = config

  const lines = content.split('\n')
  const declarations: { lines: string[], kind: DeclarationKind, name: string, isExport: boolean }[] = []
  const preamble: string[] = [] // Imports, comments at top
  const trailer: string[] = [] // Final trailing comments

  let currentDecl: { lines: string[], kind: DeclarationKind, name: string, isExport: boolean } | null = null
  let braceDepth = 0
  let inPreamble = true

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Track brace depth for multi-line declarations
    braceDepth += (line.match(/\{/g) || []).length
    braceDepth -= (line.match(/\}/g) || []).length

    // Check if this starts a new declaration
    const declInfo = detectDeclaration(trimmed)

    if (inPreamble && declInfo && declInfo.kind !== 'import' && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
      inPreamble = false
    }

    if (inPreamble) {
      preamble.push(line)
      continue
    }

    if (declInfo && braceDepth <= 1) {
      // Save previous declaration
      if (currentDecl) {
        declarations.push(currentDecl)
      }

      currentDecl = {
        lines: [line],
        kind: declInfo.kind,
        name: declInfo.name,
        isExport: declInfo.isExport,
      }
    }
    else if (currentDecl) {
      currentDecl.lines.push(line)
    }
    else {
      // Not in a declaration and not preamble
      if (trimmed === '') {
        // Skip stray blank lines
        continue
      }
      trailer.push(line)
    }
  }

  // Save last declaration
  if (currentDecl) {
    declarations.push(currentDecl)
  }

  // Sort declarations
  declarations.sort((a, b) => {
    // First by export status if grouping
    if (groupExports && a.isExport !== b.isExport) {
      return a.isExport ? -1 : 1
    }

    // Then by kind
    const aKindIdx = kinds.indexOf(a.kind)
    const bKindIdx = kinds.indexOf(b.kind)
    const aIdx = aKindIdx >= 0 ? aKindIdx : kinds.length
    const bIdx = bKindIdx >= 0 ? bKindIdx : kinds.length

    if (aIdx !== bIdx) {
      return aIdx - bIdx
    }

    // Then alphabetically by name
    if (alphabetize) {
      return a.name.localeCompare(b.name)
    }

    return 0
  })

  // Reconstruct content
  const result: string[] = [...preamble]

  let lastKind: DeclarationKind | null = null
  for (const decl of declarations) {
    // Add blank line between different kinds
    if (lastKind !== null && decl.kind !== lastKind) {
      result.push('')
    }

    result.push(...decl.lines)
    lastKind = decl.kind
  }

  if (trailer.length > 0) {
    result.push('')
    result.push(...trailer)
  }

  return result.join('\n')
}

/**
 * Detect declaration kind from a line
 */
function detectDeclaration(line: string): { kind: DeclarationKind, name: string, isExport: boolean } | null {
  const isExport = line.startsWith('export ')
  const effectiveLine = isExport ? line.slice(7) : line

  // Import
  if (line.startsWith('import ')) {
    const match = line.match(/from\s+['"]([^'"]+)['"]/)
    return { kind: 'import', name: match?.[1] || '', isExport: false }
  }

  // Type alias
  if (effectiveLine.startsWith('type ') || effectiveLine.startsWith('declare type ')) {
    const match = effectiveLine.match(/type\s+(\w+)/)
    return { kind: 'type', name: match?.[1] || '', isExport }
  }

  // Interface
  if (effectiveLine.startsWith('interface ') || effectiveLine.startsWith('declare interface ')) {
    const match = effectiveLine.match(/interface\s+(\w+)/)
    return { kind: 'interface', name: match?.[1] || '', isExport }
  }

  // Class
  if (effectiveLine.startsWith('class ') || effectiveLine.startsWith('abstract class ')
    || effectiveLine.startsWith('declare class ') || effectiveLine.startsWith('declare abstract class ')) {
    const match = effectiveLine.match(/class\s+(\w+)/)
    return { kind: 'class', name: match?.[1] || '', isExport }
  }

  // Enum
  if (effectiveLine.startsWith('enum ') || effectiveLine.startsWith('const enum ')
    || effectiveLine.startsWith('declare enum ') || effectiveLine.startsWith('declare const enum ')) {
    const match = effectiveLine.match(/enum\s+(\w+)/)
    return { kind: 'enum', name: match?.[1] || '', isExport }
  }

  // Function
  if (effectiveLine.startsWith('function ') || effectiveLine.startsWith('async function ')
    || effectiveLine.startsWith('declare function ') || effectiveLine.startsWith('declare async function ')) {
    const match = effectiveLine.match(/function\s+(\w+)/)
    return { kind: 'function', name: match?.[1] || '', isExport }
  }

  // Variable (const, let, var)
  if (effectiveLine.startsWith('const ') || effectiveLine.startsWith('let ')
    || effectiveLine.startsWith('var ') || effectiveLine.startsWith('declare const ')
    || effectiveLine.startsWith('declare let ') || effectiveLine.startsWith('declare var ')) {
    const match = effectiveLine.match(/(?:const|let|var)\s+(\w+)/)
    return { kind: 'variable', name: match?.[1] || '', isExport }
  }

  // Namespace
  if (effectiveLine.startsWith('namespace ') || effectiveLine.startsWith('declare namespace ')) {
    const match = effectiveLine.match(/namespace\s+(\w+)/)
    return { kind: 'namespace', name: match?.[1] || '', isExport }
  }

  // Module
  if (effectiveLine.startsWith('module ') || effectiveLine.startsWith('declare module ')) {
    const match = effectiveLine.match(/module\s+['"]?(\w+)['"]?/)
    return { kind: 'module', name: match?.[1] || '', isExport }
  }

  // Re-export
  if (line.startsWith('export {') || line.startsWith('export *') || line.startsWith('export type {')) {
    return { kind: 'export', name: '', isExport: true }
  }

  return null
}

/**
 * Preserve and format comments
 */
export function preserveCommentFormatting(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Preserve JSDoc comments exactly
    if (trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/')) {
      result.push(line)
      continue
    }

    // Preserve single-line comments
    if (trimmed.startsWith('//')) {
      result.push(line)
      continue
    }

    // Preserve block comments
    if (trimmed.startsWith('/*') || trimmed.endsWith('*/')) {
      result.push(line)
      continue
    }

    result.push(line)
  }

  return result.join('\n')
}

/**
 * Create a configured normalizer
 */
export function createOutputNormalizer(config: OutputNormalizerConfig = {}): {
  normalize: (content: string) => string
  normalizeLineEndings: (content: string) => string
  removeTrailingWhitespace: typeof removeTrailingWhitespace
  normalizeBlankLines: (content: string) => string
  ensureTrailingNewline: typeof ensureTrailingNewline
  processImports: (content: string) => string
  orderDeclarations: (content: string) => string
} {
  return {
    normalize: (content: string): string => normalizeOutput(content, config),
    normalizeLineEndings: (content: string): string => normalizeLineEndings(content, config.lineEnding || 'lf'),
    removeTrailingWhitespace,
    normalizeBlankLines: (content: string): string => normalizeBlankLines(content, config.maxBlankLines || 1),
    ensureTrailingNewline,
    processImports: (content: string): string => processImports(content, config.importGrouping || {}),
    orderDeclarations: (content: string): string => orderDeclarations(content, config.declarationOrder || {}),
  }
}

/**
 * Preset configurations
 */
export const normalizerPresets = {
  /** Default preset - LF, trailing newline, basic cleanup */
  default: {
    lineEnding: 'lf',
    trailingNewline: true,
    maxBlankLines: 1,
    trimTrailingWhitespace: true,
    normalizeIndentation: true,
    indent: { style: 'spaces', size: 2 },
    importGrouping: { enabled: true, separateGroups: true, alphabetize: true },
  } as OutputNormalizerConfig,

  /** Minimal preset - just line endings and trailing newline */
  minimal: {
    lineEnding: 'lf',
    trailingNewline: true,
    maxBlankLines: 2,
    trimTrailingWhitespace: true,
    normalizeIndentation: false,
    importGrouping: { enabled: false },
  } as OutputNormalizerConfig,

  /** Strict preset - all normalization enabled */
  strict: {
    lineEnding: 'lf',
    trailingNewline: true,
    maxBlankLines: 1,
    trimTrailingWhitespace: true,
    normalizeIndentation: true,
    indent: { style: 'spaces', size: 2 },
    importGrouping: { enabled: true, separateGroups: true, alphabetize: true },
    declarationOrder: {
      kinds: DEFAULT_DECLARATION_ORDER,
      alphabetize: true,
      groupExports: true,
    },
  } as OutputNormalizerConfig,

  /** Windows preset - CRLF line endings */
  windows: {
    lineEnding: 'crlf',
    trailingNewline: true,
    maxBlankLines: 1,
    trimTrailingWhitespace: true,
    normalizeIndentation: true,
    indent: { style: 'spaces', size: 2 },
    importGrouping: { enabled: true, separateGroups: true, alphabetize: true },
  } as OutputNormalizerConfig,

  /** Tabs preset - use tabs for indentation */
  tabs: {
    lineEnding: 'lf',
    trailingNewline: true,
    maxBlankLines: 1,
    trimTrailingWhitespace: true,
    normalizeIndentation: true,
    indent: { style: 'tabs', size: 1 },
    importGrouping: { enabled: true, separateGroups: true, alphabetize: true },
  } as OutputNormalizerConfig,
}
