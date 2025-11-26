import type { Declaration, DtsGenerationConfig } from './types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { extractDeclarations } from './extractor'
import { logger } from './logger'

/**
 * Documentation configuration
 */
export interface DocsConfig {
  /** Output format: 'markdown', 'html', or 'json' */
  format: 'markdown' | 'html' | 'json'
  /** Output directory for documentation */
  outdir: string
  /** Include private members (prefixed with _) */
  includePrivate?: boolean
  /** Include internal members (marked @internal) */
  includeInternal?: boolean
  /** Group by category from @category tag */
  groupByCategory?: boolean
  /** Custom title for the documentation */
  title?: string
  /** Custom description */
  description?: string
  /** Include source links */
  includeSourceLinks?: boolean
  /** Base URL for source links */
  sourceBaseUrl?: string
  /** Include type information in output */
  includeTypes?: boolean
  /** Generate separate files per module */
  splitByModule?: boolean
  /** Template for markdown output */
  template?: 'default' | 'minimal' | 'detailed'
  /** Custom CSS for HTML output */
  customCss?: string
  /** Include navigation sidebar in HTML */
  includeSidebar?: boolean
}

/**
 * Parsed JSDoc information
 */
export interface JSDocInfo {
  description: string
  params: Array<{ name: string, type?: string, description: string, optional?: boolean }>
  returns?: { type?: string, description: string }
  examples: string[]
  tags: Record<string, string[]>
  deprecated?: string
  since?: string
  see: string[]
  throws: Array<{ type?: string, description: string }>
  category?: string
}

/**
 * Documentation entry for a declaration
 */
export interface DocEntry {
  name: string
  kind: Declaration['kind']
  signature: string
  jsdoc: JSDocInfo
  isExported: boolean
  isDefault?: boolean
  sourceFile?: string
  sourceLine?: number
  members?: DocEntry[]
}

/**
 * Documentation output structure
 */
export interface Documentation {
  title: string
  description?: string
  entries: DocEntry[]
  categories: Map<string, DocEntry[]>
  generatedAt: Date
}

/**
 * Parse JSDoc comments from a declaration
 */
export function parseJSDoc(comments: string[] | undefined): JSDocInfo {
  const info: JSDocInfo = {
    description: '',
    params: [],
    examples: [],
    tags: {},
    see: [],
    throws: [],
  }

  if (!comments || comments.length === 0) {
    return info
  }

  for (const comment of comments) {
    // Remove comment delimiters and normalize
    let content = comment
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim()

    // Parse description (text before first @tag)
    const firstTagIndex = content.search(/@\w+/)
    if (firstTagIndex === -1) {
      info.description = content
      continue
    }
    else if (firstTagIndex > 0) {
      info.description = content.slice(0, firstTagIndex).trim()
      content = content.slice(firstTagIndex)
    }

    // Parse tags
    const tagRegex = /@(\w+)(?:\s+\{([^}]+)\})?\s*([^\n@]*(?:\n(?!@)[^\n@]*)*)/g
    let match

    while ((match = tagRegex.exec(content)) !== null) {
      const [, tagName, tagType, tagContent] = match
      const trimmedContent = tagContent.trim()

      switch (tagName) {
        case 'param': {
          const paramMatch = trimmedContent.match(/^(\[)?(\w+)(?:\])?\s*(?:-\s*)?(.*)/)
          if (paramMatch) {
            info.params.push({
              name: paramMatch[2],
              type: tagType,
              description: paramMatch[3].trim(),
              optional: !!paramMatch[1],
            })
          }
          break
        }

        case 'returns':
        case 'return':
          info.returns = {
            type: tagType,
            description: trimmedContent,
          }
          break

        case 'example':
          info.examples.push(trimmedContent)
          break

        case 'deprecated':
          info.deprecated = trimmedContent || 'Deprecated'
          break

        case 'since':
          info.since = trimmedContent
          break

        case 'see':
          info.see.push(trimmedContent)
          break

        case 'throws':
        case 'throw':
          info.throws.push({
            type: tagType,
            description: trimmedContent,
          })
          break

        case 'category':
          info.category = trimmedContent
          break

        default:
          if (!info.tags[tagName]) {
            info.tags[tagName] = []
          }
          info.tags[tagName].push(trimmedContent)
      }
    }
  }

  return info
}

