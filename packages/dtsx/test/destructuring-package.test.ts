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
import { assertPackageControls } from './helpers/package-controls'

interface Fixture { files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string }>, helperPrivacyCode?: string, inspect?: (output: string) => void }
const fixtures: Record<string, Fixture> = {
  'object aliases and private source identity': {
    files: { 'index.ts': "const source = { count: 7, label: 'ready' }; export const { count, label: title } = source;" },
    positive: "const n: number = api.count; const s: string = api.title; void [n, s];",
    negatives: [{ text: 'const bad: string = api.count; void bad;', code: 'TS2322' }],
  },
  'tuple holes and mutable rest': {
    files: { 'index.ts': "export const [first, , last, ...tail] = [1, 'skip', true, 4, 5] as const;" },
    positive: 'const a: 1 = api.first; const b: true = api.last; const c: 4 = api.tail[0]; api.tail.push(4); void [a,b,c];',
    negatives: [{ text: 'const bad: string = api.first; void bad;', code: 'TS2322' }, { text: 'api.tail.push(6);', code: 'TS2345' }],
  },
  'nested defaults and object rest': {
    files: { 'index.ts': "const source: { nested?: { value: number }; optional?: number; label: string; keep: boolean } = { label: 'ready', keep: true }; export const { nested: { value } = { value: 7 }, optional = 9, label: title, ...rest } = source;" },
    positive: 'const n: number = api.value + api.optional; const s: string = api.title; const b: boolean = api.rest.keep; api.rest.keep = false; void [n,s,b];',
    negatives: [{ text: 'const bad: string = api.value; void bad;', code: 'TS2322' }, { text: 'api.rest.label;', code: 'TS2339' }],
  },
  'computed quoted and symbol keys': {
    files: { 'index.ts': "export const token: unique symbol = Symbol('token'); const source = { 'quoted-name': 7, [token]: 'secret', keep: true }; export const { ['quoted-name']: count, [token]: secret, ...rest } = source;" },
    positive: 'const n: number = api.count; const s: string = api.secret; const b: boolean = api.rest.keep; void [n,s,b];',
    negatives: [{ text: 'const bad: string = api.count; void bad;', code: 'TS2322' }, { text: "api.rest['quoted-name'];", code: 'TS7053' }, { text: 'api.rest[api.token];', code: 'TS7053' }],
  },
  'multiple declarators and mutable bindings': {
    files: { 'index.ts': "export let before = 1, { value, ...rest } = { value: 2, other: 'ready' }, after = 'done'; export function reset(): void { value = 3; before = 2; after = 'again'; }" },
    positive: 'const n: number = api.before + api.value; const s: string = api.after + api.rest.other; api.reset(); void [n,s];',
    negatives: [{ text: 'const bad: string = api.value; void bad;', code: 'TS2322' }],
  },
  'class instance rest excludes prototype members': {
    files: { 'index.ts': "export class Model { private brand: undefined; value: number = 7; field: () => boolean = () => true; method(): string { return 'ready' } } export const { ...rest } = new Model();" },
    positive: 'const n: number = api.rest.value; const b: boolean = api.rest.field(); api.rest.value = 8; void [n,b];',
    negatives: [{ text: 'api.rest.method();', code: 'TS2339' }, { text: "const bad: api.Model = { ...api.rest, method: () => 'ready' }; void bad;", code: 'TS2741' }],
  },
  'private function defaults and iterable values': {
    files: { 'index.ts': "function fallback(): number { return 9 } const source: { value?: number } = {}; export const { value = fallback() } = source; export const [head, ...tail] = new Set<number>([1, 2]);" },
    positive: 'const n: number = api.value + api.head; const t: number[] = api.tail; api.tail.push(3); void [n,t];',
    negatives: [{ text: 'const bad: string = api.value; void bad;', code: 'TS2322' }, { text: "api.tail.push('bad');", code: 'TS2345' }],
  },
  'defaults reference preceding binding values': {
    files: { 'index.ts': 'export const { first = 7, second = first, third = second }: { first?: number; second?: number; third?: number } = {};' },
    positive: 'const n: number = api.first + api.second + api.third; void n;',
    negatives: [{ text: 'const bad: string = api.third; void bad;', code: 'TS2322' }],
  },
  'private imported constructor anchors': {
    files: { 'index.ts': "import { Model } from './model.js'; export const { value, ...rest } = new Model();", 'model.ts': "export class Model { private brand: undefined; value: number = 7; label: string = 'ready'; method(): number { return 7 } }" },
    positive: 'const n: number = api.value; const s: string = api.rest.label; void [n,s];',
    negatives: [{ text: 'const bad: string = api.value; void bad;', code: 'TS2322' }, { text: 'api.rest.method();', code: 'TS2339' }],
  },
  'var bindings retain mutable declarations': {
    files: { 'index.ts': 'export var { count, ...rest } = { count: 7, label: "ready" }; export function reset(): void { count = 9; rest.label = "again"; }' },
    positive: 'const n: number = api.count; const s: string = api.rest.label; api.reset(); void [n,s];',
    negatives: [{ text: 'const bad: string = api.count; void bad;', code: 'TS2322' }],
  },
  'local patterns retain named and default exports': {
    helperPrivacyCode: 'TS2614',
    files: { 'index.ts': 'const { count, label: title } = { count: 7, label: "ready" }; export { count }; export default title;' },
    positive: 'const n: number = api.count; const s: string = api.default; void [n,s];',
    negatives: [{ text: 'const bad: string = api.count; void bad;', code: 'TS2322' }, { text: 'const bad: number = api.default; void bad;', code: 'TS2322' }, { text: 'api.title;', code: 'TS2339' }],
  },
  'private unique symbol keys remain private': {
    files: { 'index.ts': 'const key: unique symbol = Symbol("key"); const source = { [key]: "secret", keep: true }; const { [key]: secret, ...rest } = source; export { secret, rest };' },
    positive: 'const s: string = api.secret; const b: boolean = api.rest.keep; void [s,b];',
    negatives: [{ text: 'const bad: number = api.secret; void bad;', code: 'TS2322' }, { text: 'api.key;', code: 'TS2339' }],
  },
  'member names do not retain unused private binding patterns': {
    files: { 'index.ts': 'const { type, member } = { type: "unused", member: 7 }; export interface Public { type: string; member: number }' },
    positive: 'const value: api.Public = { type: "ready", member: 7 }; void value;',
    negatives: [{ text: 'const value: api.Public = { type: "ready", member: "bad" }; void value;', code: 'TS2322' }, { text: 'api.type;', code: 'TS2339' }],
    inspect(output) {
      expect(output).not.toContain('__dtsx_binding_')
      expect(output).not.toMatch(/declare const (?:type|member)\b/)
    },
  },
  'generated names avoid implementation bindings': {
    files: { 'index.ts': "const __dtsx_binding_0 = 'keep'; export const marker = __dtsx_binding_0; export const { count } = { count: 7 };" },
    positive: "const n: number = api.count; const s: 'keep' = api.marker; void [n,s];",
    negatives: [{ text: 'const bad: string = api.count; void bad;', code: 'TS2322' }],
  },
}
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)

