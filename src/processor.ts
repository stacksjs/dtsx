import type { Declaration, ProcessingContext } from './types'

/**
 * Extract all imported items from an import statement
 */
function extractAllImportedItems(importText: string): string[] {
  const items: string[] = []

  // Handle mixed imports: import defaultName, { a, b } from 'module'
  const mixedMatch = importText.match(/import\s+([^{,\s]+),\s*\{?\s*([^}]+)\s*\}?\s+from/)
  if (mixedMatch) {
    // Add default import
    items.push(mixedMatch[1].trim())
    // Add named imports
    const namedItems = mixedMatch[2].split(',').map(item => item.replace(/^type\s+/, '').trim())
    items.push(...namedItems)
    return items
  }

  // Handle named imports: import { a, b } from 'module'
  const namedMatch = importText.match(/import\s+(?:type\s+)?\{?\s*([^}]+)\s*\}?\s+from/)
  if (namedMatch) {
    const namedItems = namedMatch[1].split(',').map(item => item.replace(/^type\s+/, '').trim())
    items.push(...namedItems)
    return items
  }

  // Handle default imports: import defaultName from 'module'
  const defaultMatch = importText.match(/import\s+(?:type\s+)?([^{,\s]+)\s+from/)
  if (defaultMatch) {
    items.push(defaultMatch[1].trim())
    return items
  }

  return items
}

/**
 * Process declarations and convert them to narrow DTS format
 */
