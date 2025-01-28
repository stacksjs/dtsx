/* eslint-disable regexp/no-super-linear-backtracking, no-cond-assign */
import type { FunctionSignature, ImportTrackingState, ProcessedMethod, ProcessingState } from './types'
import { config } from './config'

function cleanParameterTypes(params: string): string {
  if (!params.trim())
    return ''

  // Handle object type parameters
  if (params.includes('{')) {
    const objectMatch = params.match(/(\w+):\s*(\{[^}]+\})/)
    if (objectMatch) {
      const [, paramName, objectType] = objectMatch
      // Split on actual property boundaries
      const properties = objectType
        .slice(1, -1)
        .split(/\s+(?=\w+\??\s*:)/) // Split before property names
        .map(prop => prop.trim())
        .filter(Boolean)
        .map((prop) => {
          // Keep property name and type together
          const [name, type] = prop.split(/:\s*/)
          const isOptional = name.endsWith('?')
          const cleanName = name.replace(/\?$/, '')
          return `${cleanName}${isOptional ? '?' : ''}: ${type}`
        })
        .join(', ')

      return `${paramName}: { ${properties} }`
    }
  }

  // Rest of the function remains unchanged for non-object params
  const parts: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (const char of params) {
    if ((char === '"' || char === '\'' || char === '`')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (!inString) {
      if (char === '{' || char === '<' || char === '(')
        depth++
      if (char === '}' || char === '>' || char === ')')
        depth--

      if (char === ',' && depth === 0) {
        if (current.trim()) {
          parts.push(cleanSingleParameter(current))
        }
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    parts.push(cleanSingleParameter(current))
  }

  return parts.join(', ')
}

function cleanSingleParameter(param: string): string {
  const trimmed = param.trim()

  // Handle parameters with default values
  if (trimmed.includes('=')) {
    const [paramPart] = trimmed.split('=')
    return cleanSingleParameter(paramPart)
  }

  // Handle parameters with type annotations
  const typeMatch = trimmed.match(/^([^:]+):\s*(.+)$/)
  if (typeMatch) {
    const [, paramName, paramType] = typeMatch
    // Handle object types
    if (paramType.includes('{')) {
      return `${paramName.trim()}: ${formatObjectType(paramType)}`
    }
    return `${paramName.trim()}: ${paramType.trim()}`
  }

  return trimmed
}

/**
 * Extracts types from a TypeScript file and generates corresponding .d.ts content
 * @param filePath - Path to source TypeScript file
 */
export async function extract(filePath: string, verbose?: boolean | string[]): Promise<string> {
  try {
    const sourceCode = await Bun.file(filePath).text()
    return extractDtsTypes(sourceCode, verbose)
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
export function extractDtsTypes(sourceCode: string, verbose?: boolean | string[]): string {
  const state = createProcessingState()
  debugLog('init', 'Starting DTS extraction', verbose)

  // Process imports first
  sourceCode.split('\n').forEach((line) => {
    if (line.includes('import ')) {
      processImports(line, state.importTracking, verbose)
      debugLog('import', `Processed import: ${line.trim()}`, verbose)
    }
  })

  // Process declarations
  processSourceFile(sourceCode, state, verbose)

  // Log the state of exports before formatting
  debugLog('export-summary', `Found ${state.defaultExports.size} default exports`, verbose)
  debugLog('export-summary', `Found ${state.exportAllStatements.length} export * statements`, verbose)

  // Final pass to track what actually made it to the output
  state.dtsLines.forEach((line) => {
    if (line.trim() && !line.startsWith('import')) {
      trackTypeUsage(line, state.importTracking)
      trackValueUsage(line, state.importTracking, verbose)
    }
  })

  // Generate optimized imports based on actual output
  const optimizedImports = generateOptimizedImports(state.importTracking)
  debugLog('import-summary', `Generated ${optimizedImports.length} optimized imports`, verbose)

  // Clear any existing imports and set up dtsLines with optimized imports
  state.dtsLines = [
    ...optimizedImports.map(imp => `${imp};`),
    '',
    ...state.dtsLines.filter(line => !line.trim().startsWith('import')),
  ]

  return formatOutput(state)
}

/**
 * Extracts a complete function signature using balanced symbol tracking
 *
 * @param declaration - Full function declaration string
 * @returns Parsed function signature with name, generics, params, and return type
 *
 * @example
 * // Basic function
 * extractFunctionSignature('function foo(x: number): string')
 * // => { name: 'foo', generics: '', params: 'x: number', returnType: 'string' }
 *
 * @example
 * // Generic function with complex return type
 * extractFunctionSignature(`
 *   function map<T, U>(arr: T[], fn: (item: T) => U): U[]
 * `)
 * // => {
 * //   name: 'map',
 * //   generics: '<T, U>',
 * //   params: 'arr: T[], fn: (item: T) => U',
 * //   returnType: 'U[]'
 * // }
 */
function extractFunctionSignature(declaration: string, verbose?: boolean | string[]): FunctionSignature {
  debugLog('signature-start', `Processing declaration: ${declaration}`, verbose)

  // Clean up the declaration
  const cleanDeclaration = getCleanDeclaration(declaration)
  debugLog('signature-clean', `Clean declaration: ${cleanDeclaration}`, verbose)

  // Extract function name
  const name = extractFunctionName(cleanDeclaration)
  let rest = cleanDeclaration.slice(cleanDeclaration.indexOf(name) + name.length).trim()
  debugLog('signature-content', `Content after name: ${rest}`, verbose)

  // Extract generics with improved depth tracking
  const { generics, rest: restAfterGenerics } = extractGenerics(rest, verbose)
  rest = restAfterGenerics.trim()
  debugLog('signature-after-generics', `Remaining content: ${rest}`, verbose)

  // Extract parameters with full object type support
  const { params, rest: restAfterParams } = extractParams(rest, verbose)
  rest = restAfterParams.trim()
  debugLog('signature-after-params', `Remaining content: ${rest}`, verbose)

  // Extract return type
  const { returnType } = extractReturnType(rest)
  debugLog('signature-return', `Extracted return type: ${returnType}`, verbose)

  // Handle object parameter types
  let processedParams = params
  if (params.includes('{')) {
    const objectMatch = params.match(/\{([^}]+)\}:\s*([^)]+)/)
    if (objectMatch) {
      const [, paramList, typeRef] = objectMatch
      processedParams = `{ ${paramList} }: ${typeRef}`
    }
  }

  const signature = {
    name,
    generics,
    params: processedParams,
    returnType,
  }

  debugLog('signature-final', `Final signature object: ${JSON.stringify(signature, null, 2)}`, verbose)
  return signature
}

function extractFunctionName(declaration: string): string {
  const functionMatch = declaration.match(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([^(<\s]+)/)
  if (!functionMatch) {
    throw new Error('Invalid function declaration')
  }
  return functionMatch[1]
}

function extractGenerics(declaration: string): { generics: string, rest: string } {
  let generics = ''
  let rest = declaration

  if (declaration.startsWith('<')) {
    let depth = 1
    let pos = 1
    let buffer = '<'
    let inString = false
    let stringChar = ''

    for (; pos < declaration.length; pos++) {
      const char = declaration[pos]
      const prevChar = pos > 0 ? declaration[pos - 1] : ''

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
        if (char === '<')
          depth++
        if (char === '>') {
          depth--
          if (depth === 0) {
            buffer += char
            pos++
            break
          }
        }
      }

      buffer += char
    }

    generics = buffer
    rest = declaration.slice(pos)
  }

  return { generics, rest: rest.trim() }
}

function inferTypeFromDefaultValue(defaultValue: string): string {
  defaultValue = defaultValue.trim()

  // Handle primitive literals
  if (defaultValue === 'true' || defaultValue === 'false') return 'boolean'
  if (defaultValue === '""' || defaultValue === "''") return 'string'
  if (/^-?\d*\.?\d+$/.test(defaultValue)) return 'number'
  if (defaultValue === 'null') return 'null'
  if (defaultValue === 'undefined') return 'undefined'

  // Handle common literals
  if (defaultValue === '[]') return 'any[]'
  if (defaultValue === '{}') return 'Record<string, unknown>'

  // Handle string literals
  if (/^(['"`]).*\1$/.test(defaultValue)) return 'string'

  // Infer from contextual clues
  if (defaultValue.includes('=>')) return '(...args: any[]) => unknown'
  if (defaultValue.startsWith('new ')) return 'unknown'
  if (defaultValue.includes('function')) return '(...args: any[]) => unknown'

  // Handle array and object literals
  if (defaultValue.startsWith('[')) return 'any[]'
  if (defaultValue.startsWith('{')) return 'Record<string, unknown>'

  return 'unknown'
}

function extractParams(declaration: string): { params: string, rest: string } {
  let params = ''
  let rest = declaration

  if (declaration.includes('(')) {
    const start = declaration.indexOf('(')
    let depth = 1
    let pos = start + 1
    let buffer = ''
    let inString = false
    let stringChar = ''

    for (; pos < declaration.length; pos++) {
      const char = declaration[pos]
      const prevChar = pos > 0 ? declaration[pos - 1] : ''

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
        if (char === '(') depth++
        if (char === ')') {
          depth--
          if (depth === 0) break
        }
      }

      buffer += char
    }

    params = buffer
    rest = declaration.slice(pos + 1)
  }

  // Clean up parameters while preserving complex types
  const cleanedParams = params.split(',')
    .map(param => {
      const paramTrimmed = param.trim()
      if (!paramTrimmed) return null

      // Handle parameters with default values
      if (paramTrimmed.includes('=')) {
        const [paramPart, defaultValue] = paramTrimmed.split(/\s*=\s*/)
        const paramWithoutDefault = paramPart.trim()

        // If there's an explicit type annotation, use it
        if (paramWithoutDefault.includes(':')) {
          const [paramName, paramType] = paramWithoutDefault.split(':').map(p => p.trim())
          const fullType = extractComplexType(paramType)
          return `${paramName}?: ${fullType}`
        }

        // Otherwise infer the type from the default value
        const inferredType = inferTypeFromDefaultValue(defaultValue.trim())
        return `${paramWithoutDefault}?: ${inferredType}`
      }

      // Handle parameters with type annotations
      if (paramTrimmed.includes(':')) {
        const colonIndex = paramTrimmed.indexOf(':')
        const paramName = paramTrimmed.slice(0, colonIndex).trim()
        const rawType = paramTrimmed.slice(colonIndex + 1).trim()
        const fullType = extractComplexType(rawType)
        const isOptional = paramName.endsWith('?')
        const cleanName = paramName.replace(/\?$/, '')
        return `${cleanName}${isOptional ? '?' : ''}: ${fullType}`
      }

      return paramTrimmed
    })
    .filter(Boolean)
    .join(', ')

  return { params: cleanedParams, rest: rest.trim() }
}

function extractComplexType(typeStr: string): string {
  let result = ''
  let depth = 0
  let curlyDepth = 0
  let angleDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < typeStr.length; i++) {
    const char = typeStr[i]
    const prevChar = i > 0 ? typeStr[i - 1] : ''

    // Handle string boundaries
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
      if (char === '{') curlyDepth++
      if (char === '}') curlyDepth--
      if (char === '<') angleDepth++
      if (char === '>') angleDepth--
      if (char === '(') depth++
      if (char === ')') depth--
    }

    result += char

    // Track if we've completed a type expression
    if (curlyDepth === 0 && angleDepth === 0 && depth === 0) {
      const nextChar = i < typeStr.length - 1 ? typeStr[i + 1] : ''
      // Only break if we're at a type boundary
      if (nextChar === ',' || nextChar === ')' || nextChar === ';') break
    }
  }

  // Handle any unclosed type expressions
  const cleanResult = result.trim()
  if (curlyDepth > 0) cleanResult.concat('}'.repeat(curlyDepth))
  if (angleDepth > 0) cleanResult.concat('>'.repeat(angleDepth))
  if (depth > 0) cleanResult.concat(')'.repeat(depth))

  return cleanResult
}

function parseObjectType(typeStr: string): string {
  let depth = 0
  let cleaned = ''

  for (let i = 0; i < typeStr.length; i++) {
    const char = typeStr[i]
    if (char === '{' || char === '<')
      depth++
    if (char === '}' || char === '>')
      depth--
    cleaned += char

    // Break if we've closed all brackets and hit a stopping point
    if (depth === 0 && (char === '}' || char === '>'))
      break
  }

  return cleaned
}

function parseType(typeStr: string): string {
  // Handle generic types
  if (typeStr.includes('<')) {
    let depth = 0
    let fullType = ''

    for (let i = 0; i < typeStr.length; i++) {
      const char = typeStr[i]
      if (char === '<')
        depth++
      if (char === '>')
        depth--
      fullType += char

      if (depth === 0 && fullType.includes('>'))
        break
    }

    return fullType.trim()
  }

  // Handle intersection and union types
  if (typeStr.includes('&') || typeStr.includes('|')) {
    return typeStr.split(/\s*[&|]\s*/)
      .map(t => parseType(t.trim()))
      .join(typeStr.includes('&') ? ' & ' : ' | ')
  }

  return typeStr.trim()
}

function extractReturnType(declaration: string): { returnType: string } {
  if (!declaration.startsWith(':'))
    return { returnType: 'void' }

  const rest = declaration.slice(1).trim()

  // Handle complex return types
  let depth = 0
  let curlyDepth = 0
  let angleDepth = 0
  let fullType = ''
  let inString = false
  let stringChar = ''

  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]
    const prevChar = i > 0 ? rest[i - 1] : ''

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

    if (!inString) {
      if (char === '{') curlyDepth++
      if (char === '}') curlyDepth--
      if (char === '<') angleDepth++
      if (char === '>') angleDepth--
      depth = curlyDepth + angleDepth

      // Only break if we're at the actual end of the type
      if (depth === 0 && (char === ';' || char === '{' || char === '}')) {
        // Don't include the terminating character
        break
      }
    }

    fullType += char
  }

  let returnType = fullType.trim()

  // Special handling for object return types
  if (returnType.startsWith('{')) {
    const objectContent = returnType.slice(1, -1).trim()
    if (objectContent) {
      // Format object properties
      const properties = objectContent.split(',').map(prop => prop.trim()).join(', ')
      returnType = `{ ${properties} }`
    }
  }

  return { returnType }
}

