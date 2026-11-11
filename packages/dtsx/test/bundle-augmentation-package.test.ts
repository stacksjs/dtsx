import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src/generator'
import { isAvailable, runTsc } from './helpers/tsc'

const parent = "import { install } from './provider.js'; export class ParentThing implements ParentThing {} install(ParentThing.prototype);"
const provider = "import type { ParentThing } from './index.js'; declare module './index.js' { interface ParentThing { add: (a: number, b: number) => number } } export function install(target: ParentThing): void { target.add = (a: number, b: number) => a + b }"
const fixtures: Record<string, Record<string, string>> = {
  direct: { 'index.ts': parent, 'provider.ts': provider },
  're-exported target': {
    'index.ts': "export { ParentThing } from './model.js';",
    'model.ts': parent,
    'provider.ts': provider.replaceAll('./index.js', './model.js'),
  },
  'colliding target and imported types': {
    'index.ts': "export interface Model { label: string }; export { Model as ParentThing } from './model.js';",
    'model.ts': parent.replaceAll('ParentThing', 'Model'),
    'provider.ts': provider.replaceAll('ParentThing', 'Model').replaceAll('./index.js', './model.js'),
  },
  'generic target shadows a colliding imported type': {
    'index.ts': "export type T = string; export { ParentThing } from './model.js';",
    'model.ts': parent.replaceAll('ParentThing implements ParentThing', 'ParentThing<T> implements ParentThing<T>'),
    'types.ts': 'export interface T { label: string }',
    'provider.ts': "import type { T } from './types.js'; " + provider.replaceAll('./index.js', './model.js').replace('interface ParentThing {', 'interface ParentThing<T> {').replace('target: ParentThing', 'target: ParentThing<number>'),
  },
  'new exported interfaces, aliases and namespace members': {
    'index.ts': parent,
    'provider.ts': provider.replace('interface ParentThing {', 'interface Added { value: number } type Alias = Added; namespace ParentThing { interface Nested { value: number } } interface ParentThing {'),
  },
  'implicit target exports take precedence over provider imports': {
    'index.ts': parent + ' export interface Model { value: number }',
    'types.ts': 'export interface Model { label: string }',
    'provider.ts': "import type { Model } from './types.js'; " + provider.replace('interface ParentThing {', 'interface ParentThing { related: Model;'),
  },
  'transitive activation through a cyclic graph': {
    'index.ts': parent.replace('./provider.js', './bridge.js'),
    'bridge.ts': "import { install as apply } from './provider.js'; import type { ParentThing } from './index.js'; export function install(target: ParentThing): void { apply(target) }",
    'provider.ts': provider,
  },
  'quoted bindings and import comments': {
    'index.ts': parent.replace("from './provider.js'", "from /* activation */ './provider.js'"),
    'provider.ts': provider.replace('import type { ParentThing }', "import type { 'ParentThing' as Parent }").replace('target: ParentThing', 'target: Parent').replace("from './index.js'", "from\n'./index.js'"),
  },
  'global augmentation binding scopes': {
    'index.ts': parent + ' export interface GlobalBox { owned: boolean } export type Global = globalThis.GlobalBox;',
    'types.ts': 'export interface GlobalBox { label: string }',
    'provider.ts': "import type { GlobalBox } from './types.js'; " + provider + ' declare global { interface GlobalBox { extra: number } } export type ProviderValue = GlobalBox;',
  },
  'external augmentation binding scopes': {
    'index.ts': "import './provider.js'; export interface Remote { local: boolean } export type { Remote as ParentThing } from 'external-augmentation-contract';",
    'provider.ts': "import type { Remote } from 'external-augmentation-contract'; declare module 'external-augmentation-contract' { interface Remote { add: (a: number, b: number) => number } } export function install(target: Remote): void { void target }",
  },
  'nested generic signatures and namespace member scopes': {
    'index.ts': "export interface Nested { owned: boolean } export type T = string; export { ParentThing } from './model.js';",
    'model.ts': parent,
    'types.ts': 'export interface Nested { label: string } export interface T { value: number }',
    'provider.ts': "import type { Nested, T } from './types.js'; " + provider.replaceAll('./index.js', './model.js').replace('interface ParentThing {', "namespace ParentThing { interface Nested { value: number } function create(value: Nested): Nested; } interface ParentThing { map: <T>(value: T) => T; outer: T; label: `T-${T['value']}`;"),
  },
}
const additionalControls: Record<string, string> = {
  'new exported interfaces, aliases and namespace members': "import type { Added, Alias } from '$SPEC'; declare const a: Added; declare const b: Alias; declare const c: ParentThing.Nested; const extra: number = a.value + b.value + c.value; void extra;",
  'implicit target exports take precedence over provider imports': 'const extra: number = new ParentThing().related.value; void extra;',
  'global augmentation binding scopes': "import type { Global } from '$SPEC'; declare const g: Global; const extra: number = g.extra; void extra;",
  'nested generic signatures and namespace member scopes': "const mapped: string = new ParentThing().map('s'); const outer: number = new ParentThing().outer.value; const label: `T-${number}` = new ParentThing().label; declare const n: ParentThing.Nested; const extra: number = ParentThing.create(n).value; void [mapped, outer, label, extra];",
}
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }

