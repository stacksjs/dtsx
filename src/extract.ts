/* eslint-disable regexp/no-super-linear-backtracking, no-cond-assign, regexp/no-misleading-capturing-group */
import type { FunctionSignature, ImportTrackingState, MethodSignature, ProcessingState, PropertyInfo } from './types'

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
  debugLog(state, 'init', 'Starting DTS extraction')

  // Process imports first
  sourceCode.split('\n').forEach((line) => {
    if (line.includes('import ')) {
      processImports(line, state.importTracking)
      debugLog(state, 'import', `Processed import: ${line.trim()}`)
    }
  })

  // Process declarations
  processSourceFile(sourceCode, state)

  // Log the state of exports before formatting
  debugLog(state, 'export-summary', `Found ${state.defaultExports.size} default exports`)
  debugLog(state, 'export-summary', `Found ${state.exportAllStatements.length} export * statements`)

  // Final pass to track what actually made it to the output
  state.dtsLines.forEach((line) => {
    if (line.trim() && !line.startsWith('import')) {
      trackTypeUsage(line, state.importTracking)
      trackValueUsage(line, state.importTracking, state.dtsLines)
    }
  })

  // Generate optimized imports based on actual output
  const optimizedImports = generateOptimizedImports(state.importTracking, state.dtsLines)
  debugLog(state, 'import-summary', `Generated ${optimizedImports.length} optimized imports`)

  // Clear any existing imports and set up dtsLines with optimized imports
  state.dtsLines = [
    ...optimizedImports.map(imp => `${imp};`),
    '',
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

  let depth = 0
  let result = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === openSymbol) {
      depth++
    }
    else if (char === closeSymbol) {
      depth--
      if (depth === 0) {
        return {
          content: text.slice(0, i + 1),
          rest: text.slice(i + 1).trim(),
        }
      }
    }
    result += char
  }
  return null
}

/**
 * Extract complete function signature using regex
 */
