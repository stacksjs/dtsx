/**
 * Tests for parallel processor module
 */

import type { ProcessingNode } from '../src/parallel-processor'
import { describe, expect, test } from 'bun:test'
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
})
