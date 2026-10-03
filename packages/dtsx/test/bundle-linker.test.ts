import { describe, expect, it } from 'bun:test'
import { renameIdentifiers, splitTopLevelStatements } from '../src/bundle-linker'

describe('splitTopLevelStatements', () => {
  it('keeps multi-line declarations whole and attaches leading comments', () => {
    const statements = splitTopLevelStatements([
      '/** Creates a client. */',
      'export declare const createClient: (config?: {',
      '  baseUrl?: string',
      '}, retries?: number) => void;',
      'export declare interface A {',
      '  b: string',
      '}',
      'export type T = `prefix-${string}` | \'}\';',
    ].join('\n'))

    expect(statements.map(statement => statement.text)).toEqual([
      'export declare const createClient: (config?: {\n  baseUrl?: string\n}, retries?: number) => void;',
      'export declare interface A {\n  b: string\n}',
      'export type T = `prefix-${string}` | \'}\';',
    ])
    expect(statements[0].comments).toEqual(['/** Creates a client. */'])
  })
})

describe('renameIdentifiers', () => {
  it('renames references but not property names, members or strings', () => {
    const renames = new Map([['Options', 'Options_1']])
    const text = 'declare function f(options: Options, o: { Options: string, x?: Options }): Ns.Options | \'Options\';'
    expect(renameIdentifiers(text, renames)).toBe(
      'declare function f(options: Options_1, o: { Options: string, x?: Options_1 }): Ns.Options | \'Options\';',
    )
  })
})
