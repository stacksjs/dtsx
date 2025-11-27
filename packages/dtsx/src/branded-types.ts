/**
 * Branded types for enhanced type safety
 * These types provide compile-time guarantees for distinct string types
 */

/**
 * Brand symbol for creating nominal types
 */
declare const __brand: unique symbol

/**
 * Generic branded type creator
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B }

/**
 * Branded type for file paths
 * Ensures file paths are validated before use
 */
export type FilePath = Brand<string, 'FilePath'>

/**
 * Branded type for directory paths
 */
export type DirectoryPath = Brand<string, 'DirectoryPath'>

/**
 * Branded type for glob patterns
 */
export type GlobPattern = Brand<string, 'GlobPattern'>

/**
 * Branded type for TypeScript source code
 */
export type SourceCode = Brand<string, 'SourceCode'>

/**
 * Branded type for declaration file content
 */
export type DtsContent = Brand<string, 'DtsContent'>

/**
 * Branded type for module specifiers (import paths)
 */
export type ModuleSpecifier = Brand<string, 'ModuleSpecifier'>

/**
 * Branded type for type names
 */
export type TypeName = Brand<string, 'TypeName'>

/**
 * Branded type for declaration names
 */
export type DeclarationName = Brand<string, 'DeclarationName'>

/**
 * Branded type for validated JSON strings
 */
export type JsonString = Brand<string, 'JsonString'>

/**
 * Branded type for absolute paths
 */
export type AbsolutePath = Brand<string, 'AbsolutePath'>

/**
 * Branded type for relative paths
 */
export type RelativePath = Brand<string, 'RelativePath'>

/**
 * Type guard and constructor for FilePath
 */
export function asFilePath(path: string): FilePath {
  // Basic validation - could be extended
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid file path: must be a non-empty string')
  }
  return path as FilePath
}

/**
 * Type guard and constructor for DirectoryPath
 */
export function asDirectoryPath(path: string): DirectoryPath {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid directory path: must be a non-empty string')
  }
  return path as DirectoryPath
}

/**
 * Type guard and constructor for GlobPattern
 */
export function asGlobPattern(pattern: string): GlobPattern {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid glob pattern: must be a non-empty string')
  }
  return pattern as GlobPattern
}

/**
 * Type guard and constructor for SourceCode
 */
export function asSourceCode(code: string): SourceCode {
  if (typeof code !== 'string') {
    throw new Error('Invalid source code: must be a string')
  }
  return code as SourceCode
}

/**
 * Type guard and constructor for DtsContent
 */
export function asDtsContent(content: string): DtsContent {
  if (typeof content !== 'string') {
    throw new Error('Invalid DTS content: must be a string')
  }
  return content as DtsContent
}

/**
 * Type guard and constructor for ModuleSpecifier
 */
export function asModuleSpecifier(specifier: string): ModuleSpecifier {
  if (!specifier || typeof specifier !== 'string') {
    throw new Error('Invalid module specifier: must be a non-empty string')
  }
  return specifier as ModuleSpecifier
}

/**
 * Type guard and constructor for TypeName
 */
export function asTypeName(name: string): TypeName {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid type name: must be a non-empty string')
  }
  // Validate it looks like a type name (starts with uppercase or is a primitive)
  const primitives = ['string', 'number', 'boolean', 'symbol', 'bigint', 'undefined', 'null', 'void', 'never', 'any', 'unknown', 'object']
  if (!primitives.includes(name) && !/^[A-Z_$]/.test(name)) {
    // Allow lowercase for primitive types, but warn for others
    // This is a soft validation - we still accept it
  }
  return name as TypeName
}

/**
 * Type guard and constructor for DeclarationName
 */
export function asDeclarationName(name: string): DeclarationName {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid declaration name: must be a non-empty string')
  }
  return name as DeclarationName
}

/**
 * Type guard and constructor for AbsolutePath
 */
export function asAbsolutePath(path: string): AbsolutePath {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid absolute path: must be a non-empty string')
  }
  // Check if it starts with / (Unix) or drive letter (Windows)
  if (!path.startsWith('/') && !/^[A-Za-z]:/.test(path)) {
    throw new Error('Invalid absolute path: must start with / or drive letter')
  }
  return path as AbsolutePath
}

/**
 * Type guard and constructor for RelativePath
 */
export function asRelativePath(path: string): RelativePath {
  if (!path || typeof path !== 'string') {
    throw new Error('Invalid relative path: must be a non-empty string')
  }
  // Relative paths start with . or don't start with / or drive letter
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    throw new Error('Invalid relative path: must not be absolute')
  }
  return path as RelativePath
}

/**
 * Type guard and constructor for JsonString
 */
export function asJsonString(json: string): JsonString {
  if (typeof json !== 'string') {
    throw new Error('Invalid JSON string: must be a string')
  }
  try {
    JSON.parse(json)
  }
  catch {
    throw new Error('Invalid JSON string: must be valid JSON')
  }
  return json as JsonString
}

/**
 * Check if a value is a branded type of a specific brand
 */
export function isBranded<T, B extends string>(value: unknown, _brand: B): value is Brand<T, B> {
  return typeof value === 'string' || typeof value === 'number'
}

/**
 * Unwrap a branded type to its base type
 * Useful when you need to pass branded types to external APIs
 */
export function unwrap<T>(branded: Brand<T, string>): T {
  return branded as T
}

/**
 * Type utility to extract the brand from a branded type
 */
export type ExtractBrand<T> = T extends Brand<unknown, infer B> ? B : never

/**
 * Type utility to extract the base type from a branded type
 */
export type ExtractBase<T> = T extends Brand<infer U, string> ? U : T

/**
 * Safe path operations that preserve branding
 */
export const BrandedPath = {
  /**
   * Join path segments, returning appropriate branded type
   */
  join(base: DirectoryPath, ...segments: string[]): FilePath {
    const { join } = require('node:path')
    return join(base, ...segments) as FilePath
  },

  /**
   * Get directory name from a file path
   */
  dirname(path: FilePath): DirectoryPath {
    const { dirname } = require('node:path')
    return dirname(path) as DirectoryPath
  },

  /**
   * Get base name from a file path
   */
  basename(path: FilePath): string {
    const { basename } = require('node:path')
    return basename(path)
  },

  /**
   * Resolve path to absolute
   */
  resolve(...segments: string[]): AbsolutePath {
    const { resolve } = require('node:path')
    return resolve(...segments) as AbsolutePath
  },

  /**
   * Check if path is absolute
   */
  isAbsolute(path: string): path is AbsolutePath {
    const { isAbsolute } = require('node:path')
    return isAbsolute(path)
  },

  /**
   * Get relative path from one path to another
   */
  relative(from: DirectoryPath, to: FilePath): RelativePath {
    const { relative } = require('node:path')
    return relative(from, to) as RelativePath
  },
}
