/**
 * Security utilities for dtsx
 *
 * Provides protection against:
 * - Path traversal attacks
 * - Large file DoS
 * - Processing timeouts
 * - Symlink attacks
 */

import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, normalize, relative, resolve } from 'node:path'

/**
 * Security configuration options
 */
export interface SecurityConfig {
  /**
   * Root directory that all file operations must stay within
   * Files outside this directory will be rejected
   */
  rootDir?: string
  /**
   * Maximum file size in bytes (default: 10MB)
   * Files larger than this will be rejected
   */
  maxFileSize?: number
  /**
   * Maximum total size of all files in bytes (default: 100MB)
   */
  maxTotalSize?: number
  /**
   * Processing timeout in milliseconds (default: 30000 / 30 seconds)
   */
  timeout?: number
  /**
   * Whether to follow symbolic links (default: false)
   * When false, symlinks will be rejected
   */
  followSymlinks?: boolean
  /**
   * Maximum number of files to process (default: 10000)
   */
  maxFiles?: number
  /**
   * Blocked file patterns (glob patterns)
   */
  blockedPatterns?: string[]
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: Required<SecurityConfig> = {
  rootDir: process.cwd(),
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxTotalSize: 100 * 1024 * 1024, // 100MB
  timeout: 30000, // 30 seconds
  followSymlinks: false,
  maxFiles: 10000,
  blockedPatterns: [
    '**/.git/**',
    '**/node_modules/**',
    '**/.env*',
    '**/secrets/**',
    '**/*.key',
    '**/*.pem',
  ],
}

/**
 * Security validation error
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly code: SecurityErrorCode,
    public readonly path?: string,
  ) {
    super(message)
    this.name = 'SecurityError'
  }
}

/**
 * Security error codes
 */
export type SecurityErrorCode =
  | 'PATH_TRAVERSAL'
  | 'FILE_TOO_LARGE'
  | 'TOTAL_SIZE_EXCEEDED'
  | 'TIMEOUT'
  | 'SYMLINK_NOT_ALLOWED'
  | 'MAX_FILES_EXCEEDED'
  | 'BLOCKED_PATTERN'
  | 'INVALID_PATH'

/**
 * Validate that a path is safe and within the allowed root directory
 */
export function validatePath(filePath: string, config: SecurityConfig = {}): string {
  const { rootDir = process.cwd() } = config

  // Normalize and resolve the path
  const normalizedPath = normalize(filePath)
  const absolutePath = isAbsolute(normalizedPath)
    ? normalizedPath
    : resolve(rootDir, normalizedPath)

  // Resolve to canonical path (handles .. and .)
  const resolvedPath = resolve(absolutePath)

  // Check if the resolved path is within the root directory
  const relativePath = relative(rootDir, resolvedPath)

  // If the relative path starts with ".." or is absolute, it's outside root
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new SecurityError(
      `Path traversal detected: "${filePath}" resolves outside root directory`,
      'PATH_TRAVERSAL',
      filePath,
    )
  }

  return resolvedPath
}

/**
 * Validate multiple paths
 */
export function validatePaths(filePaths: string[], config: SecurityConfig = {}): string[] {
  return filePaths.map(p => validatePath(p, config))
}

/**
 * Check if a path matches any blocked pattern
 */
export function isBlockedPath(filePath: string, config: SecurityConfig = {}): boolean {
  const patterns = config.blockedPatterns || DEFAULT_SECURITY_CONFIG.blockedPatterns

  for (const pattern of patterns) {
    if (matchGlobPattern(filePath, pattern)) {
      return true
    }
  }

  return false
}

/**
 * Simple glob pattern matching
 * Supports ** (any path), * (any segment), and ? (single char)
 */
