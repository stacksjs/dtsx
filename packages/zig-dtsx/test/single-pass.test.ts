import { describe, expect, test } from 'bun:test'
import { processSource as processWithTypeScript } from '../../dtsx/src/index'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

// A file with imports infers each variable while it looks for the imports the
// declarations reference, then reuses that inference when it emits them. A
// file without imports infers only at emission. Both must print the same text.
const variables = `
export const plain = { port: 3000, nested: { retries: [1, 2, 4], label: 'a' } }

/** The server defaults. */
export const documented = { host: 'localhost', secure: false }

// one line comment
export const lineCommented = [1, 2, 3]

/** @defaultValue \`custom\` */
export const ownDefault = { timeout: 1000 }

/** A counter. */
export let counter = 0
export let label = 'ready'
export const frozen = { mode: 'strict', levels: ['a', 'b'] } as const
export const handler = (value: number): string => value.toFixed(2)
`

const imports = `import type { Used } from './used'
import { unused } from './unused'
`
const usesImport = `export const typed: Used = { id: 1 }
export const viaValue = { make: (): Used => ({ id: 2 }) }
`

describeIf('variable inference reuse', () => {
  for (const keepComments of [true, false]) {
    test(`imports do not change variable declarations (comments ${keepComments ? 'kept' : 'dropped'})`, () => {
      const withoutImports = processSource(variables, keepComments).trim()
      const withImports = processSource(imports + variables + usesImport, keepComments).trim()
      for (const line of withoutImports.split('\n')) expect(withImports).toContain(line)
      expect(withImports).toContain(withoutImports)
    })
  }

  test('a generated default is dropped only when the kept comment has its own', () => {
    const kept = processSource(imports + variables + usesImport, true)
    expect(kept).toContain('/** @defaultValue `custom` */\nexport declare const ownDefault')
    expect(kept).toContain('/**\n * The server defaults.\n * @defaultValue `{ host: \'localhost\', secure: false }`\n */')
    const dropped = processSource(imports + variables + usesImport, false)
    expect(dropped).toContain('/** @defaultValue `{ timeout: 1000 }` */\nexport declare const ownDefault')
    expect(dropped).not.toContain('The server defaults.')
  })

  test('only imports referenced by the declarations are kept', () => {
    const output = processSource(imports + variables + usesImport, true)
    expect(output).toContain(`import type { Used } from './used';`)
    expect(output).not.toContain('unused')
  })
})

// Parameter lists without modifiers are copied through unchanged; a modifier
// is a whole word, wherever it sits in the list.
describeIf('parameter modifier detection', () => {
  test('a modifier after a name that merely contains one is still stripped', () => {
    const output = processSource('export class A { constructor(isprivate: boolean, private x: string, readonlyish: number, readonly y: number) {} }', true)
    expect(output).toContain('constructor(isprivate: boolean, x: string, readonlyish: number, y: number);')
    expect(output).toContain('private x;')
    expect(output).toContain('readonly y: number;')
  })

  test('names that start like a modifier pass through', () => {
    expect(processSource('export function f(reporter: string, options: number, publicPath: string, overrides: string[]): void {}', true))
      .toContain('f(reporter: string, options: number, publicPath: string, overrides: string[]): void;')
  })
})

// Each initializer is classified by probing for an arrow, a comma operator and
// binary operators. The probes skip values that cannot contain the token; the
// declarations must stay exactly what the TypeScript engine prints.
describeIf('initializer probes', () => {
  test.each([
    ['arrow', '(value: number): string => String(value)'],
    ['async arrow', 'async (id: string): Promise<number> => id.length'],
    ['function expression', 'function (a: number, b: number): number { return a + b }'],
    ['async function expression', 'async function load(): Promise<void> {}'],
    ['arrows nested in an object', '{ parse: (text: string): number => Number(text), limits: [1, 2], name: \'x\' }'],
    ['arrow inside a call argument', '[1, 2, 3].map((n: number): number => n * 2)'],
    ['comma operator', '(1, \'last\')'],
    ['commas only inside brackets', '[1, 2, { a: 3, b: [4, 5] }]'],
    ['conditional', 'Math.random() > 0.5 ? \'yes\' : 42'],
    ['nullish and logical', 'process.env.NAME ?? \'fallback\''],
    ['arithmetic', '2 * 3 + 4'],
    ['string concatenation', '\'a\' + 1'],
    ['comparison', '1 < 2'],
    ['operator text inside a string', '\'a ? b : c, d => e && f\''],
    ['bitwise', '1 << 4'],
    ['instanceof', 'globalThis instanceof Object'],
  ])('%s', (_name, initializer) => {
    const source = `export const value = ${initializer}\nexport let mutable = ${initializer}\n`
    expect(processSource(source, true).trim()).toBe(processWithTypeScript(source, 'value.ts').trim())
  })
})