export function processDeclarations(
  declarations: Declaration[],
  context: ProcessingContext
): string {
  const output: string[] = []

  // Group declarations by type for better organization
  const imports = declarations.filter(d => d.kind === 'import')
  const functions = declarations.filter(d => d.kind === 'function')
  const variables = declarations.filter(d => d.kind === 'variable')
  const interfaces = declarations.filter(d => d.kind === 'interface')
  const types = declarations.filter(d => d.kind === 'type')
  const classes = declarations.filter(d => d.kind === 'class')
  const enums = declarations.filter(d => d.kind === 'enum')
  const modules = declarations.filter(d => d.kind === 'module')
  const exports = declarations.filter(d => d.kind === 'export')

  // Parse all exports to understand what's being exported
  const exportedItems = new Set<string>()
  const exportStatements: string[] = []
  const defaultExport: string[] = []

  for (const decl of exports) {
    if (decl.text.startsWith('export default')) {
      const statement = decl.text.endsWith(';') ? decl.text : decl.text + ';'
      defaultExport.push(statement)
    } else {
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

  // Filter imports to only include those that are used in exports or declarations
  const usedImports = new Set<string>()
  const usedImportItems = new Set<string>()

  // Check which imports are needed based on exported functions and types
  for (const func of functions) {
    if (func.isExported) {
      // Check the entire function signature for imported types
      const funcDeclaration = func.text
      for (const imp of imports) {
        // Handle all import patterns: named, default, and mixed
        const allImportedItems = extractAllImportedItems(imp.text)
        for (const item of allImportedItems) {
          // Use word boundary regex to match exact identifiers, not substrings
          const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
          if (regex.test(funcDeclaration)) {
            usedImportItems.add(item)
          }
        }
      }
    }
  }

    // Check which imports are needed for exported variables
  for (const variable of variables) {
    if (variable.isExported) {
      for (const imp of imports) {
        // Handle mixed imports like: import { collect, type Collection } from 'module'
        const importText = imp.text
        const typeMatches = importText.match(/type\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)
        const valueMatches = importText.match(/import\s+\{([^}]+)\}/)

                // Check type imports
        if (typeMatches) {
          for (const typeMatch of typeMatches) {
            const typeName = typeMatch.replace('type ', '').trim()
            const regex = new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            if (regex.test(variable.text)) {
              usedImportItems.add(typeName)
            }
          }
        }

        // Check value imports
        if (valueMatches) {
          const imports = valueMatches[1].split(',').map(item =>
            item.replace(/type\s+/, '').trim()
          )
          for (const importName of imports) {
            const regex = new RegExp(`\\b${importName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            if (regex.test(variable.text)) {
              usedImportItems.add(importName)
            }
          }
        }
      }
    }
  }

  // Check which imports are needed for interfaces and types (including non-exported ones that are referenced by exported items)
  for (const iface of interfaces) {
    // Include interface if it's exported OR if it's referenced by exported functions
    const isReferencedByExports = functions.some(func =>
      func.isExported && func.text.includes(iface.name)
    )

    if (iface.isExported || isReferencedByExports) {
      for (const imp of imports) {
        const allImportedItems = extractAllImportedItems(imp.text)
        for (const item of allImportedItems) {
          const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
          if (regex.test(iface.text)) {
            usedImportItems.add(item)
          }
        }
      }
    }
  }

  for (const type of types) {
    if (type.isExported) {
      for (const imp of imports) {
        const allImportedItems = extractAllImportedItems(imp.text)
        for (const item of allImportedItems) {
          const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
          if (regex.test(type.text)) {
            usedImportItems.add(item)
          }
        }
      }
    }
  }

  // Check which imports are needed for re-exports
  for (const item of exportedItems) {
    for (const imp of imports) {
      const allImportedItems = extractAllImportedItems(imp.text)
      for (const importedItem of allImportedItems) {
        if (item === importedItem) {
          usedImportItems.add(importedItem)
        }
      }
    }
  }

  // Also check for value imports that are re-exported
  for (const exp of exports) {
    for (const imp of imports) {
      const allImportedItems = extractAllImportedItems(imp.text)
      for (const importedItem of allImportedItems) {
        // Use word boundary regex to match exact identifiers in export statements
        const regex = new RegExp(`\\b${importedItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        if (regex.test(exp.text)) {
          usedImportItems.add(importedItem)
        }
      }
    }
  }

      // Create filtered imports based on actually used items
  const processedImports: string[] = []
  for (const imp of imports) {
    // Handle different import patterns - check mixed imports first
    const mixedImportMatch = imp.text.match(/import\s+([^{,\s]+),\s*\{?\s*([^}]+)\s*\}?\s+from\s+['"]([^'"]+)['"]/)
    const namedImportMatch = imp.text.match(/import\s+(?:type\s+)?\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/)
    const defaultImportMatch = imp.text.match(/import\s+(?:type\s+)?([^{,\s]+)\s+from\s+['"]([^'"]+)['"]/)

    if (mixedImportMatch) {
      // Mixed import: import defaultName, { a, b } from 'module'
      const defaultName = mixedImportMatch[1].trim()
      const namedItems = mixedImportMatch[2].split(',').map(item => item.trim())
      const source = mixedImportMatch[3]

      const usedDefault = usedImportItems.has(defaultName)
      const usedNamed = namedItems.filter(item => {
        const cleanItem = item.replace(/^type\s+/, '').trim()
        return usedImportItems.has(cleanItem)
      })

      if (usedDefault || usedNamed.length > 0) {
        const isOriginalTypeOnly = imp.text.includes('import type')

        let importStatement = 'import '
        if (isOriginalTypeOnly) {
          importStatement += 'type '
        }

        const parts = []
        if (usedDefault) parts.push(defaultName)
        if (usedNamed.length > 0) parts.push(`{ ${usedNamed.join(', ')} }`)

        importStatement += `${parts.join(', ')} from '${source}';`

        processedImports.push(importStatement)
      }
    } else if (namedImportMatch && !defaultImportMatch) {
      // Named imports only: import { a, b } from 'module'
      const importedItems = namedImportMatch[1].split(',').map(item => item.trim())
      const usedItems = importedItems.filter(item => {
        const cleanItem = item.replace(/^type\s+/, '').trim()
        return usedImportItems.has(cleanItem)
      })

      if (usedItems.length > 0) {
        const source = namedImportMatch[2]
        const isOriginalTypeOnly = imp.text.includes('import type')

        let importStatement = 'import '
        if (isOriginalTypeOnly) {
          importStatement += 'type '
        }
        importStatement += `{ ${usedItems.join(', ')} } from '${source}';`

        processedImports.push(importStatement)
      }
    } else if (defaultImportMatch && !namedImportMatch) {
      // Default import only: import defaultName from 'module'
      const defaultName = defaultImportMatch[1].trim()
      const source = defaultImportMatch[2]

      if (usedImportItems.has(defaultName)) {
        const isOriginalTypeOnly = imp.text.includes('import type')

        let importStatement = 'import '
        if (isOriginalTypeOnly) {
          importStatement += 'type '
        }
        importStatement += `${defaultName} from '${source}';`

        processedImports.push(importStatement)
      }
    }
  }

  // Sort imports: type imports from 'bun' first, then others alphabetically
  processedImports.sort((a, b) => {
    const aFromBun = a.includes("from 'bun'")
    const bFromBun = b.includes("from 'bun'")

    if (aFromBun && !bFromBun) return -1
    if (!aFromBun && bFromBun) return 1

    return a.localeCompare(b)
  })

  output.push(...processedImports)

  // Always add blank line after imports if there are any imports
  if (processedImports.length > 0) output.push('')

  // Process type exports first
  const typeExports = exportStatements.filter(exp => exp.includes('export type'))
  output.push(...typeExports)

  // Process other declarations (functions, interfaces, etc.)
  const otherDecls = [...functions, ...variables, ...interfaces, ...types, ...classes, ...enums, ...modules]

  for (const decl of otherDecls) {
    let processed = ''
    switch (decl.kind) {
      case 'function':
        processed = processFunctionDeclaration(decl)
        break
      case 'variable':
        processed = processVariableDeclaration(decl)
        break
      case 'interface':
        processed = processInterfaceDeclaration(decl)
        break
      case 'type':
        processed = processTypeDeclaration(decl)
        break
      case 'class':
        processed = processClassDeclaration(decl)
        break
      case 'enum':
        processed = processEnumDeclaration(decl)
        break
      case 'module':
        processed = processModuleDeclaration(decl)
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

  return output.filter(line => line !== '').join('\n')
}

/**
 * Process function declaration to DTS format
 */
export function processFunctionDeclaration(decl: Declaration): string {
  // The extractor already provides the correct DTS signature, just return it
  return decl.text
}

/**
 * Process variable declaration to DTS format
 */
export function processVariableDeclaration(decl: Declaration): string {
  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Add variable kind (const, let, var)
  const kind = decl.modifiers?.[0] || 'const'
  result += kind + ' '

  // Add variable name
  result += decl.name

  // Add type annotation
  let typeAnnotation = decl.typeAnnotation

  // If we have a value, check if it has 'as const' - if so, infer from value instead of type annotation
  if (decl.value && decl.value.includes('as const')) {
    typeAnnotation = inferNarrowType(decl.value, true)
  } else if (decl.value && kind === 'const') {
    // For const declarations, always try to infer a more specific type from the value
    const inferredType = inferNarrowType(decl.value, false)

    // Use the inferred type if it's more specific than a generic Record type
    if (!typeAnnotation ||
        typeAnnotation.startsWith('Record<') ||
        typeAnnotation === 'any' ||
        typeAnnotation === 'object') {
      typeAnnotation = inferredType
    }
  } else if (!typeAnnotation && decl.value) {
    // If no explicit type annotation, try to infer from value
    typeAnnotation = inferNarrowType(decl.value, kind === 'const')
  }

  // Default to any if we couldn't determine type
  if (!typeAnnotation) {
    typeAnnotation = 'any'
  }

  result += `: ${typeAnnotation};`

  return result
}

/**
 * Process interface declaration to DTS format
 */
export function processInterfaceDeclaration(decl: Declaration): string {
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
    result += ' extends ' + decl.extends
  }

  // Extract the body from the original text
  const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
  if (bodyMatch) {
    result += ' ' + bodyMatch[0]
  } else {
    result += ' {}'
  }

  return result
}

/**
 * Process type alias declaration to DTS format
 */
export function processTypeDeclaration(decl: Declaration): string {
  // For type exports like export type { Foo }
  if (decl.text.includes('{') && decl.text.includes('}') && decl.text.includes('from')) {
    return decl.text
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
  const typeMatch = decl.text.match(/type\s+[^=]+=\s*([\s\S]+)/)
  if (typeMatch) {
    const typeDef = typeMatch[0].replace(/;?\s*$/, '')
    result += typeDef
  } else {
    // Fallback to simple format
    result += 'type ' + decl.name
    if (decl.generics) {
      result += decl.generics  // No space before generics
    }
    result += ' = any'
  }

  return result
}

/**
 * Process class declaration to DTS format
 */
export function processClassDeclaration(decl: Declaration): string {
  // The extractor already provides the correct DTS signature, just return it
  return decl.text
}

/**
 * Process enum declaration to DTS format
 */
export function processEnumDeclaration(decl: Declaration): string {
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
    result += ' ' + bodyMatch[0]
  } else {
    result += ' {}'
  }

  return result
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
export function processModuleDeclaration(decl: Declaration): string {
  // Check if this is an ambient module (quoted name)
  const isAmbientModule = decl.source || (decl.name.startsWith('"') || decl.name.startsWith("'") || decl.name.startsWith('`'))

  if (isAmbientModule) {
    // This is a module declaration like: declare module 'module-name'
    let result = 'declare module '

    // Add module name
    result += decl.name

    // Extract the body from the original text
    const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
    if (bodyMatch) {
      result += ' ' + bodyMatch[0]
    } else {
      result += ' {}'
    }

    return result
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
    result += ' ' + bodyMatch[0]
  } else {
    result += ' {}'
  }

  return result
}

/**
 * Infer and narrow types from values in union context (for arrays)
 */
function inferNarrowTypeInUnion(value: any, isConst: boolean = false): string {
  if (!value || typeof value !== 'string') return 'unknown'

  const trimmed = value.trim()

  // String literals - always use literal type for simple string literals
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
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
  if (trimmed === 'null') return 'null'
  if (trimmed === 'undefined') return 'undefined'

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
      if (!content) return 'readonly []'
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
  if (!value || typeof value !== 'string') return 'unknown'

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
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
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
  if (trimmed === 'null') return 'null'
  if (trimmed === 'undefined') return 'undefined'

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
      if (!content) return 'readonly []'
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

  if (!isConst) return 'string'

  // Simple template literal without expressions
  if (!value.includes('${')) {
    return value
  }

  // Complex template literal - would need more sophisticated parsing
  return 'string'
}

/**
 * Infer type from new expression
 */
function inferNewExpressionType(value: string): string {
  const match = value.match(/^new\s+([A-Z][a-zA-Z0-9]*)/);
  if (match) {
    const className = match[1];
    // Common built-in types
    switch(className) {
      case 'Date': return 'Date';
      case 'Map': return 'Map<any, any>';
      case 'Set': return 'Set<any>';
      case 'WeakMap': return 'WeakMap<any, any>';
      case 'WeakSet': return 'WeakSet<any>';
      case 'RegExp': return 'RegExp';
      case 'Error': return 'Error';
      case 'Array': return 'any[]';
      case 'Object': return 'object';
      case 'Function': return 'Function';
      case 'Promise': return 'Promise<any>';
      default: return className;
    }
  }
  return 'unknown';
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
      const elementTypes = elements.map(el => {
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

  if (!content) return 'Array<never>'

  // Simple parsing - this would need to be more sophisticated for complex cases
  const elements = parseArrayElements(content)

  // Check if any element has 'as const' - if so, this should be a readonly tuple
  const hasAsConst = elements.some(el => el.trim().endsWith('as const'))

  if (hasAsConst) {
    // Create readonly tuple with union types for each element
    const elementTypes = elements.map(el => {
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
  const elementTypes = elements.map(el => {
    const trimmedEl = el.trim()
    // Check if element is an array itself
    if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
      return inferArrayType(trimmedEl, isConst)
    }
    return inferNarrowTypeInUnion(trimmedEl, isConst)
  })

  // For const arrays, create readonly tuples instead of union types
  if (isConst) {
    return `readonly [${elementTypes.join(', ')}]`
  }

  const uniqueTypes = [...new Set(elementTypes)]

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

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      if (char === '[' || char === '{' || char === '(') depth++
      if (char === ']' || char === '}' || char === ')') depth--

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

  if (!content) return '{}'

  // Parse object properties
  const properties = parseObjectProperties(content)
  const propTypes: string[] = []

  for (const [key, val] of properties) {
    const valueType = inferNarrowType(val, isConst)
    propTypes.push(`${key}: ${valueType}`)
  }

  return `{\n  ${propTypes.join(';\n  ')}\n}`
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

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true
      stringChar = char
      current += char
    } else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
      current += char
    } else if (!inString) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
        current += char
      } else if (char === '}' || char === ']' || char === ')') {
        depth--
        current += char
      } else if (char === ':' && depth === 0 && inKey) {
        currentKey = current.trim()
        current = ''
        inKey = false
      } else if (char === ',' && depth === 0) {
        if (currentKey && current.trim()) {
          properties.push([currentKey, current.trim()])
        }
        current = ''
        currentKey = ''
        inKey = true
      } else {
        current += char
      }
    } else {
      current += char
    }
  }

  // Don't forget the last property
  if (currentKey && current.trim()) {
    properties.push([currentKey, current.trim()])
  }

  return properties
}

/**
 * Find matching bracket for nested structures
 */
function findMatchingBracket(str: string, start: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = start; i < str.length; i++) {
    if (str[i] === openChar) {
      depth++
    } else if (str[i] === closeChar) {
      depth--
      if (depth === 0) {
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
  if ((trimmed.length > 100 || (trimmed.match(/=>/g) || []).length > 2) && !trimmed.startsWith('function')) {
    // Extract just the basic signature pattern
    const genericMatch = trimmed.match(/^<[^>]+>/)
    const generics = genericMatch ? genericMatch[0] : ''

    // Look for first parameter pattern - need to find the complete parameter list
    let paramStart = trimmed.indexOf('(')
    if (paramStart !== -1) {
      let paramEnd = findMatchingBracket(trimmed, paramStart, '(', ')')
      if (paramEnd !== -1) {
        const params = trimmed.substring(paramStart, paramEnd + 1)
        const funcType = `${generics}${params} => any`
        return inUnion ? `(${funcType})` : funcType
      }
    }

    // Fallback if parameter extraction fails
    const funcType = `${generics}(...args: any[]) => any`
    return inUnion ? `(${funcType})` : funcType
  }

  // Handle async arrow functions
  if (trimmed.startsWith('async ') && trimmed.includes('=>')) {
    const asyncRemoved = trimmed.slice(5).trim() // Remove 'async '
    const arrowIndex = asyncRemoved.indexOf('=>')
    let params = asyncRemoved.substring(0, arrowIndex).trim()
    let body = asyncRemoved.substring(arrowIndex + 2).trim()

    // Clean up params
    if (params === '()' || params === '') {
      params = '()'
    } else if (!params.startsWith('(')) {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to infer return type from body
    let returnType = 'unknown'
    if (body.startsWith('{')) {
      // Block body - can't easily infer return type
      returnType = 'unknown'
    } else {
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

    const arrowIndex = remaining.indexOf('=>')
    if (arrowIndex === -1) {
      // Fallback if no arrow found
      const funcType = '() => unknown'
      return inUnion ? `(${funcType})` : funcType
    }

    let params = remaining.substring(0, arrowIndex).trim()
    let body = remaining.substring(arrowIndex + 2).trim()

    // Handle explicit return type annotations in parameters
    // Look for pattern like (param: Type): ReturnType
    let explicitReturnType = ''
    const returnTypeMatch = params.match(/\):\s*([^=]+)$/)
    if (returnTypeMatch) {
      explicitReturnType = returnTypeMatch[1].trim()
      params = params.substring(0, params.lastIndexOf('):'))  + ')'
    }

    // Clean up params
    if (params === '()' || params === '') {
      params = '()'
    } else if (!params.startsWith('(')) {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to infer return type from body
    let returnType = 'unknown'
    if (explicitReturnType) {
      // Use explicit return type annotation
      returnType = explicitReturnType
    } else if (body.startsWith('{')) {
      // Block body - can't easily infer return type
      returnType = 'unknown'
    } else if (body.includes('=>')) {
      // This is a higher-order function returning another function
      // Try to infer the return function type
      const innerFuncType = inferFunctionType(body, false)
      returnType = innerFuncType
    } else {
      // Expression body - try to infer
      returnType = inferNarrowType(body, false)
    }

    const funcType = `${generics}${params} => ${returnType}`
    return inUnion ? `(${funcType})` : funcType
  }

    // Function expressions
  if (trimmed.startsWith('function')) {
    // Handle generics in function expressions like function* <T>(items: T[])
    let generics = ''
    let remaining = trimmed

    // Look for generics after function keyword
    const genericMatch = trimmed.match(/function\s*\*?\s*(<[^>]+>)/)
    if (genericMatch) {
      generics = genericMatch[1]
    }

    // Try to extract function signature
    const funcMatch = trimmed.match(/function\s*(\*?)\s*(?:<[^>]+>)?\s*([^(]*)\(([^)]*)\)/)
    if (funcMatch) {
      const isGenerator = !!funcMatch[1]
      const name = funcMatch[2].trim()
      const params = funcMatch[3].trim()

      let paramTypes = '(...args: any[])'
      if (params) {
        // Try to parse parameters
        paramTypes = `(${params})`
      } else {
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
