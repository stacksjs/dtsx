import { describe, expect, test } from 'bun:test'
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
