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

interface Fixture { files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string }>, reference?: { positive: string, negatives: Array<{ text: string, code: string }> } }
const fixtures: Record<string, Fixture> = {
  'private value and return dependencies retain their public property types': {
    files: { 'index.ts': 'type Version = { label: string }; function makeVersion(): Version { return { label: "ready" } } const version = "ready"; export function read(): number { return 7 } read.version = version; read.metadata = makeVersion();' },
    positive: 'const n: number = api.read(); const v: string = api.read.version; const m: string = api.read.metadata.label; api.read.version = "again"; void [n,v,m];',
    negatives: [{ text: 'api.read.metadata.label = 7;', code: 'TS2322' }, { text: 'api.makeVersion;', code: 'TS2339' }, { text: 'api.version;', code: 'TS2339' }],
    // TS7 ordinary emit incorrectly narrows this property to typeof version.
    // Authored mutation remains the contract for DTSX's installed output.
    reference: {
      positive: 'const n: number = api.read(); const v: string = api.read.version; const m: string = api.read.metadata.label; api.read.version = "ready"; void [n,v,m];',
      negatives: [{ text: 'api.read.metadata.label = 7;', code: 'TS2322' }, { text: 'api.makeVersion;', code: 'TS2339' }, { text: 'api.version;', code: 'TS2339' }, { text: 'api.read.version = "again";', code: 'TS2322' }],
    },
  },

  'assigned properties preserve callable and mutable member types': {
    files: { 'index.ts': 'export function read(): number { return 7 } read.version = "ready"; read.count = 7; read.reset = (value: number): number => value; function unused(): void { function read(): number { return 7 } read.version = 7; }' },
    positive: 'const result: number = api.read(); const version: string = api.read.version; api.read.version = "again"; api.read.count = 9; const reset: number = api.read.reset(8); void [result,version,reset];',
    negatives: [{ text: 'api.read.version = 7;', code: 'TS2322' }, { text: 'api.read.reset("bad");', code: 'TS2345' }],
  },
  'private overloaded functions retain properties through a named export': {
    files: { 'index.ts': 'function read(value: number): number; function read(value: string): string; function read(value: number | string): number | string { return value } read.version = "ready"; export { read as reader };' },
    positive: 'const n: number = api.reader(7); const s: string = api.reader("ready"); const v: string = api.reader.version; api.reader.version = "again"; void [n,s,v];',
    negatives: [{ text: 'api.reader.version = 7;', code: 'TS2322' }, { text: 'api.read;', code: 'TS2339' }],
  },
  'local functions retain properties through a default export': {
    files: { 'index.ts': 'function read(): number { return 7 } read.version = "ready"; export default read;' },
    positive: 'const n: number = api.default(); const s: string = api.default.version; api.default.version = "again"; void [n,s];',
    negatives: [{ text: 'api.default.version = 7;', code: 'TS2322' }, { text: 'api.read;', code: 'TS2339' }],
  },
  'named default declarations retain their assigned properties': {
    files: { 'index.ts': 'export default function read(): number { return 7 } read.version = "ready";' },
    positive: 'const n: number = api.default(); const s: string = api.default.version; api.default.version = "again"; void [n,s];',
    negatives: [{ text: 'api.default.version = 7;', code: 'TS2322' }, { text: 'api.read;', code: 'TS2339' }],
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
      const root = await mkdtemp(join(tmpdir(), 'dtsx-function-properties-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'function-properties-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        for (const [file, source] of Object.entries(fixture.files)) {
          await mkdir(join(library, 'src', file, '..'), { recursive: true })
          await writeFile(join(library, 'src', file), source)
        }
        await controls(library, './src/index.js', fixture)
        await writeFile(join(library, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, noEmitOnError: true, rootDir: './src', outDir: './reference' }, files: ['src/index.ts'] }))
        const reference = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.emit.json'], { cwd: library, timeout: 4000 })
        expect(reference.exitCode, reference.stdout.toString() + reference.stderr.toString()).toBe(0)
        await controls(library, './reference/index.js', fixture.reference ? { ...fixture, ...fixture.reference } : fixture)
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
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'function-properties-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/function-properties-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'function-properties-contract', fixture)

        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}

test('TS9023 is a real isolated-declaration diagnostic on strict-valid function properties', () => assertIsolatedDeclarationDiagnostic('TS9023', 'export function read(): number { return 7 } read.version = "ready";'))
