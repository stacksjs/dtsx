/**
 * Dependency Graph-based Parallel Processor
 *
 * Builds a dependency graph and processes independent files in parallel
 * while respecting dependencies between files.
 */

import type { DtsGenerationConfig, ProcessingContext } from './types'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { extractDeclarations } from './extractor'
import { processDeclarations } from './processor'

/**
 * Node in the processing dependency graph
 */
export interface ProcessingNode {
  /** File path */
  path: string
  /** Dependencies (files this file imports from) */
  dependencies: Set<string>
  /** Dependents (files that import from this file) */
  dependents: Set<string>
  /** Processing state */
  state: 'pending' | 'processing' | 'completed' | 'failed'
  /** Generated declarations */
  result?: string
  /** Error if failed */
  error?: Error
  /** Processing duration in ms */
  duration?: number
}

/**
 * Configuration for parallel processing
 */
export interface ParallelProcessorConfig {
  /** Maximum concurrent file processing */
  maxConcurrency?: number
  /** Root directory for resolution */
  rootDir?: string
  /** Generation config */
  config?: Partial<DtsGenerationConfig>
  /** Progress callback */
  onProgress?: (completed: number, total: number, current: string) => void
  /** Error callback (return true to continue, false to abort) */
  onError?: (path: string, error: Error) => boolean
}

/**
 * Result of parallel processing
 */
export interface ParallelProcessingResult {
  /** Successfully processed files */
  success: Map<string, string>
  /** Failed files with errors */
  failed: Map<string, Error>
  /** Total processing time in ms */
  totalTimeMs: number
  /** Files processed in parallel (max concurrent at any point) */
  maxConcurrent: number
  /** Processing order (for debugging) */
  processingOrder: string[]
}

/**
 * Build dependency graph from source files
 */
export async function buildProcessingGraph(
  files: string[],
  rootDir: string = process.cwd(),
): Promise<Map<string, ProcessingNode>> {
  const graph = new Map<string, ProcessingNode>()

  // First pass: create nodes and extract dependencies
  for (const filePath of files) {
    const absolutePath = resolve(rootDir, filePath)
    const dependencies = await extractFileDependencies(absolutePath, rootDir)

    graph.set(absolutePath, {
      path: absolutePath,
      dependencies,
      dependents: new Set(),
      state: 'pending',
    })
  }

  // Second pass: build reverse dependencies (dependents)
  for (const [path, node] of graph) {
    for (const dep of node.dependencies) {
      const depNode = graph.get(dep)
      if (depNode) {
        depNode.dependents.add(path)
      }
    }
  }

  return graph
}

/**
 * Extract file dependencies using TypeScript parser
 */
