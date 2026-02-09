/**
 * Extractor module - extracts declarations from TypeScript source code
 */

import type { ClassDeclaration, EnumDeclaration, ExportAssignment, ExportDeclaration, FunctionDeclaration, ImportDeclaration, InterfaceDeclaration, ModuleDeclaration, Node, SourceFile, TypeAliasDeclaration, VariableStatement } from 'typescript'
import type { Declaration } from '../types'
import type { AsyncParseConfig } from './cache'
import { forEachChild, SyntaxKind } from 'typescript'
import { getSourceFileAsync, hashContent } from './cache'
// Re-export all public APIs
import { clearSourceFileCache as _clearSFCache } from './cache'
import {
  extractClassDeclaration,
  extractEnumDeclaration,
  extractExportAssignment,
  extractExportDeclaration,
  extractFunctionDeclaration,
  extractImportDeclaration,
  extractInterfaceDeclaration,
  extractModuleDeclaration,
  extractTypeAliasDeclaration,
  extractVariableStatement,
  findReferencedTypes,
} from './declarations'
import { shouldIncludeNonExportedFunction, shouldIncludeNonExportedInterface } from './helpers'
import { scanDeclarations } from './scanner'

export {
  buildClassBody,
  buildClassDeclaration,
  buildFunctionSignature,
  buildInterfaceDeclaration,
  buildModuleBody,
  buildModuleDeclaration,
  buildTypeDeclaration,
  buildVariableDeclaration,
  getInterfaceBody,
} from './builders'
export {
  batchParseSourceFiles,
  getPendingParseCount,
  getSourceFileAsync,
  getSourceFileCacheSize,
  shouldUseAsyncParsing,
} from './cache'
export type { AsyncParseConfig } from './cache'
export {
  extractClassDeclaration,
  extractEnumDeclaration,
  extractExportAssignment,
  extractExportDeclaration,
  extractFunctionDeclaration,
  extractImportDeclaration,
  extractInterfaceDeclaration,
  extractModuleDeclaration,
  extractReferencedTypeDeclarations,
  extractTypeAliasDeclaration,
  extractVariableStatement,
  findReferencedTypes,
} from './declarations'
export {
  extractJSDocComments,
  extractTripleSlashDirectives,
  extractTypesFromModuleText,
  getNodeText,
  getParameterName,
  hasAsyncModifier,
  hasExportModifier,
  isBuiltInType,
  shouldIncludeNonExportedFunction,
  shouldIncludeNonExportedInterface,
} from './helpers'

/**
 * Cache for extracted declarations to avoid re-walking the AST when source hasn't changed.
 * Key: `${filePath}:${keepComments}`, Value: { declarations, contentHash, lastAccess }
 * Bounded to prevent memory leaks when processing many files
 */
const MAX_DECLARATION_CACHE_SIZE = 100
const declarationCache = new Map<string, { declarations: Declaration[], contentHash: number | bigint, lastAccess: number }>()

/**
 * Clear all extractor caches (source files and declarations)
 */
export function clearSourceFileCache(): void {
  _clearSFCache()
  declarationCache.clear()
}

/**
 * Extract only public API declarations from TypeScript source code
 * Uses fast string-based scanner (no TypeScript parser) for maximum performance.
 * Falls back to TS parser-based extraction if scanner is not available.
 */
export function extractDeclarations(sourceCode: string, filePath: string, keepComments: boolean = true): Declaration[] {
  const contentHash = hashContent(sourceCode)
  const cacheKey = `${filePath}:${keepComments ? 1 : 0}`
  const cached = declarationCache.get(cacheKey)
  const now = Date.now()

  if (cached && cached.contentHash === contentHash) {
    cached.lastAccess = now
    return cached.declarations
  }

  // Use fast string scanner (no TS parser needed)
  const declarations = scanDeclarations(sourceCode, filePath, keepComments)

  declarationCache.set(cacheKey, { declarations, contentHash, lastAccess: now })

  // Evict oldest entry if cache exceeds max size
  if (declarationCache.size > MAX_DECLARATION_CACHE_SIZE) {
    let oldestKey: string | null = null
    let oldestTime = Infinity
    for (const [key, entry] of declarationCache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestKey = key
      }
    }
    if (oldestKey) {
      declarationCache.delete(oldestKey)
    }
  }

  return declarations
}

/**
 * Internal function to extract declarations from a pre-parsed SourceFile
 * Single-pass: collects all declarations and non-exported type candidates in one tree walk.
 * Then resolves referenced types from the candidate map (no second tree walk).
 */
