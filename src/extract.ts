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
  moduleImports: Map<string, ImportInfo>
  availableTypes: Map<string, string>
  availableValues: Map<string, string>
}

/**
 * Initialize processing state
 */
export function createProcessingState(): ProcessingState {
  return {
    dtsLines: [],
    imports: [],
    usedTypes: new Set(),
    typeSources: new Map(),
    defaultExport: '',
    currentDeclaration: '',
    lastCommentBlock: '',
    bracketCount: 0,
    isMultiLineDeclaration: false,
    moduleImports: new Map(),
    availableTypes: new Map(),
    availableValues: new Map(),
  }
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
  const state = createProcessingState()

  const lines = sourceCode.split('\n')
  for (const line of lines) {
    processLine(line, state)
  }

  return formatOutput(state)
}

export function processLine(line: string, state: ProcessingState): void {
  const trimmedLine = line.trim()

  if (!trimmedLine)
    return

  if (isCommentLine(trimmedLine)) {
    processCommentLine(trimmedLine, state)
    return
  }

  if (trimmedLine.startsWith('import')) {
    state.imports.push(processImport(line, state))
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

export interface ImportInfo {
  kind: 'type' | 'value' | 'mixed'
  usedTypes: Set<string>
  usedValues: Set<string>
  source: string
}

/**
 * Process import statements with improved tracking
 */
export function processImport(line: string, state: ProcessingState): string {
  // Track both type and value imports
  const typeImportMatch = line.match(/import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/i)
  const valueImportMatch = line.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/i)

  if (typeImportMatch || valueImportMatch) {
    const match = typeImportMatch || valueImportMatch
    const isTypeImport = Boolean(typeImportMatch)
    const [, items, source] = match!

    // Get or create module import info
    if (!state.moduleImports.has(source)) {
      state.moduleImports.set(source, {
        kind: isTypeImport ? 'type' : 'value',
        usedTypes: new Set(),
        usedValues: new Set(),
        source,
      })
    }

    const moduleInfo = state.moduleImports.get(source)!

    // Process imported items
    items.split(',').forEach((item) => {
      const [name, alias] = item.trim().split(/\s+as\s+/).map(s => s.trim())
      const importedName = alias || name

      if (isTypeImport) {
        state.availableTypes.set(importedName, source)
        moduleInfo.kind = moduleInfo.kind === 'value' ? 'mixed' : 'type'
      }
      else {
        state.availableValues.set(importedName, source)
        moduleInfo.kind = moduleInfo.kind === 'type' ? 'mixed' : 'value'

        // Also check if this value is immediately used in a type context
        if (state.currentDeclaration?.includes(importedName)) {
          moduleInfo.usedValues.add(importedName)
        }
      }
    })
  }

  return line
}

/**
 * Generate final import statements
 */
export function generateImports(state: ProcessingState): string[] {
  // Track which values and types are actually used
  const processContent = (content: string) => {
    // Track used values - now includes both function calls and references
    const valueRegex = /\b([a-z_$][\w$]*)\s*(?:[(,;})\s]|$)/gi
    let match: any
    // eslint-disable-next-line no-cond-assign
    while ((match = valueRegex.exec(content)) !== null) {
      const [, value] = match
      if (state.availableValues.has(value)) {
        const source = state.availableValues.get(value)!
        state.moduleImports.get(source)!.usedValues.add(value)
      }
    }

    // Track used types
    const typeMatches = content.matchAll(/\b([A-Z][\w$]*)\b/g)
    for (const [, type] of typeMatches) {
      if (state.availableTypes.has(type)) {
        const source = state.availableTypes.get(type)!
        state.moduleImports.get(source)!.usedTypes.add(type)
      }
    }
  }

  // Process all content including comments and declarations
  state.dtsLines.forEach(processContent)
  if (state.currentDeclaration) {
    processContent(state.currentDeclaration)
  }

  // Generate imports by module
  const imports: string[] = []

  for (const [source, info] of state.moduleImports) {
    const { usedTypes, usedValues } = info

    // Skip if nothing is used from this module
    if (usedTypes.size === 0 && usedValues.size === 0)
      continue

    // Generate type imports if needed
    if (usedTypes.size > 0) {
      const types = Array.from(usedTypes).sort()
      imports.push(`import type { ${types.join(', ')} } from '${source}';`)
    }

    // Generate value imports if needed
    if (usedValues.size > 0) {
      const values = Array.from(usedValues).sort()
      imports.push(`import { ${values.join(', ')} } from '${source}';`)
    }
  }

  return imports.sort()
}

