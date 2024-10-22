/**
 * RegExp patterns used throughout the module
 */
export interface RegexPatterns {
  readonly typeImport: RegExp
  readonly regularImport: RegExp
  readonly returnType: RegExp
  readonly constType: RegExp
  readonly bracketOpen: RegExp
  readonly bracketClose: RegExp
  readonly functionReturn: RegExp
}

/**
 * Regular expression patterns used throughout the module
 */
export const REGEX: RegexPatterns = {
  typeImport: /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/,
  regularImport: /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/,
  returnType: /\):\s*([^{;]+)/,
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  constType: /const([^:=]+):\s*([^=]+)=/,
  bracketOpen: /[[{]/g,
  bracketClose: /[\]}]/g,
  functionReturn: /return\s+([^;]+)/,
} as const satisfies RegexPatterns

// Type Definitions
/**
 * Represents type information for a property
 */
export interface PropertyInfo {
  /** Property name */
  key: string
  /** Original value from source */
  value: string
  /** Inferred TypeScript type */
  type: string
  /** Nested properties for objects */
  nested?: PropertyInfo[]
}

/**
 * Represents the current state of the processing
 */
export interface ProcessingState {
  dtsLines: string[]
  imports: string[]
  usedTypes: Set<string>
  typeSources: Map<string, string>
  defaultExport: string
  currentDeclaration: string
  lastCommentBlock: string
  bracketCount: number
  isMultiLineDeclaration: boolean
}

interface TypeAnnotation {
  raw: string | null
  parsed: string
}

function getTypeAnnotation(declaration: string): TypeAnnotation {
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  const match = declaration.match(/:\s*(\{[^=]+\}|\[[^\]]+\]|[^=]+?)\s*=/)
  return {
    raw: match?.[1]?.trim() ?? null,
    parsed: match?.[1]?.trim() ?? 'any',
  }
}

/**
 * Extracts types from a TypeScript file and generates corresponding .d.ts content
 */
export async function extract(filePath: string): Promise<string> {
  try {
    const sourceCode = await Bun.file(filePath).text()
    return extractDtsTypes(sourceCode)
  }
  catch (error) {
    console.error('Failed to extract types:', error)
    throw new Error('Failed to extract and generate .d.ts file')
  }
}

/**
 * Generates TypeScript declaration types from source code.
 */
export function extractDtsTypes(sourceCode: string): string {
  const state: ProcessingState = {
    dtsLines: [],
    imports: [],
    usedTypes: new Set(),
    typeSources: new Map(),
    defaultExport: '',
    currentDeclaration: '',
    lastCommentBlock: '',
    bracketCount: 0,
    isMultiLineDeclaration: false,
  }

  const lines = sourceCode.split('\n')
  for (const line of lines) {
    processLine(line, state)
  }

  return formatOutput(state)
}

function processLine(line: string, state: ProcessingState): void {
  const trimmedLine = line.trim()

  if (!trimmedLine)
    return

  if (isCommentLine(trimmedLine)) {
    processCommentLine(trimmedLine, state)
    return
  }

  if (trimmedLine.startsWith('import')) {
    state.imports.push(processImport(line, state.typeSources))
    return
  }

  if (trimmedLine.startsWith('export default')) {
    state.defaultExport = `\n${trimmedLine};`
    return
  }

  if (isDeclarationLine(trimmedLine) || state.isMultiLineDeclaration) {
    processDeclarationLine(trimmedLine, state)
  }
}

/**
 * Process import statements and track type sources
 */
export function processImport(importLine: string, typeSources: Map<string, string>): string {
  const typeImportMatch = importLine.match(REGEX.typeImport)
  const regularImportMatch = importLine.match(REGEX.regularImport)

  const match = typeImportMatch || regularImportMatch
  if (match) {
    const types = match[1].split(',').map(type => type.trim())
    const source = match[2]

    for (const type of types) {
      const actualType = type.split(' as ')[0].trim()
      typeSources.set(actualType, source)
    }
  }

  return importLine
}

/**
 * Filter out unused imports and only keep type imports
 */
export function processImports(imports: string[]): string[] {
  return imports.filter(line => line.trim().startsWith('import type'))
}

/**
 * Process declarations (const, interface, type, function)
 */
