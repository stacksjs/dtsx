/**
 * Tests for advanced TypeScript features support
 */

import { describe, expect, test } from 'bun:test'
import { extractDeclarations } from '../src/extractor'

function createContext(code: string) {
  const declarations = extractDeclarations(code, 'test.ts')
  return {
    filePath: 'test.ts',
    sourceCode: code,
    declarations,
    imports: new Map(),
    exports: new Set<string>(),
    usedTypes: new Set<string>(),
  }
}

describe('TypeScript Features', () => {
  describe('Private class fields (#field)', () => {
    test('excludes private fields from output', () => {
      const code = `
        export class MyClass {
          public name: string;
          #privateData: number;
          readonly #privateId: string;
          static #instanceCount: number = 0;

          constructor(name: string) {
            this.name = name;
            this.#privateData = 0;
            this.#privateId = 'id';
          }

          get data(): number {
            return this.#privateData;
          }

          #privateMethod(): void {
            console.log(this.#privateData);
          }

          processData(): number {
            this.#privateMethod();
            return this.#privateData;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'MyClass')

      expect(classDecl).toBeDefined()
      // Private fields should not appear in output
      expect(classDecl?.text).not.toContain('#privateData')
      expect(classDecl?.text).not.toContain('#privateId')
      expect(classDecl?.text).not.toContain('#instanceCount')
      expect(classDecl?.text).not.toContain('#privateMethod')

      // Public members should appear
      expect(classDecl?.text).toContain('name: string')
      expect(classDecl?.text).toContain('constructor')
      expect(classDecl?.text).toContain('get data(): number')
      expect(classDecl?.text).toContain('processData(): number')
    })

    test('handles private accessors', () => {
      const code = `
        export class WithPrivateAccessor {
          #value: number = 0;

          get #privateValue(): number {
            return this.#value;
          }

          set #privateValue(v: number) {
            this.#value = v;
          }

          get publicValue(): number {
            return this.#value;
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'WithPrivateAccessor')

      expect(classDecl?.text).not.toContain('#privateValue')
      expect(classDecl?.text).not.toContain('#value')
      expect(classDecl?.text).toContain('get publicValue(): number')
    })
  })

  describe('Static blocks', () => {
    test('excludes static blocks from output', () => {
      const code = `
        export class StaticBlockClass {
          static config: { initialized: boolean };
          static instances: Map<string, StaticBlockClass>;

          static {
            this.config = { initialized: true };
            this.instances = new Map();
          }

          constructor() {}
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'StaticBlockClass')

      expect(classDecl).toBeDefined()
      // Static block implementation should not appear
      expect(classDecl?.text).not.toContain('initialized: true')
      expect(classDecl?.text).not.toContain('new Map()')

      // Static properties should appear
      expect(classDecl?.text).toContain('static config')
      expect(classDecl?.text).toContain('static instances')
    })

    test('handles multiple static blocks', () => {
      const code = `
        export class MultipleStaticBlocks {
          static PRIMARY: Record<string, unknown>;
          static SECONDARY: Record<string, unknown>;

          static {
            this.PRIMARY = { a: 1 };
          }

          static {
            this.SECONDARY = { b: 2 };
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'MultipleStaticBlocks')

      expect(classDecl?.text).toContain('static PRIMARY')
      expect(classDecl?.text).toContain('static SECONDARY')
      expect(classDecl?.text).not.toContain('a: 1')
      expect(classDecl?.text).not.toContain('b: 2')
    })
  })

  describe('Symbol property keys', () => {
    test('handles Symbol.iterator in interfaces', () => {
      const code = `
        export interface SymbolKeyed {
          [Symbol.iterator](): Iterator<number>;
          [Symbol.toStringTag]: string;
          [Symbol.asyncIterator]?(): AsyncIterator<number>;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const interfaceDecl = decls.find(d => d.name === 'SymbolKeyed')

      expect(interfaceDecl).toBeDefined()
      expect(interfaceDecl?.text).toContain('[Symbol.iterator](): Iterator<number>')
      expect(interfaceDecl?.text).toContain('[Symbol.toStringTag]: string')
      expect(interfaceDecl?.text).toContain('[Symbol.asyncIterator]?(): AsyncIterator<number>')
    })

    test('handles Symbol properties in classes', () => {
      const code = `
        export class SymbolClass {
          [Symbol.toStringTag] = 'SymbolClass';

          *[Symbol.iterator](): Generator<number> {
            yield 1;
          }

          [Symbol.dispose](): void {
            console.log('disposed');
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'SymbolClass')

      expect(classDecl).toBeDefined()
      expect(classDecl?.text).toContain('[Symbol.toStringTag]')
      expect(classDecl?.text).toContain('*[Symbol.iterator](): Generator<number>')
      expect(classDecl?.text).toContain('[Symbol.dispose](): void')
    })

    test('handles Symbol.dispose for Disposable interface', () => {
      const code = `
        export interface Disposable {
          [Symbol.dispose](): void;
        }

        export interface AsyncDisposable {
          [Symbol.asyncDispose](): Promise<void>;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const disposable = decls.find(d => d.name === 'Disposable')
      const asyncDisposable = decls.find(d => d.name === 'AsyncDisposable')

      expect(disposable?.text).toContain('[Symbol.dispose](): void')
      expect(asyncDisposable?.text).toContain('[Symbol.asyncDispose](): Promise<void>')
    })
  })

  describe('as const assertions', () => {
    test('handles simple as const', () => {
      const code = `
        export const SIMPLE = 'hello' as const;
      `

      const decls = extractDeclarations(code, 'test.ts')
      const constDecl = decls.find(d => d.name === 'SIMPLE')

      expect(constDecl).toBeDefined()
      expect(constDecl?.text).toContain('SIMPLE')
      // Should preserve literal type
      expect(constDecl?.typeAnnotation).toBeDefined()
    })

    test('handles object as const', () => {
      const code = `
        export const CONFIG = {
          api: {
            baseUrl: 'https://api.example.com',
            timeout: 5000,
          },
        } as const;
      `

      const decls = extractDeclarations(code, 'test.ts')
      const constDecl = decls.find(d => d.name === 'CONFIG')

      expect(constDecl).toBeDefined()
      expect(constDecl?.modifiers).toContain('const assertion')
    })

    test('handles array as const', () => {
      const code = `
        export const STATUSES = ['pending', 'active', 'completed'] as const;
      `

      const decls = extractDeclarations(code, 'test.ts')
      const constDecl = decls.find(d => d.name === 'STATUSES')

      expect(constDecl).toBeDefined()
      expect(constDecl?.modifiers).toContain('const assertion')
    })
  })

  describe('Computed property names', () => {
    test('handles computed properties in interfaces', () => {
      const code = `
        const KEY = 'dynamicProp';

        export interface ComputedProps {
          [KEY]: string;
          normalProp: number;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const interfaceDecl = decls.find(d => d.name === 'ComputedProps')

      expect(interfaceDecl).toBeDefined()
      expect(interfaceDecl?.text).toContain('[KEY]: string')
      expect(interfaceDecl?.text).toContain('normalProp: number')
    })
  })

  describe('Generator methods', () => {
    test('handles generator methods in classes', () => {
      const code = `
        export class GeneratorClass {
          *values(): Generator<number> {
            yield 1;
            yield 2;
          }

          async *asyncValues(): AsyncGenerator<string> {
            yield 'a';
            yield 'b';
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'GeneratorClass')

      expect(classDecl).toBeDefined()
      expect(classDecl?.text).toContain('*values(): Generator<number>')
      expect(classDecl?.text).toContain('*asyncValues(): AsyncGenerator<string>')
    })
  })

  describe('readonly interface properties', () => {
    test('preserves readonly modifier on interface properties', () => {
      const code = `
        export interface Config {
          readonly name: string;
          readonly version: number;
          mutable: boolean;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const interfaceDecl = decls.find(d => d.name === 'Config')

      expect(interfaceDecl).toBeDefined()
      expect(interfaceDecl?.text).toContain('readonly name: string')
      expect(interfaceDecl?.text).toContain('readonly version: number')
      expect(interfaceDecl?.text).not.toContain('readonly mutable')
    })
  })

  describe('using declarations (TS 5.2+)', () => {
    test('handles classes implementing Disposable', () => {
      const code = `
        export class DisposableResource implements Disposable {
          [Symbol.dispose](): void {
            console.log('disposed');
          }
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const classDecl = decls.find(d => d.name === 'DisposableResource')

      expect(classDecl).toBeDefined()
      expect(classDecl?.text).toContain('implements Disposable')
      expect(classDecl?.text).toContain('[Symbol.dispose](): void')
    })
  })

  describe('import.meta types', () => {
    test('handles import.meta interface declaration', () => {
      const code = `
        export interface ImportMeta {
          url: string;
          main: boolean;
          resolve(specifier: string): string;
        }
      `

      const decls = extractDeclarations(code, 'test.ts')
      const interfaceDecl = decls.find(d => d.name === 'ImportMeta')

      expect(interfaceDecl).toBeDefined()
      expect(interfaceDecl?.text).toContain('url: string')
      expect(interfaceDecl?.text).toContain('main: boolean')
      expect(interfaceDecl?.text).toContain('resolve(specifier: string): string')
    })
  })
})
