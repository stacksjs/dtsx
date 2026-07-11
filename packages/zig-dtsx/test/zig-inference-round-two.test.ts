import { describe, expect, test } from 'bun:test'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

function dts(source: string): string {
  return processSource(source, true).trim()
}

describeIf('Zig inference parity round two', () => {
  test('removes object defaults from function return annotations', () => {
    expect(dts('export function value(options: { ready?: boolean } = {}) { return options }'))
      .toContain('value(options?: { ready?: boolean }): { ready?: boolean }')
  })

  test('makes defaulted object method parameters optional', () => {
    expect(dts('export const api = { run(options: { ready?: boolean } = {}) { return options } }'))
      .toContain('run: (options?: { ready?: boolean }) => { ready?: boolean }')
  })

  test('emits object getter syntax and inferred returns', () => {
    expect(dts('export const api = { get size() { return 1 } }')).toContain('get size(): number')
  })

  test('emits object setter syntax and parameters', () => {
    expect(dts('export const api = { set size(value: number) {} }')).toContain('set size(value: number)')
  })

  test('infers object method body returns', () => {
    expect(dts('export const api = { double(value: number) { return value * 2 } }'))
      .toContain('double: (value: number) => number')
  })

  test('preserves anonymous default class exports', () => {
    expect(dts('export default class { value = 1 }')).toContain('export default class AnonymousClass')
  })

  test('infers class getter body returns', () => {
    expect(dts('export class Store { get size() { return 1 } }')).toContain('get size(): number')
  })

  test('honors const assertions on instance and static class properties', () => {
    const output = dts('export class Store { static readonly code = 1 as const; readonly name = "main" as const }')
    expect(output).toContain('static readonly code: 1')
    expect(output).toContain('readonly name: "main"')
  })

  test.each([
    ['hexadecimal', '0xff'],
    ['binary', '0b1010'],
    ['octal', '0o755'],
    ['scientific', '1e3'],
    ['separated', '1_000'],
  ])('recognizes %s numeric literals', (_name, literal) => {
    expect(dts(`export const value = ${literal}`)).toContain(`value: ${literal}`)
  })

  test('unions conditional expression branches', () => {
    expect(dts('export const value = enabled ? 1 : "off"')).toContain('value: 1 | "off"')
  })

  test('narrows nullish expressions with nullish left operands', () => {
    expect(dts('export const value = undefined ?? "fallback"')).toContain('value: "fallback"')
  })

  test('recognizes comparison expressions as boolean', () => {
    expect(dts('export const value = count >= 2')).toContain('value: boolean')
  })

  test('infers function expression body returns', () => {
    expect(dts('export const increment = function (value: number) { return value + 1 }'))
      .toContain('increment: (value: number) => number')
  })

  test('preserves generic async arrow signatures', () => {
    expect(dts('export const identity = async <T>(value: T): Promise<T> => value'))
      .toContain('identity: <T>(value: T) => Promise<T>')
  })

  test('uses named class expression constructor types', () => {
    expect(dts('export const Store = class InternalStore { value = 1 }')).toContain('Store: typeof InternalStore')
  })

  test('preserves readonly tuple spreads', () => {
    const output = dts('const values = [1, 2] as const; export const extended = [...values, 3] as const')
    expect(output).toContain('extended: readonly [...typeof values, 3]')
  })

  test.each(['NaN', 'Infinity'])('widens %s to number', value => {
    expect(dts(`export const value = ${value}`)).toContain('value: number')
  })
})
