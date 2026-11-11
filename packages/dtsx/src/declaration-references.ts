import type { Declaration } from './types'
import { bindingPatternNames } from './binding-patterns'
import type { SyntaxToken } from './module-references'
import { sourceSyntaxTokens, tokenizeDeclarationSyntax } from './module-references'

/** A direct const alias preserves the referenced value's type identity. */
export function directConstValueAlias(value: string): string | undefined {
  const tokens = tokenizeDeclarationSyntax(value)
  if (tokens.length !== 1 || tokens[0].kind !== 'word') return undefined
  const name = value.slice(tokens[0].start, tokens[0].end)
  return ['true', 'false', 'null', 'undefined', 'this', 'super'].includes(name) ? undefined : name
}

/** Whether a depth-zero brace starts a type operand instead of a function body. */
export function returnTypeExpectsObject(prefix: string): boolean {
  const tokens = tokenizeDeclarationSyntax(prefix)
  if (tokens.length === 0) return true
  const last = tokens[tokens.length - 1]
  const text = prefix.slice(last.start, last.end)
  if (last.kind === 'word' && (text === 'is' || text === 'extends')) return true
  if (text === '|' || text === '&') return true
  const previous = tokens[tokens.length - 2]
  return text === '>' && previous !== undefined && prefix.slice(previous.start, previous.end) === '='
}

/** Original top-level syntax, independent of imports or declarations pruned later. */
export function isExternalModuleSource(source: string): boolean {
  return isExternalModuleTokens(source, sourceSyntaxTokens(source))
}

/**
 * The same check for generated text, whose tokens nobody reuses. Emitted
 * declarations usually start with an import or export, and tokens ending
 * strictly before a cut are the same with or without the rest of the text
 * (lexing is left to right and never fails), so growing prefixes usually
 * answer after a few hundred bytes.
 */
export function isExternalModuleText(text: string): boolean {
  for (let cut = 1024; cut < text.length; cut *= 8) {
    const prefix = text.slice(0, cut)
    const verdict = moduleVerdict(prefix, tokenizeDeclarationSyntax(prefix), cut)
    if (verdict !== undefined) return verdict
  }
  return isExternalModuleTokens(text, tokenizeDeclarationSyntax(text))
}

function isExternalModuleTokens(source: string, tokens: readonly SyntaxToken[]): boolean {
  return moduleVerdict(source, tokens, Infinity) ?? false
}

/**
 * true/false once the tokens decide the question; undefined when a token
 * reaching `trustedEnd` (possibly cut short) would have to be inspected.
 */
function moduleVerdict(source: string, tokens: readonly SyntaxToken[], trustedEnd: number): boolean | undefined {
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.end >= trustedEnd) return undefined
    if (token.kind === 'punctuation') {
      // Only one-character punctuation tokens can be brackets.
      const code = source.charCodeAt(token.start)
      if (code === 123 || code === 40 || code === 91) depth++
      else if (code === 125 || code === 41 || code === 93) depth--
      continue
    }
    if (depth !== 0 || token.kind !== 'word' || token.end - token.start !== 6) continue
    const text = source.slice(token.start, token.end)
    if (text === 'export') return true
    if (text === 'import') {
      const following = tokens[i + 1]
      if (following === undefined ? trustedEnd !== Infinity : following.end >= trustedEnd) return undefined
      const next = following ? source.slice(following.start, following.end) : ''
      if (next !== '(' && next !== '.') return true
    }
  }
  return trustedEnd === Infinity ? false : undefined
}

/** Bindings in an ambient external module are implicitly exported without a clause. */
export function isPrivateImportableDeclaration(declaration: Declaration): boolean {
  if (declaration.isExported) return false
  if (['function', 'variable', 'interface', 'type', 'class', 'enum', 'namespace'].includes(declaration.kind)) return true
  return declaration.kind === 'module' && (declaration.moduleForm === 'namespace' || declaration.moduleForm === 'identifier')
}

