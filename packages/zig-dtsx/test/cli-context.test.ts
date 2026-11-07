import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SourceEmissionContext } from '../src'

const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)

async function directory(check: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dtsx CLI context '))
  try { await check(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

function contextFor(root: string, source: string): SourceEmissionContext {
  return {
    version: 1, moduleSpecifierMode: 'node', sourceFile: join(root, 'src/index.ts'), outputFile: join(root, 'dist/index.d.ts'),
    sourceHash: Bun.SHA256.hash(source, 'hex'),
    augmentationImports: ['./provider'],
    rewrites: [{ specifier: './provider', resolvedSource: join(root, 'src/provider.ts'), declarationOutput: join(root, 'dist/provider.d.ts'), emittedSpecifier: './provider.js' }],
  }
}

function invoke(root: string, args: string[], source = '') {
  return Bun.spawnSync([cli, ...args], { cwd: root, stdin: new TextEncoder().encode(source), stdout: 'pipe', stderr: 'pipe', timeout: 4000 })
}

for (const newline of ['\n', '\r\n']) {
  test(`native CLI context validates exact ${JSON.stringify(newline)} source bytes through stdin`, () => directory(async (root) => {
    const source = ["import { install } from './provider';", 'export interface Public { value: number }', '// café'].join(newline)
    const path = join(root, 'contexte café.json')
    await writeFile(path, JSON.stringify(contextFor(root, source)))
    const result = invoke(root, ['--context', path], source)
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString()).toContain("import './provider.js';")
    expect(result.stdout.toString()).not.toContain('install')
    expect(result.stdout.toString()).not.toContain('\r')
  }))
}

test('native CLI contextual file emission preserves Unicode filenames', () => directory(async (root) => {
  const source = "import { install } from './provider'; export interface Public { value: number }"
  const input = join(root, 'entrée café.ts')
  const output = join(root, 'sortie café.d.ts')
  const context = join(root, 'contexte café.json')
  await writeFile(input, source)
  await writeFile(context, JSON.stringify(contextFor(root, source)))
  const result = invoke(root, ['--context', context, input, '-o', output])
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(await readFile(output, 'utf8')).toContain("import './provider.js';")
}))

for (const failure of ['hash', 'version', 'JSON', 'missing', 'resolution', 'requirements'] as const) {
  test(`native CLI rejects ${failure} context failures before replacing a destination`, () => directory(async (root) => {
    const source = "import { install } from './provider'; export interface Public { value: number }"
    const context = contextFor(root, source)
    const path = join(root, 'context.json')
    const output = join(root, 'index.d.ts')
    if (failure === 'hash') context.sourceHash = '0'.repeat(64)
    if (failure === 'version') Object.assign(context, { version: 2 })
    if (failure === 'resolution') context.rewrites = []
    if (failure === 'requirements') context.augmentationImports = ['bad\0path']
    if (failure !== 'missing') await writeFile(path, failure === 'JSON' ? '{' : JSON.stringify(context))
    await writeFile(output, 'retain previous declaration')
    const result = invoke(root, ['--context', path, '-o', output], source)
    expect(result.exitCode).not.toBe(0)
    const expected = failure === 'version' ? 'UnsupportedContextVersion' : failure === 'missing' ? 'InputReadFailure' : failure === 'resolution' ? 'UnresolvedModuleSpecifier' : 'InvalidContext'
    expect(result.stderr.toString()).toContain(expected)
    expect(await readFile(output, 'utf8')).toBe('retain previous declaration')
  }))
}

for (const args of [
  ['--project'], ['--outdir'], ['--context'], ['-o'], ['--unknown'],
  ['--project', 'src'], ['--outdir', 'dist'], ['first.ts', 'second.ts'],
  ['--project', 'src', '--outdir', 'dist', 'input.ts'],
  ['--project', 'src', '--outdir', 'dist', '--context', 'context.json'],
  ['-o', 'first.d.ts', '-o', 'second.d.ts'],
  ['--project', '--outdir'],
  ['--batch', '--context', 'context.json'], ['--batch', '-o', 'index.d.ts'],
  ['--batch', 'input.ts'], ['--batch', '--project', 'src', '--outdir', 'dist'], ['--batch', '--batch'],
]) {
  test(`native CLI rejects invalid arguments ${args.join(' ')}`, () => directory(async (root) => {
    const result = invoke(root, args)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('InvalidArguments')
  }))
}

test('native CLI accepts a dash-prefixed filename after the option separator', () => directory(async (root) => {
  await writeFile(join(root, '-input.ts'), 'export const answer: number = 42;')
  const result = invoke(root, ['--', '-input.ts'])
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(result.stdout.toString()).toContain('answer: number;')
}))

test('native batch validates all source identities before writing any response prefix', () => directory(async (root) => {
  const source = 'export interface Public { value: number }'
  const first = contextFor(root, source)
  first.augmentationImports = []
  first.rewrites = []
  const second = { ...first, sourceFile: join(root, 'src/second.ts'), outputFile: join(root, 'dist/second.d.ts'), sourceHash: '0'.repeat(64) }
  const result = invoke(root, ['--batch'], JSON.stringify({ protocol: 'zig-dtsx-project', version: 1, files: [{ source, context: first }, { source, context: second }] }))
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain('InvalidContext')
  expect(result.stdout.byteLength).toBe(0)
}))

for (const duplicate of ['sourceFile', 'outputFile'] as const) {
  test(`native batch rejects duplicate ${duplicate} identities`, () => directory(async (root) => {
    const source = 'export interface Public { value: number }'
    const first = { ...contextFor(root, source), augmentationImports: [], rewrites: [] }
    const second = { ...first, sourceFile: join(root, 'src/second.ts'), outputFile: join(root, 'dist/second.d.ts'), [duplicate]: first[duplicate] }
    const result = invoke(root, ['--batch'], JSON.stringify({ protocol: 'zig-dtsx-project', version: 1, files: [{ source, context: first }, { source, context: second }] }))
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('InvalidProjectRequest')
    expect(result.stdout.byteLength).toBe(0)
  }))
}

test('native batch failure after an emitted prefix has a nonzero status and identifies the failing source', () => directory(async (root) => {
  const healthy = 'export interface Public { value: number }'
  const failed = 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { privateValue = undefined; } export const value = privateValue;'
  const first = { ...contextFor(root, healthy), augmentationImports: [], rewrites: [] }
  const second = { ...contextFor(root, failed), sourceFile: join(root, 'src/failed.ts'), outputFile: join(root, 'dist/failed.d.ts'), augmentationImports: [], rewrites: [] }
  const result = invoke(root, ['--batch'], JSON.stringify({ protocol: 'zig-dtsx-project', version: 1, files: [{ source: healthy, context: first }, { source: failed, context: second }] }))
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain('DTSX_UNSUPPORTED_VALUE_FLOW')
  expect(result.stderr.toString()).toContain(second.sourceFile)
  expect(result.stdout.toString()).toContain('"content"')
  expect(() => JSON.parse(result.stdout.toString())).toThrow()
}))

for (const request of ['{', JSON.stringify({ protocol: 'other', version: 1, files: [] }), JSON.stringify({ protocol: 'zig-dtsx-project', version: 2, files: [] })]) {
  test(`native batch rejects malformed or unsupported request ${request}`, () => directory(async (root) => {
    const result = invoke(root, ['--batch'], request)
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout.byteLength).toBe(0)
  }))
}

test('native batch distinguishes valid empty output from failure', () => directory(async (root) => {
  const source = ''
  const context = { ...contextFor(root, source), augmentationImports: [], rewrites: [] }
  const result = invoke(root, ['--batch'], JSON.stringify({ protocol: 'zig-dtsx-project', version: 1, files: [{ source, context }] }))
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toEqual({ protocol: 'zig-dtsx-project', version: 1, files: [{ sourceFile: context.sourceFile, outputFile: context.outputFile, sourceHash: context.sourceHash, content: '' }] })
}))

test('native project honors the same isolated declaration mode as single-source emission', () => directory(async (root) => {
  const source = 'export class Counter { get value() { return 7 } }'
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/index.ts'), source)
  const semantic = invoke(root, [], source)
  expect(semantic.exitCode, semantic.stderr.toString()).toBe(0)
  expect(semantic.stdout.toString()).toContain('number')
  const isolated = invoke(root, ['--isolated-declarations'], source)
  expect(isolated.exitCode, isolated.stderr.toString()).toBe(0)
  expect(isolated.stdout.toString()).toContain('unknown')
  const project = invoke(root, ['--project', join(root, 'src'), '--outdir', join(root, 'dist'), '--isolated-declarations'])
  expect(project.exitCode, project.stderr.toString()).toBe(0)
  expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).toBe(isolated.stdout.toString())
}))
