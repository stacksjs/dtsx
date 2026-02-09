/**
 * Builder functions for DTS output
 */

import type { ClassDeclaration, FunctionDeclaration, InterfaceDeclaration, ModuleDeclaration, Node, SourceFile, TypeAliasDeclaration, VariableStatement } from 'typescript'
import { isCallSignatureDeclaration, isConstructorDeclaration, isConstructSignatureDeclaration, isEnumDeclaration, isEnumMember, isExportAssignment, isFunctionDeclaration, isGetAccessorDeclaration, isIdentifier, isIndexSignatureDeclaration, isInterfaceDeclaration, isMethodDeclaration, isMethodSignature, isModuleBlock, isModuleDeclaration, isPrivateIdentifier, isPropertyDeclaration, isPropertySignature, isSetAccessorDeclaration, isTypeAliasDeclaration, isVariableStatement, NodeFlags, SyntaxKind } from 'typescript'
import { inferNarrowType } from '../processor/type-inference'
import { getParameterName, hasExportModifier } from './helpers'

const AS_TYPE_RE = /\s+as\s+(\S+)\s*$/

/**
 * Infer type from an AST initializer text when no explicit type annotation exists
 * For non-const contexts, widens primitive literals to base types (boolean, number, string)
 */
function inferTypeFromInitializer(initText: string, isConst: boolean): string {
  const trimmed = initText.trim()

  // Handle 'value as Type' assertions (but not 'as const' which inferNarrowType handles)
  if (!trimmed.endsWith('as const')) {
    const asMatch = trimmed.match(AS_TYPE_RE)
    if (asMatch) {
      return asMatch[1]
    }
  }

  const inferred = inferNarrowType(trimmed, isConst)
  if (inferred === 'unknown')
    return 'unknown'

  // For mutable contexts (non-const), widen primitive literal types to base types
  if (!isConst) {
    if (inferred === 'true' || inferred === 'false')
      return 'boolean'
    if (/^-?\d+(\.\d+)?$/.test(inferred))
      return 'number'
    if ((inferred.startsWith('"') && inferred.endsWith('"'))
      || (inferred.startsWith('\'') && inferred.endsWith('\''))) {
      return 'string'
    }
  }

  return inferred
}

/**
 * Build clean function signature for DTS output
 */
export function buildFunctionSignature(node: FunctionDeclaration, sf: SourceFile): string {
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
    parts.push(node.name.getText(sf))

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText(sf)).join(', ')
    parts.push('<', generics, '>')
  }

  // Add parameters (no space before)
  const params = node.parameters.map((param) => {
    const name = getParameterName(param, sf)
    const type = param.type?.getText(sf)
      || (param.initializer ? inferTypeFromInitializer(param.initializer.getText(sf), false) : 'unknown')
    const optional = param.questionToken || param.initializer ? '?' : ''
    const isRest = !!param.dotDotDotToken

    if (isRest) {
      return `...${name}: ${type}`
    }
    return `${name}${optional}: ${type}`
  }).join(', ')
  parts.push('(', params, ')')

  // Add return type with proper handling for async generators
  let returnType = node.type?.getText(sf)
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
export function buildInterfaceDeclaration(node: InterfaceDeclaration, isExported: boolean, sf: SourceFile): string {
  const parts: string[] = []

  if (isExported)
    parts.push('export ')
  parts.push('declare interface ', node.name.getText(sf))

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText(sf)).join(', ')
    parts.push('<', generics, '>')
  }

  // Add extends
  if (node.heritageClauses) {
    const extendsClause = node.heritageClauses.find(clause =>
      clause.token === SyntaxKind.ExtendsKeyword,
    )
    if (extendsClause) {
      const types = extendsClause.types.map(type => type.getText(sf)).join(', ')
      parts.push(' extends ', types)
    }
  }

  // Add body (simplified)
  const body = getInterfaceBody(node, sf)
  parts.push(' ', body)

  return parts.join('')
}

/**
 * Get the interface member name, handling computed properties
 */
