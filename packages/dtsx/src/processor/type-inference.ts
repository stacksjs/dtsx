/**
 * Type inference utilities for DTS generation
 * Handles inferring narrow types from values
 */

/**
 * Maximum recursion depth for type inference to prevent stack overflow on deeply nested types
 */
const MAX_INFERENCE_DEPTH = 20

/** Check if a string matches /^-?\d+(\.\d+)?$/ without regex */
function isNumericLiteral(s: string): boolean {
  const len = s.length
  if (len === 0) return false
  let i = 0
  if (s.charCodeAt(i) === 45 /* - */) i++
  if (i >= len) return false
  const digitStart = i
  while (i < len && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++
  if (i === digitStart) return false // no digits
  if (i < len && s.charCodeAt(i) === 46 /* . */) {
    i++
    const fracStart = i
    while (i < len && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++
    if (i === fracStart) return false // no digits after dot
  }
  return i === len
}

/** Check if s (excluding last char 'n') is all digits — matches /^\d+n$/ */
function isBigIntDigits(s: string): boolean {
  for (let i = 0, end = s.length - 1; i < end; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/**
 * Count occurrences of a substring using indexOf (faster than regex match + array)
 */
function countOccurrences(str: string, sub: string): number {
  let count = 0
  let pos = 0
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++
    pos += sub.length
  }
  return count
}

/**
 * Infer and narrow types from values
 * @param inUnion - When true, widens number/boolean literals to their base types (used in array union contexts)
 * @param _depth - Internal recursion depth counter (do not set manually)
 */
export function inferNarrowType(value: unknown, isConst: boolean = false, inUnion: boolean = false, _depth: number = 0): string {
  if (!value || typeof value !== 'string')
    return 'unknown'

  if (_depth >= MAX_INFERENCE_DEPTH)
    return 'unknown'

  const trimmed = value.trim()

  // BigInt expressions (check early)
  if (trimmed.startsWith('BigInt(')) {
    return 'bigint'
  }

  // Symbol.for expressions (check early)
  if (trimmed.startsWith('Symbol.for(')) {
    return 'symbol'
  }

  // Tagged template literals (check early)
  if (trimmed.includes('.raw`') || trimmed.includes('String.raw`')) {
    return 'string'
  }

  // String literals - always use literal type for simple string literals
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
    || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    if (!trimmed.includes('${')) {
      return trimmed
    }
    if (isConst) {
      return trimmed
    }
    return 'string'
  }

  // Number literals
  if (isNumericLiteral(trimmed)) {
    if (inUnion && !isConst)
      return 'number'
    return trimmed
  }

  // Boolean literals
  if (trimmed === 'true' || trimmed === 'false') {
    if (inUnion && !isConst)
      return 'boolean'
    return trimmed
  }

  // Null and undefined
  if (trimmed === 'null')
    return 'null'
  if (trimmed === 'undefined')
    return 'undefined'

  // Array literals
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return inferArrayType(trimmed, isConst, _depth + 1)
  }

  // Object literals
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return inferObjectType(trimmed, isConst, _depth + 1)
  }

  // New expressions (check before function expressions since `new X(() => {})` contains `=>`)
  if (trimmed.startsWith('new ')) {
    return inferNewExpressionType(trimmed)
  }

  // Function expressions
  if (trimmed.includes('=>') || trimmed.startsWith('function') || trimmed.startsWith('async')) {
    return inferFunctionType(trimmed, inUnion, _depth)
  }

  // As const assertions
  if (trimmed.endsWith('as const')) {
    const withoutAsConst = trimmed.slice(0, -8).trim()
    if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
      const content = withoutAsConst.slice(1, -1).trim()
      if (!content)
        return 'readonly []'
      const elements = parseArrayElements(content)
      const elementTypes = elements.map(el => inferNarrowType(el.trim(), true, false, _depth + 1))
      return `readonly [${elementTypes.join(', ')}]`
    }
    return inferNarrowType(withoutAsConst, true, inUnion, _depth + 1)
  }

  // Template literal expressions
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return inferTemplateLiteralType(trimmed, isConst)
  }

  // Promise expressions
  if (trimmed.startsWith('Promise.')) {
    return inferPromiseType(trimmed, _depth)
  }

  // Await expressions
  if (trimmed.startsWith('await ')) {
    return 'unknown'
  }

  // BigInt literals (digits followed by 'n')
  if (trimmed.charCodeAt(trimmed.length - 1) === 110 /* n */ && trimmed.length > 1 && isBigIntDigits(trimmed)) {
    if (isConst) {
      return trimmed
    }
    return 'bigint'
  }

  // Symbol
  if (trimmed.startsWith('Symbol(') || trimmed === 'Symbol.for') {
    return 'symbol'
  }

  // Other expressions (method calls, property access, etc.)
  return 'unknown'
}

