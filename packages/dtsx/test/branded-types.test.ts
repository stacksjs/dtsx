/**
 * Tests for branded types
 */

import { describe, expect, test } from 'bun:test'
import {
  asAbsolutePath,
  asDeclarationName,
  asDirectoryPath,
  asDtsContent,
  asFilePath,
  asGlobPattern,
  asJsonString,
  asModuleSpecifier,
  asRelativePath,
  asSourceCode,
  asTypeName,
  BrandedPath,
  unwrap,
} from '../src/branded-types'

describe('Branded Types', () => {
  describe('asFilePath', () => {
    test('accepts valid path', () => {
      const path = asFilePath('/path/to/file.ts')
      expect(path).toBe('/path/to/file.ts')
    })

    test('throws on empty string', () => {
      expect(() => asFilePath('')).toThrow('Invalid file path')
    })

    test('throws on non-string', () => {
      expect(() => asFilePath(null as any)).toThrow('Invalid file path')
    })
  })

  describe('asDirectoryPath', () => {
    test('accepts valid directory path', () => {
      const path = asDirectoryPath('/path/to/dir')
      expect(path).toBe('/path/to/dir')
    })

    test('throws on empty string', () => {
      expect(() => asDirectoryPath('')).toThrow('Invalid directory path')
    })
  })

  describe('asGlobPattern', () => {
    test('accepts valid glob pattern', () => {
      const pattern = asGlobPattern('**/*.ts')
      expect(pattern).toBe('**/*.ts')
    })

    test('throws on empty string', () => {
      expect(() => asGlobPattern('')).toThrow('Invalid glob pattern')
    })
  })

  describe('asSourceCode', () => {
    test('accepts valid source code', () => {
      const code = asSourceCode('const x = 1;')
      expect(code).toBe('const x = 1;')
    })

    test('accepts empty string', () => {
      const code = asSourceCode('')
      expect(code).toBe('')
    })

    test('throws on non-string', () => {
      expect(() => asSourceCode(123 as any)).toThrow('Invalid source code')
    })
  })

  describe('asDtsContent', () => {
    test('accepts valid DTS content', () => {
      const content = asDtsContent('declare const x: number;')
      expect(content).toBe('declare const x: number;')
    })

    test('throws on non-string', () => {
      expect(() => asDtsContent(undefined as any)).toThrow('Invalid DTS content')
    })
  })

  describe('asModuleSpecifier', () => {
    test('accepts valid module specifier', () => {
      const specifier = asModuleSpecifier('./module')
      expect(specifier).toBe('./module')
    })

    test('accepts package name', () => {
      const specifier = asModuleSpecifier('lodash')
      expect(specifier).toBe('lodash')
    })

    test('throws on empty string', () => {
      expect(() => asModuleSpecifier('')).toThrow('Invalid module specifier')
    })
  })

  describe('asTypeName', () => {
    test('accepts valid type name', () => {
      const name = asTypeName('MyType')
      expect(name).toBe('MyType')
    })

    test('accepts primitive type names', () => {
      expect(asTypeName('string')).toBe('string')
      expect(asTypeName('number')).toBe('number')
      expect(asTypeName('boolean')).toBe('boolean')
    })

    test('throws on empty string', () => {
      expect(() => asTypeName('')).toThrow('Invalid type name')
    })
  })

  describe('asDeclarationName', () => {
    test('accepts valid declaration name', () => {
      const name = asDeclarationName('myFunction')
      expect(name).toBe('myFunction')
    })

    test('throws on empty string', () => {
      expect(() => asDeclarationName('')).toThrow('Invalid declaration name')
    })
  })

  describe('asAbsolutePath', () => {
    test('accepts Unix absolute path', () => {
      const path = asAbsolutePath('/usr/local/bin')
      expect(path).toBe('/usr/local/bin')
    })

    test('accepts Windows absolute path', () => {
      const path = asAbsolutePath('C:\\Users\\test')
      expect(path).toBe('C:\\Users\\test')
    })

    test('throws on relative path', () => {
      expect(() => asAbsolutePath('./relative/path')).toThrow('must start with / or drive letter')
    })

    test('throws on empty string', () => {
      expect(() => asAbsolutePath('')).toThrow('Invalid absolute path')
    })
  })

  describe('asRelativePath', () => {
    test('accepts relative path with ./', () => {
      const path = asRelativePath('./relative/path')
      expect(path).toBe('./relative/path')
    })

    test('accepts relative path with ../', () => {
      const path = asRelativePath('../parent/path')
      expect(path).toBe('../parent/path')
    })

    test('accepts bare path', () => {
      const path = asRelativePath('bare/path')
      expect(path).toBe('bare/path')
    })

    test('throws on Unix absolute path', () => {
      expect(() => asRelativePath('/absolute/path')).toThrow('must not be absolute')
    })

    test('throws on Windows absolute path', () => {
      expect(() => asRelativePath('C:\\absolute')).toThrow('must not be absolute')
    })
  })

  describe('asJsonString', () => {
    test('accepts valid JSON', () => {
      const json = asJsonString('{"key": "value"}')
      expect(json).toBe('{"key": "value"}')
    })

    test('accepts JSON array', () => {
      const json = asJsonString('[1, 2, 3]')
      expect(json).toBe('[1, 2, 3]')
    })

    test('throws on invalid JSON', () => {
      expect(() => asJsonString('not json')).toThrow('must be valid JSON')
    })

    test('throws on non-string', () => {
      expect(() => asJsonString(123 as any)).toThrow('must be a string')
    })
  })

  describe('unwrap', () => {
    test('unwraps branded type to base type', () => {
      const branded = asFilePath('/path/to/file')
      const unwrapped: string = unwrap(branded)
      expect(unwrapped).toBe('/path/to/file')
    })
  })

  describe('BrandedPath utilities', () => {
    test('join creates FilePath', () => {
      const dir = asDirectoryPath('/base')
      const result = BrandedPath.join(dir, 'subdir', 'file.ts')
      expect(result).toContain('base')
      expect(result).toContain('file.ts')
    })

    test('dirname extracts directory', () => {
      const file = asFilePath('/path/to/file.ts')
      const dir = BrandedPath.dirname(file)
      expect(dir).toBe('/path/to')
    })

    test('basename extracts filename', () => {
      const file = asFilePath('/path/to/file.ts')
      const name = BrandedPath.basename(file)
      expect(name).toBe('file.ts')
    })

    test('resolve creates absolute path', () => {
      const result = BrandedPath.resolve('.')
      expect(BrandedPath.isAbsolute(result)).toBe(true)
    })

    test('isAbsolute checks path type', () => {
      expect(BrandedPath.isAbsolute('/absolute')).toBe(true)
      expect(BrandedPath.isAbsolute('./relative')).toBe(false)
    })

    test('relative computes relative path', () => {
      const from = asDirectoryPath('/base')
      const to = asFilePath('/base/subdir/file.ts')
      const result = BrandedPath.relative(from, to)
      expect(result).toBe('subdir/file.ts')
    })
  })

  describe('Type Safety', () => {
    test('branded types are assignable to base types', () => {
      const filePath = asFilePath('/path/to/file')
      // This should compile - branded types extend their base
      const str: string = filePath
      expect(str).toBe('/path/to/file')
    })

    test('different branded types are not interchangeable at runtime', () => {
      const filePath = asFilePath('/path')
      const dirPath = asDirectoryPath('/path')

      // Both have the same string value
      expect(filePath).toBe(dirPath as any)

      // But they are semantically different types
      // (TypeScript would catch misuse at compile time)
    })
  })
})
