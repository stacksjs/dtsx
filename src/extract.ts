/* eslint-disable no-console */
const DEBUG = true

function logDebug(...messages: unknown[]): void {
  if (DEBUG)
    console.debug('[dtsx]', ...messages)
}

interface PropertyInfo {
  key: string
  value: string
  type: string
  nested?: PropertyInfo[]
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

  console.log('result:', result)

  return defaultExport ? `${result}\n${defaultExport}` : result
}

function processImport(importLine: string, typeSources: Map<string, string>): string {
  const typeImportMatch = importLine.match(/import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)
  const regularImportMatch = importLine.match(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/)

  const match = typeImportMatch || regularImportMatch
  if (match) {
    const types = match[1].split(',').map(type => type.trim())
    const source = match[2]

    types.forEach((type) => {
      // Handle 'as' syntax in imports
      const actualType = type.split(' as ')[0].trim()
      typeSources.set(actualType, source)
    })
  }

  return importLine
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
  const propertyStrings = formatProperties(properties)

  return `${isExported ? 'export ' : ''}declare const ${name}: {\n${propertyStrings}\n};`
}

function formatProperties(properties: PropertyInfo[], indent = 2): string {
  return properties.map((prop) => {
    const spaces = ' '.repeat(indent)
    if (prop.nested && prop.nested.length > 0) {
      const nestedProps = formatProperties(prop.nested, indent + 2)
      return `${spaces}${prop.key}: {\n${nestedProps}\n${spaces}};`
    }
    return `${spaces}${prop.key}: ${prop.type};`
  }).join('\n')
}

function extractObjectProperties(lines: string[]): PropertyInfo[] {
  const properties: PropertyInfo[] = []
  let currentProperty: { key?: string, content: string[] } = { content: [] }
  let depth = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    if (!line || line.startsWith('//') || line.startsWith('/*'))
      continue

    const openCount = (line.match(/[[{]/g) || []).length
    const closeCount = (line.match(/[\]}]/g) || []).length

    // Start of a new property
    if (depth === 0 && line.includes(':')) {
      const [key] = line.split(':')
      currentProperty = {
        key: key.trim(),
        content: [line],
      }
    }
    // Continue current property
    else if (depth > 0 || openCount > 0) {
      currentProperty.content.push(line)
    }

    depth += openCount - closeCount

    // Property is complete
    if (depth === 0 && currentProperty.key) {
      const propertyInfo = processCompleteProperty(currentProperty)
      if (propertyInfo) {
        properties.push(propertyInfo)
      }
      currentProperty = { content: [] }
    }
  }

  return properties
}

function processCompleteProperty({ key, content }: { key?: string, content: string[] }): PropertyInfo | null {
  if (!key)
    return null

  const fullContent = content.join(' ').trim()
  const colonIndex = fullContent.indexOf(':')
  if (colonIndex === -1)
    return null

  const valueContent = fullContent.substring(colonIndex + 1).trim()

  // Handle nested objects
  if (valueContent.startsWith('{')) {
    const nestedContent = extractNestedContent(valueContent, '{', '}')
    if (nestedContent) {
      const nestedProps = extractObjectProperties(nestedContent.split(',').map(line => line.trim()))
      return {
        key,
        value: valueContent,
        type: formatNestedType(nestedProps),
        nested: nestedProps,
      }
    }
  }

  // Handle arrays
  if (valueContent.startsWith('[')) {
    return {
      key,
      value: valueContent,
      type: inferArrayType(valueContent),
    }
  }

  // Handle functions
  if (isFunction(valueContent)) {
    return {
      key,
      value: valueContent,
      type: 'Function',
    }
  }

  // Handle other types
  return processSimpleValue(key, valueContent)
}

function extractNestedContent(content: string, openChar: string, closeChar: string): string | null {
  let depth = 0
  let start = -1
  let result = ''

  for (let i = 0; i < content.length; i++) {
    if (content[i] === openChar) {
      if (depth === 0)
        start = i
      depth++
    }
    else if (content[i] === closeChar) {
      depth--
      if (depth === 0 && start !== -1) {
        result = content.substring(start + 1, i)
        break
      }
    }
  }

  return result || null
}

function isFunction(value: string): boolean {
  return (
    value.includes('=>')
    || value.startsWith('function')
    || value === 'console.log'
    || (value.endsWith('.log') && !value.includes('[') && !value.includes('{'))
  )
}

