/**
 * Type and import tracking for debugging and analysis
 *
 * Provides utilities to track:
 * - Type definitions and their usage
 * - Type relationships (extends, implements, references)
 * - Import sources and usage
 * - Declaration usage across files
 */

import type { Declaration, TrackingConfig } from './types'

/**
 * Type information tracked during processing
 */
export interface TrackedType {
  name: string
  kind: 'interface' | 'type' | 'class' | 'enum'
  file: string
  line?: number
  usedBy: Set<string>
  references: Set<string>
  extendsFrom?: string[]
  implementsFrom?: string[]
}

/**
 * Import information tracked during processing
 */
export interface TrackedImport {
  source: string
  specifiers: string[]
  isTypeOnly: boolean
  file: string
  usedSpecifiers: Set<string>
  unusedSpecifiers: Set<string>
}

/**
 * Type relationship information
 */
export interface TypeRelationship {
  from: string
  to: string
  kind: 'extends' | 'implements' | 'references' | 'uses'
  file: string
}

/**
 * Tracking results from analysis
 */
export interface TrackingResults {
  types: Map<string, TrackedType>
  imports: Map<string, TrackedImport[]>
  relationships: TypeRelationship[]
  unusedTypes: string[]
  unusedImports: TrackedImport[]
  circularReferences: string[][]
  statistics: TrackingStatistics
}

/**
 * Tracking statistics
 */
export interface TrackingStatistics {
  totalTypes: number
  usedTypes: number
  unusedTypes: number
  totalImports: number
  usedImports: number
  unusedImports: number
  totalRelationships: number
  circularDependencies: number
}

/**
 * Tracker class for collecting type and import information
 */
export class Tracker {
  private config: TrackingConfig
  private types: Map<string, TrackedType> = new Map()
  private imports: Map<string, TrackedImport[]> = new Map()
  private relationships: TypeRelationship[] = []
  private usageMap: Map<string, Set<string>> = new Map()

  constructor(config: TrackingConfig = {}) {
    this.config = {
      types: false,
      relationships: false,
      usage: false,
      imports: false,
      importUsage: false,
      importRelationships: false,
      ...config,
    }
  }

  /**
   * Track a type declaration
   */
  trackType(decl: Declaration, file: string): void {
    if (!this.config.types)
      return

    if (['interface', 'type', 'class', 'enum'].includes(decl.kind)) {
      const existing = this.types.get(decl.name)
      if (existing) {
        // Merge info for re-declared types
        return
      }

      const tracked: TrackedType = {
        name: decl.name,
        kind: decl.kind as 'interface' | 'type' | 'class' | 'enum',
        file,
        usedBy: new Set(),
        references: new Set(),
        extendsFrom: decl.extends ? [decl.extends] : undefined,
        implementsFrom: decl.implements,
      }

      this.types.set(decl.name, tracked)

      // Track relationships
      if (this.config.relationships) {
        if (decl.extends) {
          this.relationships.push({
            from: decl.name,
            to: decl.extends,
            kind: 'extends',
            file,
          })
        }
        if (decl.implements) {
          for (const impl of decl.implements) {
            this.relationships.push({
              from: decl.name,
              to: impl,
              kind: 'implements',
              file,
            })
          }
        }
      }
    }
  }

  /**
   * Track a type reference
   */
  trackTypeUsage(typeName: string, usedBy: string, file: string): void {
    if (!this.config.usage)
      return

    const tracked = this.types.get(typeName)
    if (tracked) {
      tracked.usedBy.add(usedBy)
    }

    // Track in usage map
    const usage = this.usageMap.get(typeName) || new Set()
    usage.add(`${file}:${usedBy}`)
    this.usageMap.set(typeName, usage)

    // Track relationship
    if (this.config.relationships) {
      this.relationships.push({
        from: usedBy,
        to: typeName,
        kind: 'uses',
        file,
      })
    }
  }

