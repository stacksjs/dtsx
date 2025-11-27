/**
 * Import statement parsing and processing utilities
 */

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
} | null {
  // Find 'from' and extract source
  const fromIndex = importText.indexOf(' from ')
  if (fromIndex === -1) return null

  // Extract source (between quotes after 'from')
  const afterFrom = importText.slice(fromIndex + 6).trim()
  const quoteChar = afterFrom[0]
  if (quoteChar !== '"' && quoteChar !== '\'') return null

  const endQuote = afterFrom.indexOf(quoteChar, 1)
  if (endQuote === -1) return null

  const source = afterFrom.slice(1, endQuote)

  // Parse the import part (before 'from')
  let importPart = importText.slice(0, fromIndex).trim()

  // Check for 'import type'
  const isTypeOnly = importPart.startsWith('import type ')
  if (importPart.startsWith('import ')) {
    importPart = importPart.slice(7).trim()
  }
  if (importPart.startsWith('type ')) {
    importPart = importPart.slice(5).trim()
  }

  let defaultName: string | null = null
  const namedItems: string[] = []

  // Check for braces (named imports)
  const braceStart = importPart.indexOf('{')
  const braceEnd = importPart.lastIndexOf('}')

  if (braceStart !== -1 && braceEnd !== -1) {
    // Check for default import before braces
    const beforeBrace = importPart.slice(0, braceStart).trim()
    if (beforeBrace.endsWith(',')) {
      defaultName = beforeBrace.slice(0, -1).trim() || null
    }

    // Extract named imports
    const namedPart = importPart.slice(braceStart + 1, braceEnd)
    const items = namedPart.split(',').map(s => s.trim()).filter(Boolean)
    namedItems.push(...items)
  }
  else {
    // Default import only
    defaultName = importPart.trim() || null
  }

  return { defaultName, namedItems, source, isTypeOnly }
}

/**
 * Extract all imported items from an import statement (with caching)
 * Uses simple string operations to avoid regex backtracking
 */
export function extractAllImportedItems(importText: string): string[] {
  // Check cache first
  const cached = getImportItemsFromCache(importText)
  if (cached) {
    return cached
  }

  const items: string[] = []

  // Helper to clean import item names and extract alias if present
  // For 'SomeType as AliasedType', returns 'AliasedType' (the local name used in code)
  const cleanImportItem = (item: string): string => {
    let trimmed = item.trim()
    // Remove 'type ' prefix
    if (trimmed.startsWith('type ')) {
      trimmed = trimmed.slice(5).trim()
    }
    // Handle aliases: 'OriginalName as AliasName' -> 'AliasName'
    const asIndex = trimmed.indexOf(' as ')
    if (asIndex !== -1) {
      return trimmed.slice(asIndex + 4).trim()
    }
    return trimmed
  }

  // Find 'from' keyword position
  const fromIndex = importText.indexOf(' from ')
  if (fromIndex === -1) {
    setImportItemsCache(importText, items)
    return items
  }

  // Get the part between 'import' and 'from'
  let importPart = importText.slice(0, fromIndex).trim()

  // Remove 'import' keyword and optional 'type' keyword
  if (importPart.startsWith('import ')) {
    importPart = importPart.slice(7).trim()
  }
  if (importPart.startsWith('type ')) {
    importPart = importPart.slice(5).trim()
  }

  // Check for named imports with braces
  const braceStart = importPart.indexOf('{')
  const braceEnd = importPart.lastIndexOf('}')

  if (braceStart !== -1 && braceEnd !== -1) {
    // Check for default import before braces (mixed import)
    const beforeBrace = importPart.slice(0, braceStart).trim()
    if (beforeBrace.endsWith(',')) {
      // Mixed import: defaultName, { a, b }
      const defaultName = beforeBrace.slice(0, -1).trim()
      if (defaultName) {
        items.push(defaultName)
      }
    }
    else if (beforeBrace && !beforeBrace.includes(',')) {
      // Default import before braces without comma (shouldn't happen but handle it)
      items.push(beforeBrace)
    }

    // Extract named imports from braces
    const namedPart = importPart.slice(braceStart + 1, braceEnd)
    const namedItems = namedPart.split(',').map(cleanImportItem).filter(Boolean)
    items.push(...namedItems)
  }
  else {
    // Default import only: import defaultName from 'module'
    const defaultName = importPart.trim()
    if (defaultName) {
      items.push(defaultName)
    }
  }

  setImportItemsCache(importText, items)

  return items
}

