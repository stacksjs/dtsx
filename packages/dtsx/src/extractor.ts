/* eslint-disable no-case-declarations, regexp/no-contradiction-with-assertion */
import type { ClassDeclaration, EnumDeclaration, ExportAssignment, ExportDeclaration, FunctionDeclaration, ImportDeclaration, InterfaceDeclaration, Modifier, ModuleDeclaration, Node, ParameterDeclaration, SourceFile, TypeAliasDeclaration, VariableStatement } from 'typescript'
import type { Declaration } from './types'
import { createSourceFile, forEachChild, isArrayBindingPattern, isBindingElement, isCallSignatureDeclaration, isConstructorDeclaration, isConstructSignatureDeclaration, isEnumDeclaration, isEnumMember, isExportAssignment, isFunctionDeclaration, isIdentifier, isInterfaceDeclaration, isMethodDeclaration, isMethodSignature, isModuleBlock, isModuleDeclaration, isObjectBindingPattern, isPropertyDeclaration, isPropertySignature, isStringLiteral, isTypeAliasDeclaration, isVariableStatement, NodeFlags, ScriptKind, ScriptTarget, SyntaxKind } from 'typescript'

/**
 * Extract only public API declarations from TypeScript source code
 * This focuses on what should be in .d.ts files, not implementation details
 */
export function extractDeclarations(sourceCode: string, filePath: string, keepComments: boolean = true): Declaration[] {
  const declarations: Declaration[] = []

  // Create TypeScript source file
  const sourceFile = createSourceFile(
    filePath,
    sourceCode,
    ScriptTarget.Latest,
    true,
    ScriptKind.TS,
  )

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

      case SyntaxKind.FunctionDeclaration:
        const funcDecl = extractFunctionDeclaration(node as FunctionDeclaration, sourceCode, sourceFile, keepComments)
        // Only include exported functions or functions that are referenced by exported items
        if (funcDecl && (funcDecl.isExported || shouldIncludeNonExportedFunction(funcDecl.name, sourceCode))) {
          declarations.push(funcDecl)
        }
        break

      case SyntaxKind.VariableStatement:
        const varDecls = extractVariableStatement(node as VariableStatement, sourceCode, sourceFile, keepComments)
        declarations.push(...varDecls)
        break

      case SyntaxKind.InterfaceDeclaration:
        const interfaceDecl = extractInterfaceDeclaration(node as InterfaceDeclaration, sourceCode, sourceFile, keepComments)
        // Include interfaces that are exported or referenced by exported items
        if (interfaceDecl.isExported || shouldIncludeNonExportedInterface(interfaceDecl.name, sourceCode)) {
          declarations.push(interfaceDecl)
        }
        break

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
 * Extract import declaration
 */
function extractImportDeclaration(node: ImportDeclaration, sourceCode: string): Declaration {
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
    end: node.getEnd(),
  }
}

/**
 * Extract export declaration
 */
