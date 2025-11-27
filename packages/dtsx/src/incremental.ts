/**
 * Incremental build support for faster rebuilds
 * Caches AST, declarations, and file hashes to skip unchanged files
 */

import type { Declaration, DtsGenerationConfig } from './types'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Incremental build configuration
 */
export interface IncrementalConfig {
  /**
   * Enable incremental builds
   * @default true
   */
  enabled?: boolean

  /**
   * Cache directory path
   * @default '.dtsx-cache'
   */
  cacheDir?: string

  /**
   * Cache format
   * @default 'json'
   */
  format?: 'json' | 'binary'

  /**
   * Maximum cache age in milliseconds
   * @default 86400000 (24 hours)
   */
  maxAge?: number

  /**
   * Force rebuild even if cache is valid
   * @default false
   */
  force?: boolean

  /**
   * Validate cache integrity
   * @default true
   */
  validateCache?: boolean
}

/**
 * Cached file entry for incremental builds
 */
export interface IncrementalCacheEntry {
  /** File path */
  filePath: string
  /** Content hash */
  hash: string
  /** Last modified time */
  mtime: number
  /** Cached declarations */
  declarations: Declaration[]
  /** Generated .d.ts content */
  dtsContent: string
  /** Dependencies (imported files) */
  dependencies: string[]
  /** Cache timestamp */
  cachedAt: number
  /** Config hash (to invalidate on config change) */
  configHash: string
}

/**
 * Cache manifest for incremental builds
 */
export interface IncrementalCacheManifest {
  version: string
  entries: Record<string, IncrementalCacheEntry>
  createdAt: number
  updatedAt: number
}

/**
 * Incremental build result
 */
export interface IncrementalBuildResult {
  /** Files that were rebuilt */
  rebuilt: string[]
  /** Files that used cache */
  cached: string[]
  /** Files that were skipped (no changes) */
  skipped: string[]
  /** Cache statistics */
  stats: CacheStats
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total entries in cache */
  totalEntries: number
  /** Cache hits */
  hits: number
  /** Cache misses */
  misses: number
  /** Hit ratio */
  hitRatio: number
  /** Cache size in bytes */
  sizeBytes: number
  /** Time saved (estimated) */
  timeSavedMs: number
}

const CACHE_VERSION = '1.0.0'
const DEFAULT_CACHE_DIR = '.dtsx-cache'
const MANIFEST_FILE = 'manifest.json'

/**
 * Incremental build cache manager
 */
export class IncrementalCache {
  private config: Required<IncrementalConfig>
  private manifest: IncrementalCacheManifest | null = null
  private dirty = false
  private stats: CacheStats = {
    totalEntries: 0,
    hits: 0,
    misses: 0,
    hitRatio: 0,
    sizeBytes: 0,
    timeSavedMs: 0,
  }