/**
 * Process imports while preserving their original sources
 */
export function processImports(imports: string[], usedTypes: Set<string>): string[] {
  const importMap = new Map<string, Set<string>>()
  const reExportedTypes = new Set<string>()

  // Process each import line
  for (const line of imports) {
    const typeImportMatch = line.match(/import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/i)
    const regularImportMatch = line.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/i)
    const match = typeImportMatch || regularImportMatch

    if (match) {
      const types = match[1]
        .split(',')
        .map((t) => {
          const [type, alias] = t.trim().split(/\s+as\s+/)
          return alias || type.trim()
        })
      const module = match[2]

      if (!importMap.has(module))
        importMap.set(module, new Set())

      types.forEach((type) => {
        importMap.get(module)!.add(type)
        if (usedTypes.has(type))
          reExportedTypes.add(type)
      })
    }
  }

  // Format imports with only the types that are actually used
  return Array.from(importMap.entries())
    .map(([module, types]) => {
      const relevantTypes = Array.from(types).filter(type =>
        usedTypes.has(type) || reExportedTypes.has(type))

      if (relevantTypes.length === 0)
        return ''

      return `import type { ${relevantTypes.sort().join(', ')} } from '${module}';`
    })
    .filter(Boolean)
    .sort()
}

/**
 * Process declarations (const, interface, type, function)
 */