/**
 * Infer and narrow types from values in union context (for arrays)
 * Widens number/boolean literals to base types unless const
 */
export function inferNarrowTypeInUnion(value: unknown, isConst: boolean = false, _depth: number = 0): string {
  return inferNarrowType(value, isConst, true, _depth)
}

/**
 * Infer type from template literal
 */
function inferTemplateLiteralType(value: string, isConst: boolean): string {
  // Handle tagged template literals like String.raw`...`
  if (value.includes('.raw`') || value.includes('String.raw`')) {
    return 'string'
  }

  if (!isConst)
    return 'string'

  // Simple template literal without expressions
  if (!value.includes('${')) {
    return value
  }

  // Complex template literal - would need more sophisticated parsing
  return 'string'
}

/**
 * Infer type from new expression
 */
function inferNewExpressionType(value: string): string {
  // Try to capture class name and optional generic params: new Map<string, number>()
  const match = value.match(/^new\s+([A-Z][a-zA-Z0-9]*)/)
  if (match) {
    const className = match[1]

    // Check if the expression includes explicit generic type parameters
    const afterClass = value.slice(match[0].length)
    if (afterClass.startsWith('<')) {
      // Extract the generic params by finding the matching '>'
      let depth = 0
      let end = -1
      for (let i = 0; i < afterClass.length; i++) {
        if (afterClass[i] === '<') {
          depth++
        }
        else if (afterClass[i] === '>') {
          depth--
          if (depth === 0) { end = i; break }
        }
      }
      if (end !== -1) {
        const generics = afterClass.slice(0, end + 1)
        return `${className}${generics}`
      }
    }

    // Fallback: use default generic params for known built-in types
    switch (className) {
      case 'Date': return 'Date'
      case 'Map': return 'Map<any, any>'
      case 'Set': return 'Set<any>'
      case 'WeakMap': return 'WeakMap<any, any>'
      case 'WeakSet': return 'WeakSet<any>'
      case 'RegExp': return 'RegExp'
      case 'Error': return 'Error'
      case 'Array': return 'any[]'
      case 'Object': return 'object'
      case 'Function': return 'Function'
      case 'Promise': return 'Promise<any>'
      default: return className
    }
  }
  return 'unknown'
}

/**
 * Infer type from Promise expression
 */
function inferPromiseType(value: string, _depth: number = 0): string {
  if (value.startsWith('Promise.resolve(')) {
    // Try to extract the argument type
    const match = value.match(/Promise\.resolve\(([^)]+)\)/)
    if (match) {
      const arg = match[1].trim()
      const argType = inferNarrowType(arg, false, false, _depth + 1)
      return `Promise<${argType}>`
    }
    return 'Promise<unknown>'
  }
  if (value.startsWith('Promise.reject(')) {
    return 'Promise<never>'
  }
  if (value.startsWith('Promise.all(')) {
    // Try to extract array argument types
    const match = value.match(/Promise\.all\(\[([^\]]+)\]\)/)
    if (match) {
      const arrayContent = match[1].trim()
      const elements = parseArrayElements(arrayContent)
      const elementTypes = elements.map((el) => {
        const trimmed = el.trim()
        if (trimmed.startsWith('Promise.resolve(')) {
          const promiseType = inferPromiseType(trimmed, _depth + 1)
          // Extract the inner type from Promise<T>
          const innerMatch = promiseType.match(/Promise<(.+)>/)
          return innerMatch ? innerMatch[1] : 'unknown'
        }
        return inferNarrowType(trimmed, false, false, _depth + 1)
      })
      return `Promise<[${elementTypes.join(', ')}]>`
    }
    return 'Promise<unknown[]>'
  }
  return 'Promise<unknown>'
}

/**
 * Infer array type from array literal
 */
