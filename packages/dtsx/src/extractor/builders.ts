/**
 * Builder functions for DTS output
 */

import type { ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, ModuleDeclaration, Node, TypeAliasDeclaration, VariableStatement } from 'typescript'
import { forEachChild, isCallSignatureDeclaration, isComputedPropertyName, isConstructorDeclaration, isConstructSignatureDeclaration, isEnumDeclaration, isEnumMember, isExportAssignment, isFunctionDeclaration, isGetAccessorDeclaration, isIdentifier, isIndexSignatureDeclaration, isInterfaceDeclaration, isMethodDeclaration, isMethodSignature, isModuleBlock, isModuleDeclaration, isPrivateIdentifier, isPropertyDeclaration, isPropertySignature, isSetAccessorDeclaration, isTypeAliasDeclaration, isVariableStatement, NodeFlags, SyntaxKind } from 'typescript'
import { getParameterName, hasExportModifier } from './helpers'

/**
 * Build clean function signature for DTS output
 */
export function buildFunctionSignature(node: FunctionDeclaration): string {
  const parts: string[] = []

  // Check for async and generator
  const isAsync = node.modifiers?.some(mod => mod.kind === SyntaxKind.AsyncKeyword)
  const isGenerator = !!node.asteriskToken

  // Add modifiers
  if (hasExportModifier(node))
    parts.push('export ')
  parts.push('declare function ')

  // Add name (no space before)
  if (node.name)
    parts.push(node.name.getText())

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    parts.push('<', generics, '>')
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
  parts.push('(', params, ')')

  // Add return type with proper handling for async generators
  let returnType = node.type?.getText()
  if (!returnType) {
    if (isAsync && isGenerator) {
      returnType = 'AsyncGenerator<unknown, void, unknown>'
    }
    else if (isGenerator) {
      returnType = 'Generator<unknown, void, unknown>'
    }
    else if (isAsync) {
      returnType = 'Promise<void>'
    }
    else {
      returnType = 'void'
    }
  }
  parts.push(': ', returnType, ';')

  return parts.join('')
}

/**
 * Build clean variable declaration for DTS
 */
export function buildVariableDeclaration(name: string, type: string | undefined, kind: string, isExported: boolean): string {
  const parts: string[] = []

  if (isExported)
    parts.push('export ')
  parts.push('declare ', kind, ' ', name)

  if (type) {
    parts.push(': ', type)
  }

  parts.push(';')
  return parts.join('')
}

/**
 * Build clean interface declaration for DTS
 */
export function buildInterfaceDeclaration(node: InterfaceDeclaration, isExported: boolean): string {
  const parts: string[] = []

  if (isExported)
    parts.push('export ')
  parts.push('declare interface ', node.name.getText())

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    parts.push('<', generics, '>')
  }

  // Add extends
  if (node.heritageClauses) {
    const extendsClause = node.heritageClauses.find(clause =>
      clause.token === SyntaxKind.ExtendsKeyword,
    )
    if (extendsClause) {
      const types = extendsClause.types.map(type => type.getText()).join(', ')
      parts.push(' extends ', types)
    }
  }

  // Add body (simplified)
  const body = getInterfaceBody(node)
  parts.push(' ', body)

  return parts.join('')
}

/**
 * Get the interface member name, handling computed properties
 */
function getInterfaceMemberName(member: { name?: import('typescript').PropertyName }): string {
  if (!member.name) return ''

  // For computed property names, the getText() already includes brackets
  // So we just return it directly
  return member.name.getText()
}

/**
 * Get interface body with proper formatting
 */
export function getInterfaceBody(node: InterfaceDeclaration): string {
  const members: string[] = []

  for (const member of node.members) {
    if (isPropertySignature(member)) {
      const name = getInterfaceMemberName(member)
      const type = member.type?.getText() || 'any'
      const optional = member.questionToken ? '?' : ''
      const readonly = member.modifiers?.some(mod => mod.kind === SyntaxKind.ReadonlyKeyword) ? 'readonly ' : ''
      members.push(`  ${readonly}${name}${optional}: ${type}`)
    }
    else if (isMethodSignature(member)) {
      const name = getInterfaceMemberName(member)
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
      const optional = member.questionToken ? '?' : ''
      members.push(`  ${name}${optional}(${params}): ${returnType}`)
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
  const parts: string[] = []

  if (isExported)
    parts.push('export ')
  parts.push('type ', node.name.getText())

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    parts.push('<', generics, '>')
  }

  parts.push(' = ', node.type.getText())

  return parts.join('')
}

/**
 * Build clean class declaration for DTS
 */
export function buildClassDeclaration(node: ClassDeclaration, isExported: boolean): string {
  const parts: string[] = []

  // Add export if needed
  if (isExported)
    parts.push('export ')
  parts.push('declare ')

  // Add abstract modifier if present
  const isAbstract = node.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword)
  if (isAbstract)
    parts.push('abstract ')

  parts.push('class ', node.name?.getText() || 'AnonymousClass')

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText()).join(', ')
    parts.push('<', generics, '>')
  }

  // Add extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ExtendsKeyword,
  )?.types[0]?.getText()
  if (extendsClause) {
    parts.push(' extends ', extendsClause)
  }

  // Add implements clause
  const implementsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ImplementsKeyword,
  )?.types.map(type => type.getText())
  if (implementsClause && implementsClause.length > 0) {
    parts.push(' implements ', implementsClause.join(', '))
  }

  // Build class body with only signatures
  parts.push(' ', buildClassBody(node))

  return parts.join('')
}