function extractFunctionType(value: string, verbose?: boolean | string[]): string | null {
  debugLog('extract-function', `Extracting function type from: ${value}`, verbose)

  const cleanValue = value.trim()
  let pos = 0
  const length = cleanValue.length

  // Check if the value starts with '(' (function expression)
  if (!cleanValue.startsWith('(')) {
    // Handle function keyword with explicit parameter types
    const funcMatch = cleanValue.match(/^function\s*\w*\s*\((.*?)\)/s)
    if (funcMatch) {
      const [, params] = funcMatch
      // Clean parameters while preserving type annotations
      const cleanParams = cleanParameterTypes(params || '')
      // Extract return type if available
      const returnTypeMatch = cleanValue.match(/\):\s*([^{;]+)(?:[{;]|$)/)
      const returnType = returnTypeMatch ? normalizeType(returnTypeMatch[1]) : 'unknown'
      return `(${cleanParams}) => ${returnType}`
    }
    return null
  }

  // Now, handle arrow functions with possible return types
  // Extract parameters using balanced parentheses
  pos++ // Skip '('
  let depth = 1
  const paramsStart = pos
  let inString = false
  let stringChar = ''
  for (; pos < length; pos++) {
    const char = cleanValue[pos]
    const prevChar = pos > 0 ? cleanValue[pos - 1] : ''

    if (inString) {
      if (char === stringChar && prevChar !== '\\') {
        inString = false
      }
      else if (char === '\\') {
        pos++ // Skip escaped character
      }
    }
    else {
      if (char === '"' || char === '\'' || char === '`') {
        inString = true
        stringChar = char
      }
      else if (char === '(') {
        depth++
      }
      else if (char === ')') {
        depth--
        if (depth === 0) {
          break
        }
      }
    }
  }
  if (depth !== 0) {
    // Unbalanced parentheses
    debugLog('extract-function', 'Unbalanced parentheses in function parameters', verbose)
    return null
  }

  const paramsEnd = pos
  const params = cleanValue.slice(paramsStart, paramsEnd)

  pos++ // Move past ')'

  // Skip any whitespace
  while (pos < length && /\s/.test(cleanValue[pos])) pos++

  // Check for optional return type
  let returnType = 'unknown'
  if (cleanValue[pos] === ':') {
    pos++ // Skip ':'
    // Skip any whitespace
    while (pos < length && /\s/.test(cleanValue[pos])) pos++
    const returnTypeStart = pos
    // Read until '=>' or '{'
    while (pos < length && !cleanValue.startsWith('=>', pos) && cleanValue[pos] !== '{') {
      pos++
    }
    const returnTypeEnd = pos
    returnType = cleanValue.slice(returnTypeStart, returnTypeEnd).trim()
  }

  // Skip any whitespace
  while (pos < length && /\s/.test(cleanValue[pos])) pos++

  // Now, check for '=>'
  if (cleanValue.startsWith('=>', pos)) {
    pos += 2
  }
  else {
    // No '=>', invalid function expression
    debugLog('extract-function', 'Function expression missing "=>"', verbose)
    return null
  }

  // Now, construct the function type
  const cleanParams = cleanParameterTypes(params || '')
  debugLog('extract-function', `Extracted function type: (${cleanParams}) => ${returnType}`, verbose)
  return `(${cleanParams}) => ${returnType}`
}

/**
 * Generate optimized imports based on usage
 */
function generateOptimizedImports(state: ImportTrackingState): string[] {
  const imports: string[] = []
  const seenImports = new Set<string>()

  // Handle type-only imports first
  for (const [module, types] of state.typeImports) {
    const typeImports = Array.from(types)
      .filter(t => state.usedTypes.has(t))
      .map((t) => {
        const alias = state.valueAliases.get(t)
        return alias ? `${t} as ${alias}` : t
      })
      .sort()

    if (typeImports.length > 0) {
      const importStatement = `import type { ${typeImports.join(', ')} } from '${module}'`
      if (!seenImports.has(importStatement)) {
        imports.push(importStatement)
        seenImports.add(importStatement)
      }
    }
  }

  // Handle value imports including default exports
  const processedModules = new Set()
  for (const [module, values] of state.valueImports) {
    if (processedModules.has(module))
      continue
    processedModules.add(module)

    const defaultImport = Array.from(state.valueAliases.entries())
      .find(([alias, orig]) =>
        orig === 'default'
        && state.importSources.get(alias) === module
        && state.usedValues.has(alias),
      )?.[0]

    const namedImports = Array.from(values)
      .filter(v => v !== 'default')
      .filter((v) => {
        const alias = Array.from(state.valueAliases.entries())
          .find(([_, orig]) => orig === v)?.[0]
        return state.usedValues.has(v) || (alias && state.usedValues.has(alias))
      })
      .map((v) => {
        const alias = Array.from(state.valueAliases.entries())
          .find(([_, orig]) => orig === v)?.[0]
        return alias ? `${v} as ${alias}` : v
      })
      .sort()

    if (defaultImport || namedImports.length > 0) {
      let importStatement = 'import '

      // Add default import
      if (defaultImport) {
        importStatement += defaultImport
        if (namedImports.length > 0) {
          importStatement += ', '
        }
      }

      // Add named imports if any
      if (namedImports.length > 0) {
        importStatement += `{ ${namedImports.join(', ')} }`
      }

      importStatement += ` from '${module}'`

      if (!seenImports.has(importStatement)) {
        imports.push(importStatement)
        seenImports.add(importStatement)
      }
    }
  }

  return imports.sort()
}

function extractCompleteObjectContent(value: string, verbose?: boolean | string[]): string | null {
  debugLog('extract-object', `Processing object of length ${value.length}`, verbose)
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
  const declarations: string[] = []
  const exports: string[] = []
  const defaultExports: string[] = []
  const exportAllStatements: string[] = []

  // Process all lines and categorize them
  state.dtsLines.forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed)
      return

    if (trimmed.startsWith('import')) {
      imports.add(trimmed.replace(/;+$/, ''))
    }
    else if (trimmed.startsWith('export {')) {
      exports.push(trimmed)
    }
    else if (trimmed.startsWith('export default')) {
      defaultExports.push(trimmed)
    }
    else if (trimmed.startsWith('export *')) {
      exportAllStatements.push(trimmed)
    }
    else {
      declarations.push(trimmed)
    }
  })

  // Add default exports from state
  Array.from(state.defaultExports)
    .forEach(exp => defaultExports.push(exp.trim().replace(/;+$/, ';')))

  // Construct the output with proper ordering
  const parts: string[] = []

  // 1. Add imports
  if (imports.size > 0) {
    parts.push(...Array.from(imports).map(imp => `${imp};`), '')
  }

  // 2. Add declarations
  if (declarations.length > 0) {
    parts.push(...declarations)
  }

  // 3. Add regular exports
  if (exports.length > 0) {
    if (parts.length > 0)
      parts.push('')
    parts.push(...exports)
  }

  // 4. Add export * statements
  if (exportAllStatements.length > 0) {
    if (parts.length > 0)
      parts.push('')
    parts.push(...exportAllStatements)
  }

  // 5. Add default exports last
  if (defaultExports.length > 0) {
    if (parts.length > 0)
      parts.push('')
    parts.push(...defaultExports)
  }

  // Clean up comments and join
  return parts
    .map(line => line.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, ''))
    .join('\n')
    .trim()
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
    currentScope: 'top',
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
    exportedTypes: new Set(),
    exportedValues: new Set(),
    valueAliases: new Map(),
    importSources: new Map(),
    typeExportSources: new Map(),
    defaultExportValue: undefined,
  }
}