export function inferArrayType(value: string, isConst: boolean, _depth: number = 0): string {
  // Remove brackets and parse elements
  const content = value.slice(1, -1).trim()

  if (!content)
    return 'Array<never>'

  if (_depth >= MAX_INFERENCE_DEPTH)
    return 'Array<unknown>'

  // Simple parsing - this would need to be more sophisticated for complex cases
  const elements = parseArrayElements(content)

  // Check if any element has 'as const' - if so, this should be a readonly tuple
  const hasAsConst = elements.some(el => el.trim().endsWith('as const'))

  if (hasAsConst) {
    // Create readonly tuple with union types for each element
    const elementTypes = elements.map((el) => {
      const trimmedEl = el.trim()
      if (trimmedEl.endsWith('as const')) {
        const withoutAsConst = trimmedEl.slice(0, -8).trim()
        // For arrays with 'as const', create readonly tuple
        if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
          const innerContent = withoutAsConst.slice(1, -1).trim()
          const innerElements = parseArrayElements(innerContent)
          const innerTypes = innerElements.map(innerEl => inferNarrowType(innerEl.trim(), true, false, _depth + 1))
          return `readonly [${innerTypes.join(', ')}]`
        }
        return inferNarrowType(withoutAsConst, true, false, _depth + 1)
      }
      if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
        return inferArrayType(trimmedEl, true, _depth + 1)
      }
      return inferNarrowType(trimmedEl, true, false, _depth + 1)
    })
    return `readonly [\n    ${elementTypes.join(' |\n    ')}\n  ]`
  }

  // Regular array processing
  const elementTypes = elements.map((el) => {
    const trimmedEl = el.trim()
    // Check if element is an array itself
    if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
      return inferArrayType(trimmedEl, isConst, _depth + 1)
    }
    return inferNarrowTypeInUnion(trimmedEl, isConst, _depth + 1)
  })

  // For const arrays, ALWAYS create readonly tuples for better type safety
  if (isConst) {
    return `readonly [${elementTypes.join(', ')}]`
  }

  // For simple arrays with all same literal types, also create tuples
  const uniqueTypes = [...new Set(elementTypes)]
  const allLiterals = elementTypes.every(type =>
    isNumericLiteral(type) // numbers
    || type === 'true' || type === 'false' // booleans
    || (type.startsWith('"') && type.endsWith('"')) // strings
    || (type.startsWith('\'') && type.endsWith('\'')),
  )

  if (allLiterals && elementTypes.length <= 10) {
    // Create tuple for small arrays with literal types
    return `readonly [${elementTypes.join(', ')}]`
  }

  if (uniqueTypes.length === 1) {
    return `Array<${uniqueTypes[0]}>`
  }

  return `Array<${uniqueTypes.join(' | ')}>`
}

/**
 * Parse array elements handling nested structures
 */
export function parseArrayElements(content: string): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      if (char === '[' || char === '{' || char === '(')
        depth++
      if (char === ']' || char === '}' || char === ')')
        depth--

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

/**
 * Infer object type from object literal
 */
export function inferObjectType(value: string, isConst: boolean, _depth: number = 0): string {
  // Remove braces
  const content = value.slice(1, -1).trim()

  if (!content)
    return '{}'

  if (_depth >= MAX_INFERENCE_DEPTH)
    return 'Record<string, unknown>'

  // Parse object properties
  const properties = parseObjectProperties(content)
  const propTypes: string[] = []

  for (const [key, val] of properties) {
    let valueType = inferNarrowType(val, isConst, false, _depth + 1)

    // Handle method signatures - clean up async and parameter defaults
    if (valueType.includes('=>') || valueType.includes('function') || valueType.includes('async')) {
      valueType = cleanMethodSignature(valueType)
    }

    propTypes.push(`${key}: ${valueType}`)
  }

  return `{\n  ${propTypes.join(';\n  ')}\n}`
}

/**
 * Clean method signatures for declaration files
 */
function cleanMethodSignature(signature: string): string {
  // Remove async modifier from method signatures (including in object methods)
  let cleaned = signature.replace(/^async\s+/, '').replace(/\basync\s+/g, '')

  // Remove parameter default values (e.g., currency = 'USD' becomes currency?)
  cleaned = cleaned.replace(/(\w+)\s*=[^,)]+/g, (match, paramName) => {
    return `${paramName}?`
  })

  // Clean up extra spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  return cleaned
}

/**
 * Clean parameter defaults from function parameters
 */
export function cleanParameterDefaults(params: string): string {
  // Remove parameter default values and make them optional
  return params.replace(/(\w+)\s*=[^,)]+/g, (match, paramName) => {
    return `${paramName}?`
  })
}

/**
 * Parse object properties
 */
