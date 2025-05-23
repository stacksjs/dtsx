import type { Declaration } from './types'
import { parseFunctionDeclaration, extractLeadingComments, isExportStatement, parseVariableDeclaration } from './parser'

/**
 * Extract all declarations from TypeScript source code
 */
export function extractDeclarations(sourceCode: string, filePath: string): Declaration[] {
  const declarations: Declaration[] = []

  // Extract modules first to avoid extracting their contents separately
  const modules = extractModules(sourceCode)
  declarations.push(...modules)

  // Create a set of lines that are inside modules to skip them in other extractions
  const moduleLines = new Set<number>()
  for (const module of modules) {
    const moduleText = module.text
    const lines = sourceCode.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (moduleText.includes(lines[i])) {
        moduleLines.add(i)
      }
    }
  }

  // Extract other declarations, but skip lines that are inside modules
  const filteredSourceCode = sourceCode.split('\n')
    .map((line, index) => moduleLines.has(index) ? '' : line)
    .join('\n')

  // Extract functions
  declarations.push(...extractFunctions(filteredSourceCode))

  // Extract variables
  declarations.push(...extractVariables(filteredSourceCode))

  // Extract interfaces
  declarations.push(...extractInterfaces(filteredSourceCode))

  // Extract types
  declarations.push(...extractTypes(filteredSourceCode))

  // Extract classes
  declarations.push(...extractClasses(filteredSourceCode))

  // Extract enums
  declarations.push(...extractEnums(filteredSourceCode))

  // Extract namespaces
  declarations.push(...extractNamespaces(filteredSourceCode))

  // Extract imports
  declarations.push(...extractImports(sourceCode)) // Use original source for imports

  // Extract exports
  declarations.push(...extractExports(sourceCode)) // Use original source for exports

  return declarations
}

/**
 * Extract function declarations including overloads
 */
