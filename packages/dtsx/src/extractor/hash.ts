/**
 * Fast hash function for content comparison.
 * This module is intentionally TS-free to keep the hot path lightweight.
 */

const hasBunHash = typeof globalThis.Bun?.hash === 'function'

export function hashContent(content: string): number | bigint {
  if (hasBunHash) {
    return Bun.hash(content)
  }
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash
}
