/* eslint-disable no-console,regexp/no-super-linear-backtracking */

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
  /** Named export */
  readonly complexType: RegExp
  /** Union and intersection types */
  readonly unionIntersection: RegExp
  /** Conditional types */
  readonly mappedType: RegExp
  /** Conditional types */
  readonly conditionalType: RegExp
  /** Generic constraints */
  readonly genericConstraints: RegExp
  /** Function overload */
  readonly functionOverload: RegExp
}

interface ImportTrackingState {
  typeImports: Map<string, Set<string>> // module -> Set of type names
  valueImports: Map<string, Set<string>> // module -> Set of value names
  usedTypes: Set<string> // All used type names
  usedValues: Set<string> // All used value names
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
  typeAnnotation: /:\s*(\{[^=]+\}|\[[^\]]+\]|[^=]+?)\s*=/,

  // Bracket matching
  bracketOpen: /[[{]/g,
  bracketClose: /[\]}]/g,

  // Function patterns
  functionReturn: /return\s+([^;]+)/,
  asyncFunction: /^(?:export\s+)?async\s+function/,
  genericParams: /^([a-z_$][\w$]*)\s*(<[^(]+>)/i,
  functionParams: /\(([\s\S]*?)\)(?=\s*:)/,
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

  // New patterns for complex types
  complexType: /type\s+([^=<]+)(?:<[^>]+>)?\s*=\s*([^;]+)/,
  unionIntersection: /([^|&]+)(?:\s*[|&]\s*([^|&]+))+/,
  mappedType: /\{\s*\[\s*([^\]]+)in\s*([^\]]+)\]:/,
  conditionalType: /([^extnds]+)\s+extends\s+([^?]+)\?\s*([^:]+):\s*([^;]+)/,
  genericConstraints: /<([^>]+)>/,
  functionOverload: /^(?:export\s+)?(?:declare\s+)?function\s+([^(<\s]+)/,
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
interface ProcessingState {
  dtsLines: string[]
  imports: string[]
  usedTypes: Set<string>
  typeSources: Map<string, string>
  defaultExport: string | null
  exportAllStatements: string[]
  currentDeclaration: string
  lastCommentBlock: string
  bracketCount: number
  isMultiLineDeclaration: boolean
  moduleImports: Map<string, ImportInfo>
  availableTypes: Map<string, string>
  availableValues: Map<string, string>
  currentIndentation: string
  declarationBuffer: {
    type: 'interface' | 'type' | 'const' | 'function' | 'import' | 'export'
    indent: string
    lines: string[]
    comments: string[]
  } | null
  importTracking: ImportTrackingState
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
  // isAsync: boolean
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
    defaultExport: null,
    exportAllStatements: [],
    currentDeclaration: '',
    lastCommentBlock: '',
    bracketCount: 0,
    isMultiLineDeclaration: false,
    moduleImports: new Map(),
    availableTypes: new Map(),
    availableValues: new Map(),
    currentIndentation: '',
    declarationBuffer: null,
    importTracking: createImportTrackingState(),
  }
}

/**
 * Creates initial import tracking state
 */
function createImportTrackingState(): ImportTrackingState {
  return {
    typeImports: new Map(),
    valueImports: new Map(),
    usedTypes: new Set(),
    usedValues: new Set(),
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

  // Process imports first
  sourceCode.split('\n').forEach((line) => {
    if (line.includes('import ')) {
      processImports(line, state.importTracking)
    }
  })

  // Process declarations
  processSourceFile(sourceCode, state)

  // Final pass to track what actually made it to the output
  state.dtsLines.forEach((line) => {
    if (line.trim() && !line.startsWith('import')) {
      trackTypeUsage(line, state.importTracking)
      trackValueUsage(line, state.importTracking, state.dtsLines)
    }
  })

  // Generate optimized imports based on actual output
  const optimizedImports = generateOptimizedImports(state.importTracking, state.dtsLines)

  // Replace existing imports with optimized ones
  state.dtsLines = [
    ...optimizedImports,
    '', // Add blank line after imports
    ...state.dtsLines.filter(line => !line.trim().startsWith('import')),
  ]

  return formatOutput(state)
}

/**
 * Extracts a substring that contains balanced opening and closing symbols, handling nested structures.
 * @param text - The text to extract from.
 * @param openSymbol - The opening symbol (e.g., '<', '(', '{').
 * @param closeSymbol - The closing symbol (e.g., '>', ')', '}').
 * @returns An object containing the content and the rest of the string.
 */
function extractBalancedSymbols(text: string, openSymbol: string, closeSymbol: string): { content: string, rest: string } | null {
  if (!text.startsWith(openSymbol)) {
    return null
  }

  const stack: string[] = []
  let inString = false
  let stringChar = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const prevChar = text[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === openSymbol) {
        stack.push(char)
      }
      else if (char === closeSymbol) {
        if (stack.length === 0) {
          // Unbalanced closing symbol
          return null
        }
        stack.pop()
        if (stack.length === 0) {
          // All symbols balanced, return substring
          return {
            content: text.slice(0, i + 1),
            rest: text.slice(i + 1).trim(),
          }
        }
      }
    }
  }

  return null // Unbalanced symbols
}

