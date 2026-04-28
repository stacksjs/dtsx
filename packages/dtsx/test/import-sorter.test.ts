/**
 * Tests for import-sorter.ts — covers:
 *  - detectGroup: Set-based builtin lookup, scoped/external/relative classification
 *  - parseImport: default, named, type-only, side-effect, mixed forms
 *  - sortImports: stability under group ordering, custom order patterns (regex + prefix),
 *    and behavior-equivalence after the precompiled-regex / cached-group-index refactor
 */

import { describe, expect, test } from 'bun:test'
import { detectGroup, parseImport, sortImports } from '../src/import-sorter'

describe('import-sorter — detectGroup', () => {
  test('classifies node:* as builtin', () => {
    expect(detectGroup('node:fs')).toBe('builtin')
    expect(detectGroup('node:path')).toBe('builtin')
  })

  test('classifies bare node modules as builtin (Set-based lookup)', () => {
    // Pre-fix this used Array.includes on a 37-element array per call. Behavior is unchanged.
    expect(detectGroup('fs')).toBe('builtin')
    expect(detectGroup('path')).toBe('builtin')
    expect(detectGroup('crypto')).toBe('builtin')
    expect(detectGroup('worker_threads')).toBe('builtin')
  })

  test('non-builtin bare names fall through to external', () => {
    expect(detectGroup('lodash')).toBe('external')
    expect(detectGroup('react')).toBe('external')
  })

  test('classifies relative imports', () => {
    expect(detectGroup('./foo')).toBe('sibling')
    expect(detectGroup('../bar')).toBe('parent')
    expect(detectGroup('.')).toBe('index')
    // Note: detectGroup checks `./` before the `./index` short-circuit,
    // so paths starting with `./` always classify as 'sibling'.
    expect(detectGroup('./index')).toBe('sibling')
  })

  test('classifies aliased / scoped imports', () => {
    expect(detectGroup('@/lib/x')).toBe('internal')
    expect(detectGroup('~/components/y')).toBe('internal')
    expect(detectGroup('#hash')).toBe('internal')
    expect(detectGroup('@scope/pkg')).toBe('external')
  })

  test('respects type-only flag', () => {
    expect(detectGroup('node:fs', true)).toBe('type')
    expect(detectGroup('lodash', true)).toBe('type')
  })
})

describe('import-sorter — parseImport', () => {
  test('parses a named import', () => {
    const p = parseImport('import { foo, bar } from \'./x\'')
    expect(p).not.toBeNull()
    expect(p!.specifiers).toEqual(['foo', 'bar'])
    expect(p!.source).toBe('./x')
    expect(p!.isTypeOnly).toBe(false)
  })

  test('parses a type-only import', () => {
    const p = parseImport('import type { X } from \'./y\'')
    expect(p).not.toBeNull()
    expect(p!.isTypeOnly).toBe(true)
    expect(p!.group).toBe('type')
  })

  test('parses a default import', () => {
    const p = parseImport('import foo from \'./z\'')
    expect(p).not.toBeNull()
    expect(p!.defaultImport).toBe('foo')
    expect(p!.specifiers.length).toBe(0)
  })

  test('parses default + named import', () => {
    const p = parseImport('import foo, { bar } from \'./z\'')
    expect(p).not.toBeNull()
    expect(p!.defaultImport).toBe('foo')
    expect(p!.specifiers).toEqual(['bar'])
  })

  test('parses namespace import', () => {
    const p = parseImport('import * as X from \'./z\'')
    expect(p).not.toBeNull()
    expect(p!.namespaceImport).toBe('X')
  })

  test('parses side-effect import', () => {
    const p = parseImport('import \'./side\'')
    expect(p).not.toBeNull()
    expect(p!.source).toBe('./side')
    expect(p!.specifiers.length).toBe(0)
  })

  test('returns null for non-import statements', () => {
    expect(parseImport('export const x = 1')).toBeNull()
  })
})

