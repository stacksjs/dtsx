/**
 * Processor module - converts declarations to DTS format
 */
import type { Declaration, DeclarationKind, ProcessingContext } from '../types'
import { isExternalModuleSource, isPrivateImportableDeclaration } from '../declaration-references'
import { extractTripleSlashDirectives } from '../extractor/directives'
import { formatComments } from './comments'
import { processClassDeclaration, processEnumDeclaration, processFunctionDeclaration, processInterfaceDeclaration, processModuleDeclaration, processTypeDeclaration, processVariableDeclaration } from './declarations'
import { analyzeDeclarationImportUsage } from './import-usage'
import { getImportSourceLiteral, parseImportDetailed } from './imports'

function assertNever(value: never, message?: string): never {
  throw new Error(message || `Unexpected value: ${value}`)
}

// Re-export all public APIs
export { clearProcessorCaches } from './cache'
export { formatComments } from './comments'
export {
  processClassDeclaration,
  processEnumDeclaration,
  processExportDeclaration,
  processFunctionDeclaration,
  processImportDeclaration,
  processInterfaceDeclaration,
  processModuleDeclaration,
  processTypeDeclaration,
  processVariableDeclaration,
} from './declarations'
export { extractAllImportedItems, parseImportStatement } from './imports'
export {
  extractSatisfiesType,
  findMatchingBracket,
  inferArrayType,
  inferFunctionType,
  inferNarrowType,
  inferNarrowTypeInUnion,
  inferObjectType,
  isGenericType,
  parseArrayElements,
} from './type-inference'

// Module-level cache for import priority patterns
let _cachedImportOrder: string[] | null = null
let _cachedPrioritySingle: string[] = []
let _cachedPriorityDouble: string[] = []

/**
 * Process declarations and convert them to narrow DTS format
 */
