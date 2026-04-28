/**
 * Tests for extractor/directives.ts — covers the regex hoisting + `<` pre-filter:
 *  - All three directive forms (reference, amd-module, amd-dependency) still match
 *  - Triple-slash comments without `<` are skipped quickly (no regex run)
 *  - Mixed leading whitespace and CR endings still trim correctly
 *  - Directive scan stops at the first non-directive non-comment statement
 */

import { describe, expect, test } from 'bun:test'
import { extractTripleSlashDirectives } from '../src/extractor/directives'

describe('extractTripleSlashDirectives', () => {
  test('extracts <reference types=...>', () => {
    const out = extractTripleSlashDirectives('/// <reference types="node" />\nexport {}')
    expect(out).toEqual(['/// <reference types="node" />'])
  })

  test('extracts <reference path=...>', () => {
    const out = extractTripleSlashDirectives('/// <reference path="./types.d.ts" />\nexport {}')
    expect(out).toEqual(['/// <reference path="./types.d.ts" />'])
  })

  test('extracts <reference lib=...> and <reference no-default-lib=...>', () => {
    const src = '/// <reference lib="es2020" />\n/// <reference no-default-lib="true" />\nexport {}'
    const out = extractTripleSlashDirectives(src)
    expect(out).toContain('/// <reference lib="es2020" />')
    expect(out).toContain('/// <reference no-default-lib="true" />')
  })

  test('extracts <amd-module name=...>', () => {
    const out = extractTripleSlashDirectives('/// <amd-module name="m" />\nexport {}')
    expect(out).toEqual(['/// <amd-module name="m" />'])
  })

  test('extracts <amd-dependency path=...>', () => {
    const out = extractTripleSlashDirectives('/// <amd-dependency path="./d" />\nexport {}')
    expect(out).toEqual(['/// <amd-dependency path="./d" />'])
  })

  test('skips triple-slash comments that have no `<` (the cheap pre-filter)', () => {
    const out = extractTripleSlashDirectives('/// just a comment, no angle bracket\nexport {}')
    expect(out).toEqual([])
  })

  test('skips triple-slash comments with `<` that are not directives', () => {
    const out = extractTripleSlashDirectives('/// <not-a-real-directive />\nexport {}')
    expect(out).toEqual([])
  })

  test('respects leading whitespace and CR before triple-slash', () => {
    const out = extractTripleSlashDirectives('  /// <reference types="bun" />\r\nexport {}')
    expect(out).toEqual(['/// <reference types="bun" />'])
  })

  test('stops scanning at the first non-comment, non-blank line', () => {
    const src = '/// <reference types="node" />\nexport const x = 1\n/// <reference types="bun" />'
    const out = extractTripleSlashDirectives(src)
    expect(out).toEqual(['/// <reference types="node" />'])
  })

  test('returns empty for source without any directives', () => {
    expect(extractTripleSlashDirectives('export const x = 1')).toEqual([])
  })

  test('preserves order across multiple directives', () => {
    const src = '/// <reference types="node" />\n/// <reference types="bun-types" />\n/// <amd-module name="m" />\n'
    const out = extractTripleSlashDirectives(src)
    expect(out.length).toBe(3)
    expect(out[0]).toContain('node')
    expect(out[1]).toContain('bun-types')
    expect(out[2]).toContain('amd-module')
  })
})
