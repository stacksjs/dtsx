import type { Declaration } from './types'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { extractDeclarations } from './extractor'
import { logger } from './logger'

/**
 * Optimizer configuration
 */
export interface OptimizerConfig {
  /** Remove unused type imports */
  removeUnusedImports?: boolean
  /** Remove duplicate declarations */
  deduplicateDeclarations?: boolean
  /** Inline simple type aliases */
  inlineSimpleTypes?: boolean
  /** Remove empty interfaces */
  removeEmptyInterfaces?: boolean
  /** Merge interface declarations with same name */
  mergeInterfaces?: boolean
  /** Sort declarations alphabetically */
  sortDeclarations?: boolean
  /** Sort imports */
  sortImports?: boolean
  /** Remove comments (minify) */
  removeComments?: boolean
  /** Minify output (remove whitespace) */
  minify?: boolean
  /** Tree-shake unused exports */
  treeShake?: boolean
  /** Entry points for tree shaking */
  entryPoints?: string[]
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  originalSize: number
  optimizedSize: number
  savings: number
  savingsPercent: number
  removedImports: number
  removedDeclarations: number
  mergedInterfaces: number
  inlinedTypes: number
}

/**
 * Type usage tracker for tree shaking
 */
class TypeUsageTracker {
  private usedTypes = new Set<string>()
  private declaredTypes = new Map<string, Declaration>()
  private typeReferences = new Map<string, Set<string>>()

  addDeclaration(decl: Declaration): void {
    this.declaredTypes.set(decl.name, decl)
  }

  addUsage(typeName: string): void {
    this.usedTypes.add(typeName)
  }

  addReference(fromType: string, toType: string): void {
    if (!this.typeReferences.has(fromType)) {
      this.typeReferences.set(fromType, new Set())
    }
    this.typeReferences.get(fromType)!.add(toType)
  }

  /**
   * Get all types that are reachable from the used types
   */
  getReachableTypes(): Set<string> {
    const reachable = new Set<string>()
    const queue = [...this.usedTypes]

    while (queue.length > 0) {
      const current = queue.shift()!
      if (reachable.has(current)) continue
      reachable.add(current)

      const refs = this.typeReferences.get(current)
      if (refs) {
        for (const ref of refs) {
          if (!reachable.has(ref)) {
            queue.push(ref)
          }
        }
      }
    }

    return reachable
  }

  isUsed(typeName: string): boolean {
    return this.getReachableTypes().has(typeName)
  }
}

/**
 * Extract type references from a type annotation
 */
function extractTypeReferences(typeStr: string): string[] {
  const refs: string[] = []

  // Match identifier patterns (potential type references)
  const identifierRegex = /\b([A-Z][a-zA-Z0-9]*)\b/g
  let match

  while ((match = identifierRegex.exec(typeStr)) !== null) {
    const name = match[1]
    // Skip built-in types
    if (!isBuiltInType(name)) {
      refs.push(name)
    }
  }

  return [...new Set(refs)]
}

/**
 * Check if a type name is a built-in TypeScript type
 */
function isBuiltInType(name: string): boolean {
  const builtIns = new Set([
    'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
    'Function', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
    'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
    'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Record',
    'Exclude', 'Extract', 'NonNullable', 'ReturnType', 'Parameters',
    'ConstructorParameters', 'InstanceType', 'ThisType',
    'Uppercase', 'Lowercase', 'Capitalize', 'Uncapitalize',
    'Awaited', 'NoInfer', 'Generator', 'AsyncGenerator',
    'IterableIterator', 'AsyncIterableIterator',
    'PropertyKey', 'Iterable', 'AsyncIterable',
    'ArrayLike', 'PromiseLike', 'ArrayBuffer', 'SharedArrayBuffer',
    'DataView', 'Int8Array', 'Uint8Array', 'Int16Array', 'Uint16Array',
    'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array',
    'BigInt64Array', 'BigUint64Array',
  ])
  return builtIns.has(name)
}

/**
 * Check if a type alias is "simple" (can be inlined)
 */
