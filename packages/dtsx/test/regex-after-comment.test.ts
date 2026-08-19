import { describe, expect, it } from 'bun:test'
import { extractDeclarations } from '../src/extractor'

/**
 * A `/` is a regex literal or a division sign depending on what came before it,
 * and "what came before it" has to look past comments.
 *
 * When it did not, a regex preceded by a comment was read as division, the
 * scanner walked its pattern as ordinary code, and every bracket in the pattern
 * counted towards the enclosing declaration's depth. A pattern with an
 * unbalanced `\(` therefore never closed its declaration, and everything after
 * it in the file vanished from the output — silently, producing a .d.ts that
 * parsed perfectly and was missing three quarters of the module's API.
 */
function names(source: string): string[] {
  return extractDeclarations(source, 'probe.ts').map(d => d.name)
}

describe('a regex literal preceded by a comment', () => {
  it('does not swallow the declarations after it', () => {
    expect(names([
      'const PATTERNS = [',
      '  // Bind/call/apply (can change execution context)',
      '  /\\.(bind|call|apply)\\s*\\(/,',
      ']',
      'export function after(): void {}',
    ].join('\n'))).toContain('after')
  })

  it('handles a block comment in the same position', () => {
    expect(names([
      'const PATTERNS = [',
      '  /* unbalanced: ( */',
      '  /\\(/,',
      ']',
      'export function after(): void {}',
    ].join('\n'))).toContain('after')
  })

  it('handles several comment lines before the pattern', () => {
    expect(names([
      'const PATTERNS = [',
      '  // one',
      '  // two (with a paren',
      '  /\\(/,',
      ']',
      'export function after(): void {}',
    ].join('\n'))).toContain('after')
  })

  it('is not fooled by a // inside a string on the preceding line', () => {
    expect(names([
      'const docs = "https://example.dev"',
      'const PATTERNS = [',
      '  /\\(/,',
      ']',
      'export function after(): void {}',
    ].join('\n'))).toContain('after')
  })

  it('still reads a slash after a value as division', () => {
    expect(names([
      'const half = 10',
      '// a comment',
      '  / 2',
      'export function after(): void {}',
    ].join('\n'))).toContain('after')
  })

  it('emits every export of a module that mixes comments and patterns', () => {
    const source = [
      'export function first(): void {}',
      'const PATTERNS = [',
      '  // Code execution',
      '  /\\b(eval|Function)\\b/,',
      '  // Bind/call/apply (can change execution context)',
      '  /\\.(bind|call|apply)\\s*\\(/,',
      '  // Object creation',
      '  /\\bnew\\s+/,',
      ']',
      'export function second(): void {}',
      'export interface Third { a: number }',
      'export function fourth(): void {}',
    ].join('\n')

    expect(names(source)).toEqual(expect.arrayContaining(['first', 'second', 'Third', 'fourth']))
  })
})
