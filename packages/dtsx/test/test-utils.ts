/**
 * Shared test utilities for dtsx test suite
 */

import type { ProcessingContext } from '../src/types'
import { extractDeclarations } from '../src/extractor'
import { processDeclarations } from '../src/processor'

const DEFAULT_FILE = 'test.ts'

/**
 * Create a ProcessingContext from source code
 */
export function createContext(code: string, filePath: string = DEFAULT_FILE): ProcessingContext {
  const declarations = extractDeclarations(code, filePath)
  return {
    filePath,
    sourceCode: code,
    declarations,
    imports: new Map(),
    exports: new Set(),
    usedTypes: new Set(),
  }
}

/**
 * Extract declarations and process them into DTS output in one step
 */
export function processCode(code: string, filePath: string = DEFAULT_FILE, keepComments: boolean = true): string {
  const declarations = extractDeclarations(code, filePath, keepComments)
  const context = createContext(code, filePath)
  return processDeclarations(declarations, context, keepComments)
}

/**
 * Normalize whitespace for comparison (trims trailing whitespace per line)
 */
export function normalize(str: string): string {
  return str
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
}
