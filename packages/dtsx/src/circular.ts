/**
 * Circular Dependency Detection Module
 *
 * Detects and reports circular type dependencies in TypeScript source files.
 * This is important for avoiding infinite loops during type resolution.
 */

import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

/**
 * A node in the dependency graph
 */
export interface DependencyNode {
  /** File path */
  path: string
  /** Exported symbols from this file */
  exports: Set<string>
  /** Imported symbols and their sources */
  imports: Map<string, string>
  /** Direct dependencies (files this file imports from) */
  dependencies: Set<string>
  /** Reverse dependencies (files that import from this file) */
  dependents: Set<string>
}

/**
 * A circular dependency chain
 */
export interface CircularDependency {
  /** The cycle path (file1 -> file2 -> file3 -> file1) */
  chain: string[]
  /** Symbols involved in the cycle */
  symbols: string[]
  /** Severity: 'error' for type cycles, 'warning' for value-only cycles */
  severity: 'error' | 'warning'
  /** Description of why this cycle is problematic */
  reason: string
}

/**
 * Result of circular dependency analysis
 */
export interface CircularAnalysisResult {
  /** Whether any circular dependencies were found */
  hasCircular: boolean
  /** All circular dependencies found */
  cycles: CircularDependency[]
  /** The full dependency graph */
  graph: Map<string, DependencyNode>
  /** Files analyzed */
  filesAnalyzed: string[]
  /** Analysis duration in ms */
  durationMs: number
}

/**
 * Options for circular dependency detection
 */
export interface CircularDetectionOptions {
  /** Root directory for resolution */
  rootDir?: string
  /** Ignore patterns (glob-style) */
  ignore?: string[]
  /** Only report type-level cycles (ignore value-only cycles) */
  typesOnly?: boolean
  /** Maximum depth to search for cycles */
  maxDepth?: number
  /** Include node_modules in analysis */
  includeNodeModules?: boolean
}

/**
 * Build a dependency graph from TypeScript source files
 */
export async function buildDependencyGraph(
  files: string[],
  options: CircularDetectionOptions = {},
): Promise<Map<string, DependencyNode>> {
  const graph = new Map<string, DependencyNode>()
  const rootDir = options.rootDir || process.cwd()

  // Parallelize file analysis — previously serialized I/O dominated build time
  // for large projects (every readFile waited on the previous one).
  const targets: string[] = []
  for (const filePath of files) {
    if (options.ignore?.some(pattern => matchPattern(filePath, pattern))) continue
    if (!options.includeNodeModules && filePath.includes('node_modules')) continue
    targets.push(filePath)
  }

  const nodes = await Promise.all(targets.map(p => analyzeFile(p, rootDir)))
  for (let i = 0; i < targets.length; i++) {
    const node = nodes[i]
    if (node) graph.set(targets[i], node)
  }

  // Build reverse dependencies
  for (const [filePath, node] of graph) {
    for (const dep of node.dependencies) {
      const depNode = graph.get(dep)
      if (depNode) {
        depNode.dependents.add(filePath)
      }
    }
  }

  return graph
}

/**
 * Analyze a single file for its imports and exports
 */
async function analyzeFile(filePath: string, rootDir: string): Promise<DependencyNode | null> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    )

    const node: DependencyNode = {
      path: filePath,
      exports: new Set(),
      imports: new Map(),
      dependencies: new Set(),
      dependents: new Set(),
    }

    // Analyze the AST
    ts.forEachChild(sourceFile, (child) => {
      analyzeNode(child, node, filePath, rootDir)
    })

    return node
  }
  catch {
    return null
  }
}

/**
 * Analyze an AST node for imports/exports
 */
