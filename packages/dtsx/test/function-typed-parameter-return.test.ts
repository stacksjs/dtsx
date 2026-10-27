/**
 * An arrow function returning a parameter whose type is a function type got a
 * cut-off return type:
 *
 *   export const run = (g: () => void) => g
 *
 * emitted `(g: () => void) => ();`, which does not parse. The parameter types
 * were read up to their first `=`, taken as the start of a default, and the
 * first `=` of `() => void` belongs to the arrow.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-function-typed-params-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('returning a parameter with a function type', () => {
  it.each([
    [
      'function type',
      'export const run = (g: () => void) => g\n',
      'run: (g: () => void) => () => void;',
      'import { run } from \'./index\'\nconst g: () => void = run(() => {})\nexport {}\n',
    ],
    [
      'function type in an object type with a default',
      'export const options = (opts: { onDone?: (x: number) => void } = {}) => opts\n',
      'options: (opts?: { onDone?: (x: number) => void }) => { onDone?: (x: number) => void };',
      'import { options } from \'./index\'\nconst o: { onDone?: (x: number) => void } = options()\nexport {}\n',
    ],
    [
      'function type beside a defaulted parameter',
      'export const wrap = (fn: (a: string) => number, n = 1) => fn\n',
      'wrap: (fn: (a: string) => number, n?: number) => (a: string) => number;',
      'import { wrap } from \'./index\'\nconst n: number = wrap(a => a.length)(\'x\')\nexport {}\n',
    ],
    [
      'function type returning a type parameter',
      'export const make = <T>(create: () => T) => create\n',
      'make: <T>(create: () => T) => () => T;',
      'import { make } from \'./index\'\nconst n: number = make(() => 1)()\nexport {}\n',
    ],
    [
      'function type inside a type argument with a default',
      'export const handlers = (list: Array<() => void> = []) => list\n',
      'handlers: (list?: Array<() => void>) => Array<() => void>;',
      'import { handlers } from \'./index\'\nconst l: Array<() => void> = handlers()\nexport {}\n',
    ],
  ])('keeps the whole type: %s', async (_label, code, signature, consumer) => {
    const output = processCode(code)
    expect(output).toContain(signature)
    expect(await checkConsumer(output, consumer)).toBe('')
  })

  it.each([
    ['class method returning a function-typed parameter', 'export class K {\n  m(cb: () => void = () => {}) { return cb }\n}\n', 'm(cb?: () => void): () => void;'],
    ['a comment holding a quote', 'export function run(x: number /* user\'s choice */ = 1) { return x }\n', 'run(x?: number): number;'],
    ['a comment holding `>`', 'export function gt(x: number /* > 0 */ = 1) { return x }\n', 'gt(x?: number): number;'],
    ['a comment holding a comma', 'export function run(x: number /* = 1, default */ = 1) { return x }\n', 'run(x?: number): number;'],
    ['a quoted `<` that the parameter splitter counts', 'export function run(x: ({}) => \"<\", y: number = 1) { return x }\n', 'export declare function run('],
    ['a string literal type holding a comma', 'export function run(x: ({}) => \"a,b\") { return x }\n', 'export declare function run('],
    ['a string literal type holding an escaped quote and a comma', 'export function run(x: ({}) => \"a\\\",b\", y: \'c\\\',d\') { return x }\n', 'export declare function run('],
    ['a nested template literal type with a URL', 'export function run(x: `${`http://x`}` = \'http://x\') { return x }\n', 'export declare function run('],
  ])('reads the type up to its default: %s', (_label, code, signature) => {
    const output = processCode(code)
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain(signature)
  })
})
