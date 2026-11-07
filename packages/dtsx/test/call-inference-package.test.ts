import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { processSource, ZIG_AVAILABLE } from '../../zig-dtsx/src'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src/generator'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { isAvailable, runTsc } from './helpers/tsc'
import { assertIsolatedDeclarationDiagnostic } from './helpers/isolated-oracle'

interface Fixture { files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string }> }
const fixtures: Record<string, Fixture> = {
  'a preceding parameter binding governs the default call type': {
    files: { 'index.ts': 'export function read(Math: { abs(value: number): string }, value = Math.abs(-1)): string { return value }' },
    positive: 'const value: string = api.read({ abs: () => "ready" }, "again"); void value;',
    negatives: [{ text: 'api.read({ abs: () => "ready" }, 7);', code: 'TS2345' }],
  },

  'numeric member calls retain their types at every public inference site': {
    files: { 'index.ts': 'export const value = Math.abs(-1); export function read(value = Math.abs(-1)): number { return value } export class Counter { value = Math.abs(-1); static readonly fixed = Math.abs(-1); constructor(public amount = Math.abs(-1)) {} } export default Math.abs(-1);' },
    positive: 'const a: number = api.value; const b: number = api.default; const c: number = api.read(8); const model = new api.Counter(9); model.value = 10; const n: number = model.amount + api.Counter.fixed; void [a,b,c,n];',
    negatives: [{ text: 'const bad: string = api.value; void bad;', code: 'TS2322' }, { text: 'const bad: string = api.default; void bad;', code: 'TS2322' }, { text: 'api.read("bad");', code: 'TS2345' }, { text: 'new api.Counter().value = "bad";', code: 'TS2322' }, { text: 'new api.Counter("bad");', code: 'TS2345' }],
  },
  'a shadowed Math binding keeps its own callable identity': {
    files: { 'index.ts': 'const Math = { abs(_value: number): string { return "ready" } }; export const value = Math.abs(-1); export function read(value = Math.abs(-1)): string { return value } export class Counter { value = Math.abs(-1); static readonly fixed = Math.abs(-1); constructor(public amount = Math.abs(-1)) {} } export default Math.abs(-1);' },
    positive: 'const a: string = api.value; const b: string = api.default; const c: string = api.read("again"); const model = new api.Counter("ready"); model.value = "again"; const n: string = model.amount + api.Counter.fixed; void [a,b,c,n];',
    negatives: [{ text: 'const bad: number = api.value; void bad;', code: 'TS2322' }, { text: 'api.read(7);', code: 'TS2345' }, { text: 'new api.Counter().value = 7;', code: 'TS2322' }, { text: 'new api.Counter(7);', code: 'TS2345' }],
  },
}
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)

async function controls(root: string, specifier: string, fixture: Fixture): Promise<void> {
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
  await writeFile(join(root, 'control.ts'), `import * as api from '${specifier}'; ${fixture.positive}`)
  const positive = runTsc(root, ['--project', 'tsconfig.json'])
  expect(positive.ok, positive.output).toBe(true)
  expect(positive.output.match(/error TS\d+/g) ?? [], positive.output).toEqual([])
  // Compile independent negative blocks together. Every block must produce
  // exactly its authored diagnostic on its own line, within the same 5s bound.
  await writeFile(join(root, 'control.ts'), `import * as api from '${specifier}';\n${fixture.negatives.map(negative => `{ ${negative.text} }`).join('\n')}`)
  const result = runTsc(root, ['--project', 'tsconfig.json'])
  expect(result.ok, result.output).toBe(false)
  expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(fixture.negatives.map(negative => `error ${negative.code}`))
  const lines = [...result.output.matchAll(/control\.ts\((\d+),\d+\): error TS\d+/g)].map(match => Number(match[1]))
  expect(lines, result.output).toEqual(fixture.negatives.map((_, index) => index + 2))
}

for (const producer of ['core', 'bun-plugin', 'native', 'native-project'] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    test(`${producer}: ${name} in a strict normally installed package`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-call-inference-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'call-inference-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        for (const [file, source] of Object.entries(fixture.files)) {
          await mkdir(join(library, 'src', file, '..'), { recursive: true })
          await writeFile(join(library, 'src', file), source)
        }
        await controls(library, './src/index.js', fixture)
        await writeFile(join(library, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, noEmitOnError: true, rootDir: './src', outDir: './reference' }, files: ['src/index.ts'] }))
        const reference = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.emit.json'], { cwd: library, timeout: 4000 })
        expect(reference.exitCode, reference.stdout.toString() + reference.stderr.toString()).toBe(0)
        await controls(library, './reference/index.js', fixture)
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
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'call-inference-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/call-inference-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'call-inference-contract', fixture)

        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}

for (const [code, source] of [
  ['TS9010', 'export const value = Math.abs(-1);'],
  ['TS9011', 'export function read(value = Math.abs(-1)): number { return value }'],
  ['TS9012', 'export class Counter { value = Math.abs(-1) }'],
  ['TS9037', 'export default Math.abs(-1);'],
]) {
  test(`${code} is a real isolated-declaration diagnostic on strict-valid source`, () => assertIsolatedDeclarationDiagnostic(code, source))
}
