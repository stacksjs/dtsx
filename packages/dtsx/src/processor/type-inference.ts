/**
 * Type inference utilities for DTS generation
 * Handles inferring narrow types from values
 */
import type { KeyConstants } from '../computed-keys'
import { bindingPatternNames } from '../binding-patterns'
import { hasTemplateSubstitution, isSymbolKey, resolveTemplateKey } from '../computed-keys'
import { tokenizeDeclarationSyntax } from '../module-references'
import { defaultedObjectBinding, defaultedObjectBindingParameter, normalizeDefaultParameterOrder } from '../parameters'
import { escapeJsdocContent } from './comments'

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

/** A type with its block comments removed, and no blank line left where one was. */
function withoutComments(type: string): string {
  return stripBlockComments(type).replace(/\n[ \t]*(?=\n)/g, '')
}

/** Strip block/JSDoc comments from a property key to keep @defaultValue clean */
function stripBlockComments(s: string): string {
  // Fast path: no `/*` present — return trimmed input directly (zero scan).
  const firstStart = s.indexOf('/*')
  if (firstStart === -1) return s.trim()

  // Slice-based assembly is much faster in V8 than `result += s.charAt(i)`,
  // which both allocates a 1-char string and re-grows the result on every step.
  const parts: string[] = []
  let segStart = 0
  let i = 0
  const len = s.length
  while (i < len) {
    if (s.charCodeAt(i) === 47 /* / */ && i + 1 < len && s.charCodeAt(i + 1) === 42 /* * */) {
      if (i > segStart) parts.push(s.substring(segStart, i))
      i += 2
      while (i < len - 1) {
        if (s.charCodeAt(i) === 42 /* * */ && s.charCodeAt(i + 1) === 47 /* / */) {
          i += 2
          break
        }
        i++
      }
      segStart = i
    }
    else {
      i++
    }
  }
  if (segStart < len) parts.push(s.substring(segStart))
  return parts.join('').trim()
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

function isDigitForBase(code: number, base: number): boolean {
  if (base === 2) return code === 48 || code === 49
  if (base === 8) return code >= 48 && code <= 55
  if (base === 10) return code >= 48 && code <= 57
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70)
}

/** Digits of one base with single `_` separators between them; advances `cursor.at`. */
function consumeDigits(s: string, cursor: { at: number }, base: number): boolean {
  let sawDigit = false
  let previousSeparator = false
  while (cursor.at < s.length) {
    const code = s.charCodeAt(cursor.at)
    if (isDigitForBase(code, base)) {
      sawDigit = true
      previousSeparator = false
      cursor.at++
    }
    else if (code === 95 /* _ */ && sawDigit && !previousSeparator && cursor.at + 1 < s.length && isDigitForBase(s.charCodeAt(cursor.at + 1), base)) {
      previousSeparator = true
      cursor.at++
    }
    else {
      break
    }
  }
  return sawDigit && !previousSeparator
}

function radixPrefix(s: string, at: number): number {
  if (s.charCodeAt(at) !== 48 /* 0 */ || at + 1 >= s.length) return 0
  const marker = s.charCodeAt(at + 1) | 32
  return marker === 120 /* x */ ? 16 : marker === 98 /* b */ ? 2 : marker === 111 /* o */ ? 8 : 0
}

/**
 * Decimal, scientific, hexadecimal, binary, and octal numeric literals with
 * an optional leading minus and numeric separators (the native engine's grammar).
 */
export function isNumericLiteral(s: string): boolean {
  if (s.length === 0) return false
  const cursor = { at: 0 }
  if (s.charCodeAt(0) === 45 /* - */) cursor.at++
  if (cursor.at >= s.length) return false
  const base = radixPrefix(s, cursor.at)
  if (base) {
    cursor.at += 2
    return consumeDigits(s, cursor, base) && cursor.at === s.length
  }
  const hasIntegerDigits = consumeDigits(s, cursor, 10)
  if (s.charCodeAt(cursor.at) === 46 /* . */) {
    cursor.at++
    const hasFractionDigits = consumeDigits(s, cursor, 10)
    if (!hasIntegerDigits && !hasFractionDigits) return false
  }
  else if (!hasIntegerDigits) {
    return false
  }
  const exponent = s.charCodeAt(cursor.at)
  if (exponent === 101 /* e */ || exponent === 69 /* E */) {
    cursor.at++
    if (s.charCodeAt(cursor.at) === 43 /* + */ || s.charCodeAt(cursor.at) === 45 /* - */) cursor.at++
    if (!consumeDigits(s, cursor, 10)) return false
  }
  return cursor.at === s.length
}

/** Decimal, hexadecimal, binary, and octal BigInt literals, with a leading minus and separators. */
export function isBigIntLiteral(s: string): boolean {
  if (s.length < 2 || s.charCodeAt(s.length - 1) !== 110 /* n */) return false
  const digits = s.slice(0, -1)
  const cursor = { at: 0 }
  if (digits.charCodeAt(0) === 45 /* - */) cursor.at++
  if (cursor.at >= digits.length) return false
  const base = radixPrefix(digits, cursor.at)
  if (base) {
    cursor.at += 2
    return consumeDigits(digits, cursor, base) && cursor.at === digits.length
  }
  return consumeDigits(digits, cursor, 10) && cursor.at === digits.length
}

/** A numeric or BigInt literal as a literal type: separators do not belong to its value (`5_000` is `5000`). */
export function numericLiteralType(literal: string): string {
  return literal.includes('_') ? literal.replaceAll('_', '') : literal
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

function isJsxTagNameChar(code: number): boolean {
  return (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || (code >= 48 && code <= 57)
    || code === 36 || code === 95 || code === 46 || code === 58 || code === 45
}

/**
 * Detect a complete JSX element or fragment without assuming React as the JSX
 * runtime. A matching outer close prevents generic arrows and type assertions
 * from being classified as JSX.
 */
function isJsxExpression(value: string): boolean {
  const expression = value.trim()
  if (expression.length < 3 || expression.charCodeAt(0) !== 60) return false
  if (expression.startsWith('<>')) return expression.endsWith('</>')

  const firstTagCode = expression.charCodeAt(1)
  const isIdentifierStart = (firstTagCode >= 65 && firstTagCode <= 90)
    || (firstTagCode >= 97 && firstTagCode <= 122)
    || firstTagCode === 36 || firstTagCode === 95
  if (!isIdentifierStart) return false

  let tagEnd = 2
  while (tagEnd < expression.length && isJsxTagNameChar(expression.charCodeAt(tagEnd))) tagEnd++
  const tagName = expression.slice(1, tagEnd)
  const delimiter = expression.charCodeAt(tagEnd)
  if (delimiter > 32 && delimiter !== 62 && delimiter !== 47) return false
  if (expression.endsWith('/>')) return true

  const closeStart = expression.lastIndexOf('</')
  if (closeStart === -1) return false
  let closeEnd = closeStart + 2
  while (closeEnd < expression.length && isJsxTagNameChar(expression.charCodeAt(closeEnd))) closeEnd++
  return expression.slice(closeStart + 2, closeEnd) === tagName
    && expression.charCodeAt(closeEnd) === 62
    && closeEnd === expression.length - 1
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
export function inferNarrowType(value: unknown, isConst: boolean = false, inUnion: boolean = false, _depth: number = 0, keyConstants?: KeyConstants): string {
  if (!value || typeof value !== 'string')
    return 'unknown'

  if (_depth >= MAX_INFERENCE_DEPTH)
    return 'unknown'

  const trimmed = value.trim()

  if (isJsxExpression(trimmed)) return 'JSX.Element'

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

  // Runtime interpolation contains value expressions rather than type nodes.
  // Multiline template values are widened as well, keeping declarations compact
  // and preventing embedded CSS or HTML comments from being normalized as code.
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    if (!isConst || trimmed.includes('${') || trimmed.includes('\n') || trimmed.includes('\r')) return 'string'
    return trimmed
  }

  // String literals — only when the text is exactly one literal. Multi-part
  // concatenations ('a' + 'b') evaluate to the joined literal for const
  // (string otherwise), and any `+` with a string-literal operand widens to
  // string. Purely numeric arithmetic (`60 * 1000`) widens to number.
  if (trimmed.charCodeAt(0) === 39 || trimmed.charCodeAt(0) === 34) { // single or double quote
    const stringExpr = classifyStringExpression(trimmed)
    if (stringExpr !== null) {
      if (stringExpr === 'string' || !isConst) return 'string'
      return stringExpr
    }
    // Not a plain string expression (e.g. `'x' as const`, `'x'.repeat(3)`) —
    // fall through so assertions and other wrappers are still handled below.
  }

  // Number literals
  if (isNumericLiteral(trimmed)) {
    if (!isConst)
      return 'number'
    return numericLiteralType(trimmed)
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
    return inferArrayType(trimmed, isConst, _depth + 1, keyConstants)
  }

  // Object literals
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return inferObjectType(trimmed, isConst, _depth + 1, keyConstants)
  }

  // Class expressions — extract the class name and use typeof
  if (trimmed.startsWith('class ') || trimmed.startsWith('class{')) {
    return inferClassExpressionType(trimmed)
  }

  // New expressions (check before function expressions since `new X(() => {})` contains `=>`)
  if (trimmed.startsWith('new ')) {
    return inferNewExpressionType(trimmed)
  }

  // As const assertions
  if (trimmed.endsWith('as const')) {
    const withoutAsConst = trimmed.slice(0, -8).trim()
    if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
      const content = withoutAsConst.slice(1, -1).trim()
      if (!content)
        return 'readonly []'
      const elements = parseArrayElements(content)
      const elementTypes: string[] = []
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i].trim()
        if (element.startsWith('...')) {
          const operand = element.slice(3).trim()
          // A tuple spread preserves order, literal identity and variadic length.
          // It is not one unknown element or a union of its members.
          if (isEntityName(operand)) elementTypes.push(`...typeof ${operand}`)
          else {
            const type = inferNarrowType(operand, true, false, _depth + 1, keyConstants)
            elementTypes.push(type.startsWith('readonly [') || type.endsWith('[]') ? `...${type}` : '...unknown[]')
          }
        }
        else elementTypes.push(inferNarrowType(element, true, false, _depth + 1, keyConstants))
      }
      return `readonly [${elementTypes.join(', ')}]`
    }
    return inferNarrowType(withoutAsConst, true, inUnion, _depth + 1, keyConstants)
  }

  // Function expressions. Check these after `as const` so an asserted
  // object or array containing arrow-function properties is inferred as a
  // container instead of treating the complete initializer as one function.
  if (findMainArrowIndex(trimmed) !== -1 || trimmed.startsWith('function') || trimmed.startsWith('async')) {
    return inferFunctionType(trimmed, inUnion, _depth, isConst)
  }

  // Template literal expressions
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return inferTemplateLiteralType(trimmed, isConst)
  }

  // Promise expressions
  if (trimmed.startsWith('Promise.')) {
    return inferPromiseType(trimmed, isConst, _depth, keyConstants)
  }

  // Await expressions
  if (trimmed.startsWith('await ')) {
    return 'unknown'
  }

  // Unary operators with a fixed result type. `typeof x` is a string, but
  // `typeof x === 'object' && ...` is a larger expression.
  if (trimmed.startsWith('typeof ') && isUnaryOperand(trimmed.slice(7))) return 'string'
  if (trimmed.startsWith('void ') && isUnaryOperand(trimmed.slice(5))) return 'undefined'
  if (trimmed.startsWith('delete ') && isUnaryOperand(trimmed.slice(7))) return 'boolean'

  // BigInt literals (digits followed by 'n')
  if (isBigIntLiteral(trimmed)) {
    if (isConst) {
      return numericLiteralType(trimmed)
    }
    return 'bigint'
  }

  // Symbol
  if (trimmed.startsWith('Symbol(') || trimmed === 'Symbol.for') {
    return 'symbol'
  }

  const callType = inferCallType(trimmed)
  if (callType !== null) return callType

  if (hasTopLevelComparison(trimmed)) return 'boolean'

  // Purely numeric arithmetic (`60 * 1000`, `(1 / 2) * 60`) widens to number.
  if (isNumericArithmetic(trimmed)) return 'number'

  // Other expressions (method calls, property access, etc.)
  return 'unknown'
}

/** Check if the text is a single string literal with nothing after it. */
function isSingleStringLiteral(value: string): boolean {
  const quote = value.charCodeAt(0)
  if (quote !== 39 && quote !== 34) return false
  return skipQuotedValue(value, 0, quote) === value.length
}

/**
 * Classify an expression that starts with a string literal: exactly one
 * literal, a concatenation of literals (evaluated to the joined literal), or
 * a `+` with at least one string operand (widens to string). Returns null
 * when the expression is not recognizable.
 */
function classifyStringExpression(value: string): string | null {
  if (isSingleStringLiteral(value)) return value
  const parts = splitTopLevelPlus(value)
  if (parts.length < 2) return null
  let hasStringPart = false
  let allStringParts = true
  let joined = ''
  for (const part of parts) {
    const p = part.trim()
    if (isSingleStringLiteral(p)) {
      hasStringPart = true
      joined += unquoteStringLiteral(p)
    }
    else {
      allStringParts = false
    }
  }
  if (allStringParts) return quoteStringLiteral(joined)
  if (hasStringPart) return 'string'
  return null
}

