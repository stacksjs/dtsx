import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as native from '../../zig-dtsx/src'
import { generate } from '../src/generator'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { planNativeDeclarationProject } from '../src/native-project'
import { processSource } from '../src/process-source'
import { monomorphicImportFunctions } from '../src/inferred-imports'
import { isAvailable, runTsc } from './helpers/tsc'

const model = `export function makeRecord(key = 'record,default', amount = 2) { return { key, amount, labels: ['new'] } }
export function summarize(record = makeRecord()) { return { key: record.key, next: record.amount + 3 } }
export const build = (key = 'factory') => ({ key, amount: 2 });
export class Archive {
  read() { return this.record }
  async readAsync() { return this.record }
  get current() { return this.record }
  static read() { return this.record }
  private static record: number = 3;
  private record = makeRecord();
}
export function maybe(value?: string) { return value }
export function guaranteed(value = 'default') { return value }
`
const source = `import { makeRecord as importedRecord } from './model.js';
export const external = importedRecord('linked', 9);
export { makeRecord, summarize, build, Archive, maybe, guaranteed } from './model.js';
`
const consumer = `import { makeRecord, summarize, build, Archive, external, maybe, guaranteed } from './output/index.js';
type IsAny<T> = 0 extends (1 & T) ? true : false;
type NoAny<T extends false> = T;
const a: { key: string; amount: number; labels: string[] } = makeRecord();
const b: { key: string; next: number } = summarize();
const c: { key: string; amount: number } = build();
const d: typeof a = new Archive().read();
const e: typeof a = external;
const current: typeof a = new Archive().current;
const asyncRead: Promise<typeof a> = new Archive().readAsync();
const separate: number = Archive.read();
const f: string | undefined = maybe();
const g: string = guaranteed(undefined);
type Check1 = NoAny<IsAny<typeof d.key>>;
type Check2 = NoAny<IsAny<typeof e.amount>>;
const widened: typeof d = { key: 'different', amount: 17, labels: ['changed'] };
`

for (const producer of ['core', 'bundle', 'native', 'native-cli'] as const) {
  test(`${producer} preserves default bindings, private fields, projections and resolved imported calls`, async () => {
    expect(isAvailable).toBe(true)
    if (producer === 'native') expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'dtsx-default-inference-'))
    try {
      await mkdir(join(root, 'src'))
      await writeFile(join(root, 'package.json'), '{"type":"module"}')
      await writeFile(join(root, 'src/model.ts'), model)
      await writeFile(join(root, 'src/index.ts'), source)
      await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, types: [], target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: false, noEmit: true }, files: ['consumer.ts'] }))
      const options = { cwd: root, root: 'src', outdir: 'output', entrypoints: ['index.ts'], isolatedDeclarations: false }
      if (producer === 'native-cli') {
        await generateNativeDeclarationProject(join(import.meta.dir, '../../zig-dtsx/zig-out/bin/zig-dtsx'), options)
      }
      else if (producer === 'native') {
        const project = await planNativeDeclarationProject(options)
        for (const file of project.files) {
          await mkdir(dirname(file.outputFile), { recursive: true })
          await writeFile(file.outputFile, native.processSourceWithContext(file.source, file.context, true, false))
        }
      }
      else {
        const stats = await generate({ ...options, incremental: false, bundle: producer === 'bundle', bundleOutput: 'index.d.ts' })
        expect(stats.filesFailed, JSON.stringify(stats.errors)).toBe(0)
      }
      await writeFile(join(root, 'consumer.ts'), consumer)
      const positive = runTsc(root, ['--project', 'tsconfig.json'])
      expect(positive.ok, positive.output).toBe(true)
      await writeFile(join(root, 'consumer.ts'), `import { Archive, guaranteed, maybe } from './output/index.js';\nconst wrong: number = new Archive().read().key;\nconst optional: string = maybe();\nconst bad: number = guaranteed();\n`)
      const negative = runTsc(root, ['--project', 'tsconfig.json'])
      expect(negative.ok, negative.output).toBe(false)
      expect(negative.output.match(/error TS\d+/g), negative.output).toEqual(['error TS2322', 'error TS2322', 'error TS2322'])
      expect(await readFile(join(root, 'output/index.d.ts'), 'utf8')).not.toContain('__dtsx_member_return_')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
}

for (const producer of [{ name: 'core', emit: (text: string) => processSource(text) }, { name: 'native', emit: (text: string) => native.processSource(text) }]) {
  describe(`${producer.name} default-binding scope`, () => {
    test('distinguishes optional arguments from initialized body bindings in functions and arrows', () => {
      const output = producer.emit(`export function optional(value?: number) { return value }\nexport function initialized(value = 41) { return value }\nexport const arrow = (value = 41) => value;`)
      expect(output).toMatch(/optional\(value\?: number\): \(number\) \| undefined/)
      expect(output).toContain('initialized(value?: number): number')
      expect(output).toContain('arrow: (value?: number) => number')
    })
    test('does not interpret a multi-call arithmetic expression as its first callee', () => {
      const output = producer.emit(`function text() { return 'word' }\nfunction count() { return 2 }\nexport function result(value = count() + text()) { return value }`)
      expect(output).not.toContain('result(value?: number): number')
    })
  })
}

test('import inference verifies real signatures and excludes generic, overloaded and type-only bindings', () => {
  const source = "import { plain as renamed, generic, overloaded, type onlyType } from './dependency.js'"
  const target = `export function plain(value = 'x') { return value }
export function generic<T>(value: T): T { return value }
export function overloaded(value: string): string;
export function overloaded(value: number): number;
export function overloaded(value: string | number) { return value }
export function onlyType(value: number): number { return value }
`
  expect([...monomorphicImportFunctions(source, new Map([['./dependency.js', target]]))]).toEqual(['renamed'])
  expect([...monomorphicImportFunctions(source, new Map())]).toEqual([])
})

test('incremental inference invalidates imported call eligibility when an unchanged importer gains overloaded dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtsx-imported-call-cache-'))
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/index.ts'), "import { make } from './model.js'; export const answer = make('first');")
    await writeFile(join(root, 'src/model.ts'), 'export function make(value: string): string { return value }')
    const options = { cwd: root, root: 'src', outdir: 'output', entrypoints: ['index.ts'], isolatedDeclarations: false, incremental: true }
    const initial = await generate(options)
    expect(initial.filesFailed).toBe(0)
    expect(await readFile(join(root, 'output/index.d.ts'), 'utf8')).toContain('typeof make')
    const unchanged = await generate(options)
    expect(unchanged.filesGenerated).toBe(0)
    await writeFile(join(root, 'src/model.ts'), 'export function make(value: string): string; export function make(value: number): number; export function make(value: string | number) { return value }')
    const updated = await generate(options)
    expect(updated.filesFailed).toBe(0)
    expect(await readFile(join(root, 'output/index.d.ts'), 'utf8')).toContain('answer: unknown')
    await writeFile(join(root, 'src/model.ts'), 'export function make(value: string): string { return value }')
    await generate(options)
    expect(await readFile(join(root, 'output/index.d.ts'), 'utf8')).toContain('typeof make')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