async function controls(root: string, specifier: string, fixture: Fixture): Promise<void> {
  await assertPackageControls(root, specifier, fixture)
}

for (const producer of ['core', 'bun-plugin', 'native-ffi', 'native-project'] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    test(`${producer} preserves ${name} destructuring in a strict normally installed package`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-destructuring-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'destructuring-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        for (const [file, source] of Object.entries(fixture.files)) {
          await mkdir(join(library, 'src', file, '..'), { recursive: true })
          await writeFile(join(library, 'src', file), source)
        }
        await controls(library, './src/index.js', fixture)
        const options = { cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const }
        const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts(options)] : [] })
        expect(built.success, JSON.stringify(built.logs)).toBe(true)
        if (producer === 'core') {
          const result = await generate(options)
          expect(result.filesFailed, JSON.stringify(result.errors)).toBe(0)
        }
        else if (producer === 'native-ffi') {
          expect(ZIG_AVAILABLE).toBe(true)
          for (const [file, source] of Object.entries(fixture.files)) await writeFile(join(library, 'dist', file.replace(/\.ts$/, '.d.ts')), processSource(source, true))
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
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'destructuring-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/destructuring-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          fixture.inspect?.(output)
          await controls(consumer, 'destructuring-contract', fixture)
          const helper = output.match(/declare (?:const|function|type) (__dtsx_binding_\d+)/)?.[1]
          if (helper) {
            await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
            await writeFile(join(consumer, 'control.ts'), `import { ${helper} } from 'destructuring-contract'; void ${helper}`)
            const hidden = runTsc(consumer, ['--project', 'tsconfig.json'])
            expect(hidden.ok, hidden.output).toBe(false)
            expect(hidden.output.match(/error TS\d+/g) ?? [], hidden.output).toEqual([`error ${fixture.helperPrivacyCode ?? 'TS2459'}`])
          }
        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}

test('strict-valid exported binding elements have the real TS9019 isolated declaration diagnostic', async () => {
  expect(isAvailable).toBe(true)
  const root = await mkdtemp(join(tmpdir(), 'dtsx-binding-oracle-'))
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
    const fixture = fixtures['object aliases and private source identity']
    await writeFile(join(root, 'src/index.ts'), fixture.files['index.ts'])
    await controls(root, './src/index.js', fixture)
    await writeFile(join(root, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, isolatedDeclarations: true, noEmitOnError: true, rootDir: './src', outDir: './reference' }, files: ['src/index.ts'] }))
    const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.emit.json'], { cwd: root, timeout: 4000 })
    const diagnostics = result.stdout.toString() + result.stderr.toString()
    expect(result.exitCode, diagnostics).toBe(1)
    expect(diagnostics.match(/error TS\d+/g) ?? [], diagnostics).toEqual(['error TS9019', 'error TS9019'])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
