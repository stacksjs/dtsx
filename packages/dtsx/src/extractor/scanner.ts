/**
 * Fast string-based declaration scanner.
 * Replaces ts.createSourceFile() + AST walk with direct string scanning.
 * Produces the same Declaration[] shape that the processor expects.
 */

import type { Declaration } from '../types'

// Character codes for fast comparison
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
const CH_RPAREN = 41
const CH_LBRACKET = 91
const CH_RBRACKET = 93
const CH_LANGLE = 60
const CH_RANGLE = 62
const CH_SEMI = 59
const CH_COLON = 58
const CH_EQUAL = 61
const CH_COMMA = 44
const CH_DOT = 46
const CH_QUESTION = 63
const CH_HASH = 35
const CH_AT = 64
const CH_DOLLAR = 36
const CH_UNDERSCORE = 95

function isWhitespace(ch: number): boolean {
  return ch === CH_SPACE || ch === CH_TAB || ch === CH_LF || ch === CH_CR
}

function isIdentStart(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || ch === CH_UNDERSCORE || ch === CH_DOLLAR || ch > 127
}

function isIdentChar(ch: number): boolean {
  return isIdentStart(ch) || (ch >= 48 && ch <= 57)
}

/** Check if a type annotation is generic enough that value inference produces better results. */
function isGenericAnnotation(type: string): boolean {
  // Record<K, V>
  if (type.charCodeAt(0) === 82 /* R */ && type.startsWith('Record<'))
    return true
  // Array<T>
  if (type.charCodeAt(0) === 65 /* A */ && type.startsWith('Array<'))
    return true
  // { [key: ...]: ... } index signatures
  if (type.charCodeAt(0) === CH_LBRACE && type.includes('[') && type.includes(']:'))
    return true
  // any, object, unknown
  if (type === 'any' || type === 'object' || type === 'unknown')
    return true
  return false
}

// Constructor parameter modifiers (hoisted to avoid per-call allocation)
const PARAM_MODIFIERS = ['public', 'protected', 'private', 'readonly', 'override'] as const

/**
 * Scan TypeScript source code and extract declarations without using the TypeScript parser.
 * This is the fast path that replaces createSourceFile() + AST walk.
 */