  /**
   * Track an import
   */
  trackImport(
    source: string,
    specifiers: string[],
    isTypeOnly: boolean,
    file: string,
  ): void {
    if (!this.config.imports)
      return

    const tracked: TrackedImport = {
      source,
      specifiers,
      isTypeOnly,
      file,
      usedSpecifiers: new Set(),
      unusedSpecifiers: new Set(specifiers),
    }

    const existing = this.imports.get(file) || []
    existing.push(tracked)
    this.imports.set(file, existing)
  }

  /**
   * Mark an import specifier as used
   */
  trackImportUsage(specifier: string, file: string): void {
    if (!this.config.importUsage)
      return

    const fileImports = this.imports.get(file)
    if (!fileImports)
      return

    for (const imp of fileImports) {
      if (imp.specifiers.includes(specifier)) {
        imp.usedSpecifiers.add(specifier)
        imp.unusedSpecifiers.delete(specifier)
      }
    }
  }

  /**
   * Track a type reference in type annotations
   */
  trackTypeReference(typeName: string, file: string): void {
    if (!this.config.types)
      return

    const tracked = this.types.get(typeName)
    if (tracked) {
      tracked.references.add(file)
    }
  }

  /**
   * Get tracking results
   */
  getResults(): TrackingResults {
    const unusedTypes: string[] = []
    const unusedImports: TrackedImport[] = []

    // Find unused types
    for (const [name, tracked] of this.types) {
      if (tracked.usedBy.size === 0 && tracked.references.size === 0) {
        unusedTypes.push(name)
      }
    }

    // Find unused imports
    for (const fileImports of this.imports.values()) {
      for (const imp of fileImports) {
        if (imp.unusedSpecifiers.size === imp.specifiers.length) {
          unusedImports.push(imp)
        }
      }
    }

    // Detect circular references
    const circularReferences = this.detectCircularReferences()

    // Calculate statistics
    const statistics: TrackingStatistics = {
      totalTypes: this.types.size,
      usedTypes: this.types.size - unusedTypes.length,
      unusedTypes: unusedTypes.length,
      totalImports: Array.from(this.imports.values()).flat().length,
      usedImports: Array.from(this.imports.values())
        .flat()
        .filter(i => i.usedSpecifiers.size > 0)
        .length,
      unusedImports: unusedImports.length,
      totalRelationships: this.relationships.length,
      circularDependencies: circularReferences.length,
    }

    return {
      types: this.types,
      imports: this.imports,
      relationships: this.relationships,
      unusedTypes,
      unusedImports,
      circularReferences,
      statistics,
    }
  }

  /**
   * Detect circular references in type relationships
   */
  private detectCircularReferences(): string[][] {
    const cycles: string[][] = []
    const visited = new Set<string>()
    const stack: string[] = []

    const dfs = (node: string): void => {
      if (stack.includes(node)) {
        // Found a cycle
        const cycleStart = stack.indexOf(node)
        cycles.push(stack.slice(cycleStart))
        return
      }

      if (visited.has(node))
        return

      visited.add(node)
      stack.push(node)

      // Find all nodes this type references
      const refs = this.relationships
        .filter(r => r.from === node && (r.kind === 'extends' || r.kind === 'implements' || r.kind === 'references'))
        .map(r => r.to)

      for (const ref of refs) {
        dfs(ref)
      }

      stack.pop()
    }

    for (const typeName of this.types.keys()) {
      dfs(typeName)
    }

    return cycles
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.types.clear()
    this.imports.clear()
    this.relationships = []
    this.usageMap.clear()
  }