function extractFunctionName(declaration: string): { name: string, rest: string } {
  const match = declaration.match(/^([a-z_$][\w$]*)/i)
  if (match) {
    const name = match[1]
    const rest = declaration.slice(match[0].length).trim()
    return { name, rest }
  }
  else {
    return { name: '', rest: declaration }
  }
}

/**
 * Main line processing function
 * Handles different types of content and maintains state
 */
export function processLine(line: string, state: ProcessingState): void {
  const indent = getIndentation(line)
  state.currentIndentation = indent

  const trimmedLine = line.trim()
  if (!trimmedLine)
    return

  console.log('Processing line:', trimmedLine)

  if (isCommentLine(trimmedLine)) {
    processCommentLine(trimmedLine, state)
    return
  }

  if (/^import\b/.test(trimmedLine)) {
    const importLine = processImport(line)
    // const importLine = processImport(line, state)
    state.imports.push(importLine)
    console.log('Collected import:', importLine)
    return
  }

  if (trimmedLine.startsWith('export default')) {
    state.defaultExport = trimmedLine.endsWith(';') ? trimmedLine : `${trimmedLine};`
    console.log('Collected default export:', state.defaultExport)
    return
  }

  if (
    trimmedLine.startsWith('export *')
    || trimmedLine.startsWith('export {')
    || trimmedLine.startsWith('export type {')
  ) {
    const exportStatement = trimmedLine.endsWith(';') ? trimmedLine : `${trimmedLine};`
    state.exportAllStatements.push(exportStatement)
    console.log('Collected export statement:', exportStatement)
    return
  }

  if (isDeclarationLine(trimmedLine) || state.isMultiLineDeclaration) {
    processDeclarationLine(trimmedLine, state)
    return
  }

  console.log('Unprocessed line:', trimmedLine)
}