describe('import-sorter — sortImports', () => {
  test('groups by type with default order', () => {
    const imports = [
      `import { resolve } from 'node:path'`,
      `import { foo } from 'lodash'`,
      `import { local } from './local'`,
      `import { up } from '../parent'`,
    ]
    const sorted = sortImports(imports, { groupByType: true, alphabetize: true })
    // Expect builtins first, then external, then parent, then sibling.
    const flat = sorted.filter(s => s !== '').join('\n')
    const builtinIdx = flat.indexOf('node:path')
    const externalIdx = flat.indexOf('lodash')
    const parentIdx = flat.indexOf('../parent')
    const siblingIdx = flat.indexOf('./local')
    expect(builtinIdx).toBeLessThan(externalIdx)
    expect(externalIdx).toBeLessThan(parentIdx)
    expect(parentIdx).toBeLessThan(siblingIdx)
  })

  test('alphabetizes within a group', () => {
    const imports = [
      `import { z } from 'zlib'`,
      `import { fs } from 'fs'`,
      `import { p } from 'path'`,
    ]
    const sorted = sortImports(imports, { groupByType: false, alphabetize: true })
    expect(sorted[0]).toContain(`'fs'`)
    expect(sorted[1]).toContain(`'path'`)
    expect(sorted[2]).toContain(`'zlib'`)
  })

  test('honors custom prefix order', () => {
    const imports = [
      `import { l } from 'lodash'`,
      `import { b } from 'bun'`,
      `import { f } from 'fs'`,
    ]
    const sorted = sortImports(imports, { order: ['bun', 'fs'], groupByType: false, alphabetize: false })
    // bun should come before fs, both before lodash (which has default priority = order.length).
    const idxBun = sorted.findIndex(s => s.includes(`'bun'`))
    const idxFs = sorted.findIndex(s => s.includes(`'fs'`))
    const idxLodash = sorted.findIndex(s => s.includes(`'lodash'`))
    expect(idxBun).toBeLessThan(idxFs)
    expect(idxFs).toBeLessThan(idxLodash)
  })

  test('honors custom regex order pattern (precompiled regex path)', () => {
    // Pre-fix this path was recompiled inside the sort comparator on each call.
    // Verify the regex semantics still hold.
    const imports = [
      `import { x } from '@stacks/util'`,
      `import { y } from 'react'`,
      `import { z } from '@stacks/cli'`,
    ]
    const sorted = sortImports(imports, { order: ['^@stacks/'], groupByType: false, alphabetize: true })
    // Both @stacks/* imports must come before react.
    const idxReact = sorted.findIndex(s => s.includes(`'react'`))
    const idxCli = sorted.findIndex(s => s.includes(`'@stacks/cli'`))
    const idxUtil = sorted.findIndex(s => s.includes(`'@stacks/util'`))
    expect(idxCli).toBeLessThan(idxReact)
    expect(idxUtil).toBeLessThan(idxReact)
    // Alphabetic within the matched group.
    expect(idxCli).toBeLessThan(idxUtil)
  })

  test('falls back to prefix match for an invalid regex pattern', () => {
    // The regex `^[` is invalid; the implementation falls back to prefix-matching the
    // pattern minus the leading `^`. We verify this branch remains exercised.
    const imports = [
      `import { a } from 'normal'`,
      `import { b } from '[bracket'`,
    ]
    const sorted = sortImports(imports, { order: ['^['], groupByType: false, alphabetize: false })
    expect(sorted[0]).toContain(`'[bracket'`)
  })

  test('groupByType=false still preserves alphabetic ordering when alphabetize=true', () => {
    const imports = [
      `import { c } from './c'`,
      `import { a } from './a'`,
      `import { b } from './b'`,
    ]
    const sorted = sortImports(imports, { groupByType: false, alphabetize: true })
    expect(sorted[0]).toContain(`./a`)
    expect(sorted[1]).toContain(`./b`)
    expect(sorted[2]).toContain(`./c`)
  })
})
