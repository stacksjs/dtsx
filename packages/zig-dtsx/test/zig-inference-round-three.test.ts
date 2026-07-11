import { describe, expect, test } from 'bun:test'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

function dts(source: string, isolatedDeclarations = false): string {
  return processSource(source, true, isolatedDeclarations).trim()
}

describeIf('Zig inference parity round three', () => {
  test('emits every binding in a const declaration list', () => {
    const output = dts('export const count = 1, label = "ready", enabled = true')
    expect(output).toContain('count: 1')
    expect(output).toContain('label: "ready"')
    expect(output).toContain('enabled: true')
  })

  test('emits every annotated binding in isolated mode', () => {
    const output = dts('export let first: string = expensive(), second: number = nested(1, 2)', true)
    expect(output).toContain('first: string')
    expect(output).toContain('second: number')
    expect(output).not.toContain('expensive')
    expect(output).not.toContain('nested')
  })

  test('infers optional parameter identity arrows', () => {
    expect(dts('export const identity = (value?: number) => value')).toContain('identity: (value?: number) => number')
  })

  test('infers rest parameter identity arrows', () => {
    expect(dts('export const collect = (...values: number[]) => values')).toContain('collect: (...values: number[]) => number[]')
  })

  test('unwraps parenthesized expressions', () => {
    expect(dts('export const value = (((1)))')).toContain('value: 1')
  })

  test('unwraps awaited promise values', () => {
    expect(dts('export const value = await Promise.resolve(1)')).toContain('value: number')
  })

  test('types runtime typeof expressions as strings', () => {
    expect(dts('export const value = typeof globalThis')).toContain('value: string')
  })

  test('types void expressions as undefined', () => {
    expect(dts('export const value = void run()')).toContain('value: undefined')
  })

  test('types delete expressions as boolean', () => {
    expect(dts('export const value = delete globalThis.value')).toContain('value: boolean')
  })

  test('types logical negation as boolean', () => {
    expect(dts('export const value = !!globalThis.value')).toContain('value: boolean')
  })

  test.each(['+input', '-input', '~input'])('types numeric unary expression %s as number', expression => {
    expect(dts(`declare const input: number; export const value = ${expression}`)).toContain('value: number')
  })

  test('recognizes regular expression literals', () => {
    expect(dts('export const matcher = /[a-z\\/]+/gi')).toContain('matcher: RegExp')
  })

  test('models optional property access', () => {
    const output = dts('const user = { name: "Ada" }; export const name = user?.name')
    expect(output).toContain('NonNullable<typeof user>["name"] | undefined')
  })

  test('models direct property access', () => {
    const output = dts('const user = { name: "Ada" }; export const name = user.name')
    expect(output).toContain('(typeof user)["name"]')
  })

  test('models literal element access', () => {
    const output = dts('const values = [1, 2] as const; export const first = values[0]')
    expect(output).toContain('(typeof values)[0]')
  })

  test('models identifier element access', () => {
    const output = dts('const values = { first: 1 }; const key = "first" as const; export const selected = values[key]')
    expect(output).toContain('(typeof values)[typeof key]')
  })

  test('models member calls with ReturnType', () => {
    expect(dts('export const value = Math.max(1, 2)')).toContain('value: ReturnType<typeof Math.max>')
  })

  test('types in expressions as boolean', () => {
    expect(dts('export const value = "key" in globalThis')).toContain('value: boolean')
  })

  test('types instanceof expressions as boolean', () => {
    expect(dts('export const value = globalThis instanceof Object')).toContain('value: boolean')
  })
})
