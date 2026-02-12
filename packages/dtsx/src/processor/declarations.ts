/**
 * Declaration processors - convert declarations to DTS format
 */

import type { Declaration } from '../types'
import { formatComments } from './comments'
import { consumeCleanDefault, enableCleanDefaultCollection, extractSatisfiesType, inferNarrowType, isGenericType } from './type-inference'

/**
 * Format a @defaultValue tag as a standalone JSDoc block
 */
function formatDefaultJsdoc(tag: string): string {
  if (tag.includes('\n')) {
    return `/**\n * ${tag}\n */\n`
  }
  return `/** ${tag} */\n`
}

/**
 * Find the start of interface body, accounting for nested braces in generics
 * Returns the index of the opening brace of the body, or -1 if not found
 */
function findInterfaceBodyStart(text: string): number {
  const braceIdx = text.indexOf('{')
  if (braceIdx === -1) return -1

  // Fast path: if no '<' before the first '{', no generics to worry about
  const angleIdx = text.indexOf('<')
  if (angleIdx === -1 || angleIdx > braceIdx) return braceIdx

  // Slow path: has generics, need to track angle bracket depth
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

  // Fast path: if we have an explicit type annotation and no value needing special inference,
  // use the scanner's pre-built text directly
  if (decl.typeAnnotation && !decl.value) {
    return comments + decl.text
  }

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
  const value = decl.value as string | undefined

  // Check for 'satisfies' operator - extract the type from the satisfies clause
  if (value && value.includes(' satisfies ')) {
    const satisfiesType = extractSatisfiesType(value)
    if (satisfiesType) {
      typeAnnotation = satisfiesType
    }
  }
  // If we have a value that ends with 'as const' at the top level, infer narrow from value
  else if (value && value.trim().endsWith('as const')) {
    typeAnnotation = inferNarrowType(value, true)
  }
  else if (!typeAnnotation && value && kind === 'const') {
    // For const declarations WITHOUT explicit type annotation, infer types from the value
    // Containers (objects/arrays) get widened types (sound: properties/elements are mutable)
    // Scalars keep narrow literal types (sound: const binding is immutable)
    const trimmedVal = value.trim()
    const isContainer = trimmedVal.startsWith('{') || trimmedVal.startsWith('[')
    if (isContainer) enableCleanDefaultCollection()
    typeAnnotation = inferNarrowType(value, !isContainer)
  }
  else if (typeAnnotation && value && kind === 'const' && isGenericType(typeAnnotation)) {
    // For const declarations with generic type annotations (Record, any, object), prefer narrow inference
    const inferredType = inferNarrowType(value, true)
    if (inferredType !== 'unknown') {
      typeAnnotation = inferredType
    }
  }
  else if (!typeAnnotation && value) {
    // If no explicit type annotation, try to infer from value
    typeAnnotation = inferNarrowType(value, kind === 'const')
  }

  // Default to unknown if we couldn't determine type
  if (!typeAnnotation) {
    typeAnnotation = 'unknown'
  }

  // Build @defaultValue content for widened declarations (TSDoc standard)
  // Skip when value uses 'as const' — types are already narrow/self-documenting
  let defaultTag = ''
  if (value && !decl.typeAnnotation && !value.trim().endsWith('as const')) {
    const trimVal = value.trim()
    if (kind !== 'const') {
      // let/var with widened primitives
      const isWidenedPrimitive = (typeAnnotation === 'string' || typeAnnotation === 'number' || typeAnnotation === 'boolean')
      if (isWidenedPrimitive && trimVal.length > 0) {
        defaultTag = `@defaultValue ${trimVal}`
      }
    }
    else if (trimVal.startsWith('{') || trimVal.startsWith('[')) {
      // const containers — clean @defaultValue computed inline during type inference
      const cleanDefault = consumeCleanDefault()
      if (cleanDefault) {
        if (cleanDefault.includes('\n')) {
          const lines = cleanDefault.split('\n')
          defaultTag = `@defaultValue\n * \`\`\`ts\n${lines.map(l => ` * ${l}`).join('\n')}\n * \`\`\``
        }
        else {
          defaultTag = `@defaultValue \`${cleanDefault}\``
        }
      }
    }
  }

  result += `: ${typeAnnotation};`

  // Skip generated @defaultValue if user already has one
  if (defaultTag && comments && comments.includes('@defaultValue')) {
    defaultTag = ''
  }

  // Merge @defaultValue into existing JSDoc comment, or create standalone
  if (defaultTag && comments) {
    // Inject @defaultValue before closing */ of existing JSDoc block
    const trimmedComments = comments.trimEnd()
    const closingIdx = trimmedComments.lastIndexOf('*/')
    if (closingIdx !== -1) {
      let before = trimmedComments.slice(0, closingIdx).trimEnd()
      // Convert single-line `/** text` to multi-line `/**\n * text`
      if (before.startsWith('/** ') && !before.includes('\n')) {
        before = `/**\n * ${before.slice(4)}`
      }
      const merged = `${before}\n * ${defaultTag}\n */\n`
      return merged + result
    }
    // Line comment (// ...) — convert to JSDoc block and merge
    const commentText = trimmedComments.replace(/^\/\/\s*/, '')
    return `/**\n * ${commentText}\n * ${defaultTag}\n */\n` + result
  }
  if (defaultTag) {
    return formatDefaultJsdoc(defaultTag) + result
  }
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

  // Extract the type definition from the original text using indexOf instead of regex
  const typeIdx = decl.text.indexOf('type ')
  if (typeIdx !== -1) {
    let typeDef = decl.text.slice(typeIdx)
    // Strip trailing semicolons and whitespace
    let end = typeDef.length
    while (end > 0 && (typeDef.charCodeAt(end - 1) === 59 /* ; */ || typeDef.charCodeAt(end - 1) === 32 || typeDef.charCodeAt(end - 1) === 10 || typeDef.charCodeAt(end - 1) === 13)) end--
    if (end < typeDef.length) typeDef = typeDef.slice(0, end)
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

  // Ensure semicolon at end (unless it's a multi-line type that ends with })
  const _trimmed = result.trimEnd()
  if (!_trimmed.endsWith(';') && !_trimmed.endsWith('}')) {
    result += ';'
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

  // Extract the body from the original text using indexOf instead of regex
  const enumBraceIdx = decl.text.indexOf('{')
  if (enumBraceIdx !== -1) {
    result += ' ' + decl.text.slice(enumBraceIdx)
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

  // Remove trailing semicolons without regex
  let end = result.length
  while (end > 0 && result.charCodeAt(end - 1) === 59 /* ; */) end--
  if (end < result.length) result = result.slice(0, end)

  // Add single semicolon
  result += ';'

  return result
}

/**
 * Process export statement
 */
export function processExportDeclaration(decl: Declaration, keepComments: boolean = true): string {
  const comments = formatComments(decl.leadingComments, keepComments)
  return comments + decl.text.trim()
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

    // Extract the body from the original text using indexOf
    const modBraceIdx = decl.text.indexOf('{')
    if (modBraceIdx !== -1) {
      result += ' ' + decl.text.slice(modBraceIdx)
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

  // Extract the body from the original text using indexOf
  const nsBraceIdx = decl.text.indexOf('{')
  if (nsBraceIdx !== -1) {
    result += ' ' + decl.text.slice(nsBraceIdx)
  }
  else {
    result += ' {}'
  }

  return comments + result
}