function extractDeclarationsFromSourceFile(
  sourceFile: SourceFile,
  sourceCode: string,
  keepComments: boolean,
): Declaration[] {
  const declarations: Declaration[] = []
  // Collect ALL non-exported type declarations during the single walk
  // so we can resolve referenced types without a second tree traversal
  const nonExportedTypeCandidates = new Map<string, Declaration>()

  // Visit only top-level declarations using depth tracking (no parent nodes)
  let depth = 0
  function visitTopLevel(node: Node) {
    // Only process direct children of the source file (depth 1)
    if (depth !== 1) {
      depth++
      forEachChild(node, visitTopLevel)
      depth--
      return
    }

    switch (node.kind) {
      case SyntaxKind.ImportDeclaration:
        declarations.push(extractImportDeclaration(node as ImportDeclaration, sourceCode, sourceFile))
        break

      case SyntaxKind.ExportDeclaration:
        declarations.push(extractExportDeclaration(node as ExportDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.ExportAssignment:
        declarations.push(extractExportAssignment(node as ExportAssignment, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.FunctionDeclaration: {
        const funcDecl = extractFunctionDeclaration(node as FunctionDeclaration, sourceCode, sourceFile, keepComments)
        // Only include exported functions or functions that are referenced by exported items
        if (funcDecl && (funcDecl.isExported || shouldIncludeNonExportedFunction(funcDecl.name, sourceCode))) {
          declarations.push(funcDecl)
        }
        break
      }

      case SyntaxKind.VariableStatement: {
        const varDecls = extractVariableStatement(node as VariableStatement, sourceCode, sourceFile, keepComments)
        declarations.push(...varDecls)
        break
      }

      case SyntaxKind.InterfaceDeclaration: {
        const interfaceDecl = extractInterfaceDeclaration(node as InterfaceDeclaration, sourceCode, sourceFile, keepComments)
        // Include interfaces that are exported or referenced by exported items
        if (interfaceDecl.isExported || shouldIncludeNonExportedInterface(interfaceDecl.name, sourceCode)) {
          declarations.push(interfaceDecl)
        }
        else {
          // Store for potential resolution in referenced-types pass
          nonExportedTypeCandidates.set(interfaceDecl.name, interfaceDecl)
        }
        break
      }

      case SyntaxKind.TypeAliasDeclaration: {
        const typeDecl = extractTypeAliasDeclaration(node as TypeAliasDeclaration, sourceCode, sourceFile, keepComments)
        declarations.push(typeDecl)
        if (!typeDecl.isExported) {
          nonExportedTypeCandidates.set(typeDecl.name, typeDecl)
        }
        break
      }

      case SyntaxKind.ClassDeclaration: {
        const classDecl = extractClassDeclaration(node as ClassDeclaration, sourceCode, sourceFile, keepComments)
        declarations.push(classDecl)
        if (!classDecl.isExported && classDecl.name) {
          nonExportedTypeCandidates.set(classDecl.name, classDecl)
        }
        break
      }

      case SyntaxKind.EnumDeclaration: {
        const enumDecl = extractEnumDeclaration(node as EnumDeclaration, sourceCode, sourceFile, keepComments)
        declarations.push(enumDecl)
        if (!enumDecl.isExported) {
          nonExportedTypeCandidates.set(enumDecl.name, enumDecl)
        }
        break
      }

      case SyntaxKind.ModuleDeclaration:
        declarations.push(extractModuleDeclaration(node as ModuleDeclaration, sourceCode, sourceFile, keepComments))
        break
    }
  }

  // Start walk from sourceFile (depth 0 → increments to 1 for direct children)
  visitTopLevel(sourceFile)

  // Resolve referenced types from the candidate map (no second tree walk)
  if (nonExportedTypeCandidates.size > 0) {
    const referencedTypes = findReferencedTypes(declarations, sourceCode)
    for (const typeName of referencedTypes) {
      const candidate = nonExportedTypeCandidates.get(typeName)
      if (candidate) {
        declarations.push(candidate)
      }
    }
  }

  return declarations
}

/**
 * Async version of extractDeclarations that yields to the event loop for large files
 * Use this when processing many files in parallel to prevent blocking
 */
export async function extractDeclarationsAsync(
  sourceCode: string,
  filePath: string,
  keepComments: boolean = true,
  config: AsyncParseConfig = {},
): Promise<Declaration[]> {
  // Get or create cached TypeScript source file asynchronously
  const sourceFile = await getSourceFileAsync(filePath, sourceCode, config)

  return extractDeclarationsFromSourceFile(sourceFile, sourceCode, keepComments)
}

/**
 * Batch extract declarations from multiple files asynchronously
 * Useful for processing many files while keeping the event loop responsive
 */
export async function batchExtractDeclarations(
  files: Array<{ filePath: string, sourceCode: string, keepComments?: boolean }>,
  config: AsyncParseConfig & { concurrency?: number } = {},
): Promise<Map<string, Declaration[]>> {
  const concurrency = config.concurrency ?? 4
  const results = new Map<string, Declaration[]>()

  // Process files in batches
  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency)

    const batchResults = await Promise.all(
      batch.map(async ({ filePath, sourceCode, keepComments = true }) => {
        const declarations = await extractDeclarationsAsync(sourceCode, filePath, keepComments, config)
        return { filePath, declarations }
      }),
    )

    for (const { filePath, declarations } of batchResults) {
      results.set(filePath, declarations)
    }
  }

  return results
}
