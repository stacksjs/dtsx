/**
 * Tree shaking module for removing unused types from declaration files
 * Analyzes type dependencies and removes unreferenced internal types
 */

import type { Declaration, DeclarationKind } from './types'

/**
 * Tree shaking configuration
 */
export interface TreeShakeConfig {
  /**
   * Entry points - declarations that should always be kept
   * If not specified, all exported declarations are entry points
   */
  entryPoints?: string[]

  /**
   * Keep all exported declarations
   * @default true
   */
  keepExported?: boolean

  /**
   * Keep declarations matching these patterns
   */
  keep?: (string | RegExp)[]

  /**
   * Remove declarations matching these patterns
   * (applied after keep rules)
   */
  remove?: (string | RegExp)[]

  /**
   * Declaration kinds to consider for removal
   * @default ['type', 'interface']
   */
  shakableKinds?: DeclarationKind[]

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean
}

/**
 * Result of tree shaking
 */
export interface TreeShakeResult {
  /** Kept declarations */
  declarations: Declaration[]
  /** Names of removed declarations */
  removed: string[]
  /** Dependency graph */
  dependencyGraph: Map<string, Set<string>>
  /** Statistics */
  stats: TreeShakeStats
}

/**
 * Tree shaking statistics
 */
export interface TreeShakeStats {
  /** Total declarations before shaking */
  totalBefore: number
  /** Total declarations after shaking */
  totalAfter: number
  /** Number of declarations removed */
  removedCount: number
  /** Percentage reduction */
  reductionPercent: number
}

/**
 * Type reference information
 */
interface _TypeReference {
  name: string
  isGeneric: boolean
  genericArgs: _TypeReference[]
}

/**
 * Shake unused declarations from the tree
 */
export function treeShake(
  declarations: Declaration[],
  config: TreeShakeConfig = {},
): TreeShakeResult {
  const {
    entryPoints,
    keepExported = true,
    keep = [],
    remove = [],
    shakableKinds = ['type', 'interface'],
    debug = false,
  } = config

  const log = debug ? console.log.bind(console, '[tree-shake]') : () => {}

  // Build declaration map
  const declMap = new Map<string, Declaration>()
  for (const decl of declarations) {
    declMap.set(decl.name, decl)
  }

  // Build dependency graph
  const dependencyGraph = buildDeclarationDependencyGraph(declarations)
  log('Dependency graph:', Object.fromEntries(
    Array.from(dependencyGraph.entries()).map(([k, v]) => [k, Array.from(v)]),
  ))

  // Determine entry points (roots that must be kept)
  const roots = new Set<string>()

  if (entryPoints && entryPoints.length > 0) {
    // Use explicit entry points
    for (const name of entryPoints) {
      if (declMap.has(name)) {
        roots.add(name)
      }
    }
  }
  else {
    // Auto-detect entry points
    for (const decl of declarations) {
      // Keep exported declarations
      if (keepExported && decl.isExported) {
        roots.add(decl.name)
        continue
      }

      // Keep declarations matching keep patterns
      if (matchesPatterns(decl.name, keep)) {
        roots.add(decl.name)
        continue
      }

      // Keep non-shakable kinds
      if (!shakableKinds.includes(decl.kind)) {
        roots.add(decl.name)
      }
    }
  }

  // Apply keep patterns
  for (const decl of declarations) {
    if (matchesPatterns(decl.name, keep)) {
      roots.add(decl.name)
    }
  }

  log('Entry points:', Array.from(roots))

  // Find all reachable declarations from roots
  const reachable = findReachable(roots, dependencyGraph)
  log('Reachable:', Array.from(reachable))

  // Determine which declarations to keep
  const toKeep = new Set<string>()
  const removed: string[] = []

  for (const decl of declarations) {
    const name = decl.name

    // Always keep if it's reachable from an entry point
    if (reachable.has(name)) {
      toKeep.add(name)
      continue
    }

    // Check if it should be removed by pattern
    if (matchesPatterns(name, remove)) {
      removed.push(name)
      continue
    }

    // Non-shakable kinds are always kept
    if (!shakableKinds.includes(decl.kind)) {
      toKeep.add(name)
      continue
    }

    // Otherwise, mark as removed
    removed.push(name)
  }

  log('Keeping:', Array.from(toKeep))
  log('Removing:', removed)

  // Filter declarations
  const result = declarations.filter(decl => toKeep.has(decl.name))

  // Calculate stats
  const stats: TreeShakeStats = {
    totalBefore: declarations.length,
    totalAfter: result.length,
    removedCount: removed.length,
    reductionPercent: declarations.length > 0
      ? Math.round((removed.length / declarations.length) * 100)
      : 0,
  }

  return {
    declarations: result,
    removed,
    dependencyGraph,
    stats,
  }
}

