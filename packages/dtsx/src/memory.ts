/**
 * Memory optimization utilities for large codebase processing
 * Provides streaming, chunking, and memory management strategies
 */

import type { Declaration, DtsGenerationConfig } from './types'
import { createReadStream, createWriteStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'

/**
 * Memory configuration options
 */
export interface MemoryConfig {
  /**
   * Maximum memory usage in MB before triggering cleanup
   * @default 512
   */
  maxMemoryMB?: number

  /**
   * Chunk size for streaming operations in bytes
   * @default 65536 (64KB)
   */
  chunkSize?: number

  /**
   * Enable aggressive garbage collection hints
   * @default true
   */
  aggressiveGC?: boolean

  /**
   * Maximum declarations to keep in memory
   * @default 10000
   */
  maxDeclarationsInMemory?: number

  /**
   * Enable memory profiling
   * @default false
   */
  profile?: boolean

  /**
   * Cleanup interval in milliseconds
   * @default 5000
   */
  cleanupInterval?: number
}

/**
 * Memory usage statistics
 */
export interface MemoryStats {
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
  heapUsedMB: number
  percentUsed: number
}

/**
 * Memory profiling entry
 */
export interface MemoryProfile {
  timestamp: number
  operation: string
  memoryBefore: MemoryStats
  memoryAfter: MemoryStats
  duration: number
}

/**
 * Streaming file processor for large files
 */
export class StreamingProcessor {
  private config: Required<MemoryConfig>
  private profiles: MemoryProfile[] = []
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(config: MemoryConfig = {}) {
    this.config = {
      maxMemoryMB: config.maxMemoryMB ?? 512,
      chunkSize: config.chunkSize ?? 65536,
      aggressiveGC: config.aggressiveGC ?? true,
      maxDeclarationsInMemory: config.maxDeclarationsInMemory ?? 10000,
      profile: config.profile ?? false,
      cleanupInterval: config.cleanupInterval ?? 5000,
    }
  }

  /**
   * Start memory monitoring
   */
  startMonitoring(): void {
    this.cleanupTimer = setInterval(() => {
      this.checkMemoryAndCleanup()
    }, this.config.cleanupInterval)
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /**
   * Check memory usage and trigger cleanup if needed
   */
  private checkMemoryAndCleanup(): void {
    const stats = this.getMemoryStats()

    if (stats.heapUsedMB > this.config.maxMemoryMB) {
      this.triggerCleanup()
    }
  }

  /**
   * Trigger garbage collection and cleanup
   */
  triggerCleanup(): void {
    if (this.config.aggressiveGC && global.gc) {
      global.gc()
    }
  }

  /**
   * Get current memory statistics
   */
  getMemoryStats(): MemoryStats {
    const mem = process.memoryUsage()
    return {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      rss: mem.rss,
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      percentUsed: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    }
  }

  /**
   * Profile a memory-intensive operation
   */
  async profile<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (!this.config.profile) {
      return fn()
    }

    const memoryBefore = this.getMemoryStats()
    const startTime = Date.now()

    try {
      return await fn()
    }
    finally {
      const memoryAfter = this.getMemoryStats()
      const duration = Date.now() - startTime

      this.profiles.push({
        timestamp: Date.now(),
        operation,
        memoryBefore,
        memoryAfter,
        duration,
      })
    }
  }

  /**
   * Get profiling results
   */
  getProfiles(): MemoryProfile[] {
    return [...this.profiles]
  }

  /**
   * Clear profiling data
   */
  clearProfiles(): void {
    this.profiles = []
  }

  /**
   * Read file in streaming mode
   */
  async* streamFile(filePath: string): AsyncGenerator<string, void, unknown> {
    const fileStream = createReadStream(filePath, {
      encoding: 'utf-8',
      highWaterMark: this.config.chunkSize,
    })

    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    })

    for await (const line of rl) {
      yield line
    }
  }

  /**
   * Process file in chunks to reduce memory usage
   */
  async processFileInChunks<T>(
    filePath: string,
    processor: (chunk: string[]) => Promise<T[]>,
    chunkLines: number = 1000,
  ): Promise<T[]> {
    const results: T[] = []
    let currentChunk: string[] = []

    for await (const line of this.streamFile(filePath)) {
      currentChunk.push(line)

      if (currentChunk.length >= chunkLines) {
        const chunkResults = await processor(currentChunk)
        results.push(...chunkResults)
        currentChunk = []

        // Check memory after each chunk
        this.checkMemoryAndCleanup()
      }
    }

    // Process remaining lines
    if (currentChunk.length > 0) {
      const chunkResults = await processor(currentChunk)
      results.push(...chunkResults)
    }

    return results
  }

  /**
   * Write content in streaming mode
   */
  async streamWrite(filePath: string, contentGenerator: AsyncGenerator<string>): Promise<void> {
    const writeStream = createWriteStream(filePath, { encoding: 'utf-8' })

    return new Promise((resolve, reject) => {
      const write = async () => {
        try {
          for await (const chunk of contentGenerator) {
            const canContinue = writeStream.write(chunk)

            if (!canContinue) {
              await new Promise<void>(r => writeStream.once('drain', () => r()))
            }
          }

          writeStream.end()
          writeStream.once('finish', resolve)
        }
        catch (error) {
          reject(error)
        }
      }

      writeStream.once('error', reject)
      write()
    })
  }
}

