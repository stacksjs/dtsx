/**
 * Find type names an emitted `.d.ts` uses but never defines.
 *
 * ## The failure this catches
 *
 * A source file can compile, bundle, publish and install without anybody
 * noticing that one of its types came from an ambient global:
 *
 *     // src/store.ts — no import for ModelRow or Review
 *     type ReviewRow = ModelRow<typeof Review>
 *     export function store(data: ReviewRow): Promise<ReviewRow> { … }
 *
 * Inside the authoring repo those names resolve, because a global `.d.ts`
 * somewhere declares them. dtsx faithfully carries the alias into the output,
 * because that is what the source says — but the emitted declaration lands in
 * a consumer that has no such global, and there `ModelRow` and `Review` are
 * simply undefined. TypeScript degrades the whole signature: the parameter
 * resolves to `never`, so *no argument is assignable to it*, and casting does
 * not help because nothing is assignable to `never`.
 *
 * The build is green. The publish is green. The package is broken for everyone
 * who installs it, and the error they see names neither the real cause nor the
 * package that caused it. That is what this exists to stop.
 *
 * ## Why not just run TypeScript over the output
 *
 * That is the accurate way and `checker.ts` does it, but it needs a working
 * `typescript` and a tsconfig that resolves the package's own dependencies. A
 * generator should be able to tell you it produced something broken without
 * either, so this reads the emitted text and nothing else.
 *
 * ## Conservative by construction
 *
 * A false positive here would fail a build over nothing, so anything
 * ambiguous is treated as resolved:
 *
 *   - only PascalCase identifiers are considered, since the lowercase
 *     primitives are keywords and local generics are collected anyway
 *   - the whole TypeScript global lib surface is exempt
 *   - anything declared or imported anywhere in the file counts, regardless of
 *     order
 *   - a name used only as a value, a property, or a string is ignored
 *
 * The result is that it under-reports rather than over-reports.
 */

import { GLOBAL_TYPE_NAMES } from './global-types'

export interface DanglingReference {
  /** The unresolved type name, e.g. `ModelRow`. */
  name: string
  /** 1-indexed line in the emitted `.d.ts`. */
  line: number
  /** The declaration text that referenced it, trimmed for display. */
  context: string
}

/** Reserved words that can begin a line but never name a type reference. */
const KEYWORDS = new Set([
  'This', 'True', 'False', 'Null', 'Undefined', 'Void', 'Never', 'Any',
  'Unknown', 'Object', 'Infinity', 'NaN',
])

/**
 * Blank out comments, and optionally string/template literals.
 *
 * A type name mentioned in prose ("returns a ModelRow") or inside a string
 * literal type is not a reference, and counting it is the easiest way to
 * produce a false positive.
 *
 * Strings are kept for the import scan, because a module specifier *is* a
 * string and blanking it leaves `from` with nothing after it — which silently
 * made every import invisible and reported correctly-imported types as
 * dangling.
 *
 * Everything blanked is replaced space-for-space so line numbers survive.
 */
function stripNonCode(source: string, options: { strings: boolean } = { strings: true }): string {
  let out = ''
  let index = 0

  while (index < source.length) {
    const two = source.slice(index, index + 2)

    if (two === '//') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      // Keep the newlines so line numbers survive.
      out += ' '.repeat(stop - index)
      index = stop
      continue
    }

    if (two === '/*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      for (let i = index; i < stop; i++) out += source[i] === '\n' ? '\n' : ' '
      index = stop
      continue
    }

    const char = source[index]!
    if (options.strings && (char === '"' || char === '\'' || char === '`')) {
      const quote = char
      out += ' '
      index++
      while (index < source.length) {
        if (source[index] === '\\') {
          out += '  '
          index += 2
          continue
        }
        if (source[index] === quote) {
          out += ' '
          index++
          break
        }
        out += source[index] === '\n' ? '\n' : ' '
        index++
      }
      continue
    }

    out += char
    index++
  }

  return out
}

/** Every name the file declares itself, in any position. */
function collectDeclared(code: string): Set<string> {
  const declared = new Set<string>()

  const patterns = [
    // type / interface / class / enum / namespace / module
    /\b(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(?:type|interface|class|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/g,
    // function / const / let / var
    /\b(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /\b(?:export\s+)?declare\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  ]

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern))
      declared.add(match[1]!)
  }

  return declared
}