/** Split an expression on top-level `+` operators (strings/comments aware). */
function splitTopLevelPlus(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < text.length) {
    const char = text.charCodeAt(i)
    if (char === 39 || char === 34 || char === 96) {
      i = skipQuotedValue(text, i, char)
      continue
    }
    if (char === 40 || char === 91 || char === 123) depth++
    else if (char === 41 || char === 93 || char === 125) depth--
    else if (char === 43 /* + */ && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
    i++
  }
  parts.push(text.slice(start))
  return parts
}

/** Decode a quoted string literal to its raw value. */
function unquoteStringLiteral(literal: string): string {
  const body = literal.slice(1, -1)
  return body.replace(/\\(.)/g, (_m, ch: string) => {
    if (ch === 'n') return '\n'
    if (ch === 't') return '\t'
    if (ch === 'r') return '\r'
    if (ch === '0') return '\0'
    return ch
  })
}

/** Encode a raw string value as a single-quoted string literal type. */
function quoteStringLiteral(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\\\'')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `'${escaped}'`
}

/** Check if the expression is composed solely of numeric literals and arithmetic operators. */
function isNumericArithmetic(value: string): boolean {
  if (value === '') return false
  let hasDigit = false
  let hasOperator = false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      hasDigit = true
      continue
    }
    if (c === 43 || c === 45 || c === 42 || c === 47 || c === 37) { // + - * / %
      hasOperator = true
      continue
    }
    if (c === 46 || c === 40 || c === 41 || c <= 32) continue // . ( ) whitespace
    return false
  }
  return hasDigit && hasOperator
}

/** Check for a comparison operator outside nested expressions and strings. */
function hasTopLevelComparison(value: string): boolean {
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index)
    if (char === 34 || char === 39 || char === 96) {
      index = skipQuotedValue(value, index, char) - 1
      continue
    }
    if (char === 40 || char === 91 || char === 123) {
      depth++
      continue
    }
    if (char === 41 || char === 93 || char === 125) {
      depth--
      continue
    }
    if (depth !== 0) continue
    if (value.startsWith('===', index) || value.startsWith('!==', index)
      || value.startsWith('==', index) || value.startsWith('!=', index)
      || value.startsWith('>=', index) || value.startsWith('<=', index)) return true
    if ((char === 62 || char === 60) && value.charCodeAt(index - 1) !== 61 && value.charCodeAt(index + 1) !== 61) return true
  }
  return false
}

/**
 * Infer and narrow types from values in union context (for arrays)
 * Widens number/boolean literals to base types unless const
 */
export function inferNarrowTypeInUnion(value: unknown, isConst: boolean = false, _depth: number = 0, keyConstants?: KeyConstants): string {
  return inferNarrowType(value, isConst, true, _depth, keyConstants)
}

/**
 * Infer the public return type of a function body without building a TypeScript AST.
 *
 * This is intentionally used only by the semantic generation path. Isolated
 * declarations remain annotation-first and never scan implementation bodies.
 */
export function inferFunctionBodyReturnType(body: string, isAsync: boolean = false, parameters: string = '', classExpression?: (value: string) => string | undefined, assertedType?: (type: string, position: number) => string): string {
  const parameterTypes = collectParameterTypes(parameters, classExpression)
  const returnTypes: string[] = []
  let hasBareReturn = false
  let i = 0

  while (i < body.length) {
    const char = body.charCodeAt(i)

    if (char === 34 || char === 39 || char === 96) {
      i = skipQuotedValue(body, i, char)
      continue
    }
    if (char === 47 && body.charCodeAt(i + 1) === 47) {
      i += 2
      while (i < body.length && body.charCodeAt(i) !== 10 && body.charCodeAt(i) !== 13) i++
      continue
    }
    if (char === 47 && body.charCodeAt(i + 1) === 42) {
      const close = body.indexOf('*/', i + 2)
      i = close === -1 ? body.length : close + 2
      continue
    }

    // Return statements in nested function/class bodies do not contribute to
    // the outer signature. Skip their balanced implementation blocks.
    const startsNestedDeclaration = (body.startsWith('function', i) && isWordBoundary(body, i, 8))
      || (body.startsWith('class', i) && isWordBoundary(body, i, 5))
    if (startsNestedDeclaration) {
      const blockStart = findNextCodeBlock(body, i)
      if (blockStart !== -1) {
        i = skipBalancedCodeBlock(body, blockStart)
        continue
      }
    }
    if (char === 61 && body.charCodeAt(i + 1) === 62) {
      const blockStart = skipCallableTrivia(body, i + 2)
      if (body.charCodeAt(blockStart) === 123) {
        i = skipBalancedCodeBlock(body, blockStart)
        continue
      }
    }

    if (body.startsWith('return', i)
      && (i === 0 || !isWordChar(body.charCodeAt(i - 1)))
      && !isWordChar(body.charCodeAt(i + 6))) {
      i += 6
      let sawLineBreak = false
      while (i < body.length && body.charCodeAt(i) <= 32) {
        const whitespace = body.charCodeAt(i)
        if (whitespace === 10 || whitespace === 13) sawLineBreak = true
        i++
      }

      if (sawLineBreak || i >= body.length || body.charCodeAt(i) === 59 || body.charCodeAt(i) === 125) {
        hasBareReturn = true
        continue
      }

      const expressionStart = i
      let parenDepth = 0
      let bracketDepth = 0
      let braceDepth = 0
      while (i < body.length) {
        const expressionChar = body.charCodeAt(i)
        if (expressionChar === 34 || expressionChar === 39 || expressionChar === 96) {
          i = skipQuotedValue(body, i, expressionChar)
          continue
        }
        if (expressionChar === 47 && body.charCodeAt(i + 1) === 47) {
          // A comment after the expression ends it. One inside it - a comment
          // line in a returned object literal - is skipped: ending there cut
          // \`return {\n  // section\n  a() {}\n}\` down to \`{\` and typed it unknown.
          if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) break
          while (i < body.length && body.charCodeAt(i) !== 10 && body.charCodeAt(i) !== 13) i++
          continue
        }
        if (expressionChar === 47 && body.charCodeAt(i + 1) === 42) {
          const close = body.indexOf('*/', i + 2)
          i = close === -1 ? body.length : close + 2
          continue
        }
        if (expressionChar === 40) parenDepth++
        else if (expressionChar === 41) parenDepth--
        else if (expressionChar === 91) bracketDepth++
        else if (expressionChar === 93) bracketDepth--
        else if (expressionChar === 123) braceDepth++
        else if (expressionChar === 125) {
          if (braceDepth === 0 && parenDepth === 0 && bracketDepth === 0) break
          braceDepth--
        }
        else if (expressionChar === 59 && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) break
        else if ((expressionChar === 10 || expressionChar === 13) && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
          let next = i + 1
          while (next < body.length && body.charCodeAt(next) <= 32) next++
          if (body.startsWith('return', next) && !isWordChar(body.charCodeAt(next + 6))) break
        }
        i++
      }

      const expression = body.slice(expressionStart, i).trim()
      // No comments in a return type: a returned literal's properties are not
      // defaults, and an inferred type is embedded in other JSDoc
      // (\`@defaultValue\`), where a nested \`*/\` ends the comment early.
      const inferred = withoutComments(inferBodyExpressionType(expression, parameterTypes, classExpression, assertedType, expressionStart))
      if (!returnTypes.includes(inferred)) returnTypes.push(inferred)
      continue
    }

    i++
  }

  if (hasBareReturn && !returnTypes.includes('undefined')) returnTypes.push('undefined')
  const returnType = returnTypes.includes('unknown')
    ? 'unknown'
    : returnTypes.length === 0 ? 'void' : joinReturnTypes(returnTypes)
  return isAsync && !returnType.startsWith('Promise<') ? `Promise<${returnType}>` : returnType
}

function collectParameterTypes(parameters: string, resolve?: (value: string) => string | undefined): Map<string, string> {
  const types = new Map<string, string>()
  const content = parameters.startsWith('(') && parameters.endsWith(')') ? parameters.slice(1, -1) : parameters
  const tokens = tokenizeDeclarationSyntax(content)
  let start = 0
  let depth = 0
  const parts: string[] = []
  for (const token of tokens) {
    const text = content.slice(token.start, token.end)
    if (text === ',' && depth === 0) { parts.push(content.slice(start, token.start)); start = token.end }
    if (['(', '[', '{', '<'].includes(text)) depth++
    else if ([')', ']', '}'].includes(text) || text === '>' && content[token.start - 1] !== '=') depth--
  }
  parts.push(content.slice(start))
  for (const part of parts) {
    const tokens = tokenizeDeclarationSyntax(part)
    let colon = -1
    let equal = -1
    let depth = 0
    for (const token of tokens) {
      const text = part.slice(token.start, token.end)
      if (depth === 0 && text === ':' && colon === -1) colon = token.start
      if (depth === 0 && text === '=' && part[token.end] !== '>') { equal = token.start; break }
      if (['(', '[', '{', '<'].includes(text)) depth++
      else if ([')', ']', '}'].includes(text) || text === '>' && part[token.start - 1] !== '=') depth--
    }
    const name = part.slice(0, colon !== -1 ? colon : equal !== -1 ? equal : undefined).trim().replace(/^\.\.\./, '').replace(/\?$/, '')
    // `{ ssl = true } = {}` binds each name to its own default's type.
    const binding = colon === -1 && equal !== -1 && !part.trim().startsWith('...') ? defaultedObjectBinding(name, part.slice(equal + 1)) : null
    if (binding) {
      for (const element of binding) types.set(element.alias, resolve?.(element.value) ?? inferNarrowType(element.value, false))
      continue
    }
    if (!isIdentifierName(name)) {
      // An unresolved parameter still belongs to this callable. Its local
      // binding must not become a query against an emitted module variable.
      if (name.startsWith('{') || name.startsWith('[')) {
        for (const binding of bindingPatternNames(name)) types.set(binding, 'unknown')
      }
      continue
    }
    let type = colon !== -1 ? part.slice(colon + 1, equal !== -1 ? equal : undefined).trim() : ''
    if (!type && equal !== -1) {
      const value = part.slice(equal + 1).trim()
      type = resolve?.(value) ?? inferNarrowType(value, false)
    }
    if (type) {
      // A default runs only for undefined. An optional parameter without one
      // remains possibly undefined inside the implementation.
      if (equal === -1 && part.slice(0, colon).trim().endsWith('?')) type = `(${type}) | undefined`
      types.set(name, type)
    }
    else types.set(name, 'unknown')
  }
  return types
}

/**
 * Methods of a primitive receiver whose result does not depend on arguments.
 * The native engine keeps the identical table (`primitiveMethodReturnType`).
 */
const PRIMITIVE_METHOD_RETURN_TYPES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  string: {
    at: 'string | undefined',
    charAt: 'string',
    charCodeAt: 'number',
    codePointAt: 'number | undefined',
    concat: 'string',
    endsWith: 'boolean',
    includes: 'boolean',
    indexOf: 'number',
    lastIndexOf: 'number',
    localeCompare: 'number',
    normalize: 'string',
    padEnd: 'string',
    padStart: 'string',
    repeat: 'string',
    replace: 'string',
    replaceAll: 'string',
    search: 'number',
    slice: 'string',
    split: 'string[]',
    startsWith: 'boolean',
    substring: 'string',
    toLocaleLowerCase: 'string',
    toLocaleUpperCase: 'string',
    toLowerCase: 'string',
    toString: 'string',
    toUpperCase: 'string',
    trim: 'string',
    trimEnd: 'string',
    trimStart: 'string',
    valueOf: 'string',
  },
  number: {
    toExponential: 'string',
    toFixed: 'string',
    toLocaleString: 'string',
    toPrecision: 'string',
    toString: 'string',
    valueOf: 'number',
  },
  bigint: {
    toLocaleString: 'string',
    toString: 'string',
    valueOf: 'bigint',
  },
  boolean: {
    toString: 'string',
    valueOf: 'boolean',
  },
}

/** The result of calling `method` on a value of a primitive keyword type, when it is fixed. */
export function primitiveMethodReturnType(receiver: string, method: string): string | undefined {
  const methods = Object.hasOwn(PRIMITIVE_METHOD_RETURN_TYPES, receiver) ? PRIMITIVE_METHOD_RETURN_TYPES[receiver] : undefined
  return methods && Object.hasOwn(methods, method) ? methods[method] : undefined
}

/**
 * A type embedded as a member of an object type literal (or class body) moves
 * one level in: each of its continuation lines gains two spaces, so nested
 * literals indent by level. Mirrored by the native engine (`indentNestedType`).
 */
export function indentNestedType(type: string): string {
  return type.includes('\n') ? type.replaceAll('\n', '\n  ') : type
}

