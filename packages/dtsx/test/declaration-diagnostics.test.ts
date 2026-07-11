import { describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { processSourceSemantic } from '../src/process-source'
import { validateDtsContent } from '../src/utils'

const ISOLATED_DECLARATION_DIAGNOSTICS = [
  9005, 9006, 9007, 9008, 9009, 9010, 9011, 9012, 9013, 9014, 9015, 9016, 9017,
  9018, 9019, 9020, 9021, 9022, 9023, 9025, 9026, 9027, 9028, 9029, 9030, 9031,
  9032, 9033, 9034, 9035, 9036, 9037, 9038, 9039,
] as const

const DIAGNOSTIC_SCENARIOS = [
  {
    name: 'private and inferred declarations',
    codes: [9005, 9006, 9007, 9008, 9009, 9010, 9011, 9012, 9013, 9025, 9027, 9028, 9029, 9030, 9031, 9032, 9033, 9034, 9039],
    source: `
      class Internal { value = 1 }
      export const instance = new Internal()
      export function make(value = 1) { return { value } }
      export class Service {
        property = 1
        method(value = 1) { return value }
        get current() { return this.property }
        set current(value) { this.property = value }
      }
      export const callback = (value = 1) => value
    `,
  },
  {
    name: 'computed and container expressions',
    codes: [9014, 9015, 9016, 9017, 9018, 9035, 9038],
    source: `
      const key = 'answer'
      const base = { stable: true }
      const values = [1, 2]
      export const answer = 42
      export const record = { [key]: answer, ...base, answer }
      export const list = [...values, 3]
    `,
  },
  {
    name: 'bindings, enums, heritage, classes, and function properties',
    codes: [9019, 9020, 9021, 9022, 9023],
    source: `
      const external = 1
      export const { selected = external } = { selected: 1 }
      export enum Choice { First = external }
      class Base {}
      export class Derived extends Base {}
      export const Constructor = class Named { value = 1 }
      export function callable() { return true }
      callable.description = 'callable'
    `,
  },
  {
    name: 'augmentation imports',
    codes: [9026],
    source: `
      import type { Stats } from 'node:fs'
      export interface Result { stats: Stats }
    `,
  },
  {
    name: 'default export expressions',
    codes: [9036, 9037],
    source: `export default { answer: 42, enabled: true }`,
  },
] as const

describe('isolated declaration diagnostic coverage', () => {
  it('accounts for every declaration-specific TS9xxx diagnostic exactly once', () => {
    const covered = DIAGNOSTIC_SCENARIOS.flatMap(scenario => scenario.codes).sort((a, b) => a - b)

    expect(covered).toEqual([...ISOLATED_DECLARATION_DIAGNOSTICS])
    expect(new Set(covered).size).toBe(covered.length)
  })

  for (const scenario of DIAGNOSTIC_SCENARIOS) {
    it(`emits valid declarations for ${scenario.name}`, () => {
      const output = processSourceSemantic(scenario.source, `${scenario.name.replaceAll(' ', '-')}.ts`)
      const validation = validateDtsContent(output, `${scenario.name}.d.ts`)

      expect(output.length).toBeGreaterThan(0)
      expect(validation.errors).toEqual([])
      expect(validation.isValid).toBe(true)
    })
  }

  it('passes the generated diagnostic matrix through TypeScript', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-diagnostic-matrix-'))

    try {
      const declarationPaths = await Promise.all(DIAGNOSTIC_SCENARIOS.map(async (scenario, index) => {
        const declarationPath = join(directory, `scenario-${index}.d.ts`)
        await writeFile(declarationPath, processSourceSemantic(scenario.source, `scenario-${index}.ts`))
        return declarationPath
      }))
      const subprocess = Bun.spawn([
        process.execPath,
        'x',
        'tsc',
        '--noEmit',
        '--ignoreConfig',
        '--skipLibCheck',
        '--target',
        'ESNext',
        ...declarationPaths,
      ], {
        cwd: resolve(import.meta.dir, '../../..'),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ])

      expect(`${stdout}${stderr}`).toBe('')
      expect(exitCode).toBe(0)
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
