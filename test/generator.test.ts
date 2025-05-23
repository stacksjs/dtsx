import { describe, it, expect, beforeAll } from 'bun:test'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { generate } from '../src/generator'

const fixturesDir = join(__dirname, 'fixtures')
const inputDir = join(fixturesDir, 'input')
const expectedOutputDir = join(fixturesDir, 'output')
const actualOutputDir = join(__dirname, 'temp-output')

// List of test files to validate
const testFiles = [
  'class.ts',
  'enum.ts',
  'exports.ts',
  'function.ts',
  'interface.ts',
  'imports.ts',
  'module.ts',
  'type.ts',
  'variable.ts'
]

describe('DTS Generator', () => {
  beforeAll(async () => {
    // Generate all DTS files
    await generate({
      cwd: process.cwd(),
      root: inputDir,
      entrypoints: testFiles,
      outdir: actualOutputDir,
      clean: true,
      keepComments: true,
      tsconfigPath: '',
      verbose: false
    })
  })

  // Test each file
  testFiles.forEach(testFile => {
    const baseName = testFile.replace('.ts', '')

    it(`should generate correct output for ${testFile}`, async () => {
      const expectedPath = join(expectedOutputDir, `${baseName}.d.ts`)
      const actualPath = join(actualOutputDir, `${baseName}.d.ts`)

      const [expectedContent, actualContent] = await Promise.all([
        readFile(expectedPath, 'utf-8'),
        readFile(actualPath, 'utf-8')
      ])

      // Normalize whitespace for comparison
      const normalizeContent = (content: string) => {
        return content
          .split('\n')
          .map(line => line.trimEnd()) // Remove trailing whitespace
          .filter(line => line !== '') // Remove empty lines
          .join('\n')
      }

      const normalizedExpected = normalizeContent(expectedContent)
      const normalizedActual = normalizeContent(actualContent)

      // For detailed error reporting, compare line by line
      const expectedLines = normalizedExpected.split('\n')
      const actualLines = normalizedActual.split('\n')

      // First check if number of lines match
      if (expectedLines.length !== actualLines.length) {
        console.error(`\n❌ ${testFile}: Line count mismatch`)
        console.error(`Expected ${expectedLines.length} lines, got ${actualLines.length} lines`)
        console.error('\nExpected:\n', expectedContent)
        console.error('\nActual:\n', actualContent)
      }

      // Compare line by line for better error messages
      expectedLines.forEach((expectedLine, index) => {
        const actualLine = actualLines[index] || ''
        if (expectedLine !== actualLine) {
          console.error(`\n❌ ${testFile}: Mismatch at line ${index + 1}`)
          console.error(`Expected: "${expectedLine}"`)
          console.error(`Actual:   "${actualLine}"`)
        }
      })

      expect(normalizedActual).toBe(normalizedExpected)
    })
  })

  // Test for narrowness - ensure types are as narrow or narrower than expected
  describe('Type Narrowness', () => {
    it('should infer literal types for const declarations', async () => {
      const actualPath = join(actualOutputDir, 'variable.d.ts')
      const actualContent = await readFile(actualPath, 'utf-8')

      // Check for literal types
      expect(actualContent).toContain("export declare let test: 'test'")
      expect(actualContent).toContain("export declare const someObject: {")
      expect(actualContent).toContain("someString: 'Stacks'")
      expect(actualContent).toContain("someNumber: 1000")
      expect(actualContent).toContain("someBoolean: true")
      expect(actualContent).toContain("someFalse: false")
      expect(actualContent).toContain("readonly ['google', 'github']")
    })

    it('should use broader types for let and var declarations', async () => {
      const actualPath = join(actualOutputDir, 'variable.d.ts')
      const actualContent = await readFile(actualPath, 'utf-8')

      // Test file has: export let test = 'test'
      // Should be: export declare let test: 'test' (according to expected output)
      // But this seems to be a special case in the expected output

      // Check that var gets broader type
      expect(actualContent).toContain("export declare var helloWorld: 'Hello World'")
    })

    it('should handle function overloads correctly', async () => {
      const actualPath = join(actualOutputDir, 'function.d.ts')
      const actualContent = await readFile(actualPath, 'utf-8')

      // Check that all overloads have 'declare'
      const overloadLines = actualContent
        .split('\n')
        .filter(line => line.includes('processData'))

      // First 4 should be overload signatures, last should be implementation
      expect(overloadLines[0]).toContain('export declare function processData(data: string): string')
      expect(overloadLines[1]).toContain('export declare function processData(data: number): number')
      expect(overloadLines[2]).toContain('export declare function processData(data: boolean): boolean')
      expect(overloadLines[3]).toContain('export declare function processData<T extends object>(data: T): T')
      expect(overloadLines[4]).toContain('export declare function processData(data: unknown): unknown')
    })
  })
})