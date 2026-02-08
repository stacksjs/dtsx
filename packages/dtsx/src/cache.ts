import type { DtsGenerationConfig } from './types'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { hashContent } from './extractor/cache'

/**
 * Cache entry for a single file
 */
export interface CacheEntry {
  /** Source file path (relative to cwd) */
  sourcePath: string
  /** Hash of the source content */
  sourceHash: string
  /** Source file modification time */
  sourceMtime: number
  /** Generated .d.ts content */
  dtsContent: string
  /** Hash of the generated content */
  dtsHash: string
  /** Generation timestamp */
  generatedAt: number
  /** Config hash used for generation */
  configHash: string
}

/**
 * Cache manifest containing all cached entries
 */
export interface CacheManifest {
  version: number
  configHash: string
  entries: Record<string, CacheEntry>
  createdAt: number
  updatedAt: number
}

const CACHE_VERSION = 1
const CACHE_DIR = '.dtsx-cache'
const CACHE_FILE = 'manifest.json'

/**
 * Incremental build cache manager
 */
export class BuildCache {
  private cacheDir: string
  private manifestPath: string
  private manifest: CacheManifest | null = null
  private configHash: string

  constructor(config: DtsGenerationConfig) {
    this.cacheDir = resolve(config.cwd, CACHE_DIR)
    this.manifestPath = join(this.cacheDir, CACHE_FILE)
    this.configHash = this.hashConfig(config)
  }

  /**
   * Hash relevant config options that affect output
   */
  private hashConfig(config: DtsGenerationConfig): string {
    const relevantConfig = {
      keepComments: config.keepComments,
      importOrder: config.importOrder,
      outputStructure: config.outputStructure,
    }
    return String(hashContent(JSON.stringify(relevantConfig)))
  }

  /**
   * Hash file content using shared fast hash (Bun.hash when available)
   */
  private hashString(content: string): string {
    return String(hashContent(content))
  }

  /**
   * Load the cache manifest from disk
   */
  load(): boolean {
    try {
      if (!existsSync(this.manifestPath)) {
        return false
      }

      const data = readFileSync(this.manifestPath, 'utf-8')
      const manifest = JSON.parse(data) as CacheManifest

      // Check version compatibility
      if (manifest.version !== CACHE_VERSION) {
        return false
      }

      // Check config compatibility
      if (manifest.configHash !== this.configHash) {
        return false
      }

      this.manifest = manifest
      return true
    }
    catch {
      return false
    }
  }

  /**
   * Save the cache manifest to disk
   */
  save(): void {
    if (!this.manifest) {
      this.manifest = {
        version: CACHE_VERSION,
        configHash: this.configHash,
        entries: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }

    this.manifest.updatedAt = Date.now()

    // Ensure cache directory exists
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }

    writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2))
  }

  /**
   * Check if a file needs to be regenerated
   */
  needsRegeneration(filePath: string, cwd: string): boolean {
    return this.getCachedIfValid(filePath, cwd) === null
  }

  /**
   * Get cached content for a file
   */
  getCached(filePath: string, cwd: string): string | null {
    return this.getCachedIfValid(filePath, cwd)
  }

  /**
   * Get cached DTS content if the cache entry is still valid, or null if regeneration is needed.
   * Combines cache validation and retrieval in a single operation.
   */
  getCachedIfValid(filePath: string, cwd: string): string | null {
    if (!this.manifest) {
      return null
    }

    const relativePath = relative(cwd, filePath)
    const entry = this.manifest.entries[relativePath]

    if (!entry) {
      return null
    }

    try {
      const stats = statSync(filePath)
      const mtime = stats.mtimeMs

      // Quick check: modification time
      if (mtime > entry.sourceMtime) {
        // Mtime changed, verify with hash
        const content = readFileSync(filePath, 'utf-8')
        const hash = this.hashString(content)

        if (hash !== entry.sourceHash) {
          return null
        }

        // Hash matches despite mtime change (e.g., touched file)
        // Update mtime in cache
        entry.sourceMtime = mtime
      }

      return entry.dtsContent
    }
    catch {
      return null
    }
  }

  /**
   * Update cache entry for a file
   */
  update(filePath: string, sourceContent: string, dtsContent: string, cwd: string): void {
    if (!this.manifest) {
      this.manifest = {
        version: CACHE_VERSION,
        configHash: this.configHash,
        entries: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }

    const relativePath = relative(cwd, filePath)
    let mtime: number

    try {
      const stats = statSync(filePath)
      mtime = stats.mtimeMs
    }
    catch {
      mtime = Date.now()
    }

    this.manifest.entries[relativePath] = {
      sourcePath: relativePath,
      sourceHash: this.hashString(sourceContent),
      sourceMtime: mtime,
      dtsContent,
      dtsHash: this.hashString(dtsContent),
      generatedAt: Date.now(),
      configHash: this.configHash,
    }
  }

  /**
   * Remove a file from the cache
   */
  remove(filePath: string, cwd: string): void {
    if (!this.manifest) {
      return
    }

    const relativePath = relative(cwd, filePath)
    delete this.manifest.entries[relativePath]
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.manifest = null

    try {
      if (existsSync(this.manifestPath)) {
        const fs = require('node:fs')
        fs.rmSync(this.cacheDir, { recursive: true, force: true })
      }
    }
    catch {
      // Ignore errors
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { entries: number, size: number } {
    if (!this.manifest) {
      return { entries: 0, size: 0 }
    }

    const entries = Object.keys(this.manifest.entries).length
    let size = 0

    for (const entry of Object.values(this.manifest.entries)) {
      size += entry.dtsContent.length
    }

    return { entries, size }
  }

  /**
   * Prune entries for files that no longer exist
   */
  prune(existingFiles: Set<string>, cwd: string): number {
    if (!this.manifest) {
      return 0
    }

    let pruned = 0
    const relativePaths = new Set(
      Array.from(existingFiles).map(f => relative(cwd, f)),
    )

    for (const key of Object.keys(this.manifest.entries)) {
      if (!relativePaths.has(key)) {
        delete this.manifest.entries[key]
        pruned++
      }
    }

    return pruned
  }
}

/**
 * Add .dtsx-cache to .gitignore if not already present
 */
export function ensureGitignore(cwd: string): void {
  const gitignorePath = join(cwd, '.gitignore')

  try {
    let content = ''
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf-8')
    }

    if (!content.includes(CACHE_DIR)) {
      const newContent = `${content.trimEnd()}\n\n# dtsx cache\n${CACHE_DIR}/\n`
      writeFileSync(gitignorePath, newContent)
    }
  }
  catch {
    // Ignore errors
  }
}