/**
 * Helper to build member modifiers string efficiently
 */
function buildMemberModifiers(
  isStatic: boolean,
  isAbstract: boolean,
  isReadonly: boolean,
  isPrivate: boolean,
  isProtected: boolean,
): string {
  const parts: string[] = ['  ']
  if (isStatic) parts.push('static ')
  if (isAbstract) parts.push('abstract ')
  if (isReadonly) parts.push('readonly ')
  if (isPrivate) parts.push('private ')
  else if (isProtected) parts.push('protected ')
  return parts.join('')
}

/**
 * Check if a member name is a private identifier (#field)
 */
function isPrivateMemberName(member: { name?: import('typescript').PropertyName }): boolean {
  return member.name ? isPrivateIdentifier(member.name) : false
}

/**
 * Check if a property name is a symbol expression (Symbol.iterator, etc.)
 */
function isSymbolPropertyName(member: { name?: import('typescript').PropertyName }): boolean {
  if (!member.name) return false
  const text = member.name.getText()
  // Check for [Symbol.xxx] pattern
  return text.startsWith('[Symbol.') || text.startsWith('[customSymbol')
}

/**
 * Get the property name text, handling computed properties and symbols
 */
function getMemberNameText(member: { name?: import('typescript').PropertyName }): string {
  if (!member.name) return ''

  // For computed property names, the getText() already includes brackets
  // So we just return it directly
  return member.name.getText()
}

/**
 * Build clean class body for DTS (signatures only, no implementations)
 * Excludes: private fields (#field), private methods (#method), static blocks
 */
