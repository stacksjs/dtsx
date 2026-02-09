import type { ProcessingContext } from './types'
import { extractDeclarations } from './extractor'
import { processDeclarations } from './processor'

/**
 * Process TypeScript source code from a string (for stdin support)
 * This is a lightweight module that avoids pulling in heavy dependencies
 * like bun Glob, fs/promises, bundler, cache, config, etc.
 */
export function processSource(
  sourceCode: string,
  filename: string = 'stdin.ts',
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
): string {
  // Extract declarations
  const declarations = extractDeclarations(sourceCode, filename, keepComments)

  // Create processing context
  const context: ProcessingContext = {
    filePath: filename,
    sourceCode,
    declarations,
    imports: new Map(),
    exports: new Set(),
    usedTypes: new Set(),
  }

  // Process declarations to generate DTS
  return processDeclarations(declarations, context, keepComments, importOrder)
}