function isSimpleTypeAlias(decl: Declaration): boolean {
  if (decl.kind !== 'type') return false

  const type = decl.typeAnnotation || ''

  // Don't inline generic types
  if (decl.generics) return false

  // Don't inline complex types
  if (type.includes('{') || type.includes('(') || type.includes('<')) return false

  // Simple type references, unions, or intersections
  return /^[\w\s|&]+$/.test(type)
}

/**
 * Check if an interface is empty
 */
function isEmptyInterface(decl: Declaration): boolean {
  if (decl.kind !== 'interface') return false

  // Has no members
  if (!decl.members || decl.members.length === 0) {
    // And doesn't extend anything
    if (!decl.extends) return true
  }

  return false
}

/**
 * Merge two interface declarations
 */
function mergeInterfaceDeclarations(a: Declaration, b: Declaration): Declaration {
  const merged: Declaration = {
    ...a,
    members: [...(a.members || []), ...(b.members || [])],
    leadingComments: [...(a.leadingComments || []), ...(b.leadingComments || [])],
  }

  // Merge extends
  if (a.extends && b.extends) {
    const extendsA = a.extends.split(',').map(s => s.trim())
    const extendsB = b.extends.split(',').map(s => s.trim())
    merged.extends = [...new Set([...extendsA, ...extendsB])].join(', ')
  }
  else {
    merged.extends = a.extends || b.extends
  }

  return merged
}

/**
 * Sort declarations by kind and name
 */
function sortDeclarationsFn(declarations: Declaration[]): Declaration[] {
  const kindOrder = ['import', 'interface', 'type', 'class', 'enum', 'function', 'variable', 'export']

  return [...declarations].sort((a, b) => {
    // First by kind
    const kindDiff = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)
    if (kindDiff !== 0) return kindDiff

    // Then alphabetically by name
    return a.name.localeCompare(b.name)
  })
}

/**
 * Sort import declarations
 */
function sortImports(declarations: Declaration[]): Declaration[] {
  const imports = declarations.filter(d => d.kind === 'import')
  const nonImports = declarations.filter(d => d.kind !== 'import')

  const sortedImports = [...imports].sort((a, b) => {
    const sourceA = a.source || ''
    const sourceB = b.source || ''

    // Built-in modules first (node:, bun)
    const isBuiltInA = sourceA.startsWith('node:') || sourceA === 'bun'
    const isBuiltInB = sourceB.startsWith('node:') || sourceB === 'bun'
    if (isBuiltInA && !isBuiltInB) return -1
    if (!isBuiltInA && isBuiltInB) return 1

    // External packages next
    const isExternalA = !sourceA.startsWith('.')
    const isExternalB = !sourceB.startsWith('.')
    if (isExternalA && !isExternalB) return -1
    if (!isExternalA && isExternalB) return 1

    // Alphabetically
    return sourceA.localeCompare(sourceB)
  })

  return [...sortedImports, ...nonImports]
}

/**
 * Remove unused imports from declarations
 */
