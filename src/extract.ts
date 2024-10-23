// ===========================
// Type Definitions
// ===========================

/**
 * Regular expression patterns used throughout the module
 */
export interface RegexPatterns {
  /** Import type declarations */
  readonly typeImport: RegExp
  /** Regular import declarations */
  readonly regularImport: RegExp
  /** Opening brackets and braces */
  readonly bracketOpen: RegExp
  /** Closing brackets and braces */
  readonly bracketClose: RegExp
  /** Function return statements */
  readonly functionReturn: RegExp
  /** Type annotation patterns */
  readonly typeAnnotation: RegExp
  /** Async function declarations */
  readonly asyncFunction: RegExp
  /** Generic type parameters */
  readonly genericParams: RegExp
  /** Function parameter block */
  readonly functionParams: RegExp
  /** Return type declaration */
  readonly functionReturnType: RegExp
  /** Destructured parameters */
  readonly destructuredParams: RegExp
  /** Type pattern matching */
  readonly typePattern: RegExp
  /** Value reference pattern */
  readonly valueReference: RegExp
  /** Type reference pattern */
  readonly typeReference: RegExp
  /** Function name extraction */
  readonly functionName: RegExp
  /** Export statement cleanup */
  readonly exportCleanup: RegExp
  /** Default export */
  readonly defaultExport: RegExp
}

/**
 * Regular expression patterns used throughout the module
 * @remarks These patterns are optimized for performance and reliability
 */
export const REGEX: RegexPatterns = {
  // Import patterns
  typeImport: /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/,
  regularImport: /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/,

  // Type and return patterns
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  typeAnnotation: /:\s*(\{[^=]+\}|\[[^\]]+\]|[^=]+?)\s*=/,

  // Bracket matching
  bracketOpen: /[[{]/g,
  bracketClose: /[\]}]/g,

  // Function patterns
  functionReturn: /return\s+([^;]+)/,
  asyncFunction: /^(?:export\s+)?async\s+function/,
  genericParams: /^([a-z_$][\w$]*)\s*(<[^(]+>)/i,
  functionParams: /\(([\s\S]*?)\)(?=\s*:)/,
  // eslint-disable-next-line regexp/no-super-linear-backtracking
  functionReturnType: /\)\s*:\s*([\s\S]+?)(?=\{|$)/,
  functionName: /^([^(<\s]+)/,

  // Parameter patterns
  destructuredParams: /\{([^}]+)\}:\s*([^,)]+)/g,

  // Type reference patterns
  typePattern: /(?:typeof\s+)?([A-Z]\w*(?:<[^>]+>)?)|extends\s+([A-Z]\w*(?:<[^>]+>)?)/g,
  valueReference: /\b([a-z_$][\w$]*)\s*(?:[(,;})\s]|$)/gi,
  typeReference: /\b([A-Z][\w$]*)\b/g,

  // Export patterns
  exportCleanup: /^export\s+default\s+/,
  defaultExport: /export\s+default\s+/,
} as const satisfies RegexPatterns

/**
 * Represents property type information with support for nested structures
 */
export interface PropertyInfo {
  /** Property identifier */
  key: string
  /** Original source value */
  value: string
  /** Inferred TypeScript type */
  type: string
  /** Nested property definitions */
  nested?: PropertyInfo[]
}

/**
 * Central state management for DTS processing
 * Tracks all aspects of the declaration file generation process
 */
export interface ProcessingState {
  /** Generated declaration lines */
  dtsLines: string[]
  /** Import statements */
  imports: string[]
  /** Set of types used in declarations */
  usedTypes: Set<string>
  /** Map of type names to their source modules */
  typeSources: Map<string, string>
  /** Default export declaration */
  defaultExport: string
  /** Current declaration being processed */
  currentDeclaration: string
  /** Last processed JSDoc comment block */
  lastCommentBlock: string
  /** Bracket nesting level counter */
  bracketCount: number
  /** Flag for multi-line declarations */
  isMultiLineDeclaration: boolean
  /** Map of module imports with metadata */
  moduleImports: Map<string, ImportInfo>
  /** Map of available type names */
  availableTypes: Map<string, string>
  /** Map of available value names */
  availableValues: Map<string, string>
}

/**
 * Import statement metadata and tracking
 */