function parseObjectProperties(content: string): Array<[string, string]> {
  const properties: Array<[string, string]> = []
  let current = ''
  let currentKey = ''
  let depth = 0
  let inString = false
  let stringChar = ''
  let inKey = true
  let inComment = false
  let commentDepth = 0

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const prevChar = i > 0 ? content[i - 1] : ''
    const nextChar = i < content.length - 1 ? content[i + 1] : ''

    // Track JSDoc/block comments to avoid parsing colons inside them
    if (!inString && !inComment && char === '/' && nextChar === '*') {
      // Enter block/JSDoc comment, preserve opening delimiter
      inComment = true
      commentDepth = 1
      current += '/*'
      i++ // Skip '*'
      continue
    }
    else if (inComment && char === '*' && nextChar === '/') {
      // Closing a block/JSDoc comment, preserve closing delimiter
      commentDepth--
      current += '*/'
      i++ // Skip '/'
      if (commentDepth === 0) {
        inComment = false
      }
      continue
    }
    else if (inComment && char === '/' && nextChar === '*') {
      // Nested comment start, preserve and increase depth
      commentDepth++
      current += '/*'
      i++
      continue
    }

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
      current += char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
      current += char
    }
    else if (!inString && !inComment) {
      if (char === '{' || char === '[' || char === '(') {
        depth++
        current += char
      }
      else if (char === '}' || char === ']' || char === ')') {
        depth--
        current += char
      }
      else if (char === ':' && depth === 0 && inKey) {
        currentKey = current.trim()
        current = ''
        inKey = false
      }
      else if (char === '(' && depth === 0 && inKey) {
        // This might be a method definition like: methodName(params) or async methodName<T>(params)
        currentKey = current.trim()
        // Remove 'async' from the key if present
        if (currentKey.startsWith('async ')) {
          currentKey = currentKey.slice(6).trim()
        }
        current = char // Start with the opening parenthesis
        inKey = false
        depth = 1 // We're now inside the method definition
      }
      else if (char === ',' && depth === 0) {
        if (currentKey && current.trim()) {
          // Clean method signatures before storing
          let value = current.trim()

          // Check if this is a method definition (starts with parentheses)
          if (value.startsWith('(')) {
            // This is a method definition like: (params): ReturnType { ... }
            value = convertMethodToFunctionType(currentKey, value)
          }
          else if (value.includes('=>') || value.includes('function') || value.includes('async')) {
            value = cleanMethodSignature(value)
          }

          properties.push([currentKey, value])
        }
        current = ''
        currentKey = ''
        inKey = true
      }
      else {
        current += char
      }
    }
    else {
      // Preserve all characters while inside comments
      current += char
    }
  }

  // Don't forget the last property
  if (currentKey && current.trim()) {
    let value = current.trim()

    // Check if this is a method definition (starts with parentheses)
    if (value.startsWith('(')) {
      // This is a method definition like: (params): ReturnType { ... }
      value = convertMethodToFunctionType(currentKey, value)
    }
    else if (value.includes('=>') || value.includes('function') || value.includes('async')) {
      value = cleanMethodSignature(value)
    }

    properties.push([currentKey, value])
  }

  return properties
}

/**
 * Convert method definition to function type signature
 */
