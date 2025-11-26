/**
 * Error handling utilities for dtsx
 */

import type { DtsError, SourceLocation } from './types'

/**
 * Error codes for categorizing errors
 */
export const ErrorCodes = {
  // Parse errors
  PARSE_ERROR: 'PARSE_ERROR',
  SYNTAX_ERROR: 'SYNTAX_ERROR',

  // File errors
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_READ_ERROR: 'FILE_READ_ERROR',
  FILE_WRITE_ERROR: 'FILE_WRITE_ERROR',

  // Type errors
  TYPE_INFERENCE_ERROR: 'TYPE_INFERENCE_ERROR',
  UNRESOLVED_TYPE: 'UNRESOLVED_TYPE',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_DECLARATION: 'INVALID_DECLARATION',

  // Config errors
  CONFIG_ERROR: 'CONFIG_ERROR',
  INVALID_ENTRYPOINT: 'INVALID_ENTRYPOINT',

  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * Calculate line and column from source code offset
 */
export function getLocationFromOffset(sourceCode: string, offset: number): SourceLocation {
  let line = 1
  let column = 1
  let currentOffset = 0

  for (const char of sourceCode) {
    if (currentOffset >= offset) break

    if (char === '\n') {
      line++
      column = 1
    }
    else {
      column++
    }
    currentOffset++
  }

  return { line, column, offset }
}

/**
 * Create a formatted error message with source location context
 */
export function formatErrorWithContext(
  sourceCode: string,
  location: SourceLocation,
  message: string,
  filePath?: string,
): string {
  const lines = sourceCode.split('\n')
  const lineIndex = location.line - 1

  // Build error output
  const parts: string[] = []

  // File and location header
  if (filePath) {
    parts.push(`${filePath}:${location.line}:${location.column}`)
  }
  else {
    parts.push(`Line ${location.line}, Column ${location.column}`)
  }

  parts.push(`Error: ${message}`)
  parts.push('')

  // Show context lines (1 before, error line, 1 after)
  const startLine = Math.max(0, lineIndex - 1)
  const endLine = Math.min(lines.length - 1, lineIndex + 1)

  for (let i = startLine; i <= endLine; i++) {
    const lineNum = (i + 1).toString().padStart(4, ' ')
    const marker = i === lineIndex ? '>' : ' '
    parts.push(`${marker} ${lineNum} | ${lines[i]}`)

    // Add caret pointing to error column on the error line
    if (i === lineIndex) {
      const padding = ' '.repeat(8 + location.column - 1)
      parts.push(`${padding}^`)
    }
  }

  return parts.join('\n')
}

/**
 * Create a DtsError from an exception
 */
export function createDtsError(
  error: unknown,
  file: string,
  sourceCode?: string,
): DtsError {
  const baseError: DtsError = {
    file,
    message: 'Unknown error',
    code: ErrorCodes.UNKNOWN_ERROR,
  }

  if (error instanceof Error) {
    baseError.message = error.message
    baseError.stack = error.stack

    // Try to extract location from TypeScript compiler errors
    const lineMatch = error.message.match(/\((\d+),(\d+)\)/)
    if (lineMatch) {
      baseError.location = {
        line: Number.parseInt(lineMatch[1], 10),
        column: Number.parseInt(lineMatch[2], 10),
      }
    }

    // Categorize error
    if (error.message.includes('Cannot find') || error.message.includes('not found')) {
      baseError.code = ErrorCodes.FILE_NOT_FOUND
      baseError.suggestion = 'Check that the file path is correct and the file exists.'
    }
    else if (error.message.includes('syntax') || error.message.includes('Unexpected token')) {
      baseError.code = ErrorCodes.SYNTAX_ERROR
      baseError.suggestion = 'Check for syntax errors in your TypeScript code.'
    }
    else if (error.message.includes('type') && error.message.includes('cannot')) {
      baseError.code = ErrorCodes.TYPE_INFERENCE_ERROR
      baseError.suggestion = 'Add explicit type annotations to help with type inference.'
    }
    else if (error.message.includes('parse') || error.message.includes('Parse')) {
      baseError.code = ErrorCodes.PARSE_ERROR
      baseError.suggestion = 'The file contains invalid TypeScript syntax.'
    }
  }
  else if (typeof error === 'string') {
    baseError.message = error
  }

  return baseError
}

/**
 * Format a DtsError for display
 */
export function formatDtsError(error: DtsError, sourceCode?: string): string {
  const parts: string[] = []

  // Header with file and location
  let header = error.file
  if (error.location) {
    header += `:${error.location.line}:${error.location.column}`
  }
  if (error.code) {
    header += ` [${error.code}]`
  }
  parts.push(header)

  // Error message
  parts.push(`  Error: ${error.message}`)

  // Show source context if available
  if (sourceCode && error.location) {
    parts.push('')
    const lines = sourceCode.split('\n')
    const lineIndex = error.location.line - 1

    if (lineIndex >= 0 && lineIndex < lines.length) {
      const startLine = Math.max(0, lineIndex - 1)
      const endLine = Math.min(lines.length - 1, lineIndex + 1)

      for (let i = startLine; i <= endLine; i++) {
        const lineNum = (i + 1).toString().padStart(4, ' ')
        const marker = i === lineIndex ? '>' : ' '
        parts.push(`  ${marker} ${lineNum} | ${lines[i]}`)

        if (i === lineIndex && error.location.column > 0) {
          const padding = ' '.repeat(10 + error.location.column - 1)
          parts.push(`  ${padding}^`)
        }
      }
    }
  }

  // Suggestion
  if (error.suggestion) {
    parts.push('')
    parts.push(`  Suggestion: ${error.suggestion}`)
  }

  return parts.join('\n')
}

/**
 * Aggregate multiple errors into a summary
 */
export function summarizeErrors(errors: DtsError[]): string {
  if (errors.length === 0) {
    return 'No errors'
  }

  const byCode = new Map<string, number>()
  for (const error of errors) {
    const code = error.code || 'UNKNOWN'
    byCode.set(code, (byCode.get(code) || 0) + 1)
  }

  const parts: string[] = [`${errors.length} error(s) found:`]

  for (const [code, count] of byCode.entries()) {
    parts.push(`  - ${code}: ${count}`)
  }

  return parts.join('\n')
}
