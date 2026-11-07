/**
 * Module graph utilities for following relative re-exports.
 *
 * Used to:
 *  1. Auto-expand entrypoints so a barrel `export * from './x'` pulls in `./x.ts`.
 *  2. Detect re-exports that point at siblings dtsx isn't going to emit
 *     (the silent breakage in stacksjs/dtsx#3090).
 *  3. Drive `bundle: true` so it can inline reachable declarations.
 *
 * The scanner here is intentionally lightweight — a dedicated regex pass
 * with comment + string stripping. Faster than running the full extractor
 * and good enough for the path/specifier extraction it needs to do.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { readTextFile } from './compat'
import { isRegexStart, skipRegexLiteral } from './lexical'
import { logger } from './logger'
import { readEffectiveTsconfig } from './tsconfig'

/**
 * A single relative re-export or import reference parsed out of source.
 */
export interface ReExportRef {
  /** Specifier as written in source, e.g. './router' or '../utils' */
  specifier: string
  /** Statement shape */
  kind: 'export-star' | 'export-star-as' | 'export-named' | 'import'
  /** True for `export type … from` / `import type … from` */
  isTypeOnly: boolean
}

/**
 * Result of resolving a specifier to disk.
 */
export interface ResolveResult {
  /** Absolute path on disk, or null if external/unresolvable */
  resolved: string | null
  /** True if the specifier was relative (./ or ../) or absolute */
  isRelative: boolean
  /** A configured private alias, subject to emitted-package ownership. */
  isAlias?: boolean
  /** Fragment/query from the resolved mapping target, not the alias name. */
  suffix?: string
}

/**
 * Extensions tried, in order, when resolving an extensionless specifier.
 * `.d.ts` last so source files win over generated declarations.
 */
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.vue', '.stx', '.js', '.jsx', '.mjs', '.cjs', '.d.ts', '.d.mts', '.d.cts'] as const

const RUNTIME_SOURCE_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx', '.ts', '.d.ts'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

/**
 * Resolve a relative re-export specifier to an absolute path on disk.
 *
 * Resolves local specifiers to normalized absolute native paths. Bare
 * specifiers (e.g. `react`, `@scope/foo`) return `{ resolved: null }`.
 */
export function resolveRelativeSpecifier(specifier: string, fromFile: string): ResolveResult {
  const pathSpecifier = specifier.replace(/[?#].*$/, '')
  const isRel = pathSpecifier.startsWith('./') || pathSpecifier.startsWith('../') || pathSpecifier === '.' || pathSpecifier === '..'
  if (!isRel && !isAbsolute(pathSpecifier)) {
    return { resolved: null, isRelative: false }
  }

  const baseDir = dirname(fromFile)
  const candidate = resolve(baseDir, pathSpecifier)

  // 1. Specifier already includes its extension
  if (isFile(candidate)) {
    return { resolved: candidate, isRelative: true }
  }

  // NodeNext source commonly imports the runtime extension (`./x.js`) even
  // though the file on disk is TypeScript (`x.ts`). Resolve those pairs before
  // treating the written extension as part of the basename.
  const runtimeExtension = extname(candidate)
  const sourceExtensions = RUNTIME_SOURCE_EXTENSIONS[runtimeExtension]
  if (sourceExtensions) {
    const baseCandidate = candidate.slice(0, -runtimeExtension.length)
    for (const sourceExtension of sourceExtensions) {
      const sourceCandidate = baseCandidate + sourceExtension
      if (isFile(sourceCandidate)) return { resolved: sourceCandidate, isRelative: true }
    }
  }

  // 2. Try each known TS extension
  for (const ext of TS_EXTENSIONS) {
    const withExt = candidate + ext
    if (isFile(withExt)) {
      return { resolved: withExt, isRelative: true }
    }
  }

  // 3. Try as a directory with an index file
  if (existsSync(candidate)) {
    for (const ext of TS_EXTENSIONS) {
      const indexPath = join(candidate, `index${ext}`)
      if (isFile(indexPath)) {
        return { resolved: indexPath, isRelative: true }
      }
    }
  }

  return { resolved: null, isRelative: true }
}

export interface ModuleResolutionOptions {
  cwd: string
  root: string
  tsconfigPath?: string
  outputStructure?: 'mirror' | 'flat'
}

export interface ModuleResolver {
  (specifier: string, fromFile: string): ResolveResult
  isPackageLocal?: (fromFile: string, target: string) => boolean
  cacheKey?: (files: string[]) => string
}

interface PackageBoundary {
  directory: string
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  exports?: unknown
  imports?: Record<string, unknown>
}

function matchesSpecifier(pattern: string, specifier: string): boolean {
  const star = pattern.indexOf('*')
  return star === -1 ? specifier === pattern : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1)) && specifier.length >= pattern.length - 1
}

