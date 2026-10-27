/**
 * An entrypoint pattern reaching above the root wrote its declarations outside
 * outdir:
 *
 *   generate({ root: 'src', outdir: 'dist', entrypoints: ['../*.ts'] })
 *
 * wrote `outside.d.ts` next to `outside.ts`, and `../outside.ts` did the same.
 * An absolute path outside the root was already skipped with a warning; a
 * glob or relative pattern now is too.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** A project with `src/inside.ts` and `outside.ts` next to `src`. */
async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-outside-root-'))
  tempDirectories.push(cwd)
  await mkdir(join(cwd, 'src'))
  await writeFile(join(cwd, 'src', 'inside.ts'), 'export const inside = 1\n')
  await writeFile(join(cwd, 'outside.ts'), 'export const outside = 2\n')
  return cwd
}

describe('entrypoints outside the root', () => {
  it.each([
    ['glob', ['../*.ts']],
    ['relative path', ['../outside.ts']],
  ])('are not written outside outdir: %s', async (_label, entrypoints) => {
    const cwd = await project()
    await expect(generate({ cwd, root: 'src', outdir: 'dist', entrypoints, clean: false })).rejects.toThrow('No source files matched')
    expect(existsSync(join(cwd, 'outside.d.ts'))).toBe(false)
    expect(existsSync(join(cwd, 'dist', 'outside.d.ts'))).toBe(false)
  })

  it('are skipped beside an entrypoint inside the root', async () => {
    const cwd = await project()
    await generate({ cwd, root: 'src', outdir: 'dist', entrypoints: ['*.ts', '../*.ts'], clean: false })
    expect(existsSync(join(cwd, 'outside.d.ts'))).toBe(false)
    expect(existsSync(join(cwd, 'dist', 'outside.d.ts'))).toBe(false)
    expect(existsSync(join(cwd, 'dist', 'inside.d.ts'))).toBe(true)
  })

  it('are written into outdir with a flat output structure', async () => {
    const cwd = await project()
    await generate({ cwd, root: 'src', outdir: 'dist', entrypoints: ['../*.ts'], outputStructure: 'flat', clean: false })
    expect(existsSync(join(cwd, 'outside.d.ts'))).toBe(false)
    expect(existsSync(join(cwd, 'dist', 'outside.d.ts'))).toBe(true)
  })

  it('still fail when an exclude leaves nothing', async () => {
    const cwd = await project()
    await expect(generate({ cwd, root: 'src', outdir: 'dist', entrypoints: ['../*.ts'], exclude: ['../*.ts'], outputStructure: 'flat', clean: false })).rejects.toThrow('No source files matched')
  })
})
