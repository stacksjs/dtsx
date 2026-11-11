/** Numeric literal grammar shared by type recognition and value inference. */
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
