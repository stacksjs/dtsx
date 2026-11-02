/** Shared declaration-scanner lexical rules for identifiers and regex literals. */

const CH_SPACE = 32
const CH_TAB = 9
const CH_LF = 10
const CH_CR = 13
const CH_SLASH = 47
const CH_STAR = 42
const CH_SQUOTE = 39
const CH_DQUOTE = 34
const CH_BACKTICK = 96
const CH_BACKSLASH = 92
const CH_LBRACE = 123
const CH_RBRACE = 125
const CH_LPAREN = 40
const CH_LBRACKET = 91
const CH_RBRACKET = 93
const CH_LANGLE = 60
const CH_RANGLE = 62
const CH_SEMI = 59
const CH_COLON = 58
const CH_EQUAL = 61
const CH_COMMA = 44
const CH_QUESTION = 63
const CH_HASH = 35
const CH_DOLLAR = 36
const CH_UNDERSCORE = 95

export function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === CH_UNDERSCORE || ch === CH_DOLLAR || ch > 127
}

export function isIdentChar(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57)
}

/**
 * The previous character that actually is code, skipping whitespace AND
 * comments backwards from `from`.
 *
 * Comments are the part that was missing. Scanning back over whitespace only,
 * a `/` on the line after `// Bind/call/apply (execution context)` sees `)`
 * , or, more often, an ordinary letter , as its predecessor, decides the
 * slash is division, and walks into the regex body as if it were code. Every
 * bracket in the pattern then counts towards the enclosing declaration's
 * depth, so `/\.(bind|call|apply)\s*\(/` opens two parens that never close
 * and the declaration swallows the rest of the file. dtsx emitted four of
 * stx's sixteen exports for exactly this reason, and the result parsed
 * cleanly, so nothing downstream noticed.
 *
 * Returns -1 when there is nothing but whitespace and comments before it,
 * which is the start-of-input case where a slash can only be a regex.
 */
function previousCodeIndex(source: string, from: number): number {
  let p = from
  for (;;) {
    while (p >= 0 && (source.charCodeAt(p) === CH_SPACE || source.charCodeAt(p) === CH_TAB
      || source.charCodeAt(p) === CH_LF || source.charCodeAt(p) === CH_CR)) p--
    if (p < 0)
      return -1

    // End of a block comment: jump to just before its opening.
    if (source.charCodeAt(p) === CH_SLASH && p > 0 && source.charCodeAt(p - 1) === CH_STAR) {
      const open = source.lastIndexOf('/*', p - 2)
      if (open === -1)
        return -1
      p = open - 1
      continue
    }

    // Inside a line comment: the comment runs to the end of its line, so `p`
    // is in one when its line has a `//` before it. Quotes on that line are
    // checked so a `//` inside a string literal , a URL, most often , is not
    // mistaken for the start of a comment.
    const lineStart = source.lastIndexOf('\n', p) + 1
    const commentStart = lineCommentStart(source, lineStart, p)
    if (commentStart !== -1) {
      p = commentStart - 1
      continue
    }

    return p
  }
}

/** Index of the `//` that comments out `upTo` on this line, or -1. */
function lineCommentStart(source: string, lineStart: number, upTo: number): number {
  let quote = 0
  for (let i = lineStart; i <= upTo; i++) {
    const ch = source.charCodeAt(i)
    if (quote) {
      if (ch === CH_BACKSLASH) { i++; continue }
      if (ch === quote) quote = 0
      continue
    }
    if (ch === CH_SQUOTE || ch === CH_DQUOTE || ch === CH_BACKTICK) {
      quote = ch
      continue
    }
    if (ch === CH_SLASH && i + 1 <= upTo && source.charCodeAt(i + 1) === CH_SLASH)
      return i
  }
  return -1
}

/** Punctuation after which an expression, including a regex, may start. */
function isRegexPrefixCharacter(ch: number): boolean {
  return ch === CH_EQUAL || ch === CH_LPAREN || ch === CH_LBRACKET
    || ch === 33 /* ! */ || ch === 38 /* & */ || ch === 124 /* | */
    || ch === CH_QUESTION || ch === CH_COLON || ch === CH_COMMA
    || ch === CH_SEMI || ch === CH_LBRACE || ch === CH_RBRACE
    || ch === 94 /* ^ */ || ch === 126 /* ~ */
    || ch === 43 /* + */ || ch === 45 /* - */ || ch === CH_STAR
    || ch === 37 /* % */ || ch === CH_LANGLE || ch === CH_RANGLE
}

function isRegexPrefixWord(word: string): boolean {
  return word === 'return' || word === 'typeof' || word === 'void'
    || word === 'delete' || word === 'throw' || word === 'new'
    || word === 'in' || word === 'of' || word === 'case'
    || word === 'instanceof' || word === 'yield' || word === 'await'
    || word === 'else' || word === 'do'
}

/**
 * A control header's closing parenthesis starts a statement, whereas a call's
 * closing parenthesis ends an expression. Balance lexical tokens to distinguish
 * them, ignoring delimiters inside comments, strings, templates and regexes.
 * Only the ambiguous closing-parenthesis case needs this contextual pass.
 */
