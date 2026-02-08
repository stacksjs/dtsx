import { describe, expect, it } from 'bun:test'
import { extractDeclarations } from '../src/extractor'
import { processCode } from './test-utils'

const TEST_FILE = 'fuzz.ts'

/**
 * Property-based / Fuzzing tests for parser robustness
 * These tests generate random or semi-random inputs to find edge cases
 */

// Random generators
function randomString(length: number, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)]
  }
  return result
}

function randomIdentifier(): string {
  const first = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_'
  const rest = `${first}0123456789`
  const length = Math.floor(Math.random() * 20) + 1
  return first[Math.floor(Math.random() * first.length)] + randomString(length - 1, rest)
}

function randomType(): string {
  const primitives = ['string', 'number', 'boolean', 'null', 'undefined', 'void', 'never', 'any', 'unknown', 'object', 'symbol', 'bigint']
  const choice = Math.random()

  if (choice < 0.5) {
    return primitives[Math.floor(Math.random() * primitives.length)]
  }
  else if (choice < 0.7) {
    // Array type
    return `${randomType()}[]`
  }
  else if (choice < 0.85) {
    // Generic type
    return `Array<${primitives[Math.floor(Math.random() * primitives.length)]}>`
  }
  else {
    // Union type
    const count = Math.floor(Math.random() * 3) + 2
    return Array.from({ length: count }, () => primitives[Math.floor(Math.random() * primitives.length)]).join(' | ')
  }
}

function randomFunctionDeclaration(): string {
  const name = randomIdentifier()
  const paramCount = Math.floor(Math.random() * 5)
  const params = Array.from({ length: paramCount }, () => {
    const pName = randomIdentifier()
    const pType = randomType()
    const optional = Math.random() > 0.7 ? '?' : ''
    return `${pName}${optional}: ${pType}`
  }).join(', ')
  const returnType = randomType()
  const isAsync = Math.random() > 0.7
  const asyncKeyword = isAsync ? 'async ' : ''
  const actualReturn = isAsync ? `Promise<${returnType}>` : returnType

  return `export ${asyncKeyword}function ${name}(${params}): ${actualReturn} { return null as any }`
}

function randomInterfaceDeclaration(): string {
  const name = randomIdentifier().charAt(0).toUpperCase() + randomIdentifier().slice(1)
  const propCount = Math.floor(Math.random() * 10) + 1
  const props = Array.from({ length: propCount }, () => {
    const pName = randomIdentifier()
    const pType = randomType()
    const optional = Math.random() > 0.7 ? '?' : ''
    const readonly = Math.random() > 0.8 ? 'readonly ' : ''
    return `  ${readonly}${pName}${optional}: ${pType};`
  }).join('\n')

  const hasExtends = Math.random() > 0.7
  const extendsClause = hasExtends ? ` extends ${randomIdentifier().charAt(0).toUpperCase() + randomIdentifier().slice(1)}` : ''

  return `export interface ${name}${extendsClause} {\n${props}\n}`
}

function randomTypeAlias(): string {
  const name = randomIdentifier().charAt(0).toUpperCase() + randomIdentifier().slice(1)
  const choice = Math.random()

  if (choice < 0.3) {
    // Simple type alias
    return `export type ${name} = ${randomType()}`
  }
  else if (choice < 0.6) {
    // Object type
    const propCount = Math.floor(Math.random() * 5) + 1
    const props = Array.from({ length: propCount }, () => {
      return `${randomIdentifier()}: ${randomType()}`
    }).join('; ')
    return `export type ${name} = { ${props} }`
  }
  else {
    // Generic type alias
    const typeParam = randomIdentifier().charAt(0).toUpperCase()
    return `export type ${name}<${typeParam}> = ${typeParam} | null`
  }
}

function randomConstDeclaration(): string {
  const name = randomIdentifier()
  const type = randomType()
  return `export const ${name}: ${type} = null as any`
}