export function processDeclaration(declaration: string, usedTypes: Set<string>): string {
  const trimmed = declaration.trim()

  if (trimmed.startsWith('export const'))
    return processConstDeclaration(trimmed)

  if (trimmed.startsWith('const'))
    return processConstDeclaration(trimmed, false)

  if (trimmed.startsWith('export interface'))
    return processInterfaceDeclaration(trimmed)

  if (trimmed.startsWith('interface'))
    return processInterfaceDeclaration(trimmed, false)

  if (trimmed.startsWith('export type {'))
    return processTypeOnlyExport(trimmed)

  if (trimmed.startsWith('type {'))
    return processTypeOnlyExport(trimmed, false)

  if (trimmed.startsWith('export type'))
    return processTypeDeclaration(trimmed)

  if (trimmed.startsWith('type'))
    return processTypeDeclaration(trimmed, false)

  if (trimmed.startsWith('export function') || trimmed.startsWith('export async function'))
    return processFunctionDeclaration(trimmed, usedTypes)

  if (trimmed.startsWith('function') || trimmed.startsWith('async function'))
    return processFunctionDeclaration(trimmed, usedTypes, false)

  if (trimmed.startsWith('export default'))
    return `${trimmed};`

  if (trimmed.startsWith('export'))
    return trimmed

  return `declare ${trimmed}`
}

/**
 * Process constant declarations
 */
function processConstDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const name = firstLine.split('const')[1].split('=')[0].trim().split(':')[0].trim()
  const typeAnnotation = getTypeAnnotation(firstLine)

  // If there's an explicit type annotation, use it
  if (typeAnnotation.raw) {
    return `${isExported ? 'export ' : ''}declare const ${name}: ${typeAnnotation.raw};`
  }

  // Otherwise, infer the type from the value
  const properties = extractObjectProperties(lines.slice(1, -1))
  const propertyStrings = formatProperties(properties)

  return `${isExported ? 'export ' : ''}declare const ${name}: {\n${propertyStrings}\n};`
}

/**
 * Format nested properties with proper indentation
 */
export function formatProperties(properties: PropertyInfo[], indent = 2): string {
  return properties.map((prop) => {
    const spaces = ' '.repeat(indent)
    if (prop.nested && prop.nested.length > 0) {
      const nestedProps = formatProperties(prop.nested, indent + 2)
      return `${spaces}${prop.key}: {\n${nestedProps}\n${spaces}};`
    }
    return `${spaces}${prop.key}: ${prop.type};`
  }).join('\n')
}

/**
 * Extract object properties and their types
 */
export function extractObjectProperties(lines: string[]): PropertyInfo[] {
  const properties: PropertyInfo[] = []
  let currentProperty: { key?: string, content: string[] } = { content: [] }
  let depth = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*'))
      continue

    const openCount = (trimmed.match(REGEX.bracketOpen) || []).length
    const closeCount = (trimmed.match(REGEX.bracketClose) || []).length

    if (depth === 0 && trimmed.includes(':')) {
      const [key] = trimmed.split(':')
      currentProperty = {
        key: key.trim(),
        content: [trimmed],
      }
    }
    else if (depth > 0 || openCount > 0) {
      currentProperty.content.push(trimmed)
    }

    depth += openCount - closeCount

    if (depth === 0 && currentProperty.key) {
      const propertyInfo = processCompleteProperty(currentProperty)
      if (propertyInfo)
        properties.push(propertyInfo)
      currentProperty = { content: [] }
    }
  }

  return properties
}

/**
 * Process a complete property with all its nested content
 */
