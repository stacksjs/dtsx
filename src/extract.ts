/* eslint-disable regexp/no-super-linear-backtracking, no-cond-assign, regexp/no-misleading-capturing-group */
import type { FunctionSignature, ImportTrackingState, ProcessingState } from './types'

interface MethodParsingResult {
  name: string
  isAsync: boolean
  typeParams: string
  params: string
  returnType: string
}

interface ProcessedMethod {
  name: string
  signature: string
}

function cleanParameterTypes(params: string): string {
  if (!params.trim())
    return ''

  // Split parameters by comma, handling nested structures
  let depth = 0
  let inString = false
  let stringChar = ''
  let currentParam = ''
  const cleanParams: string[] = []

  for (let i = 0; i < params.length; i++) {
    const char = params[i]
    const prevChar = i > 0 ? params[i - 1] : ''

    // Handle strings
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
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
      if (char === '{' || char === '<' || char === '(') {
        depth++
      }
      else if (char === '}' || char === '>' || char === ')') {
        depth--
      }
      else if (char === ',' && depth === 0) {
        cleanParams.push(cleanParameter(currentParam.trim()))
        currentParam = ''
        continue
      }
    }

    currentParam += char
  }

  if (currentParam.trim()) {
    cleanParams.push(cleanParameter(currentParam.trim()))
  }

  return cleanParams.join(', ')
}