function removeUnusedImportsFn(declarations: Declaration[]): { declarations: Declaration[], removed: number } {
  // Collect all used type names from non-import declarations
  const usedTypes = new Set<string>()

  for (const decl of declarations) {
    if (decl.kind === 'import') continue

    // Extract types from the declaration text
    const text = decl.text || ''
    const typeAnnotation = decl.typeAnnotation || ''
    const returnType = decl.returnType || ''
    const extendsType = decl.extends || ''
    const implementsTypes = decl.implements?.join(' ') || ''

    const allText = `${text} ${typeAnnotation} ${returnType} ${extendsType} ${implementsTypes}`

    for (const ref of extractTypeReferences(allText)) {
      usedTypes.add(ref)
    }

    // Check members
    if (decl.members) {
      for (const member of decl.members) {
        const memberText = `${member.typeAnnotation || ''} ${member.returnType || ''}`
        for (const ref of extractTypeReferences(memberText)) {
          usedTypes.add(ref)
        }
      }
    }

    // Check parameters
    if (decl.parameters) {
      for (const param of decl.parameters) {
        if (param.type) {
          for (const ref of extractTypeReferences(param.type)) {
            usedTypes.add(ref)
          }
        }
      }
    }
  }

  // Filter imports
  let removed = 0
  const filteredDeclarations = declarations.map((decl) => {
    if (decl.kind !== 'import' || !decl.specifiers) return decl

    const usedSpecifiers = decl.specifiers.filter((spec) => {
      const name = spec.alias || spec.name
      return usedTypes.has(name)
    })

    if (usedSpecifiers.length === 0) {
      // Remove entire import if it's not a side-effect import
      if (!decl.isSideEffect) {
        removed++
        return null
      }
    }

    if (usedSpecifiers.length < (decl.specifiers?.length || 0)) {
      removed += (decl.specifiers?.length || 0) - usedSpecifiers.length
      return { ...decl, specifiers: usedSpecifiers }
    }

    return decl
  }).filter((d): d is Declaration => d !== null)

  return { declarations: filteredDeclarations, removed }
}

/**
 * Deduplicate declarations with the same name
 */
function deduplicateDeclarationsFn(declarations: Declaration[]): { declarations: Declaration[], removed: number } {
  const seen = new Map<string, Declaration>()
  let removed = 0

  for (const decl of declarations) {
    // Imports can be duplicated (merged)
    if (decl.kind === 'import') {
      const key = `import:${decl.source}`
      if (seen.has(key)) {
        // Merge specifiers
        const existing = seen.get(key)!
        const allSpecifiers = [...(existing.specifiers || []), ...(decl.specifiers || [])]
        const uniqueSpecifiers = Array.from(
          new Map(allSpecifiers.map(s => [s.alias || s.name, s])).values(),
        )
        seen.set(key, { ...existing, specifiers: uniqueSpecifiers })
        removed++
      }
      else {
        seen.set(key, decl)
      }
      continue
    }

    const key = `${decl.kind}:${decl.name}`
    if (seen.has(key)) {
      // Skip duplicate
      removed++
    }
    else {
      seen.set(key, decl)
    }
  }

  return { declarations: Array.from(seen.values()), removed }
}

/**
 * Merge interface declarations with the same name
 */
function mergeInterfacesFn(declarations: Declaration[]): { declarations: Declaration[], merged: number } {
  const interfaces = new Map<string, Declaration[]>()
  const nonInterfaces: Declaration[] = []

  for (const decl of declarations) {
    if (decl.kind === 'interface') {
      const name = decl.name
      if (!interfaces.has(name)) {
        interfaces.set(name, [])
      }
      interfaces.get(name)!.push(decl)
    }
    else {
      nonInterfaces.push(decl)
    }
  }

  let merged = 0
  const mergedInterfaces: Declaration[] = []

  for (const [name, decls] of interfaces) {
    if (decls.length > 1) {
      // Merge all declarations
      let result = decls[0]
      for (let i = 1; i < decls.length; i++) {
        result = mergeInterfaceDeclarations(result, decls[i])
        merged++
      }
      mergedInterfaces.push(result)
    }
    else {
      mergedInterfaces.push(decls[0])
    }
  }

  return { declarations: [...nonInterfaces, ...mergedInterfaces], merged }
}

/**
 * Inline simple type aliases
 */
