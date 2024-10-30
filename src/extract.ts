import type { FunctionSignature, PropertyInfo } from './types'
import { cleanComments, removeLeadingComments } from './comments'
import { createProcessingState } from './create'
import { formatOutput } from './format'
import { processImports, processSourceFile, processValue } from './process'
import { trackTypeUsage, trackValueUsage } from './track'
import { debugLog, normalizeType, splitObjectProperties } from './utils'

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
export function extractFunctionSignature(declaration: string): FunctionSignature {
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
 * Extract object literal after cleaning comments
 */
export function extractCleanObjectLiteral(declaration: string): string | null {
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
export function extractObjectProperties(objectLiteral: string): PropertyInfo[] {
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
export function extractNestedContent(content: string, openChar: string, closeChar: string): string | null {
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