function cleanParameter(param: string): string {
  // Handle parameters with type annotations
  const typeMatch = param.match(/^([^:]+):\s*([^=]+)(?:\s*=\s*.+)?$/)
  if (typeMatch) {
    const [, paramName, paramType] = typeMatch
    return `${paramName.trim()}: ${paramType.trim()}`
  }

  // Handle parameters with default values but no explicit type
  const defaultMatch = param.match(/^([^=]+)\s*=\s*(.+)$/)
  if (defaultMatch) {
    const [, paramName, defaultValue] = defaultMatch
    const inferredType = inferTypeFromDefaultValue(defaultValue.trim())
    return `${paramName.trim()}: ${inferredType}`
  }

  // For simple parameters with no type or default
  return param.replace(/\s*=\s*(['"].*?['"]|\{.*?\}|\[.*?\]|\d+|true|false)/g, '')
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

function extractBalancedSymbols(text: string, openSymbol: string, closeSymbol: string, state?: ProcessingState): { content: string, rest: string } | null {
  debugLog(state, 'balance', `Extracting balanced ${openSymbol}${closeSymbol} from text length ${text.length}`)

  let depth = 0
  let inString = false
  let stringChar = ''
  let start = -1
  let buffer = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const prevChar = i > 0 ? text[i - 1] : ''

    // Handle strings
    if ((char === '"' || char === '\'') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
        debugLog(state, 'balance-detail', `String start at ${i}`)
      }
      else if (char === stringChar) {
        inString = false
        debugLog(state, 'balance-detail', `String end at ${i}`)
      }
    }

    // Track symbols only when not in strings
    if (!inString) {
      if (char === openSymbol) {
        if (start === -1)
          start = i
        depth++
        debugLog(state, 'balance-detail', `Depth increased to ${depth} at ${i}`)
      }
      else if (char === closeSymbol) {
        depth--
        debugLog(state, 'balance-detail', `Depth decreased to ${depth} at ${i}`)

        if (depth === 0 && start !== -1) {
          buffer = text.slice(start, i + 1)
          const rest = text.slice(i + 1)
          debugLog(state, 'balance', `Extracted balanced content length ${buffer.length}`)
          return { content: buffer, rest }
        }
      }
    }
  }

  debugLog(state, 'balance', `Failed to find balanced symbols, depth: ${depth}`)
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

function extractFunctionType(value: string, state?: ProcessingState): string | null {
  debugLog(state, 'extract-function', `Extracting function type from: ${value}`)

  const cleanValue = value.trim()

  // Handle explicit return type annotations
  const returnTypeMatch = cleanValue.match(/\):\s*([^{;]+)(?:\s*[{;]|$)/)
  let returnType = returnTypeMatch ? normalizeType(returnTypeMatch[1]) : 'unknown'

  // Check value contents for return type inference
  if (returnType === 'unknown') {
    if (cleanValue.includes('toISOString()')) {
      returnType = 'string'
    }
    else if (cleanValue.includes('Intl.NumberFormat') && cleanValue.includes('format')) {
      returnType = 'string'
    }
    else if (cleanValue.includes('console.log')) {
      returnType = 'void'
    }
  }

  // Handle arrow functions with explicit parameter types
  const arrowMatch = value.match(/^\((.*?)\)\s*=>\s*(.*)/)
  if (arrowMatch) {
    const [, params] = arrowMatch
    // Clean parameters while preserving type annotations
    const cleanParams = cleanParameterTypes(params || '')
    return `(${cleanParams}) => ${returnType}`
  }

  // Handle function keyword with explicit parameter types
  const funcMatch = value.match(/^function\s*\w*\s*\((.*?)\)/)
  if (funcMatch) {
    const [, params] = funcMatch
    const cleanParams = cleanParameterTypes(params || '')
    return `(${cleanParams}) => ${returnType}`
  }

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

function getDeclarationType(declaration: string): string {
  if (declaration.includes('const '))
    return 'const'
  if (declaration.includes('let '))
    return 'let'
  return 'var'
}

function extractCompleteObjectContent(value: string, state?: ProcessingState): string | null {
  debugLog(state, 'extract-object', `Processing object of length ${value.length}`)
  const fullContent = value.trim()

  // Must start with an object
  if (!fullContent.startsWith('{')) {
    return null
  }

  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < fullContent.length; i++) {
    const char = fullContent[i]
    const prevChar = i > 0 ? fullContent[i - 1] : ''

    // Handle string boundaries
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
      continue
    }

    // Track depth when not in string
    if (!inString) {
      if (char === '{') {
        depth++
      }
      else if (char === '}') {
        depth--
        if (depth === 0) {
          return fullContent.slice(0, i + 1)
        }
      }
    }
  }

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

function parseMethodSignature(declaration: string): MethodParsingResult | null {
  debugLog(undefined, 'method-parse', `Parsing method signature: ${declaration}`)

  // Handle async methods
  const isAsync = declaration.startsWith('async ')
  const cleanDeclaration = declaration.replace(/^async\s+/, '')

  // Extract method name and type parameters
  const nameMatch = cleanDeclaration.match(/^([^(<\s]+)/)
  if (!nameMatch)
    return null

  const name = nameMatch[1]
  let rest = cleanDeclaration.slice(name.length)

  // Extract type parameters if present
  let typeParams = ''
  if (rest.startsWith('<')) {
    const genericsResult = extractBalancedSymbols(rest, '<', '>')
    if (genericsResult) {
      typeParams = genericsResult.content
      rest = genericsResult.rest
    }
  }

  // Extract parameters with type preservation
  const paramsResult = extractBalancedSymbols(rest, '(', ')')
  if (!paramsResult)
    return null

  // Get raw parameters and clean them
  const rawParams = paramsResult.content.slice(1, -1)
  const params = cleanParameterTypes(rawParams)
  rest = paramsResult.rest.trim()

  // Extract return type
  let returnType = 'void'
  if (rest.startsWith(':')) {
    const match = rest.match(/^:\s*([^{;]+)/)
    if (match)
      returnType = match[1].trim()
  }

  return {
    name,
    isAsync,
    typeParams,
    params,
    returnType: normalizeType(returnType),
  }
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

function indentMultilineType(type: string, baseIndent: string, isLast: boolean): string {
  const lines = type.split('\n')
  return lines
    .map((line, i) => {
      if (i === 0)
        return `${baseIndent}${line}`
      const trimmed = line.trim()
      if (!trimmed)
        return ''
      return `${baseIndent}  ${trimmed}`
    })
    .filter(Boolean)
    .join('\n') + (isLast ? '' : ' |')
}

function inferValueType(value: string): string {
  value = value.trim()

  // For string literals, return the literal itself as the type
  if (/^['"`].*['"`]$/.test(value)) {
    return value
  }

  // For numeric literals
  if (!Number.isNaN(Number(value))) {
    return value
  }

  // For boolean literals
  if (value === 'true' || value === 'false') {
    return value
  }

  // For function expressions
  if (value.includes('=>')) {
    return '(...args: any[]) => unknown'
  }

  return 'unknown'
}

/**
 * Infer array type from array literal with support for nested arrays and mixed elements
 */
function inferArrayType(value: string, state?: ProcessingState, indentLevel = 0): string {
  debugLog(state, 'infer-array', `Inferring array type for: ${value}`)
  const content = value.slice(1, -1).trim()
  if (!content)
    return 'unknown[]'

  const baseIndent = '  '.repeat(indentLevel)
  const elementIndent = '  '.repeat(indentLevel + 1)

  // Handle const assertions first
  const elements = splitArrayElements(content, state)
  const allConstTuples = elements.every(el => el.trim().endsWith('as const'))

  if (allConstTuples) {
    const tuples = elements.map((el) => {
      const tupleContent = el.slice(0, el.indexOf('as const')).trim()
      return inferConstArrayType(tupleContent, state)
    })
    return `Array<${tuples.join(' | ')}>`
  }

  // Process each element
  const elementTypes = elements.map((element) => {
    const trimmed = element.trim()

    // Handle nested arrays
    if (trimmed.startsWith('[')) {
      return inferArrayType(trimmed, state, indentLevel + 1)
    }

    // Handle objects with proper indentation
    if (trimmed.startsWith('{')) {
      return inferComplexObjectType(trimmed, state, indentLevel + 1)
    }

    // Handle function expressions - always parenthesize
    if (trimmed.includes('=>') || trimmed.includes('function')) {
      const funcType = extractFunctionType(trimmed, state)
      return funcType ? `(${funcType})` : '((...args: any[]) => unknown)'
    }

    // Handle method/function references
    if (trimmed.includes('.') || /\w+\(/.test(trimmed)) {
      return 'unknown'
    }

    // Handle other literals
    return normalizeTypeReference(trimmed)
  })

  // Format the array type with proper indentation
  const types = elementTypes.filter(Boolean)
  if (types.length === 0)
    return 'unknown[]'

  // Check if we need multiline formatting
  const needsMultiline = types.some(type =>
    type.includes('\n')
    || type.includes('{')
    || type.length > 40
    || types.join(' | ').length > 60,
  )

  if (needsMultiline) {
    const formattedTypes = types.map((type, index) => {
      const isLast = index === types.length - 1
      // For types that contain newlines
      if (type.includes('\n')) {
        return indentMultilineType(type, elementIndent, isLast)
      }
      // For single-line types
      return `${elementIndent}${type}${isLast ? '' : ' |'}`
    })

    return `Array<\n${formattedTypes.join('\n')}\n${baseIndent}>`
  }

  return `Array<${types.join(' | ')}>`
}

/**
 * Process object properties with improved formatting
 */
function inferComplexObjectType(value: string, state?: ProcessingState, indentLevel = 0): string {
  debugLog(state, 'infer-complex', `Inferring type for object of length ${value.length}`)

  const content = extractCompleteObjectContent(value, state)
  if (!content)
    return 'Record<string, unknown>'

  const baseIndent = '  '.repeat(indentLevel)
  const propIndent = '  '.repeat(indentLevel + 1)
  const innerIndent = '  '.repeat(indentLevel + 2)

  const props = processObjectProperties(content, state)
  if (!props.length)
    return '{}'

  const propertyStrings = props.map(({ key, value }) => {
    const formattedKey = /^\w+$/.test(key) ? key : `'${key}'`

    if (value.includes('\n')) {
      // Indent nested multiline values
      const indentedValue = value
        .split('\n')
        .map((line, i) => {
          if (i === 0)
            return line
          const trimmed = line.trim()
          if (!trimmed)
            return ''
          return `${innerIndent}${trimmed}`
        })
        .filter(Boolean)
        .join('\n')
      return `${propIndent}${formattedKey}: ${indentedValue}`
    }

    return `${propIndent}${formattedKey}: ${value}`
  })

  return `{\n${propertyStrings.join(';\n')}\n${baseIndent}}`
}

function inferConstArrayType(value: string, state?: ProcessingState): string {
  debugLog(state, 'infer-const', `Inferring const array type for: ${value}`)

  // Handle array literals
  if (value.startsWith('[')) {
    const content = value.slice(1, -1).trim()
    const elements = splitArrayElements(content, state)

    const literalTypes = elements.map((element) => {
      const trimmed = element.trim()

      // Handle nested arrays
      if (trimmed.startsWith('[')) {
        return inferConstArrayType(trimmed, state)
      }

      // Handle nested objects
      if (trimmed.startsWith('{')) {
        return inferComplexObjectType(trimmed, state)
      }

      // Preserve literals
      if (/^['"`].*['"`]$/.test(trimmed))
        return trimmed
      if (!Number.isNaN(Number(trimmed)))
        return trimmed
      if (trimmed === 'true' || trimmed === 'false')
        return trimmed

      return 'unknown'
    })

    return `readonly [${literalTypes.join(', ')}]`
  }

  return 'unknown'
}

function inferTypeFromDefaultValue(defaultValue: string): string {
  // Handle string literals
  if (/^['"`].*['"`]$/.test(defaultValue)) {
    return 'string'
  }

  // Handle numeric literals
  if (!Number.isNaN(Number(defaultValue))) {
    return 'number'
  }

  // Handle boolean literals
  if (defaultValue === 'true' || defaultValue === 'false') {
    return 'boolean'
  }

  // Handle array literals
  if (defaultValue.startsWith('[')) {
    return 'unknown[]'
  }

  // Handle object literals
  if (defaultValue.startsWith('{')) {
    return 'object'
  }

  // Handle specific known values
  if (defaultValue === 'null')
    return 'null'
  if (defaultValue === 'undefined')
    return 'undefined'

  return 'unknown'
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

function normalizeTypeReference(value: string): string {
  // Handle arrow functions and regular functions - always parenthesize
  if (value.includes('=>') || value.match(/\bfunction\b/)) {
    return '((...args: any[]) => unknown)'
  }

  // Handle function calls like someFunction()
  if (value.match(/\w+\s*\([^)]*\)/)) {
    return 'unknown'
  }

  // Handle constructor expressions like new Date()
  if (value.startsWith('new ')) {
    return 'unknown'
  }

  // Handle console.log and similar value references
  if (value.includes('.')) {
    return 'unknown'
  }

  // Handle identifier references that should be typeof
  if (/^[a-z_$][\w$]*$/i.test(value)
    && !['unknown', 'string', 'number', 'boolean', 'null', 'undefined', 'any', 'never', 'void'].includes(value)
    && !/^['"`]|^\d/.test(value)
    && value !== 'true'
    && value !== 'false') {
    return 'unknown'
  }

  return value
}

/**
 * Process type declarations
 */
export function processBlock(lines: string[], comments: string[], state: ProcessingState): void {
  const declarationText = lines.join('\n')
  const cleanDeclaration = removeLeadingComments(declarationText).trim()

  // Keep track of declaration for debugging
  state.debug.currentProcessing = cleanDeclaration
  debugLog(state, 'processing', `Processing block: ${cleanDeclaration.substring(0, 100)}...`)

  if (!cleanDeclaration) {
    debugLog(state, 'processing', 'Empty declaration block')
    return
  }

  // Handle export statements first
  if (cleanDeclaration.startsWith('export')) {
    const exportMatch = cleanDeclaration.match(/^export\s+(?:type\s+)?(\{[^}]+\})/)
    if (exportMatch) {
      state.dtsLines.push(declarationText)
      return
    }
  }

  // Process by declaration type
  if (cleanDeclaration.startsWith('const') || cleanDeclaration.startsWith('let') || cleanDeclaration.startsWith('var')
    || cleanDeclaration.startsWith('export const') || cleanDeclaration.startsWith('export let') || cleanDeclaration.startsWith('export var')) {
    const isExported = cleanDeclaration.startsWith('export')
    state.dtsLines.push(processVariable(declarationText, isExported, state))
    return
  }

  if (cleanDeclaration.startsWith('interface') || cleanDeclaration.startsWith('export interface')) {
    const isExported = cleanDeclaration.startsWith('export')
    state.dtsLines.push(processInterface(declarationText, isExported))
    return
  }

  if (cleanDeclaration.startsWith('type') || cleanDeclaration.startsWith('export type')) {
    const isExported = cleanDeclaration.startsWith('export')
    state.dtsLines.push(processType(declarationText, isExported))
    return
  }

  if (cleanDeclaration.startsWith('function') || cleanDeclaration.startsWith('export function')) {
    const isExported = cleanDeclaration.startsWith('export')
    state.dtsLines.push(processFunction(declarationText, state.usedTypes, isExported))
    return
  }

  debugLog(state, 'processing', `Unhandled declaration type: ${cleanDeclaration.split('\n')[0]}`)
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

export function processSourceFile(content: string, state: ProcessingState): void {
  const lines = content.split('\n')
  let currentBlock: string[] = []
  let currentComments: string[] = []
  let bracketDepth = 0
  let inDeclaration = false
  // let declarationStart = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Track comments
    if (trimmedLine.startsWith('/*')) {
      currentComments.push(line)
      continue
    }
    if (trimmedLine.startsWith('//')) {
      currentComments.push(line)
      continue
    }

    // Track brackets for nesting depth
    bracketDepth += (line.match(/\{/g) || []).length
    bracketDepth -= (line.match(/\}/g) || []).length

    // Handle declaration starts
    if (isDeclarationStart(trimmedLine)) {
      if (inDeclaration && currentBlock.length > 0) {
        processBlock(currentBlock, currentComments, state)
        currentBlock = []
        currentComments = []
      }
      inDeclaration = true
      // declarationStart = i
      currentBlock = [line]
      continue
    }

    // Add line to current block if in declaration
    if (inDeclaration) {
      currentBlock.push(line)

      // Check for declaration end
      const isComplete = (
        bracketDepth === 0 && (
          trimmedLine.endsWith(';')
          || trimmedLine.endsWith('}')
          || trimmedLine.endsWith(',')
          || trimmedLine.match(/\bas\s+const[,;]?$/)
        )
      )

      if (isComplete) {
        processBlock(currentBlock, currentComments, state)
        currentBlock = []
        currentComments = []
        inDeclaration = false
        // declarationStart = -1
      }
    }
  }

  // Process any remaining block
  if (currentBlock.length > 0) {
    processBlock(currentBlock, currentComments, state)
  }
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
function processVariable(declaration: string, isExported: boolean, state: ProcessingState): string {
  // Handle explicit type annotations first
  const explicitTypeMatch = declaration.match(/(?:export\s+)?(?:const|let|var)\s+([^:\s]+)\s*:\s*([^=]+)=/)
  if (explicitTypeMatch) {
    const [, name, type] = explicitTypeMatch
    debugLog(state, 'process-variable', `Found explicit type for ${name}: ${type}`)
    return `${isExported ? 'export ' : ''}declare const ${name}: ${type.trim()};`
  }

  // Handle value assignments
  const valueMatch = declaration.match(/(?:export\s+)?(?:const|let|var)\s+([^=\s]+)\s*=\s*(.+)$/s)
  if (!valueMatch) {
    debugLog(state, 'process-variable', 'Failed to match variable declaration')
    return declaration
  }

  const [, name, rawValue] = valueMatch
  const declarationType = getDeclarationType(declaration)
  const trimmedValue = rawValue.trim()

  debugLog(state, 'process-variable', `Processing ${name} with value length ${trimmedValue.length}`)

  // Handle string literals
  if (/^(['"`]).*\1$/.test(trimmedValue)) {
    // For string literals, use type annotation instead of value assignment
    return `${isExported ? 'export ' : ''}declare ${declarationType} ${name}: ${trimmedValue};`
  }

  let type: string
  if (trimmedValue.startsWith('{')) {
    type = inferComplexObjectType(trimmedValue, state)
  }
  else if (trimmedValue.startsWith('[')) {
    type = inferArrayType(trimmedValue, state)
  }
  else {
    type = inferValueType(trimmedValue)
  }

  return `${isExported ? 'export ' : ''}declare ${declarationType} ${name}: ${type};`
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

function processObjectMethod(declaration: string, value: string, state?: ProcessingState): ProcessedMethod {
  debugLog(state, 'process-method', `Processing object method: ${declaration}`)

  const methodResult = parseMethodSignature(declaration)
  if (!methodResult) {
    debugLog(state, 'process-method', 'Failed to parse method signature')
    return {
      name: declaration.split('(')[0].trim().replace(/^async\s+/, ''),
      signature: '() => unknown',
    }
  }

  const {
    name,
    isAsync,
    typeParams,
    params,
    returnType,
  } = methodResult

  // Clean parameters while preserving type annotations
  const cleanParams = cleanParameterTypes(params)
  let effectiveReturnType = normalizeType(returnType)

  // Handle special return types
  if (value.includes('throw') && !effectiveReturnType.includes('Promise')) {
    effectiveReturnType = 'never'
  }
  else if (isAsync && !effectiveReturnType.includes('Promise')) {
    effectiveReturnType = `Promise<${effectiveReturnType}>`
  }
  else if (value.includes('toISOString()') || value.includes('toString()')) {
    effectiveReturnType = 'string'
  }
  else if (value.includes('console.log') || value.match(/void\s*[;{]/)) {
    effectiveReturnType = 'void'
  }
  else if (value.includes('Intl.NumberFormat') && value.includes('format')) {
    effectiveReturnType = 'string'
  }

  // Build method type
  const signature = [
    typeParams ? typeParams.trim() : '',
    `(${cleanParams})`,
    '=>',
    effectiveReturnType,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  debugLog(state, 'process-method', `Generated method signature: ${signature}`)
  return { name, signature }
}

function processObjectProperties(content: string, state?: ProcessingState): Array<{ key: string, value: string }> {
  debugLog(state, 'process-props', `Processing properties from content length ${content.length}`)
  const properties: Array<{ key: string, value: string }> = []

  // Remove outer braces and trim
  const cleanContent = content.slice(1, -1).trim()
  if (!cleanContent)
    return properties

  let buffer = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let currentKey = ''
  let isParsingKey = true
  let inMethod = false

  for (let i = 0; i < cleanContent.length; i++) {
    const char = cleanContent[i]
    const prevChar = i > 0 ? cleanContent[i - 1] : ''

    // Handle strings
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    // Track method declarations
    if (!inString && char === '(') {
      if (depth === 0)
        inMethod = true
      depth++
    }
    else if (!inString && char === ')') {
      depth--
      if (depth === 0)
        inMethod = false
    }
    else if (!inString && (char === '{' || char === '[')) {
      depth++
    }
    else if (!inString && (char === '}' || char === ']')) {
      depth--
    }

    // Handle property separation
    if (!inString && !inMethod && depth === 0) {
      if (char === ':' && isParsingKey) {
        currentKey = buffer.trim()
        buffer = ''
        isParsingKey = false
        continue
      }
      else if (char === ',' || char === ';') {
        if (currentKey && !isParsingKey) {
          properties.push(processProperty(currentKey, buffer.trim(), state))
        }
        buffer = ''
        currentKey = ''
        isParsingKey = true
        continue
      }
    }

    buffer += char
  }

  // Handle final property
  if (currentKey && !isParsingKey && buffer.trim()) {
    properties.push(processProperty(currentKey, buffer.trim(), state))
  }

  return properties
}

function processProperty(key: string, value: string, state?: ProcessingState, indentLevel = 0): { key: string, value: string } {
  const cleanKey = key.trim().replace(/^['"](.*)['"]$/, '$1')
  const cleanValue = value.trim()

  // Handle method declarations
  if (cleanKey.includes('(')) {
    const { name, signature } = processObjectMethod(cleanKey, cleanValue, state)
    return { key: name, value: signature }
  }

  // Handle arrays with proper indentation
  if (cleanValue.startsWith('[')) {
    return {
      key: cleanKey,
      value: inferArrayType(cleanValue, state, indentLevel),
    }
  }

  // Handle object literals with proper indentation
  if (cleanValue.startsWith('{')) {
    return {
      key: cleanKey,
      value: inferComplexObjectType(cleanValue, state, indentLevel),
    }
  }

  // Handle function expressions
  if (cleanValue.includes('=>') || cleanValue.includes('function')) {
    const funcType = extractFunctionType(cleanValue, state)
    return {
      key: cleanKey,
      value: funcType || '(...args: any[]) => unknown',
    }
  }

  // Handle primitive values and literals
  if (/^(['"`]).*\1$/.test(cleanValue) || !Number.isNaN(Number(cleanValue))
    || cleanValue === 'true' || cleanValue === 'false') {
    return { key: cleanKey, value: cleanValue }
  }

  // Handle references and function calls
  if (cleanValue.includes('.') || cleanValue.includes('(')) {
    return { key: cleanKey, value: 'unknown' }
  }

  return { key: cleanKey, value: 'unknown' }
}

// Improve complex object type inference
// function inferComplexObjectType(value: string, state?: ProcessingState): string {
//   debugLog(state, 'infer-complex', `Inferring type for object of length ${value.length}`)

//   const content = extractCompleteObjectContent(value, state)
//   if (!content)
//     return 'Record<string, unknown>'

//   const props = processObjectProperties(content, state)
//   if (!props.length)
//     return '{}'

//   const propertyStrings = props.map(({ key, value }) => {
//     const formattedKey = /^\w+$/.test(key) ? key : `'${key}'`
//     const indent = '  '
//     return `${indent}${formattedKey}: ${value}`
//   })

//   return `{\n${propertyStrings.join(';\n')}\n}`
// }

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

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    // Handle strings
    if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    // Track depth when not in string
    if (!inString) {
      if (char === '[' || char === '{' || char === '(') {
        depth++
      }
      else if (char === ']' || char === '}' || char === ')') {
        depth--
      }
      else if (char === ',' && depth === 0) {
        const trimmed = current.trim()
        if (trimmed) {
          debugLog(state, 'array-split', `Found element: ${trimmed}`)
          elements.push(trimmed)
        }
        current = ''
        continue
      }
    }

    current += char
  }

  // Add final element
  const trimmed = current.trim()
  if (trimmed) {
    debugLog(state, 'array-split', `Found element: ${trimmed}`)
    elements.push(trimmed)
  }

  return elements
}