function matchGlobPattern(path: string, pattern: string): boolean {
  // Normalize the path for comparison
  const normalizedPath = path.replace(/\\/g, '/')

  // Use placeholder tokens for glob patterns before escaping
  let regexPattern = pattern
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '<<STAR>>')
    .replace(/\?/g, '<<QUESTION>>')

  // Escape special regex chars
  regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')

  // Replace placeholders with regex patterns
  // <<GLOBSTAR>> at start: matches any prefix including empty
  regexPattern = regexPattern.replace(/^<<GLOBSTAR>>\//, '(.*\\/)?')
  // <<GLOBSTAR>> at end: matches any suffix including empty
  regexPattern = regexPattern.replace(/\/<<GLOBSTAR>>$/, '(\\/.*)?')
  // <<GLOBSTAR>> in middle: matches any middle path
  regexPattern = regexPattern.replace(/\/<<GLOBSTAR>>\//g, '(\\/.*)?\\/')
  // Remaining <<GLOBSTAR>>: matches anything
  regexPattern = regexPattern.replace(/<<GLOBSTAR>>/g, '.*')
  // <<STAR>>: matches segment without /
  regexPattern = regexPattern.replace(/<<STAR>>/g, '[^/]*')
  // <<QUESTION>>: single char
  regexPattern = regexPattern.replace(/<<QUESTION>>/g, '[^/]')

  // Create regex that matches the whole path
  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(normalizedPath)
}

/**
 * Validate file size
 */
export async function validateFileSize(
  filePath: string,
  config: SecurityConfig = {},
): Promise<number> {
  const maxSize = config.maxFileSize ?? DEFAULT_SECURITY_CONFIG.maxFileSize

  try {
    const stats = await stat(filePath)

    if (stats.size > maxSize) {
      throw new SecurityError(
        `File too large: "${filePath}" is ${formatBytes(stats.size)}, max is ${formatBytes(maxSize)}`,
        'FILE_TOO_LARGE',
        filePath,
      )
    }

    return stats.size
  }
  catch (error) {
    if (error instanceof SecurityError)
      throw error
    throw new SecurityError(
      `Failed to check file size: ${filePath}`,
      'INVALID_PATH',
      filePath,
    )
  }
}

/**
 * Check if path is a symbolic link
 */
export async function isSymlink(filePath: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath)
    return stats.isSymbolicLink()
  }
  catch {
    return false
  }
}

/**
 * Validate that a path is not a symlink (or follow it if allowed)
 */
export async function validateSymlink(
  filePath: string,
  config: SecurityConfig = {},
): Promise<string> {
  const followSymlinks = config.followSymlinks ?? DEFAULT_SECURITY_CONFIG.followSymlinks

  if (await isSymlink(filePath)) {
    if (!followSymlinks) {
      throw new SecurityError(
        `Symbolic links not allowed: "${filePath}"`,
        'SYMLINK_NOT_ALLOWED',
        filePath,
      )
    }

    // Follow the symlink and validate the target
    const realPath = await realpath(filePath)
    return validatePath(realPath, config)
  }

  return filePath
}

/**
 * Full path validation including all security checks
 */
export async function validateFilePath(
  filePath: string,
  config: SecurityConfig = {},
): Promise<{ path: string, size: number }> {
  // 1. Validate path is within root
  const validatedPath = validatePath(filePath, config)

  // 2. Check blocked patterns
  if (isBlockedPath(validatedPath, config)) {
    throw new SecurityError(
      `Path matches blocked pattern: "${filePath}"`,
      'BLOCKED_PATTERN',
      filePath,
    )
  }

  // 3. Check symlinks
  const resolvedPath = await validateSymlink(validatedPath, config)

  // 4. Check file size
  const size = await validateFileSize(resolvedPath, config)

  return { path: resolvedPath, size }
}

/**
 * Validate a batch of files with total size limit
 */
export async function validateFileBatch(
  filePaths: string[],
  config: SecurityConfig = {},
): Promise<{ paths: string[], totalSize: number }> {
  const maxFiles = config.maxFiles ?? DEFAULT_SECURITY_CONFIG.maxFiles
  const maxTotalSize = config.maxTotalSize ?? DEFAULT_SECURITY_CONFIG.maxTotalSize

  if (filePaths.length > maxFiles) {
    throw new SecurityError(
      `Too many files: ${filePaths.length} exceeds maximum of ${maxFiles}`,
      'MAX_FILES_EXCEEDED',
    )
  }

  const validatedPaths: string[] = []
  let totalSize = 0

  for (const filePath of filePaths) {
    const result = await validateFilePath(filePath, config)
    validatedPaths.push(result.path)
    totalSize += result.size

    if (totalSize > maxTotalSize) {
      throw new SecurityError(
        `Total size exceeded: ${formatBytes(totalSize)} exceeds maximum of ${formatBytes(maxTotalSize)}`,
        'TOTAL_SIZE_EXCEEDED',
      )
    }
  }

  return { paths: validatedPaths, totalSize }
}

/**
 * Create a timeout wrapper for async operations
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string = 'Operation',
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SecurityError(
        `${operation} timed out after ${timeoutMs}ms`,
        'TIMEOUT',
      ))
    }, timeoutMs)

    promise
      .then((result) => {
        clearTimeout(timer)
        resolve(result)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

/**
 * Create a secure file processor with all protections
 */
