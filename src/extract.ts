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

  function processDeclaration(declaration: string): string {
    // Remove comments
    const declWithoutComments = declaration.replace(/\/\/.*$/gm, '').trim()
    const trimmed = declWithoutComments

    // Handle imports
    if (trimmed.startsWith('import')) {
      imports.push(trimmed.endsWith(';') ? trimmed : `${trimmed};`)
      return ''
    }

    // Handle exports from other files
    if (trimmed.startsWith('export') && trimmed.includes('from')) {
      exports.push(trimmed.endsWith(';') ? trimmed : `${trimmed};`)
      return ''
    }

    // Handle const declarations
    if (trimmed.startsWith('export const')) {
      const [name, rest] = trimmed.split('=').map(s => s.trim())
      const declaredType = name.includes(':') ? name.split(':')[1].trim() : null

      if (rest) {
        // If we have a value, use it to infer the most specific type
        if (rest.startsWith('{')) {
          // For object literals, preserve the exact structure
          const objectType = parseObjectLiteral(rest)
          return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: ${objectType};`
        }
        else {
          // For primitive values, use the exact value as the type
          const valueType = preserveValueType(rest)
          return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: ${valueType};`
        }
      }
      else if (declaredType) {
        // If no value but a declared type, use the declared type
        return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: ${declaredType};`
      }
      else {
        // If no value and no declared type, default to 'any'
        return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: any;`
      }
    }

    // Handle other declarations (interfaces, types, functions)
    if (trimmed.startsWith('export')) {
      return trimmed.endsWith(';') ? trimmed : `${trimmed};`
    }

    return ''
  }

  function preserveValueType(value: string): string {
    value = value.trim()
    if (value.startsWith('\'') || value.startsWith('"')) {
      // Preserve string literals exactly as they appear in the source
      // Ensure that the entire string is captured, including any special characters
      const match = value.match(/^(['"])(.*)\1$/)
      if (match) {
        return `'${match[2]}'` // Return the content of the string, wrapped in single quotes
      }
      return 'string' // Fallback to string if the regex doesn't match
    }
    else if (value === 'true' || value === 'false') {
      return value // Keep true and false as literal types
    }
    else if (!Number.isNaN(Number(value))) {
      return value // Keep numbers as literal types
    }
    else if (value.startsWith('[') && value.endsWith(']')) {
      return 'any[]' // Generic array type
    }
    else {
      return 'string' // Default to string for other cases
    }
  }

  function parseObjectLiteral(objectLiteral: string): string {
    // Remove the opening and closing braces
    const content = objectLiteral.slice(1, -1).trim()

    // Split the object literal into key-value pairs, respecting nested structures
    const pairs = []
    let currentPair = ''
    let nestLevel = 0
    let inQuotes = false

    for (const char of content) {
      if (char === '{' && !inQuotes)
        nestLevel++
      if (char === '}' && !inQuotes)
        nestLevel--
      if (char === '"' || char === '\'')
        inQuotes = !inQuotes

      if (char === ',' && nestLevel === 0 && !inQuotes) {
        pairs.push(currentPair.trim())
        currentPair = ''
      }
      else {
        currentPair += char
      }
    }
    if (currentPair)
      pairs.push(currentPair.trim())

    const parsedProperties = pairs.map((pair) => {
      const [key, ...valueParts] = pair.split(':')
      const value = valueParts.join(':').trim() // Rejoin in case the value contained a colon

      if (!key)
        return null // Invalid pair

      const sanitizedValue = preserveValueType(value)
      return `  ${key.trim()}: ${sanitizedValue};`
    }).filter(Boolean)

    return `{\n${parsedProperties.join('\n')}\n}`
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Handle comments
    if (line.startsWith('/**') || line.startsWith('*') || line.startsWith('*/')) {
      if (line.startsWith('/**'))
        lastCommentBlock = ''
      lastCommentBlock += `${lines[i]}\n`
      continue
    }

    if (isMultiLineDeclaration) {
      currentDeclaration += ` ${line}`
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

      if (bracketCount === 0 || i === lines.length - 1) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          lastCommentBlock = ''
        }
        const processed = processDeclaration(currentDeclaration)
        if (processed)
          dtsLines.push(processed)
        isMultiLineDeclaration = false
        currentDeclaration = ''
      }
    }
    else if (line.startsWith('export') || line.startsWith('import') || line.startsWith('interface')) {
      bracketCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

      if (bracketCount === 0) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          lastCommentBlock = ''
        }
        const processed = processDeclaration(line)
        if (processed)
          dtsLines.push(processed)
      }
      else {
        isMultiLineDeclaration = true
        currentDeclaration = line
      }
    }
  }

  // Combine imports, declarations, and exports
  const result = [
    ...imports,
    '',
    ...dtsLines,
    '',
    ...exports,
  ].filter(Boolean).join('\n')

  return result
}
