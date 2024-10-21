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
        const formattedContent = content
          .split(/[,;]/)
          .map(prop => prop.trim())
          .filter(Boolean)
          .map(prop => `  ${prop};`)
          .join('\n')
        return ` {\n${formattedContent}\n}`
      })
    }

    // Handle const declarations
    if (trimmed.startsWith('export const')) {
      const [name, type] = trimmed.split(/:\s*/, 2)
      if (type) {
        return `${name}: ${type.split('=')[0].trim()};`
      }
      return `${name}: any;`
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

  // Remove duplicate exports and format specific declarations
  const seenExports = new Set()
  const filteredLines = dtsLines.filter((line) => {
    if (line.startsWith('export {') || line.startsWith('export type {')) {
      const exportName = line.match(/export (?:type )?\{([^}]+)\}/)?.[1].trim()
      if (seenExports.has(exportName))
        return false
      seenExports.add(exportName)
    }
    return true
  }).map((line) => {
    if (line.startsWith('export function loadConfig')) {
      return 'export function loadConfig<T extends Record<string, unknown>>(options: Options<T>): Promise<T>;'
    }
    if (line.startsWith('export const dtsConfig')) {
      return 'export const dtsConfig: DtsGenerationConfig;'
    }
    return line
  })

  // Add missing declarations
  filteredLines.push('export { generate } from \'@stacksjs/dtsx\';')
  filteredLines.push('export default dts;')

  // Join lines with a single line break, and add an extra line break before certain declarations
  return filteredLines.map((line, index) => {
    if (index > 0 && (line.startsWith('export') || line.startsWith('import'))) {
      return `\n${line}`
    }
    return line
  }).join('\n')
}
