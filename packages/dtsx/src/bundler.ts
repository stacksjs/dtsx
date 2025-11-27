import type { Declaration, DtsGenerationConfig } from './types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { extractDeclarations } from './extractor'

/**
 * Bundle configuration options
 */
export interface BundleConfig {
  /** Entry point file(s) */
  entry: string | string[]
  /** Output file path */
  output: string
  /** Module name for UMD/AMD bundles */
  name?: string
  /** Include source file comments */
  includeSourceComments?: boolean
  /** Keep individual file sections */
  preserveFileSections?: boolean
  /** External modules to exclude from bundling */
  externals?: string[]
  /** Banner comment to add at top */
  banner?: string
  /** Footer comment to add at bottom */
  footer?: string
  /** Sort declarations alphabetically */
  sortDeclarations?: boolean
  /** Merge duplicate declarations */
  mergeDuplicates?: boolean
  /** Generate ambient module wrapper */
  ambient?: boolean
  /** Module declaration name for ambient */
  moduleName?: string
  /** Include triple-slash references */
  includeReferences?: boolean
  /** References to include */
  references?: string[]
}

/**
 * Bundle result containing the combined declarations
 */
export interface BundleResult {
  content: string
  files: string[]
  declarationCount: number
  importCount: number
  exportCount: number
  /** Size in bytes */
  size: number
  /** Warnings generated during bundling */
  warnings: string[]
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
    if (!sourceCode)
      continue

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

    if (aIndex !== -1 && bIndex !== -1)
      return aIndex - bIndex
    if (aIndex !== -1)
      return -1
    if (bIndex !== -1)
      return 1

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

