import type { Declaration } from './types'
import { tokenizeDeclarationSyntax } from './module-references'

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
  const tokens = tokenizeDeclarationSyntax(source)
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const text = source.slice(token.start, token.end)
    const next = tokens[i + 1] ? source.slice(tokens[i + 1].start, tokens[i + 1].end) : ''
    if (depth === 0 && token.kind === 'word' && (text === 'export' || (text === 'import' && next !== '(' && next !== '.'))) return true
    if (text === '{' || text === '(' || text === '[') depth++
    else if (text === '}' || text === ')' || text === ']') depth--
  }
  return false
}

/** Bindings in an ambient external module are implicitly exported without a clause. */
export function isPrivateImportableDeclaration(declaration: Declaration): boolean {
  if (declaration.isExported) return false
  if (['function', 'variable', 'interface', 'type', 'class', 'enum', 'namespace'].includes(declaration.kind)) return true
  return declaration.kind === 'module' && (declaration.moduleForm === 'namespace' || declaration.moduleForm === 'identifier')
}

/** Functions have value bindings. Type names and labels cannot retain them. */
export function collectDeclarationValueReferences(declaration: Declaration, references: Set<string>): void {
  const source = declaration.text
  const tokens = tokenizeDeclarationSyntax(source)
  const text = (i: number): string => tokens[i] ? source.slice(tokens[i].start, tokens[i].end) : ''
  const word = (i: number): boolean => tokens[i]?.kind === 'word'
  const pairs = new Map<number, number>()
  const stack: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = text(i)
    if (token === '(' || token === '[' || token === '{' || token === '<') stack.push(i)
    else if (token === ')' || token === ']' || token === '}' || token === '>' && text(i - 1) !== '=') {
      const opening = stack.at(-1)
      if (opening !== undefined && (text(opening) === '(' && token === ')' || text(opening) === '[' && token === ']' || text(opening) === '{' && token === '}' || text(opening) === '<' && token === '>')) {
        stack.pop()
        pairs.set(opening, i)
      }
    }
  }

  const scopes: Array<{ start: number, end: number, names: Set<string> }> = []
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
      if (word(first)) names.add(text(first))
      for (let i = parameter; i < bindingEnd; i++) {
        if (word(i) && text(i + 1) !== ':' && !['public', 'private', 'protected', 'readonly', 'override'].includes(text(i))) names.add(text(i))
      }
      parameter = end + 1
    }
    let end = close + (text(close + 1) === ':' ? 2 : 3)
    while (end < tokens.length) {
      if ([';', ',', ')', ']', '}'].includes(text(end)) || text(end) === '>' && text(end - 1) !== '=') break
      const nested = pairs.get(end)
      if (nested !== undefined) end = nested + 1
      else end++
    }
    scopes.push({ start: open, end, names })
  }

  const add = (i: number): void => {
    if (!word(i)) return
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
        if (!['function', 'class', 'abstract'].includes(text(next + 1))) expression(next + 1, tokens.length)
        continue
      }
      if (text(next) === 'type') next++
      if (text(next) === '{') {
        const close = pairs.get(next)
        if (close === undefined || text(close + 1) === 'from') continue
        for (let item = next + 1; item < close; ) {
          if (text(item) === 'type' && word(item + 1) && text(item + 1) !== 'as') item++
          add(item)
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
}
