/* eslint-disable no-console,regexp/no-super-linear-backtracking */

/**
 * Regular expression patterns used throughout the module
 */
interface RegexPatterns {
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
  /** Module declaration pattern */
  readonly moduleDeclaration: RegExp
  /** Module augmentation pattern */
  readonly moduleAugmentation: RegExp
}

interface ImportTrackingState {
  typeImports: Map<string, Set<string>> // module -> Set of type names
  valueImports: Map<string, Set<string>> // module -> Set of value names
  usedTypes: Set<string> // All used type names
  usedValues: Set<string> // All used value names
}

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

interface MethodSignature {
  name: string
  async: boolean
  generics: string
  params: string
  returnType: string
}

/**
 * Regular expression patterns used throughout the module
 * @remarks These patterns are optimized for performance and reliability
 */
const REGEX: RegexPatterns = {
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
  moduleDeclaration: /^declare\s+module\s+['"]([^'"]+)['"]\s*\{/,
  moduleAugmentation: /^declare\s+module\s+/,
} as const satisfies RegexPatterns

/**
 * Represents property type information with support for nested structures
 */
interface PropertyInfo {
  /** Property identifier */
  key: string
  /** Original source value */
  value: string
  /** Inferred TypeScript type */
  type: string
  /** Nested property definitions */
  nested?: PropertyInfo[]
  method?: MethodSignature
}

/**
 * Import statement metadata and tracking
 */
interface ImportInfo {
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
 * Function signature components
 */
interface FunctionSignature {
  name: string
  params: string
  returnType: string
  // isAsync: boolean
  generics: string
}

// ===========================
// Core Functions
// ===========================

/**
 * Creates initial processing state with empty collections
 */
function createProcessingState(): ProcessingState {
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

  // Clear any existing imports and set up dtsLines with optimized imports
  state.dtsLines = [
    ...optimizedImports.map(imp => `${imp};`), // Ensure semicolons
    '', // Single empty line after imports
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
 * Extract complete function signature using regex
 */
function extractFunctionSignature(declaration: string): FunctionSignature {
  // Remove comments and clean up the declaration
  const cleanDeclaration = removeLeadingComments(declaration).trim()

  const functionPattern = /^\s*(export\s+)?(async\s+)?function\s*(\*)?\s*([^(<\s]+)/
  const functionMatch = cleanDeclaration.match(functionPattern)

  if (!functionMatch) {
    console.error('Function name could not be extracted from declaration:', declaration)
    return {
      name: '',
      params: '',
      returnType: 'void',
      generics: '',
    }
  }

  const name = functionMatch[4]
  let rest = cleanDeclaration.slice(cleanDeclaration.indexOf(name) + name.length).trim()

  // Extract generics
  let generics = ''
  if (rest.startsWith('<')) {
    const genericsResult = extractBalancedSymbols(rest, '<', '>')
    if (genericsResult) {
      generics = genericsResult.content
      rest = genericsResult.rest.trim()
    }
  }

  // Extract parameters
  let params = ''
  if (rest.startsWith('(')) {
    const paramsResult = extractBalancedSymbols(rest, '(', ')')
    if (paramsResult) {
      params = paramsResult.content.slice(1, -1).trim()
      rest = paramsResult.rest.trim()
    }
  }

  // Extract return type - keep it exactly as specified
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

function processValue(value: string): { type: string, nested?: PropertyInfo[], method?: MethodSignature } {
  const trimmed = value.trim()

  // Handle method declarations
  if (trimmed.includes('(') && !trimmed.startsWith('(')) {
    const methodSig = parseMethodSignature(trimmed)
    if (methodSig) {
      const { async, generics, params, returnType } = methodSig
      const genericPart = generics ? `<${generics}>` : ''
      const returnTypePart = returnType || 'void'
      const type = `${async ? 'async ' : ''}${genericPart}(${params}) => ${returnTypePart}`
      return { type, method: methodSig }
    }
  }

  // Rest of the existing processValue logic...
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
 * Process imports and track their usage
 */
function processImports(line: string, state: ImportTrackingState): void {
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

function processDeclarationBlock(
  lines: string[],
  comments: string[],
  state: ProcessingState,
): void {
  console.log('Processing declaration block:', { lines, comments })

  // Only include JSDoc comments
  const jsdocComments = comments.filter(isJSDocComment)
  console.log('Filtered JSDoc comments:', jsdocComments)

  // Add JSDoc comments directly before the declaration
  if (jsdocComments.length > 0) {
    // Directly add the comments without the extra newline
    state.dtsLines.push(...jsdocComments.map(comment => comment.trimEnd()))
  }

  // Remove any non-JSDoc comments that might have slipped through
  const cleanedLines = lines.map((line) => {
    const commentIndex = line.indexOf('//')
    return commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line
  }).filter(Boolean)

  const declaration = cleanedLines.join('\n').trim()

  if (!declaration) {
    console.log('Empty declaration, skipping')
    return
  }

  // Remove leading comments and whitespace when checking its type
  const declarationWithoutComments = removeLeadingComments(declaration).trimStart()

  // Process the declaration as before
  processSpecificDeclaration(declarationWithoutComments, declaration, state)
}

function processSpecificDeclaration(
  declarationWithoutComments: string,
  fullDeclaration: string,
  state: ProcessingState,
) {
  console.log('Processing specific declaration:', {
    declarationWithoutComments,
    fullDeclaration,
  })

  if (declarationWithoutComments.startsWith('declare module')) {
    const processed = processModuleDeclaration(fullDeclaration)
    console.log('Added module declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (declarationWithoutComments.startsWith('export default')) {
    state.defaultExport = declarationWithoutComments.endsWith(';')
      ? declarationWithoutComments
      : `${declarationWithoutComments};`
    console.log('Added default export:', state.defaultExport)
    return
  }

  if (
    declarationWithoutComments.startsWith('export const')
    || declarationWithoutComments.startsWith('const')
  ) {
    const isExported = declarationWithoutComments.trimStart().startsWith('export')
    const processed = processConstDeclaration(
      fullDeclaration,
      isExported,
    )
    console.log('Added const declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('interface')
    || declarationWithoutComments.startsWith('export interface')
  ) {
    const processed = processInterfaceDeclaration(
      fullDeclaration,
      declarationWithoutComments.startsWith('export'),
    )
    console.log('Added interface declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('type')
    || declarationWithoutComments.startsWith('export type')
  ) {
    const processed = processTypeDeclaration(
      fullDeclaration,
      declarationWithoutComments.startsWith('export'),
    )
    console.log('Added type declaration:', processed)
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
      fullDeclaration,
      state.usedTypes,
      declarationWithoutComments.startsWith('export'),
    )
    console.log('Added function declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('export {')
    || declarationWithoutComments.startsWith('export *')
  ) {
    console.log('Added export statement:', fullDeclaration)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (declarationWithoutComments.startsWith('export type {')) {
    console.log('Added type export statement:', fullDeclaration)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (
    declarationWithoutComments.startsWith('class')
    || declarationWithoutComments.startsWith('export class')
    || declarationWithoutComments.startsWith('abstract class')
    || declarationWithoutComments.startsWith('export abstract class')
  ) {
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    console.log('Added class declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('enum')
    || declarationWithoutComments.startsWith('export enum')
    || declarationWithoutComments.startsWith('const enum')
    || declarationWithoutComments.startsWith('export const enum')
  ) {
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    console.log('Added enum declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('namespace')
    || declarationWithoutComments.startsWith('export namespace')
  ) {
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    console.log('Added namespace declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('let')
    || declarationWithoutComments.startsWith('export let')
    || declarationWithoutComments.startsWith('var')
    || declarationWithoutComments.startsWith('export var')
  ) {
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    console.log('Added variable declaration:', processed)
    state.dtsLines.push(processed)
    return
  }

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

/**
 * Process function declarations with overloads
 */
function processFunctionDeclaration(
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

  // Track used types if provided
  if (usedTypes) {
    trackUsedTypes(`${generics} ${params} ${returnType}`, usedTypes)
  }

  // Build the declaration string
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
 * Process interface declarations
 */
function processInterfaceDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')

  // Only modify the first line to add 'declare' if needed
  const firstLine = lines[0]
  const prefix = isExported ? 'export declare' : 'declare'

  // Replace 'export interface' or 'interface' with the correct prefix
  const modifiedFirstLine = firstLine.replace(
    /^(\s*)(?:export\s+)?interface/,
    `$1${prefix} interface`,
  )

  // Return the modified first line with all other lines unchanged
  return [modifiedFirstLine, ...lines.slice(1)].join('\n')
}

/**
 * Process type declarations
 */
function processTypeDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0].trim()

  // Preserve direct type exports (export type { X })
  if (firstLine.startsWith('export type {')) {
    return declaration
  }

  // Only modify the first line to add 'declare' if needed
  const prefix = isExported ? 'export declare' : 'declare'

  // Replace 'export type' or 'type' with the correct prefix
  const modifiedFirstLine = lines[0].replace(
    /^(\s*)(?:export\s+)?type(?!\s*\{)/,
    `$1${prefix} type`,
  )

  // Return the modified first line with all other lines unchanged
  return [modifiedFirstLine, ...lines.slice(1)].join('\n')
}

function processSourceFile(content: string, state: ProcessingState): void {
  const cleanedContent = cleanSource(content)
  const lines = cleanedContent.split('\n')

  console.log('Processing source file:', { totalLines: lines.length })

  let currentBlock: string[] = []
  let currentComments: string[] = []
  let isInMultilineDeclaration = false
  let braceLevel = 0
  let isInModuleDeclaration = false

  function flushBlock() {
    if (currentBlock.length > 0 || currentComments.length > 0) {
      console.log('Flushing block:', {
        blockLines: currentBlock,
        comments: currentComments,
      })

      const jsdocComments = currentComments.filter(comment =>
        comment.trim().startsWith('/**')
        || comment.trim().startsWith('*')
        || comment.trim().startsWith('*/'),
      )

      processDeclarationBlock([...currentBlock], [...jsdocComments], state)
      currentBlock = []
      currentComments = []
      isInMultilineDeclaration = false
      isInModuleDeclaration = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim().replace(/^\uFEFF/, '')

    if (!trimmedLine) {
      if (isInModuleDeclaration || isInMultilineDeclaration) {
        currentBlock.push(line)
      }
      continue
    }

    console.log('Processing line:', {
      line,
      isComment: isJSDocComment(trimmedLine),
      braceLevel,
      isMultiline: isInMultilineDeclaration,
      isInModule: isInModuleDeclaration,
    })

    // Handle comments
    if (isJSDocComment(trimmedLine)) {
      currentComments.push(line)
      console.log('Added comment to current block')
      continue
    }

    // Check for module declaration start
    if (braceLevel === 0 && trimmedLine.startsWith('declare module')) {
      console.log('Found module declaration start:', trimmedLine)
      flushBlock()
      currentBlock.push(line)
      isInModuleDeclaration = true
      isInMultilineDeclaration = true
      braceLevel++
      continue
    }

    // Handle ongoing module declaration
    if (isInModuleDeclaration) {
      currentBlock.push(line)
      braceLevel += netBraceCount(line)

      // Check if module declaration is complete
      if (braceLevel === 0) {
        console.log('Completed module declaration')
        flushBlock()
      }
      continue
    }

    // Handle regular declarations
    if (braceLevel === 0 && isDeclarationStart(trimmedLine)) {
      console.log('Found declaration start:', trimmedLine)
      flushBlock()
      currentBlock.push(line)
      isInMultilineDeclaration = !isDeclarationComplete(trimmedLine)
    }
    else if (isInMultilineDeclaration) {
      currentBlock.push(line)
      // Check if declaration is complete
      const currentContent = currentBlock.join('\n')
      if (isDeclarationComplete(currentContent)) {
        console.log('Completed multiline declaration')
        flushBlock()
      }
    }
    else if (braceLevel === 0 && shouldProcessLine(trimmedLine)) {
      console.log('Processing standalone line:', trimmedLine)
      flushBlock()
      currentBlock.push(line)
      flushBlock()
    }

    // Update brace level for non-module declarations
    if (!isInModuleDeclaration) {
      braceLevel += netBraceCount(line)
    }
  }

  // Process any remaining block
  flushBlock()
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
  const isJsDoc = trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/')
  console.log('Checking JSDoc:', { line, isJsDoc })
  return isJsDoc
}

/**
 * Combine types into a union or intersection, wrapping function types in parentheses
 */
function combineTypes(types: string[], operator: '|' | '&' = '|'): string {
  const uniqueTypes = [...new Set(types)]
  const normalizedTypes = uniqueTypes.map(type => isFunctionType(type) ? `(${type})` : type)
  return normalizedTypes.join(` ${operator} `)
}

function isDeclarationStart(line: string): boolean {
  return (
    line.startsWith('export ')
    || line.startsWith('interface ')
    || line.startsWith('type ')
    || line.startsWith('const ')
    || line.startsWith('function ')
    || line.startsWith('async function ')
    || line.startsWith('declare ')
    || line.startsWith('declare module')
    || /^export\s+(interface|type|const|function|async\s+function)/.test(line)
    || line.startsWith('export async function')
  )
}

/**
 * Check if a declaration is complete by examining its content
 * @param content - Content to check, either as a string or array of lines
 */
function isDeclarationComplete(content: string | string[]): boolean {
  const fullContent = Array.isArray(content) ? content.join('\n') : content
  const trimmedContent = fullContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim()
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

function parseMethodSignature(value: string): MethodSignature | null {
  // Match async methods
  const asyncMatch = value.match(/^async\s+([^<(]+)(?:<([^>]+)>)?\s*\(([\s\S]*?)\)(?:\s*:\s*([\s\S]+))?$/)
  if (asyncMatch) {
    const [, name, generics, params, returnType] = asyncMatch
    return {
      name,
      async: true,
      generics: generics || '',
      params,
      returnType: returnType || 'Promise<void>',
    }
  }

  // Match regular methods
  const methodMatch = value.match(/^([^<(]+)(?:<([^>]+)>)?\s*\(([\s\S]*?)\)(?:\s*:\s*([\s\S]+))?$/)
  if (methodMatch) {
    const [, name, generics, params, returnType] = methodMatch
    return {
      name,
      async: false,
      generics: generics || '',
      params,
      returnType: returnType || 'void',
    }
  }

  return null
}

function processModuleDeclaration(declaration: string): string {
  const lines = declaration.split('\n')
  const indentUnit = '  '

  // Track brace depth for proper indentation
  let braceDepth = 0
  const formattedLines = lines.map((line, index) => {
    const trimmedLine = line.trim()
    if (!trimmedLine)
      return ''

    // Handle closing braces before indentation
    if (trimmedLine.startsWith('}')) {
      braceDepth--
    }

    // Determine indentation
    const currentIndent = indentUnit.repeat(Math.max(0, braceDepth))

    // Format the line
    const formattedLine = index === 0
      ? trimmedLine // First line (declare module) has no indentation
      : `${currentIndent}${trimmedLine}`

    // Handle opening braces after indentation
    if (trimmedLine.endsWith('{')) {
      braceDepth++
    }

    // Special handling for lines containing both closing and opening braces
    if (trimmedLine.includes('}') && trimmedLine.includes('{')) {
      // Adjust depth for special cases like "} else {"
      braceDepth = Math.max(0, braceDepth)
    }

    return formattedLine
  })

  return formattedLines.join('\n')
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
 * Generate optimized imports based on usage
 */
function generateOptimizedImports(state: ImportTrackingState, dtsLines: string[]): string[] {
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
 * Track used types in declarations
 */
function trackUsedTypes(content: string, usedTypes: Set<string>): void {
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
 * Format the final output with proper spacing and organization
 */
function formatOutput(state: ProcessingState): string {
  console.log('Formatting output. Initial state:', {
    importCount: state.imports.length,
    dtsLineCount: state.dtsLines.length,
    hasDefaultExport: !!state.defaultExport,
  })

  const parts: string[] = []

  // Group lines by type
  const isExportStatement = (line: string) => {
    const trimmed = line.trim()
    return trimmed.startsWith('export *')
      || (trimmed.startsWith('export {') && !trimmed.startsWith('export declare'))
      || (trimmed.startsWith('export type {') && !trimmed.startsWith('export declare type'))
  }

  // Get declarations (everything except bare exports)
  const declarations = state.dtsLines.filter(line => !isExportStatement(line))

  // Process declarations preserving empty lines
  const currentSection: string[] = []
  let lastLineWasEmpty = false

  for (const line of declarations) {
    const trimmedLine = line.trim()

    if (!trimmedLine) {
      if (!lastLineWasEmpty) {
        currentSection.push('')
      }
      lastLineWasEmpty = true
      continue
    }
    lastLineWasEmpty = false
    currentSection.push(line)
  }

  // Add declarations
  if (currentSection.length > 0) {
    parts.push(currentSection.join('\n'))
  }

  // Deduplicate and add export statements
  const exportLines = new Set([
    ...state.dtsLines.filter(isExportStatement),
    ...state.exportAllStatements,
  ])

  if (exportLines.size > 0) {
    if (parts.length > 0)
      parts.push('')
    parts.push([...exportLines].join('\n'))
  }

  // Add default export
  if (state.defaultExport) {
    if (parts.length > 0)
      parts.push('')
    parts.push(state.defaultExport)
  }

  return `${parts.join('\n')}\n`
}

function shouldProcessLine(line: string): boolean {
  return line.startsWith('export {') || line.startsWith('export *')
}
