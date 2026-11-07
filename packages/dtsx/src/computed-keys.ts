import type { Declaration } from './types'
import { decodeStringLiteral, quoteModuleSpecifier, tokenizeDeclarationSyntax } from './module-references'

export type KeyConstant = string | number
export type KeyBinding = KeyConstant | { kind: 'symbol' }
export type KeyConstants = ReadonlyMap<string, KeyBinding> & { mutableBindingTypes?: ReadonlyMap<string, string> }
const symbolBinding: { kind: 'symbol' } = { kind: 'symbol' }

const numericPrefix = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[\d_]+(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?)/
const precedence: Record<string, number> = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '>>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7 }
const operators = ['>>>', '<<', '>>', '**', '+', '-', '*', '/', '%', '|', '^', '&']

/** Evaluate the string/number constant grammar used by computed template keys. */
export function evaluateKeyConstant(expression: string, constants: KeyConstants, depth = 0): KeyConstant | undefined {
  if (depth >= 64) return undefined
  const source = expression.trim()
  const tokens = tokenizeDeclarationSyntax(source)
  if (!tokens.length) return undefined
  if (tokens[0].start !== 0 || tokens[tokens.length - 1].end !== source.length)
    return evaluateKeyConstant(source.slice(tokens[0].start, tokens[tokens.length - 1].end), constants, depth + 1)
  if (tokens.length === 1 && tokens[0].kind === 'quoted') return decodeStringLiteral(source)
  if (tokens.length === 1 && tokens[0].kind === 'word') {
    const value = constants.get(source)
    return typeof value === 'object' ? undefined : value
  }
  const numeric = numericPrefix.exec(source)
  if (numeric?.[0].length === source.length) {
    const value = Number(source.replaceAll('_', ''))
    return Number.isFinite(value) ? value : undefined
  }
  let nesting = 0
  let selected: { start: number, operator: string, priority: number } | undefined
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const text = source.slice(token.start, token.end)
    if (token.kind !== 'punctuation') continue
    if (['(', '[', '{'].includes(text)) { nesting++; continue }
    if ([')', ']', '}'].includes(text)) { nesting--; continue }
    const number = numericPrefix.exec(source.slice(token.start))
    if (number) {
      while (tokens[index + 1]?.start < token.start + number[0].length) index++
      continue
    }
    if (nesting) continue
    const operator = operators.find(item => source.startsWith(item, token.start))
    if (!operator) continue
    // The operand test distinguishes a unary sign from a binary operator.
    const previous = tokens[index - 1]
    const before = previous ? source.slice(previous.start, previous.end) : ''
    const unary = !previous || previous.kind === 'punctuation' && ![')', ']'].includes(before) && !/\d/.test(before)
    if (!unary && (!selected || precedence[operator] < selected.priority
      || precedence[operator] === selected.priority && operator !== '**')) {
      selected = { start: token.start, operator, priority: precedence[operator] }
    }
    while (tokens[index + 1]?.start < token.start + operator.length) index++
  }
  if (selected) {
    const left = evaluateKeyConstant(source.slice(0, selected.start), constants, depth + 1)
    const right = evaluateKeyConstant(source.slice(selected.start + selected.operator.length), constants, depth + 1)
    if (left === undefined || right === undefined) return undefined
    if (selected.operator === '+' && (typeof left === 'string' || typeof right === 'string')) return String(left) + String(right)
    if (typeof left !== 'number' || typeof right !== 'number') return undefined
    let result: number
    switch (selected.operator) {
      case '+': result = left + right; break
      case '-': result = left - right; break
      case '*': result = left * right; break
      case '/': result = left / right; break
      case '%': result = left % right; break
      case '**': result = left ** right; break
      case '<<': result = left << right; break
      case '>>': result = left >> right; break
      case '>>>': result = left >>> right; break
      case '|': result = left | right; break
      case '^': result = left ^ right; break
      case '&': result = left & right; break
      default: return undefined
    }
    return Number.isFinite(result) ? result : undefined
  }
  if (source.startsWith('(') && source.endsWith(')')) {
    let balance = 0
    const wrapped = tokens.every((token, index) => {
      const text = source.slice(token.start, token.end)
      if (text === '(') balance++
      if (text === ')') balance--
      return balance !== 0 || index === tokens.length - 1
    })
    if (wrapped) return evaluateKeyConstant(source.slice(1, -1), constants, depth + 1)
  }
  if (['+', '-', '~'].includes(source[0])) {
    const operand = evaluateKeyConstant(source.slice(1), constants, depth + 1)
    if (typeof operand !== 'number') return undefined
    return source[0] === '-' ? -operand : source[0] === '~' ? ~operand : operand
  }
  if (!source.startsWith('`') || !source.endsWith('`')) return undefined
  let result = ''
  let start = 1
  for (let position = 1; position < source.length - 1; position++) {
    if (source[position] === '\\') { position++; continue }
    if (source[position] !== '$' || source[position + 1] !== '{') continue
    const cooked = decodeStringLiteral(`\`${source.slice(start, position)}\``)
    if (cooked === undefined) return undefined
    result += cooked
    let braces = 0
    const closing = tokens.find((token) => {
      if (token.start < position + 2 || token.kind !== 'punctuation') return false
      const text = source.slice(token.start, token.end)
      if (text === '{') braces++
      if (text !== '}') return false
      if (braces === 0) return true
      braces--
      return false
    })
    if (!closing) return undefined
    const value = evaluateKeyConstant(source.slice(position + 2, closing.start), constants, depth + 1)
    if (value === undefined) return undefined
    result += String(value)
    position = closing.start
    start = position + 1
  }
  const cooked = decodeStringLiteral(`\`${source.slice(start, -1)}\``)
  return cooked === undefined ? undefined : result + cooked
}

