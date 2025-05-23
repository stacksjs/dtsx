import * as ts from 'typescript'
import type { Declaration } from './types'

// Performance optimization: Cache compiled regexes
const DECLARATION_PATTERNS = {
  import: /^import\s+/m,
  export: /^export\s+/m,
  function: /^(export\s+)?(async\s+)?function\s+/m,
  variable: /^(export\s+)?(const|let|var)\s+/m,
  interface: /^(export\s+)?interface\s+/m,
  type: /^(export\s+)?type\s+/m,
  class: /^(export\s+)?(abstract\s+)?class\s+/m,
  enum: /^(export\s+)?(const\s+)?enum\s+/m,
  module: /^(export\s+)?(declare\s+)?(module|namespace)\s+/m
} as const

/**
 * Extract only public API declarations from TypeScript source code
 * This focuses on what should be in .d.ts files, not implementation details
 */
export function extractDeclarations(sourceCode: string, filePath: string): Declaration[] {
  const declarations: Declaration[] = []

  // Create TypeScript source file
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

    // Visit only top-level declarations
  function visitTopLevel(node: ts.Node) {
    // Only process top-level declarations, skip function bodies and implementation details
    if (node.parent && node.parent !== sourceFile) {
      return // Skip nested declarations
    }

    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        declarations.push(extractImportDeclaration(node as ts.ImportDeclaration, sourceCode))
        break

      case ts.SyntaxKind.ExportDeclaration:
        declarations.push(extractExportDeclaration(node as ts.ExportDeclaration, sourceCode))
        break

      case ts.SyntaxKind.ExportAssignment:
        declarations.push(extractExportAssignment(node as ts.ExportAssignment, sourceCode))
        break

      case ts.SyntaxKind.FunctionDeclaration:
        const funcDecl = extractFunctionDeclaration(node as ts.FunctionDeclaration, sourceCode)
        // Only include exported functions or functions that are referenced by exported items
        if (funcDecl && (funcDecl.isExported || shouldIncludeNonExportedFunction(funcDecl.name, sourceCode))) {
          declarations.push(funcDecl)
        }
        break

      case ts.SyntaxKind.VariableStatement:
        const varDecls = extractVariableStatement(node as ts.VariableStatement, sourceCode)
        declarations.push(...varDecls)
        break

      case ts.SyntaxKind.InterfaceDeclaration:
        const interfaceDecl = extractInterfaceDeclaration(node as ts.InterfaceDeclaration, sourceCode)
        // Include interfaces that are exported or referenced by exported items
        if (interfaceDecl.isExported || shouldIncludeNonExportedInterface(interfaceDecl.name, sourceCode)) {
          declarations.push(interfaceDecl)
        }
        break

      case ts.SyntaxKind.TypeAliasDeclaration:
        declarations.push(extractTypeAliasDeclaration(node as ts.TypeAliasDeclaration, sourceCode))
        break

      case ts.SyntaxKind.ClassDeclaration:
        declarations.push(extractClassDeclaration(node as ts.ClassDeclaration, sourceCode))
        break

      case ts.SyntaxKind.EnumDeclaration:
        declarations.push(extractEnumDeclaration(node as ts.EnumDeclaration, sourceCode))
        break

      case ts.SyntaxKind.ModuleDeclaration:
        declarations.push(extractModuleDeclaration(node as ts.ModuleDeclaration, sourceCode))
        break
    }

    // Continue visiting only top-level child nodes
    ts.forEachChild(node, visitTopLevel)
  }

  visitTopLevel(sourceFile)
  return declarations
}

/**
 * Extract import declaration
 */
