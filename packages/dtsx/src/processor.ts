/* eslint-disable regexp/no-super-linear-backtracking, regexp/optimal-quantifier-concatenation, regexp/no-unused-capturing-group */
import type { Declaration, ProcessingContext } from './types'

/**
 * Maximum cache sizes to prevent memory bloat
 */
const MAX_REGEX_CACHE_SIZE = 500
const MAX_IMPORT_CACHE_SIZE = 200

/**
 * Cache for compiled RegExp patterns to avoid recreation in loops
 * Key: escaped pattern string, Value: compiled RegExp with word boundaries
 */
const regexCache = new Map<string, RegExp>()

/**
 * Get or create a cached RegExp for word boundary matching
 */
function getCachedRegex(pattern: string): RegExp {
  let cached = regexCache.get(pattern)
  if (!cached) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    cached = new RegExp(`\\b${escaped}\\b`)
    regexCache.set(pattern, cached)

    // Evict oldest entries if cache is too large
    if (regexCache.size > MAX_REGEX_CACHE_SIZE) {
      const firstKey = regexCache.keys().next().value
      if (firstKey) {
        regexCache.delete(firstKey)
      }
    }
  }
  return cached
}

/**
 * Cache for extractAllImportedItems results
 * Key: import text, Value: array of imported items
 */
const importItemsCache = new Map<string, string[]>()

/**
 * Clear processor caches (useful for testing or memory management)
 */
export function clearProcessorCaches(): void {
  regexCache.clear()
  importItemsCache.clear()
}

/**
 * Format comments for DTS output
 */
function formatComments(comments: string[] | undefined, keepComments: boolean = true): string {
  if (!keepComments || !comments || comments.length === 0) {
    return ''
  }

  const formattedComments = comments.map((comment) => {
    // Ensure proper spacing and formatting
    return comment.trim()
  }).join('\n')

  return `${formattedComments}\n`
}

/**
 * Find the start of interface body, accounting for nested braces in generics
 * Returns the index of the opening brace of the body, or -1 if not found
 */
function findInterfaceBodyStart(text: string): number {
  let angleDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const prevChar = i > 0 ? text[i - 1] : ''

    // Handle string literals
    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      // Track angle brackets for generics
      if (char === '<') {
        angleDepth++
      }
      else if (char === '>') {
        angleDepth--
      }
      // The body starts with { after all generics are closed
      else if (char === '{' && angleDepth === 0) {
        return i
      }
    }
  }

  return -1
}

/**
 * Replace unresolved types with 'any' in the DTS output
 */
function replaceUnresolvedTypes(dtsContent: string, declarations: Declaration[], imports: Declaration[]): string {
  // Get all imported type names
  const importedTypes = new Set<string>()
  for (const imp of imports) {
    const allImportedItems = extractAllImportedItems(imp.text)
    allImportedItems.forEach(item => importedTypes.add(item))
  }

  // Get all declared type names (interfaces, types, classes, enums)
  const declaredTypes = new Set<string>()
  for (const decl of declarations) {
    if (['interface', 'type', 'class', 'enum'].includes(decl.kind)) {
      declaredTypes.add(decl.name)
    }
  }

  // Extract all types that are actually defined in the DTS content itself
  // This catches types that weren't extracted but are still defined in the output
  const definedInDts = new Set<string>()

  // Look for interface definitions
  const interfaceMatches = dtsContent.match(/(?:export\s+)?(?:declare\s+)?interface\s+([A-Z][a-zA-Z0-9]*)/g)
  if (interfaceMatches) {
    interfaceMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?(?:declare\s+)?interface\s+/, '')
      definedInDts.add(name)
    })
  }

  // Look for type alias definitions
  const typeMatches = dtsContent.match(/(?:export\s+)?(?:declare\s+)?type\s+([A-Z][a-zA-Z0-9]*)/g)
  if (typeMatches) {
    typeMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?(?:declare\s+)?type\s+/, '')
      definedInDts.add(name)
    })
  }

  // Look for class definitions
  const classMatches = dtsContent.match(/(?:export\s+)?(?:declare\s+)?class\s+([A-Z][a-zA-Z0-9]*)/g)
  if (classMatches) {
    classMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?(?:declare\s+)?class\s+/, '')
      definedInDts.add(name)
    })
  }

  // Look for enum definitions
  const enumMatches = dtsContent.match(/(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Z][a-zA-Z0-9]*)/g)
  if (enumMatches) {
    enumMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+/, '')
      definedInDts.add(name)
    })
  }

  // Only replace types that are:
  // 1. Not imported
  // 2. Not declared in our extracted declarations
  // 3. Not built-in TypeScript types
  // 4. Not generic type parameters
  // 5. Not defined anywhere in the DTS content itself
  // 6. Actually used as types (not values)
  // 7. Have specific patterns that indicate they're problematic

  const result = dtsContent

  // For now, don't do any automatic type replacement
  // The proper solution is to improve the extractor to find all referenced types

  return result
}

/**
 * Parse an import statement into its components using string operations
 * Avoids regex backtracking issues
 */
