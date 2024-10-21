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
  console.log('Starting generateDtsTypes')
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
    console.log(`Processing line ${i + 1}: ${line}`)

    // Handle comments
    if (line.trim().startsWith('/**') || line.trim().startsWith('*') || line.trim().startsWith('*/')) {
      if (line.trim().startsWith('/**'))
        lastCommentBlock = ''
      lastCommentBlock += `${line}\n`
      console.log('Comment line added to lastCommentBlock')
      continue
    }

    if (line.trim().startsWith('import')) {
      const processedImport = processImport(line)
      imports.push(processedImport)
      console.log(`Processed import: ${processedImport}`)
      continue
    }

    if (line.trim().startsWith('export') && (line.includes('{') || line.includes('*') || line.includes('from'))) {
      exports.push(line)
      console.log(`Export line added: ${line}`)
      continue
    }

    if (isMultiLineDeclaration || line.trim().startsWith('export')) {
      currentDeclaration += `${line}\n`
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      console.log(`Current declaration: ${currentDeclaration.trim()}, Bracket count: ${bracketCount}`)

      if (bracketCount === 0 || (i === lines.length - 1)) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          console.log(`Comment block added to dtsLines: ${lastCommentBlock.trimEnd()}`)
          lastCommentBlock = ''
        }
        const processed = processDeclaration(currentDeclaration.trim())
        if (processed) {
          dtsLines.push(processed)
          console.log(`Processed declaration added to dtsLines: ${processed}`)
        }
        isMultiLineDeclaration = false
        currentDeclaration = ''
        bracketCount = 0
      }
      else {
        isMultiLineDeclaration = true
      }
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

  console.log('Final result:', result)
  return result
}

function processImport(importLine: string): string {
  console.log(`Processing import: ${importLine}`)
  if (importLine.includes('type')) {
    const processed = importLine.replace('import', 'import type').replace('type type', 'type')
    console.log(`Processed import: ${processed}`)
    return processed
  }
  return importLine
}

function processDeclaration(declaration: string): string {
  console.log(`Processing declaration: ${declaration}`)
  if (declaration.startsWith('export const')) {
    return processConstDeclaration(declaration)
  }
  else if (declaration.startsWith('export interface')) {
    return processInterfaceDeclaration(declaration)
  }
  else if (declaration.startsWith('export type')) {
    return processTypeDeclaration(declaration)
  }
  else if (declaration.startsWith('export function') || declaration.startsWith('export async function')) {
    return processFunctionDeclaration(declaration)
  }
  else if (declaration.startsWith('export default')) {
    return `${declaration};`
  }
  console.log(`Declaration not processed: ${declaration}`)
  return declaration
}

function processConstDeclaration(declaration: string): string {
  console.log(`Processing const declaration: ${declaration}`)
  const equalIndex = declaration.indexOf('=')
  if (equalIndex === -1)
    return declaration

  const name = declaration.slice(0, equalIndex).trim().replace('export const', '').trim()
  const value = declaration.slice(equalIndex + 1).trim().replace(/;$/, '')

  if (value.startsWith('{')) {
    const objectType = parseObjectLiteral(value)
    const result = `export declare const ${name}: ${objectType};`
    console.log(`Processed const declaration: ${result}`)
    return result
  }
  else {
    const valueType = inferValueType(value)
    const result = `export declare const ${name}: ${valueType};`
    console.log(`Processed const declaration: ${result}`)
    return result
  }
}

function processInterfaceDeclaration(declaration: string): string {
  console.log(`Processing interface declaration: ${declaration}`)
  const result = declaration.replace('export interface', 'export declare interface')
  console.log(`Processed interface declaration: ${result}`)
  return result
}

function processTypeDeclaration(declaration: string): string {
  console.log(`Processing type declaration: ${declaration}`)
  const result = declaration.replace('export type', 'export declare type')
  console.log(`Processed type declaration: ${result}`)
  return result
}

function processFunctionDeclaration(declaration: string): string {
  console.log(`Processing function declaration: ${declaration}`)
  const functionBody = declaration.match(/\{[\s\S]*\}/)?.[0] || ''
  const result = `export declare ${declaration.replace(functionBody, '').trim()};`
  console.log(`Processed function declaration: ${result}`)
  return result
}

function parseObjectLiteral(objectLiteral: string): string {
  console.log(`Parsing object literal: ${objectLiteral}`)
  const content = objectLiteral.replace(/^\{|\}$/g, '').split(',').map(pair => pair.trim())
  const parsedProperties = content.map((pair) => {
    const [key, value] = pair.split(':').map(p => p.trim())
    return `  ${key}: ${inferValueType(value)};`
  })
  const result = `{\n${parsedProperties.join('\n')}\n}`
  console.log(`Parsed object literal: ${result}`)
  return result
}

function inferValueType(value: string): string {
  console.log(`Inferring value type for: ${value}`)
  if (value === 'true' || value === 'false')
    return value
  if (!Number.isNaN(Number(value)))
    return value
  if (value.startsWith('\'') || value.startsWith('"'))
    return value
  console.log(`Defaulting to string for: ${value}`)
  return 'string' // Default to string for other cases
}

function cleanOutput(output: string): string {
  console.log('Cleaning output')
  const result = output
    .replace(/\{\s*\}/g, '{}')
    .replace(/\s*;\s*(?=\}|$)/g, ';')
    .replace(/\n+/g, '\n')
    .replace(/;\n\}/g, ';\n  }')
    .replace(/\{;/g, '{')
    .trim()
  console.log('Cleaned output:', result)
  return result
}