function convertMethodToFunctionType(methodName: string, methodDef: string): string {
  // Remove async modifier if present
  let cleaned = methodDef.replace(/^async\s+/, '')

  // Extract generics, parameters, and return type
  const genericMatch = cleaned.match(/^<([^>]+)>/)
  const generics = genericMatch ? genericMatch[0] : ''
  if (generics) {
    cleaned = cleaned.slice(generics.length).trim()
  }

  // Find parameter list
  const paramStart = cleaned.indexOf('(')
  const paramEnd = findMatchingBracket(cleaned, paramStart, '(', ')')

  if (paramStart === -1 || paramEnd === -1) {
    return '() => unknown'
  }

  const params = cleaned.slice(paramStart, paramEnd + 1)
  let returnType = 'unknown'

  // Check for explicit return type annotation
  const afterParams = cleaned.slice(paramEnd + 1).trim()
  if (afterParams.startsWith(':')) {
    const returnTypeMatch = afterParams.match(/^:\s*([^{]+)/)
    if (returnTypeMatch) {
      returnType = returnTypeMatch[1].trim()
    }
  }

  // Clean parameter defaults
  const cleanedParams = cleanParameterDefaults(params)

  return `${generics}${cleanedParams} => ${returnType}`
}

/**
 * Find matching bracket for nested structures
 */
export function findMatchingBracket(str: string, start: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let i = start; i < str.length; i++) {
    if (str[i] === openChar) {
      depth++
    }
    else if (str[i] === closeChar) {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Find the main arrow (=>) in a function, ignoring nested arrows in parameter types
 */
function findMainArrowIndex(str: string): number {
  let parenDepth = 0
  let bracketDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < str.length - 1; i++) {
    const char = str[i]
    const nextChar = str[i + 1]
    const prevChar = i > 0 ? str[i - 1] : ''

    // Handle string literals
    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      // Track nesting depth - only parentheses and square brackets
      // Don't track < > as they can be comparison operators or part of generics
      if (char === '(') {
        parenDepth++
      }
      else if (char === ')') {
        parenDepth--
      }
      else if (char === '[') {
        bracketDepth++
      }
      else if (char === ']') {
        bracketDepth--
      }

      // Look for arrow at depth 0 (not nested inside parentheses or brackets)
      if (char === '=' && nextChar === '>' && parenDepth === 0 && bracketDepth === 0) {
        return i
      }
    }
  }

  return -1
}

/**
 * Infer function type from function expression
 */
export function inferFunctionType(value: string, inUnion: boolean = false, _depth: number = 0): string {
  const trimmed = value.trim()

  // Handle very complex function types early (but not function expressions)
  // Only simplify if it's truly complex AND looks like a problematic signature
  if (trimmed.length > 200 && countOccurrences(trimmed, '=>') > 2 && countOccurrences(trimmed, '<') > 5 && !trimmed.startsWith('function')) {
    // For extremely complex types, use a simple signature
    const funcType = '(...args: any[]) => any'
    return inUnion ? `(${funcType})` : funcType
  }

  // Handle async arrow functions
  if (trimmed.startsWith('async ') && trimmed.includes('=>')) {
    const asyncRemoved = trimmed.slice(5).trim() // Remove 'async '
    const arrowIndex = asyncRemoved.indexOf('=>')
    let params = asyncRemoved.substring(0, arrowIndex).trim()
    const body = asyncRemoved.substring(arrowIndex + 2).trim()

    // Clean up params - remove default values
    params = cleanParameterDefaults(params)

    // Clean up params
    if (params === '()' || params === '') {
      params = '()'
    }
    else if (!params.startsWith('(')) {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to infer return type from body
    let returnType = 'unknown'
    if (body.startsWith('{')) {
      // Block body - can't easily infer return type
      returnType = 'unknown'
    }
    else {
      // Expression body - try to infer
      returnType = inferNarrowType(body, false, false, _depth + 1)
    }

    const funcType = `${params} => Promise<${returnType}>`
    return inUnion ? `(${funcType})` : funcType
  }

  // Regular arrow functions
  if (trimmed.includes('=>')) {
    // Handle generics at the beginning
    let generics = ''
    let remaining = trimmed

    // Check for generics at the start
    if (trimmed.startsWith('<')) {
      const genericEnd = findMatchingBracket(trimmed, 0, '<', '>')
      if (genericEnd !== -1) {
        generics = trimmed.substring(0, genericEnd + 1)
        remaining = trimmed.substring(genericEnd + 1).trim()
      }
    }

    // Find the main arrow (not nested ones inside parameter types)
    const arrowIndex = findMainArrowIndex(remaining)
    if (arrowIndex === -1) {
      // Fallback if no arrow found
      const funcType = '() => unknown'
      return inUnion ? `(${funcType})` : funcType
    }

    let params = remaining.substring(0, arrowIndex).trim()
    const body = remaining.substring(arrowIndex + 2).trim()

    // Handle explicit return type annotations in parameters
    // Look for pattern like (param: Type): ReturnType
    let explicitReturnType = ''
    const returnTypeMatch = params.match(/\):\s*([^=]+)$/)
    if (returnTypeMatch) {
      explicitReturnType = returnTypeMatch[1].trim()
      params = `${params.substring(0, params.lastIndexOf('):'))})`
    }

    // Clean up params - remove default values
    params = cleanParameterDefaults(params)

    // Clean up params
    if (params === '()' || params === '') {
      params = '()'
    }
    else if (!params.startsWith('(')) {
      // Single parameter without parentheses
      params = `(${params})`
    }

    // Try to infer return type from body
    let returnType = 'unknown'
    if (explicitReturnType) {
      // Use explicit return type annotation
      returnType = explicitReturnType
    }
    else if (body.startsWith('{')) {
      // Block body - can't easily infer return type
      returnType = 'unknown'
    }
    else if (body.includes('=>')) {
      // This is a higher-order function returning another function
      // For complex nested functions, try to extract just the outer function signature
      const outerFuncMatch = body.match(/^\s*\(([^)]*)\)\s*=>/)
      if (outerFuncMatch) {
        const outerParams = outerFuncMatch[1].trim()
        // For functions like pipe that transform T => T, infer the return type from generics
        if (generics.includes('T') && outerParams.includes('T')) {
          returnType = `(${outerParams}) => T`
        }
        else {
          returnType = `(${outerParams}) => any`
        }
      }
      else {
        // Fallback for complex cases
        returnType = 'any'
      }
    }
    else {
      // Expression body - try to infer, but be conservative in union contexts
      if (inUnion) {
        returnType = 'unknown'
      }
      else {
        returnType = inferNarrowType(body, false, false, _depth + 1)
      }
    }

    const funcType = `${generics}${params} => ${returnType}`
    return inUnion ? `(${funcType})` : funcType
  }

  // Function expressions
  if (trimmed.startsWith('function')) {
    // Handle generics in function expressions like function* <T>(items: T[])
    let generics = ''

    // Look for generics after function keyword
    const genericMatch = trimmed.match(/function\s*(?:\*\s*)?(<[^>]+>)/)
    if (genericMatch) {
      generics = genericMatch[1]
    }

    // Try to extract function signature
    const funcMatch = trimmed.match(/function\s*(\*?)\s*(?:<[^>]+>\s*)?([^(]*)\(([^)]*)\)/)
    if (funcMatch) {
      const isGenerator = !!funcMatch[1]
      const params = funcMatch[3].trim()

      let paramTypes = '(...args: any[])'
      if (params) {
        // Try to parse parameters
        paramTypes = `(${params})`
      }
      else {
        paramTypes = '()'
      }

      if (isGenerator) {
        // Try to extract return type from the function signature
        const returnTypeMatch = trimmed.match(/:\s*Generator<([^>]+)>/)
        if (returnTypeMatch) {
          const generatorTypes = returnTypeMatch[1]
          return inUnion ? `(${generics}${paramTypes} => Generator<${generatorTypes}>)` : `${generics}${paramTypes} => Generator<${generatorTypes}>`
        }
        return inUnion ? `(${generics}${paramTypes} => Generator<any, any, any>)` : `${generics}${paramTypes} => Generator<any, any, any>`
      }

      return inUnion ? `(${generics}${paramTypes} => unknown)` : `${generics}${paramTypes} => unknown`
    }

    const funcType = '(...args: any[]) => unknown'
    return inUnion ? `(${funcType})` : funcType
  }

  // Higher-order functions (functions that return functions)
  if (trimmed.includes('=>') && trimmed.includes('(') && trimmed.includes(')')) {
    // For very complex function types, fall back to a simpler signature
    if (trimmed.length > 100 || countOccurrences(trimmed, '=>') > 2) {
      // Extract just the basic signature pattern
      const genericMatch = trimmed.match(/^<[^>]+>/)
      const generics = genericMatch ? genericMatch[0] : ''

      // Look for parameter pattern
      const paramMatch = trimmed.match(/\([^)]*\)/)
      const params = paramMatch ? paramMatch[0] : '(...args: any[])'

      const funcType = `${generics}${params} => any`
      return inUnion ? `(${funcType})` : funcType
    }

    // This might be a higher-order function, try to preserve the structure
    return inUnion ? `(${trimmed})` : trimmed
  }

  const funcType = '() => unknown'
  return inUnion ? `(${funcType})` : funcType
}

