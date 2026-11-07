import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { runTsc } from './helpers/tsc'

const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }

async function project(check: (root: string) => Promise<void>): Promise<void> {
  expect(existsSync(cli), `Build the real native CLI: ${cli}`).toBe(true)
  const root = await mkdtemp(join(tmpdir(), 'dtsx-native-generation-'))
  try {
    await mkdir(join(root, 'src/nested'), { recursive: true })
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(join(root, 'src/index.ts'), "export type { Public } from './nested/model.js'")
    await writeFile(join(root, 'src/nested/model.ts'), 'export interface Public { value: number }')
    await writeFile(join(root, 'dist/index.d.ts'), 'retain previous index')
    await writeFile(join(root, 'dist/runtime.js'), 'retain unrelated runtime')
    await check(root)
  }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function controls(root: string, specifier: string): Promise<void> {
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
  for (const type of ['number', 'string']) {
    await writeFile(join(root, 'control.ts'), `import type { Public } from '${specifier}'; declare const api: Public; const value: ${type} = api.value; void value`)
    const result = runTsc(root, ['--project', 'tsconfig.json'])
    expect(result.ok, result.output).toBe(type === 'number')
    expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(type === 'number' ? [] : ['error TS2322'])
  }
}

test('the native project API publishes nested declarations and cleans only managed outputs', () => project(async (root) => {
  await controls(root, './src/index.js')
  await writeFile(join(root, 'dist/stale.d.ts'), 'stale declaration')
  const result = await generateNativeDeclarationProject(cli, { cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' }, { timeoutMs: 4000 })
  expect(result.filesGenerated).toBe(2)
  expect(result.outputFiles).toEqual([join(root, 'dist/index.d.ts'), join(root, 'dist/nested/model.d.ts')])
  expect(existsSync(join(root, 'dist/stale.d.ts'))).toBe(false)
  expect(await readFile(join(root, 'dist/runtime.js'), 'utf8')).toBe('retain unrelated runtime')
  await controls(root, './dist/index.js')
}))

test('a genuine native emission failure leaves the complete prior project untouched', () => project(async (root) => {
  const source = 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { privateValue = undefined; } export const value = privateValue;'
  await writeFile(join(root, 'src/failed.ts'), source)
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
  await writeFile(join(root, 'control.ts'), "import { value } from './src/failed.js'; const result: number | undefined = value; void result")
  const authored = runTsc(root, ['--project', 'tsconfig.json'])
  expect(authored.ok, authored.output).toBe(true)
  await writeFile(join(root, 'control.ts'), "import { value } from './src/failed.js'; const invalid: boolean = value; void invalid")
  const negative = runTsc(root, ['--project', 'tsconfig.json'])
  expect(negative.ok, negative.output).toBe(false)
  expect(negative.output.match(/error TS\d+/g), negative.output).toEqual(['error TS2322'])
  await expect(generateNativeDeclarationProject(cli, { cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts', 'failed.ts'], moduleSpecifierMode: 'node' }, { timeoutMs: 4000 })).rejects.toThrow('DTSX_UNSUPPORTED_VALUE_FLOW')
  expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).toBe('retain previous index')
  expect(await readFile(join(root, 'dist/runtime.js'), 'utf8')).toBe('retain unrelated runtime')
  expect(existsSync(join(root, 'dist/nested/model.d.ts'))).toBe(false)
  expect(existsSync(join(root, 'dist/.dtsx-publication'))).toBe(false)
}))

for (const used of [false, true]) {
  test(`native project ${used ? 'rejects a retained' : 'prunes an unused'} reference to an excluded source`, () => project(async (root) => {
    await writeFile(join(root, 'src/index.ts'), `import type { Hidden } from './excluded.js'; export interface Public { value: ${used ? 'Hidden' : 'number'} }`)
    await writeFile(join(root, 'src/excluded.ts'), 'export interface Hidden { secret: number }')
    const options = { cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts'], exclude: ['excluded.ts'], moduleSpecifierMode: 'node' as const }
    if (used) {
      await expect(generateNativeDeclarationProject(cli, options, { timeoutMs: 4000 })).rejects.toThrow('UndeliveredModuleSpecifier')
      expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).toBe('retain previous index')
    }
    else {
      const result = await generateNativeDeclarationProject(cli, options, { timeoutMs: 4000 })
      expect(result.filesGenerated).toBe(1)
      expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).not.toContain('excluded')
      await controls(root, './src/index.js')
      await controls(root, './dist/index.js')
    }
  }))
}

test('an unavailable native backend never falls back to JavaScript emission', () => project(async (root) => {
  await expect(generateNativeDeclarationProject(join(root, 'missing-native-executable'), { cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts'] }, { timeoutMs: 4000 })).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).toBe('retain previous index')
  expect(existsSync(join(root, 'dist/nested/model.d.ts'))).toBe(false)
}))

test('native project cancellation and unsupported transformations fail before publication', () => project(async (root) => {
  const options = { cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts'] }
  await expect(generateNativeDeclarationProject(cli, options, { signal: AbortSignal.abort(new Error('owned cancellation')) })).rejects.toThrow('owned cancellation')
  await expect(generateNativeDeclarationProject(cli, { ...options, ...{ prettier: true } })).rejects.toThrow('does not support option: prettier')
  expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).toBe('retain previous index')
}))
