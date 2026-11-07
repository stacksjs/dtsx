import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src/generator'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { isAvailable, runTsc } from './helpers/tsc'
import { assertPackageControls } from './helpers/package-controls'

const external = 'external-activation-contract'
const parent = `import { install } from './provider.js'; import type { Remote } from '${external}'; export type { Remote }; install({ base: 'ok', add: (a, b) => a + b });`
const provider = `import type { Remote } from '${external}'; declare module '${external}' { interface Remote { add: (a: number, b: number) => number } } export function install(target: Remote): void { void target }`
interface Fixture { files: Record<string, string>, retained: Record<string, string[]>, pruned?: Record<string, string[]> }
const fixtures: Record<string, Fixture> = {
  direct: { files: { 'index.ts': parent, 'provider.ts': provider }, retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['install'] } },
  transitive: {
    files: {
      'index.ts': parent.replace('./provider.js', './bridge.js'),
      'bridge.ts': `import type { Remote } from '${external}'; import { install as apply } from './nested/provider.js'; export function install(target: Remote): void { apply(target) }`,
      'nested/provider.ts': provider,
    },
    retained: { 'index.d.ts': ["import './bridge.js';"], 'bridge.d.ts': ["import './nested/provider.js';"] },
    pruned: { 'index.d.ts': ['install'], 'bridge.d.ts': ['apply'] },
  },
  namespace: {
    files: { 'index.ts': parent.replace('import { install }', 'import * as Installer').replace('install({', 'Installer.install({'), 'provider.ts': provider },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['Installer'] },
  },
  'unrelated external providers': {
    files: {
      'index.ts': "import { unrelated } from './other.js'; " + parent + ' unrelated();',
      'provider.ts': provider,
      'other.ts': `import type { Other } from '${external}/other'; declare module '${external}/other' { interface Other { label: string } } export function unrelated(value?: Other): void { void value }`,
    },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['other.js', 'unrelated', 'install'] },
  },
  cycles: {
    files: {
      'index.ts': "import { unrelated } from './cycle.js'; " + parent + ' unrelated();',
      'provider.ts': provider,
      'cycle.ts': "import type { Remote } from './index.js'; export function unrelated(value?: Remote): void { void value }",
    },
    retained: { 'index.d.ts': ["import './provider.js';"] }, pruned: { 'index.d.ts': ['cycle.js', 'unrelated', 'install'] },
  },
  'decoded external identity and import trivia': {
    files: {
      'index.ts': parent.replace("from './provider.js'", "from /* activation */\n'./provider.js'"),
      'provider.ts': provider.replace('import type { Remote }', "import\ntype { 'Remote' as Model }").replace('target: Remote', 'target: Model').replace(`declare module '${external}'`, "declare module 'external-activation-contr\\u0061ct'"),
    },
    retained: { 'index.d.ts': ["import './provider.js';"], 'provider.d.ts': ["'Remote' as Model"] },
  },
}
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }

async function controls(root: string, specifier: string, hiddenCode = 'TS2305'): Promise<void> {
  await assertPackageControls(root, specifier, {
    positive: 'declare const remote: api.Remote; const value: number = remote.add(1, 2); void value;',
    negatives: [
      { text: 'declare const remote: api.Remote; const value: string = remote.add(1, 2); void value;', code: 'TS2322' },
      { text: `import { install } from '${specifier}'; void install;`, code: hiddenCode },
    ],
  })
}

async function put(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, source] of Object.entries(files)) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), source)
  }
}

async function packDependency(root: string): Promise<string> {
  const dependency = join(root, 'external')
  await mkdir(dependency)
  await put(dependency, {
    'package.json': JSON.stringify({ name: external, version: '1.0.0', type: 'module', exports: { '.': { types: './index.d.ts', import: './index.js' }, './other': { types: './other.d.ts', import: './index.js' } } }),
    'index.d.ts': 'export interface Remote { base: string }',
    'other.d.ts': 'export interface Other { id: number }',
    'index.js': 'export {}',
  })
  const archive = join(root, 'external.tgz')
  const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: dependency, timeout: 4000 })
  expect(packed.exitCode, packed.stderr.toString()).toBe(0)
  return archive
}

