import type { Declaration } from './types'
import { tokenizeDeclarationSyntax } from './module-references'
import { inferNarrowType } from './processor/type-inference'

/** Retain TypeScript's function/namespace merging for authored expando assignments. */
export function attachFunctionProperties(source: string, declarations: Declaration[], candidates: ReadonlyMap<string, Declaration>, groups: ReadonlyMap<string, Declaration[]>): void {
  const bindings = new Map<string, Declaration>()
  const functions = new Map<string, Declaration>()
  for (const declaration of [...declarations, ...candidates.values(), ...[...groups.values()].flat()]) {
    bindings.set(declaration.name, declaration)
    if (declaration.kind === 'function' && !functions.has(declaration.name)) functions.set(declaration.name, declaration)
  }
  for (const [name, group] of groups) if (group.length) functions.set(name, group[0])
  if (!functions.size) return
  const overloaded = new Set<string>()
  for (const [name, group] of groups) if (group.length > 1) overloaded.add(name)
  const counts = new Map<string, number>()
  for (const declaration of declarations) if (declaration.kind === 'function') {
    const count = (counts.get(declaration.name) ?? 0) + 1
    counts.set(declaration.name, count)
    if (count > 1) overloaded.add(declaration.name)
  }
  const tokens = tokenizeDeclarationSyntax(source)
  const text = (index: number): string => tokens[index] ? source.slice(tokens[index].start, tokens[index].end) : ''
  const properties = new Map<string, Map<string, string[]>>()
  let depth = 0
  for (let index = 0; index < tokens.length; index++) {
    const word = text(index)
    if (['(', '[', '{'].includes(word)) { depth++; continue }
    if ([')', ']', '}'].includes(word)) { depth--; continue }
    if (depth || !functions.has(word) || text(index + 1) !== '.' || tokens[index + 2]?.kind !== 'word' || text(index + 3) !== '=') continue
    const property = text(index + 2)
    const start = index + 4
    let end = start
    let nesting = 0
    for (; end < tokens.length; end++) {
      const token = text(end)
      if (!nesting && token === ';') break
      if (!nesting && end > start && /[\r\n]/.test(source.slice(tokens[end - 1].end, tokens[end].start))
        && (['export', 'const', 'let', 'var', 'function', 'class'].includes(token) || functions.has(token) && text(end + 1) === '.')) break
      if (['(', '[', '{'].includes(token)) nesting++
      else if ([')', ']', '}'].includes(token)) nesting--
    }
    if (end === start) continue
    const type = assignedType(source.slice(tokens[start].start, tokens[end - 1].end), bindings, overloaded)
    let members = properties.get(word)
    if (!members) properties.set(word, members = new Map())
    let types = members.get(property)
    if (!types) members.set(property, types = [])
    if (!types.includes(type)) types.push(type)
    index = end - 1
  }
  for (const [name, members] of properties) {
    const declaration = functions.get(name)!
    const body = [...members].map(([property, types]) => `  let ${property}: ${types.map(type => type.includes('=>') && types.length > 1 ? `(${type})` : type).join(' | ')};`).join('\n')
    const exported = declaration.isExported && !declaration.isDefault ? 'export ' : ''
    if (declaration.isDefault) declaration.text = declaration.text.replace('export default function ', 'declare function ')
    declaration.text += `\n${exported}declare namespace ${name} {\n${body}\n}`
    if (declaration.isDefault) declaration.text += `\nexport default ${name};`
  }
}

function assignedType(expression: string, bindings: ReadonlyMap<string, Declaration>, overloaded: ReadonlySet<string>, depth = 0): string {
  const value = expression.trim()
  const binding = bindings.get(value)
  if (binding?.kind === 'variable' && depth < 64) {
    if (binding.typeAnnotation) return binding.typeAnnotation === 'unique symbol' ? `typeof ${value}` : binding.typeAnnotation
    if (typeof binding.value === 'string') return assignedType(binding.value, bindings, overloaded, depth + 1)
  }
  const inferred = inferNarrowType(value, false)
  if (inferred !== 'unknown') return inferred
  const tokens = tokenizeDeclarationSyntax(value)
  if (tokens[0]?.kind === 'word' && tokens[1] && value.slice(tokens[1].start, tokens[1].end) === '(' && value.endsWith(')')) {
    let depth = 0
    let close = -1
    for (let index = 1; index < tokens.length; index++) {
      const token = value.slice(tokens[index].start, tokens[index].end)
      if (token === '(') depth++
      else if (token === ')' && --depth === 0) { close = index; break }
    }
    if (close !== tokens.length - 1) return inferred
    const name = value.slice(tokens[0].start, tokens[0].end)
    const callee = bindings.get(name)
    if (callee?.kind === 'function' && !callee.generics && !overloaded.has(name)) return `ReturnType<typeof ${name}>`
  }
  if (/^[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*$/.test(value)) return `typeof ${value}`
  return inferred
}
