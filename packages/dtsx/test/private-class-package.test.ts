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

interface Fixture { files: Record<string, string>, positive: string, negatives: Array<{ text: string, code: string, authoredCode?: string }>, reference?: { positive: string, negatives: Array<{ text: string, code: string }> } }
const fixtures: Record<string, Fixture> = {
  'private fields and same-line public members': {
    files: { 'index.ts': "export class Model { private brand: undefined; value: number = 7; field: () => boolean = () => true; method(): string { return 'ready' } }" },
    positive: "const model: api.Model = new api.Model(); const n: number = model.value; const s: string = model.method(); const b: boolean = model.field(); void [n,s,b];",
    negatives: [{ text: "const bad: api.Model = { value: 7, field: () => true, method: () => 'ready' }; void bad;", code: 'TS2741' }, { text: 'new api.Model().brand;', code: 'TS2341' }],
  },
  'private overloaded methods': {
    files: { 'index.ts': "export class Model { private hidden(value: number): number; private hidden(value: string): string; private hidden(value: number | string): number | string { return value } value: number = 7; }" },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741' }],
  },
  'private accessor pairs': {
    files: { 'index.ts': 'export class Model { private get hidden(): number { return 7 } private set hidden(value: number) { void value } value: number = 7; }' },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741' }],
  },
  'hash fields methods and accessors': {
    files: { 'index.ts': "export class Model { #field: number = 7; #method(): number { return this.#field } get #hidden(): number { return this.#method() } set #hidden(value: number) { this.#field = value } value: number = 7; }" },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741', authoredCode: 'TS2739' }],
  },
  'quoted accessor pairs share one private brand': {
    files: { 'index.ts': `export class Model { private get 'hidden'(): number { return 7 } private set "hidden"(value: number) { void value } value: number = 7; }` },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741' }],
  },
  'different private names retain separate members': {
    files: { 'index.ts': 'export class Model { private abcd: undefined; private xbcy: undefined; value: number = 7; }' },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2739' }],
  },
  'private declarations retain their distinct origins': {
    files: { 'index.ts': 'export class Model { private brand: undefined; value: number = 7; } export class Other { private brand: undefined; value: number = 7; }' },
    positive: 'const a: api.Model = new api.Model(); const b: api.Other = new api.Other(); void [a,b];',
    negatives: [{ text: 'const bad: api.Model = new api.Other(); void bad;', code: 'TS2322' }],
  },
  'static and instance private names stay distinct': {
    files: { 'index.ts': 'export class Model { private brand: undefined; private static brand: undefined; value: number = 7; } export class Other { value: number = 7; }' },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741' }, { text: 'const bad: typeof api.Model = api.Other; void bad;', code: 'TS2741' }],
  },
  'static private identity': {
    files: { 'index.ts': 'export class Model { private static brand: undefined; value: number = 7; } export class Other { value: number = 7; }' },
    positive: 'const structural: api.Model = { value: 7 }; const n: number = new api.Model().value; void [structural,n];',
    negatives: [{ text: 'const bad: typeof api.Model = api.Other; void bad;', code: 'TS2741' }, { text: 'api.Model.brand;', code: 'TS2341' }],
  },
  'private constructor parameter properties': {
    files: { 'index.ts': 'export class Model { constructor(private readonly hidden: number = 7, public value: string = "ready") {} }' },
    positive: 'const model = new api.Model(); const s: string = model.value; void s;',
    negatives: [{ text: 'const bad: api.Model = { value: "ready" }; void bad;', code: 'TS2741' }, { text: 'new api.Model().hidden;', code: 'TS2341' }],
  },
  'private constructor accessibility': {
    files: { 'index.ts': 'export class Model { private constructor(value: number) { void value } static create(): Model { return new Model(7) } value: number = 7; }' },
    positive: 'const model: api.Model = api.Model.create(); const n: number = model.value; void n;',
    negatives: [{ text: 'new api.Model(7);', code: 'TS2673' }],
  },
  'protected constructor accessibility': {
    files: { 'index.ts': 'export class Model { protected constructor(public value: number) {} static create(): Model { return new Model(7) } }' },
    positive: 'class Derived extends api.Model { constructor() { super(8) } } const n: number = new Derived().value + api.Model.create().value; void n;',
    negatives: [{ text: 'new api.Model(7);', code: 'TS2674' }],
  },
  'static and instance hash brands coexist': {
    files: { 'index.ts': 'export class Model { #instance: undefined; static #hidden: undefined; value: number = 7; } export class Other { value: number = 7; }' },
    positive: 'const n: number = new api.Model().value; void n;',
    negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741' }, { text: 'const bad: typeof api.Model = api.Other; void bad;', code: 'TS2322' }],
    reference: { positive: 'const n: number = new api.Model().value; void n;', negatives: [{ text: 'const bad: api.Model = { value: 7 }; void bad;', code: 'TS2741' }] },
  },
  'hash-only static privacy preserves authored compatibility': {
    files: { 'index.ts': 'export class Model { static #hidden: number = 7; value: number = 7; static read(): number { return this.#hidden } } export class Other { value: number = 7; static read(): number { return 7 } }' },
    positive: 'const structural: api.Model = { value: 7 }; const matching: typeof api.Model = api.Other; const n: number = new api.Model().value + api.Model.read(); void [structural,matching,n];',
    negatives: [{ text: 'const bad: string = new api.Model().value; void bad;', code: 'TS2322' }],
    // TS7 ordinary emit moves a static hash brand onto instances. Keep that
    // oracle discrepancy explicit; authored compatibility governs our output.
    reference: { positive: 'const n: number = new api.Model().value + api.Model.read(); void n;', negatives: [{ text: 'const structural: api.Model = { value: 7 }; void structural;', code: 'TS2741' }] },
  },
}
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)

async function controls(root: string, specifier: string, fixture: Fixture, authored = false): Promise<void> {
  await assertPackageControls(root, specifier, { ...fixture, negatives: fixture.negatives.map(negative => ({ ...negative, code: authored ? negative.authoredCode ?? negative.code : negative.code })) })
}

for (const producer of ['core', 'bun-plugin', 'native', 'native-project'] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    test(`${producer} preserves ${name} class identity in a strict normally installed package`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-class-brand-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'class-brand-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        for (const [file, source] of Object.entries(fixture.files)) {
          await mkdir(join(library, 'src', file, '..'), { recursive: true })
          await writeFile(join(library, 'src', file), source)
        }
        await controls(library, './src/index.js', fixture, true)
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
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'class-brand-contract': `file:${archive}` } }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const output = await readFile(join(consumer, 'node_modules/class-brand-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'class-brand-contract', fixture)

        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}
