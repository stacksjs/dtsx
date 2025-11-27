/**
 * Error handling utilities for dtsx
 * Provides custom error classes and formatting utilities
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
  EXTRACTION_ERROR: 'EXTRACTION_ERROR',
  PROCESSING_ERROR: 'PROCESSING_ERROR',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_DECLARATION: 'INVALID_DECLARATION',

  // Config errors
  CONFIG_ERROR: 'CONFIG_ERROR',
  INVALID_ENTRYPOINT: 'INVALID_ENTRYPOINT',

  // Dependency errors
  CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY',

  // Operation errors
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  NOT_SUPPORTED: 'NOT_SUPPORTED',

  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

/**
 * Base error class for dtsx errors
 */
export class DtsxError extends Error {
  /** Error code for programmatic handling */
  readonly code: ErrorCode

  /** Additional context about the error */
  readonly context?: Record<string, unknown>

  constructor(message: string, code: ErrorCode = 'UNKNOWN_ERROR', context?: Record<string, unknown>) {
    super(message)
    this.name = 'DtsxError'
    this.code = code
    this.context = context

    // Maintains proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /** Format error for logging */
  toString(): string {
    let str = `${this.name} [${this.code}]: ${this.message}`
    if (this.context) {
      str += `\nContext: ${JSON.stringify(this.context, null, 2)}`
    }
    return str
  }

  /** Convert to JSON for serialization */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
    }
  }
}

/**
 * Error during file parsing
 */
export class ParseError extends DtsxError {
  readonly filePath: string
  readonly line?: number
  readonly column?: number

  constructor(message: string, filePath: string, options?: { line?: number, column?: number, cause?: Error }) {
    super(message, 'PARSE_ERROR', { filePath, line: options?.line, column: options?.column })
    this.name = 'ParseError'
    this.filePath = filePath
    this.line = options?.line
    this.column = options?.column
    if (options?.cause) this.cause = options.cause
  }

  get locationString(): string {
    if (this.line !== undefined && this.column !== undefined) {
      return `${this.filePath}:${this.line}:${this.column}`
    }
    return this.line !== undefined ? `${this.filePath}:${this.line}` : this.filePath
  }
}

/**
 * Error during declaration extraction
 */
export class ExtractionError extends DtsxError {
  readonly filePath: string
  readonly declarationKind?: string

  constructor(message: string, filePath: string, declarationKind?: string, cause?: Error) {
    super(message, 'EXTRACTION_ERROR', { filePath, declarationKind })
    this.name = 'ExtractionError'
    this.filePath = filePath
    this.declarationKind = declarationKind
    if (cause) this.cause = cause
  }
}

/**
 * Error during type processing
 */
export class ProcessingError extends DtsxError {
  readonly declarationName?: string

  constructor(message: string, declarationName?: string, cause?: Error) {
    super(message, 'PROCESSING_ERROR', { declarationName })
    this.name = 'ProcessingError'
    this.declarationName = declarationName
    if (cause) this.cause = cause
  }
}

/**
 * Error during file I/O operations
 */
export class FileError extends DtsxError {
  readonly filePath: string
  readonly operation: 'read' | 'write' | 'delete' | 'stat' | 'glob'

  constructor(message: string, filePath: string, operation: 'read' | 'write' | 'delete' | 'stat' | 'glob', cause?: Error) {
    super(message, operation === 'read' ? 'FILE_READ_ERROR' : 'FILE_WRITE_ERROR', { filePath, operation })
    this.name = 'FileError'
    this.filePath = filePath
    this.operation = operation
    if (cause) this.cause = cause
  }
}

/**
 * Error during configuration loading or validation
 */
export class ConfigError extends DtsxError {
  readonly configPath?: string
  readonly invalidKey?: string

  constructor(message: string, options?: { configPath?: string, invalidKey?: string, cause?: Error }) {
    super(message, 'CONFIG_ERROR', { configPath: options?.configPath, invalidKey: options?.invalidKey })
    this.name = 'ConfigError'
    this.configPath = options?.configPath
    this.invalidKey = options?.invalidKey
    if (options?.cause) this.cause = options.cause
  }
}

/**
 * Error when circular dependency is detected
 */
export class CircularDependencyError extends DtsxError {
  readonly cycle: string[]

  constructor(cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`, 'CIRCULAR_DEPENDENCY', { cycle })
    this.name = 'CircularDependencyError'
    this.cycle = cycle
  }
}

/**
 * Type guards for error types
 */
export function isDtsxError(error: unknown): error is DtsxError {
  return error instanceof DtsxError
}

export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError
}

export function isFileError(error: unknown): error is FileError {
  return error instanceof FileError
}

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError
}

/**
 * Wrap an unknown error in a DtsxError
 */
export function wrapError(error: unknown, code: ErrorCode = 'UNKNOWN_ERROR', message?: string): DtsxError {
  if (error instanceof DtsxError) return error
  const errorMessage = message || (error instanceof Error ? error.message : String(error))
  const wrapped = new DtsxError(errorMessage, code)
  if (error instanceof Error) wrapped.cause = error
  return wrapped
}

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
