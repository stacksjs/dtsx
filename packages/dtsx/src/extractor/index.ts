/**
 * Extractor module - extracts declarations from TypeScript source code
 */

import type { ClassDeclaration, EnumDeclaration, ExportAssignment, ExportDeclaration, FunctionDeclaration, ImportDeclaration, InterfaceDeclaration, ModuleDeclaration, Node, SourceFile, TypeAliasDeclaration, VariableStatement } from 'typescript'
import type { Declaration } from '../types'
import { forEachChild, SyntaxKind } from 'typescript'
import type { AsyncParseConfig } from './cache'
import { getSourceFile, getSourceFileAsync } from './cache'
import {
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
import { shouldIncludeNonExportedFunction, shouldIncludeNonExportedInterface } from './helpers'

// Re-export all public APIs
export {
  batchParseSourceFiles,
  clearSourceFileCache,
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

/**
 * Extract only public API declarations from TypeScript source code
 * This focuses on what should be in .d.ts files, not implementation details
 */
export function extractDeclarations(sourceCode: string, filePath: string, keepComments: boolean = true): Declaration[] {
  const declarations: Declaration[] = []

  // Get or create cached TypeScript source file
  const sourceFile = getSourceFile(filePath, sourceCode)

  // Visit only top-level declarations
  function visitTopLevel(node: Node) {
    // Only process top-level declarations, skip function bodies and implementation details
    if (node.parent && node.parent !== sourceFile) {
      return // Skip nested declarations
    }

    switch (node.kind) {
      case SyntaxKind.ImportDeclaration:
        declarations.push(extractImportDeclaration(node as ImportDeclaration, sourceCode))
        break

      case SyntaxKind.ExportDeclaration:
        declarations.push(extractExportDeclaration(node as ExportDeclaration, sourceCode))
        break

      case SyntaxKind.ExportAssignment:
        declarations.push(extractExportAssignment(node as ExportAssignment, sourceCode))
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
        break
      }

      case SyntaxKind.TypeAliasDeclaration:
        declarations.push(extractTypeAliasDeclaration(node as TypeAliasDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.ClassDeclaration:
        declarations.push(extractClassDeclaration(node as ClassDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.EnumDeclaration:
        declarations.push(extractEnumDeclaration(node as EnumDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.ModuleDeclaration:
        declarations.push(extractModuleDeclaration(node as ModuleDeclaration, sourceCode, sourceFile, keepComments))
        break
    }

    // Continue visiting only top-level child nodes
    forEachChild(node, visitTopLevel)
  }

  visitTopLevel(sourceFile)

  // Second pass: Find referenced types that aren't imported or declared
  const referencedTypes = findReferencedTypes(declarations, sourceCode)
  const additionalDeclarations = extractReferencedTypeDeclarations(sourceFile, referencedTypes, sourceCode)
  declarations.push(...additionalDeclarations)

  return declarations
}

/**
 * Internal function to extract declarations from a pre-parsed SourceFile
 * Shared between sync and async versions
 */
function extractDeclarationsFromSourceFile(
  sourceFile: SourceFile,
  sourceCode: string,
  keepComments: boolean,
): Declaration[] {
  const declarations: Declaration[] = []

  // Visit only top-level declarations
  function visitTopLevel(node: Node) {
    // Only process top-level declarations, skip function bodies and implementation details
    if (node.parent && node.parent !== sourceFile) {
      return // Skip nested declarations
    }

    switch (node.kind) {
      case SyntaxKind.ImportDeclaration:
        declarations.push(extractImportDeclaration(node as ImportDeclaration, sourceCode))
        break

      case SyntaxKind.ExportDeclaration:
        declarations.push(extractExportDeclaration(node as ExportDeclaration, sourceCode))
        break

      case SyntaxKind.ExportAssignment:
        declarations.push(extractExportAssignment(node as ExportAssignment, sourceCode))
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
        break
      }

      case SyntaxKind.TypeAliasDeclaration:
        declarations.push(extractTypeAliasDeclaration(node as TypeAliasDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.ClassDeclaration:
        declarations.push(extractClassDeclaration(node as ClassDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.EnumDeclaration:
        declarations.push(extractEnumDeclaration(node as EnumDeclaration, sourceCode, sourceFile, keepComments))
        break

      case SyntaxKind.ModuleDeclaration:
        declarations.push(extractModuleDeclaration(node as ModuleDeclaration, sourceCode, sourceFile, keepComments))
        break
    }

    // Continue visiting only top-level child nodes
    forEachChild(node, visitTopLevel)
  }

  visitTopLevel(sourceFile)

  // Second pass: Find referenced types that aren't imported or declared
  const referencedTypes = findReferencedTypes(declarations, sourceCode)
  const additionalDeclarations = extractReferencedTypeDeclarations(sourceFile, referencedTypes, sourceCode)
  declarations.push(...additionalDeclarations)

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
