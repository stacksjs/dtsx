import { describe, expect, test } from 'bun:test'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

function dts(source: string): string {
  return processSource(source, true).trim()
}

describeIf('Zig inference parity round four', () => {
  test('models optional bare calls', () => {
    expect(dts('declare const factory: (() => number) | undefined; export const value = factory?.()'))
      .toContain('value: ReturnType<typeof factory> | undefined')
  })

  test('models optional member calls', () => {
    expect(dts('declare const api: { factory?: () => number }\nexport const value = api.factory?.()'))
      .toContain('value: ReturnType<typeof api.factory> | undefined')
  })

  test('models instantiated generic calls', () => {
    expect(dts('export function factory<T>(): T { throw new Error() }\nexport const value = factory<string>()'))
      .toContain('value: ReturnType<typeof factory<string>>')
  })

  test('models instantiated generic member calls', () => {
    expect(dts('declare const api: { factory<T>(): T }\nexport const value = api.factory<number>()'))
      .toContain('value: ReturnType<typeof api.factory<number>>')
  })

  test('infers namespace-qualified constructors', () => {
    expect(dts('declare namespace widgets { class Item {} } export const value = new widgets.Item()'))
      .toContain('value: widgets.Item')
  })

  test('infers lower-case constructor values', () => {
    const output = dts('const constructor = class Item {}; export const value = new constructor()')
    expect(output).toContain('value: InstanceType<typeof constructor>')
  })

  test.each(['&', '|', '^'])('infers %s bitwise expressions', operator => {
    expect(dts(`declare const left: number, right: number; export const value = left ${operator} right`))
      .toContain('value: number')
  })

  test.each(['<<', '>>', '>>>'])('infers %s shift expressions', operator => {
    expect(dts(`declare const input: number; export const value = input ${operator} 2`))
      .toContain('value: number')
  })

  test('infers exponentiation expressions', () => {
    expect(dts('declare const input: number; export const value = input ** 2')).toContain('value: number')
  })

  test('retains bigint operator results', () => {
    expect(dts('declare const input: bigint; export const value = input & 1n')).toContain('value: bigint')
  })

  test('infers comma operator final values', () => {
    expect(dts('export const value = (1, "last")')).toContain('value: "last"')
  })

  test('infers async function expressions', () => {
    expect(dts('export const load = async function () { return 1 }')).toContain('load: () => Promise<number>')
  })

  test('infers async generator expressions', () => {
    expect(dts('export const stream = async function* () { yield 1 }')).toContain('stream: () => AsyncGenerator<any, any, any>')
  })

  test('unions Promise.race resolved values', () => {
    expect(dts('export const value = Promise.race([Promise.resolve(1), Promise.resolve("ready")])'))
      .toContain('value: Promise<number | string>')
  })

  test('ignores rejected values in Promise.any result unions', () => {
    expect(dts('export const value = Promise.any([Promise.resolve(true), Promise.reject("no")])'))
      .toContain('value: Promise<boolean>')
  })

  test('keeps advanced inferred declarations syntactically valid', () => {
    const output = dts(`
      declare const factory: { <T>(): T }
      declare const maybe: (() => number) | undefined
      export const generic = factory<string>()
      export const optional = maybe?.()
      export const raced = Promise.race([Promise.resolve(1), Promise.resolve('ready')])
      export const asyncValue = async function () { return 1 }
    `)
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    expect(() => transpiler.transformSync(output)).not.toThrow()
  })
})
