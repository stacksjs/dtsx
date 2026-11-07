import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { DeclarationPackageCase } from './helpers/declaration-package'
import { checkDeclarationPackage } from './helpers/declaration-package'
import { traceSync } from './helpers/phase-trace'

function getter(source: string, read: string, type: string, wrongType: string, assignment: string): DeclarationPackageCase {
  return {
    source,
    positive: `const value: ${type} = ${read}; void value`,
    negatives: [
      { code: 2322, content: `const invalid: ${wrongType} = ${read}; void invalid` },
      { code: 2540, content: assignment },
    ],
  }
}

const cases: Record<string, DeclarationPackageCase> = {
  'a getter literal return': getter(
    'export class Counter { get value() { return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'a static getter literal return': getter(
    'export class Counter { static get value() { return 7 } }',
    'api.Counter.value', 'number', 'string', 'api.Counter.value = 8',
  ),
  'a quoted getter return': getter(
    'export class Counter { get "value"() { return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'a getter with multiple return branches': getter(
    'export class Counter { get value() { if (Math.random() > 0.5) return 7; return "seven" } }',
    'new api.Counter().value', 'number | string', 'boolean', 'new api.Counter().value = 8',
  ),
  'a getter object return': getter(
    'export class Counter { get value() { return { count: 7 } } }',
    'new api.Counter().value', '{ count: number }', '{ count: string }', 'new api.Counter().value = { count: 8 }',
  ),
  'a getter promise return': getter(
    'export class Counter { get value() { return Promise.resolve(7) } }',
    'new api.Counter().value', 'Promise<number>', 'Promise<string>', 'new api.Counter().value = Promise.resolve(8)',
  ),
  'a getter whose nested function return is unrelated': getter(
    'export class Counter { get value() { function hidden() { return "text" }; void hidden; return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'a nested function with an object default': getter(
    'export class Counter { get value() { function hidden(input = { message: "text" }) { return input.message }; void hidden; return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'a nested generic function with an object return annotation': getter(
    'export class Counter { get value() { function hidden<T extends { message: string }>(input: T): { message: string } { return input }; void hidden; return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'a nested generic class implementation': getter(
    'export class Counter { get value() { class Hidden<T extends { message: string }> { value(): string { return "text" } }; void Hidden; return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'a nested arrow body following a comment': getter(
    'export class Counter { get value() { const hidden = () => /* own scope */ { return "text" }; void hidden; return 7 } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'an explicit getter annotation control': getter(
    'export class Counter { get value(): number { return Math.abs(-7) } }',
    'new api.Counter().value', 'number', 'string', 'new api.Counter().value = 8',
  ),
  'an inferred getter with a matching setter type': {
    source: 'export class Counter { get value() { return 7 } set value(input: number) { void input } }',
    positive: 'const counter = new api.Counter(); const value: number = counter.value; counter.value = 8; void value',
    negatives: [
      { code: 2322, content: 'const invalid: string = new api.Counter().value; void invalid' },
      { code: 2322, content: 'new api.Counter().value = true' },
    ],
  },
  'a separately typed setter control': {
    source: 'export class Counter { get value(): number { return 7 } set value(input: string) { void input } }',
    positive: 'const counter = new api.Counter(); const value: number = counter.value; counter.value = "7"; void value',
    negatives: [
      { code: 2322, content: 'const invalid: string = new api.Counter().value; void invalid' },
      { code: 2322, content: 'new api.Counter().value = true' },
    ],
  },
}

test('ordinary TypeScript identifies the multi-branch getter as TS9009 under isolated declaration emit', async () => {
  const source = cases['a getter with multiple return branches'].source
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-getter-diagnostic-'))
  try {
    await writeFile(join(directory, 'index.ts'), source)
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], declaration: true, emitDeclarationOnly: true, isolatedDeclarations: true, noEmitOnError: true, outDir: './reference' }, files: ['index.ts'] }))
    const compiler = resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js')
    const args = [process.execPath, compiler, '--project', 'tsconfig.json']
    const result = traceSync('TypeScript getter diagnostic oracle', () => Bun.spawnSync(args, { cwd: directory, timeout: 4000 }), { cwd: directory, args, sourceHash: new Bun.CryptoHasher('sha256').update(source).digest('hex') })
    const diagnostics = result.stdout.toString() + result.stderr.toString()
    expect(result.exitCode, diagnostics).toBe(1)
    expect(diagnostics.match(/error TS\d+/g), diagnostics).toEqual(['error TS9009'])
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

for (const producer of ['core', 'bun-plugin', 'native'] as const) {
  for (const [name, fixture] of Object.entries(cases))
    test(`${producer} preserves ${name} in a strict installed package`, () => checkDeclarationPackage(producer, fixture))
}
