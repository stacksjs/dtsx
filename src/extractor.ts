import type { Declaration } from './types'
import { parseFunctionDeclaration, extractLeadingComments, isExportStatement, parseVariableDeclaration } from './parser'

/**
 * Extract all declarations from TypeScript source code
 */
export function extractDeclarations(sourceCode: string, filePath: string): Declaration[] {
  const declarations: Declaration[] = []

  // Extract functions
  declarations.push(...extractFunctions(sourceCode))

  // Extract variables
  declarations.push(...extractVariables(sourceCode))

  // Extract interfaces
  declarations.push(...extractInterfaces(sourceCode))

  // Extract types
  declarations.push(...extractTypes(sourceCode))

  // Extract classes
  declarations.push(...extractClasses(sourceCode))

  // Extract enums
  declarations.push(...extractEnums(sourceCode))

  // Extract namespaces
  declarations.push(...extractNamespaces(sourceCode))

  // Extract modules
  declarations.push(...extractModules(sourceCode))

  // Extract imports
  declarations.push(...extractImports(sourceCode))

  return declarations
}

/**
 * Extract function declarations including overloads
 */
export function extractFunctions(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match function declarations
  const functionRegex = /^(\s*)(export\s+)?(async\s+)?function\s*(\*?)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(functionRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const isAsync = !!match[3]
      const isGenerator = !!match[4]
      const functionName = match[5]

      // Skip if this appears to be inside an array or object literal
      // Look back to see if we're inside a structure
      let isInsideStructure = false
      let lookback = Math.max(0, i - 5)
      let openBraces = 0
      let openBrackets = 0

      for (let k = lookback; k < i; k++) {
        const checkLine = lines[k]
        for (const char of checkLine) {
          if (char === '{') openBraces++
          if (char === '}') openBraces--
          if (char === '[') openBrackets++
          if (char === ']') openBrackets--
        }

        // Check for variable assignment with array/object
        if (checkLine.match(/=\s*[\[{]/) || checkLine.match(/:\s*[\[{]/)) {
          if (openBraces > 0 || openBrackets > 0) {
            isInsideStructure = true
          }
        }
      }

      // Skip if inside a structure
      if (isInsideStructure || (openBraces > 0 || openBrackets > 0)) {
        i++
        continue
      }

      // Also skip if the line before has a comma (likely in an array/object)
      if (i > 0 && lines[i - 1].trim().endsWith(',')) {
        i++
        continue
      }

      // Collect the full function declaration
      let declaration = line
      let braceCount = 0
      let inBody = false
      let j = i

      // Find the start of the function body or the end of declaration
      while (j < lines.length) {
        const currentLine = lines[j]

        // Count braces to find where function ends
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++
            inBody = true
          } else if (char === '}') {
            braceCount--
          }
        }

        if (j > i) {
          declaration += '\n' + currentLine
        }

        // Check if this is just a declaration (no body)
        if (!inBody && currentLine.includes(';')) {
          break
        }

        // Check if we've closed all braces
        if (inBody && braceCount === 0) {
          break
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10) // Look back up to 10 lines
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      // Parse the function signature
      const signature = parseFunctionDeclaration(declaration)

      if (signature) {
        // Check for overloads by looking ahead
        const overloads: string[] = []
        let k = j + 1

        while (k < lines.length) {
          const nextLine = lines[k].trim()

          // Skip empty lines and comments
          if (!nextLine || nextLine.startsWith('//') || nextLine.startsWith('/*')) {
            k++
            continue
          }

          // Check if it's an overload of the same function
          const overloadMatch = nextLine.match(functionRegex)
          if (overloadMatch && overloadMatch[5] === functionName) {
            // Extract just the signature line for overloads
            let overloadSig = lines[k]
            let m = k + 1

            // Continue until we find a semicolon or opening brace
            while (m < lines.length) {
              const checkLine = lines[m]
              if (checkLine.includes(';')) {
                overloadSig += '\n' + checkLine.substring(0, checkLine.indexOf(';') + 1)
                break
              }
              if (checkLine.includes('{')) {
                // This is the implementation, stop before it
                break
              }
              overloadSig += '\n' + checkLine
              m++
            }

            // Only add if it ends with semicolon (it's a signature, not implementation)
            if (overloadSig.includes(';')) {
              overloads.push(overloadSig.trim())
            }
            k = m
          } else {
            break
          }

          k++
        }

        declarations.push({
          kind: 'function',
          name: functionName,
          text: declaration,
          leadingComments,
          isExported,
          modifiers: signature.modifiers,
          generics: signature.generics,
          parameters: signature.parameters.split(',').map(p => ({ name: p.trim() })),
          returnType: signature.returnType,
          isAsync,
          isGenerator,
          overloads
        })
      }

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract variable declarations
 */
export function extractVariables(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match variable declarations
  const variableRegex = /^(\s*)(export\s+)?(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(variableRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const kind = match[3] as 'const' | 'let' | 'var'
      const variableName = match[4]

      // Check if this is a simple single-line declaration
      const hasValue = line.includes('=')
      const hasSemicolon = line.includes(';')
      const hasOpenBrace = line.includes('{')
      const hasOpenBracket = line.includes('[')

      let declaration = ''
      let endLine = i

      // Simple case: single line with no complex structures
      if (!hasOpenBrace && !hasOpenBracket && (hasSemicolon || !hasValue)) {
        declaration = line
      }
      // Single line with value but no semicolon
      else if (!hasOpenBrace && !hasOpenBracket && hasValue) {
        // Check if next line continues the declaration
        if (i < lines.length - 1) {
          const nextLine = lines[i + 1].trim()
          // If next line starts with a new statement, current line is complete
          if (nextLine.match(/^(export|const|let|var|function|class|interface|type|enum|\/\/|\/\*|\*|import)/)) {
            declaration = line
          } else {
            // Need to do complex parsing
            declaration = extractCompleteDeclaration(lines, i)
            endLine = i + declaration.split('\n').length - 1
          }
        } else {
          declaration = line
        }
      }
      // Complex case: multi-line declaration
      else {
        declaration = extractCompleteDeclaration(lines, i)
        endLine = i + declaration.split('\n').length - 1
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      // Parse the variable declaration
      const parsed = parseVariableDeclaration(declaration)

      if (parsed) {
        declarations.push({
          kind: 'variable',
          name: variableName,
          text: declaration,
          leadingComments,
          isExported,
          modifiers: [kind],
          typeAnnotation: parsed.typeAnnotation,
          value: parsed.value
        })
      }

      i = endLine
    }

    i++
  }

  return declarations
}

/**
 * Extract a complete multi-line declaration
 */
function extractCompleteDeclaration(lines: string[], startIndex: number): string {
  let declaration = ''
  let braceCount = 0
  let bracketCount = 0
  let parenCount = 0
  let inString = false
  let stringChar = ''
  let foundEquals = false
  let foundSemicolon = false

  for (let j = startIndex; j < lines.length; j++) {
    const currentLine = lines[j]
    declaration += (j > startIndex ? '\n' : '') + currentLine

    // Track string literals to avoid counting brackets inside strings
    for (let k = 0; k < currentLine.length; k++) {
      const char = currentLine[k]
      const prevChar = k > 0 ? currentLine[k - 1] : ''

      if (!inString && (char === '"' || char === "'" || char === '`')) {
        inString = true
        stringChar = char
      } else if (inString && char === stringChar && prevChar !== '\\') {
        inString = false
      }

      if (!inString) {
        if (char === '=') foundEquals = true
        if (char === '{') braceCount++
        if (char === '}') braceCount--
        if (char === '[') bracketCount++
        if (char === ']') bracketCount--
        if (char === '(') parenCount++
        if (char === ')') parenCount--
        if (char === ';') foundSemicolon = true
      }
    }

    // Check for end of declaration
    if (braceCount === 0 && bracketCount === 0 && parenCount === 0) {
      // If we found a semicolon, we're done
      if (foundSemicolon) {
        break
      }

      // If we have an equals sign and the next line starts a new statement
      if (foundEquals && j < lines.length - 1) {
        const nextLine = lines[j + 1].trim()
        if (nextLine && nextLine.match(/^(export|const|let|var|function|class|interface|type|enum|\/\/|\/\*|\*|import)/)) {
          break
        }
      }
    }
  }

  return declaration
}

/**
 * Extract interface declarations
 */
export function extractInterfaces(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match interface declarations
  const interfaceRegex = /^(\s*)(export\s+)?interface\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(interfaceRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const interfaceName = match[3]

      // Collect the full interface declaration
      let declaration = ''
      let braceCount = 0
      let foundOpenBrace = false
      let j = i

      // Find the complete interface body
      while (j < lines.length) {
        const currentLine = lines[j]
        declaration += (j > i ? '\n' : '') + currentLine

        // Count braces to find where interface ends
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++
            foundOpenBrace = true
          } else if (char === '}') {
            braceCount--
          }
        }

        // Check if we've closed all braces
        if (foundOpenBrace && braceCount === 0) {
          break
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      // Extract generics and extends
      const headerMatch = declaration.match(/interface\s+\w+\s*(<[^>]+>)?\s*(extends\s+[^{]+)?/)
      let generics = ''
      let extendsClause = ''

      if (headerMatch) {
        generics = headerMatch[1] || ''
        extendsClause = headerMatch[2]?.replace('extends', '').trim() || ''
      }

      declarations.push({
        kind: 'interface',
        name: interfaceName,
        text: declaration,
        leadingComments,
        isExported,
        generics,
        extends: extendsClause
      })

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract type alias declarations
 */
export function extractTypes(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match type declarations
  const typeRegex = /^(\s*)(export\s+)?type\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/
  const typeExportRegex = /^(\s*)export\s+type\s+\{[^}]+\}/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Check for type re-export first (e.g., export type { Foo })
    if (typeExportRegex.test(line)) {
      declarations.push({
        kind: 'export',
        name: 'export',
        text: line,
        leadingComments: [],
        isExported: true,
        isTypeOnly: true
      })
      i++
      continue
    }

    const match = line.match(typeRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const typeName = match[3]

      // Collect the full type declaration
      let declaration = ''
      let j = i
      let foundEquals = false
      let depth = 0
      let inString = false
      let stringChar = ''

      // Find the complete type declaration
      while (j < lines.length) {
        const currentLine = lines[j]
        declaration += (j > i ? '\n' : '') + currentLine

        // Track depth for complex type definitions
        for (const char of currentLine) {
          if (!inString && (char === '"' || char === "'" || char === '`')) {
            inString = true
            stringChar = char
          } else if (inString && char === stringChar) {
            inString = false
          }

          if (!inString) {
            if (char === '=') foundEquals = true
            if (char === '{' || char === '[' || char === '(') depth++
            if (char === '}' || char === ']' || char === ')') depth--
          }
        }

        // Check if declaration is complete
        if (foundEquals && depth === 0) {
          // Check for semicolon or next declaration
          if (currentLine.includes(';') || (j < lines.length - 1 &&
              lines[j + 1].trim().match(/^(export|const|let|var|function|class|interface|type|enum|\/\/|\/\*|\*|import)/))) {
            break
          }
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      // Extract generics
      const headerMatch = declaration.match(/type\s+\w+\s*(<[^=]+>)?/)
      const generics = headerMatch?.[1] || ''

      declarations.push({
        kind: 'type',
        name: typeName,
        text: declaration,
        leadingComments,
        isExported,
        generics
      })

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract class declarations
 */
export function extractClasses(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match class declarations
  const classRegex = /^(\s*)(export\s+)?(abstract\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(classRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const isAbstract = !!match[3]
      const className = match[4]

      // Collect the full class declaration
      let declaration = ''
      let braceCount = 0
      let foundOpenBrace = false
      let j = i

      // Find the complete class body
      while (j < lines.length) {
        const currentLine = lines[j]
        declaration += (j > i ? '\n' : '') + currentLine

        // Count braces to find where class ends
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++
            foundOpenBrace = true
          } else if (char === '}') {
            braceCount--
          }
        }

        // Check if we've closed all braces
        if (foundOpenBrace && braceCount === 0) {
          break
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      // Extract generics, extends, and implements
      const headerMatch = declaration.match(/class\s+\w+\s*(<[^>]+>)?\s*(extends\s+[^{]+)?\s*(implements\s+[^{]+)?/)
      let generics = ''
      let extendsClause = ''
      let implementsClause: string[] = []

      if (headerMatch) {
        generics = headerMatch[1] || ''
        extendsClause = headerMatch[2]?.replace('extends', '').trim() || ''
        const implementsStr = headerMatch[3]?.replace('implements', '').trim() || ''
        if (implementsStr) {
          implementsClause = implementsStr.split(',').map(s => s.trim())
        }
      }

      const modifiers: string[] = []
      if (isAbstract) modifiers.push('abstract')

      declarations.push({
        kind: 'class',
        name: className,
        text: declaration,
        leadingComments,
        isExported,
        modifiers,
        generics,
        extends: extendsClause,
        implements: implementsClause
      })

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract enum declarations
 */
export function extractEnums(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match enum declarations
  const enumRegex = /^(\s*)(export\s+)?(const\s+)?enum\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(enumRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const isConst = !!match[3]
      const enumName = match[4]

      // Collect the full enum declaration
      let declaration = ''
      let braceCount = 0
      let foundOpenBrace = false
      let j = i

      // Find the complete enum body
      while (j < lines.length) {
        const currentLine = lines[j]
        declaration += (j > i ? '\n' : '') + currentLine

        // Count braces to find where enum ends
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++
            foundOpenBrace = true
          } else if (char === '}') {
            braceCount--
          }
        }

        // Check if we've closed all braces
        if (foundOpenBrace && braceCount === 0) {
          break
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      const modifiers: string[] = []
      if (isConst) modifiers.push('const')

      declarations.push({
        kind: 'enum',
        name: enumName,
        text: declaration,
        leadingComments,
        isExported,
        modifiers
      })

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract namespace declarations
 */
export function extractNamespaces(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match namespace declarations
  const namespaceRegex = /^(\s*)(export\s+)?(declare\s+)?namespace\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(namespaceRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const isDeclare = !!match[3]
      const namespaceName = match[4]

      // Collect the full namespace declaration
      let declaration = ''
      let braceCount = 0
      let foundOpenBrace = false
      let j = i

      // Find the complete namespace body
      while (j < lines.length) {
        const currentLine = lines[j]
        declaration += (j > i ? '\n' : '') + currentLine

        // Count braces to find where namespace ends
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++
            foundOpenBrace = true
          } else if (char === '}') {
            braceCount--
          }
        }

        // Check if we've closed all braces
        if (foundOpenBrace && braceCount === 0) {
          break
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      declarations.push({
        kind: 'module',
        name: namespaceName,
        text: declaration,
        leadingComments,
        isExported,
        modifiers: isDeclare ? ['declare'] : []
      })

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract import statements
 */
export function extractImports(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match import statements
  const importRegex = /^(\s*)import\s+/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (importRegex.test(line)) {
      let declaration = line
      let j = i

      // Single line import with 'from' clause
      if (line.includes(' from ')) {
        // This is a complete import on one line
        declaration = line
      } else {
        // Multi-line import - continue until we find 'from' and the closing quote/semicolon
        j++
        while (j < lines.length) {
          declaration += '\n' + lines[j]

          // Check if we've completed the import statement
          if (lines[j].includes(' from ') &&
              (lines[j].includes('"') || lines[j].includes("'") || lines[j].includes('`'))) {
            // Check if the quote is closed
            const quoteMatch = lines[j].match(/from\s+(['"`])([^'"`]+)\1/)
            if (quoteMatch) {
              // Import is complete
              break
            }
          }
          j++
        }
      }

      // Determine import type
      const isTypeImport = declaration.includes('import type') || declaration.includes('import { type')

      declarations.push({
        kind: 'import',
        name: 'import',
        text: declaration.trim(),
        leadingComments: [],
        isExported: false,
        isTypeOnly: isTypeImport
      })

      i = j
    }

    i++
  }

  return declarations
}

/**
 * Extract export statements
 */
export function extractExports(sourceCode: string): Declaration[] {
  // TODO: Implement export extraction
  return []
}

/**
 * Extract module declarations and augmentations
 */
export function extractModules(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  // Regex to match module declarations
  const moduleRegex = /^(\s*)(export\s+)?(declare\s+)?module\s+(['"`][^'"`]+['"`]|[a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(moduleRegex)

    if (match) {
      const leadingWhitespace = match[1]
      const isExported = !!match[2]
      const isDeclare = !!match[3]
      const moduleName = match[4]

      // Check if this is an ambient module or augmentation
      const isAmbient = moduleName.startsWith('"') || moduleName.startsWith("'") || moduleName.startsWith('`')

      // Collect the full module declaration
      let declaration = ''
      let braceCount = 0
      let foundOpenBrace = false
      let j = i

      // Find the complete module body
      while (j < lines.length) {
        const currentLine = lines[j]
        declaration += (j > i ? '\n' : '') + currentLine

        // Count braces to find where module ends
        for (const char of currentLine) {
          if (char === '{') {
            braceCount++
            foundOpenBrace = true
          } else if (char === '}') {
            braceCount--
          }
        }

        // Check if we've closed all braces
        if (foundOpenBrace && braceCount === 0) {
          break
        }

        j++
      }

      // Extract leading comments
      const commentStartIndex = Math.max(0, i - 10)
      const leadingComments = extractLeadingComments(
        lines.slice(commentStartIndex, i).join('\n'),
        lines.slice(commentStartIndex, i).join('\n').length
      )

      declarations.push({
        kind: 'module',
        name: moduleName,
        text: declaration,
        leadingComments,
        isExported,
        modifiers: isDeclare ? ['declare'] : [],
        source: isAmbient ? moduleName : undefined
      })

      i = j
    }

    i++
  }

  return declarations
}