function processValue(value: string): { type: string, nested?: PropertyInfo[] } {
  const trimmed = value.trim()

  if (trimmed.startsWith('{')) {
    const nestedProperties = extractObjectProperties(trimmed)
    return {
      type: `{ ${nestedProperties.map(p => `${p.key}: ${p.type}`).join('; ')} }`,
      nested: nestedProperties,
    }
  }

  if (trimmed.startsWith('[')) {
    const elementTypes = inferArrayType(trimmed)
    return { type: elementTypes }
  }

  if (trimmed.startsWith('(') || trimmed.startsWith('function') || trimmed.includes('=>')) {
    return { type: '(...args: any[]) => unknown' }
  }

  // Handle literals and primitive types
  if (/^['"`]/.test(trimmed)) {
    return { type: trimmed }
  }

  if (!Number.isNaN(Number(trimmed))) {
    return { type: trimmed }
  }

  if (trimmed === 'true' || trimmed === 'false') {
    return { type: trimmed }
  }

  // For identifiers or expressions, return 'unknown' or function type
  if (/^[a-z_$][\w$]*$/i.test(trimmed)) {
    // Could be a function or variable
    return { type: 'unknown' }
  }

  return { type: 'unknown' }
}

/**
 * Process import statements and tracks dependencies
 */
export function processImport(line: string): string {
  return line.trim().endsWith(';') ? line.trim() : `${line.trim()};`
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
 * Generate optimized imports based on usage
 */
export function generateOptimizedImports(state: ImportTrackingState, dtsLines: string[]): string[] {
  const imports: string[] = []

  // Generate type imports
  for (const [module, types] of state.typeImports) {
    const usedTypes = Array.from(types)
      .filter(t => state.usedTypes.has(t))
      .sort()

    if (usedTypes.length > 0) {
      imports.push(`import type { ${usedTypes.join(', ')} } from '${module}'`)
    }
  }

  // Generate value imports
  for (const [module, values] of state.valueImports) {
    const usedValues = Array.from(values)
      .filter(v => state.usedValues.has(v))
      // Only include values that appear in actual declarations
      .filter(v => dtsLines.some(line =>
        line.includes(`declare ${v}`)
        || line.includes(`export declare ${v}`)
        || line.includes(`export { ${v}`)
        || line.includes(`, ${v}`)
        || line.includes(`${v} }`),
      ))
      .sort()

    if (usedValues.length > 0) {
      imports.push(`import { ${usedValues.join(', ')} } from '${module}'`)
    }
  }

  return imports.sort()
}

/**
 * Process imports and track their usage
 */
export function processImports(line: string, state: ImportTrackingState): void {
  // Handle type imports
  const typeImportMatch = line.match(/import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  if (typeImportMatch) {
    const [, names, module] = typeImportMatch
    if (!state.typeImports.has(module)) {
      state.typeImports.set(module, new Set())
    }
    names.split(',').forEach((name) => {
      const cleanName = name.trim().split(/\s+as\s+/).shift()! // Use shift() to get original name before 'as'
      state.typeImports.get(module)!.add(cleanName)
    })
    return
  }

  // Handle value imports
  const valueImportMatch = line.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  if (valueImportMatch) {
    const [, names, module] = valueImportMatch
    if (!state.valueImports.has(module)) {
      state.valueImports.set(module, new Set())
    }
    names.split(',').forEach((name) => {
      const cleanName = name.trim().split(/\s+as\s+/).shift()! // Use shift() to get original name before 'as'
      state.valueImports.get(module)!.add(cleanName)
    })
  }
}

export function processDeclarationBuffer(
  buffer: NonNullable<ProcessingState['declarationBuffer']>,
  state: ProcessingState,
  isExported: boolean,
): string {
  const content = buffer.lines.join('\n')

  // Skip processing for export * statements
  if (content.trim().startsWith('export *')) {
    return content
  }

  // Skip processing for export type {} statements
  if (content.trim().startsWith('export type {')) {
    return content
  }

  // Process regular declarations
  const cleaned = cleanDeclaration(content)
  switch (buffer.type) {
    case 'interface':
      return processInterfaceDeclaration(cleaned, isExported)
    case 'type':
      return processTypeDeclaration(cleaned, isExported)
    case 'const':
      return processConstDeclaration(cleaned, isExported)
    case 'function':
      return processFunctionDeclaration(cleaned, state.usedTypes, isExported)
    default:
      return content
  }
}

export function processDeclarationBlock(
  lines: string[],
  comments: string[],
  state: ProcessingState,
): void {
  // Remove any non-JSDoc comments that might have slipped through
  const cleanedLines = lines.map((line) => {
    const commentIndex = line.indexOf('//')
    return commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line
  }).filter(Boolean)

  const declaration = cleanedLines.join('\n').trim()

  if (!declaration) {
    return
  }

  // Only include JSDoc comments
  const jsdocComments = comments.filter(isJSDocComment)
  if (jsdocComments.length > 0) {
    state.dtsLines.push(...jsdocComments)
  }

  // Remove leading comments and whitespace from the declaration when checking its type
  const declarationWithoutComments = removeLeadingComments(declaration).trimStart()

  // Ignore lines that are just closing braces
  if (declarationWithoutComments === '}') {
    return
  }

  if (declarationWithoutComments.startsWith('import')) {
    // Imports are handled separately in the first pass
    return
  }

  if (
    declarationWithoutComments.startsWith('export default')
  ) {
    // Handle export default statements
    state.defaultExport = declarationWithoutComments.endsWith(';')
      ? declarationWithoutComments
      : `${declarationWithoutComments};`
    return
  }

  if (
    declarationWithoutComments.startsWith('export const')
    || declarationWithoutComments.startsWith('const')
  ) {
    const isExported = declarationWithoutComments.trimStart().startsWith('export')
    const processed = processConstDeclaration(
      declaration,
      isExported,
    )
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('interface')
    || declarationWithoutComments.startsWith('export interface')
  ) {
    const processed = processInterfaceDeclaration(
      declaration,
      declarationWithoutComments.startsWith('export'),
    )
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('type')
    || declarationWithoutComments.startsWith('export type')
  ) {
    const processed = processTypeDeclaration(
      declaration,
      declarationWithoutComments.startsWith('export'),
    )
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('function')
    || declarationWithoutComments.startsWith('export function')
    || declarationWithoutComments.startsWith('async function')
    || declarationWithoutComments.startsWith('export async function')
  ) {
    const processed = processFunctionDeclaration(
      declaration,
      state.usedTypes,
      declarationWithoutComments.startsWith('export'),
    )
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('export {')
    || declarationWithoutComments.startsWith('export *')
  ) {
    state.dtsLines.push(declaration)
    return
  }

  // If we reach here, it's an unhandled declaration type.
  // We can choose to skip it, or log a warning.

  console.warn('Unhandled declaration type:', declarationWithoutComments.split('\n')[0])
}

/**
 * Process constant declarations with type inference
 */
function processConstDeclaration(declaration: string, isExported = true): string {
  console.log('Processing const declaration:', { declaration })
  const cleanDeclaration = cleanComments(declaration)
  const firstLineEndIndex = cleanDeclaration.indexOf('\n')
  const firstLine = cleanDeclaration.slice(0, firstLineEndIndex !== -1 ? firstLineEndIndex : undefined)

  // Adjusted regex to handle 'export const'
  const typeMatch = firstLine.match(/^\s*(?:export\s+)?const\s+([^:]+):\s*([^=]+)\s*=/)
  if (typeMatch) {
    const [, name, type] = typeMatch
    return `${isExported ? 'export ' : ''}declare const ${name.trim()}: ${type.trim()};`
  }

  // Adjusted regex to handle 'export const' without type annotation
  const nameMatch = firstLine.match(/^\s*(?:export\s+)?const\s+([^=\s]+)\s*=/)
  if (!nameMatch) {
    console.log('No const declaration found:', firstLine)
    return declaration
  }

  const name = nameMatch[1].trim()
  console.log('Processing const without type annotation:', name)

  // Extract the object literal after removing comments
  const objectLiteral = extractCleanObjectLiteral(cleanDeclaration)
  if (objectLiteral) {
    const properties = extractObjectProperties(objectLiteral)
    if (properties.length > 0) {
      const propertyStrings = formatProperties(properties)
      return `${isExported ? 'export ' : ''}declare const ${name}: {\n${propertyStrings}\n};`
    }
  }

  // Handle simple value assignments
  const valueMatch = firstLine.match(/=\s*(.+)$/)
  if (valueMatch) {
    const value = valueMatch[1].trim()
    const inferredType = inferValueType(value)
    return `${isExported ? 'export ' : ''}declare const ${name}: ${inferredType};`
  }

  return declaration
}

function removeLeadingComments(code: string): string {
  const lines = code.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (
      line.startsWith('//')
      || line.startsWith('/*')
      || line.startsWith('*')
      || line.startsWith('/**')
      || line === ''
    ) {
      index++
    }
    else {
      break
    }
  }
  return lines.slice(index).join('\n')
}

function inferValueType(value: string): string {
  if (value.startsWith('{'))
    return 'Record<string, unknown>'
  if (value.startsWith('['))
    return 'unknown[]'
  if (value.startsWith('\'') || value.startsWith('"'))
    return 'string'
  if (!Number.isNaN(Number(value)))
    return 'number'
  if (value === 'true' || value === 'false')
    return 'boolean'
  if (value.includes('=>'))
    return '(...args: any[]) => unknown'
  return 'unknown'
}

/**
 * Format nested properties with proper indentation
 */
function formatProperties(properties: PropertyInfo[], indent = 2): string {
  return properties.map((prop) => {
    const spaces = ' '.repeat(indent)
    let key = prop.key

    // Check if the key is a valid identifier; if not, quote it
    if (!/^[_$a-z][\w$]*$/i.test(key)) {
      key = `'${key}'`
    }

    if (prop.nested && prop.nested.length > 0) {
      const nestedProps = formatProperties(prop.nested, indent + 2)
      return `${spaces}${key}: {\n${nestedProps}\n${spaces}};`
    }
    return `${spaces}${key}: ${prop.type};`
  }).join('\n')
}

/**
 * Extract object literal after cleaning comments
 */
function extractCleanObjectLiteral(declaration: string): string | null {
  const cleanedDeclaration = cleanComments(declaration)
  const objectStartIndex = cleanedDeclaration.indexOf('{')
  if (objectStartIndex === -1)
    return null

  let braceCount = 0
  let inString = false
  let stringChar = ''
  let objectLiteral = ''
  const chars = cleanedDeclaration.slice(objectStartIndex)

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]
    const prevChar = chars[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'') && (i === 0 || prevChar !== '\\')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '{')
        braceCount++
      if (char === '}')
        braceCount--
    }

    objectLiteral += char

    if (braceCount === 0 && !inString) {
      break
    }
  }

  return objectLiteral
}

