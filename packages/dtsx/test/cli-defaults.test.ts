import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { nativeEngineAvailable } from '../src/native-engine'

const CLI_PATH = resolve(import.meta.dir, '../bin/cli.ts')
const projects: string[] = []

/** Runs `dtsx <args>` in a fresh project holding `src/index.ts`, and returns the declaration. */
function generate(source: string, args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dtsx-cli-defaults-'))
  projects.push(dir)
  mkdirSync(join(dir, 'src'))
  writeFileSync(join(dir, 'src', 'index.ts'), source)
  const run = Bun.spawnSync([process.execPath, CLI_PATH, ...args], { cwd: dir })
  expect(run.exitCode).toBe(0)
  return readFileSync(join(dir, 'dist', 'index.d.ts'), 'utf8')
}

afterEach(() => {
  for (const dir of projects.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('dtsx generate defaults', () => {
  // The argument parser leaves an untouched list option as its raw default
  // string, so `dtsx generate` alone once passed importOrder 'bun' and skipped
  // the native engine, which only implements the import order ['bun'].
  test.skipIf(!nativeEngineAvailable())('with no flags it emits with the native engine', () => {
    const awaited = 'export const value = await Promise.resolve(1)\n'
    expect(generate(awaited, ['generate'])).toContain('export declare const value: number;')
    expect(generate(awaited, ['generate', '--stats'])).toContain('export declare const value: number;')
  })

  test('--import-order takes comma-separated patterns', () => {
    const source = [
      `import type { BunFile } from 'bun'`,
      `import type { Stats } from 'node:fs'`,
      'export function read(file: BunFile, stats: Stats): void {}',
      '',
    ].join('\n')
    const output = generate(source, ['generate', '--import-order', 'node:,bun'])
    expect(output.indexOf(`from 'node:fs'`)).toBeGreaterThanOrEqual(0)
    expect(output.indexOf(`from 'node:fs'`)).toBeLessThan(output.indexOf(`from 'bun'`))
  })
})
