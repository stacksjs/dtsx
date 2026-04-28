/**
 * Tests for optimizer.ts — covers the partition/sort refactors:
 *  - sortImports: single-pass partition (was 2 filter passes)
 *  - sortDeclarationsFn: O(1) kind→index map (was repeated indexOf in comparator)
 *
 * Both functions are private; we exercise them via the public optimizeDeclarations
 * API with sortImports/sortDeclarations enabled.
 */

import type { Declaration } from '../src/types'
import { describe, expect, test } from 'bun:test'
import { optimizeDeclarations } from '../src/optimizer'

function decl(partial: Partial<Declaration> & { kind: Declaration['kind'], name: string }): Declaration {
  return {
    text: '',
    leadingComments: [],
    isExported: false,
    isDefault: false,
    isAsync: false,
    isGenerator: false,
    ...(partial as Declaration),
  } as Declaration
}

describe('optimizer — sortImports (single-pass partition)', () => {
  test('places imports before non-imports while preserving non-import order', () => {
    const input: Declaration[] = [
      decl({ kind: 'function', name: 'a' }),
      decl({ kind: 'import', name: '', source: 'b-pkg' }),
      decl({ kind: 'class', name: 'C' }),
      decl({ kind: 'import', name: '', source: 'a-pkg' }),
    ]
    const { declarations } = optimizeDeclarations(input, { sortImports: true })

    // First items must be imports.
    expect(declarations[0].kind).toBe('import')
    expect(declarations[1].kind).toBe('import')
    // Non-imports follow in their original order.
    expect(declarations[2].kind).toBe('function')
    expect(declarations[2].name).toBe('a')
    expect(declarations[3].kind).toBe('class')
    expect(declarations[3].name).toBe('C')
    // Imports are alphabetized within their own segment.
    expect(declarations[0].source).toBe('a-pkg')
    expect(declarations[1].source).toBe('b-pkg')
  })

  test('builtin / external / relative ordering is preserved', () => {
    const input: Declaration[] = [
      decl({ kind: 'import', name: '', source: './local' }),
      decl({ kind: 'import', name: '', source: 'lodash' }),
      decl({ kind: 'import', name: '', source: 'node:fs' }),
      decl({ kind: 'import', name: '', source: 'bun' }),
    ]
    const { declarations } = optimizeDeclarations(input, { sortImports: true })
    const sources = declarations.map(d => d.source ?? '')
    // node:fs and bun are "built-in"; lodash is external; ./local is relative.
    expect(sources.indexOf('node:fs')).toBeLessThan(sources.indexOf('lodash'))
    expect(sources.indexOf('bun')).toBeLessThan(sources.indexOf('lodash'))
    expect(sources.indexOf('lodash')).toBeLessThan(sources.indexOf('./local'))
  })
})

describe('optimizer — sortDeclarationsFn (O(1) kindIndex map)', () => {
  test('orders declarations by kind: import → interface → type → class → enum → function → variable → export', () => {
    const input: Declaration[] = [
      decl({ kind: 'export', name: 'e' }),
      decl({ kind: 'function', name: 'f' }),
      decl({ kind: 'class', name: 'c' }),
      decl({ kind: 'interface', name: 'i' }),
      decl({ kind: 'variable', name: 'v' }),
      decl({ kind: 'type', name: 't' }),
      decl({ kind: 'enum', name: 'n' }),
      decl({ kind: 'import', name: '', source: 'm' }),
    ]
    const { declarations } = optimizeDeclarations(input, { sortDeclarations: true })
    const kinds = declarations.map(d => d.kind)
    expect(kinds).toEqual(['import', 'interface', 'type', 'class', 'enum', 'function', 'variable', 'export'])
  })

  test('within the same kind, declarations sort alphabetically by name', () => {
    const input: Declaration[] = [
      decl({ kind: 'class', name: 'Zebra' }),
      decl({ kind: 'class', name: 'Apple' }),
      decl({ kind: 'class', name: 'Mango' }),
    ]
    const { declarations } = optimizeDeclarations(input, { sortDeclarations: true })
    expect(declarations.map(d => d.name)).toEqual(['Apple', 'Mango', 'Zebra'])
  })

  test('unknown kinds (not in the kind-index map) sort to the end', () => {
    // Synthesize a declaration with an unrecognized kind to verify the `?? 99` fallback
    // path introduced by the kind-index Record refactor.
    const input: Declaration[] = [
      decl({ kind: 'class', name: 'A' }),
      // Cast to bypass the discriminated-union check — we deliberately probe an unknown branch.
      { ...decl({ kind: 'class', name: 'B' }), kind: 'mystery' as Declaration['kind'] },
      decl({ kind: 'function', name: 'C' }),
    ]
    const { declarations } = optimizeDeclarations(input, { sortDeclarations: true })
    expect(declarations[declarations.length - 1].name).toBe('B')
  })
})