/**
 * Extract and process object properties
 */
function extractObjectProperties(objectLiteral: string): PropertyInfo[] {
  const properties: PropertyInfo[] = []

  // Remove the outer braces
  const content = objectLiteral.trim().slice(1, -1).trim()
  if (!content)
    return properties

  // Split properties by commas, considering nested structures
  const elements = splitObjectProperties(content)

  for (const element of elements) {
    const colonIndex = element.indexOf(':')
    if (colonIndex === -1)
      continue

    const keyPart = element.slice(0, colonIndex).trim()
    const valuePart = element.slice(colonIndex + 1).trim()
    if (!keyPart || !valuePart)
      continue

    const key = keyPart.replace(/^['"]|['"]$/g, '') // Remove quotes from key if any

    const propertyInfo = processValue(valuePart)
    properties.push({
      key,
      value: valuePart,
      type: propertyInfo.type,
      nested: propertyInfo.nested,
    })
  }

  return properties
}

function extractObjectLiteral(declaration: string): string | null {
  const objectStartIndex = declaration.indexOf('{')
  if (objectStartIndex === -1)
    return null

  let braceCount = 0
  let inString = false
  let stringChar = ''
  let objectLiteral = ''
  const chars = declaration.slice(objectStartIndex)

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]

    // Handle string literals
    if ((char === '"' || char === '\'') && (i === 0 || chars[i - 1] !== '\\')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '{')
        braceCount++
      if (char === '}')
        braceCount--
    }

    objectLiteral += char

    if (braceCount === 0 && !inString) {
      break
    }
  }

  return objectLiteral
}

/**
 * Process comment lines with proper indentation handling
 * @param line - Comment line to process
 * @param state - Current processing state
 */