function extractImportDeclaration(node: ts.ImportDeclaration, sourceCode: string): Declaration {
  const text = getNodeText(node, sourceCode)
  const isTypeOnly = !!(node.importClause?.isTypeOnly)

  return {
    kind: 'import',
    name: '', // Imports don't have a single name
    text,
    isExported: false,
    isTypeOnly,
    source: node.moduleSpecifier.getText().slice(1, -1), // Remove quotes
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Extract export declaration
 */
function extractExportDeclaration(node: ts.ExportDeclaration, sourceCode: string): Declaration {
  const text = getNodeText(node, sourceCode)
  const isTypeOnly = !!node.isTypeOnly

  return {
    kind: 'export',
    name: '', // Export declarations don't have a single name
    text,
    isExported: true,
    isTypeOnly,
    source: node.moduleSpecifier?.getText().slice(1, -1), // Remove quotes if present
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Extract export assignment (export default)
 */
function extractExportAssignment(node: ts.ExportAssignment, sourceCode: string): Declaration {
  const text = getNodeText(node, sourceCode)

  return {
    kind: 'export',
    name: 'default',
    text,
    isExported: true,
    isTypeOnly: false,
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Extract function declaration with proper signature
 */
function extractFunctionDeclaration(node: ts.FunctionDeclaration, sourceCode: string): Declaration | null {
  if (!node.name) return null // Skip anonymous functions

  const name = node.name.getText()
  const isExported = hasExportModifier(node)
  const isAsync = hasAsyncModifier(node)
  const isGenerator = !!node.asteriskToken

  // Build clean function signature for DTS
  const signature = buildFunctionSignature(node)

  // Extract parameters with types
  const parameters = node.parameters.map(param => ({
    name: param.name.getText(),
    type: param.type?.getText() || 'any',
    optional: !!param.questionToken,
    defaultValue: param.initializer?.getText()
  }))

  // Extract return type
  const returnType = node.type?.getText() || (isAsync ? 'Promise<void>' : 'void')

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  return {
    kind: 'function',
    name,
    text: signature,
    isExported,
    isAsync,
    isGenerator,
    parameters,
    returnType,
    generics: generics ? `<${generics}>` : undefined,
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Build clean function signature for DTS output
 */
function buildFunctionSignature(node: ts.FunctionDeclaration): string {
  let result = ''

  // Add modifiers
  if (hasExportModifier(node)) result += 'export '
  result += 'declare '
  if (node.asteriskToken) result += 'function* '
  else result += 'function '

  // Add name (no space before)
  if (node.name) result += node.name.getText()

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    result += `<${generics}>`
  }

  // Add parameters (no space before)
  const params = node.parameters.map(param => {
    const name = param.name.getText()
    const type = param.type?.getText() || 'any'
    const optional = param.questionToken ? '?' : ''
    return `${name}${optional}: ${type}`
  }).join(', ')
  result += `(${params})`

  // Add return type (no space before colon)
  const returnType = node.type?.getText() || 'void'
  result += `: ${returnType}`

  return result + ';'
}

/**
 * Extract variable statement (only exported ones for DTS)
 */
function extractVariableStatement(node: ts.VariableStatement, sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const isExported = hasExportModifier(node)

  // Only include exported variables in DTS
  if (!isExported) return declarations

  for (const declaration of node.declarationList.declarations) {
    if (!declaration.name || !ts.isIdentifier(declaration.name)) continue

    const name = declaration.name.getText()
    const typeAnnotation = declaration.type?.getText()
    const kind = node.declarationList.flags & ts.NodeFlags.Const ? 'const' :
                 node.declarationList.flags & ts.NodeFlags.Let ? 'let' : 'var'

    // Build clean variable declaration for DTS
    const dtsText = buildVariableDeclaration(name, typeAnnotation, kind, true)

    declarations.push({
      kind: 'variable',
      name,
      text: dtsText,
      isExported: true,
      typeAnnotation,
      modifiers: [kind],
      start: node.getStart(),
      end: node.getEnd()
    })
  }

  return declarations
}

/**
 * Build clean variable declaration for DTS
 */
function buildVariableDeclaration(name: string, type: string | undefined, kind: string, isExported: boolean): string {
  let result = ''

  if (isExported) result += 'export '
  result += 'declare '
  result += kind + ' '
  result += name

  if (type) {
    result += `: ${type}`
  }

  return result + ';'
}

/**
 * Extract interface declaration
 */
function extractInterfaceDeclaration(node: ts.InterfaceDeclaration, sourceCode: string): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)

  // Build clean interface declaration
  const text = buildInterfaceDeclaration(node, isExported)

  // Extract extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === ts.SyntaxKind.ExtendsKeyword
  )?.types.map(type => type.getText()).join(', ')

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  return {
    kind: 'interface',
    name,
    text,
    isExported,
    extends: extendsClause,
    generics: generics ? `<${generics}>` : undefined,
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Build clean interface declaration for DTS
 */
function buildInterfaceDeclaration(node: ts.InterfaceDeclaration, isExported: boolean): string {
  let result = ''

  if (isExported) result += 'export '
  result += 'declare '
  result += 'interface '
  result += node.name.getText()

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    result += `<${generics}>`
  }

  // Add extends
  if (node.heritageClauses) {
    const extendsClause = node.heritageClauses.find(clause =>
      clause.token === ts.SyntaxKind.ExtendsKeyword
    )
    if (extendsClause) {
      const types = extendsClause.types.map(type => type.getText()).join(', ')
      result += ` extends ${types}`
    }
  }

  // Add body (simplified)
  const body = getInterfaceBody(node)
  result += ' ' + body

  return result
}

/**
 * Get interface body with proper formatting
 */
function getInterfaceBody(node: ts.InterfaceDeclaration): string {
  const members: string[] = []

  for (const member of node.members) {
    if (ts.isPropertySignature(member)) {
      const name = member.name?.getText() || ''
      const type = member.type?.getText() || 'any'
      const optional = member.questionToken ? '?' : ''
      members.push(`  ${name}${optional}: ${type}`)
    } else if (ts.isMethodSignature(member)) {
      const name = member.name?.getText() || ''
      const params = member.parameters.map(param => {
        const paramName = param.name.getText()
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText() || 'void'
      members.push(`  ${name}(${params}): ${returnType}`)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Extract type alias declaration
 */
function extractTypeAliasDeclaration(node: ts.TypeAliasDeclaration, sourceCode: string): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)

  // Build clean type declaration
  const text = buildTypeDeclaration(node, isExported)

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  return {
    kind: 'type',
    name,
    text,
    isExported,
    generics: generics ? `<${generics}>` : undefined,
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Build clean type declaration for DTS
 */
function buildTypeDeclaration(node: ts.TypeAliasDeclaration, isExported: boolean): string {
  let result = ''

  if (isExported) result += 'export '
  result += 'type '
  result += node.name.getText()

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    result += `<${generics}>`
  }

  result += ' = '
  result += node.type.getText()

  return result
}

/**
 * Extract class declaration
 */
function extractClassDeclaration(node: ts.ClassDeclaration, sourceCode: string): Declaration {
  const name = node.name?.getText() || 'AnonymousClass'
  const isExported = hasExportModifier(node)
  const text = getNodeText(node, sourceCode)

  // Extract extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === ts.SyntaxKind.ExtendsKeyword
  )?.types[0]?.getText()

  // Extract implements clause
  const implementsClause = node.heritageClauses?.find(clause =>
    clause.token === ts.SyntaxKind.ImplementsKeyword
  )?.types.map(type => type.getText())

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  // Check for abstract modifier
  const isAbstract = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AbstractKeyword)

  return {
    kind: 'class',
    name,
    text,
    isExported,
    extends: extendsClause,
    implements: implementsClause,
    generics: generics ? `<${generics}>` : undefined,
    modifiers: isAbstract ? ['abstract'] : undefined,
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Extract enum declaration
 */
function extractEnumDeclaration(node: ts.EnumDeclaration, sourceCode: string): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)
  const text = getNodeText(node, sourceCode)

  // Check for const modifier
  const isConst = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ConstKeyword)

  return {
    kind: 'enum',
    name,
    text,
    isExported,
    modifiers: isConst ? ['const'] : undefined,
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Extract module/namespace declaration
 */
function extractModuleDeclaration(node: ts.ModuleDeclaration, sourceCode: string): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)
  const text = getNodeText(node, sourceCode)

  // Check if this is an ambient module (quoted name)
  const isAmbient = ts.isStringLiteral(node.name)

  return {
    kind: 'module',
    name,
    text,
    isExported,
    source: isAmbient ? name.slice(1, -1) : undefined, // Remove quotes for ambient modules
    start: node.getStart(),
    end: node.getEnd()
  }
}

/**
 * Get the text of a node from source code
 */
function getNodeText(node: ts.Node, sourceCode: string): string {
  return sourceCode.slice(node.getStart(), node.getEnd())
}

/**
 * Check if a node has export modifier
 */
function hasExportModifier(node: ts.Node): boolean {
  if (!('modifiers' in node) || !node.modifiers) return false
  const modifiers = node.modifiers as readonly ts.Modifier[]
  return modifiers.some((mod: ts.Modifier) => mod.kind === ts.SyntaxKind.ExportKeyword)
}

/**
 * Check if a function has async modifier
 */
function hasAsyncModifier(node: ts.FunctionDeclaration): boolean {
  return node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword) || false
}

/**
 * Check if a non-exported function should be included (e.g., if it's referenced by exported items)
 */
function shouldIncludeNonExportedFunction(functionName: string, sourceCode: string): boolean {
  // For now, don't include non-exported functions
  // In the future, we could analyze if they're referenced by exported functions
  return false
}

/**
 * Check if a non-exported interface should be included (e.g., if it's used by exported items)
 */
function shouldIncludeNonExportedInterface(interfaceName: string, sourceCode: string): boolean {
  // Check if the interface is used in exported function signatures or other exported types
  const exportedFunctionPattern = new RegExp(`export\\s+.*?:\\s*.*?${interfaceName}`, 'g')
  const exportedTypePattern = new RegExp(`export\\s+.*?${interfaceName}`, 'g')

  return exportedFunctionPattern.test(sourceCode) || exportedTypePattern.test(sourceCode)
}

