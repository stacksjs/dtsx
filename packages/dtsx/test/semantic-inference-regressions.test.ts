import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { clearResultCache, processSourceSemantic } from '../src/process-source'

const tempDirectories: string[] = []

afterEach(async () => {
  clearResultCache()
  await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('semantic return inference regressions', () => {
  it('finds the outer async arrow after callback parameter types', () => {
    const output = processSourceSemantic(`export const f = async (cb: () => string, count: number): Promise<number> => count`)
    expect(output).toContain('(cb: () => string, count: number) => Promise<number>')
  })

  it('accepts whitespace before an explicit arrow return annotation', () => {
    const output = processSourceSemantic(`export const f = async (value: number) : Promise<number> => value`)
    expect(output).toContain('(value: number) => Promise<number>')
  })

  it('preserves nested generic async arrow return annotations', () => {
    const output = processSourceSemantic(`export const f = async (): Promise<Result<Map<string, number>, Error>> => createResult()`)
    expect(output).toContain('() => Promise<Result<Map<string, number>, Error>>')
  })

  it('infers synchronous block arrow returns', () => {
    const output = processSourceSemantic(`export const increment = (value: number) => { return value + 1 }`)
    expect(output).toContain('(value: number) => number')
  })

  it('infers asynchronous block arrow returns', () => {
    const output = processSourceSemantic(`export const increment = async (value: number) => { return value + 1 }`)
    expect(output).toContain('(value: number) => Promise<number>')
  })

  it('keeps parameter splitting balanced around callback arrows', () => {
    const output = processSourceSemantic(`export function increment(cb: (value: number) => string, count: number) { return count + 1 }`)
    expect(output).toContain('increment(cb: (value: number) => string, count: number): number')
  })

  it('infers grouped binary expressions', () => {
    const output = processSourceSemantic(`export function increment(value: number) { return (value + 1) }`)
    expect(output).toContain('increment(value: number): number')
  })

  it('collapses conditional branches with the same type', () => {
    const output = processSourceSemantic(`export function choose(flag: boolean) { return flag ? 1 : 2 }`)
    expect(output).toContain('choose(flag: boolean): number')
  })

  it('unions conditional branches with different types', () => {
    const output = processSourceSemantic(`export function choose(flag: boolean) { return flag ? 1 : 'none' }`)
    expect(output).toContain('choose(flag: boolean): number | string')
  })

  it('does not leak function-local shorthand bindings into declarations', () => {
    const output = processSourceSemantic(`export function create() { const local = 1; return { local } }`)
    expect(output).toContain('local: unknown')
    expect(output).not.toContain('typeof local')
  })
})

describe('semantic spread and value-reference regressions', () => {
  it('widens multiline template literal values', () => {
    const output = processSourceSemantic('export const styles = `/** Wrapped as .card by the renderer. */\n.card { color: red; }`')
    expect(output).toContain('styles: string')
    expect(output).not.toContain('.card {')
  })

  it('widens interpolated runtime template literals', () => {
    const output = processSourceSemantic('declare const name: string\nexport const greeting = `Hello ${name}`')
    expect(output).toContain('greeting: string')
    expect(output).not.toContain('${name}')
  })

  it('infers top-level comparison expressions as boolean', () => {
    const output = processSourceSemantic("export const isDevelopment = process.env.NODE_ENV === 'development'")
    expect(output).toContain('isDevelopment: boolean')
  })

  it('retains object spread bindings and own properties', () => {
    const output = processSourceSemantic(`const base = { a: 1 }; export const value = { ...base, b: 2 }`)
    expect(output).toContain('declare const base:')
    expect(output).toContain('Omit<typeof base')
    expect(output).toContain('b: number')
  })

  it('models own properties as overriding spread properties', () => {
    const output = processSourceSemantic(`const base = { value: 1 }; export const result = { ...base, value: 'changed' }`)
    expect(output).toContain('Omit<typeof base, keyof {')
    expect(output).toContain('value: string')
  })

  it('models later object spreads as overriding earlier spreads', () => {
    const output = processSourceSemantic(`const first = { value: 1 }; const second = { value: 'two' }; export const result = { ...first, ...second }`)
    expect(output).toContain('Omit<typeof first, keyof typeof second> & typeof second')
  })

  it('infers inline object spreads', () => {
    const output = processSourceSemantic(`export const result = { ...{ a: 1 }, b: true }`)
    expect(output).toContain('a: number')
    expect(output).toContain('b: boolean')
  })

  it('retains array spread bindings', () => {
    const output = processSourceSemantic(`const values = [1, 2]; export const result = [...values, 3]`)
    expect(output).toContain('declare const values: number[]')
    expect(output).toContain('(typeof values)[number]')
  })

  it('infers inline array spread elements', () => {
    const output = processSourceSemantic(`export const result = [...[1, 2], 3]`)
    expect(output).toContain('result: number[]')
  })

  it('retains non-exported shorthand bindings', () => {
    const output = processSourceSemantic(`const hidden = 1; export const result = { hidden }`)
    expect(output).toContain('declare const hidden: 1')
    expect(output).toContain('hidden: typeof hidden')
  })

  it('infers dotted default export expressions with type queries', () => {
    const output = processSourceSemantic(`const namespace = { value: 1 }; export default namespace.value`)
    expect(output).toContain('declare const namespace:')
    expect(output).toContain('typeof namespace.value')
  })

  it('type-checks all newly inferred declaration forms', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-semantic-regressions-'))
    tempDirectories.push(directory)
    const sources = [
      `export const f = async (cb: () => string, count: number): Promise<number> => count`,
      `export const f = (value: number) => { return value + 1 }`,
      `export function create() { const local = 1; return { local } }`,
      `const base = { value: 1 }; export const result = { ...base, value: 'changed' }`,
      `const values = [1, 2]; export const result = [...values, 3]`,
      `const namespace = { value: 1 }; export default namespace.value`,
      `export const styles = \`/** theme */\n.card { color: red; }\``,
      `declare const name: string; export const greeting = \`Hello \${name}\``,
    ]
    const paths = await Promise.all(sources.map(async (source, index) => {
      const path = join(directory, `${index}.d.ts`)
      await writeFile(path, processSourceSemantic(source, `${index}.ts`))
      return path
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
      ...paths,
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
  })
})