/**
 * Declaration pool for memory-efficient declaration management
 */
export class DeclarationPool {
  private declarations = new Map<string, WeakRef<Declaration>>()
  private registry = new FinalizationRegistry<string>((key) => {
    this.declarations.delete(key)
  })

  private maxSize: number

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  /**
   * Add a declaration to the pool
   */
  add(key: string, declaration: Declaration): void {
    // Evict old entries if at capacity
    if (this.declarations.size >= this.maxSize) {
      this.evictOldest()
    }

    const ref = new WeakRef(declaration)
    this.declarations.set(key, ref)
    this.registry.register(declaration, key)
  }

  /**
   * Get a declaration from the pool
   */
  get(key: string): Declaration | undefined {
    const ref = this.declarations.get(key)
    return ref?.deref()
  }

  /**
   * Check if declaration exists
   */
  has(key: string): boolean {
    const ref = this.declarations.get(key)
    return ref?.deref() !== undefined
  }

  /**
   * Remove a declaration
   */
  delete(key: string): void {
    this.declarations.delete(key)
  }

  /**
   * Clear all declarations
   */
  clear(): void {
    this.declarations.clear()
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.declarations.size
  }

  /**
   * Evict oldest entries
   */
  private evictOldest(): void {
    // Remove 20% of entries
    const toRemove = Math.ceil(this.maxSize * 0.2)
    const keys = Array.from(this.declarations.keys())

    for (let i = 0; i < toRemove && i < keys.length; i++) {
      this.declarations.delete(keys[i])
    }
  }
}

/**
 * Lazy loading wrapper for large objects
 */
export class LazyLoader<T> {
  private value: T | null = null
  private loaded = false
  private loader: () => T | Promise<T>

  constructor(loader: () => T | Promise<T>) {
    this.loader = loader
  }

  /**
   * Get the value, loading if necessary
   */
  async get(): Promise<T> {
    if (!this.loaded) {
      this.value = await this.loader()
      this.loaded = true
    }
    return this.value!
  }

  /**
   * Check if loaded
   */
  isLoaded(): boolean {
    return this.loaded
  }

  /**
   * Unload to free memory
   */
  unload(): void {
    this.value = null
    this.loaded = false
  }
}

/**
 * String interning for memory efficiency
 */
export class StringInterner {
  private strings = new Map<string, string>()
  private maxSize: number

  constructor(maxSize: number = 50000) {
    this.maxSize = maxSize
  }

