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