function analyzeNode(
  node: ts.Node,
  depNode: DependencyNode,
  filePath: string,
  rootDir: string,
): void {
  // Handle import declarations
  if (ts.isImportDeclaration(node)) {
    const moduleSpecifier = node.moduleSpecifier
    if (ts.isStringLiteral(moduleSpecifier)) {
      const importPath = resolveImportPath(moduleSpecifier.text, filePath, rootDir)
      if (importPath) {
        depNode.dependencies.add(importPath)

        // Track imported symbols
        const importClause = node.importClause
        if (importClause) {
          if (importClause.name) {
            depNode.imports.set(importClause.name.text, importPath)
          }
          if (importClause.namedBindings) {
            if (ts.isNamedImports(importClause.namedBindings)) {
              for (const element of importClause.namedBindings.elements) {
                depNode.imports.set(element.name.text, importPath)
              }
            }
            else if (ts.isNamespaceImport(importClause.namedBindings)) {
              depNode.imports.set(importClause.namedBindings.name.text, importPath)
            }
          }
        }
      }
    }
  }

  // Handle export declarations
  if (ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const exportPath = resolveImportPath(node.moduleSpecifier.text, filePath, rootDir)
      if (exportPath) {
        depNode.dependencies.add(exportPath)
      }
    }

    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        depNode.exports.add(element.name.text)
      }
    }
  }

  // Handle named exports (export function, export class, etc.)
  if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node)) {
    depNode.exports.add(node.name.text)
  }
  if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
    depNode.exports.add(node.name.text)
  }
  if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
    depNode.exports.add(node.name.text)
  }
  if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
    depNode.exports.add(node.name.text)
  }
  if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
    depNode.exports.add(node.name.text)
  }
  if (ts.isVariableStatement(node) && hasExportModifier(node)) {
    for (const decl of node.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) {
        depNode.exports.add(decl.name.text)
      }
    }
  }
}

/**
 * Check if a node has an export modifier
 */
function hasExportModifier(node: ts.Node): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
}

/**
 * Resolve an import path to an absolute path
 */
function resolveImportPath(
  specifier: string,
  fromFile: string,
  _rootDir: string,
): string | null {
  // Skip external modules
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null
  }

  const dir = dirname(fromFile)
  const resolved = resolve(dir, specifier)
  if (resolved.includes('node_modules')) return null

  // If the specifier already has a .ts/.tsx extension, normalize to .ts.
  // Pre-fix: the for-loop body returned on its first iteration, making the
  // remaining extension candidates dead code — preserve the single-shot
  // behaviour callers depended on while removing the unreachable branches.
  if (resolved.endsWith('.ts') || resolved.endsWith('.tsx')) {
    return resolved.replace(/\.tsx?$/, '.ts')
  }
  return `${resolved}.ts`
}

/**
 * Match a file path against a glob-like pattern
 */
function matchPattern(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(regex).test(filePath)
}

/**
 * Detect circular dependencies in a dependency graph
 */
export function detectCircularDependencies(
  graph: Map<string, DependencyNode>,
  options: CircularDetectionOptions = {},
): CircularDependency[] {
  const cycles: CircularDependency[] = []
  // visited is shared across all DFS roots — once a node is fully explored we
  // never need to walk it again. (Pre-fix the visited set was cleared for each
  // starting node, causing O(N²) work over the full graph.)
  const visited = new Set<string>()
  const recursionStack = new Set<string>()
  const path: string[] = []
  // Index lookup avoids the O(N) `path.indexOf(filePath)` call when we hit a
  // back-edge — important for large dependency graphs.
  const pathIndex = new Map<string, number>()
  const maxDepth = options.maxDepth || 100

  function dfs(filePath: string, depth: number): void {
    if (depth > maxDepth) return

    if (recursionStack.has(filePath)) {
      // Found a cycle!
      const cycleStart = pathIndex.get(filePath) ?? path.indexOf(filePath)
      const chain = path.slice(cycleStart)
      chain.push(filePath)

      const symbols = findCycleSymbols(chain, graph)
      const isTypeOnly = isTypeCycle(chain, graph)

      if (!options.typesOnly || isTypeOnly) {
        cycles.push({
          chain,
          symbols,
          severity: isTypeOnly ? 'error' : 'warning',
          reason: isTypeOnly
            ? 'Type-level circular dependency can cause compilation issues'
            : 'Value-level circular dependency may cause runtime issues',
        })
      }
      return
    }

    if (visited.has(filePath)) return

    const node = graph.get(filePath)
    if (!node) return

    recursionStack.add(filePath)
    pathIndex.set(filePath, path.length)
    path.push(filePath)

    for (const dep of node.dependencies) {
      dfs(dep, depth + 1)
    }

    recursionStack.delete(filePath)
    path.pop()
    pathIndex.delete(filePath)
    // Mark fully explored — subsequent roots that reach this node skip it.
    visited.add(filePath)
  }

  // Start DFS from each node — shared visited makes this O(V + E) total.
  for (const filePath of graph.keys()) {
    if (!visited.has(filePath)) dfs(filePath, 0)
  }

  // Deduplicate cycles (same cycle might be found from different starting points)
  return deduplicateCycles(cycles)
}

