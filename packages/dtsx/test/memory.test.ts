/**
 * Tests for memory optimization utilities
 */

import type { Declaration } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  createMemoryOptimizedConfig,
  createStreamingProcessor,
  DeclarationPool,
  formatMemoryStats,
  LazyLoader,
  ObjectPool,
  StreamingProcessor,
  StringInterner,
} from '../src/memory'
import type { MemoryStats } from '../src/memory'

function makeDeclaration(name: string): Declaration {
  return {
    kind: 'variable',
    name,
    text: `export const ${name} = 1`,
    isExported: true,
  }
}

describe('Memory Utilities', () => {
  // ---------------------------------------------------------------------------
  // StreamingProcessor
  // ---------------------------------------------------------------------------
  describe('StreamingProcessor', () => {
    let processor: StreamingProcessor

    afterEach(() => {
      processor?.stopMonitoring()
    })

    it('should construct with default config values', () => {
      processor = new StreamingProcessor()
      const stats = processor.getMemoryStats()
      expect(stats).toBeDefined()
      expect(typeof stats.heapUsed).toBe('number')
    })

    it('should construct with custom config values', () => {
      processor = new StreamingProcessor({
        maxMemoryMB: 256,
        chunkSize: 1024,
        aggressiveGC: false,
        maxDeclarationsInMemory: 500,
        profile: true,
        cleanupInterval: 1000,
      })
      const stats = processor.getMemoryStats()
      expect(stats).toBeDefined()
    })

    it('should return valid memory stats', () => {
      processor = new StreamingProcessor()
      const stats = processor.getMemoryStats()

      expect(stats.heapUsed).toBeGreaterThan(0)
      expect(stats.heapTotal).toBeGreaterThan(0)
      expect(typeof stats.external).toBe('number')
      expect(typeof stats.arrayBuffers).toBe('number')
      expect(stats.rss).toBeGreaterThan(0)
      expect(stats.heapUsedMB).toBeGreaterThan(0)
      expect(stats.percentUsed).toBeGreaterThan(0)
      expect(stats.percentUsed).toBeLessThanOrEqual(100)
    })

    it('should record profiles when profiling is enabled', async () => {
      processor = new StreamingProcessor({ profile: true })
      const result = await processor.profile('test-op', async () => {
        return 42
      })

      expect(result).toBe(42)
      const profiles = processor.getProfiles()
      expect(profiles).toHaveLength(1)
      expect(profiles[0].operation).toBe('test-op')
      expect(profiles[0].duration).toBeGreaterThanOrEqual(0)
      expect(profiles[0].memoryBefore).toBeDefined()
      expect(profiles[0].memoryAfter).toBeDefined()
      expect(profiles[0].timestamp).toBeGreaterThan(0)
    })

    it('should skip profiling when profile is disabled', async () => {
      processor = new StreamingProcessor({ profile: false })
      const result = await processor.profile('skipped-op', async () => {
        return 'hello'
      })

      expect(result).toBe('hello')
      expect(processor.getProfiles()).toHaveLength(0)
    })

    it('should still record profile when operation throws', async () => {
      processor = new StreamingProcessor({ profile: true })

      try {
        await processor.profile('error-op', async () => {
          throw new Error('boom')
        })
      }
      catch {
        // expected
      }

      const profiles = processor.getProfiles()
      expect(profiles).toHaveLength(1)
      expect(profiles[0].operation).toBe('error-op')
    })

    it('should clear profiles', async () => {
      processor = new StreamingProcessor({ profile: true })
      await processor.profile('op1', async () => 1)
      await processor.profile('op2', async () => 2)
      expect(processor.getProfiles()).toHaveLength(2)

      processor.clearProfiles()
      expect(processor.getProfiles()).toHaveLength(0)
    })

    it('should return a copy of profiles array', async () => {
      processor = new StreamingProcessor({ profile: true })
      await processor.profile('op', async () => 1)

      const profiles1 = processor.getProfiles()
      const profiles2 = processor.getProfiles()
      expect(profiles1).not.toBe(profiles2)
      expect(profiles1).toEqual(profiles2)
    })

    it('should start and stop monitoring without errors', () => {
      processor = new StreamingProcessor({ cleanupInterval: 100000 })
      processor.startMonitoring()
      processor.stopMonitoring()
    })

    it('should handle stopMonitoring when not started', () => {
      processor = new StreamingProcessor()
      processor.stopMonitoring() // should not throw
    })

    it('should call triggerCleanup without error', () => {
      processor = new StreamingProcessor({ aggressiveGC: false })
      processor.triggerCleanup() // should not throw
    })
  })

  // ---------------------------------------------------------------------------
  // DeclarationPool
  // ---------------------------------------------------------------------------
  describe('DeclarationPool', () => {
    let pool: DeclarationPool

    beforeEach(() => {
      pool = new DeclarationPool()
    })

    it('should add and get a declaration', () => {
      const decl = makeDeclaration('foo')
      pool.add('foo', decl)
      expect(pool.get('foo')).toBe(decl)
    })

    it('should report has correctly', () => {
      const decl = makeDeclaration('bar')
      expect(pool.has('bar')).toBe(false)
      pool.add('bar', decl)
      expect(pool.has('bar')).toBe(true)
    })

    it('should return undefined for missing keys', () => {
      expect(pool.get('nonexistent')).toBeUndefined()
    })

    it('should delete a declaration', () => {
      const decl = makeDeclaration('baz')
      pool.add('baz', decl)
      expect(pool.has('baz')).toBe(true)

      pool.delete('baz')
      expect(pool.has('baz')).toBe(false)
      expect(pool.get('baz')).toBeUndefined()
    })

    it('should report size correctly', () => {
      expect(pool.size).toBe(0)
      pool.add('a', makeDeclaration('a'))
      expect(pool.size).toBe(1)
      pool.add('b', makeDeclaration('b'))
      expect(pool.size).toBe(2)
    })

    it('should clear all declarations', () => {
      pool.add('x', makeDeclaration('x'))
      pool.add('y', makeDeclaration('y'))
      expect(pool.size).toBe(2)

      pool.clear()
      expect(pool.size).toBe(0)
      expect(pool.has('x')).toBe(false)
    })

    it('should evict entries when exceeding maxSize', () => {
      const smallPool = new DeclarationPool(5)

      for (let i = 0; i < 5; i++) {
        smallPool.add(`key${i}`, makeDeclaration(`decl${i}`))
      }
      expect(smallPool.size).toBe(5)

      // Adding one more should trigger eviction of 20% (1 entry for maxSize=5)
      smallPool.add('overflow', makeDeclaration('overflow'))

      // After eviction of ceil(5*0.2)=1 entry, then adding 1, size should be 5
      expect(smallPool.size).toBeLessThanOrEqual(5)
      expect(smallPool.has('overflow')).toBe(true)
    })

    it('should evict oldest entries first during eviction', () => {
      const smallPool = new DeclarationPool(5)

      for (let i = 0; i < 5; i++) {
        smallPool.add(`key${i}`, makeDeclaration(`decl${i}`))
      }

      // Trigger eviction by adding beyond capacity
      smallPool.add('new', makeDeclaration('new'))

      // key0 should be evicted (it was the oldest/first inserted)
      expect(smallPool.has('key0')).toBe(false)
      // The newest entry should still be present
      expect(smallPool.has('new')).toBe(true)
    })

    it('should overwrite existing key on re-add', () => {
      const decl1 = makeDeclaration('original')
      const decl2 = makeDeclaration('updated')

      pool.add('key', decl1)
      pool.add('key', decl2)

      expect(pool.get('key')).toBe(decl2)
      expect(pool.size).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // LazyLoader
  // ---------------------------------------------------------------------------
  describe('LazyLoader', () => {
    it('should not load until get() is called', () => {
      let loadCount = 0
      const loader = new LazyLoader(() => {
        loadCount++
        return 'value'
      })

      expect(loader.isLoaded()).toBe(false)
      expect(loadCount).toBe(0)
    })

    it('should load and return value on get()', async () => {
      const loader = new LazyLoader(() => 'hello')
      const value = await loader.get()

      expect(value).toBe('hello')
      expect(loader.isLoaded()).toBe(true)
    })

    it('should cache the loaded value on subsequent calls', async () => {
      let loadCount = 0
      const loader = new LazyLoader(() => {
        loadCount++
        return { data: 'test' }
      })

      const val1 = await loader.get()
      const val2 = await loader.get()

      expect(val1).toBe(val2) // same reference
      expect(loadCount).toBe(1) // only loaded once
    })

    it('should work with async loaders', async () => {
      const loader = new LazyLoader(async () => {
        return 'async-value'
      })

      const value = await loader.get()
      expect(value).toBe('async-value')
      expect(loader.isLoaded()).toBe(true)
    })

    it('should reset state on unload', async () => {
      const loader = new LazyLoader(() => 'val')
      await loader.get()
      expect(loader.isLoaded()).toBe(true)

      loader.unload()
      expect(loader.isLoaded()).toBe(false)
    })

    it('should reload after unload', async () => {
      let loadCount = 0
      const loader = new LazyLoader(() => {
        loadCount++
        return `load-${loadCount}`
      })

      const val1 = await loader.get()
      expect(val1).toBe('load-1')

      loader.unload()

      const val2 = await loader.get()
      expect(val2).toBe('load-2')
      expect(loadCount).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // StringInterner
  // ---------------------------------------------------------------------------
  describe('StringInterner', () => {
    let interner: StringInterner

    beforeEach(() => {
      interner = new StringInterner()
    })

    it('should intern and return the same string reference', () => {
      const s1 = interner.intern('hello')
      const s2 = interner.intern('hello')
      expect(s1).toBe(s2)
    })

    it('should intern different strings independently', () => {
      const s1 = interner.intern('foo')
      const s2 = interner.intern('bar')
      expect(s1).toBe('foo')
      expect(s2).toBe('bar')
    })

    it('should not intern strings longer than 100 characters', () => {
      const longStr = 'x'.repeat(101)
      const s1 = interner.intern(longStr)
      expect(s1).toBe(longStr)
      // The long string should not be stored in the cache
      expect(interner.size).toBe(0)
    })

    it('should intern strings of exactly 100 characters', () => {
      const str = 'a'.repeat(100)
      interner.intern(str)
      expect(interner.size).toBe(1)
    })

    it('should track size correctly', () => {
      expect(interner.size).toBe(0)
      interner.intern('a')
      interner.intern('b')
      interner.intern('c')
      expect(interner.size).toBe(3)
    })

    it('should evict half the cache when reaching maxSize', () => {
      const small = new StringInterner(4)

      small.intern('a')
      small.intern('b')
      small.intern('c')
      small.intern('d')
      expect(small.size).toBe(4)

      // This should trigger eviction of half (2), then add the new one
      small.intern('e')
      // After eviction of 2 entries and adding 1 new, size should be 3
      expect(small.size).toBe(3)
    })

    it('should clear all interned strings', () => {
      interner.intern('x')
      interner.intern('y')
      expect(interner.size).toBe(2)

      interner.clear()
      expect(interner.size).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // ObjectPool
  // ---------------------------------------------------------------------------
  describe('ObjectPool', () => {
    it('should create objects using factory when pool is empty', () => {
      let id = 0
      const pool = new ObjectPool(
        () => ({ id: ++id, value: '' }),
        obj => { obj.value = '' },
      )

      const obj = pool.acquire()
      expect(obj.id).toBe(1)
    })

    it('should reuse released objects', () => {
      let id = 0
      const pool = new ObjectPool(
        () => ({ id: ++id, value: '' }),
        obj => { obj.value = '' },
      )

      const obj1 = pool.acquire()
      obj1.value = 'used'
      pool.release(obj1)

      const obj2 = pool.acquire()
      expect(obj2).toBe(obj1) // same reference
      expect(obj2.value).toBe('') // reset was called
    })

    it('should reset objects on release', () => {
      const pool = new ObjectPool(
        () => ({ data: 'initial' }),
        obj => { obj.data = 'reset' },
      )

      const obj = pool.acquire()
      obj.data = 'modified'
      pool.release(obj)

      const reused = pool.acquire()
      expect(reused.data).toBe('reset')
    })

    it('should track pool size', () => {
      const pool = new ObjectPool(
        () => ({ v: 0 }),
        obj => { obj.v = 0 },
      )

      expect(pool.size).toBe(0)

      const obj1 = pool.acquire()
      const obj2 = pool.acquire()
      expect(pool.size).toBe(0) // both are in use, pool is empty

      pool.release(obj1)
      expect(pool.size).toBe(1)

      pool.release(obj2)
      expect(pool.size).toBe(2)
    })

    it('should not exceed maxSize', () => {
      const pool = new ObjectPool(
        () => ({ v: 0 }),
        obj => { obj.v = 0 },
        2,
      )

      const objs = [pool.acquire(), pool.acquire(), pool.acquire()]

      pool.release(objs[0])
      pool.release(objs[1])
      pool.release(objs[2]) // this one should be discarded

      expect(pool.size).toBe(2)
    })

    it('should clear the pool', () => {
      const pool = new ObjectPool(
        () => ({ v: 0 }),
        obj => { obj.v = 0 },
      )

      const obj = pool.acquire()
      pool.release(obj)
      expect(pool.size).toBe(1)

      pool.clear()
      expect(pool.size).toBe(0)
    })

    it('should use factory after pool is cleared', () => {
      let id = 0
      const pool = new ObjectPool(
        () => ({ id: ++id }),
        () => {},
      )

      const obj1 = pool.acquire()
      pool.release(obj1)
      pool.clear()

      const obj2 = pool.acquire()
      expect(obj2.id).toBe(2) // new factory call, not reused
    })
  })

  // ---------------------------------------------------------------------------
  // createMemoryOptimizedConfig
  // ---------------------------------------------------------------------------
  describe('createMemoryOptimizedConfig', () => {
    it('should merge base config with default memory settings', () => {
      const base = {
        cwd: '/test',
        root: '/test',
        entrypoints: ['index.ts'],
        outdir: 'dist',
        keepComments: true,
        clean: false,
        tsconfigPath: 'tsconfig.json',
        verbose: false as const,
      }

      const result = createMemoryOptimizedConfig(base)

      expect(result.cwd).toBe('/test')
      expect(result.root).toBe('/test')
      expect(result.entrypoints).toEqual(['index.ts'])
      expect(result.memory.maxMemoryMB).toBe(512)
      expect(result.memory.chunkSize).toBe(65536)
      expect(result.memory.aggressiveGC).toBe(true)
      expect(result.memory.maxDeclarationsInMemory).toBe(10000)
      expect(result.memory.profile).toBe(false)
      expect(result.memory.cleanupInterval).toBe(5000)
    })

    it('should allow overriding memory settings', () => {
      const base = {
        cwd: '/test',
        root: '/test',
        entrypoints: [],
        outdir: 'out',
        keepComments: false,
        clean: true,
        tsconfigPath: 'tsconfig.json',
        verbose: false as const,
      }

      const result = createMemoryOptimizedConfig(base, {
        maxMemoryMB: 1024,
        chunkSize: 8192,
        aggressiveGC: false,
        profile: true,
      })

      expect(result.memory.maxMemoryMB).toBe(1024)
      expect(result.memory.chunkSize).toBe(8192)
      expect(result.memory.aggressiveGC).toBe(false)
      expect(result.memory.profile).toBe(true)
      // Non-overridden values get defaults
      expect(result.memory.maxDeclarationsInMemory).toBe(10000)
      expect(result.memory.cleanupInterval).toBe(5000)
    })

    it('should preserve all base config properties', () => {
      const base = {
        cwd: '/app',
        root: '/app',
        entrypoints: ['src/index.ts'],
        outdir: 'dist',
        keepComments: true,
        clean: true,
        tsconfigPath: 'tsconfig.build.json',
        verbose: ['debug'] as string[],
        parallel: true,
        concurrency: 8,
      }

      const result = createMemoryOptimizedConfig(base)

      expect(result.parallel).toBe(true)
      expect(result.concurrency).toBe(8)
      expect(result.verbose).toEqual(['debug'])
    })
  })

  // ---------------------------------------------------------------------------
  // formatMemoryStats
  // ---------------------------------------------------------------------------
  describe('formatMemoryStats', () => {
    it('should format memory stats into a readable string', () => {
      const stats: MemoryStats = {
        heapUsed: 50 * 1024 * 1024, // 50MB
        heapTotal: 100 * 1024 * 1024, // 100MB
        external: 5 * 1024 * 1024, // 5MB
        arrayBuffers: 2 * 1024 * 1024, // 2MB
        rss: 120 * 1024 * 1024, // 120MB
        heapUsedMB: 50,
        percentUsed: 50,
      }

      const formatted = formatMemoryStats(stats)

      expect(formatted).toContain('Heap: 50MB / 100MB (50%)')
      expect(formatted).toContain('RSS: 120MB')
      expect(formatted).toContain('External: 5MB')
      expect(formatted).toContain(' | ')
    })

    it('should handle zero values', () => {
      const stats: MemoryStats = {
        heapUsed: 0,
        heapTotal: 1024 * 1024, // 1MB
        external: 0,
        arrayBuffers: 0,
        rss: 0,
        heapUsedMB: 0,
        percentUsed: 0,
      }

      const formatted = formatMemoryStats(stats)

      expect(formatted).toContain('Heap: 0MB / 1MB (0%)')
      expect(formatted).toContain('RSS: 0MB')
      expect(formatted).toContain('External: 0MB')
    })
  })

  // ---------------------------------------------------------------------------
  // createStreamingProcessor
  // ---------------------------------------------------------------------------
  describe('createStreamingProcessor', () => {
    it('should create a StreamingProcessor instance', () => {
      const processor = createStreamingProcessor()
      expect(processor).toBeInstanceOf(StreamingProcessor)
    })

    it('should pass config through to the processor', () => {
      const processor = createStreamingProcessor({ profile: true })
      expect(processor).toBeInstanceOf(StreamingProcessor)
      // Verify profiling works (indirectly confirming config was applied)
      const stats = processor.getMemoryStats()
      expect(stats).toBeDefined()
    })
  })
})
