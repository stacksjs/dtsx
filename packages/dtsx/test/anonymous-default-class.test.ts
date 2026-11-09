/**
 * An anonymous default-exported class with a heritage clause lost it, and its
 * members with it:
 *
 *   export default class extends Base { c = 2 }
 *
 * emitted `export default class extends {}`, which does not parse.
 * `extractClass` read `extends` (or `implements`) as the class name. The class
 * now gets a helper name, `__dtsx_default_class__`, as a default-exported
 * expression gets `__dtsx_default_export__`.
 */
import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { runTsc } from './helpers/tsc'
import { processCode } from './test-utils'

/** Type-check `consumer` against the generated declarations as `./index`. */
async function checkConsumer(dts: string, consumer: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dtsx-anonymous-class-'))
  try {
    await writeFile(join(dir, 'index.d.ts'), dts)
    await writeFile(join(dir, 'use.ts'), consumer)
    return runTsc(dir, ['index.d.ts', 'use.ts']).output
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('anonymous default class with a heritage clause', () => {
  it.each([
    [
      'extends',
      'class Base { b = 1 }\nexport default class extends Base { c = 2 }\n',
      'export default class __dtsx_default_class__ extends Base {',
      'import C from \'./index\'\nconst c = new C()\nconst n: number = c.b + c.c\nexport {}\n',
    ],
    [
      'implements',
      'interface Named { name(): string }\nexport default class implements Named { name(): string { return \'x\' } }\n',
      'export default class __dtsx_default_class__ implements Named {',
      'import C from \'./index\'\nconst s: string = new C().name()\nexport {}\n',
    ],
    [
      'abstract, implements',
      'export default abstract class implements Iterable<number> { abstract [Symbol.iterator](): Iterator<number> }\n',
      'export default abstract class __dtsx_default_class__ implements Iterable<number> {',
      'import C from \'./index\'\nexport class D extends C { *[Symbol.iterator](): Iterator<number> { yield 1 } }\nconst all: number[] = [...new D()]\n',
    ],
    [
      'generic, extends',
      'class Box<T> { value!: T }\nexport default class<T> extends Box<T> { label = \'\' }\n',
      'export default class AnonymousClass<T> extends Box<T> {',
      'import C from \'./index\'\nconst c = new C<number>()\nconst n: number = c.value\nconst s: string = c.label\nexport {}\n',
    ],
    [
      'beside a class named AnonymousClass',
      'interface Marker {}\nexport class AnonymousClass { tag = \'real\' }\nexport default class implements Marker { id = 1 }\n',
      'export default class __dtsx_default_class__ implements Marker {',
      'import C, { AnonymousClass } from \'./index\'\nconst n: number = new C().id\nconst s: string = new AnonymousClass().tag\nexport {}\n',
    ],
  ])('keeps the clause and the members: %s', async (_label, code, header, consumer) => {
    const output = processCode(code)
    expect(output).toContain(header)
    expect(await checkConsumer(output, consumer)).toBe('')
  })

  it.each([
    ['ambient class', 'export declare class implements { c: number }\n', 'export declare class implements {'],
    ['default class', 'export default class implements { c = 1 }\n', 'export default class implements {'],
  ])('keeps a class named implements: %s', (_label, code, header) => {
    expect(processCode(code)).toContain(header)
  })

  it('keeps the clause in a bundle', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-anonymous-class-bundle-'))
    try {
      await mkdir(join(cwd, 'src'))
      await writeFile(join(cwd, 'src', 'index.ts'), 'class Base { b = 1 }\nexport default class extends Base { c = 2 }\nexport * from \'./other\'\n')
      await writeFile(join(cwd, 'src', 'other.ts'), 'export class AnonymousClass { real = \'yes\' }\nexport type Label = `AnonymousClass-${string}`\n')
      await generate({ cwd, root: 'src', outdir: 'dist', entrypoints: ['index.ts'], bundle: true, clean: false, keepComments: false })
      expect(await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')).toContain('class __dtsx_default_class__ extends Base {')
      await writeFile(join(cwd, 'dist', 'use.ts'), 'import C, { AnonymousClass, type Label } from \'./index\'\nconst n: number = new C().b + new C().c\nconst real: string = new AnonymousClass().real\nconst label: Label = \'AnonymousClass-ok\'\nexport {}\n')
      expect(runTsc(join(cwd, 'dist'), ['index.d.ts', 'use.ts']).output).toBe('')
    }
    finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
