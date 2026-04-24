/**
 * Edge case tests for dtsx
 */

import { describe, expect, test } from 'bun:test'
import { extractDeclarations } from '../src/extractor'

describe('Edge Cases', () => {
  describe('Empty and minimal files', () => {
    test('handles empty file', () => {
      const code = ''
      const decls = extractDeclarations(code, 'empty.ts')
      expect(decls).toEqual([])
    })

    test('handles whitespace-only file', () => {
      const code = '   \n\n\t\t\n   '
      const decls = extractDeclarations(code, 'whitespace.ts')
      expect(decls).toEqual([])
    })

    test('handles comment-only file', () => {
      const code = `
        // Single line comment
        /* Multi-line
           comment */
        /** JSDoc comment */
      `
      const decls = extractDeclarations(code, 'comments.ts')
      expect(decls).toEqual([])
    })

    test('handles file with only imports (no exports)', () => {
      const code = `
        import { something } from 'somewhere';
        import type { SomeType } from './types';
      `
      const decls = extractDeclarations(code, 'imports-only.ts')
      // Should have import declarations
      expect(decls.filter(d => d.kind === 'import').length).toBe(2)
    })
  })

  describe('Re-export only files', () => {
    test('handles named re-exports', () => {
      const code = `
        export { foo, bar } from './module';
        export { baz as qux } from './other';
      `
      const decls = extractDeclarations(code, 'reexports.ts')
      expect(decls.filter(d => d.kind === 'export').length).toBe(2)
    })

    test('handles type re-exports', () => {
      const code = `
        export type { SomeType } from './types';
        export type { AnotherType as Aliased } from './more-types';
      `
      const decls = extractDeclarations(code, 'type-reexports.ts')
      const exports = decls.filter(d => d.kind === 'export')
      expect(exports.length).toBe(2)
      expect(exports.every(e => e.isTypeOnly)).toBe(true)
    })

    test('handles namespace re-exports', () => {
      const code = `
        export * from './utils';
        export * as helpers from './helpers';
      `
      const decls = extractDeclarations(code, 'namespace-reexports.ts')
      expect(decls.filter(d => d.kind === 'export').length).toBe(2)
    })

    test('handles mixed re-exports', () => {
      const code = `
        export { Component } from './Component';
        export type { Props } from './types';
        export * from './utils';
      `
      const decls = extractDeclarations(code, 'mixed-reexports.ts')
      expect(decls.filter(d => d.kind === 'export').length).toBe(3)
    })
  })

  describe('Barrel files (index.ts)', () => {
    test('handles typical barrel file', () => {
      const code = `
        export { Button } from './Button';
        export { Input } from './Input';
        export { Select } from './Select';
        export type { ButtonProps, InputProps, SelectProps } from './types';
        export * from './utils';
      `
      const decls = extractDeclarations(code, 'index.ts')
      expect(decls.filter(d => d.kind === 'export').length).toBe(5)
    })

    test('handles barrel with default exports', () => {
      const code = `
        export { default as Button } from './Button';
        export { default as Input } from './Input';
      `
      const decls = extractDeclarations(code, 'index.ts')
      expect(decls.filter(d => d.kind === 'export').length).toBe(2)
    })

    test('handles barrel with local declarations', () => {
      const code = `
        export { Button } from './Button';
        export { Input } from './Input';

        // Local type combining exports
        export type AllComponents = typeof Button | typeof Input;
      `
      const decls = extractDeclarations(code, 'index.ts')
      const exports = decls.filter(d => d.kind === 'export')
      const types = decls.filter(d => d.kind === 'type')
      expect(exports.length).toBe(2)
      expect(types.length).toBe(1)
    })
  })

  describe('Very long lines and types', () => {
    test('handles very long union types', () => {
      const options = Array.from({ length: 50 }, (_, i) => `'option${i}'`).join(' | ')
      const code = `export type LongUnion = ${options};`

      const decls = extractDeclarations(code, 'long-union.ts')
      const typeDecl = decls.find(d => d.name === 'LongUnion')
      expect(typeDecl).toBeDefined()
      expect(typeDecl?.text.length).toBeGreaterThan(500)
    })

    test('handles interfaces with many properties', () => {
      const props = Array.from({ length: 100 }, (_, i) => `prop${i}: string`).join(';\n  ')
      const code = `export interface ManyProps {\n  ${props};\n}`

      const decls = extractDeclarations(code, 'many-props.ts')
      const interfaceDecl = decls.find(d => d.name === 'ManyProps')
      expect(interfaceDecl).toBeDefined()
    })

    test('handles deeply nested types', () => {
      const code = `
        export type DeepNested = {
          l1: {
            l2: {
              l3: {
                l4: {
                  l5: {
                    l6: {
                      l7: {
                        l8: {
                          l9: {
                            l10: string;
                          };
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      `
      const decls = extractDeclarations(code, 'deep-nested.ts')
      const typeDecl = decls.find(d => d.name === 'DeepNested')
      expect(typeDecl).toBeDefined()
    })

    test('handles long generic constraints', () => {
      const code = `
        export type ComplexGeneric<
          T extends Record<string, unknown>,
          U extends keyof T,
          V extends T[U] extends infer R ? R : never,
          W extends V extends string ? V : never
        > = { key: U; value: W };
      `
      const decls = extractDeclarations(code, 'complex-generic.ts')
      const typeDecl = decls.find(d => d.name === 'ComplexGeneric')
      expect(typeDecl).toBeDefined()
    })
  })

  describe('Unicode identifiers', () => {
    test('handles Japanese identifiers', () => {
      const code = `
        export const 名前 = 'name';
        export function 挨拶(name: string): string {
          return \`こんにちは、\${name}\`;
        }
        export interface ユーザー {
          名前: string;
          年齢: number;
        }
      `
      const decls = extractDeclarations(code, 'japanese.ts')
      expect(decls.find(d => d.name === '名前')).toBeDefined()
      expect(decls.find(d => d.name === '挨拶')).toBeDefined()
      expect(decls.find(d => d.name === 'ユーザー')).toBeDefined()
    })

    test('handles German identifiers with umlauts', () => {
      const code = `
        export const größe = 'size';
        export function grüßen(name: string): string {
          return \`Grüß Gott, \${name}\`;
        }
        export type Größe = 'klein' | 'mittel' | 'groß';
      `
      const decls = extractDeclarations(code, 'german.ts')
      expect(decls.find(d => d.name === 'größe')).toBeDefined()
      expect(decls.find(d => d.name === 'grüßen')).toBeDefined()
      expect(decls.find(d => d.name === 'Größe')).toBeDefined()
    })

    test('handles French identifiers with accents', () => {
      const code = `
        export interface Données {
          prénom: string;
          âge: number;
          adressé: boolean;
        }
      `
      const decls = extractDeclarations(code, 'french.ts')
      const interfaceDecl = decls.find(d => d.name === 'Données')
      expect(interfaceDecl).toBeDefined()
      expect(interfaceDecl?.text).toContain('prénom')
      expect(interfaceDecl?.text).toContain('âge')
    })

    test('handles emoji in string values', () => {
      const code = `
        export const emoji = '🎉';
        export type Mood = '😀' | '😢' | '😡';
      `
      const decls = extractDeclarations(code, 'emoji.ts')
      expect(decls.find(d => d.name === 'emoji')).toBeDefined()
      expect(decls.find(d => d.name === 'Mood')).toBeDefined()
    })

    test('handles Greek identifiers', () => {
      const code = `
        export const π = Math.PI;
        export const Δ = (a: number, b: number) => a - b;
        export interface Σ {
          sum: number;
        }
      `
      const decls = extractDeclarations(code, 'greek.ts')
      expect(decls.find(d => d.name === 'π')).toBeDefined()
      expect(decls.find(d => d.name === 'Δ')).toBeDefined()
      expect(decls.find(d => d.name === 'Σ')).toBeDefined()
    })

    test('handles Cyrillic identifiers', () => {
      const code = `
        export const привет = 'hello';
        export function здравствуй(имя: string): string {
          return \`Здравствуй, \${имя}\`;
        }
      `
      const decls = extractDeclarations(code, 'cyrillic.ts')
      expect(decls.find(d => d.name === 'привет')).toBeDefined()
      expect(decls.find(d => d.name === 'здравствуй')).toBeDefined()
    })
  })

  describe('Special characters in strings and types', () => {
    test('handles template literal types', () => {
      const code = `
        export type EventName = \`on\${string}\`;
        export type CssProperty = \`--\${string}\`;
        export type Route = \`/api/\${string}/\${number}\`;
      `
      const decls = extractDeclarations(code, 'template-literals.ts')
      expect(decls.filter(d => d.kind === 'type').length).toBe(3)
    })

    test('handles nested template literals and strings inside ${} expressions', () => {
      // Regression test for infinite loop: skipTemplateLiteral did not properly
      // handle nested backticks / string literals / balanced braces inside
      // ${...} expressions, causing the scanner to desynchronize and loop.
      // Previously this input hung scanDeclarations indefinitely.
      const code = `
        export class Foo {
          createPane(name?: string): string {
            const className = \`tsmap-pane\${name ? \` tsmap-\${name.replace('Pane', '')}-pane\` : ''}\`
            return className
          }

          /**
           * Bearing in degrees, wrapped to \`[0, 360)\`. \`0\` = north is up.
           */
          getBearing(): number {
            return 0
          }
        }
      `
      const decls = extractDeclarations(code, 'nested-template.ts')
      const cls = decls.find(d => d.name === 'Foo')
      expect(cls).toBeDefined()
      expect(cls!.text).toContain('createPane')
      expect(cls!.text).toContain('getBearing')
    })

    test('handles regex in type positions', () => {
      const code = `
        export interface Patterns {
          email: RegExp;
          phone: RegExp;
        }
        export const emailRegex: RegExp = /^[^@]+@[^@]+$/;
      `
      const decls = extractDeclarations(code, 'regex.ts')
      expect(decls.find(d => d.name === 'Patterns')).toBeDefined()
      expect(decls.find(d => d.name === 'emailRegex')).toBeDefined()
    })
  })

  describe('Unusual but valid TypeScript', () => {
    test('handles numeric literal types', () => {
      const code = `
        export type Zero = 0;
        export type One = 1;
        export type Binary = 0 | 1;
        export type HttpStatus = 200 | 201 | 400 | 404 | 500;
      `
      const decls = extractDeclarations(code, 'numeric-literals.ts')
      expect(decls.filter(d => d.kind === 'type').length).toBe(4)
    })

    test('handles boolean literal types', () => {
      const code = `
        export type True = true;
        export type False = false;
        export type Bool = true | false;
      `
      const decls = extractDeclarations(code, 'boolean-literals.ts')
      expect(decls.filter(d => d.kind === 'type').length).toBe(3)
    })

    test('handles bigint literal types', () => {
      const code = `
        export type BigZero = 0n;
        export type BigOne = 1n;
        export const bigValue: 9007199254740991n = 9007199254740991n;
      `
      const decls = extractDeclarations(code, 'bigint-literals.ts')
      expect(decls.length).toBeGreaterThan(0)
    })

    test('handles unique symbol types', () => {
      const code = `
        declare const sym: unique symbol;
        export type SymType = typeof sym;
        export interface WithSymbol {
          [sym]: string;
        }
      `
      const decls = extractDeclarations(code, 'unique-symbol.ts')
      expect(decls.length).toBeGreaterThan(0)
    })
  })
})
