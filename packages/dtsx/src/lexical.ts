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
  for (;; ) {
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
  if (!source.slice(lineStart, upTo + 1).includes('//')) return -1
  // Comments and regex literals need the same expression context across lines.
  // Reuse the iterative contextual scanner rather than restarting at this line.
  return scanRegexContext(source, upTo).lineCommentStart ?? -1
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
 * Closing parentheses and line-leading slashes need this contextual pass.
 */
function scanRegexContext(source: string, end: number): { regexAllowed: boolean, closesControlHeader: boolean, lineCommentStart?: number } {
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
      if (newline === -1 || newline > end) return { regexAllowed, closesControlHeader: false, lineCommentStart: pos }
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
    if ((ch === 43 /* + */ || ch === 45 /* - */) && source.charCodeAt(pos + 1) === ch) {
      // Prefix operators still require a value; postfix operators finish one.
      token(source.slice(pos, pos + 2), regexAllowed)
      pos += 2
      continue
    }
    if (ch === 33 /* ! */ && source.charCodeAt(pos + 1) !== 61 /* = */) {
      // Unary negation needs an operand; a TS non-null assertion follows one.
      token('!', regexAllowed)
      pos++
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
      if (pos === end) return { regexAllowed: control, closesControlHeader: control }
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
  return { regexAllowed, closesControlHeader: false }
}

/** Check if `/` at current pos is the start of a regex literal (not division). */
export function isRegexStart(source: string, pos: number, previousTokenEnd?: number): boolean {
  const p = previousTokenEnd === undefined ? previousCodeIndex(source, pos - 1) : previousTokenEnd - 1
  if (p < 0) return true
  const prev = source.charCodeAt(p)
  if (prev === 33 /* ! */ || (prev === 43 /* + */ || prev === 45 /* - */) && source.charCodeAt(p - 1) === prev)
    return scanRegexContext(source, p).regexAllowed
  if (prev === 41 /* ) */) return scanRegexContext(source, p).closesControlHeader
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

/** Whether the preceding code token permits a JSX primary expression. */
export function canStartJsx(source: string, before: number, previousTokenEnd?: number): boolean {
  const previous = previousTokenEnd === undefined ? previousCodeIndex(source, before - 1) : previousTokenEnd - 1
  if (previous < 0) return true
  const char = source[previous]
  if ('=([{,:;!?+-*/%&|^~<'.includes(char)) return true
  if (char === '>' && source[previous - 1] === '=') return true
  let start = previous
  while (start >= 0 && isIdentChar(source.charCodeAt(start))) start--
  return ['return', 'throw', 'yield', 'await', 'case', 'void', 'typeof', 'delete', 'new', 'else', 'do'].includes(source.slice(start + 1, previous + 1))
}

/** Tag boundaries shared by source scanning and canonical tokenization. */
type JsxTag = { delta: number, end: number } | null

function jsxTagAt(source: string, index: number, closingTags?: ReadonlyMap<string, number>, readNested?: (index: number) => JsxTag): JsxTag {
  const len = source.length
  if (source.charCodeAt(index) !== CH_LANGLE || index + 1 >= len) return null
  const next = source.charCodeAt(index + 1)
  if (next === CH_RANGLE) return { delta: 1, end: index + 1 }
  if (next === CH_SLASH) {
    let end = index + 2
    if (source.charCodeAt(end) !== CH_RANGLE) {
      if (!isIdentStart(source.charCodeAt(end))) return null
      while (end < len && (isIdentChar(source.charCodeAt(end)) || '.:-'.includes(source[end]))) end++
      while (end < len && /\s/.test(source[end])) end++
    }
    return source.charCodeAt(end) === CH_RANGLE ? { delta: -1, end } : null
  }
  if (!isIdentStart(next)) return null

  let nameEnd = index + 2
  while (nameEnd < len) {
    const code = source.charCodeAt(nameEnd)
    if (!isIdentChar(code) && code !== 46 /* . */ && code !== 58 /* : */ && code !== 45 /* - */) break
    nameEnd++
  }
  const tagName = source.slice(index + 1, nameEnd)
  const delimiter = source.charCodeAt(nameEnd)
  if (delimiter > 32 && delimiter !== CH_RANGLE && delimiter !== CH_SLASH) return null

  let braceDepth = 0
  let quote = 0
  let tagEnd = nameEnd
  let codeEnd = nameEnd
  for (; tagEnd < len; tagEnd++) {
    const code = source.charCodeAt(tagEnd)
    if (quote !== 0) {
      if (code === CH_BACKSLASH) tagEnd++
      else if (code === quote) { quote = 0; codeEnd = tagEnd + 1 }
      continue
    }
    if (code === CH_LANGLE && braceDepth > 0 && (source[tagEnd + 1] === '/' || canStartJsx(source, tagEnd, codeEnd))) {
      const nested = readNested ? readNested(tagEnd) : jsxTagAt(source, tagEnd, closingTags)
      if (nested) {
        tagEnd = nested.end
        codeEnd = tagEnd + 1
        continue
      }
    }
    if (code === CH_SLASH && braceDepth > 0) {
      const next = source.charCodeAt(tagEnd + 1)
      if (next === CH_SLASH) {
        while (tagEnd < len && source.charCodeAt(tagEnd) !== CH_LF && source.charCodeAt(tagEnd) !== CH_CR) tagEnd++
        continue
      }
      if (next === CH_STAR) {
        const end = source.indexOf('*/', tagEnd + 2)
        if (end === -1) return null
        tagEnd = end + 1
        continue
      }
      if (isRegexStart(source, tagEnd, codeEnd)) {
        tagEnd = skipRegexLiteral(source, tagEnd) - 1
        codeEnd = tagEnd + 1
        continue
      }
    }
    if (code === CH_SQUOTE || code === CH_DQUOTE || code === CH_BACKTICK) quote = code
    else if (code === CH_LBRACE) braceDepth++
    else if (code === CH_RBRACE && braceDepth > 0) braceDepth--
    else if (code === CH_LANGLE && braceDepth === 0) return null
    else if (code === CH_RANGLE && braceDepth === 0) break
    if (code > 32) codeEnd = tagEnd + 1
  }
  if (tagEnd >= len) return null

  let beforeEnd = tagEnd - 1
  while (beforeEnd > index && source.charCodeAt(beforeEnd) <= 32) beforeEnd--
  if (source.charCodeAt(beforeEnd) === CH_SLASH) return { delta: 0, end: tagEnd }
  const closing = closingTags ? (closingTags.get(tagName) ?? -1) : source.indexOf(`</${tagName}`, tagEnd + 1)
  return closing > tagEnd ? { delta: 1, end: tagEnd } : null
}

/** Index closing candidates once, including files containing many assertions. */
export function createJsxTagReader(source: string, syntaxSlashes?: Set<number>): (index: number) => JsxTag {
  let closingTags: Map<string, number> | undefined
  const headers = new Map<number, JsxTag>()
  function read(index: number): JsxTag {
    if (headers.has(index)) return headers.get(index)!
    if (!closingTags) {
      closingTags = new Map()
      let position = source.indexOf('</')
      while (position !== -1) {
        const tag = jsxTagAt(source, position)
        if (tag) {
          let end = position + 2
          while (end < tag.end && !/\s/.test(source[end])) end++
          closingTags.set(source.slice(position + 2, end), position)
        }
        position = source.indexOf('</', position + 2)
      }
    }
    const tag = jsxTagAt(source, index, closingTags, read)
    headers.set(index, tag)
    if (tag && source[tag.end - 1] === '/') syntaxSlashes?.add(tag.end - 1)
    return tag
  }
  return read
}