/**
 * Build a declaration dependency graph for tree shaking
 */
export function buildDeclarationDependencyGraph(
  declarations: Declaration[],
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>()
  const declNames = new Set(declarations.map(d => d.name))

  for (const decl of declarations) {
    const deps = new Set<string>()
    const references = extractTypeReferences(decl)

    for (const ref of references) {
      // Only include references to declarations in our set
      if (declNames.has(ref) && ref !== decl.name) {
        deps.add(ref)
      }
    }

    graph.set(decl.name, deps)
  }

  return graph
}

/**
 * Extract type references from a declaration
 */
export function extractTypeReferences(decl: Declaration): Set<string> {
  const references = new Set<string>()

  // Extract from type annotation
  if (decl.typeAnnotation) {
    extractRefsFromType(decl.typeAnnotation, references)
  }

  // Extract from extends clause
  if (decl.extends) {
    extractRefsFromType(decl.extends, references)
  }

  // Extract from declaration text
  if (decl.text) {
    extractRefsFromText(decl.text, references)
  }

  // Extract from members
  if (decl.members) {
    for (const member of decl.members) {
      const memberRefs = extractTypeReferences(member)
      for (const ref of memberRefs) {
        references.add(ref)
      }
    }
  }

  // Extract from parameters
  if (decl.parameters) {
    for (const param of decl.parameters) {
      if (param.type) {
        extractRefsFromType(param.type, references)
      }
    }
  }

  // Extract from return type
  if (decl.returnType) {
    extractRefsFromType(decl.returnType, references)
  }

  return references
}

/**
 * Extract type references from a type string
 */
function extractRefsFromType(typeStr: string, refs: Set<string>): void {
  // Match identifiers that could be type references
  // Exclude built-in types and keywords
  const builtins = new Set([
    'string',
    'number',
    'boolean',
    'object',
    'any',
    'unknown',
    'never',
    'void',
    'null',
    'undefined',
    'symbol',
    'bigint',
    'true',
    'false',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Function',
    'Symbol',
    'Promise',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Record',
    'Partial',
    'Required',
    'Readonly',
    'Pick',
    'Omit',
    'Exclude',
    'Extract',
    'NonNullable',
    'Parameters',
    'ReturnType',
    'InstanceType',
    'ConstructorParameters',
    'ThisParameterType',
    'OmitThisParameter',
    'ThisType',
    'Uppercase',
    'Lowercase',
    'Capitalize',
    'Uncapitalize',
    'Awaited',
    'keyof',
    'typeof',
    'infer',
    'extends',
    'readonly',
    'const',
    'new',
  ])

  // Match type identifiers (PascalCase or camelCase followed by optional generics)
  const typePattern = /\b([A-Z]\w*)\b/g
  let match

  while ((match = typePattern.exec(typeStr)) !== null) {
    const name = match[1]
    if (!builtins.has(name)) {
      refs.add(name)
    }
  }
}

/**
 * Extract type references from declaration text
 */
function extractRefsFromText(text: string, refs: Set<string>): void {
  // Same as extractRefsFromType but on full text
  extractRefsFromType(text, refs)
}

/**
 * Find all declarations reachable from the given roots
 */
function findReachable(
  roots: Set<string>,
  graph: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>()
  const queue = Array.from(roots)

  while (queue.length > 0) {
    const current = queue.shift()!

    if (visited.has(current)) {
      continue
    }

    visited.add(current)

    const deps = graph.get(current)
    if (deps) {
      for (const dep of deps) {
        if (!visited.has(dep)) {
          queue.push(dep)
        }
      }
    }
  }

  return visited
}

/**
 * Check if a name matches any of the given patterns
 */
