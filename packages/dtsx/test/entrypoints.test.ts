/**
 * Regression for entrypoints that were silently dropped.
 *
 * Several entrypoints could not be passed at all: repeating the flag kept one,
 * and the documented comma form was read as a single literal path that matched
 * no file. Either way the run exited 0 having written no declarations for the
 * entrypoints it dropped — a package could publish its `.js` with no `.d.ts`
 * beside it and the build stayed green.
 */

import { $ } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TEST_DIR = resolve(import.meta.dir, '../.test-entrypoints')
const CLI_PATH = resolve(import.meta.dir, '../bin/cli.ts')

async function runCli(args: string[]): Promise<{ stdout: string, stderr: string, exitCode: number }> {
  try {
    const result = await $`bun ${CLI_PATH} ${args}`.cwd(TEST_DIR).quiet()
    return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: result.exitCode }
  }
  catch (error: any) {
    return { stdout: error.stdout?.toString() || '', stderr: error.stderr?.toString() || '', exitCode: error.exitCode ?? 1 }
  }
}

beforeAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(join(TEST_DIR, 'src', 'mime'), { recursive: true })

  writeFileSync(join(TEST_DIR, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ESNext', module: 'ESNext', moduleResolution: 'bundler', strict: true, declaration: true },
  }, null, 2))

  writeFileSync(join(TEST_DIR, 'src', 'index.ts'), `export const version: string = '1.0'\n`)
  writeFileSync(join(TEST_DIR, 'src', 'mime', 'index.ts'), `export const mimeVersion: string = '1.0'\n`)
})

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

describe('CLI — multiple entrypoints', () => {
  it('honours the flag repeated once per entrypoint', async () => {
    const result = await runCli([
      'generate',
      '--root', 'src',
      '--entrypoints', 'index.ts',
      '--entrypoints', 'mime/index.ts',
      '--outdir', 'dist-repeat',
    ])

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(TEST_DIR, 'dist-repeat', 'index.d.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'dist-repeat', 'mime', 'index.d.ts'))).toBe(true)
  })

  it('honours the documented comma-separated form', async () => {
    const result = await runCli([
      'generate',
      '--root', 'src',
      '--entrypoints', 'index.ts,mime/index.ts',
      '--outdir', 'dist-comma',
    ])

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(TEST_DIR, 'dist-comma', 'index.d.ts'))).toBe(true)
    expect(existsSync(join(TEST_DIR, 'dist-comma', 'mime', 'index.d.ts'))).toBe(true)
  })

  it('fails loudly when an entrypoint matches nothing', async () => {
    const result = await runCli(['generate', '--root', 'src', '--entrypoints', 'does-not-exist.ts', '--outdir', 'dist-missing'])

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('No source files matched')
    expect(result.stderr).toContain('does-not-exist.ts')
    expect(existsSync(join(TEST_DIR, 'dist-missing'))).toBe(false)
  })

  it('fails loudly when only one of several entrypoints is missing', async () => {
    const result = await runCli(['generate', '--root', 'src', '--entrypoints', 'index.ts,nope.ts', '--outdir', 'dist-partial'])

    // This is the shape the bug wore in practice: one entrypoint resolves, the
    // other is a typo, and the run used to succeed having emitted nothing for it.
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Entrypoint not found')
    expect(result.stderr).toContain('nope.ts')
  })

  it('does not fail on a glob that legitimately matches nothing', async () => {
    const result = await runCli(['generate', '--root', 'src', '--entrypoints', '**/*.ts,**/*.vue', '--outdir', 'dist-glob'])

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(TEST_DIR, 'dist-glob', 'index.d.ts'))).toBe(true)
  })
})
