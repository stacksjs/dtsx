/**
 * Declaration bundle linker.
 *
 * Links the per-file declarations dtsx already generated into one
 * self-contained `.d.ts` per entrypoint, the way rollup-plugin-dts and
 * api-extractor roll declarations up:
 *
 * - every declaration of every reachable file is inlined once, unexported;
 * - relative imports and re-exports are resolved to those declarations
 *   instead of being dropped, so `export { a as b } from './x'`,
 *   `export { default as X } from './x'`, `export * as ns from './x'` and
 *   `import * as ns from './x'` keep working (#3090);
 * - names that collide across files are renamed in the file that declares
 *   them second, and aliased imports are rewritten to the name they point at;
 * - the entry's export surface is written as one export clause at the end.
 *
 * It works on generated declaration text rather than on source, so every
 * inferred type is the one per-file generation produced.
 */

import { relative } from 'node:path'
import { resolveRelativeSpecifier } from './module-graph'

export interface LinkBundleOptions {
  /** Base for the `// From:` file headers */
  cwd: string
  /** Keep leading comments (JSDoc) on inlined declarations */
  keepComments?: boolean
}

export interface LinkBundleResult {
  content: string
  /** Files whose declarations were inlined */
  files: string[]
  /** Names exported from the bundle */
  exportCount: number
  /** Problems that could not be linked; the bundle is still written */
  warnings: string[]
}

export interface DeclarationStatement {
  text: string
  comments: string[]
}

type Binding =
  | { kind: 'local', name: string }
  | { kind: 'namespace', file: string }
  | { kind: 'external', source: string, imported: string }
  | { kind: 'external-namespace', source: string }

interface ImportClause {
  defaultName?: string
  namespaceName?: string
  named: Array<{ imported: string, local: string }>
}

interface ExportSpecifier {
  local: string
  exported: string
}

interface ModuleInfo {
  file: string
  declarations: Array<{ statement: DeclarationStatement, name: string | null, emit: string }>
  /** Local name -> declaration name in this file (always the same name) */
  declared: Set<string>
  /** Local import binding -> what it imports */
  imports: Map<string, { specifier: string, imported: string }>
  /** Exported name -> local name, for `export <decl>`, `export { a as b }` and `export default X` */
  localExports: Map<string, string>
  /** `export { a as b } from 'x'` */
  namedReExports: Array<{ specifier: string, imported: string, exported: string }>
  /** `export * from 'x'` */
  starReExports: string[]
  /** `export * as ns from 'x'` */
  namespaceReExports: Array<{ specifier: string, exported: string }>
  /** `declare module 'x'`, `declare global`, `export as namespace` */
  verbatim: DeclarationStatement[]
  /** Triple-slash directives */
  directives: string[]
}

const IDENT = /^[A-Z_$][\w$]*$/i

/**
 * Split generated declaration text into top-level statements, each with the
 * comments that lead it. dtsx writes one top-level statement per line start;
 * nested lines are indented, and a continuation at column 0 starts with a
 * bracket or an operator, never an identifier.
 */