function matchesPatterns(name: string, patterns: (string | RegExp)[]): boolean {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      // Glob-like matching
      if (pattern.includes('*')) {
        const regex = new RegExp(
          `^${pattern.replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
        )
        if (regex.test(name)) {
          return true
        }
      }
      else if (name === pattern) {
        return true
      }
    }
    else if (pattern.test(name)) {
      return true
    }
  }

  return false
}

/**
 * Tree shake content string
 */
export function treeShakeContent(
  content: string,
  config: TreeShakeConfig = {},
): { content: string, removed: string[] } {
  const lines = content.split('\n')
  const declarations: Array<{
    name: string
    kind: DeclarationKind
    isExported: boolean
    start: number
    end: number
    text: string
  }> = []

  // Parse declarations from content
  let current: {
    name: string
    kind: DeclarationKind
    isExported: boolean
    start: number
    lines: string[]
    braceCount: number
  } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Skip empty lines and comments when not in a declaration
    if (!current && (trimmed === '' || trimmed.startsWith('//'))) {
      continue
    }

    // Start of declaration
    if (!current) {
      const declMatch = trimmed.match(
        /^(export\s+)?(declare\s+)?(interface|type|enum|class|function|const|let|var)\s+(\w+)/,
      )

      if (declMatch) {
        const [, exportKw, , kind, name] = declMatch
        current = {
          name,
          kind: kind as DeclarationKind,
          isExported: !!exportKw,
          start: i,
          lines: [line],
          braceCount: 0,
        }

        // Count braces
        current.braceCount += (line.match(/\{/g) || []).length
        current.braceCount -= (line.match(/\}/g) || []).length

        // Single-line declaration
        if (current.braceCount === 0 && (trimmed.endsWith(';') || !trimmed.includes('{'))) {
          declarations.push({
            name: current.name,
            kind: current.kind,
            isExported: current.isExported,
            start: current.start,
            end: i,
            text: current.lines.join('\n'),
          })
          current = null
        }
        continue
      }
    }

    // Inside declaration
    if (current) {
      current.lines.push(line)
      current.braceCount += (line.match(/\{/g) || []).length
      current.braceCount -= (line.match(/\}/g) || []).length

      // End of declaration
      if (current.braceCount <= 0 && (trimmed.endsWith('}') || trimmed.endsWith(';'))) {
        declarations.push({
          name: current.name,
          kind: current.kind,
          isExported: current.isExported,
          start: current.start,
          end: i,
          text: current.lines.join('\n'),
        })
        current = null
      }
    }
  }

  if (declarations.length === 0) {
    return { content, removed: [] }
  }

  // Convert to Declaration format for tree shaking
  const declObjects: Declaration[] = declarations.map(d => ({
    name: d.name,
    kind: d.kind,
    isExported: d.isExported,
    text: d.text,
  }))

  // Tree shake
  const result = treeShake(declObjects, config)
  const keptNames = new Set(result.declarations.map(d => d.name))

  // Remove declarations
  const linesToRemove = new Set<number>()
  for (const decl of declarations) {
    if (!keptNames.has(decl.name)) {
      for (let i = decl.start; i <= decl.end; i++) {
        linesToRemove.add(i)
      }
    }
  }

  // Build result
  const resultLines = lines.filter((_, i) => !linesToRemove.has(i))

  return {
    content: resultLines.join('\n').replace(/\n{3,}/g, '\n\n'),
    removed: result.removed,
  }
}

/**
 * Get unused declarations (those that could be removed)
 */
export function findUnusedDeclarations(
  declarations: Declaration[],
  config: Omit<TreeShakeConfig, 'debug'> = {},
): string[] {
  const result = treeShake(declarations, { ...config, debug: false })
  return result.removed
}

/**
 * Analyze dependencies for a declaration
 */
export function analyzeDependencies(
  declarationName: string,
  declarations: Declaration[],
): {
    directDependencies: string[]
    transitiveDependencies: string[]
    dependents: string[]
  } {
  const graph = buildDeclarationDependencyGraph(declarations)

  // Direct dependencies
  const directDeps = graph.get(declarationName) || new Set<string>()

  // Transitive dependencies (all reachable from this declaration)
  const transitive = findReachable(new Set([declarationName]), graph)
  transitive.delete(declarationName) // Remove self

  // Find dependents (declarations that depend on this one)
  const dependents: string[] = []
  for (const [name, deps] of graph) {
    if (name !== declarationName && deps.has(declarationName)) {
      dependents.push(name)
    }
  }

  return {
    directDependencies: Array.from(directDeps),
    transitiveDependencies: Array.from(transitive),
    dependents,
  }
}

/**
 * Create a tree shaker with preset configuration
 */
export function createTreeShaker(config: TreeShakeConfig = {}): {
  shake: (declarations: Declaration[]) => TreeShakeResult
  shakeContent: (content: string) => { content: string, removed: string[] }
  findUnused: (declarations: Declaration[]) => string[]
  analyzeDependencies: (name: string, declarations: Declaration[]) => { directDependencies: string[], transitiveDependencies: string[], dependents: string[] }
  buildGraph: typeof buildDeclarationDependencyGraph
  extractRefs: typeof extractTypeReferences
} {
  return {
    shake: (declarations: Declaration[]): TreeShakeResult => treeShake(declarations, config),
    shakeContent: (content: string): { content: string, removed: string[] } => treeShakeContent(content, config),
    findUnused: (declarations: Declaration[]): string[] => findUnusedDeclarations(declarations, config),
    analyzeDependencies: (name: string, declarations: Declaration[]): { directDependencies: string[], transitiveDependencies: string[], dependents: string[] } =>
      analyzeDependencies(name, declarations),
    buildGraph: buildDeclarationDependencyGraph,
    extractRefs: extractTypeReferences,
  }
}
