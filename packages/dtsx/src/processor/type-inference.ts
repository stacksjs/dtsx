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

    if (!inString && (c === 34 || c === 39 || c === 96)) { // " ' `
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
    if (trackDefaults) {
      if (rawVal.endsWith('as const')) {
        // skip — type already narrow
      }
      else if (isPrimitiveLiteral(rawVal)) {
        cleanProps.push(`${key}: ${rawVal}`)
      }
      else if (rawVal.startsWith('[') && isSimpleArrayDefault(rawVal)) {
        cleanProps.push(`${key}: ${collapseWhitespace(rawVal)}`)
      }
      else if (rawVal.startsWith('{')) {
        if (nestedDefault) cleanProps.push(`${key}: ${nestedDefault}`)
      }
      else if (!rawVal.startsWith('[') && (rawVal.includes('=>') || rawVal.startsWith('function') || rawVal.startsWith('async'))) {
        const fnType = inferFunctionType(rawVal, false, 0, true)
        cleanProps.push(`${key}: ${fnType}`)
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
function cleanMethodSignature(signature: string): string {
  // Single-pass: remove 'async' keywords, replace param defaults with '?',
  // and collapse whitespace — all in one loop.
  let result = ''
  const len = signature.length
  let i = 0
  let lastWasWs = false
  let depth = 0 // track paren depth for param defaults

  while (i < len) {
    const c = signature.charCodeAt(i)

    // Skip 'async ' at word boundaries
    if (c === 97 /* a */ && signature.startsWith('async', i)) {
      const after = i + 5
      if (after < len && signature.charCodeAt(after) <= 32) {
        // Check word boundary before 'async'
        if (i === 0 || !(isWordChar(signature.charCodeAt(i - 1)))) {
          i = after
          while (i < len && signature.charCodeAt(i) <= 32) i++
          continue
        }
      }
    }

    // Track parentheses
    if (c === 40 /* ( */) depth++
    else if (c === 41 /* ) */) depth--

    // Inside params: check for 'word =' pattern for defaults
    if (depth > 0 && isWordChar(c)) {
      const wordStart = i
      while (i < len && isWordChar(signature.charCodeAt(i))) i++
      const word = signature.slice(wordStart, i)
      // Skip whitespace
      let j = i
      while (j < len && signature.charCodeAt(j) <= 32) j++
      if (j < len && signature.charCodeAt(j) === 61 /* = */ && (j + 1 >= len || signature.charCodeAt(j + 1) !== 62 /* > */)) {
        // This is a default value — skip it, emit 'word?'
        if (lastWasWs && result.length > 0) result += ' '
        result += word + '?'
        lastWasWs = false
        j++ // skip '='
        // Skip the default value until ',' or ')' at same depth
        let d = 0
        while (j < len) {
          const dc = signature.charCodeAt(j)
          if (dc === 40 || dc === 91 || dc === 123) d++
          else if (dc === 41 || dc === 93 || dc === 125) {
            if (d === 0) break
            d--
          }
          else if (dc === 44 && d === 0) break // comma
          j++
        }
        i = j
        continue
      }
      // Not a default — emit the word
      if (lastWasWs && result.length > 0) result += ' '
      lastWasWs = false
      result += word
      i = wordStart + word.length
      continue
    }

    // Collapse whitespace
    if (c <= 32) {
      lastWasWs = true
      i++
      continue
    }

    if (lastWasWs && result.length > 0) result += ' '
    lastWasWs = false
    result += signature[i]
    i++
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
  // Remove parameter default values and make them optional — no regex
  const len = params.length
  let result = ''
  let i = 0
  while (i < len) {
    const c = params.charCodeAt(i)
    // Look for word char sequences
    if (isWordChar(c)) {
      const wStart = i
      while (i < len && isWordChar(params.charCodeAt(i))) i++
      const word = params.slice(wStart, i)
      // Skip whitespace
      let j = i
      while (j < len && params.charCodeAt(j) <= 32) j++
      if (j < len && params.charCodeAt(j) === 61 /* = */ && (j + 1 >= len || params.charCodeAt(j + 1) !== 62 /* > */)) {
        // Default value: emit 'word?' and skip the value
        result += word + '?'
        j++ // skip '='
        let d = 0
        while (j < len) {
          const dc = params.charCodeAt(j)
          if (dc === 40 || dc === 91 || dc === 123) d++
          else if (dc === 41 || dc === 93 || dc === 125) {
            if (d === 0) break
            d--
          }
          else if (dc === 44 && d === 0) break
          j++
        }
        i = j
      }
      else {
        result += word
      }
    }
    else {
      result += params[i]
      i++
    }
  }
  return result
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
function convertMethodToFunctionType(methodName: string, methodDef: string): string {
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

      let paramTypes = params ? `(${params})` : '()'

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
export function isComplexType(typeStr: string): boolean {
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
