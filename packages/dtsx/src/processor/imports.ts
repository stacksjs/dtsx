/**
 * Import statement parsing and processing utilities
 */

import { getImportItemsFromCache, setImportItemsCache } from './cache'

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
