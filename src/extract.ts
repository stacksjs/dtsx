import { readFile } from 'node:fs/promises'
import { formatDeclarations } from './utils'

export async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let imports = ''
  let declarations = ''
  let exports = ''
  const processedDeclarations = new Set()

  // Function to extract the body of a function
  const extractFunctionBody = (funcName: string) => {
    const funcRegex = new RegExp(`function\\s+${funcName}\\s*\\([^)]*\\)\\s*{([\\s\\S]*?)}`, 'g')
    const match = funcRegex.exec(fileContent)
    return match ? match[1] : ''
  }

  // Function to check if an identifier is used in a given content
  const isIdentifierUsed = (identifier: string, content: string) => {
    const regex = new RegExp(`\\b${identifier}\\b`, 'g')
    return regex.test(content)
  }

  // Extract the body of the dts function
  const dtsFunctionBody = extractFunctionBody('dts')

  // Handle imports
  const importRegex = /import\s+(type\s+)?(\{[^}]+\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(\{[^}]+\}|\w+))?\s+from\s+['"]([^'"]+)['"]/g
  const importMatches = Array.from(fileContent.matchAll(importRegex))
  for (const [fullImport, isType, import1, import2, from] of importMatches) {
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

  // Handle all declarations
  const declarationRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+(const|interface|type|function)\s+(\w+)[\s\S]*?(?:;|\})\s*)/g
  const declarationMatches = Array.from(fileContent.matchAll(declarationRegex))
  for (const [, comment, declaration, declType, name] of declarationMatches) {
    if (!processedDeclarations.has(name)) {
      if (comment)
        declarations += `${comment.trim()}\n`

      if (declType === 'const') {
        const constMatch = declaration.match(/export\s+const\s+(\w+)\s*:\s*([^=]+)=/)
        if (constMatch) {
          declarations += `export declare const ${constMatch[1]}: ${constMatch[2].trim()}\n\n`
        }
        else {
          declarations += `${declaration.trim()}\n\n`
        }
      }
      else if (declType === 'function') {
        const funcMatch = declaration.match(/export\s+function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+)/)
        if (funcMatch) {
          declarations += `export declare function ${funcMatch[1]}(${funcMatch[2]}): ${funcMatch[3].trim()}\n\n`
        }
        else {
          declarations += `${declaration.trim()}\n\n`
        }
      }
      else {
        declarations += `${declaration.trim()}\n\n`
      }

      processedDeclarations.add(name)
    }
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
    exports += `\n\nexport type { ${types.join(', ')} }`
  }

  // Handle default export
  const defaultExportRegex = /export\s+default\s+(\w+)/
  const defaultExportMatch = fileContent.match(defaultExportRegex)
  if (defaultExportMatch) {
    exports += `\n\nexport default ${defaultExportMatch[1]}`
  }

  const output = [imports, declarations, exports].filter(Boolean).join('\n').trim()
  return formatDeclarations(output)
}
