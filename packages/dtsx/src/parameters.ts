import { tokenizeDeclarationSyntax } from './module-references'

type Token = ReturnType<typeof tokenizeDeclarationSyntax>[number]

function depthChange(source: string, token: Token): number {
  if (token.kind !== 'punctuation') return 0
  const text = source.slice(token.start, token.end)
  if ('([{<'.includes(text)) return 1
  if (')]}'.includes(text) || text === '>' && source[token.start - 1] !== '=') return -1
  return 0
}

/** A default before a required argument admits undefined, but keeps its position. */
export function normalizeDefaultParameterOrder(parameters: string): string {
  if (!parameters.includes('?')) return parameters
  const stripped = parameters.trim()
  const wrapped = stripped.startsWith('(') && stripped.endsWith(')')
  const base = parameters.indexOf(stripped) + (wrapped ? 1 : 0)
  const inner = wrapped ? stripped.slice(1, -1) : stripped
  const parts: Token[][] = [[]]
  let depth = 0
  for (const token of tokenizeDeclarationSyntax(inner)) {
    if (token.kind === 'punctuation' && inner[token.start] === ',' && depth === 0) parts.push([])
    else parts[parts.length - 1].push(token)
    depth += depthChange(inner, token)
  }
  const entries = parts.map((tokens) => {
    let depth = 0
    let colon = -1
    for (const [index, token] of tokens.entries()) {
      if (depth === 0 && token.kind === 'punctuation' && inner[token.start] === ':') { colon = index; break }
      depth += depthChange(inner, token)
    }
    const question = colon > 0 && inner[tokens[colon - 1].start] === '?' ? tokens[colon - 1] : undefined
    const name = tokens[0] ? inner.slice(tokens[0].start, tokens[0].end) : ''
    const rest = tokens[0] && inner.startsWith('...', tokens[0].start)
    return { tokens, colon, question, required: tokens.length > 0 && !question && !rest && name !== 'this' }
  })
  let lastRequired = -1
  for (const [index, entry] of entries.entries()) if (entry.required) lastRequired = index
  const edits: Array<{ start: number, end: number, text: string }> = []
  for (const [index, entry] of entries.entries()) {
    if (index >= lastRequired || !entry.question || entry.colon < 0) continue
    const first = entry.tokens[entry.colon + 1]
    const last = entry.tokens.at(-1)
    if (!first || !last) continue
    edits.push({ start: base + entry.question.start, end: base + entry.question.end, text: '' },
    { start: base + first.start, end: base + first.start, text: '(' },
    { start: base + last.end, end: base + last.end, text: ') | undefined' })
  }
  if (!edits.length) return parameters
  const chunks: string[] = []
  let cursor = 0
  for (const edit of edits) {
    chunks.push(parameters.slice(cursor, edit.start), edit.text)
    cursor = edit.end
  }
  chunks.push(parameters.slice(cursor))
  return chunks.join('')
}

/** One `key = value` or `key: alias = value` element of a defaulted object binding. */
export interface DefaultedBindingElement {
  key: string
  alias: string
  value: string
}

function isAsciiIdentifierStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36
}

function asciiIdentifierEnd(text: string, start: number): number {
  if (start >= text.length || !isAsciiIdentifierStart(text.charCodeAt(start))) return start
  let end = start + 1
  while (end < text.length && (isAsciiIdentifierStart(text.charCodeAt(end)) || (text.charCodeAt(end) >= 48 && text.charCodeAt(end) <= 57))) end++
  return end
}

function skipSpaces(text: string, start: number): number {
  let index = start
  while (index < text.length && text.charCodeAt(index) <= 32) index++
  return index
}

/**
 * An object binding parameter defaulted to `{}` whose elements are all
 * `name = value` or `key: alias = value`: `{ ssl = true } = {}`. Any other
 * shape (an element without a default, a nested pattern, a rest element, a
 * comment, or another initializer) is null. Mirrored by the native engine.
 */
export function defaultedObjectBinding(pattern: string, initializer: string): DefaultedBindingElement[] | null {
  if (initializer.trim() !== '{}') return null
  const source = pattern.trim()
  if (source.length < 2 || source[0] !== '{' || source[source.length - 1] !== '}') return null
  const inner = source.slice(1, -1)
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < inner.length; index++) {
    const code = inner.charCodeAt(index)
    if (code === 34 || code === 39 || code === 96) {
      index++
      while (index < inner.length && inner.charCodeAt(index) !== code) {
        if (inner.charCodeAt(index) === 92) index++
        index++
      }
      if (index >= inner.length) return null
      continue
    }
    if (code === 47 && (inner.charCodeAt(index + 1) === 47 || inner.charCodeAt(index + 1) === 42)) return null
    if (code === 40 || code === 91 || code === 123) {
      depth++
    }
    else if (code === 41 || code === 93 || code === 125) {
      if (--depth < 0) return null
    }
    else if (code === 44 && depth === 0) {
      parts.push(inner.slice(start, index))
      start = index + 1
    }
  }
  if (depth !== 0) return null
  // A trailing comma leaves an empty final element.
  if (inner.slice(start).trim() || parts.length === 0) parts.push(inner.slice(start))
  const elements: DefaultedBindingElement[] = []
  for (const part of parts) {
    const text = part.trim()
    const keyEnd = asciiIdentifierEnd(text, 0)
    if (keyEnd === 0) return null
    const key = text.slice(0, keyEnd)
    let alias = key
    let cursor = skipSpaces(text, keyEnd)
    if (text.charCodeAt(cursor) === 58 /* : */) {
      const aliasStart = skipSpaces(text, cursor + 1)
      const aliasEnd = asciiIdentifierEnd(text, aliasStart)
      if (aliasEnd === aliasStart) return null
      alias = text.slice(aliasStart, aliasEnd)
      cursor = skipSpaces(text, aliasEnd)
    }
    if (text.charCodeAt(cursor) !== 61 /* = */ || text.charCodeAt(cursor + 1) === 61 || text.charCodeAt(cursor + 1) === 62) return null
    const value = text.slice(cursor + 1).trim()
    if (!value) return null
    elements.push({ key, alias, value })
  }
  return elements
}

/**
 * The declaration of a defaulted object binding, as tsc writes it:
 * `{ ssl, poolSize }?: { ssl?: boolean | undefined; poolSize?: number | undefined }`.
 */
export function defaultedObjectBindingParameter(elements: readonly DefaultedBindingElement[], typeOf: (value: string) => string): string {
  const names = elements.map(element => element.key === element.alias ? element.key : `${element.key}: ${element.alias}`).join(', ')
  const members = elements.map((element) => {
    const type = typeOf(element.value)
    const optional = type === 'unknown' || type === 'any' ? type : `${type.includes('=>') ? `(${type})` : type} | undefined`
    return `${element.key}?: ${optional}`
  }).join('; ')
  return `{ ${names} }?: { ${members} }`
}
