export async function extract(filePath: string): Promise<string> {
  try {
    const sourceCode = await Bun.file(filePath).text()

    return generateDtsTypes(sourceCode)
  }
  catch (error) {
    console.error(error)
    throw new Error(`Failed to extract and generate .d.ts file`)
  }
}

export function generateDtsTypes(sourceCode: string): string {
  const lines = sourceCode.split('\n')
  const dtsLines: string[] = []
  const imports: string[] = []
  const exports: string[] = []

  let isMultiLineDeclaration = false
  let currentDeclaration = ''
  let bracketCount = 0
  let lastCommentBlock = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Handle comments
    if (line.trim().startsWith('/**') || line.trim().startsWith('*') || line.trim().startsWith('*/')) {
      if (line.trim().startsWith('/**'))
        lastCommentBlock = ''
      lastCommentBlock += `${line}\n`
      continue
    }

    if (isMultiLineDeclaration || line.trim().startsWith('export')) {
      currentDeclaration += `${line}\n`
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

      if (bracketCount === 0 || (i === lines.length - 1 && !line.trim().endsWith(','))) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          lastCommentBlock = ''
        }
        const processed = processDeclaration(currentDeclaration.trim())
        if (processed)
          dtsLines.push(processed)
        isMultiLineDeclaration = false
        currentDeclaration = ''
      }
      else {
        isMultiLineDeclaration = true
      }
    }
    else if (line.trim().startsWith('import')) {
      imports.push(line)
    }
  }

  // Combine imports, declarations, and exports
  const result = cleanOutput([
    ...imports,
    '',
    ...dtsLines,
    '',
    ...exports,
  ].filter(Boolean).join('\n'))

  return result
}

function processDeclaration(declaration: string): string {
  // Remove comments
  const declWithoutComments = declaration.replace(/\/\/.*$/gm, '').trim()
  const trimmed = declWithoutComments

  if (trimmed.startsWith('export const')) {
    return processConstDeclaration(trimmed)
  }
  else if (trimmed.startsWith('export interface')) {
    return processInterfaceDeclaration(trimmed)
  }
  else if (trimmed.startsWith('export type')) {
    return processTypeDeclaration(trimmed)
  }
  else if (trimmed.startsWith('export function')) {
    return processFunctionDeclaration(trimmed)
  }
  else if (trimmed.startsWith('export')) {
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`
  }

  return ''
}

function processConstDeclaration(declaration: string): string {
  const equalIndex = declaration.indexOf('=')
  if (equalIndex === -1)
    return declaration // No value assigned

  const name = declaration.slice(0, equalIndex).trim()
  const value = declaration.slice(equalIndex + 1).trim()

  // Handle multi-line object literals
  if (value.startsWith('{')) {
    const objectValue = extractObjectLiteral(value)
    const objectType = parseObjectLiteral(objectValue)
    return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: ${objectType};`
  }
  else {
    const valueType = preserveValueType(value)
    return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: ${valueType};`
  }
}

function processInterfaceDeclaration(declaration: string): string {
  return `export declare ${declaration.slice('export'.length).trim()}`
}

function processTypeDeclaration(declaration: string): string {
  return `export declare ${declaration.slice('export'.length).trim()}`
}

function processFunctionDeclaration(declaration: string): string {
  const functionSignature = declaration.split('{')[0].trim()
  return `export declare ${functionSignature.slice('export'.length).trim()};`
}

function extractObjectLiteral(value: string): string {
  let bracketCount = 0
  let endIndex = 0
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '{')
      bracketCount++
    if (value[i] === '}')
      bracketCount--
    if (bracketCount === 0) {
      endIndex = i + 1
      break
    }
  }
  return value.slice(0, endIndex)
}

function parseObjectLiteral(objectLiteral: string): string {
  // Remove the opening and closing braces and newlines
  const content = objectLiteral.replace(/^\{|\}$/g, '').replace(/\n/g, ' ').trim()

  const pairs = content.split(',').map(pair => pair.trim()).filter(Boolean)

  const parsedProperties = pairs.map((pair) => {
    const [key, ...valueParts] = pair.split(':')
    const value = valueParts.join(':').trim()

    if (value.startsWith('\'') || value.startsWith('"')) {
      // For string literals, keep as is
      return `  ${key.trim()}: ${value};`
    }
    else {
      // For other types, use preserveValueType
      const preservedValue = preserveValueType(value)
      return `  ${key.trim()}: ${preservedValue};`
    }
  })

  return `{\n${parsedProperties.join('\n')}\n}`
}

function preserveValueType(value: string): string {
  value = value.trim()
  if (value === 'true' || value === 'false') {
    return value // Keep true and false as literal types
  }
  else if (!Number.isNaN(Number(value))) {
    return value // Keep numbers as literal types
  }
  else if (value.startsWith('[') && value.endsWith(']')) {
    return 'any[]' // Generic array type
  }
  else if ((value.startsWith('\'') && value.endsWith('\'')) || (value.startsWith('"') && value.endsWith('"'))) {
    return value // Keep string literals as is
  }
  else {
    return 'any' // Default to any for other cases
  }
}

function cleanOutput(output: string): string {
  return output
    .replace(/\{\s*\}/g, '{}') // Replace empty objects with {}
    .replace(/\s*;\s*(?=\}|$)/g, ';') // Clean up semicolons before closing braces or end of string
    .replace(/\n+/g, '\n') // Remove multiple consecutive newlines
    .trim()
}