/**
 * Parse an import statement with detailed type-only information for each item
 * Handles: import type { X }, import { type X, Y }, import * as X, etc.
 */
export function parseImportDetailed(importText: string): ParsedImport | null {
  // Find 'from' and extract source
  const fromIndex = importText.indexOf(' from ')
  if (fromIndex === -1) return null

  // Extract source (between quotes after 'from')
  const afterFrom = importText.slice(fromIndex + 6).trim()
  const quoteChar = afterFrom[0]
  if (quoteChar !== '"' && quoteChar !== '\'') return null

  const endQuote = afterFrom.indexOf(quoteChar, 1)
  if (endQuote === -1) return null

  const source = afterFrom.slice(1, endQuote)

  // Parse the import part (before 'from')
  let importPart = importText.slice(0, fromIndex).trim()

  // Check for 'import type' (entire import is type-only)
  const isTypeOnly = importPart.startsWith('import type ')
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
  if (importPart.startsWith('* as ')) {
    isNamespace = true
    namespaceName = importPart.slice(5).trim()
    return {
      defaultName: null,
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

    // Extract named imports with type-only detection
    const namedPart = importPart.slice(braceStart + 1, braceEnd)
    const items = namedPart.split(',').map(s => s.trim()).filter(Boolean)

    for (const item of items) {
      const itemIsTypeOnly = item.startsWith('type ')
      let cleanItem = itemIsTypeOnly ? item.slice(5).trim() : item

      // Handle aliases: 'OriginalName as AliasName'
      const asIndex = cleanItem.indexOf(' as ')
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

  // Extract named exports with type-only detection
  const namedItems: ImportItem[] = []
  const namedPart = text.slice(braceStart + 1, braceEnd)
  const items = namedPart.split(',').map(s => s.trim()).filter(Boolean)

  for (const item of items) {
    const itemIsTypeOnly = item.startsWith('type ')
    let cleanItem = itemIsTypeOnly ? item.slice(5).trim() : item

    // Handle aliases: 'OriginalName as AliasName'
    const asIndex = cleanItem.indexOf(' as ')
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
  return itemText.trim().startsWith('type ')
}

/**
 * Convert import items to type-only format
 * E.g., "{ X, Y }" becomes "{ type X, type Y }"
 */
export function convertToTypeOnlyImport(importText: string): string {
  const parsed = parseImportDetailed(importText)
  if (!parsed || parsed.isTypeOnly) return importText

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
  const bySource = new Map<string, { types: ImportItem[], values: ImportItem[], defaultName: string | null }>()

  for (const imp of imports) {
    const parsed = parseImportDetailed(imp)
    if (!parsed) continue

    const existing = bySource.get(parsed.source) || { types: [], values: [], defaultName: null }

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

  const result: string[] = []

  for (const [source, { types, values, defaultName }] of bySource) {
    if (types.length === 0 && values.length === 0 && defaultName) {
      // Only default import
      result.push(`import ${defaultName} from '${source}';`)
    }
    else if (types.length > 0 && values.length === 0 && !defaultName) {
      // Only type imports
      const items = types.map(t => t.originalName === t.name ? t.name : `${t.originalName} as ${t.name}`)
      result.push(`import type { ${items.join(', ')} } from '${source}';`)
    }
    else if (values.length > 0 && types.length === 0 && !defaultName) {
      // Only value imports
      const items = values.map(v => v.originalName === v.name ? v.name : `${v.originalName} as ${v.name}`)
      result.push(`import { ${items.join(', ')} } from '${source}';`)
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
        result.push(`import ${defaultName}, { ${allItems.join(', ')} } from '${source}';`)
      }
      else {
        result.push(`import { ${allItems.join(', ')} } from '${source}';`)
      }
    }
  }

  return result
}
