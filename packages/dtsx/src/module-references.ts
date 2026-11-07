/** Shared grammatical module literals for graph discovery and declaration rewriting. */
import { isIdentChar, isIdentStart, isRegexStart, skipRegexLiteral } from './lexical'

export interface SyntaxToken {
  start: number
  end: number
  kind: 'word' | 'quoted' | 'punctuation' | 'literal'
}

export interface ModuleReference {
  /** Decoded JavaScript string value, shared with native context lookup. */
  specifier: string
  kind: 'export-star' | 'export-star-as' | 'export-named' | 'import'
  isTypeOnly: boolean
  category: 'export' | 'static-import' | 'import-type'
  /** Absolute UTF-16 offsets including the original quote characters. */
  start: number
  end: number
}

export function tokenizeDeclarationSyntax(source: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = []
  let position = 0

  function template(): void {
    let rawStart = position++
    while (position < source.length) {
      if (source[position] === '\\') position += 2
      else if (source[position] === '`') {
        tokens.push({ start: rawStart, end: ++position, kind: 'literal' })
        return
      }
      else if (source[position] === '$' && source[position + 1] === '{') {
        tokens.push({ start: rawStart, end: position + 1, kind: 'literal' })
        tokens.push({ start: position + 1, end: position + 2, kind: 'punctuation' })
        position += 2
        code(true)
        rawStart = position
      }
      else position++
    }
    tokens.push({ start: rawStart, end: position, kind: 'literal' })
  }

  function code(substitution = false): void {
    let braces = 0
    while (position < source.length) {
      const start = position
      const character = source[position]
      if (/\s/.test(character)) { position++; continue }
      if (character === '/' && source[position + 1] === '/') {
        const end = source.indexOf('\n', position + 2)
        position = end === -1 ? source.length : end + 1
        continue
      }
      if (character === '/' && source[position + 1] === '*') {
        const end = source.indexOf('*/', position + 2)
        position = end === -1 ? source.length : end + 2
        continue
      }
      if (character === '/' && isRegexStart(source, position)) {
        position = skipRegexLiteral(source, position)
        tokens.push({ start, end: position, kind: 'literal' })
      }
      else if (character === '`') template()
      else if (character === '"' || character === '\'') {
        position++
        let closed = false
        while (position < source.length) {
          const next = source[position++]
          if (next === '\\') position++
          else if (next === character) { closed = true; break }
        }
        tokens.push({ start, end: Math.min(position, source.length), kind: closed ? 'quoted' : 'literal' })
      }
      else if (isIdentStart(source.charCodeAt(position))) {
        while (isIdentChar(source.charCodeAt(++position))) {}
        tokens.push({ start, end: position, kind: 'word' })
      }
      else {
        tokens.push({ start, end: ++position, kind: 'punctuation' })
        if (substitution) {
          if (character === '{') braces++
          else if (character === '}') {
            if (braces === 0) return
            braces--
          }
        }
      }
    }
  }

  code()
  return tokens
}

/** Decode a quoted module literal without executing or transpiling source. */
function decodeLiteral(literal: string): string | undefined {
  let value = ''
  const end = literal.length - 1
  for (let position = 1; position < end; position++) {
    if (literal[position] !== '\\') { value += literal[position]; continue }
    const escaped = literal[++position]
    if (position >= end) return undefined
    switch (escaped) {
      case '\n': break
      case '\r': if (literal[position + 1] === '\n') position++; break
      case 'n': value += '\n'; break
      case 'r': value += '\r'; break
      case 't': value += '\t'; break
      case 'b': value += '\b'; break
      case 'f': value += '\f'; break
      case 'v': value += '\v'; break
      case '0':
        if (/\d/.test(literal[position + 1] ?? '')) return undefined
        value += '\0'
        break
      case 'x':
      case 'u': {
        const braced = escaped === 'u' && literal[position + 1] === '{'
        const start = position + (braced ? 2 : 1)
        const finish = braced ? literal.indexOf('}', start) : start + (escaped === 'x' ? 2 : 4)
        const digits = literal.slice(start, finish)
        if (finish < start || finish > end || !/^[\da-f]+$/i.test(digits) || (braced && digits.length > 6)) return undefined
        const point = Number.parseInt(digits, 16)
        if (point > 0x10FFFF) return undefined
        value += String.fromCodePoint(point)
        position = braced ? finish : finish - 1
        break
      }
      default:
        if (/\d/.test(escaped)) return undefined
        value += escaped
    }
  }
  return value
}