function getInterfaceMemberName(member: { name?: import('typescript').PropertyName }, sf: SourceFile): string {
  if (!member.name)
    return ''

  // For computed property names, the getText() already includes brackets
  // So we just return it directly
  return member.name.getText(sf)
}

/**
 * Get interface body with proper formatting
 */
export function getInterfaceBody(node: InterfaceDeclaration, sf: SourceFile): string {
  const members: string[] = []

  for (const member of node.members) {
    if (isPropertySignature(member)) {
      const name = getInterfaceMemberName(member, sf)
      const type = member.type?.getText(sf) || 'unknown'
      const optional = member.questionToken ? '?' : ''
      const readonly = member.modifiers?.some(mod => mod.kind === SyntaxKind.ReadonlyKeyword) ? 'readonly ' : ''
      members.push(`  ${readonly}${name}${optional}: ${type}`)
    }
    else if (isMethodSignature(member)) {
      const name = getInterfaceMemberName(member, sf)

      // Extract generic type parameters on the method itself (e.g., find<S extends T>(...))
      let generics = ''
      if (member.typeParameters && member.typeParameters.length > 0) {
        generics = `<${member.typeParameters.map(tp => tp.getText(sf)).join(', ')}>`
      }

      const params = member.parameters.map((param) => {
        const paramName = param.name.getText(sf)
        const paramType = param.type?.getText(sf) || 'unknown'
        const optional = param.questionToken ? '?' : ''
        const isRest = !!param.dotDotDotToken

        if (isRest) {
          return `...${paramName}: ${paramType}`
        }
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText(sf) || 'void'
      const optional = member.questionToken ? '?' : ''
      members.push(`  ${name}${optional}${generics}(${params}): ${returnType}`)
    }
    else if (isCallSignatureDeclaration(member)) {
      // Call signature: (param: type) => returnType
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText(sf)
        const paramType = param.type?.getText(sf) || 'unknown'
        const optional = param.questionToken ? '?' : ''
        const isRest = !!param.dotDotDotToken

        if (isRest) {
          return `...${paramName}: ${paramType}`
        }
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText(sf) || 'void'
      members.push(`  (${params}): ${returnType}`)
    }
    else if (isConstructSignatureDeclaration(member)) {
      // Constructor signature: new (param: type) => returnType
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText(sf)
        const paramType = param.type?.getText(sf) || 'unknown'
        const optional = param.questionToken ? '?' : ''
        const isRest = !!param.dotDotDotToken

        if (isRest) {
          return `...${paramName}: ${paramType}`
        }
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText(sf) || 'unknown'
      members.push(`  new (${params}): ${returnType}`)
    }
    else if (isIndexSignatureDeclaration(member)) {
      // Index signature: [key: string]: T or [index: number]: T
      // Keep 'any' for index sig params (conventional for string/number keys)
      const params = member.parameters.map((param) => {
        const paramName = param.name.getText(sf)
        const paramType = param.type?.getText(sf) || 'any'
        return `${paramName}: ${paramType}`
      }).join(', ')
      const returnType = member.type?.getText(sf) || 'unknown'
      members.push(`  [${params}]: ${returnType}`)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Build clean type declaration for DTS
 */
export function buildTypeDeclaration(node: TypeAliasDeclaration, isExported: boolean, sf: SourceFile): string {
  const parts: string[] = []

  if (isExported)
    parts.push('export ')
  parts.push('type ', node.name.getText(sf))

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText(sf)).join(', ')
    parts.push('<', generics, '>')
  }

  parts.push(' = ', node.type.getText(sf))

  return parts.join('')
}

/**
 * Build clean class declaration for DTS
 */
export function buildClassDeclaration(node: ClassDeclaration, isExported: boolean, sf: SourceFile): string {
  const parts: string[] = []

  // Add export if needed
  if (isExported)
    parts.push('export ')
  parts.push('declare ')

  // Add abstract modifier if present
  const isAbstract = node.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword)
  if (isAbstract)
    parts.push('abstract ')

  parts.push('class ', node.name?.getText(sf) || 'AnonymousClass')

  // Add generics (no space before)
  if (node.typeParameters) {
    const generics = node.typeParameters.map(tp => tp.getText(sf)).join(', ')
    parts.push('<', generics, '>')
  }

  // Add extends clause
  const extendsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ExtendsKeyword,
  )?.types[0]?.getText(sf)
  if (extendsClause) {
    parts.push(' extends ', extendsClause)
  }

  // Add implements clause
  const implementsClause = node.heritageClauses?.find(clause =>
    clause.token === SyntaxKind.ImplementsKeyword,
  )?.types.map(type => type.getText(sf))
  if (implementsClause && implementsClause.length > 0) {
    parts.push(' implements ', implementsClause.join(', '))
  }

  // Build class body with only signatures
  parts.push(' ', buildClassBody(node, sf))

  return parts.join('')
}

/**
 * Helper to build member modifiers string efficiently
 * TypeScript modifier order: private/protected/public, static, abstract, readonly
 */
function buildMemberModifiers(
  isStatic: boolean,
  isAbstract: boolean,
  isReadonly: boolean,
  isPrivate: boolean,
  isProtected: boolean,
): string {
  const parts: string[] = ['  ']
  // Access modifiers come first
  if (isPrivate)
    parts.push('private ')
  else if (isProtected)
    parts.push('protected ')
  // Then static
  if (isStatic)
    parts.push('static ')
  // Then abstract
  if (isAbstract)
    parts.push('abstract ')
  // Then readonly
  if (isReadonly)
    parts.push('readonly ')
  return parts.join('')
}

/**
 * Check if a member name is a private identifier (#field)
 */
function isPrivateMemberName(member: { name?: import('typescript').PropertyName }): boolean {
  return member.name ? isPrivateIdentifier(member.name) : false
}

/**
 * Get the property name text, handling computed properties and symbols
 */
function getMemberNameText(member: { name?: import('typescript').PropertyName }, sf: SourceFile): string {
  if (!member.name)
    return ''

  // For computed property names, the getText() already includes brackets
  // So we just return it directly
  return member.name.getText(sf)
}

/**
 * Build clean class body for DTS (signatures only, no implementations)
 * Excludes: private fields (#field), private methods (#method), static blocks
 */
export function buildClassBody(node: ClassDeclaration, sf: SourceFile): string {
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
          // Skip private parameter properties - they're not part of the public API
          const isPrivateParam = param.modifiers.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
          if (isPrivateParam) {
            continue
          }

          // This is a parameter property, add it as a separate property declaration
          const name = getParameterName(param, sf)
          const type = param.type?.getText(sf)
            || (param.initializer ? inferTypeFromInitializer(param.initializer.getText(sf), false) : 'unknown')
          const optional = param.questionToken || param.initializer ? '?' : ''
          const modifierTexts = param.modifiers.map(mod => mod.getText(sf)).join(' ')
          const modifiers = modifierTexts ? `${modifierTexts} ` : ''
          members.push(`  ${modifiers}${name}${optional}: ${type};`)
        }
      }

      // Then add constructor signature without parameter properties
      const params = member.parameters.map((param) => {
        const name = getParameterName(param, sf)
        const type = param.type?.getText(sf)
          || (param.initializer ? inferTypeFromInitializer(param.initializer.getText(sf), false) : 'unknown')
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

      // Skip private keyword methods - they're not part of the public API
      const isPrivateMethod = member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
      if (isPrivateMethod) {
        continue
      }

      // Method signature without implementation
      const name = getMemberNameText(member, sf)
      const isGenerator = !!member.asteriskToken
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        false,
        false, // Already filtered out private
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
        const generics = member.typeParameters.map(tp => tp.getText(sf)).join(', ')
        parts.push('<', generics, '>')
      }

      // Add parameters
      const params = member.parameters.map((param) => {
        const paramName = getParameterName(param, sf)
        const paramType = param.type?.getText(sf)
          || (param.initializer ? inferTypeFromInitializer(param.initializer.getText(sf), false) : 'unknown')
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      parts.push('(', params, ')')

      // Add return type - for generators, ensure proper Generator/AsyncGenerator type
      const isAsync = !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AsyncKeyword)
      let returnType = member.type?.getText(sf)
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

      // Skip private keyword properties - they're not part of the public API
      const isPrivateProperty = member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
      if (isPrivateProperty) {
        continue
      }

      // Property declaration
      const name = getMemberNameText(member, sf)
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ReadonlyKeyword),
        false, // Already filtered out private
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      const optional = member.questionToken ? '?' : ''
      const isStaticMember = !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword)
      const isReadonlyMember = !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ReadonlyKeyword)
      const isConstLike = isStaticMember && isReadonlyMember
      const type = member.type?.getText(sf)
        || (member.initializer ? inferTypeFromInitializer(member.initializer.getText(sf), isConstLike) : 'unknown')

      members.push(`${mods}${name}${optional}: ${type};`)
    }
    else if (isGetAccessorDeclaration(member)) {
      // Skip private identifier accessors
      if (isPrivateMemberName(member)) {
        continue
      }

      // Skip private keyword accessors - they're not part of the public API
      const isPrivateAccessor = member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
      if (isPrivateAccessor) {
        continue
      }

      // Get accessor declaration
      const name = getMemberNameText(member, sf)
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        false,
        false, // Already filtered out private
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      const returnType = member.type?.getText(sf) || 'unknown'
      members.push(`${mods}get ${name}(): ${returnType};`)
    }
    else if (isSetAccessorDeclaration(member)) {
      // Skip private identifier accessors
      if (isPrivateMemberName(member)) {
        continue
      }

      // Skip private keyword accessors - they're not part of the public API
      const isPrivateAccessor = member.modifiers?.some(mod => mod.kind === SyntaxKind.PrivateKeyword)
      if (isPrivateAccessor) {
        continue
      }

      // Set accessor declaration
      const name = getMemberNameText(member, sf)
      const mods = buildMemberModifiers(
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.StaticKeyword),
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.AbstractKeyword),
        false,
        false, // Already filtered out private
        !!member.modifiers?.some(mod => mod.kind === SyntaxKind.ProtectedKeyword),
      )

      // Get parameter type from the setter's parameter
      const param = member.parameters[0]
      const paramType = param?.type?.getText(sf) || 'unknown'
      const paramName = param?.name?.getText(sf) || 'value'

      members.push(`${mods}set ${name}(${paramName}: ${paramType});`)
    }
  }

  return `{\n${members.join('\n')}\n}`
}

