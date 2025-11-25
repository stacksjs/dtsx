/**
 * Cache utilities for processor
 * Handles regex compilation caching and import items caching
 */

/**
 * Maximum cache sizes to prevent memory bloat
 */
const MAX_REGEX_CACHE_SIZE = 500
const MAX_IMPORT_CACHE_SIZE = 200

/**
 * Cache for compiled RegExp patterns to avoid recreation in loops
 * Key: escaped pattern string, Value: compiled RegExp with word boundaries
 */
const regexCache = new Map<string, RegExp>()

/**
 * Cache for extractAllImportedItems results
 * Key: import text, Value: array of imported items
 */
const importItemsCache = new Map<string, string[]>()

/**
 * Get or create a cached RegExp for word boundary matching
 */
export function getCachedRegex(pattern: string): RegExp {
  let cached = regexCache.get(pattern)
  if (!cached) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    cached = new RegExp(`\\b${escaped}\\b`)
    regexCache.set(pattern, cached)

    // Evict oldest entries if cache is too large
    if (regexCache.size > MAX_REGEX_CACHE_SIZE) {
      const firstKey = regexCache.keys().next().value
      if (firstKey) {
        regexCache.delete(firstKey)
      }
    }
  }
  return cached
}

/**
 * Get cached import items or null if not cached
 */
export function getImportItemsFromCache(importText: string): string[] | null {
  return importItemsCache.get(importText) ?? null
}

/**
 * Store import items in cache with eviction
 */
export function setImportItemsCache(importText: string, items: string[]): void {
  importItemsCache.set(importText, items)

  // Evict oldest entries if cache is too large
  if (importItemsCache.size > MAX_IMPORT_CACHE_SIZE) {
    const firstKey = importItemsCache.keys().next().value
    if (firstKey) {
      importItemsCache.delete(firstKey)
    }
  }
}

/**
 * Clear processor caches (useful for testing or memory management)
 */
export function clearProcessorCaches(): void {
  regexCache.clear()
  importItemsCache.clear()
}