export function scanDeclarations(_source: string, _filename: string, _keepComments: boolean = true, _isolatedDeclarations: boolean = false): Declaration[] {
  const source = _source
  const len = source.length
  const declarations: Declaration[] = []
  const nonExportedTypes = new Map<string, Declaration>()
  const funcBodyIndices = new Set<number>()
  let pos = 0

  // Skip BOM (byte order mark)
  if (pos < len && source.charCodeAt(pos) === 0xFEFF)
    pos++

  // --- Primitive scanning helpers ---

  /** Slice source[start..end) with leading/trailing whitespace trimmed — single allocation */
  function sliceTrimmed(start: number, end: number): string {
    // Fast path: if endpoints are already non-whitespace, skip trim loops
    if (start < end) {
      const f = source.charCodeAt(start)
      const l = source.charCodeAt(end - 1)
      if (f !== CH_SPACE && f !== CH_TAB && f !== CH_LF && f !== CH_CR
        && l !== CH_SPACE && l !== CH_TAB && l !== CH_LF && l !== CH_CR) {
        return source.slice(start, end)
      }
    }
    while (start < end && isWhitespace(source.charCodeAt(start))) start++
    while (end > start && isWhitespace(source.charCodeAt(end - 1))) end--
    return source.slice(start, end)
  }

  function skipWhitespaceAndComments(): void {
    // Fast exit: if current char is not whitespace and not '/', nothing to skip
    if (pos >= len) return
    const first = source.charCodeAt(pos)
    if (first !== CH_SPACE && first !== CH_TAB && first !== CH_LF && first !== CH_CR && first !== CH_SLASH) return

    while (pos < len) {
      const ch = source.charCodeAt(pos)
      if (ch === CH_SPACE || ch === CH_TAB || ch === CH_LF || ch === CH_CR) {
        pos++
        continue
      }
      if (ch === CH_SLASH && pos + 1 < len) {
        const next = source.charCodeAt(pos + 1)
        if (next === CH_SLASH) {
          // Line comment — use native indexOf for speed
          const nl = source.indexOf('\n', pos + 2)
          pos = nl === -1 ? len : nl + 1
          continue
        }
        if (next === CH_STAR) {
          // Block comment — use native indexOf for speed
          const end = source.indexOf('*/', pos + 2)
          pos = end === -1 ? len : end + 2
          continue
        }
      }
      break
    }
  }

  /** Strip trailing comments from a line, preserving leading whitespace */
  function stripTrailingComment(line: string): string {
    const lineLen = line.length
    let inString = 0 // 0=none, quote char code when in string
    let end = lineLen
    for (let i = 0; i < lineLen; i++) {
      const c = line.charCodeAt(i)
      if (inString) {
        if (c === CH_BACKSLASH) { i++; continue }
        if (c === inString) inString = 0
        continue
      }
      if (c === CH_SQUOTE || c === CH_DQUOTE || c === CH_BACKTICK) {
        inString = c
        continue
      }
      if (c === CH_SLASH && i + 1 < lineLen) {
        const next = line.charCodeAt(i + 1)
        if (next === CH_SLASH) {
          // Trim trailing whitespace before //
          end = i
          while (end > 0 && (line.charCodeAt(end - 1) === CH_SPACE || line.charCodeAt(end - 1) === CH_TAB)) end--
          return line.slice(0, end)
        }
        if (next === CH_STAR) {
          // Inline /* ... */ — find closing and replace with space
          const closeIdx = line.indexOf('*/', i + 2)
          if (closeIdx !== -1) {
            line = `${line.slice(0, i)} ${line.slice(closeIdx + 2)}`
            i-- // re-scan
            continue
          }
        }
      }
    }
    // Trim trailing whitespace
    end = lineLen
    while (end > 0 && (line.charCodeAt(end - 1) === CH_SPACE || line.charCodeAt(end - 1) === CH_TAB || line.charCodeAt(end - 1) === CH_CR)) end--
    return end < lineLen ? line.slice(0, end) : line
  }

  function skipString(quote: number): void {
    pos++ // skip opening quote
    const q = quote === CH_SQUOTE ? '\'' : '"'
    while (pos < len) {
      const idx = source.indexOf(q, pos)
      if (idx === -1) { pos = len; return }
      // Check for backslash escaping — count consecutive backslashes before quote
      let bs = 0
      let p = idx - 1
      while (p >= 0 && source.charCodeAt(p) === CH_BACKSLASH) { bs++; p-- }
      if (bs % 2 === 0) {
        // Not escaped — found closing quote
        pos = idx + 1
        return
      }
      pos = idx + 1 // Escaped quote, keep searching
    }
  }

  function skipTemplateLiteral(): void {
    pos++ // skip opening backtick
    let depth = 0
    while (pos < len) {
      const ch = source.charCodeAt(pos)
      if (ch === CH_BACKSLASH) {
        pos += 2
        continue
      }
      if (ch === CH_BACKTICK && depth === 0) {
        pos++
        return
      }
      if (ch === CH_DOLLAR && pos + 1 < len && source.charCodeAt(pos + 1) === CH_LBRACE) {
        pos += 2
        depth++
        continue
      }
      if (ch === CH_RBRACE && depth > 0) {
        depth--
        pos++
        continue
      }
      pos++
    }
  }

  /** Skip past a string/comment/template literal if at one */
  function skipNonCode(): boolean {
    const ch = source.charCodeAt(pos)
    if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
      skipString(ch)
      return true
    }
    if (ch === CH_BACKTICK) {
      skipTemplateLiteral()
      return true
    }
    if (ch === CH_SLASH && pos + 1 < len) {
      const next = source.charCodeAt(pos + 1)
      if (next === CH_SLASH) {
        // Line comment — use native indexOf for speed
        const nl = source.indexOf('\n', pos + 2)
        pos = nl === -1 ? len : nl + 1
        return true
      }
      if (next === CH_STAR) {
        // Block comment — use native indexOf for speed
        const end = source.indexOf('*/', pos + 2)
        pos = end === -1 ? len : end + 2
        return true
      }
      // Check for regex literal: / not followed by / or *, preceded by non-expression char
      if (isRegexStart()) {
        skipRegex()
        return true
      }
    }
    return false
  }

  /** Check if `/` at current pos is the start of a regex literal (not division) */
  function isRegexStart(): boolean {
    // Look backward for the previous non-whitespace character
    let p = pos - 1
    while (p >= 0 && (source.charCodeAt(p) === CH_SPACE || source.charCodeAt(p) === CH_TAB || source.charCodeAt(p) === CH_LF || source.charCodeAt(p) === CH_CR)) p--
    if (p < 0)
      return true // start of file
    const prev = source.charCodeAt(p)
    // After these chars, `/` starts a regex (not division)
    // = ( [ ! & | ? : , ; { } ^ ~ + - * % < > \n
    if (prev === CH_EQUAL || prev === CH_LPAREN || prev === CH_LBRACKET
      || prev === 33 /* ! */ || prev === 38 /* & */ || prev === 124 /* | */
      || prev === CH_QUESTION || prev === CH_COLON || prev === CH_COMMA
      || prev === CH_SEMI || prev === CH_LBRACE || prev === CH_RBRACE
      || prev === 94 /* ^ */ || prev === 126 /* ~ */
      || prev === 43 /* + */ || prev === 45 /* - */ || prev === CH_STAR
      || prev === 37 /* % */ || prev === CH_LANGLE || prev === CH_RANGLE) {
      return true
    }
    // After keywords like return, typeof, void, delete, throw, new, in, of, case
    if (isIdentChar(prev)) {
      let wp = p
      while (wp >= 0 && isIdentChar(source.charCodeAt(wp))) wp--
      const word = source.slice(wp + 1, p + 1)
      if (word === 'return' || word === 'typeof' || word === 'void'
        || word === 'delete' || word === 'throw' || word === 'new'
        || word === 'in' || word === 'of' || word === 'case'
        || word === 'instanceof' || word === 'yield' || word === 'await') {
        return true
      }
    }
    return false
  }

  /** Skip a regex literal /.../ including flags */
  function skipRegex(): void {
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
  }

  /** Read an identifier at current position */
  function readIdent(): string {
    const start = pos
    while (pos < len && isIdentChar(source.charCodeAt(pos))) pos++
    return source.slice(start, pos)
  }

  /** Check if the source matches a word at pos (followed by non-ident char) */
  function matchWord(word: string): boolean {
    if (pos + word.length > len)
      return false
    for (let i = 0; i < word.length; i++) {
      if (source.charCodeAt(pos + i) !== word.charCodeAt(i))
        return false
    }
    // Must be followed by non-identifier char
    if (pos + word.length < len && isIdentChar(source.charCodeAt(pos + word.length)))
      return false
    return true
  }

  /** Check if current position is at a top-level statement-starting keyword */
  function isTopLevelKeyword(): boolean {
    if (pos >= len) return false
    const ch = source.charCodeAt(pos)
    switch (ch) {
      case 101: /* e */ return matchWord('export') || matchWord('enum')
      case 105: /* i */ return matchWord('import') || matchWord('interface')
      case 102: /* f */ return matchWord('function')
      case 99: /* c */ return matchWord('class') || matchWord('const')
      case 116: /* t */ return matchWord('type')
      case 108: /* l */ return matchWord('let')
      case 118: /* v */ return matchWord('var')
      case 100: /* d */ return matchWord('declare') || matchWord('default')
      case 109: /* m */ return matchWord('module')
      case 110: /* n */ return matchWord('namespace')
      case 97: /* a */ return matchWord('abstract') || matchWord('async')
      default: return false
    }
  }

  /**
   * Check for ASI boundary at top level: newline at depth 0, next non-whitespace
   * is a statement-starting keyword or EOF. Does NOT consume characters.
   */
  function checkASITopLevel(): boolean {
    const ch = source.charCodeAt(pos)
    if (ch !== CH_LF && ch !== CH_CR)
      return false
    const saved = pos
    pos++
    if (ch === CH_CR && pos < len && source.charCodeAt(pos) === CH_LF)
      pos++
    while (pos < len) {
      const c = source.charCodeAt(pos)
      if (c === CH_SPACE || c === CH_TAB || c === CH_CR || c === CH_LF) { pos++; continue }
      if (c === CH_SLASH && pos + 1 < len) {
        const next = source.charCodeAt(pos + 1)
        if (next === CH_SLASH) {
          // Skip line comment — use native indexOf
          const nl = source.indexOf('\n', pos + 2)
          pos = nl === -1 ? len : nl + 1
          continue
        }
        if (next === CH_STAR) {
          // Skip block/JSDoc comment — use native indexOf
          const end = source.indexOf('*/', pos + 2)
          pos = end === -1 ? len : end + 2
          continue
        }
      }
      break
    }
    const result = pos >= len || isTopLevelKeyword() || source.charCodeAt(pos) === CH_RBRACE
    pos = saved
    return result
  }

  /**
   * Check for ASI boundary in class member context: newline followed by a
   * member-starting token (not a type continuation like | or &).
   * Does NOT consume characters.
   */
  function checkASIMember(): boolean {
    const ch = source.charCodeAt(pos)
    if (ch !== CH_LF && ch !== CH_CR)
      return false
    const saved = pos
    pos++
    if (ch === CH_CR && pos < len && source.charCodeAt(pos) === CH_LF)
      pos++
    while (pos < len) {
      const c = source.charCodeAt(pos)
      if (c === CH_SPACE || c === CH_TAB || c === CH_CR || c === CH_LF) { pos++; continue }
      if (c === CH_SLASH && pos + 1 < len && source.charCodeAt(pos + 1) === CH_SLASH) {
        // Skip line comment — use native indexOf
        const nl = source.indexOf('\n', pos + 2)
        pos = nl === -1 ? len : nl + 1
        continue
      }
      break
    }
    if (pos >= len) { pos = saved; return true }
    const nc = source.charCodeAt(pos)
    // Type continuation operators — NOT end of member
    if (nc === 124 /* | */ || nc === 38 /* & */ || nc === CH_DOT || nc === CH_QUESTION) {
      pos = saved; return false
    }
    // Type continuation keywords
    if (matchWord('extends') || matchWord('keyof') || matchWord('typeof')
      || matchWord('infer') || matchWord('is') || matchWord('as') || matchWord('in')) {
      pos = saved; return false
    }
    // End of class body or new member
    pos = saved
    return true
  }

  // Regex to jump to next delimiter — skips identifiers/operators/numbers in native code
  const BRACE_DELIM_RE = /[{}'"`\/]/g
  const PAREN_DELIM_RE = /[()'"`\/]/g
  const BRACKET_DELIM_RE = /[[\]'"`\/]/g
  const ANGLE_DELIM_RE = /[<>'"`\/]/g

  /** Find matching closing brace, paren, or bracket, respecting nesting and strings/comments */
  function findMatchingClose(open: number, close: number): number {
    let depth = 1
    pos++ // skip opening

    // Select the right regex for this bracket type
    const re = open === CH_LBRACE ? BRACE_DELIM_RE
      : open === CH_LPAREN ? PAREN_DELIM_RE
        : open === CH_LBRACKET ? BRACKET_DELIM_RE
          : ANGLE_DELIM_RE

    re.lastIndex = pos
    let match
    while ((match = re.exec(source)) !== null) {
      const idx = match.index
      const ch = source.charCodeAt(idx)

      // Handle string/comment/template delimiters
      if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
        pos = idx
        skipString(ch)
        re.lastIndex = pos
        continue
      }
      if (ch === CH_BACKTICK) {
        pos = idx
        skipTemplateLiteral()
        re.lastIndex = pos
        continue
      }
      if (ch === CH_SLASH) {
        pos = idx
        if (skipNonCode()) {
          re.lastIndex = pos
          continue
        }
        // Division operator — skip it
        re.lastIndex = idx + 1
        continue
      }

      if (ch === open) {
        depth++
      }
      else if (ch === close) {
        // Don't match > that's part of => (arrow function)
        if (close === CH_RANGLE && idx > 0 && source.charCodeAt(idx - 1) === CH_EQUAL) {
          re.lastIndex = idx + 1
          continue
        }
        depth--
        if (depth === 0) {
          pos = idx + 1
          return pos
        }
      }
      re.lastIndex = idx + 1
    }
    pos = len
    return pos
  }

  /** Check if > at current pos is part of => (arrow function) */
  function isArrowGT(): boolean {
    return pos > 0 && source.charCodeAt(pos - 1) === CH_EQUAL
  }

  /** Skip to statement end (semicolon at depth 0, matching brace, or ASI) */
  const STMT_DELIM_RE = /[{};'"`\/\n\r]/g
  function skipToStatementEnd(): void {
    let braceDepth = 0
    STMT_DELIM_RE.lastIndex = pos
    let match
    while ((match = STMT_DELIM_RE.exec(source)) !== null) {
      const idx = match.index
      const ch = source.charCodeAt(idx)

      if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
        pos = idx
        skipString(ch)
        STMT_DELIM_RE.lastIndex = pos
        continue
      }
      if (ch === CH_BACKTICK) {
        pos = idx
        skipTemplateLiteral()
        STMT_DELIM_RE.lastIndex = pos
        continue
      }
      if (ch === CH_SLASH) {
        pos = idx
        if (skipNonCode()) {
          STMT_DELIM_RE.lastIndex = pos
          continue
        }
        STMT_DELIM_RE.lastIndex = idx + 1
        continue
      }

      if (ch === CH_LBRACE) {
        braceDepth++
        STMT_DELIM_RE.lastIndex = idx + 1
        continue
      }
      if (ch === CH_RBRACE) {
        braceDepth--
        if (braceDepth <= 0) { pos = idx + 1; return }
        STMT_DELIM_RE.lastIndex = idx + 1
        continue
      }
      if (ch === CH_SEMI && braceDepth === 0) { pos = idx + 1; return }
      // ASI: newline at brace depth 0 + keyword = end of statement
      if ((ch === CH_LF || ch === CH_CR) && braceDepth === 0) {
        pos = idx
        if (checkASITopLevel()) return
      }
      STMT_DELIM_RE.lastIndex = idx + 1
    }
    pos = len
  }

  /**
   * Skip an export re-export: { ... } [from '...'] [;]
   * pos should be at the opening {
   */
  function skipExportBraces(): void {
    findMatchingClose(CH_LBRACE, CH_RBRACE)
    // Only skip whitespace (not comments) to find 'from' — comments belong to next declaration
    while (pos < len && isWhitespace(source.charCodeAt(pos))) pos++
    if (matchWord('from')) {
      pos += 4
      while (pos < len && isWhitespace(source.charCodeAt(pos))) pos++
      if (pos < len) {
        const ch = source.charCodeAt(pos)
        if (ch === CH_SQUOTE || ch === CH_DQUOTE)
          skipString(ch)
      }
    }
    while (pos < len && (source.charCodeAt(pos) === CH_SPACE || source.charCodeAt(pos) === CH_TAB)) pos++
    if (pos < len && source.charCodeAt(pos) === CH_SEMI)
      pos++
  }

  /**
   * Skip an export star: * [as name] from '...' [;]
   * pos should be at *
   */
  function skipExportStar(): void {
    pos++ // skip *
    while (pos < len && isWhitespace(source.charCodeAt(pos))) pos++
    if (matchWord('as')) {
      pos += 2
      while (pos < len && isWhitespace(source.charCodeAt(pos))) pos++
      readIdent()
      while (pos < len && isWhitespace(source.charCodeAt(pos))) pos++
    }
    if (matchWord('from')) {
      pos += 4
      while (pos < len && isWhitespace(source.charCodeAt(pos))) pos++
      if (pos < len) {
        const ch = source.charCodeAt(pos)
        if (ch === CH_SQUOTE || ch === CH_DQUOTE)
          skipString(ch)
      }
    }
    while (pos < len && (source.charCodeAt(pos) === CH_SPACE || source.charCodeAt(pos) === CH_TAB)) pos++
    if (pos < len && source.charCodeAt(pos) === CH_SEMI)
      pos++
  }

  /** Extract leading JSDoc/block/single-line comments before position */
  function extractLeadingComments(declStart: number): string[] | undefined {
    if (!keepComments)
      return undefined

    // Scan backwards from declStart efficiently (no slice/split)
    let p = declStart - 1

    // Skip whitespace/newlines backwards
    while (p >= 0 && isWhitespace(source.charCodeAt(p))) p--
    if (p < 0)
      return undefined

    const comments: string[] = []
    let hasBlockComment = false

    // Scan backwards for consecutive comment blocks
    // Use push() + reverse at end (O(1) per append vs O(n) for unshift)
    while (p >= 0) {
      // Check for block comment ending with */
      if (p >= 1 && source.charCodeAt(p) === CH_SLASH && source.charCodeAt(p - 1) === CH_STAR) {
        // Find matching /* or /**
        const start = source.lastIndexOf('/*', p - 2)
        if (start >= 0) {
          comments.push(source.slice(start, p + 1))
          hasBlockComment = true
          p = start - 1
          while (p >= 0 && isWhitespace(source.charCodeAt(p))) p--
          continue
        }
        break
      }

      // Check for single-line comment(s)
      // Find start of current line
      let lineStart = p
      while (lineStart > 0 && source.charCodeAt(lineStart - 1) !== CH_LF) lineStart--
      const lineText = sliceTrimmed(lineStart, p + 1)

      if (lineText.startsWith('//')) {
        // Don't include // comments above block comments (they're section headers, not doc comments)
        if (hasBlockComment)
          break

        // Collect consecutive single-line comments (push + reverse)
        const singleLines: string[] = [lineText]
        p = lineStart - 1
        while (p >= 0 && (source.charCodeAt(p) === CH_LF || source.charCodeAt(p) === CH_CR)) p--
        // Check for more single-line comments above
        while (p >= 0) {
          let ls = p
          while (ls > 0 && source.charCodeAt(ls - 1) !== CH_LF) ls--
          const lt = sliceTrimmed(ls, p + 1)
          if (lt.startsWith('//')) {
            singleLines.push(lt)
            p = ls - 1
            while (p >= 0 && (source.charCodeAt(p) === CH_LF || source.charCodeAt(p) === CH_CR)) p--
          }
          else if (lt === '') {
            p = ls - 1
            while (p >= 0 && (source.charCodeAt(p) === CH_LF || source.charCodeAt(p) === CH_CR)) p--
          }
          else {
            break
          }
        }
        singleLines.reverse()
        comments.push(singleLines.join('\n'))
        continue
      }

      // Not a comment, stop
      break
    }

    if (comments.length === 0) return undefined
    comments.reverse()
    return comments
  }

  // --- High-level extraction ---

  /** Extract import statement text from current position */
  function extractImport(start: number): Declaration {
    const stmtStart = start
    // Scan to semicolon or end of statement (handle ASI - no semicolons)
    // Imports end after the module specifier string: from '...' or import '...'
    let foundQuote = false
    while (pos < len) {
      const ch = source.charCodeAt(pos)
      if (ch === CH_SEMI) { pos++; break }
      if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
        skipString(ch)
        foundQuote = true
        // After closing quote of module specifier, the import is done
        // Skip optional semicolon and stop
        while (pos < len && (source.charCodeAt(pos) === CH_SPACE || source.charCodeAt(pos) === CH_TAB)) pos++
        if (pos < len && source.charCodeAt(pos) === CH_SEMI)
          pos++
        break
      }
      if (ch === CH_LF && foundQuote)
        break // ASI after quote
      pos++
    }

    const text = sliceTrimmed(stmtStart, pos)
    const isTypeOnly = text.charCodeAt(7) === 116 /* t */ && (text.startsWith('import type ') || text.startsWith('import type{'))

    // Detect side-effect imports: import 'foo' or import "foo" (no names imported)
    // After 'import' + optional 'type', next non-ws must be a quote
    let isSideEffectImport = false
    {
      let si = 6 // skip 'import'
      while (si < text.length && (text.charCodeAt(si) === CH_SPACE || text.charCodeAt(si) === CH_TAB)) si++
      if (si < text.length && text.charCodeAt(si) === 116 /* t */ && text.startsWith('type', si)) {
        si += 4
        while (si < text.length && (text.charCodeAt(si) === CH_SPACE || text.charCodeAt(si) === CH_TAB)) si++
      }
      if (si < text.length) {
        const qc = text.charCodeAt(si)
        isSideEffectImport = qc === CH_SQUOTE || qc === CH_DQUOTE
      }
    }

    // Extract source module: find 'from' or direct quote after import
    let moduleSrc = ''
    {
      const fromIdx = text.indexOf('from ')
      if (fromIdx !== -1) {
        let mi = fromIdx + 5
        while (mi < text.length && (text.charCodeAt(mi) === CH_SPACE || text.charCodeAt(mi) === CH_TAB)) mi++
        if (mi < text.length) {
          const q = text.charCodeAt(mi)
          if (q === CH_SQUOTE || q === CH_DQUOTE) {
            const end = text.indexOf(String.fromCharCode(q), mi + 1)
            if (end !== -1) moduleSrc = text.slice(mi + 1, end)
          }
        }
      }
      else if (isSideEffectImport) {
        // import 'module' — find the quote
        let mi = 6
        while (mi < text.length && text.charCodeAt(mi) !== CH_SQUOTE && text.charCodeAt(mi) !== CH_DQUOTE) mi++
        if (mi < text.length) {
          const q = text.charCodeAt(mi)
          const end = text.indexOf(String.fromCharCode(q), mi + 1)
          if (end !== -1) moduleSrc = text.slice(mi + 1, end)
        }
      }
    }

    const comments = extractLeadingComments(stmtStart)

    return {
      kind: 'import',
      name: '',
      text,
      isExported: false,
      isTypeOnly,
      isSideEffect: isSideEffectImport,
      source: moduleSrc,
      leadingComments: comments,
      start: stmtStart,
      end: pos,
    }
  }

  /**
   * Extract a brace-enclosed block as text from current position.
   * pos should be at the opening brace.
   */
  function extractBraceBlock(): string {
    const blockStart = pos
    findMatchingClose(CH_LBRACE, CH_RBRACE)
    return source.slice(blockStart, pos)
  }

  /** Clean default values from method parameters in an interface/body member line.
   *  e.g. `doSomething(config: SomeType = {}): void` -> `doSomething(config?: SomeType): void`
   *  Only processes if the line contains `= ` inside parentheses (fast bail-out). */
  function cleanMemberLineDefaults(line: string): string {
    // Quick check: does the line have a `(` and contain `=` inside parens?
    const parenOpen = line.indexOf('(')
    if (parenOpen === -1) return line
    const parenSection = line.slice(parenOpen)
    if (parenSection.indexOf('=') === -1) return line
    // Also skip if the only `=` is `=>` (arrow in return type)
    // Check if there's a real assignment `=` (not `=>`, `==`, `>=`, `<=`)
    let hasRealEqual = false
    for (let i = 0; i < parenSection.length; i++) {
      const ch = parenSection.charCodeAt(i)
      if (ch === 61 /* = */) {
        const prev = i > 0 ? parenSection.charCodeAt(i - 1) : 0
        const next = i + 1 < parenSection.length ? parenSection.charCodeAt(i + 1) : 0
        if (prev !== 61 && prev !== 33 && prev !== 60 && prev !== 62 && next !== 61 && next !== 62) {
          hasRealEqual = true
          break
        }
      }
    }
    if (!hasRealEqual) return line

    // Find the matching closing paren for the parameter list
    let depth = 0
    let parenClose = -1
    for (let i = parenOpen; i < line.length; i++) {
      const ch = line.charCodeAt(i)
      if (ch === 40 /* ( */) depth++
      else if (ch === 41 /* ) */) {
        depth--
        if (depth === 0) { parenClose = i; break }
      }
    }
    if (parenClose === -1) return line

    // Extract and rebuild the parameter list using buildDtsParams
    const rawParams = line.slice(parenOpen, parenClose + 1)
    const cleanedParams = buildDtsParams(rawParams)
    return line.slice(0, parenOpen) + cleanedParams + line.slice(parenClose + 1)
  }

  /** Strip inline comments from a brace block and normalize indentation */
  function cleanBraceBlock(raw: string): string {
    // Fast path: if no comment markers (// or /*), skip comment detection logic
    const hasComments = raw.indexOf('//') !== -1 || raw.indexOf('/*') !== -1

    // Strip standalone comment lines and inline trailing comments, preserve relative indentation
    // Pass 1: filter + compute min indent simultaneously
    const lines = raw.split('\n')
    const filtered: string[] = []
    const trimCache: string[] = [] // cache trimmed versions
    const indentCache: number[] = [] // cache indent levels
    let inBlockComment = false
    let minIndent = Infinity

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (hasComments) {
        if (inBlockComment) {
          if (line.includes('*/'))
            inBlockComment = false
          continue
        }

        const trimmed = line.trim()

        // Skip standalone comment lines
        if (trimmed.length === 0) continue
        const ch0 = trimmed.charCodeAt(0)
        if (ch0 === CH_SLASH) {
          const ch1 = trimmed.charCodeAt(1)
          if (ch1 === CH_SLASH) continue // //
          if (ch1 === CH_STAR) { // /* or /**
            if (!trimmed.includes('*/'))
              inBlockComment = true
            continue
          }
        }
        if (ch0 === CH_STAR) continue

        // Remove trailing inline comments without regex
        let cleaned = stripTrailingComment(line)
        // Strip trailing semicolons from member lines (DTS convention for interfaces)
        if (cleaned.charCodeAt(cleaned.length - 1) === CH_SEMI)
          cleaned = cleaned.slice(0, -1)
        // Strip default values from method parameters in interface members
        cleaned = cleanMemberLineDefaults(cleaned)
        const ct = cleaned.trim()
        if (!ct) continue

        filtered.push(cleaned)
        trimCache.push(ct)

        // Compute indent simultaneously
        let iw = 0
        while (iw < cleaned.length && isWhitespace(cleaned.charCodeAt(iw))) iw++
        if (ct !== '{' && ct !== '}') {
          if (iw < minIndent) minIndent = iw
        }
        indentCache.push(iw)
      }
      else {
        // No comments — skip comment detection and stripTrailingComment
        // Just trim trailing whitespace (what stripTrailingComment does when no comments)
        let end = line.length
        while (end > 0 && (line.charCodeAt(end - 1) === CH_SPACE || line.charCodeAt(end - 1) === CH_TAB || line.charCodeAt(end - 1) === CH_CR)) end--
        if (end === 0) continue // empty line
        let cleaned = end < line.length ? line.slice(0, end) : line
        // Strip trailing semicolons
        if (cleaned.charCodeAt(cleaned.length - 1) === CH_SEMI)
          cleaned = cleaned.slice(0, -1)
        // Strip default values from method parameters in interface members
        cleaned = cleanMemberLineDefaults(cleaned)
        const ct = cleaned.trim()
        if (!ct) continue

        filtered.push(cleaned)
        trimCache.push(ct)

        let iw = 0
        while (iw < cleaned.length && isWhitespace(cleaned.charCodeAt(iw))) iw++
        if (ct !== '{' && ct !== '}') {
          if (iw < minIndent) minIndent = iw
        }
        indentCache.push(iw)
      }
    }

    if (filtered.length === 0)
      return '{}'

    if (minIndent === Infinity || minIndent <= 2)
      return filtered.join('\n') // Already at correct indent

    // Pass 2: re-indent using cached values
    const offset = minIndent - 2
    const rebased: string[] = new Array(filtered.length)
    for (let i = 0; i < filtered.length; i++) {
      const t = trimCache[i]
      if (t === '{') {
        rebased[i] = t
        continue
      }
      const currentIndent = indentCache[i]
      if (currentIndent > minIndent) {
        rebased[i] = filtered[i]
      }
      else if (currentIndent === minIndent && (t.charCodeAt(0) === CH_RBRACE || t.charCodeAt(0) === CH_RBRACKET || t.charCodeAt(0) === CH_RPAREN)) {
        rebased[i] = filtered[i]
      }
      else {
        const newIndent = Math.max(0, currentIndent - offset)
        rebased[i] = ' '.repeat(newIndent) + t
      }
    }

    return rebased.join('\n')
  }

  /** Extract type parameters <...> (normalized to single line) */
  function extractGenerics(): string {
    if (pos >= len || source.charCodeAt(pos) !== CH_LANGLE)
      return ''
    const start = pos
    findMatchingClose(CH_LANGLE, CH_RANGLE)
    const raw = source.slice(start, pos)
    // Normalize multi-line generics to single line (avoid regex)
    if (raw.includes('\n')) {
      // Collapse whitespace/newlines to single spaces
      let result = ''
      let prevSpace = false
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i)
        if (c === 32 || c === 9 || c === 10 || c === 13) {
          if (!prevSpace && result.length > 0) { result += ' '; prevSpace = true }
        }
        else {
          result += raw[i]
          prevSpace = false
        }
      }
      // Trim spaces around < and >
      if (result.charCodeAt(1) === 32) result = `<${result.slice(2)}`
      if (result.charCodeAt(result.length - 2) === 32) result = `${result.slice(0, -2)}>`
      return result
    }
    return raw
  }

  /** Extract parameter list (...) as raw text */
  function extractParamList(): string {
    if (pos >= len || source.charCodeAt(pos) !== CH_LPAREN)
      return '()'
    const start = pos
    findMatchingClose(CH_LPAREN, CH_RPAREN)
    return source.slice(start, pos)
  }

  /**
   * Build DTS-safe parameter text from raw parameter text.
   * Removes default values and handles destructuring.
   */
  function buildDtsParams(rawParams: string): string {
    // Strip outer parens
    const inner = rawParams.slice(1, -1).trim()
    if (!inner)
      return '()'

    // Fast path: if params are already in DTS-safe form, return as-is
    // Requirements: no newlines in raw string, all params typed (have ':'), no destructuring/defaults/decorators/rest/modifiers
    if (rawParams.indexOf('\n') === -1 && inner.indexOf(':') !== -1
      && inner.indexOf('{') === -1 && inner.indexOf('[') === -1 && inner.indexOf('=') === -1
      && inner.indexOf('@') === -1 && inner.indexOf('...') === -1) {
      // Verify every param has a type annotation: count colons at depth 0 vs commas at depth 0
      let colons = 0
      let commas = 0
      let depth = 0
      for (let fi = 0; fi < inner.length; fi++) {
        const fc = inner.charCodeAt(fi)
        if (fc === CH_LPAREN || fc === CH_LANGLE || fc === CH_LBRACE) depth++
        else if (fc === CH_RPAREN || fc === CH_RANGLE || fc === CH_RBRACE) depth--
        else if (depth === 0) {
          if (fc === CH_COLON) colons++
          else if (fc === CH_COMMA) commas++
        }
      }
      // Every param needs at least one colon (commas + 1 params)
      if (colons >= commas + 1) {
        let hasModifier = false
        for (let m = 0; m < PARAM_MODIFIERS.length; m++) {
          const mod = PARAM_MODIFIERS[m]
          const modIdx = inner.indexOf(mod)
          if (modIdx !== -1) {
            const afterIdx = modIdx + mod.length
            if ((modIdx === 0 || !isIdentChar(inner.charCodeAt(modIdx - 1)))
              && (afterIdx >= inner.length || !isIdentChar(inner.charCodeAt(afterIdx)))) {
              hasModifier = true
              break
            }
          }
        }
        if (!hasModifier) return rawParams
      }
    }

    // Split parameters by comma at depth 0
    const params: string[] = []
    let paramStart = 0
    let depth = 0
    let inStr = false
    let strCh = 0

    for (let i = 0; i <= inner.length; i++) {
      if (i === inner.length) {
        params.push(inner.slice(paramStart).trim())
        break
      }
      const ch = inner.charCodeAt(i)
      if (inStr) {
        if (ch === CH_BACKSLASH) { i++; continue }
        if (ch === strCh)
          inStr = false
        continue
      }
      if (ch === CH_SQUOTE || ch === CH_DQUOTE || ch === CH_BACKTICK) {
        inStr = true
        strCh = ch
        continue
      }
      if (ch === CH_LPAREN || ch === CH_LBRACE || ch === CH_LBRACKET || ch === CH_LANGLE) {
        depth++
      }
      else if (ch === CH_RPAREN || ch === CH_RBRACE || ch === CH_RBRACKET || (ch === CH_RANGLE && !(i > 0 && inner.charCodeAt(i - 1) === CH_EQUAL))) {
        depth--
      }
      else if (ch === CH_COMMA && depth === 0) {
        params.push(inner.slice(paramStart, i).trim())
        paramStart = i + 1
      }
    }

    const dtsParams: string[] = []
    for (const param of params) {
      if (!param)
        continue
      dtsParams.push(buildSingleDtsParam(param))
    }

    return `(${dtsParams.join(', ')})`
  }

  /** Clean a destructured parameter name: strip defaults and rest operators */
  function cleanDestructuredName(name: string): string {
    if (!name.startsWith('{') && !name.startsWith('['))
      return name

    let result = ''
    let i = 0
    let depth = 0
    let inStr = false
    let strCh = 0

    while (i < name.length) {
      const ch = name.charCodeAt(i)

      if (inStr) {
        if (ch === CH_BACKSLASH && i + 1 < name.length) { result += name[i] + name[i + 1]; i += 2; continue }
        if (ch === strCh)
          inStr = false
        result += name[i]; i++; continue
      }
      if (ch === CH_SQUOTE || ch === CH_DQUOTE || ch === CH_BACKTICK) {
        inStr = true; strCh = ch
        result += name[i]; i++; continue
      }

      if (ch === CH_LBRACE || ch === CH_LBRACKET || ch === CH_LPAREN)
        depth++
      else if (ch === CH_RBRACE || ch === CH_RBRACKET || ch === CH_RPAREN)
        depth--

      // At depth 1+, strip `= <default>` by skipping until , or closing bracket
      if (depth >= 1 && ch === CH_EQUAL
        && (i + 1 >= name.length || (name.charCodeAt(i + 1) !== CH_EQUAL && name.charCodeAt(i + 1) !== CH_RANGLE))) {
        // Also strip preceding whitespace
        while (result.length > 0 && (result[result.length - 1] === ' ' || result[result.length - 1] === '\t' || result[result.length - 1] === '\n'))
          result = result.slice(0, -1)
        // Skip the default value
        i++
        let skipDepth = 0
        while (i < name.length) {
          const sc = name.charCodeAt(i)
          if (sc === CH_SQUOTE || sc === CH_DQUOTE || sc === CH_BACKTICK) {
            const q = sc; i++
            while (i < name.length) {
              if (name.charCodeAt(i) === CH_BACKSLASH) { i += 2; continue }
              if (name.charCodeAt(i) === q) { i++; break }
              i++
            }
            continue
          }
          if (sc === CH_LBRACE || sc === CH_LBRACKET || sc === CH_LPAREN) {
            skipDepth++
          }
          else if (sc === CH_RBRACE || sc === CH_RBRACKET || sc === CH_RPAREN) {
            if (skipDepth === 0)
              break
            skipDepth--
          }
          else if (sc === CH_COMMA && skipDepth === 0) {
            break
          }
          i++
        }
        continue
      }

      // At depth 1, strip `...` rest operator
      if (depth === 1 && ch === CH_DOT && i + 2 < name.length
        && name.charCodeAt(i + 1) === CH_DOT && name.charCodeAt(i + 2) === CH_DOT) {
        i += 3
        continue
      }

      result += name[i]
      i++
    }

    return result
  }

  /** Build a single DTS parameter from raw source text */
  function buildSingleDtsParam(raw: string): string {
    let p = raw.trim()

    // Handle rest parameter
    const isRest = p.startsWith('...')
    if (isRest)
      p = p.slice(3).trim()

    // Handle decorators (skip @... before param)
    while (p.startsWith('@')) {
      // Skip decorator and its argument
      let di = 1
      while (di < p.length && isIdentChar(p.charCodeAt(di))) di++
      if (di < p.length && p.charCodeAt(di) === CH_LPAREN) {
        let dd = 1
        di++
        while (di < p.length && dd > 0) {
          if (p.charCodeAt(di) === CH_LPAREN)
            dd++
          else if (p.charCodeAt(di) === CH_RPAREN)
            dd--
          di++
        }
      }
      p = p.slice(di).trim()
    }

    // Strip TypeScript constructor parameter modifiers (these only appear in constructor params)
    // Loop to handle stacked modifiers like `public readonly x: number`
    let strippedMod = true
    while (strippedMod) {
      strippedMod = false
      for (const mod of PARAM_MODIFIERS) {
        if (p.startsWith(mod) && p.length > mod.length && !isIdentChar(p.charCodeAt(mod.length))) {
          p = p.slice(mod.length).trim()
          strippedMod = true
          break
        }
      }
    }

    // Split into name, type annotation, and default value
    // Need to find `:` and `=` at depth 0
    let colonIdx = -1
    let equalIdx = -1
    let depth = 0
    let inStr2 = false
    let strCh2 = 0

    for (let i = 0; i < p.length; i++) {
      const ch = p.charCodeAt(i)
      if (inStr2) {
        if (ch === CH_BACKSLASH) { i++; continue }
        if (ch === strCh2)
          inStr2 = false
        continue
      }
      if (ch === CH_SQUOTE || ch === CH_DQUOTE || ch === CH_BACKTICK) {
        inStr2 = true
        strCh2 = ch
        continue
      }
      if (ch === CH_LPAREN || ch === CH_LBRACE || ch === CH_LBRACKET || ch === CH_LANGLE) {
        depth++
      }
      else if (ch === CH_RPAREN || ch === CH_RBRACE || ch === CH_RBRACKET || (ch === CH_RANGLE && !(i > 0 && p.charCodeAt(i - 1) === CH_EQUAL))) {
        depth--
      }
      else if (depth === 0) {
        if (ch === CH_COLON && colonIdx === -1) {
          colonIdx = i
        }
        else if (ch === CH_EQUAL && equalIdx === -1 && (i === 0 || p.charCodeAt(i - 1) !== CH_EQUAL) && (i + 1 >= p.length || (p.charCodeAt(i + 1) !== CH_EQUAL && p.charCodeAt(i + 1) !== CH_RANGLE))) {
          equalIdx = i
        }
      }
    }

    let name: string
    let type: string
    const hasDefault = equalIdx !== -1

    if (colonIdx !== -1 && (equalIdx === -1 || colonIdx < equalIdx)) {
      name = p.slice(0, colonIdx).trim()
      if (equalIdx !== -1) {
        type = p.slice(colonIdx + 1, equalIdx).trim()
      }
      else {
        type = p.slice(colonIdx + 1).trim()
      }
    }
    else if (equalIdx !== -1) {
      name = p.slice(0, equalIdx).trim()
      type = inferTypeFromDefault(p.slice(equalIdx + 1).trim())
    }
    else {
      name = p
      type = 'unknown'
    }

    // Clean destructured parameter names (strip defaults, rest operators)
    name = cleanDestructuredName(name)
    if ((name.startsWith('{') || name.startsWith('[')) && name.includes('\n')) {
      // Collapse to single line only if short enough, otherwise normalize indent
      const collapsed = name.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ')
      if (collapsed.length <= 40) {
        name = collapsed
      }
      else {
        // Normalize to 2-space indent per line, keep braces unindented
        const lines = name.split('\n')
        name = lines.map((l) => {
          const t = l.trim()
          if (!t)
            return ''
          if (t === '{' || t === '}' || t === '[' || t === ']' || t.startsWith('}') || t.startsWith(']'))
            return t
          return `  ${t}`
        }).join('\n')
      }
    }

    // Handle optional marker
    const isOptional = name.endsWith('?') || hasDefault
    if (name.endsWith('?'))
      name = name.slice(0, -1).trim()
    const optionalMarker = isOptional && !isRest ? '?' : ''

    if (isRest) {
      return `...${name}: ${type}`
    }
    return `${name}${optionalMarker}: ${type}`
  }

  /** Check if string is a numeric literal (integer or decimal, optionally negative) */
  function isNumericLiteral(v: string): boolean {
    let i = 0
    if (i < v.length && v.charCodeAt(i) === 45 /* - */) i++
    if (i >= v.length) return false
    const c = v.charCodeAt(i)
    if (c < 48 || c > 57) return false // not a digit
    while (i < v.length && v.charCodeAt(i) >= 48 && v.charCodeAt(i) <= 57) i++
    if (i < v.length && v.charCodeAt(i) === 46 /* . */) {
      i++
      if (i >= v.length || v.charCodeAt(i) < 48 || v.charCodeAt(i) > 57) return false
      while (i < v.length && v.charCodeAt(i) >= 48 && v.charCodeAt(i) <= 57) i++
    }
    return i === v.length
  }

  /** Infer type from a default value expression (simple cases) */
  function inferTypeFromDefault(value: string): string {
    const v = value.trim()
    if (v === 'true' || v === 'false')
      return 'boolean'
    if (isNumericLiteral(v))
      return 'number'
    if ((v.startsWith('\'') && v.endsWith('\'')) || (v.startsWith('"') && v.endsWith('"')))
      return 'string'
    if (v.startsWith('['))
      return 'unknown[]'
    if (v.startsWith('{'))
      return 'Record<string, unknown>'
    return 'unknown'
  }

  /** Infer literal type from initializer value (for const-like / static readonly) */
  function inferLiteralType(value: string): string {
    const v = value.trim()
    if (v === 'true' || v === 'false')
      return v
    if (isNumericLiteral(v))
      return v
    if ((v.startsWith('\'') && v.endsWith('\'')) || (v.startsWith('"') && v.endsWith('"')))
      return v
    return 'unknown'
  }

  /** Extract type from `as Type` assertion in initializer */
  function extractAssertion(initText: string): string | null {
    if (initText.endsWith('as const'))
      return null
    // Find last ' as ' at depth 0 (not nested inside brackets/braces/parens)
    let depth = 0
    let lastAsIdx = -1
    for (let i = 0; i < initText.length; i++) {
      const ch = initText.charCodeAt(i)
      if (ch === 123 /* { */ || ch === 91 /* [ */ || ch === 40 /* ( */) depth++
      else if (ch === 125 /* } */ || ch === 93 /* ] */ || ch === 41 /* ) */) depth--
      else if (depth === 0 && ch === 32 /* space */ && i + 4 <= initText.length && initText.substring(i, i + 4) === ' as ') {
        lastAsIdx = i
      }
    }
    if (lastAsIdx === -1) return null
    const afterAs = initText.slice(lastAsIdx + 4).trim()
    return afterAs || null
  }

  /** Extract return type annotation `: ReturnType` after params, before `{` or `;` */
  function extractReturnType(): string {
    skipWhitespaceAndComments()
    if (pos < len && source.charCodeAt(pos) === CH_COLON) {
      pos++ // skip :
      skipWhitespaceAndComments()
      const start = pos
      // Read type, respecting nesting. Track {/} in depth when part of type (object literal types).
      let depth = 0
      while (pos < len) {
        if (skipNonCode())
          continue
        const ch = source.charCodeAt(pos)
        if (ch === CH_LPAREN || ch === CH_LBRACKET || ch === CH_LANGLE) {
          depth++
        }
        else if (ch === CH_RPAREN || ch === CH_RBRACKET || (ch === CH_RANGLE && !isArrowGT())) {
          depth--
        }
        else if (ch === CH_LBRACE) {
          if (depth > 0) {
            // Inside generics/parens/brackets, { is always part of type
            depth++
          }
          else {
            // At depth 0: { is part of return type if it starts the type or follows a type operator
            const textSoFar = sliceTrimmed(start, pos)
            const endsWithWord = (w: string) => {
              const idx = textSoFar.length - w.length
              return idx >= 0 && textSoFar.endsWith(w) && (idx === 0 || !isIdentChar(textSoFar.charCodeAt(idx - 1)))
            }
            if (textSoFar.length === 0 || textSoFar.endsWith('|') || textSoFar.endsWith('&') || endsWithWord('is') || endsWithWord('extends')) {
              depth++
            }
            else {
              break // function body
            }
          }
        }
        else if (ch === CH_RBRACE) {
          if (depth === 0)
            break
          depth--
        }
        else if (depth === 0 && ch === CH_SEMI) {
          break
        }
        if (depth === 0 && checkASIMember())
          break
        pos++
      }
      return sliceTrimmed(start, pos)
    }
    return ''
  }

  /**
   * Extract a function declaration and build DTS text.
   * pos should be at `function` keyword.
   */
  function extractFunction(declStart: number, isExported: boolean, isAsync: boolean, isDefault: boolean): Declaration | null {
    pos += 8 // skip 'function'
    skipWhitespaceAndComments()

    // Check for generator
    const isGenerator = pos < len && source.charCodeAt(pos) === CH_STAR
    if (isGenerator) { pos++; skipWhitespaceAndComments() }

    // Read name
    const name = readIdent()
    if (!name && !isDefault)
      return null
    skipWhitespaceAndComments()

    // Generics
    const generics = extractGenerics()
    skipWhitespaceAndComments()

    // Parameters
    const rawParams = extractParamList()
    skipWhitespaceAndComments()

    // Return type
    let returnType = extractReturnType()

    // Default return type based on async/generator
    if (!returnType) {
      if (isAsync && isGenerator)
        returnType = 'AsyncGenerator<unknown, void, unknown>'
      else if (isGenerator)
        returnType = 'Generator<unknown, void, unknown>'
      else if (isAsync)
        returnType = 'Promise<void>'
      else returnType = 'void'
    }

    // Skip function body if present
    skipWhitespaceAndComments()
    let hasBody = false
    if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
      hasBody = true
      findMatchingClose(CH_LBRACE, CH_RBRACE)
    }
    else if (pos < len && source.charCodeAt(pos) === CH_SEMI) {
      pos++ // skip ;
    }

    // Build DTS text
    const dtsParams = buildDtsParams(rawParams)
    const text = `${isExported ? 'export ' : ''}declare function ${name || 'default'}${generics}${dtsParams}: ${returnType};`
    const comments = extractLeadingComments(declStart)

    // Record index if this function had a body (implementation signature for overloads)
    if (hasBody) {
      funcBodyIndices.add(declarations.length)
    }

    return {
      kind: 'function',
      name: name || 'default',
      text,
      isExported,
      isDefault,
      isAsync,
      isGenerator,
      returnType,
      generics: generics || undefined,
      leadingComments: comments,
      start: declStart,
      end: pos,
    }
  }

  /**
   * Extract variable declaration(s).
   * pos should be at const/let/var keyword.
   */
  function extractVariable(declStart: number, kind: string, isExported: boolean): Declaration[] {
    pos += kind.length // skip const/let/var
    skipWhitespaceAndComments()

    const results: Declaration[] = []

    // Handle destructuring patterns and multiple declarations
    // For DTS, we only care about the name and type
    do {
      skipWhitespaceAndComments()
      if (pos >= len)
        break

      const ch = source.charCodeAt(pos)

      // Skip destructuring patterns - these are implementation details
      if (ch === CH_LBRACE || ch === CH_LBRACKET) {
        // Can't represent destructuring in DTS, skip this statement
        skipToStatementEnd()
        return results
      }

      const name = readIdent()
      if (!name) { skipToStatementEnd(); return results }
      skipWhitespaceAndComments()

      let typeAnnotation: string | undefined
      let initializerText: string | undefined
      let isAsConst = false

      // Type annotation
      if (pos < len && source.charCodeAt(pos) === CH_COLON) {
        pos++ // skip :
        skipWhitespaceAndComments()
        const typeStart = pos
        // Read type until = or ; or , at depth 0, or ASI
        let depth = 0
        while (pos < len) {
          if (skipNonCode())
            continue
          const tc = source.charCodeAt(pos)
          if (tc === CH_LPAREN || tc === CH_LBRACE || tc === CH_LBRACKET || tc === CH_LANGLE)
            depth++
          else if (tc === CH_RPAREN || tc === CH_RBRACE || tc === CH_RBRACKET || (tc === CH_RANGLE && !isArrowGT()))
            depth--
          else if (depth === 0 && (tc === CH_EQUAL || tc === CH_SEMI || tc === CH_COMMA))
            break
          if (depth === 0 && checkASITopLevel())
            break
          pos++
        }
        typeAnnotation = sliceTrimmed(typeStart, pos)
      }

      // Initializer
      if (pos < len && source.charCodeAt(pos) === CH_EQUAL) {
        // Fast path: with isolatedDeclarations + explicit non-generic type, skip initializer.
        // For generic types (Record<>, Array<>, index sigs), we still parse the initializer
        // to produce narrower inferred types from the value.
        if (isolatedDeclarations && typeAnnotation && !isGenericAnnotation(typeAnnotation)) {
          skipToStatementEnd()
        }
        else {
        pos++ // skip =
        skipWhitespaceAndComments()
        const initStart = pos
        // Read initializer until ; or , at depth 0, or ASI
        let depth = 0
        while (pos < len) {
          if (skipNonCode())
            continue
          const ic = source.charCodeAt(pos)
          if (ic === CH_LPAREN || ic === CH_LBRACE || ic === CH_LBRACKET || ic === CH_LANGLE)
            depth++
          else if (ic === CH_RPAREN || ic === CH_RBRACE || ic === CH_RBRACKET || (ic === CH_RANGLE && !isArrowGT()))
            depth--
          else if (depth === 0 && (ic === CH_SEMI || ic === CH_COMMA))
            break
          if (depth === 0 && checkASITopLevel())
            break
          pos++
        }
        initializerText = sliceTrimmed(initStart, pos)
        if (initializerText.endsWith(' as const') || initializerText === 'const') {
          isAsConst = true
          if (!typeAnnotation) {
            const val = initializerText.endsWith(' as const') ? initializerText.slice(0, -' as const'.length).trim() : initializerText
            const lit = inferLiteralType(val)
            typeAnnotation = lit !== 'unknown' ? lit : undefined
          }
        }
        else if (!typeAnnotation) {
          const asType = extractAssertion(initializerText)
          if (asType)
            typeAnnotation = asType
        }
        } // end else (non-isolatedDeclarations path)
      }

      // Skip comma or semicolon
      if (pos < len) {
        const sc = source.charCodeAt(pos)
        if (sc === CH_COMMA) { pos++; continue }
        if (sc === CH_SEMI) { pos++ }
      }

      const comments = extractLeadingComments(declStart)
      const dtsText = `export declare ${kind} ${name}: ${typeAnnotation || 'unknown'};`

      results.push({
        kind: 'variable',
        name,
        text: dtsText,
        isExported: true,
        typeAnnotation,
        value: initializerText,
        modifiers: isAsConst ? [kind, 'const assertion'] : [kind],
        leadingComments: comments,
        start: declStart,
        end: pos,
      })

      break // For now, only handle first declaration in statement
    } while (pos < len)

    return results
  }

  /**
   * Extract interface declaration.
   * pos should be at 'interface' keyword.
   */
  function extractInterface(declStart: number, isExported: boolean): Declaration {
    pos += 9 // skip 'interface'
    skipWhitespaceAndComments()

    const name = readIdent()
    skipWhitespaceAndComments()

    const generics = extractGenerics()
    skipWhitespaceAndComments()

    // Extends clause
    let extendsClause = ''
    if (matchWord('extends')) {
      pos += 7
      skipWhitespaceAndComments()
      const extStart = pos
      // Read extends types until {
      let depth = 0
      while (pos < len) {
        if (skipNonCode())
          continue
        const ch = source.charCodeAt(pos)
        if (ch === CH_LANGLE)
          depth++
        else if (ch === CH_RANGLE && !isArrowGT())
          depth--
        else if (ch === CH_LBRACE && depth === 0)
          break
        pos++
      }
      extendsClause = sliceTrimmed(extStart, pos)
    }

    // Body
    skipWhitespaceAndComments()
    const rawBody = pos < len && source.charCodeAt(pos) === CH_LBRACE ? extractBraceBlock() : '{}'
    const body = cleanBraceBlock(rawBody)

    // Build DTS text
    const text = `${isExported ? 'export ' : ''}declare interface ${name}${generics}${extendsClause ? ` extends ${extendsClause}` : ''} ${body}`
    const comments = extractLeadingComments(declStart)

    return {
      kind: 'interface',
      name,
      text,
      isExported,
      extends: extendsClause || undefined,
      generics: generics || undefined,
      leadingComments: comments,
      start: declStart,
      end: pos,
    }
  }

  /**
   * Extract type alias declaration.
   * pos should be at 'type' keyword.
   */
  function extractTypeAlias(declStart: number, isExported: boolean): Declaration {
    pos += 4 // skip 'type'
    skipWhitespaceAndComments()

    const name = readIdent()
    skipWhitespaceAndComments()

    const generics = extractGenerics()
    skipWhitespaceAndComments()

    // Skip =
    if (pos < len && source.charCodeAt(pos) === CH_EQUAL)
      pos++
    skipWhitespaceAndComments()

    // Read the type body until ; at depth 0, or ASI
    const typeStart = pos
    let depth = 0
    while (pos < len) {
      if (skipNonCode())
        continue
      const ch = source.charCodeAt(pos)
      if (ch === CH_LPAREN || ch === CH_LBRACE || ch === CH_LBRACKET || ch === CH_LANGLE)
        depth++
      else if (ch === CH_RPAREN || ch === CH_RBRACE || ch === CH_RBRACKET || (ch === CH_RANGLE && !isArrowGT()))
        depth--
      else if (depth === 0 && ch === CH_SEMI)
        break
      if (depth === 0 && checkASITopLevel())
        break
      pos++
    }
    const typeBody = sliceTrimmed(typeStart, pos)
    if (pos < len && source.charCodeAt(pos) === CH_SEMI)
      pos++

    // Build DTS text
    const text = `${isExported ? 'export ' : ''}type ${name}${generics} = ${typeBody}`
    const comments = extractLeadingComments(declStart)

    return {
      kind: 'type',
      name,
      text,
      isExported,
      generics: generics || undefined,
      leadingComments: comments,
      start: declStart,
      end: pos,
    }
  }

  /**
   * Extract enum declaration.
   * pos should be at 'enum' keyword (after optional 'const').
   */
  function extractEnum(declStart: number, isExported: boolean, isConst: boolean): Declaration {
    pos += 4 // skip 'enum'
    skipWhitespaceAndComments()

    const name = readIdent()
    skipWhitespaceAndComments()

    // Extract enum body (raw text)
    const _bodyStart = pos
    if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
      findMatchingClose(CH_LBRACE, CH_RBRACE)
    }

    // Use raw text for the whole enum (extractor does the same for enums)
    const rawText = sliceTrimmed(declStart, pos)
    const comments = extractLeadingComments(declStart)

    return {
      kind: 'enum',
      name,
      text: rawText,
      isExported,
      modifiers: isConst ? ['const'] : undefined,
      leadingComments: comments,
      start: declStart,
      end: pos,
    }
  }

  /**
   * Extract class declaration and build DTS.
   * pos should be at 'class' keyword.
   */
  function extractClass(declStart: number, isExported: boolean, isAbstract: boolean): Declaration {
    pos += 5 // skip 'class'
    skipWhitespaceAndComments()

    const name = readIdent() || 'AnonymousClass'
    skipWhitespaceAndComments()

    const generics = extractGenerics()
    skipWhitespaceAndComments()

    // Extends clause
    let extendsClause = ''
    if (matchWord('extends')) {
      pos += 7
      skipWhitespaceAndComments()
      const extStart = pos
      let depth = 0
      while (pos < len) {
        if (skipNonCode())
          continue
        const ch = source.charCodeAt(pos)
        if (ch === CH_LANGLE)
          depth++
        else if (ch === CH_RANGLE && !isArrowGT())
          depth--
        else if (depth === 0 && (ch === CH_LBRACE || matchWord('implements')))
          break
        pos++
      }
      extendsClause = sliceTrimmed(extStart, pos)
    }

    // Implements clause
    let implementsList: string[] | undefined
    if (matchWord('implements')) {
      pos += 10
      skipWhitespaceAndComments()
      const implStart = pos
      let depth = 0
      while (pos < len) {
        if (skipNonCode())
          continue
        const ch = source.charCodeAt(pos)
        if (ch === CH_LANGLE)
          depth++
        else if (ch === CH_RANGLE && !isArrowGT())
          depth--
        else if (depth === 0 && ch === CH_LBRACE)
          break
        pos++
      }
      const implText = sliceTrimmed(implStart, pos)
      if (implText)
        implementsList = implText.split(',').map(s => s.trim())
    }

    skipWhitespaceAndComments()

    // Extract class body and build DTS members
    const classBody = buildClassBodyDts()

    // Build DTS text
    const text = `${isExported ? 'export ' : ''}declare ${isAbstract ? 'abstract ' : ''}class ${name}${generics}${extendsClause ? ` extends ${extendsClause}` : ''}${implementsList && implementsList.length > 0 ? ` implements ${implementsList.join(', ')}` : ''} ${classBody}`
    const comments = extractLeadingComments(declStart)

    return {
      kind: 'class',
      name,
      text,
      isExported,
      extends: extendsClause || undefined,
      implements: implementsList,
      generics: generics || undefined,
      modifiers: isAbstract ? ['abstract'] : undefined,
      leadingComments: comments,
      start: declStart,
      end: pos,
    }
  }

  /** Build class body DTS (members only, no implementations) */
  function buildClassBodyDts(): string {
    if (pos >= len || source.charCodeAt(pos) !== CH_LBRACE)
      return '{}'

    pos++ // skip {
    const members: string[] = []

    while (pos < len) {
      skipWhitespaceAndComments()
      if (pos >= len)
        break
      if (source.charCodeAt(pos) === CH_RBRACE) { pos++; break }

      // Skip semicolons
      if (source.charCodeAt(pos) === CH_SEMI) { pos++; continue }

      // Skip static blocks
      if (matchWord('static') && peekAfterWord('static') === CH_LBRACE) {
        pos += 6
        skipWhitespaceAndComments()
        findMatchingClose(CH_LBRACE, CH_RBRACE)
        continue
      }

      // Collect modifiers
      let isPrivate = false
      let isProtected = false
      let isStatic = false
      let isAbstract = false
      let isReadonly = false
      let isOverride = false
      let isAccessor = false
      let isAsync = false

      const modLoop = true
      while (modLoop) {
        skipWhitespaceAndComments()
        if (matchWord('private')) { isPrivate = true; pos += 7; continue }
        if (matchWord('protected')) { isProtected = true; pos += 9; continue }
        if (matchWord('public')) { pos += 6; continue }
        if (matchWord('static')) { isStatic = true; pos += 6; continue }
        if (matchWord('abstract')) { isAbstract = true; pos += 8; continue }
        if (matchWord('readonly')) { isReadonly = true; pos += 8; continue }
        if (matchWord('override')) { isOverride = true; pos += 8; continue }
        if (matchWord('accessor')) { isAccessor = true; pos += 8; continue }
        if (matchWord('async')) { isAsync = true; pos += 5; continue }
        if (matchWord('declare')) { pos += 7; continue }
        break
      }

      skipWhitespaceAndComments()
      if (pos >= len || source.charCodeAt(pos) === CH_RBRACE)
        break

      // Skip private identifier members (#field)
      if (source.charCodeAt(pos) === CH_HASH) {
        isPrivate = true
      }

      // Skip private members entirely
      if (isPrivate) {
        // Skip to next member
        skipClassMember()
        continue
      }

      // Build modifier prefix
      let modPrefix = '  '
      if (isProtected)
        modPrefix += 'protected '
      if (isStatic)
        modPrefix += 'static '
      if (isAbstract)
        modPrefix += 'abstract '
      if (isReadonly)
        modPrefix += 'readonly '

      // Detect member type
      if (matchWord('constructor')) {
        pos += 11
        skipWhitespaceAndComments()
        const rawParams = extractParamList()
        skipWhitespaceAndComments()

        // Extract parameter properties (non-private params with modifiers like public/protected/readonly)
        extractParamProperties(rawParams, members)

        // Skip constructor body
        if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
          findMatchingClose(CH_LBRACE, CH_RBRACE)
        }
        else if (pos < len && source.charCodeAt(pos) === CH_SEMI) {
          pos++
        }

        const dtsParams = buildDtsParams(rawParams)
        members.push(`  constructor${dtsParams};`)
      }
      else if (matchWord('get')) {
        pos += 3
        skipWhitespaceAndComments()
        // Check it's actually an accessor (followed by identifier or [)
        if (pos < len && (isIdentStart(source.charCodeAt(pos)) || source.charCodeAt(pos) === CH_LBRACKET || source.charCodeAt(pos) === CH_HASH)) {
          const memberName = readMemberName()
          // Filter private hash accessors (e.g., get #foo())
          if (memberName.startsWith('#')) {
            skipWhitespaceAndComments()
            if (pos < len && source.charCodeAt(pos) === CH_LPAREN)
              extractParamList()
            skipWhitespaceAndComments()
            extractReturnType()
            skipWhitespaceAndComments()
            if (pos < len && source.charCodeAt(pos) === CH_LBRACE)
              findMatchingClose(CH_LBRACE, CH_RBRACE)
            else if (pos < len && source.charCodeAt(pos) === CH_SEMI)
              pos++
            continue
          }
          skipWhitespaceAndComments()
          extractParamList() // empty params for getter
          skipWhitespaceAndComments()
          const retType = extractReturnType() || 'unknown'
          skipWhitespaceAndComments()
          // Skip body
          if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
            findMatchingClose(CH_LBRACE, CH_RBRACE)
          }
          else if (pos < len && source.charCodeAt(pos) === CH_SEMI) {
            pos++
          }
          members.push(`${modPrefix}get ${memberName}(): ${retType};`)
        }
        else {
          // 'get' is used as a method name
          handleMethodOrProperty('get', modPrefix, isStatic, isReadonly, isAsync, members)
        }
      }
      else if (matchWord('set')) {
        pos += 3
        skipWhitespaceAndComments()
        if (pos < len && (isIdentStart(source.charCodeAt(pos)) || source.charCodeAt(pos) === CH_LBRACKET || source.charCodeAt(pos) === CH_HASH)) {
          const memberName = readMemberName()
          // Filter private hash accessors (e.g., set #foo(value))
          if (memberName.startsWith('#')) {
            skipWhitespaceAndComments()
            if (pos < len && source.charCodeAt(pos) === CH_LPAREN)
              extractParamList()
            skipWhitespaceAndComments()
            if (pos < len && source.charCodeAt(pos) === CH_LBRACE)
              findMatchingClose(CH_LBRACE, CH_RBRACE)
            else if (pos < len && source.charCodeAt(pos) === CH_SEMI)
              pos++
            continue
          }
          skipWhitespaceAndComments()
          const rawParams = extractParamList()
          skipWhitespaceAndComments()
          // Skip body
          if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
            findMatchingClose(CH_LBRACE, CH_RBRACE)
          }
          else if (pos < len && source.charCodeAt(pos) === CH_SEMI) {
            pos++
          }
          const dtsParams = buildDtsParams(rawParams)
          members.push(`${modPrefix}set ${memberName}${dtsParams};`)
        }
        else {
          handleMethodOrProperty('set', modPrefix, isStatic, isReadonly, isAsync, members)
        }
      }
      else {
        // Regular method or property
        const isGenerator = source.charCodeAt(pos) === CH_STAR
        if (isGenerator) { pos++; skipWhitespaceAndComments() }

        const memberName = readMemberName()
        if (!memberName) { skipClassMember(); continue }

        handleMethodOrPropertyAfterName(memberName, modPrefix, isStatic, isReadonly, isGenerator, isAbstract, isAsync, members)
      }
    }

    return `{\n${members.join('\n')}\n}`
  }

  /** Read a member name (identifier, computed property [expr], or #private) */
  function readMemberName(): string {
    if (pos >= len)
      return ''
    const ch = source.charCodeAt(pos)
    if (ch === CH_LBRACKET) {
      const start = pos
      findMatchingClose(CH_LBRACKET, CH_RBRACKET)
      return source.slice(start, pos)
    }
    if (ch === CH_HASH) {
      pos++
      return `#${readIdent()}`
    }
    return readIdent()
  }

  /** Peek at what char comes after a word (skipping whitespace) */
  function peekAfterWord(word: string): number {
    let p = pos + word.length
    while (p < len && isWhitespace(source.charCodeAt(p))) p++
    return p < len ? source.charCodeAt(p) : 0
  }

  /** Skip a class member (to next member boundary) */
  function skipClassMember(): void {
    let depth = 0
    while (pos < len) {
      if (skipNonCode())
        continue
      const ch = source.charCodeAt(pos)
      if (ch === CH_LBRACE || ch === CH_LPAREN) {
        depth++
      }
      else if (ch === CH_RBRACE || ch === CH_RPAREN) {
        if (depth === 0)
          return // hit end of class body
        depth--
      }
      else if (ch === CH_SEMI && depth === 0) { pos++; return }
      if (depth === 0 && checkASIMember())
        return
      pos++
    }
  }

  /** Handle a method or property after we know it starts with a name-like word */
  function handleMethodOrProperty(nameWord: string, modPrefix: string, isStatic: boolean, isReadonly: boolean, isAsync: boolean, members: string[]): void {
    handleMethodOrPropertyAfterName(nameWord, modPrefix, isStatic, isReadonly, false, false, isAsync, members)
  }

  /** Handle method or property after reading the member name */
  function handleMethodOrPropertyAfterName(memberName: string, modPrefix: string, isStatic: boolean, isReadonly: boolean, isGenerator: boolean, isAbstract: boolean, isAsync: boolean, members: string[]): void {
    skipWhitespaceAndComments()
    if (pos >= len)
      return

    const ch = source.charCodeAt(pos)

    // Optional marker ?
    let isOptional = false
    if (ch === CH_QUESTION) {
      isOptional = true
      pos++
      skipWhitespaceAndComments()
    }

    // Exclamation mark (definite assignment)
    if (pos < len && source.charCodeAt(pos) === 33) { // !
      pos++
      skipWhitespaceAndComments()
    }

    const nextCh = pos < len ? source.charCodeAt(pos) : 0

    if (nextCh === CH_LPAREN || nextCh === CH_LANGLE) {
      // Method
      const generics = nextCh === CH_LANGLE ? extractGenerics() : ''
      skipWhitespaceAndComments()
      const rawParams = extractParamList()
      skipWhitespaceAndComments()

      let retType = extractReturnType()
      if (!retType) {
        if (isAsync && isGenerator)
          retType = 'AsyncGenerator<unknown, void, unknown>'
        else if (isGenerator)
          retType = 'Generator<unknown, void, unknown>'
        else if (isAsync)
          retType = 'Promise<void>'
        else retType = 'void'
      }

      // Skip method body
      skipWhitespaceAndComments()
      if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
        findMatchingClose(CH_LBRACE, CH_RBRACE)
      }
      else if (pos < len && source.charCodeAt(pos) === CH_SEMI) {
        pos++
      }

      const dtsParams = buildDtsParams(rawParams)
      const optMark = isOptional ? '?' : ''
      const genText = isGenerator ? '*' : ''
      members.push(`${modPrefix}${genText}${memberName}${optMark}${generics}${dtsParams}: ${retType};`)
    }
    else if (nextCh === CH_COLON || nextCh === CH_EQUAL || nextCh === CH_SEMI || nextCh === CH_RBRACE || nextCh === CH_LF || nextCh === CH_CR) {
      // Property
      let type = ''
      if (nextCh === CH_COLON) {
        pos++ // skip :
        skipWhitespaceAndComments()
        const typeStart = pos
        let depth = 0
        while (pos < len) {
          if (skipNonCode())
            continue
          const tc = source.charCodeAt(pos)
          if (tc === CH_LPAREN || tc === CH_LBRACE || tc === CH_LBRACKET || tc === CH_LANGLE) {
            depth++
          }
          else if (tc === CH_RPAREN || tc === CH_RBRACE || tc === CH_RBRACKET || (tc === CH_RANGLE && !isArrowGT())) {
            if (depth === 0)
              break
            depth--
          }
          else if (depth === 0 && (tc === CH_SEMI || tc === CH_EQUAL || tc === CH_COMMA)) {
            break
          }
          if (depth === 0 && checkASIMember())
            break
          pos++
        }
        type = sliceTrimmed(typeStart, pos)
      }

      // Capture initializer
      let initText = ''
      if (pos < len && source.charCodeAt(pos) === CH_EQUAL) {
        // Fast path: with isolatedDeclarations + explicit type, skip initializer entirely
        if (isolatedDeclarations && type) {
          // Skip past = and find ; or end of member
          pos++ // skip =
          let depth = 0
          while (pos < len) {
            if (skipNonCode())
              continue
            const ic = source.charCodeAt(pos)
            if (ic === CH_LPAREN || ic === CH_LBRACE || ic === CH_LBRACKET)
              depth++
            else if (ic === CH_RPAREN || ic === CH_RBRACE || ic === CH_RBRACKET) {
              if (depth === 0 && ic === CH_RBRACE) break
              depth--
            }
            else if (depth === 0 && ic === CH_SEMI) break
            if (depth === 0 && checkASIMember()) break
            pos++
          }
        }
        else {
        pos++ // skip =
        skipWhitespaceAndComments()
        const initStart = pos
        let depth = 0
        while (pos < len) {
          if (skipNonCode())
            continue
          const ic = source.charCodeAt(pos)
          if (ic === CH_LPAREN || ic === CH_LBRACE || ic === CH_LBRACKET) {
            depth++
          }
          else if (ic === CH_RPAREN || ic === CH_RBRACE || ic === CH_RBRACKET) {
            if (depth === 0 && ic === CH_RBRACE)
              break
            depth--
          }
          else if (depth === 0 && ic === CH_SEMI) {
            break
          }
          if (depth === 0 && checkASIMember())
            break
          pos++
        }
        initText = sliceTrimmed(initStart, pos)
        } // end else (non-isolatedDeclarations path)
      }

      if (pos < len && source.charCodeAt(pos) === CH_SEMI)
        pos++

      if (!type) {
        if (initText) {
          const asType = extractAssertion(initText)
          if (asType) {
            type = asType
          }
          else {
            const isConstLike = isStatic && isReadonly
            type = isConstLike ? inferLiteralType(initText) : inferTypeFromDefault(initText)
          }
        }
        else {
          type = 'unknown'
        }
      }

      const optMark = isOptional ? '?' : ''
      members.push(`${modPrefix}${memberName}${optMark}: ${type};`)
    }
    else {
      // Unknown member, skip it
      skipClassMember()
    }
  }

  /** Extract parameter properties from constructor params */
  function extractParamProperties(rawParams: string, members: string[]): void {
    const inner = rawParams.slice(1, -1).trim()
    if (!inner)
      return

    // Simple split by comma at depth 0
    const params: string[] = []
    let start = 0
    let depth = 0
    let inStr = false
    let strCh = 0
    for (let i = 0; i <= inner.length; i++) {
      if (i === inner.length) {
        params.push(inner.slice(start).trim())
        break
      }
      const ch = inner.charCodeAt(i)
      if (inStr) {
        if (ch === CH_BACKSLASH) { i++; continue }
        if (ch === strCh)
          inStr = false
        continue
      }
      if (ch === CH_SQUOTE || ch === CH_DQUOTE || ch === CH_BACKTICK) { inStr = true; strCh = ch; continue }
      if (ch === CH_LPAREN || ch === CH_LBRACE || ch === CH_LBRACKET || ch === CH_LANGLE) {
        depth++
      }
      else if (ch === CH_RPAREN || ch === CH_RBRACE || ch === CH_RBRACKET || (ch === CH_RANGLE && !(i > 0 && inner.charCodeAt(i - 1) === CH_EQUAL))) {
        depth--
      }
      else if (ch === CH_COMMA && depth === 0) {
        params.push(inner.slice(start, i).trim())
        start = i + 1
      }
    }

    for (const param of params) {
      // Check for access modifier keywords
      const hasPublic = param.startsWith('public ') || param.startsWith('public\t')
      const hasProtected = param.startsWith('protected ') || param.startsWith('protected\t')
      const hasPrivate = param.startsWith('private ') || param.startsWith('private\t')
      const hasReadonly = param.includes('readonly ')

      if (!hasPublic && !hasProtected && !hasPrivate && !hasReadonly)
        continue
      if (hasPrivate)
        continue // Skip private parameter properties

      // Extract the modifiers text and parameter info (no regex — use indexOf)
      let p = param
      const mods: string[] = []
      if (hasPublic) {
        let si = 6 // 'public'.length
        while (si < p.length && isWhitespace(p.charCodeAt(si))) si++
        p = p.slice(si)
        mods.push('public')
      }
      if (hasProtected) {
        let si = 9 // 'protected'.length
        while (si < p.length && isWhitespace(p.charCodeAt(si))) si++
        p = p.slice(si)
        mods.push('protected')
      }
      if (hasReadonly) {
        const ri = p.indexOf('readonly ')
        if (ri !== -1) {
          let si = ri + 8 // 'readonly'.length
          while (si < p.length && isWhitespace(p.charCodeAt(si))) si++
          p = p.slice(0, ri) + p.slice(si)
        }
        mods.push('readonly')
      }

      const modText = mods.length > 0 ? `${mods.join(' ')} ` : ''

      // Parse name: type = default
      const dtsParam = buildSingleDtsParam(p)
      members.push(`  ${modText}${dtsParam};`)
    }
  }

  /**
   * Build DTS text for namespace/module body by processing inner declarations.
   * Strips function bodies, processes const types, keeps interfaces/types as-is.
   */
  function buildNamespaceBodyDts(indent: string = '  '): string {
    if (pos >= len || source.charCodeAt(pos) !== CH_LBRACE)
      return '{}'
    pos++ // skip {

    const lines: string[] = []

    while (pos < len) {
      skipWhitespaceAndComments()
      if (pos >= len)
        break
      if (source.charCodeAt(pos) === CH_RBRACE) { pos++; break }
      if (source.charCodeAt(pos) === CH_SEMI) { pos++; continue }

      // Check for export keyword
      let hasExport = false
      if (matchWord('export')) {
        hasExport = true
        pos += 6
        skipWhitespaceAndComments()
      }

      // Check for declare keyword
      if (matchWord('declare')) {
        pos += 7
        skipWhitespaceAndComments()
      }

      const prefix = hasExport ? 'export ' : ''

      if (matchWord('function') || (matchWord('async') && peekAfterKeyword('async', 'function'))) {
        // Function: extract signature, skip body
        let isAsync = false
        if (matchWord('async')) {
          isAsync = true
          pos += 5
          skipWhitespaceAndComments()
        }
        pos += 8 // function
        skipWhitespaceAndComments()
        const isGen = pos < len && source.charCodeAt(pos) === CH_STAR
        if (isGen) { pos++; skipWhitespaceAndComments() }
        const fname = readIdent()
        skipWhitespaceAndComments()
        const generics = extractGenerics()
        skipWhitespaceAndComments()
        const rawParams = extractParamList()
        skipWhitespaceAndComments()
        let retType = extractReturnType()
        if (!retType)
          retType = isAsync ? 'Promise<void>' : 'void'
        skipWhitespaceAndComments()
        if (pos < len && source.charCodeAt(pos) === CH_LBRACE)
          findMatchingClose(CH_LBRACE, CH_RBRACE)
        else if (pos < len && source.charCodeAt(pos) === CH_SEMI)
          pos++
        const dtsParams = buildDtsParams(rawParams)
        lines.push(`${indent}${prefix}function ${fname}${generics}${dtsParams}: ${retType};`)
      }
      else if (matchWord('const') || matchWord('let') || matchWord('var')) {
        const kw = matchWord('const') ? 'const' : matchWord('let') ? 'let' : 'var'
        pos += kw.length
        skipWhitespaceAndComments()
        const vname = readIdent()
        if (!vname) { skipToStatementEnd(); continue }
        skipWhitespaceAndComments()

        let vtype = ''
        if (pos < len && source.charCodeAt(pos) === CH_COLON) {
          pos++
          skipWhitespaceAndComments()
          const ts = pos
          let depth = 0
          while (pos < len) {
            if (skipNonCode())
              continue
            const tc = source.charCodeAt(pos)
            if (tc === CH_LPAREN || tc === CH_LBRACE || tc === CH_LBRACKET || tc === CH_LANGLE)
              depth++
            else if (tc === CH_RPAREN || tc === CH_RBRACE || tc === CH_RBRACKET || (tc === CH_RANGLE && !isArrowGT()))
              depth--
            else if (depth === 0 && (tc === CH_EQUAL || tc === CH_SEMI || tc === CH_COMMA))
              break
            if (depth === 0 && checkASITopLevel())
              break
            pos++
          }
          vtype = sliceTrimmed(ts, pos)
        }

        let initText = ''
        if (pos < len && source.charCodeAt(pos) === CH_EQUAL) {
          pos++
          skipWhitespaceAndComments()
          const is2 = pos
          let depth = 0
          while (pos < len) {
            if (skipNonCode())
              continue
            const ic = source.charCodeAt(pos)
            if (ic === CH_LPAREN || ic === CH_LBRACE || ic === CH_LBRACKET || ic === CH_LANGLE)
              depth++
            else if (ic === CH_RPAREN || ic === CH_RBRACE || ic === CH_RBRACKET || (ic === CH_RANGLE && !isArrowGT()))
              depth--
            else if (depth === 0 && (ic === CH_SEMI || ic === CH_COMMA))
              break
            if (depth === 0 && checkASITopLevel())
              break
            pos++
          }
          initText = sliceTrimmed(is2, pos)
        }
        if (pos < len && source.charCodeAt(pos) === CH_SEMI)
          pos++

        if (!vtype && initText) {
          const asType = extractAssertion(initText)
          if (asType) {
            vtype = asType
          }
          else if (kw === 'const') {
            vtype = inferLiteralType(initText)
          }
          else {
            vtype = inferTypeFromDefault(initText)
          }
        }
        if (!vtype)
          vtype = 'unknown'
        lines.push(`${indent}${prefix}${kw} ${vname}: ${vtype};`)
      }
      else if (matchWord('interface')) {
        pos += 9
        skipWhitespaceAndComments()
        const iname = readIdent()
        skipWhitespaceAndComments()
        const generics = extractGenerics()
        skipWhitespaceAndComments()
        // extends clause
        let ext = ''
        if (matchWord('extends')) {
          const extStart = pos
          while (pos < len && source.charCodeAt(pos) !== CH_LBRACE) {
            if (skipNonCode())
              continue
            pos++
          }
          ext = source.slice(extStart, pos)
        }
        const body = cleanBraceBlock(extractBraceBlock())
        lines.push(`${indent}${prefix}interface ${iname}${generics}${ext} ${body}`)
      }
      else if (matchWord('type')) {
        pos += 4
        skipWhitespaceAndComments()
        const tname = readIdent()
        skipWhitespaceAndComments()
        const generics = extractGenerics()
        skipWhitespaceAndComments()
        if (pos < len && source.charCodeAt(pos) === CH_EQUAL) {
          pos++
          skipWhitespaceAndComments()
          const ts = pos
          let depth = 0
          while (pos < len) {
            if (skipNonCode())
              continue
            const tc = source.charCodeAt(pos)
            if (tc === CH_LPAREN || tc === CH_LBRACE || tc === CH_LBRACKET || tc === CH_LANGLE)
              depth++
            else if (tc === CH_RPAREN || tc === CH_RBRACE || tc === CH_RBRACKET || (tc === CH_RANGLE && !isArrowGT()))
              depth--
            else if (depth === 0 && tc === CH_SEMI)
              break
            if (depth === 0 && checkASITopLevel())
              break
            pos++
          }
          const typeBody = sliceTrimmed(ts, pos)
          if (pos < len && source.charCodeAt(pos) === CH_SEMI)
            pos++
          lines.push(`${indent}${prefix}type ${tname}${generics} = ${typeBody}`)
        }
      }
      else if (matchWord('class')) {
        pos += 5
        skipWhitespaceAndComments()
        const cname = readIdent()
        skipWhitespaceAndComments()
        const generics = extractGenerics()
        skipWhitespaceAndComments()
        const hStart = pos
        while (pos < len && source.charCodeAt(pos) !== CH_LBRACE) {
          if (skipNonCode())
            continue
          pos++
        }
        const heritage = sliceTrimmed(hStart, pos)
        const hText = heritage ? ` ${heritage}` : ''
        const body = buildClassBodyDts()
        lines.push(`${indent}${prefix}class ${cname}${generics}${hText} ${body}`)
      }
      else if (matchWord('enum')) {
        pos += 4
        skipWhitespaceAndComments()
        const ename = readIdent()
        skipWhitespaceAndComments()
        const body = extractBraceBlock()
        lines.push(`${indent}${prefix}enum ${ename} ${body}`)
      }
      else if (matchWord('namespace') || matchWord('module')) {
        const kw = matchWord('namespace') ? 'namespace' : 'module'
        pos += kw.length
        skipWhitespaceAndComments()
        const nname = readIdent()
        skipWhitespaceAndComments()
        const body = buildNamespaceBodyDts(indent)
        lines.push(`${indent}${prefix}${kw} ${nname} ${body}`)
      }
      else if (matchWord('abstract')) {
        // abstract class
        pos += 8
        skipWhitespaceAndComments()
        if (matchWord('class')) {
          pos += 5
          skipWhitespaceAndComments()
          const cname = readIdent()
          skipWhitespaceAndComments()
          const generics = extractGenerics()
          skipWhitespaceAndComments()
          const hStart = pos
          while (pos < len && source.charCodeAt(pos) !== CH_LBRACE) {
            if (skipNonCode())
              continue
            pos++
          }
          const heritage = sliceTrimmed(hStart, pos)
          const hText = heritage ? ` ${heritage}` : ''
          const body = buildClassBodyDts()
          lines.push(`${indent}${prefix}abstract class ${cname}${generics}${hText} ${body}`)
        }
        else {
          skipToStatementEnd()
        }
      }
      else if (hasExport && matchWord('default')) {
        // export default <identifier/expression>;
        pos += 7
        skipWhitespaceAndComments()
        const defStart = pos
        skipToStatementEnd()
        let defText = sliceTrimmed(defStart, pos)
        if (defText.charCodeAt(defText.length - 1) === CH_SEMI) defText = defText.slice(0, -1)
        if (defText) {
          lines.push(`${indent}export default ${defText};`)
        }
      }
      else if (!hasExport && (source.charCodeAt(pos) === CH_SQUOTE || source.charCodeAt(pos) === CH_DQUOTE || source.charCodeAt(pos) === CH_BACKTICK)) {
        // Skip string expression statements like 'use strict'
        skipToStatementEnd()
      }
      else {
        // Unknown declaration or expression, skip
        skipToStatementEnd()
      }
    }

    if (lines.length === 0)
      return '{}'
    return `{\n${lines.join('\n')}\n}`
  }

  /** Peek ahead to check if word2 follows word1 */
  function peekAfterKeyword(word1: string, word2: string): boolean {
    let p = pos + word1.length
    while (p < len && isWhitespace(source.charCodeAt(p))) p++
    for (let i = 0; i < word2.length; i++) {
      if (p + i >= len || source.charCodeAt(p + i) !== word2.charCodeAt(i))
        return false
    }
    return p + word2.length >= len || !isIdentChar(source.charCodeAt(p + word2.length))
  }

  /**
   * Extract module/namespace declaration.
   * pos should be at 'module' or 'namespace' keyword.
   */
  function extractModule(declStart: number, isExported: boolean, keyword: string): Declaration {
    pos += keyword.length // skip module/namespace
    skipWhitespaceAndComments()

    // Read name (could be quoted for ambient modules)
    let name = ''
    const ch = source.charCodeAt(pos)
    if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
      const quoteStart = pos
      skipString(ch)
      name = source.slice(quoteStart, pos)
    }
    else {
      name = readIdent()
      // Handle dotted names (A.B.C)
      while (pos < len && source.charCodeAt(pos) === CH_DOT) {
        pos++
        name += `.${readIdent()}`
      }
    }

    skipWhitespaceAndComments()

    // Body - process inner declarations for DTS
    const body = pos < len && source.charCodeAt(pos) === CH_LBRACE ? buildNamespaceBodyDts() : '{}'

    // Build DTS text
    const text = `${isExported ? 'export ' : ''}declare ${keyword} ${name} ${body}`
    const comments = extractLeadingComments(declStart)
    const isAmbient = name.startsWith('\'') || name.startsWith('"')

    return {
      kind: 'module',
      name,
      text,
      isExported,
      source: isAmbient ? name.slice(1, -1) : undefined,
      leadingComments: comments,
      start: declStart,
      end: pos,
    }
  }

  // --- Main scan loop (first-char dispatch for speed) ---

  while (pos < len) {
    skipWhitespaceAndComments()
    if (pos >= len)
      break

    const stmtStart = pos
    const ch0 = source.charCodeAt(pos)

    // Fast dispatch on first character of keyword
    if (ch0 === 105 /* i */ && matchWord('import')) {
      declarations.push(extractImport(stmtStart))
    }
    else if (ch0 === 101 /* e */ && matchWord('export')) {
      pos += 6 // skip 'export'
      skipWhitespaceAndComments()
      const ech = source.charCodeAt(pos)

      if (ech === 100 /* d */ && matchWord('default')) {
        pos += 7
        skipWhitespaceAndComments()
        const dch = source.charCodeAt(pos)

        if (dch === 102 /* f */ && matchWord('function')) {
          const decl = extractFunction(stmtStart, true, false, true)
          if (decl)
            declarations.push(decl)
        }
        else if (dch === 97 /* a */ && matchWord('async') && peekAfterWord('async') !== CH_SEMI) {
          pos += 5
          skipWhitespaceAndComments()
          if (matchWord('function')) {
            const decl = extractFunction(stmtStart, true, true, true)
            if (decl)
              declarations.push(decl)
          }
          else {
            // export default async expression
            skipToStatementEnd()
            const fullText = sliceTrimmed(stmtStart, pos)
            declarations.push({
              kind: 'export',
              name: 'default',
              text: fullText,
              isExported: true,
              isTypeOnly: false,
              start: stmtStart,
              end: pos,
            })
          }
        }
        else if (dch === 99 /* c */ && matchWord('class')) {
          const decl = extractClass(stmtStart, true, false)
          declarations.push(decl)
        }
        else if (dch === 97 /* a */ && matchWord('abstract')) {
          pos += 8
          skipWhitespaceAndComments()
          if (matchWord('class')) {
            const decl = extractClass(stmtStart, true, true)
            declarations.push(decl)
          }
        }
        else {
          // export default expression
          skipToStatementEnd()
          const text = sliceTrimmed(stmtStart, pos)
          const comments = extractLeadingComments(stmtStart)
          declarations.push({
            kind: 'export',
            name: 'default',
            text,
            isExported: true,
            isTypeOnly: false,
            leadingComments: comments,
            start: stmtStart,
            end: pos,
          })
        }
      }
      else if (ech === 116 /* t */ && matchWord('type')) {
        // Could be `export type Name = ...` or `export type { ... }`
        const savedPos = pos
        pos += 4
        skipWhitespaceAndComments()

        if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
          // export type { ... } from '...'
          skipExportBraces()
          const text = sliceTrimmed(stmtStart, pos)
          const comments = extractLeadingComments(stmtStart)
          declarations.push({
            kind: 'export',
            name: '',
            text,
            isExported: true,
            isTypeOnly: true,
            leadingComments: comments,
            start: stmtStart,
            end: pos,
          })
        }
        else if (pos < len && source.charCodeAt(pos) === CH_STAR) {
          // export type * from '...'
          skipExportStar()
          const text = sliceTrimmed(stmtStart, pos)
          declarations.push({
            kind: 'export',
            name: '',
            text,
            isExported: true,
            isTypeOnly: true,
            start: stmtStart,
            end: pos,
          })
        }
        else {
          // export type Name = ...
          pos = savedPos
          const decl = extractTypeAlias(stmtStart, true)
          declarations.push(decl)
        }
      }
      else if (ech === 105 /* i */ && matchWord('interface')) {
        const decl = extractInterface(stmtStart, true)
        declarations.push(decl)
      }
      else if (ech === 102 /* f */ && matchWord('function')) {
        const decl = extractFunction(stmtStart, true, false, false)
        if (decl)
          declarations.push(decl)
      }
      else if (ech === 97 /* a */ && matchWord('async')) {
        pos += 5
        skipWhitespaceAndComments()
        if (matchWord('function')) {
          const decl = extractFunction(stmtStart, true, true, false)
          if (decl)
            declarations.push(decl)
        }
        else {
          skipToStatementEnd()
        }
      }
      else if (ech === 99 /* c */) {
        if (matchWord('class')) {
          const decl = extractClass(stmtStart, true, false)
          declarations.push(decl)
        }
        else if (matchWord('const')) {
          // Could be 'export const enum' or 'export const ...'
          const savedPos = pos
          pos += 5
          skipWhitespaceAndComments()
          if (matchWord('enum')) {
            pos = savedPos + 5
            skipWhitespaceAndComments()
            const decl = extractEnum(stmtStart, true, true)
            declarations.push(decl)
          }
          else {
            pos = savedPos
            const decls = extractVariable(stmtStart, 'const', true)
            for (let _di = 0; _di < decls.length; _di++) declarations.push(decls[_di])
          }
        }
        else {
          skipToStatementEnd()
        }
      }
      else if (ech === 97 /* a */ && matchWord('abstract')) {
        pos += 8
        skipWhitespaceAndComments()
        if (matchWord('class')) {
          const decl = extractClass(stmtStart, true, true)
          declarations.push(decl)
        }
      }
      else if (ech === 108 /* l */ && matchWord('let')) {
        const decls = extractVariable(stmtStart, 'let', true)
        for (let _di = 0; _di < decls.length; _di++) declarations.push(decls[_di])
      }
      else if (ech === 118 /* v */ && matchWord('var')) {
        const decls = extractVariable(stmtStart, 'var', true)
        for (let _di = 0; _di < decls.length; _di++) declarations.push(decls[_di])
      }
      else if (ech === 101 /* e */ && matchWord('enum')) {
        const decl = extractEnum(stmtStart, true, false)
        declarations.push(decl)
      }
      else if (ech === 100 /* d */ && matchWord('declare')) {
        pos += 7
        skipWhitespaceAndComments()
        // export declare ...
        handleDeclare(stmtStart, true)
      }
      else if (ech === 110 /* n */ && matchWord('namespace')) {
        const decl = extractModule(stmtStart, true, 'namespace')
        declarations.push(decl)
      }
      else if (ech === 109 /* m */ && matchWord('module')) {
        const decl = extractModule(stmtStart, true, 'module')
        declarations.push(decl)
      }
      else if (ech === CH_LBRACE) {
        // export { ... } or export { ... } from '...'
        skipExportBraces()
        const text = sliceTrimmed(stmtStart, pos)
        const isTypeOnly = text.includes('export type')
        const comments = extractLeadingComments(stmtStart)
        declarations.push({
          kind: 'export',
          name: '',
          text,
          isExported: true,
          isTypeOnly,
          leadingComments: comments,
          start: stmtStart,
          end: pos,
        })
      }
      else if (ech === CH_STAR) {
        // export * from '...'
        skipExportStar()
        const text = sliceTrimmed(stmtStart, pos)
        const comments = extractLeadingComments(stmtStart)
        // Extract source from 'from "..."' or "from '...'" without regex
        let _exportSource: string | undefined
        const _fromIdx = text.indexOf('from ')
        if (_fromIdx !== -1) {
          let _qi = _fromIdx + 5
          while (_qi < text.length && (text.charCodeAt(_qi) === 32 || text.charCodeAt(_qi) === 9)) _qi++
          if (_qi < text.length) {
            const _qch = text.charCodeAt(_qi)
            if (_qch === 39 || _qch === 34) { // ' or "
              const _qend = text.indexOf(text[_qi], _qi + 1)
              if (_qend !== -1) _exportSource = text.slice(_qi + 1, _qend)
            }
          }
        }
        declarations.push({
          kind: 'export',
          name: '',
          text,
          isExported: true,
          isTypeOnly: false,
          source: _exportSource,
          leadingComments: comments,
          start: stmtStart,
          end: pos,
        })
      }
      else {
        // Unknown export, skip
        skipToStatementEnd()
        const text = sliceTrimmed(stmtStart, pos)
        if (text) {
          declarations.push({
            kind: 'export',
            name: '',
            text,
            isExported: true,
            start: stmtStart,
            end: pos,
          })
        }
      }
    }
    else if (ch0 === 100 /* d */ && matchWord('declare')) {
      pos += 7
      skipWhitespaceAndComments()
      handleDeclare(stmtStart, false)
    }
    else if (ch0 === 105 /* i */ && matchWord('interface')) {
      // Non-exported interface
      const decl = extractInterface(stmtStart, false)
      nonExportedTypes.set(decl.name, decl)
    }
    else if (ch0 === 116 /* t */ && matchWord('type')) {
      // Non-exported type alias
      const decl = extractTypeAlias(stmtStart, false)
      nonExportedTypes.set(decl.name, decl)
      declarations.push(decl)
    }
    else if (ch0 === 102 /* f */ && matchWord('function')) {
      // Non-exported function — skip for DTS
      skipToStatementEnd()
    }
    else if (ch0 === 97 /* a */) {
      if (matchWord('async')) {
        // Non-exported async function — skip for DTS
        skipToStatementEnd()
      }
      else if (matchWord('abstract')) {
        pos += 8
        skipWhitespaceAndComments()
        if (matchWord('class')) {
          const decl = extractClass(stmtStart, false, false)
          nonExportedTypes.set(decl.name, decl)
          declarations.push(decl)
        }
        else {
          skipToStatementEnd()
        }
      }
      else {
        pos++
        skipToStatementEnd()
      }
    }
    else if (ch0 === 99 /* c */) {
      if (matchWord('class')) {
        const decl = extractClass(stmtStart, false, false)
        nonExportedTypes.set(decl.name, decl)
        declarations.push(decl)
      }
      else if (matchWord('const')) {
        // Check for 'const enum' before skipping as variable
        const savedPos = pos
        pos += 5
        skipWhitespaceAndComments()
        if (matchWord('enum')) {
          pos = savedPos + 5
          skipWhitespaceAndComments()
          const decl = extractEnum(stmtStart, false, true)
          nonExportedTypes.set(decl.name, decl)
          declarations.push(decl)
        }
        else {
          // Non-exported const variable — skip for DTS
          pos = savedPos
          skipToStatementEnd()
        }
      }
      else {
        pos++
        skipToStatementEnd()
      }
    }
    else if (ch0 === 101 /* e */ && matchWord('enum')) {
      // Non-exported enum
      const decl = extractEnum(stmtStart, false, false)
      nonExportedTypes.set(decl.name, decl)
      declarations.push(decl)
    }
    else if (ch0 === 108 /* l */ && matchWord('let')) {
      // Non-exported variable — skip for DTS
      skipToStatementEnd()
    }
    else if (ch0 === 118 /* v */ && matchWord('var')) {
      // Non-exported variable — skip for DTS
      skipToStatementEnd()
    }
    else if (ch0 === 109 /* m */ && matchWord('module')) {
      const decl = extractModule(stmtStart, false, 'module')
      declarations.push(decl)
    }
    else if (ch0 === 110 /* n */ && matchWord('namespace')) {
      const decl = extractModule(stmtStart, false, 'namespace')
      declarations.push(decl)
    }
    else {
      // Skip unknown top-level content (string expressions like 'use strict', decorators, etc.)
      const ch = source.charCodeAt(pos)
      if (ch === CH_SQUOTE || ch === CH_DQUOTE) {
        skipString(ch)
        if (pos < len && source.charCodeAt(pos) === CH_SEMI)
          pos++
      }
      else if (ch === CH_BACKTICK) {
        skipTemplateLiteral()
        if (pos < len && source.charCodeAt(pos) === CH_SEMI)
          pos++
      }
      else if (ch === CH_AT) {
        // Decorator — skip @identifier(args) then continue to next statement
        pos++
        readIdent()
        skipWhitespaceAndComments()
        if (pos < len && source.charCodeAt(pos) === CH_DOT) {
          pos++
          readIdent()
          skipWhitespaceAndComments()
        }
        if (pos < len && source.charCodeAt(pos) === CH_LPAREN) {
          findMatchingClose(CH_LPAREN, CH_RPAREN)
        }
      }
      else {
        pos++
        skipToStatementEnd()
      }
    }
  }

  // Resolve referenced non-exported types
  if (nonExportedTypes.size > 0) {
    resolveReferencedTypes(declarations, nonExportedTypes)
  }

  // Post-process: remove implementation signatures of overloaded functions.
  // For any function name that appears more than once, remove the last declaration
  // that has a body (the implementation signature).
  if (funcBodyIndices.size > 0) {
    const funcNameCounts = new Map<string, number>()
    for (const decl of declarations) {
      if (decl.kind === 'function') {
        funcNameCounts.set(decl.name, (funcNameCounts.get(decl.name) || 0) + 1)
      }
    }
    // Only remove implementation signatures for overloaded functions (count > 1)
    const overloadedNames = new Set<string>()
    for (const [name, count] of funcNameCounts) {
      if (count > 1)
        overloadedNames.add(name)
    }
    if (overloadedNames.size > 0) {
      // Find the last body-bearing declaration index for each overloaded name
      const toRemove = new Set<number>()
      for (const name of overloadedNames) {
        // Walk backwards to find the last declaration with a body for this name
        for (let i = declarations.length - 1; i >= 0; i--) {
          if (declarations[i].kind === 'function' && declarations[i].name === name && funcBodyIndices.has(i)) {
            toRemove.add(i)
            break
          }
        }
      }
      if (toRemove.size > 0) {
        // Remove in reverse order to preserve indices
        const sortedIndices = [...toRemove].sort((a, b) => b - a)
        for (const idx of sortedIndices) {
          declarations.splice(idx, 1)
        }
      }
    }
  }

  return declarations

  // --- Helper: handle `declare ...` after `declare` keyword ---
  function handleDeclare(stmtStart: number, isExported: boolean): void {
    if (matchWord('function')) {
      const decl = extractFunction(stmtStart, isExported, false, false)
      if (decl)
        declarations.push(decl)
    }
    else if (matchWord('async')) {
      pos += 5
      skipWhitespaceAndComments()
      if (matchWord('function')) {
        const decl = extractFunction(stmtStart, isExported, true, false)
        if (decl)
          declarations.push(decl)
      }
    }
    else if (matchWord('class')) {
      const decl = extractClass(stmtStart, isExported, false)
      declarations.push(decl)
    }
    else if (matchWord('abstract')) {
      pos += 8
      skipWhitespaceAndComments()
      if (matchWord('class')) {
        const decl = extractClass(stmtStart, isExported, true)
        declarations.push(decl)
      }
    }
    else if (matchWord('interface')) {
      const decl = extractInterface(stmtStart, isExported)
      declarations.push(decl)
    }
    else if (matchWord('type')) {
      const decl = extractTypeAlias(stmtStart, isExported)
      declarations.push(decl)
    }
    else if (matchWord('enum')) {
      const decl = extractEnum(stmtStart, isExported, false)
      declarations.push(decl)
    }
    else if (matchWord('const')) {
      const savedPos = pos
      pos += 5
      skipWhitespaceAndComments()
      if (matchWord('enum')) {
        pos = savedPos + 5
        skipWhitespaceAndComments()
        const decl = extractEnum(stmtStart, isExported, true)
        declarations.push(decl)
      }
      else if (isExported) {
        pos = savedPos
        const decls = extractVariable(stmtStart, 'const', true)
        for (let _di = 0; _di < decls.length; _di++) declarations.push(decls[_di])
      }
      else {
        skipToStatementEnd()
      }
    }
    else if (matchWord('let') || matchWord('var')) {
      if (isExported) {
        const kind = matchWord('let') ? 'let' : 'var'
        const decls = extractVariable(stmtStart, kind, true)
        for (let _di = 0; _di < decls.length; _di++) declarations.push(decls[_di])
      }
      else {
        skipToStatementEnd()
      }
    }
    else if (matchWord('module')) {
      const decl = extractModule(stmtStart, isExported, 'module')
      declarations.push(decl)
    }
    else if (matchWord('namespace')) {
      const decl = extractModule(stmtStart, isExported, 'namespace')
      declarations.push(decl)
    }
    else if (matchWord('global')) {
      // declare global { ... }
      pos += 6
      skipWhitespaceAndComments()
      const body = pos < len && source.charCodeAt(pos) === CH_LBRACE ? buildNamespaceBodyDts() : '{}'
      const text = `declare global ${body}`
      const comments = extractLeadingComments(stmtStart)
      declarations.push({
        kind: 'module',
        name: 'global',
        text,
        isExported: false,
        leadingComments: comments,
        start: stmtStart,
        end: pos,
      })
    }
    else {
      skipToStatementEnd()
    }
  }
}

