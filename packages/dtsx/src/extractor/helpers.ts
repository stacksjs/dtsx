/**
 * Helper utilities for the extractor
 */

import type { FunctionDeclaration, Modifier, Node, ParameterDeclaration, SourceFile } from 'typescript'
import { isArrayBindingPattern, isBindingElement, isIdentifier, isObjectBindingPattern, SyntaxKind } from 'typescript'

/**
 * Get the text of a node from source code
 */
export function getNodeText(node: Node, sourceCode: string): string {
  return sourceCode.slice(node.getStart(), node.getEnd())
}

/**
 * Extract JSDoc comments from a node
 */
export function extractJSDocComments(node: Node, sourceFile: SourceFile): string[] {
  const comments: string[] = []

  // Get leading trivia (comments before the node)
  const fullStart = node.getFullStart()
  const start = node.getStart(sourceFile)

  if (fullStart !== start) {
    const triviaText = sourceFile.text.substring(fullStart, start)

    // Extract JSDoc comments (/** ... */) and single-line comments (// ...)
    const jsDocMatches = triviaText.match(/\/\*\*[\s\S]*?\*\//g)
    if (jsDocMatches) {
      comments.push(...jsDocMatches)
    }

    // Also capture regular block comments (/* ... */) that might be documentation
    const blockCommentMatches = triviaText.match(/\/\*(?!\*)[\s\S]*?\*\//g)
    if (blockCommentMatches) {
      comments.push(...blockCommentMatches)
    }

    // Capture single-line comments that appear right before the declaration
    const lines = triviaText.split('\n')
    const commentLines: string[] = []

    // Look for consecutive comment lines at the end of the trivia
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (line.startsWith('//')) {
        commentLines.unshift(line)
      }
      else if (line === '') {
        // Empty line is okay, continue
        continue
      }
      else {
        // Non-comment, non-empty line - stop
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
export function getParameterName(param: ParameterDeclaration): string {
  if (isObjectBindingPattern(param.name)) {
    // For destructured parameters like { name, cwd, defaultConfig }
    // We need to reconstruct without default values
    const elements = param.name.elements.map((element) => {
      if (isBindingElement(element) && isIdentifier(element.name)) {
        // Don't include default values in DTS
        return element.name.getText()
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
        return element.name.getText()
      }
      return ''
    }).filter(Boolean)
    return `[${elements.join(', ')}]`
  }
  else {
    // Simple parameter name
    return param.name.getText()
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

/**
 * Check if a non-exported interface should be included (e.g., if it's used by exported items)
 */
export function shouldIncludeNonExportedInterface(interfaceName: string, sourceCode: string): boolean {
  // Check if the interface is used in exported function signatures or other exported types
  const exportedFunctionPattern = new RegExp(`export\\s+.*?:\\s*.*?${interfaceName}`, 'g')
  const exportedTypePattern = new RegExp(`export\\s+.*?${interfaceName}`, 'g')

  return exportedFunctionPattern.test(sourceCode) || exportedTypePattern.test(sourceCode)
}

/**
 * Check if a type is a built-in TypeScript type
 */
export function isBuiltInType(typeName: string): boolean {
  const builtInTypes = new Set([
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
    // Common generic type parameters
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
  return builtInTypes.has(typeName)
}

/**
 * Extract triple-slash directives from the beginning of source code
 * These are special comments like /// <reference types="..." />
 */
export function extractTripleSlashDirectives(sourceCode: string): string[] {
  const directives: string[] = []
  const lines = sourceCode.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // Triple-slash directives must be at the very beginning of the file
    // (only whitespace and other triple-slash directives can precede them)
    if (trimmed.startsWith('///')) {
      // Match reference directives: /// <reference path="..." />, /// <reference types="..." />, /// <reference lib="..." />
      if (trimmed.match(/^\/\/\/\s*<reference\s+(path|types|lib|no-default-lib)\s*=\s*["'][^"']+["']\s*\/>/)) {
        directives.push(trimmed)
      }
      // Match amd-module directive: /// <amd-module name="..." />
      else if (trimmed.match(/^\/\/\/\s*<amd-module\s+name\s*=\s*["'][^"']+["']\s*\/>/)) {
        directives.push(trimmed)
      }
      // Match amd-dependency directive: /// <amd-dependency path="..." />
      else if (trimmed.match(/^\/\/\/\s*<amd-dependency\s+path\s*=\s*["'][^"']+["']/)) {
        directives.push(trimmed)
      }
    }
    else if (trimmed === '' || trimmed.startsWith('//')) {
      // Empty lines or regular comments can precede triple-slash directives
      continue
    }
    else {
      // Non-comment, non-empty line - stop looking for directives
      break
    }
  }

  return directives
}

/**
 * Extract type names from module/namespace text
 */
export function extractTypesFromModuleText(moduleText: string): string[] {
  const types: string[] = []

  // Look for interface declarations
  const interfaceMatches = moduleText.match(/(?:export\s+)?interface\s+([A-Z][a-zA-Z0-9]*)/g)
  if (interfaceMatches) {
    interfaceMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?interface\s+/, '')
      types.push(name)
    })
  }

  // Look for type alias declarations
  const typeMatches = moduleText.match(/(?:export\s+)?type\s+([A-Z][a-zA-Z0-9]*)/g)
  if (typeMatches) {
    typeMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?type\s+/, '')
      types.push(name)
    })
  }

  // Look for class declarations
  const classMatches = moduleText.match(/(?:export\s+)?(?:declare\s+)?class\s+([A-Z][a-zA-Z0-9]*)/g)
  if (classMatches) {
    classMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?(?:declare\s+)?class\s+/, '')
      types.push(name)
    })
  }

  // Look for enum declarations
  const enumMatches = moduleText.match(/(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Z][a-zA-Z0-9]*)/g)
  if (enumMatches) {
    enumMatches.forEach((match) => {
      const name = match.replace(/(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+/, '')
      types.push(name)
    })
  }

  return types
}