/** Snapshot eligible const syntax before private declaration pruning. */
export function attachComputedKeyConstants(declarations: Declaration[], privateDeclarations: ReadonlyMap<string, Declaration>): void {
  const ordered = [...new Set([...declarations, ...privateDeclarations.values()])]
  if (!ordered.some(declaration => declaration.kind === 'variable' && typeof declaration.value === 'string' && /[\[{]/.test(declaration.value))) return
  ordered.sort((left, right) => (left.start ?? 0) - (right.start ?? 0))
  const constants = new Map<string, KeyBinding>()
  const mutableBindingTypes = new Map<string, string>()
  const shadowsSymbol = ordered.some(declaration => declaration.name === 'Symbol')
  for (const declaration of ordered) {
    if (declaration.kind !== 'variable' || typeof declaration.value !== 'string') continue
    // Keep binding freshness beside the constant snapshot, before pruning. A
    // mutable property widens a fresh literal but preserves annotated literals.
    if (declaration.value.includes('{') || declaration.value.includes('[')) {
      const snapshot: Map<string, KeyBinding> & { mutableBindingTypes?: ReadonlyMap<string, string> } = new Map(constants)
      snapshot.mutableBindingTypes = new Map(mutableBindingTypes)
      declaration.computedKeyConstants = snapshot
    }
    const tokens = tokenizeDeclarationSyntax(declaration.value)
    const binding = tokens.length === 1 && tokens[0].kind === 'word' ? constants.get(declaration.value.slice(tokens[0].start, tokens[0].end)) : undefined
    if (declaration.typeAnnotation === 'unique symbol' || declaration.typeAnnotation === 'symbol' || typeof binding === 'object'
      || !shadowsSymbol && tokens[0]?.kind === 'word' && declaration.value.slice(tokens[0].start, tokens[0].end) === 'Symbol'
      && ['(', '.'].includes(declaration.value.slice(tokens[1]?.start, tokens[1]?.end))) {
      constants.set(declaration.name, symbolBinding)
      continue
    }
    // TypeScript folds unannotated constant declaration syntax. An annotation,
    // assertion, boolean, mutable binding or runtime call produces an index.
    if (declaration.modifiers?.[0] !== 'const' || declaration.typeAnnotation || declaration.modifiers.includes('const assertion')) continue
    const value = evaluateKeyConstant(declaration.value, constants)
    if (value !== undefined) {
      constants.set(declaration.name, value)
      // An alias of a non-widening literal remains non-widening.
      const alias = tokens.length === 1 && tokens[0].kind === 'word'
      if (!alias || mutableBindingTypes.has(declaration.value.trim()))
        mutableBindingTypes.set(declaration.name, typeof value)
    }
    else if (declaration.value.trim() === 'true' || declaration.value.trim() === 'false') mutableBindingTypes.set(declaration.name, 'boolean')
    else if (tokens.length === 1 && tokens[0].kind === 'word') {
      const type = mutableBindingTypes.get(declaration.value.trim())
      if (type) mutableBindingTypes.set(declaration.name, type)
    }
  }
}

export function resolveTemplateKey(key: string, constants?: KeyConstants): { name: string } | { index: true } | undefined {
  if (!key.trimStart().startsWith('[') || !key.includes('`')) return undefined
  const tokens = tokenizeDeclarationSyntax(key)
  if (key[tokens[0]?.start] !== '[' || key[tokens[1]?.start] !== '`' || key[tokens.at(-1)?.start ?? -1] !== ']') return undefined
  const template = key.slice(tokens[0].end, tokens.at(-1)!.start).trim()
  const value = evaluateKeyConstant(template, constants ?? new Map())
  return typeof value === 'string' ? { name: quoteModuleSpecifier(value, "'") } : { index: true }
}

/** Symbol properties do not contribute to a string index's value union. */
export function isSymbolKey(key: string, constants?: KeyConstants): boolean {
  if (!constants || !key.trimStart().startsWith('[')) return false
  const tokens = tokenizeDeclarationSyntax(key)
  return tokens.length === 3 && key[tokens[0].start] === '[' && tokens[1].kind === 'word'
    && key[tokens[2].start] === ']' && typeof constants.get(key.slice(tokens[1].start, tokens[1].end)) === 'object'
}

export function hasTemplateSubstitution(key: string): boolean {
  if (!key.trimStart().startsWith('[') || !key.includes('`')) return false
  const tokens = tokenizeDeclarationSyntax(key)
  return key[tokens[1]?.start] === '`' && tokens.some(token => token.kind === 'punctuation' && key[token.start] === '{')
}
