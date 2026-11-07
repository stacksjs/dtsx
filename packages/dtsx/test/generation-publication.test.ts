import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { generate } from '../src/generator'

// Public generate + real filesystem. The original loop replaced the first file
// before a later destination conflict. No helper or emitter is replaced.
interface EntrySnapshot {
  kind: 'directory' | 'file' | 'symlink'
  mode: number
  bytes?: string
  target?: string
}

async function snapshot(directory: string): Promise<Record<string, EntrySnapshot>> {
  const entries: Record<string, EntrySnapshot> = {}
  async function walk(path: string, prefix: string): Promise<void> {
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name)
      const key = prefix ? `${prefix}/${name}` : name
      const stat = await lstat(child)
      const mode = stat.mode & 0o777
      if (stat.isDirectory()) {
        entries[key] = { kind: 'directory', mode }
        await walk(child, key)
      }
      else if (stat.isSymbolicLink()) entries[key] = { kind: 'symlink', mode, target: await readlink(child) }
      else if (stat.isFile()) entries[key] = { kind: 'file', mode, bytes: (await readFile(child)).toString('hex') }
      else throw new Error(`Unexpected fixture entry: ${child}`)
    }
  }
  await walk(directory, '')
  return entries
}

const retained = new Map<string, string | Uint8Array>([
  ['runtime.js', 'export const runtime = 7;\n'],
  ['runtime.js.map', '{"version":3,"sources":["runtime.ts"]}\n'],
  ['assets/texture.bin', new Uint8Array([0, 255, 13, 10, 128, 42])],
  ['assets/manifest.json', '{"keep":true}\n'],
  ['notes.d.ts.backup', 'This is an unrelated asset, not a declaration.\n'],
])

const stale = new Map([
  ['old.d.ts', 'export interface Previous { keep: string }\r\n'],
  ['nested/old.d.mts', 'export declare const previousEsm: unique symbol;\r\n'],
  ['nested/old.d.cts', 'export declare const previousCjs: unique symbol;\n'],
  ['old.d.ts.map', '{"version":3,"sources":["old.ts"]}\n'],
  ['nested/old.d.mts.map', '{"version":3,"sources":["old.mts"]}\n'],
  ['nested/old.d.cts.map', '{"version":3,"sources":["old.cts"]}\n'],
])

async function put(directory: string, path: string, content: string | Uint8Array): Promise<void> {
  const parts = path.split('/')
  await mkdir(join(directory, ...parts.slice(0, -1)), { recursive: true })
  await writeFile(join(directory, ...parts), content)
}

async function fixture(check: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-publication-'))
  try {
    await mkdir(join(cwd, 'src'))
    await mkdir(join(cwd, 'dist'))
    // Explicitly annotated ordinary modules are strict-valid without ambient
    // packages, aliases, declaration generation by tsc, or inference tricks.
    await writeFile(join(cwd, 'src/a-current.ts'), 'export const current: number = 1;\n')
    await writeFile(join(cwd, 'dist/a-current.d.ts'), 'export declare const previousCurrent: string;\r\n')
    for (const [path, content] of [...retained, ...stale]) await put(join(cwd, 'dist'), path, content)
    if (process.platform !== 'win32') {
      await chmod(join(cwd, 'dist/a-current.d.ts'), 0o600)
      await chmod(join(cwd, 'dist/nested/old.d.mts'), 0o440)
      await chmod(join(cwd, 'dist/runtime.js'), 0o750)
    }
    await put(cwd, '.dtsx-cache/other-tool/sentinel.txt', 'preserve another tool\n')
    await writeFile(join(cwd, 'package.json'), '{"name":"publication-fixture","private":true,"type":"module"}\n')
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, include: ['src/**/*.ts'] }))
    await check(cwd)
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
}

function options(cwd: string, clean: boolean) {
  return {
    cwd, root: './src', outdir: './dist', entrypoints: ['**/*.ts'],
    outputStructure: 'mirror' as const, moduleSpecifierMode: 'node' as const,
    clean, keepComments: false, isolatedDeclarations: false,
    parallel: false, incremental: false, continueOnError: false,
    declarationMap: false, bundle: false, logLevel: 'silent' as const,
  }
}