function parseImportStatement(importText: string): {
  defaultName: string | null
  namedItems: string[]
  source: string
  isTypeOnly: boolean
} | null {
  // Find 'from' and extract source
  const fromIndex = importText.indexOf(' from ')
  if (fromIndex === -1) return null

  // Extract source (between quotes after 'from')
  const afterFrom = importText.slice(fromIndex + 6).trim()
  const quoteChar = afterFrom[0]
  if (quoteChar !== '"' && quoteChar !== '\'') return null

  const endQuote = afterFrom.indexOf(quoteChar, 1)
  if (endQuote === -1) return null

  const source = afterFrom.slice(1, endQuote)

  // Parse the import part (before 'from')
  let importPart = importText.slice(0, fromIndex).trim()

  // Check for 'import type'
  const isTypeOnly = importPart.startsWith('import type ')
  if (importPart.startsWith('import ')) {
    importPart = importPart.slice(7).trim()
  }
  if (importPart.startsWith('type ')) {
    importPart = importPart.slice(5).trim()
  }

  let defaultName: string | null = null
  const namedItems: string[] = []

  // Check for braces (named imports)
  const braceStart = importPart.indexOf('{')
  const braceEnd = importPart.lastIndexOf('}')

  if (braceStart !== -1 && braceEnd !== -1) {
    // Check for default import before braces
    const beforeBrace = importPart.slice(0, braceStart).trim()
    if (beforeBrace.endsWith(',')) {
      defaultName = beforeBrace.slice(0, -1).trim() || null
    }

    // Extract named imports
    const namedPart = importPart.slice(braceStart + 1, braceEnd)
    const items = namedPart.split(',').map(s => s.trim()).filter(Boolean)
    namedItems.push(...items)
  }
  else {
    // Default import only
    defaultName = importPart.trim() || null
  }

  return { defaultName, namedItems, source, isTypeOnly }
}

/**
 * Extract all imported items from an import statement (with caching)
 * Uses simple string operations to avoid regex backtracking
 */