function randomClassDeclaration(): string {
  const name = randomIdentifier().charAt(0).toUpperCase() + randomIdentifier().slice(1)
  const propCount = Math.floor(Math.random() * 5)
  const methodCount = Math.floor(Math.random() * 3)

  const props = Array.from({ length: propCount }, () => {
    const visibility = ['public ', 'private ', 'protected ', ''][Math.floor(Math.random() * 4)]
    const readonly = Math.random() > 0.8 ? 'readonly ' : ''
    const pName = randomIdentifier()
    const pType = randomType()
    return `  ${visibility}${readonly}${pName}: ${pType};`
  }).join('\n')

  const methods = Array.from({ length: methodCount }, () => {
    const visibility = ['public ', 'private ', 'protected ', ''][Math.floor(Math.random() * 4)]
    const isAsync = Math.random() > 0.7
    const asyncKeyword = isAsync ? 'async ' : ''
    const mName = randomIdentifier()
    const returnType = randomType()
    const actualReturn = isAsync ? `Promise<${returnType}>` : returnType
    return `  ${visibility}${asyncKeyword}${mName}(): ${actualReturn} { return null as any }`
  }).join('\n')

  const isAbstract = Math.random() > 0.9
  const abstractKeyword = isAbstract ? 'abstract ' : ''

  return `export ${abstractKeyword}class ${name} {\n${props}\n${methods}\n}`
}

function randomEnumDeclaration(): string {
  const name = randomIdentifier().charAt(0).toUpperCase() + randomIdentifier().slice(1)
  const memberCount = Math.floor(Math.random() * 10) + 1
  const isConst = Math.random() > 0.8

  const members = Array.from({ length: memberCount }, (_, i) => {
    const mName = randomIdentifier().toUpperCase()
    const hasValue = Math.random() > 0.5
    return hasValue ? `  ${mName} = ${i}` : `  ${mName}`
  }).join(',\n')

  const constKeyword = isConst ? 'const ' : ''
  return `export ${constKeyword}enum ${name} {\n${members}\n}`
}


