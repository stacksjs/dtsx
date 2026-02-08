/**
 * Tests for the BuildCache module and ensureGitignore utility
 */

import type { DtsGenerationConfig } from '../src/types'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BuildCache, ensureGitignore } from '../src/cache'

let tempDir: string

function makeConfig(overrides: Partial<DtsGenerationConfig> = {}): DtsGenerationConfig {
  return {
    cwd: tempDir,
    root: tempDir,
    entrypoints: ['index.ts'],
    outdir: join(tempDir, 'dist'),
    keepComments: true,
    clean: false,
    tsconfigPath: join(tempDir, 'tsconfig.json'),
    verbose: false,
    ...overrides,
  }
}

function writeSourceFile(name: string, content: string): string {
  const filePath = join(tempDir, name)
  const dir = join(filePath, '..')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, content)
  return filePath
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'dtsx-cache-test-'))
})

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  }
  catch {
    // ignore cleanup errors
  }
})

describe('BuildCache', () => {
  describe('construction', () => {
    it('creates an instance with config', () => {
      const cache = new BuildCache(makeConfig())
      expect(cache).toBeInstanceOf(BuildCache)
    })

    it('creates an instance with different configs', () => {
      const cache1 = new BuildCache(makeConfig({ keepComments: true }))
      const cache2 = new BuildCache(makeConfig({ keepComments: false }))
      expect(cache1).toBeInstanceOf(BuildCache)
      expect(cache2).toBeInstanceOf(BuildCache)
    })
  })

  describe('load', () => {
    it('returns false when no cache exists', () => {
      const cache = new BuildCache(makeConfig())
      expect(cache.load()).toBe(false)
    })

    it('returns false when manifest file is corrupted', () => {
      const cacheDir = join(tempDir, '.dtsx-cache')
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(join(cacheDir, 'manifest.json'), '{ invalid json }}}')

      const cache = new BuildCache(makeConfig())
      expect(cache.load()).toBe(false)
    })

    it('returns false when cache version is mismatched', () => {
      const cacheDir = join(tempDir, '.dtsx-cache')
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(join(cacheDir, 'manifest.json'), JSON.stringify({
        version: 9999,
        configHash: 'whatever',
        entries: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }))

      const cache = new BuildCache(makeConfig())
      expect(cache.load()).toBe(false)
    })
  })

  describe('save and load round-trip', () => {
    it('save then load returns true', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)
      cache.save()

      const cache2 = new BuildCache(config)
      expect(cache2.load()).toBe(true)
    })

    it('creates the .dtsx-cache directory on save', () => {
      const cache = new BuildCache(makeConfig())
      expect(existsSync(join(tempDir, '.dtsx-cache'))).toBe(false)

      cache.save()
      expect(existsSync(join(tempDir, '.dtsx-cache'))).toBe(true)
      expect(existsSync(join(tempDir, '.dtsx-cache', 'manifest.json'))).toBe(true)
    })

    it('writes valid JSON to manifest.json', () => {
      const cache = new BuildCache(makeConfig())
      cache.save()

      const raw = readFileSync(join(tempDir, '.dtsx-cache', 'manifest.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      expect(parsed.version).toBe(1)
      expect(parsed.entries).toEqual({})
      expect(typeof parsed.configHash).toBe('string')
      expect(typeof parsed.createdAt).toBe('number')
      expect(typeof parsed.updatedAt).toBe('number')
    })
  })

  describe('update and getCachedIfValid', () => {
    it('returns dts content after update', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const foo: string = "hello"'
      const dtsContent = 'export declare const foo: string;'
      const filePath = writeSourceFile('src/foo.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)

      const result = cache.getCachedIfValid(filePath, tempDir)
      expect(result).toBe(dtsContent)
    })

    it('returns null when file content has changed', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const foo: string = "hello"'
      const dtsContent = 'export declare const foo: string;'
      const filePath = writeSourceFile('src/foo.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)

      // Overwrite the file with different content and bump mtime into the future
      // so the cache detects the change (mtime resolution can mask same-ms writes)
      writeFileSync(filePath, 'export const foo: number = 42')
      const futureTime = new Date(Date.now() + 5000)
      utimesSync(filePath, futureTime, futureTime)

      const result = cache.getCachedIfValid(filePath, tempDir)
      expect(result).toBeNull()
    })

    it('returns null when manifest has not been loaded or created', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const filePath = writeSourceFile('src/bar.ts', 'export const bar = 1')
      const result = cache.getCachedIfValid(filePath, tempDir)
      expect(result).toBeNull()
    })

    it('returns null when file does not exist on disk', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const baz = true'
      const dtsContent = 'export declare const baz: boolean;'
      const filePath = writeSourceFile('src/baz.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)

      // Delete the source file
      rmSync(filePath)

      const result = cache.getCachedIfValid(filePath, tempDir)
      expect(result).toBeNull()
    })
  })

  describe('getCached', () => {
    it('returns the same result as getCachedIfValid', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export type Foo = string'
      const dtsContent = 'export type Foo = string;'
      const filePath = writeSourceFile('src/types.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)

      expect(cache.getCached(filePath, tempDir)).toBe(cache.getCachedIfValid(filePath, tempDir))
    })
  })

  describe('needsRegeneration', () => {
    it('returns true when file is not cached', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)
      cache.save()
      cache.load()

      const filePath = writeSourceFile('src/uncached.ts', 'export const x = 1')
      expect(cache.needsRegeneration(filePath, tempDir)).toBe(true)
    })

    it('returns false when file is cached and unchanged', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const x = 1'
      const dtsContent = 'export declare const x: number;'
      const filePath = writeSourceFile('src/cached.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)

      expect(cache.needsRegeneration(filePath, tempDir)).toBe(false)
    })

    it('returns true when file has been modified', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const x = 1'
      const dtsContent = 'export declare const x: number;'
      const filePath = writeSourceFile('src/modified.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)

      // Modify the file and bump mtime so the cache detects the change
      writeFileSync(filePath, 'export const x = "changed"')
      const futureTime = new Date(Date.now() + 5000)
      utimesSync(filePath, futureTime, futureTime)

      expect(cache.needsRegeneration(filePath, tempDir)).toBe(true)
    })
  })

  describe('remove', () => {
    it('removes a cached entry', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const a = 1'
      const dtsContent = 'export declare const a: number;'
      const filePath = writeSourceFile('src/a.ts', sourceContent)

      cache.update(filePath, sourceContent, dtsContent, tempDir)
      expect(cache.getCachedIfValid(filePath, tempDir)).toBe(dtsContent)

      cache.remove(filePath, tempDir)
      expect(cache.getCachedIfValid(filePath, tempDir)).toBeNull()
    })

    it('is a no-op when manifest is not loaded', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const filePath = join(tempDir, 'src/nothing.ts')
      // Should not throw
      cache.remove(filePath, tempDir)
    })

    it('is a no-op for entries that do not exist', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)
      cache.save()
      cache.load()

      const filePath = join(tempDir, 'src/nonexistent.ts')
      // Should not throw
      cache.remove(filePath, tempDir)
    })
  })

  describe('clear', () => {
    it('removes the cache directory from disk', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)
      cache.save()

      expect(existsSync(join(tempDir, '.dtsx-cache'))).toBe(true)

      cache.clear()
      expect(existsSync(join(tempDir, '.dtsx-cache'))).toBe(false)
    })

    it('resets manifest so getStats returns zero', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const sourceContent = 'export const a = 1'
      const filePath = writeSourceFile('src/a.ts', sourceContent)
      cache.update(filePath, sourceContent, 'export declare const a: number;', tempDir)

      expect(cache.getStats().entries).toBe(1)

      cache.clear()
      expect(cache.getStats()).toEqual({ entries: 0, size: 0 })
    })

    it('does not throw when no cache exists', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)
      // Should not throw
      cache.clear()
    })
  })

  describe('getStats', () => {
    it('returns zero entries and size when no manifest exists', () => {
      const cache = new BuildCache(makeConfig())
      expect(cache.getStats()).toEqual({ entries: 0, size: 0 })
    })

    it('returns correct count after updates', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const file1 = writeSourceFile('src/one.ts', 'export const one = 1')
      const file2 = writeSourceFile('src/two.ts', 'export const two = 2')

      cache.update(file1, 'export const one = 1', 'export declare const one: number;', tempDir)
      cache.update(file2, 'export const two = 2', 'export declare const two: number;', tempDir)

      const stats = cache.getStats()
      expect(stats.entries).toBe(2)
    })

    it('returns correct size as sum of dtsContent lengths', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const dts1 = 'export declare const one: number;'
      const dts2 = 'export declare const two: string;'
      const file1 = writeSourceFile('src/one.ts', 'export const one = 1')
      const file2 = writeSourceFile('src/two.ts', 'export const two = "2"')

      cache.update(file1, 'export const one = 1', dts1, tempDir)
      cache.update(file2, 'export const two = "2"', dts2, tempDir)

      const stats = cache.getStats()
      expect(stats.size).toBe(dts1.length + dts2.length)
    })
  })

  describe('prune', () => {
    it('removes entries for files not in the existing set', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const file1 = writeSourceFile('src/keep.ts', 'export const keep = 1')
      const file2 = writeSourceFile('src/remove.ts', 'export const remove = 2')

      cache.update(file1, 'export const keep = 1', 'export declare const keep: number;', tempDir)
      cache.update(file2, 'export const remove = 2', 'export declare const remove: number;', tempDir)

      expect(cache.getStats().entries).toBe(2)

      // Only file1 exists
      const existingFiles = new Set([file1])
      const pruned = cache.prune(existingFiles, tempDir)

      expect(pruned).toBe(1)
      expect(cache.getStats().entries).toBe(1)
      expect(cache.getCachedIfValid(file1, tempDir)).not.toBeNull()
      expect(cache.getCachedIfValid(file2, tempDir)).toBeNull()
    })

    it('returns 0 when all entries are still valid', () => {
      const config = makeConfig()
      const cache = new BuildCache(config)

      const file1 = writeSourceFile('src/a.ts', 'export const a = 1')
      const file2 = writeSourceFile('src/b.ts', 'export const b = 2')

      cache.update(file1, 'export const a = 1', 'export declare const a: number;', tempDir)
      cache.update(file2, 'export const b = 2', 'export declare const b: number;', tempDir)

      const existingFiles = new Set([file1, file2])
      const pruned = cache.prune(existingFiles, tempDir)
      expect(pruned).toBe(0)
      expect(cache.getStats().entries).toBe(2)
    })

    it('returns 0 when manifest is not loaded', () => {
      const cache = new BuildCache(makeConfig())
      const pruned = cache.prune(new Set(), tempDir)
      expect(pruned).toBe(0)
    })
  })

  describe('config hash invalidation', () => {
    it('invalidates cache when keepComments changes', () => {
      const config1 = makeConfig({ keepComments: true })
      const cache1 = new BuildCache(config1)

      const sourceContent = 'export const x = 1'
      const dtsContent = 'export declare const x: number;'
      const filePath = writeSourceFile('src/x.ts', sourceContent)

      cache1.update(filePath, sourceContent, dtsContent, tempDir)
      cache1.save()

      // Load with different keepComments
      const config2 = makeConfig({ keepComments: false })
      const cache2 = new BuildCache(config2)
      expect(cache2.load()).toBe(false)
    })

    it('invalidates cache when importOrder changes', () => {
      const config1 = makeConfig({ importOrder: ['bun'] })
      const cache1 = new BuildCache(config1)
      cache1.save()

      const config2 = makeConfig({ importOrder: ['node:', 'bun'] })
      const cache2 = new BuildCache(config2)
      expect(cache2.load()).toBe(false)
    })

    it('invalidates cache when outputStructure changes', () => {
      const config1 = makeConfig({ outputStructure: 'mirror' })
      const cache1 = new BuildCache(config1)
      cache1.save()

      const config2 = makeConfig({ outputStructure: 'flat' })
      const cache2 = new BuildCache(config2)
      expect(cache2.load()).toBe(false)
    })

    it('preserves cache when irrelevant config changes', () => {
      const config1 = makeConfig({ verbose: false })
      const cache1 = new BuildCache(config1)
      cache1.save()

      // verbose is not part of the hashed config
      const config2 = makeConfig({ verbose: true })
      const cache2 = new BuildCache(config2)
      expect(cache2.load()).toBe(true)
    })
  })

  describe('persistence across instances', () => {
    it('persists entries across save/load cycle', () => {
      const config = makeConfig()
      const sourceContent = 'export const persisted = true'
      const dtsContent = 'export declare const persisted: boolean;'
      const filePath = writeSourceFile('src/persist.ts', sourceContent)

      const cache1 = new BuildCache(config)
      cache1.update(filePath, sourceContent, dtsContent, tempDir)
      cache1.save()

      const cache2 = new BuildCache(config)
      cache2.load()
      expect(cache2.getCachedIfValid(filePath, tempDir)).toBe(dtsContent)
    })
  })
})

describe('ensureGitignore', () => {
  it('creates .gitignore with .dtsx-cache entry when none exists', () => {
    ensureGitignore(tempDir)

    const gitignorePath = join(tempDir, '.gitignore')
    expect(existsSync(gitignorePath)).toBe(true)

    const content = readFileSync(gitignorePath, 'utf-8')
    expect(content).toContain('.dtsx-cache/')
  })

  it('appends .dtsx-cache to existing .gitignore', () => {
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/\ndist/\n')

    ensureGitignore(tempDir)

    const content = readFileSync(join(tempDir, '.gitignore'), 'utf-8')
    expect(content).toContain('node_modules/')
    expect(content).toContain('dist/')
    expect(content).toContain('.dtsx-cache/')
  })

  it('does not duplicate .dtsx-cache if already present', () => {
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/\n.dtsx-cache/\n')

    ensureGitignore(tempDir)

    const content = readFileSync(join(tempDir, '.gitignore'), 'utf-8')
    const occurrences = content.split('.dtsx-cache').length - 1
    expect(occurrences).toBe(1)
  })
})