/** Functions have value bindings. Type names and labels cannot retain them. */
export function collectDeclarationValueReferences(declaration: Declaration, references: Set<string>, typeReferences?: { candidates: ReadonlyMap<string, Declaration>, references: Set<string> }): void {
  const source = declaration.text
  const tokens = tokenizeDeclarationSyntax(source)
  const text = (i: number): string => tokens[i] ? source.slice(tokens[i].start, tokens[i].end) : ''
  const word = (i: number): boolean => tokens[i]?.kind === 'word'
  const pairs = new Map<number, number>()
  const genericOpenings = new Map<number, number>()
  const stack: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = text(i)
    if (token === '(' || token === '[' || token === '{' || token === '<') stack.push(i)
    else if (token === ')' || token === ']' || token === '}' || token === '>' && text(i - 1) !== '=') {
      const opening = stack.at(-1)
      if (opening !== undefined && (text(opening) === '(' && token === ')' || text(opening) === '[' && token === ']' || text(opening) === '{' && token === '}' || text(opening) === '<' && token === '>')) {
        stack.pop()
        pairs.set(opening, i)
        if (text(opening) === '<') genericOpenings.set(i, opening)
      }
    }
  }

  const memberHeader = (start: number): boolean => {
    let label = start
    while (['readonly', 'public', 'private', 'protected', 'static', 'abstract', 'override', 'declare', 'accessor', 'get', 'set', 'async'].includes(text(label))
      && (word(label + 1) || tokens[label + 1]?.kind === 'quoted' || text(label + 1) === '[' || /^[0-9]/.test(text(label + 1)))) label++
    if (text(label) === '(') return text((pairs.get(label) ?? tokens.length) + 1) === ':'
    if (text(label) === '<') return text((pairs.get(label) ?? tokens.length) + 1) === '('
    let after = label + 1
    if (text(label) === '[') after = (pairs.get(label) ?? tokens.length) + 1
    else if (source.charCodeAt(tokens[label]?.start ?? source.length) >= 48 && source.charCodeAt(tokens[label]?.start ?? source.length) <= 57) {
      // Numeric labels can span punctuation and word tokens, for example 1e3.
      while (after < tokens.length && tokens[after - 1].end === tokens[after].start && /^[\da-fxob_e.+-]+$/i.test(text(after))) after++
    }
    else if (!word(label) && tokens[label]?.kind !== 'quoted' && tokens[label]?.kind !== 'literal') return false
    if (text(after) === '?') after++
    if (text(after) === '<') after = (pairs.get(after) ?? tokens.length) + 1
    return text(after) === ':' || text(after) === '('
  }

  const scopes: Array<{ start: number, end: number, names: Set<string> }> = []
  const genericScopes: typeof scopes = []
  for (let open = 0; open < tokens.length; open++) {
    if (text(open) !== '(') continue
    const close = pairs.get(open)
    if (close === undefined || !(text(close + 1) === ':' || text(close + 1) === '=' && text(close + 2) === '>')) continue
    const names = new Set<string>()
    let parameter = open + 1
    while (parameter < close) {
      let end = parameter
      while (end < close && text(end) !== ',') {
        const nested = pairs.get(end)
        if (nested !== undefined) end = nested + 1
        else end++
      }
      let bindingEnd = parameter
      while (bindingEnd < end && text(bindingEnd) !== ':' && text(bindingEnd) !== '=') {
        const nested = pairs.get(bindingEnd)
        if (nested !== undefined) bindingEnd = nested + 1
        else bindingEnd++
      }
      let first = parameter
      while (['.', 'public', 'private', 'protected', 'readonly', 'override'].includes(text(first))) first++
      if (text(first) === '{' || text(first) === '[') {
        for (const name of bindingPatternNames(source.slice(tokens[first].start, tokens[bindingEnd - 1].end))) names.add(name)
      }
      else if (word(first)) names.add(text(first))
      parameter = end + 1
    }
    let end = close + (text(close + 1) === ':' ? 2 : 3)
    while (end < tokens.length) {
      // Declaration emitters may omit member semicolons. A new member's
      // label ends this signature even when it follows on the next line.
      if (end > close + 2 && source.slice(tokens[end - 1].end, tokens[end].start).includes('\n')
        && !['|', '&', '?', 'extends', 'keyof', 'typeof', 'readonly', 'new', 'infer', 'is'].includes(text(end - 1))
        && memberHeader(end)) break
      if ([';', ',', ')', ']', '}'].includes(text(end)) || text(end) === '>' && text(end - 1) !== '=') break
      const nested = pairs.get(end)
      if (nested !== undefined) end = nested + 1
      else end++
    }
    scopes.push({ start: open, end, names })
    const genericOpen = genericOpenings.get(open - 1)
    if (typeReferences && genericOpen !== undefined) {
      const genericNames = new Set<string>()
      let parameter = genericOpen + 1
      while (parameter < open - 1) {
        while (['const', 'in', 'out'].includes(text(parameter))) parameter++
        if (word(parameter)) genericNames.add(text(parameter))
        while (parameter < open - 1 && text(parameter) !== ',') parameter = (pairs.get(parameter) ?? parameter) + 1
        parameter++
      }
      genericScopes.push({ start: genericOpen, end, names: genericNames })
    }
  }

  const valuePositions = typeReferences ? new Set<number>() : undefined
  const add = (i: number): void => {
    if (!word(i)) return
    valuePositions?.add(tokens[i].start)
    const name = text(i)
    if (!scopes.some(scope => i >= scope.start && i < scope.end && scope.names.has(name))) references.add(name)
  }

  const expression = (start: number, end: number): void => {
    for (let i = start; i < end; i++) {
      if (text(i) === '<' && pairs.has(i)) { i = pairs.get(i)!; continue }
      if (!word(i) || text(i - 1) === '.' || text(i + 1) === ':') continue
      if (['true', 'false', 'null', 'undefined', 'new', 'this', 'super', 'as', 'satisfies', 'typeof', 'void', 'keyof'].includes(text(i))) continue
      add(i)
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    if (text(i) === 'typeof') add(i + 1)
    if (text(i) === 'export') {
      let next = i + 1
      if (text(next) === 'default') {
        if (!['function', 'class', 'abstract'].includes(text(next + 1))) {
          expression(next + 1, tokens.length)
          if (word(next + 1) && typeReferences?.candidates.has(text(next + 1)) && (text(next + 2) === ';' || next + 2 === tokens.length)) typeReferences.references.add(text(next + 1))
        }
        continue
      }
      const typeOnly = text(next) === 'type'
      if (typeOnly) next++
      if (text(next) === '{') {
        const close = pairs.get(next)
        if (close === undefined || text(close + 1) === 'from') continue
        for (let item = next + 1; item < close; ) {
          const inlineType = text(item) === 'type' && word(item + 1) && text(item + 1) !== 'as'
          if (inlineType) item++
          const hasType = typeReferences?.candidates.has(text(item))
          if (hasType) typeReferences!.references.add(text(item))
          if (!hasType || !typeOnly && !inlineType) add(item)
          else valuePositions?.add(tokens[item].start)
          while (item < close && text(item) !== ',') item++
          item++
        }
      }
    }
    if (text(i) === '[') {
      const close = pairs.get(i)
      if (close !== undefined && [':', '?', '('].includes(text(close + 1)) && text(i + 2) !== ':' && text(i + 2) !== 'in') expression(i + 1, close)
    }
  }

  if (declaration.kind === 'class') {
    let heritage = -1
    for (let i = 0; i < tokens.length && text(i) !== '{'; i++) {
      if (text(i) === '<' && pairs.has(i)) i = pairs.get(i)!
      else if (text(i) === 'extends') { heritage = i; break }
    }
    if (heritage !== -1) {
      let end = heritage + 1
      while (end < tokens.length && text(end) !== '{' && text(end) !== 'implements') {
        const nested = pairs.get(end)
        if (nested !== undefined) end = nested + 1
        else end++
      }
      expression(heritage + 1, end)
    }
  }
  if (typeReferences) {
    const genericNames = new Set<string>()
    const genericTokens = tokenizeDeclarationSyntax(declaration.generics ?? '')
    let depth = 0
    let parameter = false
    for (const token of genericTokens) {
      const value = (declaration.generics ?? '').slice(token.start, token.end)
      if (['<', '(', '[', '{'].includes(value)) { depth++; if (value === '<' && depth === 1) parameter = true }
      else if (['>', ')', ']', '}'].includes(value) && !(value === '>' && (declaration.generics ?? '').slice(token.start - 1, token.start) === '=')) depth--
      else if (value === ',' && depth === 1) parameter = true
      else if (parameter && depth === 1 && token.kind === 'word' && !['const', 'in', 'out'].includes(value)) { genericNames.add(value); parameter = false }
    }
    const events = genericScopes.flatMap(scope => [...scope.names].flatMap(name => [
      { index: scope.start, name, delta: 1 }, { index: scope.end, name, delta: -1 },
    ])).sort((left, right) => left.index - right.index)
    const active = new Map<string, number>()
    let event = 0
    for (let i = 0; i < tokens.length; i++) {
      while (event < events.length && events[event].index <= i) {
        const entry = events[event++]
        active.set(entry.name, (active.get(entry.name) ?? 0) + entry.delta)
      }
      if (!word(i) || valuePositions?.has(tokens[i].start) || !typeReferences.candidates.has(text(i)) || genericNames.has(text(i)) || (active.get(text(i)) ?? 0) > 0) continue
      const before = text(i - 1)
      const after = text(i + 1)
      if (before === '.' || before === 'as' && declaration.kind === 'export' || ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'namespace', 'module'].includes(before)) continue
      if (after === ':' && before !== '?' || after === '?' && [':', '('].includes(text(i + 2)) || after === '(' || after === '<' && text((pairs.get(i + 1) ?? tokens.length) + 1) === '(') continue
      typeReferences.references.add(text(i))
    }
  }

}