/** Check if name appears as a whole word in text (fast includes + boundary check) */
function isWordInText(name: string, text: string): boolean {
  let searchFrom = 0
  const nameLen = name.length
  while (searchFrom < text.length) {
    const idx = text.indexOf(name, searchFrom)
    if (idx === -1) return false
    // Check word boundaries
    const before = idx > 0 ? text.charCodeAt(idx - 1) : 32
    const after = idx + nameLen < text.length ? text.charCodeAt(idx + nameLen) : 32
    const beforeOk = !((before >= 65 && before <= 90) || (before >= 97 && before <= 122) || (before >= 48 && before <= 57) || before === 95 || before === 36)
    const afterOk = !((after >= 65 && after <= 90) || (after >= 97 && after <= 122) || (after >= 48 && after <= 57) || after === 95 || after === 36)
    if (beforeOk && afterOk) return true
    searchFrom = idx + 1
  }
  return false
}

/** Extract all identifier words from text into an existing Set. O(n) single pass. */
function addWordsToSet(text: string, words: Set<string>): void {
  let i = 0
  const len = text.length
  while (i < len) {
    const c = text.charCodeAt(i)
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127) {
      const start = i
      i++
      while (i < len) {
        const ch = text.charCodeAt(i)
        if ((ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57) || ch === 95 || ch === 36 || ch > 127) {
          i++
        }
        else {
          break
        }
      }
      words.add(text.substring(start, i))
    }
    else {
      i++
    }
  }
}