export function splitTopLevelStatements(text: string): DeclarationStatement[] {
  const statements: DeclarationStatement[] = []
  let pendingComments: string[] = []
  let start = 0
  let depth = 0
  // Stack of open template literals; each entry is the brace depth at which
  // its `${` was opened.
  const templates: number[] = []
  let inTemplate = false
  let i = 0
  const n = text.length

  const flush = (end: number): void => {
    const chunk = text.slice(start, end).trim()
    start = end
    if (!chunk) return
    if (isCommentOnly(chunk)) {
      pendingComments.push(chunk)
      return
    }
    statements.push({ text: chunk, comments: pendingComments })
    pendingComments = []
  }

  while (i < n) {
    const c = text[i]
    if (inTemplate) {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { inTemplate = false; i++; continue }
      if (c === '$' && text[i + 1] === '{') {
        templates.push(depth)
        depth++
        inTemplate = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    if (c === '\'' || c === '"') {
      i++
      while (i < n && text[i] !== c && text[i] !== '\n') {
        if (text[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    if (c === '`') { inTemplate = true; i++; continue }
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue }
    if (c === ')' || c === ']' || c === '}') {
      depth--
      if (templates.length > 0 && c === '}' && depth === templates[templates.length - 1]) {
        templates.pop()
        inTemplate = true
      }
      i++
      continue
    }
    if (depth === 0 && c === ';') {
      flush(i + 1)
      i++
      continue
    }
    if (depth === 0 && c === '\n') {
      const next = text[i + 1]
      if (next !== undefined && /[\w$@/]/.test(next)) flush(i + 1)
      i++
      continue
    }
    i++
  }
  flush(n)
  return statements
}

function isCommentOnly(chunk: string): boolean {
  let i = 0
  while (i < chunk.length) {
    while (i < chunk.length && /\s/.test(chunk[i])) i++
    if (i >= chunk.length) return true
    if (chunk.startsWith('//', i)) {
      const end = chunk.indexOf('\n', i)
      i = end === -1 ? chunk.length : end
      continue
    }
    if (chunk.startsWith('/*', i)) {
      const end = chunk.indexOf('*/', i + 2)
      if (end === -1) return true
      i = end + 2
      continue
    }
    return false
  }
  return true
}

function parseSpecifierList(list: string): ExportSpecifier[] {
  const result: ExportSpecifier[] = []
  for (const raw of list.split(',')) {
    const part = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/^type\s+/, '')
    if (!part) continue
    const match = part.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/)
    if (!match) continue
    result.push({ local: match[1], exported: match[2] ?? match[1] })
  }
  return result
}

function parseImportClause(clause: string): ImportClause {
  const result: ImportClause = { named: [] }
  let rest = clause.trim().replace(/^type\s+/, '')
  const braces = rest.match(/\{([\s\S]*)\}/)
  if (braces) {
    for (const spec of parseSpecifierList(braces[1])) result.named.push({ imported: spec.local, local: spec.exported })
    rest = rest.replace(braces[0], '')
  }
  const namespace = rest.match(/\*\s*as\s+([\w$]+)/)
  if (namespace) {
    result.namespaceName = namespace[1]
    rest = rest.replace(namespace[0], '')
  }
  const defaultName = rest.replace(/,/g, '').trim()
  if (defaultName && IDENT.test(defaultName)) result.defaultName = defaultName
  return result
}

const DECLARATION_HEAD = /^(?:export\s+)?(default\s+)?(?:declare\s+)?(abstract\s+)?(class|interface|type|function\s*\*?|enum|const\s+enum|namespace|module|const|let|var|async\s+function)\b\s*([\w$]+)?/

/** Turn an `export`ed statement into its unexported, ambient form. */
function toLocalDeclaration(text: string, name: string): string {
  let body = text.replace(/^export\s+/, '')
  const isDefault = /^default\s+/.test(body)
  body = body.replace(/^default\s+/, '')
  if (isDefault) {
    // An anonymous default declaration takes the synthesized name.
    body = body.replace(/^((?:declare\s+)?(?:abstract\s+)?(?:class|function\s*\*?|async\s+function\s*\*?))\s*(?=[(<{])/, (_, head: string) => `${head.trimEnd()} ${name}`)
  }
  if (/^(?:interface|type)\b/.test(body) || /^declare\b/.test(body)) return body
  return `declare ${body}`
}

function parseModule(file: string, dts: string): ModuleInfo {
  const info: ModuleInfo = {
    file,
    declarations: [],
    declared: new Set(),
    imports: new Map(),
    localExports: new Map(),
    namedReExports: [],
    starReExports: [],
    namespaceReExports: [],
    verbatim: [],
    directives: [],
  }

  const statements = splitTopLevelStatements(dts)
  for (const statement of statements) {
    // Triple-slash directives arrive as leading comments; keep them apart.
    statement.comments = statement.comments.filter((comment) => {
      if (/^\/\/\/\s*</.test(comment)) {
        info.directives.push(...comment.split('\n').map(line => line.trim()).filter(line => line.startsWith('///')))
        return false
      }
      return true
    })

    const text = statement.text.replace(/;\s*$/, '').trim()

    let match = text.match(/^import\s+(type\s+)?([\s\S]+?)\s+from\s+(['"])([^'"]+)\3/)
    if (match) {
      const clause = parseImportClause(match[2])
      const specifier = match[4]
      if (clause.defaultName) info.imports.set(clause.defaultName, { specifier, imported: 'default' })
      if (clause.namespaceName) info.imports.set(clause.namespaceName, { specifier, imported: '*' })
      for (const named of clause.named) info.imports.set(named.local, { specifier, imported: named.imported })
      continue
    }
    if (/^import\s+['"]/.test(text)) {
      info.verbatim.push(statement)
      continue
    }

    match = text.match(/^export\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s+(['"])([^'"]+)\2/)
    if (match) {
      info.namespaceReExports.push({ specifier: match[3], exported: match[1] })
      continue
    }
    match = text.match(/^export\s+(?:type\s+)?\*\s+from\s+(['"])([^'"]+)\1/)
    if (match) {
      info.starReExports.push(match[2])
      continue
    }
    match = text.match(/^export\s+(?:type\s+)?\{([\s\S]*)\}\s+from\s+(['"])([^'"]+)\2/)
    if (match) {
      for (const spec of parseSpecifierList(match[1])) info.namedReExports.push({ specifier: match[3], imported: spec.local, exported: spec.exported })
      continue
    }
    match = text.match(/^export\s+(?:type\s+)?\{([\s\S]*)\}$/)
    if (match) {
      for (const spec of parseSpecifierList(match[1])) info.localExports.set(spec.exported, spec.local)
      continue
    }
    match = text.match(/^export\s+default\s+([\w$]+)$/)
    if (match && IDENT.test(match[1])) {
      info.localExports.set('default', match[1])
      continue
    }
    if (/^export\s+as\s+namespace\b/.test(text) || /^(?:export\s+)?declare\s+(?:global\b|module\s+['"])/.test(text)) {
      info.verbatim.push(statement)
      continue
    }

    const head = text.match(DECLARATION_HEAD)
    if (head) {
      const isDefault = !!head[1]
      const name = head[4] ?? (isDefault ? '_default' : null)
      if (name) {
        info.declared.add(name)
        if (/^export\s/.test(text)) info.localExports.set(isDefault ? 'default' : name, name)
        info.declarations.push({ statement, name, emit: toLocalDeclaration(statement.text, name) })
        continue
      }
    }

    // `export =` and anything unrecognised is kept as written.
    info.declarations.push({ statement, name: null, emit: statement.text })
  }

  return info
}

/**
 * Rename identifier references in declaration text. Strings, comments,
 * qualified-name members (`a.b`) and property or parameter names (`{ b: T }`,
 * `(b: T)`) are left alone.
 */
export function renameIdentifiers(text: string, renames: Map<string, string>): string {
  if (renames.size === 0) return text
  let out = ''
  let i = 0
  const n = text.length
  let lastSignificant = '\n'
  while (i < n) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      out += text.slice(i, stop)
      i = stop
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += text.slice(i, stop)
      i = stop
      continue
    }
    if (c === '\'' || c === '"') {
      let j = i + 1
      while (j < n && text[j] !== c && text[j] !== '\n') {
        if (text[j] === '\\') j++
        j++
      }
      out += text.slice(i, j + 1)
      i = j + 1
      lastSignificant = c
      continue
    }
    if (/[A-Z_$]/i.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(text[j])) j++
      const word = text.slice(i, j)
      const replacement = renames.get(word)
      if (replacement !== undefined && lastSignificant !== '.') {
        let k = j
        while (k < n && (text[k] === ' ' || text[k] === '\t')) k++
        const isKey = (text[k] === ':' || (text[k] === '?' && text[k + 1] === ':'))
          && /[{;,(\n]/.test(lastSignificant)
        out += isKey ? word : replacement
      }
      else {
        out += word
      }
      lastSignificant = 'a'
      i = j
      continue
    }
    out += c
    if (c === '\n' || !/\s/.test(c)) lastSignificant = c
    i++
  }
  return out
}

/**
 * Link one entrypoint's reachable declarations into a single declaration
 * file. `dtsContents` maps each source file to the declaration text dtsx
 * generated for it.
 */
export function linkBundle(
  entry: string,
  files: string[],
  dtsContents: Map<string, string>,
  options: LinkBundleOptions,
): LinkBundleResult {
  const warnings: string[] = []
  const modules = new Map<string, ModuleInfo>()
  const order = [entry, ...files.filter(file => file !== entry)]
  for (const file of order) {
    const dts = dtsContents.get(file)
    if (dts === undefined) {
      warnings.push(`No declarations were generated for ${relative(options.cwd, file)}; it is left out of the bundle`)
      continue
    }
    modules.set(file, parseModule(file, dts))
  }

  const resolveFile = (specifier: string, from: string): string | null => {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null
    const resolved = resolveRelativeSpecifier(specifier, from).resolved
    return resolved && modules.has(resolved) ? resolved : null
  }
  const isRelative = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/')

  // 1. Bundle names: one per declared name per file, and one per external
  //    import binding. The first file to claim a name keeps it.
  const taken = new Set<string>()
  const allocate = (preferred: string): string => {
    let candidate = preferred
    for (let suffix = 1; taken.has(candidate); suffix++) candidate = `${preferred}_${suffix}`
    taken.add(candidate)
    return candidate
  }
  const bundleNames = new Map<string, Map<string, string>>()
  for (const [file, info] of modules) {
    const names = new Map<string, string>()
    for (const name of info.declared) names.set(name, allocate(name))
    bundleNames.set(file, names)
  }

  // External imports share one binding per (source, imported name).
  const externalNames = new Map<string, string>()
  const externalBinding = (source: string, imported: string, preferred: string): string => {
    const key = `${source}\0${imported}`
    let name = externalNames.get(key)
    if (!name) {
      name = allocate(preferred)
      externalNames.set(key, name)
    }
    return name
  }

  // 2. What each module exports, following re-exports.
  const exportCache = new Map<string, Map<string, Binding>>()
  const externalStars = new Map<string, Set<string>>()
  const inProgress = new Set<string>()

  const resolveImport = (info: ModuleInfo, specifier: string, imported: string): Binding | null => {
    const target = resolveFile(specifier, info.file)
    if (target) {
      if (imported === '*') return { kind: 'namespace', file: target }
      const binding = exportsOf(target).get(imported)
      if (!binding) warnings.push(`${relative(options.cwd, info.file)}: '${imported}' is not exported by '${specifier}'`)
      return binding ?? null
    }
    if (isRelative(specifier)) {
      warnings.push(`${relative(options.cwd, info.file)}: '${specifier}' is not part of the bundle`)
      return null
    }
    return imported === '*' ? { kind: 'external-namespace', source: specifier } : { kind: 'external', source: specifier, imported }
  }

  const resolveLocal = (info: ModuleInfo, name: string): Binding | null => {
    if (info.declared.has(name)) return { kind: 'local', name: bundleNames.get(info.file)!.get(name)! }
    const imported = info.imports.get(name)
    if (imported) return resolveImport(info, imported.specifier, imported.imported)
    warnings.push(`${relative(options.cwd, info.file)}: cannot resolve exported name '${name}'`)
    return null
  }

  function exportsOf(file: string): Map<string, Binding> {
    const cached = exportCache.get(file)
    if (cached) return cached
    const result = new Map<string, Binding>()
    const info = modules.get(file)
    if (!info || inProgress.has(file)) return result
    inProgress.add(file)
    const stars = new Set<string>()

    for (const [exported, local] of info.localExports) {
      const binding = resolveLocal(info, local)
      if (binding) result.set(exported, binding)
    }
    for (const reExport of info.namedReExports) {
      const binding = resolveImport(info, reExport.specifier, reExport.imported)
      if (binding) result.set(reExport.exported, binding)
    }
    for (const reExport of info.namespaceReExports) {
      const binding = resolveImport(info, reExport.specifier, '*')
      if (binding) result.set(reExport.exported, binding)
    }
    for (const specifier of info.starReExports) {
      const target = resolveFile(specifier, file)
      if (target) {
        for (const [name, binding] of exportsOf(target)) {
          if (name !== 'default' && !result.has(name)) result.set(name, binding)
        }
        for (const source of externalStars.get(target) ?? []) stars.add(source)
      }
      else if (isRelative(specifier)) {
        warnings.push(`${relative(options.cwd, file)}: '${specifier}' is not part of the bundle`)
      }
      else {
        stars.add(specifier)
      }
    }

    inProgress.delete(file)
    exportCache.set(file, result)
    externalStars.set(file, stars)
    return result
  }

  // 3. Namespaces for `import * as ns` / `export * as ns` of bundled files.
  const namespaceNames = new Map<string, string>()
  const namespaceDeclarations: string[] = []
  const bindingName = (binding: Binding, preferred: string): string => {
    switch (binding.kind) {
      case 'local': return binding.name
      case 'external': return externalBinding(binding.source, binding.imported, binding.imported === 'default' ? preferred : binding.imported)
      case 'external-namespace': return externalBinding(binding.source, '*', preferred)
      case 'namespace': return namespaceFor(binding.file, preferred)
    }
  }
  function namespaceFor(file: string, preferred: string): string {
    const existing = namespaceNames.get(file)
    if (existing) return existing
    const name = allocate(preferred)
    namespaceNames.set(file, name)
    const members: string[] = []
    for (const [exported, binding] of exportsOf(file)) {
      if (exported === 'default') continue
      const local = bindingName(binding, exported)
      members.push(local === exported ? exported : `${local} as ${exported}`)
    }
    if (externalStars.get(file)?.size) {
      warnings.push(`${relative(options.cwd, file)}: 'export * from' an external module cannot be expressed inside namespace '${name}'`)
    }
    namespaceDeclarations.push(`declare namespace ${name} {\n  export { ${members.join(', ')} };\n}`)
    return name
  }

  // 4. Rewrite each file's declarations so every reference uses its bundle name.
  const declarationBlocks: string[] = []
  const verbatim: string[] = []
  const directives = new Set<string>()
  for (const [file, info] of modules) {
    for (const directive of info.directives) directives.add(directive)
    const renames = new Map<string, string>()
    for (const [name, bundleName] of bundleNames.get(file)!) {
      if (name !== bundleName) renames.set(name, bundleName)
    }
    for (const [local, imported] of info.imports) {
      if (info.declared.has(local)) continue
      const binding = resolveImport(info, imported.specifier, imported.imported)
      if (!binding) continue
      const target = bindingName(binding, local)
      if (target !== local) renames.set(local, target)
    }

    const lines: string[] = []
    for (const declaration of info.declarations) {
      if (options.keepComments) lines.push(...declaration.statement.comments)
      let emit = renameIdentifiers(declaration.emit, renames)
      if (!/[;}]$/.test(emit)) emit += ';'
      lines.push(emit)
    }
    for (const statement of info.verbatim) {
      if (options.keepComments) verbatim.push(...statement.comments)
      verbatim.push(renameIdentifiers(statement.text, renames))
    }
    if (lines.length > 0) declarationBlocks.push(`// From: ${relative(options.cwd, file)}\n${lines.join('\n')}`)
  }

  // 5. The entry's export surface.
  const entryExports = exportsOf(entry)
  const clause: string[] = []
  const externalReExports: string[] = []
  for (const [exported, binding] of entryExports) {
    if (binding.kind === 'external') {
      externalReExports.push(`export { ${binding.imported === exported ? exported : `${binding.imported} as ${exported}`} } from '${binding.source}';`)
      continue
    }
    if (binding.kind === 'external-namespace') {
      externalReExports.push(`export * as ${exported} from '${binding.source}';`)
      continue
    }
    const local = bindingName(binding, exported === 'default' ? '_default' : exported)
    clause.push(local === exported ? exported : `${local} as ${exported}`)
  }
  for (const source of externalStars.get(entry) ?? []) externalReExports.push(`export * from '${source}';`)

  // 6. External imports, grouped per source.
  const importsBySource = new Map<string, { named: string[], defaults: string[], namespaces: string[] }>()
  for (const [key, local] of externalNames) {
    const [source, imported] = key.split('\0')
    const group = importsBySource.get(source) ?? { named: [], defaults: [], namespaces: [] }
    importsBySource.set(source, group)
    if (imported === '*') group.namespaces.push(local)
    else if (imported === 'default') group.defaults.push(local)
    else group.named.push(imported === local ? local : `${imported} as ${local}`)
  }
  const importLines: string[] = []
  for (const [source, group] of [...importsBySource].sort(([a], [b]) => a.localeCompare(b))) {
    for (const local of group.defaults) importLines.push(`import ${local} from '${source}';`)
    for (const local of group.namespaces) importLines.push(`import * as ${local} from '${source}';`)
    if (group.named.length > 0) importLines.push(`import { ${group.named.join(', ')} } from '${source}';`)
  }

  const sections: string[] = []
  if (directives.size > 0) sections.push([...directives].join('\n'))
  sections.push(`/**\n * Bundled TypeScript declarations\n * Generated from ${modules.size} source files\n */`)
  if (importLines.length > 0) sections.push(importLines.join('\n'))
  sections.push(...declarationBlocks)
  if (namespaceDeclarations.length > 0) sections.push(namespaceDeclarations.join('\n'))
  if (verbatim.length > 0) sections.push(verbatim.join('\n'))
  const exportLines: string[] = []
  if (clause.length > 0) exportLines.push(`export { ${clause.join(', ')} };`)
  exportLines.push(...externalReExports)
  if (exportLines.length === 0) exportLines.push('export {};')
  sections.push(exportLines.join('\n'))

  return {
    content: `${sections.join('\n\n')}\n`,
    files: [...modules.keys()],
    exportCount: entryExports.size,
    warnings,
  }
}
