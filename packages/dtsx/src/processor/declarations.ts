/**
 * Declaration processors - convert declarations to DTS format
 */

import type { Declaration } from '../types'
import { formatComments } from './comments'
import { extractSatisfiesType, inferNarrowType, isGenericType } from './type-inference'

/**
 * Find the start of interface body, accounting for nested braces in generics
 * Returns the index of the opening brace of the body, or -1 if not found
 */
function findInterfaceBodyStart(text: string): number {
  let angleDepth = 0
  let inString = false
  let stringChar = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const prevChar = i > 0 ? text[i - 1] : ''

    // Handle string literals
    if (!inString && (char === '"' || char === '\'' || char === '`')) {
      inString = true
      stringChar = char
    }
    else if (inString && char === stringChar && prevChar !== '\\') {
      inString = false
    }

    if (!inString) {
      // Track angle brackets for generics
      if (char === '<') {
        angleDepth++
      }
      else if (char === '>') {
        angleDepth--
      }
      // The body starts with { after all generics are closed
      else if (char === '{' && angleDepth === 0) {
        return i
      }
    }
  }

  return -1
}

/**
 * Process function declaration to DTS format
 */
export function processFunctionDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // The extractor already provides the correct DTS signature, just return it
  return comments + decl.text
}

/**
 * Process variable declaration to DTS format
 */
export function processVariableDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Add variable kind (const, let, var)
  const kind = decl.modifiers?.[0] || 'const'
  result += `${kind} `

  // Add variable name
  result += decl.name

  // Add type annotation
  let typeAnnotation = decl.typeAnnotation

  // Check for 'satisfies' operator - extract the type from the satisfies clause
  if (decl.value && decl.value.includes(' satisfies ')) {
    const satisfiesType = extractSatisfiesType(decl.value)
    if (satisfiesType) {
      typeAnnotation = satisfiesType
    }
  }
  // If we have a value, check if it has 'as const' - if so, infer from value instead of type annotation
  else if (decl.value && decl.value.includes('as const')) {
    typeAnnotation = inferNarrowType(decl.value, true)
  }
  else if (!typeAnnotation && decl.value && kind === 'const') {
    // For const declarations WITHOUT explicit type annotation, infer narrow types from the value
    typeAnnotation = inferNarrowType(decl.value, true)
  }
  else if (typeAnnotation && decl.value && kind === 'const' && isGenericType(typeAnnotation)) {
    // For const declarations with generic type annotations (Record, any, object), prefer narrow inference
    const inferredType = inferNarrowType(decl.value, true)
    if (inferredType !== 'unknown') {
      typeAnnotation = inferredType
    }
  }
  else if (!typeAnnotation && decl.value) {
    // If no explicit type annotation, try to infer from value
    typeAnnotation = inferNarrowType(decl.value, kind === 'const')
  }

  // Default to any if we couldn't determine type
  if (!typeAnnotation) {
    typeAnnotation = 'any'
  }

  result += `: ${typeAnnotation};`

  return comments + result
}

/**
 * Process interface declaration to DTS format
 */
export function processInterfaceDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // The extractor already produces properly formatted interface declarations
  // We just need to ensure proper export and declare keywords
  const text = decl.text

  // If the extractor's text already starts with proper keywords, use it
  if (text.startsWith('export declare interface') || text.startsWith('declare interface')) {
    return comments + text
  }

  // Otherwise build from components
  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare interface '

  // Add interface name
  result += decl.name

  // Add generics if present (no space before)
  if (decl.generics) {
    result += decl.generics
  }

  // Add extends clause if present
  if (decl.extends) {
    result += ` extends ${decl.extends}`
  }

  // Find the body using balanced brace matching to handle nested braces in generics
  const bodyStart = findInterfaceBodyStart(decl.text)
  if (bodyStart !== -1) {
    result += ` ${decl.text.slice(bodyStart)}`
  }
  else {
    result += ' {}'
  }

  return comments + result
}

/**
 * Process type alias declaration to DTS format
 */
export function processTypeDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // For type exports like export type { Foo }
  if (decl.text.includes('{') && decl.text.includes('}') && decl.text.includes('from')) {
    return comments + decl.text
  }

  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Only add declare for non-exported type aliases
  if (!decl.isExported && !decl.text.includes(' from ')) {
    result += 'declare '
  }

  // Extract the type definition from the original text
  // Remove leading/trailing whitespace and comments
  const typeMatch = decl.text.match(/type\s[^=]+=\s*([\s\S]+)/)
  if (typeMatch) {
    const typeDef = typeMatch[0].replace(/;?\s*$/, '')
    result += typeDef
  }
  else {
    // Fallback to simple format
    result += `type ${decl.name}`
    if (decl.generics) {
      result += decl.generics // No space before generics
    }
    result += ' = any'
  }

  return comments + result
}

/**
 * Process class declaration to DTS format
 */
export function processClassDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // The extractor already provides the correct DTS signature, just return it
  return comments + decl.text
}

/**
 * Process enum declaration to DTS format
 */
export function processEnumDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Add const if needed
  if (decl.modifiers?.includes('const')) {
    result += 'const '
  }

  // Add enum keyword
  result += 'enum '

  // Add enum name
  result += decl.name

  // Extract the body from the original text
  const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
  if (bodyMatch) {
    result += ` ${bodyMatch[0]}`
  }
  else {
    result += ' {}'
  }

  return comments + result
}

/**
 * Process import statement
 */
export function processImportDeclaration(decl: Declaration): string {
  // Import statements remain the same in .d.ts files
  // Just ensure they end with semicolon
  let result = decl.text.trim()

  // Remove any existing semicolon to avoid doubles
  result = result.replace(/;+$/, '')

  // Add single semicolon
  result += ';'

  return result
}

/**
 * Process export statement
 */
export function processExportDeclaration(decl: Declaration): string {
  // Type re-exports and other export statements should be returned as-is
  return decl.text.trim()
}

/**
 * Process module/namespace declaration to DTS format
 */
export function processModuleDeclaration(decl: Declaration, keepComments: boolean = true): string {
  // Add comments if present
  const comments = formatComments(decl.leadingComments, keepComments)

  // Check if this is a global augmentation (declare global { ... })
  // The extractor already formats this correctly, so just use the text
  if (decl.text.startsWith('declare global')) {
    return comments + decl.text
  }

  // Check if this is an ambient module (quoted name)
  const isAmbientModule = decl.source || (decl.name.startsWith('"') || decl.name.startsWith('\'') || decl.name.startsWith('`'))

  if (isAmbientModule) {
    // This is a module declaration like: declare module 'module-name'
    let result = 'declare module '

    // Add module name
    result += decl.name

    // Extract the body from the original text
    const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
    if (bodyMatch) {
      result += ` ${bodyMatch[0]}`
    }
    else {
      result += ' {}'
    }

    return comments + result
  }

  // Regular namespace
  let result = ''

  // Add export if needed
  if (decl.isExported) {
    result += 'export '
  }

  // Add declare if not already present
  if (!decl.modifiers?.includes('declare')) {
    result += 'declare '
  }

  // Add namespace keyword
  result += 'namespace '

  // Add namespace name
  result += decl.name

  // Extract the body from the original text
  const bodyMatch = decl.text.match(/\{[\s\S]*\}/)
  if (bodyMatch) {
    result += ` ${bodyMatch[0]}`
  }
  else {
    result += ' {}'
  }

  return comments + result
}