function extractAllImportedItems(importText: string): string[] {
  // Check cache first
  const cached = importItemsCache.get(importText)
  if (cached) {
    return cached
  }

  const items: string[] = []

  // Helper to clean import item names and extract alias if present
  // For 'SomeType as AliasedType', returns 'AliasedType' (the local name used in code)
  const cleanImportItem = (item: string): string => {
    let trimmed = item.trim()
    // Remove 'type ' prefix
    if (trimmed.startsWith('type ')) {
      trimmed = trimmed.slice(5).trim()
    }
    // Handle aliases: 'OriginalName as AliasName' -> 'AliasName'
    const asIndex = trimmed.indexOf(' as ')
    if (asIndex !== -1) {
      return trimmed.slice(asIndex + 4).trim()
    }
    return trimmed
  }

  // Find 'from' keyword position
  const fromIndex = importText.indexOf(' from ')
  if (fromIndex === -1) {
    importItemsCache.set(importText, items)
    return items
  }

  // Get the part between 'import' and 'from'
  let importPart = importText.slice(0, fromIndex).trim()

  // Remove 'import' keyword and optional 'type' keyword
  if (importPart.startsWith('import ')) {
    importPart = importPart.slice(7).trim()
  }
  if (importPart.startsWith('type ')) {
    importPart = importPart.slice(5).trim()
  }

  // Check for named imports with braces
  const braceStart = importPart.indexOf('{')
  const braceEnd = importPart.lastIndexOf('}')

  if (braceStart !== -1 && braceEnd !== -1) {
    // Check for default import before braces (mixed import)
    const beforeBrace = importPart.slice(0, braceStart).trim()
    if (beforeBrace.endsWith(',')) {
      // Mixed import: defaultName, { a, b }
      const defaultName = beforeBrace.slice(0, -1).trim()
      if (defaultName) {
        items.push(defaultName)
      }
    }
    else if (beforeBrace && !beforeBrace.includes(',')) {
      // Default import before braces without comma (shouldn't happen but handle it)
      items.push(beforeBrace)
    }

    // Extract named imports from braces
    const namedPart = importPart.slice(braceStart + 1, braceEnd)
    const namedItems = namedPart.split(',').map(cleanImportItem).filter(Boolean)
    items.push(...namedItems)
  }
  else {
    // Default import only: import defaultName from 'module'
    const defaultName = importPart.trim()
    if (defaultName) {
      items.push(defaultName)
    }
  }

  importItemsCache.set(importText, items)

  // Evict oldest entries if cache is too large
  if (importItemsCache.size > MAX_IMPORT_CACHE_SIZE) {
    const firstKey = importItemsCache.keys().next().value
    if (firstKey) {
      importItemsCache.delete(firstKey)
    }
  }

  return items
}

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
    switch (d.kind) {
      case 'import': imports.push(d); break
      case 'function': functions.push(d); break
      case 'variable': variables.push(d); break
      case 'interface': interfaces.push(d); break
      case 'type': types.push(d); break
      case 'class': classes.push(d); break
      case 'enum': enums.push(d); break
      case 'module': modules.push(d); break
      case 'export': exports.push(d); break
    }
  }

  // Parse all exports to understand what's being exported
  const exportedItems = new Set<string>()
  const exportStatements: string[] = []
  const defaultExport: string[] = []

  for (const decl of exports) {
    if (decl.text.startsWith('export default')) {
      const statement = decl.text.endsWith(';') ? decl.text : `${decl.text};`
      defaultExport.push(statement)
    }
    else {
      // Handle multi-line export statements properly
      let exportText = decl.text.trim()

      // Clean up the export text and ensure it ends with semicolon
      if (!exportText.endsWith(';')) {
        exportText += ';'
      }

      // Extract exported items for tracking
      const match = exportText.match(/export\s+(?:type\s+)?\{\s*([^}]+)\s*\}/)
      if (match) {
        const items = match[1].split(',').map(item => item.trim())
        for (const item of items) {
          exportedItems.add(item)
        }
      }

      if (!exportStatements.includes(exportText)) {
        exportStatements.push(exportText)
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

  // Helper function to check which imports are used in a text
  function findUsedImports(text: string, additionalTexts: string[] = []): Set<string> {
    const used = new Set<string>()
    const textsToCheck = [text, ...additionalTexts]

    for (const item of allImportedItemNames) {
      const regex = getCachedRegex(item)
      for (const textToCheck of textsToCheck) {
        if (regex.test(textToCheck)) {
          used.add(item)
          break // Found in at least one text, no need to check others
        }
      }
    }
    return used
  }

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

  // Build reference check sets for interfaces
  const interfaceReferences = new Set<string>()
  for (const func of functions) {
    if (func.isExported) {
      for (const iface of interfaces) {
        if (func.text.includes(iface.name)) {
          interfaceReferences.add(iface.name)
        }
      }
    }
  }
  for (const cls of classes) {
    for (const iface of interfaces) {
      if (cls.text.includes(iface.name)) {
        interfaceReferences.add(iface.name)
      }
    }
  }
  for (const type of types) {
    for (const iface of interfaces) {
      if (type.text.includes(iface.name)) {
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

  // Single pass: find all used imports across all declarations
  for (const { text, additionalTexts } of declarationTexts) {
    const used = findUsedImports(text, additionalTexts)
    for (const item of used) {
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
    if (!parsed) continue

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
    switch (decl.kind) {
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

  let result = output.filter(line => line !== '').join('\n')

  // Post-process to replace unresolved internal types with 'any'
  // This handles cases where internal interfaces/types are referenced but not extracted
  result = replaceUnresolvedTypes(result, declarations, imports)

  return result
}

/**
 * Process function declaration to DTS format
 */
export function processFunctionDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // The extractor already provides the correct DTS signature, just return it
  return comments + decl.text
}

/**
 * Check if a type annotation is a generic/broad type that should be replaced with narrow inference
 */
function isGenericType(typeAnnotation: string): boolean {
  const trimmed = typeAnnotation.trim()

  // Generic types that are less specific than narrow inference
  if (trimmed === 'any' || trimmed === 'object' || trimmed === 'unknown') {
    return true
  }

  // Record types like Record<string, string>, Record<string, any>, etc.
  if (trimmed.startsWith('Record<') && trimmed.endsWith('>')) {
    return true
  }

  // Array types like Array<any>, Array<string>, etc. (but not specific tuples)
  if (trimmed.startsWith('Array<') && trimmed.endsWith('>')) {
    return true
  }

  // Object types like { [key: string]: any }
  if (trimmed.match(/^\{\s*\[.*\]:\s*(any|string|number|unknown)\s*\}$/)) {
    return true
  }

  return false
}

/**
 * Process variable declaration to DTS format
 */
export function processVariableDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Add variable kind (const, let, var)
  const kind = decl.modifiers?.[0] || 'const'
  result += `${kind} `

  // Add variable name
  result += decl.name

  // Add type annotation
  let typeAnnotation = decl.typeAnnotation

  // Check for 'satisfies' operator - extract the type from the satisfies clause
  if (decl.value && decl.value.includes(' satisfies ')) {
    const satisfiesType = extractSatisfiesType(decl.value)
    if (satisfiesType) {
      typeAnnotation = satisfiesType
    }
  }
  // If we have a value, check if it has 'as const' - if so, infer from value instead of type annotation
  else if (decl.value && decl.value.includes('as const')) {
    typeAnnotation = inferNarrowType(decl.value, true)
  }
  else if (!typeAnnotation && decl.value && kind === 'const') {
    // For const declarations WITHOUT explicit type annotation, infer narrow types from the value
    typeAnnotation = inferNarrowType(decl.value, true)
  }
  else if (typeAnnotation && decl.value && kind === 'const' && isGenericType(typeAnnotation)) {
    // For const declarations with generic type annotations (Record, any, object), prefer narrow inference
    const inferredType = inferNarrowType(decl.value, true)
    if (inferredType !== 'unknown') {
      typeAnnotation = inferredType
    }
  }
  else if (!typeAnnotation && decl.value) {
    // If no explicit type annotation, try to infer from value
    typeAnnotation = inferNarrowType(decl.value, kind === 'const')
  }

  // Default to any if we couldn't determine type
  if (!typeAnnotation) {
    typeAnnotation = 'any'
  }

  result += `: ${typeAnnotation};`

  return comments + result
}

/**
 * Process interface declaration to DTS format
 */
export function processInterfaceDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // The extractor already produces properly formatted interface declarations
  // We just need to ensure proper export and declare keywords
  let text = decl.text

  // If the extractor's text already starts with proper keywords, use it
  if (text.startsWith('export declare interface') || text.startsWith('declare interface')) {
    return comments + text
  }

  // Otherwise build from components
  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare interface '

  // Add interface name
  result += decl.name

  // Add generics if present (no space before)
  if (decl.generics) {
    result += decl.generics
  }

  // Add extends clause if present
  if (decl.extends) {
    result += ` extends ${decl.extends}`
  }

  // Find the body using balanced brace matching to handle nested braces in generics
  const bodyStart = findInterfaceBodyStart(decl.text)
  if (bodyStart !== -1) {
    result += ` ${decl.text.slice(bodyStart)}`
  }
  else {
    result += ' {}'
  }

  return comments + result
}

/**
 * Process type alias declaration to DTS format
 */
export function processTypeDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // For type exports like export type { Foo }
  if (decl.text.includes('{') && decl.text.includes('}') && decl.text.includes('from')) {
    return comments + decl.text
  }

  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Only add declare for non-exported type aliases
  if (!decl.isExported && !decl.text.includes(' from ')) {
    result += 'declare '
  }

  // Extract the type definition from the original text
  // Remove leading/trailing whitespace and comments
  const typeMatch = decl.text.match(/type\s[^=]+=\s*([\s\S]+)/)
  if (typeMatch) {
    const typeDef = typeMatch[0].replace(/;?\s*$/, '')
    result += typeDef
  }
  else {
    // Fallback to simple format
    result += `type ${decl.name}`
    if (decl.generics) {
      result += decl.generics // No space before generics
    }
    result += ' = any'
  }

  return comments + result
}

/**
 * Process class declaration to DTS format
 */
export function processClassDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // The extractor already provides the correct DTS signature, just return it
  return comments + decl.text
}

/**
 * Process enum declaration to DTS format
 */
export function processEnumDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Add const if needed
  if (decl.modifiers?.includes('const')) {
    result += 'const '
  }

  // Add enum keyword
  result += 'enum '

  // Add enum name
  result += decl.name

  // Extract the body from the original text
  const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
  if (bodyMatch) {
    result += ` ${bodyMatch[0]}`
  }
  else {
    result += ' {}'
  }

  return comments + result
}

/**
 * Process import statement
 */
export function processImportDeclaration(decl: Declaration): string {
  // Import statements remain the same in .d.ts files
  // Just ensure they end with semicolon
  let result = decl.text.trim()

  // Remove any existing semicolon to avoid doubles
  result = result.replace(/;+$/, '')

  // Add single semicolon
  result += ';'

  return result
}

/**
 * Process export statement
 */
export function processExportDeclaration(decl: Declaration): string {
  // Type re-exports and other export statements should be returned as-is
  return decl.text.trim()
}

/**
 * Process module/namespace declaration to DTS format
 */
export function processModuleDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // Check if this is a global augmentation (declare global { ... })
  // The extractor already formats this correctly, so just use the text
  if (decl.text.startsWith('declare global')) {
    return comments + decl.text
  }

  // Check if this is an ambient module (quoted name)
  const isAmbientModule = decl.source || (decl.name.startsWith('"') || decl.name.startsWith('\'') || decl.name.startsWith('`'))

  if (isAmbientModule) {
    // This is a module declaration like: declare module 'module-name'
    let result = 'declare module '

    // Add module name
    result += decl.name

    // Extract the body from the original text
    const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
    if (bodyMatch) {
      result += ` ${bodyMatch[0]}`
    }
    else {
      result += ' {}'
    }

    return comments + result
  }

  // Regular namespace
  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare if not already present
  if (!decl.modifiers?.includes('declare')) {
    result += 'declare '
  }

  // Add namespace keyword
  result += 'namespace '

  // Add namespace name
  result += decl.name

  // Extract the body from the original text
  const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
  if (bodyMatch) {
    result += ` ${bodyMatch[0]}`
  }
  else {
    result += ' {}'
  }

  return comments + result
}