function inlineSimpleTypesFn(declarations: Declaration[]): { declarations: Declaration[], inlined: number } {
  // Find simple type aliases
  const simpleTypes = new Map<string, string>()
  const toRemove = new Set<string>()

  for (const decl of declarations) {
    if (isSimpleTypeAlias(decl)) {
      simpleTypes.set(decl.name, decl.typeAnnotation || '')
      toRemove.add(decl.name)
    }
  }

  if (simpleTypes.size === 0) {
    return { declarations, inlined: 0 }
  }

  // Replace type references
  function replaceTypeRefs(text: string): string {
    let result = text
    for (const [name, replacement] of simpleTypes) {
      const regex = new RegExp(`\\b${name}\\b`, 'g')
      result = result.replace(regex, replacement)
    }
    return result
  }

  // Apply inlining
  const inlinedDeclarations = declarations
    .filter(decl => decl.kind !== 'type' || !toRemove.has(decl.name))
    .map((decl) => {
      if (decl.typeAnnotation) {
        decl = { ...decl, typeAnnotation: replaceTypeRefs(decl.typeAnnotation) }
      }
      if (decl.returnType) {
        decl = { ...decl, returnType: replaceTypeRefs(decl.returnType) }
      }
      if (decl.extends) {
        decl = { ...decl, extends: replaceTypeRefs(decl.extends) }
      }
      return decl
    })

  return { declarations: inlinedDeclarations, inlined: simpleTypes.size }
}

/**
 * Remove empty interfaces
 */
function removeEmptyInterfacesFn(declarations: Declaration[]): { declarations: Declaration[], removed: number } {
  const before = declarations.length
  const filtered = declarations.filter(decl => !isEmptyInterface(decl))
  return { declarations: filtered, removed: before - filtered.length }
}

/**
 * Optimize declarations
 */
export function optimizeDeclarations(
  declarations: Declaration[],
  config: OptimizerConfig = {},
): { declarations: Declaration[], result: OptimizationResult } {
  let result = [...declarations]
  const stats: OptimizationResult = {
    originalSize: 0,
    optimizedSize: 0,
    savings: 0,
    savingsPercent: 0,
    removedImports: 0,
    removedDeclarations: 0,
    mergedInterfaces: 0,
    inlinedTypes: 0,
  }

  // Remove unused imports
  if (config.removeUnusedImports) {
    const { declarations: filtered, removed } = removeUnusedImportsFn(result)
    result = filtered
    stats.removedImports = removed
  }

  // Deduplicate declarations
  if (config.deduplicateDeclarations) {
    const { declarations: deduped, removed } = deduplicateDeclarationsFn(result)
    result = deduped
    stats.removedDeclarations += removed
  }

  // Merge interfaces
  if (config.mergeInterfaces) {
    const { declarations: merged, merged: count } = mergeInterfacesFn(result)
    result = merged
    stats.mergedInterfaces = count
  }

  // Remove empty interfaces
  if (config.removeEmptyInterfaces) {
    const { declarations: filtered, removed } = removeEmptyInterfacesFn(result)
    result = filtered
    stats.removedDeclarations += removed
  }

  // Inline simple types
  if (config.inlineSimpleTypes) {
    const { declarations: inlined, inlined: count } = inlineSimpleTypesFn(result)
    result = inlined
    stats.inlinedTypes = count
  }

  // Sort imports
  if (config.sortImports) {
    result = sortImports(result)
  }

  // Sort declarations
  if (config.sortDeclarations) {
    result = sortDeclarationsFn(result)
  }

  return { declarations: result, result: stats }
}

/**
 * Optimize a .d.ts file
 */
export async function optimizeFile(
  filePath: string,
  config: OptimizerConfig = {},
): Promise<OptimizationResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const content = readFileSync(filePath, 'utf-8')
  const originalSize = Buffer.byteLength(content, 'utf-8')

  // Extract declarations
  const declarations = extractDeclarations(content, filePath, !config.removeComments)

  // Optimize
  const { declarations: optimized, result } = optimizeDeclarations(declarations, config)

  // Rebuild content
  let optimizedContent = rebuildDeclarations(optimized, config)

  // Minify if requested
  if (config.minify) {
    optimizedContent = minifyDts(optimizedContent)
  }

  const optimizedSize = Buffer.byteLength(optimizedContent, 'utf-8')

  result.originalSize = originalSize
  result.optimizedSize = optimizedSize
  result.savings = originalSize - optimizedSize
  result.savingsPercent = Math.round((result.savings / originalSize) * 100)

  // Write optimized content
  writeFileSync(filePath, optimizedContent)

  return result
}

/**
 * Rebuild declaration content from declarations
 */
