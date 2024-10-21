import { formatDeclarations } from './utils'

export async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await Bun.file(filePath).text()
  let imports = ''
  let declarations = ''
  let exports = ''
  let pendingComment = ''

  // Function to extract the body of a function
  function extractFunctionBody(funcName: string) {
    const funcRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*{([\\s\\S]*?)}`, 'g')
    const match = funcRegex.exec(fileContent)
    return match ? match[1] : ''
  }

  // Function to check if an identifier is used in a given content
  function isIdentifierUsed(identifier: string, content: string) {
    const regex = new RegExp(`\\b${identifier}\\b`, 'g')
    return regex.test(content)
  }

  // Extract the body of the dts function
  const dtsFunctionBody = extractFunctionBody('dts')

  // Handle imports
  const importRegex = /import\s+(type\s+)?(\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(\{[^}]+\}|\w+))?\s+from\s+['"]([^'"]+)['"]/g
  const importMatches = Array.from(fileContent.matchAll(importRegex))
  for (const [, isType, import1, import2, from] of importMatches) {
    if (from === 'node:process' && !isIdentifierUsed('process', dtsFunctionBody)) {
      continue
    }

    const importedItems = [...(import1.match(/\b\w+\b/g) || []), ...(import2?.match(/\b\w+\b/g) || [])]
    const usedImports = importedItems.filter(item =>
      isIdentifierUsed(item, dtsFunctionBody)
      || isIdentifierUsed(item, fileContent.replace(/import[^;]+;/g, '')),
    )

    if (usedImports.length > 0) {
      if (isType) {
        imports += `import type { ${usedImports.join(', ')} } from '${from}'\n`
      }
      else {
        imports += `import { ${usedImports.join(', ')} } from '${from}'\n`
      }
    }
  }

  // Function to parse object literal
  function parseObjectLiteral(str: string) {
    const obj: Record<string, string> = {}
    const regex = /(['"]?)([^\s'":]+)\1\s*:\s*(['"]?)([^\s'"]+)\3/g
    let match

    while ((match = regex.exec(str)) !== null) {
      const [, , key, , value] = match
      obj[key] = value
    }

    return obj
  }

  // Handle all declarations
  const declarationRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+(const|interface|type|function|async function)\s+\w[\s\S]*?(?=export\s|$))/g
  const declarationMatches = Array.from(fileContent.matchAll(declarationRegex))
  for (const [, comment, declaration, declType] of declarationMatches) {
    if (comment) {
      pendingComment = comment.trim()
    }

    if (declType === 'const') {
      const constMatch = declaration.match(/export\s+const\s+(\w+)(\s*:[^=]+)?\s*=\s*(\{[^}]+\})/)
      if (constMatch) {
        const [, constName, , constValue] = constMatch
        // Parse the object literal
        const parsedValue = parseObjectLiteral(constValue.slice(1, -1))
        const formattedValue = Object.entries(parsedValue)
          .map(([key, value]) => `  ${key.match(/\W/) ? `'${key}'` : key}: ${value.match(/^['"].*['"]$/) ? value : `'${value}'`}`)
          .join(',\n')

        if (pendingComment) {
          declarations += `${pendingComment}\n`
          pendingComment = ''
        }
        declarations += `export declare const ${constName}: {\n${formattedValue}\n}\n`
      }
      else {
        // Handle constants initialized with function calls
        const constFuncMatch = declaration.match(/export\s+const\s+(\w+)\s*:\s*([^=]+)\s*=\s*await\s+\w+\([^)]*\)/)
        if (constFuncMatch) {
          const [, constName, constType] = constFuncMatch
          if (pendingComment) {
            declarations += `${pendingComment}\n`
            pendingComment = ''
          }
          declarations += `export declare const ${constName}: ${constType.trim()}\n`
        }
        else {
          // Fallback to the original declaration if parsing fails
          if (pendingComment) {
            declarations += `${pendingComment}\n`
            pendingComment = ''
          }
          declarations += `export declare ${declaration.replace(/export\s+/, '').trim()}\n`
        }
      }
    }
    else if (declType === 'interface' || declType === 'type') {
      if (pendingComment) {
        declarations += `${pendingComment}\n`
        pendingComment = ''
      }
      declarations += `${declaration.trim()}\n`
    }
    else if (declType === 'function' || declType === 'async function') {
      if (pendingComment) {
        declarations += `${pendingComment}\n`
        pendingComment = ''
      }
      const funcSignatureRegex = /export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+)/
      const funcSignatureMatch = declaration.match(funcSignatureRegex)

      if (funcSignatureMatch) {
        const [, isAsync, funcName, params, returnType] = funcSignatureMatch
        declarations += `export declare ${isAsync || ''}function ${funcName}(${params.trim()}): ${returnType.trim()}\n`
      }
      else {
        // If we can't match the full signature, let's try to extract what we can
        const funcNameParamsRegex = /export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/
        const funcNameParamsMatch = declaration.match(funcNameParamsRegex)

        if (funcNameParamsMatch) {
          const [, isAsync, funcName, params] = funcNameParamsMatch
          // Try to find the return type
          const returnTypeRegex = /\)\s*:\s*([^{]+)/
          const returnTypeMatch = declaration.match(returnTypeRegex)
          const returnType = returnTypeMatch ? returnTypeMatch[1].trim() : 'any'

          declarations += `export declare ${isAsync || ''}function ${funcName}(${params.trim()}): ${returnType}\n`
        }
        else {
          // If all else fails, just add 'declare' to the original export
          const simplifiedDeclaration = declaration.replace(/export\s+/, '').split('{')[0].trim()
          declarations += `export declare ${simplifiedDeclaration}\n`
        }
      }
    }

    // Clear any remaining pending comment
    pendingComment = ''
  }

  // Handle re-exports and standalone exports
  const reExportRegex = /export\s*\{([^}]+)\}(?:\s*from\s*['"]([^'"]+)['"])?\s*;?/g
  const reExportMatches = Array.from(fileContent.matchAll(reExportRegex))
  for (const [, exportList, from] of reExportMatches) {
    const exportItems = exportList.split(',').map(e => e.trim())
    if (from) {
      exports += `\nexport { ${exportItems.join(', ')} } from '${from}'`
    }
    else {
      exports += `\nexport { ${exportItems.join(', ')} }`
    }
  }

  // Handle type exports
  const typeExportRegex = /export\s+type\s*\{([^}]+)\}/g
  const typeExportMatches = Array.from(fileContent.matchAll(typeExportRegex))
  for (const [, typeList] of typeExportMatches) {
    const types = typeList.split(',').map(t => t.trim())
    exports += `\nexport type { ${types.join(', ')} }`
  }

  // Handle default export
  const defaultExportRegex = /export\s+default\s+(\w+)/
  const defaultExportMatch = fileContent.match(defaultExportRegex)
  if (defaultExportMatch) {
    exports += `\nexport default ${defaultExportMatch[1]}`
  }

  const output = [imports, declarations.trim(), exports.trim()].filter(Boolean).join('\n').trim()
  return formatDeclarations(output)
}
