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
    // Batch evict ~10% to amortize O(n) scan cost
    const toEvict = Math.max(1, Math.ceil(declarationCache.size * 0.1))
    const entries: [string, number][] = []
    for (const [key, entry] of declarationCache) {
      entries.push([key, entry.lastAccess])
    }
    entries.sort((a, b) => a[1] - b[1])
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      declarationCache.delete(entries[i][0])
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
