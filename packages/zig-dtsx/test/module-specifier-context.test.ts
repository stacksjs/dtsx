import { expect, test } from 'bun:test'
import * as native from '../src/index'

function contextFor(source: string): native.SourceEmissionContext {
  return {
    version: 1,
    moduleSpecifierMode: 'node',
    sourceFile: '/library/src/index.ts',
    outputFile: '/library/dist/index.d.ts',
    sourceHash: new Bun.CryptoHasher('sha256').update(source).digest('hex'),
    rewrites: [{
      specifier: './options',
      resolvedSource: '/library/src/options.ts',
      declarationOutput: '/library/dist/options.d.ts',
      emittedSpecifier: './options.js',
    }],
  }
}

// This public native seam catches contextual emission and actual native
// availability. Package graph planning and delivery are qualified separately.
test('the native contextual emitter uses a resolved Node output mapping without changing the source-only API', () => {
  expect(native.ZIG_AVAILABLE).toBe(true)
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const source = "export type { Options } from './options'\n"
  const context = contextFor(source)
  expect(native.processSource(source)).toContain("from './options'")
  expect(native.processSourceWithContext(source, context)).toContain("from './options.js'")
})

test('native context rewrites actual import types inside template type substitutions', () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const source = "export type Label = `name:${import('./options').Name}`\n"
  expect(native.processSource(source)).toContain("import('./options').Name")
  expect(native.processSourceWithContext(source, contextFor(source))).toContain("import('./options.js').Name")
})

test('the public native API distinguishes invalid, unsupported and unresolved contexts', () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const source = "export type { Options } from './options'\n"
  expect(() => native.processSourceWithContext(source, { ...contextFor(source), sourceHash: '0'.repeat(64) }))
    .toThrow('Invalid native emission context')
  expect(() => native.processSourceWithContext(source, { ...contextFor(source), version: 2 } as unknown as native.SourceEmissionContext))
    .toThrow('Unsupported native emission context version')
  expect(() => native.processSourceWithContext(source, { ...contextFor(source), rewrites: [] }))
    .toThrow('Unresolved module specifier in native emission context')
  const conflict = contextFor(source)
  conflict.rewrites.push({ ...conflict.rewrites[0], emittedSpecifier: './different.js' })
  expect(() => native.processSourceWithContext(source, conflict)).toThrow('Invalid native emission context')
  expect(() => native.processSourceWithContext(source, undefined as unknown as native.SourceEmissionContext))
    .toThrow('Invalid native emission context')
  expect(native.processSourceWithContext('', contextFor(''))).toBe('')
})

test('native context rejects empty or NUL-bearing identities and mappings before emission', () => {
  expect(native.ZIG_CONTEXT_AVAILABLE).toBe(true)
  const source = "export type { Options } from './options'\n"
  for (const invalid of ['', 'bad\0path']) {
    for (const field of ['sourceFile', 'outputFile'] as const) {
      const context = contextFor(source)
      context[field] = invalid
      expect(() => native.processSourceWithContext(source, context)).toThrow('Invalid native emission context')
    }
    for (const field of ['specifier', 'resolvedSource', 'declarationOutput', 'emittedSpecifier'] as const) {
      const context = contextFor(source)
      context.rewrites[0][field] = invalid
      expect(() => native.processSourceWithContext(source, context)).toThrow('Invalid native emission context')
    }
  }
  expect(() => native.processSourceWithContext('', { ...contextFor(''), outputFile: 'bad\0path' }))
    .toThrow('Invalid native emission context')
})
