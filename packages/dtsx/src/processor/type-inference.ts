/**
 * Type inference utilities for DTS generation
 * Handles inferring narrow types from values
 */

/**
 * Maximum recursion depth for type inference to prevent stack overflow on deeply nested types
 */
const MAX_INFERENCE_DEPTH = 20

// ---------------------------------------------------------------------------
// Module-level storage for computing clean default alongside type inference.
// This avoids double-parsing: inferObjectType/inferArrayType build the
// @defaultValue content during the same pass that infers types.
// ---------------------------------------------------------------------------
let _collectCleanDefault = false
let _cleanDefaultResult: string | null = null

/** Strip block/JSDoc comments from a property key to keep @defaultValue clean */
function stripBlockComments(s: string): string {
  let result = ''
  let i = 0
  while (i < s.length) {
    if (s.charCodeAt(i) === 47 /* / */ && i + 1 < s.length && s.charCodeAt(i + 1) === 42 /* * */) {
      // Skip until closing */
      i += 2
      while (i < s.length - 1) {
        if (s.charCodeAt(i) === 42 /* * */ && s.charCodeAt(i + 1) === 47 /* / */) {
          i += 2
          break
        }
        i++
      }
    }
    else {
      result += s.charAt(i)
      i++
    }
  }
  return result.trim()
}

/**
 * Enable clean default collection for the next type inference pass.
 * Must be called before inferNarrowType when you need a @defaultValue.
 */
export function enableCleanDefaultCollection(): void {
  _collectCleanDefault = true
  _cleanDefaultResult = null
}

/**
 * Consume the computed clean default (also disables collection).
 * Returns null if no clean default was computed.
 */
export function consumeCleanDefault(): string | null {
  _collectCleanDefault = false
  const val = _cleanDefaultResult
  _cleanDefaultResult = null
  return val
}

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