function extractFunctionSignature(declaration: string): FunctionSignature {
  // Remove comments and clean up the declaration
  const cleanDeclaration = removeLeadingComments(declaration).trim()
  const functionPattern = /^\s*(export\s+)?(async\s+)?function\s*(?:(\*)\s*)?([^(<\s]+)/
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
 * Extract and process object properties
 */
function extractObjectProperties(objectLiteral: string, state?: ProcessingState): PropertyInfo[] {
  debugLog(state, 'property-extraction-detail', `Processing object literal: ${objectLiteral}`)

  const properties: PropertyInfo[] = []
  const content = objectLiteral.slice(1, -1).trim()
  const parts = splitObjectProperties(content, state)

  debugLog(state, 'property-extraction-detail', `Split into ${parts.length} parts`)

  for (const part of parts) {
    const property = processProperty(part, state)
    if (property) {
      properties.push(property)
      debugLog(state, 'property-extraction-detail', `Added property ${property.key} with type ${property.type}`)
    }
  }

  debugLog(state, 'property-extraction-detail', `Final properties count: ${properties.length}`)
  return properties
}

/**
 * Extract nested content between delimiters
 */
function extractNestedContent(content: string, openChar: string, closeChar: string, state?: ProcessingState): string | null {
  debugLog(state, 'content-extraction', `Extracting nested content with ${openChar}${closeChar}`)

  const startIdx = content.indexOf(openChar)
  if (startIdx === -1)
    return null

  let depth = 0
  let inString = false
  let stringChar = ''
  let inTemplate = false
  let result = ''
  let contentStarted = false

  for (let i = startIdx; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    // Handle string literals
    if (!inTemplate && (char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
        debugLog(state, 'content-extraction', `String start at ${i}`)
      }
      else if (char === stringChar) {
        inString = false
        debugLog(state, 'content-extraction', `String end at ${i}`)
      }
    }

    // Handle template literals
    if (char === '`' && prevChar !== '\\') {
      inTemplate = !inTemplate
      debugLog(state, 'content-extraction', `Template ${inTemplate ? 'start' : 'end'} at ${i}`)
    }

    // Track depth for braces/brackets
    if (!inString && !inTemplate) {
      if (char === openChar) {
        depth++
        debugLog(state, 'content-extraction', `Opening at ${i}, depth: ${depth}`)
        if (!contentStarted) {
          contentStarted = true
          continue
        }
      }
      else if (char === closeChar) {
        depth--
        debugLog(state, 'content-extraction', `Closing at ${i}, depth: ${depth}`)
        if (depth === 0) {
          debugLog(state, 'content-extraction', `Complete content captured, length: ${result.length}`)
          return result
        }
      }
    }

    if (contentStarted) {
      result += char
    }
  }

  debugLog(state, 'content-extraction', `Failed to extract complete content, depth: ${depth}`)
  return null
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

function extractCompleteObject(value: string, state?: ProcessingState): string | null {
  debugLog(state, 'extract-object', `Starting extraction of object with length ${value.length}`)
  const bracketStack: string[] = []
  let result = ''
  let inString = false
  let stringChar = ''
  let inTemplate = false
  let startBrace = ''

  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    const prevChar = i > 0 ? value[i - 1] : ''

    // Handle strings
    if (!inTemplate && (char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
        debugLog(state, 'extract-detail', `String start at ${i}`)
      }
      else if (char === stringChar) {
        inString = false
        debugLog(state, 'extract-detail', `String end at ${i}`)
      }
    }
    else if (char === '`' && prevChar !== '\\') {
      inTemplate = !inTemplate
    }

    // Handle brackets only when not in string/template
    if (!inString && !inTemplate) {
      if (char === '{' || char === '[' || char === '(') {
        if (bracketStack.length === 0) {
          startBrace = char
        }
        bracketStack.push(char)
        debugLog(state, 'extract-detail', `Push ${char}, stack: [${bracketStack.join(',')}]`)
      }
      else if (char === '}' || char === ']' || char === ')') {
        const last = bracketStack[bracketStack.length - 1]
        const isMatching = (
          (char === '}' && last === '{')
          || (char === ']' && last === '[')
          || (char === ')' && last === '(')
        )

        if (isMatching) {
          bracketStack.pop()
          debugLog(state, 'extract-detail', `Pop ${char}, stack: [${bracketStack.join(',')}]`)

          // If this completes our object
          if (bracketStack.length === 0 && startBrace === '{' && char === '}') {
            result += char
            debugLog(state, 'extract-complete', `Complete object extracted, length ${result.length}`)
            return result
          }
        }
      }
    }

    result += char
  }

  debugLog(state, 'extract-failed', `Failed with stack: [${bracketStack.join(',')}]`)
  return null
}

/**
 * Format the final output with proper spacing and organization
 */
function formatOutput(state: ProcessingState): string {
  const imports = new Set<string>()

  // Deduplicate and format imports
  state.dtsLines
    .filter(line => line.startsWith('import'))
    .forEach(imp => imports.add(imp))

  state.dtsLines = [
    ...Array.from(imports),
    '',
    ...state.dtsLines.filter(line => !line.startsWith('import')),
  ]

  // Remove comments and normalize whitespace
  return `${state.dtsLines
    .map(line => line.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''))
    .filter(Boolean)
    .join('\n')}\n`
}

/**
 * Removes leading comments from code
 */
function removeLeadingComments(code: string): string {
  const lines = code.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index].trim()
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line === '') {
      index++
    }
    else {
      break
    }
  }
  return lines.slice(index).join('\n')
}

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
    defaultExports: new Set(),
    debug: {
      exports: {
        default: [],
        named: [],
        all: [],
      },
      declarations: [],
      currentProcessing: '',
    },
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

function inferValueType(value: string, state?: ProcessingState): string {
  debugLog(state, 'type-inference', `Inferring value type from: ${value.substring(0, 50)}...`)

  if (value.startsWith('{')) {
    debugLog(state, 'type-inference', 'Value is an object literal')
    return 'Record<string, unknown>'
  }

  if (value.startsWith('[')) {
    debugLog(state, 'type-inference', 'Value is an array literal')
    return 'unknown[]'
  }

  if (value.startsWith('\'') || value.startsWith('"')) {
    debugLog(state, 'type-inference', 'Value is a string literal')
    return 'string'
  }

  if (!Number.isNaN(Number(value))) {
    debugLog(state, 'type-inference', 'Value is a number literal')
    return 'number'
  }

  if (value === 'true' || value === 'false') {
    debugLog(state, 'type-inference', 'Value is a boolean literal')
    return 'boolean'
  }

  if (value.includes('=>')) {
    debugLog(state, 'type-inference', 'Value is a function')
    return '(...args: any[]) => unknown'
  }

  debugLog(state, 'type-inference', 'Value is an unknown literal')
  return 'unknown'
}

