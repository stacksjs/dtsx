import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from '../../bun-plugin/src'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'bun-plugin-dtsx-'))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('bun-plugin-dtsx', () => {
  it('keeps default clean behavior and emits root entry declarations for src roots', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await mkdir(outDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export const value = 'ok'\n`)
    await writeFile(join(outDir, 'stale.d.ts'), `export interface Stale {}\n`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [
        dts({
          cwd: tempDir,
          root: './src',
          outdir: './dist',
        }),
      ],
    })

    expect(result.success).toBe(true)

    const declaration = await readFile(join(outDir, 'index.d.ts'), 'utf8')
    expect(declaration).toContain(`export declare const value: 'ok';`)
    await expect(readFile(join(outDir, 'stale.d.ts'), 'utf8')).rejects.toThrow()
  })
})
