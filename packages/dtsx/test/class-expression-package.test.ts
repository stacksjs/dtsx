import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { processSource, ZIG_AVAILABLE } from '../../zig-dtsx/src'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src/generator'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { isAvailable } from './helpers/tsc'
import { assertPackageControls } from './helpers/package-controls'
import { assertIsolatedDeclarationDiagnostic } from './helpers/isolated-oracle'

interface Fixture { files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string }>, referenceErrors?: string[] }
const fixtures: Record<string, Fixture> = {
  'distinct class expression brands retain their declaration identities': {
    files: { 'index.ts': 'export const Counter = class { private brand: undefined; value = 7 }; export const Other = class { private brand: undefined; value = 7 };' },
    positive: 'const a: InstanceType<typeof api.Counter> = new api.Counter(); const b: InstanceType<typeof api.Other> = new api.Other(); const n: number = a.value + b.value; void n;',
    negatives: [{ text: 'const bad: InstanceType<typeof api.Counter> = new api.Other(); void bad;', code: 'TS2322' }, { text: 'const bad: InstanceType<typeof api.Counter> = { value: 7 }; void bad;', code: 'TS2741' }],
    // Ordinary TypeScript cannot name private members of exported anonymous
    // classes. Verify that diagnostic; DTSX's private scopes preserve the API.
    referenceErrors: ['TS4094', 'TS4094'],
  },

  'anonymous class expressions retain members and constructor arguments': {
    files: { 'index.ts': 'export const Counter = class { value = 7; constructor(public amount: number = 7) {} };' },
    positive: 'const model = new api.Counter(8); const value: number = model.value + model.amount; model.value = 9; void value;',
    negatives: [{ text: 'new api.Counter("bad");', code: 'TS2345' }, { text: 'new api.Counter().value = "bad";', code: 'TS2322' }],
  },
  'class factories retain inherited members and constructor arguments': {
    files: { 'index.ts': 'function base() { return class { value = 7; constructor(public amount: number = 7) {} } } export class Counter extends base() {}' },
    positive: 'const model: api.Counter = new api.Counter(8); const value: number = model.value + model.amount; model.value = 9; void value;',
    negatives: [{ text: 'new api.Counter("bad");', code: 'TS2345' }, { text: 'new api.Counter().value = "bad";', code: 'TS2322' }],
  },
  'named generic class expressions keep their own type parameters': {
    files: { 'index.ts': 'export const Counter = class Model<T> { constructor(public value: T) {} };' },
    positive: 'const a = new api.Counter<string>("ready"); const s: string = a.value; const b = new api.Counter<number>(7); const n: number = b.value; void [s,n];',
    negatives: [{ text: 'new api.Counter<number>("bad");', code: 'TS2345' }, { text: 'api.Model;', code: 'TS2339' }],
  },
  'named class self types and static factory signatures remain in scope': {
    files: { 'index.ts': 'export const Counter = class Model { constructor(public value: number) {} static create(value: number): Model { return new Model(value) } };' },
    positive: 'const model: InstanceType<typeof api.Counter> = api.Counter.create(8); const n: number = model.value; void n;',
    negatives: [{ text: 'api.Counter.create("bad");', code: 'TS2345' }, { text: 'api.Model;', code: 'TS2339' }],
  },
  'generated class scopes avoid source names and remain private': {
    files: { 'index.ts': 'const __dtsx_class_0 = 7; export const marker = __dtsx_class_0; export const Counter = class { value = 7 };' },
    positive: 'const marker: 7 = api.marker; const value: number = new api.Counter().value; void [marker,value];',
    negatives: [{ text: 'const bad: string = new api.Counter().value; void bad;', code: 'TS2322' }, { text: 'api.__dtsx_class_1;', code: 'TS2339' }],
  },
}
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)

async function controls(root: string, specifier: string, fixture: Fixture): Promise<void> {
  await assertPackageControls(root, specifier, fixture)
}

for (const producer of ['core', 'bun-plugin', 'native', 'native-project'] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    test(`${producer}: ${name} in a strict normally installed package`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-class-expression-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'class-expression-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        for (const [file, source] of Object.entries(fixture.files)) {
          await mkdir(join(library, 'src', file, '..'), { recursive: true })
          await writeFile(join(library, 'src', file), source)
        }
        await controls(library, './src/index.js', fixture)
        await writeFile(join(library, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, noEmitOnError: true, rootDir: './src', outDir: './reference' }, files: ['src/index.ts'] }))
        const reference = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.emit.json'], { cwd: library, timeout: 4000 })
        const referenceDiagnostics = reference.stdout.toString() + reference.stderr.toString()
        if (fixture.referenceErrors) {
          expect(reference.exitCode, referenceDiagnostics).not.toBe(0)
          expect(referenceDiagnostics.match(/error TS\d+/g) ?? [], referenceDiagnostics).toEqual(fixture.referenceErrors.map(code => `error ${code}`))
          expect(existsSync(join(library, 'reference/index.d.ts'))).toBe(false)
        }
        else {
          expect(reference.exitCode, referenceDiagnostics).toBe(0)
          await controls(library, './reference/index.js', fixture)
        }
        const options = { cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const }
        const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts(options)] : [] })
        expect(built.success, JSON.stringify(built.logs)).toBe(true)
        if (producer === 'core') {
          const result = await generate(options)
          expect(result.filesFailed, JSON.stringify(result.errors)).toBe(0)
        }
        else if (producer === 'native') {
          expect(ZIG_AVAILABLE).toBe(true)
          await writeFile(join(library, 'dist/index.d.ts'), processSource(fixture.files['index.ts'], true))
        }
        else if (producer === 'native-project') {
          expect(existsSync(cli), `Build the real native CLI: ${cli}`).toBe(true)
          const result = await generateNativeDeclarationProject(cli, options, { timeoutMs: 4000 })
          expect(result.filesGenerated).toBe(Object.keys(fixture.files).length)
        }
        const archive = join(root, 'library.tgz')
        const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 })
        expect(packed.exitCode, packed.stderr.toString()).toBe(0)
        await mkdir(consumer)
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'class-expression-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/class-expression-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'class-expression-contract', fixture)

        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}

for (const [code, source] of [
  ['TS9021', 'function base() { return class { value = 7 } } export class Counter extends base() {}'],
  ['TS9022', 'export const Counter = class { value = 7 };'],
]) {
  test(`${code} is a real isolated-declaration diagnostic on strict-valid class source`, () => assertIsolatedDeclarationDiagnostic(code, source))
}