/**
 * Check if a type annotation is a generic/broad type that should be replaced with narrow inference
 */
export function isGenericType(typeAnnotation: string): boolean {
  const trimmed = typeAnnotation.trim()

  // Generic types that are less specific than narrow inference
  if (trimmed === 'any' || trimmed === 'object' || trimmed === 'unknown') {
    return true
  }

  // Record types like Record<string, string>, Record<string, any>, etc.
  if (trimmed.startsWith('Record<') && trimmed.endsWith('>')) {
    return true
  }

  // Array types like Array<any>, Array<string>, etc. (but not specific tuples)
  if (trimmed.startsWith('Array<') && trimmed.endsWith('>')) {
    return true
  }

  // Object types like { [key: string]: any }
  // Use [^\]]* instead of .* to avoid backtracking past the closing bracket
  if (trimmed.match(/^\{\s*\[[^\]]*\]:\s*(any|string|number|unknown)\s*\}$/)) {
    return true
  }

  return false
}

/**
 * Extract type from 'satisfies' operator
 * e.g., "{ port: 3000 } satisfies { port: number }" returns "{ port: number }"
 */
export function extractSatisfiesType(value: string): string | null {
  const satisfiesIndex = value.lastIndexOf(' satisfies ')
  if (satisfiesIndex === -1) {
    return null
  }

  // Extract everything after 'satisfies '
  let typeStr = value.slice(satisfiesIndex + 11).trim()

  // Remove trailing semicolon if present
  if (typeStr.endsWith(';')) {
    typeStr = typeStr.slice(0, -1).trim()
  }

  return typeStr || null
}

/**
 * Infer mapped type from type expression
 * Handles patterns like { [K in keyof T]: V }
 */
