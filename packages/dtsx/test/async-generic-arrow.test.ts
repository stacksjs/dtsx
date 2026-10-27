/**
 * An async arrow function with type parameters got them wrapped into its
 * parameter list:
 *
 *   export const load = async <T>(key: string, fallback: T): Promise<T> => ...
 *
 * emitted `(<T>(key: string, fallback: T): Promise<T>) => Promise<unknown>`,
 * which does not parse. The async branch of inferFunctionType did not take
 * leading type parameters off as the branch for other arrows does.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-async-generic-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('async arrow functions with type parameters', () => {
  it.each([
    [
      'annotated return type',
      'export const load = async <T>(key: string, fallback: T): Promise<T> => fallback\n',
      'load: <T>(key: string, fallback: T) => Promise<T>;',
      'import { load } from \'./index\'\nconst p: Promise<number> = load(\'k\', 1)\nexport {}\n',
    ],
    [
      'constraint holding an arrow type and a block body',
      'export const run = async <T, U extends () => void>(a: T, done: U): Promise<T> => { done(); return a }\n',
      'run: <T, U extends () => void>(a: T, done: U) => Promise<T>;',
      'import { run } from \'./index\'\nconst p: Promise<string> = run(\'x\', () => {})\nexport {}\n',
    ],
    [
      'type parameter default',
      'export const wrap = async <T = string>(a: T) => [a]\n',
      'wrap: <T = string>(a: T) =>',
      'import { wrap } from \'./index\'\nwrap(1)\nexport {}\n',
    ],
  ])('keeps them in front: %s', async (_label, code, signature, consumer) => {
    const output = processCode(code)
    expect(output).toContain(signature)
    expect(await checkConsumer(output, consumer)).toBe('')
  })
})
