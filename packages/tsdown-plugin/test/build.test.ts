import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'tsdown'
import plugin, { dts } from '../src/index'

const projects: string[] = []

/** A throwaway tsdown project. It sits in this package so `@dtsx/dtsx` resolves. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(import.meta.dir, '.tsdown-project-'))
  projects.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

afterEach(() => {
  for (const dir of projects.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('tsdown build with @dtsx/tsdown', () => {
  test('the default export is the dts plugin', () => {
    expect(plugin).toBe(dts)
    expect(dts().name).toBe('dtsx')
    expect(dts().tsdownConfig()).toEqual({ dts: false })
  })

  test('writes narrow declarations beside each entry chunk', async () => {
    const dir = project({
      'src/index.ts': [
        `export { double } from './utils'`,
        `export const config = { port: 3000, host: 'localhost', retries: [1, 2, 4] }`,
        '',
      ].join('\n'),
      'src/utils.ts': 'export function double(value: number): number { return value * 2 }\n',
    })
    await build({ config: false, cwd: dir, entry: ['src/index.ts'], outDir: 'dist', format: ['esm'], plugins: [dts()], logLevel: 'silent', report: false })

    const files = readdirSync(join(dir, 'dist')).sort()
    expect(files).toContain('index.mjs')
    expect(files).toContain('index.d.mts')
    const declarations = readFileSync(join(dir, 'dist', 'index.d.mts'), 'utf8')
    // tsdown bundles each entry's declarations into one file.
    expect(declarations).toContain('declare function double(value: number): number;')
    expect(declarations).toContain('/** @defaultValue 3000 */\n  port: number;')
    expect(declarations).toContain('export { config, double };')
  })
})
