/**
 * Tests for async generator return type inference
 */

import { describe, expect, test } from 'bun:test'
import { extractDeclarations } from '../src/extractor'

describe('Async Generator Return Types', () => {
  describe('Function declarations', () => {
    test('infers Generator type for function*', () => {
      const code = `
        export function* generateNumbers() {
          yield 1;
          yield 2;
          yield 3;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'generateNumbers')

      expect(func).toBeDefined()
      expect(func?.isGenerator).toBe(true)
      expect(func?.returnType).toContain('Generator')
    })

    test('infers AsyncGenerator type for async function*', () => {
      const code = `
        export async function* asyncGenerateNumbers() {
          yield 1;
          yield 2;
          yield 3;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'asyncGenerateNumbers')

      expect(func).toBeDefined()
      expect(func?.isGenerator).toBe(true)
      expect(func?.isAsync).toBe(true)
      expect(func?.returnType).toContain('AsyncGenerator')
    })

    test('preserves explicit Generator return type', () => {
      const code = `
        export function* typedGenerator(): Generator<number, void, unknown> {
          yield 1;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'typedGenerator')

      expect(func?.returnType).toBe('Generator<number, void, unknown>')
    })

    test('preserves explicit AsyncGenerator return type', () => {
      const code = `
        export async function* typedAsyncGenerator(): AsyncGenerator<string, void, unknown> {
          yield 'hello';
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'typedAsyncGenerator')

      expect(func?.returnType).toBe('AsyncGenerator<string, void, unknown>')
    })

    test('handles generator with generic type parameter', () => {
      const code = `
        export function* genericGenerator<T>(items: T[]): Generator<T> {
          for (const item of items) {
            yield item;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'genericGenerator')

      expect(func?.generics).toBe('<T>')
      expect(func?.returnType).toBe('Generator<T>')
    })

    test('handles async generator with generic type parameter', () => {
      const code = `
        export async function* asyncGenericGenerator<T>(items: T[]): AsyncGenerator<T> {
          for (const item of items) {
            yield item;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'asyncGenericGenerator')

      expect(func?.generics).toBe('<T>')
      expect(func?.returnType).toBe('AsyncGenerator<T>')
    })
  })

  describe('Class method generators', () => {
    test('handles generator method in class', () => {
      const code = `
        export class MyClass {
          *values() {
            yield 1;
            yield 2;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'MyClass')

      expect(classDecl).toBeDefined()
      expect(classDecl?.text).toContain('*values()')
      expect(classDecl?.text).toContain('Generator')
    })

    test('handles async generator method in class', () => {
      const code = `
        export class AsyncClass {
          async *asyncValues() {
            yield 'a';
            yield 'b';
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'AsyncClass')

      expect(classDecl).toBeDefined()
      expect(classDecl?.text).toContain('*asyncValues()')
      expect(classDecl?.text).toContain('AsyncGenerator')
    })

    test('handles typed generator method', () => {
      const code = `
        export class TypedClass {
          *typedValues(): Generator<number, string, boolean> {
            const input = yield 1;
            return 'done';
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'TypedClass')

      expect(classDecl?.text).toContain('Generator<number, string, boolean>')
    })

    test('handles Symbol.iterator generator', () => {
      const code = `
        export class IterableClass {
          *[Symbol.iterator](): Generator<number> {
            yield 1;
            yield 2;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'IterableClass')

      expect(classDecl?.text).toContain('[Symbol.iterator]')
      expect(classDecl?.text).toContain('Generator<number>')
    })

    test('handles Symbol.asyncIterator async generator', () => {
      const code = `
        export class AsyncIterableClass {
          async *[Symbol.asyncIterator](): AsyncGenerator<string> {
            yield 'hello';
            yield 'world';
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'AsyncIterableClass')

      expect(classDecl?.text).toContain('[Symbol.asyncIterator]')
      expect(classDecl?.text).toContain('AsyncGenerator<string>')
    })
  })

  describe('Edge cases', () => {
    test('handles empty generator', () => {
      const code = `
        export function* emptyGenerator() {
          // No yield statements
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'emptyGenerator')

      expect(func?.isGenerator).toBe(true)
      expect(func?.returnType).toContain('Generator')
    })

    test('handles generator with return statement', () => {
      const code = `
        export function* generatorWithReturn() {
          yield 1;
          return 'done';
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'generatorWithReturn')

      expect(func?.isGenerator).toBe(true)
    })

    test('handles nested generators', () => {
      const code = `
        export function* outerGenerator() {
          yield* innerGenerator();
        }

        function* innerGenerator() {
          yield 1;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const outer = decls.find(d => d.name === 'outerGenerator')

      expect(outer?.isGenerator).toBe(true)
    })

    test('handles generator with complex yield type', () => {
      const code = `
        interface User {
          name: string;
          age: number;
        }

        export function* userGenerator(): Generator<User, void, unknown> {
          yield { name: 'Alice', age: 30 };
          yield { name: 'Bob', age: 25 };
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'userGenerator')

      expect(func?.returnType).toBe('Generator<User, void, unknown>')
    })

    test('handles async generator with await', () => {
      const code = `
        export async function* fetchUsers(): AsyncGenerator<string, void, unknown> {
          const response = await fetch('/api/users');
          const users = await response.json();
          for (const user of users) {
            yield user.name;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const func = decls.find(d => d.name === 'fetchUsers')

      expect(func?.isAsync).toBe(true)
      expect(func?.isGenerator).toBe(true)
      expect(func?.returnType).toBe('AsyncGenerator<string, void, unknown>')
    })
  })
})