/**
 * Infer and narrow types from values in union context (for arrays)
 */
function inferNarrowTypeInUnion(value: any, isConst: boolean = false): string {
  if (!value || typeof value !== 'string')
    return 'unknown'

  const trimmed = value.trim()

  // String literals - always use literal type for simple string literals
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
    || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    // For simple string literals without expressions, always return the literal
    if (!trimmed.includes('${')) {
      return trimmed
    }
    // Template literals with expressions only get literal type if const
    if (isConst) {
      return trimmed
    }
    return 'string'
  }

  // Number literals
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    if (isConst) {
      return trimmed
    }
    return 'number'
  }

  // Boolean literals
  if (trimmed === 'true' || trimmed === 'false') {
    if (isConst) {
      return trimmed
    }
    return 'boolean'
  }

  // Null and undefined
  if (trimmed === 'null')
    return 'null'
  if (trimmed === 'undefined')
    return 'undefined'

  // Array literals
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return inferArrayType(trimmed, isConst)
  }

  // Object literals
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return inferObjectType(trimmed, isConst)
  }

  // Function expressions - use union context
  if (trimmed.includes('=>') || trimmed.startsWith('function') || trimmed.startsWith('async')) {
    return inferFunctionType(trimmed, true)
  }

  // As const assertions
  if (trimmed.endsWith('as const')) {
    const withoutAsConst = trimmed.slice(0, -8).trim()
    // For arrays with 'as const', create readonly tuple
    if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
      const content = withoutAsConst.slice(1, -1).trim()
      if (!content)
        return 'readonly []'
      const elements = parseArrayElements(content)
      const elementTypes = elements.map(el => inferNarrowType(el.trim(), true))
      return `readonly [${elementTypes.join(', ')}]`
    }
    return inferNarrowTypeInUnion(withoutAsConst, true)
  }

  // Template literal expressions
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return inferTemplateLiteralType(trimmed, isConst)
  }

  // New expressions
  if (trimmed.startsWith('new ')) {
    return inferNewExpressionType(trimmed)
  }

  // Promise expressions
  if (trimmed.startsWith('Promise.')) {
    return inferPromiseType(trimmed)
  }

  // Await expressions
  if (trimmed.startsWith('await ')) {
    return 'unknown' // Would need async context analysis
  }

  // BigInt literals
  if (/^\d+n$/.test(trimmed)) {
    if (isConst) {
      return trimmed
    }
    return 'bigint'
  }

  // Symbol
  if (trimmed.startsWith('Symbol(') || trimmed === 'Symbol.for') {
    return 'symbol'
  }

  // Other expressions (method calls, property access, etc.)
  return 'unknown'
}

/**
 * Infer and narrow types from values
 */