export function inferMappedType(typeStr: string): string | null {
  const trimmed = typeStr.trim()

  // Check for mapped type pattern: { [K in keyof T]: V } or { [P in T]: V }
  const mappedMatch = trimmed.match(/^\{\s*\[(\w+)\s+in\s+(.+?)\](\?)?\s*:\s*(.+)\s*\}$/)
  if (mappedMatch) {
    const [, keyVar, constraint, optional, valueType] = mappedMatch
    const optionalMod = optional ? '?' : ''
    return `{ [${keyVar} in ${constraint}]${optionalMod}: ${valueType} }`
  }

  // Check for readonly mapped type: { readonly [K in keyof T]: V }
  const readonlyMappedMatch = trimmed.match(/^\{\s*readonly\s+\[(\w+)\s+in\s+(.+?)\](\?)?\s*:\s*(.+)\s*\}$/)
  if (readonlyMappedMatch) {
    const [, keyVar, constraint, optional, valueType] = readonlyMappedMatch
    const optionalMod = optional ? '?' : ''
    return `{ readonly [${keyVar} in ${constraint}]${optionalMod}: ${valueType} }`
  }

  // Check for mapped type with -readonly or -?: { -readonly [K in keyof T]-?: V }
  const modifierMappedMatch = trimmed.match(/^\{\s*(-?readonly\s+)?\[(\w+)\s+in\s+(.+?)\](-?\?)?\s*:\s*(.+)\s*\}$/)
  if (modifierMappedMatch) {
    const [, readonlyMod, keyVar, constraint, optional, valueType] = modifierMappedMatch
    const readonlyStr = readonlyMod ? `${readonlyMod.trim()} ` : ''
    const optionalMod = optional || ''
    return `{ ${readonlyStr}[${keyVar} in ${constraint}]${optionalMod}: ${valueType} }`
  }

  return null
}

/**
 * Infer conditional type from type expression
 * Handles patterns like T extends U ? X : Y
 */
export function inferConditionalType(typeStr: string): string | null {
  const trimmed = typeStr.trim()

  // Check for conditional type pattern: T extends U ? X : Y
  // Handle nested conditionals by finding the first ? and matching :
  const extendsIndex = trimmed.indexOf(' extends ')
  if (extendsIndex === -1)
    return null

  const afterExtends = trimmed.slice(extendsIndex + 9)
  const questionIndex = findConditionalQuestionMark(afterExtends)
  if (questionIndex === -1)
    return null

  const colonIndex = findConditionalColon(afterExtends, questionIndex)
  if (colonIndex === -1)
    return null

  const checkType = trimmed.slice(0, extendsIndex).trim()
  const extendsType = afterExtends.slice(0, questionIndex).trim()
  const trueType = afterExtends.slice(questionIndex + 1, colonIndex).trim()
  const falseType = afterExtends.slice(colonIndex + 1).trim()

  return `${checkType} extends ${extendsType} ? ${trueType} : ${falseType}`
}

/**
 * Find the question mark in a conditional type (handling nested conditionals)
 */
function findConditionalQuestionMark(str: string): number {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < str.length; i++) {
    const char = str[i]
    const prevChar = i > 0 ? str[i - 1] : ''

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      if (char === '<' || char === '(' || char === '[' || char === '{')
        depth++
      if (char === '>' || char === ')' || char === ']' || char === '}')
        depth--

      if (char === '?' && depth === 0) {
        return i
      }
    }
  }

  return -1
}

/**
 * Find the colon in a conditional type (handling nested conditionals)
 */
function findConditionalColon(str: string, startAfter: number): number {
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = startAfter + 1; i < str.length; i++) {
    const char = str[i]
    const prevChar = i > 0 ? str[i - 1] : ''

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      if (char === '<' || char === '(' || char === '[' || char === '{')
        depth++
      if (char === '>' || char === ')' || char === ']' || char === '}')
        depth--

      // Handle nested ternary - if we see ? at depth 0, increase depth
      if (char === '?' && depth === 0) {
        depth++
      }

      if (char === ':' && depth === 0) {
        return i
      }

      // Handle nested ternary colon
      if (char === ':' && depth > 0) {
        depth--
      }
    }
  }

  return -1
}

/**
 * Infer template literal type from type expression
 * Handles patterns like `${string}-${number}`
 */
export function inferTemplateLiteralTypeAdvanced(typeStr: string): string | null {
  const trimmed = typeStr.trim()

  // Check if it's a template literal type (backticks with ${...})
  if (!trimmed.startsWith('`') || !trimmed.endsWith('`')) {
    return null
  }

  // Extract the template content
  const content = trimmed.slice(1, -1)

  // Check for template expressions
  if (!content.includes('${')) {
    // Simple string literal
    return trimmed
  }

  // Parse template literal type
  const parts: string[] = []
  let current = ''
  let i = 0

  while (i < content.length) {
    if (content[i] === '$' && content[i + 1] === '{') {
      // Found expression start
      if (current) {
        parts.push(`"${current}"`)
        current = ''
      }

      // Find matching }
      let depth = 1
      let expr = ''
      i += 2 // Skip ${

      while (i < content.length && depth > 0) {
        if (content[i] === '{')
          depth++
        if (content[i] === '}')
          depth--
        if (depth > 0)
          expr += content[i]
        i++
      }

      parts.push(expr.trim())
    }
    else {
      current += content[i]
      i++
    }
  }

  if (current) {
    parts.push(`"${current}"`)
  }

  // Return the template literal type
  return trimmed
}

/**
 * Infer infer keyword usage in conditional types
 * Handles patterns like T extends (infer U)[] ? U : never
 */
