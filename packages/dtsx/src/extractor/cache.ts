/**
 * SourceFile caching utilities for the extractor
 */

import type { SourceFile } from 'typescript'
import { createSourceFile, ScriptKind, ScriptTarget } from 'typescript'

/**
 * Cache for parsed SourceFile objects to avoid re-parsing
 * Key: filePath, Value: { sourceFile, contentHash, lastAccess }
 */
const sourceFileCache = new Map<string, { sourceFile: SourceFile, contentHash: number, lastAccess: number }>()

/**
 * Maximum number of cached SourceFiles to prevent memory bloat
 */
const MAX_CACHE_SIZE = 100

/**
 * Simple hash function for content comparison
 */
export function hashContent(content: string): number {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return hash
}

/**
 * Evict oldest entries if cache exceeds max size
 */
export function evictOldestEntries(): void {
  if (sourceFileCache.size <= MAX_CACHE_SIZE) {
    return
  }

  // Sort by last access time and remove oldest entries
  const entries = Array.from(sourceFileCache.entries())
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess)

  const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE)
  for (const [key] of toRemove) {
    sourceFileCache.delete(key)
  }
}

/**
 * Get or create a cached SourceFile
 */
export function getSourceFile(filePath: string, sourceCode: string): SourceFile {
  const contentHash = hashContent(sourceCode)
  const cached = sourceFileCache.get(filePath)
  const now = Date.now()

  if (cached && cached.contentHash === contentHash) {
    // Update last access time
    cached.lastAccess = now
    return cached.sourceFile
  }

  // Create new SourceFile and cache it
  const sourceFile = createSourceFile(
    filePath,
    sourceCode,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  )

  sourceFileCache.set(filePath, { sourceFile, contentHash, lastAccess: now })

  // Evict old entries if needed
  evictOldestEntries()

  return sourceFile
}

/**
 * Clear the SourceFile cache (useful for testing or memory management)
 */
export function clearSourceFileCache(): void {
  sourceFileCache.clear()
}

/**
 * Get the current cache size (useful for debugging)
 */
export function getSourceFileCacheSize(): number {
  return sourceFileCache.size
}