/** Collapse runs of whitespace to single spaces (no regex) */
function collapseWhitespace(s: string): string {
  const len = s.length
  let hasRun = false
  // Fast check: does the string even have consecutive whitespace?
  for (let i = 1; i < len; i++) {
    if (s.charCodeAt(i) <= 32 && s.charCodeAt(i - 1) <= 32) {
      hasRun = true
      break
    }
  }
  // Also check for non-space whitespace chars (newlines, tabs)
  if (!hasRun) {
    for (let i = 0; i < len; i++) {
      const c = s.charCodeAt(i)
      if (c === 10 || c === 13 || c === 9) {
        hasRun = true
        break
      }
    }
  }
  if (!hasRun) return s
  // Build result using substring slices instead of char-by-char +=
  const parts: string[] = []
  let segStart = -1
  let inWs = false
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i)
    if (c <= 32) {
      if (!inWs) {
        if (segStart >= 0) parts.push(s.substring(segStart, i))
        parts.push(' ')
        inWs = true
        segStart = -1
      }
    }
    else {
      if (inWs || segStart < 0) segStart = i
      inWs = false
    }
  }
  if (segStart >= 0) parts.push(s.substring(segStart))
  return parts.join('')
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

  // String literals
  if ((trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
    || (trimmed.startsWith('`') && trimmed.endsWith('`'))) {
    if (!trimmed.includes('${')) {
      if (!isConst) return 'string'
      return trimmed
    }
    if (isConst) {
      return trimmed
    }
    return 'string'
  }

  // Number literals
  if (isNumericLiteral(trimmed)) {
    if (!isConst)
      return 'number'
    return trimmed
  }

  // Boolean literals
  if (trimmed === 'true' || trimmed === 'false') {
    if (!isConst)
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
    return inferFunctionType(trimmed, inUnion, _depth, isConst)
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
    return inferPromiseType(trimmed, isConst, _depth)
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
  // Extract class name after 'new ' — must start with uppercase A-Z
  let i = 4 // skip 'new '
  while (i < value.length && value.charCodeAt(i) <= 32) i++ // skip whitespace
  const nameStart = i
  const firstChar = value.charCodeAt(i)
  if (firstChar < 65 || firstChar > 90) return 'unknown' // must start with A-Z
  while (i < value.length && isWordChar(value.charCodeAt(i))) i++
  if (i === nameStart) return 'unknown'
  const className = value.slice(nameStart, i)

  {
    const afterClass = value.slice(i)
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
function inferPromiseType(value: string, isConst: boolean, _depth: number = 0): string {
  if (value.startsWith('Promise.resolve(')) {
    // Extract argument between parens using indexOf
    const openIdx = 16 // length of 'Promise.resolve('
    const closeIdx = value.indexOf(')', openIdx)
    if (closeIdx !== -1) {
      const arg = value.slice(openIdx, closeIdx).trim()
      if (arg) {
        const argType = inferNarrowType(arg, isConst, false, _depth + 1)
        return `Promise<${argType}>`
      }
    }
    return 'Promise<unknown>'
  }
  if (value.startsWith('Promise.reject(')) {
    return 'Promise<never>'
  }
  if (value.startsWith('Promise.all(')) {
    // Extract array content between Promise.all([ ... ])
    const bracketStart = value.indexOf('[', 12)
    const bracketEnd = value.lastIndexOf(']')
    if (bracketStart !== -1 && bracketEnd > bracketStart) {
      const arrayContent = value.slice(bracketStart + 1, bracketEnd).trim()
      const elements = parseArrayElements(arrayContent)
      const elementTypes = elements.map((el) => {
        const trimmed = el.trim()
        if (trimmed.startsWith('Promise.resolve(')) {
          const promiseType = inferPromiseType(trimmed, isConst, _depth + 1)
          // Extract inner type from Promise<T> using indexOf
          const ltIdx = promiseType.indexOf('<')
          const gtIdx = promiseType.lastIndexOf('>')
          return (ltIdx !== -1 && gtIdx > ltIdx) ? promiseType.slice(ltIdx + 1, gtIdx) : 'unknown'
        }
        return inferNarrowType(trimmed, isConst, false, _depth + 1)
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
    return 'never[]'

  if (_depth >= MAX_INFERENCE_DEPTH)
    return 'unknown[]'

  // Simple parsing - this would need to be more sophisticated for complex cases
  const elements = parseArrayElements(content)

  // Check if any element has 'as const' - if so, this should be a readonly tuple
  let hasAsConst = false
  for (let k = 0; k < elements.length; k++) {
    const el = elements[k]
    // Check endsWith 'as const' accounting for trailing whitespace
    let end = el.length
    while (end > 0 && el.charCodeAt(end - 1) <= 32) end--
    if (end >= 8 && el.slice(end - 8, end) === 'as const') { hasAsConst = true; break }
  }

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

  // Regular array processing — also track nested defaults for clean default building
  const trackDefaults = _collectCleanDefault && !isConst
  const elementTypes: string[] = []
  const nestedDefaults: (string | null)[] = []
  for (const el of elements) {
    const trimmedEl = el.trim()
    const saved = _cleanDefaultResult
    _cleanDefaultResult = null
    if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
      elementTypes.push(inferArrayType(trimmedEl, isConst, _depth + 1))
    }
    else {
      elementTypes.push(inferNarrowTypeInUnion(trimmedEl, isConst, _depth + 1))
    }
    if (trackDefaults) nestedDefaults.push(_cleanDefaultResult)
    _cleanDefaultResult = saved
  }

  // Build clean default for non-const arrays (same pass, no re-parse)
  if (trackDefaults) {
    if (isSimpleArrayDefault(value)) {
      _cleanDefaultResult = collapseWhitespace(value)
    }
    else {
      const cleanElems: string[] = []
      for (let ei = 0; ei < elements.length; ei++) {
        const te = elements[ei].trim()
        if (te.endsWith('as const')) continue
        if (isPrimitiveLiteral(te) || te === 'null' || te === 'undefined') {
          cleanElems.push(te)
        }
        else if (te.startsWith('[') && isSimpleArrayDefault(te)) {
          cleanElems.push(collapseWhitespace(te))
        }
        else if (te.startsWith('{')) {
          if (nestedDefaults[ei]) cleanElems.push(nestedDefaults[ei]!)
        }
        else {
          // Re-infer without union context for the clean default
          const cleanType = inferNarrowType(te, false, false, 0)
          if (cleanType !== 'unknown') cleanElems.push(cleanType)
        }
      }
      if (cleanElems.length > 0) {
        _cleanDefaultResult = `[${cleanElems.join(', ')}]`
      }
    }
  }

  // For const arrays, ALWAYS create readonly tuples for better type safety
  if (isConst) {
    return `readonly [${elementTypes.join(', ')}]`
  }

  // Single-pass: deduplicate types AND check if all are literals
  const uniqueTypes: string[] = []
  let allLiterals = true
  for (const t of elementTypes) {
    // Dedup check
    let found = false
    for (const u of uniqueTypes) {
      if (t === u) { found = true; break }
    }
    if (!found) uniqueTypes.push(t)
    // Literal check
    if (allLiterals) {
      const isLit = isNumericLiteral(t)
        || t === 'true' || t === 'false'
        || (t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34) // "..."
        || (t.charCodeAt(0) === 39 && t.charCodeAt(t.length - 1) === 39) // '...'
      if (!isLit) allLiterals = false
    }
  }

  if (allLiterals && elementTypes.length <= 10) {
    return `readonly [${elementTypes.join(', ')}]`
  }

  if (uniqueTypes.length === 1) {
    return `${uniqueTypes[0]}[]`
  }

  return `(${uniqueTypes.join(' | ')})[]`
}

/**
 * Parse array elements handling nested structures
 */
export function parseArrayElements(content: string): string[] {
  const elements: string[] = []
  let start = 0
  let depth = 0
  let inString = false
  let stringChar = 0

  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)

    if (!inString && (c === 34 || c === 39 || c === 96)) { // double, single, backtick
      inString = true
      stringChar = c
    }
    else if (inString && c === stringChar && (i === 0 || content.charCodeAt(i - 1) !== 92)) { // not escaped
      inString = false
    }

    if (!inString) {
      if (c === 91 || c === 123 || c === 40) depth++ // [ { (
      else if (c === 93 || c === 125 || c === 41) depth-- // ] } )
      else if (c === 44 && depth === 0) { // ,
        const elem = content.substring(start, i).trim()
        if (elem) elements.push(elem)
        start = i + 1
        continue
      }
    }
  }

  const last = content.substring(start).trim()
  if (last) elements.push(last)

  return elements
}

/** Check if a value string is a primitive literal (number, string, boolean) */
function isPrimitiveLiteral(val: string): boolean {
  if (isNumericLiteral(val)) return true
  if (val === 'true' || val === 'false') return true
  if ((val.startsWith('"') && val.endsWith('"'))
    || (val.startsWith('\'') && val.endsWith('\''))) return true
  return false
}

/** Check if a type is a base/widened type */
function isBaseType(type: string): boolean {
  return type === 'number' || type === 'string' || type === 'boolean'
}

/** Check if an array literal only contains primitives/nested arrays/objects (no runtime expressions) */
function isSimpleArrayDefault(val: string): boolean {
  // Scan character by character, skipping quoted strings.
  // Reject if we find: arrow functions, keywords (new/async/await/function/yield/console/process),
  // or identifier followed by '(' (function calls).
  let inStr = false
  let strCh = 0
  const len = val.length
  for (let i = 0; i < len; i++) {
    const c = val.charCodeAt(i)
    if (inStr) {
      if (c === 92 /* \ */) { i++; continue } // skip escaped
      if (c === strCh) inStr = false
      continue
    }
    if (c === 34 || c === 39 || c === 96) { // " ' `
      inStr = true
      strCh = c
      continue
    }
    // Check for '=>'
    if (c === 61 /* = */ && i + 1 < len && val.charCodeAt(i + 1) === 62 /* > */) return false
    // Check for keywords at word boundary
    if (c >= 97 && c <= 122) { // a-z
      const start = i
      while (i < len && ((val.charCodeAt(i) >= 97 && val.charCodeAt(i) <= 122) || (val.charCodeAt(i) >= 65 && val.charCodeAt(i) <= 90) || (val.charCodeAt(i) >= 48 && val.charCodeAt(i) <= 57) || val.charCodeAt(i) === 95 || val.charCodeAt(i) === 36)) i++
      const word = val.slice(start, i)
      if (word === 'new' || word === 'async' || word === 'await' || word === 'function' || word === 'yield' || word === 'console' || word === 'process') return false
      // Check if identifier is followed by '(' (function call)
      let j = i
      while (j < len && val.charCodeAt(j) <= 32) j++
      if (j < len && val.charCodeAt(j) === 40 /* ( */) return false
      i-- // for-loop will increment
    }
  }
  return true
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

  // Track whether we should build a clean default inline
  const trackDefaults = _collectCleanDefault && !isConst
  const cleanProps: string[] = []

  for (const [key, val] of properties) {
    // Save/restore nested clean default around recursive calls
    const saved = _cleanDefaultResult
    _cleanDefaultResult = null

    let valueType = inferNarrowType(val, isConst, false, _depth + 1)

    const nestedDefault = _cleanDefaultResult
    _cleanDefaultResult = saved

    // Handle method signatures - clean up async and parameter defaults
    if (valueType.includes('=>') || valueType.includes('function') || valueType.includes('async')) {
      valueType = cleanMethodSignature(valueType)
    }

    // Add inline @defaultValue for widened primitive properties
    const rawVal = val.trim()
    if (!isConst && isBaseType(valueType) && isPrimitiveLiteral(rawVal)) {
      propTypes.push(`/** @defaultValue ${rawVal} */\n  ${key}: ${valueType}`)
    }
    else {
      propTypes.push(`${key}: ${valueType}`)
    }

    // Build clean default inline (same pass, no re-parse)
    // Strip block/JSDoc comments from key to prevent nested */ in @defaultValue code blocks
    if (trackDefaults) {
      const cleanKey = stripBlockComments(key)
      if (rawVal.endsWith('as const')) {
        // skip — type already narrow
      }
      else if (isPrimitiveLiteral(rawVal)) {
        cleanProps.push(`${cleanKey}: ${rawVal}`)
      }
      else if (rawVal.startsWith('[') && isSimpleArrayDefault(rawVal)) {
        cleanProps.push(`${cleanKey}: ${collapseWhitespace(rawVal)}`)
      }
      else if (rawVal.startsWith('{')) {
        if (nestedDefault) cleanProps.push(`${cleanKey}: ${nestedDefault}`)
      }
      else if (!rawVal.startsWith('[') && (rawVal.includes('=>') || rawVal.startsWith('function') || rawVal.startsWith('async'))) {
        const fnType = inferFunctionType(rawVal, false, 0, true)
        cleanProps.push(`${cleanKey}: ${fnType}`)
      }
    }
  }

  // Store the clean default result
  if (trackDefaults && cleanProps.length > 0) {
    const indent = _depth > 0 ? (_depth - 1) / 2 : 0
    const oneLine = `{ ${cleanProps.join(', ')} }`
    if (oneLine.length <= 80) {
      _cleanDefaultResult = oneLine
    }
    else {
      const pad = ' '.repeat((indent + 1) * 2)
      const closePad = ' '.repeat(indent * 2)
      _cleanDefaultResult = `{\n${pad}${cleanProps.join(`,\n${pad}`)}\n${closePad}}`
    }
  }

  return `{\n  ${propTypes.join(';\n  ')}\n}`
}

/**
 * Clean method signatures for declaration files
 */
function cleanMethodSignature(_signature: string): string {
  // 0. Strip inline // comments from each line before processing
  const signature = _signature.split('\n').map(line => stripTrailingInlineComment(line)).join('\n')
  // 1. Strip 'async' keyword at word boundaries
  let cleaned = signature
  const asyncIdx = cleaned.indexOf('async')
  if (asyncIdx !== -1) {
    const before = asyncIdx > 0 ? cleaned.charCodeAt(asyncIdx - 1) : 32
    const after = asyncIdx + 5 < cleaned.length ? cleaned.charCodeAt(asyncIdx + 5) : 32
    if (!isWordChar(before) && !isWordChar(after)) {
      cleaned = (cleaned.slice(0, asyncIdx) + cleaned.slice(asyncIdx + 5)).trim()
    }
  }

  // 2. Clean parameter defaults using the proper cleanParameterDefaults
  // Find the outermost parameter list (...) and clean it
  const parenStart = cleaned.indexOf('(')
  if (parenStart !== -1) {
    const parenEnd = findMatchingBracket(cleaned, parenStart, '(', ')')
    if (parenEnd !== -1) {
      const rawParams = cleaned.slice(parenStart, parenEnd + 1)
      const cleanedParams = cleanParameterDefaults(rawParams)
      cleaned = cleaned.slice(0, parenStart) + cleanedParams + cleaned.slice(parenEnd + 1)
    }
  }

  // 3. Collapse whitespace, but when the immediately surrounding context is {} (object type
  //    literal), replace newlines with '; ' to preserve member separation on a single line.
  //    Use a nesting stack to track whether { or ( is the innermost context.
  const len = cleaned.length
  let result = ''
  const nestStack: number[] = [] // stack of char codes: 123 for {, 40 for (
  let lastWasWs = false
  let wsHadNewline = false

  for (let i = 0; i < len; i++) {
    const c = cleaned.charCodeAt(i)

    if (c === 123 /* { */ || c === 40 /* ( */) nestStack.push(c)
    else if (c === 125 /* } */ || c === 41 /* ) */) nestStack.pop()

    if (c <= 32) {
      lastWasWs = true
      if (c === 10 || c === 13) wsHadNewline = true
      continue
    }

    if (lastWasWs && result.length > 0) {
      // When the innermost nesting context is {}, newline-separated members need semicolons
      const innermost = nestStack.length > 0 ? nestStack[nestStack.length - 1] : 0
      const insideBrace = innermost === 123 /* { */

      if (wsHadNewline && insideBrace) {
        // Check if the previous non-whitespace char already has a separator or is a comment end
        const lastChar = result.charCodeAt(result.length - 1)
        const isAlreadySeparated = lastChar === 59 /* ; */
          || lastChar === 44 /* , */
          || lastChar === 123 /* { */
          || c === 125 /* } */
        // Also don't add semicolons after JSDoc comment closings (*/)
        const isAfterComment = result.length >= 2
          && result.charCodeAt(result.length - 1) === 47 /* / */
          && result.charCodeAt(result.length - 2) === 42 /* * */

        if (!isAlreadySeparated && !isAfterComment) {
          result += '; '
        }
        else {
          result += ' '
        }
      }
      else {
        result += ' '
      }
    }

    lastWasWs = false
    wsHadNewline = false
    result += cleaned[i]
  }

  return result.trim()
}

function isWordChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36
}

/**
 * Clean parameter defaults from function parameters
 */
export function cleanParameterDefaults(params: string): string {
  // Remove parameter default values and make them optional.
  // Properly handles `name: Type = default` by placing `?` on the name, not the type.
  // Preserves multiline formatting when the original has newlines.
  const stripped = params.trim()
  // Remove outer parentheses if present
  let inner: string
  let hadParens = false
  if (stripped.startsWith('(') && stripped.endsWith(')')) {
    inner = stripped.slice(1, -1)
    hadParens = true
  }
  else {
    inner = stripped
  }

  const trimmedInner = inner.trim()
  if (!trimmedInner) return hadParens ? '()' : ''

  // Quick check: if there's no '=' (that isn't '=>'), there's nothing to clean
  let hasRealEqual = false
  {
    let d = 0
    for (let i = 0; i < trimmedInner.length; i++) {
      const ch = trimmedInner.charCodeAt(i)
      if (ch === 40 || ch === 60 || ch === 91 || ch === 123) d++
      else if (ch === 41 || ch === 62 || ch === 93 || ch === 125) d--
      else if (d === 0 && ch === 61) {
        const prev = i > 0 ? trimmedInner.charCodeAt(i - 1) : 0
        const next = i + 1 < trimmedInner.length ? trimmedInner.charCodeAt(i + 1) : 0
        if (prev !== 61 && prev !== 33 && prev !== 60 && prev !== 62 && next !== 61 && next !== 62) {
          hasRealEqual = true
          break
        }
      }
    }
  }
  if (!hasRealEqual) return stripped

  // Split parameters by comma at depth 0, preserving whitespace around commas
  const paramParts: string[] = []
  const separators: string[] = [] // The commas and surrounding whitespace between params
  let start = 0
  let depth = 0
  let inStr = false
  let strCh = 0
  for (let i = 0; i <= trimmedInner.length; i++) {
    if (i === trimmedInner.length) {
      paramParts.push(trimmedInner.slice(start))
      break
    }
    const ch = trimmedInner.charCodeAt(i)
    if (inStr) {
      if (ch === 92 /* \\ */) { i++; continue }
      if (ch === strCh) inStr = false
      continue
    }
    if (ch === 39 || ch === 34 || ch === 96) { inStr = true; strCh = ch; continue }
    if (ch === 40 || ch === 60 || ch === 91 || ch === 123) depth++
    else if (ch === 41 || ch === 62 || ch === 93 || ch === 125) depth--
    else if (ch === 44 && depth === 0) {
      paramParts.push(trimmedInner.slice(start, i))
      // Capture the comma + whitespace after it as separator
      let sep = ','
      let j = i + 1
      while (j < trimmedInner.length && (trimmedInner.charCodeAt(j) <= 32)) {
        sep += trimmedInner[j]
        j++
      }
      separators.push(sep)
      start = j
    }
  }

  // Process each parameter
  const cleaned: string[] = []
  for (const param of paramParts) {
    const trimmed = param.trim()
    if (!trimmed) { cleaned.push(param); continue }
    // Skip parameters that are entirely inline comments (e.g. "// 7 days default")
    if (trimmed.startsWith('//')) continue
    // Strip trailing inline comments from the parameter (e.g. "name: Type // comment")
    const stripped = stripTrailingInlineComment(trimmed)
    // Preserve leading whitespace from original param
    const leadingWs = param.slice(0, param.length - param.trimStart().length)
    cleaned.push(leadingWs + cleanSingleParam(stripped))
  }

  // Rejoin with original separators
  let result = cleaned[0] || ''
  for (let i = 1; i < cleaned.length; i++) {
    result += (separators[i - 1] || ', ') + cleaned[i]
  }

  return hadParens ? `(${result})` : result
}

/** Strip trailing inline // comments from a string, respecting string literals */
function stripTrailingInlineComment(text: string): string {
  let inStr = false
  let strCh = 0
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text.charCodeAt(i)
    if (inStr) {
      if (ch === 92 /* \\ */) { i++; continue }
      if (ch === strCh) inStr = false
      continue
    }
    if (ch === 39 || ch === 34 || ch === 96) { inStr = true; strCh = ch; continue }
    if (ch === 47 /* / */ && text.charCodeAt(i + 1) === 47 /* / */) {
      return text.slice(0, i).trimEnd()
    }
  }
  return text
}

/** Clean a single parameter: strip default value, add ? to name if needed */
function cleanSingleParam(param: string): string {
  // Handle rest parameters
  if (param.startsWith('...')) {
    return param // rest params don't have defaults in meaningful way
  }

  // Find colon and equals at depth 0 to parse: name[?]: type [= default]
  let colonIdx = -1
  let equalIdx = -1
  let depth = 0
  let inStr = false
  let strCh = 0

  for (let i = 0; i < param.length; i++) {
    const ch = param.charCodeAt(i)
    if (inStr) {
      if (ch === 92 /* \\ */) { i++; continue }
      if (ch === strCh) inStr = false
      continue
    }
    if (ch === 39 || ch === 34 || ch === 96) { inStr = true; strCh = ch; continue }
    if (ch === 40 || ch === 60 || ch === 91 || ch === 123) depth++
    else if (ch === 41 || ch === 62 || ch === 93 || ch === 125) depth--
    else if (depth === 0) {
      if (ch === 58 /* : */ && colonIdx === -1) colonIdx = i
      else if (ch === 61 /* = */ && equalIdx === -1
        && (i === 0 || param.charCodeAt(i - 1) !== 61)
        && (i + 1 >= param.length || (param.charCodeAt(i + 1) !== 61 && param.charCodeAt(i + 1) !== 62))) {
        equalIdx = i
      }
    }
  }

  const hasDefault = equalIdx !== -1

  if (colonIdx !== -1 && (equalIdx === -1 || colonIdx < equalIdx)) {
    // Has type annotation: name[?]: type [= default]
    const name = param.slice(0, colonIdx).trim()
    const type = equalIdx !== -1
      ? param.slice(colonIdx + 1, equalIdx).trim()
      : param.slice(colonIdx + 1).trim()

    // Add ? to the name if it has a default and doesn't already have ?
    const optionalMarker = hasDefault && !name.endsWith('?') ? '?' : ''
    return `${name}${optionalMarker}: ${type}`
  }
  else if (equalIdx !== -1) {
    // No type annotation, just name = default
    const name = param.slice(0, equalIdx).trim()
    const optionalMarker = !name.endsWith('?') ? '?' : ''
    // Try to infer type from default value
    const defaultVal = param.slice(equalIdx + 1).trim()
    let type = 'unknown'
    if (defaultVal === 'true' || defaultVal === 'false') type = 'boolean'
    else if (/^-?\d+(\.\d+)?$/.test(defaultVal)) type = 'number'
    else if ((defaultVal.startsWith('\'') && defaultVal.endsWith('\'')) || (defaultVal.startsWith('"') && defaultVal.endsWith('"'))) type = 'string'
    else if (defaultVal.startsWith('[')) type = 'unknown[]'
    else if (defaultVal.startsWith('{')) type = 'Record<string, unknown>'
    return `${name}${optionalMarker}: ${type}`
  }

  // No default, return as-is
  return param
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

    // Track single-line comments — skip to end of line
    if (!inString && !inComment && char === '/' && nextChar === '/') {
      // Skip the entire single-line comment (don't include in key/value parsing)
      i += 2 // Skip '//'
      while (i < content.length && content[i] !== '\n') i++
      continue
    }

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
      if (char === '(' && depth === 0 && inKey) {
        // Method definition like: methodName(params) or async methodName<T>(params)
        // Must be checked BEFORE general bracket tracking so ( isn't swallowed
        currentKey = current.trim()
        // Remove 'async' from the key if present
        if (currentKey.startsWith('async ')) {
          currentKey = currentKey.slice(6).trim()
        }
        current = char // Start with the opening parenthesis
        inKey = false
        depth = 1 // We're now inside the method definition
      }
      else if (char === '{' || char === '[' || char === '(') {
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
function convertMethodToFunctionType(_methodName: string, methodDef: string): string {
  // Remove async modifier if present — no regex
  let cleaned = methodDef
  let ci = 0
  while (ci < cleaned.length && cleaned.charCodeAt(ci) <= 32) ci++
  if (cleaned.startsWith('async', ci) && ci + 5 < cleaned.length && cleaned.charCodeAt(ci + 5) <= 32) {
    cleaned = cleaned.slice(ci + 5).trimStart()
  }

  // Extract generics: starts with '<', find matching '>'
  let generics = ''
  if (cleaned.charCodeAt(0) === 60 /* < */) {
    let depth = 0
    let gEnd = -1
    for (let gi = 0; gi < cleaned.length; gi++) {
      if (cleaned.charCodeAt(gi) === 60) depth++
      else if (cleaned.charCodeAt(gi) === 62) { depth--; if (depth === 0) { gEnd = gi; break } }
    }
    if (gEnd !== -1) {
      generics = cleaned.slice(0, gEnd + 1)
      cleaned = cleaned.slice(gEnd + 1).trimStart()
    }
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
  const afterParams = cleaned.slice(paramEnd + 1).trimStart()
  if (afterParams.charCodeAt(0) === 58 /* : */) {
    // Extract return type until '{' (body start)
    const braceIdx = afterParams.indexOf('{')
    if (braceIdx !== -1) {
      returnType = afterParams.slice(1, braceIdx).trim()
    }
    else {
      returnType = afterParams.slice(1).trim()
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
export function inferFunctionType(value: string, inUnion: boolean = false, _depth: number = 0, isConst: boolean = true): string {
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
      returnType = inferNarrowType(body, isConst, false, _depth + 1)
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
    const closingParenColon = params.lastIndexOf('):')
    if (closingParenColon !== -1) {
      const afterColon = params.substring(closingParenColon + 2).trim()
      if (afterColon && !afterColon.includes('=>') && !afterColon.includes('=')) {
        explicitReturnType = afterColon
        params = params.substring(0, closingParenColon + 1)
      }
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
      const bodyTrimmed = body.trimStart()
      const outerParenOpen = bodyTrimmed.indexOf('(')
      const outerParenClose = outerParenOpen !== -1 ? bodyTrimmed.indexOf(')', outerParenOpen) : -1
      const outerArrow = outerParenClose !== -1 ? bodyTrimmed.indexOf('=>', outerParenClose) : -1
      if (outerParenOpen === 0 && outerParenClose !== -1 && outerArrow !== -1) {
        const outerParams = bodyTrimmed.substring(outerParenOpen + 1, outerParenClose).trim()
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
        returnType = inferNarrowType(body, isConst, false, _depth + 1)
      }
    }

    const funcType = `${generics}${params} => ${returnType}`
    return inUnion ? `(${funcType})` : funcType
  }

  // Function expressions
  if (trimmed.startsWith('function')) {
    // Parse function expression manually: function[*] [<generics>] [name]([params]) [: ReturnType] { ... }
    let pos = 8 // skip "function"
    const len = trimmed.length

    // Skip whitespace
    while (pos < len && trimmed.charCodeAt(pos) <= 32) pos++

    // Check for generator *
    let isGenerator = false
    if (pos < len && trimmed.charCodeAt(pos) === 42) { // *
      isGenerator = true
      pos++
      while (pos < len && trimmed.charCodeAt(pos) <= 32) pos++
    }

    // Check for generics <...>
    let generics = ''
    if (pos < len && trimmed.charCodeAt(pos) === 60) { // <
      const genStart = pos
      let depth = 1
      pos++
      while (pos < len && depth > 0) {
        const c = trimmed.charCodeAt(pos)
        if (c === 60) depth++
        else if (c === 62) depth--
        pos++
      }
      generics = trimmed.substring(genStart, pos)
      while (pos < len && trimmed.charCodeAt(pos) <= 32) pos++
    }

    // Skip optional function name until (
    const parenIdx = trimmed.indexOf('(', pos)
    if (parenIdx !== -1) {
      // Find matching closing paren
      let depth = 1
      let closeIdx = parenIdx + 1
      while (closeIdx < len && depth > 0) {
        const c = trimmed.charCodeAt(closeIdx)
        if (c === 40) depth++
        else if (c === 41) depth--
        closeIdx++
      }
      const params = trimmed.substring(parenIdx + 1, closeIdx - 1).trim()

      const paramTypes = params ? `(${params})` : '()'

      if (isGenerator) {
        // Check for explicit Generator return type after the closing paren
        const afterParen = trimmed.substring(closeIdx).trim()
        const genIdx = afterParen.indexOf('Generator<')
        if (genIdx !== -1) {
          const genStart = genIdx + 10 // "Generator<".length
          const genEnd = afterParen.indexOf('>', genStart)
          if (genEnd !== -1) {
            const generatorTypes = afterParen.substring(genStart, genEnd)
            const funcType = `${generics}${paramTypes} => Generator<${generatorTypes}>`
            return inUnion ? `(${funcType})` : funcType
          }
        }
        const funcType = `${generics}${paramTypes} => Generator<any, any, any>`
        return inUnion ? `(${funcType})` : funcType
      }

      const funcType = `${generics}${paramTypes} => unknown`
      return inUnion ? `(${funcType})` : funcType
    }

    const funcType = '(...args: any[]) => unknown'
    return inUnion ? `(${funcType})` : funcType
  }

  // Higher-order functions (functions that return functions)
  if (trimmed.includes('=>') && trimmed.includes('(') && trimmed.includes(')')) {
    // For very complex function types, fall back to a simpler signature
    if (trimmed.length > 100 || countOccurrences(trimmed, '=>') > 2) {
      // Extract just the basic signature pattern
      let generics = ''
      if (trimmed.charCodeAt(0) === 60) { // <
        const gt = trimmed.indexOf('>')
        if (gt !== -1) generics = trimmed.substring(0, gt + 1)
      }

      // Look for parameter pattern
      const po = trimmed.indexOf('(')
      const pc = po !== -1 ? trimmed.indexOf(')', po) : -1
      const params = (po !== -1 && pc !== -1) ? trimmed.substring(po, pc + 1) : '(...args: any[])'

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
  if (/^\{\s*\[[^\]]*\]:\s*(any|string|number|unknown)\s*\}$/.test(trimmed)) {
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
export function isComplexType(_typeStr: string): boolean {
  const typeStr = _typeStr
  const trimmed = typeStr.trim()

  // Mapped types: [key in ...
  const bracketIdx = trimmed.indexOf('[')
  if (bracketIdx !== -1) {
    const inIdx = trimmed.indexOf(' in ', bracketIdx)
    if (inIdx !== -1) return true
  }

  // Conditional types: ... extends ... ? ... : ...
  const extendsIdx = trimmed.indexOf(' extends ')
  if (extendsIdx !== -1) {
    const qIdx = trimmed.indexOf(' ? ', extendsIdx)
    if (qIdx !== -1 && trimmed.indexOf(' : ', qIdx) !== -1) return true
  }

  // Template literal types: `...${...}...`
  if (trimmed.charCodeAt(0) === 96 /* ` */ && trimmed.charCodeAt(trimmed.length - 1) === 96) {
    if (trimmed.indexOf('${') !== -1) return true
  }

  // Infer keyword: infer T
  const inferIdx = trimmed.indexOf('infer ')
  if (inferIdx !== -1) {
    if (inferIdx === 0 || !isWordChar(trimmed.charCodeAt(inferIdx - 1))) return true
  }

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
  if (trimmed.length === 0 || trimmed.charCodeAt(0) === 91 /* [ */) return false
  // Must end with ']' and contain '[' preceded by word chars or dots
  if (trimmed.charCodeAt(trimmed.length - 1) !== 93 /* ] */) return false
  const bracketIdx = trimmed.indexOf('[')
  if (bracketIdx <= 0) return false
  // Check prefix is word chars and dots only
  for (let i = 0; i < bracketIdx; i++) {
    const c = trimmed.charCodeAt(i)
    if (!isWordChar(c) && c !== 46 /* . */) return false
  }
  return true
}