/**
 * Generate documentation entry from a declaration
 */
function createDocEntry(decl: Declaration, sourceFile?: string): DocEntry {
  const jsdoc = parseJSDoc(decl.leadingComments)

  // Build signature
  let signature = ''
  switch (decl.kind) {
    case 'function':
      signature = buildFunctionSignature(decl)
      break
    case 'variable':
      signature = buildVariableSignature(decl)
      break
    case 'interface':
      signature = buildInterfaceSignature(decl)
      break
    case 'type':
      signature = buildTypeSignature(decl)
      break
    case 'class':
      signature = buildClassSignature(decl)
      break
    case 'enum':
      signature = buildEnumSignature(decl)
      break
    default:
      signature = decl.text || decl.name
  }

  const entry: DocEntry = {
    name: decl.name,
    kind: decl.kind,
    signature,
    jsdoc,
    isExported: decl.isExported,
    isDefault: decl.isDefault,
    sourceFile,
  }

  // Add members for interfaces/classes
  if (decl.members && decl.members.length > 0) {
    entry.members = decl.members.map(m => createDocEntry(m, sourceFile))
  }

  return entry
}

/**
 * Build function signature string
 */
function buildFunctionSignature(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  if (decl.isDefault) parts.push('default')
  parts.push('function')
  parts.push(decl.name)

  if (decl.generics) {
    parts.push(decl.generics)
  }

  if (decl.parameters) {
    const params = decl.parameters.map((p) => {
      let param = ''
      if (p.rest) param += '...'
      param += p.name
      if (p.optional) param += '?'
      if (p.type) param += `: ${p.type}`
      return param
    }).join(', ')
    parts.push(`(${params})`)
  }
  else {
    parts.push('()')
  }

  if (decl.returnType) {
    parts.push(`: ${decl.returnType}`)
  }

  return parts.join(' ').replace(/\s+/g, ' ')
}

/**
 * Build variable signature string
 */
function buildVariableSignature(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  parts.push('const')
  parts.push(decl.name)

  if (decl.typeAnnotation) {
    parts.push(`: ${decl.typeAnnotation}`)
  }

  return parts.join(' ')
}

/**
 * Build interface signature string
 */
function buildInterfaceSignature(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  parts.push('interface')
  parts.push(decl.name)

  if (decl.generics) {
    parts.push(decl.generics)
  }

  if (decl.extends) {
    parts.push(`extends ${decl.extends}`)
  }

  return parts.join(' ')
}

/**
 * Build type alias signature string
 */
function buildTypeSignature(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  parts.push('type')
  parts.push(decl.name)

  if (decl.generics) {
    parts.push(decl.generics)
  }

  parts.push('=')

  if (decl.typeAnnotation) {
    parts.push(decl.typeAnnotation)
  }

  return parts.join(' ')
}

/**
 * Build class signature string
 */
function buildClassSignature(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  if (decl.isDefault) parts.push('default')
  parts.push('class')
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

  return parts.join(' ')
}

/**
 * Build enum signature string
 */
function buildEnumSignature(decl: Declaration): string {
  const parts: string[] = []

  if (decl.isExported) parts.push('export')
  parts.push('enum')
  parts.push(decl.name)

  return parts.join(' ')
}

/**
 * Extract documentation from source files
 */