/** Every name the file imports, under whatever local alias it uses. */
function collectImported(code: string): Set<string> {
  const imported = new Set<string>()

  for (const match of code.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"`]/g)) {
    const clause = match[1]!

    // `import * as NS from …`
    const namespaced = /\*\s*as\s+([A-Za-z_$][\w$]*)/.exec(clause)
    if (namespaced)
      imported.add(namespaced[1]!)

    // `import Default, { … } from …`
    const beforeBrace = clause.split('{')[0]!.replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, '')
    for (const part of beforeBrace.split(',')) {
      const name = part.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name))
        imported.add(name)
    }

    // `{ A, type B, C as D }` — the binding is what the file can reference.
    const braced = /\{([\s\S]*?)\}/.exec(clause)
    if (braced) {
      for (const entry of braced[1]!.split(',')) {
        const cleaned = entry.trim().replace(/^type\s+/, '')
        if (!cleaned)
          continue
        const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(cleaned)
        imported.add(alias ? alias[1]! : cleaned.split(/\s+/)[0]!)
      }
    }
  }

  // `import('…').Thing` resolves through the module, not this file's scope.
  for (const match of code.matchAll(/\bimport\s*\(\s*['"`][^'"`]*['"`]\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g))
    imported.add(match[1]!)

  return imported
}

/**
 * Type parameters introduced anywhere in the file.
 *
 * Collected file-wide rather than per scope: a `T` declared on one function
 * and referenced in another is a different bug, and not this one's business.
 * Over-collecting here only makes the check quieter.
 */
function collectTypeParameters(code: string): Set<string> {
  const params = new Set<string>()

  const add = (list: string) => {
    for (const entry of list.split(',')) {
      // `T extends X = Y` introduces T; X and Y are references, not parameters.
      const name = entry.trim().split(/\s+|=/)[0]?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name))
        params.add(name)
    }
  }

  // The `<…>` immediately following a declaration name.
  const declarationHead = /\b(?:type|interface|class|function)\s+[A-Za-z_$][\w$]*\s*<([^<>]*(?:<[^<>]*>[^<>]*)*)>/g
  for (const match of code.matchAll(declarationHead))
    add(match[1]!)

  // Generics on a call or method signature: a method in an interface body, or
  // a bare arrow type. Neither follows one of the keywords above, so this
  // pattern anchors on the parameter list that comes after instead.
  for (const match of code.matchAll(/(?:\b[A-Za-z_$][\w$]*)?\s*<([^<>()]*)>\s*\(/g))
    add(match[1]!)

  // A name introduced by `infer` in a conditional type. Missing these reported
  // dtsx's own `ExtractBase` helper as referencing an undefined type: it was
  // the single file in dtsx's output that this check tripped on.
  for (const match of code.matchAll(/\binfer\s+([A-Za-z_$][\w$]*)/g))
    params.add(match[1]!)

  // `{ [K in keyof T]: … }` introduces K.
  for (const match of code.matchAll(/\[\s*([A-Za-z_$][\w$]*)\s+in\b/g))
    params.add(match[1]!)

  return params
}

/**
 * Identifiers used in a type position, with the line they appear on.
 *
 * Rather than parse, this walks the regions where a type can legally appear —
 * the right-hand side of an alias, an `extends`/`implements` clause, an
 * annotation after `:`, and the inside of a `<…>` argument list — and takes
 * the PascalCase identifiers out of them.
 */
function collectReferences(code: string): Map<string, { line: number, context: string }> {
  const references = new Map<string, { line: number, context: string }>()

  const lineOf = (offset: number): number => {
    let line = 1
    for (let i = 0; i < offset && i < code.length; i++) {
      if (code.charCodeAt(i) === 10)
        line++
    }
    return line
  }

  const record = (region: string, offset: number, context: string) => {
    for (const match of region.matchAll(/\b([A-Z][\w$]*)\b/g)) {
      const name = match[1]!
      if (references.has(name))
        continue

      // A property name is not a type reference. Inline object types inside a
      // generic put PascalCase members right where a type would otherwise sit,
      // and reading those as undefined types is the biggest source of noise
      // this check can produce: it flagged forty files of AWS-shaped
      // declarations that were entirely correct. Anything followed by `:` or
      // `?:` is the left of a member, so skip it.
      const after = region.slice(match.index! + name.length)
      if (/^\s*\??:/.test(after))
        continue

      references.set(name, { line: lineOf(offset), context: context.trim().slice(0, 120) })
    }
  }

  // `type X = …` up to the terminating semicolon or newline.
  for (const match of code.matchAll(/\btype\s+[A-Za-z_$][\w$]*\s*(?:<[^=]*?>)?\s*=([^;]*)/g))
    record(match[1]!, match.index! + match[0].indexOf('='), match[0])

  // `extends` / `implements` heritage.
  for (const match of code.matchAll(/\b(?:extends|implements)\s+([^{;]*)/g))
    record(match[1]!, match.index!, match[0])

  // Annotations: `: Type` in parameters, properties and return positions.
  for (const match of code.matchAll(/:\s*([^;,){}\n=]+)/g))
    record(match[1]!, match.index!, match[0])

  // Generic argument lists.
  for (const match of code.matchAll(/<([^<>()]*)>/g))
    record(match[1]!, match.index!, match[0])

  return references
}

/**
 * Type names the emitted declaration references but never resolves.
 *
 * Returns an empty array for a self-contained file, which is the normal case.
 */
export function findDanglingTypeReferences(dts: string): DanglingReference[] {
  const code = stripNonCode(dts)
  // Imports are read with strings intact; see stripNonCode.
  const withStrings = stripNonCode(dts, { strings: false })

  const resolved = new Set<string>([
    ...collectDeclared(code),
    ...collectImported(withStrings),
    ...collectTypeParameters(code),
    ...GLOBAL_TYPE_NAMES,
    ...KEYWORDS,
  ])

  const dangling: DanglingReference[] = []

  for (const [name, where] of collectReferences(code)) {
    if (resolved.has(name))
      continue

    // A member expression's tail (`ts.Program`, `NS.Thing`) resolves through
    // its namespace, which is what was checked above.
    if (new RegExp(`[\\w$]\\s*\\.\\s*${name}\\b`).test(code))
      continue

    dangling.push({ name, line: where.line, context: where.context })
  }

  return dangling.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name))
}
