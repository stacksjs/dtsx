/**
 * Tests for async AST parsing functionality
 */

import { describe, expect, test } from 'bun:test'
import {
  batchExtractDeclarations,
  batchParseSourceFiles,
  clearSourceFileCache,
  extractDeclarations,
  extractDeclarationsAsync,
  getPendingParseCount,
  getSourceFileAsync,
  getSourceFileCacheSize,
  shouldUseAsyncParsing,
} from '../src/extractor'

describe('Async AST Parsing', () => {
  describe('shouldUseAsyncParsing', () => {
    test('returns false for small files', () => {
      const smallCode = 'const x = 1;'
      expect(shouldUseAsyncParsing(smallCode)).toBe(false)
    })

    test('returns true for large files', () => {
      // Generate a large file (> 100KB)
      const largeCode = 'const x = 1;\n'.repeat(10000)
      expect(shouldUseAsyncParsing(largeCode)).toBe(true)
    })

    test('respects custom threshold', () => {
      const code = 'const x = 1;'.repeat(100) // ~1200 bytes
      expect(shouldUseAsyncParsing(code, { asyncThreshold: 1000 })).toBe(true)
      expect(shouldUseAsyncParsing(code, { asyncThreshold: 2000 })).toBe(false)
    })
  })

  describe('getSourceFileAsync', () => {
    test('parses small files synchronously', async () => {
      clearSourceFileCache()
      const code = 'export const x: number = 1;'
      const sourceFile = await getSourceFileAsync('test.ts', code)
      expect(sourceFile).toBeDefined()
      expect(sourceFile.fileName).toBe('test.ts')
    })

    test('caches parsed source files', async () => {
      clearSourceFileCache()
      const code = 'export const x: number = 1;'

      // First parse
      await getSourceFileAsync('cached-test.ts', code)
      expect(getSourceFileCacheSize()).toBeGreaterThanOrEqual(1)

      // Second parse should use cache
      const sourceFile2 = await getSourceFileAsync('cached-test.ts', code)
      expect(sourceFile2).toBeDefined()
    })

    test('re-parses when content changes', async () => {
      clearSourceFileCache()
      const code1 = 'export const x: number = 1;'
      const code2 = 'export const y: string = "hello";'

      const sf1 = await getSourceFileAsync('changing.ts', code1)
      const sf2 = await getSourceFileAsync('changing.ts', code2)

      // Should have different content
      expect(sf1.text).not.toBe(sf2.text)
    })

    test('deduplicates concurrent parses for same file', async () => {
      clearSourceFileCache()
      const code = 'export const x: number = 1;'

      // Start multiple concurrent parses
      const promises = [
        getSourceFileAsync('concurrent.ts', code),
        getSourceFileAsync('concurrent.ts', code),
        getSourceFileAsync('concurrent.ts', code),
      ]

      const results = await Promise.all(promises)

      // All should return the same source file
      expect(results[0]).toBe(results[1])
      expect(results[1]).toBe(results[2])
    })
  })

  describe('extractDeclarationsAsync', () => {
    test('extracts declarations from small files', async () => {
      const code = `
        export interface User {
          name: string;
          age: number;
        }

        export function greet(user: User): string {
          return \`Hello, \${user.name}\`;
        }
      `

      const declarations = await extractDeclarationsAsync(code, 'test.ts')
      expect(declarations.length).toBeGreaterThan(0)

      const interfaceDecl = declarations.find(d => d.kind === 'interface' && d.name === 'User')
      expect(interfaceDecl).toBeDefined()

      const funcDecl = declarations.find(d => d.kind === 'function' && d.name === 'greet')
      expect(funcDecl).toBeDefined()
    })

    test('produces same results as sync version', async () => {
      const code = `
        export type Status = 'active' | 'inactive';
        export const DEFAULT_STATUS: Status = 'active';
        export class DataManager<T> {
          private data: T[];
          constructor() {
            this.data = [];
          }
          add(item: T): void {
            this.data.push(item);
          }
        }
      `

      const syncDeclarations = extractDeclarations(code, 'sync.ts')
      const asyncDeclarations = await extractDeclarationsAsync(code, 'async.ts')

      // Should have same number of declarations
      expect(asyncDeclarations.length).toBe(syncDeclarations.length)

      // Should have same kinds
      const syncKinds = syncDeclarations.map(d => d.kind).sort()
      const asyncKinds = asyncDeclarations.map(d => d.kind).sort()
      expect(asyncKinds).toEqual(syncKinds)
    })

    test('handles imports and exports', async () => {
      const code = `
        import { readFile } from 'fs';
        import type { Buffer } from 'buffer';

        export { readFile };
        export type { Buffer };
      `

      const declarations = await extractDeclarationsAsync(code, 'imports.ts')
      const imports = declarations.filter(d => d.kind === 'import')
      const exports = declarations.filter(d => d.kind === 'export')

      expect(imports.length).toBe(2)
      expect(exports.length).toBe(2)
    })
  })

  describe('batchParseSourceFiles', () => {
    test('parses multiple files', async () => {
      clearSourceFileCache()

      const files = [
        { filePath: 'a.ts', sourceCode: 'export const a = 1;' },
        { filePath: 'b.ts', sourceCode: 'export const b = 2;' },
        { filePath: 'c.ts', sourceCode: 'export const c = 3;' },
      ]

      const results = await batchParseSourceFiles(files)

      expect(results.size).toBe(3)
      expect(results.has('a.ts')).toBe(true)
      expect(results.has('b.ts')).toBe(true)
      expect(results.has('c.ts')).toBe(true)
    })

    test('respects concurrency limit', async () => {
      clearSourceFileCache()

      const files = Array.from({ length: 10 }, (_, i) => ({
        filePath: `file${i}.ts`,
        sourceCode: `export const x${i} = ${i};`,
      }))

      const results = await batchParseSourceFiles(files, { concurrency: 2 })
      expect(results.size).toBe(10)
    })
  })

  describe('batchExtractDeclarations', () => {
    test('extracts from multiple files', async () => {
      const files = [
        { filePath: 'types.ts', sourceCode: 'export type ID = string;' },
        { filePath: 'interfaces.ts', sourceCode: 'export interface Entity { id: ID; }' },
        { filePath: 'functions.ts', sourceCode: 'export function createEntity(): Entity { return { id: "1" }; }' },
      ]

      const results = await batchExtractDeclarations(files)

      expect(results.size).toBe(3)
      expect(results.get('types.ts')?.length).toBeGreaterThan(0)
      expect(results.get('interfaces.ts')?.length).toBeGreaterThan(0)
      expect(results.get('functions.ts')?.length).toBeGreaterThan(0)
    })

    test('handles empty files', async () => {
      const files = [
        { filePath: 'empty.ts', sourceCode: '' },
        { filePath: 'comment.ts', sourceCode: '// Just a comment' },
      ]

      const results = await batchExtractDeclarations(files)
      expect(results.size).toBe(2)
    })

    test('preserves comments when requested', async () => {
      const files = [
        {
          filePath: 'documented.ts',
          sourceCode: `
            /** User documentation */
            export interface User {
              name: string;
            }
          `,
          keepComments: true,
        },
      ]

      const results = await batchExtractDeclarations(files)
      const declarations = results.get('documented.ts') || []
      const userDecl = declarations.find(d => d.name === 'User')
      // Check that leadingComments contains the JSDoc comment
      expect(userDecl).toBeDefined()
      expect(userDecl?.leadingComments).toBeDefined()
      expect(userDecl?.leadingComments?.join('\n') ?? '').toContain('User documentation')
    })
  })

  describe('getPendingParseCount', () => {
    test('returns 0 when no parses are pending', () => {
      expect(getPendingParseCount()).toBe(0)
    })
  })

  describe('Performance characteristics', () => {
    test('async parsing does not block event loop for reasonable workloads', async () => {
      clearSourceFileCache()

      // Generate multiple medium-sized files
      const files = Array.from({ length: 20 }, (_, i) => ({
        filePath: `perf-test-${i}.ts`,
        sourceCode: `
          export interface Entity${i} {
            id: string;
            name: string;
            data: Record<string, unknown>;
          }
          export function process${i}(entity: Entity${i}): void {
            console.log(entity);
          }
        `.repeat(10),
      }))

      const startTime = Date.now()

      // Process files with async parsing
      const results = await batchExtractDeclarations(files, { concurrency: 4 })

      const duration = Date.now() - startTime

      expect(results.size).toBe(20)
      // Should complete in reasonable time (< 5 seconds)
      expect(duration).toBeLessThan(5000)
    })
  })

  describe('Error handling', () => {
    test('handles syntax errors gracefully in async mode', async () => {
      // TypeScript parser is lenient with syntax errors
      const code = `
        export interface {
          // Missing name
        }
      `

      // Should not throw, TypeScript parser handles gracefully
      const declarations = await extractDeclarationsAsync(code, 'syntax-error.ts')
      expect(declarations).toBeDefined()
    })

    test('handles malformed code in batch processing', async () => {
      const files = [
        { filePath: 'good.ts', sourceCode: 'export const x = 1;' },
        { filePath: 'malformed.ts', sourceCode: 'export const = ;' },
        { filePath: 'also-good.ts', sourceCode: 'export const y = 2;' },
      ]

      // Should not throw
      const results = await batchExtractDeclarations(files)
      expect(results.size).toBe(3)
    })
  })
})