function indentMultilineType(type: string, baseIndent: string, isLast: boolean): string {
  const lines = type.split('\n')
  if (lines.length === 1)
    return `${baseIndent}${type}${isLast ? '' : ' |'}`

  interface BracketInfo {
    char: string
    indent: string
    isArray: boolean
    depth: number
    isSingleElement?: boolean
  }
  const bracketStack: BracketInfo[] = []

  // First pass: analyze structure
  let isInSingleElementArray = false
  let arrayElementCount = 0
  lines.forEach((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('Array<')) {
      arrayElementCount = 0
    }
    if (trimmed === '}' || trimmed.startsWith('> |') || trimmed === '>') {
      isInSingleElementArray = arrayElementCount === 1
    }
    if (trimmed && !trimmed.startsWith('Array<') && !trimmed.endsWith('>') && !trimmed.startsWith('{') && !trimmed.endsWith('}')) {
      arrayElementCount++
    }
  })

  const formattedLines = lines.map((line, i) => {
    const trimmed = line.trim()
    if (!trimmed)
      return ''

    // Calculate base indentation for this line
    let currentIndent = baseIndent
    if (i > 0) {
      // Add additional indentation for nested structures
      const stackDepth = bracketStack.reduce((depth, info) => depth + info.depth, 0)
      currentIndent = baseIndent + '  '.repeat(stackDepth)

      // Handle object property indentation
      if (trimmed.match(/^['"]/)) { // Property starts with a quote
        currentIndent += '  '
      }

      // Adjust closing brace/bracket indentation
      if ((trimmed.startsWith('}') || trimmed.startsWith('>') || trimmed.startsWith('> |')) && bracketStack.length > 0) {
        currentIndent = baseIndent + '  '.repeat(Math.max(0, stackDepth - 1))
      }
    }

    // Track brackets for nested structures
    const openBrackets = trimmed.match(/[{<[]/g) || []
    const closeBrackets = trimmed.match(/[}\]>]/g) || []

    // Handle opening brackets
    openBrackets.forEach((bracket) => {
      const isArrayBracket = trimmed.startsWith('Array') && bracket === '<'
      bracketStack.push({
        char: bracket,
        indent: currentIndent,
        isArray: isArrayBracket,
        depth: 1,
        isSingleElement: isInSingleElementArray,
      })
    })

    // Handle closing brackets
    if (closeBrackets.length > 0) {
      for (let j = 0; j < closeBrackets.length; j++) {
        if (bracketStack.length > 0)
          bracketStack.pop()
      }
    }

    // Add union operator when needed
    let needsUnion = false
    if (!isLast && i === lines.length - 1 && !trimmed.endsWith(' |') && !trimmed.endsWith(';')) {
      needsUnion = true
    }

    // Handle special cases for objects in arrays
    if (trimmed === '}') {
      const lastArray = [...bracketStack].reverse().find(info => info.isArray)
      if (lastArray?.isSingleElement)
        needsUnion = false
    }

    // Don't add union if it's already there
    if (trimmed.endsWith(' |'))
      needsUnion = false

    return `${currentIndent}${trimmed}${needsUnion ? ' |' : ''}`
  }).filter(Boolean)

  return formattedLines.join('\n')
}

function inferTypeFromDefault(defaultValue: string): string {
  if (defaultValue === '""' || defaultValue === '\'\'')
    return 'string'
  if (defaultValue === 'true' || defaultValue === 'false')
    return 'boolean'
  if (defaultValue === '0' || !isNaN(Number(defaultValue)))
    return 'number'
  if (defaultValue === '[]')
    return 'any[]'
  if (defaultValue === '{}')
    return 'Record<string, unknown>'
  if (defaultValue === 'null')
    return 'null'
  if (defaultValue === 'undefined')
    return 'undefined'
  return 'unknown'
}

function extractGenerics(rest: string): { generics: string, rest: string } {
  if (!rest.startsWith('<'))
    return { generics: '', rest }

  let depth = 1
  let pos = 1
  let generics = '<'

  for (; pos < rest.length; pos++) {
    const char = rest[pos]
    if (char === '<')
      depth++
    if (char === '>')
      depth--
    generics += char
    if (depth === 0) {
      pos++
      break
    }
  }

  return {
    generics,
    rest: rest.slice(pos).trim(),
  }
}

function inferValueType(value: string): string {
  const normalizedValue = value.split('\n').map(line => line.trim()).join(' ')

  // For string literals
  if (/^['"`].*['"`]$/.test(normalizedValue)) {
    return normalizedValue
  }

  // For numeric literals
  if (!Number.isNaN(Number(normalizedValue))) {
    return normalizedValue
  }

  // For boolean literals
  if (normalizedValue === 'true' || normalizedValue === 'false') {
    return normalizedValue
  }

  // Check for explicit return type annotations with better multiline handling
  const returnTypeMatch = normalizedValue.match(/\([^)]*\)\s*:\s*([^=>{]+)/)
  if (returnTypeMatch) {
    return returnTypeMatch[1].trim()
  }

  // For function expressions
  if (normalizedValue.includes('=>')) {
    return '(...args: any[]) => unknown'
  }

  return 'unknown'
}

/**
 * Infer array type from array literal with support for nested arrays and mixed elements
 */
function inferArrayType(value: string, state?: ProcessingState, preserveLineBreaks = false, verbose?: boolean | string[]): string {
  const content = value.slice(1, -1).trim()
  const isConstAssertion = value.trim().endsWith('as const')

  if (!content)
    return isConstAssertion ? 'readonly unknown[]' : 'unknown[]'

  const elements = splitArrayElements(content, verbose)

  // Handle const assertions
  if (isConstAssertion || elements.some(el => el.includes('as const'))) {
    const tuples = elements.map((el) => {
      const cleaned = el.trim().replace(/\s*as\s*const\s*$/, '').trim()
      return inferConstArrayType(cleaned, state, verbose)
    })

    if (needsMultilineFormat(tuples)) {
      // Use indentMultilineType for tuple formatting
      const formattedContent = tuples.map((type, i) =>
        indentMultilineType(type, '    ', i === tuples.length - 1),
      ).join('\n')
      return `readonly [\n${formattedContent}\n  ]`
    }

    return `readonly [${tuples.join(', ')}]`
  }

  const elementTypes = elements.map((element) => {
    const trimmed = element.trim()
    if (trimmed.startsWith('[')) {
      return inferArrayType(trimmed, state, false, verbose)
    }

    if (trimmed.startsWith('{')) {
      return inferComplexObjectType(trimmed, state)
    }

    if (trimmed.includes('=>') || trimmed.includes('function')) {
      const funcType = extractFunctionType(trimmed, verbose)
      return funcType ? `(${funcType})` : '((...args: any[]) => unknown)'
    }

    return normalizeTypeReference(trimmed)
  })

  const types = elementTypes.filter(Boolean)
  const needsMultiline = types.some(type =>
    type.includes('\n')
    || type.includes('{')
    || type.length > 40
    || types.join(' | ').length > 60,
  )

  if (needsMultiline && preserveLineBreaks) {
    // Use indentMultilineType for array type formatting
    const formattedContent = types.map((type, i) =>
      indentMultilineType(type, '    ', i === types.length - 1),
    ).join('\n')
    return `Array<\n${formattedContent}\n  >`
  }

  return `Array<${types.join(' | ')}>`
}

/**
 * Process object properties with improved formatting
 */
function inferComplexObjectType(value: string, state?: ProcessingState, indentLevel = 0, verbose?: boolean | string[]): string {
  const content = extractCompleteObjectContent(value, verbose)
  if (!content)
    return 'Record<string, unknown>'

  // Calculate indentation based on nesting level
  const baseIndent = '  '.repeat(indentLevel)
  const propIndent = '  '.repeat(indentLevel + 1)
  const closingIndent = baseIndent // Keep closing brace aligned with opening

  const props = processObjectProperties(content, state, indentLevel, verbose)
  if (!props.length)
    return '{}'

  const propertyStrings = props.map(({ key, value }) => {
    return `${propIndent}${key}: ${value}`
  })

  // Format the object with consistent indentation
  return `{\n${propertyStrings.join(';\n')}\n${closingIndent}}`
}

function inferConstArrayType(value: string, state?: ProcessingState, verbose?: boolean | string[]): string {
  debugLog('infer-const', `Inferring const array type for: ${value}`, verbose)

  // For string literals, return them directly
  if (/^['"`].*['"`]$/.test(value)) {
    // Strip any potential 'as cons' suffix and quotes
    const cleaned = value
      .replace(/\]\s*as\s*cons.*$/, '')
      .replace(/^['"`]|['"`]$/g, '')
    return `'${cleaned}'`
  }

  // Handle array literals
  if (value.startsWith('[')) {
    const content = value.slice(1, -1).trim()
    const elements = splitArrayElements(content, verbose)

    // Build tuple type
    const literalTypes = elements.map((element) => {
      let trimmed = element.trim()
      debugLog('const-tuple-element', `Processing tuple element: ${trimmed}`, verbose)

      // Clean up any 'as cons' or 'as const' suffixes first
      if (trimmed.includes('] as cons') || trimmed.includes('] as const')) {
        trimmed = trimmed
          .replace(/\]\s*as\s*cons.*$/, '')
          .replace(/\]\s*as\s*const.*$/, '')
          .trim()
      }

      // Handle nested arrays
      if (trimmed.startsWith('[')) {
        return inferConstArrayType(trimmed, state, verbose)
      }

      // Handle nested objects
      if (trimmed.startsWith('{')) {
        const result = inferComplexObjectType(trimmed, state)
        return result.replace(/^\{/, '{ readonly').replace(/;\s+/g, '; readonly ')
      }

      // Handle string literals
      if (/^['"`].*['"`]$/.test(trimmed)) {
        // Clean up quotes and get the actual string value
        const stringContent = trimmed.replace(/^['"`]|['"`]$/g, '')
        return `'${stringContent}'`
      }

      // Handle numeric literals
      if (!Number.isNaN(Number(trimmed))) {
        return trimmed
      }

      // Handle boolean literals
      if (trimmed === 'true' || trimmed === 'false') {
        return trimmed
      }

      // At this point, we probably have a string without quotes
      // Clean up any remaining artifacts and quote it
      const cleanString = trimmed
        .replace(/\]\s*as\s*cons.*$/, '') // Remove '] as cons'
        .replace(/\]\s*as\s*const.*$/, '') // Remove '] as const'
        .replace(/^['"`]|['"`]$/g, '') // Remove any quotes
        .trim()

      return `'${cleanString}'`
    })

    debugLog('const-tuple-result', `Generated tuple types: [${literalTypes.join(', ')}]`, verbose)
    return `readonly [${literalTypes.join(', ')}]`
  }

  // If it's a plain string (without quotes), quote it
  const cleanString = value
    .replace(/\]\s*as\s*cons.*$/, '')
    .replace(/\]\s*as\s*const.*$/, '')
    .replace(/^['"`]|['"`]$/g, '')
    .trim()

  return `'${cleanString}'`
}

function inferConstType(value: string, state: ProcessingState, verbose?: boolean | string[]): string {
  if (value.startsWith('{')) {
    return inferComplexObjectType(value, state)
  }

  if (value.startsWith('[')) {
    return inferArrayType(value, state, true, verbose)
  }

  return value
}

/**
 * Check if a line is a JSDoc comment
 */
// function isJSDocComment(line: string): boolean {
//   const trimmed = line.trim()
//   const isJsDoc = trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/')
//   return isJsDoc
// }

function isDefaultExport(line: string): boolean {
  // Handle both inline and multi-line default exports
  return line.trim().startsWith('export default')
}

function isDeclarationStart(line: string): boolean {
  // Skip regex patterns
  if (isRegexPattern(line))
    return false

  const trimmed = line.trim()
  // const validIdentifierRegex = /^[a-z_$][\w$]*$/i

  // Handle all function declaration types
  if (/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*[a-zA-Z_$][\w$]*/.test(trimmed))
    return true

  // Handle other declarations
  return (
    trimmed.startsWith('export ')
    || trimmed.startsWith('interface ')
    || trimmed.startsWith('type ')
    || trimmed.startsWith('const ')
    || trimmed.startsWith('function ')
    || trimmed.startsWith('async function ')
    || trimmed.startsWith('declare ')
    || /^export\s+(?:interface|type|const|function\*?|async\s+function\*?)/.test(trimmed)
  )
}

function isRegexPattern(line: string): boolean {
  return (
    line.includes('\\')
    || line.includes('[^')
    || line.includes('(?:')
    || line.includes('(?=')
    || line.includes('(?!')
    || line.includes('\\s*')
    || line.includes('\\w+')
    || line.includes('\\d+')
    || line.includes('(?<')
    || line.includes('(?!')
    || line.includes('(?<=')
    || line.includes('(?<!')
  )
}

/**
 * Checks if a declaration is a branded type
 * A branded type follows the pattern: BaseType & { readonly __brand: X }
 */
function isBrandedType(declaration: string): boolean {
  // Basic structure check
  if (!declaration.includes('&'))
    return false

  // Split the type declaration into its parts
  const parts = declaration.split('&').map(part => part.trim())
  if (parts.length !== 2)
    return false

  // Check if the second part is an object type containing __brand
  const objectPart = parts[1]
  if (!objectPart.startsWith('{') || !objectPart.endsWith('}'))
    return false

  // Validate the object contains __brand
  const objectContent = objectPart.slice(1, -1).trim()

  return objectContent.includes('__brand')
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

function isVariableInsideFunction(line: string, state: ProcessingState): boolean {
  const trimmed = line.trim()
  return (
    state.currentScope === 'function'
    && (trimmed.startsWith('const ')
      || trimmed.startsWith('let ')
      || trimmed.startsWith('var ')
    // Handle multiline variable declarations
      || /^(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*(?::|=)/.test(trimmed))
  )
}

function needsMultilineFormat(types: string[]): boolean {
  return types.some(type =>
    type.includes('\n')
    || type.includes('{')
    || type.length > 40
    || types.join(' | ').length > 60,
  )
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

function processBlock(lines: string[], comments: string[], state: ProcessingState, verbose?: boolean | string[]): void {
  debugLog('block-processing', 'Starting block processing', verbose)

  // Join lines to handle potential JSDoc
  const fullContent = lines.join('\n')
  const { jsDoc, remainingContent } = extractJSDocComment(fullContent)

  // Split remaining content back into lines
  const contentLines = remainingContent.split('\n')

  // Clean up content lines but preserve non-JSDoc structure
  const cleanedLines = contentLines.filter((line) => {
    const trimmed = line.trim()
    // Only filter out comment lines, not other structural elements
    return !trimmed.startsWith('/*') && !trimmed.startsWith('*') && !trimmed.startsWith('//')
  })

  // Skip empty blocks after comment removal
  if (cleanedLines.length === 0) {
    return
  }

  const declarationText = cleanedLines.join('\n')
  const cleanDeclaration = removeLeadingComments(declarationText).trim()

  debugLog('block-processing', `Full block content:\n${cleanDeclaration}`, verbose)

  if (!cleanDeclaration) {
    debugLog('block-processing', 'Empty declaration block', verbose)
    return
  }

  // Early check for variables inside functions
  if (isVariableInsideFunction(cleanDeclaration, state)) {
    debugLog('block-processing', 'Skipping variable declaration inside function', verbose)
    return
  }

  // Handle branded types
  if (isBrandedType(cleanDeclaration)) {
    const processed = processType(declarationText, cleanDeclaration.startsWith('export'))
    state.dtsLines.push(processed)
    return
  }

  // Process interfaces first with improved depth tracking
  if (cleanDeclaration.startsWith('interface') || cleanDeclaration.startsWith('export interface')) {
    debugLog('block-processing', 'Processing interface declaration using interface block processor', verbose)
    if (processInterfaceBlock(cleanDeclaration, declarationText, state)) {
      debugLog('block-processing', 'Interface successfully processed', verbose)
      return
    }
  }

  // Split declarations for multiple functions
  if (cleanDeclaration.includes('\n\nexport function') || cleanDeclaration.includes('\n\nfunction')) {
    const declarations = splitFunctionDeclarations(cleanDeclaration)
    if (declarations.length > 1) {
      debugLog('block-processing', `Found ${declarations.length} function declarations to process`, verbose)
      declarations.forEach((declaration) => {
        const declarationLines = declaration.split('\n')
        processBlock(declarationLines, comments, state, verbose)
      })
      return
    }
  }

  // Try each processor in order, with JSDoc awareness
  const processed = processFunctionBlock(jsDoc + cleanDeclaration, state, verbose)
    ? undefined
    : processVariableBlock(cleanDeclaration, lines, state, verbose)
      ? undefined
      : processTypeBlock(cleanDeclaration, declarationText, state)
        ? undefined
        : processDefaultExportBlock(cleanDeclaration, state)
          ? undefined
          : processExportAllBlock(cleanDeclaration, state)
            ? undefined
            : processExportBlock(cleanDeclaration, declarationText, state, verbose)
              ? undefined
              : processModuleBlock(cleanDeclaration, declarationText, state)
                ? undefined
                : undefined

  if (processed === undefined) {
    debugLog('processing', `Unhandled declaration type: ${cleanDeclaration.split('\n')[0]}`, verbose)
  }
}

function processVariableBlock(cleanDeclaration: string, lines: string[], state: ProcessingState, verbose?: boolean | string[]): boolean {
  const variableMatch = cleanDeclaration.match(/^(?:export\s+)?(const|let|var)\s+/)
  if (!variableMatch)
    return false

  // Double-check we're not inside a function
  if (isVariableInsideFunction(cleanDeclaration, state)) {
    debugLog('variable-processing', 'Skipping variable inside function', verbose)
    return true // Return true because we handled it (by skipping)
  }

  const isExported = cleanDeclaration.startsWith('export')

  // Only process variables at the top level
  if (state.currentScope === 'top') {
    const fullDeclaration = lines.join('\n')
    state.dtsLines.push(processVariable(fullDeclaration, isExported, state, verbose))
  }
  else {
    debugLog('block-processing', 'Skipping variable declared inside a function', verbose)
  }
  return true
}

function processFunctionBlock(cleanDeclaration: string, state: ProcessingState, verbose?: boolean | string[]): boolean {
  debugLog('function-processing', `Processing potential function block: ${cleanDeclaration.slice(0, 100)}...`, verbose)

  // First check for generator functions
  if (/^(?:export\s+)?(?:async\s+)?function\s*\*/.test(cleanDeclaration)) {
    debugLog('block-processing', 'Processing generator function declaration', verbose)
    const processed = processGeneratorFunction(cleanDeclaration)
    if (processed) {
      state.dtsLines.push(processed)
      return true
    }
  }

  // Extract potential JSDoc and actual declaration
  const jsDocRegex = /\/\*\*\s*([\s\S]*?)\s*\*\//
  const jsDocMatch = cleanDeclaration.match(jsDocRegex)
  const actualDeclaration = cleanDeclaration.replace(jsDocRegex, '').trim()

  // Check for function declarations
  if (!/^(?:export\s+)?(?:async\s+)?function\s+[a-zA-Z_$][\w$]*/.test(actualDeclaration))
    return false

  debugLog('block-processing', 'Processing function declaration', verbose)

  // Handle potential overloads
  const declarations = actualDeclaration
    .split(/[\n;]/)
    .map(d => d.trim())
    .filter(d => d.startsWith('export function') || d.startsWith('function'))

  if (declarations.length > 1) {
    declarations.forEach((declaration) => {
      if (!declaration.endsWith('{')) { // Skip implementation
        const processed = processFunction(declaration, state.usedTypes, declaration.startsWith('export'), verbose)
        if (processed)
          state.dtsLines.push(processed)
      }
    })
    return true
  }

  // Extract signature for non-overloaded functions
  const signatureEnd = findSignatureEnd(actualDeclaration)
  const signaturePart = actualDeclaration.slice(0, signatureEnd).trim()

  debugLog('signature-extraction', `Extracted signature: ${signaturePart}`, verbose)

  const isExported = signaturePart.startsWith('export')
  // Reconstruct with JSDoc if present
  const fullDeclaration = jsDocMatch
    ? `${jsDocMatch[0]}\n${signaturePart}`
    : signaturePart

  const processed = processFunction(fullDeclaration, state.usedTypes, isExported, verbose)

  if (processed) {
    debugLog('function-processed', `Generated declaration: ${processed}`, verbose)
    state.dtsLines.push(processed)
  }

  return true
}

function findSignatureEnd(declaration: string): number {
  let signatureEnd = 0
  let parenDepth = 0
  let angleDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < declaration.length; i++) {
    const char = declaration[i]
    const prevChar = i > 0 ? declaration[i - 1] : ''

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

    if (!inString) {
      if (char === '(')
        parenDepth++
      if (char === ')')
        parenDepth--
      if (char === '<')
        angleDepth++
      if (char === '>')
        angleDepth--

      if (char === '{' && parenDepth === 0 && angleDepth === 0) {
        signatureEnd = i
        break
      }
    }
  }

  // If we didn't find '{', set signatureEnd to the end of the declaration
  return signatureEnd || declaration.length
}

function processInterfaceBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState, verbose?: boolean | string[]): boolean {
  debugLog('interface-processing', `Starting interface processing with declaration: ${cleanDeclaration.slice(0, 100)}...`, verbose)

  if (!cleanDeclaration.startsWith('interface') && !cleanDeclaration.startsWith('export interface')) {
    debugLog('interface-processing', 'Not an interface declaration, skipping', verbose)
    return false
  }

  const lines = declarationText.split('\n')
  let bracketDepth = 0
  let angleDepth = 0
  const processedLines: string[] = []
  let isFirstLine = true
  let hasStartedBody = false

  debugLog('interface-processing', `Processing ${lines.length} lines`, verbose)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Track bracket depths
    const openCurly = (line.match(/\{/g) || []).length
    const closeCurly = (line.match(/\}/g) || []).length
    const openAngle = (line.match(/</g) || []).length
    const closeAngle = (line.match(/>/g) || []).length

    bracketDepth += openCurly - closeCurly
    angleDepth += openAngle - closeAngle

    if (trimmedLine.includes('{')) {
      hasStartedBody = true
    }

    debugLog('interface-depth', `Line ${i + 1}: "${trimmedLine}" , verbose`
    + `Bracket depth: ${bracketDepth}, Angle depth: ${angleDepth}, `
    + `Has started body: ${hasStartedBody}`)

    // Handle first line separately to add 'declare'
    if (isFirstLine) {
      const prefix = trimmedLine.startsWith('export') ? 'export declare' : 'declare'
      processedLines.push(
        line.replace(
          /^(\s*)(?:export\s+)?interface/,
          `$1${prefix} interface`,
        ),
      )
      isFirstLine = false
    }
    else {
      processedLines.push(line)
    }
  }

  // Only consider it successful if we have a complete interface
  const result = processedLines.join('\n')
  const hasCompleteBody = result.includes('{') && result.includes('}')
  const isComplete = (bracketDepth === 0 && (angleDepth === 0 || result.includes('>'))) && hasCompleteBody

  if (isComplete) {
    debugLog('interface-processing', `Successfully processed interface:\n${result}`, verbose)
    state.dtsLines.push(result)
    return true
  }

  debugLog('interface-processing', `Interface processing incomplete. Bracket depth: ${bracketDepth}, , verbose`
  + `Angle depth: ${angleDepth}, Has started body: ${hasStartedBody}`)
  return false
}

function processTypeBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('type') && !cleanDeclaration.startsWith('export type'))
    return false

  const isExported = cleanDeclaration.startsWith('export')
  state.dtsLines.push(processType(declarationText, isExported))
  return true
}

function processDefaultExportBlock(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!isDefaultExport(cleanDeclaration))
    return false

  const exportedValue = cleanDeclaration.replace(/^export\s+default\s+/, '').replace(/;$/, '')
  state.importTracking.defaultExportValue = exportedValue

  // Store the complete default export statement
  const defaultExport = cleanDeclaration.endsWith(';')
    ? cleanDeclaration
    : `${cleanDeclaration};`

  state.defaultExports.add(defaultExport)

  // Do not add the default export to `state.dtsLines` to avoid duplication
  // state.dtsLines.push(defaultExport);

  return true
}

function processExportAllBlock(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export *'))
    return false

  state.exportAllStatements.push(cleanDeclaration)
  state.dtsLines.push(cleanDeclaration)
  return true
}

function processExportBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState, verbose?: boolean | string[]): boolean {
  if (!cleanDeclaration.startsWith('export'))
    return false

  // Handle various export types
  if (cleanDeclaration.startsWith('export {')) {
    // Handle multiline exports by preserving the entire declaration
    state.dtsLines.push(declarationText)
    return true
  }

  if (processExportedClass(cleanDeclaration, state))
    return true
  if (processExportedEnum(cleanDeclaration, state))
    return true
  if (processExportedNamespace(cleanDeclaration, state))
    return true

  // Handle named exports
  if (cleanDeclaration.includes('export {')) {
    state.dtsLines.push(declarationText)
    return true
  }

  // Log unhandled export
  debugLog('processing', `Unhandled exported declaration type: ${cleanDeclaration.split('\n')[0]}`, verbose)
  return true
}

function processExport(line: string, state: ProcessingState, verbose?: boolean | string[]): void {
  debugLog('export-processing', `Processing export: ${line}`, verbose)

  // Handle multiline exports by concatenating until we have a complete statement
  if (line.includes('{') && !line.includes('}')) {
    state.currentDeclaration = line
    return
  }

  // Continue building multiline export
  if (state.currentDeclaration) {
    state.currentDeclaration += ` ${line}`
    if (!line.includes('}'))
      return
    line = state.currentDeclaration
    state.currentDeclaration = ''
  }

  const exportMatch = line.match(/export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/)
  if (!exportMatch) {
    debugLog('export-error', 'Failed to match export pattern', verbose)
    if (line.startsWith('export {')) {
      // If it's a malformed export statement, add it as-is to preserve the declaration
      state.dtsLines.push(line)
    }
    return
  }

  const [, exports, sourceModule] = exportMatch
  debugLog('export-found', `Found exports: ${exports}, source: ${sourceModule || 'local'}`, verbose)

  // If it's a complete export statement, add it to dtsLines
  if (line.startsWith('export {')) {
    state.dtsLines.push(line)
  }

  exports.split(',').forEach((exp) => {
    const [itemName, aliasName] = exp.trim().split(/\s+as\s+/).map(e => e.trim())

    if (itemName.startsWith('type ')) {
      const typeName = itemName.replace(/^type\s+/, '').trim()
      const exportedName = aliasName || typeName
      state.importTracking.exportedTypes.add(exportedName)
      if (sourceModule) {
        state.importTracking.typeExportSources.set(exportedName, sourceModule)
      }
      debugLog('export-type-processed', `Added exported type: ${exportedName}`, verbose)
    }
    else {
      const exportedName = aliasName || itemName
      state.importTracking.exportedValues.add(exportedName)
      debugLog('export-value-processed', `Added exported value: ${exportedName}`, verbose)
    }
  })
}

function processExportedClass(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export class')
    && !cleanDeclaration.startsWith('export abstract class')) {
    return false
  }

  const processed = `export declare ${cleanDeclaration.replace(/^export\s+/, '')}`
  state.dtsLines.push(processed)
  return true
}

function processExportedEnum(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export enum')
    && !cleanDeclaration.startsWith('export const enum')) {
    return false
  }

  const processed = `export declare ${cleanDeclaration.replace(/^export\s+/, '')}`
  state.dtsLines.push(processed)

  return true
}