export async function extractDocumentation(
  files: string[],
  config: Partial<DocsConfig> = {},
): Promise<Documentation> {
  const entries: DocEntry[] = []
  const categories = new Map<string, DocEntry[]>()

  for (const file of files) {
    if (!existsSync(file)) {
      logger.warn(`File not found: ${file}`)
      continue
    }

    const sourceCode = readFileSync(file, 'utf-8')
    const declarations = extractDeclarations(sourceCode, file, true)

    for (const decl of declarations) {
      // Skip imports
      if (decl.kind === 'import') continue

      // Skip private members if not configured
      if (!config.includePrivate && decl.name.startsWith('_')) continue

      // Skip internal members if not configured
      if (!config.includeInternal && decl.leadingComments?.some(c => c.includes('@internal'))) continue

      const entry = createDocEntry(decl, file)
      entries.push(entry)

      // Group by category
      if (config.groupByCategory && entry.jsdoc.category) {
        const category = entry.jsdoc.category
        if (!categories.has(category)) {
          categories.set(category, [])
        }
        categories.get(category)!.push(entry)
      }
    }
  }

  return {
    title: config.title || 'API Documentation',
    description: config.description,
    entries,
    categories,
    generatedAt: new Date(),
  }
}

/**
 * Generate markdown documentation
 */
