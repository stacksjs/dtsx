import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'

const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
const unsupported = 'let privateValue: number | undefined = 7; if (Math.random() > 0.5) { privateValue = undefined; } export const value = privateValue;'

async function directory(check: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'zig-dtsx project '))
  try { await check(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

function invoke(args: string[], cwd?: string) {
  expect(existsSync(cli), `Build the real native CLI: ${cli}`).toBe(true)
  return Bun.spawnSync([cli, ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 4000 })
}

for (const count of [1, 24]) {
  test(`native project discovers ${count} nested sources and preserves their output structure`, () => directory(async (root) => {
    const input = join(root, 'src')
    const output = join(root, 'previously missing/parents/types')
    for (let index = 0; index < count; index++) {
      const path = join(input, `level${index % 3}`, 'deep', `file${index}.ts`)
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, `export const value${index}: number = ${index};`)
    }
    const result = invoke(['--project', input, '--outdir', output])
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    for (let index = 0; index < count; index++)
      expect(await readFile(join(output, `level${index % 3}/deep/file${index}.d.ts`), 'utf8')).toContain(`export declare const value${index}: number;`)
  }))
}

test('native project excludes declaration inputs, dependency trees and its own output', () => directory(async (root) => {
  const input = join(root, 'src')
  const output = join(input, 'generated')
  await mkdir(join(input, 'nested'), { recursive: true })
  await mkdir(join(input, 'node_modules/dependency'), { recursive: true })
  await mkdir(output)
  await writeFile(join(input, 'nested/index.ts'), 'export const nested: number = 7;')
  await writeFile(join(input, 'broken.d.ts'), unsupported)
  await writeFile(join(input, 'node_modules/dependency/index.ts'), unsupported)
  await writeFile(join(output, 'unrelated.ts'), unsupported)
  await writeFile(join(output, 'runtime.js'), 'retain unrelated runtime')
  for (let generation = 0; generation < 2; generation++) {
    const result = invoke(['--project', input, '--outdir', output])
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(await readFile(join(output, 'nested/index.d.ts'), 'utf8')).toContain('nested: number;')
    expect(existsSync(join(output, 'generated'))).toBe(false)
    expect(existsSync(join(output, 'node_modules'))).toBe(false)
    expect(existsSync(join(output, 'broken.d.d.ts'))).toBe(false)
    expect(await readFile(join(output, 'runtime.js'), 'utf8')).toBe('retain unrelated runtime')
    expect(await readFile(join(output, 'unrelated.ts'), 'utf8')).toBe(unsupported)
  }
}))

test('native project preserves Unicode and spaced source/output paths', () => directory(async (root) => {
  const input = join(root, 'entrée source')
  const output = join(root, 'résultat types')
  await mkdir(join(input, 'sous dossier'), { recursive: true })
  await writeFile(join(input, 'sous dossier/café.ts'), 'export const answer: number = 42;')
  const result = invoke(['--project', input, '--outdir', output])
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(await readFile(join(output, 'sous dossier/café.d.ts'), 'utf8')).toContain('answer: number;')
}))

test('native project handles root aliases and directory cycles without traversing generated output', () => directory(async (root) => {
  const input = join(root, 'src')
  const output = join(input, 'generated')
  const inputAlias = join(root, 'input alias')
  const outputAlias = join(root, 'output alias')
  await mkdir(join(input, 'nested'), { recursive: true })
  await mkdir(output)
  await writeFile(join(input, 'nested/index.ts'), 'export const aliased: number = 7;')
  await writeFile(join(output, 'unrelated.ts'), unsupported)
  const kind = process.platform === 'win32' ? 'junction' : 'dir'
  await symlink(input, inputAlias, kind)
  await symlink(output, outputAlias, kind)
  await symlink(input, join(input, 'nested/cycle'), kind)
  const result = invoke(['--project', inputAlias, '--outdir', outputAlias])
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  expect(await readFile(join(output, 'nested/index.d.ts'), 'utf8')).toContain('aliased: number;')
  expect(existsSync(join(output, 'nested/cycle'))).toBe(false)
  expect(existsSync(join(output, 'generated'))).toBe(false)
  expect(await readFile(join(output, 'unrelated.ts'), 'utf8')).toBe(unsupported)
}))

for (const count of [1, 24]) {
  test(`native ${count}-source project reports nested emission failures`, () => directory(async (root) => {
    const input = join(root, 'src')
    const output = join(root, 'types')
    await mkdir(join(input, 'nested'), { recursive: true })
    await mkdir(join(output, 'nested'), { recursive: true })
    await writeFile(join(input, 'nested/failed.ts'), unsupported)
    for (let index = 1; index < count; index++) await writeFile(join(input, `healthy${index}.ts`), `export const healthy${index}: number = ${index};`)
    await writeFile(join(output, 'nested/failed.d.ts'), 'retain previous failed declaration')
    await writeFile(join(output, 'runtime.js'), 'retain unrelated runtime')
    const result = invoke(['--project', input, '--outdir', output])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.toString()).toContain('DTSX_UNSUPPORTED_VALUE_FLOW')
    expect(await readFile(join(output, 'nested/failed.d.ts'), 'utf8')).toBe('retain previous failed declaration')
    expect(await readFile(join(output, 'runtime.js'), 'utf8')).toBe('retain unrelated runtime')
  }))
}

