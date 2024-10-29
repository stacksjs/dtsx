import { extractNestedContent, extractObjectProperties } from './extract'
import { combineTypes, splitArrayElements } from './utils'

export function inferValueType(value: string): string {
  if (value.startsWith('{'))
    return 'Record<string, unknown>'
  if (value.startsWith('['))
    return 'unknown[]'
  if (value.startsWith('\'') || value.startsWith('"'))
    return 'string'
  if (!Number.isNaN(Number(value)))
    return 'number'
  if (value === 'true' || value === 'false')
    return 'boolean'
  if (value.includes('=>'))
    return '(...args: any[]) => unknown'
  return 'unknown'
}

/**
 * Infer array type from array literal with support for nested arrays and mixed elements
 */
export function inferArrayType(value: string): string {
  const content = extractNestedContent(value, '[', ']')
  if (content === null) {
    return 'never[]'
  }

  const elements = splitArrayElements(content)
  if (elements.length === 0) {
    return 'never[]'
  }

  const elementTypes = elements.map(element => inferElementType(element.trim()))
  const combinedTypes = combineTypes(elementTypes)
  return `Array<${combinedTypes}>`
}

/**
 * Infer element type with improved type detection
 */
export function inferElementType(element: string): string {
  const trimmed = element.trim()

  if (trimmed.startsWith('[')) {
    // Nested array
    return inferArrayType(trimmed)
  }

  if (trimmed.startsWith('{')) {
    // Object literal
    const properties = extractObjectProperties(trimmed)
    return `{ ${properties.map(p => `${p.key}: ${p.type}`).join('; ')} }`
  }

  if (trimmed.startsWith('(') || trimmed.startsWith('function') || trimmed.includes('=>')) {
    // Function type
    return '(...args: any[]) => unknown'
  }

  if (/^['"`]/.test(trimmed)) {
    // String literal
    return trimmed
  }

  if (!Number.isNaN(Number(trimmed))) {
    // Number literal
    return trimmed
  }

  if (trimmed === 'true' || trimmed === 'false') {
    // Boolean literal
    return trimmed
  }

  // Identifier or unknown value
  return 'unknown'
}
