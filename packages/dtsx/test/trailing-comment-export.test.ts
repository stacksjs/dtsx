import { describe, expect, test } from 'bun:test'
import { processSource } from '../src/generator'

describe('declaration boundaries after trailing comments', () => {
  test.each(['\n', '\r\n', '\r'])('retains the next export after a line comment with %j', (newline) => {
    const source = `export const first = 1 // trailing comment${newline}export const second = 2${newline}export function third(): string { return 'ok' }`
    const output = processSource(source)
    expect(output).toContain('export declare const first:')
    expect(output).toContain('export declare const second:')
    expect(output).toContain('export declare function third(')
  })

  test('recognizes a line break within a block comment as a declaration boundary', () => {
    const output = processSource('export const first = 1 /* comment\n */ export const second = 2')
    expect(output).toContain('export declare const second:')
  })

  test('keeps multiline expressions continued after a comment', () => {
    const output = processSource('export const first = 1 + // continued\n 2\nexport const second = 3')
    expect(output).toContain('export declare const first:')
    expect(output).toContain('export declare const second:')
  })
})
