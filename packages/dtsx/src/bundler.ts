import type { Declaration, DtsGenerationConfig } from './types'
import { basename, dirname, relative } from 'node:path'
import { extractDeclarations } from './extractor'

/**
 * Bundle result containing the combined declarations
 */
export interface BundleResult {
  content: string
  files: string[]
  declarationCount: number
  importCount: number
  exportCount: number
}

/**
 * Import tracking for deduplication
 */
interface ImportInfo {
  source: string
  specifiers: Map<string, { name: string, alias?: string, isType: boolean }>
  isTypeOnly: boolean
  isSideEffect: boolean
}

/**
 * Bundle multiple TypeScript files into a single .d.ts file
 */
export async function bundleDeclarations(
  files: string[],
  sourceContents: Map<string, string>,
  config: DtsGenerationConfig,
): Promise<BundleResult> {
  // Track all imports across files for deduplication
  const allImports = new Map<string, ImportInfo>()

  // Track all declarations
  const allDeclarations: Array<{ declaration: Declaration, file: string }> = []

  // Track exported names to avoid duplicates
  const exportedNames = new Set<string>()

  let totalDeclarations = 0
  let totalImports = 0
  let totalExports = 0

  // Process each file
  for (const file of files) {
    const sourceCode = sourceContents.get(file)
    if (!sourceCode) continue

    const declarations = extractDeclarations(sourceCode, file, config.keepComments)
    totalDeclarations += declarations.length

    for (const decl of declarations) {
      if (decl.kind === 'import') {
        totalImports++
        // Merge imports from same source
        const source = decl.source || ''

        // Skip relative imports (internal module references)
        if (source.startsWith('.')) {
          continue
        }

        if (!allImports.has(source)) {
          allImports.set(source, {
            source,
            specifiers: new Map(),
            isTypeOnly: decl.isTypeOnly || false,
            isSideEffect: decl.isSideEffect || false,
          })
        }

        const importInfo = allImports.get(source)!

        // Merge specifiers
        if (decl.specifiers) {
          for (const spec of decl.specifiers) {
            const key = spec.alias || spec.name
            if (!importInfo.specifiers.has(key)) {
              importInfo.specifiers.set(key, {
                name: spec.name,
                alias: spec.alias,
                isType: spec.isType || false,
              })
            }
          }
        }

        // If any import from this source is not type-only, mark as not type-only
        if (!decl.isTypeOnly) {
          importInfo.isTypeOnly = false
        }
      }
      else if (decl.isExported || decl.kind === 'export') {
        totalExports++
        // Skip if already exported
        if (decl.name && exportedNames.has(decl.name)) {
          continue
        }
        if (decl.name) {
          exportedNames.add(decl.name)
        }
        allDeclarations.push({ declaration: decl, file })
      }
    }
  }

  // Build the bundled output
  const output: string[] = []

  // Add banner comment
  output.push('/**')
  output.push(' * Bundled TypeScript declarations')
  output.push(` * Generated from ${files.length} source files`)
  output.push(' */')
  output.push('')

  // Add deduplicated imports
  const sortedImports = Array.from(allImports.values()).sort((a, b) => {
    // Sort by import order priority
    const importOrder = config.importOrder || ['bun']
    const aIndex = importOrder.findIndex(pattern => a.source.startsWith(pattern))
    const bIndex = importOrder.findIndex(pattern => b.source.startsWith(pattern))

    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
    if (aIndex !== -1) return -1
    if (bIndex !== -1) return 1

    return a.source.localeCompare(b.source)
  })

  for (const importInfo of sortedImports) {
    if (importInfo.isSideEffect) {
      output.push(`import '${importInfo.source}';`)
    }
    else if (importInfo.specifiers.size > 0) {
      const specs = Array.from(importInfo.specifiers.values())
      const specStrings = specs.map((s) => {
        const typePrefix = s.isType ? 'type ' : ''
        return s.alias ? `${typePrefix}${s.name} as ${s.alias}` : `${typePrefix}${s.name}`
      })

      const typePrefix = importInfo.isTypeOnly ? 'type ' : ''
      output.push(`import ${typePrefix}{ ${specStrings.join(', ')} } from '${importInfo.source}';`)
    }
  }

  if (sortedImports.length > 0) {
    output.push('')
  }

  // Group declarations by file for better organization
  const declarationsByFile = new Map<string, Declaration[]>()
  for (const { declaration, file } of allDeclarations) {
    if (!declarationsByFile.has(file)) {
      declarationsByFile.set(file, [])
    }
    declarationsByFile.get(file)!.push(declaration)
  }

  // Add declarations grouped by source file
  for (const [file, declarations] of declarationsByFile) {
    const relativePath = relative(config.cwd, file)
    output.push(`// From: ${relativePath}`)

    for (const decl of declarations) {
      // Add leading comments if present and keepComments is enabled
      if (config.keepComments && decl.leadingComments) {
        for (const comment of decl.leadingComments) {
          output.push(comment)
        }
      }

      // Build the declaration text
      output.push(buildDeclarationText(decl))
    }

    output.push('')
  }

  return {
    content: output.join('\n'),
    files,
    declarationCount: totalDeclarations,
    importCount: totalImports,
    exportCount: totalExports,
  }
}

