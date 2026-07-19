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
  it('preserves side-effect-only entrypoints as modules', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'server.ts'), `
import type { ServerOptions } from 'bun'
import { serve } from 'bun'

const options: ServerOptions = { port: 3000 }
serve(options)
`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'server.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir, root: './src', outdir: './dist' })],
    })

    expect(result.success).toBe(true)
    expect(await readFile(join(outDir, 'server.d.ts'), 'utf8')).toBe('export {};\n')
  })

  it('emits recursively reachable barrel declarations for issue 3090', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(join(srcDir, 'middleware'), { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), [
      `export * from './router'`,
      `export * from './middleware'`,
      `export type { RouteConfig } from './types'`,
    ].join('\n'))
    await writeFile(join(srcDir, 'cli.ts'), `export const cli: string = 'ready'`)
    await writeFile(join(srcDir, 'router.ts'), `import type { RouteConfig } from './types'; export class Router { register(_: RouteConfig): void {} }`)
    await writeFile(join(srcDir, 'types.ts'), `export interface RouteConfig { path: string }`)
    await writeFile(join(srcDir, 'middleware', 'index.ts'), `export interface Middleware { handle(): void }`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts'), join(srcDir, 'cli.ts')],
      outdir: outDir,
      splitting: true,
      target: 'bun',
      format: 'esm',
      plugins: [dts({
        cwd: tempDir,
        root: './src',
        outdir: './dist',
        entrypoints: ['index.ts', 'cli.ts'],
      })],
    })

    expect(result.success).toBe(true)
    expect(await readFile(join(outDir, 'index.d.ts'), 'utf8')).toContain(`export * from './router'`)
    expect(await readFile(join(outDir, 'router.d.ts'), 'utf8')).toContain('class Router')
    expect(await readFile(join(outDir, 'types.d.ts'), 'utf8')).toContain('interface RouteConfig')
    expect(await readFile(join(outDir, 'middleware', 'index.d.ts'), 'utf8')).toContain('interface Middleware')
  })

  it('bundles recursively reachable barrel declarations for issue 3090', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export * from './router'; export * from './types';`)
    await writeFile(join(srcDir, 'router.ts'), `import type { RouteConfig } from './types'; export class Router { register(_: RouteConfig): void {} }`)
    await writeFile(join(srcDir, 'types.ts'), `export interface RouteConfig { path: string }`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts')],
      outdir: outDir,
      target: 'bun',
      format: 'esm',
      plugins: [dts({
        cwd: tempDir,
        root: './src',
        outdir: './dist',
        entrypoints: ['index.ts'],
        bundle: true,
      })],
    })

    expect(result.success).toBe(true)
    const declaration = await readFile(join(outDir, 'index.d.ts'), 'utf8')
    expect(declaration).toContain('class Router')
    expect(declaration).toContain('interface RouteConfig')
    expect(declaration).not.toContain(`from './router'`)
    expect(declaration).not.toContain(`from './types'`)
  })

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

  it('preserves inline object return types in exported function maps', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `
export const api = {
  async login(credentials: { email: string }): Promise<{ user: Record<string, unknown>, token: string }> {
    return { user: {}, token: credentials.email }
  },
  relation: (id: string): { parent: string, child: string } => ({ parent: id, child: id }),
}
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
    expect(declaration).toContain('login: (credentials: { email: string }) => Promise<{ user: Record<string, unknown>, token: string }>')
    expect(declaration).toContain('relation: (id: string) => { parent: string, child: string }')
    expect(declaration).not.toContain('Promise<;')
    expect(declaration).not.toContain('=> ;')
  })
})