export function inferNarrowType(value: any, isConst: boolean = false): string {
  if (!value || typeof value !== 'string')
    return 'unknown'

  const trimmed = value.trim()

  // BigInt expressions (check early)
  if (trimmed.startsWith('BigInt(')) {
    return 'bigint'
  }

  // Symbol.for expressions (check early)
  if (trimmed.startsWith('Symbol.for(')) {
    return 'symbol'
  }

  // Tagged template literals (check early)
  if (trimmed.includes('.raw`') || trimmed.includes('String.raw`')) {
    return 'string'
  }

  // String literals - always use literal type for simple string literals
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
    || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    // For simple string literals without expressions, always return the literal
    if (!trimmed.includes('${')) {
      return trimmed
    }
    // Template literals with expressions only get literal type if const
    if (isConst) {
      return trimmed
    }
    return 'string'
  }

  // Number literals - ALWAYS use literal types for const declarations
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed // Always return literal number
  }

  // Boolean literals - ALWAYS use literal types for const declarations
  if (trimmed === 'true' || trimmed === 'false') {
    return trimmed // Always return literal boolean
  }

  // Null and undefined
  if (trimmed === 'null')
    return 'null'
  if (trimmed === 'undefined')
    return 'undefined'

  // Array literals
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return inferArrayType(trimmed, isConst)
  }

  // Object literals
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return inferObjectType(trimmed, isConst)
  }

  // Function expressions
  if (trimmed.includes('=>') || trimmed.startsWith('function') || trimmed.startsWith('async')) {
    return inferFunctionType(trimmed, false)
  }

  // As const assertions
  if (trimmed.endsWith('as const')) {
    const withoutAsConst = trimmed.slice(0, -8).trim()
    // For arrays with 'as const', create readonly tuple
    if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
      const content = withoutAsConst.slice(1, -1).trim()
      if (!content)
        return 'readonly []'
      const elements = parseArrayElements(content)
      const elementTypes = elements.map(el => inferNarrowType(el.trim(), true))
      return `readonly [${elementTypes.join(', ')}]`
    }
    return inferNarrowType(withoutAsConst, true)
  }

  // Template literal expressions
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return inferTemplateLiteralType(trimmed, isConst)
  }

  // New expressions
  if (trimmed.startsWith('new ')) {
    return inferNewExpressionType(trimmed)
  }

  // Promise expressions
  if (trimmed.startsWith('Promise.')) {
    return inferPromiseType(trimmed)
  }

  // Await expressions
  if (trimmed.startsWith('await ')) {
    return 'unknown' // Would need async context analysis
  }

  // BigInt literals
  if (/^\d+n$/.test(trimmed)) {
    if (isConst) {
      return trimmed
    }
    return 'bigint'
  }

  // Symbol
  if (trimmed.startsWith('Symbol(') || trimmed === 'Symbol.for') {
    return 'symbol'
  }

  // Other expressions (method calls, property access, etc.)
  return 'unknown'
}

/**
 * Infer type from template literal
 */
function inferTemplateLiteralType(value: string, isConst: boolean): string {
  // Handle tagged template literals like String.raw`...`
  if (value.includes('.raw`') || value.includes('String.raw`')) {
    return 'string'
  }

  if (!isConst)
    return 'string'

  // Simple template literal without expressions
  if (!value.includes('${')) {
    return value
  }

  // Complex template literal - would need more sophisticated parsing
  return 'string'
}

/**
 * Extract type from 'satisfies' operator
 * e.g., "{ port: 3000 } satisfies { port: number }" returns "{ port: number }"
 */
function extractSatisfiesType(value: string): string | null {
  const satisfiesIndex = value.lastIndexOf(' satisfies ')
  if (satisfiesIndex === -1) {
    return null
  }

  // Extract everything after 'satisfies '
  let typeStr = value.slice(satisfiesIndex + 11).trim()

  // Remove trailing semicolon if present
  if (typeStr.endsWith(';')) {
    typeStr = typeStr.slice(0, -1).trim()
  }

  return typeStr || null
}

/**
 * Infer type from new expression
 */
function inferNewExpressionType(value: string): string {
  const match = value.match(/^new\s+([A-Z][a-zA-Z0-9]*)/)
  if (match) {
    const className = match[1]
    // Common built-in types
    switch (className) {
      case 'Date': return 'Date'
      case 'Map': return 'Map<any, any>'
      case 'Set': return 'Set<any>'
      case 'WeakMap': return 'WeakMap<any, any>'
      case 'WeakSet': return 'WeakSet<any>'
      case 'RegExp': return 'RegExp'
      case 'Error': return 'Error'
      case 'Array': return 'any[]'
      case 'Object': return 'object'
      case 'Function': return 'Function'
      case 'Promise': return 'Promise<any>'
      default: return className
    }
  }
  return 'unknown'
}

/**
 * Infer type from Promise expression
 */
function inferPromiseType(value: string): string {
  if (value.startsWith('Promise.resolve(')) {
    // Try to extract the argument type
    const match = value.match(/Promise\.resolve\(([^)]+)\)/)
    if (match) {
      const arg = match[1].trim()
      const argType = inferNarrowType(arg, false)
      return `Promise<${argType}>`
    }
    return 'Promise<unknown>'
  }
  if (value.startsWith('Promise.reject(')) {
    return 'Promise<never>'
  }
  if (value.startsWith('Promise.all(')) {
    // Try to extract array argument types
    const match = value.match(/Promise\.all\(\[([^\]]+)\]\)/)
    if (match) {
      const arrayContent = match[1].trim()
      const elements = parseArrayElements(arrayContent)
      const elementTypes = elements.map((el) => {
        const trimmed = el.trim()
        if (trimmed.startsWith('Promise.resolve(')) {
          const promiseType = inferPromiseType(trimmed)
          // Extract the inner type from Promise<T>
          const innerMatch = promiseType.match(/Promise<(.+)>/)
          return innerMatch ? innerMatch[1] : 'unknown'
        }
        return inferNarrowType(trimmed, false)
      })
      return `Promise<[${elementTypes.join(', ')}]>`
    }
    return 'Promise<unknown[]>'
  }
  return 'Promise<unknown>'
}