async function extractFileDependencies(
  filePath: string,
  rootDir: string,
): Promise<Set<string>> {
  const dependencies = new Set<string>()

  try {
    const content = await readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    const fileDir = dirname(filePath)

    // Walk AST to find imports
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier
        if (ts.isStringLiteral(moduleSpecifier)) {
          const importPath = moduleSpecifier.text

          // Only track relative imports (local dependencies)
          if (importPath.startsWith('.') || importPath.startsWith('/')) {
            const resolved = resolveImportPath(importPath, fileDir, rootDir)
            if (resolved) {
              dependencies.add(resolved)
            }
          }
        }
      }
      else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        if (ts.isStringLiteral(node.moduleSpecifier)) {
          const exportPath = node.moduleSpecifier.text

          if (exportPath.startsWith('.') || exportPath.startsWith('/')) {
            const resolved = resolveImportPath(exportPath, fileDir, rootDir)
            if (resolved) {
              dependencies.add(resolved)
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }
  catch {
    // If we can't read the file, return empty dependencies
  }

  return dependencies
}

/**
 * Resolve import path to absolute path
 */
function resolveImportPath(
  importPath: string,
  fromDir: string,
  _rootDir: string,
): string | null {
  const extensions = ['.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx']

  // Try to resolve with various extensions
  const basePath = resolve(fromDir, importPath)

  for (const ext of extensions) {
    const fullPath = basePath + ext
    // Note: We don't check if file exists here for performance
    // The graph building will handle missing files gracefully
    if (!fullPath.includes('node_modules')) {
      return fullPath
    }
  }

  // If path already has extension
  if (importPath.endsWith('.ts') || importPath.endsWith('.tsx')) {
    return basePath
  }

  return null
}

/**
 * Get files ready for processing (no pending dependencies)
 */
function getReadyFiles(graph: Map<string, ProcessingNode>): string[] {
  const ready: string[] = []

  for (const [path, node] of graph) {
    if (node.state !== 'pending')
      continue

    // Check if all dependencies are completed
    let allDepsCompleted = true
    for (const dep of node.dependencies) {
      const depNode = graph.get(dep)
      // If dependency doesn't exist in graph (external) or is completed, OK
      if (depNode && depNode.state !== 'completed') {
        allDepsCompleted = false
        break
      }
    }

    if (allDepsCompleted) {
      ready.push(path)
    }
  }

  return ready
}

/**
 * Process a single file
 */
async function processFile(
  filePath: string,
  config: Partial<DtsGenerationConfig> = {},
): Promise<string> {
  const content = await readFile(filePath, 'utf-8')
  const declarations = extractDeclarations(content, filePath, config.keepComments ?? true)

  const context: ProcessingContext = {
    filePath,
    sourceCode: content,
    declarations,
    imports: new Map(),
    exports: new Set(),
    usedTypes: new Set(),
  }

  return processDeclarations(declarations, context)
}

/**
 * Process files in parallel respecting dependencies
 */
export async function processInParallel(
  files: string[],
  options: ParallelProcessorConfig = {},
): Promise<ParallelProcessingResult> {
  const startTime = performance.now()
  const {
    maxConcurrency = 4,
    rootDir = process.cwd(),
    config = {},
    onProgress,
    onError,
  } = options

  // Build dependency graph
  const graph = await buildProcessingGraph(files, rootDir)

  const success = new Map<string, string>()
  const failed = new Map<string, Error>()
  const processingOrder: string[] = []
  let maxConcurrent = 0
  let currentConcurrent = 0
  let completed = 0
  const total = graph.size

  // Process until all files are done
  while (completed < total) {
    // Get files ready for processing
    const ready = getReadyFiles(graph)

    if (ready.length === 0) {
      // Check for circular dependencies or all failed
      const pending = [...graph.values()].filter(n => n.state === 'pending')
      if (pending.length > 0) {
        // Mark remaining as failed due to circular dependency
        for (const node of pending) {
          node.state = 'failed'
          node.error = new Error('Circular dependency detected or dependency failed')
          failed.set(node.path, node.error)
          completed++
        }
      }
      break
    }

    // Process ready files up to concurrency limit
    const batch = ready.slice(0, maxConcurrency - currentConcurrent)

    // Mark as processing
    for (const path of batch) {
      const node = graph.get(path)!
      node.state = 'processing'
      currentConcurrent++
    }

    maxConcurrent = Math.max(maxConcurrent, currentConcurrent)

    // Process batch concurrently
    const promises = batch.map(async (path) => {
      const node = graph.get(path)!
      const startMs = performance.now()

      try {
        const result = await processFile(path, config)
        node.state = 'completed'
        node.result = result
        node.duration = performance.now() - startMs
        success.set(path, result)
        processingOrder.push(path)
      }
      catch (error) {
        node.state = 'failed'
        node.error = error instanceof Error ? error : new Error(String(error))
        node.duration = performance.now() - startMs
        failed.set(path, node.error)

        // Check if we should continue
        if (onError && !onError(path, node.error)) {
          throw new Error('Processing aborted by error handler')
        }
      }
      finally {
        currentConcurrent--
        completed++
        onProgress?.(completed, total, path)
      }
    })

    await Promise.all(promises)
  }

  return {
    success,
    failed,
    totalTimeMs: performance.now() - startTime,
    maxConcurrent,
    processingOrder,
  }
}

/**
 * Get topological processing order (respects dependencies)
 */
export function getTopologicalOrder(graph: Map<string, ProcessingNode>): string[] {
  const order: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(path: string): void {
    if (visited.has(path))
      return
    if (visiting.has(path)) {
      // Circular dependency - skip
      return
    }

    visiting.add(path)

    const node = graph.get(path)
    if (node) {
      for (const dep of node.dependencies) {
        if (graph.has(dep)) {
          visit(dep)
        }
      }
    }

    visiting.delete(path)
    visited.add(path)
    order.push(path)
  }

  for (const path of graph.keys()) {
    visit(path)
  }

  return order
}

/**
 * Find files that can be processed independently (no dependencies on other files in the set)
 */
export function findIndependentFiles(graph: Map<string, ProcessingNode>): string[] {
  const independent: string[] = []

  for (const [path, node] of graph) {
    // A file is independent if it has no dependencies within the graph
    let hasInternalDep = false
    for (const dep of node.dependencies) {
      if (graph.has(dep)) {
        hasInternalDep = true
        break
      }
    }

    if (!hasInternalDep) {
      independent.push(path)
    }
  }

  return independent
}

/**
 * Get processing levels (files at same level can be processed in parallel)
 */
export function getProcessingLevels(graph: Map<string, ProcessingNode>): string[][] {
  const levels: string[][] = []
  const processed = new Set<string>()

  while (processed.size < graph.size) {
    const level: string[] = []

    for (const [path, node] of graph) {
      if (processed.has(path))
        continue

      // Check if all dependencies are processed
      let allDepsProcessed = true
      for (const dep of node.dependencies) {
        if (graph.has(dep) && !processed.has(dep)) {
          allDepsProcessed = false
          break
        }
      }

      if (allDepsProcessed) {
        level.push(path)
      }
    }

    if (level.length === 0) {
      // Circular dependency - add remaining files
      for (const path of graph.keys()) {
        if (!processed.has(path)) {
          level.push(path)
        }
      }
    }

    for (const path of level) {
      processed.add(path)
    }

    levels.push(level)
  }

  return levels
}

/**
 * Analyze graph for parallelization potential
 */
export function analyzeParallelizationPotential(
  graph: Map<string, ProcessingNode>,
): {
    totalFiles: number
    independentFiles: number
    maxParallelism: number
    levels: number
    estimatedSpeedup: number
  } {
  const levels = getProcessingLevels(graph)
  const independent = findIndependentFiles(graph)
  const maxParallelism = Math.max(...levels.map(l => l.length))

  // Estimated speedup: if we had infinite cores, how much faster?
  // This is the ratio of total files to the number of levels (critical path)
  const estimatedSpeedup = graph.size / levels.length

  return {
    totalFiles: graph.size,
    independentFiles: independent.length,
    maxParallelism,
    levels: levels.length,
    estimatedSpeedup,
  }
}
