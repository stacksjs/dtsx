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

interface Fixture { files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string }> }
const fixtures: Record<string, Fixture> = {
  'readonly tuple spreads preserve literal positions': {
    files: { 'index.ts': 'const base = [1, 2] as const; export const list = [...base] as const; export const mixed = [0, ...base, 3] as const;' },
    positive: 'const a: 1 = api.list[0]; const b: 2 = api.list[1]; const length: 2 = api.list.length; const m: readonly [0, 1, 2, 3] = api.mixed; void [a,b,length,m];',
    negatives: [{ text: 'const bad: 2 = api.list[0]; void bad;', code: 'TS2322' }, { text: 'api.list[0] = 1;', code: 'TS2540' }],
  },
  'multiple readonly tuple spreads retain their order': {
    files: { 'index.ts': 'const a = [1, "ready"] as const; const b = [true, 4] as const; export const list = [...a, ...b] as const;' },
    positive: 'const value: readonly [1, "ready", true, 4] = api.list; const length: 4 = api.list.length; void [value,length];',
    negatives: [{ text: 'const bad: string = api.list[0]; void bad;', code: 'TS2322' }],
  },

  'numeric shorthand and aliases widen in mutable properties': {
    files: { 'index.ts': 'const value = 7; const alias = value; export const direct = alias; export const object = { value, renamed: alias, nested: { value } }; export const frozen = { value } as const;' },
    positive: 'api.object.value = 8; api.object.renamed = 9; api.object.nested.value = 10; const literal: 7 = api.direct; const frozen: 7 = api.frozen.value; void [literal,frozen];',
    negatives: [{ text: 'api.object.value = "bad";', code: 'TS2322' }, { text: 'api.frozen.value = 8;', code: 'TS2540' }, { text: 'const bad: 8 = api.direct; void bad;', code: 'TS2322' }],
  },
  'string shorthand widens in mutable properties': {
    files: { 'index.ts': 'const value = "ready"; const alias = value; export const direct = alias; export const object = { value, renamed: alias }; export const frozen = { value } as const;' },
    positive: 'api.object.value = "again"; api.object.renamed = "other"; const literal: "ready" = api.direct; const frozen: "ready" = api.frozen.value; void [literal,frozen];',
    negatives: [{ text: 'api.object.value = 7;', code: 'TS2322' }, { text: 'api.frozen.value = "again";', code: 'TS2540' }],
  },
  'boolean shorthand widens in mutable properties': {
    files: { 'index.ts': 'const value = true; const alias = value; export const object = { value, renamed: alias };' },
    positive: 'api.object.value = false; api.object.renamed = false;',
    negatives: [{ text: 'api.object.value = "bad";', code: 'TS2322' }],
  },
  'annotated and asserted literals remain non-widening': {
    files: { 'index.ts': 'const annotated: 7 = 7; const asserted = "ready" as const; const alias = annotated; export const object = { annotated, asserted, alias };' },
    positive: 'const a: 7 = api.object.annotated; const b: "ready" = api.object.asserted; const c: 7 = api.object.alias; api.object.annotated = 7; api.object.asserted = "ready"; void [a,b,c];',
    negatives: [{ text: 'api.object.annotated = 8;', code: 'TS2322' }, { text: 'api.object.asserted = "again";', code: 'TS2322' }, { text: 'api.object.alias = 8;', code: 'TS2322' }],
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
      const root = await mkdtemp(join(tmpdir(), 'dtsx-literal-binding-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'literal-binding-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
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
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'literal-binding-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/literal-binding-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'literal-binding-contract', fixture)

        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}

for (const [code, source] of [
  ['TS9016', 'const value = 7; export const object = { value };'],
  ['TS9018', 'const base = [1, 2] as const; export const list = [...base] as const;'],
]) {
  test(`${code} is a real isolated-declaration diagnostic on strict-valid source`, () => assertIsolatedDeclarationDiagnostic(code, source))
}
