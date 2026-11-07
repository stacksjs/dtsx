import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src/generator'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { traceSync } from './helpers/phase-trace'
import { isAvailable, runTsc } from './helpers/tsc'

const parent = "import { install } from './provider.js'; export class ParentThing implements ParentThing {} install(ParentThing.prototype);"
const provider = "import type { ParentThing } from './index.js'; declare module './index.js' { interface ParentThing { add: (a: number, b: number) => number } } export function install(target: ParentThing): void { target.add = (a: number, b: number) => a + b }"
interface Fixture {
  files: Record<string, string>
  retained: Record<string, string[]>
  pruned?: Record<string, string[]>
  paths?: Record<string, string[]>
}
const fixtures: Record<string, Fixture> = {
  direct: { files: { 'index.ts': parent, 'provider.ts': provider }, retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['install'] } },
  'from comments': {
    files: { 'index.ts': parent.replace("from './provider.js'", "from /* activation */ './provider.js'"), 'provider.ts': provider.replace("from './index.js'", "from /* type binding */ './index.js'") },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['import type { ParentThing }'] },
  },
  'multiline imports': {
    files: { 'index.ts': parent.replace("from './provider.js'", "from\n'./provider.js'"), 'provider.ts': provider.replace("import type { ParentThing } from './index.js'", "import\ntype\n{ ParentThing }\nfrom\n'./index.js'") },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['import type { ParentThing }'] },
  },
  'binding and alias comments': {
    files: { 'index.ts': parent.replace('{ install }', '{ /* binding */ install }'), 'provider.ts': provider.replace("import type { ParentThing }", "import /* declaration */ type { ParentThing as /* alias */ Parent }").replace('target: ParentThing', 'target: Parent') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['ParentThing as Parent'] },
  },
  'quoted named bindings': {
    files: { 'index.ts': parent, 'provider.ts': provider.replace('import type { ParentThing }', "import type { 'ParentThing' as Parent }").replace('target: ParentThing', 'target: Parent') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ["'ParentThing' as Parent"] },
  },
  'side effect import trivia': {
    files: { 'index.ts': "import /* activation */ './provider.js'; " + parent, 'provider.ts': provider },
    retained: { 'index.d.ts': ["import /* activation */ './provider.js';"], 'provider.d.ts': ['import type { ParentThing }'] },
  },
  'namespace import trivia': {
    files: { 'index.ts': parent.replace('import { install }', 'import * /* namespace */ as Installer').replace('install(ParentThing', 'Installer.install(ParentThing'), 'provider.ts': provider.replace("import type { ParentThing }", 'import type * /* namespace */ as Model').replace('target: ParentThing', 'target: Model.ParentThing') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['import type * as Model'] },
  },
  'default import trivia': {
    files: { 'index.ts': parent.replace('import { install }', 'import /* default */ install'), 'provider.ts': provider + '; export default install;' },
    retained: { 'index.d.ts': ["import './provider.js';"] },
  },
  'mixed default and namespace type bindings': {
    files: { 'index.ts': parent + '; export default ParentThing;', 'provider.ts': provider.replace('import type { ParentThing }', 'import Parent, * as Model').replace('target: ParentThing', 'target: Parent').replace('): void {', '): Model.ParentThing {').replace('=> a + b }', '=> a + b; return target }') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['import Parent, * as Model'] },
  },
  'quoted bindings containing punctuation and contextual words': {
    files: { 'index.ts': parent + '; export { ParentThing as "ParentThing from, as label" };', 'provider.ts': provider.replace('import type { ParentThing }', 'import type { "ParentThing from, as label" as Parent }').replace('target: ParentThing', 'target: Parent') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['"ParentThing from, as label" as Parent'] },
  },
  'a value binding named type': {
    files: { 'index.ts': parent + '; export { ParentThing as type };', 'provider.ts': provider.replace('import type { ParentThing }', 'import { type as Parent }').replace('target: ParentThing', 'target: Parent') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['type as Parent'] },
  },
  'a default binding named from': {
    files: { 'index.ts': parent + '; export default ParentThing;', 'provider.ts': provider.replace('import type { ParentThing }', 'import from').replace('target: ParentThing', 'target: from') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ['import from from'] },
  },
  transitive: {
    files: {
      'index.ts': parent.replace('./provider.js', './bridge.js'),
      'bridge.ts': "import type { ParentThing } from './index.js'; import { install as apply } from './nested/provider.js'; export function install(target: ParentThing): void { apply(target) }",
      'nested/provider.ts': provider.replaceAll('./index.js', '../index.js'),
    },
    retained: { 'index.d.ts': ["import './bridge.js';"], 'bridge.d.ts': ["import './nested/provider.js';"] },
    pruned: { 'index.d.ts': ['install'], 'bridge.d.ts': ['apply'] },
  },
  namespace: {
    files: { 'index.ts': parent.replace("import { install }", 'import * as Installer').replace('install(ParentThing', 'Installer.install(ParentThing'), 'provider.ts': provider },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['Installer'] },
  },
  'private aliases': {
    files: { 'index.ts': parent.replace('./provider.js', 'private/provider'), 'provider.ts': provider.replaceAll('./index.js', 'private/index') },
    paths: { 'private/*': ['./src/*.ts'] },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ["declare module './index.js'"] },
    pruned: { 'index.d.ts': ['private/', 'install'], 'provider.d.ts': ['private/'] },
  },
  'unrelated providers': {
    files: {
      'index.ts': "import { unrelated } from './other.js'; " + parent + ' unrelated();',
      'provider.ts': provider,
      'other.ts': "import type { Other } from './unrelated.js'; declare module './unrelated.js' { interface Other { label: string } } export function unrelated(): void {}",
      'unrelated.ts': 'export interface Other {}',
    },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['other.js', 'unrelated', 'install'] },
  },
  cycles: {
    files: {
      'index.ts': "import { unrelated } from './cycle.js'; " + parent + ' unrelated();',
      'cycle.ts': "import type { ParentThing } from './index.js'; export function unrelated(value?: ParentThing): void { void value }",
      'provider.ts': provider,
    },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['cycle.js', 'unrelated', 'install'] },
  },
}

