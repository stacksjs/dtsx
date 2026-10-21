/**
 * A protected constructor was emitted as a public one:
 *
 *   export class Singleton {
 *     protected constructor(name: string) {}
 *     static create(): Singleton { ... }
 *   }
 *
 * emitted `constructor(name: string);`, so `new Singleton('x')` type-checked
 * against the declarations although only subclasses and the class itself may
 * construct it.
 */
import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-protected-constructor-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('protected constructor', () => {
  it.each([
    [
      'plain',
      'export class Singleton {\n  protected constructor(name: string) {}\n  static create(): Singleton { return new Singleton(\'x\') }\n}\n',
      'protected constructor(name: string);',
      'import { Singleton } from \'./index\'\nconst s: Singleton = Singleton.create()\nexport class Named extends Singleton {\n  constructor() { super(\'named\') }\n}\nnew Named()\n// @ts-expect-error the constructor is protected\nnew Singleton(\'x\')\nexport {}\n',
    ],
    [
      'with a parameter property',
      'export class Entity {\n  protected constructor(public readonly id: number) {}\n}\n',
      'protected constructor(id: number);',
      'import { Entity } from \'./index\'\nexport class User extends Entity {\n  constructor() { super(1) }\n}\nconst id: number = new User().id\n// @ts-expect-error the constructor is protected\nnew Entity(1)\nexport {}\n',
    ],
    [
      'overloads',
      'export class Point {\n  protected constructor(x: number, y: number)\n  protected constructor(xy: [number, number])\n  protected constructor(a: any, b?: any) {}\n}\n',
      'protected constructor(x: number, y: number);',
      'import { Point } from \'./index\'\nexport class Origin extends Point {\n  constructor() { super(0, 0) }\n}\n// @ts-expect-error the constructor is protected\nnew Point(0, 0)\nexport {}\n',
    ],
  ])('stays protected: %s', async (_label, code, constructor, consumer) => {
    const output = processCode(code)
    expect(output).toContain(constructor)
    expect(await checkConsumer(output, consumer)).toBe('')
  })

  it.each([
    ['public modifier', 'export class C {\n  public constructor(a: string) {}\n}\n'],
    ['a field named protected on the line before', 'export class C {\n  protected\n  constructor(a: string) { this.protected = a }\n}\n'],
    ['a line break inside a comment after protected', 'export class C {\n  protected /*\n  */ constructor(a: string) { this.protected = a }\n}\n'],
  ])('leaves a public constructor public: %s', async (_label, code) => {
    const output = processCode(code)
    expect(output).toContain('  constructor(a: string);')
    expect(output).not.toContain('protected constructor')
    expect(await checkConsumer(output, 'import { C } from \'./index\'\nnew C(\'x\')\nexport {}\n')).toBe('')
  })
})
