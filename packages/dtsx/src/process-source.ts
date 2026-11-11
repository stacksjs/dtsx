import type { ProcessingContext } from './types'
import { extractDeclarations } from './extractor/extract'
import { hashContent } from './extractor/hash'
import { scanIsolatedDeclarations, scanSemanticDeclarations } from './extractor/scanner'
import { processDeclarations } from './processor'
import type { DeclarationEngine } from './native-engine'
import { emitWithNativeEngine, resolveDeclarationEngine } from './native-engine'
import { isStxFile, transformStxToTs } from './stx'
import { isVueFile, transformVueSfcToTs } from './vue'

/**
 * Emit through the native engine when it can produce this output: the engine
 * is loaded and the import order is the default one it implements. Returns
 * null otherwise, or when the native emitter rejects the input, and the
 * TypeScript engine runs instead.
 */
export function emitNatively(sourceCode: string, filename: string | undefined, keepComments: boolean, importOrder: readonly string[], isolatedDeclarations: boolean, engine?: DeclarationEngine): string | null {
  if (importOrder.length !== 1 || importOrder[0] !== 'bun') return null
  if (resolveDeclarationEngine(engine) === 'typescript') return null
  const source = isVueFile(filename ?? '') ? transformVueSfcToTs(sourceCode) : isStxFile(filename ?? '') ? transformStxToTs(sourceCode) : sourceCode
  return emitWithNativeEngine(source, { keepComments, isolatedDeclarations, engine, sourceFile: filename })
}

// ---------------------------------------------------------------------------
// Result-level cache: caches the FINAL DTS output string, not just declarations.
// This eliminates processDeclarations entirely on repeated calls (the #1 bottleneck).
// ---------------------------------------------------------------------------
const MAX_RESULT_CACHE_SIZE = 100
let _resultAccessCounter = 0
const resultCache = new Map<string, { result: string, contentHash: number | bigint, lastAccess: number }>()

/**
 * Process TypeScript source code from a string (for stdin support)
 * This is a lightweight module that avoids pulling in heavy dependencies
 * like bun Glob, fs/promises, bundler, cache, config, etc.
 */
export function processSource(
  sourceCode: string,
  filename?: string,
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
  isolatedDeclarations: boolean = false,
  engine?: DeclarationEngine,
): string {
  // Check result cache first — avoids both extraction AND processing on hit
  const contentHash = hashContent(sourceCode)
  const cacheKey = JSON.stringify([filename, keepComments, isolatedDeclarations, importOrder, resolveDeclarationEngine(engine)])
  const cached = resultCache.get(cacheKey)

  if (cached && cached.contentHash === contentHash) {
    cached.lastAccess = ++_resultAccessCounter
    return cached.result
  }

  const result = emitNatively(sourceCode, filename, keepComments, importOrder, isolatedDeclarations, engine)
    ?? emitWithTypeScriptEngine(sourceCode, filename, keepComments, importOrder, isolatedDeclarations)

  // Store in result cache
  resultCache.set(cacheKey, { result, contentHash, lastAccess: ++_resultAccessCounter })

  if (resultCache.size > MAX_RESULT_CACHE_SIZE) {
    // Batch evict ~10% to amortize O(n) scan cost
    const toEvict = Math.max(1, Math.ceil(resultCache.size * 0.1))
    const entries: [string, number][] = []
    for (const [key, entry] of resultCache) {
      entries.push([key, entry.lastAccess])
    }
    entries.sort((a, b) => a[1] - b[1])
    for (let i = 0; i < toEvict && i < entries.length; i++) {
      resultCache.delete(entries[i][0])
    }
  }

  return result
}

/** Generate declarations through the annotation-first isolated fast path. */
export function processSourceIsolated(
  sourceCode: string,
  filename?: string,
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
): string {
  return processSource(sourceCode, filename, keepComments, importOrder, true)
}

/** Generate declarations through the value-aware semantic inference path. */
export function processSourceSemantic(
  sourceCode: string,
  filename?: string,
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
): string {
  return processSource(sourceCode, filename, keepComments, importOrder, false)
}

function emitWithTypeScriptEngine(sourceCode: string, filename: string | undefined, keepComments: boolean, importOrder: string[], isolatedDeclarations: boolean): string {
  // Extract declarations (has its own cache layer too)
  const declarations = extractDeclarations(sourceCode, filename, keepComments, isolatedDeclarations)
  const context: ProcessingContext = {
    filePath: filename ?? 'stdin.ts',
    sourceCode,
    declarations,
  }
  return processDeclarations(declarations, context, keepComments, importOrder)
}

export function clearResultCache(): void {
  resultCache.clear()
}

/**
 * Fast path for project mode — skips cache lookup/store.
 * Use when processing many files once (no cache benefit).
 */
export function processSourceDirect(
  sourceCode: string,
  filename?: string,
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
  isolatedDeclarations: boolean = false,
  engine?: DeclarationEngine,
): string {
  return emitNatively(sourceCode, filename, keepComments, importOrder, isolatedDeclarations, engine)
    ?? processSourceWithTypeScriptEngine(sourceCode, filename, keepComments, importOrder, isolatedDeclarations)
}

/**
 * Emit through the TypeScript engine only, without the native engine or the
 * result cache: the reference the native engine is held to.
 */
export function processSourceWithTypeScriptEngine(
  sourceCode: string,
  filename?: string,
  keepComments: boolean = true,
  importOrder: string[] = ['bun'],
  isolatedDeclarations: boolean = false,
): string {
  // Component files are transformed into virtual TS modules before scanning.
  if (isVueFile(filename ?? '')) {
    sourceCode = transformVueSfcToTs(sourceCode)
  }
  else if (isStxFile(filename ?? '')) {
    sourceCode = transformStxToTs(sourceCode)
  }
  const declarations = isolatedDeclarations
    ? scanIsolatedDeclarations(sourceCode, filename, keepComments)
    : scanSemanticDeclarations(sourceCode, filename, keepComments)
  const context: ProcessingContext = {
    filePath: filename ?? 'stdin.ts',
    sourceCode,
    declarations,
  }
  return processDeclarations(declarations, context, keepComments, importOrder)
}
