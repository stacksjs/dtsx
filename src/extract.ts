import { readFile } from 'node:fs/promises'

export async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''
  let usedTypes = new Set<string>()
  let importMap = new Map<string, Set<string>>()

  // Capture all imports
  const importRegex = /import\s+(?:(type)\s+)?(?:(\{[^}]+\})|(\w+))(?:\s*,\s*(?:(\{[^}]+\})|(\w+)))?\s+from\s+['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importRegex.exec(fileContent)) !== null) {
    const [, isTypeImport, namedImports1, defaultImport1, namedImports2, defaultImport2, from] = importMatch
    const processImports = (imports: string | undefined, isType: boolean) => {
      if (imports) {
        const types = imports.replace(/[{}]/g, '').split(',').map(t => {
          const [name, alias] = t.split(' as ').map(s => s.trim())
          return { name: name.replace(/^type\s+/, ''), alias: alias || name.replace(/^type\s+/, '') }
        })
        if (!importMap.has(from)) importMap.set(from, new Set())
        types.forEach(({ name, alias }) => {
          importMap.get(from)!.add(name)
        })
      }
    }

    processImports(namedImports1, !!isTypeImport)
    processImports(namedImports2, !!isTypeImport)
    if (defaultImport1) importMap.get(from)!.add(defaultImport1)
    if (defaultImport2) importMap.get(from)!.add(defaultImport2)
  }

  // Handle exported functions with comments
  const exportedFunctionRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+)(async\s+)?(function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+))/g
  let match
  while ((match = exportedFunctionRegex.exec(fileContent)) !== null) {
    const [, comment, exportKeyword, isAsync, , name, params, returnType] = match
    const cleanParams = params.replace(/\s*=\s*[^,)]+/g, '')
    let cleanReturnType = returnType.trim()

    if (isAsync && !cleanReturnType.startsWith('Promise')) {
      cleanReturnType = `Promise<${cleanReturnType}>`
    }

    const declaration = `${comment || ''}${exportKeyword}declare function ${name}(${cleanParams}): ${cleanReturnType}`
    declarations += `${declaration}\n\n`

    // Add parameter types and return type to usedTypes
    params.match(/:\s*(\w+)/g)?.forEach(type => usedTypes.add(type.slice(1).trim()))
    cleanReturnType.match(/\b([A-Z]\w+)\b/g)?.forEach(type => usedTypes.add(type))
  }

  // Handle other exports (interface, type, const)
  const otherExportRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+((?:interface|type|const)\s+\w+(?:\s*=\s*[^;]+|\s*\{[^}]*\})));?/gs
  while ((match = otherExportRegex.exec(fileContent)) !== null) {
    const [, comment, exportStatement] = match
    declarations += `${comment || ''}${exportStatement}\n\n`

    // Add types used in the export to usedTypes
    exportStatement.match(/\b([A-Z]\w+)\b/g)?.forEach(type => usedTypes.add(type))
  }

  // Generate import statements for used types
  let importDeclarations = ''
  importMap.forEach((types, path) => {
    const usedTypesFromPath = [...types].filter(type => usedTypes.has(type))
    if (usedTypesFromPath.length > 0) {
      importDeclarations += `import type { ${usedTypesFromPath.join(', ')} } from '${path}'\n`
    }
  })

  if (importDeclarations) {
    declarations = importDeclarations + '\n' + declarations
  }

  return declarations.trim() + '\n'
}

export async function extractConfigTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''

  // Handle type imports
  const importRegex = /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importRegex.exec(fileContent)) !== null) {
    const types = importMatch[1].split(',').map(t => t.trim())
    const from = importMatch[2]
    declarations += `import type { ${types.join(', ')} } from '${from}'\n\n`  // Add two newlines here
  }

  // Handle exports
  const exportRegex = /export\s+const\s+(\w+)\s*:\s*([^=]+)\s*=/g
  let exportMatch
  while ((exportMatch = exportRegex.exec(fileContent)) !== null) {
    const [, name, type] = exportMatch
    declarations += `export declare const ${name}: ${type.trim()}\n`
  }

  return declarations.trim() + '\n'
}

export async function extractIndexTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''

  // Handle re-exports
  const reExportRegex = /export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g
  let match
  while ((match = reExportRegex.exec(fileContent)) !== null) {
    declarations += `${match[0]}\n`
  }

  return declarations.trim() + '\n'
}
