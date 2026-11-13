import { sourceSyntaxTokens } from './module-references'
import { isBigIntLiteral, isNumericLiteral } from './numeric-literals'

export interface InitializerTypeSpan {
  end: number
  completeOperand: boolean
  parameters?: boolean
}

/** Recognize type syntax without assigning angle depth to relational operators. */
export function createInitializerTypeReader(source: string): (opening: number, initializerStart: number, previousOperandEnd?: number) => InitializerTypeSpan | undefined {
  const tokens = sourceSyntaxTokens(source)
  let index = 0
  let groupEnds: Map<number, number> | undefined
  let signatureStart: number | undefined
  let signatureEnd: number | undefined
  const typeResults = [new Map<number, number>(), new Map<number, number>()]
  const text = (at = index): string => tokens[at] ? source.slice(tokens[at].start, tokens[at].end) : ''
  const word = (at = index): boolean => tokens[at]?.kind === 'word'
  const lineBreak = (before: number, after: number): boolean => /[\r\n]/.test(source.slice(before, after))

  function eat(value: string): boolean {
    if (text() !== value) return false
    index++
    return true
  }

  function sequence(value: string): boolean {
    const saved = index
    for (const char of value) {
      if (!eat(char) || (index > saved + 1 && tokens[index - 2].end !== tokens[index - 1].start)) {
        index = saved
        return false
      }
    }
    return true
  }

  function attempt(parse: () => boolean): boolean {
    const saved = index
    if (parse()) return true
    index = saved
    return false
  }

  function identifier(): boolean {
    if (!word()) return false
    index++
    return true
  }

  function numeric(): boolean {
    const start = index
    let end = index
    while (end < tokens.length && (end === start || tokens[end - 1].end === tokens[end].start)) {
      const value = text(end)
      const exponentSign = (value === '+' || value === '-') && /[eE]$/.test(text(end - 1))
      if (!word(end) && !/^[0-9.]$/.test(value) && !exponentSign) break
      end++
    }
    if (end === start) return false
    const literal = source.slice(tokens[start].start, tokens[end - 1].end)
    if (!isNumericLiteral(literal) && !isBigIntLiteral(literal)) return false
    index = end
    return true
  }

  function group(): boolean {
    if (!['(', '[', '{'].includes(text())) return false
    if (!groupEnds) {
      groupEnds = new Map()
      const openings: number[] = []
      for (let at = 0; at < tokens.length; at++) {
        const value = text(at)
        if (['(', '[', '{'].includes(value)) openings.push(at)
        else if ([')', ']', '}'].includes(value)) {
          const opening = openings.pop()
          if (opening !== undefined && ['()', '[]', '{}'].includes(text(opening) + value)) groupEnds.set(opening, at + 1)
          else openings.length = 0
        }
      }
    }
    const end = groupEnds.get(index)
    if (end === undefined) return false
    index = end
    return true
  }

  function bindingName(): boolean {
    return identifier() || ((text() === '{' || text() === '[') && group())
  }

  function parameters(): boolean {
    if (!eat('(')) return false
    if (eat(')')) return true
    do {
      sequence('...')
      if (!bindingName()) return false
      eat('?')
      if (eat(':') && !type()) return false
      if (text() === ')') break
    } while (eat(',') && text() !== ')')
    return eat(')')
  }

  function typeParameters(): boolean {
    if (!eat('<')) return false
    if (text() === '>') return false
    do {
      if (text() === 'const') index++
      while ((text() === 'in' || text() === 'out') && word(index + 1) && text(index + 1) !== 'extends') index++
      if (!identifier()) return false
      if (eat('extends') && !type(false)) return false
      if (eat('=') && !type()) return false
      if (text() === '>') break
    } while (eat(',') && text() !== '>')
    return eat('>')
  }

  function typeArguments(): boolean {
    if (!eat('<') || text() === '>') return false
    do {
      if (!type()) return false
      if (text() === '>') break
    } while (eat(',') && text() !== '>')
    return eat('>')
  }

  function functionType(): boolean {
    eat('abstract')
    eat('new')
    if (text() === '<' && !typeParameters()) return false
    return parameters() && sequence('=>') && returnType()
  }

  function templateType(): boolean {
    if (tokens[index]?.kind !== 'literal' || source.charCodeAt(tokens[index].start) !== 96) return false
    for (;; ) {
      const token = tokens[index++]
      if (!token) return false
      if (source.charCodeAt(token.end - 1) === 96) return true
      if (source.charCodeAt(token.end - 1) !== 36 || !eat('{') || !type() || !eat('}')) return false
      if (tokens[index]?.kind !== 'literal') return false
    }
  }

  function tuple(): boolean {
    if (!eat('[')) return false
    if (eat(']')) return true
    do {
      sequence('...')
      const saved = index
      if (word() || tokens[index]?.kind === 'quoted') {
        index++
        eat('?')
        if (!eat(':')) index = saved
      }
      if (!type()) return false
      eat('?')
      if (text() === ']') break
    } while (eat(',') && text() !== ']')
    return eat(']')
  }

  function returnType(): boolean {
    if (eat('asserts')) {
      if (!identifier()) return false
      return !eat('is') || type()
    }
    if (word() && text(index + 1) === 'is') {
      index += 2
      return type()
    }
    return type()
  }

  function signature(): boolean {
    if (text() === '<' && !typeParameters()) return false
    if (!parameters()) return false
    return !eat(':') || returnType()
  }

  function bracketMember(): boolean {
    if (!eat('[')) return false
    if (word() && (text(index + 1) === 'in' || text(index + 1) === ':')) {
      index++
      const mapped = eat('in')
      if (!mapped && !eat(':')) return false
      if (!type()) return false
      if (mapped && eat('as') && !type()) return false
    }
    else {
      // Computed type-member names are entity names or literal values.
      if (!identifier() && !numeric()) {
        if (tokens[index]?.kind !== 'quoted') return false
        index++
      }
      while (eat('.')) if (!identifier()) return false
    }
    return eat(']')
  }

  function memberName(): boolean {
    if (text() === '[') return bracketMember()
    if (identifier() || numeric()) return true
    if (tokens[index]?.kind !== 'quoted') return false
    index++
    return true
  }

  function accessorModifier(): void {
    if (text() !== 'get' && text() !== 'set') return
    const start = index++
    const accessor = memberName() && text() === '('
    index = accessor ? start + 1 : start
  }

  function objectType(): boolean {
    if (!eat('{')) return false
    while (!eat('}')) {
      if (index >= tokens.length) return false
      const start = index
      if ((text() === '+' || text() === '-') && text(index + 1) === 'readonly') index++
      if (text() === 'readonly' && text(index + 1) !== ':' && text(index + 1) !== '?' && text(index + 1) !== '(' && text(index + 1) !== ';' && text(index + 1) !== '}') index++
      if (text() === 'new' && (text(index + 1) === '(' || text(index + 1) === '<')) index++
      if (text() === '(' || text() === '<') {
        if (!signature()) return false
      }
      else {
        accessorModifier()
        if (!memberName()) return false
        if (text() === '+' || text() === '-') {
          index++
          if (!eat('?')) return false
        }
        else eat('?')
        if (eat(':')) {
          if (!type()) return false
        }
        else if (text() === '(' || text() === '<') {
          if (!signature()) return false
        }
      }
      if (index === start) return false
      if (eat(';') || eat(',')) continue
      if (text() !== '}' && !lineBreak(tokens[index - 1].end, tokens[index]?.start ?? source.length)) return false
    }
    return true
  }

  function primary(): boolean {
    if (attempt(functionType)) return true
    if (eat('(')) return type() && eat(')')
    if (text() === '{') return objectType()
    if (text() === '[') return tuple()
    if (attempt(templateType)) return true
    if (tokens[index]?.kind === 'quoted') { index++; return true }
    if (eat('-')) return numeric()
    if (attempt(numeric)) return true
    if (eat('typeof')) {
      if (text() === 'import') return primary()
      if (!identifier()) return false
      while (eat('.')) if (!identifier()) return false
      if (text() === '<' && !typeArguments()) return false
      return true
    }
    if (eat('import')) {
      if (!eat('(') || !type()) return false
      if (eat(',') && !objectType()) return false
      return eat(')')
    }
    if (['export', 'function', 'class', 'const', 'let', 'var', 'return', 'throw', 'default', 'new', 'abstract'].includes(text())) return false
    return identifier()
  }

  function unary(): boolean {
    if (text() === 'keyof' || text() === 'readonly' || text() === 'unique') {
      index++
      return unary()
    }
    if (eat('infer')) {
      if (!identifier()) return false
      if (eat('extends') && !type(false)) return false
      return true
    }
    if (!primary()) return false
    for (;; ) {
      if (eat('.')) {
        if (!identifier()) return false
      }
      else if (text() === '<') {
        if (lineBreak(tokens[index - 1].end, tokens[index].start)) return true
        if (!typeArguments()) return false
      }
      else if (text() === '[') {
        if (lineBreak(tokens[index - 1].end, tokens[index].start)) return true
        index++
        if (!eat(']') && !(type() && eat(']'))) return false
      }
      else return true
    }
  }

  function intersection(): boolean {
    eat('&')
    if (!unary()) return false
    while (eat('&')) if (!unary()) return false
    return true
  }

  function type(conditional = true): boolean {
    const start = index
    const results = typeResults[conditional ? 1 : 0]
    const cached = results.get(start)
    if (cached !== undefined) {
      if (cached < 0) return false
      index = cached
      return true
    }
    const success = parseType(conditional)
    results.set(start, success ? index : -1)
    if (!success) index = start
    return success
  }

  function parseType(conditional: boolean): boolean {
    eat('|')
    if (!intersection()) return false
    while (eat('|')) if (!intersection()) return false
    if (conditional && text() === 'extends' && !lineBreak(tokens[index - 1].end, tokens[index].start)) {
      index++
      return type(false) && eat('?') && type() && eat(':') && type()
    }
    return true
  }

  function arrowAfterParameters(): boolean {
    if (text() !== '(' || !group()) return false
    if (eat(':') && !returnType()) return false
    return sequence('=>')
  }

  function runtimeSignature(): boolean {
    eat('async')
    const functionExpression = eat('function')
    if (functionExpression) {
      eat('*')
      if (word()) index++
    }
    if (text() === '<' && !typeParameters()) return false
    if (text() !== '(' || !group()) return false
    if (eat(':') && !returnType()) return false
    return functionExpression ? text() === '{' : sequence('=>')
  }

  function followsExpressionArguments(): boolean {
    const value = text()
    if (value === '<' || value === '>' || value === '+' || value === '-') return false
    if (value === '(' || (tokens[index]?.kind === 'literal' && source.charCodeAt(tokens[index].start) === 96)) return true
    if (!tokens[index] || lineBreak(tokens[index - 1].end, tokens[index].start)) return true
    if (['*', '/', '%', '=', '&', '|', '^', '?', ':', ',', ';', ')', ']', '}', 'in', 'instanceof', 'as', 'satisfies'].includes(value)) return true
    if (value === '!') return text(index + 1) === '=' && tokens[index].end === tokens[index + 1]?.start
    return !word() && tokens[index]?.kind !== 'quoted' && tokens[index]?.kind !== 'literal'
      && !['{', '[', '~', '#', '@'].includes(value) && !/^[0-9]$/.test(value)
  }

  return (opening, initializerStart, previousOperandEnd) => {
    let low = 0
    let high = tokens.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (tokens[middle].start < opening) low = middle + 1
      else high = middle
    }
    if (tokens[low]?.start !== opening) return undefined
    if (signatureStart !== initializerStart) {
      signatureStart = initializerStart
      signatureEnd = undefined
      let start = 0
      let end = low
      while (start < end) {
        const middle = (start + end) >>> 1
        if (tokens[middle].start < initializerStart) start = middle + 1
        else end = middle
      }
      index = start
      if (runtimeSignature()) signatureEnd = text() === '{' ? tokens[index].start : tokens[index - 1].end
    }
    if (signatureEnd !== undefined && opening < signatureEnd)
      return { end: signatureEnd, completeOperand: false, parameters: true }
    if (text(low) !== '<') return undefined
    index = low
    const previous = text(low - 1)
    const prefix = opening === initializerStart || ['=', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '?', ':', '<', '>', 'void', 'typeof', 'await', 'yield', 'delete'].includes(previous)
    const header = previous === 'function' || previous === 'class' || (previous === '*' && text(low - 2) === 'function') || (word(low - 1) && (text(low - 2) === 'function' || text(low - 2) === 'class' || (text(low - 2) === '*' && text(low - 3) === 'function')))
    if (header && attempt(typeParameters)) return { end: tokens[index - 1].end, completeOperand: false, parameters: true }
    index = low
    if ((prefix || previous === 'async') && attempt(typeParameters)) {
      const end = tokens[index - 1].end
      if (attempt(arrowAfterParameters)) return { end, completeOperand: false, parameters: true }
    }
    index = low
    const optionalCall = previous === '.' && text(low - 2) === '?' && tokens[low - 2].end === tokens[low - 1].start
    const callee = (tokens[low - 1]?.end ?? -1) >= initializerStart && (optionalCall || word(low - 1) || previous === ')' || previous === ']' || previous === '!' || (previous === '>' && tokens[low - 1].end === previousOperandEnd))
    if (callee && attempt(typeArguments) && followsExpressionArguments()) return { end: tokens[index - 1].end, completeOperand: true }
    index = low
    // A prefix assertion still expects its value after the type span.
    if (prefix && eat('<') && type() && eat('>')) return { end: tokens[index - 1].end, completeOperand: false }
    return undefined
  }
}
