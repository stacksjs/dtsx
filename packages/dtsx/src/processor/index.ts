/**
 * Processor module - converts declarations to DTS format
 */

import type { Declaration, DeclarationKind, ProcessingContext } from '../types'
import { extractTripleSlashDirectives } from '../extractor/helpers'
import { assertNever } from '../utils'
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
  const tripleSlashDirectives = extractTripleSlashDirectives(context.sourceCode)
  if (tripleSlashDirectives.length > 0) {
    output.push(...tripleSlashDirectives)
    output.push('') // Blank line after directives
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
  const exportStatements: string[] = []
  const defaultExport: string[] = []

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
      if (!exportStatements.includes(fullExportText)) {
        exportStatements.push(fullExportText)
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

  // Get all unique imported item names for regex matching
  const allImportedItemNames = Array.from(allImportedItemsMap.keys())

  // Filter imports to only include those that are used in exports or declarations
  const usedImportItems = new Set<string>()

  // Collect all declaration texts that need to be checked for imports (single pass)
  const declarationTexts: Array<{ text: string, additionalTexts: string[] }> = []

  // Add exported functions
  for (const func of functions) {
    if (func.isExported) {
      declarationTexts.push({ text: func.text, additionalTexts: [] })
    }
  }

  // Add exported variables
  for (const variable of variables) {
    if (variable.isExported) {
      const additionalTexts: string[] = []
      if (variable.typeAnnotation) {
        additionalTexts.push(variable.typeAnnotation)
      }
      declarationTexts.push({ text: variable.text, additionalTexts })
    }
  }

  // Build reference check sets for interfaces (optimized: single pass over text sources)
  const interfaceReferences = new Set<string>()
  if (interfaces.length > 0) {
    // Collect all texts to search in one array
    const textsToSearch: string[] = []
    for (const func of functions) {
      if (func.isExported)
        textsToSearch.push(func.text)
    }
    for (const cls of classes) {
      textsToSearch.push(cls.text)
    }
    for (const type of types) {
      textsToSearch.push(type.text)
    }

    // Join all texts for a single search per interface (faster than N*M individual searches)
    const combinedText = textsToSearch.join('\n')

    // Single pass: check each interface name against combined text
    for (const iface of interfaces) {
      if (combinedText.includes(iface.name)) {
        interfaceReferences.add(iface.name)
      }
    }
  }

  // Add interfaces (exported or referenced)
  for (const iface of interfaces) {
    if (iface.isExported || interfaceReferences.has(iface.name)) {
      declarationTexts.push({ text: iface.text, additionalTexts: [] })
    }
  }

  // Add all types, classes, enums, modules (they may be included in DTS)
  for (const type of types) {
    declarationTexts.push({ text: type.text, additionalTexts: [] })
  }
  for (const cls of classes) {
    declarationTexts.push({ text: cls.text, additionalTexts: [] })
  }
  for (const enumDecl of enums) {
    declarationTexts.push({ text: enumDecl.text, additionalTexts: [] })
  }
  for (const mod of modules) {
    declarationTexts.push({ text: mod.text, additionalTexts: [] })
  }

  // Add export statements
  for (const exp of exports) {
    declarationTexts.push({ text: exp.text, additionalTexts: [] })
  }

  // Optimized: combine ALL declaration texts into one and do a single pass for import detection
  const allTexts: string[] = []
  for (const { text, additionalTexts } of declarationTexts) {
    allTexts.push(text)
    if (additionalTexts.length > 0) {
      allTexts.push(...additionalTexts)
    }
  }
  const combinedDeclarationText = allTexts.join('\n')

  // Single pass: find all used imports in combined text
  for (const item of allImportedItemNames) {
    const regex = getCachedRegex(item)
    regex.lastIndex = 0
    if (regex.test(combinedDeclarationText)) {
      usedImportItems.add(item)
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
  const typeExports = exportStatements.filter(exp => exp.includes('export type'))
  output.push(...typeExports)

  // Process other declarations (functions, interfaces, etc.)
  const otherDecls = [...functions, ...variables, ...interfaces, ...types, ...classes, ...enums, ...modules]

  for (const decl of otherDecls) {
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
        processed = processModuleDeclaration(decl, keepComments)
        break
      // import and export are handled separately above
      case 'import':
      case 'export':
        break
      case 'namespace':
        processed = processModuleDeclaration(decl, keepComments)
        break
      case 'unknown':
        // Skip unknown declarations
        break
      default:
        assertNever(kind, `Unhandled declaration kind in processor: ${kind}`)
    }

    if (processed) {
      output.push(processed)
    }
  }

  // Process value exports
  const valueExports = exportStatements.filter(exp => !exp.includes('export type'))
  output.push(...valueExports)

  // Process default export last
  output.push(...defaultExport)

  return output.filter(line => line !== '').join('\n')
}