export function generateMarkdown(docs: Documentation, config: Partial<DocsConfig> = {}): string {
  const lines: string[] = []

  // Header
  lines.push(`# ${docs.title}`)
  lines.push('')

  if (docs.description) {
    lines.push(docs.description)
    lines.push('')
  }

  lines.push(`> Generated on ${docs.generatedAt.toISOString()}`)
  lines.push('')

  // Table of contents
  lines.push('## Table of Contents')
  lines.push('')

  if (config.groupByCategory && docs.categories.size > 0) {
    for (const category of docs.categories.keys()) {
      lines.push(`- [${category}](#${slugify(category)})`)
    }
  }
  else {
    // Group by kind
    const byKind = groupByKind(docs.entries)
    for (const [kind, entries] of byKind) {
      if (entries.length > 0) {
        lines.push(`- [${kindToTitle(kind)}](#${slugify(kindToTitle(kind))})`)
      }
    }
  }
  lines.push('')

  // Content
  if (config.groupByCategory && docs.categories.size > 0) {
    for (const [category, entries] of docs.categories) {
      lines.push(`## ${category}`)
      lines.push('')

      for (const entry of entries) {
        lines.push(...generateEntryMarkdown(entry, config))
      }
    }
  }
  else {
    const byKind = groupByKind(docs.entries)
    for (const [kind, entries] of byKind) {
      if (entries.length > 0) {
        lines.push(`## ${kindToTitle(kind)}`)
        lines.push('')

        for (const entry of entries) {
          lines.push(...generateEntryMarkdown(entry, config))
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * Generate markdown for a single entry
 */
function generateEntryMarkdown(entry: DocEntry, config: Partial<DocsConfig>): string[] {
  const lines: string[] = []

  // Name and signature
  lines.push(`### ${entry.name}`)
  lines.push('')

  if (entry.jsdoc.deprecated) {
    lines.push(`> **Deprecated:** ${entry.jsdoc.deprecated}`)
    lines.push('')
  }

  lines.push('```typescript')
  lines.push(entry.signature)
  lines.push('```')
  lines.push('')

  // Description
  if (entry.jsdoc.description) {
    lines.push(entry.jsdoc.description)
    lines.push('')
  }

  // Parameters
  if (entry.jsdoc.params.length > 0) {
    lines.push('**Parameters:**')
    lines.push('')
    lines.push('| Name | Type | Description |')
    lines.push('|------|------|-------------|')

    for (const param of entry.jsdoc.params) {
      const optional = param.optional ? ' (optional)' : ''
      const type = param.type || 'any'
      lines.push(`| \`${param.name}\`${optional} | \`${type}\` | ${param.description} |`)
    }
    lines.push('')
  }

  // Returns
  if (entry.jsdoc.returns) {
    lines.push('**Returns:**')
    lines.push('')
    const type = entry.jsdoc.returns.type ? `\`${entry.jsdoc.returns.type}\`` : ''
    lines.push(`${type} ${entry.jsdoc.returns.description}`)
    lines.push('')
  }

  // Throws
  if (entry.jsdoc.throws.length > 0) {
    lines.push('**Throws:**')
    lines.push('')
    for (const t of entry.jsdoc.throws) {
      const type = t.type ? `\`${t.type}\`` : ''
      lines.push(`- ${type} ${t.description}`)
    }
    lines.push('')
  }

  // Examples
  if (entry.jsdoc.examples.length > 0) {
    lines.push('**Examples:**')
    lines.push('')
    for (const example of entry.jsdoc.examples) {
      lines.push('```typescript')
      lines.push(example)
      lines.push('```')
      lines.push('')
    }
  }

  // See also
  if (entry.jsdoc.see.length > 0) {
    lines.push('**See also:**')
    lines.push('')
    for (const see of entry.jsdoc.see) {
      lines.push(`- ${see}`)
    }
    lines.push('')
  }

  // Since
  if (entry.jsdoc.since) {
    lines.push(`*Since: ${entry.jsdoc.since}*`)
    lines.push('')
  }

  // Source link
  if (config.includeSourceLinks && entry.sourceFile) {
    const relativePath = entry.sourceFile
    if (config.sourceBaseUrl) {
      lines.push(`[Source](${config.sourceBaseUrl}/${relativePath})`)
    }
    else {
      lines.push(`*Source: ${relativePath}*`)
    }
    lines.push('')
  }

  // Members
  if (entry.members && entry.members.length > 0) {
    lines.push('**Members:**')
    lines.push('')

    for (const member of entry.members) {
      lines.push(`#### ${member.name}`)
      lines.push('')
      lines.push('```typescript')
      lines.push(member.signature)
      lines.push('```')
      lines.push('')

      if (member.jsdoc.description) {
        lines.push(member.jsdoc.description)
        lines.push('')
      }
    }
  }

  lines.push('---')
  lines.push('')

  return lines
}

/**
 * Generate HTML documentation
 */
export function generateHTML(docs: Documentation, config: Partial<DocsConfig> = {}): string {
  const markdown = generateMarkdown(docs, config)

  // Basic HTML wrapper with styling
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(docs.title)}</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a1a;
      --code-bg: #f4f4f4;
      --border: #e0e0e0;
      --link: #0066cc;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --text: #e0e0e0;
        --code-bg: #2d2d2d;
        --border: #404040;
        --link: #66b3ff;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
      background: var(--bg);
      color: var(--text);
    }
    h1, h2, h3, h4 { margin-top: 2rem; }
    code {
      background: var(--code-bg);
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9em;
    }
    pre {
      background: var(--code-bg);
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
    }
    pre code {
      padding: 0;
      background: none;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 0.5rem;
      text-align: left;
    }
    th { background: var(--code-bg); }
    a { color: var(--link); }
    blockquote {
      border-left: 4px solid var(--border);
      margin: 1rem 0;
      padding-left: 1rem;
      color: #666;
    }
    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }
    .deprecated {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 0.5rem 1rem;
      margin: 1rem 0;
    }
    @media (prefers-color-scheme: dark) {
      .deprecated {
        background: #3d3000;
        border-left-color: #ffc107;
      }
    }
  </style>
</head>
<body>
  <article id="content"></article>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    const markdown = ${JSON.stringify(markdown)};
    document.getElementById('content').innerHTML = marked.parse(markdown);
  </script>
</body>
</html>`
}

/**
 * Generate JSON documentation
 */
export function generateJSON(docs: Documentation, config: Partial<DocsConfig> = {}): string {
  const output = {
    title: docs.title,
    description: docs.description,
    generatedAt: docs.generatedAt.toISOString(),
    version: '1.0.0',
    entries: docs.entries.map(entry => ({
      name: entry.name,
      kind: entry.kind,
      signature: entry.signature,
      description: entry.jsdoc.description,
      isExported: entry.isExported,
      isDefault: entry.isDefault,
      deprecated: entry.jsdoc.deprecated,
      since: entry.jsdoc.since,
      category: entry.jsdoc.category,
      params: entry.jsdoc.params,
      returns: entry.jsdoc.returns,
      examples: entry.jsdoc.examples,
      throws: entry.jsdoc.throws,
      see: entry.jsdoc.see,
      tags: entry.jsdoc.tags,
      sourceFile: entry.sourceFile,
      sourceLine: entry.sourceLine,
      members: entry.members?.map(m => ({
        name: m.name,
        kind: m.kind,
        signature: m.signature,
        description: m.jsdoc.description,
        deprecated: m.jsdoc.deprecated,
        params: m.jsdoc.params,
        returns: m.jsdoc.returns,
      })),
    })),
    categories: config.groupByCategory
      ? Object.fromEntries(
          Array.from(docs.categories.entries()).map(([cat, entries]) => [
            cat,
            entries.map(e => e.name),
          ]),
        )
      : undefined,
  }

  return JSON.stringify(output, null, 2)
}

/**
 * Generate documentation in TypeDoc-compatible JSON format
 */
export function generateTypeDocJSON(docs: Documentation): string {
  const output = {
    id: 0,
    name: docs.title,
    kind: 1, // Project
    kindString: 'Project',
    flags: {},
    children: docs.entries.map((entry, idx) => ({
      id: idx + 1,
      name: entry.name,
      kind: kindToTypeDocKind(entry.kind),
      kindString: entry.kind,
      flags: {
        isExported: entry.isExported,
        isDefault: entry.isDefault,
      },
      comment: entry.jsdoc.description
        ? {
            summary: [{ kind: 'text', text: entry.jsdoc.description }],
            blockTags: entry.jsdoc.deprecated
              ? [{ tag: '@deprecated', content: [{ kind: 'text', text: entry.jsdoc.deprecated }] }]
              : undefined,
          }
        : undefined,
      sources: entry.sourceFile
        ? [{ fileName: entry.sourceFile, line: entry.sourceLine || 1, character: 0 }]
        : undefined,
      signatures: entry.kind === 'function'
        ? [{
            id: idx + 1000,
            name: entry.name,
            kind: 4096, // Call signature
            kindString: 'Call signature',
            parameters: entry.jsdoc.params.map((p, pidx) => ({
              id: idx + 2000 + pidx,
              name: p.name,
              kind: 32768, // Parameter
              kindString: 'Parameter',
              flags: { isOptional: p.optional },
              type: p.type ? { type: 'intrinsic', name: p.type } : undefined,
              comment: p.description
                ? { summary: [{ kind: 'text', text: p.description }] }
                : undefined,
            })),
            type: entry.jsdoc.returns?.type
              ? { type: 'intrinsic', name: entry.jsdoc.returns.type }
              : undefined,
          }]
        : undefined,
      children: entry.members?.map((m, midx) => ({
        id: idx + 3000 + midx,
        name: m.name,
        kind: kindToTypeDocKind(m.kind),
        kindString: m.kind,
        comment: m.jsdoc.description
          ? { summary: [{ kind: 'text', text: m.jsdoc.description }] }
          : undefined,
      })),
    })),
  }

  return JSON.stringify(output, null, 2)
}

/**
 * Generate and write documentation files
 */
export async function generateDocs(
  files: string[],
  config: DocsConfig,
): Promise<void> {
  logger.info('Extracting documentation...')

  const docs = await extractDocumentation(files, config)

  logger.info(`Found ${docs.entries.length} documented entries`)

  // Ensure output directory exists
  if (!existsSync(config.outdir)) {
    mkdirSync(config.outdir, { recursive: true })
  }

  if (config.format === 'markdown') {
    if (config.splitByModule) {
      // Generate separate files per source file
      const byFile = groupBySourceFile(docs.entries)
      for (const [sourceFile, entries] of byFile) {
        const moduleDocs: Documentation = {
          title: basename(sourceFile, '.ts'),
          description: `Documentation for ${sourceFile}`,
          entries,
          categories: new Map(),
          generatedAt: docs.generatedAt,
        }
        const markdown = generateMarkdown(moduleDocs, config)
        const outputPath = join(config.outdir, `${basename(sourceFile, '.ts')}.md`)
        writeFileSync(outputPath, markdown)
        logger.info(`Generated: ${outputPath}`)
      }

      // Generate index file
      const indexLines = [`# ${docs.title}`, '', docs.description || '', '', '## Modules', '']
      for (const [sourceFile] of byFile) {
        const moduleName = basename(sourceFile, '.ts')
        indexLines.push(`- [${moduleName}](./${moduleName}.md)`)
      }
      writeFileSync(join(config.outdir, 'README.md'), indexLines.join('\n'))
      logger.info(`Generated: ${join(config.outdir, 'README.md')}`)
    }
    else {
      const markdown = generateMarkdown(docs, config)
      const outputPath = join(config.outdir, 'API.md')
      writeFileSync(outputPath, markdown)
      logger.info(`Generated: ${outputPath}`)
    }
  }
  else if (config.format === 'json') {
    const json = generateJSON(docs, config)
    const outputPath = join(config.outdir, 'api.json')
    writeFileSync(outputPath, json)
    logger.info(`Generated: ${outputPath}`)

    // Also generate TypeDoc-compatible format
    const typeDocJson = generateTypeDocJSON(docs)
    const typeDocPath = join(config.outdir, 'typedoc.json')
    writeFileSync(typeDocPath, typeDocJson)
    logger.info(`Generated: ${typeDocPath}`)
  }
  else {
    const html = generateHTML(docs, config)
    const outputPath = join(config.outdir, 'index.html')
    writeFileSync(outputPath, html)
    logger.info(`Generated: ${outputPath}`)
  }
}

