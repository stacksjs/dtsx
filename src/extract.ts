const DEBUG = true

function logDebug(...messages: unknown[]): void {
  if (DEBUG)
    console.debug('[dtsx]', ...messages)
}

interface PropertyInfo {
  key: string
  value: string
  type: string
}

export async function extract(filePath: string): Promise<string> {
  try {
    const sourceCode = await Bun.file(filePath).text()
    return generateDtsTypes(sourceCode)
  }
  catch (error) {
    console.error(error)
    throw new Error('Failed to extract and generate .d.ts file')
  }
}

function generateDtsTypes(sourceCode: string): string {
  logDebug('Starting generateDtsTypes')
  const lines = sourceCode.split('\n')
  const dtsLines: string[] = []
  const imports: string[] = []
  const usedTypes: Set<string> = new Set()
  const typeSources: Map<string, string> = new Map()
  let defaultExport = ''

  let isMultiLineDeclaration = false
  let currentDeclaration = ''
  let bracketCount = 0
  let lastCommentBlock = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    logDebug(`Processing line ${i + 1}: ${line}`)

    if (line.trim().startsWith('/**') || line.trim().startsWith('*') || line.trim().startsWith('*/')) {
      if (line.trim().startsWith('/**'))
        lastCommentBlock = ''
      lastCommentBlock += `${line}\n`
      continue
    }

    if (line.trim().startsWith('import')) {
      imports.push(processImport(line, typeSources))
      continue
    }

    if (line.trim().startsWith('export default')) {
      defaultExport = `\n${line.trim()};`
      continue
    }

    const isDeclaration = line.trim().startsWith('export')
      || isMultiLineDeclaration
      || line.trim().startsWith('const')
      || line.trim().startsWith('interface')
      || line.trim().startsWith('type')
      || line.trim().startsWith('function')

    if (isDeclaration) {
      currentDeclaration += `${line}\n`
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      isMultiLineDeclaration = bracketCount > 0

      if (!isMultiLineDeclaration) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          lastCommentBlock = ''
        }
        const processed = processDeclaration(currentDeclaration.trim(), usedTypes)
        if (processed)
          dtsLines.push(processed)

        currentDeclaration = ''
        bracketCount = 0
      }
    }
  }

  const dynamicImports = Array.from(usedTypes)
    .map((type) => {
      const source = typeSources.get(type)
      return source ? `import type { ${type} } from '${source}';` : ''
    })
    .filter(Boolean)

  const result = [...imports, ...dynamicImports, '', ...dtsLines]
    .filter(Boolean)
    .join('\n')

  console.log('Final result', result)
  return defaultExport ? `${result}\n${defaultExport}` : result
}

function processImport(importLine: string, typeSources: Map<string, string>): string {
  const importMatch = importLine.match(/import(?: type)? \{([^}]+)\} from ['"]([^'"]+)['"]/)
  if (importMatch) {
    const types = importMatch[1].split(',').map(t => t.trim())
    const source = importMatch[2]
    types.forEach(type => typeSources.set(type, source))
  }
  return importLine.includes('type')
    ? importLine.replace('import', 'import type').replace('type type', 'type')
    : importLine
}

function processDeclaration(declaration: string, usedTypes: Set<string>): string {
  if (declaration.startsWith('export const'))
    return processConstDeclaration(declaration)

  if (declaration.startsWith('const'))
    return processConstDeclaration(declaration, false)

  if (declaration.startsWith('export interface'))
    return processInterfaceDeclaration(declaration)

  if (declaration.startsWith('interface'))
    return processInterfaceDeclaration(declaration, false)

  if (declaration.startsWith('export type {'))
    return processTypeOnlyExport(declaration)

  if (declaration.startsWith('type {'))
    return processTypeOnlyExport(declaration, false)

  if (declaration.startsWith('export type'))
    return processTypeDeclaration(declaration)

  if (declaration.startsWith('type'))
    return processTypeDeclaration(declaration, false)

  if (declaration.startsWith('export function') || declaration.startsWith('export async function'))
    return processFunctionDeclaration(declaration, usedTypes)

  if (declaration.startsWith('function') || declaration.startsWith('async function'))
    return processFunctionDeclaration(declaration, usedTypes, false)

  if (declaration.startsWith('export default'))
    return `${declaration};`

  if (declaration.startsWith('export'))
    return declaration

  return `declare ${declaration}`
}

function processConstDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const name = firstLine.split('const')[1].split('=')[0].trim().split(':')[0].trim()
  const typeMatch = firstLine.match(/const\s[^:]+:\s*([^=]+)\s*=/)

  if (typeMatch) {
    const type = typeMatch[1].trim()
    return `${isExported ? 'export ' : ''}declare const ${name}: ${type};`
  }

  const properties = extractObjectProperties(lines.slice(1, -1))
  const propertyStrings = properties.map(prop => `  ${prop.key}: ${prop.type};`)

  return `${isExported ? 'export ' : ''}declare const ${name}: {\n${propertyStrings.join('\n')}\n};`
}

function extractObjectProperties(lines: string[]): PropertyInfo[] {
  const properties: PropertyInfo[] = []
  let currentProperty: Partial<PropertyInfo> | null = null
  let bracketCount = 0

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*'))
      continue

    if (currentProperty === null) {
      const match = trimmedLine.match(/^(\w+)\s*:\s*(.+?),?$/)
      if (match) {
        const [, key, value] = match
        properties.push({
          key,
          value,
          type: inferType(value.trim()),
        })
      }
    }
    else {
      bracketCount += (trimmedLine.match(/\{/g) || []).length
      bracketCount -= (trimmedLine.match(/\}/g) || []).length

      if (bracketCount === 0) {
        if (currentProperty.key) {
          properties.push({
            key: currentProperty.key,
            value: currentProperty.value || '',
            type: currentProperty.type || 'any',
          })
        }
        currentProperty = null
      }
    }
  }

  return properties
}

function inferType(value: string): string {
  // Handle string literals - keep the quotes
  if (value.startsWith('"') || value.startsWith('\'')) {
    // Ensure consistent quote style (using single quotes)
    const cleanValue = value.trim().replace(/^["']|["']$/g, '')
    return `'${cleanValue}'`
  }

  if (value === 'true' || value === 'false')
    return value

  if (!Number.isNaN(Number(value)))
    return value

  if (value.includes('=>') || value.includes('function'))
    return 'Function'

  if (value.startsWith('['))
    return 'Array<any>'

  if (value.startsWith('{'))
    return 'Object'

  if (value.includes('.'))
    return 'Object'

  return value
}

function processInterfaceDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const interfaceName = lines[0].split('interface')[1].split('{')[0].trim()
  const interfaceBody = lines
    .slice(1, -1)
    .map(line => `  ${line.trim().replace(/;?$/, ';')}`)
    .join('\n')

  return `${isExported ? 'export ' : ''}declare interface ${interfaceName} {\n${interfaceBody}\n}`
}

function processTypeOnlyExport(declaration: string, isExported = true): string {
  return declaration
    .replace('export type', `${isExported ? 'export ' : ''}declare type`)
    .replace(/;$/, '')
}

function processTypeDeclaration(declaration: string, isExported = true): string {
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const typeName = firstLine.split('type')[1].split('=')[0].trim()
  const typeBody = firstLine.split('=')[1]?.trim() || lines.slice(1).join('\n').trim().replace(/;$/, '')

  return `${isExported ? 'export ' : ''}declare type ${typeName} = ${typeBody};`
}

function processFunctionDeclaration(
  declaration: string,
  usedTypes: Set<string>,
  isExported = true,
): string {
  const functionSignature = declaration.split('{')[0].trim()
  const asyncKeyword = functionSignature.includes('async') ? 'async ' : ''
  const functionName = functionSignature
    .replace('export ', '')
    .replace('async ', '')
    .split('(')[0]
    .trim()
  const params = functionSignature.split('(')[1].split(')')[0].trim()
  const returnType = getReturnType(functionSignature)

  if (returnType && returnType !== 'void')
    usedTypes.add(returnType)

  return `${isExported ? 'export ' : ''}declare ${asyncKeyword}function ${functionName}(${params}): ${returnType};`
    .replace('function function', 'function')
}

function getReturnType(functionSignature: string): string {
  const returnTypeMatch = functionSignature.match(/:\s*([^\s{]+)/)
  return returnTypeMatch ? returnTypeMatch[1].replace(/;$/, '') : 'void'
}
