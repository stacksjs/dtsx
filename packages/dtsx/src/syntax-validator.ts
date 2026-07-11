export interface SyntaxIssue {
  line: number
  column: number
  message: string
  code: string
}

function getLocation(source: string, offset: number): { line: number, column: number } {
  let line = 1
  let column = 1
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line++
      column = 1
    }
    else column++
  }
  return { line, column }
}

export function validateTypeScriptSyntax(source: string): SyntaxIssue[] {
  const issues: SyntaxIssue[] = []
  const nonCodeRanges: Array<{ start: number, end: number }> = []
  const stack: Array<{ char: string, offset: number }> = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  let quote = 0
  let quoteStart = 0
  let blockCommentStart = -1

  for (let index = 0; index < source.length; index++) {
    const char = source.charCodeAt(index)
    const next = source.charCodeAt(index + 1)
    if (blockCommentStart !== -1) {
      if (char === 42 && next === 47) {
        nonCodeRanges.push({ start: blockCommentStart, end: index + 2 })
        blockCommentStart = -1
        index++
      }
      continue
    }
    if (quote) {
      if (char === 92) index++
      else if (char === quote) {
        nonCodeRanges.push({ start: quoteStart, end: index + 1 })
        quote = 0
      }
      continue
    }
    if (char === 47 && next === 42) {
      blockCommentStart = index
      index++
      continue
    }
    if (char === 47 && next === 47) {
      const commentStart = index
      while (index < source.length && source.charCodeAt(index) !== 10) index++
      nonCodeRanges.push({ start: commentStart, end: index })
      continue
    }
    if (char === 39 || char === 34 || char === 96) {
      quote = char
      quoteStart = index
      continue
    }
    const token = source[index]
    if (token === '(' || token === '[' || token === '{') stack.push({ char: token, offset: index })
    else if (pairs[token]) {
      const open = stack.pop()
      if (!open || open.char !== pairs[token]) {
        issues.push({ ...getLocation(source, index), message: `Unexpected closing delimiter ${token}`, code: 'DTSX1004' })
      }
    }
  }

  if (quote) issues.push({ ...getLocation(source, quoteStart), message: 'Unterminated string literal', code: 'DTSX1002' })
  if (blockCommentStart !== -1) issues.push({ ...getLocation(source, blockCommentStart), message: 'Unterminated block comment', code: 'DTSX1003' })
  for (const open of stack) {
    issues.push({ ...getLocation(source, open.offset), message: `Unclosed delimiter ${open.char}`, code: 'DTSX1001' })
  }

  const malformed: Array<[RegExp, string]> = [
    [/\b(?:interface|class|enum)\s*(?=[{=])/g, 'Declaration name expected'],
    [/\bfunction\s*(?=\()/g, 'Function name expected'],
    [/\(\s*:/g, 'Parameter name expected'],
  ]
  for (const [pattern, message] of malformed) {
    for (const match of source.matchAll(pattern)) {
      if (nonCodeRanges.some(range => match.index >= range.start && match.index < range.end)) continue
      issues.push({ ...getLocation(source, match.index), message, code: 'DTSX1005' })
    }
  }

  // A bare `type {` / `type =` is missing an alias name, but the same token
  // sequence is valid in `import type { ... }` and `export type { ... }`.
  for (const match of source.matchAll(/\btype\s*(?=[{=])/g)) {
    if (nonCodeRanges.some(range => match.index >= range.start && match.index < range.end)) continue
    const prefix = source.slice(0, match.index).trimEnd()
    if (prefix.endsWith('import') || prefix.endsWith('export')) continue
    issues.push({ ...getLocation(source, match.index), message: 'Declaration name expected', code: 'DTSX1005' })
  }
  return issues.sort((left, right) => left.line - right.line || left.column - right.column)
}