export interface ImportInfo {
  /** Import kind: type, value, or mixed */
  kind: 'type' | 'value' | 'mixed'
  /** Set of used type imports */
  usedTypes: Set<string>
  /** Set of used value imports */
  usedValues: Set<string>
  /** Source module path */
  source: string
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
 * Function signature components
 */
export interface FunctionSignature {
  name: string
  params: string
  returnType: string
  isAsync: boolean
  generics: string
}

/**
 * Function parsing state
 */
export interface FunctionParseState {
  genericParams: string
  functionName: string
  parameters: string
  returnType: string
  isAsync: boolean
}

/**
 * Type annotation extraction result
 */
interface TypeAnnotation {
  raw: string | null
  parsed: string
}

// ===========================
// Core Functions
// ===========================

/**
 * Creates initial processing state with empty collections
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

/**
 * Extracts type annotation from a declaration
 */
function getTypeAnnotation(declaration: string): TypeAnnotation {
  const match = declaration.match(REGEX.typeAnnotation)
  return {
    raw: match?.[1]?.trim() ?? null,
    parsed: match?.[1]?.trim() ?? 'any',
  }
}

/**
 * Extracts types from a TypeScript file and generates corresponding .d.ts content
 * @param filePath - Path to source TypeScript file
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
 * Processes TypeScript source code and generates declaration types
 * @param sourceCode - TypeScript source code
 */
export function extractDtsTypes(sourceCode: string): string {
  const state = createProcessingState()
  const lines = sourceCode.split('\n')

  for (const line of lines) {
    processLine(line, state)
  }

  return formatOutput(state)
}

/**
 * Main line processing function
 * Handles different types of content and maintains state
 */
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

/**
 * Process import statements and tracks dependencies
 */
export function processImport(line: string, state: ProcessingState): string {
  const typeImportMatch = line.match(REGEX.typeImport)
  const valueImportMatch = line.match(REGEX.regularImport)

  if (typeImportMatch || valueImportMatch) {
    const match = typeImportMatch || valueImportMatch
    const isTypeImport = Boolean(typeImportMatch)
    const [, items, source] = match!

    if (!state.moduleImports.has(source)) {
      state.moduleImports.set(source, {
        kind: isTypeImport ? 'type' : 'value',
        usedTypes: new Set(),
        usedValues: new Set(),
        source,
      })
    }

    const moduleInfo = state.moduleImports.get(source)!

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

        if (state.currentDeclaration?.includes(importedName)) {
          moduleInfo.usedValues.add(importedName)
        }
      }
    })
  }

  return line
}

/**
 * Generate optimized import statements
 */
