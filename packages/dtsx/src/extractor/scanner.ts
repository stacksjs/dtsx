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

/**
 * Scan TypeScript source code and extract declarations without using the TypeScript parser.
 * This is the fast path that replaces createSourceFile() + AST walk.
 */
export function scanDeclarations(source: string, filename: string, keepComments: boolean = true): Declaration[] {
  const len = source.length
  const declarations: Declaration[] = []
  const nonExportedTypes = new Map<string, Declaration>()
  const funcBodyIndices = new Set<number>()
  let pos = 0

  // Skip BOM (byte order mark)
  if (pos < len && source.charCodeAt(pos) === 0xFEFF)
    pos++

  // --- Primitive scanning helpers ---

  function skipWhitespaceAndComments(): void {
    while (pos < len) {
      const ch = source.charCodeAt(pos)
      if (isWhitespace(ch)) {
        pos++
        continue
      }
      if (ch === CH_SLASH && pos + 1 < len) {
        const next = source.charCodeAt(pos + 1)
        if (next === CH_SLASH) {
          // Line comment
          pos += 2
          while (pos < len && source.charCodeAt(pos) !== CH_LF) pos++
          if (pos < len)
            pos++ // skip \n
          continue
        }
        if (next === CH_STAR) {
          // Block comment
          pos += 2
          while (pos < len - 1 && !(source.charCodeAt(pos) === CH_STAR && source.charCodeAt(pos + 1) === CH_SLASH)) pos++
          if (pos < len - 1)
            pos += 2
          continue
        }
      }
      break
    }
  }

  function skipString(quote: number): void {
    pos++ // skip opening quote
    while (pos < len) {
      const ch = source.charCodeAt(pos)
      if (ch === CH_BACKSLASH) {
        pos += 2
        continue
      }
      if (ch === quote) {
        pos++
        return
      }
      pos++
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
        pos += 2
        while (pos < len && source.charCodeAt(pos) !== CH_LF) pos++
        if (pos < len)
          pos++
        return true
      }
      if (next === CH_STAR) {
        pos += 2
        while (pos < len - 1 && !(source.charCodeAt(pos) === CH_STAR && source.charCodeAt(pos + 1) === CH_SLASH)) pos++
        if (pos < len - 1)
          pos += 2
        return true
      }
    }
    return false
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
    return matchWord('export') || matchWord('import') || matchWord('function')
      || matchWord('class') || matchWord('interface') || matchWord('type')
      || matchWord('enum') || matchWord('const') || matchWord('let')
      || matchWord('var') || matchWord('declare') || matchWord('module')
      || matchWord('namespace') || matchWord('abstract') || matchWord('async')
      || matchWord('default')
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
      if (c === CH_SLASH && pos + 1 < len && source.charCodeAt(pos + 1) === CH_SLASH) {
        pos += 2
        while (pos < len && source.charCodeAt(pos) !== CH_LF) pos++
        if (pos < len)
          pos++
        continue
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
        pos += 2
        while (pos < len && source.charCodeAt(pos) !== CH_LF) pos++
        if (pos < len)
          pos++
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

  /** Find matching closing brace, paren, or bracket, respecting nesting and strings/comments */
  function findMatchingClose(open: number, close: number): number {
    let depth = 1
    pos++ // skip opening
    while (pos < len && depth > 0) {
      if (skipNonCode())
        continue
      const ch = source.charCodeAt(pos)
      if (ch === open) {
        depth++
      }
      else if (ch === close) {
        // Don't match > that's part of => (arrow function)
        if (close === CH_RANGLE && pos > 0 && source.charCodeAt(pos - 1) === CH_EQUAL) {
          pos++
          continue
        }
        depth--
        if (depth === 0) {
          pos++
          return pos
        }
      }
      pos++
    }
    return pos
  }

  /** Check if > at current pos is part of => (arrow function) */
  function isArrowGT(): boolean {
    return pos > 0 && source.charCodeAt(pos - 1) === CH_EQUAL
  }

  /** Skip to statement end (semicolon at depth 0, matching brace, or ASI) */
  function skipToStatementEnd(): void {
    let braceDepth = 0
    while (pos < len) {
      if (skipNonCode())
        continue
      const ch = source.charCodeAt(pos)
      if (ch === CH_LBRACE) {
        braceDepth++
      }
      else if (ch === CH_RBRACE) {
        braceDepth--
        if (braceDepth <= 0) { pos++; return }
      }
      else if (ch === CH_SEMI && braceDepth === 0) { pos++; return }
      // ASI: at brace depth 0, newline + keyword = end of statement
      if (braceDepth === 0 && checkASITopLevel())
        return
      pos++
    }
  }

  /**
   * Skip an export re-export: { ... } [from '...'] [;]
   * pos should be at the opening {
   */
  function skipExportBraces(): void {
    findMatchingClose(CH_LBRACE, CH_RBRACE)
    skipWhitespaceAndComments()
    if (matchWord('from')) {
      pos += 4
      skipWhitespaceAndComments()
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
    skipWhitespaceAndComments()
    if (matchWord('as')) {
      pos += 2
      skipWhitespaceAndComments()
      readIdent()
      skipWhitespaceAndComments()
    }
    if (matchWord('from')) {
      pos += 4
      skipWhitespaceAndComments()
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

    // Scan backwards for consecutive comment blocks
    while (p >= 0) {
      // Check for block comment ending with */
      if (p >= 1 && source.charCodeAt(p) === CH_SLASH && source.charCodeAt(p - 1) === CH_STAR) {
        // Find matching /* or /**
        let start = p - 2
        while (start >= 1 && !(source.charCodeAt(start) === CH_SLASH && source.charCodeAt(start + 1) === CH_STAR)) start--
        if (start >= 0 && source.charCodeAt(start) === CH_SLASH && source.charCodeAt(start + 1) === CH_STAR) {
          comments.unshift(source.slice(start, p + 1))
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
      const lineText = source.slice(lineStart, p + 1).trim()

      if (lineText.startsWith('//')) {
        // Collect consecutive single-line comments
        const singleLines: string[] = [lineText]
        p = lineStart - 1
        while (p >= 0 && (source.charCodeAt(p) === CH_LF || source.charCodeAt(p) === CH_CR)) p--
        // Check for more single-line comments above
        while (p >= 0) {
          let ls = p
          while (ls > 0 && source.charCodeAt(ls - 1) !== CH_LF) ls--
          const lt = source.slice(ls, p + 1).trim()
          if (lt.startsWith('//')) {
            singleLines.unshift(lt)
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
        comments.unshift(singleLines.join('\n'))
        continue
      }

      // Not a comment, stop
      break
    }

    return comments.length > 0 ? comments : undefined
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

    const text = source.slice(stmtStart, pos).trim()
    const isTypeOnly = text.startsWith('import type ') || text.startsWith('import type{')

    // Detect side-effect imports
    const isSideEffect = !text.includes('{') && !text.includes(' as ') && !/import\s+\w/.test(text.replace(/import\s+type\s/, 'import ').replace(/import\s+['"]/, 'import_str '))
    const isSideEffectImport = /^import\s+['"]/.test(text) || /^import\s+type\s+['"]/.test(text.replace('type ', ''))

    // Extract source module
    const sourceMatch = text.match(/from\s+['"]([^'"]+)['"]/) || text.match(/import\s+['"]([^'"]+)['"]/)
    const moduleSrc = sourceMatch ? sourceMatch[1] : ''

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

  /** Strip inline comments from a brace block and normalize indentation */
  function cleanBraceBlock(raw: string): string {
    // Remove inline // and /** */ comments, normalize indentation
    const lines = raw.split('\n')
    const cleaned: string[] = []
    for (const line of lines) {
      // Strip full-line comments
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('/**') || trimmed.startsWith('/*') || trimmed.startsWith('*'))
        continue
      if (trimmed === '' || trimmed === '{' || trimmed === '}') {
        cleaned.push(trimmed)
        continue
      }
      // Remove trailing inline comments
      const result = trimmed.replace(/\s*\/\/.*$/, '').replace(/\s*\/\*.*?\*\/\s*/g, ' ').trim()
      if (result)
        cleaned.push(result)
    }
    // Rebuild with consistent 2-space indent
    const members: string[] = []
    for (const line of cleaned) {
      if (line === '{' || line === '}')
        continue
      if (line)
        members.push(`  ${line}`)
    }
    if (members.length === 0)
      return '{}'
    return `{\n${members.join('\n')}\n}`
  }

  /** Extract type parameters <...> (normalized to single line) */
  function extractGenerics(): string {
    if (pos >= len || source.charCodeAt(pos) !== CH_LANGLE)
      return ''
    const start = pos
    findMatchingClose(CH_LANGLE, CH_RANGLE)
    const raw = source.slice(start, pos)
    // Normalize multi-line generics to single line
    if (raw.includes('\n')) {
      return raw.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').replace(/^<\s+/, '<').replace(/\s+>$/, '>')
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
    const paramModifiers = ['public', 'protected', 'private', 'readonly', 'override']
    let strippedMod = true
    while (strippedMod) {
      strippedMod = false
      for (const mod of paramModifiers) {
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

  /** Infer type from a default value expression (simple cases) */
  function inferTypeFromDefault(value: string): string {
    const v = value.trim()
    if (v === 'true' || v === 'false')
      return 'boolean'
    if (/^-?\d+(\.\d+)?$/.test(v))
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
    if (/^-?\d+(\.\d+)?$/.test(v))
      return v
    if ((v.startsWith('\'') && v.endsWith('\'')) || (v.startsWith('"') && v.endsWith('"')))
      return v
    return 'unknown'
  }

  /** Extract type from `as Type` assertion in initializer */
  function extractAssertion(initText: string): string | null {
    if (initText.endsWith('as const'))
      return null
    const m = initText.match(/\bas\s+(.+)$/)
    return m ? m[1].trim() : null
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
            const textSoFar = source.slice(start, pos).trim()
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
      return source.slice(start, pos).trim()
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
    const parts: string[] = []
    if (isExported)
      parts.push('export ')
    parts.push('declare function ')
    parts.push(name || 'default')
    parts.push(generics)
    parts.push(dtsParams)
    parts.push(': ', returnType, ';')

    const text = parts.join('')
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
        typeAnnotation = source.slice(typeStart, pos).trim()
      }

      // Initializer
      if (pos < len && source.charCodeAt(pos) === CH_EQUAL) {
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
        initializerText = source.slice(initStart, pos).trim()
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
      extendsClause = source.slice(extStart, pos).trim()
    }

    // Body
    skipWhitespaceAndComments()
    const rawBody = pos < len && source.charCodeAt(pos) === CH_LBRACE ? extractBraceBlock() : '{}'
    const body = cleanBraceBlock(rawBody)

    // Build DTS text
    const parts: string[] = []
    if (isExported)
      parts.push('export ')
    parts.push('declare interface ', name)
    parts.push(generics)
    if (extendsClause)
      parts.push(' extends ', extendsClause)
    parts.push(' ', body)

    const text = parts.join('')
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
    const typeBody = source.slice(typeStart, pos).trim()
    if (pos < len && source.charCodeAt(pos) === CH_SEMI)
      pos++

    // Build DTS text
    const parts: string[] = []
    if (isExported)
      parts.push('export ')
    parts.push('type ', name, generics, ' = ', typeBody)

    const text = parts.join('')
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
    const bodyStart = pos
    if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
      findMatchingClose(CH_LBRACE, CH_RBRACE)
    }

    // Use raw text for the whole enum (extractor does the same for enums)
    const rawText = source.slice(declStart, pos).trim()
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
      extendsClause = source.slice(extStart, pos).trim()
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
      const implText = source.slice(implStart, pos).trim()
      if (implText)
        implementsList = implText.split(',').map(s => s.trim())
    }

    skipWhitespaceAndComments()

    // Extract class body and build DTS members
    const classBody = buildClassBodyDts()

    // Build DTS text
    const parts: string[] = []
    if (isExported)
      parts.push('export ')
    parts.push('declare ')
    if (isAbstract)
      parts.push('abstract ')
    parts.push('class ', name, generics)
    if (extendsClause)
      parts.push(' extends ', extendsClause)
    if (implementsList && implementsList.length > 0)
      parts.push(' implements ', implementsList.join(', '))
    parts.push(' ', classBody)

    const text = parts.join('')
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
        type = source.slice(typeStart, pos).trim()
      }

      // Capture initializer
      let initText = ''
      if (pos < len && source.charCodeAt(pos) === CH_EQUAL) {
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
        initText = source.slice(initStart, pos).trim()
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

      // Extract the modifiers text and parameter info
      let p = param
      const mods: string[] = []
      if (hasPublic) { p = p.replace(/^public\s+/, ''); mods.push('public') }
      if (hasProtected) { p = p.replace(/^protected\s+/, ''); mods.push('protected') }
      if (hasReadonly) { p = p.replace(/readonly\s+/, ''); mods.push('readonly') }

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
          vtype = source.slice(ts, pos).trim()
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
          initText = source.slice(is2, pos).trim()
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
          const typeBody = source.slice(ts, pos).trim()
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
        const heritage = source.slice(hStart, pos).trim()
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
        const body = buildNamespaceBodyDts(`${indent}  `)
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
          const heritage = source.slice(hStart, pos).trim()
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
        const defText = source.slice(defStart, pos).trim().replace(/;$/, '')
        if (defText) {
          lines.push(`${indent}export default ${defText}`)
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
    const parts: string[] = []
    if (isExported)
      parts.push('export ')
    parts.push('declare ')
    parts.push(keyword, ' ', name, ' ', body)

    const text = parts.join('')
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

  // --- Main scan loop ---

  while (pos < len) {
    skipWhitespaceAndComments()
    if (pos >= len)
      break

    const stmtStart = pos

    // Detect keywords at top level
    if (matchWord('import')) {
      declarations.push(extractImport(stmtStart))
    }
    else if (matchWord('export')) {
      pos += 6 // skip 'export'
      skipWhitespaceAndComments()

      if (matchWord('default')) {
        pos += 7
        skipWhitespaceAndComments()

        if (matchWord('function')) {
          const decl = extractFunction(stmtStart, true, false, true)
          if (decl)
            declarations.push(decl)
        }
        else if (matchWord('async') && peekAfterWord('async') !== CH_SEMI) {
          pos += 5
          skipWhitespaceAndComments()
          if (matchWord('function')) {
            const decl = extractFunction(stmtStart, true, true, true)
            if (decl)
              declarations.push(decl)
          }
          else {
            // export default async expression
            const text = source.slice(stmtStart, pos).trim()
            skipToStatementEnd()
            const fullText = source.slice(stmtStart, pos).trim()
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
        else if (matchWord('class')) {
          const decl = extractClass(stmtStart, true, false)
          declarations.push(decl)
        }
        else if (matchWord('abstract')) {
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
          const text = source.slice(stmtStart, pos).trim()
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
      else if (matchWord('type')) {
        // Could be `export type Name = ...` or `export type { ... }`
        const savedPos = pos
        pos += 4
        skipWhitespaceAndComments()

        if (pos < len && source.charCodeAt(pos) === CH_LBRACE) {
          // export type { ... } from '...'
          skipExportBraces()
          const text = source.slice(stmtStart, pos).trim()
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
          const text = source.slice(stmtStart, pos).trim()
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
      else if (matchWord('interface')) {
        const decl = extractInterface(stmtStart, true)
        declarations.push(decl)
      }
      else if (matchWord('function')) {
        const decl = extractFunction(stmtStart, true, false, false)
        if (decl)
          declarations.push(decl)
      }
      else if (matchWord('async')) {
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
      else if (matchWord('class')) {
        const decl = extractClass(stmtStart, true, false)
        declarations.push(decl)
      }
      else if (matchWord('abstract')) {
        pos += 8
        skipWhitespaceAndComments()
        if (matchWord('class')) {
          const decl = extractClass(stmtStart, true, true)
          declarations.push(decl)
        }
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
          declarations.push(...decls)
        }
      }
      else if (matchWord('let')) {
        const decls = extractVariable(stmtStart, 'let', true)
        declarations.push(...decls)
      }
      else if (matchWord('var')) {
        const decls = extractVariable(stmtStart, 'var', true)
        declarations.push(...decls)
      }
      else if (matchWord('enum')) {
        const decl = extractEnum(stmtStart, true, false)
        declarations.push(decl)
      }
      else if (matchWord('declare')) {
        pos += 7
        skipWhitespaceAndComments()
        // export declare ...
        handleDeclare(stmtStart, true)
      }
      else if (matchWord('namespace')) {
        const decl = extractModule(stmtStart, true, 'namespace')
        declarations.push(decl)
      }
      else if (matchWord('module')) {
        const decl = extractModule(stmtStart, true, 'module')
        declarations.push(decl)
      }
      else if (source.charCodeAt(pos) === CH_LBRACE) {
        // export { ... } or export { ... } from '...'
        skipExportBraces()
        const text = source.slice(stmtStart, pos).trim()
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
      else if (source.charCodeAt(pos) === CH_STAR) {
        // export * from '...'
        skipExportStar()
        const text = source.slice(stmtStart, pos).trim()
        const comments = extractLeadingComments(stmtStart)
        const sourceMatch = text.match(/from\s+['"]([^'"]+)['"]/)
        declarations.push({
          kind: 'export',
          name: '',
          text,
          isExported: true,
          isTypeOnly: false,
          source: sourceMatch ? sourceMatch[1] : undefined,
          leadingComments: comments,
          start: stmtStart,
          end: pos,
        })
      }
      else {
        // Unknown export, skip
        skipToStatementEnd()
        const text = source.slice(stmtStart, pos).trim()
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
    else if (matchWord('declare')) {
      pos += 7
      skipWhitespaceAndComments()
      handleDeclare(stmtStart, false)
    }
    else if (matchWord('interface')) {
      // Non-exported interface
      const decl = extractInterface(stmtStart, false)
      nonExportedTypes.set(decl.name, decl)
    }
    else if (matchWord('type')) {
      // Non-exported type alias
      const decl = extractTypeAlias(stmtStart, false)
      nonExportedTypes.set(decl.name, decl)
      declarations.push(decl)
    }
    else if (matchWord('function') || matchWord('async')) {
      // Non-exported function — skip for DTS
      skipToStatementEnd()
    }
    else if (matchWord('class') || matchWord('abstract')) {
      // Non-exported class
      if (matchWord('abstract')) {
        pos += 8
        skipWhitespaceAndComments()
      }
      if (matchWord('class')) {
        const decl = extractClass(stmtStart, false, false)
        nonExportedTypes.set(decl.name, decl)
        declarations.push(decl)
      }
      else {
        skipToStatementEnd()
      }
    }
    else if (matchWord('enum')) {
      // Non-exported enum
      const decl = extractEnum(stmtStart, false, false)
      nonExportedTypes.set(decl.name, decl)
      declarations.push(decl)
    }
    else if (matchWord('const') || matchWord('let') || matchWord('var')) {
      // Non-exported variable — skip for DTS
      skipToStatementEnd()
    }
    else if (matchWord('module')) {
      const decl = extractModule(stmtStart, false, 'module')
      declarations.push(decl)
    }
    else if (matchWord('namespace')) {
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
        declarations.push(...decls)
      }
      else {
        skipToStatementEnd()
      }
    }
    else if (matchWord('let') || matchWord('var')) {
      if (isExported) {
        const kind = matchWord('let') ? 'let' : 'var'
        const decls = extractVariable(stmtStart, kind, true)
        declarations.push(...decls)
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
      const body = pos < len && source.charCodeAt(pos) === CH_LBRACE ? extractBraceBlock() : '{}'
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

/** Resolve non-exported types that are referenced by exported declarations */
function resolveReferencedTypes(declarations: Declaration[], nonExportedTypes: Map<string, Declaration>): void {
  // Build combined text of all exported declarations
  const exportedTexts: string[] = []
  for (const decl of declarations) {
    if (decl.isExported && decl.kind !== 'import') {
      exportedTexts.push(decl.text)
    }
  }
  const combinedText = exportedTexts.join('\n')

  // Check each non-exported type
  for (const [name, decl] of nonExportedTypes) {
    // Simple word-boundary check
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (re.test(combinedText)) {
      // Check it's not already in declarations
      const existing = declarations.find(d => d.name === name)
      if (!existing) {
        declarations.push(decl)
      }
    }
  }
}