describe('bun-plugin-dtsx', () => {
  it('mirrors Bun output paths and completes declarations before build returns', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const binDir = join(tempDir, 'bin')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export const value = 'ok' as const\n`)
    await writeFile(join(binDir, 'cli.ts'), `export const cli = true as const\n`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts'), join(binDir, 'cli.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir })],
    })

    expect(result.success).toBe(true)
    expect(await readFile(join(outDir, 'src', 'index.d.ts'), 'utf8')).toContain(`export declare const value: 'ok';`)
    expect(await readFile(join(outDir, 'bin', 'cli.d.ts'), 'utf8')).toContain('export declare const cli: true;')
  })

  it('emits declarations for every sequential Bun.build call in one process', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await writeFile(join(srcDir, 'alpha.ts'), `export const alpha: number = 1\n`)
    await writeFile(join(srcDir, 'beta.ts'), `export const beta: string = 'b'\n`)

    const first = await Bun.build({
      entrypoints: [join(srcDir, 'alpha.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir })],
    })
    const second = await Bun.build({
      entrypoints: [join(srcDir, 'beta.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir })],
    })

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    // Both builds must emit — and the second build must not wipe the first
    // build's declarations from the shared outdir.
    expect(await readFile(join(outDir, 'alpha.d.ts'), 'utf8')).toContain('export declare const alpha: number;')
    expect(await readFile(join(outDir, 'beta.d.ts'), 'utf8')).toContain(`export declare const beta: string;`)
  })

  it('still cleans stale declarations on the first build of an outdir', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(srcDir, { recursive: true })
    await mkdir(outDir, { recursive: true })
    await writeFile(join(srcDir, 'fresh.ts'), `export const fresh = true\n`)
    await writeFile(join(outDir, 'stale.d.ts'), `export interface Stale {}\n`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'fresh.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir })],
    })

    expect(result.success).toBe(true)
    expect(await readFile(join(outDir, 'fresh.d.ts'), 'utf8')).toContain('export declare const fresh: true;')
    await expect(readFile(join(outDir, 'stale.d.ts'), 'utf8')).rejects.toThrow()
  })

  it('roots per-module outdirs at the entrypoint parent without doubled segments', async () => {
    // Sequential single-entry builds into dist/<mod>/ (the layout that
    // produced dist/token/token/index.d.ts with root ./src).
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')

    await mkdir(join(srcDir, 'token'), { recursive: true })
    await mkdir(join(srcDir, 'nft'), { recursive: true })
    await writeFile(join(srcDir, 'token', 'index.ts'), `export const tokenName: string = 'token'\n`)
    await writeFile(join(srcDir, 'nft', 'index.ts'), `export interface Nft { id: number }\n`)

    for (const mod of ['token', 'nft']) {
      const result = await Bun.build({
        entrypoints: [join(srcDir, mod, 'index.ts')],
        outdir: join(tempDir, 'dist', mod),
        format: 'esm',
        target: 'bun',
        plugins: [dts({ cwd: tempDir })],
      })
      expect(result.success).toBe(true)
    }

    expect(await readFile(join(tempDir, 'dist', 'token', 'index.d.ts'), 'utf8')).toContain('tokenName')
    expect(await readFile(join(tempDir, 'dist', 'nft', 'index.d.ts'), 'utf8')).toContain('interface Nft')
    // No doubled mirror of the module directory.
    await expect(readFile(join(tempDir, 'dist', 'token', 'token', 'index.d.ts'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(tempDir, 'dist', 'nft', 'nft', 'index.d.ts'), 'utf8')).rejects.toThrow()
  })

  it('mirrors nested entry directories without doubled segments', async () => {
    const tempDir = await createTempDir()
    const srcDir = join(tempDir, 'src')
    const outDir = join(tempDir, 'dist')

    await mkdir(join(srcDir, 'deep', 'nested'), { recursive: true })
    await writeFile(join(srcDir, 'index.ts'), `export const root = 1\n`)
    await writeFile(join(srcDir, 'deep', 'nested', 'mod.ts'), `export const mod = 2\n`)

    const result = await Bun.build({
      entrypoints: [join(srcDir, 'index.ts'), join(srcDir, 'deep', 'nested', 'mod.ts')],
      outdir: outDir,
      format: 'esm',
      target: 'bun',
      plugins: [dts({ cwd: tempDir })],
    })

    expect(result.success).toBe(true)
    expect(await readFile(join(outDir, 'index.d.ts'), 'utf8')).toContain('export declare const root: 1;')
    expect(await readFile(join(outDir, 'deep', 'nested', 'mod.d.ts'), 'utf8')).toContain('export declare const mod: 2;')
    await expect(readFile(join(outDir, 'deep', 'nested', 'deep', 'nested', 'mod.d.ts'), 'utf8')).rejects.toThrow()
  })
})