/** Read a known object member without manufacturing a type for opaque shapes. */
function objectMemberType(type: string, name: string): string | undefined {
  type = type.trim()
  if (!type.startsWith('{') || !type.endsWith('}')) return undefined
  const content = type.slice(1, -1)
  const tokens = tokenizeDeclarationSyntax(content)
  let start = 0
  let depth = 0
  for (let index = 0; index <= tokens.length; index++) {
    const token = tokens[index]
    const text = token ? content.slice(token.start, token.end) : ';'
    if (depth === 0 && (text === ';' || text === ',')) {
      const member = content.slice(start, token?.start).trim()
      const colon = member.indexOf(':')
      if (colon !== -1 && member.slice(0, colon).trim() === name) return member.slice(colon + 1).trim()
      start = token?.end ?? content.length
    }
    if (['(', '[', '{', '<'].includes(text)) depth++
    else if ([')', ']', '}'].includes(text) || text === '>' && token && content[token.start - 1] !== '=') depth--
  }
  return undefined
}

function inferBodyExpressionType(expression: string, parameterTypes: ReadonlyMap<string, string>, classExpression?: (value: string) => string | undefined, assertedType?: (type: string, position: number) => string, position = 0, inferenceDepth = 0): string {
  if (inferenceDepth >= MAX_INFERENCE_DEPTH) return 'unknown'
  let value = expression.trim()
  while (hasBalancedOuterParentheses(value)) value = value.slice(1, -1).trim()
  const classType = classExpression?.(value)
  if (classType) return classType
  if (isJsxExpression(value)) return 'JSX.Element'
  if (value.startsWith('await ')) {
    const awaited = inferBodyExpressionType(value.slice(6), parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
    return awaited.startsWith('Promise<') && awaited.endsWith('>') ? awaited.slice(8, -1) : awaited
  }
  if (parameterTypes.has(value)) return parameterTypes.get(value)!
  const member = /^([\w$]+)\.([\w$]+(?:\.[\w$]+)*)$/.exec(value)
  let memberQuery: string | undefined
  if (member) {
    const type = parameterTypes.get(member[1])
    const property = type && objectMemberType(type, member[2])
    if (property) return property
    if (type) memberQuery = `typeof ${value}`
  }
  if (value.startsWith('!')) return 'boolean'
  if (value.startsWith('fetch(')) return 'Promise<Response>'

  // A callback's signature and body belong to that value, not to the
  // enclosing expression's comparison/conditional operators.
  if (isFunctionExpression(value)) return inferNarrowType(value, false)

  const conditional = splitTopLevelConditional(value)
  if (conditional) {
    const whenTrue = inferBodyExpressionType(conditional.whenTrue, parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
    const whenFalse = inferBodyExpressionType(conditional.whenFalse, parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
    return whenTrue === whenFalse ? whenTrue : joinReturnTypes([whenTrue, whenFalse])
  }

  // A cast belongs to its operand, rather than swallowing a following
  // runtime logical expression into a declaration's type text.
  for (const operator of ['??', '||', '&&']) {
    const index = topLevelLogicalOperator(value, operator)
    if (index !== -1) {
      const left = inferBodyExpressionType(value.slice(0, index), parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
      const right = inferBodyExpressionType(value.slice(index + operator.length), parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
      return logicalBodyType(left, right, operator)
    }
  }

  const assertion = wholeReturnAssertion(value)
  if (assertion && assertedType) return assertedType(assertion, position)

  if (hasTopLevelComparison(value)) return 'boolean'

  let depth = 0
  for (let i = value.length - 1; i >= 0; i--) {
    const char = value.charCodeAt(i)
    if (char === 41 || char === 93 || char === 125) depth++
    else if (char === 40 || char === 91 || char === 123) depth--
    else if (depth === 0 && (char === 43 || char === 45 || char === 42 || char === 47 || char === 37)) {
      const left = inferBodyExpressionType(value.slice(0, i), parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
      const right = inferBodyExpressionType(value.slice(i + 1), parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
      if (char === 43 && (left === 'string' || right === 'string')) return 'string'
      if (left === 'number' && right === 'number') return 'number'
      break
    }
  }

  if (value.startsWith('[') && value.endsWith(']')) {
    const elements = parseArrayElements(value.slice(1, -1))
    if (elements.some(element => element.trim().startsWith('...'))) {
      const types = elements.map((element) => {
        const item = element.trim()
        if (!item) return 'undefined'
        const spread = item.startsWith('...')
        const type = inferBodyExpressionType(spread ? item.slice(3) : item, parameterTypes, classExpression, assertedType, position, inferenceDepth + 1)
        return spread ? `(NonNullable<${type}> extends Iterable<infer Element> ? Element : never)` : type
      })
      return `(${[...new Set(types)].join(' | ') || 'never'})[]`
    }
  }

  const inferred = memberQuery ?? (value.startsWith('{') && value.endsWith('}')
    ? inferObjectType(value, false, inferenceDepth + 1, undefined, item => inferBodyExpressionType(item, parameterTypes, classExpression, assertedType, position, inferenceDepth + 1))
    : inferNarrowType(value, false))
  if (inferred === 'unknown' && isIdentifierName(value) && assertedType) return assertedType(`typeof ${value}`, position)
  const tokens = tokenizeDeclarationSyntax(inferred)
  let result = ''
  let cursor = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.kind !== 'word' || inferred.slice(token.start, token.end) !== 'typeof') continue
    const root = tokens[index + 1]
    if (!root || root.kind !== 'word') continue
    let type = parameterTypes.get(inferred.slice(root.start, root.end))
    const rootType = type
    const unresolved = !type
    let start = token.start
    let end = root.end
    const queryIndex = index
    const properties: string[] = []
    index++
    while (tokens[index + 1] && inferred.slice(tokens[index + 1].start, tokens[index + 1].end) === '.' && tokens[index + 2]?.kind === 'word') {
      const property = tokens[index + 2]
      properties.push(inferred.slice(property.start, property.end))
      if (!unresolved) type = `(${type})["${inferred.slice(property.start, property.end)}"]`
      end = property.end
      index += 2
    }
    const wrappedInReturnType = queryIndex >= 2
      && inferred.slice(tokens[queryIndex - 2].start, tokens[queryIndex - 2].end) === 'ReturnType'
      && inferred.slice(tokens[queryIndex - 1].start, tokens[queryIndex - 1].end) === '<'
      && tokens[index + 1] && inferred.slice(tokens[index + 1].start, tokens[index + 1].end) === '>'
    // A call on a primitive parameter: `value.toFixed(2)` is a string.
    const primitiveResult = rootType && wrappedInReturnType && properties.length === 1
      ? primitiveMethodReturnType(rootType.trim(), properties[0])
      : undefined
    if (primitiveResult) {
      start = tokens[queryIndex - 2].start
      end = tokens[++index].end
      const whole = start === 0 && end === inferred.length
      result += inferred.slice(cursor, start) + (whole || !primitiveResult.includes('|') ? primitiveResult : `(${primitiveResult})`)
      cursor = end
      continue
    }
    // Keep the enclosing object/tuple shape. An unresolved query alone is a
    // valid unknown property; a ReturnType over that query must collapse as
    // one node, rather than forming ReturnType<unknown> or unknown.member.
    if (unresolved && wrappedInReturnType) {
      start = tokens[queryIndex - 2].start
      end = tokens[++index].end
    }
    result += inferred.slice(cursor, start) + (type ?? 'unknown')
    cursor = end
  }
  return result + inferred.slice(cursor)
}

/** A complete assertion, excluding expression continuations and property names. */
function wholeReturnAssertion(value: string): string | undefined {
  const tokens = tokenizeDeclarationSyntax(value)
  let depth = 0
  let assertion = -1
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const text = value.slice(token.start, token.end)
    if (token.kind !== 'punctuation' && token.kind !== 'word') continue
    if (['(', '[', '{'].includes(text)) depth++
    else if ([')', ']', '}'].includes(text)) depth--
    else if (!depth && text === 'as' && index > 0 && value.slice(tokens[index - 1].start, tokens[index - 1].end) !== '.') assertion = index
  }
  if (assertion === -1 || assertion + 1 === tokens.length) return undefined
  const type = value.slice(tokens[assertion].end).trim()
  if (type === 'const') return undefined
  depth = 0
  for (const token of tokens.slice(assertion + 1)) {
    if (token.kind !== 'punctuation') continue
    const text = value.slice(token.start, token.end)
    if (!depth && ['??', '||', '&&'].some(operator => value.startsWith(operator, token.start))) return undefined
    if (['(', '[', '{', '<'].includes(text)) depth++
    else if ([')', ']', '}', '>'].includes(text)) depth--
    else if (!depth && ['+', '-', '*', '/', '%', '=', '!', ';'].includes(text)) return undefined
  }
  return type
}

/** Locate a logical value operator, excluding strings and nested expressions. */
function topLevelLogicalOperator(value: string, operator: string): number {
  let depth = 0
  for (const token of tokenizeDeclarationSyntax(value)) {
    if (token.kind !== 'punctuation') continue
    const text = value.slice(token.start, token.end)
    if (['(', '[', '{'].includes(text)) depth++
    else if ([')', ']', '}'].includes(text)) depth--
    if (!depth && value.startsWith(operator, token.start)) return token.start
  }
  return -1
}

/** Top-level members of a union type, or null when the text is not safely splittable. */
function unionMembers(type: string): string[] | null {
  // An arrow's `>` would unbalance the bracket count.
  if (type.includes('=>')) return null
  const members: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index <= type.length; index++) {
    const char = index === type.length ? '|' : type[index]
    if (char === '\'' || char === '"' || char === '`') {
      index++
      while (index < type.length && type[index] !== char) index += type[index] === '\\' ? 2 : 1
      if (index >= type.length) return null
    }
    else if (char === '(' || char === '[' || char === '{' || char === '<') { depth++ }
    else if (char === ')' || char === ']' || char === '}' || char === '>') { depth-- }
    else if (char === '|' && depth === 0) {
      const member = type.slice(start, index).trim()
      if (member) members.push(member)
      start = index + 1
    }
    if (depth < 0) return null
  }
  return depth === 0 ? members : null
}

/**
 * `first | second` with duplicate members removed and literals absorbed by
 * their own primitive (`true | false` and `true | boolean` are `boolean`).
 */
function logicalUnion(first: string, second: string): string {
  const split = unionMembers(second)
  if (!split) return `${first} | ${second}`
  const members: string[] = []
  for (const member of [first, ...split]) {
    if (member === 'unknown') return 'unknown'
    if (!members.includes(member)) members.push(member)
  }
  const hasBoolean = members.includes('boolean') || (members.includes('true') && members.includes('false'))
  const hasString = members.includes('string')
  const hasNumber = members.includes('number')
  const result: string[] = []
  let placedBoolean = false
  for (const member of members) {
    if (hasBoolean && (member === 'true' || member === 'false' || member === 'boolean')) {
      if (!placedBoolean) result.push('boolean')
      placedBoolean = true
    }
    else if (hasString && isQuotedLiteralType(member)) { continue }
    else if (hasNumber && /^-?\d+(?:\.\d+)?$/.test(member)) { continue }
    else { result.push(member) }
  }
  return result.join(' | ')
}

function isQuotedLiteralType(member: string): boolean {
  const quote = member[0]
  return member.length >= 2 && (quote === '\'' || quote === '"') && member.endsWith(quote) && !member.slice(1, -1).includes(quote)
}

/** Conditional types retain the operand's nullability and truthiness bounds. */
function logicalBodyType(left: string, rawRight: string, operator: string): string {
  // A function type is only a union member inside parentheses.
  const right = findMainArrowIndex(rawRight) !== -1 ? `(${rawRight.trim()})` : rawRight
  // The conditionals below are already decided for an `unknown` left operand:
  // `??` and `||` yield its non-nullish values (`{}`) or the right operand,
  // and `&&` yields `unknown`. Print that result instead of the conditional.
  if (left.trim() === 'unknown') return operator === '&&' || right.trim() === 'unknown' ? 'unknown' : `{} | ${right}`
  // They are decided for a plain primitive too: it is never nullish, so `??`
  // keeps it; `||` yields its truthy values or the right operand; `&&` yields
  // its one falsy value or the right operand.
  const primitive = left.trim()
  if (primitive === 'boolean' || primitive === 'string' || primitive === 'number') {
    if (operator === '??') return primitive
    const falsyValue = primitive === 'boolean' ? 'false' : primitive === 'string' ? `''` : '0'
    return logicalUnion(operator === '||' ? (primitive === 'boolean' ? 'true' : primitive) : falsyValue, right)
  }
  const falsy = "false | 0 | 0n | '' | null | undefined"
  if (operator === '??') return `([${left}] extends [NonNullable<${left}>] ? ${left} : NonNullable<${left}> | ${right})`
  if (operator === '||') return `([${left}] extends [object] ? ${left} : [Exclude<${left}, object> & (${falsy})] extends [never] ? ${left} : Exclude<NonNullable<${left}>, ${falsy}> | ${right})`
  return `([${left}] extends [object] ? ${right} : [${left}] extends [${falsy}] ? ${left} : unknown extends (${left}) ? ${left} : (Exclude<${left}, object> & (${falsy})) | ${right})`
}

/** Copied nullable fields become optional and lose their source readonly flag. */
function nullableSpreadType(left: string): string {
  const mutable = `(NonNullable<${left}> extends infer __dtsx_spread_value ? { -readonly [__dtsx_spread_key in keyof __dtsx_spread_value]: __dtsx_spread_value[__dtsx_spread_key] } : never)`
  const optional = `(NonNullable<${left}> extends infer __dtsx_spread_value ? { -readonly [__dtsx_spread_key in keyof __dtsx_spread_value]?: __dtsx_spread_value[__dtsx_spread_key] } : never)`
  return `([${left}] extends [null | undefined] ? {} : [${left}] extends [NonNullable<${left}>] ? ${mutable} : ${optional})`
}

function inferBodySpreadType(expression: string, resolve: (value: string) => string): string {
  let value = expression.trim()
  while (hasBalancedOuterParentheses(value)) value = value.slice(1, -1).trim()
  const index = topLevelLogicalOperator(value, '??')
  if (index !== -1 && value.slice(index + 2).trim() === '{}') return nullableSpreadType(resolve(value.slice(0, index)))
  const conditional = splitTopLevelConditional(value)
  if (conditional) {
    if (conditional.whenFalse.trim() === '{}') return `Partial<${resolve(conditional.whenTrue)}>`
    if (conditional.whenTrue.trim() === '{}') return `Partial<${resolve(conditional.whenFalse)}>`
  }
  return resolve(value)
}

/** Function members need parentheses at a union boundary. */
function joinReturnTypes(types: string[]): string {
  return types.map(type => types.length > 1 && findMainArrowIndex(type) !== -1 ? `(${type})` : type).join(' | ')
}

/** An expression without the comments before its first token and after its last. */
function withoutEdgeComments(value: string): string {
  let start = 0
  while (start < value.length) {
    const char = value.charCodeAt(start)
    if (char <= 32) start++
    else if (char === 47 && value.charCodeAt(start + 1) === 47) {
      start += 2
      while (start < value.length && value.charCodeAt(start) !== 10 && value.charCodeAt(start) !== 13) start++
    }
    else if (char === 47 && value.charCodeAt(start + 1) === 42) {
      const close = value.indexOf('*/', start + 2)
      start = close === -1 ? value.length : close + 2
    }
    else break
  }
  let codeEnd = start
  let i = start
  while (i < value.length) {
    const char = value.charCodeAt(i)
    if (char === 34 || char === 39 || char === 96) {
      i = skipQuotedValue(value, i, char)
      codeEnd = i
      continue
    }
    if (char === 92) {
      i = Math.min(i + 2, value.length)
      codeEnd = i
      continue
    }
    if (char === 47 && value.charCodeAt(i + 1) === 47) {
      while (i < value.length && value.charCodeAt(i) !== 10 && value.charCodeAt(i) !== 13) i++
      continue
    }
    if (char === 47 && value.charCodeAt(i + 1) === 42) {
      const close = value.indexOf('*/', i + 2)
      i = close === -1 ? value.length : close + 2
      continue
    }
    i++
    if (char > 32) codeEnd = i
  }
  return value.slice(start, codeEnd)
}

/** Whether a unary operator's operand is the whole remaining expression. */
function isUnaryOperand(value: string): boolean {
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '\'' || char === '"' || char === '`') {
      let j = i + 1
      while (j < value.length && value[j] !== char) {
        if (value[j] === '\\') j++
        j++
      }
      i = j
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth++
    else if (char === ')' || char === ']' || char === '}') depth--
    else if (depth !== 0) continue
    else if (char === '?') { if (value[i + 1] !== '.') return false }
    else if ('=!<>&|+-*/%,:'.includes(char)) return false
    else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      const rest = value.slice(i).trimStart()
      if (rest && rest[0] !== '.' && rest[0] !== '?' && rest[0] !== '(' && rest[0] !== '[') return false
    }
  }
  return true
}

/** Recognize a complete function value without consuming an outer conditional. */
function isFunctionExpression(value: string): boolean {
  if (value.startsWith('function') && isWordBoundary(value, 0, 8)) return true
  const arrow = findMainArrowIndex(value)
  if (arrow === -1) return false
  let header = value.slice(0, arrow).trim()
  if (header.startsWith('async') && isWordBoundary(header, 0, 5)) header = header.slice(5).trim()
  if (header.startsWith('<')) {
    const end = findMatchingBracket(header, 0, '<', '>')
    if (end === -1) return false
    header = header.slice(end + 1).trim()
  }
  if (header.startsWith('(')) {
    const close = findMatchingBracket(header, 0, '(', ')')
    if (close === -1) return false
    const suffix = header.slice(close + 1).trim()
    if (suffix && !suffix.startsWith(':')) return false
  }
  const signature = splitArrowSignature(header)
  return hasBalancedOuterParentheses(signature.params) || isIdentifierName(signature.params)
}

function hasBalancedOuterParentheses(value: string): boolean {
  if (!value.startsWith('(') || !value.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    if (char === 40) depth++
    else if (char === 41 && --depth === 0) return i === value.length - 1
  }
  return false
}

function splitTopLevelConditional(value: string): { whenTrue: string, whenFalse: string } | null {
  let depth = 0
  let question = -1
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    // Literal text and comments cannot hold the operator: `ok ? 'a:b' : 'c'`.
    if (char === 34 || char === 39 || char === 96) {
      i = skipQuotedValue(value, i, char) - 1
      continue
    }
    if (char === 47 && (value.charCodeAt(i + 1) === 47 || value.charCodeAt(i + 1) === 42)) {
      if (value.charCodeAt(i + 1) === 47) {
        while (i + 1 < value.length && value.charCodeAt(i + 1) !== 10 && value.charCodeAt(i + 1) !== 13) i++
      }
      else {
        const close = value.indexOf('*/', i + 2)
        i = close === -1 ? value.length : close + 1
      }
      continue
    }
    if (char === 40 || char === 91 || char === 123) depth++
    else if (char === 41 || char === 93 || char === 125) depth--
    else if (char === 63 && depth === 0 && value.charCodeAt(i + 1) !== 63) question = i
    else if (char === 58 && depth === 0 && question !== -1) {
      return { whenTrue: withoutEdgeComments(value.slice(question + 1, i)), whenFalse: withoutEdgeComments(value.slice(i + 1)) }
    }
  }
  return null
}

