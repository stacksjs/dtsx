import { readFile } from 'node:fs/promises'

export async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''
  let usedTypes = new Set<string>()
  let importMap = new Map<string, Set<string>>()

  // Capture all imported types
  const importRegex = /import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importRegex.exec(fileContent)) !== null) {
    const types = importMatch[1].split(',').map(t => t.trim())
    const from = importMatch[2]
    if (!importMap.has(from)) importMap.set(from, new Set())
    types.forEach(type => importMap.get(from)!.add(type))
  }

  // Function to add used types
  const addUsedType = (type: string) => {
    const cleanType = type.replace(/[\[\]?]/g, '').trim() // Remove brackets and question marks
    if (/^[A-Z]/.test(cleanType)) { // Only add if it starts with a capital letter (likely a type)
      usedTypes.add(cleanType)
    }
  }

  // Handle exported functions with comments
  const exportedFunctionRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*:\s*([^{]+))/g
  let match
  while ((match = exportedFunctionRegex.exec(fileContent)) !== null) {
    const [, comment, , isAsync, name, params, returnType] = match
    const cleanParams = params.replace(/\s*=\s*[^,)]+/g, '')
    const declaration = `${comment || ''}export declare ${isAsync || ''}function ${name}(${cleanParams}): ${returnType.trim()}`
    declarations += `${declaration}\n\n`

    // Check for types used in parameters
    const paramTypes = params.match(/:\s*([^,)=]+)/g) || []
    paramTypes.forEach(type => addUsedType(type.slice(1).trim()))

    // Check for return type
    addUsedType(returnType.trim())
  }

  // Handle other exports (interface, type, const)
  const otherExportRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+((?:interface|type|const)\s+\w+(?:\s*=\s*[^;]+|\s*\{[^}]*\})));?/gs
  while ((match = otherExportRegex.exec(fileContent)) !== null) {
    const [, comment, exportStatement, declaration] = match
    declarations += `${comment || ''}${exportStatement}\n\n`

    // Check for types used in the declaration
    const typeRegex = /\b([A-Z]\w+)\b/g
    let typeMatch
    while ((typeMatch = typeRegex.exec(declaration)) !== null) {
      addUsedType(typeMatch[1])
    }
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
