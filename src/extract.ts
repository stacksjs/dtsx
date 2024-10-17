import { readFile } from 'node:fs/promises'
import { formatComment, formatDeclarations } from './utils'

export async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''
  let usedTypes = new Set<string>()
  let importMap = new Map<string, Set<string>>()

  // Handle re-exports
  const reExportRegex = /export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g
  let reExportMatch
  while ((reExportMatch = reExportRegex.exec(fileContent)) !== null) {
    declarations += `${reExportMatch[0]}\n`
  }

  // Capture all imports
  const importRegex = /import\s+(?:(type)\s+)?(?:(\{[^}]+\})|(\w+))(?:\s*,\s*(?:(\{[^}]+\})|(\w+)))?\s+from\s+['"]([^'"]+)['"]/g
  let importMatch
  while ((importMatch = importRegex.exec(fileContent)) !== null) {
    const [, isTypeImport, namedImports1, defaultImport1, namedImports2, defaultImport2, from] = importMatch
    if (!importMap.has(from)) {
      importMap.set(from, new Set())
    }

    const processImports = (imports: string | undefined, isType: boolean) => {
      if (imports) {
        const types = imports.replace(/[{}]/g, '').split(',').map(t => {
          const [name, alias] = t.split(' as ').map(s => s.trim())
          return { name: name.replace(/^type\s+/, ''), alias: alias || name.replace(/^type\s+/, '') }
        })
        types.forEach(({ name }) => {
          importMap.get(from)!.add(name)
        })
      }
    }

    processImports(namedImports1, !!isTypeImport)
    processImports(namedImports2, !!isTypeImport)
    if (defaultImport1) importMap.get(from)!.add(defaultImport1)
    if (defaultImport2) importMap.get(from)!.add(defaultImport2)
  }

  // Handle exports with comments
  const exportRegex = /(\/\*\*[\s\S]*?\*\/\s*)?(export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type)\s+\w+[\s\S]*?)(?=\n\s*(?:\/\*\*|export|$))/g;
  let match
  while ((match = exportRegex.exec(fileContent)) !== null) {
    const [, comment, exportStatement] = match
    const formattedComment = comment ? formatComment(comment.trim()) : ''
    let formattedExport = exportStatement.trim()

    if (formattedExport.startsWith('export function') || formattedExport.startsWith('export async function')) {
      formattedExport = formattedExport.replace(/^export\s+(async\s+)?function/, 'export declare function')
      const functionSignature = formattedExport.match(/^.*?\)/)
      if (functionSignature) {
        let params = functionSignature[0].slice(functionSignature[0].indexOf('(') + 1, -1)
        params = params.replace(/\s*=\s*[^,)]+/g, '') // Remove default values
        const returnType = formattedExport.match(/\):\s*([^{]+)/)
        formattedExport = `export declare function ${formattedExport.split('function')[1].split('(')[0].trim()}(${params})${returnType ? `: ${returnType[1].trim()}` : ''};`
      }
    } else if (formattedExport.startsWith('export const') || formattedExport.startsWith('export let') || formattedExport.startsWith('export var')) {
      formattedExport = formattedExport.replace(/^export\s+(const|let|var)/, 'export declare $1')
      formattedExport = formattedExport.split('=')[0].trim() + ';'
    }

    declarations += `${formattedComment}\n${formattedExport}\n\n`

    // Add types used in the export to usedTypes
    const typeRegex = /\b([A-Z]\w+)(?:<[^>]*>)?/g
    let typeMatch
    while ((typeMatch = typeRegex.exec(formattedExport)) !== null) {
      usedTypes.add(typeMatch[1])
    }
  }

  // Generate import statements for used types
  let importDeclarations = ''
  importMap.forEach((types, path) => {
    const usedTypesFromPath = [...types].filter(type => usedTypes.has(type))
    if (usedTypesFromPath.length > 0) {
      importDeclarations += `import type { ${usedTypesFromPath.join(', ')} } from '${path}'\n`
    }
  })

  if (importDeclarations) {
    declarations = importDeclarations + '\n' + declarations
  }

  // Apply final formatting
  return formatDeclarations(declarations, false)
}