function isWordBoundary(value: string, start: number, length: number): boolean {
  return (start === 0 || !isWordChar(value.charCodeAt(start - 1)))
    && !isWordChar(value.charCodeAt(start + length))
}

function skipCallableTrivia(value: string, start: number): number {
  let index = start
  while (index < value.length) {
    if (value.charCodeAt(index) <= 32) { index++; continue }
    if (value.startsWith('//', index)) {
      while (index < value.length && value.charCodeAt(index) !== 10 && value.charCodeAt(index) !== 13) index++
      continue
    }
    if (value.startsWith('/*', index)) {
      const close = value.indexOf('*/', index + 2)
      index = close < 0 ? value.length : close + 2
      continue
    }
    break
  }
  return index
}

function findNextCodeBlock(value: string, start: number): number {
  let parens = 0
  let brackets = 0
  let angles = 0
  let annotation = false
  let expectsType = false
  for (let i = start; i < value.length; i++) {
    i = skipCallableTrivia(value, i)
    if (i >= value.length) break
    const char = value.charCodeAt(i)
    if (char === 34 || char === 39 || char === 96) {
      i = skipQuotedValue(value, i, char) - 1
      expectsType = false
      continue
    }
    if (isWordChar(char) || char >= 128) {
      const wordStart = i
      while (i + 1 < value.length && (isWordChar(value.charCodeAt(i + 1)) || value.charCodeAt(i + 1) >= 128)) i++
      expectsType = annotation && ['keyof', 'typeof', 'readonly', 'unique', 'new', 'abstract', 'infer', 'extends'].includes(value.slice(wordStart, i + 1))
      continue
    }
    if (char === 61 && value.charCodeAt(i + 1) === 62) { i++; expectsType = annotation; continue }
    if (char === 40) parens++
    else if (char === 41) { parens--; expectsType = false }
    else if (char === 91) brackets++
    else if (char === 93) { brackets--; expectsType = false }
    else if (char === 60 && parens === 0 && brackets === 0) angles++
    else if (char === 62 && angles > 0 && parens === 0 && brackets === 0) { angles--; expectsType = false }
    else if (char === 123) {
      if (parens || brackets || angles || annotation && expectsType) {
        i = skipBalancedCodeBlock(value, i) - 1
        expectsType = false
      }
      else return i
    }
    else if (parens === 0 && brackets === 0 && angles === 0) {
      if (char === 58) { annotation = true; expectsType = true }
      else if (annotation && [124, 38, 63].includes(char)) expectsType = true
      else if (char === 59) return -1
    }
  }
  return -1
}

function skipBalancedCodeBlock(value: string, start: number): number {
  let depth = 1
  let i = start + 1
  while (i < value.length && depth > 0) {
    const char = value.charCodeAt(i)
    if (char === 34 || char === 39 || char === 96) {
      i = skipQuotedValue(value, i, char)
      continue
    }
    if (char === 47 && value.charCodeAt(i + 1) === 47) {
      i += 2
      while (i < value.length && value.charCodeAt(i) !== 10 && value.charCodeAt(i) !== 13) i++
      continue
    }
    if (char === 47 && value.charCodeAt(i + 1) === 42) {
      const close = value.indexOf('*/', i + 2)
      i = close === -1 ? value.length : close + 2
      continue
    }
    if (char === 123) depth++
    else if (char === 125) depth--
    i++
  }
  return i
}

function skipQuotedValue(value: string, start: number, quote: number): number {
  let i = start + 1
  while (i < value.length) {
    const char = value.charCodeAt(i)
    if (char === 92) {
      i += 2
      continue
    }
    if (quote === 96 && char === 36 && value.charCodeAt(i + 1) === 123) {
      i = skipBalancedCodeBlock(value, i + 1)
      continue
    }
    i++
    if (char === quote) break
  }
  return i
}

/**
 * Infer type from template literal
 */
function inferTemplateLiteralType(value: string, isConst: boolean): string {
  // Handle tagged template literals like String.raw`...`
  if (value.includes('.raw`') || value.includes('String.raw`')) {
    return 'string'
  }

  if (!isConst || value.includes('${') || value.includes('\n') || value.includes('\r'))
    return 'string'

  return value
}

/**
 * Infer type from new expression
 */
