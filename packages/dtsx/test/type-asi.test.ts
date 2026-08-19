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