function processExportedNamespace(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export namespace'))
    return false

  const processed = `export declare ${cleanDeclaration.replace(/^export\s+/, '')}`
  state.dtsLines.push(processed)

  return true
}

function processModuleBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('declare module'))
    return false

  const processed = processModule(declarationText)
  state.dtsLines.push(processed)

  return true
}

function processSourceFile(content: string, state: ProcessingState, verbose?: boolean | string[]): void {
  const lines = content.split('\n')
  let currentBlock: string[] = []
  let currentComments: string[] = []
  let bracketDepth = 0
  let angleDepth = 0
  let inDeclaration = false
  let inExport = false
  state.currentScope = 'top'

  debugLog('source-processing', `Processing source file with ${lines.length} lines`, verbose)

  // First pass: process imports and type exports
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Handle export blocks
    if (trimmedLine.startsWith('export {')) {
      if (trimmedLine.includes('}')) {
        // Single-line export
        state.dtsLines.push(line)
        continue
      }

      inExport = true
      currentBlock = [line]

      continue
    }

    if (inExport) {
      currentBlock.push(line)
      if (line.includes('}')) {
        state.dtsLines.push(currentBlock.join('\n'))
        currentBlock = []
        inExport = false
      }

      continue
    }

    // Process imports
    if (line.includes('import ')) {
      processImports(line, state.importTracking, verbose)
      debugLog('import', `Processed import: ${line}`, verbose)
    }

    // Process type exports
    if (trimmedLine.startsWith('export type {')) {
      debugLog('type-export', `Found type export: ${trimmedLine}`, verbose)
      processTypeExport(trimmedLine, state)
      state.dtsLines.push(line)
      continue
    }

    // Process regular exports that might include types
    if (trimmedLine.startsWith('export {')) {
      debugLog('mixed-export', `Found mixed export: ${trimmedLine}`, verbose)
      processExport(trimmedLine, state, verbose)
      if (trimmedLine.includes('}')) {
        state.dtsLines.push(line)
      }
      continue
    }
  }

  // Second pass: process declarations and other content
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Skip lines we've already processed
    if (trimmedLine.startsWith('import ')
      || trimmedLine.startsWith('export type {')
      || trimmedLine.startsWith('export {')) {
      continue
    }

    // Track comments
    if (trimmedLine.startsWith('/*') || trimmedLine.startsWith('//')) {
      currentComments.push(line)
      continue
    }

    // Track depths
    const openCurly = (line.match(/\{/g) || []).length
    const closeCurly = (line.match(/\}/g) || []).length
    const openAngle = (line.match(/</g) || []).length
    const closeAngle = (line.match(/>/g) || []).length

    // Start of a new declaration
    if (!inDeclaration && isDeclarationStart(trimmedLine)) {
      debugLog('declaration', `Found declaration start: ${trimmedLine}`, verbose)
      inDeclaration = true
      currentBlock = [line]
      bracketDepth = openCurly - closeCurly
      angleDepth = openAngle - closeAngle
      continue
    }

    // If we're in a declaration, keep collecting lines
    if (inDeclaration) {
      currentBlock.push(line)
      bracketDepth += openCurly - closeCurly
      angleDepth += openAngle - closeAngle

      // Special handling for type declarations
      const isTypeDeclaration = currentBlock[0].trim().startsWith('type')
        || currentBlock[0].trim().startsWith('export type')

      if (isTypeDeclaration) {
        // For type declarations, we need to track the complete expression
        const nextLine = i < lines.length - 1 ? lines[i + 1]?.trim() : ''
        const shouldContinue = bracketDepth > 0 || angleDepth > 0
          || !trimmedLine.endsWith(';') // No semicolon yet
          || trimmedLine.endsWith('?') // Conditional type continues
          || trimmedLine.endsWith(':') // Property type continues
          || (nextLine && (
            nextLine.startsWith('?')
            || nextLine.startsWith(':')
            || nextLine.startsWith('|')
            || nextLine.startsWith('&')
            || nextLine.startsWith('extends')
            || nextLine.startsWith('=>')
          ))

        if (!shouldContinue) {
          debugLog('declaration-complete', `Type declaration complete at line ${i + 1}`, verbose)
          processBlock(currentBlock, currentComments, state, verbose)
          currentBlock = []
          currentComments = []
          inDeclaration = false
          bracketDepth = 0
          angleDepth = 0
        }
      }
      else {
        // Original handling for non-type declarations
        const isComplete = bracketDepth === 0 && angleDepth === 0 && trimmedLine.endsWith('}')
        const nextLine = i < lines.length - 1 ? lines[i + 1]?.trim() : ''
        const shouldContinue = bracketDepth > 0 || angleDepth > 0
          || (nextLine && !nextLine.startsWith('export') && !nextLine.startsWith('interface'))

        if (!shouldContinue || isComplete) {
          debugLog('declaration-complete', `Declaration complete at line ${i + 1}`, verbose)
          processBlock(currentBlock, currentComments, state, verbose)
          currentBlock = []
          currentComments = []
          inDeclaration = false
          bracketDepth = 0
          angleDepth = 0
        }
      }
    }
  }

  // Process any remaining block
  if (currentBlock.length > 0) {
    processBlock(currentBlock, currentComments, state, verbose)
  }
}