function inferArrayType(value: string): string {
  const content = extractNestedContent(value, '[', ']')
  if (!content)
    return 'never[]'

  const elements = splitArrayElements(content)
  if (elements.length === 0)
    return 'never[]'

  // Analyze each element to determine specific types
  const elementTypes = elements.map(element => inferElementType(element.trim()))

  // If all elements are of the same type, use that type
  if (elementTypes.every(type => type === elementTypes[0])) {
    return `Array<${elementTypes[0]}>`
  }

  // For mixed types, create a union
  const uniqueTypes = [...new Set(elementTypes)]
  return `Array<${uniqueTypes.join(' | ')}>`
}

function inferElementType(element: string): string {
  // Handle nested arrays
  if (element.startsWith('[')) {
    return inferArrayType(element)
  }

  // Handle objects
  if (element.startsWith('{')) {
    const props = parseObjectLiteral(element)
    return formatObjectType(props)
  }

  // Handle string literals
  if (element.startsWith('\'') || element.startsWith('"')) {
    const stringContent = element.slice(1, -1)
    return `'${stringContent}'`
  }

  // Handle numbers
  if (!Number.isNaN(Number(element))) {
    return element // Use literal type for numbers
  }

  // Handle booleans
  if (element === 'true' || element === 'false') {
    return element
  }

  // Handle functions
  if (element.includes('=>') || element.startsWith('function')) {
    return inferFunctionType(element)
  }

  // Handle known function references
  if (element === 'console.log' || element.endsWith('.log')) {
    return '(...args: any[]) => void'
  }

  // Handle potentially undefined references
  if (element.includes('.')) {
    return 'unknown'
  }

  return 'any'
}

function inferFunctionType(func: string): string {
  // Check for async functions
  const isAsync = func.startsWith('async')

  // Try to determine return type
  let returnType = 'unknown'

  if (func.includes('console.log')) {
    returnType = 'void'
  }
  else if (func.includes('return')) {
    const returnStatement = func.match(/return\s+([^;]+)/)?.[1]
    if (returnStatement) {
      if (returnStatement.startsWith('\'') || returnStatement.startsWith('"')) {
        returnType = 'string'
      }
      else if (!Number.isNaN(Number(returnStatement))) {
        returnType = 'number'
      }
      else if (returnStatement === 'true' || returnStatement === 'false') {
        returnType = 'boolean'
      }
      else if (returnStatement.includes('??')) {
        const [, fallback] = returnStatement.split('??').map(s => s.trim())
        if (fallback.startsWith('\'') || fallback.startsWith('"')) {
          returnType = 'string'
        }
      }
    }
  }

  return `${isAsync ? 'async ' : ''}(...args: any[]) => ${returnType}`
}

function splitArrayElements(content: string): string[] {
  const elements: string[] = []
  let current = ''
  let depth = 0
  let inString = false
  let stringChar = ''

  for (const char of content) {
    if ((char === '"' || char === '\'') && !inString) {
      inString = true
      stringChar = char
    }
    else if (char === stringChar && !inString) {
      inString = false
    }

    if (!inString) {
      if (char === '[' || char === '{')
        depth++
      else if (char === ']' || char === '}')
        depth--
    }

    if (char === ',' && depth === 0 && !inString) {
      elements.push(current.trim())
      current = ''
    }
    else {
      current += char
    }
  }

  if (current.trim()) {
    elements.push(current.trim())
  }

  return elements
}

function parseObjectLiteral(objStr: string): PropertyInfo[] {
  const content = objStr.slice(1, -1).trim()
  return extractObjectProperties([content])
}

function processSimpleValue(key: string, value: string): PropertyInfo {
  // Clean the value first - remove trailing commas and whitespace
  const cleanValue = value.replace(/,\s*$/, '').trim()

  // String literals
  if (cleanValue.startsWith('\'') || cleanValue.startsWith('"')) {
    const stringContent = cleanValue.slice(1, -1)
    return {
      key,
      value: cleanValue,
      type: `'${stringContent}'`,
    }
  }

  // Numbers
  if (!Number.isNaN(Number(cleanValue))) {
    return {
      key,
      value: cleanValue,
      type: cleanValue, // Keep the exact number
    }
  }

  // Booleans
  if (cleanValue === 'true' || cleanValue === 'false') {
    return {
      key,
      value: cleanValue,
      type: cleanValue, // Keep the exact boolean value
    }
  }

  // Function calls
  if (cleanValue.endsWith('()') || cleanValue === 'console.log') {
    return {
      key,
      value: cleanValue,
      type: 'Function',
    }
  }

  // Default to Object for unknown types
  return {
    key,
    value: cleanValue,
    type: 'Object',
  }
}