function processCommentLine(line: string, state: ProcessingState): void {
  // Skip single-line comments
  if (line.trim().startsWith('//')) {
    state.lastCommentBlock = ''
    return
  }

  const indentedLine = line.startsWith('*')
    ? ` ${line}` // Add indentation for content lines
    : line.startsWith('/**') || line.startsWith('*/')
      ? line // Keep delimiters at original indentation
      : ` ${line}` // Add indentation for other lines

  if (line.startsWith('/**')) {
    state.lastCommentBlock = ''
  }

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
      const nestedProps = extractObjectProperties(nestedContent)
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
 * Process complex type declarations
 */
function processComplexTypeDeclaration(declaration: string): string {
  // Handle union and intersection types
  if (declaration.includes('|') || declaration.includes('&')) {
    const operator = declaration.includes('|') ? '|' : '&'
    const types = declaration.split(new RegExp(`\\s*\\${operator}\\s*`)).map(type => type.trim())
    const combinedTypes = combineTypes(types, operator as '|' | '&')
    return combinedTypes
  }

  // Handle mapped types
  if (declaration.includes('[') && declaration.includes('in')) {
    const match = declaration.match(REGEX.mappedType)
    if (match) {
      const [, keyType, valueType] = match
      return `{ [${keyType} in ${valueType}]: ${processTypeExpression(valueType)} }`
    }
  }

  // Handle conditional types
  if (declaration.includes('extends') && declaration.includes('?')) {
    const match = declaration.match(REGEX.conditionalType)
    if (match) {
      const [, condition, constraint, trueType, falseType] = match
      return `${condition} extends ${constraint} ? ${trueType} : ${falseType}`
    }
  }

  return declaration
}

/**
 * Process type expressions
 */
function processTypeExpression(expression: string): string {
  // Handle generics
  if (expression.includes('<')) {
    const match = expression.match(REGEX.genericConstraints)
    if (match) {
      const [fullMatch, constraints] = match
      const processedConstraints = constraints.split(',').map((c) => {
        const [name, constraint] = c.split('extends').map(s => s.trim())
        return constraint ? `${name} extends ${constraint}` : name
      })
      return expression.replace(fullMatch, `<${processedConstraints.join(', ')}>`)
    }
  }

  return expression
}

/**
 * Extract nested content between delimiters
 */
function extractNestedContent(content: string, openChar: string, closeChar: string): string | null {
  let depth = 0
  let inString = false
  let stringChar = ''
  let result = ''
  let started = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = content[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === openChar) {
        depth++
        if (!started) {
          started = true
          continue // Skip the opening character
        }
      }
      else if (char === closeChar) {
        depth--
        if (depth === 0) {
          return result
        }
      }
    }

    if (started && depth > 0) {
      result += char
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
 * Check if a given type string represents a function type
 */
function isFunctionType(type: string): boolean {
  const functionTypeRegex = /^\s*\(.*\)\s*=>\s*(?:\S.*|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/
  return functionTypeRegex.test(type.trim())
}

/**
 * Check if a line is a JSDoc comment
 */
function isJSDocComment(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/')
}

/**
 * Combine types into a union or intersection, wrapping function types in parentheses
 */
function combineTypes(types: string[], operator: '|' | '&' = '|'): string {
  const uniqueTypes = [...new Set(types)]
  const normalizedTypes = uniqueTypes.map(type => isFunctionType(type) ? `(${type})` : type)
  return normalizedTypes.join(` ${operator} `)
}

/**
 * Determines if a line is a comment
 * @param line - Source code line to check
 * @returns True if the line is a JSDoc comment
 */
function isCommentLine(line: string): boolean {
  return isJSDocComment(line.trim())
}

/**
 * Checks if a line contains a TypeScript declaration
 * Covers exports, constants, interfaces, types, and functions
 * @param line - Source code line to check
 * @returns True if the line contains a declaration
 */
/**
 * Determine if a line is the start of a declaration
 */
function isDeclarationLine(line: string): boolean {
  return (
    line.startsWith('export ')
    || line.startsWith('declare ')
    || line.startsWith('interface ')
    || line.startsWith('type ')
    || line.startsWith('function ')
    || line.startsWith('const ')
    || line.startsWith('let ')
    || line.startsWith('var ')
    || line.startsWith('class ')
    || line.startsWith('enum ')
  )
}

function isDeclarationStart(line: string): boolean {
  return (
    line.startsWith('export ')
    || line.startsWith('interface ')
    || line.startsWith('type ')
    || line.startsWith('const ')
    || line.startsWith('function ')
    || line.startsWith('async function ')
    // Handle possible declare keywords
    || line.startsWith('declare ')
    // Handle possible export combinations
    || /^export\s+(interface|type|const|function|async\s+function)/.test(line)
    // Handle 'export async function'
    || line.startsWith('export async function')
  )
}

/**
 * Check if a declaration is complete by examining its content
 * @param content - Content to check, either as a string or array of lines
 */
function isDeclarationComplete(content: string | string[]): boolean {
  // Convert array to string if necessary
  const fullContent = Array.isArray(content) ? content.join('\n') : content

  // Remove comments and leading/trailing whitespace
  const trimmedContent = fullContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim()

  // Check if content ends with a semicolon or a closing brace
  return /;\s*$/.test(trimmedContent) || /\}\s*$/.test(trimmedContent)
}

/**
 * Infer array type from array literal with support for nested arrays and mixed elements
 */
function inferArrayType(value: string): string {
  const content = extractNestedContent(value, '[', ']')
  if (content === null) {
    return 'never[]'
  }

  const elements = splitArrayElements(content)
  if (elements.length === 0) {
    return 'never[]'
  }

  const elementTypes = elements.map(element => inferElementType(element.trim()))
  const combinedTypes = combineTypes(elementTypes)
  return `Array<${combinedTypes}>`
}

/**
 * Enhanced type inference for complex cases
 */
export function inferComplexType(value: string): string {
  const trimmed = value.trim()

  if (trimmed.includes('=>')) {
    return inferFunctionType(trimmed)
  }

  if (trimmed.startsWith('[')) {
    return inferArrayType(trimmed)
  }

  if (trimmed.startsWith('{')) {
    return processObjectLiteral(trimmed)
  }

  if (trimmed.includes('extends')) {
    return processComplexTypeDeclaration(trimmed)
  }

  if (trimmed.includes('|') || trimmed.includes('&')) {
    return processComplexTypeDeclaration(trimmed)
  }

  // Pass through direct type references and primitives
  return trimmed
}

/**
 * Infer element type with improved type detection
 */
function inferElementType(element: string): string {
  const trimmed = element.trim()

  if (trimmed.startsWith('[')) {
    // Nested array
    return inferArrayType(trimmed)
  }

  if (trimmed.startsWith('{')) {
    // Object literal
    const properties = extractObjectProperties(trimmed)
    return `{ ${properties.map(p => `${p.key}: ${p.type}`).join('; ')} }`
  }

  if (trimmed.startsWith('(') || trimmed.startsWith('function') || trimmed.includes('=>')) {
    // Function type
    return '(...args: any[]) => unknown'
  }

  if (/^['"`]/.test(trimmed)) {
    // String literal
    return trimmed
  }

  if (!Number.isNaN(Number(trimmed))) {
    // Number literal
    return trimmed
  }

  if (trimmed === 'true' || trimmed === 'false') {
    // Boolean literal
    return trimmed
  }

  // Identifier or unknown value
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
        const combinedNestedTypes = combineTypes(nestedTypes)
        return `Array<${combinedNestedTypes}>`
      }
      return 'never'
    }

    return inferElementType(trimmed)
  }).filter(type => type !== 'never')

  return combineTypes(processedTypes)
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
    const prevChar = content[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '[' || char === '{' || char === '(') {
        depth++
      }
      else if (char === ']' || char === '}' || char === ')') {
        depth--
      }

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

