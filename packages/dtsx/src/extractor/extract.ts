/**
 * Lightweight extraction module — NO TypeScript dependency.
 * Only uses the string-based scanner for maximum startup speed.
 * Used by process-source.ts and the CLI fast path.
 */

import type { Declaration } from '../types'
import { hashContent } from './hash'
import { scanDeclarations } from './scanner'

const MAX_DECLARATION_CACHE_SIZE = 100
let _accessCounter = 0
const declarationCache = new Map<string, { declarations: Declaration[], contentHash: number | bigint, lastAccess: number }>()

/**
 * Extract declarations using the fast string scanner (no TS parser).
 * Results are cached by file path + keepComments flag.
 */
export function extractDeclarations(
  sourceCode: string,
  filePath: string,
  keepComments: boolean = true,
  isolatedDeclarations: boolean = false,
): Declaration[] {
  const contentHash = hashContent(sourceCode)
  const cacheKey = `${filePath}:${keepComments ? 1 : 0}:${isolatedDeclarations ? 1 : 0}`
  const cached = declarationCache.get(cacheKey)

  if (cached && cached.contentHash === contentHash) {
    cached.lastAccess = ++_accessCounter
    return cached.declarations
  }

  const declarations = scanDeclarations(sourceCode, filePath, keepComments, isolatedDeclarations)

  declarationCache.set(cacheKey, { declarations, contentHash, lastAccess: ++_accessCounter })

  if (declarationCache.size > MAX_DECLARATION_CACHE_SIZE) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of declarationCache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) {
      declarationCache.delete(oldestKey)
    }
  }

  return declarations
}

/**
 * Clear the declaration cache (for benchmarks and testing)
 */
export function clearDeclarationCache(): void {
  declarationCache.clear()
}