function inferNewExpressionType(value: string): string {
  // Extract class name after 'new ' — must start with uppercase A-Z
  // Supports dotted names like Intl.NumberFormat
  let i = 4 // skip 'new '
  while (i < value.length && value.charCodeAt(i) <= 32) i++ // skip whitespace
  const nameStart = i
  const firstChar = value.charCodeAt(i)
  if (firstChar < 65 || firstChar > 90) return 'unknown' // must start with A-Z
  while (i < value.length && (isWordChar(value.charCodeAt(i)) || value.charCodeAt(i) === 46 /* . */)) i++
  if (i === nameStart) return 'unknown'
  const className = value.slice(nameStart, i)

  {
    const afterClass = value.slice(i)

    // Check for generic type parameters
    let afterGenerics = afterClass
    if (afterClass.startsWith('<')) {
      // Extract the generic params by finding the matching '>'
      let depth = 0
      let end = -1
      for (let j = 0; j < afterClass.length; j++) {
        if (afterClass[j] === '<') depth++
        else if (afterClass[j] === '>') { depth--; if (depth === 0) { end = j; break } }
      }
      if (end !== -1) {
        const generics = afterClass.slice(0, end + 1)
        afterGenerics = afterClass.slice(end + 1)
        // Check for method chain after constructor (e.g., new Foo<T>(...).method())
        // Find closing paren of constructor, then check for '.'
        const parenStart = afterGenerics.indexOf('(')
        if (parenStart !== -1) {
          let pDepth = 0
          let pEnd = -1
          for (let j = parenStart; j < afterGenerics.length; j++) {
            if (afterGenerics[j] === '(') pDepth++
            else if (afterGenerics[j] === ')') { pDepth--; if (pDepth === 0) { pEnd = j; break } }
          }
          if (pEnd !== -1) {
            const rest = afterGenerics.slice(pEnd + 1).trimStart()
            if (rest.startsWith('.')) return 'unknown' // method chain — can't infer
          }
        }
        return `${className}${generics}`
      }
    }

    // Check for method chain after constructor (e.g., new Foo(...).method())
    const parenStart = afterGenerics.indexOf('(')
    if (parenStart !== -1) {
      let pDepth = 0
      let pEnd = -1
      for (let j = parenStart; j < afterGenerics.length; j++) {
        if (afterGenerics[j] === '(') pDepth++
        else if (afterGenerics[j] === ')') { pDepth--; if (pDepth === 0) { pEnd = j; break } }
      }
      if (pEnd !== -1) {
        const rest = afterGenerics.slice(pEnd + 1).trimStart()
        if (rest.startsWith('.')) return 'unknown' // method chain — can't infer
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
 * Infer the type of a class expression used as a value.
 *
 * Both the named and the anonymous form get a constructor type, because a
 * class expression's name is bound only inside its own body:
 *
 *     export const Constructor = class Named { value = 1 }
 *
 * `Named` is a real binding within the class — it is how the class refers to
 * itself — but it is not in scope anywhere else, and it is not something the
 * declaration file can name. Emitting `typeof Named` produced a `.d.ts` that
 * referenced an identifier it never declared, so every consumer resolved
 * `Constructor` to an error type. The declaration-validation pass reports that
 * now, which is how this was found.
 *
 * A class *declaration* is a different thing and keeps its name; this is only
 * reached for expressions.
 */
function inferClassExpressionType(_value: string): string {
  return '{ new (...args: any[]): any }'
}

/**
 * Infer type from Promise expression
 */
function inferPromiseType(value: string, isConst: boolean, _depth: number = 0, keyConstants?: KeyConstants): string {
  if (value.startsWith('Promise.resolve(')) {
    // Extract argument between parens using indexOf
    const openIdx = 16 // length of 'Promise.resolve('
    const closeIdx = value.indexOf(')', openIdx)
    if (closeIdx !== -1) {
      const arg = value.slice(openIdx, closeIdx).trim()
      if (arg) {
        const argType = inferNarrowType(arg, isConst, false, _depth + 1, keyConstants)
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
      const elementTypes: string[] = []
      for (let i = 0; i < elements.length; i++) {
        const trimmed = elements[i].trim()
        if (trimmed.startsWith('Promise.resolve(')) {
          const promiseType = inferPromiseType(trimmed, isConst, _depth + 1, keyConstants)
          // Extract inner type from Promise<T> using indexOf
          const ltIdx = promiseType.indexOf('<')
          const gtIdx = promiseType.lastIndexOf('>')
          elementTypes.push((ltIdx !== -1 && gtIdx > ltIdx) ? promiseType.slice(ltIdx + 1, gtIdx) : 'unknown')
        }
        else {
          elementTypes.push(inferNarrowType(trimmed, isConst, false, _depth + 1, keyConstants))
        }
      }
      return `Promise<[${elementTypes.join(', ')}]>`
    }
    return 'Promise<unknown[]>'
  }
  return 'Promise<unknown>'
}

/**
 * Infer array type from array literal
 */
export function inferArrayType(value: string, isConst: boolean, _depth: number = 0, keyConstants?: KeyConstants): string {
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
    const elementTypes: string[] = []
    for (let ei = 0; ei < elements.length; ei++) {
      const trimmedEl = elements[ei].trim()
      if (trimmedEl.endsWith('as const')) {
        const withoutAsConst = trimmedEl.slice(0, -8).trim()
        // For arrays with 'as const', create readonly tuple
        if (withoutAsConst.startsWith('[') && withoutAsConst.endsWith(']')) {
          const innerContent = withoutAsConst.slice(1, -1).trim()
          const innerElements = parseArrayElements(innerContent)
          const innerTypes: string[] = []
          for (let j = 0; j < innerElements.length; j++) {
            innerTypes.push(inferNarrowType(innerElements[j].trim(), true, false, _depth + 1, keyConstants))
          }
          elementTypes.push(`readonly [${innerTypes.join(', ')}]`)
        }
        else {
          elementTypes.push(inferNarrowType(withoutAsConst, true, false, _depth + 1, keyConstants))
        }
      }
      else if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
        elementTypes.push(inferArrayType(trimmedEl, true, _depth + 1, keyConstants))
      }
      else {
        elementTypes.push(inferNarrowType(trimmedEl, true, false, _depth + 1, keyConstants))
      }
    }
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
    if (trimmedEl.startsWith('...')) {
      const spreadValue = trimmedEl.slice(3).trim()
      const spreadType = inferNarrowType(spreadValue, false, false, _depth + 1, keyConstants)
      if (spreadType.endsWith('[]')) elementTypes.push(spreadType.slice(0, -2))
      else if (spreadType.startsWith('readonly [') && spreadType.endsWith(']')) elementTypes.push(spreadType.slice(10, -1))
      else if (isEntityName(spreadValue)) elementTypes.push(`(typeof ${spreadValue})[number]`)
      else elementTypes.push('unknown')
    }
    else if (trimmedEl.startsWith('[') && trimmedEl.endsWith(']')) {
      elementTypes.push(inferArrayType(trimmedEl, isConst, _depth + 1, keyConstants))
    }
    else {
      elementTypes.push(inferNarrowTypeInUnion(trimmedEl, isConst, _depth + 1, keyConstants))
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
          const cleanType = inferNarrowType(te, false, false, 0, keyConstants)
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

  // Single-pass: deduplicate types with Set (O(1) lookup) AND check if all are literals
  const seenTypes = new Set<string>()
  const uniqueTypes: string[] = []
  let allLiterals = true
  for (const t of elementTypes) {
    // O(1) dedup check via Set
    if (!seenTypes.has(t)) {
      seenTypes.add(t)
      uniqueTypes.push(t)
    }
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
  let depth = 0
  let inString = false
  let stringChar = 0
  // Comments are trivia: they never split elements and are trimmed from both
  // ends of an element (`'a', // note` is the element `'a'`).
  let start = -1 // first code character of the current element
  let end = 0 // one past its last code character

  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i)
    if (inString) {
      if (c === 92) i++ // backslash escape
      else if (c === stringChar) inString = false
      end = i + 1
      continue
    }
    if (c === 47 && content.charCodeAt(i + 1) === 47) { // line comment
      const newline = content.indexOf('\n', i + 2)
      i = (newline === -1 ? content.length : newline) - 1
      continue
    }
    if (c === 47 && content.charCodeAt(i + 1) === 42) { // block comment
      const close = content.indexOf('*/', i + 2)
      i = (close === -1 ? content.length : close + 2) - 1
      continue
    }
    if (c === 32 || c === 9 || c === 10 || c === 13) continue
    if (c === 44 && depth === 0) { // ,
      if (start !== -1) elements.push(content.slice(start, end))
      start = -1
      continue
    }
    if (c === 34 || c === 39 || c === 96) { // double, single, backtick
      inString = true
      stringChar = c
    }
    else if (c === 91 || c === 123 || c === 40) depth++ // [ { (
    else if (c === 93 || c === 125 || c === 41) depth-- // ] } )
    if (start === -1) start = i
    end = i + 1
  }
  if (start !== -1) elements.push(content.slice(start, end))

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

/**
 * The comments that open a parameter's source text (`/** doc *\/ public x = 1`),
 * in order. Mirrored by the native engine.
 */
export function leadingSourceComments(text: string): string[] {
  const comments: string[] = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && text.charCodeAt(index) <= 32) index++
    if (text.startsWith('/*', index)) {
      const close = text.indexOf('*/', index + 2)
      if (close === -1) break
      comments.push(text.slice(index, close + 2))
      index = close + 2
    }
    else if (text.startsWith('//', index)) {
      let end = index
      while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) end++
      comments.push(text.slice(index, end).trimEnd())
      index = end
    }
    else {
      break
    }
  }
  return comments
}

/**
 * The doc block a class field (or constructor parameter property) gets for its
 * initializer: `@defaultValue` exactly as a widened object-literal property
 * gets it, merged with the member's own doc comment the way a variable's is.
 * Each line carries the two-space class member indent. Empty when the field
 * gets no `@defaultValue`. Mirrored by the native engine.
 */
export function classFieldDefaultDoc(comments: readonly string[] | undefined, initializer: string, type: string): string {
  const raw = initializer.trim()
  if (!isBaseType(type) || !isPrimitiveLiteral(raw)) return ''
  // Doc comments only: a plain `/* note */` is not documentation to merge into.
  const existing = (comments ?? []).map(comment => comment.trim()).filter(comment => comment.startsWith('/**') || comment.startsWith('//')).join('\n')
  let doc: string
  if (existing.includes('@defaultValue')) {
    doc = existing
  }
  else {
    const tag = `@defaultValue ${escapeJsdocContent(raw)}`
    if (!existing) {
      doc = `/** ${tag} */`
    }
    else {
      const closing = existing.lastIndexOf('*/')
      if (closing !== -1) {
        let before = existing.slice(0, closing).trimEnd()
        // A single-line `/** text` opens onto its own line, as for variables.
        if (before.startsWith('/** ') && !before.includes('\n')) before = `/**\n * ${before.slice(4)}`
        doc = `${before}\n * ${tag}\n */`
      }
      else {
        const text = existing.startsWith('// ') ? existing.slice(3) : existing.startsWith('//') ? existing.slice(2) : existing
        doc = `/**\n * ${text}\n * ${tag}\n */`
      }
    }
  }
  return doc.split('\n').map((line) => {
    const content = line.trim()
    if (!content) return ''
    return content.startsWith('*') ? `   ${content}` : `  ${content}`
  }).join('\n') + '\n'
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
    if (c === 34 || c === 39 || c === 96) { // ' " `
      inStr = true
      strCh = c
      continue
    }
    // Check for '=>'
    if (c === 61 /* = */ && i + 1 < len && val.charCodeAt(i + 1) === 62 /* > */) return false
    // A comment would be collapsed into the default text; rebuild from elements.
    if (c === 47 /* / */ && (val.charCodeAt(i + 1) === 47 || val.charCodeAt(i + 1) === 42)) return false
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
export function inferObjectType(value: string, isConst: boolean, _depth: number = 0, keyConstants?: KeyConstants, resolve?: (value: string) => string): string {
  // Remove braces
  const content = value.slice(1, -1).trim()

  if (!content)
    return '{}'

  if (_depth >= MAX_INFERENCE_DEPTH)
    return 'Record<string, unknown>'

  // Parse object properties
  const properties = parseObjectProperties(content)
  const getterNames = new Set(properties.flatMap(([key]) => {
    const accessor = matchAccessorKey(splitLeadingCommentsFromKey(key).key)
    return accessor?.kind === 'get' ? [accessor.name] : []
  }))
  const propTypes: string[] = []
  const spreadTypes: string[] = []
  const propertyTypes: string[] = []
  let stringIndex = false

  // Track whether we should build a clean default inline
  const trackDefaults = _collectCleanDefault && !isConst
  const cleanProps: string[] = []
  // Function entries only repeat their signatures from the type.
  let functionProps = 0

  for (const [key, val] of properties) {
    const { comments: keyComments, key: propertyKey } = splitLeadingCommentsFromKey(key)
    const commentPrefix = keyComments ? `${keyComments}\n  ` : ''
    const accessor = matchAccessorKey(propertyKey)
    // TypeScript omits interpolated computed accessors rather than assigning
    // them a literal name or an index signature. Preserve that public shape.
    if (accessor && hasTemplateSubstitution(accessor.name)) continue
    // The key actually emitted: a generic method shorthand (`merge<T, U>(…)`)
    // has its type parameters moved onto the function type, see below.
    let emitKey = propertyKey
    let wasMethodShorthand = false

    if (propertyKey === '...') {
      const spreadValue = val.trim()
      const spreadType = resolve ? inferBodySpreadType(spreadValue, resolve) : isEntityName(spreadValue)
        ? `typeof ${spreadValue}`
        : inferNarrowType(spreadValue, isConst, false, _depth + 1, keyConstants)
      if (spreadType !== 'unknown') spreadTypes.push(spreadType)
      if (trackDefaults && (isEntityName(spreadValue) || spreadValue.startsWith('{'))) cleanProps.push(`...${collapseWhitespace(spreadValue)}`)
      continue
    }

    // Save/restore nested clean default around recursive calls
    const saved = _cleanDefaultResult
    _cleanDefaultResult = null

    let valueType: string
    const trimVal = val.trim()

    // Mutable properties widen fresh literals; const assertions and explicitly
    // annotated literal bindings retain their identity.
    if (trimVal === propertyKey && isIdentifierName(trimVal)) {
      valueType = resolve?.(val) ?? (isConst ? undefined : keyConstants?.mutableBindingTypes?.get(trimVal)) ?? `typeof ${trimVal}`
    }
    // Method definitions (method shorthand syntax) — convert directly to function type
    // to avoid double-processing through inferNarrowType which loses return type info
    else if (isMethodDefinition(trimVal)) {
      wasMethodShorthand = true
      // A generic method shorthand (`merge<T, U>(…)`) parses with its type
      // parameters glued to the key. Move them onto the function type —
      // `merge: <T, U>(…) => …` is valid, `merge<T, U>: (…) => …` is not.
      const genericKey = splitKeyTypeParameters(propertyKey)
      if (genericKey) {
        emitKey = genericKey.name
        // Keep any `async`/`*` modifiers (moved onto the value by the property
        // parser) in front of the re-attached type parameters.
        let modifiers = ''
        if (trimVal.startsWith('async ')) modifiers = 'async '
        if (trimVal.charCodeAt(modifiers.length) === 42 /* * */) modifiers += '*'
        valueType = convertMethodToFunctionType(genericKey.name, modifiers + genericKey.typeParams + trimVal.slice(modifiers.length))
      }
      else {
        valueType = convertMethodToFunctionType(propertyKey, trimVal)
      }
    }
    else {
      valueType = resolve?.(val) ?? inferNarrowType(val, isConst, false, _depth + 1, keyConstants)

      // A property naming another binding (`driver: paymentDriver`,
      // `webhook: manage.webhook`) has that binding's type, exactly as the
      // shorthand above does. Literals such as `undefined` are typed before
      // this is reached; anything else left unknown is a reference.
      if (valueType === 'unknown' && isEntityName(trimVal))
        valueType = (isConst ? undefined : keyConstants?.mutableBindingTypes?.get(trimVal)) ?? `typeof ${trimVal}`

      // Handle method signatures - clean up async and parameter defaults
      if (valueType.includes('=>') || valueType.includes('function') || valueType.includes('async')) {
        valueType = cleanMethodSignature(valueType)
      }
    }

    const nestedDefault = _cleanDefaultResult
    _cleanDefaultResult = saved
    const sourceKey = emitKey
    const rawVal = val.trim()
    const templateKey = resolveTemplateKey(emitKey, keyConstants)
    if (!isSymbolKey(accessor?.name ?? emitKey, keyConstants) && !(accessor?.kind === 'set' && getterNames.has(accessor.name)))
      propertyTypes.push(accessor ? accessorValueType(accessor.kind, valueType) : valueType)
    if (templateKey && 'index' in templateKey) stringIndex = true
    else {
      if (templateKey && 'name' in templateKey) emitKey = templateKey.name

      // Getter/setter shorthand — `{ get X() {…} }` parses with a key of
      // "get X" and a value that converts into `() => T`. Emitted as a
      // regular property that becomes `get X: () => T`, which is invalid
      // TS. Reshape into proper accessor signatures (`get X(): T` and
      // `set X(arg: T): void`). See stacksjs/dtsx#3093.
      if (accessor) {
        const sig = formatAccessor(accessor.kind, accessor.name, valueType)
        if (sig) {
          propTypes.push(`${commentPrefix}${indentNestedType(sig)}`)
          // Accessors don't carry @defaultValue; skip the trackDefaults block below.
          continue
        }
      }

      if (!isConst && isBaseType(valueType) && isPrimitiveLiteral(rawVal)) {
        propTypes.push(`${commentPrefix}/** @defaultValue ${escapeJsdocContent(rawVal)} */\n  ${emitKey}: ${indentNestedType(valueType)}`)
      }
      else {
        propTypes.push(`${commentPrefix}${isConst ? 'readonly ' : ''}${emitKey}: ${indentNestedType(valueType)}`)
      }
    }

    // Build clean default inline (same pass, no re-parse)
    // Strip block/JSDoc comments from key to prevent nested */ in @defaultValue code blocks
    if (trackDefaults) {
      const cleanKey = stripBlockComments(sourceKey)
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
      else if (wasMethodShorthand) {
        // Reuse the converted function type: re-inferring from the raw method
        // shorthand loses the parameter list and the generic parameters.
        // Collapsed with cleanMethodSignature, which separates object-type
        // members it joins onto one line (`{ a?: string; b?: number }`).
        cleanProps.push(`${cleanKey}: ${withoutComments(cleanMethodSignature(valueType))}`)
        functionProps++
      }
      else if (!rawVal.startsWith('[') && (rawVal.includes('=>') || rawVal.startsWith('function') || rawVal.startsWith('async'))) {
        const fnType = inferFunctionType(rawVal, false, 0, true)
        cleanProps.push(`${cleanKey}: ${withoutComments(fnType)}`)
        functionProps++
      }
    }
  }

  // Store the clean default result
  // A block of function signatures alone repeats the type: no default.
  if (trackDefaults && cleanProps.length > functionProps) {
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

  // Spread inference preserves named fields and omits unknown computed names;
  // it does not synthesize a string index as a plain object literal does.
  if (stringIndex && spreadTypes.length === 0) {
    const members = [...new Set(propertyTypes)].map(type => type.includes('=>') || type.includes(' & ') ? `(${type})` : type)
    propTypes.unshift(`${isConst ? 'readonly ' : ''}[x: string]: ${indentNestedType(members.join(' | '))}`)
  }
  const ownType = propTypes.length > 0 ? `{\n  ${propTypes.join(';\n  ')}\n}` : '{}'
  if (spreadTypes.length === 0) return ownType

  let mergedType = spreadTypes[0]
  for (let i = 1; i < spreadTypes.length; i++) {
    mergedType = `Omit<${mergedType}, keyof ${spreadTypes[i]}> & ${spreadTypes[i]}`
  }
  return propTypes.length > 0 ? `Omit<${mergedType}, keyof ${ownType}> & ${ownType}` : mergedType
}

function isIdentifierName(value: string): boolean {
  if (!value) return false
  const first = value.charCodeAt(0)
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122) || first === 95 || first === 36 || first > 127)) return false
  for (let i = 1; i < value.length; i++) {
    if (!isWordChar(value.charCodeAt(i))) return false
  }
  return true
}

function isEntityName(value: string): boolean {
  const parts = value.split('.')
  return parts.length > 0 && parts.every(isIdentifierName)
}

/**
 * Index of the `(` that opens a call's argument list.
 *
 * Not `indexOf('(')`: type arguments can contain parentheses of their own, as in
 * `k<{ go: (p: string) => void }>('a')`. Taking the first `(` there lands inside
 * the type argument, the call then looks unbalanced, and the caller falls
 * through to arrow-function inference — which emits a signature truncated at
 * that paren (`(k<{ go: (p: string)) => unknown`). So skip balanced `<...>`
 * regions before looking for the call.
 *
 * An unbalanced `<` is a comparison operator rather than type arguments
 * (`a < b(c)`), so it is left to scan past as an ordinary character.
 */
function findCallParenIndex(value: string): number {
  let inString = false
  let quote = ''

  for (let i = 0; i < value.length; i++) {
    const char = value[i]

    if (inString) {
      if (char === '\\') i++
      else if (char === quote) inString = false
      continue
    }

    if (char === '"' || char === '\'' || char === '`') {
      inString = true
      quote = char
      continue
    }

    if (char === '(') return i

    if (char === '<') {
      const end = findMatchingBracket(value, i, '<', '>')
      if (end !== -1) i = end
    }
  }

  return -1
}

/** Infer calls whose callee can be referenced safely from declaration syntax. */
export function inferCallType(value: string): string | null {
  if (value.length < 3 || !value.endsWith(')')) return null
  const open = findCallParenIndex(value)
  if (open === -1 || findMatchingBracket(value, open, '(', ')') !== value.length - 1) return null

  let callee = value.slice(0, open).trim()
  let isOptional = false
  if (callee.endsWith('?.')) {
    isOptional = true
    callee = callee.slice(0, -2).trim()
  }

  let entity = callee
  let hasTypeArguments = false
  const genericStart = callee.indexOf('<')
  if (genericStart !== -1) {
    const genericEnd = findMatchingBracket(callee, genericStart, '<', '>')
    if (genericEnd !== callee.length - 1) return null
    entity = callee.slice(0, genericStart).trim()
    hasTypeArguments = true
  }
  if (!isEntityName(entity)) return null

  const argumentsText = value.slice(open + 1, -1).trim()
  const hasInlineFunction = findMainArrowIndex(argumentsText) !== -1
    || argumentsText.startsWith('function')
    || argumentsText.startsWith('async function')
  const hasReferenceArgument = isEntityName(argumentsText)
  const hasNestedCall = !hasInlineFunction && argumentsText.endsWith(')') && inferCallType(argumentsText) !== null
  const dot = entity.indexOf('.')
  if (dot !== -1) {
    if (entity.indexOf('.', dot + 1) !== -1) return null
  }
  else if (!hasTypeArguments && !isOptional && !hasInlineFunction && !hasReferenceArgument && !hasNestedCall) return null

  const type = `ReturnType<typeof ${callee}>`
  return isOptional ? `${type} | undefined` : type
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
      else if (ch === 41 || ch === 93 || ch === 125 || (ch === 62 && trimmedInner.charCodeAt(i - 1) !== 61)) d--
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
    // Skip block and line comments — JSDoc prose can contain unmatched
    // quote chars (e.g. apostrophe in "error's") that would otherwise
    // trip the scanner into a string-literal mode it never escapes.
    if (ch === 47 /* / */ && i + 1 < trimmedInner.length) {
      const nc = trimmedInner.charCodeAt(i + 1)
      if (nc === 42 /* * */) {
        i += 2
        while (i + 1 < trimmedInner.length && !(trimmedInner.charCodeAt(i) === 42 && trimmedInner.charCodeAt(i + 1) === 47)) i++
        i++ // position on closing '/'; loop's i++ moves past
        continue
      }
      if (nc === 47) {
        while (i < trimmedInner.length && trimmedInner.charCodeAt(i) !== 10) i++
        continue
      }
    }
    if (ch === 39 || ch === 34 || ch === 96) { inStr = true; strCh = ch; continue }
    if (ch === 40 || ch === 60 || ch === 91 || ch === 123) depth++
    else if (ch === 41 || ch === 93 || ch === 125 || (ch === 62 && trimmedInner.charCodeAt(i - 1) !== 61)) depth--
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

  return normalizeDefaultParameterOrder(hadParens ? `(${result})` : result)
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
    // Skip block and line comments before string-mode detection so JSDoc
    // apostrophes (e.g. "error's") don't trigger an unclosed string.
    if (ch === 47 /* / */ && i + 1 < param.length) {
      const nc = param.charCodeAt(i + 1)
      if (nc === 42 /* * */) {
        i += 2
        while (i + 1 < param.length && !(param.charCodeAt(i) === 42 && param.charCodeAt(i + 1) === 47)) i++
        i++
        continue
      }
      if (nc === 47) {
        while (i < param.length && param.charCodeAt(i) !== 10) i++
        continue
      }
    }
    if (ch === 39 || ch === 34 || ch === 96) { inStr = true; strCh = ch; continue }
    if (ch === 40 || ch === 60 || ch === 91 || ch === 123) depth++
    else if (ch === 41 || ch === 93 || ch === 125 || (ch === 62 && param.charCodeAt(i - 1) !== 61)) depth--
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
    const binding = defaultedObjectBinding(name, param.slice(equalIdx + 1))
    if (binding) return defaultedObjectBindingParameter(binding, simpleDefaultType)
    const optionalMarker = !name.endsWith('?') ? '?' : ''
    return `${name}${optionalMarker}: ${simpleDefaultType(param.slice(equalIdx + 1))}`
  }

  // No default, return as-is
  return param
}

