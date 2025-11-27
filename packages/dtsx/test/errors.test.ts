import { describe, expect, it } from 'bun:test'
import { extractDeclarations } from '../src/extractor'
import { processDeclarations } from '../src/processor'
import type { ProcessingContext } from '../src/types'

const TEST_FILE = 'test.ts'

function createContext(code: string): ProcessingContext {
  const declarations = extractDeclarations(code, TEST_FILE)
  return {
    filePath: TEST_FILE,
    sourceCode: code,
    declarations,
    imports: new Map(),
    exports: new Set(),
    usedTypes: new Set(),
  }
}

function processCode(code: string): string {
  const declarations = extractDeclarations(code, TEST_FILE)
  const context = createContext(code)
  return processDeclarations(declarations, context)
}

describe('Error Handling', () => {
  describe('Malformed TypeScript Input', () => {
    it('should handle empty input', () => {
      const result = extractDeclarations('', TEST_FILE)
      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle whitespace-only input', () => {
      const result = extractDeclarations('   \n\n\t  \n  ', TEST_FILE)
      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle unclosed braces', () => {
      const code = `
        export interface User {
          name: string
          // missing closing brace
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle unclosed parentheses in function', () => {
      const code = `
        export function greet(name: string {
          return name
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle invalid syntax in type definition', () => {
      const code = `
        export type Invalid = {
          name: string
          age: // missing type
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle duplicate keywords', () => {
      const code = `
        export export function foo(): void {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle missing function body', () => {
      const code = `
        export function noBody(): string
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle invalid generic syntax', () => {
      const code = `
        export function broken<T extends>(): T {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle random characters', () => {
      const code = `
        @#$%^&*()
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle unmatched quotes', () => {
      const code = `
        export const str = "unclosed string
        export const num = 42
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle unmatched template literal', () => {
      const code = `
        export const template = \`unclosed template
        export const num = 42
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle invalid import syntax', () => {
      const code = `
        import { from './module'
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle invalid export syntax', () => {
      const code = `
        export { } from
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle extremely long lines', () => {
      const longType = 'string | '.repeat(1000) + 'number'
      const code = `export type LongUnion = ${longType}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle deeply nested types', () => {
      const nested = 'Array<'.repeat(50) + 'string' + '>'.repeat(50)
      const code = `export type DeepNested = ${nested}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle circular-looking type references', () => {
      const code = `
        export type A = B
        export type B = A
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
      expect(result.length).toBe(2)
    })

    it('should handle reserved words as identifiers', () => {
      const code = `
        export const class = 1
        export const function = 2
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle mixed valid and invalid code', () => {
      const code = `
        export function valid(): string { return 'ok' }

        export function broken( { }

        export const alsoValid = 42
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })
  })

  describe('Process Declarations Error Handling', () => {
    it('should handle empty declarations', () => {
      const result = processCode('')
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
    })

    it('should handle declarations with syntax errors', () => {
      const code = `
        export interface Broken {
          name: string
          age: // missing type
        }
      `
      const result = processCode(code)
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
    })

    it('should handle code with only imports', () => {
      const code = `
        import { something } from 'module'
        import type { Type } from 'types'
      `
      const result = processCode(code)
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
    })

    it('should handle null bytes in input', () => {
      const code = `export const x = 1\0export const y = 2`
      const result = processCode(code)
      expect(result).toBeDefined()
    })

    it('should handle CRLF line endings', () => {
      const code = 'export const x = 1\r\nexport const y = 2\r\n'
      const result = processCode(code)
      expect(result).toBeDefined()
    })

    it('should handle mixed line endings', () => {
      const code = 'export const x = 1\nexport const y = 2\r\nexport const z = 3\r'
      const result = processCode(code)
      expect(result).toBeDefined()
    })

    it('should handle BOM (byte order mark)', () => {
      const code = '\uFEFFexport const x = 1'
      const result = processCode(code)
      expect(result).toBeDefined()
    })

    it('should handle tabs and spaces mixed', () => {
      const code = `
\t\texport interface User {
    \tname: string
\t    age: number
        }
      `
      const result = processCode(code)
      expect(result).toBeDefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle interface with no members', () => {
      const code = `export interface Empty {}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle type alias to primitive', () => {
      const code = `export type Str = string`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple exports on same line', () => {
      const code = `export const a = 1; export const b = 2; export const c = 3;`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle export with complex destructuring', () => {
      const code = `
        export const { a, b: { c, d: [e, f] } } = obj
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle function with rest parameters', () => {
      const code = `
        export function fn(...args: string[]): void {}
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle function with default parameters', () => {
      const code = `
        export function greet(name: string = 'World'): string {
          return name
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle class with private fields', () => {
      const code = `
        export class MyClass {
          #privateField: string
          private privateMethod(): void {}
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle abstract class', () => {
      const code = `
        export abstract class Base {
          abstract method(): void
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle class with static members', () => {
      const code = `
        export class Static {
          static value: number = 42
          static method(): void {}
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
    })

    it('should handle namespace', () => {
      const code = `
        export namespace MyNamespace {
          export interface Inner {}
          export function fn(): void {}
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle module declaration', () => {
      const code = `
        declare module 'my-module' {
          export function fn(): void
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
    })

    it('should handle triple-slash directives', () => {
      const code = `
        /// <reference types="node" />
        /// <reference path="./types.d.ts" />
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle shebang', () => {
      const code = `#!/usr/bin/env node
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle use strict directive', () => {
      const code = `
        'use strict'
        export const x = 1
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle very large number of exports', () => {
      const exports = Array.from({ length: 100 }, (_, i) => `export const v${i} = ${i}`).join('\n')
      const result = extractDeclarations(exports, TEST_FILE)
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
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
      expect(result).toBeDefined()
    })

    it('should handle async generator', () => {
      const code = `
        export async function* asyncGen(): AsyncGenerator<number> {
          yield 1
          yield 2
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle symbol as property key', () => {
      const code = `
        const sym = Symbol('key')
        export const obj = {
          [sym]: 'value'
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle satisfies operator', () => {
      const code = `
        export const config = {
          port: 3000,
          host: 'localhost'
        } satisfies { port: number; host: string }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle using declaration (TS 5.2+)', () => {
      const code = `
        export function withResource(): void {
          using resource = getResource()
          console.log(resource)
        }
      `
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })
  })
})
