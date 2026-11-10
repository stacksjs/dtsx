import { describe, expect, test } from 'bun:test'
import { processSourceWithTypeScriptEngine } from '../src/process-source'

/** The TypeScript engine alone: the fallback when the native library is unavailable. */
function emit(source: string, isolated = false): string {
  return processSourceWithTypeScriptEngine(source, 'engine.ts', true, ['bun'], isolated)
}

describe('TypeScript engine inference', () => {
  test('a comment after an initializer is not part of the value', () => {
    const output = emit([
      'export const first = 1 // note',
      'export const second = { a: 1 } // trailing',
      'export const third = [1, 2] /* x */ // y',
      `export const url = 'http://example.com' // site`,
      'export const crlf = 2 // windows\r\nexport const cr = 3 // classic mac\rexport const after = 4',
    ].join('\n'))
    expect(output).toContain('export declare const first: 1;')
    expect(output).toContain('export declare const second: {')
    expect(output).toContain('export declare const third: number[];')
    expect(output).toContain(`export declare const url: 'http://example.com';`)
    expect(output).toContain('export declare const crlf: 2;')
    expect(output).toContain('export declare const cr: 3;')
    expect(output).toContain('export declare const after: 4;')
    expect(output).not.toContain('unknown')
  })

  test('unary operators have fixed result types', () => {
    const output = emit([
      'export const kind = typeof value',
      'export const nothing = void 0',
      'export const removed = delete obj.key',
      `export const check = typeof value === 'string'`,
      'export function local() { const x = 1; return typeof x }',
    ].join('\n'))
    expect(output).toContain('export declare const kind: string;')
    expect(output).toContain('export declare const nothing: undefined;')
    expect(output).toContain('export declare const removed: boolean;')
    expect(output).toContain('export declare const check: boolean;')
    expect(output).toContain('export declare function local(): string;')
  })

  test('a conditional is split outside literal text and comments', () => {
    const output = emit(`export function label(ok: boolean) { return ok ? 'a:b' /* x ? y : z */ : 'c?d' }`)
    expect(output).toContain('export declare function label(ok: boolean): string;')
  })

  test('an arrow in a union returns what its expression body returns', () => {
    const output = emit(`export const handlers = [() => 'a', 1]`)
    expect(output).toContain('export declare const handlers: ((() => string) | number)[];')
  })

  test('a method of a primitive parameter has its fixed result type', () => {
    const output = emit([
      'export const format = (value: number, digits = 2) => value.toFixed(digits)',
      'export function first(s: string) { return s.at(0) }',
      'export function both(s: string) { return [s.at(0)] }',
      'export function parts(s: string) { return s.split(\',\') }',
      'export function size(s: string) { return s.indexOf(\'a\') }',
      'export function flag(b: boolean, g: bigint) { return { b: b.toString(), g: g.valueOf() } }',
      'export function other(s: string) { return s.custom() }',
      'export function maybe(s?: string) { return s.trim() }',
    ].join('\n'))
    expect(output).toContain('export declare const format: (value: number, digits?: number) => string;')
    expect(output).toContain('export declare function first(s: string): string | undefined;')
    // A union result keeps its parentheses inside a larger type.
    expect(output).toContain('export declare function both(s: string): (string | undefined)[];')
    expect(output).toContain('export declare function parts(s: string): string[];')
    expect(output).toContain('export declare function size(s: string): number;')
    expect(output).toContain('b: string;')
    expect(output).toContain('g: bigint')
    expect(output).toContain('export declare function other(s: string): ReturnType<(string)["custom"]>;')
    // An optional receiver is not a primitive keyword type.
    expect(output).toContain('export declare function maybe(s?: string): ReturnType<((string) | undefined)["trim"]>;')
  })

  test('an object binding defaulted to {} declares each element like tsc', () => {
    const output = emit([
      `export function connect(host = 'localhost', { ssl = true, timeout: ms = 10, } = {}) { return { host, ssl, ms } }`,
      'export const arrow = ({ a = 1 } = {}) => a',
      'export function partial({ a, b = 1 } = {}) { return b }',
      'export function nested({ a: { b = 1 } = {} } = {}) { return 1 }',
      'export function seeded({ a = 1 } = { a: 2 }) { return a }',
    ].join('\n'))
    expect(output).toContain('export declare function connect(host?: string, { ssl, timeout: ms }?: { ssl?: boolean | undefined; timeout?: number | undefined }): {')
    expect(output).toContain('  ssl: boolean;\n  ms: number\n};')
    expect(output).toContain('export declare const arrow: ({ a }?: { a?: number | undefined }) => number;')
    // Other shapes keep the opaque record.
    expect(output).toContain('export declare function partial({ a, b}?: Record<string, unknown>): unknown;')
    expect(output).toContain('export declare function nested({ a: { b}}?: Record<string, unknown>): number;')
    expect(output).toContain('export declare function seeded({ a}?: Record<string, unknown>): unknown;')
  })

  test('numeric separators are not part of a literal type', () => {
    const output = emit([
      'export const timeout = 5_000',
      'export const big = 1_000n',
      'export const hex = 0xFF_FF',
      'export let retries = 1_000',
      'export const fixed = { max: 10_000 } as const',
      'export class K { static readonly max = 2_000 }',
      'export function wait(ms = 1_000) { return ms }',
    ].join('\n'))
    expect(output).toContain('export declare const timeout: 5000;')
    expect(output).toContain('export declare const big: 1000n;')
    expect(output).toContain('export declare const hex: 0xFFFF;')
    // A widened declaration documents the value as written.
    expect(output).toContain('/** @defaultValue 1_000 */\nexport declare let retries: number;')
    expect(output).toContain('readonly max: 10000')
    expect(output).toContain('static readonly max: 2000;')
    expect(output).toContain('export declare function wait(ms?: number): number;')
  })

  test('an object default made only of functions is omitted', () => {
    const output = emit([
      'export const handlers = { onReady: () => true, format(value: number) { return value } }',
      'export const mixed = { port: 1, onReady: () => true }',
    ].join('\n'))
    expect(output).toContain('export declare const handlers: {')
    expect(output).not.toContain('@defaultValue `{ onReady')
    expect(output).toContain('/** @defaultValue `{ port: 1, onReady: () => boolean }` */')
  })
})