/** A type guessed from a parameter default's literal form. */
function simpleDefaultType(value: string): string {
  const defaultVal = value.trim()
  if (defaultVal === 'true' || defaultVal === 'false') return 'boolean'
  if (isNumericLiteral(defaultVal)) return 'number'
  if ((defaultVal.startsWith('\'') && defaultVal.endsWith('\'')) || (defaultVal.startsWith('"') && defaultVal.endsWith('"'))) return 'string'
  if (defaultVal.startsWith('[')) return 'unknown[]'
  if (defaultVal.startsWith('{')) return 'Record<string, unknown>'
  return 'unknown'
}

/**
 * Find the index after any leading block comments and whitespace in a key.
 * Used to locate the actual identifier so modifiers like `async` can be
 * detected even when JSDoc precedes the method name.
 */
function findIdentifierStart(key: string): number {
  let i = 0
  const n = key.length
  while (i < n) {
    // Skip whitespace
    while (i < n && (key.charCodeAt(i) === 32 || key.charCodeAt(i) === 9 || key.charCodeAt(i) === 10 || key.charCodeAt(i) === 13)) i++
    // Skip /* ... */ block comments (handles nested */ since dtsx-stripped)
    if (i + 1 < n && key.charCodeAt(i) === 47 && key.charCodeAt(i + 1) === 42) {
      i += 2
      while (i + 1 < n && !(key.charCodeAt(i) === 42 && key.charCodeAt(i + 1) === 47)) i++
      i += 2 // skip the closing '*/'
      continue
    }
    break
  }
  return i
}