/**
 * Find symbols involved in a circular dependency chain
 */
function findCycleSymbols(chain: string[], graph: Map<string, DependencyNode>): string[] {
  const symbols: string[] = []

  for (let i = 0; i < chain.length - 1; i++) {
    const current = graph.get(chain[i])
    const next = chain[i + 1]

    if (current) {
      for (const [symbol, source] of current.imports) {
        if (source === next) {
          symbols.push(symbol)
        }
      }
    }
  }

  return [...new Set(symbols)]
}

/**
 * Check if a cycle involves type-only imports
 */
function isTypeCycle(chain: string[], graph: Map<string, DependencyNode>): boolean {
  // Simplified check - in a real implementation, would track import type vs import
  // For now, assume cycles involving .d.ts files or type exports are type cycles
  return chain.some(file =>
    file.endsWith('.d.ts')
    || graph.get(file)?.exports.has('type')
    || [...(graph.get(file)?.imports.keys() || [])].some(s =>
      s.startsWith('type ') || s === 'type',
    ),
  )
}

/**
 * Remove duplicate cycles (rotations of the same cycle)
 */
function deduplicateCycles(cycles: CircularDependency[]): CircularDependency[] {
  const seen = new Set<string>()
  const unique: CircularDependency[] = []

  for (const cycle of cycles) {
    // Normalize the cycle by finding the smallest rotation
    const normalized = normalizeCycle(cycle.chain)
    const key = normalized.join(' -> ')

    if (!seen.has(key)) {
      seen.add(key)
      unique.push({ ...cycle, chain: normalized })
    }
  }

  return unique
}

/**
 * Normalize a cycle to its lexicographically smallest rotation
 */
function normalizeCycle(chain: string[]): string[] {
  if (chain.length <= 1)
    return chain

  // Remove the duplicate last element
  const cycle = chain.slice(0, -1)

  // Find the lexicographically smallest rotation
  let minRotation = cycle
  for (let i = 1; i < cycle.length; i++) {
    const rotation = [...cycle.slice(i), ...cycle.slice(0, i)]
    if (rotation.join('') < minRotation.join('')) {
      minRotation = rotation
    }
  }

  // Add the first element to close the cycle
  return [...minRotation, minRotation[0]]
}

/**
 * Analyze files for circular dependencies
 */
export async function analyzeCircularDependencies(
  files: string[],
  options: CircularDetectionOptions = {},
): Promise<CircularAnalysisResult> {
  const startTime = Date.now()

  const graph = await buildDependencyGraph(files, options)
  const cycles = detectCircularDependencies(graph, options)

  return {
    hasCircular: cycles.length > 0,
    cycles,
    graph,
    filesAnalyzed: files,
    durationMs: Date.now() - startTime,
  }
}

/**
 * Format circular dependency analysis as a string
 */
export function formatCircularAnalysis(result: CircularAnalysisResult, rootDir?: string): string {
  const lines: string[] = []

  if (!result.hasCircular) {
    lines.push(`✓ No circular dependencies found (${result.filesAnalyzed.length} files analyzed in ${result.durationMs}ms)`)
    return lines.join('\n')
  }

  lines.push(`✗ Found ${result.cycles.length} circular dependency chain(s)`)
  lines.push('')

  for (const cycle of result.cycles) {
    const icon = cycle.severity === 'error' ? '🔴' : '🟡'
    lines.push(`${icon} ${cycle.severity.toUpperCase()}: Circular dependency`)

    // Format the chain with relative paths if rootDir provided
    const formattedChain = cycle.chain.map(p =>
      rootDir ? relative(rootDir, p) : p,
    )

    lines.push(`   ${formattedChain.join(' → ')}`)

    if (cycle.symbols.length > 0) {
      lines.push(`   Symbols: ${cycle.symbols.join(', ')}`)
    }

    lines.push(`   ${cycle.reason}`)
    lines.push('')
  }

  lines.push(`Analyzed ${result.filesAnalyzed.length} files in ${result.durationMs}ms`)

  return lines.join('\n')
}