function splitObjectProperties(content: string): string[] {
  const properties: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = content[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
      }

      if (char === ',' && depth === 0) {
        properties.push(current.trim())
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    properties.push(current.trim())
  }

  return properties
}

/**
 * Parse object literal into properties
 */
export function parseObjectLiteral(objStr: string): PropertyInfo[] {
  const content = objStr.slice(1, -1).trim()
  return extractObjectProperties(content)
}

/**
 * Process object type literals
 */
function processObjectLiteral(obj: string): string {
  const properties = extractObjectProperties(obj)
  return formatObjectType(properties)
}

/**
 * Process interface declarations
 */
function processInterfaceDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const baseIndent = getIndentation(lines[0])
  const memberIndent = `${baseIndent}  `

  // Process the interface header
  const firstLine = lines[0].trim()
  const match = firstLine.match(/^(?:export\s+)?interface\s+([^<\s{]+)(<[^{]+>)?/)
  if (!match)
    return declaration

  const [, name, generics = ''] = match
  const prefix = isExported ? 'export declare' : 'declare'

  // Process interface members maintaining original indentation
  const processedLines = [
    `${baseIndent}${prefix} interface ${name}${generics} {`,
  ]

  // Add members with preserved indentation
  let seenContent = false
  for (let i = 1; i < lines.length - 1; i++) {
    const line = lines[i]
    const content = line.trim()
    if (content) {
      seenContent = true
      processedLines.push(`${memberIndent}${content}`)
    }
  }

  // If no content was found, add a newline for better formatting
  if (!seenContent) {
    processedLines.push('')
  }

  processedLines.push(`${baseIndent}}`)
  return processedLines.join('\n')
}

/**
 * Process type declarations
 */
function processTypeDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const baseIndent = getIndentation(lines[0])

  // Handle type exports
  if (lines[0].includes('type {')) {
    return declaration
  }

  // Extract type name and initial content
  const typeMatch = lines[0].match(/^(?:export\s+)?type\s+([^=\s]+)\s*=\s*(.*)/)
  if (!typeMatch)
    return declaration

  const [, name, initialContent] = typeMatch
  const prefix = isExported ? 'export declare' : 'declare'

  // If it's a simple single-line type
  if (lines.length === 1) {
    return `${baseIndent}${prefix} type ${name} = ${initialContent};`
  }

  // For multi-line types, properly format with line breaks
  const processedLines = [`${baseIndent}${prefix} type ${name} = ${initialContent.trim()}`]
  const remainingLines = lines.slice(1)

  for (const line of remainingLines) {
    const trimmed = line.trim()
    if (trimmed) {
      // Keep original indentation for the line
      const lineIndent = getIndentation(line)
      processedLines.push(`${lineIndent}${trimmed}`)
    }
  }

  return processedLines.join('\n')
}

function processSourceFile(content: string, state: ProcessingState): void {
  // Clean the source content first
  const cleanedContent = cleanSource(content)
  const lines = cleanedContent.split('\n')

  let currentBlock: string[] = []
  let currentComments: string[] = []
  let isInMultilineDeclaration = false
  let braceLevel = 0

  function flushBlock() {
    if (currentBlock.length > 0 || currentComments.length > 0) {
      // Only include JSDoc comments in currentComments
      const jsdocComments = currentComments.filter(comment =>
        comment.trim().startsWith('/**')
        || comment.trim().startsWith('*')
        || comment.trim().startsWith('*/'),
      )

      processDeclarationBlock([...currentBlock], [...jsdocComments], state)
      currentBlock = []
      currentComments = []
      isInMultilineDeclaration = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim().replace(/^\uFEFF/, '') // Remove BOM if present

    if (!trimmedLine) {
      continue
    }

    // Handle comments
    if (isJSDocComment(trimmedLine)) {
      currentComments.push(line)
      continue
    }

    // Check for declaration start only at top level
    if (braceLevel === 0 && isDeclarationStart(trimmedLine)) {
      flushBlock()
      currentBlock.push(line)
      isInMultilineDeclaration = !isDeclarationComplete(trimmedLine)
    }
    else if (isInMultilineDeclaration) {
      currentBlock.push(line)
      // Check if declaration is complete
      const currentContent = currentBlock.join('\n')
      if (isDeclarationComplete(currentContent)) {
        flushBlock()
      }
    }
    else if (braceLevel === 0 && shouldProcessLine(trimmedLine)) {
      flushBlock()
      currentBlock.push(line)
      flushBlock()
    }

    // Update brace level to track scope
    braceLevel += netBraceCount(line)
  }

  // Process any remaining block
  flushBlock()
}

function netBraceCount(line: string): number {
  let netCount = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const prevChar = line[i - 1]

    // Handle string literals
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '{') {
        netCount++
      }
      else if (char === '}') {
        netCount--
      }
    }
  }

  return netCount
}

