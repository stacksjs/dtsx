/**
 * Helper utilities for the extractor
 */

import type { FunctionDeclaration, Modifier, Node, ParameterDeclaration, SourceFile } from 'typescript'
import { isArrayBindingPattern, isBindingElement, isIdentifier, isObjectBindingPattern, SyntaxKind } from 'typescript'

/**
 * Get the text of a node from source code
 */
export function getNodeText(node: Node, sourceCode: string, sf?: SourceFile): string {
  return sourceCode.slice(sf ? node.getStart(sf) : node.getStart(), node.getEnd())
}

// Combined block-comment regex: captures both `/** ... */` (JSDoc) and
// `/* ... */` (non-JSDoc) in a single pass instead of two scans of the trivia.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g

/**
 * Extract JSDoc comments from a node
 */
export function extractJSDocComments(node: Node, sourceFile: SourceFile): string[] {
  const comments: string[] = []

  // Get leading trivia (comments before the node)
  const fullStart = node.getFullStart()
  const start = node.getStart(sourceFile)
  if (fullStart === start) return comments

  const triviaText = sourceFile.text.substring(fullStart, start)

  // Single-pass block-comment extraction (was two separate regexes).
  if (triviaText.indexOf('/*') !== -1) {
    BLOCK_COMMENT_RE.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = BLOCK_COMMENT_RE.exec(triviaText)) !== null) {
      comments.push(match[0])
    }
  }

  // Capture single-line comments adjacent to the declaration. Skip the split
  // entirely when no `//` markers are present in the trivia.
  if (triviaText.indexOf('//') !== -1) {
    const lines = triviaText.split('\n')
    const commentLines: string[] = []
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.startsWith('//')) {
        commentLines.unshift(line)
      }
      else if (line === '') {
        continue
      }
      else {
        break
      }
    }
    if (commentLines.length > 0) {
      comments.push(commentLines.join('\n'))
    }
  }

  return comments
}

/**
 * Get parameter name without default values for DTS
 */
export function getParameterName(param: ParameterDeclaration, sf?: SourceFile): string {
  if (isObjectBindingPattern(param.name)) {
    // For destructured parameters like { name, cwd, defaultConfig }
    // We need to reconstruct without default values
    const elements = param.name.elements.map((element) => {
      if (isBindingElement(element) && isIdentifier(element.name)) {
        // Don't include default values in DTS
        return element.name.getText(sf)
      }
      return ''
    }).filter(Boolean)

    // Format on multiple lines if there are multiple elements
    if (elements.length > 3) {
      return `{\n  ${elements.join(',\n  ')},\n}`
    }
    return `{ ${elements.join(', ')} }`
  }
  else if (isArrayBindingPattern(param.name)) {
    // For array destructuring parameters
    const elements = param.name.elements.map((element) => {
      if (element && isBindingElement(element) && isIdentifier(element.name)) {
        return element.name.getText(sf)
      }
      return ''
    }).filter(Boolean)
    return `[${elements.join(', ')}]`
  }
  else {
    // Simple parameter name
    return param.name.getText(sf)
  }
}

/**
 * Check if a node has export modifier
 */
export function hasExportModifier(node: Node): boolean {
  if (!('modifiers' in node) || !node.modifiers)
    return false
  const modifiers = node.modifiers as readonly Modifier[]
  return modifiers.some((mod: Modifier) => mod.kind === SyntaxKind.ExportKeyword)
}

/**
 * Check if a function has async modifier
 */
export function hasAsyncModifier(node: FunctionDeclaration): boolean {
  return node.modifiers?.some(mod => mod.kind === SyntaxKind.AsyncKeyword) || false
}

/**
 * Check if a non-exported function should be included (e.g., if it's referenced by exported items)
 */
export function shouldIncludeNonExportedFunction(_functionName?: string, _sourceCode?: string): boolean {
  // For now, don't include non-exported functions
  // In the future, we could analyze if they're referenced by exported functions
  return false
}

// Cache for interface usage patterns
const interfacePatternCache = new Map<string, { funcPattern: RegExp, typePattern: RegExp }>()

/**
 * Check if a non-exported interface should be included (e.g., if it's used by exported items)
 */
export function shouldIncludeNonExportedInterface(interfaceName: string, sourceCode: string): boolean {
  // Get or create cached patterns for this interface name
  let patterns = interfacePatternCache.get(interfaceName)
  if (!patterns) {
    const escaped = interfaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Use [^\n]* instead of .*? to avoid backtracking across lines
    // This is more efficient as it stops at line boundaries
    patterns = {
      funcPattern: new RegExp(`export\\s+[^\\n]*:\\s*[^\\n]*\\b${escaped}\\b`, 'gm'),
      typePattern: new RegExp(`export\\s+[^\\n]*\\b${escaped}\\b`, 'gm'),
    }
    interfacePatternCache.set(interfaceName, patterns)

    // Evict a batch of entries if cache grows too large
    if (interfacePatternCache.size > 200) {
      const keysToDelete = Array.from(interfacePatternCache.keys()).slice(0, 50)
      for (const key of keysToDelete) {
        interfacePatternCache.delete(key)
      }
    }
  }

  // Reset lastIndex before testing (since we use 'g' flag)
  patterns.funcPattern.lastIndex = 0
  patterns.typePattern.lastIndex = 0

  return patterns.funcPattern.test(sourceCode) || patterns.typePattern.test(sourceCode)
}

/**
 * Built-in TypeScript types and common generic type parameters (hoisted to module level for performance)
 */
const BUILT_IN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'any',
  'unknown',
  'never',
  'void',
  'undefined',
  'null',
  'Array',
  'Promise',
  'Record',
  'Partial',
  'Required',
  'Pick',
  'Omit',
  'Exclude',
  'Extract',
  'NonNullable',
  'ReturnType',
  'Parameters',
  'ConstructorParameters',
  'InstanceType',
  'ThisType',
  'Function',
  'Date',
  'RegExp',
  'Error',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'T',
  'K',
  'V',
  'U',
  'R',
  'P',
  'E',
  'A',
  'B',
  'C',
  'D',
  'F',
  'G',
  'H',
  'I',
  'J',
  'L',
  'M',
  'N',
  'O',
  'Q',
  'S',
  'W',
  'X',
  'Y',
  'Z',
])

/**
 * Check if a type is a built-in TypeScript type
 */
export function isBuiltInType(typeName: string): boolean {
  return BUILT_IN_TYPES.has(typeName)
}

// Re-exported from directives.ts for backward compatibility
export { extractTripleSlashDirectives } from './directives'

// Combined module-type regex: a single pass over the module text capturing the
// declaration kind in group 1 (unused) and the type name in group 2. The
// previous implementation ran four separate global regexes and then a second
// regex replace per match to strip the keyword.
const MODULE_TYPES_RE = /(?:export\s+)?(?:declare\s+)?(?:const\s+)?(?:interface|type|class|enum)\s+([A-Z][a-zA-Z0-9]*)/g

/**
 * Extract type names from module/namespace text
 */
export function extractTypesFromModuleText(moduleText: string): string[] {
  const types: string[] = []
  MODULE_TYPES_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = MODULE_TYPES_RE.exec(moduleText)) !== null) {
    types.push(match[1])
  }
  return types
}