for (const clean of [false, true]) {
  for (const conflict of ['destination-directory', 'regular-file-parent'] as const) {
    test(`generate preserves prior artifacts after a late ${conflict} conflict (clean=${clean})`, () => fixture(async (cwd) => {
      if (conflict === 'destination-directory') {
        await writeFile(join(cwd, 'src/z-conflict.ts'), 'export const later: string = "valid source";\n')
        await put(join(cwd, 'dist'), 'z-conflict.d.ts/occupied.txt', 'retain this directory and asset\n')
      }
      else {
        await put(join(cwd, 'src'), 'z-parent/late.ts', 'export const later: string = "valid source";\n')
        await writeFile(join(cwd, 'dist/z-parent'), 'retain this regular file; it cannot become a directory\n')
      }
      // Canonical source selection sorts a-current before the z-* source. The
      // current loop encounters this real conflict after its first final write.
      // A future preflight may detect it earlier, which also satisfies the test.
      const before = await snapshot(cwd)
      let failure: unknown
      try { await generate(options(cwd, clean)) }
      catch (error) { failure = error }
      expect(failure).toBeInstanceOf(Error)
      expect(await snapshot(cwd)).toEqual(before)
    }))
  }

  test(`generate successful publication honors declaration-only cleaning (clean=${clean})`, () => fixture(async (cwd) => {
    await writeFile(join(cwd, 'src/z-healthy.ts'), 'export function later(value: number): number { return value; }\n')
    await writeFile(join(cwd, 'dist/z-healthy.d.ts'), 'export declare const previousLater: string;\n')
    const before = await snapshot(cwd)
    const stats = await generate({ ...options(cwd, clean), lineEnding: 'crlf' })
    expect(stats.filesProcessed).toBe(2)
    expect(stats.filesGenerated).toBe(2)
    expect(stats.filesFailed).toBe(0)
    const first = await readFile(join(cwd, 'dist/a-current.d.ts'), 'utf8')
    const later = await readFile(join(cwd, 'dist/z-healthy.d.ts'), 'utf8')
    expect(first).toContain('export declare const current: number;')
    expect(later).toContain('later(value: number): number;')
    for (const content of [first, later]) {
      expect(content.endsWith('\r\n')).toBe(true)
      expect(content.replace(/\r\n/g, '')).not.toContain('\n')
    }
    const after = await snapshot(cwd)
    if (!clean) expect(after['dist/a-current.d.ts']!.mode).toBe(before['dist/a-current.d.ts']!.mode)
    for (const path of retained.keys()) expect(after[`dist/${path}`]).toEqual(before[`dist/${path}`])
    for (const path of stale.keys()) {
      if (clean) expect(after[`dist/${path}`]).toBeUndefined()
      else expect(after[`dist/${path}`]).toEqual(before[`dist/${path}`])
    }
    expect(after['.dtsx-cache/other-tool/sentinel.txt']).toEqual(before['.dtsx-cache/other-tool/sentinel.txt'])
    expect(after['src/a-current.ts']).toEqual(before['src/a-current.ts'])
    expect(after['src/z-healthy.ts']).toEqual(before['src/z-healthy.ts'])
  }))
}

for (const clean of [false, true]) {
  for (const mode of ['stage', 'short-write', 'backup', 'install', 'rollback', 'finalize'] as const) {
    test(`generate handles an injected ${mode} filesystem failure without losing recovery data (clean=${clean})`, () => fixture(async (cwd) => {
      await writeFile(join(cwd, 'src/z-healthy.ts'), 'export const later: number = 2;\n')
      await writeFile(join(cwd, 'dist/z-healthy.d.ts'), 'export declare const previousLater: string;\r\n')
      const before = await snapshot(cwd)
      const child = Bun.spawn([
        process.execPath, '--no-env-file', join(import.meta.dir, 'helpers/publication-fault.ts'),
        mode, JSON.stringify(options(cwd, clean)),
      ], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 4000 })
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ])
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      const result = JSON.parse(stdout.trim())
      expect(result.failed).toBe(true)
      expect(result.injected).toBe(mode === 'rollback' ? 2 : 1)
      const after = await snapshot(cwd)
      if (mode === 'stage' || mode === 'short-write' || mode === 'backup' || mode === 'install') {
        expect(after).toEqual(before)
        if (mode === 'short-write') expect(result.message).toContain('Incomplete declaration write:')
        else expect(result.message).toContain(`Injected publication ${mode} failure`)
        if (mode === 'stage' || mode === 'short-write') {
          expect(result.stageWrites).toBe(2)
          expect(result.backupMoves).toBe(0)
          expect(result.installs).toBe(0)
        }
        else expect(result.restores).toBe(mode === 'backup' ? 1 : result.backupMoves)
        return
      }
      expect(result.code).toBe('DTSX_PUBLICATION_FAILED')
      expect(result.phase).toBe(mode)
      expect(result.outputsCommitted).toBe(mode === 'finalize')
      expect(result.recoveryDirectory).toBe(join(cwd, 'dist/.dtsx-publication'))
      expect(result.retryMessage).toContain('active or requires recovery')
      const manifest = JSON.parse(await readFile(join(result.recoveryDirectory, 'manifest.json'), 'utf8'))
      for (const target of manifest.targets) {
        const previous = before[`dist/${target.path}`]
        if (mode === 'finalize' || target.path === 'a-current.d.ts') {
          expect(after[`dist/.dtsx-publication/${target.backup}`]).toEqual(previous)
        }
      }
      if (mode === 'rollback') {
        expect(after['dist/a-current.d.ts']).toBeUndefined()
        expect(after['dist/z-healthy.d.ts']).toEqual(before['dist/z-healthy.d.ts'])
      }
      else {
        expect(await readFile(join(cwd, 'dist/a-current.d.ts'), 'utf8')).toContain('current: number')
        expect(await readFile(join(cwd, 'dist/z-healthy.d.ts'), 'utf8')).toContain('later: number')
      }
      for (const path of retained.keys()) expect(after[`dist/${path}`]).toEqual(before[`dist/${path}`])
      for (const path of stale.keys()) {
        if (clean && mode === 'finalize') expect(after[`dist/${path}`]).toBeUndefined()
        else expect(after[`dist/${path}`]).toEqual(before[`dist/${path}`])
      }
    }))
  }
}