describe('Property-Based / Fuzzing Tests', () => {
  describe('Random valid declarations', () => {
    it('should handle randomly generated functions', () => {
      for (let i = 0; i < 50; i++) {
        const code = randomFunctionDeclaration()
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle randomly generated interfaces', () => {
      for (let i = 0; i < 50; i++) {
        const code = randomInterfaceDeclaration()
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle randomly generated type aliases', () => {
      for (let i = 0; i < 50; i++) {
        const code = randomTypeAlias()
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle randomly generated const declarations', () => {
      for (let i = 0; i < 50; i++) {
        const code = randomConstDeclaration()
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle randomly generated classes', () => {
      for (let i = 0; i < 30; i++) {
        const code = randomClassDeclaration()
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle randomly generated enums', () => {
      for (let i = 0; i < 30; i++) {
        const code = randomEnumDeclaration()
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })

    it('should handle mixed random declarations', () => {
      for (let i = 0; i < 20; i++) {
        const generators = [
          randomFunctionDeclaration,
          randomInterfaceDeclaration,
          randomTypeAlias,
          randomConstDeclaration,
          randomClassDeclaration,
          randomEnumDeclaration,
        ]

        const count = Math.floor(Math.random() * 10) + 1
        const declarations = Array.from({ length: count }, () => {
          const gen = generators[Math.floor(Math.random() * generators.length)]
          return gen()
        })

        const code = declarations.join('\n\n')
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
      }
    })
  })

  describe('Edge case strings', () => {
    it('should handle identifiers with unicode', () => {
      const unicodeIds = [
        'export const α = 1',
        'export const _ñ = 1',
        'export const ℕ = 1',
        'export function π(): number { return 3.14 }',
        'export interface Δ { x: number }',
      ]

      for (const code of unicodeIds) {
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle very long identifiers', () => {
      const longName = 'a'.repeat(1000)
      const code = `export const ${longName} = 1`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle identifiers with numbers', () => {
      const codes = [
        'export const a1b2c3 = 1',
        'export const _123 = 1',
        'export const $123 = 1',
        'export function test123(): void {}',
      ]

      for (const code of codes) {
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle escaped strings in types', () => {
      const codes = [
        'export type A = "hello\\nworld"',
        'export type B = "tab\\there"',
        'export type C = "quote\\"here"',
        'export type D = `template\\`literal`',
      ]

      for (const code of codes) {
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle deeply nested generics', () => {
      const depths = [5, 10, 20, 30]

      for (const depth of depths) {
        const nested = `${'Promise<'.repeat(depth)}string${'>'.repeat(depth)}`
        const code = `export type Deep = ${nested}`
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle complex union types', () => {
      const unionSizes = [5, 10, 20, 50]

      for (const size of unionSizes) {
        const types = Array.from({ length: size }, (_, i) => `Type${i}`)
        const code = `export type BigUnion = ${types.join(' | ')}`
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle complex intersection types', () => {
      const sizes = [5, 10, 20]

      for (const size of sizes) {
        const types = Array.from({ length: size }, (_, i) => `{ prop${i}: string }`)
        const code = `export type BigIntersection = ${types.join(' & ')}`
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })
  })

  describe('Malformed input resilience', () => {
    it('should not crash on random binary data', () => {
      for (let i = 0; i < 20; i++) {
        const bytes = new Uint8Array(100)
        crypto.getRandomValues(bytes)
        const code = String.fromCharCode(...bytes)

        // Should not throw
        try {
          extractDeclarations(code, TEST_FILE)
        }
        catch {
          // Acceptable to throw, but not crash
        }
      }
    })

    it('should handle strings with null bytes', () => {
      const codes = [
        'export const a\0b = 1',
        'export const x = 1\0',
        '\0export const y = 1',
        'export type T = string\0number',
      ]

      for (const code of codes) {
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle control characters', () => {
      for (let i = 0; i < 32; i++) {
        const char = String.fromCharCode(i)
        const code = `export const x${char}y = 1`

        // Should not crash
        try {
          extractDeclarations(code, TEST_FILE)
        }
        catch {
          // Acceptable to throw on invalid input
        }
      }
    })

    it('should handle unbalanced brackets', () => {
      const unbalanced = [
        'export type A = {{{',
        'export type B = }}}',
        'export type C = <<<',
        'export type D = >>>',
        'export type E = [[[',
        'export type F = ]]]',
        'export type G = (((',
        'export type H = )))',
      ]

      for (const code of unbalanced) {
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle mixed bracket types incorrectly matched', () => {
      const mixed = [
        'export type A = { x: [}',
        'export type B = [ x: {]',
        'export type C = ( x: {)',
        'export type D = < x: [>',
      ]

      for (const code of mixed) {
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })
  })

  describe('Process declarations fuzzing', () => {
    it('should process random valid code without errors', () => {
      for (let i = 0; i < 20; i++) {
        const generators = [
          randomFunctionDeclaration,
          randomInterfaceDeclaration,
          randomTypeAlias,
          randomConstDeclaration,
        ]

        const count = Math.floor(Math.random() * 5) + 1
        const declarations = Array.from({ length: count }, () => {
          const gen = generators[Math.floor(Math.random() * generators.length)]
          return gen()
        })

        const code = declarations.join('\n\n')
        const result = processCode(code, TEST_FILE)
        expect(typeof result).toBe('string')
      }
    })
  })

  describe('Import statement fuzzing', () => {
    it('should handle various import patterns', () => {
      const imports = [
        'import { a } from \'mod\'',
        'import { a, b, c } from \'mod\'',
        'import { a as b } from \'mod\'',
        'import { type a } from \'mod\'',
        'import { type a, b } from \'mod\'',
        'import type { a } from \'mod\'',
        'import type { a, b } from \'mod\'',
        'import * as ns from \'mod\'',
        'import def from \'mod\'',
        'import def, { a } from \'mod\'',
        'import def, { a, b } from \'mod\'',
        'import def, * as ns from \'mod\'',
        'import \'mod\'',
      ]

      for (const imp of imports) {
        const code = `${imp}\nexport const x = 1`
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })

    it('should handle various export patterns', () => {
      const exports = [
        'export { a }',
        'export { a, b, c }',
        'export { a as b }',
        'export { type a }',
        'export { type a, b }',
        'export type { a }',
        'export type { a, b }',
        'export * from \'mod\'',
        'export * as ns from \'mod\'',
        'export { a } from \'mod\'',
        'export { a as b } from \'mod\'',
        'export type * from \'mod\'',
        'export default function() {}',
        'export default class {}',
      ]

      for (const exp of exports) {
        const code = `const a = 1\nconst b = 2\nconst c = 3\n${exp}`
        const result = extractDeclarations(code, TEST_FILE)
        expect(result).toBeDefined()
      }
    })
  })

  describe('Stress tests', () => {
    it('should handle many declarations', () => {
      const count = 100
      const declarations = Array.from({ length: count }, (_, i) => {
        return `export const var${i}: number = ${i}`
      })

      const code = declarations.join('\n')
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(count)
    })

    it('should handle very long lines', () => {
      const longType = Array.from({ length: 100 }, (_, i) => `prop${i}: string`).join('; ')
      const code = `export type Long = { ${longType} }`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })

    it('should handle deeply nested objects', () => {
      let type = 'string'
      for (let i = 0; i < 20; i++) {
        type = `{ nested: ${type} }`
      }

      const code = `export type DeepObject = ${type}`
      const result = extractDeclarations(code, TEST_FILE)
      expect(result).toBeDefined()
    })
  })
})
