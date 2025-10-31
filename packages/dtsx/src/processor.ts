/* eslint-disable regexp/no-super-linear-backtracking, regexp/no-misleading-capturing-group, regexp/optimal-quantifier-concatenation, regexp/no-unused-capturing-group */
import type { Declaration, ProcessingContext } from './types'

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

  // Common TypeScript built-in types that don't need to be imported
  // const builtInTypes = new Set([
  //   'string',
  //   'number',
  //   'boolean',
  //   'object',
  //   'any',
  //   'unknown',
  //   'never',
  //   'void',
  //   'undefined',
  //   'null',
  //   'Array',
  //   'Promise',
  //   'Record',
  //   'Partial',
  //   'Required',
  //   'Pick',
  //   'Omit',
  //   'Exclude',
  //   'Extract',
  //   'NonNullable',
  //   'ReturnType',
  //   'Parameters',
  //   'ConstructorParameters',
  //   'InstanceType',
  //   'ThisType',
  //   'Function',
  //   'Date',
  //   'RegExp',
  //   'Error',
  //   'Map',
  //   'Set',
  //   'WeakMap',
  //   'WeakSet',
  // ])

  // // Common generic type parameter names that should not be replaced
  // const genericTypeParams = new Set([
  //   'T',
  //   'K',
  //   'V',
  //   'U',
  //   'R',
  //   'P',
  //   'E',
  //   'A',
  //   'B',
  //   'C',
  //   'D',
  //   'F',
  //   'G',
  //   'H',
  //   'I',
  //   'J',
  //   'L',
  //   'M',
  //   'N',
  //   'O',
  //   'Q',
  //   'S',
  //   'W',
  //   'X',
  //   'Y',
  //   'Z',
  // ])

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
 * Extract all imported items from an import statement
 */
