import type { ProcessingContext } from './types'
import { extractDeclarations } from './extractor/extract'
import { scanDeclarations } from './extractor/scanner'
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
  }

  // Process declarations to generate DTS
  return processDeclarations(declarations, context, keepComments, importOrder)
}

/**
 * Fast path for project mode — skips cache lookup/store.
 * Use when processing many files once (no cache benefit).
 */
export function processSourceDirect(
  sourceCode: string,
  filename: string = 'stdin.ts',
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
  isolatedDeclarations: boolean = false,
): string {
  const declarations = scanDeclarations(sourceCode, filename, keepComments, isolatedDeclarations)
  const context: ProcessingContext = {
    filePath: filename,
    sourceCode,
    declarations,
  }
  return processDeclarations(declarations, context, keepComments, importOrder)
}
