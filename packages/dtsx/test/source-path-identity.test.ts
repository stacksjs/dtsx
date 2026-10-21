import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from 'bun-plugin-dtsx'
import { generate } from '../src/generator'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('source path identity', () => {
  for (const kind of ['directory', 'absolute alias'] as const) {
    it(`deduplicates glob matches reached through ${kind === 'directory' ? 'a directory' : 'an absolute alias'} barrel`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'dtsx-directory-identity-'))
      directories.push(cwd)
      const sourceDirectory = join(cwd, 'src')
      await mkdir(join(sourceDirectory, 'generate'), { recursive: true })
      const specifier = kind === 'directory' ? './generate' : `${sourceDirectory.replace(/\\/g, '/')}/../src/generate`
      await writeFile(join(sourceDirectory, 'index.ts'), `export { value } from ${JSON.stringify(specifier)};`)
      await writeFile(join(sourceDirectory, 'generate', 'index.ts'), 'export const value: number = 3;')

      const stats = await generate({
        cwd,
        root: 'src',
        outdir: 'dist',
        entrypoints: ['**/*.ts'],
        clean: true,
        keepComments: false,
        isolatedDeclarations: true,
      })

      expect(stats.filesProcessed).toBe(2)
      expect(stats.errors).toEqual([])
      expect(await readFile(join(cwd, 'dist', 'generate', 'index.d.ts'), 'utf8')).toContain('export declare const value: number;')
    })
  }

  it('builds explicit framework entrypoints with a directory re-export through the public Bun plugin', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-framework-entrypoints-'))
    directories.push(cwd)
    const sourceDirectory = join(cwd, 'src')
    const outdir = join(cwd, 'dist')
    await mkdir(join(sourceDirectory, 'generate'), { recursive: true })
    await writeFile(join(sourceDirectory, 'index.ts'), 'export { value } from "./generate";')
    await writeFile(join(sourceDirectory, 'generate', 'index.ts'), 'export const value: number = 3;')
    let processed = 0

    const result = await Bun.build({
      entrypoints: [join(sourceDirectory, 'index.ts'), join(sourceDirectory, 'generate', 'index.ts')],
      root: sourceDirectory,
      outdir,
      target: 'bun',
      format: 'esm',
      plugins: [dts({ cwd, root: sourceDirectory, outdir, onSuccess: stats => { processed = stats.filesProcessed } })],
    })

    expect(result.success).toBe(true)
    expect(processed).toBe(2)
    expect(await readFile(join(outdir, 'generate', 'index.d.ts'), 'utf8')).toContain('export declare const value: number;')
  })

  it('treats glob matches and reachable re-exports as the same source files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-source-reexports-'))
    directories.push(cwd)
    await mkdir(join(cwd, 'src', 'nested'), { recursive: true })
    await writeFile(join(cwd, 'src', 'index.ts'), 'export { value } from "./nested/value";')
    await writeFile(join(cwd, 'src', 'nested', 'value.ts'), 'export const value: number = 3;')

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['**/*.ts'],
      clean: true,
      keepComments: false,
      isolatedDeclarations: true,
    })

    expect(stats.filesProcessed).toBe(2)
    expect(stats.errors).toEqual([])
    expect(await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')).toContain('./nested/value')
    expect(await readFile(join(cwd, 'dist', 'nested', 'value.d.ts'), 'utf8')).toContain('export declare const value: number;')
  })

  it('deduplicates explicit path aliases and overlapping glob matches before checking outputs', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-source-identity-'))
    directories.push(cwd)
    const sourceDirectory = join(cwd, 'src')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'index.ts'), 'export const value: string = "settlement";')

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: [
        '**/*.ts',
        join(sourceDirectory, 'index.ts'),
        `${sourceDirectory}/../src/index.ts`,
        `${sourceDirectory}/index.ts`,
      ],
      include: ['index.ts'],
      clean: true,
      keepComments: false,
      isolatedDeclarations: true,
    })

    expect(stats.filesProcessed).toBe(1)
    expect(stats.errors).toEqual([])
    expect(await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')).toContain('export declare const value: string;')
  })

  it('still rejects distinct sources that collide in flat output before changing existing declarations', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-source-collision-'))
    directories.push(cwd)
    await mkdir(join(cwd, 'src', 'first'), { recursive: true })
    await mkdir(join(cwd, 'src', 'second'), { recursive: true })
    await mkdir(join(cwd, 'dist'))
    await writeFile(join(cwd, 'src', 'first', 'index.ts'), 'export const first: string = "first";')
    await writeFile(join(cwd, 'src', 'second', 'index.ts'), 'export const second: string = "second";')
    await writeFile(join(cwd, 'dist', 'index.d.ts'), 'original declaration')

    await expect(generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['**/*.ts'],
      outputStructure: 'flat',
      clean: true,
      keepComments: false,
      isolatedDeclarations: true,
    })).rejects.toThrow('Output path collision')

    expect(await readFile(join(cwd, 'dist', 'index.d.ts'), 'utf8')).toBe('original declaration')
  })

  it('emits nested sources directly in flat output on every platform', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dtsx-source-flat-'))
    directories.push(cwd)
    await mkdir(join(cwd, 'src', 'nested'), { recursive: true })
    await writeFile(join(cwd, 'src', 'nested', 'value.ts'), 'export const value: number = 3;')

    const stats = await generate({
      cwd,
      root: 'src',
      outdir: 'dist',
      entrypoints: ['**/*.ts'],
      outputStructure: 'flat',
      clean: true,
      keepComments: false,
      isolatedDeclarations: true,
    })

    expect(stats.filesProcessed).toBe(1)
    expect(await readFile(join(cwd, 'dist', 'value.d.ts'), 'utf8')).toContain('export declare const value: number;')
  })
})