export function processCompleteProperty({ key, content }: { key?: string, content: string[] }): PropertyInfo | null {
  if (!key)
    return null

  const fullContent = content.join(' ').trim()
  const colonIndex = fullContent.indexOf(':')
  if (colonIndex === -1)
    return null

  const valueContent = fullContent.substring(colonIndex + 1).trim()

  if (valueContent.startsWith('{')) {
    const nestedContent = extractNestedContent(valueContent, '{', '}')
    if (nestedContent) {
      const nestedProps = extractObjectProperties(nestedContent.split(',').map(line => line.trim()))
      return {
        key,
        value: valueContent,
        type: formatNestedType(nestedProps),
        nested: nestedProps,
      }
    }
  }

  // Handle arrays with proper type parameters
  if (valueContent.startsWith('[')) {
    return {
      key,
      value: valueContent,
      type: inferArrayType(valueContent).replace(/'+$/, ''), // Remove any trailing quotes
    }
  }

  if (isFunction(valueContent)) {
    return {
      key,
      value: valueContent,
      type: inferFunctionType(valueContent),
    }
  }

  return processSimpleValue(key, valueContent)
}

/**
 * Extract nested content between matching delimiters
 */
export function extractNestedContent(content: string, openChar: string, closeChar: string): string | null {
  let depth = 0
  let start = -1

  for (let i = 0; i < content.length; i++) {
    if (content[i] === openChar) {
      if (depth === 0)
        start = i
      depth++
    }
    else if (content[i] === closeChar) {
      depth--
      if (depth === 0 && start !== -1) {
        return content.substring(start + 1, i)
      }
    }
  }

  return null
}

/**
 * Check if a value represents a function
 */
export function isFunction(value: string): boolean {
  return (
    value.includes('=>')
    || value.startsWith('function')
    || value === 'console.log'
    || (value.endsWith('.log') && !value.includes('[') && !value.includes('{'))
  )
}

/**
 * Infer array type from array literal
 */
export function inferArrayType(value: string): string {
  const content = extractNestedContent(value, '[', ']')
  if (!content)
    return 'never[]'

  const elements = splitArrayElements(content)
  if (elements.length === 0)
    return 'never[]'

  // Handle case where elements themselves are arrays
  if (elements.some(el => el.trim().startsWith('['))) {
    const nestedTypes = elements.map((element) => {
      const trimmed = element.trim()
      if (trimmed.startsWith('[')) {
        const nestedContent = extractNestedContent(trimmed, '[', ']')
        if (nestedContent) {
          const nestedElements = splitArrayElements(nestedContent)
          return `Array<${nestedElements.map(ne => inferElementType(ne.trim())).join(' | ')}>`
        }
      }
      return inferElementType(trimmed)
    })

    return `Array<${nestedTypes.join(' | ')}>`
  }

  // Handle simple array case
  const elementTypes = elements.map(element => inferElementType(element.trim()))
  const uniqueTypes = [...new Set(elementTypes)]
  return `Array<${uniqueTypes.join(' | ')}>`
}

/**
 * Infer element type from a single array element
 */
export function inferElementType(element: string): string {
  const trimmed = element.trim()

  // Handle string literals
  if (trimmed.startsWith('\'') || trimmed.startsWith('"')) {
    const cleanValue = trimmed.slice(1, -1).replace(/'+$/, '')
    return `'${cleanValue}'`
  }

  // Handle numbers
  if (!Number.isNaN(Number(trimmed))) {
    return trimmed
  }

  // Handle objects
  if (trimmed.startsWith('{')) {
    return formatObjectType(parseObjectLiteral(trimmed))
  }

  // Handle function references and calls
  if (trimmed === 'console.log' || trimmed.endsWith('.log')) {
    return '(...args: any[]) => void'
  }

  // Handle arrow functions
  if (trimmed.includes('=>')) {
    const arrowFn = trimmed.match(/\(.*\)\s*=>\s*(.*)/)
    return '(...args: any[]) => void'
  }

  // Handle function calls
  if (trimmed.endsWith('()')) {
    return 'unknown'
  }

  // Handle object references
  if (trimmed.includes('.')) {
    return 'unknown'
  }

  // Handle identifiers that might be undefined
  if (/^[a-z_]\w*$/i.test(trimmed)) {
    return 'unknown'
  }

  return 'unknown'
}

/**
 * Process nested array structures
 */
export function processNestedArray(elements: string[]): string {
  const processedTypes = elements.map((element) => {
    const trimmed = element.trim()

    // Handle nested arrays
    if (trimmed.startsWith('[')) {
      const nestedContent = extractNestedContent(trimmed, '[', ']')
      if (nestedContent) {
        const nestedElements = splitArrayElements(nestedContent)
        // Process each nested element to create a proper union type
        const nestedTypes = nestedElements.map(ne => inferElementType(ne.trim()))
        return `Array<${nestedTypes.join(' | ')}>`
      }
      return 'never'
    }

    return inferElementType(trimmed)
  }).filter(type => type !== 'never')

  return processedTypes.join(' | ')
}

/**
 * Infer function type including return type
 */
export function inferFunctionType(func: string): string {
  const isAsync = func.startsWith('async')
  let returnType = 'unknown'

  if (func.includes('console.log')) {
    returnType = 'void'
  }
  else if (func.includes('return')) {
    const returnStatement = func.match(REGEX.functionReturn)?.[1]
    if (returnStatement) {
      returnType = inferReturnType(returnStatement)
    }
  }

  return `${isAsync ? 'async ' : ''}(...args: any[]) => ${returnType}`
}

export function inferReturnType(returnStatement: string): string {
  if (returnStatement.startsWith('\'') || returnStatement.startsWith('"'))
    return 'string'
  if (!Number.isNaN(Number(returnStatement)))
    return 'number'
  if (returnStatement === 'true' || returnStatement === 'false')
    return 'boolean'
  if (returnStatement.includes('??')) {
    const [, fallback] = returnStatement.split('??').map(s => s.trim())
    if (fallback.startsWith('\'') || fallback.startsWith('"'))
      return 'string'
  }
  return 'unknown'
}

/**
 * Split array elements while respecting nested structures
 */
export function splitArrayElements(content: string): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]

    // Handle string boundaries
    if ((char === '"' || char === '\'') && (i === 0 || content[i - 1] !== '\\')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    // Track nested structures
    if (!inString) {
      if (char === '[' || char === '{')
        depth++
      else if (char === ']' || char === '}')
        depth--
    }

    // Split elements only at top level
    if (char === ',' && depth === 0 && !inString) {
      if (current.trim()) {
        elements.push(current.trim())
      }
      current = ''
    }
    else {
      current += char
    }
  }

  // Add the last element
  if (current.trim()) {
    elements.push(current.trim())
  }

  return elements.filter(Boolean)
}