  const content = output.join('\n')
  return {
    content,
    files,
    declarationCount: totalDeclarations,
    importCount: totalImports,
    exportCount: totalExports,
    size: Buffer.byteLength(content, 'utf8'),
    warnings: [],
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
  if (!params || params.length === 0)
    return ''

  return params.map((p) => {
    let param = ''
    if (p.rest)
      param += '...'
    param += p.name
    if (p.optional)
      param += '?'
    if (p.type)
      param += `: ${p.type}`
    if (p.defaultValue)
      param += ` = ${p.defaultValue}`
    return param
  }).join(', ')
}

/**
 * Bundle multiple .d.ts files into a single file
 */
export async function bundleDtsFiles(
  files: string[],
  config: Partial<BundleConfig> = {},
): Promise<BundleResult> {
  const warnings: string[] = []
  const allImports = new Map<string, ImportInfo>()
  const allDeclarations: string[] = []
  const processedFiles: string[] = []
  const seenDeclarations = new Set<string>()

  let declarationCount = 0
  let importCount = 0
  let exportCount = 0

  // Process each file
  for (const file of files) {
    if (!existsSync(file)) {
      warnings.push(`File not found: ${file}`)
      continue
    }

    const content = readFileSync(file, 'utf-8')
    processedFiles.push(file)

    // Parse the .d.ts content
    const lines = content.split('\n')
    let currentDeclaration: string[] = []
    let braceCount = 0
    let inDeclaration = false

    for (const line of lines) {
      const trimmed = line.trim()

      // Skip empty lines outside declarations
      if (!trimmed && !inDeclaration)
        continue

      // Handle imports
      if (trimmed.startsWith('import ')) {
        importCount++
        const importMatch = trimmed.match(/import\s+(type\s+)?(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/)
        if (importMatch) {
          const [, typeOnly, namedImports, _defaultImport, _namespaceImport, source] = importMatch

          // Skip if external
          if (config.externals?.some(ext => source.startsWith(ext))) {
            allDeclarations.push(trimmed)
            continue
          }

          // Skip relative imports (they're being bundled)
          if (source.startsWith('.'))
            continue

          if (!allImports.has(source)) {
            allImports.set(source, {
              source,
              specifiers: new Map(),
              isTypeOnly: !!typeOnly,
              isSideEffect: false,
            })
          }

          const info = allImports.get(source)!

          if (namedImports) {
            const specs = namedImports.split(',').map(s => s.trim())
            for (const spec of specs) {
              const [name, alias] = spec.split(/\s+as\s+/).map(s => s.trim())
              const isType = name.startsWith('type ')
              const actualName = isType ? name.replace('type ', '') : name
              info.specifiers.set(alias || actualName, {
                name: actualName,
                alias: alias !== actualName ? alias : undefined,
                isType,
              })
            }
          }

          if (!typeOnly) {
            info.isTypeOnly = false
          }
        }
        continue
      }

      // Handle declarations
      const isDeclarationStart = /^(export\s+)?(declare\s+)?(interface|type|class|function|const|let|var|enum|namespace|module)\s/.test(trimmed)

      if (isDeclarationStart) {
        inDeclaration = true
        currentDeclaration = [line]
        braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

        // Single-line declaration
        if (braceCount === 0 && (trimmed.endsWith(';') || !trimmed.includes('{'))) {
          // Check for duplicates
          const declKey = extractDeclarationKey(trimmed)
          if (!seenDeclarations.has(declKey) || !config.mergeDuplicates) {
            seenDeclarations.add(declKey)
            allDeclarations.push(line)
            declarationCount++
            if (trimmed.startsWith('export'))
              exportCount++
          }
          inDeclaration = false
          currentDeclaration = []
        }
      }
      else if (inDeclaration) {
        currentDeclaration.push(line)
        braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length

        if (braceCount <= 0) {
          const fullDecl = currentDeclaration.join('\n')
          const declKey = extractDeclarationKey(currentDeclaration[0])

          if (!seenDeclarations.has(declKey) || !config.mergeDuplicates) {
            seenDeclarations.add(declKey)
            allDeclarations.push(fullDecl)
            declarationCount++
            if (currentDeclaration[0].trim().startsWith('export'))
              exportCount++
          }

          inDeclaration = false
          currentDeclaration = []
        }
      }
      else if (trimmed.startsWith('export ') && !trimmed.includes('declare')) {
        // Re-export statements
        allDeclarations.push(line)
        exportCount++
      }
    }
  }

  // Build output
  const output: string[] = []

  // Add banner
  if (config.banner) {
    output.push(config.banner)
    output.push('')
  }

  // Add triple-slash references
  if (config.includeReferences && config.references) {
    for (const ref of config.references) {
      output.push(`/// <reference types="${ref}" />`)
    }
    output.push('')
  }

  // Add imports
  const sortedImports = Array.from(allImports.values()).sort((a, b) =>
    a.source.localeCompare(b.source),
  )

  for (const info of sortedImports) {
    if (info.specifiers.size > 0) {
      const specs = Array.from(info.specifiers.values())
      const specStrings = specs.map((s) => {
        const typePrefix = s.isType ? 'type ' : ''
        return s.alias ? `${typePrefix}${s.name} as ${s.alias}` : `${typePrefix}${s.name}`
      })
      const typePrefix = info.isTypeOnly ? 'type ' : ''
      output.push(`import ${typePrefix}{ ${specStrings.join(', ')} } from '${info.source}';`)
    }
  }

  if (sortedImports.length > 0) {
    output.push('')
  }

  // Add declarations
  if (config.ambient && config.moduleName) {
    output.push(`declare module '${config.moduleName}' {`)
    for (const decl of allDeclarations) {
      // Indent and remove 'declare' keyword inside module
      const indented = decl.split('\n').map(line => `  ${line.replace(/^(\s*)(export\s+)?declare\s+/, '$1$2')}`).join('\n')
      output.push(indented)
    }
    output.push('}')
  }
  else {
    if (config.sortDeclarations) {
      allDeclarations.sort((a, b) => {
        const aName = extractDeclarationKey(a)
        const bName = extractDeclarationKey(b)
        return aName.localeCompare(bName)
      })
    }

    for (const decl of allDeclarations) {
      output.push(decl)
    }
  }

  // Add footer
  if (config.footer) {
    output.push('')
    output.push(config.footer)
  }

  const content = output.join('\n')

  return {
    content,
    files: processedFiles,
    declarationCount,
    importCount,
    exportCount,
    size: Buffer.byteLength(content, 'utf-8'),
    warnings,
  }
}

/**
 * Extract a key for deduplication from a declaration line
 */
function extractDeclarationKey(line: string): string {
  const match = line.match(/(interface|type|class|function|const|let|var|enum|namespace|module)\s+(\w+)/)
  return match ? `${match[1]}:${match[2]}` : line.trim()
}

/**
 * Bundle and write to file
 */
export async function bundleAndWrite(
  files: string[],
  outputPath: string,
  config: Partial<BundleConfig> = {},
): Promise<BundleResult> {
  const result = await bundleDtsFiles(files, config)

  // Ensure output directory exists
  const outDir = dirname(outputPath)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }

  writeFileSync(outputPath, result.content)

  return result
}

/**
 * Create a bundler with preset configuration
 */
export function createBundler(config: Partial<BundleConfig> = {}): {
  bundle: (files: string[]) => Promise<BundleResult>
  bundleAndWrite: (files: string[], output: string) => Promise<BundleResult>
} {
  return {
    bundle: (files: string[]): Promise<BundleResult> => bundleDtsFiles(files, config),
    bundleAndWrite: (files: string[], output: string): Promise<BundleResult> =>
      bundleAndWrite(files, output, { ...config, output }),
  }
}

/**
 * Resolve entry files from glob patterns
 */
export async function resolveEntryFiles(
  patterns: string | string[],
  cwd: string = process.cwd(),
): Promise<string[]> {
  const patternList = Array.isArray(patterns) ? patterns : [patterns]
  const files: string[] = []

  for (const pattern of patternList) {
    if (pattern.includes('*')) {
      // Would need glob library for full support
      // For now, just handle direct file paths
      continue
    }

    const fullPath = resolve(cwd, pattern)
    if (existsSync(fullPath)) {
      files.push(fullPath)
    }
  }

  return files
}
