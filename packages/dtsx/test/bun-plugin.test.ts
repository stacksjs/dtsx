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

  it('mirrors Bun\'s common-ancestor output layout when no root is given', async () => {
    // With entrypoints in src/ AND bin/, Bun roots JS outputs at the package
    // dir (dist/src/index.js, dist/bin/cli.js). Declarations must land at the
    // matching paths or the package.json `types` fields point at nothing.
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const binDir = join(tempDir, 'bin')
    const outDir = join(tempDir, 'dist')

    await mkdir(join(srcDir, 'cloud'), { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export const value = 'ok'\n`)
    await writeFile(join(srcDir, 'cloud', 'index.ts'), `export const cloud = true\n`)
    await writeFile(join(binDir, 'cli.ts'), `export const cli = 1\n`)

    const result = await Bun.build({
      entrypoints: [
        join(srcDir, 'index.ts'),
        join(srcDir, 'cloud', 'index.ts'),
        join(binDir, 'cli.ts'),
      ],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [
        dts({ cwd: tempDir, outdir: './dist' }),
      ],
    })

    expect(result.success).toBe(true)

    // JS lands at dist/src/... and dist/bin/... — declarations must too.
    expect(await readFile(join(outDir, 'src', 'index.js'), 'utf8')).toContain('ok')
    expect(await readFile(join(outDir, 'src', 'index.d.ts'), 'utf8')).toContain(`export declare const value: 'ok';`)
    expect(await readFile(join(outDir, 'src', 'cloud', 'index.d.ts'), 'utf8')).toContain('cloud')
    await expect(readFile(join(outDir, 'index.d.ts'), 'utf8')).rejects.toThrow()
  })

  it('skips entrypoints outside an explicit root instead of mangling them', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const binDir = join(tempDir, 'bin')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export const value = 'ok'\n`)
    await writeFile(join(binDir, 'cli.ts'), `export const cli = 1\n`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts'), join(binDir, 'cli.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [
        dts({ cwd: tempDir, root: './src', outdir: './dist' }),
      ],
    })

    expect(result.success).toBe(true)
    // src entrypoint emitted relative to the explicit root...
    expect(await readFile(join(outDir, 'index.d.ts'), 'utf8')).toContain(`export declare const value: 'ok';`)
    // ...and the out-of-root bin entrypoint is skipped, not emitted as cli.d.ts.
    await expect(readFile(join(outDir, 'cli.d.ts'), 'utf8')).rejects.toThrow()
  })

  it('emits complete as-const object types containing arrow functions', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `
export const keyPatterns = {
  account: {
    primary: (accountId: string): string => \`ACCOUNT#\${accountId}\`,
    secondary: (createdAt: Date, accountId: string): string =>
      \`CREATED#\${createdAt.toISOString()}#\${accountId}\`,
  },
  event: {
    primary: (eventId: string): string => \`EVENT#\${eventId}\`,
  },
} as const
`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir, root: './src', outdir: './dist' })],
    })

    expect(result.success).toBe(true)

    const declaration = await readFile(join(outDir, 'index.d.ts'), 'utf8')
    expect(declaration).toContain('primary: (accountId: string) => string')
    expect(declaration).toContain('secondary: (createdAt: Date, accountId: string) => string')
    expect(declaration).toContain('primary: (eventId: string) => string')
    expect(declaration).not.toContain(')) =>')
  })

  it('retains external type imports used by default-exported constants', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `
import type { FrameworkModule } from '@example/framework'

const frameworkModule: FrameworkModule<{ enabled?: boolean }> = {
  enabled: true,
}

export default frameworkModule
`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      external: ['@example/framework'],
      plugins: [dts({ cwd: tempDir, root: './src', outdir: './dist' })],
    })

    expect(result.success).toBe(true)

    const declaration = await readFile(join(outDir, 'index.d.ts'), 'utf8')
    expect(declaration).toContain(`import type { FrameworkModule } from '@example/framework';`)
    expect(declaration).toContain('declare const frameworkModule: FrameworkModule<{ enabled?: boolean }>')
    expect(declaration).toContain('export default frameworkModule;')
  })
})
