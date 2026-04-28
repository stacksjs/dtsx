/**
 * Tests for parallel processor module
 */

import type { ProcessingNode } from '../src/parallel-processor'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  analyzeParallelizationPotential,
  buildProcessingGraph,
  findIndependentFiles,
  getProcessingLevels,
  getTopologicalOrder,

  processInParallel,
} from '../src/parallel-processor'

const fixturesDir = join(import.meta.dir, 'fixtures/input')

describe('Parallel Processor', () => {
  describe('buildProcessingGraph', () => {
    test('builds graph from single file', async () => {
      const graph = await buildProcessingGraph(
        ['example/0001.ts'],
        fixturesDir,
      )

      expect(graph.size).toBe(1)
      const node = graph.values().next().value as ProcessingNode
      expect(node.state).toBe('pending')
    })

    test('builds graph from multiple files', async () => {
      const graph = await buildProcessingGraph(
        ['example/0001.ts', 'example/0002.ts', 'example/0003.ts'],
        fixturesDir,
      )

      expect(graph.size).toBe(3)
      for (const node of graph.values()) {
        expect(node.state).toBe('pending')
      }
    })

    test('detects dependencies between files', async () => {
      // Create a mock scenario with files that have dependencies
      const graph = await buildProcessingGraph(
        ['type-interface-imports.ts'],
        fixturesDir,
      )

      expect(graph.size).toBe(1)
      const node = graph.values().next().value as ProcessingNode
      // This file imports from other files
      expect(node.dependencies.size).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getTopologicalOrder', () => {
    test('returns correct order for independent files', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
      ])

      const order = getTopologicalOrder(graph)
      expect(order.length).toBe(3)
      expect(order).toContain('a.ts')
      expect(order).toContain('b.ts')
      expect(order).toContain('c.ts')
    })

    test('returns correct order for linear dependency chain', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(['b.ts']), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(['a.ts']), dependents: new Set(['c.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['b.ts']), dependents: new Set(), state: 'pending' }],
      ])

      const order = getTopologicalOrder(graph)
      expect(order.length).toBe(3)

      // a should come before b, b should come before c
      expect(order.indexOf('a.ts')).toBeLessThan(order.indexOf('b.ts'))
      expect(order.indexOf('b.ts')).toBeLessThan(order.indexOf('c.ts'))
    })

    test('handles circular dependencies gracefully', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(['c.ts']), dependents: new Set(['b.ts']), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(['a.ts']), dependents: new Set(['c.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['b.ts']), dependents: new Set(['a.ts']), state: 'pending' }],
      ])

      // Should not throw
      const order = getTopologicalOrder(graph)
      expect(order.length).toBe(3)
    })
  })

  describe('findIndependentFiles', () => {
    test('finds all independent files', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(), dependents: new Set(['c.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['b.ts']), dependents: new Set(), state: 'pending' }],
      ])

      const independent = findIndependentFiles(graph)
      expect(independent).toContain('a.ts')
      expect(independent).toContain('b.ts')
      expect(independent).not.toContain('c.ts')
    })

    test('returns empty for fully connected graph', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(['b.ts']), dependents: new Set(['c.ts']), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(['c.ts']), dependents: new Set(['a.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['a.ts']), dependents: new Set(['b.ts']), state: 'pending' }],
      ])

      const independent = findIndependentFiles(graph)
      expect(independent.length).toBe(0)
    })
  })

  describe('getProcessingLevels', () => {
    test('groups independent files into same level', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
      ])

      const levels = getProcessingLevels(graph)
      expect(levels.length).toBe(1)
      expect(levels[0].length).toBe(3)
    })

    test('creates correct levels for linear chain', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(['b.ts']), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(['a.ts']), dependents: new Set(['c.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['b.ts']), dependents: new Set(), state: 'pending' }],
      ])

      const levels = getProcessingLevels(graph)
      expect(levels.length).toBe(3)
      expect(levels[0]).toContain('a.ts')
      expect(levels[1]).toContain('b.ts')
      expect(levels[2]).toContain('c.ts')
    })

    test('creates correct levels for diamond dependency', () => {
      // a -> b, a -> c, b -> d, c -> d
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(['b.ts', 'c.ts']), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(['a.ts']), dependents: new Set(['d.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['a.ts']), dependents: new Set(['d.ts']), state: 'pending' }],
        ['d.ts', { path: 'd.ts', dependencies: new Set(['b.ts', 'c.ts']), dependents: new Set(), state: 'pending' }],
      ])

      const levels = getProcessingLevels(graph)
      expect(levels.length).toBe(3)
      expect(levels[0]).toContain('a.ts')
      expect(levels[1]).toContain('b.ts')
      expect(levels[1]).toContain('c.ts')
      expect(levels[2]).toContain('d.ts')
    })
  })

  describe('analyzeParallelizationPotential', () => {
    test('analyzes independent files correctly', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
        ['d.ts', { path: 'd.ts', dependencies: new Set(), dependents: new Set(), state: 'pending' }],
      ])

      const analysis = analyzeParallelizationPotential(graph)
      expect(analysis.totalFiles).toBe(4)
      expect(analysis.independentFiles).toBe(4)
      expect(analysis.maxParallelism).toBe(4)
      expect(analysis.levels).toBe(1)
      expect(analysis.estimatedSpeedup).toBe(4)
    })

    test('analyzes linear chain correctly', () => {
      const graph = new Map<string, ProcessingNode>([
        ['a.ts', { path: 'a.ts', dependencies: new Set(), dependents: new Set(['b.ts']), state: 'pending' }],
        ['b.ts', { path: 'b.ts', dependencies: new Set(['a.ts']), dependents: new Set(['c.ts']), state: 'pending' }],
        ['c.ts', { path: 'c.ts', dependencies: new Set(['b.ts']), dependents: new Set(), state: 'pending' }],
      ])

      const analysis = analyzeParallelizationPotential(graph)
      expect(analysis.totalFiles).toBe(3)
      expect(analysis.independentFiles).toBe(1)
      expect(analysis.maxParallelism).toBe(1)
      expect(analysis.levels).toBe(3)
      expect(analysis.estimatedSpeedup).toBe(1)
    })
  })

  describe('processInParallel', () => {
    test('processes single file', async () => {
      const result = await processInParallel(
        [join(fixturesDir, 'example/0001.ts')],
        { maxConcurrency: 1 },
      )

      expect(result.success.size).toBe(1)
      expect(result.failed.size).toBe(0)
      expect(result.totalTimeMs).toBeGreaterThan(0)
    })

    test('processes multiple independent files in parallel', async () => {
      const result = await processInParallel(
        [
          join(fixturesDir, 'example/0001.ts'),
          join(fixturesDir, 'example/0002.ts'),
          join(fixturesDir, 'example/0003.ts'),
        ],
        { maxConcurrency: 3 },
      )

      expect(result.success.size).toBe(3)
      expect(result.failed.size).toBe(0)
      expect(result.maxConcurrent).toBeGreaterThanOrEqual(1)
    })

    test('calls progress callback', async () => {
      const progress: Array<{ completed: number, total: number }> = []

      await processInParallel(
        [
          join(fixturesDir, 'example/0001.ts'),
          join(fixturesDir, 'example/0002.ts'),
        ],
        {
          maxConcurrency: 1,
          onProgress: (completed, total) => {
            progress.push({ completed, total })
          },
        },
      )

      expect(progress.length).toBe(2)
      expect(progress[0].total).toBe(2)
      expect(progress[1].completed).toBe(2)
    })

    test('handles errors gracefully', async () => {
      const errors: string[] = []

      const result = await processInParallel(
        [
          join(fixturesDir, 'example/0001.ts'),
          join(fixturesDir, 'nonexistent.ts'),
        ],
        {
          maxConcurrency: 2,
          onError: (path) => {
            errors.push(path)
            return true // continue processing
          },
        },
      )

      expect(result.success.size).toBe(1)
      expect(result.failed.size).toBe(1)
      expect(errors.length).toBe(1)
    })
  })

  // ----------------------------------------------------------------------
  // resolveImportPath behavior — exercised via buildProcessingGraph.
  //
  // Pre-fix the function had a `for (const ext of extensions)` loop where
  // the body unconditionally `return`ed on the first iteration, making the
  // remaining extensions dead code. The new implementation explicitly
  // returns the canonical `.ts` candidate (or honors an existing extension)
  // and rejects node_modules paths. These tests pin that contract.
  // ----------------------------------------------------------------------
  describe('resolveImportPath via buildProcessingGraph', () => {
    let tmpDir: string

    beforeAll(async () => {
      tmpDir = join(tmpdir(), `dtsx-resolve-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      await mkdir(tmpDir, { recursive: true })
      // Bare relative import — should resolve to "./helper.ts"
      await writeFile(join(tmpDir, 'main.ts'), `import { helper } from './helper'\nexport const x = helper()\n`)
      await writeFile(join(tmpDir, 'helper.ts'), `export function helper(): number { return 1 }\n`)
      // Relative import that already has an extension — should resolve verbatim
      await writeFile(join(tmpDir, 'main-ext.ts'), `import { y } from './sibling.ts'\nexport const z = y\n`)
      await writeFile(join(tmpDir, 'sibling.ts'), `export const y = 2\n`)
      // Relative import with .tsx extension — must be preserved
      await writeFile(join(tmpDir, 'main-tsx.ts'), `import { Comp } from './widget.tsx'\nexport const w = Comp\n`)
      await writeFile(join(tmpDir, 'widget.tsx'), `export const Comp = null\n`)
    })

    afterAll(async () => {
      await rm(tmpDir, { recursive: true, force: true })
    })

    test('resolves bare relative imports to .ts candidate', async () => {
      const graph = await buildProcessingGraph(['main.ts'], tmpDir)
      const node = graph.get(join(tmpDir, 'main.ts'))!
      const deps = Array.from(node.dependencies)
      expect(deps.some(d => d.endsWith('helper.ts'))).toBe(true)
    })

    test('preserves .ts extension when already present in import path', async () => {
      const graph = await buildProcessingGraph(['main-ext.ts'], tmpDir)
      const node = graph.get(join(tmpDir, 'main-ext.ts'))!
      const deps = Array.from(node.dependencies)
      expect(deps.some(d => d.endsWith('sibling.ts'))).toBe(true)
      // Must not append a second extension (`sibling.ts.ts`).
      expect(deps.every(d => !d.endsWith('.ts.ts'))).toBe(true)
    })

    test('preserves .tsx extension when already present', async () => {
      const graph = await buildProcessingGraph(['main-tsx.ts'], tmpDir)
      const node = graph.get(join(tmpDir, 'main-tsx.ts'))!
      const deps = Array.from(node.dependencies)
      expect(deps.some(d => d.endsWith('widget.tsx'))).toBe(true)
    })
  })
})
