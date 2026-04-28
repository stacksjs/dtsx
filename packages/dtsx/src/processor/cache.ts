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
 * Get or create a cached RegExp for word boundary matching.
 * Promotes the entry on a hit so the FIFO eviction approximates LRU.
 */
export function getCachedRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern)
  if (cached) {
    // Move-to-end: delete + set re-inserts at the end of Map's insertion order,
    // so eviction (which scans from the front) drops cold entries first.
    regexCache.delete(pattern)
    regexCache.set(pattern, cached)
    return cached
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fresh = new RegExp(`\\b${escaped}\\b`)
  regexCache.set(pattern, fresh)

  // Evict a batch of oldest entries if cache is too large.
  if (regexCache.size > MAX_REGEX_CACHE_SIZE) {
    let count = 0
    for (const key of regexCache.keys()) {
      if (count++ >= 50) break
      regexCache.delete(key)
    }
  }
  return fresh
}

/**
 * Get cached import items or null if not cached.
 * Promotes on hit for LRU-like semantics.
 */
export function getImportItemsFromCache(importText: string): string[] | null {
  const cached = importItemsCache.get(importText)
  if (cached) {
    importItemsCache.delete(importText)
    importItemsCache.set(importText, cached)
    return cached
  }
  return null
}

/**
 * Store import items in cache with eviction
 */
export function setImportItemsCache(importText: string, items: string[]): void {
  importItemsCache.set(importText, items)

  // Evict a batch of entries if cache is too large
  if (importItemsCache.size > MAX_IMPORT_CACHE_SIZE) {
    let count = 0
    for (const key of importItemsCache.keys()) {
      if (count++ >= 20) break
      importItemsCache.delete(key)
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
