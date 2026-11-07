import type { KeyBinding, KeyConstant, KeyConstants } from './computed-keys'
import type { Declaration } from './types'
import { evaluateKeyConstant } from './computed-keys'
import { decodeStringLiteral, quoteModuleSpecifier, tokenizeDeclarationSyntax } from './module-references'

function literal(value: KeyConstant): string {
  return typeof value === 'string' ? quoteModuleSpecifier(value, "'") : String(value)
}

/** Runtime enum values become uninitialized numeric ambient members. */
export function lowerEnumBody(body: string, name: string, outer: KeyConstants = new Map()): { body: string, members: Map<string, KeyBinding> } {
  const tokens = tokenizeDeclarationSyntax(body)
  const constants = new Map(outer)
  const members = new Map<string, KeyBinding>()
  const edits: Array<{ start: number, end: number, text: string }> = []
  let start = 1
  let depth = 0
  let next: number | undefined = 0
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index]
    const text = body.slice(token.start, token.end)
    if (token.kind === 'punctuation' && depth === 0 && (text === ',' || text === '}')) {
      const entry = tokens.slice(start, index)
      const key = entry[0]
      if (key) {
        const memberName = key.kind === 'quoted' ? decodeStringLiteral(body.slice(key.start, key.end)) : body.slice(key.start, key.end)
        const equals = entry.findIndex(item => item.kind === 'punctuation' && body[item.start] === '=')
        let value: KeyConstant | undefined = next
        if (equals >= 0) {
          const expression = entry.slice(equals + 1)
          let rewritten = ''
          let cursor = entry[equals].end
          for (let i = 0; i + 2 < expression.length; i++) {
            const [left, dot, right] = expression.slice(i, i + 3)
            if (left.kind !== 'word' || right.kind !== 'word' || body.slice(dot.start, dot.end) !== '.') continue
            const binding = constants.get(`${body.slice(left.start, left.end)}.${body.slice(right.start, right.end)}`)
            if (binding === undefined || typeof binding === 'object') continue
            rewritten += body.slice(cursor, left.start) + literal(binding)
            cursor = right.end
            i += 2
          }
          rewritten += body.slice(cursor, entry.at(-1)!.end)
          value = evaluateKeyConstant(rewritten, constants)
          edits.push({ start: entry[equals].start, end: entry.at(-1)!.end, text: value === undefined ? '' : `= ${literal(value)}` })
        }
        else if (value !== undefined) edits.push({ start: key.end, end: key.end, text: ` = ${literal(value)}` })
        next = typeof value === 'number' ? value + 1 : undefined
        if (memberName !== undefined) {
          // An unknown member shadows an outer constant with the same name.
          constants.delete(memberName)
          constants.delete(`${name}.${memberName}`)
          if (value !== undefined) {
            members.set(memberName, value)
            constants.set(memberName, value)
            constants.set(`${name}.${memberName}`, value)
          }
        }
      }
      start = index + 1
    }
    else if (token.kind === 'punctuation') {
      if ('([{'.includes(text)) depth++
      else if (')]}'.includes(text)) depth--
    }
  }
  let result = body
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  return { body: result, members }
}

/** Preserve source constants before pruning implementation-only declarations. */
export function attachEnumBodies(declarations: Declaration[], privateDeclarations: ReadonlyMap<string, Declaration>): void {
  const ordered = [...new Set([...declarations, ...privateDeclarations.values()])]
  if (!ordered.some(item => item.kind === 'enum')) return
  ordered.sort((left, right) => (left.start ?? 0) - (right.start ?? 0))
  const constants = new Map<string, KeyBinding>()
  for (const declaration of ordered) {
    if (declaration.kind === 'enum') {
      const start = declaration.text.indexOf('{')
      if (start < 0) continue
      if (tokenizeDeclarationSyntax(declaration.text.slice(0, start)).some(token => declaration.text.slice(token.start, token.end) === 'declare')) continue
      const lowered = lowerEnumBody(declaration.text.slice(start), declaration.name, constants)
      declaration.text = declaration.text.slice(0, start) + lowered.body
      for (const [member, value] of lowered.members) constants.set(`${declaration.name}.${member}`, value)
    }
    else if (declaration.kind === 'variable' && declaration.modifiers?.[0] === 'const' && !declaration.typeAnnotation
      && !declaration.modifiers.includes('const assertion') && typeof declaration.value === 'string') {
      const value = evaluateKeyConstant(declaration.value, constants)
      if (value !== undefined) constants.set(declaration.name, value)
    }
  }
}
