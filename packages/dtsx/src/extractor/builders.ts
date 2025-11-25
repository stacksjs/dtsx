/**
 * Builder functions for DTS output
 */

import type { ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, ModuleDeclaration, Node, TypeAliasDeclaration, VariableStatement } from 'typescript'
import { forEachChild, isCallSignatureDeclaration, isConstructorDeclaration, isConstructSignatureDeclaration, isEnumDeclaration, isEnumMember, isExportAssignment, isFunctionDeclaration, isGetAccessorDeclaration, isIdentifier, isIndexSignatureDeclaration, isInterfaceDeclaration, isMethodDeclaration, isMethodSignature, isModuleBlock, isModuleDeclaration, isPropertyDeclaration, isPropertySignature, isSetAccessorDeclaration, isTypeAliasDeclaration, isVariableStatement, NodeFlags, SyntaxKind } from 'typescript'
import { getParameterName, hasExportModifier } from './helpers'

/**
 * Build clean function signature for DTS output
 */
export function buildFunctionSignature(node: FunctionDeclaration): string {
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
 * Build clean variable declaration for DTS
 */
export function buildVariableDeclaration(name: string, type: string | undefined, kind: string, isExported: boolean): string {
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
 * Build clean interface declaration for DTS
 */
export function buildInterfaceDeclaration(node: InterfaceDeclaration, isExported: boolean): string {
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
export function getInterfaceBody(node: InterfaceDeclaration): string {
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
    else if (isIndexSignatureDeclaration(member)) {
      // Index signature: [key: string]: T or [index: number]: T
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText()
        const paramType = param.type?.getText() || 'any'
        return `${paramName}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText() || 'any'
      members.push(`  [${params}]: ${returnType}`)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Build clean type declaration for DTS
 */
export function buildTypeDeclaration(node: TypeAliasDeclaration, isExported: boolean): string {
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
 * Build clean class declaration for DTS
 */
export function buildClassDeclaration(node: ClassDeclaration, isExported: boolean): string {
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
export function buildClassBody(node: ClassDeclaration): string {
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
    else if (isGetAccessorDeclaration(member)) {
      // Get accessor declaration
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

      const returnType = member.type?.getText() || 'any'
      signature += `get ${name}(): ${returnType};`

      members.push(signature)
    }
    else if (isSetAccessorDeclaration(member)) {
      // Set accessor declaration
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

      // Get parameter type from the setter's parameter
      const param = member.parameters[0]
      const paramType = param?.type?.getText() || 'any'
      const paramName = param?.name?.getText() || 'value'

      signature += `set ${name}(${paramName}: ${paramType});`

      members.push(signature)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Build clean module declaration for DTS
 */
export function buildModuleDeclaration(node: ModuleDeclaration, isExported: boolean): string {
  let result = ''

  // Check if this is a global augmentation (declare global { ... })
  const isGlobalAugmentation = node.flags & NodeFlags.GlobalAugmentation

  if (isGlobalAugmentation) {
    // Global augmentation - output as "declare global"
    result = 'declare global'
    result += ` ${buildModuleBody(node)}`
    return result
  }

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
export function buildModuleBody(node: ModuleDeclaration): string {
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
      for (const declaration of (element as VariableStatement).declarationList.declarations) {
        if (declaration.name && isIdentifier(declaration.name)) {
          const name = declaration.name.getText()
          const typeAnnotation = declaration.type?.getText()
          const initializer = declaration.initializer?.getText()
          const kind = (element as VariableStatement).declarationList.flags & NodeFlags.Const
            ? 'const'
            : (element as VariableStatement).declarationList.flags & NodeFlags.Let ? 'let' : 'var'

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
