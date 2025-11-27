/**
 * Tests for type and import tracking
 */

import type { Declaration } from '../src/types'
import { describe, expect, test } from 'bun:test'
import {
  analyzeImports,
  analyzeTypes,
  createTracker,
  trackDeclarations,
  Tracker,
} from '../src/tracking'

describe('Tracking Module', () => {
  describe('Tracker', () => {
    test('creates tracker with default config', () => {
      const tracker = createTracker()
      expect(tracker).toBeInstanceOf(Tracker)
    })

    test('creates tracker with custom config', () => {
      const tracker = createTracker({
        types: true,
        relationships: true,
        usage: true,
      })
      expect(tracker).toBeInstanceOf(Tracker)
    })

    test('tracks type declarations', () => {
      const tracker = createTracker({ types: true })

      const decl: Declaration = {
        kind: 'interface',
        name: 'User',
        text: 'interface User { name: string }',
        isExported: true,
      }

      tracker.trackType(decl, 'test.ts')

      const results = tracker.getResults()
      expect(results.types.size).toBe(1)
      expect(results.types.has('User')).toBe(true)
    })

    test('tracks type usage', () => {
      const tracker = createTracker({ types: true, usage: true })

      const typeDecl: Declaration = {
        kind: 'interface',
        name: 'User',
        text: 'interface User { name: string }',
        isExported: true,
      }

      tracker.trackType(typeDecl, 'types.ts')
      tracker.trackTypeUsage('User', 'getUser', 'api.ts')

      const results = tracker.getResults()
      const userType = results.types.get('User')
      expect(userType?.usedBy.has('getUser')).toBe(true)
    })

    test('tracks type relationships', () => {
      const tracker = createTracker({ types: true, relationships: true })

      const baseDecl: Declaration = {
        kind: 'interface',
        name: 'Entity',
        text: 'interface Entity { id: string }',
        isExported: true,
      }

      const childDecl: Declaration = {
        kind: 'interface',
        name: 'User',
        text: 'interface User extends Entity { name: string }',
        isExported: true,
        extends: 'Entity',
      }

      tracker.trackType(baseDecl, 'types.ts')
      tracker.trackType(childDecl, 'types.ts')

      const results = tracker.getResults()
      expect(results.relationships.length).toBeGreaterThan(0)

      const extendsRel = results.relationships.find(
        r => r.from === 'User' && r.to === 'Entity' && r.kind === 'extends',
      )
      expect(extendsRel).toBeDefined()
    })

    test('tracks imports', () => {
      const tracker = createTracker({ imports: true })

      tracker.trackImport('./types', ['User', 'Role'], false, 'api.ts')

      const results = tracker.getResults()
      expect(results.imports.size).toBe(1)
      expect(results.imports.has('api.ts')).toBe(true)
    })

    test('tracks import usage', () => {
      const tracker = createTracker({ imports: true, importUsage: true })

      tracker.trackImport('./types', ['User', 'Role'], false, 'api.ts')
      tracker.trackImportUsage('User', 'api.ts')

      const results = tracker.getResults()
      const apiImports = results.imports.get('api.ts')
      expect(apiImports).toBeDefined()
      expect(apiImports?.[0].usedSpecifiers.has('User')).toBe(true)
      expect(apiImports?.[0].unusedSpecifiers.has('Role')).toBe(true)
    })

    test('finds unused types', () => {
      const tracker = createTracker({ types: true, usage: true })

      const usedDecl: Declaration = {
        kind: 'interface',
        name: 'UsedType',
        text: 'interface UsedType {}',
        isExported: true,
      }

      const unusedDecl: Declaration = {
        kind: 'interface',
        name: 'UnusedType',
        text: 'interface UnusedType {}',
        isExported: true,
      }

      tracker.trackType(usedDecl, 'types.ts')
      tracker.trackType(unusedDecl, 'types.ts')
      tracker.trackTypeUsage('UsedType', 'someFunc', 'api.ts')

      const results = tracker.getResults()
      expect(results.unusedTypes).toContain('UnusedType')
      expect(results.unusedTypes).not.toContain('UsedType')
    })

    test('finds unused imports', () => {
      const tracker = createTracker({ imports: true, importUsage: true })

      tracker.trackImport('./used', ['A'], false, 'file.ts')
      tracker.trackImport('./unused', ['B'], false, 'file.ts')
      tracker.trackImportUsage('A', 'file.ts')

      const results = tracker.getResults()
      expect(results.unusedImports.length).toBe(1)
      expect(results.unusedImports[0].source).toBe('./unused')
    })

    test('calculates statistics', () => {
      const tracker = createTracker({
        types: true,
        imports: true,
        relationships: true,
        usage: true,
        importUsage: true,
      })

      const decl: Declaration = {
        kind: 'interface',
        name: 'Test',
        text: 'interface Test {}',
        isExported: true,
      }

      tracker.trackType(decl, 'test.ts')
      tracker.trackImport('./types', ['A', 'B'], false, 'test.ts')
      tracker.trackImportUsage('A', 'test.ts')

      const results = tracker.getResults()
      expect(results.statistics.totalTypes).toBe(1)
      expect(results.statistics.totalImports).toBe(1)
    })

    test('formats results as string', () => {
      const tracker = createTracker({ types: true })

      const decl: Declaration = {
        kind: 'interface',
        name: 'User',
        text: 'interface User {}',
        isExported: true,
      }

      tracker.trackType(decl, 'types.ts')

      const formatted = tracker.formatResults()
      expect(formatted).toContain('Tracking Results')
      expect(formatted).toContain('Statistics')
      expect(formatted).toContain('Total types: 1')
    })

    test('clears tracking data', () => {
      const tracker = createTracker({ types: true })

      const decl: Declaration = {
        kind: 'interface',
        name: 'User',
        text: 'interface User {}',
        isExported: true,
      }

      tracker.trackType(decl, 'types.ts')
      expect(tracker.getResults().types.size).toBe(1)

      tracker.clear()
      expect(tracker.getResults().types.size).toBe(0)
    })
  })

  describe('trackDeclarations', () => {
    test('tracks multiple declarations', () => {
      const tracker = createTracker({
        types: true,
        imports: true,
        usage: true,
      })

      const declarations: Declaration[] = [
        {
          kind: 'interface',
          name: 'User',
          text: 'interface User {}',
          isExported: true,
        },
        {
          kind: 'type',
          name: 'ID',
          text: 'type ID = string',
          isExported: true,
        },
        {
          kind: 'import',
          name: 'external',
          text: 'import { External } from "external"',
          isExported: false,
          source: 'external',
          specifiers: [{ name: 'External' }],
        },
      ]

      trackDeclarations(declarations, 'test.ts', tracker)

      const results = tracker.getResults()
      expect(results.types.size).toBe(2)
      expect(results.imports.size).toBe(1)
    })

    test('tracks extends relationships', () => {
      const tracker = createTracker({
        types: true,
        usage: true,
        relationships: true,
      })

      const declarations: Declaration[] = [
        {
          kind: 'interface',
          name: 'Base',
          text: 'interface Base {}',
          isExported: true,
        },
        {
          kind: 'interface',
          name: 'Derived',
          text: 'interface Derived extends Base {}',
          isExported: true,
          extends: 'Base',
        },
      ]

      trackDeclarations(declarations, 'test.ts', tracker)

      const results = tracker.getResults()
      expect(results.relationships.length).toBeGreaterThan(0)
    })

    test('tracks implements relationships', () => {
      const tracker = createTracker({
        types: true,
        usage: true,
        relationships: true,
      })

      const declarations: Declaration[] = [
        {
          kind: 'interface',
          name: 'Printable',
          text: 'interface Printable {}',
          isExported: true,
        },
        {
          kind: 'class',
          name: 'Document',
          text: 'class Document implements Printable {}',
          isExported: true,
          implements: ['Printable'],
        },
      ]

      trackDeclarations(declarations, 'test.ts', tracker)

      const results = tracker.getResults()
      const implRel = results.relationships.find(
        r => r.kind === 'implements',
      )
      expect(implRel).toBeDefined()
    })
  })

  describe('analyzeTypes', () => {
    test('analyzes types from multiple files', () => {
      const fileDeclarations = new Map<string, Declaration[]>([
        ['types.ts', [
          {
            kind: 'interface',
            name: 'User',
            text: 'interface User {}',
            isExported: true,
          },
        ]],
        ['api.ts', [
          {
            kind: 'function',
            name: 'getUser',
            text: 'function getUser(): User',
            isExported: true,
            typeAnnotation: 'User',
          },
        ]],
      ])

      const results = analyzeTypes(fileDeclarations)
      expect(results.types.size).toBeGreaterThan(0)
    })
  })

  describe('analyzeImports', () => {
    test('analyzes imports from multiple files', () => {
      const fileDeclarations = new Map<string, Declaration[]>([
        ['file1.ts', [
          {
            kind: 'import',
            name: 'lodash',
            text: 'import { map } from "lodash"',
            isExported: false,
            source: 'lodash',
            specifiers: [{ name: 'map' }],
          },
        ]],
        ['file2.ts', [
          {
            kind: 'import',
            name: 'lodash',
            text: 'import { filter } from "lodash"',
            isExported: false,
            source: 'lodash',
            specifiers: [{ name: 'filter' }],
          },
        ]],
      ])

      const results = analyzeImports(fileDeclarations)
      expect(results.imports.size).toBe(2)
    })
  })

  describe('Circular Reference Detection', () => {
    test('detects simple circular references', () => {
      const tracker = createTracker({
        types: true,
        relationships: true,
      })

      // A extends B, B extends A
      const declarations: Declaration[] = [
        {
          kind: 'interface',
          name: 'A',
          text: 'interface A extends B {}',
          isExported: true,
          extends: 'B',
        },
        {
          kind: 'interface',
          name: 'B',
          text: 'interface B extends A {}',
          isExported: true,
          extends: 'A',
        },
      ]

      trackDeclarations(declarations, 'test.ts', tracker)

      const results = tracker.getResults()
      expect(results.circularReferences.length).toBeGreaterThan(0)
    })
  })
})