  constructor(config: IncrementalConfig = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      cacheDir: config.cacheDir ?? DEFAULT_CACHE_DIR,
      format: config.format ?? 'json',
      maxAge: config.maxAge ?? 86400000,
      force: config.force ?? false,
      validateCache: config.validateCache ?? true,
    }
  }

  /**
   * Initialize the cache
   */
  async init(): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    try {
      await mkdir(this.config.cacheDir, { recursive: true })
      await this.loadManifest()
    }
    catch {
      // Create fresh manifest
      this.manifest = {
        version: CACHE_VERSION,
        entries: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
  }

  /**
   * Load cache manifest
   */
  private async loadManifest(): Promise<void> {
    const manifestPath = join(this.config.cacheDir, MANIFEST_FILE)

    try {
      const content = await readFile(manifestPath, 'utf-8')
      this.manifest = JSON.parse(content)

      // Version check
      if (this.manifest!.version !== CACHE_VERSION) {
        await this.clear()
        return
      }

      this.stats.totalEntries = Object.keys(this.manifest!.entries).length
    }
    catch {
      this.manifest = {
        version: CACHE_VERSION,
        entries: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
  }

  /**
   * Save cache manifest
   */
  async save(): Promise<void> {
    if (!this.config.enabled || !this.manifest || !this.dirty) {
      return
    }

    const manifestPath = join(this.config.cacheDir, MANIFEST_FILE)
    this.manifest.updatedAt = Date.now()

    await writeFile(manifestPath, JSON.stringify(this.manifest, null, 2))
    this.dirty = false
  }

  /**
   * Get cached entry for a file
   */
  async get(
    filePath: string,
    configHash: string,
  ): Promise<IncrementalCacheEntry | null> {
    if (!this.config.enabled || !this.manifest || this.config.force) {
      this.stats.misses++
      return null
    }

    const entry = this.manifest.entries[filePath]

    if (!entry) {
      this.stats.misses++
      return null
    }

    // Check config hash
    if (entry.configHash !== configHash) {
      this.stats.misses++
      return null
    }

    // Check max age
    if (Date.now() - entry.cachedAt > this.config.maxAge) {
      this.stats.misses++
      delete this.manifest.entries[filePath]
      this.dirty = true
      return null
    }

    // Validate file hasn't changed
    if (this.config.validateCache) {
      try {
        const fileStat = await stat(filePath)
        const currentMtime = fileStat.mtimeMs

        // Quick check: mtime changed
        if (currentMtime !== entry.mtime) {
          // Verify with hash
          const content = await readFile(filePath, 'utf-8')
          const currentHash = this.hashContent(content)

          if (currentHash !== entry.hash) {
            this.stats.misses++
            return null
          }

          // Update mtime in cache
          entry.mtime = currentMtime
          this.dirty = true
        }
      }
      catch {
        this.stats.misses++
        delete this.manifest.entries[filePath]
        this.dirty = true
        return null
      }
    }

    // Check dependencies haven't changed
    for (const dep of entry.dependencies) {
      const depEntry = this.manifest.entries[dep]
      if (depEntry) {
        try {
          const depStat = await stat(dep)
          if (depStat.mtimeMs !== depEntry.mtime) {
            this.stats.misses++
            return null
          }
        }
        catch {
          // Dependency file missing
          this.stats.misses++
          return null
        }
      }
    }

    this.stats.hits++
    this.stats.timeSavedMs += 50 // Estimated time saved per cache hit
    this.updateHitRatio()

    return entry
  }

  /**
   * Set cached entry for a file
   */
  async set(
    filePath: string,
    content: string,
    declarations: Declaration[],
    dtsContent: string,
    dependencies: string[],
    configHash: string,
  ): Promise<void> {
    if (!this.config.enabled || !this.manifest) {
      return
    }

    let mtime = Date.now()
    try {
      const fileStat = await stat(filePath)
      mtime = fileStat.mtimeMs
    }
    catch {
      // Use current time if file doesn't exist
    }

    const entry: IncrementalCacheEntry = {
      filePath,
      hash: this.hashContent(content),
      mtime,
      declarations,
      dtsContent,
      dependencies,
      cachedAt: Date.now(),
      configHash,
    }

    this.manifest.entries[filePath] = entry
    this.stats.totalEntries = Object.keys(this.manifest.entries).length
    this.dirty = true
  }

  /**
   * Invalidate cache for a file
   */
  invalidate(filePath: string): void {
    if (!this.manifest) {
      return
    }

    delete this.manifest.entries[filePath]
    this.dirty = true

    // Also invalidate files that depend on this file
    for (const [path, entry] of Object.entries(this.manifest.entries)) {
      if (entry.dependencies.includes(filePath)) {
        delete this.manifest.entries[path]
      }
    }
  }

  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    this.manifest = {
      version: CACHE_VERSION,
      entries: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    this.stats = {
      totalEntries: 0,
      hits: 0,
      misses: 0,
      hitRatio: 0,
      sizeBytes: 0,
      timeSavedMs: 0,
    }
    this.dirty = true
    await this.save()
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * Hash file content
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  /**
   * Update hit ratio
   */
  private updateHitRatio(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRatio = total > 0 ? this.stats.hits / total : 0
  }

  /**
   * Hash configuration for cache invalidation
   */
  static hashConfig(config: DtsGenerationConfig): string {
    const relevantConfig = {
      outdir: config.outdir,
      clean: config.clean,
      tsconfigPath: config.tsconfigPath,
      // Add other config properties that affect output
    }
    return createHash('sha256')
      .update(JSON.stringify(relevantConfig))
      .digest('hex')
      .slice(0, 16)
  }
}

/**
 * Create an incremental build wrapper
 */
export function createIncrementalBuilder(
  cache: IncrementalCache,
  configHash: string,
) {
  const rebuilt: string[] = []
  const cached: string[] = []
  const skipped: string[] = []

  return {
    /**
     * Check if file needs rebuild
     */
    async needsRebuild(filePath: string): Promise<boolean> {
      const entry = await cache.get(filePath, configHash)
      return entry === null
    },

    /**
     * Get cached declarations for a file
     */
    async getCachedDeclarations(filePath: string): Promise<Declaration[] | null> {
      const entry = await cache.get(filePath, configHash)
      if (entry) {
        cached.push(filePath)
        return entry.declarations
      }
      return null
    },

    /**
     * Get cached .d.ts content for a file
     */
    async getCachedDts(filePath: string): Promise<string | null> {
      const entry = await cache.get(filePath, configHash)
      if (entry) {
        return entry.dtsContent
      }
      return null
    },

    /**
     * Cache build result for a file
     */
    async cacheResult(
      filePath: string,
      content: string,
      declarations: Declaration[],
      dtsContent: string,
      dependencies: string[] = [],
    ): Promise<void> {
      await cache.set(filePath, content, declarations, dtsContent, dependencies, configHash)
      rebuilt.push(filePath)
    },

    /**
     * Mark file as skipped (unchanged)
     */
    skip(filePath: string): void {
      skipped.push(filePath)
    },

    /**
     * Get build result
     */
    getResult(): IncrementalBuildResult {
      return {
        rebuilt,
        cached,
        skipped,
        stats: cache.getStats(),
      }
    },

    /**
     * Save cache
     */
    async save(): Promise<void> {
      await cache.save()
    },
  }
}

/**
 * Prune old cache entries
 */
export async function pruneCache(
  cache: IncrementalCache,
  _maxAge: number = 86400000 * 7, // 7 days default
): Promise<number> {
  const stats = cache.getStats()
  // This would need access to internal manifest
  // For now, just clear if too old
  if (stats.totalEntries > 1000) {
    await cache.clear()
    return stats.totalEntries
  }
  return 0
}

/**
 * Format incremental build result
 */
export function formatIncrementalResult(result: IncrementalBuildResult): string {
  const lines: string[] = []

  lines.push(`Incremental Build Results:`)
  lines.push(`  Rebuilt: ${result.rebuilt.length} files`)
  lines.push(`  From cache: ${result.cached.length} files`)
  lines.push(`  Skipped: ${result.skipped.length} files`)
  lines.push(``)
  lines.push(`Cache Statistics:`)
  lines.push(`  Total entries: ${result.stats.totalEntries}`)
  lines.push(`  Hit ratio: ${(result.stats.hitRatio * 100).toFixed(1)}%`)
  lines.push(`  Time saved: ~${result.stats.timeSavedMs}ms`)

  return lines.join('\n')
}

/**
 * Extract dependencies from source content
 */
export function extractDependencies(content: string, basePath: string): string[] {
  const deps: string[] = []
  const importRegex = /import\s+(?:type\s+)?(?:.+(?:[\n\r\u2028\u2029]\s*|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])from\s+)?['"]([^'"]+)['"]/g

  let match
  while ((match = importRegex.exec(content)) !== null) {
    const importPath = match[1]

    // Only track relative imports
    if (importPath.startsWith('.')) {
      const resolved = join(dirname(basePath), importPath)
      // Add common extensions
      deps.push(resolved)
      deps.push(`${resolved}.ts`)
      deps.push(`${resolved}.tsx`)
      deps.push(join(resolved, 'index.ts'))
      deps.push(join(resolved, 'index.tsx'))
    }
  }

  return deps
}
