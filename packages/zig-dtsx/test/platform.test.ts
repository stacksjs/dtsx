import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { processBatch, processSource, ZIG_AVAILABLE } from '../src/index'

// The CLI and the batch library reach threads and the file system through
// src/platform.zig, which calls libc directly on Darwin.
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)
const library = resolve(import.meta.dir, '../zig-out/lib/libzig-dtsx.dylib')
const posix = process.platform !== 'win32'

async function directory(check: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'zig-dtsx-platform-'))
  try { await check(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

function invoke(args: string[], cwd?: string) {
  expect(existsSync(cli), `Build the real native CLI: ${cli}`).toBe(true)
  const result = Bun.spawnSync([cli, ...args], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout: 10_000 })
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
}

const testIfNative = ZIG_AVAILABLE ? test : test.skip

testIfNative.each([0, 1, 2, 7, 64])('a batch on %i threads returns every result in order', (threads) => {
  const sources = Array.from({ length: 203 }, (_, index) => `export const value${index} = { id: ${index}, tags: ['a', 'b'], nested: { on: ${index % 2 === 0} } }`)
  const results = processBatch(sources, true, threads)
  expect(results).toHaveLength(sources.length)
  for (const index of [0, 1, 50, 101, 202])
    expect(results[index].trim()).toBe(processSource(sources[index], true).trim())
  expect(results.every((result, index) => result.includes(`value${index}:`))).toBe(true)
})

// Workers get the same 16 MiB stack the standard library gave them; libc's
// default for a secondary thread is 512 KiB.
testIfNative('worker threads have room for deeply nested expressions', () => {
  const depth = 400
  const nested = `export const deep = ${'['.repeat(depth)}1${']'.repeat(depth)}\nexport const wrapped = ${'('.repeat(depth)}1${')'.repeat(depth)}`
  const sources = Array.from({ length: 32 }, () => nested)
  const results = processBatch(sources, true, 8)
  expect(results).toHaveLength(32)
  expect(new Set(results).size).toBe(1)
  expect(results[0]).toBe(processBatch([nested], true, 1)[0])
  expect(results[0]).toContain('export declare const deep')
})

test('the project output directory is created through missing parents', () => directory(async (root) => {
  await mkdir(join(root, 'src/a/b'), { recursive: true })
  await writeFile(join(root, 'src/top.ts'), 'export const top: number = 1\n')
  await writeFile(join(root, 'src/a/b/deep.ts'), 'export const deep: number = 2\n')
  for (const out of ['one/two/three', 'slash/at/end/', 'double//slash', 'existing']) {
    if (out === 'existing') await mkdir(join(root, out))
    const result = invoke(['--project', 'src', '--outdir', out], root)
    expect(result.exitCode, `${out}: ${result.stderr}`).toBe(0)
    expect(await readFile(join(root, out, 'top.d.ts'), 'utf8')).toBe('export declare const top: number;\n')
    expect(await readFile(join(root, out, 'a/b/deep.d.ts'), 'utf8')).toBe('export declare const deep: number;\n')
  }
}))

test.skipIf(!posix)('an output path through a file is reported, not written around', () => directory(async (root) => {
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src/top.ts'), 'export const top: number = 1\n')
  await writeFile(join(root, 'blocker'), 'a file, not a directory')
  const result = invoke(['--project', 'src', '--outdir', 'blocker/types'], root)
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toMatch(/^error: \w+\n$/)
  expect(await readFile(join(root, 'blocker'), 'utf8')).toBe('a file, not a directory')
}))

test('failures print one error line and exit with status 1', () => directory(async (root) => {
  const missingProject = invoke(['--project', 'nowhere', '--outdir', 'out'], root)
  expect(missingProject.exitCode).toBe(1)
  expect(missingProject.stderr).toBe('error: DirNotFound\n')
  const unknownFlag = invoke(['--no-such-flag'], root)
  expect(unknownFlag.exitCode).toBe(1)
  expect(unknownFlag.stderr).toBe('error: InvalidArguments\n')
  const missingFile = invoke(['nowhere.ts'], root)
  expect(missingFile.exitCode).toBe(1)
  expect(missingFile.stderr).toBe('error: InputReadFailure\n')
}))

test.skipIf(!posix)('discovery follows no directory link and skips dependency and cache folders', () => directory(async (root) => {
  await mkdir(join(root, 'src/real/inner'), { recursive: true })
  await mkdir(join(root, 'src/node_modules/pkg'), { recursive: true })
  await mkdir(join(root, 'src/.git'), { recursive: true })
  await mkdir(join(root, 'src/.dtsx-cache'), { recursive: true })
  await mkdir(join(root, 'elsewhere'))
  await writeFile(join(root, 'src/real/inner/kept.ts'), 'export const kept: number = 1\n')
  await writeFile(join(root, 'src/real/types.d.ts'), 'export declare const authored: number\n')
  await writeFile(join(root, 'src/real/notes.txt'), 'not a source\n')
  await writeFile(join(root, 'src/node_modules/pkg/index.ts'), 'export const dependency: number = 1\n')
  await writeFile(join(root, 'src/.git/hook.ts'), 'export const hook: number = 1\n')
  await writeFile(join(root, 'src/.dtsx-cache/cached.ts'), 'export const cached: number = 1\n')
  await writeFile(join(root, 'elsewhere/outside.ts'), 'export const outside: number = 1\n')
  await symlink(join(root, 'elsewhere'), join(root, 'src/linked'), 'dir')
  await symlink(join(root, 'src/real'), join(root, 'src/real/inner/loop'), 'dir')
  await symlink(join(root, 'elsewhere/outside.ts'), join(root, 'src/real/alias.ts'), 'file')
  // A directory whose name ends in .ts, reached through a link, is not a source.
  await symlink(join(root, 'elsewhere'), join(root, 'src/real/folder.ts'), 'dir')

  const result = invoke(['--project', 'src', '--outdir', 'out'], root)
  expect(result.exitCode, result.stderr).toBe(0)
  const written = (await readdir(join(root, 'out'), { recursive: true }) as string[]).filter(name => name.endsWith('.d.ts')).sort()
  expect(written).toEqual(['real/alias.d.ts', 'real/inner/kept.d.ts'])
  expect(await readFile(join(root, 'out/real/alias.d.ts'), 'utf8')).toBe('export declare const outside: number;\n')
}))

// Every imported function is bound by dyld at launch, called or not, and the
// standard I/O layer alone imports about a hundred.
test.skipIf(process.platform !== 'darwin' || !existsSync('/usr/bin/nm'))('the Darwin binaries import only the libc functions they use', () => {
  const imports = (file: string): string[] => Bun.spawnSync(['/usr/bin/nm', '-u', file]).stdout.toString().split('\n').map(line => line.trim()).filter(Boolean)
  const cliImports = imports(cli)
  const libraryImports = imports(library)
  for (const networking of ['_socket', '_getaddrinfo', '_posix_spawn', '_connect']) {
    expect(cliImports).not.toContain(networking)
    expect(libraryImports).not.toContain(networking)
  }
  expect(cliImports.length).toBeLessThan(64)
  expect(libraryImports.length).toBeLessThan(32)
})