async function controls(root: string, specifier: string, name: string, hiddenCode = 'TS2459'): Promise<void> {
  const files: string[] = []
  for (const type of ['number', 'string'] as const) {
    const expression = name.startsWith('external') ? 'instance.add(1, 2)' : 'new ParentThing().add(1, 2)'
    const setup = name.startsWith('external') ? `import type { ParentThing } from '${specifier}'; declare const instance: ParentThing;` : `import { ParentThing } from '${specifier}';`
    const file = type === 'number' ? 'control-positive.ts' : 'control-wrong-type.ts'
    files.push(file)
    await writeFile(join(root, file), `${setup} const value: ${type} = ${expression}; void value; ${(additionalControls[name] ?? '').replaceAll('$SPEC', specifier)}`)
  }
  files.push('control-hidden.ts')
  await writeFile(join(root, 'control-hidden.ts'), `import { install } from '${specifier}'; void install`)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files }))
  // Each control is an external module, so negative witnesses cannot modify
  // the positive's scope. One compiler program still requires exactly the two
  // intended diagnostics, attributed to their own negative files, and none in
  // the positive or any dependency. Keep all existing install/timeout guards.
  const result = runTsc(root, ['--project', 'tsconfig.json'])
  expect(result.ok, result.output).toBe(false)
  expect(result.output.match(/error TS\d+/g) ?? [], result.output).toHaveLength(2)
  const diagnostics = [...result.output.matchAll(/^([^\r\n]+?)\(\d+,\d+\): error TS(\d+):/gm)]
    .map(match => ({ file: match[1].replaceAll('\\', '/'), code: Number(match[2]) }))
    .sort((left, right) => left.file.localeCompare(right.file))
  expect(diagnostics, result.output).toEqual([
    { file: 'control-hidden.ts', code: Number(hiddenCode.slice(2)) },
    { file: 'control-wrong-type.ts', code: 2322 },
  ])
}

for (const producer of ['core', 'bun-plugin'] as const) {
  for (const [name, files] of Object.entries(fixtures)) {
    test(`${producer} links ${name} augmentations in a strict normally installed bundle`, async () => {
      expect(isAvailable).toBe(true)
      const root = await mkdtemp(join(tmpdir(), 'dtsx-bundle-augmentation-'))
      const library = join(root, 'library')
      const consumer = join(root, 'consumer')
      try {
        await mkdir(join(library, 'src'), { recursive: true })
        const dependencies: Record<string, string> = {}
        if (name.startsWith('external')) {
          const external = join(root, 'external')
          await mkdir(external)
          await writeFile(join(external, 'package.json'), JSON.stringify({ name: 'external-augmentation-contract', version: '1.0.0', type: 'module', exports: { '.': { types: './index.d.ts', import: './index.js' } } }))
          await writeFile(join(external, 'index.d.ts'), 'export interface Remote { base: string }')
          await writeFile(join(external, 'index.js'), 'export {}')
          const archive = join(root, 'external.tgz')
          const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: external, timeout: 4000 })
          expect(packed.exitCode, packed.stderr.toString()).toBe(0)
          dependencies['external-augmentation-contract'] = `file:${archive}`
        }
        await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'bundle-augmentation-contract', version: '1.0.0', type: 'module', files: ['dist/index.d.ts', 'dist/index.js'], dependencies, exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
        if (Object.keys(dependencies).length) {
          const installed = Bun.spawnSync([process.execPath, 'install'], { cwd: library, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
        }
        await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
        for (const [file, source] of Object.entries(files)) await writeFile(join(library, 'src', file), source)
        await controls(library, './src/index.js', name, files['index.ts'].includes('import { install }') ? 'TS2459' : 'TS2305')
        const options = { cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const, bundle: true, bundleOutput: 'index.d.ts' }
        const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts(options)] : [] })
        expect(built.success, JSON.stringify(built.logs)).toBe(true)
        if (producer === 'core') {
          const result = await generate(options)
          expect(result.filesFailed, JSON.stringify(result.errors)).toBe(0)
        }
        const archive = join(root, 'library.tgz')
        const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 })
        expect(packed.exitCode, packed.stderr.toString()).toBe(0)
        await mkdir(consumer)
        await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'bundle-augmentation-contract': `file:${archive}` } }))
        await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
        for (const flags of [[], ['--frozen-lockfile']]) {
          const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
          expect(installed.exitCode, installed.stderr.toString()).toBe(0)
          expect((await readdir(join(consumer, 'node_modules/bundle-augmentation-contract/dist'))).sort()).toEqual(['index.d.ts', 'index.js'])
          const output = await readFile(join(consumer, 'node_modules/bundle-augmentation-contract/dist/index.d.ts'), 'utf8')
          expect(output).toBe(await readFile(join(library, 'dist/index.d.ts'), 'utf8'))
          await controls(consumer, 'bundle-augmentation-contract', name)
          expect(output).not.toMatch(/(?:from|import|module)\s+['"]\.\.?\//)
        }
      }
      finally { await rm(root, { recursive: true, force: true }) }
    })
  }
}
