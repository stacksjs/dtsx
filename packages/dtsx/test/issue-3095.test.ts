/**
 * Regression tests for stacksjs/dtsx#3095 — destructured parameter with
 * inline type and default value emits malformed `.d.ts` when the source
 * has JSDoc comments inside the destructuring pattern. The unmatched
 * apostrophe in JSDoc prose (e.g. "error's") used to send the param
 * scanner into an inescapable string-literal mode, which broke depth
 * tracking and produced sequences like `,: unknown):` that TypeScript
 * rejects with `error TS1138: Parameter declaration expected.`.
 */
import { describe, expect, it } from 'bun:test'
import { processCode } from './test-utils'

const DESTRUCTURED_WITH_JSDOC = `export interface ParsedArgv { ok: boolean }
export class CLI {
  async parse(
    argv: string[] = [],
    {
      /** Whether to run the action for matched command */
      run = true,
      /**
       * When \`true\`, \`ClappError\` instances whose \`isUsageError\` flag is
       * set are rendered as a one-line message (plus "run --help" hint)
       * and terminate the process with the error's \`exitCode\`. Other
       * errors still propagate. Defaults to \`false\` for back-compat.
       */
      exitOnError = false,
    }: { run?: boolean, exitOnError?: boolean } = {},
  ): Promise<ParsedArgv> {
    void run; void exitOnError; void argv
    return { ok: true }
  }
}`

describe('issue 3095 — destructured param with JSDoc apostrophe', () => {
  it('does not emit a synthetic `: unknown` placeholder parameter', () => {
    const out = processCode(DESTRUCTURED_WITH_JSDOC)
    // The bug appended `,: unknown` after the destructured param when the
    // scanner failed mid-stream. That sequence must never reappear.
    expect(out).not.toMatch(/,\s*:\s*unknown\)/)
  })

  it('strips inner defaults from the destructured pattern', () => {
    const out = processCode(DESTRUCTURED_WITH_JSDOC)
    expect(out).not.toContain('exitOnError = false')
    expect(out).not.toContain('run = true')
  })

  it('strips the outer `= {}` default from the destructured param', () => {
    const out = processCode(DESTRUCTURED_WITH_JSDOC)
    expect(out).not.toContain('= {}')
  })

  it('preserves the inline type annotation on the destructured param', () => {
    const out = processCode(DESTRUCTURED_WITH_JSDOC)
    expect(out).toContain('run?: boolean')
    expect(out).toContain('exitOnError?: boolean')
  })

  it('produces a parseable parse() signature', () => {
    const out = processCode(DESTRUCTURED_WITH_JSDOC)
    // The cleaned `}` of the destructured pattern must be followed by `?:`,
    // a colon, or whitespace then a colon — never a comma + colon.
    expect(out).not.toMatch(/}\s*[^?:]*,\s*:/)
    expect(out).toMatch(/parse\(/)
    expect(out).toContain('Promise<ParsedArgv>')
  })

  it('handles a top-level function with the same shape', () => {
    const src = `export function f(
  argv: string[] = [],
  {
    /** run the action */
    run = true,
    /** when error's flag is set, exit */
    exitOnError = false,
  }: { run?: boolean, exitOnError?: boolean } = {},
): Promise<void> {
  return Promise.resolve()
}`
    const out = processCode(src)
    expect(out).not.toMatch(/,\s*:\s*unknown\)/)
    expect(out).not.toContain('= {}')
    expect(out).toContain('Promise<void>')
  })
})
