/**
 * Import statement parsing and processing utilities
 */
import type { ModuleReference } from '../module-references'
import { parseImportEquals, quoteModuleSpecifier, scanModuleReferences, tokenizeDeclarationSyntax } from '../module-references'
import { getImportItemsFromCache, setImportItemsCache } from './cache'

/**
 * Represents a single imported item with its type-only status
 */
export interface ImportItem {
  /** The local name used in code (alias if present) */
  name: string
  /** The original name from the module (before 'as') */
  originalName: string
  /** Whether this specific item is type-only (import { type X }) */
  isTypeOnly: boolean
  /** Whether this is a default import */
  isDefault: boolean
}

/**
 * Detailed import statement parse result
 */
export interface ParsedImport {
  /** Default import name if present */
  defaultName: string | null
  /** Named import items with details */
  namedItems: ImportItem[]
  /** Module source path */
  source: string
  /** Whether the entire import is type-only (import type { ... }) */
  isTypeOnly: boolean
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean
  /** Namespace name if isNamespace is true */
  namespaceName: string | null
  /** External import-equals syntax must retain its require clause. */
  isImportEquals?: boolean
}

function getStaticImportReference(importText: string): ModuleReference | undefined {
  return scanModuleReferences(importText).find(item => item.category === 'static-import')
}

/** Ignore grammatical trivia while keeping quoted names and module values intact. */
function normalizeImportSyntax(source: string): string {
  return tokenizeDeclarationSyntax(source).map(token => source.slice(token.start, token.end)).join(' ')
}

function importClauseEnd(source: string): number {
  const reference = getStaticImportReference(source)
  return reference ? source.lastIndexOf(' from ', reference.start) : -1
}

/** Canonically quote the decoded value of a grammatical module literal. */
export function getImportSourceLiteral(importText: string): string | undefined {
  const reference = getStaticImportReference(importText)
  return reference ? quoteModuleSpecifier(reference.specifier, '\'') : undefined
}

/**
 * Parse an import statement into its components using string operations
 * Avoids regex backtracking issues
 */
export function parseImportStatement(importText: string): {
  defaultName: string | null
  namedItems: string[]
  source: string
  isTypeOnly: boolean
  isNamespace: boolean
  namespaceName?: string | null
  isImportEquals?: boolean
} | null {
  const parsed = parseImportDetailed(importText)
  if (!parsed) return null
  return {
    defaultName: parsed.defaultName ?? parsed.namespaceName,
    namedItems: parsed.namedItems.map(item => `${!parsed.isTypeOnly && item.isTypeOnly ? 'type ' : ''}${item.originalName === item.name ? item.name : `${item.originalName} as ${item.name}`}`),
    source: parsed.source, isTypeOnly: parsed.isTypeOnly, isNamespace: parsed.isNamespace,
    namespaceName: parsed.namespaceName, isImportEquals: parsed.isImportEquals,
  }
}

/** Imported local names, sharing the same binding grammar as emission. */
export function extractAllImportedItems(importText: string): string[] {
  const cached = getImportItemsFromCache(importText)
  if (cached) return cached
  const parsed = parseImportDetailed(importText)
  const items = parsed ? [parsed.defaultName, parsed.namespaceName, ...parsed.namedItems.map(item => item.name)].filter((name): name is string => name !== null) : []
  setImportItemsCache(importText, items)
  return items
}

function splitImportItems(source: string): string[] {
  const result: string[] = []
  let start = 0
  for (const token of tokenizeDeclarationSyntax(source)) {
    if (token.kind !== 'punctuation' || source.slice(token.start, token.end) !== ',') continue
    const item = source.slice(start, token.start).trim()
    if (item) result.push(item)
    start = token.end
  }
  const item = source.slice(start).trim()
  if (item) result.push(item)
  return result
}

/**
 * Parse an import statement with detailed type-only information for each item
 * Handles: import type { X }, import { type X, Y }, import * as X, etc.
 */
