import { describe, expect, it } from 'bun:test'
import { extractDeclarations } from '../src/extractor'
import { createContext, processCode } from './test-utils'

const TEST_FILE = 'test.ts'

describe('Error Handling', () => {
  describe('Malformed TypeScript Input', () => {
    it('should handle empty input', () => {
      const result = extractDeclarations('', TEST_FILE)
      expect(result).toEqual([])
    })

    it('should handle whitespace-only input', () => {
      const result = extractDeclarations('   \n\n\t  \n  ', TEST_FILE)
      expect(result).toEqual([])
    })

    it('should handle unclosed braces', () => {
      const code = `
        export interface User {
          name: string
          // missing closing brace
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('interface')
    })

    it('should handle unclosed parentheses in function', () => {
      const code = `
        export function greet(name: string {
          return name
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle invalid syntax in type definition', () => {
      const code = `
        export type Invalid = {
          name: string
          age: // missing type
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.find(d => d.kind === 'type')).toBeDefined()
    })

    it('should handle duplicate keywords', () => {
      const code = `
        export export function foo(): void {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle missing function body', () => {
      const code = `
        export function noBody(): string
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('function')
    })

    it('should handle invalid generic syntax', () => {
      const code = `
        export function broken<T extends>(): T {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle random characters', () => {
      const code = `
        @#$%^&*()
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle unmatched quotes', () => {
      const code = `
        export const str = "unclosed string
        export const num = 42
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle unmatched template literal', () => {
      const code = `
        export const template = \`unclosed template
        export const num = 42
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle invalid import syntax', () => {
      const code = `
        import { from './module'
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle invalid export syntax', () => {
      const code = `
        export { } from
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle extremely long lines', () => {
      const longType = `${'string | '.repeat(1000)}number`
      const code = `export type LongUnion = ${longType}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('type')
      expect(result[0].name).toBe('LongUnion')
    })

    it('should handle deeply nested types', () => {
      const nested = `${'Array<'.repeat(50)}string${'>'.repeat(50)}`
      const code = `export type DeepNested = ${nested}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].name).toBe('DeepNested')
    })

    it('should handle circular-looking type references', () => {
      const code = `
        export type A = B
        export type B = A
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBe(2)
      expect(result[0].name).toBe('A')
      expect(result[1].name).toBe('B')
    })

    it('should handle reserved words as identifiers', () => {
      const code = `
        export const class = 1
        export const function = 2
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle mixed valid and invalid code', () => {
      const code = `
        export function valid(): string { return 'ok' }

        export function broken( { }

        export const alsoValid = 42
      `
      const result = extractDeclarations(code, TEST_FILE)
      // Should at least extract the valid declarations
      expect(result.length).toBeGreaterThanOrEqual(1)
      const names = result.map(d => d.name)
      expect(names).toContain('valid')
    })
  })

  describe('Process Declarations Error Handling', () => {
    it('should handle empty declarations', () => {
      const result = processCode('')
      expect(result).toBe('')
    })

    it('should handle declarations with syntax errors', () => {
      const code = `
        export interface Broken {
          name: string
          age: // missing type
        }
      `
      const result = processCode(code)
      expect(result).toContain('interface')
      expect(result).toContain('name: string')
    })

    it('should handle code with only comments', () => {
      const code = `
        // This is a comment
        /* This is a block comment */
        /**
         * This is a JSDoc comment
         */
      `
      const result = processCode(code)
      expect(result).toBe('')
    })

    it('should handle code with only imports', () => {
      const code = `
        import { something } from 'module'
        import type { Type } from 'types'
      `
      const result = processCode(code)
      // Unused imports should be filtered out
      expect(result).toBe('')
    })

    it('should handle Unicode content', () => {
      const code = `
        export const emoji = '🎉'
        export const chinese = '你好'
        export const arabic = 'مرحبا'
        export function greet(名前: string): string {
          return 名前
        }
      `
      const result = processCode(code)
      expect(result).toContain('emoji')
      expect(result).toContain('chinese')
      expect(result).toContain('greet')
    })

    it('should handle null bytes in input', () => {
      const code = `export const x = 1\0export const y = 2`
      const result = processCode(code)
      expect(typeof result).toBe('string')
    })

    it('should handle CRLF line endings', () => {
      const code = 'export const x = 1\r\nexport const y = 2\r\n'
      const result = processCode(code)
      expect(result).toContain('x')
      expect(result).toContain('y')
    })

    it('should handle mixed line endings', () => {
      const code = 'export const x = 1\nexport const y = 2\r\nexport const z = 3\r'
      const result = processCode(code)
      expect(result).toContain('x')
    })

    it('should handle BOM (byte order mark)', () => {
      const code = '\uFEFFexport const x = 1'
      const result = processCode(code)
      expect(result).toContain('x')
    })

    it('should handle tabs and spaces mixed', () => {
      const code = `
\t\texport interface User {
    \tname: string
\t    age: number
        }
      `
      const result = processCode(code)
      expect(result).toContain('interface User')
      expect(result).toContain('name: string')
      expect(result).toContain('age: number')
    })
  })

  describe('Edge Cases', () => {
    it('should handle interface with no members', () => {
      const code = `export interface Empty {}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('interface')
      expect(result[0].name).toBe('Empty')
    })

    it('should handle type alias to primitive', () => {
      const code = `export type Str = string`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('type')
      expect(result[0].name).toBe('Str')
    })

    it('should handle multiple exports on same line', () => {
      const code = `export const a = 1; export const b = 2; export const c = 3;`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(3)
      const names = result.map(d => d.name)
      expect(names).toContain('a')
      expect(names).toContain('b')
      expect(names).toContain('c')
    })

    it('should handle export with complex destructuring', () => {
      const code = `
        export const { a, b: { c, d: [e, f] } } = obj
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle function with rest parameters', () => {
      const code = `
        export function fn(...args: string[]): void {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('function')
      expect(result[0].text).toContain('...args')
    })

    it('should handle function with default parameters', () => {
      const code = `
        export function greet(name: string = 'World'): string {
          return name
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('function')
      expect(result[0].name).toBe('greet')
    })

    it('should handle class with private fields', () => {
      const code = `
        export class MyClass {
          #privateField: string
          private privateMethod(): void {}
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('class')
    })

    it('should handle abstract class', () => {
      const code = `
        export abstract class Base {
          abstract method(): void
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('class')
      expect(result[0].text).toContain('abstract')
    })

    it('should handle class with static members', () => {
      const code = `
        export class Static {
          static value: number = 42
          static method(): void {}
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('class')
      expect(result[0].text).toContain('static')
    })

    it('should handle enum with computed values', () => {
      const code = `
        export enum Computed {
          A = 1 << 0,
          B = 1 << 1,
          C = A | B,
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('enum')
      expect(result[0].name).toBe('Computed')
    })

    it('should handle const enum', () => {
      const code = `
        export const enum ConstEnum {
          A,
          B,
          C,
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('enum')
    })

    it('should handle namespace', () => {
      const code = `
        export namespace MyNamespace {
          export interface Inner {}
          export function fn(): void {}
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      const nsDecl = result.find(d => d.kind === 'namespace' || d.kind === 'module')
      expect(nsDecl).toBeDefined()
      expect(nsDecl!.name).toBe('MyNamespace')
    })

    it('should handle module declaration', () => {
      const code = `
        declare module 'my-module' {
          export function fn(): void
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.find(d => d.kind === 'module')).toBeDefined()
    })

    it('should handle global augmentation', () => {
      const code = `
        declare global {
          interface Window {
            myProperty: string
          }
        }
        export {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle triple-slash directives', () => {
      const code = `
        /// <reference types="node" />
        /// <reference path="./types.d.ts" />
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      const varDecl = result.find(d => d.name === 'x')
      expect(varDecl).toBeDefined()
    })

    it('should handle shebang', () => {
      const code = `#!/usr/bin/env node
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle use strict directive', () => {
      const code = `
        'use strict'
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle very large number of exports', () => {
      const exports = Array.from({ length: 100 }, (_, i) => `export const v${i} = ${i}`).join('\n')
      const result = extractDeclarations(exports, TEST_FILE)
      expect(result.length).toBe(100)
      expect(result.every(d => d.kind === 'variable')).toBe(true)
    })

    it('should handle overloaded functions', () => {
      const code = `
        export function fn(x: string): string
        export function fn(x: number): number
        export function fn(x: string | number): string | number {
          return x
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      const fnDecls = result.filter(d => d.name === 'fn')
      expect(fnDecls.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle getter and setter', () => {
      const code = `
        export class WithAccessors {
          private _value: string = ''
          get value(): string { return this._value }
          set value(v: string) { this._value = v }
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('class')
    })

    it('should handle async generator', () => {
      const code = `
        export async function* asyncGen(): AsyncGenerator<number> {
          yield 1
          yield 2
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('function')
      expect(result[0].name).toBe('asyncGen')
    })

    it('should handle symbol as property key', () => {
      const code = `
        const sym = Symbol('key')
        export const obj = {
          [sym]: 'value'
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle satisfies operator', () => {
      const code = `
        export const config = {
          port: 3000,
          host: 'localhost'
        } satisfies { port: number; host: string }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.find(d => d.name === 'config')).toBeDefined()
    })

    it('should handle using declaration (TS 5.2+)', () => {
      const code = `
        export function withResource(): void {
          using resource = getResource()
          console.log(resource)
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].kind).toBe('function')
    })
  })
})
