/**
 * Processor module - converts declarations to DTS format
 */

import type { Declaration, DeclarationKind, ProcessingContext } from '../types'
import { extractTripleSlashDirectives } from '../extractor/directives'
import { getCachedRegex } from './cache'
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
  const output: string[] = []

  // Extract and add triple-slash directives at the top of the file
  // Fast check: only call extractTripleSlashDirectives if source starts with ///
  const src = context.sourceCode
  const firstNonWS = src.length > 0 ? src.trimStart() : ''
  if (firstNonWS.startsWith('///')) {
    const tripleSlashDirectives = extractTripleSlashDirectives(src)
    if (tripleSlashDirectives.length > 0) {
      output.push(...tripleSlashDirectives)
      output.push('') // Blank line after directives
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
  for (const imp of imports) {
    const items = extractAllImportedItems(imp.text)
    for (const item of items) {
      allImportedItemsMap.set(item, imp)
    }
  }

  // Filter imports to only include those that are used in exports or declarations
  const usedImportItems = new Set<string>()

  // Build combined text for import usage detection (single allocation)
  const allTexts: string[] = []

  // Add exported functions
  for (const func of functions) {
    if (func.isExported) {
      allTexts.push(func.text)
    }
  }

  // Add exported variables
  for (const variable of variables) {
    if (variable.isExported) {
      allTexts.push(variable.text)
      if (variable.typeAnnotation) {
        allTexts.push(variable.typeAnnotation)
      }
    }
  }

  // Build reference check sets for interfaces (optimized: single pass over text sources)
  const interfaceReferences = new Set<string>()
  if (interfaces.length > 0) {
    // Build combined text from functions/classes/types for interface reference check
    let refCheckText = ''
    for (const func of functions) {
      if (func.isExported)
        refCheckText += func.text + '\n'
    }
    for (const cls of classes) {
      refCheckText += cls.text + '\n'
    }
    for (const type of types) {
      refCheckText += type.text + '\n'
    }

    for (const iface of interfaces) {
      if (refCheckText.includes(iface.name)) {
        interfaceReferences.add(iface.name)
      }
    }
  }

  // Add interfaces (exported or referenced)
  for (const iface of interfaces) {
    if (iface.isExported || interfaceReferences.has(iface.name)) {
      allTexts.push(iface.text)
    }
  }

  // Add all types, classes, enums, modules
  for (const type of types) {
    allTexts.push(type.text)
  }
  for (const cls of classes) {
    allTexts.push(cls.text)
  }
  for (const enumDecl of enums) {
    allTexts.push(enumDecl.text)
  }
  for (const mod of modules) {
    allTexts.push(mod.text)
  }

  // Add export statements
  for (const exp of exports) {
    allTexts.push(exp.text)
  }

  // Two-phase import detection: fast includes() rejection then regex word-boundary check
  // Check each text individually to avoid large join() allocation
  for (const item of allImportedItemsMap.keys()) {
    for (let t = 0; t < allTexts.length; t++) {
      if (allTexts[t].includes(item) && getCachedRegex(item).test(allTexts[t])) {
        usedImportItems.add(item)
        break
      }
    }
  }

  // Check which imports are needed for re-exports (direct matches)
  for (const item of exportedItems) {
    if (allImportedItemsMap.has(item)) {
      usedImportItems.add(item)
    }
  }

  // Create filtered imports based on actually used items
  const processedImports: string[] = []
  for (const imp of imports) {
    // Preserve side-effect imports unconditionally (they may have type effects like reflect-metadata)
    if (imp.isSideEffect) {
      const sideEffectImport = imp.text.trim().endsWith(';') ? imp.text.trim() : `${imp.text.trim()};`
      processedImports.push(sideEffectImport)
      continue
    }

    // Parse import using string operations to avoid regex backtracking
    const parsed = parseImportStatement(imp.text)
    if (!parsed)
      continue

    const { defaultName, namedItems, source, isTypeOnly } = parsed

    // Filter to only used items
    const usedDefault = defaultName ? usedImportItems.has(defaultName) : false
    const usedNamed = namedItems.filter((item) => {
      let cleanItem = item.startsWith('type ') ? item.slice(5).trim() : item.trim()
      // For aliases 'OriginalName as AliasName', check if AliasName is used
      const asIndex = cleanItem.indexOf(' as ')
      if (asIndex !== -1) {
        cleanItem = cleanItem.slice(asIndex + 4).trim()
      }
      return usedImportItems.has(cleanItem)
    })

    if (usedDefault || usedNamed.length > 0) {
      let importStatement = 'import '
      if (isTypeOnly) {
        importStatement += 'type '
      }

      const parts: string[] = []
      if (usedDefault && defaultName) {
        parts.push(defaultName)
      }
      if (usedNamed.length > 0) {
        parts.push(`{ ${usedNamed.join(', ')} }`)
      }

      importStatement += `${parts.join(', ')} from '${source}';`
      processedImports.push(importStatement)
    }
  }

  // Sort imports based on importOrder priority, then alphabetically
  processedImports.sort((a, b) => {
    // Find the priority index for each import (-1 if not in priority list)
    const getPriority = (imp: string): number => {
      for (let i = 0; i < importOrder.length; i++) {
        if (imp.includes(`from '${importOrder[i]}`) || imp.includes(`from "${importOrder[i]}`)) {
          return i
        }
      }
      return importOrder.length // Non-priority imports come last
    }

    const aPriority = getPriority(a)
    const bPriority = getPriority(b)

    if (aPriority !== bPriority) {
      return aPriority - bPriority
    }

    return a.localeCompare(b)
  })

  output.push(...processedImports)

  // Always add blank line after imports if there are any imports
  if (processedImports.length > 0)
    output.push('')

  // Process type exports first
  for (let i = 0; i < typeExportStatements.length; i++) output.push(typeExportStatements[i])

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
      if (processed) output.push(processed)
    }
  }

  // Process value exports
  for (let i = 0; i < valueExportStatements.length; i++) output.push(valueExportStatements[i])

  // Process default export last
  for (let i = 0; i < defaultExport.length; i++) output.push(defaultExport[i])

  // Build final output — skip empty strings inline instead of filter()
  let result = ''
  for (let i = 0; i < output.length; i++) {
    if (output[i] !== '') {
      if (result) result += '\n'
      result += output[i]
    }
  }
  return result
}
