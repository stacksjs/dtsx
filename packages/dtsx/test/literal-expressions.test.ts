import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processSource } from '../src/process-source'

const tempDirs: string[] = []

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'dtsx-literals-'))
  tempDirs.push(tempDir)
  return tempDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Assert a declaration file passes `tsc --noEmit --strict`. */
async function expectParsesUnderTsc(files: Record<string, string>): Promise<void> {
  const tempDir = await createTempDir()
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(tempDir, name), content)
  }
  const tscBin = join(import.meta.dir, '..', '..', '..', 'node_modules', '.bin', 'tsc')
  const proc = Bun.spawnSync([tscBin, '--noEmit', '--strict', ...Object.keys(files)], { cwd: tempDir })
  const output = `${proc.stdout.toString()}${proc.stderr.toString()}`
  expect(proc.exitCode === 0 ? '' : output).toBe('')
}

describe('literal expression inference', () => {
  it('evaluates multi-part string-literal concatenations into one literal', async () => {
    const source = await readFile(join(import.meta.dir, 'fixtures', 'literals', 'program.ts'), 'utf8')
    const dts = processSource(source, 'program.ts')

    expect(dts).toContain(
      `export declare const STAKING_PROGRAM_NOT_DEPLOYED: 'Staking program is not deployed (STAKING_PROGRAM_ID is a placeholder); staking transactions cannot be submitted';`,
    )
    expect(dts).not.toContain('+\n')
    expect(dts).toContain(`export declare const STAKING_TIMEOUT: number;`)
    expect(dts).toContain(`export declare const STAKING_PREFIX: 'staking:v1';`)
    // Mixed concatenation with a non-literal operand widens to string.
    expect(dts).toContain(`export declare const STAKING_LABEL: string;`)

    await expectParsesUnderTsc({ 'program.d.ts': dts })
  })

  it('keeps single string and numeric literals narrow', async () => {
    const dts = processSource(`
export const SINGLE = 42
export const NEG = -5
export const NAME = 'dtsx'
export const FLAG = true
`, 'single.ts')

    expect(dts).toContain('export declare const SINGLE: 42;')
    expect(dts).toContain('export declare const NEG: -5;')
    expect(dts).toContain(`export declare const NAME: 'dtsx';`)
    expect(dts).toContain('export declare const FLAG: true;')

    await expectParsesUnderTsc({ 'single.d.ts': dts })
  })

  it('widens numeric arithmetic to number instead of emitting unknown', () => {
    const dts = processSource(`
export const TIMEOUT = 60 * 1000
export const HALF = 1 / 2
export const SUM = 10 + 5
export const PERCENT = (3 / 4) * 100
`, 'math.ts')

    expect(dts).toContain('export declare const TIMEOUT: number;')
    expect(dts).toContain('export declare const HALF: number;')
    expect(dts).toContain('export declare const SUM: number;')
    expect(dts).toContain('export declare const PERCENT: number;')
  })

  it('concatenates literals through the isolated declaration path as well', async () => {
    const dts = processSource(
      `export const MESSAGE = 'a' + 'b' as const`,
      'iso.ts',
      true,
      ['bun'],
      true,
    )
    expect(dts).toContain(`export declare const MESSAGE: 'ab';`)
    await expectParsesUnderTsc({ 'iso.d.ts': dts })
  })
})