/**
 * Build clean module declaration for DTS
 */
export function buildModuleDeclaration(node: ModuleDeclaration, isExported: boolean, sf: SourceFile): string {
  const parts: string[] = []

  // Check if this is a global augmentation (declare global { ... })
  const isGlobalAugmentation = node.flags & NodeFlags.GlobalAugmentation

  if (isGlobalAugmentation) {
    // Global augmentation - output as "declare global"
    return `declare global ${buildModuleBody(node, sf)}`
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
  parts.push(node.name.getText(sf))

  // Build module body with only signatures
  parts.push(' ', buildModuleBody(node, sf))

  return parts.join('')
}

/**
 * Build clean module body for DTS (signatures only, no implementations)
 */
export function buildModuleBody(node: ModuleDeclaration, sf: SourceFile): string {
  if (!node.body)
    return '{}'

  const members: string[] = []

  function processModuleElement(element: Node) {
    if (isFunctionDeclaration(element)) {
      // Function signature without implementation (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name?.getText(sf) || ''

      const parts: string[] = ['  ']
      if (isExported)
        parts.push('export ')
      parts.push('function ', name)

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText(sf)).join(', ')
        parts.push('<', generics, '>')
      }

      // Add parameters
      const params = element.parameters.map((param) => {
        const paramName = getParameterName(param, sf)
        const paramType = param.type?.getText(sf)
          || (param.initializer ? inferTypeFromInitializer(param.initializer.getText(sf), false) : 'unknown')
        const optional = param.questionToken || param.initializer ? '?' : ''
        return `${paramName}${optional}: ${paramType}`
      }).join(', ')
      parts.push('(', params, ')')

      // Add return type
      const returnType = element.type?.getText(sf) || 'void'
      parts.push(': ', returnType, ';')

      members.push(parts.join(''))
    }
    else if (isVariableStatement(element)) {
      // Variable declarations
      const isExported = hasExportModifier(element)
      for (const declaration of (element as VariableStatement).declarationList.declarations) {
        if (declaration.name && isIdentifier(declaration.name)) {
          const name = declaration.name.getText(sf)
          const typeAnnotation = declaration.type?.getText(sf)
          const initializer = declaration.initializer?.getText(sf)
          const kind = (element as VariableStatement).declarationList.flags & NodeFlags.Const
            ? 'const'
            : (element as VariableStatement).declarationList.flags & NodeFlags.Let ? 'let' : 'var'

          const parts: string[] = ['  ']
          if (isExported)
            parts.push('export ')
          parts.push(kind, ' ', name)

          // Use type annotation if available, otherwise infer from initializer
          if (typeAnnotation) {
            parts.push(': ', typeAnnotation)
          }
          else if (initializer) {
            const inferred = inferTypeFromInitializer(initializer, kind === 'const')
            parts.push(': ', inferred)
          }
          else {
            parts.push(': unknown')
          }

          parts.push(';')
          members.push(parts.join(''))
        }
      }
    }
    else if (isInterfaceDeclaration(element)) {
      // Interface declaration (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText(sf)

      const parts: string[] = ['  ']
      if (isExported)
        parts.push('export ')
      parts.push('interface ', name)

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText(sf)).join(', ')
        parts.push('<', generics, '>')
      }

      // Add extends
      if (element.heritageClauses) {
        const extendsClause = element.heritageClauses.find(clause =>
          clause.token === SyntaxKind.ExtendsKeyword,
        )
        if (extendsClause) {
          const types = extendsClause.types.map(type => type.getText(sf)).join(', ')
          parts.push(' extends ', types)
        }
      }

      // Add body
      const body = getInterfaceBody(element, sf)
      parts.push(' ', body)

      members.push(parts.join(''))
    }
    else if (isTypeAliasDeclaration(element)) {
      // Type alias declaration (no declare keyword in ambient context)
      const isExported = hasExportModifier(element)
      const name = element.name.getText(sf)

      const parts: string[] = ['  ']
      if (isExported)
        parts.push('export ')
      parts.push('type ', name)

      // Add generics
      if (element.typeParameters) {
        const generics = element.typeParameters.map(tp => tp.getText(sf)).join(', ')
        parts.push('<', generics, '>')
      }

      parts.push(' = ', element.type.getText(sf))

      members.push(parts.join(''))
    }
    else if (isEnumDeclaration(element)) {
      // Enum declaration
      const isExported = hasExportModifier(element)
      const name = element.name.getText(sf)
      const isConst = element.modifiers?.some(mod => mod.kind === SyntaxKind.ConstKeyword)

      const parts: string[] = ['  ']
      if (isExported)
        parts.push('export ')
      if (isConst)
        parts.push('const ')
      parts.push('enum ', name)

      // Build enum body
      const enumMembers: string[] = []
      for (const member of element.members) {
        if (isEnumMember(member)) {
          const memberName = member.name.getText(sf)
          if (member.initializer) {
            const value = member.initializer.getText(sf)
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
      const name = element.name.getText(sf)

      const parts: string[] = ['  ']
      if (isExported)
        parts.push('export ')

      // Check if this is a namespace or module
      const isNamespace = element.flags & NodeFlags.Namespace
      parts.push(isNamespace ? 'namespace ' : 'module ')
      parts.push(name, ' ', buildModuleBody(element, sf))

      members.push(parts.join(''))
    }
    else if (isExportAssignment(element)) {
      // Export default statement
      const parts: string[] = ['  export default ']
      if (element.expression) {
        parts.push(element.expression.getText(sf))
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
