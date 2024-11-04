/* eslint-disable regexp/no-super-linear-backtracking, no-cond-assign, regexp/no-misleading-capturing-group */
import type { FunctionSignature, ImportTrackingState, ProcessingState } from './types'

interface ProcessedMethod {
  name: string
  signature: string
}

interface BalancedSymbolResult {
  /** The extracted content including the opening and closing symbols */
  content: string
  /** The remaining text after the closing symbol */
  rest: string
}

function cleanParameterTypes(params: string): string {
  debugLog(undefined, 'params', `Cleaning parameters: ${params}`)

  if (!params.trim())
    return ''

  const parts: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let inDestructuring = false

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
      if (char === '{') {
        inDestructuring = true
        depth++
      }
      if (char === '}') {
        inDestructuring = false
        depth--
      }
      if (char === '<' || char === '(')
        depth++
      if (char === '>' || char === ')')
        depth--

      if (char === ',' && depth === 0 && !inDestructuring) {
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

  const result = parts.join(', ')
  debugLog(undefined, 'params', `Cleaned parameters: ${result}`)
  return result
}

function cleanSingleParameter(param: string): string {
  debugLog(undefined, 'param-clean', `Cleaning parameter: ${param}`)

  // Handle parameters with type annotations
  const typeMatch = param.match(/^([^:]+):\s*([^=]+)(?:\s*=\s*.+)?$/)
  if (typeMatch) {
    const [, paramName, paramType] = typeMatch
    // Clean intersection types while avoiding extra spaces
    const cleanedType = paramType
      .replace(/\s*&\s*/g, ' & ') // Changed from '&' to ' & '
      .replace(/\s{2,}/g, ' ')
      .trim()

    const cleanedParam = `${paramName.trim()}: ${cleanedType}`
    debugLog(undefined, 'param-clean', `Cleaned to: ${cleanedParam}`)
    return cleanedParam
  }

  // Handle parameters with default values but no explicit type
  const defaultMatch = param.match(/^([^=]+)\s*=\s*(.+)$/)
  if (defaultMatch) {
    const [, paramName, defaultValue] = defaultMatch
    const inferredType = inferTypeFromDefaultValue(defaultValue.trim())
    const cleanedParam = `${paramName.trim()}: ${inferredType}`
    debugLog(undefined, 'param-clean', `Inferred type: ${cleanedParam}`)
    return cleanedParam
  }

  // For simple parameters with no type or default
  return param.trim()
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
  // debugLog(state, 'init', 'Starting DTS extraction')

  // Process imports first
  sourceCode.split('\n').forEach((line) => {
    if (line.includes('import ')) {
      processImports(line, state.importTracking)
      // debugLog(state, 'import', `Processed import: ${line.trim()}`)
    }
  })

  // Process declarations
  processSourceFile(sourceCode, state)

  // Log the state of exports before formatting
  // debugLog(state, 'export-summary', `Found ${state.defaultExports.size} default exports`)
  // debugLog(state, 'export-summary', `Found ${state.exportAllStatements.length} export * statements`)

  // Final pass to track what actually made it to the output
  state.dtsLines.forEach((line) => {
    if (line.trim() && !line.startsWith('import')) {
      trackTypeUsage(line, state.importTracking)
      trackValueUsage(line, state.importTracking, state.dtsLines)
    }
  })

  // Generate optimized imports based on actual output
  const optimizedImports = generateOptimizedImports(state.importTracking)
  // debugLog(state, 'import-summary', `Generated ${optimizedImports.length} optimized imports`)

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
function extractFunctionSignature(declaration: string): FunctionSignature {
  debugLog(undefined, 'signature-start', `Processing declaration: ${declaration}`)

  // Clean up the declaration
  const cleanDeclaration = getCleanDeclaration(declaration)
  debugLog(undefined, 'signature-clean', `Clean declaration: ${cleanDeclaration}`)

  // Extract function name
  const name = extractFunctionName(cleanDeclaration)
  let rest = cleanDeclaration.slice(cleanDeclaration.indexOf(name) + name.length).trim()
  debugLog(undefined, 'signature-content', `Content after name: ${rest}`)

  // Extract generics with improved depth tracking
  const { generics, rest: restAfterGenerics } = extractGenerics(rest)
  rest = restAfterGenerics.trim()
  debugLog(undefined, 'signature-after-generics', `Remaining content: ${rest}`)

  // Extract parameters
  const { params, rest: restAfterParams } = extractParams(rest)
  rest = restAfterParams.trim()
  debugLog(undefined, 'signature-after-params', `Remaining content: ${rest}`)

  // Extract return type
  const { returnType } = extractReturnType(rest, cleanDeclaration)
  debugLog(undefined, 'signature-return', `Extracted return type: ${returnType}`)

  const signature = {
    name,
    generics,
    params,
    returnType,
  }

  debugLog(undefined, 'signature-final', `Final signature object: ${JSON.stringify(signature, null, 2)}`)
  return signature
}

function extractFunctionName(declaration: string): string {
  const functionMatch = declaration.match(/^(?:export\s+)?(?:async\s+)?function\s*\*?\s*([^(<\s]+)/)
  if (!functionMatch) {
    throw new Error('Invalid function declaration')
  }
  return functionMatch[1]
}

function extractGenerics(rest: string): { generics: string, rest: string } {
  let generics = ''
  if (rest.startsWith('<')) {
    let depth = 1 // Start at 1 since we're starting with an opening bracket
    let pos = 0
    let buffer = '<' // Start buffer with opening bracket
    let inString = false
    let stringChar = ''

    debugLog(undefined, 'generics-input', `Starting generic extraction with: ${rest}`)

    // Start from position 1 since we already handled the first '<'
    for (let i = 1; i < rest.length; i++) {
      const char = rest[i]
      const nextChar = i < rest.length - 1 ? rest[i + 1] : ''
      const prevChar = i > 0 ? rest[i - 1] : ''

      debugLog(undefined, 'generics-char', `Processing char: ${char}, next char: ${nextChar}, depth: ${depth}, pos: ${i}`)

      // Handle string boundaries
      if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true
          stringChar = char
          debugLog(undefined, 'generics-string', `Entering string with ${stringChar}`)
        }
        else if (char === stringChar) {
          inString = false
          debugLog(undefined, 'generics-string', 'Exiting string')
        }
      }

      // Track depth when not in string
      if (!inString) {
        if (char === '<') {
          depth++
          debugLog(undefined, 'generics-depth', `Increasing depth to ${depth} at pos ${i}`)
        }
        else if (char === '>') {
          depth--
          debugLog(undefined, 'generics-depth', `Decreasing depth to ${depth} at pos ${i}`)

          // If we hit zero depth and the next char is also '>', include both
          if (depth === 0 && nextChar === '>') {
            buffer += '>>' // Add both closing brackets
            pos = i + 1 // Skip the next '>' since we've included it
            debugLog(undefined, 'generics-complete', `Found double closing bracket at pos ${i}, final buffer: ${buffer}`)
            break
          }
          else if (depth === 0) {
            buffer += '>'
            pos = i
            debugLog(undefined, 'generics-complete', `Found single closing bracket at pos ${i}, final buffer: ${buffer}`)
            break
          }
        }
      }

      if (depth > 0) { // Only add to buffer if we're still inside generic parameters
        buffer += char
        debugLog(undefined, 'generics-buffer', `Current buffer: ${buffer}`)
      }
    }

    if (buffer) {
      generics = buffer
      rest = rest.slice(pos + 1)
      debugLog(undefined, 'generics-success', `Successfully extracted generics: ${generics}`)
      debugLog(undefined, 'generics-rest', `Remaining text: ${rest}`)
    }
    else {
      debugLog(undefined, 'generics-fail', `Failed to extract generics from: ${rest}`)
    }
  }
  return { generics, rest }
}

function extractParams(rest: string): { params: string, rest: string } {
  let params = ''
  if (rest.includes('(')) {
    const start = rest.indexOf('(')
    let depth = 1
    let pos = start + 1
    let buffer = ''

    debugLog(undefined, 'params-extraction-start', `Starting params extraction from pos ${pos}: ${rest}`)

    for (; pos < rest.length; pos++) {
      const char = rest[pos]

      if (char === '(')
        depth++
      if (char === ')') {
        depth--
        if (depth === 0) {
          debugLog(undefined, 'params-depth-zero', `Found closing parenthesis at pos ${pos}`)
          break
        }
      }

      buffer += char
    }

    params = buffer.trim()
    rest = rest.slice(pos + 1).trim()
    debugLog(undefined, 'signature-params', `Extracted params: ${params}`)
  }
  return { params, rest }
}

function extractReturnType(rest: string): { returnType: string } {
  let returnType = 'void'
  if (rest.startsWith(':')) {
    debugLog(undefined, 'return-start', `Starting return type extraction with: ${rest}`)
    rest = rest.slice(1).trim()

    let depth = 0
    let buffer = ''
    let i = 0
    let inString = false
    let stringChar = ''
    let foundEnd = false

    debugLog(undefined, 'return-extraction', 'Starting character-by-character extraction')

    while (i < rest.length && !foundEnd) {
      const char = rest[i]
      const prevChar = i > 0 ? rest[i - 1] : ''
      // const nextChar = i < rest.length - 1 ? rest[i + 1] : ''

      debugLog(undefined, 'return-char', `Pos ${i}: Char "${char}", Depth ${depth}, InString ${inString}, Buffer length ${buffer.length}`)

      // Handle string boundaries
      if ((char === '"' || char === '\'' || char === '`') && prevChar !== '\\') {
        if (!inString) {
          inString = true
          stringChar = char
          debugLog(undefined, 'return-string', `Entering string with ${stringChar}`)
        }
        else if (char === stringChar) {
          inString = false
          debugLog(undefined, 'return-string', 'Exiting string')
        }
      }

      // Track depth when not in string
      if (!inString) {
        if (char === '{' || char === '<' || char === '(') {
          depth++
          debugLog(undefined, 'return-depth', `Opening bracket, increasing depth to ${depth}`)
        }
        else if (char === '}' || char === '>' || char === ')') {
          depth--
          debugLog(undefined, 'return-depth', `Closing bracket, decreasing depth to ${depth}`)

          // If we hit depth 0 with a closing brace, this might be the end of our type
          if (depth === 0 && char === '}') {
            buffer += char
            // Look ahead to see if this is followed by a function body
            const nextNonWhitespace = rest.slice(i + 1).trim()[0]
            if (nextNonWhitespace === '{') {
              debugLog(undefined, 'return-end', `Found end of return type at pos ${i}, next char is function body`)
              foundEnd = true
              break
            }
          }
        }

        // Stop at semicolons at depth 0
        if (depth === 0 && char === ';') {
          debugLog(undefined, 'return-end', 'Found semicolon at depth 0')
          foundEnd = true
          break
        }
      }

      buffer += char
      debugLog(undefined, 'return-buffer', `Updated buffer: ${buffer}`)
      i++
    }

    returnType = buffer.trim()
    debugLog(undefined, 'return-final', `Final extracted return type: ${returnType}`)
  }
  return { returnType }
}

function extractFunctionType(value: string): string | null {
  debugLog(undefined, 'extract-function', `Extracting function type from: ${value}`)

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
function generateOptimizedImports(state: ImportTrackingState): string[] {
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

function extractCompleteObjectContent(value: string): string | null {
  // debugLog(state, 'extract-object', `Processing object of length ${value.length}`)
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
function inferArrayType(value: string, state?: ProcessingState, preserveLineBreaks = false): string {
  const content = value.slice(1, -1).trim()
  const isConstAssertion = value.trim().endsWith('as const')

  if (!content)
    return isConstAssertion ? 'readonly unknown[]' : 'unknown[]'

  const elements = splitArrayElements(content)

  // Handle const assertions
  if (isConstAssertion || elements.some(el => el.includes('as const'))) {
    const tuples = elements.map((el) => {
      const cleaned = el.trim().replace(/\s*as\s*const\s*$/, '').trim()
      return inferConstArrayType(cleaned, state)
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
      return inferArrayType(trimmed, state)
    }
    else if (trimmed.startsWith('{')) {
      return inferComplexObjectType(trimmed, state)
    }
    else if (trimmed.includes('=>') || trimmed.includes('function')) {
      const funcType = extractFunctionType(trimmed)
      return funcType ? `(${funcType})` : '((...args: any[]) => unknown)'
    }
    else {
      return normalizeTypeReference(trimmed)
    }
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
function inferComplexObjectType(value: string, state?: ProcessingState, indentLevel = 0): string {
  const content = extractCompleteObjectContent(value)
  if (!content)
    return 'Record<string, unknown>'

  // Calculate indentation based on nesting level
  const baseIndent = '  '.repeat(indentLevel)
  const propIndent = '  '.repeat(indentLevel + 1)
  const closingIndent = baseIndent // Keep closing brace aligned with opening

  const props = processObjectProperties(content, state, indentLevel)
  if (!props.length)
    return '{}'

  const propertyStrings = props.map(({ key, value }) => {
    return `${propIndent}${key}: ${value}`
  })

  // Format the object with consistent indentation
  return `{\n${propertyStrings.join(';\n')}\n${closingIndent}}`
}

function inferConstArrayType(value: string, state?: ProcessingState): string {
  // debugLog(state, 'infer-const', `Inferring const array type for: ${value}`)

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
    const elements = splitArrayElements(content)

    // Build tuple type
    const literalTypes = elements.map((element) => {
      let trimmed = element.trim()
      // debugLog(state, 'const-tuple-element', `Processing tuple element: ${trimmed}`)

      // Clean up any 'as cons' or 'as const' suffixes first
      if (trimmed.includes('] as cons') || trimmed.includes('] as const')) {
        trimmed = trimmed
          .replace(/\]\s*as\s*cons.*$/, '')
          .replace(/\]\s*as\s*const.*$/, '')
          .trim()
      }

      // Handle nested arrays
      if (trimmed.startsWith('[')) {
        return inferConstArrayType(trimmed, state)
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

    // debugLog(state, 'const-tuple-result', `Generated tuple types: [${literalTypes.join(', ')}]`)
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

function inferConstType(value: string, state: ProcessingState): string {
  if (value.startsWith('{')) {
    return inferComplexObjectType(value, state)
  }
  if (value.startsWith('[')) {
    return inferArrayType(value, state, /* preserveLineBreaks */ true)
  }
  return value
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
    || trimmed.startsWith('declare module')
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

function processBlock(lines: string[], comments: string[], state: ProcessingState): void {
  const declarationText = lines.join('\n')
  const cleanDeclaration = removeLeadingComments(declarationText).trim()

  debugLog(state, 'block-processing', `Full block content:\n${cleanDeclaration}`)

  if (!cleanDeclaration) {
    debugLog(state, 'block-processing', 'Empty declaration block')
    return
  }

  // Early check for variables inside functions
  if (isVariableInsideFunction(cleanDeclaration, state)) {
    debugLog(state, 'block-processing', 'Skipping variable declaration inside function')
    return
  }

  // Split declarations if multiple are found and they're functions
  if (cleanDeclaration.includes('\n\nexport function') || cleanDeclaration.includes('\n\nfunction')) {
    const declarations = splitFunctionDeclarations(cleanDeclaration)
    if (declarations.length > 1) {
      debugLog(state, 'block-processing', `Found ${declarations.length} function declarations to process`)
      declarations.forEach((declaration) => {
        const declarationLines = declaration.split('\n')
        processBlock(declarationLines, comments, state)
      })
      return
    }
  }

  // Try each processor in order
  if (processFunctionBlock(cleanDeclaration, state))
    return
  if (processVariableBlock(cleanDeclaration, lines, state))
    return
  if (processInterfaceBlock(cleanDeclaration, declarationText, state))
    return
  if (processTypeBlock(cleanDeclaration, declarationText, state))
    return
  if (processDefaultExportBlock(cleanDeclaration, state))
    return
  if (processExportAllBlock(cleanDeclaration, state))
    return
  if (processExportBlock(cleanDeclaration, declarationText, state))
    return
  if (processModuleBlock(cleanDeclaration, declarationText, state))
    return

  debugLog(state, 'processing', `Unhandled declaration type: ${cleanDeclaration.split('\n')[0]}`)
}

function processVariableBlock(cleanDeclaration: string, lines: string[], state: ProcessingState): boolean {
  const variableMatch = cleanDeclaration.match(/^(?:export\s+)?(const|let|var)\s+/)
  if (!variableMatch)
    return false

  // Double-check we're not inside a function
  if (isVariableInsideFunction(cleanDeclaration, state)) {
    debugLog(state, 'variable-processing', 'Skipping variable inside function')
    return true // Return true because we handled it (by skipping)
  }

  const isExported = cleanDeclaration.startsWith('export')

  // Only process variables at the top level
  if (state.currentScope === 'top') {
    const fullDeclaration = lines.join('\n')
    state.dtsLines.push(processVariable(fullDeclaration, isExported, state))
  }
  else {
    debugLog(state, 'block-processing', 'Skipping variable declared inside a function')
  }
  return true
}

function processFunctionBlock(cleanDeclaration: string, state: ProcessingState): boolean {
  debugLog(state, 'function-processing', `Processing potential function block: ${cleanDeclaration.slice(0, 100)}...`)

  // First check for generator functions
  if (/^(?:export\s+)?(?:async\s+)?function\s*\*/.test(cleanDeclaration)) {
    debugLog(state, 'block-processing', 'Processing generator function declaration')
    const processed = processGeneratorFunction(cleanDeclaration, state)
    if (processed) {
      state.dtsLines.push(processed)
      return true
    }
  }

  // Regular function detection
  if (!/^(?:export\s+)?(?:async\s+)?function\s+[a-zA-Z_$][\w$]*/.test(cleanDeclaration))
    return false

  debugLog(state, 'block-processing', 'Processing function declaration')

  // Extract signature
  let signatureEnd = 0
  let parenDepth = 0
  let angleDepth = 0
  // const braceDepth = 0

  for (let i = 0; i < cleanDeclaration.length; i++) {
    const char = cleanDeclaration[i]

    if (char === '(')
      parenDepth++
    if (char === ')')
      parenDepth--

    if (char === '<')
      angleDepth++
    if (char === '>')
      angleDepth--

    if (char === '{') {
      if (parenDepth === 0 && angleDepth === 0) {
        signatureEnd = i
        break
      }
    }
  }

  // If we didn't find '{', set signatureEnd to the end of the declaration
  if (signatureEnd === 0)
    signatureEnd = cleanDeclaration.length

  const signaturePart = cleanDeclaration.slice(0, signatureEnd).trim()

  debugLog(state, 'signature-extraction', `Extracted signature: ${signaturePart}`)

  const isExported = signaturePart.startsWith('export')
  const processed = processFunction(signaturePart, state.usedTypes, isExported)
  if (processed) {
    debugLog(state, 'function-processed', `Generated declaration: ${processed}`)
    state.dtsLines.push(processed)
  }

  return true
}

function processInterfaceBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('interface') && !cleanDeclaration.startsWith('export interface'))
    return false

  const isExported = cleanDeclaration.startsWith('export')
  state.dtsLines.push(processInterface(declarationText, isExported))
  return true
}

function processTypeBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('type') && !cleanDeclaration.startsWith('export type'))
    return false

  const isExported = cleanDeclaration.startsWith('export')
  state.dtsLines.push(processType(declarationText, isExported))
  return true
}

function processDefaultExportBlock(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export default'))
    return false

  // Store the complete default export statement
  const defaultExport = cleanDeclaration.endsWith(';')
    ? cleanDeclaration
    : `${cleanDeclaration};`

  state.defaultExports.add(defaultExport)
  return true
}

function processExportAllBlock(cleanDeclaration: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export *'))
    return false

  state.exportAllStatements.push(cleanDeclaration)
  state.dtsLines.push(cleanDeclaration)
  return true
}

function processExportBlock(cleanDeclaration: string, declarationText: string, state: ProcessingState): boolean {
  if (!cleanDeclaration.startsWith('export'))
    return false

  // Handle various export types
  if (processExportedClass(cleanDeclaration, state))
    return true
  if (processExportedEnum(cleanDeclaration, state))
    return true
  if (processExportedNamespace(cleanDeclaration, state))
    return true

  // Handle named exports
  if (cleanDeclaration.startsWith('export {')) {
    state.dtsLines.push(declarationText)
    return true
  }

  // Log unhandled export
  debugLog(
    state,
    'processing',
    `Unhandled exported declaration type: ${cleanDeclaration.split('\n')[0]}`,
  )
  return true
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

export function processSpecificDeclaration(declarationWithoutComments: string, fullDeclaration: string, state: ProcessingState): void {
  state.debug.currentProcessing = declarationWithoutComments
  // debugLog(state, 'processing', `Processing declaration: ${declarationWithoutComments.substring(0, 100)}...`)

  if (declarationWithoutComments.startsWith('export default')) {
    // debugLog(state, 'default-export', `Found default export: ${declarationWithoutComments}`)

    // Store the complete default export statement
    const defaultExport = declarationWithoutComments.endsWith(';')
      ? declarationWithoutComments
      : `${declarationWithoutComments};`

    state.defaultExports.add(defaultExport)
    // debugLog(state, 'default-export', `Added to default exports: ${defaultExport}`)
    return
  }

  if (declarationWithoutComments.startsWith('declare module')) {
    // debugLog(state, 'module-declaration', `Found module declaration: ${declarationWithoutComments}`)
    const processed = processModule(fullDeclaration)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('export const')
    || declarationWithoutComments.startsWith('const')
  ) {
    // debugLog(state, 'variable-declaration', `Found const declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.trimStart().startsWith('export')
    const processed = processVariable(fullDeclaration, isExported, state)
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('interface')
    || declarationWithoutComments.startsWith('export interface')
  ) {
    // debugLog(state, 'interface-declaration', `Found interface declaration: ${declarationWithoutComments}`)
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
    // debugLog(state, 'type-declaration', `Found type declaration: ${declarationWithoutComments}`)
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
    // debugLog(state, 'function-declaration', `Found function declaration: ${declarationWithoutComments}`)

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
    // debugLog(state, 'export-all-declaration', `Found export all declaration: ${declarationWithoutComments}`)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (declarationWithoutComments.startsWith('export {')) {
    // debugLog(state, 'export-declaration', `Found export declaration: ${declarationWithoutComments}`)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (declarationWithoutComments.startsWith('export type {')) {
    // debugLog(state, 'export-type-declaration', `Found export type declaration: ${declarationWithoutComments}`)
    state.dtsLines.push(fullDeclaration)
    return
  }

  if (
    declarationWithoutComments.startsWith('class')
    || declarationWithoutComments.startsWith('export class')
    || declarationWithoutComments.startsWith('abstract class')
    || declarationWithoutComments.startsWith('export abstract class')
  ) {
    // debugLog(state, 'class-declaration', `Found class declaration: ${declarationWithoutComments}`)
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
    // debugLog(state, 'enum-declaration', `Found enum declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    state.dtsLines.push(processed)
    return
  }

  if (
    declarationWithoutComments.startsWith('namespace')
    || declarationWithoutComments.startsWith('export namespace')
  ) {
    // debugLog(state, 'namespace-declaration', `Found namespace declaration: ${declarationWithoutComments}`)
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
    // debugLog(state, 'variable-declaration', `Found variable declaration: ${declarationWithoutComments}`)
    const isExported = declarationWithoutComments.startsWith('export')
    const processed = `${isExported ? 'export ' : ''}declare ${declarationWithoutComments.replace(/^export\s+/, '')}`
    state.dtsLines.push(processed)
    return
  }

  console.warn('Unhandled declaration type:', declarationWithoutComments.split('\n')[0])
}

function processSourceFile(content: string, state: ProcessingState): void {
  const lines = content.split('\n')
  let currentBlock: string[] = []
  let currentComments: string[] = []
  let bracketDepth = 0
  let parenDepth = 0
  let inDeclaration = false
  state.currentScope = 'top'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()

    // Track comments
    if (trimmedLine.startsWith('/*') || trimmedLine.startsWith('//')) {
      currentComments.push(line)
      continue
    }

    // Start of a new declaration - now includes generator functions
    if (isDeclarationStart(trimmedLine) && bracketDepth === 0) {
      if (inDeclaration && currentBlock.length > 0) {
        processBlock(currentBlock, currentComments, state)
        currentBlock = []
        currentComments = []
        bracketDepth = 0
        parenDepth = 0
      }
      inDeclaration = true
      currentBlock = [line]

      // Update depths
      parenDepth += (line.match(/\(/g) || []).length
      parenDepth -= (line.match(/\)/g) || []).length
      bracketDepth += (line.match(/\{/g) || []).length
      bracketDepth -= (line.match(/\}/g) || []).length

      // Update scope
      if (/^(?:export\s+)?(?:async\s+)?function\*?/.test(trimmedLine)) {
        state.currentScope = 'function'
      }

      continue
    }

    // Collecting declaration lines
    if (inDeclaration) {
      currentBlock.push(line)

      // Update depths
      parenDepth += (line.match(/\(/g) || []).length
      parenDepth -= (line.match(/\)/g) || []).length
      bracketDepth += (line.match(/\{/g) || []).length
      bracketDepth -= (line.match(/\}/g) || []).length

      // Check if declaration is complete
      if (parenDepth === 0 && bracketDepth === 0) {
        const isComplete = (
          trimmedLine.endsWith(';')
          || trimmedLine.endsWith('}')
          || (!trimmedLine.endsWith('{') && !trimmedLine.endsWith(','))
        )

        if (isComplete) {
          processBlock(currentBlock, currentComments, state)
          currentBlock = []
          currentComments = []
          inDeclaration = false
          bracketDepth = 0
          parenDepth = 0

          if (state.currentScope === 'function') {
            state.currentScope = 'top'
          }
        }
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
  const arrowWithType = trimmedValue.match(/^\(\s*.*?\)\s*:\s*([^=>\s{]+).*=>/)
  if (arrowWithType) {
    const returnType = arrowWithType[1]
    return `${isExported ? 'export ' : ''}declare ${declarationType} ${name}: ${returnType};`
  }

  let type: string
  if (trimmedValue.includes('as const')) {
    const constValue = trimmedValue.replace(/\s*as\s*const\s*$/, '')
    type = inferConstType(constValue, state)
  }
  else if (trimmedValue.startsWith('{')) {
    type = inferComplexObjectType(trimmedValue, state)
  }
  else if (trimmedValue.startsWith('[')) {
    type = inferArrayType(trimmedValue, state)
  }
  else if (trimmedValue.includes('=>') || trimmedValue.includes('function')) {
    const funcType = extractFunctionType(trimmedValue)
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
function processFunction(declaration: string, usedTypes?: Set<string>, isExported = true): string {
  debugLog(undefined, 'process-function-start', `Starting to process: ${declaration}`)

  // Normalize while preserving structure
  const normalizedDeclaration = declaration
    .split('\n')
    .map(line => line.trim())
    .join(' ')
    .replace(/\s+/g, ' ')

  debugLog(undefined, 'process-function-normalized', `Normalized declaration: ${normalizedDeclaration}`)

  const signature = extractFunctionSignature(normalizedDeclaration)
  debugLog(undefined, 'process-function-signature', `Extracted signature: ${JSON.stringify(signature, null, 2)}`)

  // Extra validation
  if (!signature.params && normalizedDeclaration.includes('(')) {
    debugLog(undefined, 'process-function-warning', 'Found parentheses but no params extracted')
  }

  if (signature.returnType === 'void' && normalizedDeclaration.includes('):')) {
    debugLog(undefined, 'process-function-warning', 'Found return type indicator but extracted void')
  }

  const parts = [
    isExported ? 'export ' : '',
    'declare function ',
    signature.name,
    signature.generics,
    `(${signature.params})`,
    signature.returnType ? `: ${signature.returnType}` : '',
    ';',
  ]

  const result = parts.filter(Boolean).join('')
  debugLog(undefined, 'process-function-final', `Final declaration: ${result}`)
  return result
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

function processGeneratorFunction(declaration: string, state?: ProcessingState): string {
  debugLog(state, 'generator-function', `Processing generator function: ${declaration}`)

  // Clean up the declaration but keep info for processing
  const cleanDeclaration = declaration
    .replace(/^export\s+/, '')
    .replace(/^async\s+/, '')
    .trim()

  // Extract function name
  const nameMatch = cleanDeclaration.match(/function\*\s+([^(<\s]+)/)
  if (!nameMatch) {
    debugLog(state, 'generator-function', 'Failed to match generator function name')
    return ''
  }

  const [, name] = nameMatch
  let rest = cleanDeclaration.slice(cleanDeclaration.indexOf(name) + name.length).trim()

  // Extract generics if present
  let generics = ''
  if (rest.startsWith('<')) {
    let depth = 1
    let pos = 1
    for (; pos < rest.length && depth > 0; pos++) {
      if (rest[pos] === '<')
        depth++
      if (rest[pos] === '>')
        depth--
    }
    generics = rest.slice(0, pos)
    rest = rest.slice(pos).trim()
  }

  // Extract parameters
  let params = ''
  if (rest.startsWith('(')) {
    let depth = 1
    let pos = 1
    for (; pos < rest.length && depth > 0; pos++) {
      if (rest[pos] === '(')
        depth++
      if (rest[pos] === ')')
        depth--
    }
    params = rest.slice(1, pos - 1).trim()
    rest = rest.slice(pos).trim()
  }

  // Extract return type - use exact return type if specified
  let returnType = 'any' // Default to 'any' if no return type specified
  if (rest.startsWith(':')) {
    rest = rest.slice(1).trim()
    const match = rest.match(/([^{;]+)/)
    if (match) {
      returnType = match[1].trim()
    }
  }

  // Construct the declaration with proper spacing
  return [
    'export declare function ', // Added space after function
    name,
    generics ? `${generics}` : '',
    `(${params})`,
    ': ', // Added space after colon
    returnType,
  ]
    .filter(Boolean)
    .join('')
    .concat(';')
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

function processObjectMethod(declaration: string): ProcessedMethod {
  // debugLog(state, 'process-method-start', `Processing method: ${declaration}`)

  // Regex to match the method declaration
  const methodPattern = /^(?:async\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^ {][^;{]*))?/
  const match = declaration.match(methodPattern)

  if (!match) {
    // debugLog(state, 'process-method-error', `Failed to parse method declaration: ${declaration}`)
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

  // debugLog(state, 'process-method-parsed', `Name: ${name}, Generics: ${generics}, Params: ${params}, ReturnType: ${returnType}`)

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

  // debugLog(state, 'process-method-result', `Generated signature for ${name}: ${signature}`)
  return { name, signature }
}

function processObjectProperties(content: string, state?: ProcessingState, indentLevel = 0): Array<{ key: string, value: string }> {
  // debugLog(state, 'process-props', `Processing object properties at indent level ${indentLevel}`)
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
          // debugLog(state, 'process-props-key', `Found key: ${currentKey}`)
          buffer = ''
          isParsingKey = false
          continue
        }
        else if ((char === ',' || char === ';') && !isParsingKey) {
          if (currentKey) {
            const trimmedBuffer = buffer.trim()
            // debugLog(state, 'process-props-value', `Processing value for key ${currentKey}: ${trimmedBuffer.substring(0, 50)}...`)

            const isMethodDecl = currentKey.includes('(') || currentKey.match(/^\s*(?:async\s+)?\w+\s*(?:<[^>]+>)?\s*\(/)
            // debugLog(state, 'method-check', `Checking if method declaration: ${currentKey}`)

            if (isMethodDecl) {
              // debugLog(state, 'process-props-method', `Detected method: ${currentKey} with body length: ${trimmedBuffer.length}`)
              const { name, signature } = processObjectMethod(currentKey)
              properties.push({ key: name, value: signature })
            }
            else {
              const processedValue = processPropertyValue(trimmedBuffer, indentLevel + 1, state)
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
      // debugLog(state, 'process-props-method', `Detected final method: ${currentKey}`)
      const { name, signature } = processObjectMethod(currentKey)
      properties.push({ key: name, value: signature })
    }
    else {
      const processedValue = processPropertyValue(trimmedBuffer, indentLevel + 1, state)
      properties.push({ key: normalizePropertyKey(currentKey), value: processedValue })
    }
  }

  // debugLog(state, 'process-props', `Processed ${properties.length} properties`)
  return properties
}

function processPropertyValue(value: string, indentLevel: number, state?: ProcessingState): string {
  const trimmed = value.trim()
  // debugLog(state, 'process-value', `Processing value: ${trimmed.substring(0, 100)}...`)

  // Check if this is an object with method declarations first
  if (trimmed.startsWith('{') && trimmed.includes('(') && trimmed.includes(')') && trimmed.includes(':')) {
    // debugLog(state, 'process-value', 'Detected potential object with methods')
    return inferComplexObjectType(trimmed, state, indentLevel)
  }

  // Handle arrays before methods since they might contain method-like structures
  if (trimmed.startsWith('[')) {
    // debugLog(state, 'process-value', 'Detected array')
    return inferArrayType(trimmed, state, true)
  }

  // Handle regular objects
  if (trimmed.startsWith('{')) {
    // debugLog(state, 'process-value', 'Detected object')
    return inferComplexObjectType(trimmed, state, indentLevel)
  }

  // Handle function expressions
  if (trimmed.includes('=>') || trimmed.includes('function')) {
    // debugLog(state, 'process-value', 'Detected function expression')
    const funcType = extractFunctionType(trimmed)
    return funcType || '(...args: any[]) => unknown'
  }

  // Handle primitive values and literals
  if (/^(['"`]).*\1$/.test(trimmed) || !Number.isNaN(Number(trimmed))
    || trimmed === 'true' || trimmed === 'false') {
    return trimmed
  }

  return 'unknown'
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
function splitArrayElements(content: string): string[] {
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
          // debugLog(state, 'array-split', `Found element: ${trimmed}`)
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
    // debugLog(state, 'array-split', `Found element: ${trimmed}`)
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
