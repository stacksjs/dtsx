/* eslint-disable regexp/no-super-linear-backtracking, no-cond-assign, regexp/no-misleading-capturing-group */
import type { FunctionSignature, ImportTrackingState, ProcessingState } from './types'

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
function inferArrayType(value: string, state?: ProcessingState): string {
  debugLog(state, 'infer-array', `Inferring array type for: ${value}`)
  const content = value.slice(1, -1).trim()
  if (!content)
    return 'unknown[]'

  // Handle 'as const' arrays
  if (content.includes('as const')) {
    const beforeConst = content.split('as const')[0].trim()
    return inferConstArrayType(beforeConst, state)
  }

  const elements = splitArrayElements(content, state)
  const types = elements.map((element) => {
    const trimmed = element.trim()

    if (trimmed.endsWith('as const')) {
      return inferConstArrayType(trimmed.slice(0, -8).trim(), state)
    }
    if (trimmed.startsWith('[')) {
      return inferArrayType(trimmed, state)
    }
    if (trimmed.startsWith('{')) {
      return inferComplexObjectType(trimmed, state)
    }
    if (/^['"`].*['"`]$/.test(trimmed))
      return trimmed
    if (!Number.isNaN(Number(trimmed)))
      return trimmed
    if (trimmed === 'true' || trimmed === 'false')
      return trimmed
    if (trimmed.includes('=>'))
      return '(...args: any[]) => unknown'

    return 'unknown'
  }).filter(Boolean)

  const uniqueTypes = Array.from(new Set(types))
  return uniqueTypes.length === 1
    ? `Array<${uniqueTypes[0]}>`
    : `Array<${uniqueTypes.join(' | ')}>`
}

function inferComplexObjectType(value: string, state?: ProcessingState): string {
  debugLog(state, 'infer-complex', `Inferring type for object of length ${value.length}`)

  const content = extractCompleteObjectContent(value, state)
  if (!content) {
    return 'Record<string, unknown>'
  }

  const props = processObjectProperties(content, state)
  if (!props.length) {
    return '{}'
  }

  const typeEntries = props.map(({ key, value }) => {
    const formattedKey = /^\w+$/.test(key) ? key : `'${key}'`
    return `${formattedKey}: ${value}`
  })

  return `{\n  ${typeEntries.join(';\n  ')}\n}`
}

function inferConstArrayType(value: string, state?: ProcessingState): string {
  debugLog(state, 'infer-const', `Inferring const array type for: ${value}`)

  // Handle nested array with const assertion
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

function processObjectProperties(content: string, state?: ProcessingState): Array<{ key: string, value: string }> {
  debugLog(state, 'process-props', `Processing properties from content length ${content.length}`)
  const properties: Array<{ key: string, value: string }> = []

  // Remove the outer braces
  const cleanContent = content.slice(1, -1).trim()
  let buffer = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let currentKey = ''
  // let parsingKey = true

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
      buffer += char
      continue
    }

    // Track depth
    if (!inString) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
      }
      else if (char === ':' && depth === 0) {
        currentKey = buffer.trim()
        buffer = ''
        // parsingKey = false
        continue
      }
      else if (char === ',' && depth === 0) {
        if (currentKey) {
          const value = buffer.trim()
          if (value) {
            properties.push(processProperty(currentKey, value, state))
          }
        }
        buffer = ''
        currentKey = ''
        // parsingKey = true
        continue
      }
    }

    buffer += char
  }

  // Handle final property
  if (currentKey && buffer.trim()) {
    properties.push(processProperty(currentKey, buffer.trim(), state))
  }

  return properties
}

/**
 * Process individual property with improved type inference
 */
function processProperty(key: string, value: string, state?: ProcessingState): { key: string, value: string } {
  const cleanKey = key.replace(/^['"`]|['"`]$/g, '')
  const cleanValue = value.trim()

  // Handle 'as const' arrays
  if (cleanValue.endsWith('as const')) {
    const constValue = cleanValue.slice(0, -8).trim()
    return {
      key: cleanKey,
      value: inferConstArrayType(constValue, state),
    }
  }

  // Handle arrays
  if (cleanValue.startsWith('[')) {
    return {
      key: cleanKey,
      value: inferArrayType(cleanValue, state),
    }
  }

  // Handle objects
  if (cleanValue.startsWith('{')) {
    return {
      key: cleanKey,
      value: inferComplexObjectType(cleanValue, state),
    }
  }

  // Handle function expressions
  if (cleanValue.includes('=>')) {
    return {
      key: cleanKey,
      value: '(...args: any[]) => unknown',
    }
  }

  // Handle literals
  if (/^['"`].*['"`]$/.test(cleanValue)) {
    return { key: cleanKey, value: cleanValue }
  }
  if (!Number.isNaN(Number(cleanValue))) {
    return { key: cleanKey, value: cleanValue }
  }
  if (cleanValue === 'true' || cleanValue === 'false') {
    return { key: cleanKey, value: cleanValue }
  }

  // Handle other expressions
  return { key: cleanKey, value: 'unknown' }
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
  let inComment = false
  let inMultilineComment = false

  function addElement() {
    const trimmed = current.trim()
    if (trimmed) {
      debugLog(state, 'array-split', `Found element: ${trimmed}`)
      elements.push(trimmed)
    }
    current = ''
  }

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const nextChar = content[i + 1] || ''
    const prevChar = i > 0 ? content[i - 1] : ''

    // Handle comments
    if (!inString) {
      if (!inComment && !inMultilineComment && char === '/' && nextChar === '/') {
        inComment = true
        continue
      }
      if (!inComment && !inMultilineComment && char === '/' && nextChar === '*') {
        inMultilineComment = true
        continue
      }
      if (inMultilineComment && char === '*' && nextChar === '/') {
        inMultilineComment = false
        i++
        continue
      }
      if (inComment && (char === '\n' || char === '\r')) {
        inComment = false
        continue
      }
    }

    if (inComment || inMultilineComment)
      continue

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

    // Track nested structures when not in string
    if (!inString) {
      if (char === '[' || char === '{' || char === '(') {
        depth++
      }
      else if (char === ']' || char === '}' || char === ')') {
        depth--
      }
      else if (char === ',' && depth === 0) {
        addElement()
        continue
      }
    }

    current += char
  }

  // Add final element
  addElement()

  return elements
}
