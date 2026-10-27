/**
 * An arrow function's destructured parameter kept its default values:
 *
 *   export const glob = ({ cwd, gitignore = true }: GlobOptions) => ...
 *
 * emitted `({ cwd, gitignore = true }: GlobOptions) => ...`, and TypeScript
 * rejects an initializer in a declaration (TS2371). knip's `util/glob` came out
 * this way. A function declaration's parameters already lost them.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-pattern-defaults-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('destructured arrow parameters with defaults', () => {
  it.each([
    [
      'object pattern',
      'export interface GlobOptions { cwd: string, dir?: string, gitignore?: boolean }\nexport const glob = ({ cwd, dir = cwd, gitignore = true }: GlobOptions): string => dir + gitignore\n',
      '({ cwd, dir, gitignore }: GlobOptions) => string',
      'import { glob } from \'./index\'\nconst s: string = glob({ cwd: \'.\' })\nexport {}\n',
    ],
    [
      'array pattern',
      'export const first = ([x = 0, y]: [number?, number?]): number => x\n',
      '([x, y]: [number?, number?]) => number',
      'import { first } from \'./index\'\nconst n: number = first([])\nexport {}\n',
    ],
    [
      'nested pattern with its own default',
      'export const pick = ({ o: { p = \'z\' } = {} }: { o?: { p?: string } }): string => p\n',
      '({ o: { p } }: { o?: { p?: string } }) => string',
      'import { pick } from \'./index\'\nconst s: string = pick({})\nexport {}\n',
    ],
    [
      'pattern with a parameter default',
      'export const add = (n = 5, { m = 2 }: { m?: number } = {}): number => n + m\n',
      '(n?: number, { m }?: { m?: number }) => number',
      'import { add } from \'./index\'\nconst a: number = add()\nconst b: number = add(1, { m: 3 })\nexport {}\n',
    ],
    [
      'defaults that are names, numbers, strings and empty literals, and a rest element',
      'export interface Opts { a?: number, b?: number, c?: string, d?: string, e?: string[], f?: object, g?: boolean }\nconst base = { c: \'x\' }\nexport const opts = ({ a = 1.5, b = -2, c = base.c, d = \'q\', e = [], f = {}, ...rest }: Opts): number => a + b\n',
      '({ a, b, c, d, e, f, ...rest }: Opts) => number',
      'import { opts } from \'./index\'\nconst n: number = opts({})\nexport {}\n',
    ],
    [
      'two patterns around a generic type',
      'export const f = ({ a = 1 }: { a?: number }, b: Map<string, { c: number }>, { d = 2 }: { d?: number }): number => a\n',
      '({ a }: { a?: number }, b: Map<string, { c: number }>, { d }: { d?: number }) => number',
      'import { f } from \'./index\'\nconst n: number = f({}, new Map(), {})\nexport {}\n',
    ],
  ])('leaves the defaults out: %s', async (_label, code, signature, consumer) => {
    const output = processCode(code)
    expect(output).toContain(signature)
    expect(await checkConsumer(output, consumer)).toBe('')
  })

  it.each([
    ['a line comment holding `=`', 'export const f = ({ x, // seconds = ms / 1000\n  y }: { x: number, y: number }): number => 1\n', '// seconds = ms / 1000\n  y }'],
    ['a default with type arguments', 'export const f = ({ map = new Map<string, number>() }: { map?: Map<string, number> }): number => 1\n', '{ map = new Map<string, number>() }'],
    ['a computed key with an assignment', 'let key: string | undefined\nexport const f = ({ [key ??= \'x\']: x }: Record<string, number>): number => x\n', '[key ??= \'x\']: x'],
    ['a default with operators, a string holding `=` and an arrow', 'export const f = ({ s = \'x=y\', eq = 1 === 1, cb = (q: number) => q }: { s?: string, eq?: boolean, cb?: (q: number) => number }): string => s\n', '{ s = \'x=y\', eq = 1 === 1, cb = (q: number) => q }'],
    ['comparisons in two patterns', 'type B = { b?: boolean }\nexport const f = ({ a = 1 < 2 }, { b = 2 > 1 }: B): boolean => !!a && !!b\n', '({ a = 1 < 2 }, { b = 2 > 1 }: B)'],
    ['a computed key with a default', 'let key: \'a\' | \'b\' = \'a\'\nexport const f = ({ [key = \'b\']: value }: { a: string, b: number }, n = 1): typeof value => value\n', '{ [key = \'b\']: value }'],
    ['a regex default holding a comma', 'export const f = ({ re = /a,b/ }: { re?: RegExp }): number => 1\n', '{ re = /a,b/ }'],
    ['a regex default holding `,b=`', 'export const f = ({ re = /a,b=c/ }: { re?: RegExp }): boolean => re.test(\'a\')\n', '{ re = /a,b=c/ }'],
    ['a default holding a block comment', 'export const f = ({ n = 1 /* a,b=c */ }: { n?: number }): number => n\n', '{ n = 1 /* a,b=c */ }'],
    ['a default holding a nested template literal', 'export const f = ({ t = `${`a,b=c`}` }: { t?: string }): string => t\n', '{ t = `${`a,b=c`}` }'],
    ['a pattern without a type, whose defaults give its type', 'export const f = ({ verbose = false }): boolean => verbose\n', '{ verbose = false }'],
    ['a parameter beside it with a block comment', 'export const f = ({ a = 1 }: { a?: number }, /* note */ b: string): number => a\n', '({ a = 1 }: { a?: number }, /* note */ b: string)'],
    ['a regex that looks like another parameter', 'export const f = ({ re = /}, { b = 2 }:B/ }: { re?: RegExp }): number => 1\n', '{ re = /}, { b = 2 }:B/ }'],
    ['a parameter beside it with a nested template literal type', 'export const f = ({ x = 1 }: { x?: number }, query: `?${`id=${number}`}`): number => x\n', '({ x = 1 }: { x?: number }, query: `?${`id=${number}`}`)'],
    ['a parameter beside it with `//` in a comment', 'export const f = ({ x = 1 }: { x?: number }, /** See https://example.com */ y: number): number => x + y\n', '/** See https://example.com */ y: number'],
  ])('leaves a pattern it cannot cut cleanly as written: %s', (_label, code, kept) => {
    expect(processCode(code)).toContain(kept)
  })

  it('keeps an unannotated pattern beside it as written', () => {
    expect(processCode('export const f = ({ op = \'<\' }: { op?: string }, { valid = 1 > 0, verbose = false }): string => op\n'))
      .toContain('({ op }: { op?: string }, { valid = 1 > 0, verbose = false }) => string')
  })
})