export function extractInferTypes(typeStr: string): string[] {
  const inferTypes: string[] = []
  const inferRegex = /infer\s+(\w+)/g
  let match

  while ((match = inferRegex.exec(typeStr)) !== null) {
    inferTypes.push(match[1])
  }

  return inferTypes
}

/**
 * Check if a type uses advanced TypeScript features
 */
export function isComplexType(typeStr: string): boolean {
  const trimmed = typeStr.trim()

  // Mapped types
  if (/\[\s*\w+\s+in\s+/.test(trimmed))
    return true

  // Conditional types
  if (/\s+extends\s+(?:\S.*|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])\s+\?\s+(?:\S.*|[\t\v\f \xA0\u1680\u2000-\u200A\u202F\u205F\u3000\uFEFF])\s+:\s+/.test(trimmed))
    return true

  // Template literal types
  if (/^`.*\$\{[^\n\r}\u2028\u2029]*\}.*`$/.test(trimmed))
    return true

  // Infer keyword
  if (/\binfer\s+\w+/.test(trimmed))
    return true

  // Key remapping in mapped types
  if (/\bas\s+/.test(trimmed) && /\[\s*\w+\s+in\s+/.test(trimmed))
    return true

  return false
}

/**
 * Simplify complex type for declaration output
 * Returns simplified version if too complex
 */
export function simplifyComplexType(typeStr: string, maxDepth: number = 3): string {
  const trimmed = typeStr.trim()

  // Count nesting depth
  let depth = 0
  let maxFound = 0

  for (const char of trimmed) {
    if (char === '<' || char === '(' || char === '[' || char === '{') {
      depth++
      maxFound = Math.max(maxFound, depth)
    }
    if (char === '>' || char === ')' || char === ']' || char === '}') {
      depth--
    }
  }

  // If too deeply nested, simplify
  if (maxFound > maxDepth) {
    // Try to extract the outermost type
    const outerMatch = trimmed.match(/^(\w+)</)
    if (outerMatch) {
      return `${outerMatch[1]}<any>`
    }
    return 'unknown'
  }

  return trimmed
}

/**
 * Parse utility type and extract its parameters
 * Handles Partial<T>, Required<T>, Pick<T, K>, Omit<T, K>, etc.
 */
export function parseUtilityType(typeStr: string): { name: string, params: string[] } | null {
  const trimmed = typeStr.trim()

  // Match utility type pattern: Name<Params>
  const match = trimmed.match(/^(\w+)<(.+)>$/)
  if (!match)
    return null

  const name = match[1]
  const paramsStr = match[2]

  // Parse parameters handling nested types
  const params = parseTypeParameters(paramsStr)

  // Known utility types
  const utilityTypes = [
    'Partial',
    'Required',
    'Readonly',
    'Pick',
    'Omit',
    'Record',
    'Exclude',
    'Extract',
    'NonNullable',
    'ReturnType',
    'Parameters',
    'ConstructorParameters',
    'InstanceType',
    'ThisParameterType',
    'OmitThisParameter',
    'ThisType',
    'Uppercase',
    'Lowercase',
    'Capitalize',
    'Uncapitalize',
    'Awaited',
    'NoInfer',
  ]

  if (utilityTypes.includes(name)) {
    return { name, params }
  }

  return null
}

/**
 * Parse type parameters from a comma-separated string
 * Handles nested types properly
 */
export function parseTypeParameters(paramsStr: string): string[] {
  const params: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < paramsStr.length; i++) {
    const char = paramsStr[i]
    const prevChar = i > 0 ? paramsStr[i - 1] : ''

    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      if (char === '<' || char === '(' || char === '[' || char === '{')
        depth++
      if (char === '>' || char === ')' || char === ']' || char === '}')
        depth--

      if (char === ',' && depth === 0) {
        params.push(current.trim())
        current = ''
        continue
      }
    }

    current += char
  }

  if (current.trim()) {
    params.push(current.trim())
  }

  return params
}

/**
 * Infer keyof type
 */
export function inferKeyofType(typeStr: string): string | null {
  const trimmed = typeStr.trim()

  if (trimmed.startsWith('keyof ')) {
    return trimmed
  }

  return null
}

/**
 * Infer typeof type
 */
export function inferTypeofType(typeStr: string): string | null {
  const trimmed = typeStr.trim()

  if (trimmed.startsWith('typeof ')) {
    return trimmed
  }

  return null
}

/**
 * Check if type is an indexed access type
 * e.g., T[K], Person['name']
 */
export function isIndexedAccessType(typeStr: string): boolean {
  const trimmed = typeStr.trim()

  // Check for pattern like T[K] or T['key']
  return /^[\w.]+\[.+\]$/.test(trimmed) && !trimmed.startsWith('[')
}
