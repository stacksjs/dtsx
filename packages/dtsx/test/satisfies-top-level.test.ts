/**
 * The text after the last ` satisfies ` in an initializer was taken as the
 * declared type, wherever it stood:
 *
 *   export const list = [
 *     'a', // b satisfies T
 *   ]
 *
 * emitted `export declare const list: T\n];`. A `satisfies` in a comment, a
 * string, a nested element or a function body is not about the declaration,
 * and the text after it closes a bracket or leaves a string open that it never
 * began. Vue's compiler-core `babelUtils` and three of knip's plugins came out
 * unparsable this way.
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

describe('satisfies outside the top level of an initializer', () => {
  it.each([
    ['comment', 'export const list = [\n  \'a\', // b satisfies T\n]\nexport const after = 1\n', 'const list: T'],
    ['string', 'export const s = \'x satisfies Y\'\nexport const after = 1\n', 'const s: Y'],
    ['nested element', 'type Item = { id: number }\nexport const items = [{ id: 1 } satisfies Item, { id: 2 } satisfies Item]\nexport const after = 1\n', 'const items: Item'],
    ['function body', 'type Cfg = { a: number }\nexport const plugin = {\n  setup() { const c = { a: 1 } satisfies Cfg; return c },\n}\nexport const after = 1\n', 'const plugin: Cfg'],
    ['string after a regex', 'export const rule = { pattern: /\'/, message: \'x satisfies Y\' }\nexport const after = 1\n', 'const rule: Y'],
  ])('is not taken as the declared type: %s', (_label, code, wrong) => {
    const output = processCode(code)
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).not.toContain(wrong)
    expect(output).toContain('export declare const after: 1;')
  })

  it.each([
    ['plain', 'type Cfg = { port: number }\nexport const config = { port: 3000 } satisfies Cfg\n', 'export declare const config: Cfg;'],
    ['function type', 'export const f = (() => {}) satisfies () => void\n', 'export declare const f: () => void;'],
    ['template literal type', 'export const id = `a-1` satisfies `a-${number}`\n', 'export declare const id: `a-${number}`;'],
    ['brackets in a string and a comment', 'export const m = { \'(\': 1 } satisfies Record<\'(\', 1 /* ) */>\n', 'export declare const m: Record<\'(\', 1 /* ) */>;'],
    ['regex with a quote', 'export const re = /\'/ satisfies RegExp\n', 'export declare const re: RegExp;'],
    ['regex with a bracket and slashes', 'export const re = /[)//]/ satisfies RegExp\n', 'export declare const re: RegExp;'],
    ['division after a non-null assertion', 'declare const n: number | undefined\nexport const ratio = n! / 2 satisfies number\n', 'export declare const ratio: number;'],
    ['nested template literal with a URL', 'export const url = `${`https://example.com`}` satisfies string\n', 'export declare const url: string;'],
  ])('still types a declaration from a top-level satisfies: %s', (_label, code, expected) => {
    expect(processCode(code)).toContain(expected)
  })

  it('still types JSX from a top-level satisfies', () => {
    expect(processCode('export const link = (<a>https://example.com</a>) satisfies JSX.Element\n', 'link.tsx')).toContain('export declare const link: JSX.Element;')
  })

  it('leaves a comment cut from inside a regex out', () => {
    const output = processCode('export const x = /=>[ satisfies RegExp /*]/\n/** docs */\nexport const after = 1\n')
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain('/** docs */')
  })

  it('leaves a value whose last satisfies has nothing after it as before', () => {
    const output = processCode('export const x = 1 // => satisfies ;\n')
    expect(() => transpiler.transformSync(output)).not.toThrow()
  })
})