export function buildClassBody(node: ClassDeclaration): string {
  const members: string[] = []

  for (const member of node.members) {
    // Skip static blocks - they're implementation details
    if (member.kind === SyntaxKind.ClassStaticBlockDeclaration) {
      continue
    }

    if (isConstructorDeclaration(member)) {
      // First, add property declarations for parameter properties
      for (const param of member.parameters) {
        if (param.modifiers && param.modifiers.length > 0) {
          // This is a parameter property, add it as a separate property declaration
          const name = getParameterName(param)
          const type = param.type?.getText() || 'any'
          const optional = param.questionToken || param.initializer ? '?' : ''
          const modifierTexts = param.modifiers.map(mod => mod.getText()).join(' ')
          const modifiers = modifierTexts ? `${modifierTexts} ` : ''
          members.push(`  ${modifiers}${name}${optional}: ${type};`)
        }
      }

      // Then add constructor signature without parameter properties
      const params = member.parameters.map((param) => {
        const name = getParameterName(param)
        const type = param.type?.getText() || 'any'
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${name}${optional}: ${type}`
      }).join(', ')

      members.push(`  constructor(${params});`)
    }
    else if (isMethodDeclaration(member)) {
      // Skip private identifier methods (#privateMethod)
      if (isPrivateMemberName(member)) {
        continue
      }

      // Method signature without implementation
      const name = getMemberNameText(member)
      const isGenerator = !!member.asteriskToken
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        false,
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      const parts: string[] = [mods]

      // For generator methods, add the asterisk (including for symbol-named methods)
      if (isGenerator) {
        parts.push('*')
      }

      parts.push(name)

      // Add generics
      if (member.typeParameters) {
        const generics = member.typeParameters.map(tp => tp.getText()).join(', ')
        parts.push('<', generics, '>')
      }

      // Add parameters
      const params = member.parameters.map((param) => {
        const paramName = getParameterName(param)
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      parts.push('(', params, ')')

      // Add return type - for generators, ensure proper Generator/AsyncGenerator type
      const isAsync = !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AsyncKeyword)
      let returnType = member.type?.getText()
      if (!returnType) {
        if (isAsync && isGenerator) {
          returnType = 'AsyncGenerator<unknown, void, unknown>'
        }
        else if (isGenerator) {
          returnType = 'Generator<unknown, void, unknown>'
        }
        else if (isAsync) {
          returnType = 'Promise<void>'
        }
        else {
          returnType = 'void'
        }
      }
      parts.push(': ', returnType, ';')

      members.push(parts.join(''))
    }
    else if (isPropertyDeclaration(member)) {
      // Skip private identifier properties (#privateField)
      if (isPrivateMemberName(member)) {
        continue
      }

      // Property declaration
      const name = getMemberNameText(member)
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ReadonlyKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      const optional = member.questionToken ? '?' : ''
      const type = member.type?.getText() || 'any'

      members.push(`${mods}${name}${optional}: ${type};`)
    }
    else if (isGetAccessorDeclaration(member)) {
      // Skip private identifier accessors
      if (isPrivateMemberName(member)) {
        continue
      }

      // Get accessor declaration
      const name = getMemberNameText(member)
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        false,
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      const returnType = member.type?.getText() || 'any'
      members.push(`${mods}get ${name}(): ${returnType};`)
    }
    else if (isSetAccessorDeclaration(member)) {
      // Skip private identifier accessors
      if (isPrivateMemberName(member)) {
        continue
      }

      // Set accessor declaration
      const name = getMemberNameText(member)
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        false,
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      // Get parameter type from the setter's parameter
      const param = member.parameters[0]
      const paramType = param?.type?.getText() || 'any'
      const paramName = param?.name?.getText() || 'value'

      members.push(`${mods}set ${name}(${paramName}: ${paramType});`)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Build clean module declaration for DTS
 */
export function buildModuleDeclaration(node: ModuleDeclaration, isExported: boolean): string {
  const parts: string[] = []

  // Check if this is a global augmentation (declare global { ... })
  const isGlobalAugmentation = node.flags & NodeFlags.GlobalAugmentation

  if (isGlobalAugmentation) {
    // Global augmentation - output as "declare global"
    return `declare global ${buildModuleBody(node)}`
  }

  // Add export if needed
  if (isExported) {
    parts.push('export ')
  }

  // Add declare keyword
  parts.push('declare ')

  // Check if this is a namespace or module
  const isNamespace = node.flags & NodeFlags.Namespace
  parts.push(isNamespace ? 'namespace ' : 'module ')

  // Add module name
  parts.push(node.name.getText())

  // Build module body with only signatures
  parts.push(' ', buildModuleBody(node))

  return parts.join('')
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

      const parts: string[] = ['  ']
      if (isExported) parts.push('export ')
      parts.push('function ', name)

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText()).join(', ')
        parts.push('<', generics, '>')
      }

      // Add parameters
      const params = element.parameters.map((param) => {
        const paramName = getParameterName(param)
        const paramType = param.type?.getText() || 'any'
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      parts.push('(', params, ')')

      // Add return type
      const returnType = element.type?.getText() || 'void'
      parts.push(': ', returnType, ';')

      members.push(parts.join(''))
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

          const parts: string[] = ['  ']
          if (isExported) parts.push('export ')
          parts.push(kind, ' ', name)

          // Use type annotation if available, otherwise infer from initializer
          if (typeAnnotation) {
            parts.push(': ', typeAnnotation)
          }
          else if (initializer) {
            // Simple type inference for common cases
            if (initializer.startsWith('\'') || initializer.startsWith('"') || initializer.startsWith('`')) {
              parts.push(': string')
            }
            else if (/^\d+$/.test(initializer)) {
              parts.push(': number')
            }
            else if (initializer === 'true' || initializer === 'false') {
              parts.push(': boolean')
            }
            else {
              parts.push(': any')
            }
          }
          else {
            parts.push(': any')
          }

          parts.push(';')
          members.push(parts.join(''))
        }
      }
    }
    else if (isInterfaceDeclaration(element)) {
      // Interface declaration (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText()

      const parts: string[] = ['  ']
      if (isExported) parts.push('export ')
      parts.push('interface ', name)

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText()).join(', ')
        parts.push('<', generics, '>')
      }

      // Add extends
      if (element.heritageClauses) {
        const extendsClause = element.heritageClauses.find(clause =>
          clause.token === SyntaxKind.ExtendsKeyword,
        )
        if (extendsClause) {
          const types = extendsClause.types.map(type => type.getText()).join(', ')
          parts.push(' extends ', types)
        }
      }

      // Add body
      const body = getInterfaceBody(element)
      parts.push(' ', body)

      members.push(parts.join(''))
    }
    else if (isTypeAliasDeclaration(element)) {
      // Type alias declaration (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText()

      const parts: string[] = ['  ']
      if (isExported) parts.push('export ')
      parts.push('type ', name)

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText()).join(', ')
        parts.push('<', generics, '>')
      }

      parts.push(' = ', element.type.getText())

      members.push(parts.join(''))
    }
    else if (isEnumDeclaration(element)) {
      // Enum declaration
      const isExported = hasExportModifier(element)
      const name = element.name.getText()
      const isConst = element.modifiers?.some(mod => mod.kind === SyntaxKind.ConstKeyword)

      const parts: string[] = ['  ']
      if (isExported) parts.push('export ')
      if (isConst) parts.push('const ')
      parts.push('enum ', name)

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

      parts.push(' {\n', enumMembers.join(',\n'), '\n  }')
      members.push(parts.join(''))
    }
    else if (isModuleDeclaration(element)) {
      // Nested namespace/module (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText()

      const parts: string[] = ['  ']
      if (isExported) parts.push('export ')

      // Check if this is a namespace or module
      const isNamespace = element.flags & NodeFlags.Namespace
      parts.push(isNamespace ? 'namespace ' : 'module ')
      parts.push(name, ' ', buildModuleBody(element))

      members.push(parts.join(''))
    }
    else if (isExportAssignment(element)) {
      // Export default statement
      const parts: string[] = ['  export default ']
      if (element.expression) {
        parts.push(element.expression.getText())
      }
      parts.push(';')
      members.push(parts.join(''))
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