function splitLeadingCommentsFromKey(key: string): { comments: string, key: string } {
  const comments: string[] = []
  let i = 0
  const n = key.length

  while (i < n) {
    while (i < n && key.charCodeAt(i) <= 32) i++

    if (i + 1 >= n || key.charCodeAt(i) !== 47 || key.charCodeAt(i + 1) !== 42)
      break

    const start = i
    i += 2
    while (i + 1 < n && !(key.charCodeAt(i) === 42 && key.charCodeAt(i + 1) === 47)) i++
    i = Math.min(i + 2, n)
    comments.push(key.slice(start, i).trim())
  }

  return {
    comments: comments.join('\n'),
    key: key.slice(i).trim(),
  }
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
  let arrowParameterListClosed = false
  let inArrowReturnType = false
  let typeArgumentDepth = 0
  // True while collecting the value of a method shorthand (between the
  // method's '(' and the body's closing '}').
  let inMethodShorthand = false
  // True between the closing ')' of a method shorthand's params and its body '{'.
  // While true, commas at depth 0 belong to the return-type annotation
  // (e.g. `Promise<Record<string, X>>`) and must not split properties.
  let methodAwaitingBody = false

  for (let i = 0; i < content.length; i++) {
    const cc = content.charCodeAt(i)
    const prevCode = i > 0 ? content.charCodeAt(i - 1) : 0
    const nextCode = i < content.length - 1 ? content.charCodeAt(i + 1) : 0

    // Track single-line comments — skip to end of line
    if (!inString && !inComment && cc === 47 /* / */ && nextCode === 47 /* / */) {
      // Skip the comment but not the newline that ends it: the loop's own
      // increment used to step over it as well, so in a multi-line value
      // (\`id?: string // note\\n  column?: string\`) the next member joined the
      // same line and the declaration no longer parsed.
      current = current.replace(/[ \t]+$/, '')
      i += 2 // Skip '//'
      while (i < content.length && content.charCodeAt(i) !== 10 /* \n */) i++
      i--
      continue
    }

    // Track JSDoc/block comments to avoid parsing colons inside them
    if (!inString && !inComment && cc === 47 /* / */ && nextCode === 42 /* * */) {
      // Enter block/JSDoc comment, preserve opening delimiter
      inComment = true
      commentDepth = 1
      current += '/*'
      i++ // Skip '*'
      continue
    }
    else if (inComment && cc === 42 /* * */ && nextCode === 47 /* / */) {
      // Closing a block/JSDoc comment, preserve closing delimiter
      commentDepth--
      current += '*/'
      i++ // Skip '/'
      if (commentDepth === 0) {
        inComment = false
      }
      continue
    }
    else if (inComment && cc === 47 /* / */ && nextCode === 42 /* * */) {
      // Nested comment start, preserve and increase depth
      commentDepth++
      current += '/*'
      i++
      continue
    }

    const char = content[i]
    // Not inside a comment: an apostrophe in a property's JSDoc ("Stripe's")
    // opened a string that never closed, and every property after it was lost.
    if (!inString && !inComment && (cc === 34 /* " */ || cc === 39 /* ' */ || cc === 96 /* ` */)) {
      inString = true
      stringChar = char
      current += char
    }
    else if (inString && char === stringChar && prevCode !== 92 /* \\ */) {
      inString = false
      current += char
    }
    else if (!inString && !inComment) {
      if (cc === 46 /* . */ && nextCode === 46 && content.charCodeAt(i + 2) === 46 && depth === 0 && inKey) {
        // Spread operands are expressions, including parenthesized casts and
        // calls, rather than shorthand method parameter lists.
        currentKey = `${current.trim()}...`
        current = ''
        inKey = false
        inMethodShorthand = false
        i += 2
      }
      else if (cc === 40 /* ( */ && depth === 0 && inKey && typeArgumentDepth === 0) {
        // Method definition like: methodName(params) or async methodName<T>(params).
        // Must be checked BEFORE general bracket tracking so ( isn't swallowed.
        currentKey = current.trim()
        // The key may carry leading JSDoc/block comments. Split off the
        // comment block so `async`/`*` modifiers right before the
        // identifier can still be detected and stripped.
        const idStart = findIdentifierStart(currentKey)
        const commentLead = idStart > 0 ? currentKey.slice(0, idStart) : ''
        let identifier = currentKey.slice(idStart)
        let methodPrefix = ''
        if (identifier.startsWith('async ') || identifier.startsWith('async\t') || identifier.startsWith('async\n')) {
          identifier = identifier.slice(6).trimStart()
          methodPrefix = 'async '
        }
        if (identifier.startsWith('*')) {
          identifier = identifier.slice(1).trimStart()
          methodPrefix += '*'
        }
        currentKey = commentLead + identifier
        current = methodPrefix + char // Start with any prefix + opening parenthesis
        inKey = false
        inMethodShorthand = true
        methodAwaitingBody = false
        depth = 1 // We're now inside the method definition's params
      }
      else if (cc === 123 /* { */ || cc === 91 /* [ */ || cc === 40 /* ( */) {
        depth++
        current += char
        // Body '{' of a method shorthand — type annotation phase ends here.
        if (methodAwaitingBody && cc === 123 /* { */) {
          methodAwaitingBody = false
        }
      }
      else if (cc === 125 /* } */ || cc === 93 /* ] */ || cc === 41 /* ) */) {
        depth--
        current += char
        if (cc === 41 /* ) */ && depth === 0 && !inKey && !inMethodShorthand) {
          arrowParameterListClosed = true
        }
        if (inMethodShorthand) {
          // Closing ')' of params at depth 0 → enter return-type annotation
          // phase (commas in `Record<K, V>` etc must not split properties).
          if (cc === 41 /* ) */ && depth === 0 && !methodAwaitingBody) {
            methodAwaitingBody = true
          }
          // Closing '}' at depth 0 ends the method shorthand value entirely.
          else if (cc === 125 /* } */ && depth === 0) {
            inMethodShorthand = false
            methodAwaitingBody = false
          }
        }
      }
      else if (cc === 58 /* : */ && depth === 0 && inKey && typeArgumentDepth === 0) {
        currentKey = current.trim()
        current = ''
        inKey = false
      }
      else if (cc === 58 /* : */ && depth === 0 && arrowParameterListClosed) {
        inArrowReturnType = true
        current += char
      }
      else if (cc === 60 /* < */ && inArrowReturnType) {
        typeArgumentDepth++
        current += char
      }
      else if (cc === 60 /* < */ && inKey && depth === 0) {
        // Generic type parameters on a method-shorthand key, e.g.
        // `merge<T, U = Partial<T>>(…)`. Track them so a comma inside the
        // parameter list doesn't split the property mid-key.
        typeArgumentDepth++
        current += char
      }
      else if (cc === 62 /* > */ && typeArgumentDepth > 0 && prevCode !== 61 /* = */) {
        typeArgumentDepth--
        current += char
      }
      else if (cc === 61 /* = */ && nextCode === 62 /* > */ && inArrowReturnType && typeArgumentDepth === 0) {
        inArrowReturnType = false
        arrowParameterListClosed = false
        current += char
      }
      else if (cc === 44 /* , */ && depth === 0 && typeArgumentDepth === 0 && !methodAwaitingBody) {
        if (currentKey && current.trim()) {
          const value = current.trim()
          properties.push([currentKey, value])
        }
        else if (inKey && current.trim()) {
          pushShorthand(properties, current.trim())
        }
        current = ''
        currentKey = ''
        inKey = true
        arrowParameterListClosed = false
        inArrowReturnType = false
        typeArgumentDepth = 0
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
    const value = current.trim()
    properties.push([currentKey, value])
  }
  else if (inKey && current.trim()) {
    pushShorthand(properties, current.trim())
  }

  return properties
}

/**
 * Record a shorthand property (`charge`) or a spread (`...base`).
 *
 * The text may open with the property's JSDoc - the parser keeps comments in
 * the key so they reach the declaration. It used to test the whole text,
 * comment included, as an identifier, so a documented shorthand property was
 * dropped without a word; an object of documented shorthands declared `{}`.
 */
function pushShorthand(properties: Array<[string, string]>, text: string): void {
  const { comments, key } = splitLeadingCommentsFromKey(text)
  if (isIdentifierName(key))
    properties.push([comments ? `${comments}\n  ${key}` : key, key])
  else if (key.startsWith('...') && key.length > 3)
    properties.push(['...', key.slice(3).trim()])
}

/**
 * Detect getter/setter shorthand keys (`get X` / `set X`).
 *
 * `parseObjectProperties` doesn't understand accessor syntax — it
 * splits `get TRACE()` into key `"get TRACE"` and value `"() { … }"`,
 * just like a regular method. We re-detect that pattern here so the
 * caller can emit a proper accessor signature.
 */
function matchAccessorKey(key: string): { kind: 'get' | 'set', name: string } | null {
  const trimmed = key.trim()
  if (trimmed.startsWith('get ') && trimmed.length > 4) {
    const name = trimmed.slice(4).trim()
    if (name) return { kind: 'get', name }
  }
  if (trimmed.startsWith('set ') && trimmed.length > 4) {
    const name = trimmed.slice(4).trim()
    if (name) return { kind: 'set', name }
  }
  return null
}

/**
 * Reshape an inferred function-type string (`(args) => T`) into the
 * accessor signature TypeScript expects inside a type literal.
 *
 *   getter:  `() => T`            → `get NAME(): T`
 *   setter:  `(value: T) => any`  → `set NAME(value: T)`
 *
 * Returns null if the value doesn't look like an arrow function — the
 * caller falls back to the regular property form.
 */
function formatAccessor(kind: 'get' | 'set', name: string, valueType: string): string | null {
  // Match `(<params>) => <return>` with proper paren depth tracking
  const trimmed = valueType.trim()
  if (trimmed.charCodeAt(0) !== 40 /* ( */) return null

  const paramEnd = findMatchingBracket(trimmed, 0, '(', ')')
  if (paramEnd === -1) return null

  const params = trimmed.slice(1, paramEnd).trim()
  const tail = trimmed.slice(paramEnd + 1).trimStart()
  if (!tail.startsWith('=>')) return null
  const ret = tail.slice(2).trim()

  if (kind === 'get') {
    return `get ${name}(): ${ret || 'unknown'}`
  }
  // Setter signatures don't have a return type in TS.
  return `set ${name}(${params})`
}

/** Index signatures describe property reads, not the functions implementing accessors. */
function accessorValueType(kind: 'get' | 'set', valueType: string): string {
  const input = valueType.trim()
  const end = findMatchingBracket(input, 0, '(', ')')
  if (!input.startsWith('(') || end === -1) return 'unknown'
  if (kind === 'get') {
    const tail = input.slice(end + 1).trim()
    return tail.startsWith('=>') ? tail.slice(2).trim() : 'unknown'
  }
  const parameter = input.slice(1, end).trim()
  const bindingEnd = parameter.startsWith('{') ? findMatchingBracket(parameter, 0, '{', '}')
    : parameter.startsWith('[') ? findMatchingBracket(parameter, 0, '[', ']') : 0
  const colon = parameter.indexOf(':', Math.max(0, bindingEnd))
  return colon === -1 ? 'unknown' : parameter.slice(colon + 1).trim()
}

/** Check if value looks like a method definition (not an arrow function).
 *  Method definitions: (params): ReturnType { body }
 *  Arrow functions: (params): ReturnType => body
 *  Key difference: method definitions have no '=>' at top level. */
// eslint-disable-next-line pickier/no-unused-vars
function isMethodDefinition(value: string): boolean {
  let stripped = value
  // Strip async/generator prefixes to check what follows
  if (stripped.startsWith('async ') || stripped.startsWith('async\t')) {
    stripped = stripped.slice(5).trimStart()
  }
  if (stripped.startsWith('*')) {
    stripped = stripped.slice(1).trimStart()
  }
  // Must start with '(' to be a method definition
  if (!stripped.startsWith('(')) return false

  // Find the matching ')' for the parameter list
  let depth = 0
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped.charCodeAt(i)
    if (c === 40 /* ( */) depth++
    else if (c === 41 /* ) */) {
      depth--
      if (depth === 0) {
        // After the closing paren, check if there's '=>' (arrow function) or not (method def)
        const after = stripped.slice(i + 1).trimStart()
        // Method definitions have ':' then return type then '{', or just '{'
        // Arrow functions have '=>' (possibly after ': ReturnType')
        if (after.startsWith('{')) return true // (params) { body }
        if (after.startsWith(':')) {
          const boundary = findReturnTypeBoundary(after, 1)
          if (boundary?.kind === 'arrow') return false
          if (boundary?.kind === 'body') return true
        }
        return false
      }
    }
  }
  return false
}

/**
 * Split a generic method-shorthand key (`merge<T, U = Partial<T>>`) into its
 * plain name and its type parameter list. Returns null when the key carries
 * no type parameters. The object property parser splits a method shorthand at
 * its parameter list, so the generics stay glued to the key; the caller moves
 * them onto the converted function type because `name<T>: (…) => …` is not
 * valid TypeScript — `name: <T>(…) => …` is.
 */
function splitKeyTypeParameters(key: string): { name: string, typeParams: string } | null {
  const trimmed = key.trimEnd()
  if (!trimmed.endsWith('>'))
    return null

  // Scan backwards to find the '<' that opens the trailing type parameter
  // list, skipping the '>' of arrow types inside constraints
  // (e.g. `T extends () => void`).
  let depth = 0
  let openIndex = -1
  for (let i = trimmed.length - 1; i >= 0; i--) {
    const c = trimmed.charCodeAt(i)
    if (c === 62 /* > */) {
      if (i > 0 && trimmed.charCodeAt(i - 1) === 61 /* = */)
        continue
      depth++
    }
    else if (c === 60 /* < */) {
      depth--
      if (depth === 0) {
        openIndex = i
        break
      }
    }
  }
  if (openIndex === -1)
    return null

  const name = trimmed.slice(0, openIndex).trimEnd()
  if (!name)
    return null
  return { name, typeParams: trimmed.slice(openIndex) }
}

/**
 * Convert method definition to function type signature
 */
function convertMethodToFunctionType(_methodName: string, _methodDef: string): string {
  // Detect and remove async/generator prefixes
  let cleaned = _methodDef.trimStart()
  let isAsync = false
  let isGenerator = false

  if (cleaned.startsWith('async ') || cleaned.startsWith('async\t')) {
    isAsync = true
    cleaned = cleaned.slice(5).trimStart()
  }
  if (cleaned.startsWith('*')) {
    isGenerator = true
    cleaned = cleaned.slice(1).trimStart()
  }

  // Extract generics: starts with '<', find matching '>'
  let generics = ''
  if (cleaned.charCodeAt(0) === 60 /* < */) {
    let depth = 0
    let gEnd = -1
    for (let gi = 0; gi < cleaned.length; gi++) {
      if (cleaned.charCodeAt(gi) === 60) depth++
      // Skip the '>' of arrow types inside constraints (`T extends () => void`)
      else if (cleaned.charCodeAt(gi) === 62 && !(gi > 0 && cleaned.charCodeAt(gi - 1) === 61)) { depth--; if (depth === 0) { gEnd = gi; break } }
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
    const typeContent = afterParams.slice(1) // skip ':'
    const boundary = findReturnTypeBoundary(typeContent, 0)
    if (boundary) {
      returnType = typeContent.slice(0, boundary.index).trim()
    }
    else {
      returnType = typeContent.trim()
    }
  }

  // No annotation: what the body returns, as for a function. A method used to
  // be declared \`Promise<void>\` (async) or \`unknown\` without its body read.
  if (returnType === 'unknown' && !isGenerator && afterParams.charCodeAt(0) === 123 /* { */) {
    const bodyEnd = findMatchingBracket(afterParams, 0, '{', '}')
    if (bodyEnd !== -1) {
      const inferred = inferFunctionBodyReturnType(afterParams.slice(1, bodyEnd), isAsync, params)
      if (inferred !== 'unknown' && inferred !== 'Promise<unknown>')
        returnType = isAsync && inferred.startsWith('Promise<') ? inferred.slice(8, -1) : inferred
      else if (isAsync)
        returnType = 'Promise<unknown>'
    }
  }

  // Apply async/generator defaults when no explicit return type was provided
  if (returnType === 'unknown') {
    if (isAsync && isGenerator) {
      returnType = 'AsyncGenerator<unknown, void, unknown>'
    }
    else if (isGenerator) {
      returnType = 'Generator<unknown, void, unknown>'
    }
    else if (isAsync) {
      returnType = 'Promise<void>'
    }
  }
  else if (isAsync && !returnType.startsWith('Promise<') && !returnType.startsWith('AsyncGenerator<')) {
    // If async method has explicit non-Promise return type, wrap it
    returnType = `Promise<${returnType}>`
  }

  // Clean parameter defaults
  const cleanedParams = cleanParameterDefaults(params)

  return `${generics}${cleanedParams} => ${returnType}`
}

interface ReturnTypeBoundary {
  index: number
  kind: 'arrow' | 'body'
}

/**
 * Find where an annotated return type ends and an implementation begins.
 * Object type literals are part of the type, including when nested in a
 * generic, union, or intersection. A later top-level brace starts a method
 * body, while a top-level arrow identifies an arrow-function initializer.
 */
function findReturnTypeBoundary(value: string, start: number): ReturnTypeBoundary | null {
  let parenDepth = 0
  let bracketDepth = 0
  let angleDepth = 0
  let objectTypeDepth = 0
  let inString = false
  let stringChar = 0

  for (let i = start; i < value.length; i++) {
    const current = value.charCodeAt(i)

    if (inString) {
      if (current === 92 /* \\ */) i++
      else if (current === stringChar) inString = false
      continue
    }

    if (current === 34 /* " */ || current === 39 /* ' */ || current === 96 /* ` */) {
      inString = true
      stringChar = current
      continue
    }

    if (current === 40 /* ( */) parenDepth++
    else if (current === 41 /* ) */ && parenDepth > 0) parenDepth--
    else if (current === 91 /* [ */) bracketDepth++
    else if (current === 93 /* ] */ && bracketDepth > 0) bracketDepth--
    else if (current === 60 /* < */) angleDepth++
    else if (current === 62 /* > */ && angleDepth > 0 && value.charCodeAt(i - 1) !== 61 /* = */) angleDepth--
    else if (current === 125 /* } */ && objectTypeDepth > 0) objectTypeDepth--
    else if (current === 123 /* { */) {
      const nested = parenDepth > 0 || bracketDepth > 0 || angleDepth > 0 || objectTypeDepth > 0
      const preceding = value.slice(start, i).trimEnd()
      const previous = preceding.charCodeAt(preceding.length - 1)
      const startsObjectType = preceding.length === 0
        || previous === 38 /* & */
        || previous === 124 /* | */
        || previous === 40 /* ( */
        || previous === 44 /* , */
        || previous === 58 /* : */
        || previous === 61 /* = */
        || previous === 91 /* [ */

      if (nested || startsObjectType) objectTypeDepth++
      else return { index: i, kind: 'body' }
    }
    else if (current === 61 /* = */
      && i + 1 < value.length
      && value.charCodeAt(i + 1) === 62 /* > */
      && parenDepth === 0
      && bracketDepth === 0
      && angleDepth === 0
      && objectTypeDepth === 0) {
      return { index: i, kind: 'arrow' }
    }
  }

  return null
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
      // Don't treat the '>' of an arrow type (`=>`) as closing an angle bracket
      if (closeChar === '>' && i > 0 && str[i - 1] === '=') continue
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
      // Skip over a balanced `<...>`. An arrow inside a TYPE argument is not the
      // value's main arrow — `k<{ go: (p: string) => void }>('a')` is a call, not
      // a function — and counting it made the caller infer a function type and
      // truncate the signature at that paren. Only balanced runs are skipped, so
      // a bare comparison (`a < b`) still scans through as ordinary characters.
      if (char === '<') {
        const end = findMatchingBracket(str, i, '<', '>')
        if (end !== -1) {
          i = end
          continue
        }
      }

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
    const arrowIndex = findMainArrowIndex(asyncRemoved)
    if (arrowIndex === -1) return inUnion ? '(() => Promise<unknown>)' : '() => Promise<unknown>'
    const rawParams = asyncRemoved.substring(0, arrowIndex).trim()
    const body = asyncRemoved.substring(arrowIndex + 2).trim()
    const signature = splitArrowSignature(rawParams)
    let params = signature.params
    const explicitReturnType = signature.returnType

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
    let returnType = explicitReturnType
    if (returnType) {
      // The source annotation already contains the required Promise wrapper.
    }
    else if (body.startsWith('{')) {
      returnType = inferFunctionBodyReturnType(body.slice(1, body.endsWith('}') ? -1 : undefined), true, signature.params)
    }
    else {
      // Expression body - try to infer
      returnType = inferBodyExpressionType(body, collectParameterTypes(signature.params))
    }

    const funcType = `${params} => ${explicitReturnType || returnType.startsWith('Promise<') ? returnType : `Promise<${returnType}>`}`
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

    const rawParams = remaining.substring(0, arrowIndex).trim()
    const body = remaining.substring(arrowIndex + 2).trim()
    const signature = splitArrowSignature(rawParams)
    let params = signature.params
    const explicitReturnType = signature.returnType

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
      returnType = inferFunctionBodyReturnType(body.slice(1, body.endsWith('}') ? -1 : undefined), false, signature.params)
    }
    else if (isJsxExpression(body) || (hasBalancedOuterParentheses(body) && isJsxExpression(body.slice(1, -1).trim()))) {
      // Nested callbacks inside parenthesized JSX are implementation details,
      // not evidence that the component returns a higher-order function.
      returnType = 'JSX.Element'
    }
    else if (body.includes('=>')) {
      // This is a higher-order function returning another function
      // For complex nested functions, try to extract just the outer function signature
      //
      // `indexOf(')')` returns the FIRST `)`, which truncates whenever the
      // outer param type contains its own parens (e.g. `(handler: () => void)`).
      // Use proper bracket matching, and strip default values so the result
      // is valid in `.d.ts` output. See stacksjs/dtsx#3093.
      const bodyTrimmed = body.trimStart()
      const outerParenOpen = bodyTrimmed.indexOf('(')
      const outerParenClose = outerParenOpen !== -1
        ? findMatchingBracket(bodyTrimmed, outerParenOpen, '(', ')')
        : -1
      const outerArrow = outerParenClose !== -1
        ? bodyTrimmed.indexOf('=>', outerParenClose)
        : -1
      if (outerParenOpen === 0 && outerParenClose !== -1 && outerArrow !== -1) {
        const rawOuter = bodyTrimmed.substring(outerParenOpen + 1, outerParenClose).trim()
        const cleanedOuter = cleanParameterDefaults(rawOuter)
        // For functions like pipe that transform T => T, infer the return type from generics
        if (generics.includes('T') && cleanedOuter.includes('T')) {
          // eslint-disable-next-line pickier/no-unused-vars
          returnType = `(${cleanedOuter}) => T`
        }
        else {
          // eslint-disable-next-line pickier/no-unused-vars
          returnType = `(${cleanedOuter}) => any`
        }
      }
      else {
        // Fallback for complex cases
        returnType = 'any'
      }
    }
    else {
      // An expression body returns its value, in a union as anywhere else:
      // `[() => 'a']` is `(() => string)[]`, as its `@defaultValue` shows.
      returnType = inferBodyExpressionType(body, collectParameterTypes(signature.params))
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
        // Skip the '>' of arrow types inside constraints (`T extends () => void`)
        else if (c === 62 && trimmed.charCodeAt(pos - 1) !== 61) depth--
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

      // Initializers are not allowed in a declaration (#3093).
      const paramTypes = params ? cleanParameterDefaults(`(${params})`) : '()'

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

      // An annotated return type is the declared one.
      let returnType = 'unknown'
      const afterParams = trimmed.substring(closeIdx).trimStart()
      if (afterParams.charCodeAt(0) === 58 /* : */) {
        const typeContent = afterParams.slice(1)
        const boundary = findReturnTypeBoundary(typeContent, 0)
        const annotated = (boundary ? typeContent.slice(0, boundary.index) : typeContent).trim()
        if (annotated) returnType = annotated
      }

      const funcType = `${generics}${paramTypes} => ${returnType}`
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
        const gt = findMatchingBracket(trimmed, 0, '<', '>')
        if (gt !== -1) generics = trimmed.substring(0, gt + 1)
      }

      // Look for parameter pattern. Use proper bracket matching — `indexOf(')')`
      // returns the FIRST `)`, which truncates the param list when the param
      // type contains its own parens (e.g. `(handler: () => void) => any`).
      // Also clean default values, which are invalid in `.d.ts`. See #3093.
      const po = trimmed.indexOf('(')
      const pc = po !== -1 ? findMatchingBracket(trimmed, po, '(', ')') : -1
      let params = (po !== -1 && pc !== -1) ? trimmed.substring(po, pc + 1) : '(...args: any[])'
      params = cleanParameterDefaults(params)

      const funcType = `${generics}${params} => any`
      return inUnion ? `(${funcType})` : funcType
    }

    // This might be a higher-order function, try to preserve the structure
    return inUnion ? `(${trimmed})` : trimmed
  }

  const funcType = '() => unknown'
  return inUnion ? `(${funcType})` : funcType
}

