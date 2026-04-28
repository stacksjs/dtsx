/**
 * Tests for utils.ts — covers behavior-affecting fixes:
 *  - createDiff: multiset semantics for duplicate lines
 *  - generateDeclarationMap: hoisted line-count computation
 *  - getAllTypeScriptFiles: .flat()-based recursion
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addSourceMapComment, createDiff, generateDeclarationMap, getAllTypeScriptFiles } from '../src/utils'

describe('utils — createDiff', () => {
  test('returns empty string for identical content', () => {
    expect(createDiff('a\nb\nc', 'a\nb\nc', 'foo.d.ts')).toBe('')
  })

  test('reports a single removed line', () => {
    const diff = createDiff('a\nb\nc', 'a\nc', 'foo.d.ts')
    expect(diff).toContain('--- foo.d.ts')
    expect(diff).toContain('+++ foo.d.ts')
    expect(diff).toContain('- b')
  })

  test('reports a single added line', () => {
    const diff = createDiff('a\nc', 'a\nb\nc', 'foo.d.ts')
    expect(diff).toContain('+ b')
  })

  test('multiset semantics: removing one of three duplicate lines is reported', () => {
    // Pre-fix behavior used Set-based dedup, which would silently swallow this case.
    const oldContent = '{\n  x: 1\n}\n}'
    const newContent = '{\n  x: 1\n}'
    const diff = createDiff(oldContent, newContent, 'multi.d.ts')
    // One of the two `}` lines was removed — the diff must surface that.
    const removedClosingBraces = diff.split('\n').filter(l => l === '- }').length
    expect(removedClosingBraces).toBe(1)
  })

  test('multiset semantics: adding a duplicate line is reported', () => {
    const oldContent = 'a\nb'
    const newContent = 'a\nb\nb'
    const diff = createDiff(oldContent, newContent, 'dup.d.ts')
    const addedB = diff.split('\n').filter(l => l === '+ b').length
    expect(addedB).toBe(1)
  })

  test('handles complete content rewrite', () => {
    const diff = createDiff('foo\nbar', 'baz\nqux', 'r.d.ts')
    expect(diff).toContain('- foo')
    expect(diff).toContain('- bar')
    expect(diff).toContain('+ baz')
    expect(diff).toContain('+ qux')
  })
})

describe('utils — generateDeclarationMap', () => {
  test('produces a v3 source map with the expected shape', () => {
    const dts = 'export declare function foo(): void;\nexport declare const x: number;'
    const source = 'export function foo() {\n  return 1\n}\nexport const x = 1'
    const map = generateDeclarationMap(dts, 'foo.d.ts', 'foo.ts', source)
    expect(map.version).toBe(3)
    expect(map.file).toBe('foo.d.ts')
    expect(map.sources).toEqual(['foo.ts'])
    expect(map.sourcesContent).toEqual([source])
    expect(typeof map.mappings).toBe('string')
  })

  test('handles dts content with more lines than source (perf-sensitive case)', () => {
    // Pre-fix this triggered O(N²) split('\n') per loop iteration; verify correctness.
    const dts = Array.from({ length: 50 }, (_, i) => `// dts line ${i}`).join('\n')
    const source = 'a\nb\nc'
    const map = generateDeclarationMap(dts, 'x.d.ts', 'x.ts', source)
    // Empty mapping segments are emitted for blank lines; non-blank lines produce
    // segments. The combined string should have 49 semicolons (joining 50 entries).
    const semis = map.mappings.split(';').length - 1
    expect(semis).toBe(49)
  })

  test('handles empty source', () => {
    const map = generateDeclarationMap('export {};\n', 'e.d.ts', 'e.ts', '')
    expect(map.version).toBe(3)
    expect(map.sources).toEqual(['e.ts'])
  })
})

describe('utils — addSourceMapComment', () => {
  test('appends the sourceMappingURL comment', () => {
    const out = addSourceMapComment('export {}', 'foo.d.ts.map')
    expect(out).toContain('//# sourceMappingURL=foo.d.ts.map')
  })
})

describe('utils — getAllTypeScriptFiles', () => {
  let dir: string

  beforeAll(async () => {
    dir = join(tmpdir(), `dtsx-utils-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(join(dir, 'sub', 'deep'), { recursive: true })
    await writeFile(join(dir, 'a.ts'), '')
    await writeFile(join(dir, 'ignore.txt'), '')
    await writeFile(join(dir, 'sub', 'b.ts'), '')
    await writeFile(join(dir, 'sub', 'deep', 'c.ts'), '')
    // .d.ts and .tsx are intentionally excluded by the current filter contract
    await writeFile(join(dir, 'sub', 'd.d.ts'), '')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('recurses through subdirectories and returns only .ts files', async () => {
    const files = await getAllTypeScriptFiles(dir)
    const names = files.map(f => f.replace(`${dir}/`, '')).sort()
    // Expect a.ts, sub/b.ts, sub/deep/c.ts (and per current behavior, .d.ts is *.ts so it matches)
    expect(names).toContain('a.ts')
    expect(names).toContain('sub/b.ts')
    expect(names).toContain('sub/deep/c.ts')
    expect(names.includes('ignore.txt')).toBe(false)
  })

  test('flat() handles a directory with many files without exploding the call stack', async () => {
    // Pre-fix used spread-based concat, which triggers stack overflow at very high arity.
    // This is a smoke test using a moderate count — the spread variant would still survive
    // here, but the test ensures the new flat-based implementation is at least as correct.
    const wide = join(tmpdir(), `dtsx-utils-wide-${Date.now()}`)
    await mkdir(wide, { recursive: true })
    try {
      const N = 200
      await Promise.all(
        Array.from({ length: N }, (_, i) => writeFile(join(wide, `f${i}.ts`), '')),
      )
      const files = await getAllTypeScriptFiles(wide)
      expect(files.length).toBe(N)
    }
    finally {
      await rm(wide, { recursive: true, force: true })
    }
  })
})