function hasPublicMapping(mapping: Record<string, unknown>, specifier: string): boolean {
  if (Object.hasOwn(mapping, specifier)) return mapping[specifier] !== null
  const pattern = Object.keys(mapping).filter(key => key.includes('*') && matchesSpecifier(key, specifier))
    .sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length)[0]
  return pattern !== undefined && mapping[pattern] !== null
}

function isPublicSelfSpecifier(owner: PackageBoundary, specifier: string): boolean {
  if (!owner.name || (specifier !== owner.name && !specifier.startsWith(`${owner.name}/`))) return false
  if (owner.exports === undefined) return true
  const subpath = specifier === owner.name ? '.' : `.${specifier.slice(owner.name.length)}`
  if (typeof owner.exports === 'string' || Array.isArray(owner.exports)) return subpath === '.'
  if (!owner.exports || typeof owner.exports !== 'object') return false
  const exports = owner.exports as Record<string, unknown>
  const keys = Object.keys(exports)
  if (!keys.some(key => key.startsWith('.'))) return subpath === '.'
  return hasPublicMapping(exports, subpath)
}

function containsPath(directory: string, file: string): boolean {
  const path = relative(directory, file)
  return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path)
}

/** Share local alias ownership between graph traversal and declaration output. */
export async function createModuleResolver(options: ModuleResolutionOptions): Promise<ModuleResolver> {
  const config = await readEffectiveTsconfig(resolve(options.cwd, options.tsconfigPath || 'tsconfig.json'))
  const mappings = Object.entries(config?.paths ?? {})
  if (mappings.length === 0) return resolveRelativeSpecifier
  const base = config?.baseUrl ?? config?.pathsBasePath ?? options.cwd
  const configuredRoot = resolve(options.cwd, options.root)
  const packages = new Map<string, PackageBoundary | undefined>()
  const builtins = new Set([...builtinModules, 'bun'])

  const packageAt = (file: string): PackageBoundary | undefined => {
    let directory = dirname(file)
    const visited: string[] = []
    while (true) {
      if (packages.has(directory)) {
        const found = packages.get(directory)
        for (const path of visited) packages.set(path, found)
        return found
      }
      visited.push(directory)
      const manifest = join(directory, 'package.json')
      if (existsSync(manifest)) {
        const data = JSON.parse(readFileSync(manifest, 'utf8')) as Omit<PackageBoundary, 'directory'>
        const found = { ...data, directory: realpathSync(directory) }
        for (const path of visited) packages.set(path, found)
        return found
      }
      const parent = dirname(directory)
      if (parent === directory) return undefined
      directory = parent
    }
  }

  const resolveModule: ModuleResolver = (specifier, fromFile) => {
    if (specifier.startsWith('.') || isAbsolute(specifier)) return resolveRelativeSpecifier(specifier, fromFile)
    if (specifier.startsWith('node:') || specifier.startsWith('bun:') || builtins.has(specifier))
      return { resolved: null, isRelative: false }

    const owner = packageAt(fromFile)
    const name = specifier.startsWith('@') ? /^@[^/]+\/[^/]+/.exec(specifier)?.[0] : specifier.split('/')[0]
    if (owner && (isPublicSelfSpecifier(owner, specifier)
      || hasPublicMapping(owner.imports ?? {}, specifier)
      || (name && [owner.dependencies, owner.devDependencies, owner.peerDependencies, owner.optionalDependencies].some(dependencies => Object.hasOwn(dependencies ?? {}, name)))))
    return { resolved: null, isRelative: false }

    // Exact mapping wins, otherwise TypeScript chooses the longest matching
    // prefix. Array targets are attempted in their declared order.
    const matched = mappings.filter(([pattern]) => matchesSpecifier(pattern, specifier)).sort(([a], [b]) => {
      if (!a.includes('*')) return -1
      if (!b.includes('*')) return 1
      return b.indexOf('*') - a.indexOf('*')
    })[0]
    if (!matched) return { resolved: null, isRelative: false }
    const [pattern, targets] = matched
    const star = pattern.indexOf('*')
    const wildcard = star === -1 ? '' : specifier.slice(star, specifier.length - (pattern.length - star - 1))
    for (const target of targets) {
      const candidate = resolve(base, target.replace('*', wildcard))
      const targetOwner = packageAt(candidate)
      // Public workspace package imports retain their published identity even
      // when a monorepo tsconfig points them at a sibling's source checkout.
      if (targetOwner && isPublicSelfSpecifier(targetOwner, specifier) && !targetOwner.private && targetOwner.directory !== owner?.directory)
        return { resolved: null, isRelative: false }
      const found = resolveRelativeSpecifier(candidate, fromFile)
      if (!found.resolved) continue
      const actual = realpathSync(found.resolved)
      const withinOutputRoot = options.outputStructure === 'flat' || (existsSync(configuredRoot) && containsPath(realpathSync(configuredRoot), actual))
      if (!owner || !containsPath(owner.directory, actual) || !withinOutputRoot
        || packageAt(actual)?.directory !== owner.directory || /\.d\.(?:ts|mts|cts)$/.test(actual))
      throw new Error(`Local alias ${JSON.stringify(specifier)} from ${fromFile} resolves outside its emitted package source: ${actual}`)
      logger.debug(`Resolved local declaration alias ${specifier} from ${fromFile} to ${actual}`)
      // Keep the caller's lexical root identity for output mapping (macOS
      // /var and /private/var can name the same package). Real paths above
      // establish ownership without moving emitted files outside that root.
      const outputSource = options.outputStructure === 'flat'
        ? found.resolved
        : resolve(configuredRoot, relative(realpathSync(configuredRoot), actual))
      return { resolved: outputSource, isRelative: true, isAlias: true, suffix: candidate.match(/[?#].*$/)?.[0] ?? '' }
    }
    throw new Error(`Cannot resolve local alias ${JSON.stringify(specifier)} from ${fromFile} using ${options.tsconfigPath || 'tsconfig.json'} (${JSON.stringify(pattern)})`)
  }
  resolveModule.isPackageLocal = (fromFile, target) => {
    const owner = packageAt(fromFile)
    return !!owner && packageAt(target)?.directory === owner.directory && containsPath(owner.directory, realpathSync(target))
  }
  resolveModule.cacheKey = (files) => {
    const edges = files.map(file => ({
      file,
      references: scanReExportSpecifiers(readFileSync(file, 'utf8'), { includeImports: true })
        .map(reference => ({ specifier: reference.specifier, resolution: resolveModule(reference.specifier, file) })),
    }))
    const boundaries = [...new Set(packages.values())].filter((owner): owner is PackageBoundary => owner !== undefined)
      .sort((a, b) => a.directory.localeCompare(b.directory))
    return JSON.stringify({ root: configuredRoot, compilerOptions: config, packages: boundaries, edges })
  }
  return resolveModule
}

/**
 * Drop comments while leaving string literals intact.
 *
 * String contents are preserved so that real `from '…'` clauses still
 * match the regex. The regex itself is anchored to statement starts
 * (`^`, newline, `;`, `{`, `}`), which keeps it from matching `export`
 * appearing inside string bodies in normal code.
 */
// eslint-disable-next-line pickier/no-unused-vars -- false positive: `input` is read on the next lines
function stripComments(input: string, strings: Array<{ start: number, end: number }> = []): string {
  const len = input.length
  let out = ''
  let i = 0

  while (i < len) {
    const c = input.charCodeAt(i)

    // String / template literal
    if (c === 0x22 /* " */ || c === 0x27 /* ' */ || c === 0x60 /* ` */) {
      const quote = c
      const start = i
      out += input[i++]
      while (i < len) {
        const cc = input.charCodeAt(i)
        const ch = input[i++]
        out += quote === 0x60 && cc !== quote
          ? (cc === 0x0A || cc === 0x0D ? ch : ' ')
          : ch
        if (cc === 0x5C /* \\ */ && i < len) {
          const escaped = input[i++]
          out += quote === 0x60 ? (escaped === '\n' || escaped === '\r' ? escaped : ' ') : escaped
          continue
        }
        if (cc === quote) break
      }
      strings.push({ start, end: i })
      continue
    }

    if (c === 0x2F /* / */ && i + 1 < len) {
      const c2 = input.charCodeAt(i + 1)
      if (c2 === 0x2F /* / */) {
        out += '  '
        i += 2
        while (i < len && input.charCodeAt(i) !== 0x0A) { out += ' '; i++ }
        continue
      }
      if (c2 === 0x2A /* * */) {
        out += '  '
        i += 2
        while (i < len && !(input.charCodeAt(i) === 0x2A && input.charCodeAt(i + 1) === 0x2F)) {
          out += input[i] === '\n' || input[i] === '\r' ? input[i] : ' '
          i++
        }
        if (i < len) { out += '  '; i += 2 }
        continue
      }
      if (isRegexStart(input, i)) {
        const end = skipRegexLiteral(input, i)
        out += input.slice(i, end).replace(/[^\r\n]/g, ' ')
        i = end
        continue
      }
    }

    out += input[i++]
  }

  return out
}

// Anchor `export`/`import` to statement starts (start-of-input, newline,
// semicolon, or block braces). This keeps us from matching the substring
// `export * from './fake'` inside a string literal like
// `const s = "export * from './fake'"`.
const RE_EXPORT_FROM = /(?:^|[\n;{}])\s*export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+(['"])([^'"]+)\2/g
const IMPORT_TYPE = /\bimport\s*\(\s*(['"])([^'"]+)\1/g
const IMPORT_FROM = /(?:^|[\n;{}])\s*import\s+(type\s+)?(?:[^'";]+?\s+from\s+)?(['"])([^'"]+)\2/g

/**
 * Quickly scan source for relative re-export references.
 *
 * By default only re-exports are returned, since plain `import`s do not
 * propagate types to consumers unless they are also re-exported. Pass
 * `includeImports: true` for the bundle pathway, where any reachable
 * file's declarations may need to be inlined.
 */
export function scanReExportSpecifiers(
  source: string,
  options: { includeImports?: boolean } = {},
): ReExportRef[] {
  const refs: ReExportRef[] = []
  const strings: Array<{ start: number, end: number }> = []
  const code = stripComments(source, strings)
  const inString = (offset: number): boolean => strings.some(range => offset > range.start && offset < range.end)

  RE_EXPORT_FROM.lastIndex = 0
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = RE_EXPORT_FROM.exec(code)) !== null) {
    if (inString(m.index)) continue
    const isTypeOnly = !!m[1]
    const specifier = m[3]
    const head = m[0]
    let kind: ReExportRef['kind']
    if (head.includes('* as '))
      kind = 'export-star-as'
    else if (head.includes('*'))
      kind = 'export-star'
    else
      kind = 'export-named'
    refs.push({ specifier, kind, isTypeOnly })
  }

  if (options.includeImports) {
    IMPORT_FROM.lastIndex = 0
    while ((m = IMPORT_FROM.exec(code)) !== null) {
      if (inString(m.index)) continue
      refs.push({ specifier: m[3], kind: 'import', isTypeOnly: !!m[1] })
    }
  }

  if (options.includeImports) {
    IMPORT_TYPE.lastIndex = 0
    while ((m = IMPORT_TYPE.exec(code)) !== null) {
      if (!inString(m.index)) refs.push({ specifier: m[2], kind: 'import', isTypeOnly: false })
    }
  }
  return refs
}

/** Rewrite real module specifiers without changing comments or string values. */
export function rewriteModuleSpecifiers(source: string, rewrite: (specifier: string) => string): string {
  const strings: Array<{ start: number, end: number }> = []
  const code = stripComments(source, strings)
  const pattern = /\b(?:from\s*|import\s*(?:\(\s*)?)(['"])([^'"]+)\1/g
  const changes: Array<{ start: number, end: number, value: string }> = []
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(code)) !== null) {
    if (strings.some(range => match!.index > range.start && match!.index < range.end)) continue
    const start = match.index + match[0].lastIndexOf(`${match[1]}${match[2]}${match[1]}`) + 1
    const value = rewrite(match[2])
    if (value !== match[2]) changes.push({ start, end: start + match[2].length, value })
  }
  let result = source
  for (const change of changes.reverse()) result = result.slice(0, change.start) + change.value + result.slice(change.end)
  return result
}

/**
 * An unresolved relative re-export discovered during traversal.
 */
export interface UnresolvedReExport {
  /** Absolute path of the file containing the re-export */
  from: string
  /** Specifier as written, e.g. './router' */
  specifier: string
  /** True for `export type … from` */
  isTypeOnly: boolean
}

/**
 * Result of walking the re-export graph from a set of entrypoints.
 */
export interface ReachabilityResult {
  /** Entry files plus every file reached through relative re-exports */
  reachable: Set<string>
  /** Per-file list of every relative re-export found in that file */
  reExports: Map<string, ReExportRef[]>
  /** Re-exports whose specifier could not be resolved on disk */
  unresolved: UnresolvedReExport[]
}

/**
 * BFS the re-export graph starting from `entrypoints`.
 *
 * Each entrypoint and every file reached via `export … from './x'`
 * (recursively, with normalized path identities and cycle protection) ends up in `reachable`. Files
 * whose source can't be read are skipped silently — the caller is the
 * one with the right context to decide whether that's an error.
 */
export async function collectReachableViaReExports(
  entrypoints: string[],
  options: { includeImports?: boolean, resolveSpecifier?: ModuleResolver } = {},
): Promise<ReachabilityResult> {
  const reachable = new Set<string>()
  const reExports = new Map<string, ReExportRef[]>()
  const unresolved: UnresolvedReExport[] = []

  const queue: string[] = []
  for (const entrypoint of entrypoints) {
    const ep = resolve(entrypoint)
    if (!reachable.has(ep)) {
      reachable.add(ep)
      queue.push(ep)
    }
  }

  while (queue.length > 0) {
    const file = queue.shift()!
    let source: string
    try {
      source = await readTextFile(file)
    }
    catch {
      continue
    }

    const refs = scanReExportSpecifiers(source, options)
    reExports.set(file, refs)

    for (const ref of refs) {
      const r = (options.resolveSpecifier ?? resolveRelativeSpecifier)(ref.specifier, file)
      if (!r.isRelative) continue
      if (r.resolved) {
        if (!reachable.has(r.resolved)) {
          reachable.add(r.resolved)
          queue.push(r.resolved)
        }
      }
      else {
        unresolved.push({ from: file, specifier: ref.specifier, isTypeOnly: ref.isTypeOnly })
      }
    }
  }

  return { reachable, reExports, unresolved }
}
