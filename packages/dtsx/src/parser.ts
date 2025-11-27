/**
 * Parser utilities - DEPRECATED
 *
 * This module contains legacy string-based parsing utilities.
 * Most functionality has been superseded by TypeScript AST-based extraction
 * in the extractor module.
 *
 * @deprecated Use extractor module for AST-based extraction and
 * processor/type-inference for type inference utilities.
 */

export { extractJSDocComments as extractLeadingCommentsFromNode, getNodeText } from './extractor/helpers'
export { formatComments } from './processor/comments'
// Re-export commonly used utilities from their new locations
export { findMatchingBracket } from './processor/type-inference'

/**
 * @deprecated Use TypeScript AST-based extraction instead
 */
export function removeLeadingComments(text: string): string {
  let result = text
  let changed = true

  while (changed) {
    changed = false
    const trimmed = result.trimStart()

    if (trimmed.startsWith('/*')) {
      const endIndex = trimmed.indexOf('*/', 2)
      if (endIndex !== -1) {
        result = trimmed.slice(endIndex + 2)
        changed = true
        continue
      }
    }

    if (trimmed.startsWith('//')) {
      const newlineIndex = trimmed.indexOf('\n')
      if (newlineIndex !== -1) {
        result = trimmed.slice(newlineIndex + 1)
        changed = true
      }
      else {
        result = ''
        changed = true
      }
    }
  }

  return result.trim()
}

/**
 * @deprecated Use extractJSDocComments from extractor/helpers instead
 */
export function extractLeadingComments(source: string, position: number): string[] {
  const before = source.substring(0, position)
  const lines = before.split('\n')
  const comments: string[] = []

  let i = lines.length - 1
  let inMultilineComment = false
  let multilineCommentLines: string[] = []

  while (i >= 0) {
    const line = lines[i].trim()

    if (line.endsWith('*/') && !inMultilineComment) {
      inMultilineComment = true
      multilineCommentLines.unshift(line)
    }
    else if (line.startsWith('/*') && inMultilineComment) {
      multilineCommentLines.unshift(line)
      comments.unshift(...multilineCommentLines)
      multilineCommentLines = []
      inMultilineComment = false
    }
    else if (inMultilineComment) {
      multilineCommentLines.unshift(line)
    }
    else if (line.startsWith('//')) {
      comments.unshift(line)
    }
    else if (line.startsWith('*') && (i > 0 && lines[i - 1].trim().startsWith('/*'))) {
      comments.unshift(line)
    }
    else if (line === '' && comments.length > 0) {
      // Continue
    }
    else if (line !== '') {
      break
    }

    i--
  }

  return comments
}

/**
 * @deprecated Not commonly used - use inline logic instead
 */
export function extractTrailingComment(line: string): string | null {
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
 * @deprecated Use findMatchingBracket from processor/type-inference instead
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

  if (!text.startsWith(openSymbol)) {
    return null
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (!escaped && (char === '"' || char === '\'' || char === '`')) {
      if (!inString) {
        inString = true
        stringChar = char
      }
      else if (char === stringChar) {
        inString = false
      }
    }

    if (char === '\\' && !escaped) {
      escaped = true
      continue
    }
    escaped = false

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
 * @deprecated Interface kept for backward compatibility
 */
export interface FunctionSignature {
  name: string
  generics: string
  parameters: string
  returnType: string
  modifiers: string[]
}

/**
 * @deprecated Use TypeScript AST-based extraction instead
 */
export function parseFunctionDeclaration(text: string): FunctionSignature | null {
  const clean = removeLeadingComments(text).trim()

  const functionMatch = clean.match(
    /^(export\s+)?(async\s+)?function\s*(\*?)([a-zA-Z_$][\w$]*)/,
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

  let generics = ''
  if (rest.startsWith('<')) {
    const genericResult = extractBalancedSymbols(rest, '<', '>')
    if (genericResult) {
      generics = genericResult.content
      rest = genericResult.rest.trim()
    }
  }

  let parameters = ''
  if (rest.startsWith('(')) {
    const paramResult = extractBalancedSymbols(rest, '(', ')')
    if (paramResult) {
      parameters = paramResult.content.slice(1, -1).trim()
      rest = paramResult.rest.trim()
    }
  }

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
 * @deprecated Use hasExportModifier from extractor/helpers instead
 */
export function isExportStatement(line: string): boolean {
  return /^\s*export\s+/.test(line)
}

/**
 * @deprecated Not commonly used
 */
export function isTypeOnlyExport(line: string): boolean {
  return /^\s*export\s+type\s+/.test(line)
}

/**
 * @deprecated Use TypeScript AST-based extraction instead
 */
export function parseVariableDeclaration(text: string): {
  name: string
  kind: 'const' | 'let' | 'var'
  typeAnnotation?: string
  value?: string
} | null {
  const clean = removeLeadingComments(text).trim()

  const declarationMatch = clean.match(/^(export\s+)?(const|let|var)\s+([a-zA-Z_$][\w$]*)/)

  if (!declarationMatch)
    return null

  const kind = declarationMatch[2] as 'const' | 'let' | 'var'
  const name = declarationMatch[3]

  let rest = clean.substring(declarationMatch[0].length).trim()

  let typeAnnotation: string | undefined
  if (rest.startsWith(':')) {
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