export function processDeclaration(declaration: string, state: ProcessingState): string {
  const trimmed = declaration.trim()

  // Handle different declaration types with proper formatting
  if (trimmed.startsWith('export const')) {
    return processConstDeclaration(trimmed)
  }

  if (trimmed.startsWith('const')) {
    return processConstDeclaration(trimmed, false)
  }

  if (trimmed.startsWith('export interface')) {
    return processInterfaceDeclaration(trimmed)
  }

  if (trimmed.startsWith('interface')) {
    return processInterfaceDeclaration(trimmed, false)
  }

  if (trimmed.startsWith('export type {')) {
    // Handle type-only exports without 'declare'
    return trimmed
  }

  if (trimmed.startsWith('export type')) {
    return processTypeDeclaration(trimmed)
  }

  if (trimmed.startsWith('type')) {
    return processTypeDeclaration(trimmed, false)
  }

  if (trimmed.startsWith('export function') || trimmed.startsWith('export async function')) {
    // Remove async from ambient context
    const processed = trimmed.replace(/\basync\s+/, '')
    return processFunctionDeclaration(processed, state.usedTypes)
  }

  if (trimmed.startsWith('function') || trimmed.startsWith('async function')) {
    // Remove async from ambient context
    const processed = trimmed.replace(/\basync\s+/, '')
    return processFunctionDeclaration(processed, state.usedTypes, false)
  }

  if (trimmed.startsWith('export default')) {
    return `${trimmed};`
  }

  if (trimmed.startsWith('export')) {
    return trimmed
  }

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
function inferArrayType(value: string): string {
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

  // Handle function references and calls - now parenthesized
  if (trimmed === 'console.log' || trimmed.endsWith('.log')) {
    return '((...args: any[]) => void)'
  }

  // Handle arrow functions - now parenthesized
  if (trimmed.includes('=>')) {
    return '((...args: any[]) => void)'
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
        const nestedTypes = nestedElements.map(ne => inferElementType(ne.trim()))
        // Ensure nested array types are properly formatted
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
function splitArrayElements(content: string): string[] {
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
 * Parses a function declaration into its components
 */
export function parseFunctionDeclaration(declaration: string): FunctionParseState {
  const state: FunctionParseState = {
    genericParams: '',
    functionName: '',
    parameters: '',
    returnType: 'void',
    isAsync: false,
  }

  // Check for async
  state.isAsync = declaration.includes('async')

  // Clean declaration
  let cleanDeclaration = declaration
    .replace(/^export\s+/, '')
    .replace(/^async\s+/, '')
    .replace(/^function\s+/, '')
    .trim()

  // Extract function name and generic parameters
  const functionMatch = cleanDeclaration.match(/^([^(<\s]+)(\s*<[^>]+>)?/)
  if (functionMatch) {
    state.functionName = functionMatch[1]
    if (functionMatch[2]) {
      state.genericParams = functionMatch[2].trim()
    }
    cleanDeclaration = cleanDeclaration.slice(functionMatch[0].length).trim()
  }

  // Extract parameters
  const paramsMatch = cleanDeclaration.match(/\(([\s\S]*?)\)/)
  if (paramsMatch) {
    state.parameters = paramsMatch[1].trim()
    cleanDeclaration = cleanDeclaration.slice(paramsMatch[0].length).trim()
  }

  // Extract return type, removing any duplicate colons
  if (cleanDeclaration.startsWith(':')) {
    let returnType = cleanDeclaration.slice(1).trim()
    returnType = returnType
      .replace(/:\s*$/, '') // Remove trailing colons
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim()

    // Match the return type up to any trailing colon
    const returnMatch = returnType.match(/^([^:]+)/)
    if (returnMatch) {
      state.returnType = returnMatch[1].trim()
    }
  }

  return state
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
export function processTypeOnlyExport(declaration: string, state: ProcessingState, isExported = true): string {
  // When processing "export type { X }", add X to usedTypes
  const typeMatch = declaration.match(/export\s+type\s*\{([^}]+)\}/)
  if (typeMatch) {
    const types = typeMatch[1].split(',').map(t => t.trim())
    types.forEach(type => state.usedTypes.add(type))
  }

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
 * Extract complete function signature
 */
export interface FunctionSignature {
  name: string
  params: string
  returnType: string
  isAsync: boolean
  generics: string
}

/**
 * Represents a tracked type reference
 */
export interface TypeReference {
  name: string
  generics: string[]
  isExternal: boolean
}

/**
 * Extract complete function signature handling multi-line declarations
 */
export function extractFunctionSignature(declaration: string): FunctionSignature {
  // Check if the main function declaration is async
  // Only match 'async' at the start of the declaration before 'function'
  const isAsync = /^export\s+async\s+function/.test(declaration)
    || /^async\s+function/.test(declaration)

  // Remove export keyword and clean up whitespace
  const cleanDeclaration = declaration
    .replace(/^export\s+/, '')
    .replace(/^async\s+/, '')
    .replace(/^function\s+/, '')
    .trim()

  // Extract complete generic section with improved regex
  const genericsRegex = /^([a-z_$][\w$]*)\s*(<[^(]+>)/i
  const genericsMatch = cleanDeclaration.match(genericsRegex)

  // Process generics if found
  let generics = ''
  let nameFromGenerics = ''
  if (genericsMatch) {
    nameFromGenerics = genericsMatch[1]
    generics = genericsMatch[2]
  }

  // Remove generics for further parsing
  const withoutGenerics = cleanDeclaration
    .replace(genericsRegex, nameFromGenerics)

  // Extract function name (use the one we got from generics match if available)
  const name = nameFromGenerics || withoutGenerics.match(/^([^(<\s]+)/)?.[1] || ''

  // Extract parameters section
  const paramsMatch = withoutGenerics.match(/\(([\s\S]*?)\)(?=\s*:)/)
  let params = paramsMatch ? paramsMatch[1].trim() : ''

  // Clean up parameters while preserving generic references
  params = cleanParameters(params)

  // Extract return type
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  const returnTypeMatch = withoutGenerics.match(/\)\s*:\s*([\s\S]+?)(?=\{|$)/)
  let returnType = returnTypeMatch ? returnTypeMatch[1].trim() : 'void'

  // Clean up return type
  returnType = normalizeType(returnType)

  const result = {
    name,
    params,
    returnType,
    isAsync,
    generics,
  }

  return result
}

/**
 * Process function declaration with fixed generic handling
 */
export function processFunctionDeclaration(
  declaration: string,
  usedTypes: Set<string>,
  isExported = true,
): string {
  const {
    name,
    params,
    returnType,
    isAsync,
    generics,
  } = extractFunctionSignature(declaration)

  // Track all used types including generics
  trackUsedTypes(`${generics} ${params} ${returnType}`, usedTypes)

  // Build declaration string
  const parts = [
    isExported ? 'export' : '',
    'declare',
    isAsync ? 'async' : '',
    'function',
    name,
    generics,
    `(${params})`,
    ':',
    returnType,
    ';',
  ]

  const result = parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([<>(),;:])/g, '$1')
    .replace(/([<>(),;:])\s+/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return result
}

/**
 * Clean and normalize parameter declarations
 */
export function cleanParameters(params: string): string {
  if (!params.trim())
    return ''

  const result = params
    // Handle destructured parameters while preserving generic references
    .replace(/\{([^}]+)\}:\s*([^,)]+)/g, (_, props, type) => {
      const typeName = normalizeType(type.trim())
      return `options: ${typeName}`
    })
    // Normalize spaces around special characters
    .replace(/\s*([,:])\s*/g, '$1 ')
    // Add space after commas if missing
    .replace(/,(\S)/g, ', $1')
    // Normalize optional parameter syntax
    .replace(/\s*\?\s*:/g, '?: ')
    // Clean up spaces around array/generic brackets while preserving content
    .replace(/\s*([<[\]>])\s*/g, '$1')
    // Final cleanup of any double spaces
    .replace(/\s{2,}/g, ' ')
    .trim()

  return result
}

/**
 * Normalize type references while preserving generic parameters
 */
function normalizeType(type: string): string {
  return type
    .replace(/\s+/g, ' ')
    .replace(/\s*([<>])\s*/g, '$1')
    .replace(/\s*,\s*/g, ', ')
    .trim()
}

/**
 * Track used types in function signatures and bodies
 */
export function trackUsedTypes(content: string, usedTypes: Set<string>): void {
  // Track type references in generics, parameters, and return types
  const typePattern = /(?:typeof\s+)?([A-Z]\w*(?:<[^>]+>)?)|extends\s+([A-Z]\w*(?:<[^>]+>)?)/g
  let match: any

  // eslint-disable-next-line no-cond-assign
  while ((match = typePattern.exec(content)) !== null) {
    const type = match[1] || match[2]
    if (type) {
      // Extract base type and any nested generic types
      const [baseType, ...genericParams] = type.split(/[<>]/)
      if (baseType && /^[A-Z]/.test(baseType))
        usedTypes.add(baseType)

      // Process generic parameters
      if (genericParams.length > 0) {
        genericParams.forEach((param: any) => {
          const nestedTypes = param.split(/[,\s]/)
          nestedTypes.forEach((t: any) => {
            if (/^[A-Z]/.test(t))
              usedTypes.add(t)
          })
        })
      }
    }
  }
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

  // Track brackets for multi-line declarations
  const bracketMatch = line.match(/[[{(]/g)
  const closeBracketMatch = line.match(/[\]})]/g)
  const openCount = bracketMatch ? bracketMatch.length : 0
  const closeCount = closeBracketMatch ? closeBracketMatch.length : 0
  state.bracketCount += openCount - closeCount

  state.isMultiLineDeclaration = state.bracketCount > 0

  if (!state.isMultiLineDeclaration) {
    if (state.lastCommentBlock) {
      state.dtsLines.push(state.lastCommentBlock.trimEnd())
      state.lastCommentBlock = ''
    }

    // Process and format the declaration
    const processed = processDeclaration(state.currentDeclaration.trim(), state)
    if (processed) {
      state.dtsLines.push(processed)
    }

    state.currentDeclaration = ''
    state.bracketCount = 0
  }
}

/**
 * Represents the current state of function parsing
 */
export interface FunctionParseState {
  genericParams: string
  functionName: string
  parameters: string
  returnType: string
  isAsync: boolean
}

/**
 * Format the final output
 */
export function formatOutput(state: ProcessingState): string {
  // Generate optimized imports
  const imports = generateImports(state)

  // Process declarations with proper grouping and spacing
  const { regularDeclarations, starExports } = categorizeDeclarations(state.dtsLines)

  // Build sections with careful spacing
  const sections: string[] = []

  // Add imports with proper spacing after
  if (imports.length > 0) {
    sections.push(`${imports.join('\n')}\n`)
  }

  // Add regular declarations with proper spacing between them
  if (regularDeclarations.length > 0) {
    sections.push(regularDeclarations.join('\n\n'))
  }

  // Add export * declarations grouped together
  if (starExports.length > 0) {
    sections.push(starExports.join('\n'))
  }

  // Combine sections
  let result = sections
    .filter(Boolean)
    .join('\n\n')
    .trim()

  // Handle default export
  if (state.defaultExport) {
    const exportIdentifier = state.defaultExport
      .replace(/^export\s+default\s+/, '')
      .replace(/export\s+default\s+/, '')
      .replace(/;+$/, '')
      .trim()

    // Ensure blank line before default export if there's content before it
    result = result.replace(/\n*$/, '\n\n')
    result += `export default ${exportIdentifier};`
  }

  // Ensure final newline
  result += '\n'

  return fixDtsOutput(result)
}

/**
 * Categorize declarations into different types
 */
function categorizeDeclarations(declarations: string[]): {
  regularDeclarations: string[]
  starExports: string[]
} {
  const regularDeclarations: string[] = []
  const starExports: string[] = []
  let currentComment = ''

  declarations.forEach((declaration) => {
    const trimmed = declaration.trim()

    if (trimmed.startsWith('/**') || trimmed.startsWith('*')) {
      currentComment = currentComment ? `${currentComment}\n${declaration}` : declaration
      return
    }

    if (trimmed.startsWith('export *')) {
      starExports.push(ensureSemicolon(trimmed))
    }
    else if (trimmed) {
      const formattedDeclaration = formatSingleDeclaration(
        currentComment ? `${currentComment}\n${declaration}` : declaration,
      )
      regularDeclarations.push(formattedDeclaration)
    }

    currentComment = ''
  })

  return { regularDeclarations, starExports }
}

/**
 * Format a single declaration with proper spacing and fixes
 */
function formatSingleDeclaration(declaration: string): string {
  if (!declaration.trim())
    return ''

  let formatted = declaration

  // Fix 'export declare type' statements
  if (formatted.includes('export declare type {')) {
    formatted = formatted.replace('export declare type', 'export type')
  }

  // Remove async from ambient declarations
  if (formatted.includes('declare') && formatted.includes('async')) {
    formatted = formatted
      .replace(/declare\s+async\s+/, 'declare ')
      .replace(/export\s+declare\s+async\s+/, 'export declare ')
  }

  // Only add semicolon if it's needed and not after an opening brace
  if (!formatted.endsWith(';') && !formatted.endsWith('{') && shouldAddSemicolon(formatted)) {
    formatted = `${formatted.trimEnd()};`
  }

  return formatted
}

/**
 * Determine if a semicolon should be added to the declaration
 */
function shouldAddSemicolon(declaration: string): boolean {
  const trimmed = declaration.trim()

  // Skip comments and formatting-only lines
  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
    return false
  }

  // Skip interface/type declarations ending with opening or closing braces
  if (trimmed.endsWith('{') || trimmed.endsWith('}')) {
    return false
  }

  // Skip declarations that already have semicolons
  if (trimmed.endsWith(';')) {
    return false
  }

  return true
}

/**
 * Ensure declaration ends with semicolon
 */
function ensureSemicolon(declaration: string): string {
  return declaration.trim()
    .replace(/;+$/, '') // Remove any existing semicolons first
    .replace(/\{\s*$/, '{') // Remove any spaces after opening brace
    + (declaration.trim().endsWith('{') ? '' : ';') // Add semicolon only if not ending with brace
}

/**
 * Apply final fixes to the complete DTS output
 */
function fixDtsOutput(content: string): string {
  return content
    // First ensure all line endings are consistent
    .replace(/\r\n/g, '\n')
    // Remove semicolons after opening braces
    .replace(/\{\s*;/g, '{')
    // Fix any duplicate semicolons
    .replace(/;+/g, ';')
    // Normalize empty lines (no more than 2 consecutive newlines)
    .replace(/\n{3,}/g, '\n\n')
    // Add semicolons to declarations if missing (but not after opening braces)
    .replace(/^(export (?!.*\{$)[^*{}\n].*[^;\n])$/gm, '$1;')
    // Ensure proper spacing for export * declarations (without duplicate semicolons)
    .replace(/^(export \* from [^;\n]+);*$/gm, '$1;')
    // Fix export statements with duplicated semicolons
    .replace(/^(export \{[^}]+\} from [^;\n]+);*$/gm, '$1;')
    // Remove any trailing whitespace
    .replace(/[ \t]+$/gm, '')
    // Ensure single newline at the end
    .replace(/\n*$/, '\n')
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

/**
 * Utility function to format type parameters
 */
export function formatTypeParameters(params: string): string {
  return params
    .split(',')
    .map((param) => {
      const [name, constraint] = param.split('extends').map(p => p.trim())
      return constraint ? `${name} extends ${constraint}` : name
    })
    .join(', ')
}
