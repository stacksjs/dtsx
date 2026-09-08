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

  issues.push(...validateModuleClauses(source, nonCodeRanges))

  return issues.sort((left, right) => left.line - right.line || left.column - right.column)
}

/** A binding name: an identifier (unicode included), or a string module-export name. */
const BINDING_NAME = String.raw`(?:[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*|'[^']*'|"[^"]*")`

/** One entry of a specifier list: `a`, `a as b`, `type A`, `type A as B`, `default as X`. */
const SPECIFIER_RE = new RegExp(`^(?:type\\s+)?${BINDING_NAME}(?:\\s+as\\s+${BINDING_NAME})?$`, 'u')

/**
 * Parse every `import`/`export` braced specifier list and check its contents.
 *
 * Balanced braces are not a grammar. A wrapped export clause whose specifiers
 * were separated by `;` instead of `,` balanced perfectly, so `--validate`
 * called the file good and the broken declaration shipped. The clause is the
 * one construct a declaration file cannot be wrong about — everything a
 * consumer imports travels through it — so it is parsed rather than counted.
 */
function validateModuleClauses(
  source: string,
  nonCodeRanges: Array<{ start: number, end: number }>,
): SyntaxIssue[] {
  const issues: SyntaxIssue[] = []
  const inNonCode = (offset: number): boolean =>
    nonCodeRanges.some(range => offset >= range.start && offset < range.end)

  for (const match of source.matchAll(/\b(import|export)\s+(?:type\s+)?\{/g)) {
    const start = match.index
    if (inNonCode(start)) continue

    const openBrace = start + match[0].length - 1
    let close = -1
    for (let index = openBrace + 1; index < source.length; index++) {
      if (inNonCode(index)) continue
      const char = source[index]
      // A specifier list cannot nest braces; anything else means this was not
      // a module clause after all (`export default {` and friends), so bail
      // rather than report against a construct we did not parse.
      if (char === '{') {
        close = -2
        break
      }
      if (char === '}') {
        close = index
        break
      }
    }
    if (close < 0) continue

    const body = source.slice(openBrace + 1, close)
    if (!body.trim()) continue

    let offset = openBrace + 1
    for (const part of body.split(',')) {
      const text = part.trim()
      if (text) {
        const partOffset = offset + part.indexOf(text)
        if (text.includes(';')) {
          issues.push({
            ...getLocation(source, partOffset),
            message: `Unexpected ';' in ${match[1]} clause — specifiers are separated by ','`,
            code: 'DTSX1006',
          })
        }
        else if (!SPECIFIER_RE.test(text)) {
          issues.push({
            ...getLocation(source, partOffset),
            message: `Invalid ${match[1]} specifier '${text}'`,
            code: 'DTSX1006',
          })
        }
      }
      offset += part.length + 1
    }
  }

  return issues
}
