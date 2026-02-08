/**
 * SourceFile caching utilities for the extractor
 * Supports both synchronous and asynchronous parsing for large files
 */

import type { SourceFile } from 'typescript'
import { createSourceFile, ScriptKind, ScriptTarget } from 'typescript'

/**
 * Cache for parsed SourceFile objects to avoid re-parsing
 * Key: filePath, Value: { sourceFile, contentHash, lastAccess }
 */
const sourceFileCache = new Map<string, { sourceFile: SourceFile, contentHash: number, lastAccess: number }>()

/**
 * Pending async parse operations to prevent duplicate parsing
 */
const pendingParses = new Map<string, Promise<SourceFile>>()

/**
 * Configuration for async parsing
 */
export interface AsyncParseConfig {
  /**
   * File size threshold (in bytes) above which to use async parsing
   * @default 100000 (100KB)
   */
  asyncThreshold?: number

  /**
   * Chunk size for yielding to event loop during parsing
   * @default 50000 (50KB)
   */
  chunkSize?: number

  /**
   * Yield interval in milliseconds
   * @default 0 (use setImmediate)
   */
  yieldInterval?: number
}

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
 * Evict oldest entry if cache exceeds max size
 * Uses O(n) scan instead of O(n log n) sort since we add one entry at a time
 */
export function evictOldestEntries(): void {
  if (sourceFileCache.size <= MAX_CACHE_SIZE) {
    return
  }

  // Find the oldest entry by last access time
  let oldestKey: string | null = null
  let oldestTime = Infinity
  for (const [key, entry] of sourceFileCache) {
    if (entry.lastAccess < oldestTime) {
      oldestTime = entry.lastAccess
      oldestKey = key
    }
  }
  if (oldestKey) {
    sourceFileCache.delete(oldestKey)
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

/**
 * Default async parsing configuration
 */
const DEFAULT_ASYNC_CONFIG: Required<AsyncParseConfig> = {
  asyncThreshold: 100000, // 100KB
  chunkSize: 50000, // 50KB
  yieldInterval: 0, // Use setImmediate
}

/**
 * Yield to the event loop
 */
function yieldToEventLoop(interval: number): Promise<void> {
  return new Promise((resolve) => {
    if (interval === 0) {
      // Use setImmediate for minimal delay
      if (typeof setImmediate !== 'undefined') {
        setImmediate(resolve)
      }
      else {
        setTimeout(resolve, 0)
      }
    }
    else {
      setTimeout(resolve, interval)
    }
  })
}

/**
 * Parse source code asynchronously with periodic yields to the event loop
 * This prevents blocking the main thread for large files
 */
async function parseSourceFileAsync(
  filePath: string,
  sourceCode: string,
  config: Required<AsyncParseConfig>,
): Promise<SourceFile> {
  // For files below the threshold, parse synchronously
  if (sourceCode.length < config.asyncThreshold) {
    return createSourceFile(
      filePath,
      sourceCode,
      ScriptTarget.Latest,
      true,
      ScriptKind.TS,
    )
  }

  // For large files, yield periodically while doing pre-processing
  // Note: TypeScript's createSourceFile is synchronous, but we can
  // yield before/after to allow other operations to proceed

  // Pre-parse yield: allow pending I/O to complete
  await yieldToEventLoop(config.yieldInterval)

  // Parse the source file (this is still synchronous in TypeScript)
  const sourceFile = createSourceFile(
    filePath,
    sourceCode,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  )

  // Post-parse yield: allow other operations to proceed
  await yieldToEventLoop(config.yieldInterval)

  return sourceFile
}

/**
 * Async version of getSourceFile that yields to the event loop for large files
 * Prevents blocking when processing many large files in parallel
 */
export async function getSourceFileAsync(
  filePath: string,
  sourceCode: string,
  config: AsyncParseConfig = {},
): Promise<SourceFile> {
  const fullConfig = { ...DEFAULT_ASYNC_CONFIG, ...config }
  const contentHash = hashContent(sourceCode)
  const cacheKey = filePath
  const now = Date.now()

  // Check cache first
  const cached = sourceFileCache.get(cacheKey)
  if (cached && cached.contentHash === contentHash) {
    cached.lastAccess = now
    return cached.sourceFile
  }

  // Check if there's already a pending parse for this file
  const pending = pendingParses.get(cacheKey)
  if (pending) {
    return pending
  }

  // Create a new parse promise
  const parsePromise = (async () => {
    try {
      const sourceFile = await parseSourceFileAsync(filePath, sourceCode, fullConfig)

      // Cache the result
      sourceFileCache.set(cacheKey, { sourceFile, contentHash, lastAccess: now })

      // Evict old entries if needed
      evictOldestEntries()

      return sourceFile
    }
    finally {
      // Remove from pending
      pendingParses.delete(cacheKey)
    }
  })()

  // Store in pending map
  pendingParses.set(cacheKey, parsePromise)

  return parsePromise
}

/**
 * Batch parse multiple files asynchronously with concurrency control
 * Useful for processing many files while keeping the event loop responsive
 */
export async function batchParseSourceFiles(
  files: Array<{ filePath: string, sourceCode: string }>,
  config: AsyncParseConfig & { concurrency?: number } = {},
): Promise<Map<string, SourceFile>> {
  const concurrency = config.concurrency ?? 4
  const results = new Map<string, SourceFile>()
  const errors: Array<{ filePath: string, error: Error }> = []

  // Process files in batches
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)

    const batchResults = await Promise.allSettled(
      batch.map(async ({ filePath, sourceCode }) => {
        const sourceFile = await getSourceFileAsync(filePath, sourceCode, config)
        return { filePath, sourceFile }
      }),
    )

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.set(result.value.filePath, result.value.sourceFile)
      }
      else {
        errors.push({
          filePath: batch[batchResults.indexOf(result)].filePath,
          error: result.reason,
        })
      }
    }

    // Yield between batches
    if (i + concurrency < files.length) {
      await yieldToEventLoop(0)
    }
  }

  // If there were errors, log them but continue
  if (errors.length > 0) {
    console.warn(`[dtsx] ${errors.length} file(s) failed to parse:`, errors.map(e => e.filePath))
  }

  return results
}

/**
 * Check if a file should use async parsing based on size
 */
export function shouldUseAsyncParsing(
  sourceCode: string,
  config: AsyncParseConfig = {},
): boolean {
  const threshold = config.asyncThreshold ?? DEFAULT_ASYNC_CONFIG.asyncThreshold
  return sourceCode.length >= threshold
}

/**
 * Get statistics about pending parse operations
 */
export function getPendingParseCount(): number {
  return pendingParses.size
}
