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
    console.log('processDeclaration input:', declaration)

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

  function parseObjectLiteral(objectLiteral: string): string {
    console.log('parseObjectLiteral input:', objectLiteral)
    // Remove the opening and closing braces
    const content = objectLiteral.slice(1, -1).trim()
    console.log('Cleaned content:', content)

    const pairs = []
    let currentPair = ''
    let inQuotes = false
    let bracketCount = 0

    for (const char of content) {
      if (char === '"' || char === '\'') {
        inQuotes = !inQuotes
      }
      else if (!inQuotes) {
        if (char === '{')
          bracketCount++
        if (char === '}')
          bracketCount--
      }

      if (char === ',' && !inQuotes && bracketCount === 0) {
        pairs.push(currentPair.trim())
        currentPair = ''
      }
      else {
        currentPair += char
      }
    }

    if (currentPair.trim()) {
      pairs.push(currentPair.trim())
    }

    console.log('Pairs:', pairs)

    const parsedProperties = pairs.map((pair) => {
      console.log('Processing pair:', pair)
      const colonIndex = pair.indexOf(':')
      if (colonIndex === -1)
        return null // Invalid pair

      const key = pair.slice(0, colonIndex).trim()
      const value = pair.slice(colonIndex + 1).trim()
      console.log('Key:', key, 'Value:', value)

      const sanitizedValue = preserveValueType(value)
      return `  ${key}: ${sanitizedValue};`
    }).filter(Boolean)

    const result = `{\n${parsedProperties.join('\n')}\n}`
    console.log('parseObjectLiteral output:', result)
    return result
  }

  function preserveValueType(value: string): string {
    console.log('preserveValueType input:', value)
    value = value.trim()
    let result
    if (value.startsWith('\'') || value.startsWith('"')) {
      // Handle string literals, including URLs
      result = value // Keep the original string as is
    }
    else if (value === 'true' || value === 'false') {
      result = value // Keep true and false as literal types
    }
    else if (!Number.isNaN(Number(value))) {
      result = value // Keep numbers as literal types
    }
    else if (value.startsWith('[') && value.endsWith(']')) {
      result = 'any[]' // Generic array type
    }
    else {
      result = 'string' // Default to string for other cases
    }
    console.log('preserveValueType output:', result)
    return result
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
