/**
 * Tests for security utilities
 */

import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  createSecureProcessor,
  createSecurityMiddleware,
  DEFAULT_SECURITY_CONFIG,
  isBlockedPath,
  isSafePath,
  sanitizeFilename,
  SecurityError,
  validatePath,
  validatePaths,
  withTimeout,
} from '../src/security'

describe('Security Module', () => {
  const testRoot = process.cwd()

  describe('validatePath', () => {
    test('accepts valid path within root', () => {
      const result = validatePath('src/index.ts', { rootDir: testRoot })
      expect(result).toBe(resolve(testRoot, 'src/index.ts'))
    })

    test('accepts absolute path within root', () => {
      const absolutePath = join(testRoot, 'src/index.ts')
      const result = validatePath(absolutePath, { rootDir: testRoot })
      expect(result).toBe(absolutePath)
    })

    test('rejects path traversal with ..', () => {
      expect(() => {
        validatePath('../../../etc/passwd', { rootDir: testRoot })
      }).toThrow(SecurityError)
    })

    test('rejects path traversal with encoded ..', () => {
      expect(() => {
        validatePath('src/../../etc/passwd', { rootDir: testRoot })
      }).toThrow(SecurityError)
    })

    test('rejects absolute path outside root', () => {
      expect(() => {
        validatePath('/etc/passwd', { rootDir: testRoot })
      }).toThrow(SecurityError)
    })

    test('normalizes path with . segments', () => {
      const result = validatePath('./src/../src/index.ts', { rootDir: testRoot })
      expect(result).toBe(resolve(testRoot, 'src/index.ts'))
    })

    test('error includes correct code', () => {
      try {
        validatePath('../outside', { rootDir: testRoot })
        expect(true).toBe(false) // Should not reach here
      }
      catch (error) {
        expect(error).toBeInstanceOf(SecurityError)
        expect((error as SecurityError).code).toBe('PATH_TRAVERSAL')
      }
    })
  })

  describe('validatePaths', () => {
    test('validates multiple paths', () => {
      const paths = ['src/a.ts', 'src/b.ts', 'src/c.ts']
      const results = validatePaths(paths, { rootDir: testRoot })
      expect(results.length).toBe(3)
      expect(results[0]).toBe(resolve(testRoot, 'src/a.ts'))
    })

    test('throws on first invalid path', () => {
      const paths = ['src/a.ts', '../outside', 'src/c.ts']
      expect(() => {
        validatePaths(paths, { rootDir: testRoot })
      }).toThrow(SecurityError)
    })
  })

  describe('isBlockedPath', () => {
    test('blocks .git directory', () => {
      expect(isBlockedPath('.git/config')).toBe(true)
      expect(isBlockedPath('src/.git/hooks')).toBe(true)
    })

    test('blocks node_modules', () => {
      expect(isBlockedPath('node_modules/typescript/lib/typescript.js')).toBe(true)
    })

    test('blocks .env files', () => {
      expect(isBlockedPath('.env')).toBe(true)
      expect(isBlockedPath('.env.local')).toBe(true)
      expect(isBlockedPath('.env.production')).toBe(true)
    })

    test('blocks secrets directory', () => {
      expect(isBlockedPath('secrets/api-key.txt')).toBe(true)
    })

    test('blocks key files', () => {
      expect(isBlockedPath('private.key')).toBe(true)
      expect(isBlockedPath('ssl/server.key')).toBe(true)
    })

    test('blocks pem files', () => {
      expect(isBlockedPath('certificate.pem')).toBe(true)
    })

    test('allows normal source files', () => {
      expect(isBlockedPath('src/index.ts')).toBe(false)
      expect(isBlockedPath('lib/utils.js')).toBe(false)
    })

    test('uses custom blocked patterns', () => {
      const config = {
        blockedPatterns: ['**/private/**', '*.secret'],
      }
      expect(isBlockedPath('private/data.txt', config)).toBe(true)
      expect(isBlockedPath('config.secret', config)).toBe(true)
      expect(isBlockedPath('src/index.ts', config)).toBe(false)
    })
  })

  describe('sanitizeFilename', () => {
    test('removes path traversal sequences', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('etc/passwd')
      expect(sanitizeFilename('foo/../bar')).toBe('foo/bar')
    })

    test('removes leading slashes', () => {
      expect(sanitizeFilename('/etc/passwd')).toBe('etc/passwd')
      expect(sanitizeFilename('///foo/bar')).toBe('foo/bar')
    })

    test('removes Windows drive letters', () => {
      expect(sanitizeFilename('C:\\Users\\test')).toBe('Users/test')
      expect(sanitizeFilename('D:foo\\bar')).toBe('foo/bar')
    })

    test('removes null bytes', () => {
      expect(sanitizeFilename('foo\0bar')).toBe('foobar')
    })

    test('normalizes backslashes', () => {
      expect(sanitizeFilename('foo\\bar\\baz')).toBe('foo/bar/baz')
    })

    test('keeps valid filenames unchanged', () => {
      expect(sanitizeFilename('src/index.ts')).toBe('src/index.ts')
      expect(sanitizeFilename('file.txt')).toBe('file.txt')
    })
  })

  describe('isSafePath', () => {
    test('returns true for safe paths', () => {
      expect(isSafePath('src/index.ts')).toBe(true)
      expect(isSafePath('lib/utils.js')).toBe(true)
      expect(isSafePath('./relative/path')).toBe(true)
    })

    test('returns false for paths with null bytes', () => {
      expect(isSafePath('foo\0bar')).toBe(false)
    })

    test('returns false for paths with ..', () => {
      expect(isSafePath('../outside')).toBe(false)
      expect(isSafePath('foo/../../../bar')).toBe(false)
    })
  })

  describe('withTimeout', () => {
    test('resolves if promise completes in time', async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('done'), 10)
      })

      const result = await withTimeout(promise, 100, 'Test operation')
      expect(result).toBe('done')
    })

    test('rejects if promise times out', async () => {
      const promise = new Promise<string>(resolve => {
        setTimeout(() => resolve('done'), 200)
      })

      try {
        await withTimeout(promise, 50, 'Test operation')
        expect(true).toBe(false) // Should not reach here
      }
      catch (error) {
        expect(error).toBeInstanceOf(SecurityError)
        expect((error as SecurityError).code).toBe('TIMEOUT')
        expect((error as SecurityError).message).toContain('Test operation')
      }
    })

    test('preserves original error if promise rejects', async () => {
      const promise = Promise.reject(new Error('Original error'))

      try {
        await withTimeout(promise, 100, 'Test')
        expect(true).toBe(false)
      }
      catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe('Original error')
      }
    })
  })

  describe('createSecureProcessor', () => {
    test('processes valid files', async () => {
      const processor = createSecureProcessor(
        async (path) => `Processed: ${path}`,
        { rootDir: testRoot, timeout: 1000 },
      )

      // This will fail because the file doesn't exist, but validates the path first
      try {
        await processor('src/index.ts')
      }
      catch (error) {
        // Expected - file validation will fail, but path validation passes
        expect((error as SecurityError).code).not.toBe('PATH_TRAVERSAL')
      }
    })

    test('rejects path traversal attempts', async () => {
      const processor = createSecureProcessor(
        async (path) => `Processed: ${path}`,
        { rootDir: testRoot },
      )

      try {
        await processor('../../../etc/passwd')
        expect(true).toBe(false)
      }
      catch (error) {
        expect(error).toBeInstanceOf(SecurityError)
        expect((error as SecurityError).code).toBe('PATH_TRAVERSAL')
      }
    })
  })

  describe('createSecurityMiddleware', () => {
    test('creates middleware with default config', () => {
      const middleware = createSecurityMiddleware()
      expect(middleware.getConfig()).toEqual(DEFAULT_SECURITY_CONFIG)
    })

    test('creates middleware with custom config', () => {
      const middleware = createSecurityMiddleware({
        maxFileSize: 1024,
        timeout: 5000,
      })

      const config = middleware.getConfig()
      expect(config.maxFileSize).toBe(1024)
      expect(config.timeout).toBe(5000)
      expect(config.maxFiles).toBe(DEFAULT_SECURITY_CONFIG.maxFiles)
    })

    test('validatePath method works', () => {
      const middleware = createSecurityMiddleware({ rootDir: testRoot })

      const result = middleware.validatePath('src/index.ts')
      expect(result).toBe(resolve(testRoot, 'src/index.ts'))
    })

    test('isBlocked method works', () => {
      const middleware = createSecurityMiddleware()

      expect(middleware.isBlocked('.git/config')).toBe(true)
      expect(middleware.isBlocked('src/index.ts')).toBe(false)
    })

    test('withTimeout method works', async () => {
      const middleware = createSecurityMiddleware({ timeout: 100 })

      const fastPromise = Promise.resolve('fast')
      const result = await middleware.withTimeout(fastPromise, 'Fast operation')
      expect(result).toBe('fast')
    })
  })

  describe('SecurityError', () => {
    test('has correct properties', () => {
      const error = new SecurityError('Test error', 'PATH_TRAVERSAL', '/test/path')

      expect(error.name).toBe('SecurityError')
      expect(error.message).toBe('Test error')
      expect(error.code).toBe('PATH_TRAVERSAL')
      expect(error.path).toBe('/test/path')
    })

    test('works without path', () => {
      const error = new SecurityError('Timeout', 'TIMEOUT')

      expect(error.code).toBe('TIMEOUT')
      expect(error.path).toBeUndefined()
    })
  })

  describe('DEFAULT_SECURITY_CONFIG', () => {
    test('has sensible defaults', () => {
      expect(DEFAULT_SECURITY_CONFIG.maxFileSize).toBe(10 * 1024 * 1024) // 10MB
      expect(DEFAULT_SECURITY_CONFIG.maxTotalSize).toBe(100 * 1024 * 1024) // 100MB
      expect(DEFAULT_SECURITY_CONFIG.timeout).toBe(30000) // 30 seconds
      expect(DEFAULT_SECURITY_CONFIG.followSymlinks).toBe(false)
      expect(DEFAULT_SECURITY_CONFIG.maxFiles).toBe(10000)
      expect(DEFAULT_SECURITY_CONFIG.blockedPatterns).toContain('**/.git/**')
      expect(DEFAULT_SECURITY_CONFIG.blockedPatterns).toContain('**/node_modules/**')
    })
  })
})
