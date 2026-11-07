import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'

const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
const parent = "import { install } from './provider.js'; export class ParentThing implements ParentThing {} install(ParentThing.prototype);"
const provider = "import type { ParentThing } from './index.js'; declare module './index.js' { interface ParentThing { add: (a: number, b: number) => number } } export function install(target: ParentThing): void { target.add = (a: number, b: number) => a + b }"
interface Fixture { files: Record<string, string>, retained: Record<string, string[]>, pruned?: Record<string, string[]>, flags?: string[] }
const fixtures: Record<string, Fixture> = {
  direct: { files: { 'index.ts': parent, 'provider.ts': provider }, retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['install'] } },
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
    files: { 'index.ts': parent.replace('import { install }', 'import * as Installer').replace('install(ParentThing', 'Installer.install(ParentThing'), 'provider.ts': provider },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['Installer'] },
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
  'multiline and quoted bindings': {
    files: { 'index.ts': parent.replace("from './provider.js'", "from /* activation */\n'./provider.js'"), 'provider.ts': provider.replace('import type { ParentThing }', "import\ntype { 'ParentThing' as Model }").replace('target: ParentThing', 'target: Model') },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ["'ParentThing' as Model"] },
  },
  'Unicode provider with escaped module identity': {
    files: { 'index.ts': parent.replace('./provider.js', './nested/caf\\u00e9.js'), 'nested/café.ts': provider.replaceAll('./index.js', '../index.js') },
    retained: { 'index.d.ts': ["import './nested/café.js';"] },
  },
  'contextual default binding': {
    files: { 'index.ts': parent.replace('import { install }', 'import from').replace('install(ParentThing', 'from(ParentThing'), 'provider.ts': provider + '; export default install;' },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['install', 'import from'] },
  },
  'isolated activation': { files: { 'index.ts': parent, 'provider.ts': provider }, retained: { 'index.d.ts': ["import './provider.js';"] }, flags: ['--isolated-declarations'] },
}
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }

async function controls(root: string, specifier: string): Promise<void> {
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
  for (const type of ['number', 'string']) {
    await writeFile(join(root, 'control.ts'), `import { ParentThing } from '${specifier}'; const value: ${type} = new ParentThing().add(1,2); void value`)
    const result = runTsc(root, ['--project', 'tsconfig.json'])
    expect(result.ok, result.output).toBe(type === 'number')
    expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(type === 'number' ? [] : ['error TS2322'])
  }
}

for (const [name, fixture] of Object.entries(fixtures)) {
  test(`standalone project retains ${name} augmentations through normal and frozen installed CLI delivery`, async () => {
    expect(isAvailable).toBe(true)
    expect(existsSync(cli), `Build the actual native CLI: ${cli}`).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'dtsx-native-cli-augmentation-'))
    const library = join(root, 'library')
    const consumer = join(root, 'consumer')
    try {
      await mkdir(join(library, 'src'), { recursive: true })
      await mkdir(join(library, 'bin'))
      await mkdir(consumer)
      const executable = `zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`
      await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'native-augmentation-contract', version: '1.0.0', type: 'module', files: ['bin', 'dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, bin: { 'native-augmentation-contract': `./bin/${executable}` } }))
      for (const [file, source] of Object.entries(fixture.files)) {
        await mkdir(join(library, 'src', file, '..'), { recursive: true })
        await writeFile(join(library, 'src', file), source)
      }
      await controls(library, './src/index.js')
      const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun' })
      expect(built.success, JSON.stringify(built.logs)).toBe(true)
      const emitted = Bun.spawnSync([cli, '--project', join(library, 'src'), '--outdir', join(library, 'dist'), ...fixture.flags ?? []], { timeout: 4000 })
      expect(emitted.exitCode, emitted.stderr.toString()).toBe(0)
      await copyFile(cli, join(library, 'bin', executable))
      const archive = join(root, 'library.tgz')
      const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 })
      expect(packed.exitCode, packed.stderr.toString()).toBe(0)
      await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'native-augmentation-contract': `file:${archive}` }, scripts: { emit: 'native-augmentation-contract' } }))
      for (const [file, source] of Object.entries(fixture.files)) {
        await mkdir(join(consumer, 'independent', file, '..'), { recursive: true })
        await writeFile(join(consumer, 'independent', file), source)
      }
      for (const flags of [[], ['--frozen-lockfile']]) {
        const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
        expect(installed.exitCode, installed.stderr.toString()).toBe(0)
        const installedRoot = join(consumer, 'node_modules/native-augmentation-contract')
        expect(Bun.SHA256.hash(await readFile(join(installedRoot, 'bin', executable)), 'hex')).toBe(Bun.SHA256.hash(await readFile(cli), 'hex'))
        await controls(consumer, 'native-augmentation-contract')
        for (const file of Object.keys(fixture.files).map(file => file.replace(/\.ts$/, '.d.ts'))) {
          const output = await readFile(join(installedRoot, 'dist', file), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist', file), 'utf8'))
          for (const text of fixture.retained[file] ?? []) expect(output).toContain(text)
          for (const text of fixture.pruned?.[file] ?? []) expect(output).not.toContain(text)
        }
        const output = flags.length ? 'emitted-frozen' : 'emitted-normal'
        const command = Bun.spawnSync([process.execPath, 'run', 'emit', '--project', join(consumer, 'independent'), '--outdir', join(consumer, output), ...fixture.flags ?? []], { cwd: consumer, timeout: 4000 })
        expect(command.exitCode, command.stderr.toString()).toBe(0)
        for (const file of Object.keys(fixture.files).map(file => file.replace(/\.ts$/, '.d.ts')))
          expect(await readFile(join(consumer, output, file), 'utf8')).toBe(await readFile(join(library, 'dist', file), 'utf8'))
        await controls(consumer, `./${output}/index.js`)
      }
    }
    finally { await rm(root, { recursive: true, force: true }) }
  }, 15000)
}