const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }

async function prepare(root: string, fixture: Fixture): Promise<void> {
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'augmentation-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, paths: fixture.paths ?? {} }, files: ['control.ts'] }))
  for (const [name, source] of Object.entries(fixture.files)) {
    const path = join(root, 'src', name)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, source)
  }
}

async function controls(root: string, specifier: string): Promise<void> {
  for (const [type, expected] of [['number', []], ['string', ['error TS2322']]] as const) {
    await writeFile(join(root, 'control.ts'), `import { ParentThing } from '${specifier}'; const value: ${type} = new ParentThing().add(1, 2); void value`)
    const result = runTsc(root, ['--project', 'tsconfig.json'])
    expect(result.ok, result.output).toBe(type === 'number')
    expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual([...expected])
  }
}

test('the strict-valid augmentation graph has the real TS9026 isolated declaration diagnostic', async () => {
  expect(isAvailable).toBe(true)
  const root = await mkdtemp(join(tmpdir(), 'dtsx-augmentation-oracle-'))
  try {
    await prepare(root, fixtures.direct)
    await controls(root, './src/index.js')
    await writeFile(join(root, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, isolatedDeclarations: true, noEmitOnError: true, rootDir: './src', outDir: './reference' }, files: ['src/index.ts'] }))
    const args = [process.execPath, resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js'), '--project', 'tsconfig.emit.json']
    const result = traceSync('TypeScript augmentation diagnostic oracle', () => Bun.spawnSync(args, { cwd: root, timeout: 4000 }), { cwd: root, args })
    const diagnostics = result.stdout.toString() + result.stderr.toString()
    expect(result.exitCode, diagnostics).toBe(1)
    expect(diagnostics.match(/error TS\d+/g), diagnostics).toEqual(['error TS9026'])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

for (const producer of ['core', 'bun-plugin', 'native-project'] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    test(`${producer} preserves ${name} augmentations in a strict normally installed package`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-augmentation-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await prepare(library, fixture)
        await controls(library, './src/index.js')
        const options = { cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const }
        const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts(options)] : [] })
        expect(built.success, JSON.stringify(built.logs)).toBe(true)
        if (producer === 'core') {
          const stats = await generate(options)
          expect(stats.filesFailed, JSON.stringify(stats.errors)).toBe(0)
        }
        else if (producer === 'native-project') {
          const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
          expect(existsSync(cli), `Build the actual native CLI: ${cli}`).toBe(true)
          const result = await generateNativeDeclarationProject(cli, options, { timeoutMs: 4000 })
          expect(result.filesGenerated).toBe(Object.keys(fixture.files).length)
        }
        const archive = join(root, 'library.tgz')
        const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 })
        expect(packed.exitCode, packed.stderr.toString()).toBe(0)
        await mkdir(consumer)
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'augmentation-contract': `file:${archive}` } }))
        await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          for (const name of Object.keys(fixture.files)) {
            const file = name.replace(/\.ts$/, '.d.ts')
            const output = await readFile(join(consumer, 'node_modules/augmentation-contract/dist', file), 'utf8')
            expect(output).toBe(await readFile(join(library, 'dist', file), 'utf8'))
            for (const text of fixture.retained[file] ?? []) expect(output).toContain(text)
            for (const text of fixture.pruned?.[file] ?? []) expect(output).not.toContain(text)
          }
          await controls(consumer, 'augmentation-contract')
        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}
