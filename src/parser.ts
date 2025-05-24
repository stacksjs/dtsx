/**
 * Parser utilities for TypeScript syntax
 */

/**
 * Remove leading comments from a declaration
 */
export function removeLeadingComments(text: string): string {
  return text.replace(/^(\s*\/\*[\s\S]*?\*\/\s*|\s*\/\/.*\n)*/g, '').trim()
}

/**
 * Extract leading comments from source code before a position
 */
export function extractLeadingComments(source: string, position: number): string[] {
  const before = source.substring(0, position)
  const lines = before.split('\n')
  const comments: string[] = []

  // Look backwards for comments
  let i = lines.length - 1
  let inMultilineComment = false
  let multilineCommentLines: string[] = []

  while (i >= 0) {
    const line = lines[i].trim()

    // Check for end of multiline comment
    if (line.endsWith('*/') && !inMultilineComment) {
      inMultilineComment = true
      multilineCommentLines.unshift(line)
    }
    // Check for start of multiline comment
    else if (line.startsWith('/*') && inMultilineComment) {
      multilineCommentLines.unshift(line)
      comments.unshift(...multilineCommentLines)
      multilineCommentLines = []
      inMultilineComment = false
    }
    // Inside multiline comment
    else if (inMultilineComment) {
      multilineCommentLines.unshift(line)
    }
    // Single line comment
    else if (line.startsWith('//')) {
      comments.unshift(line)
    }
    // JSDoc style comment line
    else if (line.startsWith('*') && (i > 0 && lines[i - 1].trim().startsWith('/*'))) {
      comments.unshift(line)
    }
    // Empty line between declaration and comments
    else if (line === '' && comments.length > 0) {
      // Continue to look for more comments
    }
    // Non-comment, non-empty line - stop
    else if (line !== '') {
      break
    }

    i--
  }

  return comments
}

/**
 * Extract trailing comments from a line
 */
export function extractTrailingComment(line: string): string | null {
  // Find comment outside of strings
  let inString = false
  let stringChar = ''
  let escaped = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (!escaped && !inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (!escaped && inString && char === stringChar) {
      inString = false
    }
    else if (char === '\\' && !escaped) {
      escaped = true
      continue
    }
    else if (!inString && char === '/' && i < line.length - 1) {
      if (line[i + 1] === '/') {
        return line.substring(i)
      }
    }

    escaped = false
  }

  return null
}

/**
 * Format comments for output
 */
export function formatComments(comments: string[]): string[] {
  return comments.map((comment) => {
    // Preserve indentation and format
    return comment
  })
}

/**
 * Extract balanced content between symbols (e.g., <>, (), {})
 */
export function extractBalancedSymbols(
  text: string,
  openSymbol: string,
  closeSymbol: string,
): { content: string, rest: string } | null {
  let depth = 0
  let inString = false
  let stringChar = ''
  let escaped = false
  let i = 0

  if (!text.startsWith(openSymbol)) {
    return null
  }

  for (i = 0; i < text.length; i++) {
    const char = text[i]
    const prevChar = i > 0 ? text[i - 1] : ''

    // Handle string literals
    if (!escaped && (char === '"' || char === '\'' || char === '`')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    // Handle escape sequences
    if (char === '\\' && !escaped) {
      escaped = true
      continue
    }
    escaped = false

    // Count brackets only outside strings
    if (!inString) {
      if (text.substring(i, i + openSymbol.length) === openSymbol) {
        depth++
      }
      else if (text.substring(i, i + closeSymbol.length) === closeSymbol) {
        depth--
        if (depth === 0) {
          return {
            content: text.substring(0, i + closeSymbol.length),
            rest: text.substring(i + closeSymbol.length),
          }
        }
      }
    }
  }

  return null
}

/**
 * Extract function signature parts
 */
export interface FunctionSignature {
  name: string
  generics: string
  parameters: string
  returnType: string
  modifiers: string[]
}

/**
 * Parse a function declaration
 */
export function parseFunctionDeclaration(text: string): FunctionSignature | null {
  const clean = removeLeadingComments(text).trim()

  // Match function pattern
  const functionMatch = clean.match(
    /^(export\s+)?(async\s+)?function\s*(\*?)\s*([a-zA-Z_$][\w$]*)/,
  )

  if (!functionMatch)
    return null

  const modifiers: string[] = []
  if (functionMatch[1])
    modifiers.push('export')
  if (functionMatch[2])
    modifiers.push('async')
  if (functionMatch[3])
    modifiers.push('generator')

  const name = functionMatch[4]
  let rest = clean.substring(functionMatch[0].length).trim()

  // Extract generics
  let generics = ''
  if (rest.startsWith('<')) {
    const genericResult = extractBalancedSymbols(rest, '<', '>')
    if (genericResult) {
      generics = genericResult.content
      rest = genericResult.rest.trim()
    }
  }

  // Extract parameters
  let parameters = ''
  if (rest.startsWith('(')) {
    const paramResult = extractBalancedSymbols(rest, '(', ')')
    if (paramResult) {
      parameters = paramResult.content.slice(1, -1).trim()
      rest = paramResult.rest.trim()
    }
  }

  // Extract return type
  let returnType = 'void'
  if (rest.startsWith(':')) {
    const typeMatch = rest.match(/^:\s*([^{;]+)/)
    if (typeMatch) {
      returnType = typeMatch[1].trim()
    }
  }

  return {
    name,
    generics,
    parameters,
    returnType,
    modifiers,
  }
}

/**
 * Check if a line is an export statement
 */
export function isExportStatement(line: string): boolean {
  return /^\s*export\s+/.test(line)
}

/**
 * Check if a line is a type-only export
 */
export function isTypeOnlyExport(line: string): boolean {
  return /^\s*export\s+type\s+/.test(line)
}

/**
 * Extract variable name and type from declaration
 */
export function parseVariableDeclaration(text: string): {
  name: string
  kind: 'const' | 'let' | 'var'
  typeAnnotation?: string
  value?: string
} | null {
  const clean = removeLeadingComments(text).trim()

  // First, find the variable kind and name
  const declarationMatch = clean.match(/^(export\s+)?(const|let|var)\s+([a-zA-Z_$][\w$]*)/)

  if (!declarationMatch)
    return null

  const kind = declarationMatch[2] as 'const' | 'let' | 'var'
  const name = declarationMatch[3]

  // Find where the name ends
  let rest = clean.substring(declarationMatch[0].length).trim()

  // Extract type annotation if present
  let typeAnnotation: string | undefined
  if (rest.startsWith(':')) {
    // Find the end of the type annotation (before = or end of statement)
    const equalIndex = rest.indexOf('=')
    if (equalIndex !== -1) {
      typeAnnotation = rest.substring(1, equalIndex).trim()
      rest = rest.substring(equalIndex).trim()
    }
    else {
      typeAnnotation = rest.substring(1).replace(/;?\s*$/, '').trim()
      rest = ''
    }
  }

  // Extract value if present
  let value: string | undefined
  if (rest.startsWith('=')) {
    value = rest.substring(1).replace(/;?\s*$/, '').trim()
  }

  return {
    kind,
    name,
    typeAnnotation,
    value,
  }
}
