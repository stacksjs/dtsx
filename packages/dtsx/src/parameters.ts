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
