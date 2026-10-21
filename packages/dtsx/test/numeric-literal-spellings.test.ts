/**
 * A number written any way but plain decimal was typed `unknown`:
 *
 *   export const TIMEOUT_MS = 30_000
 *   export const MASK = 0xff
 *   export const EPSILON = 1e-9
 *
 * all came out `unknown`, and so did a `let`, an object property, a parameter
 * default or a class field initialized that way. Both copies of
 * `isNumericLiteral` accepted only `-?\d+(\.\d+)?`, and the BigInt check only
 * decimal digits. The Zig port already reads every spelling below.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

describe('numeric literal spellings', () => {
  it.each([
    ['separators', 'export const a = 30_000\n', 'const a: 30_000;'],
    ['hexadecimal', 'export const a = 0xff\n', 'const a: 0xff;'],
    ['binary', 'export const a = 0b101\n', 'const a: 0b101;'],
    ['octal', 'export const a = 0o17\n', 'const a: 0o17;'],
    ['exponent', 'export const a = -2.5e-3\n', 'const a: -2.5e-3;'],
    ['leading dot', 'export const a = .5\n', 'const a: .5;'],
    ['let', 'export let a = 1e3\n', 'let a: number;'],
    ['object property', 'export let a = { max: 0x10 }\n', 'max: number'],
    ['parameter default', 'export function f(ms = 1_000): number { return ms }\n', 'f(ms?: number): number;'],
    ['class field', 'export class C { size = 0x10 }\n', 'size: number;'],
    ['BigInt', 'export const a = 0xffn\n', 'const a: 0xffn;'],
    ['trailing dot', 'export const a = 3.\n', 'const a: 3.;'],
    ['negative separated BigInt', 'export const a = -1_000n\n', 'const a: -1_000n;'],
    ['static readonly class constant', 'export class C { static readonly MASK = -0x10 }\n', 'static readonly MASK: -0x10;'],
  ])('types it: %s', (_label, code, expected) => {
    const output = processCode(code)
    expect(output).toContain(expected)
    expect(output).not.toContain('unknown')
  })

  it.each([
    ['separator after a leading zero', 'export const a = 0_1\n'],
    ['doubled separator', 'export const a = 1__0\n'],
    ['BigInt with a leading zero', 'export const a = 0_1n\n'],
  ])('leaves a malformed spelling alone: %s', (_label, code) => {
    expect(processCode(code)).toContain('const a: unknown;')
  })

  it('gives a consumer the values it was written with', async () => {
    const output = processCode('export const TIMEOUT_MS = 30_000\nexport const MASK = 0xff\nexport const EPSILON = 1e-9\nexport const BIG = 0xffn\nexport class Flags { static readonly ALL = 0b111 }\n')
    const dir = await mkdtemp(join(tmpdir(), 'dtsx-numbers-'))
    try {
      await writeFile(join(dir, 'index.d.ts'), output)
      await writeFile(join(dir, 'use.ts'), 'import { TIMEOUT_MS, MASK, EPSILON, BIG, Flags } from \'./index\'\nconst a: 30000 = TIMEOUT_MS\nconst b: 255 = MASK\nconst c: number = EPSILON\nconst d: 255n = BIG\nconst e: 7 = Flags.ALL\nexport {}\n')
      expect(runTsc(dir, ['index.d.ts', 'use.ts']).output).toBe('')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
