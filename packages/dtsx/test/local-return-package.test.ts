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

interface Fixture { referenceDiagnostic?: string, files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string }> }
const fixtures: Record<string, Fixture> = {
  'captured defaults precede required local type parameters safely': {
    files: { 'index.ts': 'export function read<T = string>(value: T) { type Box<U> = { value: T; extra: U }; return { value, extra: 7 } as Box<number>; }' },
    positive: 'const n: number = api.read(7).value + api.read("ready").extra; void n;',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },
  'local type parameters shadow captured names without renaming property keys': {
    files: { 'index.ts': 'export function read<T>(value: T) { type Box<T> = { T: T; value: T }; return { T: "ready", value: "ready" } as Box<string>; }' },
    positive: 'const s: string = api.read(7).T + api.read(7).value; void s;',
    negatives: [{ text: 'const bad: number = api.read(7).T; void bad;', code: 'TS2322' }],
  },
  'const type parameters preserve literal captures and original property names': {
    files: { 'index.ts': 'export function read<const T extends string>(value: T) { type Private = { T: T }; return { T: value } as Private; }' },
    positive: 'const s: "ready" = api.read("ready").T; void s;',
    negatives: [{ text: 'const bad: "other" = api.read("ready").T; void bad;', code: 'TS2322' }],
  },

  'recursive aliases capture outer type parameters': {
    referenceDiagnostic: 'TS4060',
    files: { 'index.ts': 'export function read<T>(value: T) { type Node = { value: T; next?: Node }; return { value } as Node; }' },
    positive: 'const n: number | undefined = api.read(7).next?.value; void n;',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },
  'generic local aliases capture outer parameters independently': {
    files: { 'index.ts': 'export function read<T>(value: T) { type Box<U> = { value: T; extra: U }; return { value, extra: 7 } as Box<number>; }' },
    positive: 'const n: number = api.read(7).value + api.read("ready").extra; const s: string = api.read("ready").value; void [n,s];',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },
  'block aliases capture outer type parameters': {
    files: { 'index.ts': 'export function read<T>(value: T) { { type Private = { value: T }; return { value } as Private; } }' },
    positive: 'const n: number = api.read(7).value; void n;',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },
  'conditional branches retain both asserted local return types': {
    files: { 'index.ts': 'export function read(flag: boolean) { type NumberValue = { value: number }; type StringValue = { value: string }; return flag ? ({ value: 7 } as NumberValue) : ({ value: "ready" } as StringValue); }' },
    positive: 'const v: number | string = api.read(true).value; void v;',
    negatives: [{ text: 'const bad: boolean = api.read(false).value; void bad;', code: 'TS2322' }],
  },

  'control-flow blocks retain separate alias identities': {
    files: { 'index.ts': 'export function read(flag: boolean) { if (flag) { type Private = { value: number }; return { value: 7 } as Private; } else { type Private = { value: string }; return { value: "ready" } as Private; } }' },
    positive: 'const v: number | string = api.read(true).value; void v;',
    negatives: [{ text: 'const bad: boolean = api.read(false).value; void bad;', code: 'TS2322' }],
  },
  'captured aliases retain generic constraints and defaults': {
    files: { 'index.ts': 'export function read<T extends { value: number } = { value: number }>(value: T) { type Private = { item: T }; return { item: value } as Private; }' },
    positive: 'const n: number = api.read({ value: 7 }).item.value; const s: string = api.read({ value: 7, extra: "ready" }).item.extra; void [n,s];',
    negatives: [{ text: 'const bad: string = api.read({ value: 7 }).item.value; void bad;', code: 'TS2322' }],
  },
  'captured aliases can reference later local declarations': {
    files: { 'index.ts': 'export function read<T>(value: T) { type Private = Later; type Later = { value: T }; return { value } as Private; }' },
    positive: 'const n: number = api.read(7).value; void n;',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },
  'captured local interfaces retain their generic context': {
    referenceDiagnostic: 'TS4060',
    files: { 'index.ts': 'export function read<T>(value: T) { interface Private { value: T } return { value } as Private; }' },
    positive: 'const n: number = api.read(7).value; void n;',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },

  'local aliases capture enclosing function type parameters': {
    files: { 'index.ts': 'export function read<T>(value: T) { type Private = { value: T }; return { value } as Private; }' },
    positive: 'const n: number = api.read(7).value; const s: string = api.read("ready").value; void [n,s];',
    negatives: [{ text: 'const bad: string = api.read(7).value; void bad;', code: 'TS2322' }],
  },
  'block-local aliases shadow enclosing aliases': {
    files: { 'index.ts': 'type Private = { outer: boolean }; export function read() { type Private = { outer: number }; { type Private = { value: number }; return { value: 7 } as Private; } }' },
    positive: 'const n: number = api.read().value; void n;',
    negatives: [{ text: 'const bad: string = api.read().value; void bad;', code: 'TS2322' }],
  },

  'local names stay distinct across functions and module types': {
    files: { 'index.ts': 'type Private = { outer: boolean }; export function read() { type Private = { value: number }; return { value: 7 } as Private; } export function label() { type Private = { label: string }; return { label: "ready" } as Private; }' },
    positive: 'const value: number = api.read().value; const label: string = api.label().label; void [value,label];',
    negatives: [{ text: 'api.read().label;', code: 'TS2339' }, { text: 'api.label().value;', code: 'TS2339' }, { text: 'api.Private;', code: 'TS2339' }],
  },
  'forward local aliases preserve their dependency chain': {
    files: { 'index.ts': 'export function read() { type Private = Later; type Later = { value: number }; return { value: 7 } as Private; }' },
    positive: 'const value: number = api.read().value; void value;',
    negatives: [{ text: 'const bad: string = api.read().value; void bad;', code: 'TS2322' }],
  },
  'asserted primitive unions keep intentionally wider return types': {
    files: { 'index.ts': 'export function read() { type Private = number | string; return 7 as Private; }' },
    positive: 'const value: ReturnType<typeof api.read> = "ready"; const result: number | string = api.read(); void [value,result];',
    negatives: [{ text: 'const bad: boolean = api.read(); void bad;', code: 'TS2322' }],
  },

  'local asserted aliases preserve their public shape': {
    files: { 'index.ts': 'export function read() { type Private = { value: number }; return { value: 7 } as Private; }' },
    positive: 'const value: number = api.read().value; api.read().value = 8; void value;',
    negatives: [{ text: 'const bad: string = api.read().value; void bad;', code: 'TS2322' }, { text: 'api.Private;', code: 'TS2339' }],
  },
  'asserted aliases preserve intentional widening': {
    files: { 'index.ts': 'export function read() { type Private = { value: number | string }; return { value: 7 } as Private; }' },
    positive: 'const value: number | string = api.read().value; api.read().value = "again"; void value;',
    negatives: [{ text: 'const bad: boolean = api.read().value; void bad;', code: 'TS2322' }],
  },
  'local alias dependencies retain module-private types': {
    files: { 'index.ts': 'interface Outer { value: number } export function read() { type Private = Outer & { label: string }; return { value: 7, label: "ready" } as Private; }' },
    positive: 'const value: number = api.read().value; const label: string = api.read().label; void [value,label];',
    negatives: [{ text: 'const bad: string = api.read().value; void bad;', code: 'TS2322' }, { text: 'api.Outer;', code: 'TS2339' }],
  },
  'local generic aliases retain their own binding scope': {
    files: { 'index.ts': 'export function read() { type Box<T> = { Box: T; value: T }; return { Box: 7, value: 7 } as Box<number>; }' },
    positive: 'const value: number = api.read().value + api.read().Box; void value;',
    negatives: [{ text: 'const bad: string = api.read().Box; void bad;', code: 'TS2322' }, { text: 'api.Box;', code: 'TS2339' }],
  },
  'local value queries retain their actual dependencies': {
    files: { 'index.ts': 'export function read() { const local = { value: 7 }; type Private = typeof local; return local as Private; }' },
    positive: 'const value: number = api.read().value; api.read().value = 8; void value;',
    negatives: [{ text: 'const bad: string = api.read().value; void bad;', code: 'TS2322' }, { text: 'api.local;', code: 'TS2339' }],
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
      const root = await mkdtemp(join(tmpdir(), 'dtsx-local-return-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'local-return-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        for (const [file, source] of Object.entries(fixture.files)) {
          await mkdir(join(library, 'src', file, '..'), { recursive: true })
          await writeFile(join(library, 'src', file), source)
        }
        await controls(library, './src/index.js', fixture)
        await writeFile(join(library, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, noEmitOnError: true, rootDir: './src', outDir: './reference' }, files: ['src/index.ts'] }))
        const reference = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.emit.json'], { cwd: library, timeout: 4000 })
        const referenceDiagnostics = reference.stdout.toString() + reference.stderr.toString()
        if (fixture.referenceDiagnostic) {
          expect(reference.exitCode, referenceDiagnostics).not.toBe(0)
          expect(referenceDiagnostics.match(/error TS\d+/g)).toEqual([`error ${fixture.referenceDiagnostic}`])
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
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'local-return-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/local-return-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'local-return-contract', fixture)

        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}

test('TS9039 is a real isolated-declaration diagnostic on strict-valid local alias source', () => assertIsolatedDeclarationDiagnostic('TS9039', 'export function read() { type Private = { value: number }; return { value: 7 } as Private; }'))
