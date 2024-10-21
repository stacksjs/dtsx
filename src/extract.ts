const DEBUG = true // Set to false to disable debug logs

function logDebug(...messages: unknown[]): void {
  if (DEBUG) {
    console.log(...messages)
  }
}

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
  logDebug('Starting generateDtsTypes')
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
    logDebug(`Processing line ${i + 1}: ${line}`)

    if (line.trim().startsWith('/**') || line.trim().startsWith('*') || line.trim().startsWith('*/')) {
      if (line.trim().startsWith('/**'))
        lastCommentBlock = ''
      lastCommentBlock += `${line}\n`
      logDebug('Comment line added to lastCommentBlock')
      continue
    }

    if (line.trim().startsWith('import')) {
      const processedImport = processImport(line)
      imports.push(processedImport)
      logDebug(`Processed import: ${processedImport}`)
      continue
    }

    if (line.trim().startsWith('export default')) {
      defaultExport = `\n${line.trim()};`
      logDebug(`Default export found: ${defaultExport}`)
      continue
    }

    if (line.trim().startsWith('export') || isMultiLineDeclaration) {
      currentDeclaration += `${line}\n`
      bracketCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length
      isMultiLineDeclaration = bracketCount > 0

      if (!isMultiLineDeclaration) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trimEnd())
          logDebug(`Comment block added to dtsLines: ${lastCommentBlock.trimEnd()}`)
          lastCommentBlock = ''
        }
        const processed = processDeclaration(currentDeclaration.trim())
        if (processed) {
          dtsLines.push(processed)
          logDebug(`Processed declaration added to dtsLines: ${processed}`)
        }
        currentDeclaration = ''
        bracketCount = 0
      }
    }
  }

  const result = cleanOutput([...imports, '', ...dtsLines, '', ...exports].filter(Boolean).join('\n'))
  const finalResult = defaultExport ? `${result}\n${defaultExport}` : result

  logDebug('Final result:', finalResult)
  return finalResult
}

function processImport(importLine: string): string {
  logDebug(`Processing import: ${importLine}`)
  if (importLine.includes('type')) {
    return importLine.replace('import', 'import type').replace('type type', 'type')
  }
  return importLine
}

function processDeclaration(declaration: string): string {
  logDebug(`Processing declaration: ${declaration}`)
  if (declaration.startsWith('export const')) {
    return processConstDeclaration(declaration)
  }
  else if (declaration.startsWith('export interface')) {
    return processInterfaceDeclaration(declaration)
  }
  else if (declaration.startsWith('interface')) {
    return processInterfaceDeclaration(declaration)
  }
  else if (declaration.startsWith('export type {')) {
    return processTypeOnlyExport(declaration)
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
  logDebug(`Declaration not processed: ${declaration}`)
  return declaration
}

function processConstDeclaration(declaration: string): string {
  logDebug(`Processing const declaration: ${declaration}`)
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
  logDebug(`Processing interface declaration: ${declaration}`)
  const lines = declaration.split('\n')
  const interfaceName = lines[0].split('interface')[1].split('{')[0].trim()
  const interfaceBody = lines.slice(1, -1).map(line => `  ${line.trim()}`).join('\n')
  const result = `export declare interface ${interfaceName} {\n${interfaceBody}\n}`
  logDebug(`Processed interface declaration: ${result}`)
  return result
}

function processTypeOnlyExport(declaration: string): string {
  logDebug(`Processing type-only export: ${declaration}`)
  return declaration.replace('export type', 'export declare type')
}

function processTypeDeclaration(declaration: string): string {
  logDebug(`Processing type declaration: ${declaration}`)
  const lines = declaration.split('\n')
  const firstLine = lines[0]
  const typeName = firstLine.split('type')[1].split('=')[0].trim()
  const typeBody = firstLine.split('=')[1]?.trim() || lines.slice(1).join('\n').trim().replace(/;$/, '')
  const result = `export declare type ${typeName} = ${typeBody};`
  logDebug(`Processed type declaration: ${result}`)
  return result
}

function processFunctionDeclaration(declaration: string): string {
  logDebug(`Processing function declaration: ${declaration}`)
  const functionSignature = declaration.split('{')[0].trim()
  const asyncKeyword = functionSignature.includes('async') ? 'async ' : ''
  const functionName = functionSignature.replace('export ', '').replace('async ', '').split('(')[0].trim()
  const params = functionSignature.split('(')[1].split(')')[0].trim()
  const returnType = getReturnType(declaration)
  const result = `export declare ${asyncKeyword}function ${functionName}(${params}): ${returnType};`
  logDebug(`Processed function declaration: ${result}`)
  return result
}

function getReturnType(declaration: string): string {
  const returnTypeMatch = declaration.match(/:\s*([^\s{]+)/)
  return returnTypeMatch ? returnTypeMatch[1] : 'void'
}

function cleanOutput(output: string): string {
  logDebug('Cleaning output')

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
    .replace(/,\n\s*;/g, ';')
    .replace(/;\s*\/\/\s*/g, '; // ')
    .replace(/,\s*;/g, ';')
    .replace(/;[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*\}/g, ';\n}')
    .replace(/;\s*\/\/\s*/g, '; // ')
    .replace(/;\s*\}/g, ';\n}')
    .replace(/;\s*\/\/\s*/g, '; // ')
    .replace(/export declare async function/g, 'export declare function')
    .trim()

  logDebug('Cleaned output:', result)

  return result
}
