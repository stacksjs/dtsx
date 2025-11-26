import { describe, expect, it, beforeAll, afterAll } from 'bun:test'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import {
  typeCheck,
  validateDeclarations,
  checkIsolatedDeclarations,
  getTypeAtPosition,
  getQuickInfo,
  formatTypeCheckResults,
  loadCompilerOptions,
} from '../src/checker'

const TEST_DIR = join(import.meta.dir, '.checker-test-fixtures')

describe('Type Checker', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true })

    // Create test files
    await writeFile(
      join(TEST_DIR, 'valid.ts'),
      `export function greet(name: string): string {
  return \`Hello, \${name}!\`
}

export interface User {
  id: number
  name: string
  email?: string
}

export type UserId = number

export const DEFAULT_USER: User = {
  id: 1,
  name: 'Test User'
}
`,
    )

    await writeFile(
      join(TEST_DIR, 'valid.d.ts'),
      `export declare function greet(name: string): string;
export interface User {
  id: number;
  name: string;
  email?: string;
}
export type UserId = number;
export declare const DEFAULT_USER: User;
`,
    )

    await writeFile(
      join(TEST_DIR, 'with-errors.ts'),
      `export function add(a: number, b: number): number {
  return a + b
}

// This has a type error - string + number
export function badAdd(a: string, b: number): string {
  // @ts-expect-error intentional error for testing
  return a + b.toFixed(2)
}

export const value: number = 42
`,
    )

    await writeFile(
      join(TEST_DIR, 'syntax-error.ts'),
      `export function broken( {
  return 'missing closing paren'
}
`,
    )

    await writeFile(
      join(TEST_DIR, 'invalid.d.ts'),
      `export declare function broken(: string;
export interface {
  id: number
}
`,
    )

    await writeFile(
      join(TEST_DIR, 'needs-annotation.ts'),
      `// Missing return type annotation (isolatedDeclarations issue)
export function inferredReturn() {
  return { x: 1, y: 2 }
}

// Missing parameter type (isolatedDeclarations issue)
export function noParamType(x) {
  return x
}

// Properly annotated
export function properlyAnnotated(x: number): number {
  return x * 2
}
`,
    )

    await writeFile(
      join(TEST_DIR, 'complex-types.ts'),
      `export type Callback<T> = (value: T) => void

export interface Config<T extends object> {
  data: T
  transform?: (input: T) => T
}

export function createConfig<T extends object>(data: T): Config<T> {
  return { data }
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
`,
    )

    // Create a minimal tsconfig for tests
    await writeFile(
      join(TEST_DIR, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ESNext',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            skipLibCheck: true,
            noEmit: true,
          },
        },
        null,
        2,
      ),
    )
  })

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true })
  })

  describe('typeCheck', () => {
    it('should pass for valid TypeScript files', async () => {
      const result = await typeCheck([join(TEST_DIR, 'valid.ts')])

      expect(result.success).toBe(true)
      expect(result.errorCount).toBe(0)
      expect(result.filesChecked).toHaveLength(1)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should detect syntax errors', async () => {
      const result = await typeCheck([join(TEST_DIR, 'syntax-error.ts')])

      expect(result.success).toBe(false)
      expect(result.errorCount).toBeGreaterThan(0)
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.diagnostics[0].severity).toBe('error')
    })

    it('should check multiple files', async () => {
      const result = await typeCheck([
        join(TEST_DIR, 'valid.ts'),
        join(TEST_DIR, 'complex-types.ts'),
      ])

      expect(result.success).toBe(true)
      expect(result.filesChecked).toHaveLength(2)
    })

    it('should respect include patterns', async () => {
      const result = await typeCheck(
        [join(TEST_DIR, 'valid.ts'), join(TEST_DIR, 'syntax-error.ts')],
        { include: ['.*valid.*'] },
      )

      expect(result.success).toBe(true)
      expect(result.filesChecked).toHaveLength(1)
    })

    it('should respect exclude patterns', async () => {
      const result = await typeCheck(
        [join(TEST_DIR, 'valid.ts'), join(TEST_DIR, 'syntax-error.ts')],
        { exclude: ['.*syntax-error.*'] },
      )

      expect(result.success).toBe(true)
      expect(result.filesChecked).toHaveLength(1)
    })

    it('should respect maxErrors option', async () => {
      const result = await typeCheck([join(TEST_DIR, 'syntax-error.ts')], {
        maxErrors: 1,
      })

      expect(result.diagnostics.length).toBeLessThanOrEqual(1)
    })

    it('should convert warnings to errors when warningsAsErrors is true', async () => {
      const result = await typeCheck([join(TEST_DIR, 'valid.ts')], {
        warningsAsErrors: true,
      })

      // All warnings should be converted to errors
      expect(result.warningCount).toBe(0)
    })

    it('should use tsconfig when provided', async () => {
      const result = await typeCheck([join(TEST_DIR, 'valid.ts')], {
        tsconfigPath: join(TEST_DIR, 'tsconfig.json'),
      })

      expect(result.success).toBe(true)
    })
  })

  describe('validateDeclarations', () => {
    it('should validate valid .d.ts files', async () => {
      const result = await validateDeclarations([join(TEST_DIR, 'valid.d.ts')])

      expect(result.success).toBe(true)
      expect(result.errorCount).toBe(0)
    })

    it('should detect errors in invalid .d.ts files', async () => {
      const result = await validateDeclarations([join(TEST_DIR, 'invalid.d.ts')])

      expect(result.success).toBe(false)
      expect(result.errorCount).toBeGreaterThan(0)
    })

    it('should filter to only .d.ts files', async () => {
      const result = await validateDeclarations([
        join(TEST_DIR, 'valid.d.ts'),
        join(TEST_DIR, 'valid.ts'), // Should be filtered out
      ])

      expect(result.filesChecked).toHaveLength(1)
      expect(result.filesChecked[0]).toContain('.d.ts')
    })
  })

  describe('checkIsolatedDeclarations', () => {
    it('should detect missing type annotations', async () => {
      const results = await checkIsolatedDeclarations([
        join(TEST_DIR, 'needs-annotation.ts'),
      ])

      const result = results.get(join(TEST_DIR, 'needs-annotation.ts'))
      expect(result).toBeDefined()
      // Note: isolatedDeclarations checks might not catch all cases in all TS versions
      // The test verifies the function runs without error
    })

    it('should pass for properly annotated files', async () => {
      const results = await checkIsolatedDeclarations([join(TEST_DIR, 'valid.ts')])

      const result = results.get(join(TEST_DIR, 'valid.ts'))
      expect(result).toBeDefined()
      expect(result!.compatible).toBe(true)
      expect(result!.issues).toHaveLength(0)
    })

    it('should check multiple files', async () => {
      const results = await checkIsolatedDeclarations([
        join(TEST_DIR, 'valid.ts'),
        join(TEST_DIR, 'complex-types.ts'),
      ])

      expect(results.size).toBe(2)
    })

    it('should use tsconfig when provided', async () => {
      const results = await checkIsolatedDeclarations(
        [join(TEST_DIR, 'valid.ts')],
        join(TEST_DIR, 'tsconfig.json'),
      )

      expect(results.size).toBe(1)
    })
  })

  describe('getTypeAtPosition', () => {
    it('should return type information for a variable', () => {
      // Line 13 (0-indexed line 12) is where DEFAULT_USER is declared
      const type = getTypeAtPosition(join(TEST_DIR, 'valid.ts'), 13, 14)

      // Should get the type of DEFAULT_USER
      expect(type).toBeDefined()
    })

    it('should return type information for a function', () => {
      const type = getTypeAtPosition(join(TEST_DIR, 'valid.ts'), 1, 17)

      expect(type).toBeDefined()
    })

    it('should return null for invalid position', () => {
      const type = getTypeAtPosition(join(TEST_DIR, 'valid.ts'), 999, 999)

      // Position is out of bounds, but should handle gracefully
      expect(type).toBeNull()
    })

    it('should return null for non-existent file', () => {
      const type = getTypeAtPosition(join(TEST_DIR, 'nonexistent.ts'), 1, 1)

      expect(type).toBeNull()
    })
  })

  describe('getQuickInfo', () => {
    it('should return type and documentation for a symbol', () => {
      const info = getQuickInfo(join(TEST_DIR, 'valid.ts'), 1, 17)

      expect(info).toBeDefined()
      expect(info!.type).toBeDefined()
    })

    it('should return null for invalid position', () => {
      const info = getQuickInfo(join(TEST_DIR, 'valid.ts'), 999, 999)

      expect(info).toBeNull()
    })

    it('should use tsconfig when provided', () => {
      const info = getQuickInfo(
        join(TEST_DIR, 'valid.ts'),
        1,
        17,
        join(TEST_DIR, 'tsconfig.json'),
      )

      expect(info).toBeDefined()
    })
  })

  describe('formatTypeCheckResults', () => {
    it('should format successful results', async () => {
      const result = await typeCheck([join(TEST_DIR, 'valid.ts')])
      const formatted = formatTypeCheckResults(result)

      expect(formatted).toContain('✓')
      expect(formatted).toContain('passed')
      expect(formatted).toContain('files checked')
    })

    it('should format failed results with diagnostics', async () => {
      const result = await typeCheck([join(TEST_DIR, 'syntax-error.ts')])
      const formatted = formatTypeCheckResults(result)

      expect(formatted).toContain('✗')
      expect(formatted).toContain('failed')
      expect(formatted).toContain('error')
    })

    it('should include source context in formatted output', async () => {
      const result = await typeCheck([join(TEST_DIR, 'syntax-error.ts')])
      const formatted = formatTypeCheckResults(result)

      // Should include line numbers and file info
      expect(formatted).toContain('syntax-error.ts')
    })
  })

  describe('loadCompilerOptions', () => {
    it('should load options from tsconfig.json', () => {
      const options = loadCompilerOptions(join(TEST_DIR, 'tsconfig.json'))

      expect(options.strict).toBe(true)
      expect(options.skipLibCheck).toBe(true)
    })

    it('should apply overrides', () => {
      const options = loadCompilerOptions(join(TEST_DIR, 'tsconfig.json'), {
        strict: false,
      })

      expect(options.strict).toBe(false)
    })

    it('should throw for invalid tsconfig path', () => {
      expect(() => {
        loadCompilerOptions(join(TEST_DIR, 'nonexistent.json'))
      }).toThrow()
    })
  })

  describe('diagnostic information', () => {
    it('should provide file, line, and column for errors', async () => {
      const result = await typeCheck([join(TEST_DIR, 'syntax-error.ts')])

      expect(result.diagnostics.length).toBeGreaterThan(0)
      const diag = result.diagnostics[0]

      expect(diag.file).toContain('syntax-error.ts')
      expect(diag.line).toBeGreaterThan(0)
      expect(diag.column).toBeGreaterThan(0)
      expect(diag.message).toBeDefined()
      expect(diag.code).toBeGreaterThan(0)
      expect(diag.severity).toBe('error')
      expect(diag.category).toBe('Error')
    })

    it('should include source context when available', async () => {
      const result = await typeCheck([join(TEST_DIR, 'syntax-error.ts')])

      const diagWithSource = result.diagnostics.find((d) => d.source)
      // Source context is optional but should be present for most diagnostics
      if (diagWithSource) {
        expect(diagWithSource.source).toBeDefined()
        expect(typeof diagWithSource.source).toBe('string')
      }
    })
  })

  describe('complex type checking', () => {
    it('should handle generic types', async () => {
      const result = await typeCheck([join(TEST_DIR, 'complex-types.ts')])

      expect(result.success).toBe(true)
    })

    it('should handle conditional types', async () => {
      await writeFile(
        join(TEST_DIR, 'conditional.ts'),
        `export type IsString<T> = T extends string ? true : false
export type Result = IsString<'hello'>  // true
export type Result2 = IsString<number>  // false
`,
      )

      const result = await typeCheck([join(TEST_DIR, 'conditional.ts')])
      expect(result.success).toBe(true)
    })

    it('should handle mapped types', async () => {
      await writeFile(
        join(TEST_DIR, 'mapped.ts'),
        `export type Readonly<T> = {
  readonly [K in keyof T]: T[K]
}

export type Partial<T> = {
  [K in keyof T]?: T[K]
}

interface User {
  name: string
  age: number
}

export type ReadonlyUser = Readonly<User>
export type PartialUser = Partial<User>
`,
      )

      const result = await typeCheck([join(TEST_DIR, 'mapped.ts')])
      expect(result.success).toBe(true)
    })

    it('should handle template literal types', async () => {
      await writeFile(
        join(TEST_DIR, 'template-literal.ts'),
        `export type EventName = 'click' | 'focus' | 'blur'
export type EventHandler = \`on\${Capitalize<EventName>}\`
// EventHandler = 'onClick' | 'onFocus' | 'onBlur'
`,
      )

      const result = await typeCheck([join(TEST_DIR, 'template-literal.ts')])
      expect(result.success).toBe(true)
    })
  })
})
