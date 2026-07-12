import { describe, expect, test } from 'bun:test'
import { processSource, ZIG_AVAILABLE } from '../src/index'

const describeIf = ZIG_AVAILABLE ? describe : describe.skip

function dts(source: string): string {
  return processSource(source, true).trim()
}

describeIf('Zig inference parity round five', () => {
  test.each(['.5', '3.'])('recognizes %s as a decimal literal', value => {
    expect(dts(`export const value = ${value}`)).toContain(`value: ${value}`)
  })

  test.each(['-1n', '0xffn', '0b101n', '0o77n', '1_000n'])('recognizes %s as a bigint literal', value => {
    expect(dts(`export const value = ${value}`)).toContain(`value: ${value}`)
  })

  test.each([
    ['true ? "yes" : 0', '"yes"'],
    ['false ? "no" : 1', '1'],
    ['true && 1', '1'],
    ['false && 1', 'false'],
    ['true || "fallback"', 'true'],
    ['false || "fallback"', '"fallback"'],
    ['"ready" ?? 0', '"ready"'],
  ])('folds static expression %s', (expression, expected) => {
    expect(dts(`export const value = ${expression}`)).toContain(`value: ${expected}`)
  })

  test('infers Promise.allSettled tuple members', () => {
    expect(dts('export const value = Promise.allSettled([Promise.resolve(1), "ready"])'))
      .toContain('value: Promise<[PromiseSettledResult<number>, PromiseSettledResult<string>]>')
  })

  test('recursively unwraps nested promise types for await', () => {
    expect(dts('export const value = await Promise.resolve(Promise.resolve(1))')).toContain('value: number')
  })
})
