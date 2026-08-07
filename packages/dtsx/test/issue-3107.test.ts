/**
 * Regression tests for stacksjs/dtsx#3107 — a parenthesis inside a call's TYPE
 * ARGUMENTS made the initializer look like an arrow function, and the emitted
 * declaration was truncated at that paren.
 *
 *   export const RouterKey = createInjectionKey<{ navigate: (p: string) => void }>('router')
 *
 * emitted
 *
 *   export declare const RouterKey: (createInjectionKey<{ navigate: (p: string)) => unknown;
 *
 * which is not parseable. A syntax error in a `.d.ts` is not `skipLibCheck`-able,
 * so it aborted tsc in every consumer of the package.
 *
 * Two scanners walked past the type arguments as if they were plain text:
 * `findMainArrowIndex` saw the `=>` of the property type and reported it as the
 * value's main arrow, and `inferCallType` took `indexOf('(')` and landed inside
 * the type argument, so the call read as unbalanced. Both now skip balanced
 * `<...>` runs; an unbalanced `<` is still treated as a comparison operator.
 *
 * Surfaced from stx, where it truncated `dist/composables.d.ts` (stacksjs/stx#1888).
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

/** Parens must be balanced in the emitted type — the bug left one unclosed. */
function parensBalanced(text: string): boolean {
  let depth = 0
  for (const char of text) {
    if (char === '(') depth++
    else if (char === ')') depth--
    if (depth < 0) return false
  }
  return depth === 0
}

describe('issue 3107 — parens inside type arguments truncate the declaration', () => {
  it('emits the complete type for the reported case', () => {
    const out = processCode(
      `export const RouterKey = createInjectionKey<{ currentRoute: string, navigate: (path: string) => void }>('router')`,
    )

    expect(out).toContain('ReturnType<typeof createInjectionKey<{ currentRoute: string, navigate: (path: string) => void }>>')
    // The exact truncation shape from the bug report.
    expect(out).not.toContain('(path: string)) =>')
    expect(parensBalanced(out)).toBe(true)
  })

  it('is not specific to function-typed properties — any paren in the type args triggered it', () => {
    const cases = [
      // Empty parens were enough.
      `export const C = k<{ go: () => void }>('c')`,
      // A function type as the type argument itself.
      `export const D = k<(p: string) => void>('d')`,
      // Nested inside another generic, so the emitted type ends `>>>`.
      `export const F = k<Array<(p: string) => void>>('f')`,
    ]

    for (const src of cases) {
      const out = processCode(src)
      expect(parensBalanced(out)).toBe(true)
      expect(out).toContain('ReturnType<typeof k<')
      expect(out).not.toContain('=> unknown')
      expect(out).not.toContain('=> boolean')
    }
  })

  it('still infers the shapes that already worked', () => {
    // No paren in the type arguments — this path was never broken, and the fix
    // must not disturb it.
    expect(processCode(`export const B = k<{ go: string }>('b')`))
      .toContain('ReturnType<typeof k<{ go: string }>>')

    // Parens in the VALUE arguments were always handled by bracket matching.
    expect(processCode(`export const E = k<{ x: string }>(String(1))`))
      .toContain('ReturnType<typeof k<{ x: string }>>')
  })

  it('still treats a real arrow function as a function', () => {
    const out = processCode(`export const fn = (p: string): void => { void p }`)
    expect(out).toContain('=>')
    expect(out).not.toContain('ReturnType<typeof')
  })

  it('still treats a generic arrow function as a function', () => {
    // `<T>` is balanced and gets skipped, so the arrow after it must still be
    // found — otherwise the fix would break every generic arrow.
    const out = processCode(`export const identity = <T>(value: T): T => value`)
    expect(out).toContain('=>')
    expect(out).not.toContain('ReturnType<typeof')
  })

  it('leaves an unbalanced `<` alone as a comparison operator', () => {
    // No matching `>`, so nothing is skipped and the expression still reads as
    // a comparison rather than as type arguments.
    expect(processCode(`export const cmp = a < b`)).toContain('boolean')
  })
})
