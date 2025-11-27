/**
 * Declaration extraction functions
 */

import type { ClassDeclaration, EnumDeclaration, ExportAssignment, ExportDeclaration, FunctionDeclaration, ImportDeclaration, InterfaceDeclaration, ModuleDeclaration, SourceFile, TypeAliasDeclaration, VariableStatement } from 'typescript'
import type { Declaration } from '../types'
import { forEachChild, isAsExpression, isFunctionDeclaration, isIdentifier, isStringLiteral, NodeFlags, SyntaxKind } from 'typescript'
import { buildClassDeclaration, buildFunctionSignature, buildInterfaceDeclaration, buildModuleDeclaration, buildTypeDeclaration, buildVariableDeclaration } from './builders'
import { extractJSDocComments, extractTypesFromModuleText, getNodeText, hasAsyncModifier, hasExportModifier, isBuiltInType } from './helpers'

/**
 * Extract import declaration
 */
export function extractImportDeclaration(node: ImportDeclaration, sourceCode: string): Declaration {
  const text = getNodeText(node, sourceCode)
  const isTypeOnly = !!(node.importClause?.isTypeOnly)

  // Detect side-effect imports (no import clause, e.g., `import 'module'`)
  const isSideEffectImport = !node.importClause

  return {
    kind: 'import',
    name: '', // Imports don't have a single name
    text,
    isExported: false,
    isTypeOnly,
    isSideEffect: isSideEffectImport,
    source: node.moduleSpecifier.getText().slice(1, -1), // Remove quotes
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Extract export declaration
 */
export function extractExportDeclaration(node: ExportDeclaration, sourceCode: string): Declaration {
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
    end: node.getEnd(),
  }
}

/**
 * Extract export assignment (export default)
 */
export function extractExportAssignment(node: ExportAssignment, sourceCode: string): Declaration {
  const text = getNodeText(node, sourceCode)

  return {
    kind: 'export',
    name: 'default',
    text,
    isExported: true,
    isTypeOnly: false,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Extract function declaration with proper signature
 */
export function extractFunctionDeclaration(node: FunctionDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration | null {
  if (!node.name)
    return null // Skip anonymous functions

  // Skip implementation signatures for overloaded functions
  // In TypeScript, overload declarations have no body, only the implementation does
  // If this function has a body and there are overload declarations with the same name,
  // we should skip it (only emit the overload declarations)
  if (node.body) {
    // This is an implementation signature - check if there are overload declarations
    const funcName = node.name.getText()
    let hasOverloads = false

    // Look through sibling nodes for overload declarations
    forEachChild(sourceFile, (sibling) => {
      if (isFunctionDeclaration(sibling)
        && sibling !== node
        && sibling.name?.getText() === funcName
        && !sibling.body) {
        hasOverloads = true
      }
    })

    if (hasOverloads) {
      return null // Skip implementation, only overload declarations will be emitted
    }
  }

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
    defaultValue: param.initializer?.getText(),
  }))

  // Extract return type with proper handling for async generators and type predicates
  let returnType = node.type?.getText()
  if (!returnType) {
    if (isAsync && isGenerator) {
      // async function* returns AsyncGenerator
      returnType = 'AsyncGenerator<unknown, void, unknown>'
    }
    else if (isGenerator) {
      // function* returns Generator
      returnType = 'Generator<unknown, void, unknown>'
    }
    else if (isAsync) {
      returnType = 'Promise<void>'
    }
    else {
      returnType = 'void'
    }
  }

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  // Extract comments if enabled
  const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

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
    leadingComments,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Check if an expression is an 'as const' assertion
 */
function isAsConstAssertion(node: import('typescript').Expression): boolean {
  if (isAsExpression(node)) {
    const typeNode = node.type
    // Check if it's 'as const'
    if (typeNode.kind === SyntaxKind.TypeReference) {
      const text = typeNode.getText()
      return text === 'const'
    }
  }
  return false
}

/**
 * Get the underlying expression from an 'as const' assertion
 */
function _getAsConstValue(node: import('typescript').Expression): import('typescript').Expression | null {
  if (isAsExpression(node) && isAsConstAssertion(node)) {
    return node.expression
  }
  return null
}

/**
 * Infer a literal type from a value for 'as const' declarations
 * This creates readonly types for objects and arrays
 */
function inferAsConstType(expression: import('typescript').Expression): string {
  const text = expression.getText()

  // For object literals, convert to readonly type
  if (expression.kind === SyntaxKind.ObjectLiteralExpression) {
    // Return typeof with const assertion
    return `typeof ${text} as const`
  }

  // For array literals, create readonly tuple
  if (expression.kind === SyntaxKind.ArrayLiteralExpression) {
    return `readonly ${text}`
  }

  // For string/number/boolean literals, return literal type
  if (expression.kind === SyntaxKind.StringLiteral) {
    return text // Already includes quotes
  }
  if (expression.kind === SyntaxKind.NumericLiteral) {
    return text
  }
  if (expression.kind === SyntaxKind.TrueKeyword || expression.kind === SyntaxKind.FalseKeyword) {
    return text
  }

  // Fallback to typeof
  return `typeof ${text}`
}

/**
 * Extract variable statement (only exported ones for DTS)
 */
export function extractVariableStatement(node: VariableStatement, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration[] {
  const declarations: Declaration[] = []
  const isExported = hasExportModifier(node)

  // Only include exported variables in DTS
  if (!isExported)
    return declarations

  for (const declaration of node.declarationList.declarations) {
    if (!declaration.name || !isIdentifier(declaration.name))
      continue

    const name = declaration.name.getText()
    let typeAnnotation = declaration.type?.getText()
    const initializer = declaration.initializer
    const initializerText = initializer?.getText()
    const kind = node.declarationList.flags & NodeFlags.Const
      ? 'const'
      : node.declarationList.flags & NodeFlags.Let ? 'let' : 'var'

    // Check for 'as const' assertion
    let isAsConst = false
    if (initializer && isAsExpression(initializer)) {
      const typeText = initializer.type.getText()
      if (typeText === 'const') {
        isAsConst = true
        // For 'as const', we need to preserve the literal type
        const valueExpr = initializer.expression
        if (!typeAnnotation) {
          typeAnnotation = inferAsConstType(valueExpr)
        }
      }
    }

    // Build clean variable declaration for DTS
    const dtsText = buildVariableDeclaration(name, typeAnnotation, kind, true)

    // Extract comments if enabled
    const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

    declarations.push({
      kind: 'variable',
      name,
      text: dtsText,
      isExported: true,
      typeAnnotation,
      value: initializerText,
      modifiers: isAsConst ? [kind, 'const assertion'] : [kind],
      leadingComments,
      start: node.getStart(),
      end: node.getEnd(),
    })
  }

  return declarations
}

/**
 * Extract interface declaration
 */
export function extractInterfaceDeclaration(node: InterfaceDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)

  // Build clean interface declaration
  const text = buildInterfaceDeclaration(node, isExported)

  // Extract extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ExtendsKeyword,
  )?.types.map(type => type.getText()).join(', ')

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  // Extract comments if enabled
  const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

  return {
    kind: 'interface',
    name,
    text,
    isExported,
    extends: extendsClause,
    generics: generics ? `<${generics}>` : undefined,
    leadingComments,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Extract type alias declaration
 */
export function extractTypeAliasDeclaration(node: TypeAliasDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)

  // Build clean type declaration
  const text = buildTypeDeclaration(node, isExported)

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  // Extract comments if enabled
  const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

  return {
    kind: 'type',
    name,
    text,
    isExported,
    generics: generics ? `<${generics}>` : undefined,
    leadingComments,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Extract class declaration
 */
export function extractClassDeclaration(node: ClassDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
  const name = node.name?.getText() || 'AnonymousClass'
  const isExported = hasExportModifier(node)

  // Build clean class declaration for DTS
  const text = buildClassDeclaration(node, isExported)

  // Extract extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ExtendsKeyword,
  )?.types[0]?.getText()

  // Extract implements clause
  const implementsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ImplementsKeyword,
  )?.types.map(type => type.getText())

  // Extract generics
  const generics = node.typeParameters?.map(tp => tp.getText()).join(', ')

  // Check for abstract modifier
  const isAbstract = node.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword)

  // Extract comments if enabled
  const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

  return {
    kind: 'class',
    name,
    text,
    isExported,
    extends: extendsClause,
    implements: implementsClause,
    generics: generics ? `<${generics}>` : undefined,
    modifiers: isAbstract ? ['abstract'] : undefined,
    leadingComments,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Extract enum declaration
 */
export function extractEnumDeclaration(node: EnumDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)
  const text = getNodeText(node, sourceCode)

  // Check for const modifier
  const isConst = node.modifiers?.some(mod => mod.kind === SyntaxKind.ConstKeyword)

  // Extract comments if enabled
  const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

  return {
    kind: 'enum',
    name,
    text,
    isExported,
    modifiers: isConst ? ['const'] : undefined,
    leadingComments,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Extract module/namespace declaration
 */
export function extractModuleDeclaration(node: ModuleDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
  const name = node.name.getText()
  const isExported = hasExportModifier(node)

  // Build clean module declaration for DTS
  const text = buildModuleDeclaration(node, isExported)

  // Check if this is an ambient module (quoted name)
  const isAmbient = isStringLiteral(node.name)

  // Extract comments if enabled
  const leadingComments = keepComments ? extractJSDocComments(node, sourceFile) : undefined

  return {
    kind: 'module',
    name,
    text,
    isExported,
    source: isAmbient ? name.slice(1, -1) : undefined, // Remove quotes for ambient modules
    leadingComments,
    start: node.getStart(),
    end: node.getEnd(),
  }
}

/**
 * Find types that are referenced in declarations but not imported or declared
 */
export function findReferencedTypes(declarations: Declaration[], _sourceCode: string): Set<string> {
  const referencedTypes = new Set<string>()
  const importedTypes = new Set<string>()
  const declaredTypes = new Set<string>()

  // Collect imported types
  for (const decl of declarations) {
    if (decl.kind === 'import') {
      // Extract imported type names from import statements
      const importMatches = decl.text.match(/import\s+(?:type\s+)?\{([^}]+)\}/g)
      if (importMatches) {
        for (const match of importMatches) {
          const items = match.replace(/import\s+(?:type\s+)?\{([^}]+)\}/, '$1').split(',')
          for (const item of items) {
            const cleanItem = item.replace(/^type\s+/, '').trim()
            importedTypes.add(cleanItem)
          }
        }
      }
    }
  }

  // Collect declared types (including those within modules/namespaces)
  for (const decl of declarations) {
    if (['interface', 'type', 'class', 'enum'].includes(decl.kind)) {
      declaredTypes.add(decl.name)
    }
    // Also scan module/namespace bodies for declared types
    if (decl.kind === 'module') {
      const moduleTypes = extractTypesFromModuleText(decl.text)
      moduleTypes.forEach((type: string) => declaredTypes.add(type))
    }
  }

  // Find referenced types in declaration texts
  for (const decl of declarations) {
    if (decl.kind !== 'import' && decl.kind !== 'export') {
      // Look for type references in the declaration text
      const typeReferences = decl.text.match(/:\s*([A-Z][a-zA-Z0-9]*)/g) || []
      for (const ref of typeReferences) {
        const typeName = ref.replace(/:\s*/, '')
        // Only add if it's not imported, not declared, and not a built-in type
        if (!importedTypes.has(typeName) && !declaredTypes.has(typeName) && !isBuiltInType(typeName)) {
          referencedTypes.add(typeName)
        }
      }
    }
  }

  return referencedTypes
}

/**
 * Extract declarations for referenced types by searching the entire source file
 */
export function extractReferencedTypeDeclarations(sourceFile: SourceFile, referencedTypes: Set<string>, sourceCode: string): Declaration[] {
  const additionalDeclarations: Declaration[] = []

  if (referencedTypes.size === 0) {
    return additionalDeclarations
  }

  // Visit all nodes in the source file to find interface/type/class/enum declarations
  function visitAllNodes(node: import('typescript').Node) {
    switch (node.kind) {
      case SyntaxKind.InterfaceDeclaration: {
        const interfaceNode = node as InterfaceDeclaration
        const interfaceName = interfaceNode.name.getText()
        if (referencedTypes.has(interfaceName)) {
          const decl = extractInterfaceDeclaration(interfaceNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
          additionalDeclarations.push(decl)
          referencedTypes.delete(interfaceName) // Remove to avoid duplicates
        }
        break
      }

      case SyntaxKind.TypeAliasDeclaration: {
        const typeNode = node as TypeAliasDeclaration
        const typeName = typeNode.name.getText()
        if (referencedTypes.has(typeName)) {
          const decl = extractTypeAliasDeclaration(typeNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
          additionalDeclarations.push(decl)
          referencedTypes.delete(typeName)
        }
        break
      }

      case SyntaxKind.ClassDeclaration: {
        const classNode = node as ClassDeclaration
        if (classNode.name) {
          const className = classNode.name.getText()
          if (referencedTypes.has(className)) {
            const decl = extractClassDeclaration(classNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
            additionalDeclarations.push(decl)
            referencedTypes.delete(className)
          }
        }
        break
      }

      case SyntaxKind.EnumDeclaration: {
        const enumNode = node as EnumDeclaration
        const enumName = enumNode.name.getText()
        if (referencedTypes.has(enumName)) {
          const decl = extractEnumDeclaration(enumNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
          additionalDeclarations.push(decl)
          referencedTypes.delete(enumName)
        }
        break
      }
    }

    // Continue visiting child nodes
    forEachChild(node, visitAllNodes)
  }

  visitAllNodes(sourceFile)
  return additionalDeclarations
}
