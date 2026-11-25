/**
 * A conditional whose branches are arrow functions was read as one arrow:
 *
 *   export const toPosix = isWin ? (value: string) => value.replace(...) : (value: string) => value
 *
 * emitted `toPosix: (isWin ? (value: string)) => any`, which does not parse.
 * The arrow found outside parentheses belongs to a branch, and everything
 * before it was taken as the parameter list. Pinia's `getActivePinia` and
 * knip's `toPosix` and `debugLog` are written this way. Such a value is now
 * typed as other conditionals are, `unknown`; arrow functions read as before.
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })

describe('conditional with arrow function branches', () => {
  it.each([
    ['both branches arrows', 'declare const isWin: boolean\nexport const toPosix = isWin ? (value: string) => value.split(\'\\\\\').join(\'/\') : (value: string) => value\n', 'toPosix: unknown;'],
    ['branches with return types, over several lines', 'declare const dev: boolean\nexport const getActive = dev\n  ? (): string | undefined => {\n      return undefined\n    }\n  : (): string | undefined => undefined\n', 'getActive: unknown;'],
    ['an arrow and a name', 'declare const enabled: boolean\ndeclare const noop: () => void\nexport const log = enabled\n  ? (context: string, message: string) => console.log(context, message)\n  : noop\n', 'log: unknown;'],
    ['an arrow in the second branch only', 'declare const c: boolean\nexport const pick = c ? 1 : (v: string) => v\n', 'pick: unknown;'],
    ['an object property', 'declare const c: boolean\nexport const handlers = { a: c ? () => 1 : () => 2, b: (x: number) => x }\n', 'a: unknown;\n  b: (x: number) => number'],
    ['an array element', 'declare const c: boolean\nexport const list = [c ? () => 1 : () => 2]\n', 'list: unknown[];'],
    ['an asserted object holding an arrow', 'export const routes = { home: { render: () => 1 } as object }\n', 'home: unknown'],
  ])('emits a type that parses: %s', (_label, code, expected) => {
    const output = processCode(code)
    expect(() => transpiler.transformSync(output)).not.toThrow()
    expect(output).toContain(expected)
  })

  it.each([
    ['a parenthesis in a default', 'export const q = (a = \')\') => a\n', 'q: (a?: string) => string;'],
    ['a regular expression with parentheses in a default', 'export const re = (x: RegExp = /[)(]/): RegExp => x\n', 're: (x?: RegExp) => RegExp;'],
    ['a nested template literal in a default', 'export const text = (x: string = `${`)(`}`): string => x\n', 'text: (x?: string) => string;'],
    ['a comment after the parameters', 'export const fn = (x: number) /* note */ => x\n', 'fn: (x: number) => number;'],
    ['type parameters and a return type', 'export const id = <T,>(a: T): T => a\n', 'id: <T,>(a: T) => T;'],
    ['a type predicate', 'export const isX = (a: string): a is \'x\' => a === \'x\'\n', 'isX: (a: string) => a is \'x\';'],
    ['one bare parameter', 'export const same = x => x\n', 'same: (x) => unknown;'],
    ['one bare parameter and a comment', 'export const noted = x /* note */ => x\n', 'noted: (x /* note */) => unknown;'],
    ['one non-ASCII parameter', 'export const greek = αβ => αβ\n', 'greek: (αβ) => unknown;'],
    ['one escaped parameter', 'export const esc = \\u0078 => \\u0078\n', 'esc: (\\u0078) => unknown;'],
    ['one parameter with a code point escape', 'export const point = \\u{78} => \\u{78}\n', 'point: (\\u{78}) => unknown;'],
    ['async', 'export const load = async (a: string) => a\n', 'load: (a: string) => Promise<unknown>;'],
  ])('still reads an arrow function: %s', (_label, code, expected) => {
    expect(processCode(code)).toContain(expected)
  })
})