export function parseImportDetailed(importText: string): ParsedImport | null {
  importText = normalizeImportSyntax(importText)
  const importEquals = parseImportEquals(importText)
  if (importEquals) return {
    defaultName: importEquals.name,
    namedItems: [],
    source: importEquals.source,
    isTypeOnly: importEquals.isTypeOnly,
    isNamespace: false,
    namespaceName: null,
    isImportEquals: true,
  }
  // Find 'from' and extract source
  const fromIndex = importClauseEnd(importText)
  if (fromIndex === -1)
    return null

  const reference = getStaticImportReference(importText)
  if (!reference) return null
  const source = reference.specifier

  // Parse the import part (before 'from')
  let importPart = importText.slice(0, fromIndex).trim()

  // Check for 'import type' (entire import is type-only)
  const isTypeOnly = reference.isTypeOnly
  if (importPart.startsWith('import ')) {
    importPart = importPart.slice(7).trim()
  }
  if (isTypeOnly && importPart.startsWith('type ')) {
    importPart = importPart.slice(5).trim()
  }

  let defaultName: string | null = null
  const namedItems: ImportItem[] = []
  let isNamespace = false
  let namespaceName: string | null = null

  // Check for namespace import (import * as X)
  const namespaceIndex = importPart.includes('{') ? -1 : importPart.indexOf('* as ')
  if (namespaceIndex !== -1) {
    isNamespace = true
    namespaceName = importPart.slice(namespaceIndex + 5).trim()
    defaultName = importPart.slice(0, namespaceIndex).trim().replace(/,$/, '').trim() || null
    return {
      defaultName,
      namedItems: [],
      source,
      isTypeOnly,
      isNamespace,
      namespaceName,
    }
  }

  // Check for braces (named imports)
  const braceStart = importPart.indexOf('{')
  const braceEnd = importPart.lastIndexOf('}')

  if (braceStart !== -1 && braceEnd !== -1) {
    // Check for default import before braces
    const beforeBrace = importPart.slice(0, braceStart).trim()
    if (beforeBrace.endsWith(',')) {
      defaultName = beforeBrace.slice(0, -1).trim() || null
    }

    // Extract named imports with type-only detection (single-pass parsing)
    const namedPart = importPart.slice(braceStart + 1, braceEnd)
    const items = splitImportItems(namedPart)

    for (const item of items) {
      const itemIsTypeOnly = isTypeOnlyImportItem(item)
      const cleanItem = itemIsTypeOnly ? item.slice(5).trim() : item

      // Handle aliases: 'OriginalName as AliasName'
      const asIndex = cleanItem.lastIndexOf(' as ')
      let name: string
      let originalName: string

      if (asIndex !== -1) {
        originalName = cleanItem.slice(0, asIndex).trim()
        name = cleanItem.slice(asIndex + 4).trim()
      }
      else {
        name = cleanItem
        originalName = cleanItem
      }

      namedItems.push({
        name,
        originalName,
        isTypeOnly: isTypeOnly || itemIsTypeOnly,
        isDefault: false,
      })
    }
  }
  else {
    // Default import only
    defaultName = importPart.trim() || null
  }

  return {
    defaultName,
    namedItems,
    source,
    isTypeOnly,
    isNamespace,
    namespaceName,
  }
}

/**
 * Parse an export statement with detailed type-only information
 * Handles: export type { X }, export { type X, Y }, export * from, etc.
 */
export function parseExportDetailed(exportText: string): {
  namedItems: ImportItem[]
  source: string | null
  isTypeOnly: boolean
  isNamespace: boolean
  isDefault: boolean
} | null {
  let text = exportText.trim()

  // Check for export default
  if (text.startsWith('export default ')) {
    return {
      namedItems: [],
      source: null,
      isTypeOnly: false,
      isNamespace: false,
      isDefault: true,
    }
  }

  // Check for 'export type' (entire export is type-only)
  const isTypeOnly = text.startsWith('export type ')
  if (text.startsWith('export ')) {
    text = text.slice(7).trim()
  }
  if (isTypeOnly && text.startsWith('type ')) {
    text = text.slice(5).trim()
  }

  // Check for namespace re-export (export * from)
  if (text.startsWith('* from ') || text.startsWith('* as ')) {
    const fromIndex = text.indexOf(' from ')
    let source: string | null = null

    if (fromIndex !== -1) {
      const afterFrom = text.slice(fromIndex + 6).trim()
      const quoteChar = afterFrom[0]
      if (quoteChar === '"' || quoteChar === '\'') {
        const endQuote = afterFrom.indexOf(quoteChar, 1)
        if (endQuote !== -1) {
          source = afterFrom.slice(1, endQuote)
        }
      }
    }

    return {
      namedItems: [],
      source,
      isTypeOnly,
      isNamespace: true,
      isDefault: false,
    }
  }

  // Check for braces (named exports)
  const braceStart = text.indexOf('{')
  const braceEnd = text.lastIndexOf('}')

  if (braceStart === -1 || braceEnd === -1) {
    return null
  }

  // Extract source if present
  let source: string | null = null
  const fromIndex = text.indexOf(' from ', braceEnd)
  if (fromIndex !== -1) {
    const afterFrom = text.slice(fromIndex + 6).trim()
    const quoteChar = afterFrom[0]
    if (quoteChar === '"' || quoteChar === '\'') {
      const endQuote = afterFrom.indexOf(quoteChar, 1)
      if (endQuote !== -1) {
        source = afterFrom.slice(1, endQuote)
      }
    }
  }

  // Extract named exports with type-only detection (single-pass parsing)
  const namedItems: ImportItem[] = []
  const namedPart = text.slice(braceStart + 1, braceEnd)
  const items: string[] = []
  {
    let _s = 0
    for (let _i = 0; _i <= namedPart.length; _i++) {
      if (_i === namedPart.length || namedPart.charCodeAt(_i) === 44) {
        let a = _s, b = _i
        while (a < b && (namedPart.charCodeAt(a) <= 32)) a++
        while (b > a && (namedPart.charCodeAt(b - 1) <= 32)) b--
        if (a < b) items.push(namedPart.slice(a, b))
        _s = _i + 1
      }
    }
  }

  for (const item of items) {
    const itemIsTypeOnly = isTypeOnlyImportItem(item)
    const cleanItem = itemIsTypeOnly ? item.slice(5).trim() : item

    // Handle aliases: 'OriginalName as AliasName'
    const asIndex = cleanItem.lastIndexOf(' as ')
    let name: string
    let originalName: string

    if (asIndex !== -1) {
      originalName = cleanItem.slice(0, asIndex).trim()
      name = cleanItem.slice(asIndex + 4).trim()
    }
    else {
      name = cleanItem
      originalName = cleanItem
    }

    namedItems.push({
      name,
      originalName,
      isTypeOnly: isTypeOnly || itemIsTypeOnly,
      isDefault: false,
    })
  }

  return {
    namedItems,
    source,
    isTypeOnly,
    isNamespace: false,
    isDefault: false,
  }
}

