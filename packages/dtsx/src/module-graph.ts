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

import { existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { readTextFile } from './compat'

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
}

/**
 * Extensions tried, in order, when resolving an extensionless specifier.
 * `.d.ts` last so source files win over generated declarations.
 */
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.d.ts'] as const

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
 * Mirrors TypeScript's classic resolver for relative paths only — bare
 * specifiers (e.g. `react`, `@scope/foo`) return `{ resolved: null }`.
 */
export function resolveRelativeSpecifier(specifier: string, fromFile: string): ResolveResult {
  const isRel = specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..'
  if (!isRel && !isAbsolute(specifier)) {
    return { resolved: null, isRelative: false }
  }

  const baseDir = dirname(fromFile)
  const candidate = isAbsolute(specifier) ? specifier : resolve(baseDir, specifier)

  // 1. Specifier already includes its extension
  if (isFile(candidate)) {
    return { resolved: candidate, isRelative: true }
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
      const indexPath = `${candidate}/index${ext}`
      if (isFile(indexPath)) {
        return { resolved: indexPath, isRelative: true }
      }
    }
  }

  return { resolved: null, isRelative: true }
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
function stripComments(input: string): string {
  const len = input.length
  let out = ''
  let i = 0

  while (i < len) {
    const c = input.charCodeAt(i)

    // String / template literal — copy through verbatim
    if (c === 0x22 /* " */ || c === 0x27 /* ' */ || c === 0x60 /* ` */) {
      const quote = c
      out += input[i++]
      while (i < len) {
        const cc = input.charCodeAt(i)
        out += input[i++]
        if (cc === 0x5C /* \\ */ && i < len) {
          out += input[i++]
          continue
        }
        if (cc === quote) break
      }
      continue
    }

    if (c === 0x2F /* / */ && i + 1 < len) {
      const c2 = input.charCodeAt(i + 1)
      if (c2 === 0x2F /* / */) {
        i += 2
        while (i < len && input.charCodeAt(i) !== 0x0A) i++
        continue
      }
      if (c2 === 0x2A /* * */) {
        i += 2
        while (i + 1 < len && !(input.charCodeAt(i) === 0x2A && input.charCodeAt(i + 1) === 0x2F)) i++
        i += 2
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
const IMPORT_FROM = /(?:^|[\n;{}])\s*import\s+(type\s+)?(?:[^'";\n]+\s+from\s+)?(['"])([^'"]+)\2/g

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
  const code = stripComments(source)

  RE_EXPORT_FROM.lastIndex = 0
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = RE_EXPORT_FROM.exec(code)) !== null) {
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
      refs.push({ specifier: m[3], kind: 'import', isTypeOnly: !!m[1] })
    }
  }

  return refs
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
 * (recursively, with cycle protection) ends up in `reachable`. Files
 * whose source can't be read are skipped silently — the caller is the
 * one with the right context to decide whether that's an error.
 */
export async function collectReachableViaReExports(
  entrypoints: string[],
  options: { includeImports?: boolean } = {},
): Promise<ReachabilityResult> {
  const reachable = new Set<string>()
  const reExports = new Map<string, ReExportRef[]>()
  const unresolved: UnresolvedReExport[] = []

  const queue: string[] = []
  for (const ep of entrypoints) {
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
      // Only chase relative paths — bare specifiers are external packages.
      if (!(ref.specifier.startsWith('.') || isAbsolute(ref.specifier)))
        continue

      const r = resolveRelativeSpecifier(ref.specifier, file)
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