/**
 * Extract complete function signature using regex
 */
function extractFunctionSignature(declaration: string): FunctionSignature {
  // Remove comments from the declaration
  const cleanDeclaration = removeLeadingComments(declaration).trim()

  // Remove leading 'export', 'async', 'function' keywords
  const withoutKeywords = cleanDeclaration.replace(/^\s*(export\s+)?(async\s+)?function\s+/, '').trim()

  // Extract function name
  const { name, rest: afterName } = extractFunctionName(withoutKeywords)
  if (!name) {
    console.error('Function name could not be extracted from declaration:', declaration)
    return {
      name: '',
      params: '',
      returnType: 'void',
      generics: '',
    }
  }

  let rest = afterName

  // Extract generics
  let generics = ''
  if (rest.startsWith('<')) {
    const genericsResult = extractBalancedSymbols(rest, '<', '>')
    if (genericsResult) {
      generics = genericsResult.content
      rest = genericsResult.rest.trim()
    }
    else {
      console.error('Generics could not be extracted from declaration:', declaration)
    }
  }

  // Extract parameters
  let params = ''
  if (rest.startsWith('(')) {
    const paramsResult = extractBalancedSymbols(rest, '(', ')')
    if (paramsResult) {
      params = paramsResult.content.slice(1, -1).trim() // Remove the surrounding parentheses
      rest = paramsResult.rest.trim()
    }
    else {
      console.error('Parameters could not be extracted from declaration:', declaration)
      return {
        name,
        params: '',
        returnType: 'void',
        generics,
      }
    }
  }
  else {
    console.error('Parameters could not be extracted from declaration:', declaration)
    return {
      name,
      params: '',
      returnType: 'void',
      generics,
    }
  }

  // Extract return type
  let returnType = 'void'
  if (rest.startsWith(':')) {
    const match = rest.match(/^:\s*([^{]+)/)
    if (match) {
      returnType = match[1].trim()
    }
  }

  return {
    name,
    params,
    returnType: normalizeType(returnType),
    generics,
  }
}

/**
 * Process function declarations with overloads
 */
export function processFunctionDeclaration(
  declaration: string,
  usedTypes?: Set<string>,
  isExported = true,
): string {
  // Remove comments from the declaration for parsing
  const cleanDeclaration = removeLeadingComments(declaration).trim()

  const {
    name,
    params,
    returnType,
    generics,
  } = extractFunctionSignature(cleanDeclaration)

  // Add logs to verify extracted components
  console.log('Function Name:', name)
  console.log('Generics:', generics)
  console.log('Parameters:', params)
  console.log('Return Type:', returnType)

  // Track used types if provided
  if (usedTypes) {
    trackUsedTypes(`${generics} ${params} ${returnType}`, usedTypes)
  }

  const parts = [
    isExported ? 'export' : '',
    'declare',
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
    // Include ':' in the character classes to handle spacing around colons
    .replace(/\s+([<>(),;:])/g, '$1')
    .replace(/([<>(),;:])\s+/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Clean source code by removing single-line comments and normalizing content
 */
function cleanSource(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      // Remove single line comments
      const commentIndex = line.indexOf('//')
      if (commentIndex !== -1) {
        // Keep the line if there's content before the comment
        const beforeComment = line.substring(0, commentIndex).trim()
        return beforeComment || ''
      }
      return line
    })
    .filter(Boolean) // Remove empty lines
    .join('\n')
}

/**
 * Clean single line comments and whitespace from a string
 */
function cleanComments(input: string): string {
  return input
    // Remove single line comments
    .replace(/\/\/[^\n]*/g, '')
    // Clean up empty lines that may be left after comment removal
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
}

function cleanDeclaration(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .trim()
}

/**
 * Clean and normalize parameters
 */
export function cleanParameters(params: string): string {
  return params.trim()
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
 * Track type usage in declarations
 */
function trackTypeUsage(content: string, state: ImportTrackingState): void {
  // Only look for capitalized type references that are actually used in declarations
  const typePattern = /(?:extends|implements|:|<)\s*([A-Z][a-zA-Z0-9]*(?:<[^>]+>)?)/g
  let match
  // eslint-disable-next-line no-cond-assign
  while ((match = typePattern.exec(content)) !== null) {
    const typeName = match[1].split('<')[0] // Handle generic types
    state.usedTypes.add(typeName)
  }
}

/**
 * Track value usage in declarations
 */
function trackValueUsage(content: string, state: ImportTrackingState, dtsLines?: string[]): void {
  // Track values in declarations
  const patterns = [
    // Export statements in declarations
    /export\s+declare\s+\{\s*([^}\s]+)(?:\s*,\s*[^}\s]+)*\s*\}/g,
    // Declared exports
    /export\s+declare\s+(?:const|function|class)\s+([a-zA-Z_$][\w$]*)/g,
    // Direct exports
    /export\s+\{\s*([^}\s]+)(?:\s*,\s*[^}\s]+)*\s*\}/g,
  ]

  for (const pattern of patterns) {
    let match
    // eslint-disable-next-line no-cond-assign
    while ((match = pattern.exec(content)) !== null) {
      const values = match[1].split(',').map(v => v.trim())
      for (const value of values) {
        if (!['type', 'interface', 'declare', 'extends', 'implements', 'function', 'const', 'let', 'var'].includes(value)) {
          state.usedValues.add(value)
        }
      }
    }
  }

  // Track values in the final output lines if provided
  if (dtsLines) {
    dtsLines.forEach((line) => {
      if (line.includes('declare') || line.includes('export')) {
        // Look for exported values
        const exportMatch = line.match(/(?:export|declare)\s+(?:const|function|class)\s+([a-zA-Z_$][\w$]*)/)
        if (exportMatch) {
          state.usedValues.add(exportMatch[1])
        }
      }
    })
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
function processDeclarationLine(line: string, state: ProcessingState): void {
  const indent = getIndentation(line)
  const trimmedLine = cleanComments(line).trim()

  if (!trimmedLine) {
    state.dtsLines.push('')
    return
  }

  // Handle JSDoc comments
  if (isJSDocComment(trimmedLine)) {
    if (trimmedLine.startsWith('/**')) {
      state.lastCommentBlock = ''
    }
    state.lastCommentBlock += `${line}\n`
    return
  }

  // If we have a pending comment block and this is a declaration,
  // add the comment block before the declaration
  if (state.lastCommentBlock && isDeclarationLine(trimmedLine)) {
    state.dtsLines.push(state.lastCommentBlock.trimEnd())
    state.lastCommentBlock = ''
  }

  // Rest of the existing processDeclarationLine logic...
  if (isDeclarationStart(trimmedLine)) {
    if (state.declarationBuffer) {
      const cleaned = cleanDeclaration(cleanComments(state.declarationBuffer.lines.join('\n')))
      const processed = processDeclarationBuffer(
        state.declarationBuffer,
        state,
        needsExport(cleaned),
      )

      if (processed) {
        if (state.declarationBuffer.comments.length > 0) {
          state.dtsLines.push(...state.declarationBuffer.comments)
        }
        state.dtsLines.push(processed)
      }
    }

    state.declarationBuffer = {
      type: getDeclarationType(trimmedLine),
      indent,
      lines: [line],
      comments: state.lastCommentBlock ? [state.lastCommentBlock] : [],
    }
    state.lastCommentBlock = ''
    return
  }

  if (state.declarationBuffer) {
    state.declarationBuffer.lines.push(line)

    if (isDeclarationComplete(state.declarationBuffer.lines)) {
      const cleaned = cleanDeclaration(cleanComments(state.declarationBuffer.lines.join('\n')))
      const processed = processDeclarationBuffer(
        state.declarationBuffer,
        state,
        needsExport(cleaned),
      )

      if (processed) {
        if (state.declarationBuffer.comments.length > 0) {
          state.dtsLines.push(...state.declarationBuffer.comments)
        }
        state.dtsLines.push(processed)
      }
      state.declarationBuffer = null
    }
  }
}

function getDeclarationType(line: string): 'interface' | 'type' | 'const' | 'function' {
  if (line.includes('interface'))
    return 'interface'
  if (line.includes('type'))
    return 'type'
  if (line.includes('const'))
    return 'const'
  return 'function'
}

/**
 * Format the final output with proper spacing and organization
 */
function formatOutput(state: ProcessingState): string {
  const sections: string[] = []

  // Process imports
  const imports = state.imports.join('\n').trim()
  if (imports) {
    sections.push(imports)
  }

  // Process declarations (excluding exports)
  const declarations = state.dtsLines
    .filter(line => !line.startsWith('export *') && !line.startsWith('export { config }'))
    .join('\n')
    .trim()
  if (declarations) {
    sections.push(declarations)
  }

  // Group all export * and export { config } statements
  const exportStatements = [
    ...state.dtsLines.filter(line => line.startsWith('export *') || line.startsWith('export { config }')),
    ...state.exportAllStatements,
  ].join('\n').trim()

  // Add default export if it exists
  const defaultExport = state.defaultExport?.trim()

  // Combine sections with appropriate spacing
  let output = sections.join('\n\n')

  // Add export statements group before default export
  if (exportStatements) {
    output += output ? '\n\n' : ''
    output += exportStatements
  }

  // Add default export with spacing
  if (defaultExport) {
    output += output ? '\n\n' : ''
    output += defaultExport
  }

  // Ensure output ends with a single newline
  return `${output.trimEnd()}\n`
}

function getIndentation(line: string): string {
  const match = line.match(/^(\s+)/)
  return match ? match[1] : ''
}

function needsExport(line: string): boolean {
  const trimmed = line.trim()
  return (
    trimmed.startsWith('export ')
    || trimmed.startsWith('export default ')
    || trimmed.startsWith('export type ')
    || trimmed.startsWith('export interface ')
  )
}

function shouldProcessLine(line: string): boolean {
  // Lines that should be processed even if they don't start with a declaration keyword
  return line.startsWith('export {') || line.startsWith('export *')
}
