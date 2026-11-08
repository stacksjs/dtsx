import { tokenizeDeclarationSyntax } from './module-references'

export function functionCount(source: string, name: string): number {
  const tokens = tokenizeDeclarationSyntax(source)
  let depth = 0
  let count = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const text = source.slice(token.start, token.end)
    const next = tokens[index + 1]
    if (depth === 0 && text === 'function' && next?.kind === 'word' && source.slice(next.start, next.end) === name) count++
    if (['{', '(', '['].includes(text)) depth++
    else if (['}', ')', ']'].includes(text)) depth--
  }
  return count
}
