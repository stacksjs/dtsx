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
    const trimmed = declaration.trim()

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
      const [name, rest] = trimmed.split('=')
      const type = name.split(':')[1]?.trim() || 'any'
      return `export declare const ${name.split(':')[0].replace('export const', '').trim()}: ${type};`
    }

    // Handle interface declarations
    if (trimmed.startsWith('export interface')) {
      return trimmed.replace(/\s*\{\s*([^}]+)\}\s*$/, (_, content) => {
        const formattedContent = content
          .split(';')
          .map(prop => prop.trim())
          .filter(Boolean)
          .map(prop => `  ${prop};`)
          .join('\n')
        return ` {\n${formattedContent}\n}`
      }).replace('export ', 'export declare ')
    }

    // Handle type declarations
    if (trimmed.startsWith('export type')) {
      return `export declare ${trimmed.replace('export ', '')}`
    }

    // Handle function declarations
    if (trimmed.includes('function')) {
      return `export declare ${trimmed.replace('export ', '').split('{')[0].trim()};`
    }

    // Handle default exports
    if (trimmed.startsWith('export default')) {
      return `export default ${trimmed.replace('export default ', '')};`
    }

    return trimmed
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