/**
 * Build declaration text from a Declaration object
 */
function buildDeclarationText(decl: Declaration): string {
  // If we have the original text and it's already properly formatted, use it
  if (decl.text) {
    // Ensure it has export if needed
    let text = decl.text.trim()
    if (decl.isExported && !text.startsWith('export')) {
      text = `export ${text}`
    }
    // Ensure it ends with semicolon for declarations
    if (!text.endsWith(';') && !text.endsWith('}')) {
      text += ';'
    }
    return text
  }

  // Build from parts
  const parts: string[] = []

  if (decl.isExported) {
    parts.push('export')
  }

  if (decl.isDefault) {
    parts.push('default')
  }

  switch (decl.kind) {
    case 'function':
      parts.push('declare function')
      parts.push(decl.name)
      if (decl.generics) {
        parts.push(decl.generics)
      }
      parts.push(`(${buildParameters(decl.parameters)})`)
      if (decl.returnType) {
        parts.push(`: ${decl.returnType}`)
      }
      break

    case 'variable':
      parts.push('declare const')
      parts.push(decl.name)
      if (decl.typeAnnotation) {
        parts.push(`: ${decl.typeAnnotation}`)
      }
      break

    case 'interface':
      parts.push('interface')
      parts.push(decl.name)
      if (decl.generics) {
        parts.push(decl.generics)
      }
      if (decl.extends) {
        parts.push(`extends ${decl.extends}`)
      }
      parts.push('{')
      if (decl.members) {
        for (const member of decl.members) {
          parts.push(`  ${member.name}${member.typeAnnotation ? `: ${member.typeAnnotation}` : ''};`)
        }
      }
      parts.push('}')
      break

    case 'type':
      parts.push('type')
      parts.push(decl.name)
      if (decl.generics) {
        parts.push(decl.generics)
      }
      parts.push('=')
      parts.push(decl.typeAnnotation || 'unknown')
      break

    case 'class':
      parts.push('declare class')
      parts.push(decl.name)
      if (decl.generics) {
        parts.push(decl.generics)
      }
      if (decl.extends) {
        parts.push(`extends ${decl.extends}`)
      }
      if (decl.implements && decl.implements.length > 0) {
        parts.push(`implements ${decl.implements.join(', ')}`)
      }
      parts.push('{')
      if (decl.members) {
        for (const member of decl.members) {
          parts.push(`  ${buildDeclarationText(member)}`)
        }
      }
      parts.push('}')
      break

    case 'enum':
      parts.push('declare enum')
      parts.push(decl.name)
      parts.push('{')
      if (decl.members) {
        const enumMembers = decl.members.map(m =>
          m.value !== undefined ? `${m.name} = ${m.value}` : m.name,
        )
        parts.push(`  ${enumMembers.join(',\n  ')}`)
      }
      parts.push('}')
      break

    default:
      return decl.text || ''
  }

  return parts.join(' ')
}

/**
 * Build parameter list string
 */
function buildParameters(params?: Declaration['parameters']): string {
  if (!params || params.length === 0) return ''

  return params.map((p) => {
    let param = ''
    if (p.rest) param += '...'
    param += p.name
    if (p.optional) param += '?'
    if (p.type) param += `: ${p.type}`
    if (p.defaultValue) param += ` = ${p.defaultValue}`
    return param
  }).join(', ')
}
