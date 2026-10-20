/**
 * An uninitialized variable whose type ran to the end of the line, with no
 * trailing semicolon, swallowed the statement after it:
 *
 *   export let format: (s: string) => string
 *
 *   defaultLocale({ thousands: ',' })
 *
 * emitted both, so the `.d.ts` contained a call expression and TypeScript
 * rejected the file with TS1036, "Statements are not allowed in ambient
 * contexts". Semicolons are not the house style here, so this was the common
 * case rather than the odd one.
 *
 * `checkASITopLevel` only breaks on a top-level *keyword*, and the swallowed
 * statement starts with an identifier. Reading a type needs the stricter rule:
 * a newline ends it unless what follows can continue a type.
 *
 * Surfaced from ts-charts, whose `packages/format/dist/defaultLocale.d.ts` and
 * `packages/time-format/dist/defaultLocale.d.ts` did not parse.
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

describe('type annotation ASI', () => {
  it('does not swallow the statement after an unterminated type', () => {
    const dts = processCode(`
export let format: (s: string) => string

setup({ a: 1 })

export default function setup(opts: { a: number }): void {
  format = (s: string) => s
}
`)
    expect(dts).not.toContain('setup({')
    expect(dts).toContain('let format: (s: string) => string')
  })

  // The risk in fixing the above is ending a type that legitimately continues
  // on the next line, so each continuation token gets its own case.
  it.each([
    ['union', 'export let u: \n  | \'a\'\n  | \'b\'\n', '| \'b\''],
    ['intersection', 'export let i: { a: number }\n  & { b: string }\n', '& { b: string }'],
    ['conditional', 'export let c: string extends string\n  ? number\n  : boolean\n', ': boolean'],
    ['generic across lines', 'export let g: Array<\n  { deep: true }\n>\n', '{ deep: true }'],
    ['qualified name', 'export let q: Foo\n  .Bar\n', '.Bar'],
  ])('keeps a multi-line type: %s', (_label, code, expected) => {
    expect(processCode(code)).toContain(expected)
  })
})

/**
 * The same ASI problem in the INITIALIZER loop rather than the type loop:
 *
 *   const number = Object.create(base) as EnhancedNumber
 *   number.int = (o) => ...
 *
 * emitted the assignments below the declaration into the `.d.ts`. Surfaced from
 * @stacksjs/faker, whose `dist/index.d.ts` shipped 12 syntax errors.
 */
describe('initializer ASI', () => {
  it('does not swallow assignments that follow an unterminated initializer', () => {
    const dts = processCode(`
interface Enhanced { int: (n: number) => number }
const base = { int: (n: number) => n }
export const num = Object.create(base) as Enhanced
num.int = (n: number): number => n + 1
`)
    expect(dts).not.toContain('num.int =')
  })

  // Both halves of ASI: the statement must also be complete for a newline to end
  // it, so a line ending in an operator continues regardless of what follows.
  it.each([
    ['assignment at end of line', 'export const MSG =\n  \'one \' +\n  \'two\'\n', 'MSG'],
    ['arithmetic across lines', 'export const T = 60\n  * 1000\n', 'T'],
    ['method chain', 'export const C = [1, 2]\n  .map(n => n)\n', 'C'],
    ['ternary across lines', 'export const X = cond\n  ? 1\n  : 2\n', 'X'],
  ])('keeps a multi-line initializer: %s', (_label, code, name) => {
    const dts = processCode(code)
    // The declaration survives and nothing from the continuation lines leaks out
    // as a statement. How well the initializer is then *inferred* is a separate
    // question - a chain and a ternary both resolve to `unknown` here, before
    // this change as well as after - so it is not asserted.
    expect(dts).toContain(name)
    expect(dts).not.toContain('.map(')
    expect(dts).not.toContain('? 1')
  })
})

/**
 * The third read loop with the same blind spot. A type alias whose body ran to
 * the end of the line, with no trailing semicolon, swallowed the statement after
 * it - so a file with a top-level `await` between two declarations emitted the
 * await into the `.d.ts`, where TypeScript rejects it with TS1036.
 *
 * Surfaced from `@stacksjs/search-engine`, which bound its driver that way.
 */
describe('type alias ASI', () => {
  it('does not swallow a statement after an unterminated type alias', () => {
    const dts = processCode(`
import { ready } from './dep'
export type Driver = 'a' | 'b'
await ready
export function go(): void {}
`)
    expect(dts).not.toContain('await ready')
    expect(dts).toContain('export type Driver')
  })

  it.each([
    ['leading union', 'export type U =\n  | \'a\'\n  | \'b\'\n', '| \'b\''],
    ['trailing union', 'export type T = \'a\' |\n  \'b\'\n', '\'b\''],
    ['conditional', 'export type C = string extends string\n  ? 1\n  : 2\n', ': 2'],
    ['object across lines', 'export type O = {\n  a: number\n}\n', 'a: number'],
  ])('keeps a multi-line type alias: %s', (_label, code, expected) => {
    expect(processCode(code)).toContain(expected)
  })
})