/**
 * Check if an import item is type-only
 */
export function isTypeOnlyImportItem(itemText: string): boolean {
  const tokens = tokenizeDeclarationSyntax(itemText)
  const first = tokens[0]
  if (!first || first.kind !== 'word' || itemText.slice(first.start, first.end) !== 'type' || tokens.length < 2) return false
  return !(tokens.length === 3 && itemText.slice(tokens[1].start, tokens[1].end) === 'as')
}

/**
 * Convert import items to type-only format
 * E.g., "{ X, Y }" becomes "{ type X, type Y }"
 */
export function convertToTypeOnlyImport(importText: string): string {
  const parsed = parseImportDetailed(importText)
  if (!parsed || parsed.isTypeOnly || parsed.isImportEquals)
    return importText

  // Already type-only at statement level
  if (parsed.namedItems.every(item => item.isTypeOnly)) {
    return importText.replace(/^import\s+/, 'import type ')
  }

  return importText
}

/**
 * Merge value and type imports from the same module
 * Combines separate import statements into one where possible
 */
export function mergeImports(imports: string[]): string[] {
  const bySource = new Map<string, { types: ImportItem[], values: ImportItem[], defaultName: string | null, sourceLiteral: string }>()
  const preservedEquals: string[] = []

  for (const imp of imports) {
    const parsed = parseImportDetailed(imp)
    if (!parsed)
      continue
    if (parsed.isImportEquals || parsed.isNamespace) {
      preservedEquals.push(imp)
      continue
    }

    const sourceLiteral = getImportSourceLiteral(imp)
    if (!sourceLiteral) throw new Error('Cannot locate a grammatical module literal in the import declaration')
    const existing = bySource.get(parsed.source) || { types: [], values: [], defaultName: null, sourceLiteral }

    if (parsed.defaultName) {
      existing.defaultName = parsed.defaultName
    }

    for (const item of parsed.namedItems) {
      if (item.isTypeOnly) {
        existing.types.push(item)
      }
      else {
        existing.values.push(item)
      }
    }

    bySource.set(parsed.source, existing)
  }

  const result: string[] = preservedEquals

  for (const { types, values, defaultName, sourceLiteral } of bySource.values()) {
    if (types.length === 0 && values.length === 0 && defaultName) {
      // Only default import
      result.push(`import ${defaultName} from ${sourceLiteral};`)
    }
    else if (types.length > 0 && values.length === 0 && !defaultName) {
      // Only type imports
      const items = types.map(t => t.originalName === t.name ? t.name : `${t.originalName} as ${t.name}`)
      result.push(`import type { ${items.join(', ')} } from ${sourceLiteral};`)
    }
    else if (values.length > 0 && types.length === 0 && !defaultName) {
      // Only value imports
      const items = values.map(v => v.originalName === v.name ? v.name : `${v.originalName} as ${v.name}`)
      result.push(`import { ${items.join(', ')} } from ${sourceLiteral};`)
    }
    else {
      // Mixed imports - use inline type specifiers
      const allItems: string[] = []

      for (const t of types) {
        const name = t.originalName === t.name ? t.name : `${t.originalName} as ${t.name}`
        allItems.push(`type ${name}`)
      }
      for (const v of values) {
        const name = v.originalName === v.name ? v.name : `${v.originalName} as ${v.name}`
        allItems.push(name)
      }

      if (defaultName) {
        result.push(`import ${defaultName}, { ${allItems.join(', ')} } from ${sourceLiteral};`)
      }
      else {
        result.push(`import { ${allItems.join(', ')} } from ${sourceLiteral};`)
      }
    }
  }

  return result
}
