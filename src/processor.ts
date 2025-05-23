import type { Declaration, ProcessingContext } from './types'

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
    const lines = decl.text.split('\n').map(line => line.trim()).filter(line => line)

    for (const line of lines) {
      if (line.startsWith('export default')) {
        defaultExport.push(line.endsWith(';') ? line : line + ';')
      } else if (line.startsWith('export type {') || line.startsWith('export {')) {
        // Extract exported items from the line
        const match = line.match(/export\s+(?:type\s+)?\{\s*([^}]+)\s*\}/)
        if (match) {
          const items = match[1].split(',').map(item => item.trim())
          for (const item of items) {
            exportedItems.add(item)
          }
        }
        const statement = line.endsWith(';') ? line : line + ';'
        if (!exportStatements.includes(statement)) {
          exportStatements.push(statement)
        }
      } else if (line.startsWith('export ')) {
        const statement = line.endsWith(';') ? line : line + ';'
        if (!exportStatements.includes(statement)) {
          exportStatements.push(statement)
        }
      }
    }
  }

  // Filter imports to only include those that are used in exports or declarations
  const usedImports = new Set<string>()

  // Check which imports are needed based on exported functions and types
  for (const func of functions) {
    if (func.isExported) {
      // Check function signature for imported types (only in the function signature, not the body)
      const funcDeclaration = func.text.split('{')[0] // Only check the signature part
      for (const imp of imports) {
        const importMatch = imp.text.match(/import\s+(?:type\s+)?\{?\s*([^}]+)\s*\}?\s+from/)
        if (importMatch) {
          const importedItems = importMatch[1].split(',').map(item => item.trim())
          for (const item of importedItems) {
            if (funcDeclaration.includes(item)) {
              usedImports.add(imp.text)
            }
          }
        }
      }
    }
  }

  // Check which imports are needed for interfaces and types (check all, not just exported)
  for (const iface of interfaces) {
    for (const imp of imports) {
      const importMatch = imp.text.match(/import\s+(?:type\s+)?\{?\s*([^}]+)\s*\}?\s+from/)
      if (importMatch) {
        const importedItems = importMatch[1].split(',').map(item => item.trim())
        for (const item of importedItems) {
          if (iface.text.includes(item)) {
            usedImports.add(imp.text)
          }
        }
      }
    }
  }

  for (const type of types) {
    if (type.isExported) {
      for (const imp of imports) {
        const importMatch = imp.text.match(/import\s+(?:type\s+)?\{?\s*([^}]+)\s*\}?\s+from/)
        if (importMatch) {
          const importedItems = importMatch[1].split(',').map(item => item.trim())
          for (const item of importedItems) {
            if (type.text.includes(item)) {
              usedImports.add(imp.text)
            }
          }
        }
      }
    }
  }

  // Check which imports are needed for re-exports
  for (const item of exportedItems) {
    for (const imp of imports) {
      if (imp.text.includes(item)) {
        usedImports.add(imp.text)
      }
    }
  }

  // Also check for value imports that are re-exported
  for (const exp of exports) {
    if (exp.text.includes('export { generate }')) {
      // Find the import for generate
      for (const imp of imports) {
        if (imp.text.includes('{ generate }')) {
          usedImports.add(imp.text)
        }
      }
    }
  }

  // Process and add used imports first
  const processedImports: string[] = []
  for (const imp of imports) {
    if (usedImports.has(imp.text)) {
      const processed = processImportDeclaration(imp)
      if (processed && processed.trim()) {
        processedImports.push(processed)
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
  const parts: string[] = []

  // Add export if needed
  if (decl.isExported) {
    parts.push('export')
  }

  // Add declare keyword
  parts.push('declare')

  // Add variable kind (const, let, var)
  const kind = decl.modifiers?.[0] || 'const'
  parts.push(kind)

  // Add variable name
  parts.push(decl.name)

  // Add type annotation
  let typeAnnotation = decl.typeAnnotation

  // If no explicit type annotation, try to infer from value
  if (!typeAnnotation && decl.value) {
    // Only infer literal types for const declarations
    typeAnnotation = inferNarrowType(decl.value, kind === 'const')
  }

  // Default to any if we couldn't determine type
  if (!typeAnnotation) {
    typeAnnotation = 'any'
  }

  parts.push(':')
  parts.push(typeAnnotation)

  // Combine parts
  let result = parts.join(' ')
  result = result.replace(' : ', ': ')

  // Add semicolon
  result += ';'

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

  // Add generics if present
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
      result += decl.generics
    }
    result += ' = any'
  }

  return result
}

/**
 * Process class declaration to DTS format
 */
export function processClassDeclaration(decl: Declaration): string {
  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Add modifiers
  if (decl.modifiers?.includes('abstract')) {
    result += 'abstract '
  }

  // Add class keyword
  result += 'class '

  // Add class name
  result += decl.name

  // Add generics if present
  if (decl.generics) {
    result += decl.generics
  }

  // Add extends clause if present
  if (decl.extends) {
    result += ' extends ' + decl.extends
  }

  // Add implements clause if present
  if (decl.implements && decl.implements.length > 0) {
    result += ' implements ' + decl.implements.join(', ')
  }

  // Extract the body from the original text
  const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
  if (bodyMatch) {
    // For now, include the whole body
    // In a more sophisticated implementation, we'd parse and clean method bodies
    result += ' ' + bodyMatch[0]
  } else {
    result += ' {}'
  }

  return result
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
    return 'Promise<unknown>'
  }
  if (value.startsWith('Promise.reject(')) {
    return 'Promise<never>'
  }
  if (value.startsWith('Promise.all(')) {
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
      return inferArrayType(trimmedEl, true)
    }
    return inferNarrowTypeInUnion(trimmedEl, true)
  })

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
 * Infer function type from function expression
 */
function inferFunctionType(value: string, inUnion: boolean = false): string {
  // Arrow functions
  if (value.includes('=>')) {
    const arrowIndex = value.indexOf('=>')
    let params = value.substring(0, arrowIndex).trim()

    // Clean up params - remove extra parentheses if they exist
    if (params === '()' || params === '') {
      params = ''
    } else if (params.startsWith('(') && params.endsWith(')')) {
      // Keep the parentheses for parameters
      params = params
    } else {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to parse return type from the body
    const funcType = `${params || '()'} => unknown`

    // Add extra parentheses if this function is part of a union type
    return inUnion ? `(${funcType})` : funcType
  }

  // Regular functions
  if (value.startsWith('function') || value.startsWith('async function')) {
    const funcType = '(...args: any[]) => unknown'
    return inUnion ? `(${funcType})` : funcType
  }

  const funcType = '() => unknown'
  return inUnion ? `(${funcType})` : funcType
}