/**
 * Infer array type from array literal
 */
function inferArrayType(value: string, isConst: boolean): string {
  // Remove brackets and parse elements
  const content = value.slice(1, -1).trim()

  if (!content)
    return 'Array<never>'

  // Simple parsing - this would need to be more sophisticated for complex cases
  const elements = parseArrayElements(content)

  // Check if any element has 'as const' - if so, this should be a readonly tuple
  const hasAsConst = elements.some(el => el.trim().endsWith('as const'))

  if (hasAsConst) {
    // Create readonly tuple with union types for each element
    const elementTypes = elements.map((el) => {
      const trimmedEl = el.trim()
      if (trimmedEl.endsWith('as const')) {
        const withoutAsConst = trimmedEl.slice(0, -8).trim()
        // For arrays with 'as const', create readonly tuple
        if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
          const innerContent = withoutAsConst.slice(1, -1).trim()
          const innerElements = parseArrayElements(innerContent)
          const innerTypes = innerElements.map(innerEl => inferNarrowType(innerEl.trim(), true))
          return `readonly [${innerTypes.join(', ')}]`
        }
        return inferNarrowType(withoutAsConst, true)
      }
      if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
        return inferArrayType(trimmedEl, true)
      }
      return inferNarrowType(trimmedEl, true)
    })
    return `readonly [\n    ${elementTypes.join(' |\n    ')}\n  ]`
  }

  // Regular array processing
  const elementTypes = elements.map((el) => {
    const trimmedEl = el.trim()
    // Check if element is an array itself
    if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
      return inferArrayType(trimmedEl, isConst)
    }
    return inferNarrowTypeInUnion(trimmedEl, isConst)
  })

  // For const arrays, ALWAYS create readonly tuples for better type safety
  if (isConst) {
    return `readonly [${elementTypes.join(', ')}]`
  }

  // For simple arrays with all same literal types, also create tuples
  const uniqueTypes = [...new Set(elementTypes)]
  const allLiterals = elementTypes.every(type =>
    /^-?\d+(\.\d+)?$/.test(type) // numbers
    || type === 'true' || type === 'false' // booleans
    || (type.startsWith('"') && type.endsWith('"')) // strings
    || (type.startsWith('\'') && type.endsWith('\'')),
  )

  if (allLiterals && elementTypes.length <= 10) {
    // Create tuple for small arrays with literal types
    return `readonly [${elementTypes.join(', ')}]`
  }

  if (uniqueTypes.length === 1) {
    return `Array<${uniqueTypes[0]}>`
  }

  return `Array<${uniqueTypes.join(' | ')}>`
}

/**
 * Parse array elements handling nested structures
 */
function parseArrayElements(content: string): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      if (char === '[' || char === '{' || char === '(')
        depth++
      if (char === ']' || char === '}' || char === ')')
        depth--

      if (char === ',' && depth === 0) {
        elements.push(current.trim())
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    elements.push(current.trim())
  }

  return elements
}

/**
 * Infer object type from object literal
 */
function inferObjectType(value: string, isConst: boolean): string {
  // Remove braces
  const content = value.slice(1, -1).trim()

  if (!content)
    return '{}'

  // Parse object properties
  const properties = parseObjectProperties(content)
  const propTypes: string[] = []

  for (const [key, val] of properties) {
    let valueType = inferNarrowType(val, isConst)

    // Handle method signatures - clean up async and parameter defaults
    if (valueType.includes('=>') || valueType.includes('function') || valueType.includes('async')) {
      valueType = cleanMethodSignature(valueType)
    }

    propTypes.push(`${key}: ${valueType}`)
  }

  return `{\n  ${propTypes.join(';\n  ')}\n}`
}

/**
 * Clean method signatures for declaration files
 */
function cleanMethodSignature(signature: string): string {
  // Remove async modifier from method signatures (including in object methods)
  let cleaned = signature.replace(/^async\s+/, '').replace(/\basync\s+/g, '')

  // Remove parameter default values (e.g., currency = 'USD' becomes currency?)
  cleaned = cleaned.replace(/(\w+)\s*=[^,)]+/g, (match, paramName) => {
    return `${paramName}?`
  })

  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return cleaned
}

/**
 * Clean parameter defaults from function parameters
 */
function cleanParameterDefaults(params: string): string {
  // Remove parameter default values and make them optional
  return params.replace(/(\w+)\s*=[^,)]+/g, (match, paramName) => {
    return `${paramName}?`
  })
}

/**
 * Parse object properties
 */