/**
 * Process imports and track their usage
 */
function processImports(line: string, state: ImportTrackingState, verbose?: boolean | string[]): void {
  debugLog('import-processing', `Processing import line: ${line}`, verbose)

  // Handle pure type imports (import type { X } from 'y')
  const typeImportMatch = line.match(/import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  if (typeImportMatch) {
    const [, types, module] = typeImportMatch
    handleTypeImports(types, module, state)
    return
  }

  // Handle default import with named imports
  const defaultWithNamedMatch = line.match(/import\s+([^,{\s]+)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  if (defaultWithNamedMatch) {
    const [, defaultImport, namedImports, module] = defaultWithNamedMatch
    handleDefaultImport(defaultImport, module, state)
    handleMixedImports(namedImports, module, state)
    return
  }

  // Handle default-only imports
  const defaultOnlyMatch = line.match(/import\s+([^,{\s]+)\s+from\s*['"]([^'"]+)['"]/)
  if (defaultOnlyMatch && !defaultWithNamedMatch) {
    const [, defaultImport, module] = defaultOnlyMatch
    handleDefaultImport(defaultImport, module, state)
    return
  }

  // Handle mixed imports
  const mixedImportMatch = line.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  if (mixedImportMatch) {
    const [, imports, module] = mixedImportMatch
    handleMixedImports(imports, module, state)
  }
}

function handleTypeImports(types: string, module: string, state: ImportTrackingState, verbose?: boolean | string[]): void {
  debugLog('type-import', `Handling type imports from ${module}: ${types}`, verbose)

  if (!state.typeImports.has(module)) {
    state.typeImports.set(module, new Set())
  }

  const typesList = types
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

  typesList.forEach((type) => {
    const [original, alias] = type.split(/\s+as\s+/).map(t => t.trim())
    const cleanType = original.replace(/^type\s+/, '')

    if (original && cleanType) {
      state.typeImports.get(module)!.add(cleanType)
      state.typeExportSources.set(cleanType, module)

      if (alias) {
        state.valueAliases.set(alias, cleanType)
      }
    }
  })
}

function handleDefaultImport(defaultImport: string, module: string, state: ImportTrackingState): void {
  if (!state.valueImports.has(module)) {
    state.valueImports.set(module, new Set())
  }

  // Only track the import, but don't mark as used until we confirm it's exported
  state.valueImports.get(module)!.add('default')
  state.importSources.set(defaultImport, module)
  state.valueAliases.set(defaultImport, 'default')
}

function handleMixedImports(imports: string, module: string, state: ImportTrackingState, verbose?: boolean | string[]): void {
  debugLog('mixed-import', `Handling mixed imports from ${module}: ${imports}`, verbose)

  // Parse imports
  const importsList = imports.split(',').map(imp => imp.trim()).filter(Boolean)

  importsList.forEach((imp) => {
    if (imp.startsWith('type ')) {
      // Handle type import
      const typePart = imp.replace(/^type\s+/, '')
      const [original, alias] = typePart.split(/\s+as\s+/).map(t => t.trim())

      if (!state.typeImports.has(module)) {
        state.typeImports.set(module, new Set())
      }
      state.typeImports.get(module)!.add(original)
      state.typeExportSources.set(original, module)

      if (alias) {
        state.valueAliases.set(alias, original)
        debugLog('type-alias', `Added type alias: ${alias} -> ${original}`, verbose)
      }
    }
    else {
      // Handle value import with potential alias
      const [original, alias] = imp.split(/\s+as\s+/).map(n => n.trim())

      if (!state.valueImports.has(module)) {
        state.valueImports.set(module, new Set())
      }

      // Track the import and its module
      state.valueImports.get(module)!.add(original)
      state.importSources.set(original, module)

      if (alias) {
        state.valueAliases.set(alias, original)
        state.importSources.set(alias, module)
        debugLog('value-alias', `Added value alias: ${alias} -> ${original} from ${module}`, verbose)
      }
    }
  })
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

  // Return declaration with no extra whitespace
  return [modifiedFirstLine, ...lines.slice(1)].join('\n').trimEnd()
}

function processTypeExport(line: string, state: ProcessingState, verbose?: boolean | string[]): void {
  debugLog('type-export-processing', `Processing type export: ${line}`, verbose)

  const typeExportMatch = line.match(/export\s+type\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?/)
  if (!typeExportMatch) {
    debugLog('type-export-error', 'Failed to match type export pattern', verbose)
    return
  }

  const [, types, sourceModule] = typeExportMatch
  debugLog('type-export-found', `Found types: ${types}, source: ${sourceModule || 'local'}`, verbose)

  types.split(',').forEach((typeExport) => {
    const [typeName, aliasName] = typeExport.trim().split(/\s+as\s+/).map(t => t.trim())
    const exportedName = aliasName || typeName

    state.importTracking.exportedTypes.add(exportedName)
    if (sourceModule) {
      state.importTracking.typeExportSources.set(exportedName, sourceModule)
    }
    debugLog('type-export-processed', `Added exported type: ${exportedName}`, verbose)
  })
}

/**
 * Process variable (const, let, var)  declarations with type inference
 */
function processVariable(declaration: string, isExported: boolean, state: ProcessingState, verbose?: boolean | string[]): string {
  // Handle declaration type correctly
  const declarationType = declaration.includes('let ')
    ? 'let'
    : declaration.includes('var ')
      ? 'var'
      : 'const'

  // Handle explicit type annotations first
  const explicitTypeMatch = declaration.match(/(?:export\s+)?(?:const|let|var)\s+([^:\s]+)\s*:\s*([^=]+)=/)
  if (explicitTypeMatch) {
    const [, name, type] = explicitTypeMatch
    return `${isExported ? 'export ' : ''}declare ${declarationType} ${name}: ${type.trim()};`
  }

  const valueMatch = declaration.match(/(?:export\s+)?(?:const|let|var)\s+([^=\s]+)\s*=\s*([\s\S]+)$/)
  if (!valueMatch)
    return declaration

  const [, name, rawValue] = valueMatch
  const trimmedValue = rawValue.trim()

  // Check for explicit return type in arrow functions
  const arrowWithType = trimmedValue.match(/^\(\s*.*?\)\s*:\s*([^=>\s{]).*=>/)
  if (arrowWithType) {
    const returnType = arrowWithType[1]
    return `${isExported ? 'export ' : ''}declare ${declarationType} ${name}: ${returnType};`
  }

  let type: string
  if (trimmedValue.includes('as const')) {
    const constValue = trimmedValue.replace(/\s*as\s*const\s*$/, '')
    type = inferConstType(constValue, state, verbose)
  }
  else if (trimmedValue.startsWith('{')) {
    type = inferComplexObjectType(trimmedValue, state)
  }
  else if (trimmedValue.startsWith('[')) {
    type = inferArrayType(trimmedValue, state, false, verbose)
  }
  else if (trimmedValue.includes('=>') || trimmedValue.includes('function')) {
    const funcType = extractFunctionType(trimmedValue, verbose)
    type = funcType || '(...args: any[]) => unknown'
  }
  else {
    type = inferValueType(trimmedValue)
  }

  return `${isExported ? 'export ' : ''}declare ${declarationType} ${name}: ${type};`
}

/**
 * Process function declarations with overloads
 */
function processFunction(declaration: string, usedTypes?: Set<string>, isExported = true, verbose?: boolean | string[]): string {
  debugLog('function-processing', `Processing function with potential JSDoc:\n${declaration}`, verbose)

  // Extract JSDoc if present
  const jsDocRegex = /\/\*\*\s*([\s\S]*?)\s*\*\//
  const jsDocMatch = declaration.match(jsDocRegex)
  const actualDeclaration = declaration.replace(jsDocRegex, '').trim()

  const signature = extractFunctionSignature(actualDeclaration, verbose)

  // Clean up parameters
  if (signature.params) {
    if (signature.params.includes('{')) {
      const paramMatch = actualDeclaration.match(/\{([^}]+)\}:\s*([^)]+)/)
      if (paramMatch) {
        const [, paramList, typeRef] = paramMatch
        // Clean up destructured parameters while preserving type information
        const cleanedParams = paramList
          .split(',')
          .map((p) => {
            const paramTrimmed = p.trim()
            if (!paramTrimmed)
              return null

            // Remove default values but preserve type annotations
            const [paramPart] = paramTrimmed.split('=')
            const paramName = paramPart.trim()

            // If parameter has type annotation, preserve it
            if (paramName.includes(':')) {
              const [name, type] = paramName.split(':').map(p => p.trim())
              return `${name}: ${type}`
            }

            return paramName
          })
          .filter(Boolean)
          .join(', ')

        signature.params = `{ ${cleanedParams} }: ${typeRef.trim()}`
      }
    }
    else {
      // Handle regular parameters
      const cleanedParams = signature.params
        .split(',')
        .map((param) => {
          const paramTrimmed = param.trim()
          if (!paramTrimmed)
            return null

          // Remove default values but preserve type annotations
          const [paramPart] = paramTrimmed.split('=')
          const paramWithoutDefault = paramPart.trim()

          // If parameter has type annotation, preserve it
          if (paramWithoutDefault.includes(':')) {
            const [paramName, paramType] = paramWithoutDefault.split(':').map(p => p.trim())
            return `${paramName}: ${paramType}`
          }

          return paramWithoutDefault
        })
        .filter(Boolean)
        .join(', ')

      signature.params = cleanedParams
    }
  }

  // Construct the output
  let output = ''

  if (jsDocMatch) {
    output += `${jsDocMatch[0]}\n`
  }

  output += [
    isExported ? 'export ' : '',
    'declare function ',
    signature.name,
    signature.generics || '',
    `(${signature.params})`,
    signature.returnType ? `: ${signature.returnType}` : '',
    ';',
  ].filter(Boolean).join('')

  return output
}

// Helper function to extract JSDoc comments (keep as is)
function extractJSDocComment(content: string): { jsDoc: string, remainingContent: string } {
  const jsDocMatch = content.match(/^(\s*\/\*\*[\s\S]*?\*\/\s*)/)
  if (!jsDocMatch) {
    return { jsDoc: '', remainingContent: content }
  }

  const jsDoc = jsDocMatch[1]
  const remainingContent = content.slice(jsDocMatch[0].length)
  return { jsDoc, remainingContent }
}

function formatObjectType(type: string): string {
  const trimmed = type.trim()
  if (!trimmed.startsWith('{'))
    return trimmed

  const content = trimmed.slice(1, -1).trim()
  if (!content)
    return '{}'

  // Properly parse and format each property
  const properties = content
    .split(/,?\s+/)
    .filter(Boolean)
    .map((prop) => {
      const parts = prop.split(':').map(p => p.trim())
      if (parts.length < 2)
        return prop // Handle malformed properties

      const name = parts[0].endsWith('?')
        ? parts[0].slice(0, -1)
        : parts[0]

      const type = parts[1]
      return `${name}${parts[0].endsWith('?') ? '?' : ''}: ${type}`
    })
    .join(', ')

  return `{ ${properties} }`
}

function getCleanDeclaration(declaration: string): string {
  // Remove leading comments while preserving the structure
  const lines = declaration.split('\n')
  let startIndex = 0

  while (startIndex < lines.length) {
    const line = lines[startIndex].trim()
    if (!line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*') && line !== '') {
      break
    }
    startIndex++
  }

  return lines.slice(startIndex).join('\n').trim()
}

function processGeneratorFunction(declaration: string): string {
  const jsDocRegex = /\/\*\*\s*([\s\S]*?)\s*\*\//
  const jsDocMatch = declaration.match(jsDocRegex)
  const actualDeclaration = declaration.replace(jsDocRegex, '').trim()

  const nameMatch = actualDeclaration.match(/function\*\s+([^(<\s]+)/)
  if (!nameMatch)
    return ''

  const [, name] = nameMatch
  let rest = actualDeclaration.slice(actualDeclaration.indexOf(name) + name.length).trim()

  // Extract generics
  let generics = ''
  if (rest.startsWith('<')) {
    let depth = 1
    let pos = 1
    let buffer = '<'

    for (; pos < rest.length && depth > 0; pos++) {
      const char = rest[pos]
      if (char === '<')
        depth++
      if (char === '>')
        depth--
      buffer += char
    }

    generics = buffer
    rest = rest.slice(pos).trim()
  }

  // Extract parameters and clean them
  let params = ''
  if (rest.startsWith('(')) {
    let depth = 1
    let pos = 1
    for (; pos < rest.length && depth > 0; pos++) {
      const char = rest[pos]
      if (char === '(')
        depth++
      if (char === ')')
        depth--
    }
    params = rest.slice(1, pos - 1).trim()
    rest = rest.slice(pos).trim()
  }

  // Extract return type
  let returnType = 'any'
  if (rest.startsWith(':')) {
    rest = rest.slice(1).trim()
    const match = rest.match(/([^{;]+)/)
    if (match) {
      returnType = match[1].trim()
    }
  }

  // Clean up parameters - remove default values but keep types
  const cleanedParams = params.split(',')
    .map((param) => {
      const [paramPart] = param.trim().split('=')
      return paramPart.trim()
    })
    .join(', ')

  // Construct the declaration
  const parts = [
    jsDocMatch ? jsDocMatch[0] : '',
    'export declare function*',
    name,
    generics,
    `(${cleanedParams})`,
    `:`,
    returnType,
    ';',
  ]

  return parts.filter(Boolean).join(' ')
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

function processObjectMethod(declaration: string, verbose?: boolean | string[]): ProcessedMethod {
  debugLog('process-method-start', `Processing method: ${declaration}`, verbose)

  // Regex to match the method declaration
  const methodPattern = /^(?:async\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^ {][^;{]*))?/
  const match = declaration.match(methodPattern)

  if (!match) {
    debugLog('process-method-error', `Failed to parse method declaration: ${declaration}`, verbose)
    return {
      name: declaration.split('(')[0].trim().replace(/^async\s+/, ''),
      signature: '() => unknown',
    }
  }

  const [, name, generics = '', params, returnTypeAnnotation = 'void'] = match

  let returnType = returnTypeAnnotation.trim()

  // Determine if the method is async
  const isAsync = /^async\s+/.test(declaration)

  // Adjust return type for async methods
  if (isAsync && !/^Promise<.*>$/.test(returnType)) {
    returnType = `Promise<${returnType}>`
  }

  debugLog('process-method-parsed', `Name: ${name}, Generics: ${generics}, Params: ${params}, ReturnType: ${returnType}`, verbose)

  const cleanParams = cleanParameterTypes(params || '')
  const signature = [
    generics ? `${generics}` : '',
    `(${cleanParams})`,
    '=>',
    returnType,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  debugLog('process-method-result', `Generated signature for ${name}: ${signature}`, verbose)
  return { name, signature }
}

function processObjectProperties(content: string, state?: ProcessingState, indentLevel = 0, verbose?: boolean | string[]): Array<{ key: string, value: string }> {
  debugLog('process-props', `Processing object properties at indent level ${indentLevel}`, verbose)
  const properties: Array<{ key: string, value: string }> = []
  const cleanContent = content.slice(1, -1).trim()
  if (!cleanContent)
    return properties

  let buffer = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let currentKey = ''
  let isParsingKey = true
  let colonFound = false

  for (let i = 0; i < cleanContent.length; i++) {
    const char = cleanContent[i]
    const prevChar = i > 0 ? cleanContent[i - 1] : ''

    // Handle string boundaries
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
      if (char === '{' || char === '[' || char === '(') {
        depth++
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
      }
      else if (depth === 0) {
        if (char === ':' && !colonFound) {
          colonFound = true
          currentKey = buffer.trim()
          debugLog('process-props-key', `Found key: ${currentKey}`, verbose)
          buffer = ''
          isParsingKey = false
          continue
        }
        else if ((char === ',' || char === ';') && !isParsingKey) {
          if (currentKey) {
            const trimmedBuffer = buffer.trim()
            debugLog('process-props-value', `Processing value for key ${currentKey}: ${trimmedBuffer.substring(0, 50)}...`, verbose)

            const isMethodDecl = currentKey.includes('(') || currentKey.match(/^\s*(?:async\s+)?\w+\s*(?:<[^>]+>)?\s*\(/)
            debugLog('method-check', `Checking if method declaration: ${currentKey}`, verbose)

            if (isMethodDecl) {
              debugLog('process-props-method', `Detected method: ${currentKey} with body length: ${trimmedBuffer.length}`, verbose)
              const { name, signature } = processObjectMethod(currentKey, verbose)
              properties.push({ key: name, value: signature })
            }
            else {
              const processedValue = processPropertyValue(trimmedBuffer, indentLevel + 1, state, verbose)
              properties.push({ key: normalizePropertyKey(currentKey), value: processedValue })
            }
          }
          buffer = ''
          currentKey = ''
          isParsingKey = true
          colonFound = false
          continue
        }
      }
    }

    buffer += char
  }

  // Handle final property
  if (currentKey && !isParsingKey && buffer.trim()) {
    const trimmedBuffer = buffer.trim()
    const isMethodDecl = currentKey.includes('(') || currentKey.match(/^\s*(?:async\s+)?\w+\s*(?:<[^>]+>)?\s*\(/)
    if (isMethodDecl) {
      debugLog('process-props-method', `Detected final method: ${currentKey}`, verbose)
      const { name, signature } = processObjectMethod(currentKey, verbose)
      properties.push({ key: name, value: signature })
    }
    else {
      const processedValue = processPropertyValue(trimmedBuffer, indentLevel + 1, state, verbose)
      properties.push({ key: normalizePropertyKey(currentKey), value: processedValue })
    }
  }

  debugLog('process-props', `Processed ${properties.length} properties`, verbose)

  return properties
}

function processPropertyValue(value: string, indentLevel: number, state?: ProcessingState, verbose?: boolean | string[]): string {
  const trimmed = value.trim()
  debugLog('process-value', `Processing value: ${trimmed.substring(0, 100)}...`, verbose)

  // Check if this is an object with method declarations first
  if (trimmed.startsWith('{') && trimmed.includes('(') && trimmed.includes(')') && trimmed.includes(':')) {
    debugLog('process-value', 'Detected potential object with methods', verbose)
    return inferComplexObjectType(trimmed, state, indentLevel)
  }

  // Handle arrays before methods since they might contain method-like structures
  if (trimmed.startsWith('[')) {
    debugLog('process-value', 'Detected array', verbose)
    return inferArrayType(trimmed, state, true, verbose)
  }

  // Handle regular objects
  if (trimmed.startsWith('{')) {
    debugLog('process-value', 'Detected object', verbose)

    return inferComplexObjectType(trimmed, state, indentLevel)
  }

  // Handle function expressions
  if (trimmed.includes('=>') || trimmed.includes('function')) {
    debugLog('process-value', 'Detected function expression', verbose)
    const funcType = extractFunctionType(trimmed, verbose)

    return funcType || '(...args: any[]) => unknown'
  }

  // Handle primitive values and literals
  if (/^(['"`]).*\1$/.test(trimmed) || !Number.isNaN(Number(trimmed))
    || trimmed === 'true' || trimmed === 'false') {
    return trimmed
  }

  return 'unknown'
}

/**
 * Track type usage in declarations
 */
function trackTypeUsage(content: string, state: ImportTrackingState): void {
  const typeRefPattern = /(?:extends|implements|:|<)\s*([A-Z][a-zA-Z0-9]*(?:<[^>]+>)?)/g
  const paramTypePattern = /(?:^|[\s<,])\s*([A-Z][a-zA-Z0-9]*)(?:[<>,\s]|$)/g

  // Add new pattern for Promise generic parameters
  const promiseGenericPattern = /Promise<([A-Z][a-zA-Z0-9]*)>/g
  let match: RegExpExecArray | null

  // Track Promise generic parameters
  while ((match = promiseGenericPattern.exec(content)) !== null) {
    const typeName = match[1]
    if (Array.from(state.typeImports.values()).some(types => types.has(typeName))) {
      state.usedTypes.add(typeName)
    }
  }

  // Rest of existing tracking logic...
  while ((match = typeRefPattern.exec(content)) !== null) {
    const typeName = match[1].split('<')[0]
    if (Array.from(state.typeImports.values()).some(types => types.has(typeName))) {
      state.usedTypes.add(typeName)
    }
  }

  while ((match = paramTypePattern.exec(content)) !== null) {
    const typeName = match[1]
    if (Array.from(state.typeImports.values()).some(types => types.has(typeName))) {
      state.usedTypes.add(typeName)
    }
  }

  // Track exported types
  const exportedTypePattern = /export\s+(?:type|interface)\s+([A-Z][a-zA-Z0-9]*)/g
  while ((match = exportedTypePattern.exec(content)) !== null) {
    const typeName = match[1]
    state.exportedTypes.add(typeName)
  }
}

/**
 * Track value usage in declarations
 */
function trackValueUsage(content: string, state: ImportTrackingState, verbose?: boolean | string[]): void {
  debugLog('content', `Processing content:\n${content}`, verbose)

  // Track exports first
  const exportMatches = content.matchAll(/export\s*\{([^}]+)\}/g)
  for (const match of exportMatches) {
    const exports = match[1].split(',').map(e => e.trim())
    exports.forEach((exp) => {
      const [name] = exp.split(/\s+as\s+/).map(n => n.trim())
      if (!name.startsWith('type ')) {
        state.usedValues.add(name)
        debugLog('export-tracking', `Added exported value: ${name}`, verbose)
      }
    })
  }

  // Process default export using defaultExportValue
  if (state.defaultExportValue) {
    const defaultExport = state.defaultExportValue
    debugLog('default-export', `Processing default export: ${defaultExport}`, verbose)
    state.usedValues.add(defaultExport)

    // Look for alias mapping
    const aliasEntry = Array.from(state.valueAliases.entries()).find(([alias]) => alias === defaultExport)

    if (aliasEntry) {
      const [alias, originalName] = aliasEntry
      debugLog('default-export', `Found alias mapping: ${alias} -> ${originalName}`, verbose)

      // Mark both the alias and the original as used
      state.usedValues.add(originalName)
      state.usedValues.add(alias)

      // Track the module this came from
      const sourceModule = state.importSources.get(originalName)
      if (sourceModule) {
        debugLog('default-export', `Original value ${originalName} comes from module: ${sourceModule}`, verbose)
        if (!state.valueImports.has(sourceModule)) {
          state.valueImports.set(sourceModule, new Set())
        }
        state.valueImports.get(sourceModule)?.add(originalName)
      }
    }
    else {
      debugLog('default-export', `No alias mapping found for default export ${defaultExport}`, verbose)
      debugLog('default-export', `Current aliases: ${JSON.stringify(Array.from(state.valueAliases.entries()))}`, verbose)
    }
  }
  else {
    debugLog('default-export', 'No default export found in state.', verbose)
  }

  // Log used values after processing
  debugLog('values', `Final used values: ${JSON.stringify(Array.from(state.usedValues))}`, verbose)
}

function debugLog(category: string, message: string, verbose?: boolean | string[]): void {
  if (verbose === false) {
    return
  }

  if (verbose === true || config.verbose === true) {
    // eslint-disable-next-line no-console
    console.debug(`[dtsx:${category}] ${message}`)
  }

  if (Array.isArray(verbose)) {
    // Check if any of the verbose categories match the prefix
    const matches = verbose.some(prefix => category.startsWith(prefix))
    if (matches) {
      // eslint-disable-next-line no-console
      console.log(`[dtsx:${category}] ${message}`)
    }
  }

  if (Array.isArray(config.verbose)) {
    // Check if any of the verbose categories match the prefix
    const matches = config.verbose.some(prefix => category.startsWith(prefix))
    if (matches) {
      // eslint-disable-next-line no-console
      console.log(`[dtsx:${category}] ${message}`)
    }
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

function normalizePropertyKey(key: string): string {
  // Remove any existing quotes
  const cleanKey = key.replace(/^['"`]|['"`]$/g, '')

  // Check if the key needs quotes (contains special characters or is not a valid identifier)
  if (!/^[a-z_$][\w$]*$/i.test(cleanKey)) {
    return `'${cleanKey}'`
  }

  return cleanKey
}

/**
 * Split array elements while preserving nested structures
 */
function splitArrayElements(content: string, verbose?: boolean | string[]): string[] {
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
          debugLog('array-split', `Found element: ${trimmed}`, verbose)
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
    debugLog('array-split', `Found element: ${trimmed}`, verbose)
    elements.push(trimmed)
  }

  return elements
}

function splitFunctionDeclarations(content: string): string[] {
  const declarations: string[] = []
  const lines = content.split('\n')
  let current: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Start of a new function declaration
    if ((line.startsWith('export function') || line.startsWith('function')) && current.length > 0) {
      declarations.push(current.join('\n'))
      current = []
    }

    current.push(lines[i])
  }

  if (current.length > 0) {
    declarations.push(current.join('\n'))
  }

  return declarations
}
