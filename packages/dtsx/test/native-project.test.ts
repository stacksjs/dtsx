import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as native from '../../zig-dtsx/src/index'
import { isAvailable, runTsc } from './helpers/tsc'

test('native contextual planning preserves a strict-valid augmentation graph and its private alias identities', async () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  expect(isAvailable).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-augmentation-seam-'))
  try {
    await mkdir(join(directory, 'src'))
    await mkdir(join(directory, 'dist'))
    await writeFile(join(directory, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(join(directory, 'src/index.ts'), "import { install } from 'private/provider'; export class ParentThing implements ParentThing {} install(ParentThing.prototype);")
    await writeFile(join(directory, 'src/provider.ts'), "import type { ParentThing } from 'private/index'; declare module 'private/index' { interface ParentThing { add: (a: number, b: number) => number } } export function install(target: ParentThing): void { target.add = (a: number, b: number) => a + b }")
    const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, types: [], paths: { 'private/*': ['./src/*.ts'] }, noEmit: true }
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
    async function check(specifier: string): Promise<void> {
      for (const type of ['number', 'string']) {
        await writeFile(join(directory, 'control.ts'), `import { ParentThing } from '${specifier}'; const value: ${type} = new ParentThing().add(1,2); void value`)
        const result = runTsc(directory, ['--project', 'tsconfig.json'])
        expect(result.ok, result.output).toBe(type === 'number')
        expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(type === 'number' ? [] : ['error TS2322'])
      }
    }
    await check('./src/index.js')
    const { planNativeDeclarationProject } = await import('../src/native-project')
    const plan = await planNativeDeclarationProject({ cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' })
    expect(plan.files[0].context.augmentationImports).toEqual(['private/provider'])
    for (const file of plan.files) {
      const output = native.processSourceWithContext(file.source, file.context)
      expect(output).not.toContain('private/')
      await writeFile(file.outputFile, output)
    }
    expect(await readFile(join(directory, 'dist/index.d.ts'), 'utf8')).toContain("import './provider.js';")
    expect(await readFile(join(directory, 'dist/provider.d.ts'), 'utf8')).toContain("declare module './index.js'")
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, paths: {} }, files: ['control.ts'] }))
    await check('./dist/index.js')
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

// This seam uses the real graph planner and actual native emitter. Publishing
// outputs and strict installed-package delivery have separate acceptance gates.
test('a native project plan derives source contexts from the canonical resolved graph', async () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-project-'))
  try {
    await mkdir(join(directory, 'src'))
    const index = join(directory, 'src/index.ts')
    const options = join(directory, 'src/options.ts')
    const source = "export type { Options } from './options'\n"
    await writeFile(index, source)
    await writeFile(options, 'export interface Options { scale: number }\n')
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
    const planner = await import('../src/native-project')
    const plan = await planner.planNativeDeclarationProject({ cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' })
    expect(plan.files.map(file => file.sourceFile)).toEqual([index, options])
    const file = plan.files[0]
    expect(file.source).toBe(source)
    expect(file.context).toEqual({
      version: 1,
      moduleSpecifierMode: 'node',
      sourceFile: index,
      outputFile: join(directory, 'dist/index.d.ts'),
      sourceHash: new Bun.CryptoHasher('sha256').update(source).digest('hex'),
      rewrites: [{ specifier: './options', resolvedSource: options, declarationOutput: join(directory, 'dist/options.d.ts'), emittedSpecifier: './options.js' }],
      inferenceSources: [{ specifier: './options', source: 'export interface Options { scale: number }\n' }],
    })
    expect(native.processSourceWithContext(file.source, file.context)).toContain("from './options.js'")
    expect(native.processSourceWithContext(plan.files[1].source, plan.files[1].context)).toContain('interface Options')
    expect(await Bun.file(join(directory, 'dist/index.d.ts')).exists()).toBe(false)
    expect(await readFile(index, 'utf8')).toBe(source)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('preserve mode applies canonical private alias mappings without inferring Node extensions', async () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-project-alias-'))
  try {
    await mkdir(join(directory, 'src'))
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'native-alias-library', version: '1.0.0', type: 'module' }))
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { 'local/*': ['./src/*'] } } }))
    await writeFile(join(directory, 'src/index.ts'), "export type { Options } from 'local/options'\n")
    await writeFile(join(directory, 'src/options.ts'), 'export interface Options { scale: number }\n')
    const planner = await import('../src/native-project')
    const plan = await planner.planNativeDeclarationProject({ cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'preserve' })
    expect(plan.files).toHaveLength(2)
    expect(plan.files[0].context.rewrites[0].emittedSpecifier).toBe('./options')
    const output = native.processSourceWithContext(plan.files[0].source, plan.files[0].context)
    expect(output).toContain("from './options'")
    expect(output).not.toContain('local/options')
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('the native project graph includes actual import types inside template substitutions', async () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-project-template-'))
  try {
    await mkdir(join(directory, 'src'))
    const index = join(directory, 'src/index.ts')
    const names = join(directory, 'src/names.ts')
    await writeFile(index, "export type Label = `name:${import('./names').Name}`\n")
    await writeFile(names, "export type Name = 'settler'\n")
    const planner = await import('../src/native-project')
    const plan = await planner.planNativeDeclarationProject({ cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' })
    const output = native.processSourceWithContext(plan.files[0].source, plan.files[0].context)
    expect(output).toContain("import('./names.js').Name")
    expect(plan.files.map(file => file.sourceFile)).toEqual([index, names])
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})

for (const scenario of [
  { name: 'import-equals require', source: "import Options = require('./options.cjs')\nexport interface Box { value: Options.Value }\n", target: 'options.cts', declaration: 'export interface Value { scale: number }\n', specifier: './options.cjs', expected: "require('./options.cjs')" },
  { name: 'escaped module literal', source: "export type { Options } from '\\u002e/options'\n", target: 'options.ts', declaration: 'export interface Options { scale: number }\n', specifier: './options', expected: "from './options.js'" },
  { name: 'non-ASCII hex escape', source: "export type { Options } from './caf\\xE9'\n", target: 'café.ts', declaration: 'export interface Options { scale: number }\n', specifier: './café', expected: "from './café.js'" },
  { name: 'non-ASCII Unicode escape', source: "export type { Options } from './caf\\u00E9'\n", target: 'café.ts', declaration: 'export interface Options { scale: number }\n', specifier: './café', expected: "from './café.js'" },
] as const) {
  test(`native planning and emission agree on ${scenario.name}`, async () => {
    expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
    expect(isAvailable).toBe(true)
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-project-grammar-'))
    try {
      await mkdir(join(directory, 'src'))
      await writeFile(join(directory, 'src/index.ts'), scenario.source)
      await writeFile(join(directory, 'src', scenario.target), scenario.declaration)
      await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['src/index.ts'] }))
      const authored = runTsc(directory, ['--project', 'tsconfig.json'])
      expect(authored.ok, authored.output).toBe(true)
      const planner = await import('../src/native-project')
      const plan = await planner.planNativeDeclarationProject({ cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' })
      const output = native.processSourceWithContext(plan.files[0].source, plan.files[0].context)
      expect(output).toContain(scenario.expected)
      expect(plan.files).toHaveLength(2)
      expect(plan.files[0].context.rewrites[0].specifier).toBe(scenario.specifier)
    }
    finally { await rm(directory, { recursive: true, force: true }) }
  })
}

test('native planning rejects unsupported policy, plugins and malformed UTF-8 before publishing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-native-project-invalid-'))
  try {
    await mkdir(join(directory, 'src'))
    const file = join(directory, 'src/index.ts')
    await writeFile(file, 'export interface Options { scale: number }\n')
    const { planNativeDeclarationProject } = await import('../src/native-project')
    const options = { cwd: directory, root: './src', outdir: './dist', entrypoints: ['index.ts'] }
    // Exercise untyped callers as well as the typed configuration contract.
    // @ts-expect-error invalid runtime policy must be rejected
    await expect(planNativeDeclarationProject({ ...options, moduleSpecifierMode: 'invalid' })).rejects.toThrow('moduleSpecifierMode must be preserve or node')
    await expect(planNativeDeclarationProject({ ...options, plugins: [{ name: 'unsupported-native-plugin' }] })).rejects.toThrow('does not support generation plugins')
    await writeFile(file, Buffer.from([0x65, 0x78, 0x70, 0x6F, 0x72, 0x74, 0x20, 0xFF]))
    await expect(planNativeDeclarationProject(options)).rejects.toThrow('must be valid UTF-8')
    expect(await Bun.file(join(directory, 'dist/index.d.ts')).exists()).toBe(false)
  }
  finally { await rm(directory, { recursive: true, force: true }) }
})
