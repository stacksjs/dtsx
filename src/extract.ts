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
  let dtsLines: string[] = []

  let isMultiLineDeclaration = false
  let currentDeclaration = ''
  let bracketCount = 0
  let lastCommentBlock = ''

  function processDeclaration(declaration: string): string {
    const trimmed = declaration.trim()

    // Handle imports
    if (trimmed.startsWith('import')) {
      return trimmed.endsWith(';') ? trimmed : `${trimmed};`
    }

    // Handle exports from other files
    if (trimmed.startsWith('export') && trimmed.includes('from')) {
      return trimmed.endsWith(';') ? trimmed : `${trimmed};`
    }

    // Handle interfaces and types
    if (trimmed.startsWith('export interface') || trimmed.startsWith('export type') || trimmed.startsWith('interface')) {
      return trimmed.replace(/\s*\{\s*([^}]+)\}\s*$/, (_, content) => {
        const formattedContent = content.split(';').map(prop => prop.trim()).filter(Boolean).join(';\n  ')
        return ` {\n  ${formattedContent}\n}`
      })
    }

    // Handle const declarations
    if (trimmed.startsWith('export const')) {
      const [name, rest] = trimmed.split(/:\s*/, 2)
      if (rest) {
        const type = rest.split('=')[0].trim()
        return `${name}: ${type};`
      }
      return `${trimmed.split('=')[0].trim()}: any;`
    }

    // Handle function declarations
    if (trimmed.includes('function')) {
      return `${trimmed.split('{')[0].trim()};`
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
          dtsLines.push(lastCommentBlock.trim())
          lastCommentBlock = ''
        }
        dtsLines.push(processDeclaration(currentDeclaration))
        isMultiLineDeclaration = false
        currentDeclaration = ''
      }
    }
    else if (line.startsWith('export') || line.startsWith('import') || line.startsWith('interface')) {
      bracketCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

      if (bracketCount === 0) {
        if (lastCommentBlock) {
          dtsLines.push(lastCommentBlock.trim())
          lastCommentBlock = ''
        }
        dtsLines.push(processDeclaration(line))
      }
      else {
        isMultiLineDeclaration = true
        currentDeclaration = line
      }
    }
  }

  // Remove duplicate default export
  const defaultExports = dtsLines.filter(line => line.startsWith('export default'))
  if (defaultExports.length > 1) {
    dtsLines = dtsLines.filter(line => line !== 'export default dts;')
  }

  return dtsLines.join('\n')
}
