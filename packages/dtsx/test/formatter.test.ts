/**
 * Tests for formatter.ts — covers:
 *  - formatBuiltIn: gated regex replacements (skip full-string scans on clean input)
 *  - formatImports: single-pass import grouping (was 5 separate filter passes)
 *  - formatImports: import-type detection via prefix slice (was full-line includes)
 */

import { describe, expect, test } from 'bun:test'
import { formatDts } from '../src/formatter'

async function builtIn(content: string, opts: Record<string, unknown> = {}): Promise<string> {
  // Force the built-in formatter — Prettier might be installed in CI but we want
  // deterministic coverage of the routes we touched.
  const r = await formatDts(content, { usePrettier: false, builtIn: opts as Record<string, unknown> })
  return r.content
}

describe('formatter — formatBuiltIn (built-in path)', () => {
  test('normalizes \\r\\n to \\n', async () => {
    const out = await builtIn('export const x = 1\r\nexport const y = 2\r\n')
    expect(out.includes('\r')).toBe(false)
    expect(out).toContain('export const x = 1\nexport const y = 2')
  })

  test('leaves clean LF-only content untouched (gated CRLF replace)', async () => {
    const src = 'export const x = 1\nexport const y = 2\n'
    const out = await builtIn(src, { sortImports: false, groupImports: false })
    // Equality (modulo trailing newline guarantee) — the gated `indexOf('\r\n')` short-circuit
    // means no replacement runs on clean input.
    expect(out.replace(/\n+$/, '\n')).toBe(src)
  })

  test('strips trailing whitespace from lines', async () => {
    const src = 'export const x = 1   \nexport const y = 2\t\n'
    const out = await builtIn(src, { normalizeWhitespace: true })
    expect(out).not.toMatch(/[ \t]+\n/)
  })

  test('collapses 3+ blank lines to 2 (gated by indexOf("\\n\\n\\n"))', async () => {
    const src = 'export const x = 1\n\n\n\n\nexport const y = 2\n'
    const out = await builtIn(src, { normalizeWhitespace: true })
    expect(out).not.toMatch(/\n{3,}/)
    expect(out).toMatch(/\n\n/)
  })

  test('appends trailing newline if missing', async () => {
    const out = await builtIn('export const x = 1', { trailingNewline: true })
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('formatter — formatImports (single-pass grouping)', () => {
  test('groups node:* before scoped before relative', async () => {
    const src = [
      `import { local } from './local'`,
      `import { lo } from 'lodash'`,
      `import { fs } from 'node:fs'`,
      `import { foo } from '@stacks/foo'`,
      '',
      'export const x = 1',
      '',
    ].join('\n')

    const out = await builtIn(src, { sortImports: true, groupImports: true })

    // node: import precedes lodash (external) precedes @stacks (scoped) precedes ./local (relative)
    const idxNode = out.indexOf(`'node:fs'`)
    const idxLodash = out.indexOf(`'lodash'`)
    const idxScoped = out.indexOf(`'@stacks/foo'`)
    const idxRelative = out.indexOf(`'./local'`)

    expect(idxNode).toBeGreaterThan(-1)
    expect(idxLodash).toBeGreaterThan(-1)
    expect(idxScoped).toBeGreaterThan(-1)
    expect(idxRelative).toBeGreaterThan(-1)

    expect(idxNode).toBeLessThan(idxLodash)
    expect(idxLodash).toBeLessThan(idxScoped)
    expect(idxScoped).toBeLessThan(idxRelative)
  })

  test('puts type imports after value imports of the same source category', async () => {
    const src = [
      `import { B } from 'b-pkg'`,
      `import type { A } from 'a-pkg'`,
      `import { C } from 'c-pkg'`,
      '',
      'export const x = 1',
    ].join('\n')

    const out = await builtIn(src, { sortImports: true, groupImports: false })

    // Sort places non-type imports before type imports (sort comparator), then alphabetic.
    const idxValueB = out.indexOf(`'b-pkg'`)
    const idxValueC = out.indexOf(`'c-pkg'`)
    const idxTypeA = out.indexOf(`'a-pkg'`)

    expect(idxValueB).toBeLessThan(idxTypeA)
    expect(idxValueC).toBeLessThan(idxTypeA)
  })

  test('correctly identifies "import type" via prefix slice (not full-line includes)', async () => {
    // A spuriously-named identifier like `importType` in a comment must NOT trip
    // the "this is an import type" classifier.
    const src = [
      `// notes about importType usage`,
      `import { x } from 'pkg'`,
      '',
      'export const y = 1',
    ].join('\n')

    const out = await builtIn(src, { sortImports: true, groupImports: false })
    expect(out).toContain(`import { x } from 'pkg'`)
  })

  test('groupImports with no imports returns content unchanged at the import level', async () => {
    const src = 'export const x = 1\nexport const y = 2\n'
    const out = await builtIn(src, { sortImports: true, groupImports: true })
    expect(out).toContain('export const x = 1')
    expect(out).toContain('export const y = 2')
  })
})