// Helper functions

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function kindToTitle(kind: string): string {
  const titles: Record<string, string> = {
    function: 'Functions',
    variable: 'Variables',
    interface: 'Interfaces',
    type: 'Type Aliases',
    class: 'Classes',
    enum: 'Enums',
    export: 'Exports',
    module: 'Modules',
  }
  return titles[kind] || kind
}

function groupByKind(entries: DocEntry[]): Map<string, DocEntry[]> {
  const groups = new Map<string, DocEntry[]>()
  const order = ['function', 'class', 'interface', 'type', 'enum', 'variable']

  for (const kind of order) {
    groups.set(kind, [])
  }

  for (const entry of entries) {
    const kind = entry.kind
    if (!groups.has(kind)) {
      groups.set(kind, [])
    }
    groups.get(kind)!.push(entry)
  }

  return groups
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function groupBySourceFile(entries: DocEntry[]): Map<string, DocEntry[]> {
  const groups = new Map<string, DocEntry[]>()

  for (const entry of entries) {
    const sourceFile = entry.sourceFile || 'unknown'
    if (!groups.has(sourceFile)) {
      groups.set(sourceFile, [])
    }
    groups.get(sourceFile)!.push(entry)
  }

  return groups
}

function kindToTypeDocKind(kind: string): number {
  const kinds: Record<string, number> = {
    function: 64, // Function
    variable: 32, // Variable
    interface: 256, // Interface
    type: 4194304, // Type alias
    class: 128, // Class
    enum: 8, // Enum
    property: 1024, // Property
    method: 2048, // Method
    module: 2, // Module
    namespace: 4, // Namespace
  }
  return kinds[kind] || 0
}

/**
 * Create a documentation generator with preset configuration
 */
export function createDocsGenerator(config: Partial<DocsConfig> = {}) {
  return {
    extract: (files: string[]) => extractDocumentation(files, config),
    generateMarkdown: (docs: Documentation) => generateMarkdown(docs, config),
    generateHTML: (docs: Documentation) => generateHTML(docs, config),
    generateJSON: (docs: Documentation) => generateJSON(docs, config),
    parseJSDoc,
  }
}