/**
 * Parse object literal into properties
 */
export function parseObjectLiteral(objStr: string): PropertyInfo[] {
  const content = objStr.slice(1, -1).trim()
  return extractObjectProperties([content])
}

/**
 * Process simple value types (string, number, boolean)
 */
export function processSimpleValue(key: string, value: string): PropertyInfo {
  const cleanValue = value.replace(/,\s*$/, '').trim()

  if (cleanValue.startsWith('\'') || cleanValue.startsWith('"')) {
    return {
      key,
      value: cleanValue,
      type: `'${cleanValue.slice(1, -1)}'`,
    }
  }

  if (!Number.isNaN(Number(cleanValue))) {
    return {
      key,
      value: cleanValue,
      type: cleanValue,
    }
  }

  if (cleanValue === 'true' || cleanValue === 'false') {
    return {
      key,
      value: cleanValue,
      type: cleanValue,
    }
  }

  if (cleanValue.endsWith('()') || cleanValue === 'console.log') {
    return {
      key,
      value: cleanValue,
      type: '(...args: any[]) => void',
    }
  }

  return {
    key,
    value: cleanValue,
    type: 'unknown',
  }
}

/**
 * Format nested type structure
 */
export function formatNestedType(properties: PropertyInfo[]): string {
  if (properties.length === 0)
    return 'Object'

  const formattedProps = properties
    .map(prop => `${prop.key}: ${prop.nested ? formatNestedType(prop.nested) : prop.type}`)
    .join('; ')

  return `{ ${formattedProps} }`
}

/**
 * Process interface declarations
 */
export function processInterfaceDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const interfaceName = lines[0].split('interface')[1].split('{')[0].trim()
  const interfaceBody = lines
    .slice(1, -1)
    .map(line => `  ${line.trim().replace(/;?$/, ';')}`)
    .join('\n')

  return `${isExported ? 'export ' : ''}declare interface ${interfaceName} {\n${interfaceBody}\n}`
}

/**
 * Process type-only exports
 */
export function processTypeOnlyExport(declaration: string, isExported = true): string {
  return declaration
    .replace('export type', `${isExported ? 'export ' : ''}declare type`)
    .replace(/;$/, '')
}

/**
 * Process type declarations
 */
export function processTypeDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const typeName = firstLine.split('type')[1].split('=')[0].trim()
  const typeBody = firstLine.split('=')[1]?.trim() || lines.slice(1).join('\n').trim().replace(/;$/, '')

  return `${isExported ? 'export ' : ''}declare type ${typeName} = ${typeBody};`
}

/**
 * Process function declarations
 */