function closesControlHeader(source: string, end: number): boolean {
  const parentheses: boolean[] = []
  const templateExpressions: number[] = []
  let braceDepth = 0
  let inTemplate = false
  let previous = ''
  let beforePrevious = ''
  let regexAllowed = true
  let pos = 0
  const token = (value: string, allowsRegex: boolean = false): void => {
    beforePrevious = previous
    previous = value
    regexAllowed = allowsRegex
  }
  while (pos <= end) {
    const ch = source.charCodeAt(pos)
    if (inTemplate) {
      if (ch === CH_BACKSLASH) { pos += 2; continue }
      if (ch === CH_BACKTICK) {
        inTemplate = false
        token('literal')
      }
      else if (ch === CH_DOLLAR && source.charCodeAt(pos + 1) === CH_LBRACE) {
        templateExpressions.push(braceDepth++)
        inTemplate = false
        token('{', true)
        pos++
      }
      pos++
      continue
    }
    if (ch === CH_SPACE || ch === CH_TAB || ch === CH_LF || ch === CH_CR) { pos++; continue }
    if (ch === CH_SLASH && source.charCodeAt(pos + 1) === CH_SLASH) {
      const newline = source.indexOf('\n', pos + 2)
      pos = newline === -1 ? source.length : newline + 1
      continue
    }
    if (ch === CH_SLASH && source.charCodeAt(pos + 1) === CH_STAR) {
      const close = source.indexOf('*/', pos + 2)
      pos = close === -1 ? source.length : close + 2
      continue
    }
    if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
      const quote = ch
      pos++
      while (pos < source.length) {
        const next = source.charCodeAt(pos++)
        if (next === CH_BACKSLASH) pos++
        else if (next === quote) break
      }
      token('literal')
      continue
    }
    if (ch === CH_BACKTICK) { inTemplate = true; pos++; continue }
    // Private identifiers are one value token, even when their name is a keyword.
    if (isIdentStart(ch) || (ch === CH_HASH && isIdentStart(source.charCodeAt(pos + 1)))) {
      const start = pos++
      while (isIdentChar(source.charCodeAt(pos))) pos++
      const word = source.slice(start, pos)
      token(word, previous !== '.' && isRegexPrefixWord(word))
      continue
    }
    if (ch === CH_LPAREN) {
      const control = beforePrevious !== '.' && (previous === 'if' || previous === 'while'
        || previous === 'for' || previous === 'with' || previous === 'switch'
        || previous === 'catch' || (previous === 'await' && beforePrevious === 'for'))
      parentheses.push(control)
      token('(', true)
    }
    else if (ch === 41 /* ) */) {
      const control = parentheses.pop() ?? false
      if (pos === end) return control
      token(')', control)
    }
    else if (ch === CH_SLASH && regexAllowed) {
      pos = skipRegexLiteral(source, pos)
      token('literal')
      continue
    }
    else {
      if (ch === CH_LBRACE) braceDepth++
      else if (ch === CH_RBRACE) {
        braceDepth--
        if (templateExpressions.at(-1) === braceDepth) {
          templateExpressions.pop()
          inTemplate = true
        }
      }
      token(source[pos], ch === CH_SLASH || isRegexPrefixCharacter(ch))
    }
    pos++
  }
  return false
}

/** Check if `/` at current pos is the start of a regex literal (not division). */
export function isRegexStart(source: string, pos: number): boolean {
  const p = previousCodeIndex(source, pos - 1)
  if (p < 0) return true
  const prev = source.charCodeAt(p)
  if (prev === 41 /* ) */) return closesControlHeader(source, p)
  if (isRegexPrefixCharacter(prev)) return true
  if (isIdentChar(prev)) {
    let start = p
    while (start >= 0 && isIdentChar(source.charCodeAt(start))) start--
    // Member names and complete private identifiers end value expressions.
    const prefix = source.charCodeAt(previousCodeIndex(source, start))
    if (prefix === 46 /* . */ || prefix === CH_HASH) return false
    return isRegexPrefixWord(source.slice(start + 1, p + 1))
  }
  return false
}

/** Skip a regex literal /.../ including flags */
export function skipRegexLiteral(source: string, start: number): number {
  let pos = start
  const len = source.length
  pos++ // skip opening /
  let inCharClass = false
  while (pos < len) {
    const ch = source.charCodeAt(pos)
    if (ch === CH_BACKSLASH) { pos += 2; continue } // skip escaped char
    if (inCharClass) {
      if (ch === CH_RBRACKET)
        inCharClass = false
      pos++
      continue
    }
    if (ch === CH_LBRACKET) { inCharClass = true; pos++; continue }
    if (ch === CH_SLASH) { pos++; break } // closing /
    if (ch === CH_LF || ch === CH_CR)
      break // unterminated regex
    pos++
  }
  // Skip flags (g, i, m, s, u, y, d, v)
  while (pos < len && isIdentChar(source.charCodeAt(pos))) pos++
  return pos
}
