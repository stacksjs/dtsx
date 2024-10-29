import type { ProcessingState, PropertyInfo } from './types'
import { cleanComments, removeLeadingComments } from './comments'
import { extractCleanObjectLiteral, extractFunctionSignature, extractObjectProperties } from './extract'
import { formatProperties } from './format'
import { inferArrayType, inferValueType } from './infer'
import { isDeclarationComplete, isDeclarationStart, isDefaultExport, isJSDocComment } from './is'
import { trackUsedTypes } from './track'
import { cleanSource, debugLog, parseMethodSignature, shouldProcessLine } from './utils'

/**
 * Process type declarations
 */
export function processDeclarationBlock(lines: string[], comments: string[], state: ProcessingState): void {
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
    debugLog(state, 'const-declaration', `Found const declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.trimStart().startsWith('export')
    const processed = processVariable(
      fullDeclaration,
      isExported,
    )
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
  debugLog(state, 'source', 'Starting source file processing')
  const cleanedContent = cleanSource(content)
  const lines = cleanedContent.split('\n')

  let currentBlock: string[] = []
  let currentComments: string[] = []
  let isInMultilineDeclaration = false
  let braceLevel = 0
  let isInModuleDeclaration = false
  let isCapturingDefaultExport = false

  function flushBlock() {
    if (currentBlock.length > 0 || currentComments.length > 0) {
      const fullDeclaration = currentBlock.join('\n')
      debugLog(state, 'flush', `Flushing block: ${fullDeclaration.substring(0, 50)}...`)

      if (isCapturingDefaultExport) {
        debugLog(state, 'default-export', `Processing default export: ${fullDeclaration}`)
        const defaultExport = `export default ${fullDeclaration.replace(/^export\s+default\s+/, '')}`
        state.defaultExports.add(defaultExport.endsWith(';') ? defaultExport : `${defaultExport};`)
        isCapturingDefaultExport = false
      }
      else {
        const jsdocComments = currentComments.filter(comment =>
          comment.trim().startsWith('/**')
          || comment.trim().startsWith('*')
          || comment.trim().startsWith('*/'),
        )
        processDeclarationBlock([...currentBlock], [...jsdocComments], state)
      }

      currentBlock = []
      currentComments = []
      isInMultilineDeclaration = false
      isInModuleDeclaration = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Skip empty lines unless we're in a multi-line declaration
    if (!trimmedLine) {
      if (isInMultilineDeclaration || isInModuleDeclaration || isCapturingDefaultExport) {
        currentBlock.push(line)
      }
      continue
    }

    // Handle default exports
    if (isDefaultExport(trimmedLine)) {
      debugLog(state, 'default-export', `Found default export line: ${trimmedLine}`)
      flushBlock() // Flush any existing block
      isCapturingDefaultExport = true
      currentBlock.push(line)

      // If it's a single-line default export
      if (trimmedLine.endsWith(';')) {
        flushBlock()
      }
      continue
    }

    // If we're capturing a default export, keep adding lines until we complete the expression
    if (isCapturingDefaultExport) {
      currentBlock.push(line)
      // Check if we've completed the default export
      const currentContent = currentBlock.join('\n')
      if (isDeclarationComplete(currentContent)) {
        flushBlock()
      }
      continue
    }

    // Handle comments
    if (isJSDocComment(trimmedLine)) {
      currentComments.push(line)
      continue
    }

    // Check for module declaration start
    if (braceLevel === 0 && trimmedLine.startsWith('declare module')) {
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

      if (braceLevel === 0) {
        flushBlock()
      }
      continue
    }

    // Handle regular declarations
    if (braceLevel === 0 && isDeclarationStart(trimmedLine)) {
      flushBlock()
      currentBlock.push(line)
      isInMultilineDeclaration = !isDeclarationComplete(trimmedLine)
    }
    else if (isInMultilineDeclaration) {
      currentBlock.push(line)
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

    // Update brace level for non-module declarations
    if (!isInModuleDeclaration) {
      braceLevel += netBraceCount(line)
    }
  }

  // Process any remaining block
  flushBlock()
}

export function processValue(value: string): { type: string, nested?: PropertyInfo[], method?: MethodSignature } {
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
function processVariable(declaration: string, isExported = true): string {
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
    return declaration
  }

  const name = nameMatch[1].trim()

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