export function processDeclarations(
  declarations: Declaration[],
  context: ProcessingContext,
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
): string {
  // Build result string directly instead of output array (avoids array + join allocation)
  let result = ''

  // Extract and add triple-slash directives at the top of the file
  // Fast check: skip whitespace with charCodeAt to avoid trimStart() allocation
  const src = context.sourceCode
  if (src) {
    let _si = 0
    while (_si < src.length && (src.charCodeAt(_si) === 32 || src.charCodeAt(_si) === 9 || src.charCodeAt(_si) === 10 || src.charCodeAt(_si) === 13)) _si++
    if (_si < src.length - 2 && src.charCodeAt(_si) === 47 && src.charCodeAt(_si + 1) === 47 && src.charCodeAt(_si + 2) === 47) {
      const tripleSlashDirectives = extractTripleSlashDirectives(src)
      if (tripleSlashDirectives.length > 0) {
        for (let i = 0; i < tripleSlashDirectives.length; i++) {
          if (result) result += '\n'
          result += tripleSlashDirectives[i]
        }
      }
    }
  }

  // Group declarations by type for better organization (single pass)
  const imports: Declaration[] = []
  const functions: Declaration[] = []
  const variables: Declaration[] = []
  const interfaces: Declaration[] = []
  const types: Declaration[] = []
  const classes: Declaration[] = []
  const enums: Declaration[] = []
  const modules: Declaration[] = []
  const exports: Declaration[] = []

  for (const d of declarations) {
    const kind: DeclarationKind = d.kind
    switch (kind) {
      case 'import': imports.push(d); break
      case 'function': functions.push(d); break
      case 'variable': variables.push(d); break
      case 'interface': interfaces.push(d); break
      case 'type': types.push(d); break
      case 'class': classes.push(d); break
      case 'enum': enums.push(d); break
      case 'module': modules.push(d); break
      case 'export': exports.push(d); break
      case 'namespace': modules.push(d); break // namespaces are treated like modules
      case 'unknown': break // skip unknown declarations
      default: assertNever(kind, `Unhandled declaration kind: ${kind}`)
    }
  }

  // Parse all exports to understand what's being exported
  const typeExportStatements: string[] = []
  const valueExportStatements: string[] = []
  const defaultExport: string[] = []
  const seenExports = new Set<string>()

  for (const decl of exports) {
    // Prepend comments if present
    const comments = formatComments(decl.leadingComments, keepComments)

    if (decl.text.startsWith('export default')) {
      const statement = decl.text.endsWith(';') ? decl.text : `${decl.text};`
      defaultExport.push(comments + statement)
    }
    else {
      // Handle multi-line export statements properly
      let exportText = decl.text.trim()

      // Clean up the export text and ensure it ends with semicolon
      if (!exportText.endsWith(';')) {
        exportText += ';'
      }

      const fullExportText = comments + exportText
      if (!seenExports.has(fullExportText)) {
        seenExports.add(fullExportText)
        // Categorize into type vs value exports in one pass
        if (fullExportText.includes('export type')) {
          typeExportStatements.push(fullExportText)
        }
        else {
          valueExportStatements.push(fullExportText)
        }
      }
    }
  }

  const processedImports: string[] = []
  if (imports.length > 0) {
    const { usedItems: usedImportItems } = analyzeDeclarationImportUsage(declarations)

    for (const imp of imports) {
      // Preserve side-effect imports unconditionally (they may have type effects like reflect-metadata)
      if (imp.isSideEffect) {
        const _trimmedImp = imp.text.trim()
        const sideEffectImport = _trimmedImp.endsWith(';') ? _trimmedImp : `${_trimmedImp};`
        processedImports.push(sideEffectImport)
        continue
      }

      // Parse import using string operations to avoid regex backtracking
      const parsed = parseImportDetailed(imp.text)
      if (!parsed)
        continue

      const { defaultName, namedItems, isTypeOnly, namespaceName } = parsed

      // Filter to only used items (manual loop avoids closure allocation)
      const usedDefault = defaultName ? usedImportItems.has(defaultName) : false
      const usedNamespace = namespaceName ? usedImportItems.has(namespaceName) : false
      if (parsed.isImportEquals) {
        if (usedDefault) {
          const original = imp.text.trim()
          processedImports.push(original.endsWith(';') ? original : `${original};`)
        }
        else if (context.augmentationImports?.has(parsed.source)) {
          const literal = getImportSourceLiteral(imp.text)
          if (!literal) throw new Error('Cannot locate an augmentation import module literal')
          processedImports.push(`import ${literal};`)
        }
        continue
      }
      let usedNamedStr = ''
      let usedNamedCount = 0
      for (let ni = 0; ni < namedItems.length; ni++) {
        const item = namedItems[ni]
        if (usedImportItems.has(item.name)) {
          if (usedNamedCount > 0) usedNamedStr += ', '
          if (!isTypeOnly && item.isTypeOnly) usedNamedStr += 'type '
          usedNamedStr += item.originalName === item.name ? item.name : `${item.originalName} as ${item.name}`
          usedNamedCount++
        }
      }

      if (usedDefault || usedNamespace || usedNamedCount > 0) {
        let importStatement = isTypeOnly ? 'import type ' : 'import '
        if (usedNamespace && namespaceName) {
          if (usedDefault && defaultName) importStatement += `${defaultName}, `
          importStatement += `* as ${namespaceName}`
        }
        else if (usedDefault && defaultName) {
          importStatement += usedNamedCount > 0 ? `${defaultName}, { ${usedNamedStr} }` : defaultName
        }
        else if (usedNamedCount > 0) {
          importStatement += `{ ${usedNamedStr} }`
        }
        const sourceLiteral = getImportSourceLiteral(imp.text)
        if (!sourceLiteral) throw new Error('Cannot locate a grammatical module literal in the import declaration')
        importStatement += ` from ${sourceLiteral};`
        processedImports.push(importStatement)
      }
      else if (context.augmentationImports?.has(parsed.source)) {
        const literal = getImportSourceLiteral(imp.text)
        if (!literal) throw new Error('Cannot locate an augmentation import module literal')
        processedImports.push(`import ${literal};`)
      }
    }

    // Sort imports based on importOrder priority, then alphabetically
    // Pre-compute priority for each import into a Map (avoids re-scanning in O(n log n) comparator)
    const defaultPriority = importOrder.length
    if (processedImports.length > 1) {
      if (_cachedImportOrder !== importOrder) {
        _cachedImportOrder = importOrder
        _cachedPrioritySingle = importOrder.map(p => `from '${p}`)
        _cachedPriorityDouble = importOrder.map(p => `from "${p}`)
      }
      const prioritySingle = _cachedPrioritySingle
      const priorityDouble = _cachedPriorityDouble
      const priorityMap = new Map<string, number>()
      for (const imp of processedImports) {
        let p = defaultPriority
        for (let i = 0; i < importOrder.length; i++) {
          if (imp.includes(prioritySingle[i]) || imp.includes(priorityDouble[i])) { p = i; break }
        }
        priorityMap.set(imp, p)
      }
      processedImports.sort((a, b) => {
        const ap = priorityMap.get(a)!
        const bp = priorityMap.get(b)!
        return ap !== bp ? ap - bp : a.localeCompare(b)
      })
    }
  }

  // Append imports to result
  for (let i = 0; i < processedImports.length; i++) {
    if (result) result += '\n'
    result += processedImports[i]
  }

  // Process type exports first
  for (let i = 0; i < typeExportStatements.length; i++) {
    if (result) result += '\n'
    result += typeExportStatements[i]
  }

  // Process other declarations — iterate each group directly (no spread allocation)
  const declGroups = [functions, variables, interfaces, types, classes, enums, modules]
  for (let g = 0; g < declGroups.length; g++) {
    const group = declGroups[g]
    for (let d = 0; d < group.length; d++) {
      const decl = group[d]
      let processed = ''
      const kind: DeclarationKind = decl.kind
      switch (kind) {
        case 'function':
          processed = processFunctionDeclaration(decl, keepComments)
          break
        case 'variable':
          processed = processVariableDeclaration(decl, keepComments)
          break
        case 'interface':
          processed = processInterfaceDeclaration(decl, keepComments)
          break
        case 'type':
          processed = processTypeDeclaration(decl, keepComments)
          break
        case 'class':
          processed = processClassDeclaration(decl, keepComments)
          break
        case 'enum':
          processed = processEnumDeclaration(decl, keepComments)
          break
        case 'module':
        case 'namespace':
          processed = processModuleDeclaration(decl, keepComments)
          break
        case 'import':
        case 'export':
        case 'unknown':
          break
        default:
          assertNever(kind, `Unhandled declaration kind in processor: ${kind}`)
      }
      if (processed) {
        if (result) result += '\n'
        result += processed
      }
    }
  }

  // Process value exports
  for (let i = 0; i < valueExportStatements.length; i++) {
    if (result) result += '\n'
    result += valueExportStatements[i]
  }

  // Process default export last
  for (let i = 0; i < defaultExport.length; i++) {
    if (result) result += '\n'
    result += defaultExport[i]
  }

  // Keep original module identity when imports were pruned, and prevent ambient
  // local bindings from becoming implicit named exports. Augmentations alone
  // introduce no local binding and need no extra clause in an existing module.
  if (isExternalModuleSource(context.sourceCode) && exports.length === 0
    && (!isExternalModuleSource(result) || declarations.some(isPrivateImportableDeclaration))) {
    result += `${result ? '\n' : ''}export {};`
  }

  return result
}
