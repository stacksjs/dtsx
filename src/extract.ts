import { readFile } from 'node:fs/promises'
import { formatComment, formatDeclarations } from './utils'

export async function extractTypeFromSource(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath, 'utf-8')
  let declarations = ''
  const usedTypes = new Set<string>()
  const importMap = new Map<string, Set<string>>()

  // Handle re-exports
  const reExportRegex = /export\s*(?:\*|\{[^}]*\})\s*from\s*['"][^'"]+['"]/g
  const reExports = fileContent.match(reExportRegex) || []
  declarations += `${reExports.join('\n')}\n`

  // Capture all imports
  const importRegex = /import\s+(?:(type)\s+)?(?:(\{[^}]+\})|(\w+))(?:\s*,\s*(?:(\{[^}]+\})|(\w+)))?\s+from\s+['"]([^'"]+)['"]/g
  const imports = Array.from(fileContent.matchAll(importRegex))

  imports.forEach(([, isTypeImport, namedImports1, defaultImport1, namedImports2, defaultImport2, from]) => {
    if (!importMap.has(from)) {
      importMap.set(from, new Set())
    }

    const processImports = (imports: string | undefined, _isType: boolean) => {
      if (imports) {
        const types = imports.replace(/[{}]/g, '').split(',').map((t) => {
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
    if (defaultImport1)
      importMap.get(from)!.add(defaultImport1)
    if (defaultImport2)
      importMap.get(from)!.add(defaultImport2)
  })

  // Handle exports with comments
  const exportLines = fileContent.split('\n')
  let i = 0
  while (i < exportLines.length) {
    let comment = ''
    let exportStatement = ''

    // Collect comment
    if (exportLines[i].trim().startsWith('/**')) {
      while (i < exportLines.length && !exportLines[i].includes('*/')) {
        comment += `${exportLines[i]}\n`
        i++
      }
      comment += `${exportLines[i]}\n`
      i++
    }

    // Collect export statement
    if (i < exportLines.length && exportLines[i].trim().startsWith('export')) {
      exportStatement = exportLines[i]
      i++
      while (i < exportLines.length && !exportLines[i].trim().startsWith('export') && !exportLines[i].trim().startsWith('/**')) {
        exportStatement += `\n${exportLines[i]}`
        i++
      }
    }

    if (exportStatement) {
      const formattedComment = comment ? formatComment(comment.trim()) : ''
      let formattedExport = exportStatement.trim()

      if (formattedExport.startsWith('export function') || formattedExport.startsWith('export async function')) {
        formattedExport = formattedExport.replace(/^export\s+(async\s+)?function/, 'export declare function')
        const functionSignature = formattedExport.match(/^.*?\)/)
        if (functionSignature) {
          let params = functionSignature[0].slice(functionSignature[0].indexOf('(') + 1, -1)
          params = params.replace(/\s*=[^,)]+/g, '') // Remove default values
          const returnType = formattedExport.match(/\):\s*([^{]+)/)
          formattedExport = `export declare function ${formattedExport.split('function')[1].split('(')[0].trim()}(${params})${returnType ? `: ${returnType[1].trim()}` : ''};`
        }
      }
      else if (formattedExport.startsWith('export const') || formattedExport.startsWith('export let') || formattedExport.startsWith('export var')) {
        formattedExport = formattedExport.replace(/^export\s+(const|let|var)/, 'export declare $1')
        formattedExport = `${formattedExport.split('=')[0].trim()};`
      }

      declarations += `${formattedComment}\n${formattedExport}\n\n`

      // Add types used in the export to usedTypes
      const typeRegex = /\b([A-Z]\w+)(?:<[^>]*>)?/g
      const types = Array.from(formattedExport.matchAll(typeRegex))
      types.forEach(([, type]) => usedTypes.add(type))
    }

    if (!exportStatement && !comment) {
      i++
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
    declarations = `${importDeclarations}\n${declarations}`
  }

  // Apply final formatting
  return formatDeclarations(declarations)
}
