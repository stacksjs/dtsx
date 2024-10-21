/* eslint-disable no-console */
const DEBUG = true // Set to false to disable debug logs

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

function generateDtsTypes(sourceCode: string): string {
  if (DEBUG)
    console.log('Starting generateDtsTypes')
  const lines = sourceCode.split('\n')
  const dtsLines: string[] = []
  const imports: string[] = []
  const exports: string[] = []
  let defaultExport = ''

  let isMultiLineDeclaration = false
  let currentDeclaration = ''
  let bracketCount = 0
  let lastCommentBlock = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (DEBUG)
      console.log(`Processing line ${i + 1}: ${line}`)

    if (line.trim().startsWith('/**') || line.trim().startsWith('*') || line.trim().startsWith('*/')) {
      if (line.trim().startsWith('/**'))
        lastCommentBlock = ''
      lastCommentBlock += `${line}\n`
      if (DEBUG)
        console.log('Comment line added to lastCommentBlock')
      continue
    }

    if (line.trim().startsWith('import')) {
      const processedImport = processImport(line)
      imports.push(processedImport)
      if (DEBUG)
        console.log(`Processed import: ${processedImport}`)
      continue
    }

    if (line.trim().startsWith('export default')) {
      defaultExport = `\n${line.trim()};`
      if (DEBUG)
        console.log(`Default export found: ${defaultExport}`)
      continue
    }

    if (line.trim().startsWith('export') || isMultiLineDeclaration) {
      currentDeclaration += `${line}\n`
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      isMultiLineDeclaration = bracketCount > 0

      if (!isMultiLineDeclaration) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          if (DEBUG)
            console.log(`Comment block added to dtsLines: ${lastCommentBlock.trimEnd()}`)
          lastCommentBlock = ''
        }
        const processed = processDeclaration(currentDeclaration.trim())
        if (processed) {
          dtsLines.push(processed)
          if (DEBUG)
            console.log(`Processed declaration added to dtsLines: ${processed}`)
        }
        currentDeclaration = ''
        bracketCount = 0
      }
    }
  }

  const result = cleanOutput([...imports, '', ...dtsLines, '', ...exports, defaultExport].filter(Boolean).join('\n'))
  if (DEBUG)
    console.log('Final result:', result)
  return result
}

function processImport(importLine: string): string {
  if (DEBUG)
    console.log(`Processing import: ${importLine}`)
  if (importLine.includes('type')) {
    return importLine.replace('import', 'import type').replace('type type', 'type')
  }
  return importLine
}

function processDeclaration(declaration: string): string {
  if (DEBUG)
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
  if (DEBUG)
    console.log(`Declaration not processed: ${declaration}`)
  return declaration
}

function processConstDeclaration(declaration: string): string {
  if (DEBUG)
    console.log(`Processing const declaration: ${declaration}`)
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const name = firstLine.split('export const')[1].split('=')[0].trim().split(':')[0].trim()

  const properties = lines.slice(1, -1).map((line) => {
    let inString = false
    let stringChar = ''
    let commentIndex = -1

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (inString) {
        if (char === stringChar && line[i - 1] !== '\\') {
          inString = false
        }
      }
      else {
        if (char === '"' || char === '\'' || char === '`') {
          inString = true
          stringChar = char
        }
        else if (char === '/' && line[i + 1] === '//') {
          commentIndex = i
          break
        }
      }
    }

    const hasComment = commentIndex !== -1
    const mainPart = hasComment ? line.slice(0, commentIndex) : line
    let comment = hasComment ? line.slice(commentIndex) : ''

    if (hasComment && !comment.startsWith(' //')) {
      comment = ` //${comment.slice(2)}`
    }

    const [key, ...valueParts] = mainPart.split(':')
    let value = valueParts.join(':').trim()
    if (value.endsWith(',')) {
      value = value.slice(0, -1)
    }

    return `  ${key.trim()}: ${value}${comment};`
  }).join('\n')

  return `export declare const ${name}: {\n${properties}\n};`
}

function processInterfaceDeclaration(declaration: string): string {
  if (DEBUG)
    console.log(`Processing interface declaration: ${declaration}`)
  const lines = declaration.split('\n')
  const interfaceName = lines[0].split('interface')[1].split('{')[0].trim()
  const interfaceBody = lines.slice(1, -1).map(line => `  ${line.trim()}`).join('\n')
  const result = `export declare interface ${interfaceName} {\n${interfaceBody}\n}`
  if (DEBUG)
    console.log(`Processed interface declaration: ${result}`)
  return result
}

function processTypeDeclaration(declaration: string): string {
  if (DEBUG)
    console.log(`Processing type declaration: ${declaration}`)
  const lines = declaration.split('\n')
  const typeName = lines[0].split('type')[1].split('=')[0].trim()
  const typeBody = lines.slice(1).map(line => `  ${line.trim()}`).join('\n')
  const result = `export declare type ${typeName} = ${typeBody}`
  if (DEBUG)
    console.log(`Processed type declaration: ${result}`)
  return result
}

function processFunctionDeclaration(declaration: string): string {
  if (DEBUG)
    console.log(`Processing function declaration: ${declaration}`)
  const functionSignature = declaration.split('{')[0].trim()
  const result = `export declare ${functionSignature.replace('export ', '')};`
  if (DEBUG)
    console.log(`Processed function declaration: ${result}`)
  return result
}

function cleanOutput(output: string): string {
  if (DEBUG)
    console.log('Cleaning output')

  const result = output
    .replace(/\{\s*\}/g, '{}')
    .replace(/\s*;\s*(?=\}|$)/g, ';')
    .replace(/\n+/g, '\n')
    .replace(/;\n\}/g, ';\n}')
    .replace(/\{;/g, '{')
    .replace(/\};\n/g, '}\n\n')
    .replace(/\}\n(?!$)/g, '}\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/;\n(\s*)\}/g, ';\n$1\n$1}')
    .replace(/,\n\s*;/g, ';') // Remove unnecessary commas before semicolons
    .replace(/;\s*\/\/\s*/g, '; // ') // Ensure comments are properly formatted
    .replace(/,\s*;/g, ';') // Remove trailing commas before semicolons
    .replace(/;[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*\}/g, ';\n}') // Ensure closing braces are on their own lines
    .replace(/;\s*\/\/\s*/g, '; // ') // Ensure comments are properly formatted
    .replace(/;\s*\}/g, ';\n}') // Ensure closing braces are on their own lines
    .replace(/;\s*\/\/\s*/g, '; // ') // Ensure comments are properly formatted
    .trim()

  if (DEBUG)
    console.log('Cleaned output:', result)

  return result
}