  /**
   * Format results as human-readable string
   */
  formatResults(): string {
    const results = this.getResults()
    const lines: string[] = ['=== Tracking Results ===', '']

    // Statistics
    lines.push('Statistics:')
    lines.push(`  Total types: ${results.statistics.totalTypes}`)
    lines.push(`  Used types: ${results.statistics.usedTypes}`)
    lines.push(`  Unused types: ${results.statistics.unusedTypes}`)
    lines.push(`  Total imports: ${results.statistics.totalImports}`)
    lines.push(`  Used imports: ${results.statistics.usedImports}`)
    lines.push(`  Unused imports: ${results.statistics.unusedImports}`)
    lines.push(`  Type relationships: ${results.statistics.totalRelationships}`)
    lines.push(`  Circular dependencies: ${results.statistics.circularDependencies}`)
    lines.push('')

    // Unused types
    if (results.unusedTypes.length > 0) {
      lines.push('Unused types:')
      for (const name of results.unusedTypes) {
        const type = results.types.get(name)
        lines.push(`  - ${name} (${type?.kind}) in ${type?.file}`)
      }
      lines.push('')
    }

    // Unused imports
    if (results.unusedImports.length > 0) {
      lines.push('Unused imports:')
      for (const imp of results.unusedImports) {
        lines.push(`  - ${imp.source} in ${imp.file}`)
        lines.push(`    Specifiers: ${Array.from(imp.unusedSpecifiers).join(', ')}`)
      }
      lines.push('')
    }

    // Circular references
    if (results.circularReferences.length > 0) {
      lines.push('Circular references:')
      for (const cycle of results.circularReferences) {
        lines.push(`  - ${cycle.join(' -> ')} -> ${cycle[0]}`)
      }
      lines.push('')
    }

    return lines.join('\n')
  }
}

/**
 * Create a new tracker instance
 */
export function createTracker(config?: TrackingConfig): Tracker {
  return new Tracker(config)
}

/**
 * Track declarations from a file
 */
export function trackDeclarations(
  declarations: Declaration[],
  file: string,
  tracker: Tracker,
): void {
  for (const decl of declarations) {
    // Track type declarations
    tracker.trackType(decl, file)

    // Track type usage in type annotations
    if (decl.typeAnnotation) {
      const typeRefs = extractTypeReferences(decl.typeAnnotation)
      for (const ref of typeRefs) {
        tracker.trackTypeUsage(ref, decl.name, file)
      }
    }

    // Track extends/implements
    if (decl.extends) {
      tracker.trackTypeUsage(decl.extends, decl.name, file)
    }
    if (decl.implements) {
      for (const impl of decl.implements) {
        tracker.trackTypeUsage(impl, decl.name, file)
      }
    }

    // Track imports
    if (decl.kind === 'import' && decl.source && decl.specifiers) {
      tracker.trackImport(
        decl.source,
        decl.specifiers.map(s => s.name),
        decl.isTypeOnly || false,
        file,
      )
    }
  }
}

/**
 * Extract type references from a type annotation string
 */
function extractTypeReferences(typeAnnotation: string): string[] {
  const refs: string[] = []

  // Match type identifiers (capitalized words that aren't keywords)
  const keywords = new Set([
    'string',
    'number',
    'boolean',
    'any',
    'unknown',
    'void',
    'never',
    'null',
    'undefined',
    'object',
    'symbol',
    'bigint',
    'true',
    'false',
    'readonly',
    'keyof',
    'typeof',
    'infer',
    'extends',
    'in',
    'out',
  ])

  const identifierPattern = /\b([A-Z]\w*)\b/g
  let match
  while ((match = identifierPattern.exec(typeAnnotation)) !== null) {
    const name = match[1]
    if (!keywords.has(name.toLowerCase()) && !refs.includes(name)) {
      refs.push(name)
    }
  }

  return refs
}

/**
 * Analyze imports for a set of files
 */
export function analyzeImports(
  fileDeclarations: Map<string, Declaration[]>,
  config?: TrackingConfig,
): TrackingResults {
  const tracker = createTracker({
    imports: true,
    importUsage: true,
    importRelationships: true,
    ...config,
  })

  for (const [file, declarations] of fileDeclarations) {
    trackDeclarations(declarations, file, tracker)
  }

  return tracker.getResults()
}

/**
 * Analyze types for a set of files
 */
export function analyzeTypes(
  fileDeclarations: Map<string, Declaration[]>,
  config?: TrackingConfig,
): TrackingResults {
  const tracker = createTracker({
    types: true,
    relationships: true,
    usage: true,
    ...config,
  })

  for (const [file, declarations] of fileDeclarations) {
    trackDeclarations(declarations, file, tracker)
  }

  return tracker.getResults()
}