export function generateImports(state: ProcessingState): string[] {
  const processContent = (content: string) => {
    let match: any
    // eslint-disable-next-line no-cond-assign
    while ((match = REGEX.valueReference.exec(content)) !== null) {
      const [, value] = match
      if (state.availableValues.has(value)) {
        const source = state.availableValues.get(value)!
        state.moduleImports.get(source)!.usedValues.add(value)
      }
    }

    const typeMatches = content.matchAll(REGEX.typeReference)
    for (const [, type] of typeMatches) {
      if (state.availableTypes.has(type)) {
        const source = state.availableTypes.get(type)!
        state.moduleImports.get(source)!.usedTypes.add(type)
      }
    }
  }

  state.dtsLines.forEach(processContent)
  if (state.currentDeclaration) {
    processContent(state.currentDeclaration)
  }

  const imports: string[] = []

  for (const [source, info] of state.moduleImports) {
    const { usedTypes, usedValues } = info

    if (usedTypes.size === 0 && usedValues.size === 0)
      continue

    if (usedTypes.size > 0) {
      const types = Array.from(usedTypes).sort()
      imports.push(`import type { ${types.join(', ')} } from '${source}';`)
    }

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

  for (const line of imports) {
    const typeImportMatch = line.match(REGEX.typeImport)
    const regularImportMatch = line.match(REGEX.regularImport)
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
 * Process declarations with type inference
 */
export function processDeclaration(declaration: string, state: ProcessingState): string {
  const trimmed = declaration.trim()

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
    return trimmed
  }

  if (trimmed.startsWith('export type')) {
    return processTypeDeclaration(trimmed)
  }

  if (trimmed.startsWith('type')) {
    return processTypeDeclaration(trimmed, false)
  }

  if (trimmed.startsWith('export function') || trimmed.startsWith('export async function')) {
    const processed = trimmed.replace(/\basync\s+/, '')
    return processFunctionDeclaration(processed, state.usedTypes)
  }

  if (trimmed.startsWith('function') || trimmed.startsWith('async function')) {
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
 * Process constant declarations with type inference
 */
function processConstDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const name = firstLine.split('const')[1].split('=')[0].trim().split(':')[0].trim()
  const typeAnnotation = getTypeAnnotation(firstLine)

  if (typeAnnotation.raw) {
    return `${isExported ? 'export ' : ''}declare const ${name}: ${typeAnnotation.raw};`
  }

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
 * Extract and process object properties
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
 * Process comment lines with proper indentation handling
 * @param line - Comment line to process
 * @param state - Current processing state
 */
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

/**
 * Process a complete property with nested content
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

  if (valueContent.startsWith('[')) {
    return {
      key,
      value: valueContent,
      type: inferArrayType(valueContent).replace(/'+$/, ''),
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
 * Extract nested content between delimiters
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
 * Determine if a value represents a function
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
 * Determines if a line is a comment
 * @param line - Source code line to check
 * @returns True if the line is a comment
 */
export function isCommentLine(line: string): boolean {
  return line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')
}

/**
 * Checks if a line contains a TypeScript declaration
 * Covers exports, constants, interfaces, types, and functions
 * @param line - Source code line to check
 * @returns True if the line contains a declaration
 */
export function isDeclarationLine(line: string): boolean {
  return line.startsWith('export')
    || line.startsWith('const')
    || line.startsWith('interface')
    || line.startsWith('type')
    || line.startsWith('function')
}

/**
 * Infer array type from array literal with support for nested arrays
 */
function inferArrayType(value: string): string {
  const content = extractNestedContent(value, '[', ']')
  if (!content)
    return 'never[]'

  const elements = splitArrayElements(content)
  if (elements.length === 0)
    return 'never[]'

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

  const elementTypes = elements.map(element => inferElementType(element.trim()))
  const uniqueTypes = [...new Set(elementTypes)]
  return `Array<${uniqueTypes.join(' | ')}>`
}

/**
 * Infer element type with improved type detection
 */
export function inferElementType(element: string): string {
  const trimmed = element.trim()

  if (trimmed.startsWith('\'') || trimmed.startsWith('"')) {
    const cleanValue = trimmed.slice(1, -1).replace(/'+$/, '')
    return `'${cleanValue}'`
  }

  if (!Number.isNaN(Number(trimmed))) {
    return trimmed
  }

  if (trimmed.startsWith('{')) {
    return formatObjectType(parseObjectLiteral(trimmed))
  }

  if (trimmed === 'console.log' || trimmed.endsWith('.log')) {
    return '((...args: any[]) => void)'
  }

  if (trimmed.includes('=>')) {
    return '((...args: any[]) => void)'
  }

  if (trimmed.endsWith('()')) {
    return 'unknown'
  }

  if (trimmed.includes('.')) {
    return 'unknown'
  }

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

    if (trimmed.startsWith('[')) {
      const nestedContent = extractNestedContent(trimmed, '[', ']')
      if (nestedContent) {
        const nestedElements = splitArrayElements(nestedContent)
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
 * Infer function type with return type analysis
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

/**
 * Infer return type from return statement
 */
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
 * Split array elements while preserving nested structures
 */
function splitArrayElements(content: string): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]

    if ((char === '"' || char === '\'') && (i === 0 || content[i - 1] !== '\\')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '[' || char === '{')
        depth++
      else if (char === ']' || char === '}')
        depth--
    }

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
export function extractFunctionSignature(declaration: string): FunctionSignature {
  const isAsync = REGEX.asyncFunction.test(declaration)

  const cleanDeclaration = declaration
    .replace(/^export\s+/, '')
    .replace(/^async\s+/, '')
    .replace(/^function\s+/, '')
    .trim()

  const genericsMatch = cleanDeclaration.match(REGEX.genericParams)

  let generics = ''
  let nameFromGenerics = ''
  if (genericsMatch) {
    nameFromGenerics = genericsMatch[1]
    generics = genericsMatch[2]
  }

  const withoutGenerics = cleanDeclaration.replace(REGEX.genericParams, nameFromGenerics)
  const name = nameFromGenerics || withoutGenerics.match(REGEX.functionName)?.[1] || ''

  const paramsMatch = withoutGenerics.match(REGEX.functionParams)
  let params = paramsMatch ? paramsMatch[1].trim() : ''

  params = cleanParameters(params)

  // Extract return type
  const returnTypeMatch = withoutGenerics.match(REGEX.functionReturnType)
  let returnType = returnTypeMatch ? returnTypeMatch[1].trim() : 'void'

  returnType = normalizeType(returnType)

  return {
    name,
    params,
    returnType,
    isAsync,
    generics,
  }
}

/**
 * Process function declarations
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

  trackUsedTypes(`${generics} ${params} ${returnType}`, usedTypes)

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

  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([<>(),;:])/g, '$1')
    .replace(/([<>(),;:])\s+/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Clean and normalize parameters
 */
export function cleanParameters(params: string): string {
  if (!params.trim())
    return ''

  return params
    .replace(REGEX.destructuredParams, (_, props, type) => {
      const typeName = normalizeType(type.trim())
      return `options: ${typeName}`
    })
    .replace(/\s*([,:])\s*/g, '$1 ')
    .replace(/,(\S)/g, ', $1')
    .replace(/\s*\?\s*:/g, '?: ')
    .replace(/\s*([<[\]>])\s*/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Normalize type references
 */
function normalizeType(type: string): string {
  return type
    .replace(/\s+/g, ' ')
    .replace(/\s*([<>])\s*/g, '$1')
    .replace(/\s*,\s*/g, ', ')
    .trim()
}

/**
 * Track used types in declarations
 */
export function trackUsedTypes(content: string, usedTypes: Set<string>): void {
  let match: any
  // eslint-disable-next-line no-cond-assign
  while ((match = REGEX.typePattern.exec(content)) !== null) {
    const type = match[1] || match[2]
    if (type) {
      const [baseType, ...genericParams] = type.split(/[<>]/)
      if (baseType && /^[A-Z]/.test(baseType))
        usedTypes.add(baseType)

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

/**
 * Process simple value types
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
 * Format object type from properties
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
 * Format type parameters with constraints
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

/**
 * Process declarations with improved structure
 */
export function processDeclarationLine(line: string, state: ProcessingState): void {
  state.currentDeclaration += `${line}\n`

  const bracketMatch = line.match(REGEX.bracketOpen)
  const closeBracketMatch = line.match(REGEX.bracketClose)
  const openCount = bracketMatch ? bracketMatch.length : 0
  const closeCount = closeBracketMatch ? closeBracketMatch.length : 0
  state.bracketCount += openCount - closeCount

  state.isMultiLineDeclaration = state.bracketCount > 0

  if (!state.isMultiLineDeclaration) {
    if (state.lastCommentBlock) {
      state.dtsLines.push(state.lastCommentBlock.trimEnd())
      state.lastCommentBlock = ''
    }

    const processed = processDeclaration(state.currentDeclaration.trim(), state)
    if (processed) {
      state.dtsLines.push(processed)
    }

    state.currentDeclaration = ''
    state.bracketCount = 0
  }
}

/**
 * Format the final output with proper spacing and organization
 */
export function formatOutput(state: ProcessingState): string {
  const imports = generateImports(state)
  const { regularDeclarations, starExports } = categorizeDeclarations(state.dtsLines)
  const sections: string[] = []

  if (imports.length > 0) {
    sections.push(`${imports.join('\n')}\n`)
  }

  if (regularDeclarations.length > 0) {
    sections.push(regularDeclarations.join('\n\n'))
  }

  if (starExports.length > 0) {
    sections.push(starExports.join('\n'))
  }

  let result = sections
    .filter(Boolean)
    .join('\n\n')
    .trim()

  if (state.defaultExport) {
    const exportIdentifier = state.defaultExport
      .replace(REGEX.exportCleanup, '')
      .replace(REGEX.defaultExport, '')
      .replace(/;+$/, '')
      .trim()

    result = result.replace(/\n*$/, '\n\n')
    result += `export default ${exportIdentifier};`
  }

  result += '\n'

  return fixDtsOutput(result)
}

/**
 * Categorize declarations by type
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
 * Format individual declarations
 */
function formatSingleDeclaration(declaration: string): string {
  if (!declaration.trim())
    return ''

  let formatted = declaration

  if (formatted.includes('export declare type {')) {
    formatted = formatted.replace('export declare type', 'export type')
  }

  if (formatted.includes('declare') && formatted.includes('async')) {
    formatted = formatted
      .replace(/declare\s+async\s+/, 'declare ')
      .replace(/export\s+declare\s+async\s+/, 'export declare ')
  }

  if (!formatted.endsWith(';') && !formatted.endsWith('{') && shouldAddSemicolon(formatted)) {
    formatted = `${formatted.trimEnd()};`
  }

  return formatted
}

/**
 * Check if semicolon should be added
 */
function shouldAddSemicolon(declaration: string): boolean {
  const trimmed = declaration.trim()

  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
    return false
  }

  if (trimmed.endsWith('{') || trimmed.endsWith('}')) {
    return false
  }

  if (trimmed.endsWith(';')) {
    return false
  }

  return true
}

/**
 * Ensure proper semicolon placement
 */
function ensureSemicolon(declaration: string): string {
  return declaration.trim()
    .replace(/;+$/, '')
    .replace(/\{\s*$/, '{')
    + (declaration.trim().endsWith('{') ? '' : ';')
}

/**
 * Final output formatting and cleanup
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
    .replace(/^(export \* from [^;\n]+);*$/gm, '$1;')
    // Fix export statements with duplicated semicolons
    .replace(/^(export \{[^}]+\} from [^;\n]+);*$/gm, '$1;')
    // Remove any trailing whitespace
    .replace(/[ \t]+$/gm, '')
    // Ensure single newline at the end
    .replace(/\n*$/, '\n')
}
