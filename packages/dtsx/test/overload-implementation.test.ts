/**
 * An overloaded function lost a public overload and kept its implementation
 * signature when a local type was pulled into the declaration file:
 *
 *   interface I { a: number }
 *   export function f(x: string): string
 *   export function f(x: number): number
 *   export function f(x: unknown): unknown { return x }
 *   export const value: I = { a: 1 }
 *
 * emitted `f(x: string)` and `f(x: unknown): unknown`, so `f(1)` became
 * `unknown` and `f(true)` type-checked. The implementation was remembered by
 * its index in `declarations`, and declaring `I` shifted every index after it,
 * so the removal hit the overload before the implementation.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-overloads-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('overloads alongside a declared local type', () => {
  it.each([
    [
      'local interface before the overloads',
      'interface I { a: number }\nexport function f(x: string): string\nexport function f(x: number): number\nexport function f(x: unknown): unknown { return x }\nexport const value: I = { a: 1 }\n',
      ['f(x: string): string;', 'f(x: number): number;'],
      'f(x: unknown)',
      'import { f } from \'./index\'\nconst s: string = f(\'a\')\nconst n: number = f(1)\n// @ts-expect-error no public overload takes a boolean\nf(true)\nexport {}\n',
    ],
    [
      'default export',
      'interface Opts { a: number }\nexport default function make(x: string): Opts\nexport default function make(x: number): number\nexport default function make(x: any): any { return x }\n',
      ['make(x: string): Opts;', 'make(x: number): number;'],
      'make(x: any)',
      'import make from \'./index\'\nconst o: { a: number } = make(\'a\')\nconst n: number = make(1)\n// @ts-expect-error no public overload takes a boolean\nmake(true)\nexport {}\n',
    ],
    [
      'two overloaded functions',
      'interface A { a: number }\ninterface B { b: number }\nexport function f(x: string): A\nexport function f(x: number): number\nexport function f(x: any): any { return x }\nexport function g(x: string): B\nexport function g(x: number): number\nexport function g(x: any): any { return x }\n',
      ['f(x: string): A;', 'f(x: number): number;', 'g(x: string): B;', 'g(x: number): number;'],
      '(x: any)',
      'import { f, g } from \'./index\'\nconst a: { a: number } = f(\'a\')\nconst b: { b: number } = g(\'b\')\n// @ts-expect-error no public overload takes a boolean\nf(true)\n// @ts-expect-error no public overload takes a boolean\ng(true)\nexport {}\n',
    ],
  ])('keeps the public overloads: %s', async (_label, code, overloads, implementation, consumer) => {
    const output = processCode(code)
    for (const overload of overloads)
      expect(output).toContain(overload)
    expect(output).not.toContain(implementation)
    expect(await checkConsumer(output, consumer)).toBe('')
  })
})

describe('a named and a default export of the same name', () => {
  it.each([
    ['named signature, default implementation', 'interface Input { value: number }\ninterface Output { result: number }\nexport function make(input: Input): Output\nexport default function make(input: Input): Output { return { result: input.value } }\n'],
    ['default signature, named implementation', 'interface Input { value: number }\ninterface Output { result: number }\nexport default function make(input: Input): Output\nexport function make(input: Input): Output { return { result: input.value } }\n'],
    ['no local types', 'export function make(input: { value: number }): { result: number }\nexport default function make(input: { value: number }): { result: number } { return { result: input.value } }\n'],
  ])('keeps both: %s', async (_label, code) => {
    const output = processCode(code)
    expect(output).toContain('export declare function make(')
    expect(output).toContain('export default function make(')
    const consumer = 'import make, { make as named } from \'./index\'\nconst a: number = make({ value: 1 }).result\nconst b: number = named({ value: 1 }).result\nexport {}\n'
    expect(await checkConsumer(output, consumer)).toBe('')
  })
})