for (const producer of ['core', 'bun-plugin', 'native-api', 'native-cli'] as const) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    test(`${producer} retains ${name} activation for external types in a normally installed package`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-external-augmentation-package-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        const dependencyArchive = await packDependency(root)
        await mkdir(join(library, 'src'), { recursive: true })
        const executable = `zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'external-augmentation-package', version: '1.0.0', type: 'module', files: ['dist', 'bin'], dependencies: { [external]: `file:${dependencyArchive}` }, exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, bin: producer === 'native-cli' ? { 'external-augmentation-package': `./bin/${executable}` } : undefined }))
        await put(join(library, 'src'), fixture.files)
        const installedDependency = Bun.spawnSync([process.execPath, 'install'], { cwd: library, timeout: 4000 })
        expect(installedDependency.exitCode, installedDependency.stderr.toString()).toBe(0)
        await controls(library, './src/index.js', fixture.files['index.ts'].includes('import { install }') ? 'TS2459' : 'TS2305')
        const options = { cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const }
        const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts(options)] : [] })
        expect(built.success, JSON.stringify(built.logs)).toBe(true)
        if (producer === 'core') {
          const result = await generate(options)
          expect(result.filesFailed, JSON.stringify(result.errors)).toBe(0)
        }
        else if (producer === 'native-api') {
          expect(existsSync(cli), `Build the real CLI: ${cli}`).toBe(true)
          const result = await generateNativeDeclarationProject(cli, options, { timeoutMs: 4000 })
          expect(result.filesGenerated).toBe(Object.keys(fixture.files).length)
        }
        else if (producer === 'native-cli') {
          expect(existsSync(cli), `Build the real CLI: ${cli}`).toBe(true)
          const emitted = Bun.spawnSync([cli, '--project', join(library, 'src'), '--outdir', join(library, 'dist')], { timeout: 4000 })
          expect(emitted.exitCode, emitted.stderr.toString()).toBe(0)
          await mkdir(join(library, 'bin'))
          await copyFile(cli, join(library, 'bin', executable))
        }
        const archive = join(root, 'library.tgz')
        const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 })
        expect(packed.exitCode, packed.stderr.toString()).toBe(0)
        await mkdir(consumer)
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'external-augmentation-package': `file:${archive}` }, scripts: { emit: 'external-augmentation-package' } }))
        if (producer === 'native-cli') await put(join(consumer, 'independent'), fixture.files)
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          const installedRoot = join(consumer, 'node_modules/external-augmentation-package')
          await controls(consumer, 'external-augmentation-package')
          for (const file of Object.keys(fixture.files).map(file => file.replace(/\.ts$/, '.d.ts'))) {
            const output = await readFile(join(installedRoot, 'dist', file), 'utf8')
            expect(output).toBe(await readFile(join(library, 'dist', file), 'utf8'))
            for (const text of fixture.retained[file] ?? []) expect(output).toContain(text)
            for (const text of fixture.pruned?.[file] ?? []) expect(output).not.toContain(text)
          }
          if (producer === 'native-cli') {
            expect(Bun.SHA256.hash(await readFile(join(installedRoot, 'bin', executable)), 'hex')).toBe(Bun.SHA256.hash(await readFile(cli), 'hex'))
            const output = flags.length ? 'emitted-frozen' : 'emitted-normal'
            const command = Bun.spawnSync([process.execPath, 'run', 'emit', '--project', join(consumer, 'independent'), '--outdir', join(consumer, output)], { cwd: consumer, timeout: 4000 })
            expect(command.exitCode, command.stderr.toString()).toBe(0)
            await controls(consumer, `./${output}/index.js`)
            for (const file of Object.keys(fixture.files).map(file => file.replace(/\.ts$/, '.d.ts')))
              expect(await readFile(join(consumer, output, file), 'utf8')).toBe(await readFile(join(library, 'dist', file), 'utf8'))
          }
        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    }, producer === 'native-cli' ? 15000 : 5000)
  }
}

for (const producer of ['core', 'bun-plugin'] as const) {
  test(`${producer} invalidates an unchanged entry when a sibling begins augmenting its external type`, async () => {
    expect(isAvailable).toBe(true)
    const root = await mkdtemp(join(tmpdir(), 'dtsx-external-activation-cache-'))
    try {
      const archive = await packDependency(root)
      const library = join(root, 'library')
      await mkdir(join(library, 'src'), { recursive: true })
      await writeFile(join(library, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { [external]: `file:${archive}` } }))
      const installed = Bun.spawnSync([process.execPath, 'install'], { cwd: library, timeout: 4000 })
      expect(installed.exitCode, installed.stderr.toString()).toBe(0)
      const entry = `import { install } from './provider.js'; import type { Remote } from '${external}'; export type { Remote }; install({base:'ok'});`
      const initialProvider = `import type { Remote } from '${external}'; export function install(target: Pick<Remote, 'base'>): void { void target }`
      await put(join(library, 'src'), { 'index.ts': entry, 'provider.ts': initialProvider })
      await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
      for (const type of ['string', 'number']) {
        await writeFile(join(library, 'control.ts'), `import type { Remote } from './src/index.js'; declare const api: Remote; const value: ${type} = api.base; void value`)
        const result = runTsc(library, ['--project', 'tsconfig.json'])
        expect(result.ok, result.output).toBe(type === 'string')
        expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(type === 'string' ? [] : ['error TS2322'])
      }
      const options = { cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const, incremental: true }
      async function emit(): Promise<void> {
        if (producer === 'core') {
          const result = await generate(options)
          expect(result.filesFailed, JSON.stringify(result.errors)).toBe(0)
        }
        else {
          const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [dts(options)] })
          expect(built.success, JSON.stringify(built.logs)).toBe(true)
        }
      }
      await emit()
      expect(await readFile(join(library, 'dist/index.d.ts'), 'utf8')).not.toContain('./provider.js')
      const augmented = initialProvider + ` declare module '${external}' { interface Remote { add: (a: number, b: number) => number } }`
      await writeFile(join(library, 'src/provider.ts'), augmented)
      await controls(library, './src/index.js', 'TS2459')
      expect(await readFile(join(library, 'src/index.ts'), 'utf8')).toBe(entry)
      await emit()
      expect(await readFile(join(library, 'dist/index.d.ts'), 'utf8')).toContain("import './provider.js';")
      await controls(library, './dist/index.js')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
}
