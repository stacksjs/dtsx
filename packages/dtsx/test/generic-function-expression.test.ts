/**
 * A named function expression lost its type parameters:
 *
 *   export const identity = function id<T>(value: T): T { return value }
 *
 * emitted `(value: T) => T`, where `T` is not declared (TS2304). The parser
 * looked for type parameters right after `function`, where an anonymous
 * function expression has them, not after the name.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-generic-function-expression-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('function expressions with type parameters', () => {
  it.each([
    [
      'named',
      'export const identity = function id<T>(value: T): T { return value }\n',
      'identity: <T>(value: T) => T;',
      'import { identity } from \'./index\'\nconst n: number = identity(1)\nexport {}\n',
    ],
    [
      'named, with a constraint and a default',
      'export const pick = function pick<K extends string, V = number>(key: K, value: V): V { return value }\n',
      'pick: <K extends string, V = number>(key: K, value: V) => V;',
      'import { pick } from \'./index\'\nconst s: string = pick(\'a\', \'b\')\nexport {}\n',
    ],
    [
      'named generator',
      'export const repeat = function* repeat<T>(value: T): Generator<T> { yield value }\n',
      'repeat: <T>(value: T) => Generator<T>;',
      'import { repeat } from \'./index\'\nconst g: Generator<number> = repeat(1)\nexport {}\n',
    ],
    [
      'anonymous',
      'export const anon = function <T>(value: T): T { return value }\n',
      'anon: <T>(value: T) => T;',
      'import { anon } from \'./index\'\nconst n: number = anon(1)\nexport {}\n',
    ],
    [
      'named, with a space before them',
      'export const spaced = function id <T>(value: T): T { return value }\n',
      'spaced: <T>(value: T) => T;',
      'import { spaced } from \'./index\'\nconst n: number = spaced(1)\nexport {}\n',
    ],
  ])('keeps them: %s', async (_label, code, signature, consumer) => {
    const output = processCode(code)
    expect(output).toContain(signature)
    expect(await checkConsumer(output, consumer)).toBe('')
  })

  it.each([
    ['a quoted `>` in a constraint', 'export const f = function id<T extends \">\">(value: number): number { return value }\n', 'f: (value: number) => number;'],
    ['a quoted `<` in a constraint', 'export const f = function id<T extends \"<\">(value: number): number { return value }\n', 'f: (value: number) => number;'],
    ['a quoted `>` after a space', 'export const f = function id <T extends \'>\'>(value: number): number { return value }\n', 'f: (value: number) => number;'],
    ['a comment holding `>`', 'export const f = function id<T /* values > 0 */>(value: number): number { return value }\n', 'f: (value: number) => number;'],
    ['a type parameter naming the function itself', 'export const f = function id<T = typeof id>(value: number): number { return value }\n', 'f: (value: number) => number;'],
    ['a call to a function whose name starts with `function`', 'declare function functionFactory<T>(): () => unknown\nexport const f = functionFactory<string>()\n', 'f: () => unknown;'],
  ])('reads as before: %s', (_label, code, signature) => {
    expect(processCode(code)).toContain(signature)
  })
})