function extractExportDeclaration(node: ExportDeclaration, sourceCode: string): Declaration {
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
function extractExportAssignment(node: ExportAssignment, sourceCode: string): Declaration {
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
function extractFunctionDeclaration(node: FunctionDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration | null {
  if (!node.name)
    return null // Skip anonymous functions

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

  // Extract return type
  const returnType = node.type?.getText() || (isAsync ? 'Promise<void>' : 'void')

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
 * Build clean function signature for DTS output
 */
function buildFunctionSignature(node: FunctionDeclaration): string {
  let result = ''

  // Add modifiers
  if (hasExportModifier(node))
    result += 'export '
  result += 'declare '
  // Note: Generator functions in declaration files should not have the asterisk
  result += 'function '

  // Add name (no space before)
  if (node.name)
    result += node.name.getText()

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    result += `<${generics}>`
  }

  // Add parameters (no space before)
  const params = node.parameters.map((param) => {
    const name = getParameterName(param)
    const type = param.type?.getText() || 'any'
    const optional = param.questionToken || param.initializer ? '?' : ''
    const isRest = !!param.dotDotDotToken

    if (isRest) {
      return `...${name}: ${type}`
    }
    return `${name}${optional}: ${type}`
  }).join(', ')
  result += `(${params})`

  // Add return type (no space before colon)
  const returnType = node.type?.getText() || 'void'
  result += `: ${returnType}`

  return `${result};`
}

/**
 * Extract variable statement (only exported ones for DTS)
 */
function extractVariableStatement(node: VariableStatement, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration[] {
  const declarations: Declaration[] = []
  const isExported = hasExportModifier(node)

  // Only include exported variables in DTS
  if (!isExported)
    return declarations

  for (const declaration of node.declarationList.declarations) {
    if (!declaration.name || !isIdentifier(declaration.name))
      continue

    const name = declaration.name.getText()
    const typeAnnotation = declaration.type?.getText()
    const initializer = declaration.initializer?.getText()
    const kind = node.declarationList.flags & NodeFlags.Const
      ? 'const'
      : node.declarationList.flags & NodeFlags.Let ? 'let' : 'var'

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
      value: initializer,
      modifiers: [kind],
      leadingComments,
      start: node.getStart(),
      end: node.getEnd(),
    })
  }

  return declarations
}

/**
 * Build clean variable declaration for DTS
 */
function buildVariableDeclaration(name: string, type: string | undefined, kind: string, isExported: boolean): string {
  let result = ''

  if (isExported)
    result += 'export '
  result += 'declare '
  result += `${kind} `
  result += name

  if (type) {
    result += `: ${type}`
  }

  return `${result};`
}

/**
 * Extract interface declaration
 */
function extractInterfaceDeclaration(node: InterfaceDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
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
 * Build clean interface declaration for DTS
 */
function buildInterfaceDeclaration(node: InterfaceDeclaration, isExported: boolean): string {
  let result = ''

  if (isExported)
    result += 'export '
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
      clause.token === SyntaxKind.ExtendsKeyword,
    )
    if (extendsClause) {
      const types = extendsClause.types.map(type => type.getText()).join(', ')
      result += ` extends ${types}`
    }
  }

  // Add body (simplified)
  const body = getInterfaceBody(node)
  result += ` ${body}`

  return result
}

/**
 * Get interface body with proper formatting
 */
function getInterfaceBody(node: InterfaceDeclaration): string {
  const members: string[] = []

  for (const member of node.members) {
    if (isPropertySignature(member)) {
      const name = member.name?.getText() || ''
      const type = member.type?.getText() || 'any'
      const optional = member.questionToken ? '?' : ''
      members.push(`  ${name}${optional}: ${type}`)
    }
    else if (isMethodSignature(member)) {
      const name = member.name?.getText() || ''
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText()
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken ? '?' : ''
        const isRest = !!param.dotDotDotToken

        if (isRest) {
          return `...${paramName}: ${paramType}`
        }
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText() || 'void'
      members.push(`  ${name}(${params}): ${returnType}`)
    }
    else if (isCallSignatureDeclaration(member)) {
      // Call signature: (param: type) => returnType
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText()
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken ? '?' : ''
        const isRest = !!param.dotDotDotToken

        if (isRest) {
          return `...${paramName}: ${paramType}`
        }
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText() || 'void'
      members.push(`  (${params}): ${returnType}`)
    }
    else if (isConstructSignatureDeclaration(member)) {
      // Constructor signature: new (param: type) => returnType
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText()
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken ? '?' : ''
        const isRest = !!param.dotDotDotToken

        if (isRest) {
          return `...${paramName}: ${paramType}`
        }
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText() || 'any'
      members.push(`  new (${params}): ${returnType}`)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Extract type alias declaration
 */
function extractTypeAliasDeclaration(node: TypeAliasDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
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
 * Build clean type declaration for DTS
 */
function buildTypeDeclaration(node: TypeAliasDeclaration, isExported: boolean): string {
  let result = ''

  if (isExported)
    result += 'export '
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
function extractClassDeclaration(node: ClassDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
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
 * Build clean class declaration for DTS
 */
function buildClassDeclaration(node: ClassDeclaration, isExported: boolean): string {
  let result = ''

  // Add export if needed
  if (isExported)
    result += 'export '
  result += 'declare '

  // Add abstract modifier if present
  const isAbstract = node.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword)
  if (isAbstract)
    result += 'abstract '

  result += 'class '
  result += node.name?.getText() || 'AnonymousClass'

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    result += `<${generics}>`
  }

  // Add extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ExtendsKeyword,
  )?.types[0]?.getText()
  if (extendsClause) {
    result += ` extends ${extendsClause}`
  }

  // Add implements clause
  const implementsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ImplementsKeyword,
  )?.types.map(type => type.getText())
  if (implementsClause && implementsClause.length > 0) {
    result += ` implements ${implementsClause.join(', ')}`
  }

  // Build class body with only signatures
  result += ` ${buildClassBody(node)}`

  return result
}

/**
 * Build clean class body for DTS (signatures only, no implementations)
 */
function buildClassBody(node: ClassDeclaration): string {
  const members: string[] = []

  for (const member of node.members) {
    if (isConstructorDeclaration(member)) {
      // First, add property declarations for parameter properties
      for (const param of member.parameters) {
        if (param.modifiers && param.modifiers.length > 0) {
          // This is a parameter property, add it as a separate property declaration
          const name = getParameterName(param)
          const type = param.type?.getText() || 'any'
          const optional = param.questionToken || param.initializer ? '?' : ''

          let modifiers = ''
          if (param.modifiers) {
            const modifierTexts = param.modifiers.map(mod => mod.getText()).join(' ')
            if (modifierTexts)
              modifiers = `${modifierTexts} `
          }

          members.push(`  ${modifiers}${name}${optional}: ${type};`)
        }
      }

      // Then add constructor signature without parameter properties
      const params = member.parameters.map((param) => {
        const name = getParameterName(param)
        const type = param.type?.getText() || 'any'
        const optional = param.questionToken || param.initializer ? '?' : ''

        // Don't include access modifiers in constructor signature for DTS
        return `${name}${optional}: ${type}`
      }).join(', ')

      members.push(`  constructor(${params});`)
    }
    else if (isMethodDeclaration(member)) {
      // Method signature without implementation
      const name = member.name?.getText() || ''
      const isStatic = member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword)
      const isPrivate = member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
      const isProtected = member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword)
      const isAbstract = member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword)

      let signature = '  '
      if (isStatic)
        signature += 'static '
      if (isAbstract)
        signature += 'abstract '
      if (isPrivate)
        signature += 'private '
      else if (isProtected)
        signature += 'protected '

      signature += name

      // Add generics
      if (member.typeParameters) {
        const generics = member.typeParameters.map(tp => tp.getText()).join(', ')
        signature += `<${generics}>`
      }

      // Add parameters
      const params = member.parameters.map((param) => {
        const paramName = getParameterName(param)
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      signature += `(${params})`

      // Add return type
      const returnType = member.type?.getText() || 'void'
      signature += `: ${returnType};`

      members.push(signature)
    }
    else if (isPropertyDeclaration(member)) {
      // Property declaration
      const name = member.name?.getText() || ''
      const isStatic = member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword)
      const isReadonly = member.modifiers?.some(mod => mod.kind === SyntaxKind.ReadonlyKeyword)
      const isPrivate = member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
      const isProtected = member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword)
      const isAbstract = member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword)

      let signature = '  '
      if (isStatic)
        signature += 'static '
      if (isAbstract)
        signature += 'abstract '
      if (isReadonly)
        signature += 'readonly '
      if (isPrivate)
        signature += 'private '
      else if (isProtected)
        signature += 'protected '

      signature += name

      const optional = member.questionToken ? '?' : ''
      signature += optional

      const type = member.type?.getText() || 'any'
      signature += `: ${type};`

      members.push(signature)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Extract enum declaration
 */
function extractEnumDeclaration(node: EnumDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
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
function extractModuleDeclaration(node: ModuleDeclaration, sourceCode: string, sourceFile: SourceFile, keepComments: boolean): Declaration {
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
 * Build clean module declaration for DTS
 */
function buildModuleDeclaration(node: ModuleDeclaration, isExported: boolean): string {
  let result = ''

  // Add export if needed
  if (isExported) {
    result += 'export '
  }

  // Add declare keyword
  result += 'declare '

  // Check if this is a namespace or module
  const isNamespace = node.flags & NodeFlags.Namespace
  if (isNamespace) {
    result += 'namespace '
  }
  else {
    result += 'module '
  }

  // Add module name
  result += node.name.getText()

  // Build module body with only signatures
  result += ` ${buildModuleBody(node)}`

  return result
}

/**
 * Build clean module body for DTS (signatures only, no implementations)
 */
function buildModuleBody(node: ModuleDeclaration): string {
  if (!node.body)
    return '{}'

  const members: string[] = []

  function processModuleElement(element: Node) {
    if (isFunctionDeclaration(element)) {
      // Function signature without implementation (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name?.getText() || ''

      let signature = '  '
      if (isExported)
        signature += 'export '
      signature += 'function '
      signature += name

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText()).join(', ')
        signature += `<${generics}>`
      }

      // Add parameters
      const params = element.parameters.map((param) => {
        const paramName = getParameterName(param)
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      signature += `(${params})`

      // Add return type
      const returnType = element.type?.getText() || 'void'
      signature += `: ${returnType};`

      members.push(signature)
    }
    else if (isVariableStatement(element)) {
      // Variable declarations
      const isExported = hasExportModifier(element)
      for (const declaration of element.declarationList.declarations) {
        if (declaration.name && isIdentifier(declaration.name)) {
          const name = declaration.name.getText()
          const typeAnnotation = declaration.type?.getText()
          const initializer = declaration.initializer?.getText()
          const kind = element.declarationList.flags & NodeFlags.Const
            ? 'const'
            : element.declarationList.flags & NodeFlags.Let ? 'let' : 'var'

          let varDecl = '  '
          if (isExported)
            varDecl += 'export '
          varDecl += `${kind} `
          varDecl += name

          // Use type annotation if available, otherwise infer from initializer
          if (typeAnnotation) {
            varDecl += `: ${typeAnnotation}`
          }
          else if (initializer) {
            // Simple type inference for common cases
            if (initializer.startsWith('\'') || initializer.startsWith('"') || initializer.startsWith('`')) {
              varDecl += ': string'
            }
            else if (/^\d+$/.test(initializer)) {
              varDecl += ': number'
            }
            else if (initializer === 'true' || initializer === 'false') {
              varDecl += ': boolean'
            }
            else {
              varDecl += ': any'
            }
          }
          else {
            varDecl += ': any'
          }

          varDecl += ';'
          members.push(varDecl)
        }
      }
    }
    else if (isInterfaceDeclaration(element)) {
      // Interface declaration (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText()

      let interfaceDecl = '  '
      if (isExported)
        interfaceDecl += 'export '
      interfaceDecl += 'interface '
      interfaceDecl += name

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText()).join(', ')
        interfaceDecl += `<${generics}>`
      }

      // Add extends
      if (element.heritageClauses) {
        const extendsClause = element.heritageClauses.find(clause =>
          clause.token === SyntaxKind.ExtendsKeyword,
        )
        if (extendsClause) {
          const types = extendsClause.types.map(type => type.getText()).join(', ')
          interfaceDecl += ` extends ${types}`
        }
      }

      // Add body
      const body = getInterfaceBody(element)
      interfaceDecl += ` ${body}`

      members.push(interfaceDecl)
    }
    else if (isTypeAliasDeclaration(element)) {
      // Type alias declaration (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText()

      let typeDecl = '  '
      if (isExported)
        typeDecl += 'export '
      typeDecl += 'type '
      typeDecl += name

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText()).join(', ')
        typeDecl += `<${generics}>`
      }

      typeDecl += ' = '
      typeDecl += element.type.getText()

      members.push(typeDecl)
    }
    else if (isEnumDeclaration(element)) {
      // Enum declaration
      const isExported = hasExportModifier(element)
      const name = element.name.getText()
      const isConst = element.modifiers?.some(mod => mod.kind === SyntaxKind.ConstKeyword)

      let enumDecl = '  '
      if (isExported)
        enumDecl += 'export '
      if (isConst)
        enumDecl += 'const '
      enumDecl += 'enum '
      enumDecl += name

      // Build enum body
      const enumMembers: string[] = []
      for (const member of element.members) {
        if (isEnumMember(member)) {
          const memberName = member.name.getText()
          if (member.initializer) {
            const value = member.initializer.getText()
            enumMembers.push(`    ${memberName} = ${value}`)
          }
          else {
            enumMembers.push(`    ${memberName}`)
          }
        }
      }

      enumDecl += ` {\n${enumMembers.join(',\n')}\n  }`
      members.push(enumDecl)
    }
    else if (isModuleDeclaration(element)) {
      // Nested namespace/module (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText()

      let nestedDecl = '  '
      if (isExported)
        nestedDecl += 'export '

      // Check if this is a namespace or module
      const isNamespace = element.flags & NodeFlags.Namespace
      if (isNamespace) {
        nestedDecl += 'namespace '
      }
      else {
        nestedDecl += 'module '
      }

      nestedDecl += name
      nestedDecl += ` ${buildModuleBody(element)}`

      members.push(nestedDecl)
    }
    else if (isExportAssignment(element)) {
      // Export default statement
      let exportDecl = '  export default '
      if (element.expression) {
        exportDecl += element.expression.getText()
      }
      exportDecl += ';'
      members.push(exportDecl)
    }
  }

  if (isModuleBlock(node.body)) {
    // Module block with statements
    for (const statement of node.body.statements) {
      processModuleElement(statement)
    }
  }
  else if (isModuleDeclaration(node.body)) {
    // Nested module
    processModuleElement(node.body)
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Get the text of a node from source code
 */
function getNodeText(node: Node, sourceCode: string): string {
  return sourceCode.slice(node.getStart(), node.getEnd())
}

/**
 * Extract JSDoc comments from a node
 */
function extractJSDocComments(node: Node, sourceFile: SourceFile): string[] {
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
function getParameterName(param: ParameterDeclaration): string {
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
function hasExportModifier(node: Node): boolean {
  if (!('modifiers' in node) || !node.modifiers)
    return false
  const modifiers = node.modifiers as readonly Modifier[]
  return modifiers.some((mod: Modifier) => mod.kind === SyntaxKind.ExportKeyword)
}

/**
 * Check if a function has async modifier
 */
function hasAsyncModifier(node: FunctionDeclaration): boolean {
  return node.modifiers?.some(mod => mod.kind === SyntaxKind.AsyncKeyword) || false
}

/**
 * Check if a non-exported function should be included (e.g., if it's referenced by exported items)
 */
function shouldIncludeNonExportedFunction(_functionName?: string, _sourceCode?: string): boolean {
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

/**
 * Find types that are referenced in declarations but not imported or declared
 */
function findReferencedTypes(declarations: Declaration[], _sourceCode: string): Set<string> {
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
function extractReferencedTypeDeclarations(sourceFile: SourceFile, referencedTypes: Set<string>, sourceCode: string): Declaration[] {
  const additionalDeclarations: Declaration[] = []

  if (referencedTypes.size === 0) {
    return additionalDeclarations
  }

  // Visit all nodes in the source file to find interface/type/class/enum declarations
  function visitAllNodes(node: Node) {
    switch (node.kind) {
      case SyntaxKind.InterfaceDeclaration:
        const interfaceNode = node as InterfaceDeclaration
        const interfaceName = interfaceNode.name.getText()
        if (referencedTypes.has(interfaceName)) {
          const decl = extractInterfaceDeclaration(interfaceNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
          additionalDeclarations.push(decl)
          referencedTypes.delete(interfaceName) // Remove to avoid duplicates
        }
        break

      case SyntaxKind.TypeAliasDeclaration:
        const typeNode = node as TypeAliasDeclaration
        const typeName = typeNode.name.getText()
        if (referencedTypes.has(typeName)) {
          const decl = extractTypeAliasDeclaration(typeNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
          additionalDeclarations.push(decl)
          referencedTypes.delete(typeName)
        }
        break

      case SyntaxKind.ClassDeclaration:
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

      case SyntaxKind.EnumDeclaration:
        const enumNode = node as EnumDeclaration
        const enumName = enumNode.name.getText()
        if (referencedTypes.has(enumName)) {
          const decl = extractEnumDeclaration(enumNode, sourceCode, sourceFile, false) // Don't extract comments for referenced types
          additionalDeclarations.push(decl)
          referencedTypes.delete(enumName)
        }
        break
    }

    // Continue visiting child nodes
    forEachChild(node, visitAllNodes)
  }

  visitAllNodes(sourceFile)
  return additionalDeclarations
}

/**
 * Extract type names from module/namespace text
 */
function extractTypesFromModuleText(moduleText: string): string[] {
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

/**
 * Check if a type is a built-in TypeScript type
 */
function isBuiltInType(typeName: string): boolean {
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