function parseObjectProperties(content: string): Array<[string, string]> {
  const properties: Array<[string, string]> = []
  let current = ''
  let currentKey = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let inKey = true
  let inComment = false
  let commentDepth = 0

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''
    const nextChar = i < content.length - 1 ? content[i + 1] : ''

    // Track JSDoc/block comments to avoid parsing colons inside them
    if (!inString && !inComment && char === '/' && nextChar === '*') {
      // Enter block/JSDoc comment, preserve opening delimiter
      inComment = true
      commentDepth = 1
      current += '/*'
      i++ // Skip '*'
      continue
    }
    else if (inComment && char === '*' && nextChar === '/') {
      // Closing a block/JSDoc comment, preserve closing delimiter
      commentDepth--
      current += '*/'
      i++ // Skip '/'
      if (commentDepth === 0) {
        inComment = false
      }
      continue
    }
    else if (inComment && char === '/' && nextChar === '*') {
      // Nested comment start, preserve and increase depth
      commentDepth++
      current += '/*'
      i++
      continue
    }

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
      current += char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
      current += char
    }
    else if (!inString && !inComment) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
        current += char
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
        current += char
      }
      else if (char === ':' && depth === 0 && inKey) {
        currentKey = current.trim()
        current = ''
        inKey = false
      }
      else if (char === '(' && depth === 0 && inKey) {
        // This might be a method definition like: methodName(params) or async methodName<T>(params)
        currentKey = current.trim()
        // Remove 'async' from the key if present
        if (currentKey.startsWith('async ')) {
          currentKey = currentKey.slice(6).trim()
        }
        current = char // Start with the opening parenthesis
        inKey = false
        depth = 1 // We're now inside the method definition
      }
      else if (char === ',' && depth === 0) {
        if (currentKey && current.trim()) {
          // Clean method signatures before storing
          let value = current.trim()

          // Check if this is a method definition (starts with parentheses)
          if (value.startsWith('(')) {
            // This is a method definition like: (params): ReturnType { ... }
            value = convertMethodToFunctionType(currentKey, value)
          }
          else if (value.includes('=>') || value.includes('function') || value.includes('async')) {
            value = cleanMethodSignature(value)
          }

          properties.push([currentKey, value])
        }
        current = ''
        currentKey = ''
        inKey = true
      }
      else {
        current += char
      }
    }
    else {
      // Preserve all characters while inside comments
      current += char
    }
  }

  // Don't forget the last property
  if (currentKey && current.trim()) {
    let value = current.trim()

    // Check if this is a method definition (starts with parentheses)
    if (value.startsWith('(')) {
      // This is a method definition like: (params): ReturnType { ... }
      value = convertMethodToFunctionType(currentKey, value)
    }
    else if (value.includes('=>') || value.includes('function') || value.includes('async')) {
      value = cleanMethodSignature(value)
    }

    properties.push([currentKey, value])
  }

  return properties
}

/**
 * Convert method definition to function type signature
 */