function formatNestedType(properties: PropertyInfo[]): string {
  if (properties.length === 0)
    return 'Object'

  const formattedProps = properties
    .map(prop => `${prop.key}: ${prop.nested ? formatNestedType(prop.nested) : prop.type}`)
    .join('; ')

  return `{ ${formattedProps} }`
}

function extractPropertyInfo(key: string, value: string, originalLines: string[]): PropertyInfo {
  // Handle multiline object definitions
  if (value.startsWith('{') && value.includes('{}')) {
    const objectLines = originalLines.filter(line =>
      line.trim().startsWith(key)
      || (line.includes('{') && line.includes('}'))
      || line.trim().endsWith(',')
      || line.trim().endsWith('}'),
    )

    const nestedProperties = parseNestedObject(objectLines)
    if (nestedProperties.length > 0) {
      return {
        key,
        value,
        type: formatNestedType(nestedProperties),
        nested: nestedProperties,
      }
    }
  }

  // Handle arrow functions and function declarations
  if ((value.includes('=>') && !value.includes('['))
    || value.startsWith('function')
    || (value.includes('()') && value.includes('{'))) {
    return {
      key,
      value,
      type: 'Function',
    }
  }

  // Handle arrays
  if (value.startsWith('[')) {
    return {
      key,
      value,
      type: inferArrayType(value),
    }
  }

  // Handle inline objects
  if (value.startsWith('{')) {
    const objectContent = value.slice(1, -1).trim()
    const nestedProps = extractObjectProperties([objectContent])
    return {
      key,
      value,
      type: formatObjectType(nestedProps),
      nested: nestedProps.length > 0 ? nestedProps : undefined,
    }
  }

  // Handle function references and console methods
  if (value === 'console.log' || value.endsWith('.log')) {
    return {
      key,
      value,
      type: 'Function',
    }
  }

  // Handle string literals
  if (value.startsWith('\'') || value.startsWith('"')) {
    const cleanValue = value.slice(1, -1)
    return {
      key,
      value,
      type: `'${cleanValue}'`,
    }
  }

  // Handle numbers
  if (!Number.isNaN(Number(value))) {
    return {
      key,
      value,
      type: value,
    }
  }

  // Handle booleans
  if (value === 'true' || value === 'false') {
    return {
      key,
      value,
      type: value,
    }
  }

  // Handle object references
  return {
    key,
    value,
    type: 'Object',
  }
}

function parseNestedObject(lines: string[]): PropertyInfo[] {
  const nestedLines = lines
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('//'))

  let braceCount = 0
  let currentBlock = ''
  const properties: PropertyInfo[] = []

  for (const line of nestedLines) {
    braceCount += (line.match(/\{/g) || []).length
    braceCount -= (line.match(/\}/g) || []).length

    if (line.includes(':')) {
      const [key, ...valueParts] = line.split(':')
      const value = valueParts.join(':').trim()

      if (value.includes('{')) {
        // Start of nested object
        currentBlock = `${key.trim()}: ${value}`
      }
      else if (braceCount === 0) {
        // Simple property
        const propInfo = extractPropertyInfo(
          key.trim(),
          value.replace(/,$/, ''),
          nestedLines,
        )
        properties.push(propInfo)
      }
    }
  }

  return properties
}

function formatObjectType(properties: PropertyInfo[]): string {
  if (properties.length === 0)
    return 'Object'

  const formattedProps = properties
    .map(prop => `${prop.key}: ${prop.nested ? formatNestedType(prop.nested) : prop.type}`)
    .join('; ')

  return `{ ${formattedProps} }`
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

  if (returnType && returnType !== 'void') {
    // Add base type and any generic parameters to usedTypes
    const baseType = returnType.split('<')[0].trim()
    usedTypes.add(baseType)

    // Extract types from generic parameters if present
    const genericMatch = returnType.match(/<([^>]+)>/)?.[1]
    if (genericMatch) {
      genericMatch.split(',').forEach((type) => {
        const cleanType = type.trim().split('<')[0].trim()
        if (cleanType)
          usedTypes.add(cleanType)
      })
    }
  }

  return `${isExported ? 'export ' : ''}declare ${asyncKeyword}function ${functionName}(${params}): ${returnType};`
    .replace('function function', 'function')
}

function getReturnType(functionSignature: string): string {
  // Match everything after ): up to { or end of string
  const returnTypeMatch = functionSignature.match(/\):\s*([^{;]+)/)
  if (!returnTypeMatch)
    return 'void'

  // Clean up the return type
  return returnTypeMatch[1]
    .replace(/[;,]$/, '') // Remove trailing semicolons and commas
    .trim()
}