/** Preserve the caller's quote style while safely spelling a new module value. */
export function quoteModuleSpecifier(value: string, quote: string): string {
  let result = quote
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (character === quote || character === '\\') result += `\\${character}`
    else if (code < 32 || code === 0x2028 || code === 0x2029 || (character.length === 1 && code >= 0xD800 && code <= 0xDFFF))
      result += `\\u${code.toString(16).padStart(4, '0')}`
    else result += character
  }
  return result + quote
}

/** Parse one complete external import-equals declaration, including trivia. */
export function parseImportEquals(source: string): { name: string, source: string, isTypeOnly: boolean, end: number } | undefined {
  const items = tokenizeDeclarationSyntax(source)
  const text = (index: number): string => items[index] ? source.slice(items[index].start, items[index].end) : ''
  if (text(0) !== 'import') return undefined
  const isTypeOnly = text(1) === 'type' && text(2) !== '='
  const binding = isTypeOnly ? 2 : 1
  if (items[binding]?.kind !== 'word' || text(binding + 1) !== '=' || text(binding + 2) !== 'require'
    || text(binding + 3) !== '(' || items[binding + 4]?.kind !== 'quoted' || text(binding + 5) !== ')') return undefined
  const end = binding + 6
  if (items.length !== end && !(items.length === end + 1 && text(end) === ';')) return undefined
  const specifier = decodeLiteral(text(binding + 4))
  if (specifier === undefined) return undefined
  return { name: text(binding), source: specifier, isTypeOnly, end: items[items.length - 1].end }
}

/** Source-order grammatical module literals, retaining spans for safe rewriting. */
export function scanModuleReferences(source: string): ModuleReference[] {
  const tokens = tokenizeDeclarationSyntax(source)
  const references: ModuleReference[] = []
  const seen = new Set<number>()
  const text = (index: number): string => index >= 0 && index < tokens.length ? source.slice(tokens[index].start, tokens[index].end) : ''
  const quoted = (index: number): boolean => tokens[index]?.kind === 'quoted'
  const word = (index: number): boolean => tokens[index]?.kind === 'word'

  function bindingEnd(start: number, exporting = false): number {
    if (text(start) === '*') {
      if (text(start + 1) === 'as') return word(start + 2) || (exporting && quoted(start + 2)) ? start + 3 : -1
      return exporting ? start + 1 : -1
    }
    if (text(start) !== '{') return -1
    let depth = 1
    for (let index = start + 1; index < tokens.length; index++) {
      if (text(index) === '{') depth++
      else if (text(index) === '}' && --depth === 0) return index + 1
      else if (tokens[index].kind === 'literal' || text(index) === ';') return -1
    }
    return -1
  }

  function add(index: number, kind: ModuleReference['kind'], isTypeOnly: boolean, category: ModuleReference['category']): void {
    const token = tokens[index]
    if (!token || token.kind !== 'quoted' || seen.has(token.start)) return
    const specifier = decodeLiteral(source.slice(token.start, token.end))
    if (specifier === undefined) return
    seen.add(token.start)
    references.push({ specifier, kind, isTypeOnly, category, start: token.start, end: token.end })
  }

  for (let index = 0; index < tokens.length; index++) {
    if (!word(index) || text(index - 1) === '.' || text(index - 1) === '#') continue
    const keyword = text(index)
    let next = index + 1
    if (keyword === 'export') {
      const typeOnly = text(next) === 'type'
      if (typeOnly) next++
      const kind = text(next) === '*' ? (text(next + 1) === 'as' ? 'export-star-as' : 'export-star') : 'export-named'
      const afterBinding = bindingEnd(next, true)
      if (afterBinding >= 0 && text(afterBinding) === 'from') add(afterBinding + 1, kind, typeOnly, 'export')
    }
    else if (keyword === 'import') {
      if (quoted(next)) { add(next, 'import', false, 'static-import'); continue }
      if (text(next) === '(') {
        if (text(next + 2) === ')' || text(next + 2) === ',') add(next + 1, 'import', false, 'import-type')
        continue
      }
      const typeOnly = text(next) === 'type' && text(next + 1) !== 'from' && text(next + 1) !== '='
      if (typeOnly) next++
      if (word(next)) {
        next++
        if (text(next) === '=') {
          if (text(next + 1) === 'require' && text(next + 2) === '(' && text(next + 4) === ')') add(next + 3, 'import', typeOnly, 'static-import')
          continue
        }
        if (text(next) === ',') next = bindingEnd(next + 1)
      }
      else next = bindingEnd(next)
      if (next >= 0 && text(next) === 'from') add(next + 1, 'import', typeOnly, 'static-import')
    }
  }
  return references
}