function extractAllImportedItems(importText: string): string[] {
  const items: string[] = []

  // Handle mixed imports: import defaultName, { a, b } from 'module'
  const mixedMatch = importText.match(/import\s+([^{,\s]+),\s*(?:\{\s*)?([^}]+)(?:\s+(?:\}\s+)?|\}\s+)from/)
  if (mixedMatch) {
    // Add default import
    items.push(mixedMatch[1].trim())
    // Add named imports
    const namedItems = mixedMatch[2].split(',').map(item => item.replace(/^type\s+/, '').trim())
    items.push(...namedItems)
    return items
  }

  // Handle named imports: import { a, b } from 'module'
  const namedMatch = importText.match(/import\s+(?:type\s+)?\{?\s*([^}]+)(?:\s+(?:\}\s+)?|\}\s+)from/)
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
  context: ProcessingContext,
  keepComments: boolean = true,
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

  // Filter imports to only include those that are used in exports or declarations
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
        const typeMatches = importText.match(/type\s+([A-Za-z_$][\w$]*)/g)
        const valueMatches = importText.match(/import\s+\{([^}]+)\}/)

        // Get all text to check (both variable.text and variable.typeAnnotation)
        const textToCheck = [variable.text]
        if (variable.typeAnnotation) {
          textToCheck.push(variable.typeAnnotation)
        }

        // Check type imports
        if (typeMatches) {
          for (const typeMatch of typeMatches) {
            const typeName = typeMatch.replace('type ', '').trim()
            const regex = new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            // Check both variable.text and variable.typeAnnotation
            if (textToCheck.some(text => regex.test(text))) {
              usedImportItems.add(typeName)
            }
          }
        }

        // Check value imports
        if (valueMatches) {
          const imports = valueMatches[1].split(',').map(item =>
            item.replace(/type\s+/, '').trim(),
          )
          for (const importName of imports) {
            const regex = new RegExp(`\\b${importName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
            // Check both variable.text and variable.typeAnnotation
            if (textToCheck.some(text => regex.test(text))) {
              usedImportItems.add(importName)
            }
          }
        }

        // Also check using the more comprehensive extractAllImportedItems function
        const allImportedItems = extractAllImportedItems(imp.text)
        for (const item of allImportedItems) {
          const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
          // Check both variable.text and variable.typeAnnotation
          if (textToCheck.some(text => regex.test(text))) {
            usedImportItems.add(item)
          }
        }
      }
    }
  }

  // Check which imports are needed for ALL declarations that will be included in the DTS output
  // This includes non-exported types, interfaces, classes, etc. that are still part of the public API

  // Check interfaces (both exported and non-exported ones that are referenced)
  for (const iface of interfaces) {
    // Include interface if it's exported OR if it's referenced by any declaration we're including
    const isReferencedByExports = functions.some(func =>
      func.isExported && func.text.includes(iface.name),
    )
    const isReferencedByClasses = classes.some(cls =>
      cls.text.includes(iface.name),
    )
    const isReferencedByTypes = types.some(type =>
      type.text.includes(iface.name),
    )

    if (iface.isExported || isReferencedByExports || isReferencedByClasses || isReferencedByTypes) {
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

  // Check ALL types (exported and non-exported) since they may be included in DTS
  for (const type of types) {
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

  // Check ALL classes (exported and non-exported) since they may be included in DTS
  for (const cls of classes) {
    for (const imp of imports) {
      const allImportedItems = extractAllImportedItems(imp.text)
      for (const item of allImportedItems) {
        const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        if (regex.test(cls.text)) {
          usedImportItems.add(item)
        }
      }
    }
  }

  // Check ALL enums (exported and non-exported) since they may be included in DTS
  for (const enumDecl of enums) {
    for (const imp of imports) {
      const allImportedItems = extractAllImportedItems(imp.text)
      for (const item of allImportedItems) {
        const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        if (regex.test(enumDecl.text)) {
          usedImportItems.add(item)
        }
      }
    }
  }

  // Check ALL modules/namespaces since they may be included in DTS
  for (const mod of modules) {
    for (const imp of imports) {
      const allImportedItems = extractAllImportedItems(imp.text)
      for (const item of allImportedItems) {
        const regex = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        if (regex.test(mod.text)) {
          usedImportItems.add(item)
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
    const mixedImportMatch = imp.text.match(/import\s+([^{,\s]+),\s*(?:\{\s*)?([^}]+)(?:\s+(?:\}\s+)?|\}\s+)from\s+['"]([^'"]+)['"]/)
    const namedImportMatch = imp.text.match(/import\s+(?:type\s+)?\{\s*([^}]+)\s*\}\s+from\s+['"]([^'"]+)['"]/)
    const defaultImportMatch = imp.text.match(/import\s+(?:type\s+)?([^{,\s]+)\s+from\s+['"]([^'"]+)['"]/)

    if (mixedImportMatch) {
      // Mixed import: import defaultName, { a, b } from 'module'
      const defaultName = mixedImportMatch[1].trim()
      const namedItems = mixedImportMatch[2].split(',').map(item => item.trim())
      const source = mixedImportMatch[3]

      const usedDefault = usedImportItems.has(defaultName)
      const usedNamed = namedItems.filter((item) => {
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
        if (usedDefault)
          parts.push(defaultName)
        if (usedNamed.length > 0)
          parts.push(`{ ${usedNamed.join(', ')} }`)

        importStatement += `${parts.join(', ')} from '${source}';`

        processedImports.push(importStatement)
      }
    }
    else if (namedImportMatch && !defaultImportMatch) {
      // Named imports only: import { a, b } from 'module'
      const importedItems = namedImportMatch[1].split(',').map(item => item.trim())
      const usedItems = importedItems.filter((item) => {
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
    }
    else if (defaultImportMatch && !namedImportMatch) {
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
    const aFromBun = a.includes('from \'bun\'')
    const bFromBun = b.includes('from \'bun\'')

    if (aFromBun && !bFromBun)
      return -1
    if (!aFromBun && bFromBun)
      return 1

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

  // If we have a value, check if it has 'as const' - if so, infer from value instead of type annotation
  if (decl.value && decl.value.includes('as const')) {
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