/**
 * Get a summary of the dependency graph
 */
export function getGraphSummary(graph: Map<string, DependencyNode>): {
  totalFiles: number
  totalDependencies: number
  avgDependencies: number
  maxDependencies: { file: string, count: number }
  isolatedFiles: string[]
  mostDepended: { file: string, count: number }
} {
  let totalDependencies = 0
  let maxDeps = { file: '', count: 0 }
  let mostDepended = { file: '', count: 0 }
  const isolatedFiles: string[] = []

  for (const [file, node] of graph) {
    const depCount = node.dependencies.size
    totalDependencies += depCount

    if (depCount > maxDeps.count) {
      maxDeps = { file, count: depCount }
    }

    if (depCount === 0 && node.dependents.size === 0) {
      isolatedFiles.push(file)
    }

    if (node.dependents.size > mostDepended.count) {
      mostDepended = { file, count: node.dependents.size }
    }
  }

  return {
    totalFiles: graph.size,
    totalDependencies,
    avgDependencies: graph.size > 0 ? totalDependencies / graph.size : 0,
    maxDependencies: maxDeps,
    isolatedFiles,
    mostDepended,
  }
}

/**
 * Find all files that depend on a given file (transitive)
 */
export function findAllDependents(
  filePath: string,
  graph: Map<string, DependencyNode>,
): Set<string> {
  const dependents = new Set<string>()
  const queue = [filePath]

  while (queue.length > 0) {
    const current = queue.shift()!
    const node = graph.get(current)

    if (node) {
      for (const dependent of node.dependents) {
        if (!dependents.has(dependent)) {
          dependents.add(dependent)
          queue.push(dependent)
        }
      }
    }
  }

  return dependents
}

/**
 * Find all dependencies of a given file (transitive)
 */
export function findAllDependencies(
  filePath: string,
  graph: Map<string, DependencyNode>,
): Set<string> {
  const dependencies = new Set<string>()
  const queue = [filePath]

  while (queue.length > 0) {
    const current = queue.shift()!
    const node = graph.get(current)

    if (node) {
      for (const dep of node.dependencies) {
        if (!dependencies.has(dep)) {
          dependencies.add(dep)
          queue.push(dep)
        }
      }
    }
  }

  return dependencies
}

/**
 * Export dependency graph as DOT format (for visualization with Graphviz)
 */
export function exportGraphAsDot(
  graph: Map<string, DependencyNode>,
  rootDir?: string,
): string {
  const lines: string[] = ['digraph dependencies {', '  rankdir=LR;', '  node [shape=box];', '']

  for (const [file, node] of graph) {
    const label = rootDir ? relative(rootDir, file) : file
    const nodeId = file.replace(/[^a-z0-9]/gi, '_')

    lines.push(`  ${nodeId} [label="${label}"];`)

    for (const dep of node.dependencies) {
      const depId = dep.replace(/[^a-z0-9]/gi, '_')
      lines.push(`  ${nodeId} -> ${depId};`)
    }
  }

  lines.push('}')
  return lines.join('\n')
}

/**
 * Export dependency graph as JSON
 */
export function exportGraphAsJson(
  graph: Map<string, DependencyNode>,
  rootDir?: string,
): string {
  const nodes: Array<{
    id: string
    path: string
    exports: string[]
    imports: Record<string, string>
    dependencies: string[]
    dependents: string[]
  }> = []

  for (const [file, node] of graph) {
    const relativePath = rootDir ? relative(rootDir, file) : file
    nodes.push({
      id: file,
      path: relativePath,
      exports: [...node.exports],
      imports: Object.fromEntries(node.imports),
      dependencies: [...node.dependencies],
      dependents: [...node.dependents],
    })
  }

  return JSON.stringify({ nodes }, null, 2)
}