  /**
   * Intern a string
   */
  intern(str: string): string {
    if (str.length > 100) {
      // Don't intern very long strings
      return str
    }

    const existing = this.strings.get(str)
    if (existing !== undefined) {
      return existing
    }

    if (this.strings.size >= this.maxSize) {
      // Clear half the cache when full
      const keys = Array.from(this.strings.keys())
      for (let i = 0; i < keys.length / 2; i++) {
        this.strings.delete(keys[i])
      }
    }

    this.strings.set(str, str)
    return str
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.strings.size
  }

  /**
   * Clear the interner
   */
  clear(): void {
    this.strings.clear()
  }
}

/**
 * Object pool for reusing declaration objects
 */
export class ObjectPool<T> {
  private pool: T[] = []
  private factory: () => T
  private reset: (obj: T) => void
  private maxSize: number

  constructor(
    factory: () => T,
    reset: (obj: T) => void,
    maxSize: number = 1000,
  ) {
    this.factory = factory
    this.reset = reset
    this.maxSize = maxSize
  }

  /**
   * Acquire an object from the pool
   */
  acquire(): T {
    if (this.pool.length > 0) {
      return this.pool.pop()!
    }
    return this.factory()
  }

  /**
   * Release an object back to the pool
   */
  release(obj: T): void {
    if (this.pool.length < this.maxSize) {
      this.reset(obj)
      this.pool.push(obj)
    }
  }

  /**
   * Get pool size
   */
  get size(): number {
    return this.pool.length
  }

  /**
   * Clear the pool
   */
  clear(): void {
    this.pool = []
  }
}

/**
 * Create memory-optimized configuration
 */
export function createMemoryOptimizedConfig(
  baseConfig: DtsGenerationConfig,
  memoryConfig: MemoryConfig = {},
): DtsGenerationConfig & { memory: Required<MemoryConfig> } {
  return {
    ...baseConfig,
    memory: {
      maxMemoryMB: memoryConfig.maxMemoryMB ?? 512,
      chunkSize: memoryConfig.chunkSize ?? 65536,
      aggressiveGC: memoryConfig.aggressiveGC ?? true,
      maxDeclarationsInMemory: memoryConfig.maxDeclarationsInMemory ?? 10000,
      profile: memoryConfig.profile ?? false,
      cleanupInterval: memoryConfig.cleanupInterval ?? 5000,
    },
  }
}

/**
 * Estimate memory usage for a file
 */
export function estimateMemoryUsage(filePath: string): {
  fileSizeMB: number
  estimatedMemoryMB: number
  recommendedChunkSize: number
} {
  const stats = statSync(filePath)
  const fileSizeMB = stats.size / 1024 / 1024

  // Rough estimate: parsed AST is typically 3-5x file size
  const estimatedMemoryMB = fileSizeMB * 4

  // Adjust chunk size based on file size
  let recommendedChunkSize = 65536 // 64KB default

  if (fileSizeMB > 10) {
    recommendedChunkSize = 32768 // 32KB for large files
  }
  if (fileSizeMB > 50) {
    recommendedChunkSize = 16384 // 16KB for very large files
  }

  return {
    fileSizeMB: Math.round(fileSizeMB * 100) / 100,
    estimatedMemoryMB: Math.round(estimatedMemoryMB * 100) / 100,
    recommendedChunkSize,
  }
}

/**
 * Format memory stats for display
 */
export function formatMemoryStats(stats: MemoryStats): string {
  return [
    `Heap: ${stats.heapUsedMB}MB / ${Math.round(stats.heapTotal / 1024 / 1024)}MB (${stats.percentUsed}%)`,
    `RSS: ${Math.round(stats.rss / 1024 / 1024)}MB`,
    `External: ${Math.round(stats.external / 1024 / 1024)}MB`,
  ].join(' | ')
}

/**
 * Create a streaming processor with default config
 */
export function createStreamingProcessor(config: MemoryConfig = {}): StreamingProcessor {
  return new StreamingProcessor(config)
}