export function extractFunctions(sourceCode: string): Declaration[] {
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')
  const processedLines = new Set<number>() // Track which lines we've already processed

  // Regex to match function declarations
  const functionRegex = /^(\s*)(export\s+)?(async\s+)?function\s*(\*?)\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/

  let i = 0
  while (i < lines.length) {
    // Skip if we've already processed this line (as part of an overload)
    if (processedLines.has(i)) {
      i++
      continue
    }

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

      // Mark this line as processed
      processedLines.add(i)

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
        if (!inBody && (currentLine.includes(';') || j === lines.length - 1)) {
          break
        }

        // Check if we've closed all braces
        if (inBody && braceCount === 0) {
          break
        }

        j++
      }

      // Check if this is an overload (no function body) or implementation
      const isOverload = !inBody && !declaration.includes('{')

      // If this is an overload, look for the implementation
      if (isOverload) {
        // Look ahead for more overloads and the implementation
        const allOverloads: string[] = [declaration.trim()]
        let k = j + 1
        let implementationFound = false
        let implementationDeclaration = ''

        while (k < lines.length) {
          const nextLine = lines[k].trim()

          // Skip empty lines and comments
          if (!nextLine || nextLine.startsWith('//') || nextLine.startsWith('/*')) {
            k++
            continue
          }

          // Check if it's another overload or the implementation
          const overloadMatch = nextLine.match(functionRegex)
          if (overloadMatch && overloadMatch[5] === functionName) {
            // Mark this line as processed
            processedLines.add(k)

            // Extract this function signature
            let funcSig = lines[k]
            let m = k + 1
            let hasBodyHere = false

            // Continue until we find the end of the signature or body
            while (m < lines.length) {
              const checkLine = lines[m].trim()

              // Check if this line has a brace (function body)
              if (checkLine.includes('{')) {
                hasBodyHere = true
                // This is the implementation, collect the full body
                let implBraceCount = 0
                let implInBody = false

                for (let n = k; n < lines.length; n++) {
                  const implLine = lines[n]

                  if (n > k) {
                    funcSig += '\n' + implLine
                  }

                  // Count braces
                  for (const char of implLine) {
                    if (char === '{') {
                      implBraceCount++
                      implInBody = true
                    } else if (char === '}') {
                      implBraceCount--
                    }
                  }

                  // Mark all lines as processed
                  processedLines.add(n)

                  // Check if we've closed all braces
                  if (implInBody && implBraceCount === 0) {
                    break
                  }
                }

                implementationDeclaration = funcSig
                implementationFound = true
                break
              }

              // Check if next line is another function or statement
              if (checkLine.match(/^(export|const|let|var|function|class|interface|type|enum|import)/)) {
                // This overload is complete
                break
              }

              // If line has content, add it to the signature
              if (checkLine && !checkLine.startsWith('//')) {
                funcSig += '\n' + lines[m]
              }

              m++
            }

            if (!hasBodyHere) {
              // This is another overload
              allOverloads.push(funcSig.trim())
              k = m - 1 // Back up one line since we'll increment k at the end
            } else {
              // This is the implementation
              break
            }
          } else {
            break
          }

          k++
        }

        // If we found an implementation, use it as the main declaration with overloads
        if (implementationFound) {
          declaration = implementationDeclaration

          // Extract leading comments
          const commentStartIndex = Math.max(0, i - 10)
          const leadingComments = extractLeadingComments(
            lines.slice(commentStartIndex, i).join('\n'),
            lines.slice(commentStartIndex, i).join('\n').length
          )

          // Parse the implementation signature
          const signature = parseFunctionDeclaration(declaration)

          if (signature) {
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
              overloads: allOverloads
            })
          }

          i = k
          continue
        } else {
          // No implementation found, treat as regular function
          // This shouldn't happen in well-formed TypeScript
        }
      }

      // Handle regular functions (not overloads)
      if (!isOverload) {
        // Extract leading comments
        const commentStartIndex = Math.max(0, i - 10)
        const leadingComments = extractLeadingComments(
          lines.slice(commentStartIndex, i).join('\n'),
          lines.slice(commentStartIndex, i).join('\n').length
        )

        // Parse the function signature
        const signature = parseFunctionDeclaration(declaration)

        if (signature) {
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
            overloads: []
          })
        }

        i = j
      }
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

    // Check if we're inside a function or class body by looking at previous lines
    let isInsideFunction = false
    let lookback = Math.max(0, i - 20) // Look back up to 20 lines
    let functionDepth = 0

    for (let j = lookback; j < i; j++) {
      const checkLine = lines[j]
      // Check for function/class/method declarations
      if (checkLine.match(/^\s*(export\s+)?(async\s+)?(function|class)\s+/) ||
          checkLine.match(/^\s*(async\s+)?[a-zA-Z_$][a-zA-Z0-9_$]*\s*\([^)]*\)\s*{/) ||
          checkLine.match(/^\s*(get|set)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*\(/) ||
          checkLine.match(/^\s*constructor\s*\(/)) {
        functionDepth++
      }

      // Count braces to track depth
      for (const char of checkLine) {
        if (char === '{') functionDepth++
        if (char === '}') functionDepth--
      }
    }

    // If we're at depth > 0, we're inside a function/class
    if (functionDepth > 0) {
      isInsideFunction = true
    }

    // Only process top-level declarations (not inside functions/classes)
    if (!isInsideFunction) {
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

      // Extract generics and extends - improved regex to handle complex generics
      const headerMatch = declaration.match(/interface\s+\w+\s*(<[^{]+>)?\s*(extends\s+[^{]+)?/)
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
  const declarations: Declaration[] = []
  const lines = sourceCode.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Check for various export patterns
    // export { ... }
    if (/^export\s*\{/.test(line)) {
      let declaration = line
      let j = i

      // Continue until we find the closing brace
      if (!line.includes('}')) {
        j++
        while (j < lines.length && !lines[j].includes('}')) {
          declaration += '\n' + lines[j]
          j++
        }
        if (j < lines.length) {
          declaration += '\n' + lines[j]
        }
      }

      declarations.push({
        kind: 'export',
        name: 'export',
        text: declaration.trim(),
        leadingComments: [],
        isExported: true,
        isTypeOnly: declaration.includes('export type {')
      })

      i = j
    }
    // export * from ...
    else if (/^export\s*\*\s*from/.test(line)) {
      declarations.push({
        kind: 'export',
        name: 'export',
        text: line.trim(),
        leadingComments: [],
        isExported: true,
        isTypeOnly: false
      })
    }
    // export default ...
    else if (/^export\s+default\s+/.test(line)) {
      declarations.push({
        kind: 'export',
        name: 'export',
        text: line.trim(),
        leadingComments: [],
        isExported: true,
        isDefault: true
      })
    }
    // export type { ... } from ...
    else if (/^export\s+type\s*\{/.test(line)) {
      let declaration = line
      let j = i

      // Continue until complete
      while (j < lines.length && !lines[j].includes(';') && !lines[j].endsWith('"') && !lines[j].endsWith("'")) {
        j++
        if (j < lines.length) {
          declaration += '\n' + lines[j]
        }
      }

      declarations.push({
        kind: 'export',
        name: 'export',
        text: declaration.trim(),
        leadingComments: [],
        isExported: true,
        isTypeOnly: true
      })

      i = j
    }

    i++
  }

  return declarations
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

