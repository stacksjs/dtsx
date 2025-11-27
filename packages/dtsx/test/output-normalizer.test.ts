/**
 * Tests for output normalizer
 */

import { describe, expect, test } from 'bun:test'
import {
  createOutputNormalizer,
  detectLineEnding,
  ensureTrailingNewline,
  normalizeBlankLines,
  normalizeIndent,
  normalizeLineEndings,
  normalizeOutput,
  normalizerPresets,
  orderDeclarations,
  processImports,
  removeTrailingWhitespace,
} from '../src/output-normalizer'

describe('Output Normalizer', () => {
  describe('Line Endings', () => {
    test('normalizes CRLF to LF', () => {
      const input = 'line1\r\nline2\r\nline3'
      const result = normalizeLineEndings(input, 'lf')
      expect(result).toBe('line1\nline2\nline3')
    })

    test('converts LF to CRLF', () => {
      const input = 'line1\nline2\nline3'
      const result = normalizeLineEndings(input, 'crlf')
      expect(result).toBe('line1\r\nline2\r\nline3')
    })

    test('handles mixed line endings', () => {
      const input = 'line1\r\nline2\nline3\rline4'
      const result = normalizeLineEndings(input, 'lf')
      expect(result).toBe('line1\nline2\nline3\nline4')
    })

    test('detects CRLF majority', () => {
      const input = 'line1\r\nline2\r\nline3\n'
      const result = detectLineEnding(input)
      expect(result).toBe('crlf')
    })

    test('detects LF majority', () => {
      const input = 'line1\nline2\nline3\r\n'
      const result = detectLineEnding(input)
      expect(result).toBe('lf')
    })
  })

  describe('Trailing Whitespace', () => {
    test('removes trailing spaces', () => {
      const input = 'line1   \nline2  \nline3'
      const result = removeTrailingWhitespace(input)
      expect(result).toBe('line1\nline2\nline3')
    })

    test('removes trailing tabs', () => {
      const input = 'line1\t\t\nline2\t\nline3'
      const result = removeTrailingWhitespace(input)
      expect(result).toBe('line1\nline2\nline3')
    })

    test('removes mixed trailing whitespace', () => {
      const input = 'line1 \t \nline2\t \nline3'
      const result = removeTrailingWhitespace(input)
      expect(result).toBe('line1\nline2\nline3')
    })

    test('preserves leading whitespace', () => {
      const input = '  line1  \n\tline2  '
      const result = removeTrailingWhitespace(input)
      expect(result).toBe('  line1\n\tline2')
    })
  })

  describe('Blank Lines', () => {
    test('collapses multiple blank lines to one', () => {
      const input = 'line1\n\n\n\nline2'
      const result = normalizeBlankLines(input, 1)
      expect(result).toBe('line1\n\nline2')
    })

    test('allows specified max blank lines', () => {
      const input = 'line1\n\n\n\n\nline2'
      const result = normalizeBlankLines(input, 2)
      expect(result).toBe('line1\n\n\nline2')
    })

    test('does not add blank lines where none exist', () => {
      const input = 'line1\nline2\nline3'
      const result = normalizeBlankLines(input, 1)
      expect(result).toBe('line1\nline2\nline3')
    })
  })

  describe('Trailing Newline', () => {
    test('adds trailing newline if missing', () => {
      const input = 'content'
      const result = ensureTrailingNewline(input)
      expect(result).toBe('content\n')
    })

    test('keeps single trailing newline', () => {
      const input = 'content\n'
      const result = ensureTrailingNewline(input)
      expect(result).toBe('content\n')
    })

    test('removes multiple trailing newlines', () => {
      const input = 'content\n\n\n'
      const result = ensureTrailingNewline(input)
      expect(result).toBe('content\n')
    })

    test('removes trailing whitespace before newline', () => {
      const input = 'content   \n'
      const result = ensureTrailingNewline(input)
      expect(result).toBe('content\n')
    })
  })

  describe('Indentation Normalization', () => {
    test('normalizes to spaces', () => {
      // Each tab is treated as 2 spaces, so 2 tabs = 4 spaces = 2 indent levels
      const input = '\t\tline1\n\t\t\tline2'
      const result = normalizeIndent(input, { style: 'spaces', size: 2 })
      expect(result).toBe('    line1\n      line2')
    })

    test('normalizes to tabs', () => {
      const input = '    line1\n      line2'
      const result = normalizeIndent(input, { style: 'tabs', size: 1 })
      expect(result).toBe('\t\tline1\n\t\t\tline2')
    })

    test('handles mixed indentation', () => {
      // 2 spaces + 1 tab = 4 spaces = 2 indent levels
      const input = '  \tline1\n\t  line2'
      const result = normalizeIndent(input, { style: 'spaces', size: 2 })
      // Should normalize to consistent spacing based on calculated level
      expect(result.split('\n')[0].match(/^\s*/)?.[0]).toBe('    ')
    })

    test('preserves empty lines', () => {
      const input = 'line1\n\nline2'
      const result = normalizeIndent(input, { style: 'spaces', size: 2 })
      expect(result).toBe('line1\n\nline2')
    })
  })

  describe('Import Processing', () => {
    test('groups imports by type', () => {
      const input = `import { bar } from './local'
import { foo } from 'external'
import { path } from 'node:path'
import type { Type } from './types'`

      const result = processImports(input, {
        enabled: true,
        separateGroups: true,
        alphabetize: true,
      })

      const lines = result.split('\n').filter(l => l.trim())
      // node: should be first
      expect(lines[0]).toContain('node:path')
      // external should be next
      expect(lines[1]).toContain('external')
    })

    test('alphabetizes within groups', () => {
      const input = `import { z } from 'zebra'
import { a } from 'apple'
import { m } from 'mango'`

      const result = processImports(input, {
        enabled: true,
        alphabetize: true,
        separateGroups: false,
      })

      const lines = result.split('\n').filter(l => l.trim())
      expect(lines[0]).toContain('apple')
      expect(lines[1]).toContain('mango')
      expect(lines[2]).toContain('zebra')
    })

    test('preserves type imports separately', () => {
      const input = `import type { Type } from './types'
import { value } from './values'`

      const result = processImports(input, {
        enabled: true,
        separateGroups: true,
        alphabetize: true,
      })

      // Type imports should come after value imports in same group
      const lines = result.split('\n').filter(l => l.trim())
      expect(lines.findIndex(l => l.includes('value'))).toBeLessThan(
        lines.findIndex(l => l.includes('type { Type')),
      )
    })

    test('handles scoped packages', () => {
      const input = `import { foo } from '@org/package'
import { bar } from 'external'`

      const result = processImports(input, {
        enabled: true,
        separateGroups: true,
      })

      // Both should be grouped appropriately
      expect(result).toContain('@org/package')
      expect(result).toContain('external')
    })
  })

  describe('Declaration Ordering', () => {
    test('orders by declaration kind', () => {
      const input = `export function foo(): void {}
export type Bar = string
export interface Baz {}
export const value = 1`

      const result = orderDeclarations(input, {
        kinds: ['type', 'interface', 'class', 'function', 'variable'],
        alphabetize: false,
      })

      const lines = result.split('\n').filter(l => l.trim())
      // type should come first
      expect(lines[0]).toContain('type Bar')
      // then interface
      expect(lines[1]).toContain('interface Baz')
    })

    test('alphabetizes within kinds', () => {
      const input = `export type Zebra = string
export type Apple = number
export type Mango = boolean`

      const result = orderDeclarations(input, {
        kinds: ['type'],
        alphabetize: true,
      })

      const lines = result.split('\n').filter(l => l.trim())
      expect(lines[0]).toContain('Apple')
      expect(lines[1]).toContain('Mango')
      expect(lines[2]).toContain('Zebra')
    })

    test('groups exports first when enabled', () => {
      const input = `type InternalType = string
export type ExportedType = number`

      const result = orderDeclarations(input, {
        kinds: ['type'],
        groupExports: true,
      })

      const lines = result.split('\n').filter(l => l.trim())
      expect(lines[0]).toContain('export type')
    })

    test('handles multi-line declarations', () => {
      const input = `export interface MultiLine {
  prop1: string
  prop2: number
}
export type Simple = string`

      const result = orderDeclarations(input, {
        kinds: ['type', 'interface'],
        alphabetize: false,
      })

      // Type should come before interface
      expect(result.indexOf('type Simple')).toBeLessThan(result.indexOf('interface MultiLine'))
    })
  })

  describe('Full Normalization', () => {
    test('applies all normalizations', () => {
      const input = `import { bar } from './local'   \r\nimport { foo } from 'external'\r\n\r\n\r\nexport const value = 1\r\n\r\n\r\n`

      const result = normalizeOutput(input, {
        lineEnding: 'lf',
        trailingNewline: true,
        maxBlankLines: 1,
        trimTrailingWhitespace: true,
      })

      // Should use LF
      expect(result).not.toContain('\r')
      // Should remove trailing whitespace
      expect(result).not.toMatch(/[ \t]\n/)
      // Should end with single newline
      expect(result).toMatch(/[^\n]\n$/)
      // Should not have multiple blank lines
      expect(result).not.toContain('\n\n\n')
    })

    test('works with minimal preset', () => {
      const input = 'content\r\n'
      const normalizer = createOutputNormalizer(normalizerPresets.minimal)
      const result = normalizer.normalize(input)

      expect(result).toBe('content\n')
    })

    test('works with strict preset', () => {
      const input = `export const b = 1
export const a = 2
export type Z = string
export type A = number`

      const normalizer = createOutputNormalizer(normalizerPresets.strict)
      const result = normalizer.normalize(input)

      // Types should come before variables
      expect(result.indexOf('type')).toBeLessThan(result.indexOf('const'))
    })
  })

  describe('Comment Preservation', () => {
    test('preserves JSDoc comments', () => {
      const input = `/**
 * This is a JSDoc comment
 * @param foo - A parameter
 */
export function foo(foo: string): void {}`

      const result = normalizeOutput(input, {
        preserveComments: true,
      })

      expect(result).toContain('/**')
      expect(result).toContain('@param foo')
      expect(result).toContain('*/')
    })

    test('preserves single-line comments', () => {
      const input = `// This is a comment
export const value = 1`

      const result = normalizeOutput(input, {
        preserveComments: true,
      })

      expect(result).toContain('// This is a comment')
    })

    test('preserves block comments', () => {
      const input = `/* Block comment */
export const value = 1`

      const result = normalizeOutput(input, {
        preserveComments: true,
      })

      expect(result).toContain('/* Block comment */')
    })
  })

  describe('Normalizer Factory', () => {
    test('creates normalizer with config', () => {
      const normalizer = createOutputNormalizer({
        lineEnding: 'lf',
        trailingNewline: true,
      })

      expect(typeof normalizer.normalize).toBe('function')
      expect(typeof normalizer.normalizeLineEndings).toBe('function')
      expect(typeof normalizer.removeTrailingWhitespace).toBe('function')
      expect(typeof normalizer.normalizeBlankLines).toBe('function')
      expect(typeof normalizer.ensureTrailingNewline).toBe('function')
      expect(typeof normalizer.processImports).toBe('function')
      expect(typeof normalizer.orderDeclarations).toBe('function')
    })

    test('applies configuration to normalize', () => {
      const normalizer = createOutputNormalizer({
        lineEnding: 'lf',
        trailingNewline: true,
      })

      const result = normalizer.normalize('content\r\n')
      // CRLF should be normalized to LF
      expect(result).not.toContain('\r')
      expect(result).toBe('content\n')
    })
  })

  describe('Presets', () => {
    test('default preset exists', () => {
      expect(normalizerPresets.default).toBeDefined()
      expect(normalizerPresets.default.lineEnding).toBe('lf')
    })

    test('minimal preset exists', () => {
      expect(normalizerPresets.minimal).toBeDefined()
      expect(normalizerPresets.minimal.normalizeIndentation).toBe(false)
    })

    test('strict preset exists', () => {
      expect(normalizerPresets.strict).toBeDefined()
      expect(normalizerPresets.strict.declarationOrder).toBeDefined()
    })

    test('windows preset uses CRLF', () => {
      expect(normalizerPresets.windows.lineEnding).toBe('crlf')
    })

    test('tabs preset uses tabs', () => {
      expect(normalizerPresets.tabs.indent?.style).toBe('tabs')
    })
  })

  describe('Edge Cases', () => {
    test('handles empty content', () => {
      const result = normalizeOutput('')
      expect(result).toBe('\n')
    })

    test('handles whitespace-only content', () => {
      const result = normalizeOutput('   \n\n\t\t')
      expect(result).toBe('\n')
    })

    test('handles content without imports', () => {
      const input = 'export const value = 1'
      const result = processImports(input, { enabled: true })
      expect(result).toContain('export const value')
    })

    test('handles content without declarations', () => {
      const input = '// Just a comment'
      const result = orderDeclarations(input, { kinds: ['type'] })
      expect(result).toContain('// Just a comment')
    })

    test('handles very long lines', () => {
      const longType = `${'A | '.repeat(100)}Z`
      const input = `export type Long = ${longType}`
      const result = normalizeOutput(input)
      expect(result).toContain(longType)
    })

    test('handles deeply nested braces', () => {
      const input = `export interface Deep {
  level1: {
    level2: {
      level3: {
        value: string
      }
    }
  }
}`
      const result = orderDeclarations(input, { kinds: ['interface'] })
      expect(result).toContain('level3')
    })
  })
})