/**
 * A trailing line comment hid the newline that ends the statement, in every read
 * loop above:
 *
 *   export const SLASH_RE = /\//g // %2F
 *   export const PLUS_RE = /\+/g // %2B
 *
 * Skipping the comment also stepped over its newline, so the ASI checks never ran
 * there and the next line was read into the initializer: `SLASH_RE` came out
 * `unknown` and `PLUS_RE` was missing. After a type annotation or a type alias
 * the next statement leaked into the `.d.ts` instead.
 *
 * Surfaced from vue-router, whose `encoding.ts` exports the two constants above.
 */
describe('a line comment before the newline', () => {
  it.each([
    ['initializer', 'export const a = 1 // note\nexport const z = 3\n', 'const a: 1;'],
    ['initializer with CRLF', 'export const a = 1 // note\r\nexport const z = 3\r\n', 'const a: 1;'],
    ['local declaration next', 'export const a = 1 // note\nconst z = 3\nexport { z }\n', 'const a: 1;'],
    ['type annotation', 'export let a: number // note\nexport const z = 3\n', 'let a: number;'],
    ['type alias', 'export type A = string // note\nexport const z = 3\n', 'type A = string;'],
    ['type ending in void', 'export type F = () => void // note\nexport const z = 3\n', 'type F = () => void;'],
    ['namespace initializer', 'export namespace N {\n  export const a = 1 // note\n  export const z = 3\n}\n', 'const a: 1;'],
    ['namespace annotation', 'export namespace N {\n  export let a: number // note\n  export const z = 3\n}\n', 'let a: number;'],
    ['namespace type alias', 'export namespace N {\n  export type A = string // note\n  export const z = 3\n}\n', 'type A = string'],
    ['default export', 'const a = 1\nexport default a // note\nexport const z = 3\n', 'export default a;'],
  ])('ends the statement: %s', (_label, code, expected) => {
    const dts = processCode(code)
    expect(dts).toContain(expected)
    expect(dts).not.toContain('note')
    expect(dts).toMatch(/const z: 3;/)
  })

  it('ends an initializer at the end of the file', () => {
    expect(processCode('export const a = \'x\' // note')).toContain('const a: \'x\';')
  })

  // The comment ends a statement only before a declaration, `}` or the end of
  // the file. A statement that continues on the next line reads on, as before.
  it.each([
    ['operator before the comment', 'export let a: string | // note\n  number\nexport const z = 3\n', /let a: string \|[^;]*number;/],
    ['comment lines inside a type', 'export type A<T> = T extends string\n  ? // note\n    // more\n    number\n  : boolean\n', /\? \/\/ note[^;]*: boolean/],
    ['return type', 'export function f(): string | // note\n  number { return 1 }\n', /f\(\): string \|[^;]*number;/],
    ['class member type', 'export class C {\n  a: string | // note\n    number\n}\n', /a: string \|[^;]*number;/],
    ['keyword before the comment', 'export type A = typeof // note\n  import(\'./dep\')\nexport const z = 3\n', /typeof[^;]*import\('\.\/dep'\);/],
    ['call on the next line', 'export const a = (() => 1) // note\n  () as number\nexport const z = 3\n', /const a: number;/],
    ['void in a value', 'export const a = void // note\n  function f() {} as undefined\nexport const z = 3\n', /const a: undefined;/],
    ['decorator before the comment', 'export const a = @dec() // note\n  class {} as { new(): object }\nexport const z = 3\n', /const a: \{ new\(\): object \};/],
    ['as const across the comment', 'export const a = { x: 1 } as // note\n  const satisfies { x: number }\nexport const z = 3\n', /const a: \{ x: number \};/],
    ['as const with the operator far along the line', `export const a = { x: 1 } as // note\n  const${' '.repeat(200)}satisfies { x: number }\nexport const z = 3\n`, /const a: \{ x: number \};/],
    ['property named like a keyword', 'declare const api: { export(): number }\nexport const a = api. // note\n  // more\n  export() as number\nexport const z = 3\n', /const a: number;/],
    ['variable named like a keyword', 'const namespace = \'app\'\nexport const a = false ? \'\' : // note\n  namespace as string\nexport const z = 3\n', /const a: string;/],
  ])('keeps a statement that continues: %s', (_label, code, expected) => {
    expect(processCode(code)).toMatch(expected)
  })

  // `//` inside a literal is not a comment.
  it.each([
    ['regex', 'export const a = /[//]/g as RegExp\na.test(\'/\') as boolean\n', 'const a: RegExp;'],
    ['template', 'export type A = `Use:\n// example`\nconsole.log(\'loaded\')\nexport const z = 3\n', 'const z: 3;'],
  ])('is not fooled by // in a %s', (_label, code, expected) => {
    const dts = processCode(code)
    expect(dts).toContain(expected)
    expect(dts).not.toContain('console.log')
    expect(dts).not.toContain('a.test')
  })
})
