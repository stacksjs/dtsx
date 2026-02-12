/**
 * Processor module - converts declarations to DTS format
 */

import type { Declaration, DeclarationKind, ProcessingContext } from '../types'
import { extractTripleSlashDirectives } from '../extractor/directives'
import { formatComments } from './comments'
import {
  processClassDeclaration,
  processEnumDeclaration,
  processFunctionDeclaration,
  processInterfaceDeclaration,
  processModuleDeclaration,
  processTypeDeclaration,
  processVariableDeclaration,
} from './declarations'
import { extractAllImportedItems, parseImportStatement } from './imports'

function assertNever(value: never, message?: string): never {
  throw new Error(message || `Unexpected value: ${value}`)
}

function isIdentChar(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57)
    || ch === 95 || ch === 36 || ch > 127
}

/** Check if name appears as a whole word in text (fast indexOf + boundary check). */
function isWordInText(name: string, text: string): boolean {
  let searchFrom = 0
  const nameLen = name.length
  while (searchFrom < text.length) {
    const idx = text.indexOf(name, searchFrom)
    if (idx === -1) return false
    const before = idx > 0 ? text.charCodeAt(idx - 1) : 32
    const after = idx + nameLen < text.length ? text.charCodeAt(idx + nameLen) : 32
    const beforeOk = !isIdentChar(before)
    const afterOk = !isIdentChar(after)
    if (beforeOk && afterOk) return true
    searchFrom = idx + 1
  }
  return false
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

const EXPORT_ITEMS_PATTERN = /export\s+(?:type\s+)?\{\s*([^}]+)\s*\}/

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
  const exportedItems = new Set<string>()
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

      // Extract exported items for tracking (using cached pattern)
      const match = exportText.match(EXPORT_ITEMS_PATTERN)
      if (match) {
        const items = match[1].split(',').map(item => item.trim())
        for (const item of items) {
          exportedItems.add(item)
        }
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

  // Build a map of all imported items to their import declarations (single pass)
  // This eliminates the O(n²) iteration over imports for each declaration
  const allImportedItemsMap = new Map<string, Declaration>()
  if (imports.length > 0) {
    for (const imp of imports) {
      const items = extractAllImportedItems(imp.text)
      for (const item of items) {
        allImportedItemsMap.set(item, imp)
      }
    }
  }

  // Build reference check sets for interfaces
  // Join all referencing texts into ONE string, then search each interface name once.
  // This replaces the O(interfaces * (functions + classes + types)) nested loop
  // with O(total_text_length + interfaces * total_text_length) which is more cache-friendly.
  const interfaceReferences = new Set<string>()
  if (interfaces.length > 0) {
    const refParts: string[] = []
    for (const func of functions) {
      if (func.isExported) refParts.push(func.text)
    }
    for (const cls of classes) refParts.push(cls.text)
    for (const type of types) refParts.push(type.text)
    if (refParts.length > 0) {
      const refText = refParts.join('\n')
      for (const iface of interfaces) {
        if (isWordInText(iface.name, refText)) {
          interfaceReferences.add(iface.name)
        }
      }
    }
  }

  // Create filtered imports based on actually used items
  const processedImports: string[] = []
  if (imports.length > 0) {
    // Filter imports to only include those that are used in exports or declarations
    const usedImportItems = new Set<string>()

    // Build combined text for import usage detection
    const textParts: string[] = []
    for (const func of functions) {
      if (func.isExported) textParts.push(func.text)
    }
    for (const variable of variables) {
      if (variable.isExported) {
        textParts.push(variable.text)
        if (variable.typeAnnotation) textParts.push(variable.typeAnnotation)
      }
    }
    for (const iface of interfaces) {
      if (iface.isExported || interfaceReferences.has(iface.name)) textParts.push(iface.text)
    }
    for (const type of types) textParts.push(type.text)
    for (const cls of classes) textParts.push(cls.text)
    for (const enumDecl of enums) textParts.push(enumDecl.text)
    for (const mod of modules) textParts.push(mod.text)
    for (const exp of exports) textParts.push(exp.text)
    const combinedText = textParts.join('\n')

    // Import detection: search each import item once in the combined text.
    // This replaces the O(imports * text_parts) nested loop with O(imports) searches
    // on a single string, leveraging native indexOf for cache-friendly scanning.
    if (combinedText && allImportedItemsMap.size > 0) {
      for (const item of allImportedItemsMap.keys()) {
        if (isWordInText(item, combinedText)) {
          usedImportItems.add(item)
        }
      }
    }

    // Check which imports are needed for re-exports (direct matches)
    for (const item of exportedItems) {
      if (allImportedItemsMap.has(item)) {
        usedImportItems.add(item)
      }
    }

    for (const imp of imports) {
      // Preserve side-effect imports unconditionally (they may have type effects like reflect-metadata)
      if (imp.isSideEffect) {
        const _trimmedImp = imp.text.trim()
        const sideEffectImport = _trimmedImp.endsWith(';') ? _trimmedImp : `${_trimmedImp};`
        processedImports.push(sideEffectImport)
        continue
      }

      // Parse import using string operations to avoid regex backtracking
      const parsed = parseImportStatement(imp.text)
      if (!parsed)
        continue

      const { defaultName, namedItems, source, isTypeOnly } = parsed

      // Filter to only used items (manual loop avoids closure allocation)
      const usedDefault = defaultName ? usedImportItems.has(defaultName) : false
      let usedNamedStr = ''
      let usedNamedCount = 0
      for (let ni = 0; ni < namedItems.length; ni++) {
        const item = namedItems[ni]
        let cleanItem = item.charCodeAt(0) === 116 && item.startsWith('type ') ? item.slice(5).trim() : item.trim()
        const asIndex = cleanItem.indexOf(' as ')
        if (asIndex !== -1) {
          cleanItem = cleanItem.slice(asIndex + 4).trim()
        }
        if (usedImportItems.has(cleanItem)) {
          if (usedNamedCount > 0) usedNamedStr += ', '
          usedNamedStr += item
          usedNamedCount++
        }
      }

      if (usedDefault || usedNamedCount > 0) {
        let importStatement = isTypeOnly ? 'import type ' : 'import '
        if (usedDefault && defaultName) {
          importStatement += usedNamedCount > 0 ? `${defaultName}, { ${usedNamedStr} }` : defaultName
        }
        else if (usedNamedCount > 0) {
          importStatement += `{ ${usedNamedStr} }`
        }
        importStatement += ` from '${source}';`
        processedImports.push(importStatement)
      }
    }

    // Sort imports based on importOrder priority, then alphabetically
    // Pre-compute priority for each import into a Map (avoids re-scanning in O(n log n) comparator)
    const defaultPriority = importOrder.length
    if (processedImports.length > 1) {
      const prioritySingle = importOrder.map(p => `from '${p}`)
      const priorityDouble = importOrder.map(p => `from "${p}`)
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

  return result
}
