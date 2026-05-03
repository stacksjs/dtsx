/**
 * Regression tests for stacksjs/dtsx#3093 — three forms of malformed
 * `.d.ts` output: getter syntax, missing separators in inline object
 * types, default values leaking into declarations.
 */
import { describe, expect, it } from 'bun:test'
import { processSource } from '../src/generator'

describe('issue 3093 — getter syntax', () => {
  it('emits `get NAME(): T` for getter shorthand in object literals', () => {
    const src = `export const ENV = {
  get TRACE() { return process.env.PICKIER_TRACE === '1' },
}`
    const out = processSource(src)
    // Must be the accessor form, not the property+arrow form.
    expect(out).toContain('get TRACE()')
    expect(out).not.toContain('get TRACE: ()')
  })

  it('emits `set NAME(arg)` for setter shorthand', () => {
    const src = `export const x = {
  set foo(v: number) {},
}`
    const out = processSource(src)
    expect(out).toContain('set foo(v: number)')
    expect(out).not.toContain('set foo: (')
  })

  it('handles paired get/set on the same name', () => {
    const src = `export const x = {
  get foo() { return 1 },
  set foo(v: number) {},
}`
    const out = processSource(src)
    expect(out).toContain('get foo()')
    expect(out).toContain('set foo(v: number)')
  })

  it('still produces parseable .d.ts (no `get X: () =>` form)', () => {
    const src = `export const ENV = {
  get TRACE() { return true },
  get DEBUG() { return false },
}`
    const out = processSource(src)
    // The bug produced `get NAME: () => T` which TypeScript rejects with
    // "TS1005: '(' expected". Make sure that pattern never reappears.
    expect(out).not.toMatch(/get\s+\w+\s*:\s*\(/)
  })
})

describe('issue 3093 — default values in declarations', () => {
  it('strips `= {}` from function parameters in top-level functions', () => {
    const src = `export function resilient(config: { sentryDsn?: string } = {}) {}`
    const out = processSource(src)
    expect(out).not.toContain('= {}')
    expect(out).toContain('config?:')
  })

  it('strips defaults from arrow function parameters', () => {
    const src = `export const fn = (config: { sentryDsn?: string } = {}) => config`
    const out = processSource(src)
    expect(out).not.toContain('= {}')
    expect(out).toContain('config?:')
  })

  it('strips defaults from class method parameters', () => {
    const src = `export class C {
  resilient(config: { sentryDsn?: string } = {}): any { return config }
}`
    const out = processSource(src)
    expect(out).not.toContain('= {}')
    expect(out).toContain('config?:')
  })

  it('strips defaults from object literal method shorthand', () => {
    const src = `export const handler = {
  resilient(config: { sentryDsn?: string } = {}) { return config },
}`
    const out = processSource(src)
    expect(out).not.toContain('= {}')
    expect(out).toContain('config?:')
  })

  it('strips defaults from higher-order function bodies', () => {
    // This case used to take the "very complex" fallback in inferFunctionType
    // and pass through `= {}` because that path didn't run cleanParameterDefaults.
    const src = `export const wrap = (config: { sentryDsn?: string, bugsnagApiKey?: string } = {}) => (handler: () => void) => () => handler()`
    const out = processSource(src)
    expect(out).not.toContain('= {}')
  })
})

describe('issue 3093 — inline object type separators', () => {
  it('preserves comma separators in single-line object param types', () => {
    const src = `export function resilient(config: { sentryDsn?: string, bugsnagApiKey?: string, services?: string[] } = {}) {}`
    const out = processSource(src)
    // Members must have either `,` or `;` between them — never adjacent
    // identifiers like `string bugsnagApiKey`.
    expect(out).not.toMatch(/string\s+bugsnagApiKey/)
    expect(out).not.toMatch(/string\s+services/)
  })

  it('inserts separators when source uses newline-separated members', () => {
    const src = `export function resilient(config: {
  sentryDsn?: string
  bugsnagApiKey?: string
  services?: string[]
} = {}) {}`
    const out = processSource(src)
    // Either format (multiline preserved or collapsed with `;`) is fine
    // as long as there's no `string bugsnagApiKey` adjacency.
    expect(out).not.toMatch(/string\s+bugsnagApiKey(?!\?)/)
    expect(out).not.toMatch(/string\s+services(?!\?)/)
  })

  it('handles higher-order function param types with their own parens', () => {
    // The bug here was that bodyTrimmed.indexOf(')') found the first `)`
    // (inside `() => void`), truncating the param list.
    const src = `export const wrap = (cfg: { a?: string } = {}) => (handler: () => void) => () => handler()`
    const out = processSource(src)
    // The inner `(handler: () => void)` must not be cut down to `(handler: ()`.
    expect(out).not.toMatch(/handler:\s*\(\s*\)\s*=>\s*any[^a-z]*$/i)
    expect(out).toContain('handler: () => void')
  })
})

describe('issue 3093 — line comments inside inline object types', () => {
  // Bug: buildDtsParams stripped trailing `// ...` comments from each param
  // by walking the param string for `//` and slicing there. The walker did
  // not track brace depth, so a `// eslint-disable-next-line` between
  // fields of an *inline* object type was treated as a trailing comment
  // and chopped off everything after it — including the remaining fields
  // and their closing braces. Real-world repro:
  // `very-happy-dom@0.1.2`'s `BrowserPage.screenshot()` shipped a malformed
  // `.d.ts` (`}>): Promise<…>`) that broke `tsc --noEmit` for every consumer.
  it('keeps fields after a line comment inside an inline object type', () => {
    const src = `export class Page {
  async screenshot(options: {
    useWebView?: boolean | {
      css?: string
      fonts?: Array<{ family: string, url: string }>
      // eslint-disable-next-line pickier/no-unused-vars
      console?: true | ((event: unknown) => void)
    }
  } = {}): Promise<string | Buffer> {
    return ''
  }
}`
    const out = processSource(src)
    // Field after the comment must survive
    expect(out).toContain('console?:')
    // The inline comment itself should not appear in .d.ts output
    expect(out).not.toContain('eslint-disable')
    // Bracket structure must still close properly — no `}>):` adjacency
    expect(out).not.toMatch(/}>\)\s*:/)
    // The screenshot signature must end with the documented return type
    expect(out).toMatch(/Promise<string\s*\|\s*Buffer>/)
    expect(out).toContain('screenshot(')
  })

  it('still strips a true trailing line comment on the param itself', () => {
    const src = `export function fn(
  options: { a?: string } = {}, // legacy compatibility
) {}`
    const out = processSource(src)
    // The trailing `// legacy …` is at param scope, not inside the type — strip it
    expect(out).not.toContain('legacy compatibility')
    // The param + its type must survive
    expect(out).toContain('options?:')
  })

  it('keeps fields after multiple comments within deeply nested inline types', () => {
    const src = `export class C {
  m(opts: {
    nested?: {
      // first comment
      a?: string
      // second comment
      b?: number
      // third
      c?: boolean
    }
  } = {}): void {}
}`
    const out = processSource(src)
    expect(out).toContain('a?:')
    expect(out).toContain('b?:')
    expect(out).toContain('c?:')
    expect(out).not.toContain('first comment')
    expect(out).not.toContain('second comment')
    expect(out).not.toContain('third')
  })
})