test('native project reports an unreadable nested source entry', () => directory(async (root) => {
  const input = join(root, 'src')
  const output = join(root, 'types')
  await mkdir(join(input, 'nested'), { recursive: true })
  // Windows junctions permit an owned dangling source entry without requiring
  // the file-symlink privilege. Both entries must reach the checked read.
  await symlink(join(root, 'missing-target'), join(input, 'nested/missing.ts'), process.platform === 'win32' ? 'junction' : 'file')
  const result = invoke(['--project', input, '--outdir', output])
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain('InputReadFailure')
  expect(existsSync(join(output, 'nested/missing.d.ts'))).toBe(false)
}))

test('native project reports nested destination conflicts', () => directory(async (root) => {
  const input = join(root, 'src')
  const output = join(root, 'types')
  await mkdir(join(input, 'nested'), { recursive: true })
  await mkdir(join(output, 'nested/index.d.ts'), { recursive: true })
  await writeFile(join(input, 'nested/index.ts'), 'export const value: number = 7;')
  const result = invoke(['--project', input, '--outdir', output])
  expect(result.exitCode).not.toBe(0)
  expect(result.stderr.toString()).toContain('OutputWriteFailure')
}))

test('normally packed native CLI generates nested declarations after normal and frozen installation', () => directory(async (root) => {
  expect(isAvailable).toBe(true)
  const library = join(root, 'library')
  const consumer = join(root, 'consumer')
  await mkdir(join(library, 'src/nested'), { recursive: true })
  await mkdir(join(library, 'bin'))
  await mkdir(consumer)
  await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'native-project-contract', version: '1.0.0', type: 'module', files: ['bin', 'dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }, bin: { 'native-project-contract': `./bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}` } }))
  await writeFile(join(library, 'src/index.ts'), "export { sum } from './nested/index.js'")
  await writeFile(join(library, 'src/nested/index.ts'), 'export function sum(first: number = 1, last: number): number { return first + last }')
  const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
  async function check(cwd: string, specifier: string): Promise<void> {
    await writeFile(join(cwd, 'control.ts'), `import { sum } from '${specifier}'; const value: number = sum(undefined, 2); void value`)
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
    let result = runTsc(cwd, ['--project', 'tsconfig.json'])
    expect(result.ok, result.output).toBe(true)
    await writeFile(join(cwd, 'control.ts'), `import { sum } from '${specifier}'; const invalid: string = sum(undefined, 2); void invalid`)
    result = runTsc(cwd, ['--project', 'tsconfig.json'])
    expect(result.ok, result.output).toBe(false)
    expect(result.output.match(/error TS\d+/g), result.output).toEqual(['error TS2322'])
  }
  await check(library, './src/index.js')
  const built = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun' })
  expect(built.success).toBe(true)
  const emitted = invoke(['--project', join(library, 'src'), '--outdir', join(library, 'dist')])
  expect(emitted.exitCode, emitted.stderr.toString()).toBe(0)
  const name = `zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`
  await copyFile(cli, join(library, 'bin', name))
  const archive = join(root, 'library.tgz')
  const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 })
  expect(packed.exitCode, packed.stderr.toString()).toBe(0)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'native-project-contract': `file:${archive}` }, scripts: { emit: 'native-project-contract' } }))
  await mkdir(join(consumer, 'independent/nested'), { recursive: true })
  await copyFile(join(library, 'src/nested/index.ts'), join(consumer, 'independent/nested/index.ts'))
  for (const flags of [[], ['--frozen-lockfile']]) {
    const installed = Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 })
    expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    const packageRoot = join(consumer, 'node_modules/native-project-contract')
    expect(Bun.SHA256.hash(await readFile(join(packageRoot, 'bin', name)), 'hex')).toBe(Bun.SHA256.hash(await readFile(cli), 'hex'))
    for (const file of ['index.d.ts', 'nested/index.d.ts']) expect(await readFile(join(packageRoot, 'dist', file), 'utf8')).toBe(await readFile(join(library, 'dist', file), 'utf8'))
    await check(consumer, 'native-project-contract')
    const output = join(consumer, flags.length ? 'emitted-frozen' : 'emitted-normal')
    const command = Bun.spawnSync([process.execPath, 'run', 'emit', '--project', join(consumer, 'independent'), '--outdir', output], { cwd: consumer, timeout: 4000 })
    expect(command.exitCode, command.stderr.toString()).toBe(0)
    expect(await readFile(join(output, 'nested/index.d.ts'), 'utf8')).toBe(await readFile(join(library, 'dist/nested/index.d.ts'), 'utf8'))
    const sourceFile = join(consumer, 'independent/nested/index.ts')
    const source = await readFile(sourceFile, 'utf8')
    const outputFile = join(consumer, 'batch-output/nested/index.d.ts')
    const context = { version: 1, moduleSpecifierMode: 'node', sourceFile, outputFile, sourceHash: Bun.SHA256.hash(source, 'hex'), rewrites: [] }
    const batch = Bun.spawnSync([process.execPath, 'run', 'emit', '--batch'], { cwd: consumer, stdin: new TextEncoder().encode(JSON.stringify({ protocol: 'zig-dtsx-project', version: 1, files: [{ source, context }] })), timeout: 4000 })
    expect(batch.exitCode, batch.stderr.toString()).toBe(0)
    const response = JSON.parse(batch.stdout.toString())
    expect(response.protocol).toBe('zig-dtsx-project')
    expect(response.version).toBe(1)
    expect(response.files).toHaveLength(1)
    expect(response.files[0]).toMatchObject({ sourceFile, outputFile, sourceHash: context.sourceHash })
    // Legacy file publication adds exactly one newline to the emitter's bytes.
    expect(`${response.files[0].content}\n`).toBe(await readFile(join(library, 'dist/nested/index.d.ts'), 'utf8'))
    expect(existsSync(outputFile)).toBe(false)
  }
}), 15000)