/**
 * Infer array type from array literal with support for nested arrays and mixed elements
 */
function inferArrayType(value: string, preserveLiterals = true, state?: ProcessingState): string {
  const content = extractNestedContent(value, '[', ']')
  if (!content)
    return 'unknown[]'

  const elements = splitArrayElements(content)
  if (!elements.length)
    return 'unknown[]'

  const types = elements.map((element) => {
    const trimmed = element.trim()

    if (trimmed.startsWith('[')) {
      return inferArrayType(trimmed, preserveLiterals)
    }

    if (trimmed.startsWith('{')) {
      return inferObjectType(trimmed, state)
    }

    if (preserveLiterals) {
      if (trimmed.startsWith('\'') || trimmed.startsWith('"'))
        return trimmed
      if (!Number.isNaN(Number(trimmed)))
        return trimmed
      if (trimmed === 'true' || trimmed === 'false')
        return trimmed
    }

    return inferValueType(trimmed)
  })

  const uniqueTypes = Array.from(new Set(types))
  return uniqueTypes.length === 1 ? `${uniqueTypes[0]}[]` : `Array<${uniqueTypes.join(' | ')}>`
}

/**
 * Enhanced object type inference
 */
function inferObjectType(content: string, state?: ProcessingState): string {
  const propertyRegex = /(\w+|'[^']+'|"[^"]+")\s*:\s*([^,}]+)/g
  const properties = []
  let match

  debugLog(state, 'infer-detail', 'Starting property extraction')
  while ((match = propertyRegex.exec(content)) !== null) {
    const [, key, value] = match
    debugLog(state, 'infer-detail', `Found property ${key}: ${value.trim()}`)
    properties.push({ key, value: value.trim() })
  }

  const typeEntries = properties.map(({ key, value }) => {
    const cleanKey = key.replace(/^['"]|['"]$/g, '')
    const formattedKey = /^[a-z_$][\w$]*$/i.test(cleanKey) ? cleanKey : `'${cleanKey}'`

    let type = value
    if (value.startsWith('['))
      type = inferArrayType(value, true)
    else if (value.startsWith('{'))
      type = inferObjectType(value, state)
    else if (value.includes('=>'))
      type = '() => void'
    else if (/^['"`]/.test(value))
      type = value
    else if (value === 'true' || value === 'false')
      type = value
    else if (!Number.isNaN(Number(value)))
      type = value
    else type = inferValueType(value)

    debugLog(state, 'infer-detail', `Inferred ${formattedKey}: ${type}`)
    return `${formattedKey}: ${type}`
  })

  return `{\n  ${typeEntries.join(';\n  ')}\n}`
}

function inferComplexObjectType(value: string, state?: ProcessingState): string {
  debugLog(state, 'infer-object', `Starting type inference for object of length ${value.length}`)
  const cleanValue = value.trim()

  if (cleanValue === '{}') {
    debugLog(state, 'infer-object', 'Empty object detected')
    return '{}'
  }

  const extracted = extractCompleteObject(cleanValue, state)
  if (!extracted) {
    debugLog(state, 'infer-object', 'Failed to extract complete object')
    return 'Record<string, unknown>'
  }

  try {
    debugLog(state, 'infer-object', 'Splitting object properties')
    const properties = splitObjectProperties(extracted.slice(1, -1), state)
    debugLog(state, 'infer-object', `Found ${properties.length} properties`)

    const typeEntries = properties.map((prop, index) => {
      const colonIndex = prop.indexOf(':')
      if (colonIndex === -1)
        return null

      const key = prop.slice(0, colonIndex).trim()
      const value = prop.slice(colonIndex + 1).trim()

      const cleanKey = key.replace(/^['"]|['"]$/g, '')
      const formattedKey = /^[a-z_$][\w$]*$/i.test(cleanKey) ? cleanKey : `'${cleanKey}'`

      debugLog(state, 'infer-object-property', `Processing property ${index + 1}: ${formattedKey}`)
      const cleanValue = value.replace(/,$/, '').trim()

      let type: string
      if (cleanValue.startsWith('[')) {
        type = inferArrayType(cleanValue, true)
      }
      else if (cleanValue.startsWith('{')) {
        type = inferComplexObjectType(cleanValue, state)
      }
      else if (cleanValue.includes('=>')) {
        type = '() => void'
      }
      else if (/^['"`]/.test(cleanValue)) {
        type = cleanValue
      }
      else if (!Number.isNaN(Number(cleanValue))) {
        type = cleanValue
      }
      else if (cleanValue === 'true' || cleanValue === 'false') {
        type = cleanValue
      }
      else {
        type = inferValueType(cleanValue)
      }

      return `${formattedKey}: ${type}`
    }).filter(Boolean)

    const result = `{\n  ${typeEntries.join(';\n  ')}\n}`
    debugLog(state, 'infer-object', `Type inference complete: ${result}`)
    return result
  }
  catch (error) {
    debugLog(state, 'infer-object-error', `Failed to infer complex object type: ${error}`)
    return 'Record<string, unknown>'
  }
}

/**
 * Check if a line is a JSDoc comment
 */
export function isJSDocComment(line: string): boolean {
  const trimmed = line.trim()
  const isJsDoc = trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/')
  return isJsDoc
}

export function isDefaultExport(line: string): boolean {
  // Handle both inline and multi-line default exports
  return line.trim().startsWith('export default')
}

export function isDeclarationStart(line: string): boolean {
  return (
    line.startsWith('export ')
    || line.startsWith('interface ')
    || line.startsWith('type ')
    || line.startsWith('const ')
    || line.startsWith('function ')
    || line.startsWith('async function ')
    || line.startsWith('declare ')
    || line.startsWith('declare module')
    || /^export\s+(?:interface|type|const|function|async\s+function)/.test(line)
    || line.startsWith('export async function')
  )
}

/**
 * Check if a given type string represents a function type
 */
export function isFunctionType(type: string): boolean {
  const functionTypeRegex = /^\s*\(.*\)\s*=>\s*(?:\S.*|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])$/
  return functionTypeRegex.test(type.trim())
}

/**
 * Check if a declaration is complete by examining its content
 * @param content - Content to check, either as a string or array of lines
 */
export function isDeclarationComplete(content: string | string[]): boolean {
  const fullContent = Array.isArray(content) ? content.join('\n') : content
  const trimmedContent = fullContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim()
  return /;\s*$/.test(trimmedContent) || /\}\s*$/.test(trimmedContent)
}

/**
 * Process type declarations
 */
export function processBlock(lines: string[], comments: string[], state: ProcessingState): void {
  const declarationText = lines.join('\n')
  const cleanedDeclaration = removeLeadingComments(declarationText).trimStart()

  if (
    cleanedDeclaration.startsWith('interface')
    || cleanedDeclaration.startsWith('export interface')
    || cleanedDeclaration.startsWith('type')
    || cleanedDeclaration.startsWith('export type')
  ) {
    // Process the declaration while preserving all formatting and comments
    const isInterface = cleanedDeclaration.startsWith('interface') || cleanedDeclaration.startsWith('export interface')
    const isExported = declarationText.trimStart().startsWith('export')

    const processed = isInterface
      ? processInterface(declarationText, isExported)
      : processType(declarationText, isExported)

    state.dtsLines.push(processed)
    return
  }

  const jsdocComments = comments.filter(isJSDocComment)
  if (jsdocComments.length > 0) {
    state.dtsLines.push(...jsdocComments.map(comment => comment.trimEnd()))
  }

  const cleanedLines = lines.map((line) => {
    const commentIndex = line.indexOf('//')
    return commentIndex !== -1 ? line.substring(0, commentIndex).trim() : line
  }).filter(Boolean)

  const declaration = cleanedLines.join('\n').trim()
  if (!declaration) {
    return
  }

  const declarationWithoutComments = removeLeadingComments(declaration).trimStart()
  processSpecificDeclaration(declarationWithoutComments, declaration, state)
}

export function processSpecificDeclaration(declarationWithoutComments: string, fullDeclaration: string, state: ProcessingState): void {
  state.debug.currentProcessing = declarationWithoutComments
  debugLog(state, 'processing', `Processing declaration: ${declarationWithoutComments.substring(0, 100)}...`)

  if (declarationWithoutComments.startsWith('export default')) {
    debugLog(state, 'default-export', `Found default export: ${declarationWithoutComments}`)

    // Store the complete default export statement
    const defaultExport = declarationWithoutComments.endsWith(';')
      ? declarationWithoutComments
      : `${declarationWithoutComments};`

    state.defaultExports.add(defaultExport)
    debugLog(state, 'default-export', `Added to default exports: ${defaultExport}`)
    return
  }

  if (declarationWithoutComments.startsWith('declare module')) {
    debugLog(state, 'module-declaration', `Found module declaration: ${declarationWithoutComments}`)
    const processed = processModule(fullDeclaration)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('export const')
    || declarationWithoutComments.startsWith('const')
  ) {
    debugLog(state, 'variable-declaration', `Found const declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.trimStart().startsWith('export')
    const processed = processVariable(fullDeclaration, isExported, state)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('interface')
    || declarationWithoutComments.startsWith('export interface')
  ) {
    debugLog(state, 'interface-declaration', `Found interface declaration: ${declarationWithoutComments}`)
    const processed = processInterface(
      fullDeclaration,
      declarationWithoutComments.startsWith('export'),
    )
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('type')
    || declarationWithoutComments.startsWith('export type')
  ) {
    debugLog(state, 'type-declaration', `Found type declaration: ${declarationWithoutComments}`)
    const processed = processType(
      fullDeclaration,
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
    debugLog(state, 'function-declaration', `Found function declaration: ${declarationWithoutComments}`)

    const processed = processFunction(
      fullDeclaration,
      state.usedTypes,
      declarationWithoutComments.startsWith('export'),
    )
    state.dtsLines.push(processed)
    return
  }

  if (declarationWithoutComments.startsWith('export *')) {
    state.exportAllStatements.push(declarationWithoutComments)
    debugLog(state, 'export-all-declaration', `Found export all declaration: ${declarationWithoutComments}`)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (declarationWithoutComments.startsWith('export {')) {
    debugLog(state, 'export-declaration', `Found export declaration: ${declarationWithoutComments}`)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (declarationWithoutComments.startsWith('export type {')) {
    debugLog(state, 'export-type-declaration', `Found export type declaration: ${declarationWithoutComments}`)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (
    declarationWithoutComments.startsWith('class')
    || declarationWithoutComments.startsWith('export class')
    || declarationWithoutComments.startsWith('abstract class')
    || declarationWithoutComments.startsWith('export abstract class')
  ) {
    debugLog(state, 'class-declaration', `Found class declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('enum')
    || declarationWithoutComments.startsWith('export enum')
    || declarationWithoutComments.startsWith('const enum')
    || declarationWithoutComments.startsWith('export const enum')
  ) {
    debugLog(state, 'enum-declaration', `Found enum declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('namespace')
    || declarationWithoutComments.startsWith('export namespace')
  ) {
    debugLog(state, 'namespace-declaration', `Found namespace declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('let')
    || declarationWithoutComments.startsWith('export let')
    || declarationWithoutComments.startsWith('var')
    || declarationWithoutComments.startsWith('export var')
  ) {
    debugLog(state, 'variable-declaration', `Found variable declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    state.dtsLines.push(processed)
    return
  }

  console.warn('Unhandled declaration type:', declarationWithoutComments.split('\n')[0])
}

// Modify processSourceFile to properly collect comments and match processBlock signature
export function processSourceFile(content: string, state: ProcessingState): void {
  const lines = content.split('\n')
  let currentBlock: string[] = []
  let currentComments: string[] = []
  let inComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Handle multi-line comments
    if (line.startsWith('/*')) {
      inComment = true
      currentComments.push(line)
      continue
    }
    if (inComment) {
      currentComments.push(line)
      if (line.endsWith('*/')) {
        inComment = false
      }
      continue
    }

    // Handle single line comments
    if (line.startsWith('//')) {
      currentComments.push(line)
      continue
    }

    // Start a new block on exports/declarations
    if (line.includes('export') || line.includes('const') || line.includes('let') || line.includes('var')) {
      if (currentBlock.length > 0) {
        processBlock(currentBlock, currentComments, state)
        currentBlock = []
        currentComments = []
      }
      currentBlock.push(lines[i])
    }
    // Add to current block
    else if (currentBlock.length > 0) {
      // Only add non-empty lines
      if (line) {
        currentBlock.push(lines[i])
      }
    }
  }

  // Process any remaining block
  if (currentBlock.length > 0) {
    processBlock(currentBlock, currentComments, state)
  }
}

export function processValue(value: string, state: ProcessingState): {
  type: string
  nested?: PropertyInfo[]
  method?: MethodSignature
} {
  const trimmed = value.trim()
  debugLog(state, 'value-processing', `Processing value: ${trimmed.substring(0, 50)}...`)

  // Handle method declarations
  if (trimmed.includes('(') && !trimmed.startsWith('(')) {
    debugLog(state, 'value-processing', 'Attempting to parse method signature')
    const methodSig = parseMethodSignature(trimmed)
    if (methodSig) {
      const { async, generics, params, returnType } = methodSig
      const genericPart = generics ? `<${generics}>` : ''
      const returnTypePart = returnType || 'void'
      const type = `${async ? 'async ' : ''}${genericPart}(${params}) => ${returnTypePart}`
      debugLog(state, 'value-processing', `Parsed method type: ${type}`)
      return { type, method: methodSig }
    }
  }

  // Handle object literals
  if (trimmed.startsWith('{')) {
    debugLog(state, 'value-processing', 'Processing object literal')
    const nestedProperties = extractObjectProperties(trimmed, state)
    const type = `{ ${nestedProperties.map(p => `${p.key}: ${p.type}`).join('; ')} }`
    debugLog(state, 'value-processing', `Processed object type with ${nestedProperties.length} properties`)
    return {
      type,
      nested: nestedProperties,
    }
  }

  // Handle arrays
  if (trimmed.startsWith('[')) {
    debugLog(state, 'value-processing', 'Processing array type')
    const elementTypes = inferArrayType(trimmed)
    debugLog(state, 'value-processing', `Inferred array type: ${elementTypes}`)
    return { type: elementTypes }
  }

  // Handle functions
  if (trimmed.startsWith('(') || trimmed.startsWith('function') || trimmed.includes('=>')) {
    debugLog(state, 'value-processing', 'Processing function type')
    return { type: '(...args: any[]) => unknown' }
  }

  // Handle string literals
  if (/^['"`]/.test(trimmed)) {
    debugLog(state, 'value-processing', 'Processing string literal')
    return { type: trimmed }
  }

  // Handle number literals
  if (!Number.isNaN(Number(trimmed))) {
    debugLog(state, 'value-processing', 'Processing number literal')
    return { type: trimmed }
  }

  // Handle boolean literals
  if (trimmed === 'true' || trimmed === 'false') {
    debugLog(state, 'value-processing', 'Processing boolean literal')
    return { type: trimmed }
  }

  // Handle method calls
  if (trimmed.includes('.') && trimmed.includes('(')) {
    debugLog(state, 'value-processing', 'Processing method call')
    return { type: '() => void' }
  }

  // Handle property access
  if (trimmed.includes('.')) {
    debugLog(state, 'value-processing', 'Processing property access')
    return { type: 'unknown' }
  }

  // Handle identifiers
  if (/^[a-z_$][\w$]*$/i.test(trimmed)) {
    debugLog(state, 'value-processing', 'Processing identifier')
    return { type: 'unknown' }
  }

  debugLog(state, 'value-processing', 'Falling back to unknown type')
  return { type: 'unknown' }
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

function processType(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0].trim()

  // Preserve direct type exports
  if (firstLine.startsWith('export type {')) {
    return declaration
  }

  // Only modify the first line
  const prefix = isExported ? 'export declare' : 'declare'
  const modifiedFirstLine = lines[0].replace(
    /^(\s*)(?:export\s+)?type(?!\s*\{)/,
    `$1${prefix} type`,
  )

  // Return original declaration with only the first line modified
  return [modifiedFirstLine, ...lines.slice(1)].join('\n')
}

/**
 * Process variable (const, let, var)  declarations with type inference
 */
export function processVariable(declaration: string, isExported: boolean, state: ProcessingState): string {
  debugLog(state, 'process-variable', `Processing declaration: ${declaration.substring(0, 100)}...`)
  const cleanDeclaration = removeLeadingComments(declaration).trim()

  const typeMatch = cleanDeclaration.match(/(?:export\s+)?(?:const|let|var)\s+([^:\s]+)\s*:\s*([^=]+)=/)
  if (typeMatch) {
    const [, name, type] = typeMatch
    debugLog(state, 'process-variable', `Found explicit type for ${name}: ${type}`)
    return `${isExported ? 'export ' : ''}declare const ${name}: ${type.trim()};`
  }

  const nameMatch = cleanDeclaration.match(/(?:export\s+)?(?:const|let|var)\s+([^=\s]+)\s*=\s*(.+)$/s)
  if (!nameMatch) {
    debugLog(state, 'process-variable', 'Failed to match variable declaration')
    return declaration
  }

  const [, name, value] = nameMatch
  const trimmedValue = value.trim()
  debugLog(state, 'process-variable', `Processing ${name} with value length ${trimmedValue.length}`)

  let type: string
  if (trimmedValue.startsWith('{')) {
    debugLog(state, 'process-variable', `Inferring complex object type for ${name}`)
    type = inferComplexObjectType(trimmedValue, state)
  }
  else {
    debugLog(state, 'process-variable', `Inferring value type for ${name}`)
    type = inferValueType(trimmedValue)
  }

  const result = `${isExported ? 'export ' : ''}declare const ${name}: ${type};`
  debugLog(state, 'process-variable', `Generated declaration: ${result}`)
  return result
}

/**
 * Process function declarations with overloads
 */
export function processFunction(
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
function processInterface(declaration: string, isExported = true): string {
  // Split into lines while preserving all formatting and comments
  const lines = declaration.split('\n')

  // Only modify the first line to add necessary keywords
  const firstLine = lines[0]
  const prefix = isExported ? 'export declare' : 'declare'

  // Replace only the 'interface' or 'export interface' part
  const modifiedFirstLine = firstLine.replace(
    /^(\s*)(?:export\s+)?interface/,
    `$1${prefix} interface`,
  )

  // Return original declaration with only the first line modified
  return [modifiedFirstLine, ...lines.slice(1)].join('\n')
}

function processModule(declaration: string): string {
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

export function processObjectProperties(declaration: string, state: ProcessingState): PropertyInfo[] {
  debugLog(state, 'property-processing', `Processing object: ${declaration}`)

  const content = declaration.slice(1, -1).trim()
  debugLog(state, 'property-processing', `Content without braces: ${content}`)

  const parts = splitObjectProperties(content, state)
  const properties: PropertyInfo[] = []

  for (const part of parts) {
    const colonIndex = part.indexOf(':')
    if (colonIndex === -1)
      continue

    let key = part.slice(0, colonIndex).trim()
    const value = part.slice(colonIndex + 1).trim()

    // Keep original quoting for key if it exists
    const keyQuoted = /^['"].*['"]$/.test(key)
    key = key.replace(/^['"]|['"]$/g, '')
    const finalKey = keyQuoted ? `'${key}'` : key

    debugLog(state, 'property-processing', `Processing "${key}" with value: ${value}`)

    let type: string
    if (value.startsWith('[')) {
      type = inferArrayType(value, true)
    }
    else if (value.startsWith('{')) {
      type = inferObjectType(value, state)
    }
    else if (value.includes('=>')) {
      type = '(...args: unknown[]) => unknown'
    }
    else if (/^['"`]/.test(value)) {
      type = value // Preserve string literals
    }
    else if (!Number.isNaN(Number(value))) {
      type = value // Preserve number literals
    }
    else if (value === 'true' || value === 'false') {
      type = value // Preserve boolean literals
    }
    else {
      type = inferValueType(value)
    }

    debugLog(state, 'property-processing', `Inferred type for "${key}": ${type}`)
    properties.push({ key: finalKey, value, type })
  }

  return properties
}

export function processProperty(prop: string, state?: ProcessingState): PropertyInfo | null {
  debugLog(state, 'property-processing-detail', `Processing raw property: ${prop}`)

  const colonIndex = prop.indexOf(':')
  if (colonIndex === -1) {
    debugLog(state, 'property-processing-detail', 'No colon found in property')
    return null
  }

  const key = prop.slice(0, colonIndex).trim().replace(/^['"]|['"]$/g, '')
  const value = prop.slice(colonIndex + 1).trim()

  debugLog(state, 'property-processing-detail', `Key: "${key}", Value: "${value.slice(0, 50)}..."`)

  let type: string
  if (value.startsWith('[')) {
    type = inferArrayType(value, true)
    debugLog(state, 'property-processing-detail', `Array type inferred: ${type}`)
  }
  else if (value.startsWith('{')) {
    type = inferObjectType(value, state)
    debugLog(state, 'property-processing-detail', `Object type inferred: ${type}`)
  }
  else if (value.includes('=>')) {
    type = '(...args: unknown[]) => unknown'
    debugLog(state, 'property-processing-detail', `Function type inferred`)
  }
  else if (/^['"`]/.test(value)) {
    type = value
    debugLog(state, 'property-processing-detail', `String literal preserved`)
  }
  else if (!Number.isNaN(Number(value))) {
    type = value
    debugLog(state, 'property-processing-detail', `Number literal preserved`)
  }
  else if (value === 'true' || value === 'false') {
    type = value
    debugLog(state, 'property-processing-detail', `Boolean literal preserved`)
  }
  else {
    type = inferValueType(value)
    debugLog(state, 'property-processing-detail', `Value type inferred: ${type}`)
  }

  return { key, value, type }
}

const REGEX = {
  typePattern: /(?:typeof\s+)?([A-Z]\w*(?:<[^>]+>)?)|extends\s+([A-Z]\w*(?:<[^>]+>)?)/g,
} as const

/**
 * Track used types in declarations
 */
function trackUsedTypes(content: string, usedTypes: Set<string>): void {
  let match: any
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

function debugLog(state: ProcessingState | undefined, category: string, message: string): void {
  // eslint-disable-next-line no-console
  console.debug(`[dtsx:${category}] ${message}`)

  // Track in debug state
  if (category === 'default-export') {
    state?.debug.exports.default.push(message)
  }
  else if (category === 'named-export') {
    state?.debug.exports.named.push(message)
  }
  else if (category === 'declaration') {
    state?.debug.declarations.push(message)
  }
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

/**
 * Normalizes type references by cleaning up whitespace
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
function splitArrayElements(content: string, state?: ProcessingState): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let inTemplate = false

  debugLog(state, 'array-split', `Splitting array elements of length ${content.length}`)

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = content[i - 1]

    // Handle template literals
    if (char === '`' && prevChar !== '\\') {
      inTemplate = !inTemplate
      current += char
      continue
    }

    // Handle string literals
    if (!inTemplate && (char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
        debugLog(state, 'array-split', `String start at ${i}`)
      }
      else if (char === stringChar) {
        inString = false
        debugLog(state, 'array-split', `String end at ${i}`)
      }
    }

    if (!inString && !inTemplate) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
        debugLog(state, 'array-split', `Nesting increased to ${depth}`)
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
        debugLog(state, 'array-split', `Nesting decreased to ${depth}`)
      }
      else if (char === ',' && depth === 0) {
        if (current.trim()) {
          debugLog(state, 'array-split', `Found element: ${current.trim().substring(0, 50)}...`)
          elements.push(current.trim())
        }
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    debugLog(state, 'array-split', `Adding final element: ${current.trim().substring(0, 50)}...`)
    elements.push(current.trim())
  }

  debugLog(state, 'array-split', `Split complete, found ${elements.length} elements`)
  return elements
}

function splitObjectProperties(content: string, state?: ProcessingState): string[] {
  debugLog(state, 'split-props', `Splitting properties of length ${content.length}`)
  const properties: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let inTemplate = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    // Handle strings
    if (!inTemplate && (char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
      current += char
      continue
    }

    // Handle template literals
    if (char === '`' && prevChar !== '\\') {
      inTemplate = !inTemplate
      current += char
      continue
    }

    if (!inString && !inTemplate) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
      }
      else if (char === ',' && depth === 0) {
        if (current.trim()) {
          properties.push(current.trim())
          debugLog(state, 'split-props', `Found property: ${current.trim()}`)
        }
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    properties.push(current.trim())
    debugLog(state, 'split-props', `Found final property: ${current.trim()}`)
  }

  debugLog(state, 'split-props', `Found ${properties.length} properties`)
  return properties
}