function splitArrowSignature(value: string): { params: string, returnType: string } {
  const trimmed = value.trim()
  if (!trimmed.startsWith('(')) return { params: trimmed, returnType: '' }
  const close = findMatchingBracket(trimmed, 0, '(', ')')
  if (close === -1) return { params: trimmed, returnType: '' }
  const suffix = trimmed.slice(close + 1).trim()
  return {
    params: trimmed.slice(0, close + 1),
    returnType: suffix.startsWith(':') ? suffix.slice(1).trim() : '',
  }
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
  let satisfiesIndex = -1
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i)
    if (char === 34 || char === 39 || char === 96) {
      i = skipQuotedValue(value, i, char) - 1
      continue
    }
    if (char === 47 && value.charCodeAt(i + 1) === 47) {
      while (i < value.length && value.charCodeAt(i) !== 10) i++
      continue
    }
    if (char === 47 && value.charCodeAt(i + 1) === 42) {
      const close = value.indexOf('*/', i + 2)
      i = close === -1 ? value.length : close + 1
      continue
    }
    if (char === 47) {
      let previous = i - 1
      while (previous >= 0 && value.charCodeAt(previous) <= 32) previous--
      if (previous < 0 || '([{:;,=!?&|+*-~>'.includes(value[previous])) {
        let inClass = false
        for (i++; i < value.length; i++) {
          const regexChar = value.charCodeAt(i)
          if (regexChar === 92) i++
          else if (regexChar === 91) inClass = true
          else if (regexChar === 93) inClass = false
          else if (regexChar === 47 && !inClass) break
        }
        continue
      }
    }
    if (char === 40 || char === 91 || char === 123) depth++
    else if (char === 41 || char === 93 || char === 125) depth--
    else if (depth === 0 && value.startsWith('satisfies', i) && isWordBoundary(value, i, 9) && value[i - 1] !== '.') {
      satisfiesIndex = i
    }
  }
  if (satisfiesIndex === -1) return null

  // Extract everything after 'satisfies '
  let typeStr = value.slice(satisfiesIndex + 9).trim()

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