/** Resolve non-exported types that are referenced by exported declarations */
function resolveReferencedTypes(declarations: Declaration[], nonExportedTypes: Map<string, Declaration>): void {
  // Iteratively resolve referenced non-exported types (transitive closure)
  const resolved = new Set<string>()
  const declNames = new Set<string>()
  for (const d of declarations) declNames.add(d.name)

  // Build a word set from all declaration texts — O(1) lookups per type name
  const wordSet = new Set<string>()
  const textParts: string[] = []
  for (let i = 0; i < declarations.length; i++) {
    if (declarations[i].kind !== 'import') {
      textParts.push(declarations[i].text)
      addWordsToSet(declarations[i].text, wordSet)
    }
  }

  for (;;) {
    // Collect referenced non-exported types not yet resolved — O(1) per type
    const toInsert: Declaration[] = []
    for (const [name, decl] of nonExportedTypes) {
      if (resolved.has(name))
        continue
      if (wordSet.has(name)) {
        if (!declNames.has(name)) {
          toInsert.push(decl)
          declNames.add(name)
        }
        resolved.add(name)
      }
    }

    if (toInsert.length === 0)
      break

    // Merge at correct source positions in a single O(n+k) pass (avoids O(k*n) splice)
    toInsert.sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
    const merged: Declaration[] = []
    let ti = 0
    for (let i = 0; i < declarations.length; i++) {
      const candidateStart = declarations[i].start ?? Infinity
      while (ti < toInsert.length && (toInsert[ti].start ?? Infinity) <= candidateStart) {
        merged.push(toInsert[ti++])
      }
      merged.push(declarations[i])
    }
    while (ti < toInsert.length) merged.push(toInsert[ti++])
    declarations.length = 0
    for (let i = 0; i < merged.length; i++) declarations.push(merged[i])

    // Incrementally add new words from inserted declarations
    for (const decl of toInsert) {
      if (decl.kind !== 'import') {
        textParts.push(decl.text)
        addWordsToSet(decl.text, wordSet)
      }
    }
  }
}