function convertMethodToFunctionType(methodName: string, methodDef: string): string {
  // Remove async modifier if present
  let cleaned = methodDef.replace(/^async\s+/, '')

  // Extract generics, parameters, and return type
  const genericMatch = cleaned.match(/^<([^>]+)>/)
  const generics = genericMatch ? genericMatch[0] : ''
  if (generics) {
    cleaned = cleaned.slice(generics.length).trim()
  }

  // Find parameter list
  const paramStart = cleaned.indexOf('(')
  const paramEnd = findMatchingBracket(cleaned, paramStart, '(', ')')

  if (paramStart === -1 || paramEnd === -1) {
    return '() => unknown'
  }

  const params = cleaned.slice(paramStart, paramEnd + 1)
  let returnType = 'unknown'

  // Check for explicit return type annotation
  const afterParams = cleaned.slice(paramEnd + 1).trim()
  if (afterParams.startsWith(':')) {
    const returnTypeMatch = afterParams.match(/^:\s*([^{]+)/)
    if (returnTypeMatch) {
      returnType = returnTypeMatch[1].trim()
    }
  }

  // Clean parameter defaults
  const cleanedParams = cleanParameterDefaults(params)

  return `${generics}${cleanedParams} => ${returnType}`
}

/**
 * Find matching bracket for nested structures
 */
function findMatchingBracket(str: string, start: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = start; i < str.length; i++) {
    if (str[i] === openChar) {
      depth++
    }
    else if (str[i] === closeChar) {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Find the main arrow (=>) in a function, ignoring nested arrows in parameter types
 */
function findMainArrowIndex(str: string): number {
  let parenDepth = 0
  let bracketDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < str.length - 1; i++) {
    const char = str[i]
    const nextChar = str[i + 1]
    const prevChar = i > 0 ? str[i - 1] : ''

    // Handle string literals
    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      // Track nesting depth - only parentheses and square brackets
      // Don't track < > as they can be comparison operators or part of generics
      if (char === '(') {
        parenDepth++
      }
      else if (char === ')') {
        parenDepth--
      }
      else if (char === '[') {
        bracketDepth++
      }
      else if (char === ']') {
        bracketDepth--
      }

      // Look for arrow at depth 0 (not nested inside parentheses or brackets)
      if (char === '=' && nextChar === '>' && parenDepth === 0 && bracketDepth === 0) {
        return i
      }
    }
  }

  return -1
}

/**
 * Infer function type from function expression
 */
function inferFunctionType(value: string, inUnion: boolean = false): string {
  const trimmed = value.trim()

  // Handle very complex function types early (but not function expressions)
  // Only simplify if it's truly complex AND looks like a problematic signature
  if (trimmed.length > 200 && (trimmed.match(/=>/g) || []).length > 2 && (trimmed.match(/</g) || []).length > 5 && !trimmed.startsWith('function')) {
    // For extremely complex types, use a simple signature
    const funcType = '(...args: any[]) => any'
    return inUnion ? `(${funcType})` : funcType
  }

  // Handle async arrow functions
  if (trimmed.startsWith('async ') && trimmed.includes('=>')) {
    const asyncRemoved = trimmed.slice(5).trim() // Remove 'async '
    const arrowIndex = asyncRemoved.indexOf('=>')
    let params = asyncRemoved.substring(0, arrowIndex).trim()
    const body = asyncRemoved.substring(arrowIndex + 2).trim()

    // Clean up params - remove default values
    params = cleanParameterDefaults(params)

    // Clean up params
    if (params === '()' || params === '') {
      params = '()'
    }
    else if (!params.startsWith('(')) {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to infer return type from body
    let returnType = 'unknown'
    if (body.startsWith('{')) {
      // Block body - can't easily infer return type
      returnType = 'unknown'
    }
    else {
      // Expression body - try to infer
      returnType = inferNarrowType(body, false)
    }

    const funcType = `${params} => Promise<${returnType}>`
    return inUnion ? `(${funcType})` : funcType
  }

  // Regular arrow functions
  if (trimmed.includes('=>')) {
    // Handle generics at the beginning
    let generics = ''
    let remaining = trimmed

    // Check for generics at the start
    if (trimmed.startsWith('<')) {
      const genericEnd = findMatchingBracket(trimmed, 0, '<', '>')
      if (genericEnd !== -1) {
        generics = trimmed.substring(0, genericEnd + 1)
        remaining = trimmed.substring(genericEnd + 1).trim()
      }
    }

    // Find the main arrow (not nested ones inside parameter types)
    const arrowIndex = findMainArrowIndex(remaining)
    if (arrowIndex === -1) {
      // Fallback if no arrow found
      const funcType = '() => unknown'
      return inUnion ? `(${funcType})` : funcType
    }

    let params = remaining.substring(0, arrowIndex).trim()
    const body = remaining.substring(arrowIndex + 2).trim()

    // Handle explicit return type annotations in parameters
    // Look for pattern like (param: Type): ReturnType
    let explicitReturnType = ''
    const returnTypeMatch = params.match(/\):\s*([^=]+)$/)
    if (returnTypeMatch) {
      explicitReturnType = returnTypeMatch[1].trim()
      params = `${params.substring(0, params.lastIndexOf('):'))})`
    }

    // Clean up params - remove default values
    params = cleanParameterDefaults(params)

    // Clean up params
    if (params === '()' || params === '') {
      params = '()'
    }
    else if (!params.startsWith('(')) {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to infer return type from body
    let returnType = 'unknown'
    if (explicitReturnType) {
      // Use explicit return type annotation
      returnType = explicitReturnType
    }
    else if (body.startsWith('{')) {
      // Block body - can't easily infer return type
      returnType = 'unknown'
    }
    else if (body.includes('=>')) {
      // This is a higher-order function returning another function
      // For complex nested functions, try to extract just the outer function signature
      const outerFuncMatch = body.match(/^\s*\(([^)]*)\)\s*=>/)
      if (outerFuncMatch) {
        const outerParams = outerFuncMatch[1].trim()
        // For functions like pipe that transform T => T, infer the return type from generics
        if (generics.includes('T') && outerParams.includes('T')) {
          returnType = `(${outerParams}) => T`
        }
        else {
          returnType = `(${outerParams}) => any`
        }
      }
      else {
        // Fallback for complex cases
        returnType = 'any'
      }
    }
    else {
      // Expression body - try to infer, but be conservative in union contexts
      if (inUnion) {
        returnType = 'unknown'
      }
      else {
        returnType = inferNarrowType(body, false)
      }
    }

    const funcType = `${generics}${params} => ${returnType}`
    return inUnion ? `(${funcType})` : funcType
  }

  // Function expressions
  if (trimmed.startsWith('function')) {
    // Handle generics in function expressions like function* <T>(items: T[])
    let generics = ''
    // const remaining = trimmed

    // Look for generics after function keyword
    const genericMatch = trimmed.match(/function\s*(?:\*\s*)?(<[^>]+>)/)
    if (genericMatch) {
      generics = genericMatch[1]
    }

    // Try to extract function signature
    const funcMatch = trimmed.match(/function\s*(\*?)\s*(?:<[^>]+>\s*)?([^(]*)\(([^)]*)\)/)
    if (funcMatch) {
      const isGenerator = !!funcMatch[1]
      // const name = funcMatch[2].trim()
      const params = funcMatch[3].trim()

      let paramTypes = '(...args: any[])'
      if (params) {
        // Try to parse parameters
        paramTypes = `(${params})`
      }
      else {
        paramTypes = '()'
      }

      if (isGenerator) {
        // Try to extract return type from the function signature
        const returnTypeMatch = trimmed.match(/:\s*Generator<([^>]+)>/)
        if (returnTypeMatch) {
          const generatorTypes = returnTypeMatch[1]
          return inUnion ? `(${generics}${paramTypes} => Generator<${generatorTypes}>)` : `${generics}${paramTypes} => Generator<${generatorTypes}>`
        }
        return inUnion ? `(${generics}${paramTypes} => Generator<any, any, any>)` : `${generics}${paramTypes} => Generator<any, any, any>`
      }

      return inUnion ? `(${generics}${paramTypes} => unknown)` : `${generics}${paramTypes} => unknown`
    }

    const funcType = '(...args: any[]) => unknown'
    return inUnion ? `(${funcType})` : funcType
  }

  // Higher-order functions (functions that return functions)
  if (trimmed.includes('=>') && trimmed.includes('(') && trimmed.includes(')')) {
    // For very complex function types, fall back to a simpler signature
    if (trimmed.length > 100 || (trimmed.match(/=>/g) || []).length > 2) {
      // Extract just the basic signature pattern
      const genericMatch = trimmed.match(/^<[^>]+>/)
      const generics = genericMatch ? genericMatch[0] : ''

      // Look for parameter pattern
      const paramMatch = trimmed.match(/\([^)]*\)/)
      const params = paramMatch ? paramMatch[0] : '(...args: any[])'

      const funcType = `${generics}${params} => any`
      return inUnion ? `(${funcType})` : funcType
    }

    // This might be a higher-order function, try to preserve the structure
    return inUnion ? `(${trimmed})` : trimmed
  }

  const funcType = '() => unknown'
  return inUnion ? `(${funcType})` : funcType
}