export function createSecureProcessor<T>(
  processor: (filePath: string) => Promise<T>,
  config: SecurityConfig = {},
): (filePath: string) => Promise<T> {
  const timeout = config.timeout ?? DEFAULT_SECURITY_CONFIG.timeout

  return async (filePath: string): Promise<T> => {
    // Validate the file first
    const { path: validatedPath } = await validateFilePath(filePath, config)

    // Process with timeout
    return withTimeout(
      processor(validatedPath),
      timeout,
      `Processing ${filePath}`,
    )
  }
}

/**
 * Create a secure batch processor
 */
export function createSecureBatchProcessor<T>(
  processor: (filePaths: string[]) => Promise<T>,
  config: SecurityConfig = {},
): (filePaths: string[]) => Promise<T> {
  const timeout = config.timeout ?? DEFAULT_SECURITY_CONFIG.timeout

  return async (filePaths: string[]): Promise<T> => {
    // Validate all files first
    const { paths: validatedPaths } = await validateFileBatch(filePaths, config)

    // Process with timeout
    return withTimeout(
      processor(validatedPaths),
      timeout,
      `Processing ${filePaths.length} files`,
    )
  }
}

/**
 * Sanitize a filename to prevent path traversal
 */
export function sanitizeFilename(filename: string): string {
  let result = filename
    // Normalize slashes first
    .replace(/\\/g, '/')
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove absolute path indicators
    .replace(/^\/+/, '')
    .replace(/^[A-Z]:/i, '')

  // Remove path traversal sequences iteratively
  let prev = ''
  while (prev !== result) {
    prev = result
    result = result.replace(/\.\.\/|\.\.$/g, '').replace(/\/+/g, '/')
  }

  // Remove leading/trailing slashes
  return result.replace(/^\/+|\/+$/g, '')
}

/**
 * Check if a path is safe (doesn't contain traversal sequences)
 */
export function isSafePath(path: string): boolean {
  // Check for null bytes
  if (path.includes('\0'))
    return false

  // Check for path traversal
  const normalized = normalize(path)
  if (normalized.includes('..'))
    return false

  // Check for absolute paths when not expected
  if (isAbsolute(path) && !path.startsWith(process.cwd()))
    return false

  return true
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0)
    return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${units[i]}`
}

/**
 * Create security middleware for the generator
 */
export function createSecurityMiddleware(config: SecurityConfig = {}): {
  validatePath: (filePath: string) => string
  validatePaths: (filePaths: string[]) => string[]
  validateFile: (filePath: string) => Promise<{ path: string, size: number }>
  validateBatch: (filePaths: string[]) => Promise<{ paths: string[], totalSize: number }>
  withTimeout: <T>(promise: Promise<T>, operation?: string) => Promise<T>
  secureProcessor: <T>(processor: (filePath: string) => Promise<T>) => (filePath: string) => Promise<T>
  isBlocked: (filePath: string) => boolean
  getConfig: () => Required<SecurityConfig>
} {
  const mergedConfig: Required<SecurityConfig> = { ...DEFAULT_SECURITY_CONFIG, ...config } as Required<SecurityConfig>

  return {
    /**
     * Validate a single file path
     */
    validatePath: (filePath: string): string => validatePath(filePath, mergedConfig),

    /**
     * Validate multiple file paths
     */
    validatePaths: (filePaths: string[]): string[] => validatePaths(filePaths, mergedConfig),

    /**
     * Full file validation with size and symlink checks
     */
    validateFile: (filePath: string): Promise<{ path: string, size: number }> => validateFilePath(filePath, mergedConfig),

    /**
     * Validate a batch of files
     */
    validateBatch: (filePaths: string[]): Promise<{ paths: string[], totalSize: number }> => validateFileBatch(filePaths, mergedConfig),

    /**
     * Wrap an operation with timeout
     */
    withTimeout: <T>(promise: Promise<T>, operation?: string): Promise<T> =>
      withTimeout(promise, mergedConfig.timeout, operation),

    /**
     * Create a secure processor
     */
    secureProcessor: <T>(processor: (filePath: string) => Promise<T>): ((filePath: string) => Promise<T>) =>
      createSecureProcessor(processor, mergedConfig),

    /**
     * Check if path is blocked
     */
    isBlocked: (filePath: string): boolean => isBlockedPath(filePath, mergedConfig),

    /**
     * Get the configuration
     */
    getConfig: (): Required<SecurityConfig> => mergedConfig,
  }
}
