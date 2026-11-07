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

  it('preserves generic bindings and scopes while renaming outer type and value references', () => {
    const renames = new Map([['T', 'T_1'], ['Box', 'Box_1']])
    expect(renameIdentifiers('declare class Box<T> extends T { value: T; source: typeof T; }', renames)).toBe('declare class Box_1<T> extends T_1 { value: T; source: typeof T_1; }')
    expect(renameIdentifiers('interface Box<T> { value: T; }', renames)).toBe('interface Box_1<T> { value: T; }')
    expect(renameIdentifiers('type Methods = { pick: <T>(value: T) => T; outer: T; };', renames)).toBe('type Methods = { pick: <T>(value: T) => T; outer: T_1; };')
    expect(renameIdentifiers('declare namespace Box { interface T { value: number } function make(value: T): T; }', renames)).toBe('declare namespace Box_1 { interface T { value: number } function make(value: T): T; }')
    expect(renameIdentifiers('type Label = `T-${T}`;', renames)).toBe('type Label = `T-${T_1}`;')
  })
})