export function processFunctionDeclaration(
  declaration: string,
  usedTypes: Set<string>,
  isExported = true,
): string {
  const functionSignature = declaration.split('{')[0].trim()
  const asyncKeyword = functionSignature.includes('async') ? 'async ' : ''
  const functionName = functionSignature
    .replace('export ', '')
    .replace('async ', '')
    .split('(')[0]
    .trim()
  const params = functionSignature.split('(')[1].split(')')[0].trim()
  const returnType = getReturnType(functionSignature)

  if (returnType && returnType !== 'void') {
    // Add base type and any generic parameters to usedTypes
    const baseType = returnType.split('<')[0].trim()
    usedTypes.add(baseType)

    // Extract types from generic parameters if present
    const genericMatch = returnType.match(/<([^>]+)>/)?.[1]
    if (genericMatch) {
      genericMatch.split(',').forEach((type) => {
        const cleanType = type.trim().split('<')[0].trim()
        if (cleanType)
          usedTypes.add(cleanType)
      })
    }
  }

  return `${isExported ? 'export ' : ''}declare ${asyncKeyword}function ${functionName}(${params}): ${returnType};`
    .replace('function function', 'function')
}

/**
 * Get function return type
 */
export function getReturnType(functionSignature: string): string {
  const returnTypeMatch = functionSignature.match(REGEX.returnType)
  if (!returnTypeMatch)
    return 'void'

  return returnTypeMatch[1]
    .replace(/[;,]$/, '')
    .trim()
}

// Helper functions for line processing
export function isCommentLine(line: string): boolean {
  return line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')
}

function processCommentLine(line: string, state: ProcessingState): void {
  const indentedLine = line.startsWith('*')
    ? ` ${line}` // Add indentation for content lines
    : line.startsWith('/**') || line.startsWith('*/')
      ? line // Keep delimiters at original indentation
      : ` ${line}` // Add indentation for other lines

  if (line.startsWith('/**'))
    state.lastCommentBlock = ''
  state.lastCommentBlock += `${indentedLine}\n`
}

export function isDeclarationLine(line: string): boolean {
  return line.startsWith('export')
    || line.startsWith('const')
    || line.startsWith('interface')
    || line.startsWith('type')
    || line.startsWith('function')
}

export function processDeclarationLine(line: string, state: ProcessingState): void {
  state.currentDeclaration += `${line}\n`
  const opens = (line.match(REGEX.bracketOpen) || []).length
  const closes = (line.match(REGEX.bracketClose) || []).length
  state.bracketCount += opens - closes
  state.isMultiLineDeclaration = state.bracketCount > 0

  if (!state.isMultiLineDeclaration) {
    if (state.lastCommentBlock) {
      state.dtsLines.push(state.lastCommentBlock.trimEnd())
      state.lastCommentBlock = ''
    }
    const processed = processDeclaration(state.currentDeclaration.trim(), state.usedTypes)
    if (processed)
      state.dtsLines.push(processed)
    state.currentDeclaration = ''
    state.bracketCount = 0
  }
}

function formatOutput(state: ProcessingState): string {
  const imports = processImports(state.imports)
  const dynamicImports = Array.from(state.usedTypes)
    .map((type) => {
      const source = state.typeSources.get(type)
      return source ? `import type { ${type} } from '${source}';` : ''
    })
    .filter(Boolean)

  const declarations = state.dtsLines.map(line =>
    line.startsWith('*') ? `  ${line}` : line,
  )

  const result = [
    ...imports,
    ...dynamicImports,
    '',
    ...declarations,
  ].filter(Boolean).join('\n')

  // Handle default export
  if (state.defaultExport) {
    const cleanDefaultExport = state.defaultExport
      .replace(/^export\s+default\s+/, '')
      .replace(/;+$/, '')
    return `${result}\n\nexport default ${cleanDefaultExport};`
  }

  return result
}

/**
 * Formats an object's properties into a TypeScript type string
 * @param properties - Array of property information to format
 * @returns Formatted type string
 */
export function formatObjectType(properties: PropertyInfo[]): string {
  if (properties.length === 0)
    return 'Object'

  const formattedProps = properties
    .map((prop) => {
      const type = prop.nested ? formatNestedType(prop.nested) : prop.type
      return `${prop.key}: ${type}`
    })
    .join('; ')

  return `{ ${formattedProps} }`
}