function rebuildDeclarations(declarations: Declaration[], config: OptimizerConfig): string {
  const lines: string[] = []

  for (const decl of declarations) {
    // Add comments if not removing them
    if (!config.removeComments && decl.leadingComments) {
      for (const comment of decl.leadingComments) {
        lines.push(comment)
      }
    }

    // Add declaration text
    if (decl.text) {
      lines.push(decl.text)
    }
    else {
      lines.push(buildDeclarationText(decl))
    }

    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Build declaration text from Declaration object
 */
function buildDeclarationText(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  if (decl.isDefault) parts.push('default')

  switch (decl.kind) {
    case 'import':
      if (decl.isTypeOnly) {
        parts.push('import type')
      }
      else {
        parts.push('import')
      }
      if (decl.specifiers && decl.specifiers.length > 0) {
        const specs = decl.specifiers.map((s) => {
          const typePrefix = s.isType ? 'type ' : ''
          return s.alias ? `${typePrefix}${s.name} as ${s.alias}` : `${typePrefix}${s.name}`
        }).join(', ')
        parts.push(`{ ${specs} }`)
      }
      parts.push('from')
      parts.push(`'${decl.source}'`)
      break

    case 'function':
      parts.push('declare function')
      parts.push(decl.name)
      if (decl.generics) parts.push(decl.generics)
      parts.push(`(${buildParams(decl.parameters)})`)
      if (decl.returnType) parts.push(`: ${decl.returnType}`)
      break

    case 'variable':
      parts.push('declare const')
      parts.push(decl.name)
      if (decl.typeAnnotation) parts.push(`: ${decl.typeAnnotation}`)
      break

    case 'interface':
      parts.push('interface')
      parts.push(decl.name)
      if (decl.generics) parts.push(decl.generics)
      if (decl.extends) parts.push(`extends ${decl.extends}`)
      parts.push('{')
      if (decl.members) {
        for (const m of decl.members) {
          parts.push(`  ${m.name}${m.typeAnnotation ? `: ${m.typeAnnotation}` : ''}`)
        }
      }
      parts.push('}')
      break

    case 'type':
      parts.push('type')
      parts.push(decl.name)
      if (decl.generics) parts.push(decl.generics)
      parts.push('=')
      parts.push(decl.typeAnnotation || 'unknown')
      break

    case 'class':
      parts.push('declare class')
      parts.push(decl.name)
      if (decl.generics) parts.push(decl.generics)
      if (decl.extends) parts.push(`extends ${decl.extends}`)
      if (decl.implements?.length) parts.push(`implements ${decl.implements.join(', ')}`)
      parts.push('{ }')
      break

    case 'enum':
      parts.push('declare enum')
      parts.push(decl.name)
      parts.push('{ }')
      break

    default:
      return decl.text || ''
  }

  return parts.join(' ')
}

/**
 * Build parameter string
 */
function buildParams(params?: Declaration['parameters']): string {
  if (!params) return ''
  return params.map((p) => {
    let s = ''
    if (p.rest) s += '...'
    s += p.name
    if (p.optional) s += '?'
    if (p.type) s += `: ${p.type}`
    return s
  }).join(', ')
}

/**
 * Minify .d.ts content
 */
export function minifyDts(content: string): string {
  return content
    // Remove single-line comments (but keep JSDoc)
    .replace(/(?<!\/\*\*)\/\/[^\n]*/g, '')
    // Remove empty lines
    .replace(/^\s*[\r\n]/gm, '')
    // Collapse multiple spaces
    .replace(/  +/g, ' ')
    // Remove space before/after brackets
    .replace(/\s*([{}\[\]();,:])\s*/g, '$1')
    // Add back necessary spaces
    .replace(/([a-zA-Z0-9_])([{])/g, '$1 $2')
    .replace(/([}])([a-zA-Z])/g, '$1 $2')
    .replace(/(export|import|type|interface|class|function|const|let|var|extends|implements|declare)\s*/g, '$1 ')
    // Clean up
    .trim()
}
