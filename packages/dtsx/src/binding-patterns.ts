/** Binding syntax and ambient parameter projections, shared with value scopes. */
import type { Declaration } from './types'
import { tokenizeDeclarationSyntax } from './module-references'

interface Expression { text: string, offset: number }
interface Target {
  kind: 'name' | 'object' | 'array'
  name?: string
  elements?: Array<Element | undefined>
  defaultValue?: Expression
}
interface Element { key?: string, computed?: Expression, rest: boolean, target: Target }

function parsePattern(source: string): Target {
  const tokens = tokenizeDeclarationSyntax(source)
  const text = (index: number): string => tokens[index] ? source.slice(tokens[index].start, tokens[index].end) : ''
  const pairs = new Map<number, number>()
  const stack: number[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (['(', '[', '{'].includes(text(index))) stack.push(index)
    else if ([')', ']', '}'].includes(text(index))) {
      const open = stack.pop()
      if (open === undefined || !['()', '[]', '{}'].includes(text(open) + text(index))) throw new Error('Unbalanced binding pattern')
      pairs.set(open, index)
    }
  }
  if (stack.length) throw new Error('Unbalanced binding pattern')
  // Generics in defaults contain commas too. A top-level assignment inside a
  // call's type arguments distinguishes a comparison spanning two bindings.
  for (let open = 0; open < tokens.length; open++) {
    if (text(open) !== '<') continue
    const allowDefaults = ['=', ',', '(', ':', '?', '[', '{'].includes(text(open - 1))
    let depth = 1
    for (let index = open + 1; index < tokens.length; index++) {
      if (text(index) === '=' && text(index + 1) !== '>' && depth === 1 && !allowDefaults) break
      if (text(index) === '<') depth++
      else if (text(index) === '>' && text(index - 1) !== '=' && --depth === 0) {
        if (index + 1 === tokens.length || ['(', '[', '.', ',', '}', ']', ')', '?', ':', ';', '=', '>'].includes(text(index + 1))) pairs.set(open, index)
        break
      }
      const close = pairs.get(index)
      if (close !== undefined) index = close
    }
  }
  const raw = (start: number, end: number): Expression => ({ text: start < end ? source.slice(tokens[start].start, tokens[end - 1].end) : '', offset: tokens[start]?.start ?? source.length })
  const top = (start: number, end: number, marker: string): number | undefined => {
    for (let index = start; index < end; index++) {
      if (text(index) === marker) return index
      const close = pairs.get(index)
      if (close !== undefined) index = close
    }
    return undefined
  }
  const target = (start: number, end: number): Target => {
    const equal = top(start, end, '=')
    const defaultValue = equal === undefined ? undefined : raw(equal + 1, end)
    if (equal !== undefined) end = equal
    if (start + 1 === end && tokens[start]?.kind === 'word') return { kind: 'name', name: text(start), defaultValue }
    const kind = text(start) === '{' ? 'object' : text(start) === '[' ? 'array' : undefined
    if (!kind || pairs.get(start) !== end - 1) throw new Error(`Invalid binding target: ${raw(start, end).text}`)
    const elements: Array<Element | undefined> = []
    let item = start + 1
    while (item < end - 1) {
      const comma = top(item, end - 1, ',')
      const stop = comma ?? end - 1
      if (item === stop) elements.push(undefined)
      else if (text(item) === '.' && text(item + 1) === '.' && text(item + 2) === '.') elements.push({ rest: true, target: target(item + 3, stop) })
      else if (kind === 'array') elements.push({ rest: false, target: target(item, stop) })
      else if (text(item) === '[') {
        const close = pairs.get(item)
        if (close === undefined || text(close + 1) !== ':') throw new Error('Computed binding needs a target')
        elements.push({ computed: raw(item + 1, close), rest: false, target: target(close + 2, stop) })
      }
      else {
        let colon = item + 1
        if (tokens[item].kind !== 'word' && tokens[item].kind !== 'quoted') {
          while (colon < stop && text(colon) !== ':') colon++
        }
        const aliased = text(colon) === ':'
        if (!aliased && tokens[item].kind !== 'word') throw new Error('Invalid object binding key')
        elements.push({ key: raw(item, aliased ? colon : item + 1).text, rest: false, target: target(aliased ? colon + 1 : item, stop) })
      }
      if (comma === undefined) break
      item = comma + 1
    }
    return { kind, elements, defaultValue }
  }
  return target(0, tokens.length)
}

function namesOf(target: Target, names: string[]): void {
  if (target.kind === 'name') names.push(target.name!)
  else for (const element of target.elements!) if (element) namesOf(element.target, names)
}

/** Only targets bind names; computed keys and defaults remain free references. */
export function bindingPatternNames(pattern: string): string[] {
  const names: string[] = []
  namesOf(parsePattern(pattern), names)
  return names
}

export interface BindingProjectionOptions {
  pattern: string
  patternOffset: number
  root: Declaration
  kind: string
  exported: boolean
  comments?: string[]
  allocateName: () => string
}

/**
 * Ambient parameter binding patterns are legal declaration syntax. Their typed
 * projections preserve TypeScript's own rest/tuple/iterable and member identity
 * rules, without emitting implementation bodies or invoking a compiler emitter.
 */
export function projectBindingPattern(options: BindingProjectionOptions): Declaration[] {
  const target = parsePattern(options.pattern)
  const names: string[] = []
  namesOf(target, names)
  if (!names.length) return []
  const declarations: Declaration[] = [options.root]
  let commented = false
  const at = { start: options.root.start, end: options.root.end }
  const value = (expression: Expression, kind: string): string => {
    const name = options.allocateName()
    declarations.push({ kind: 'variable', name, text: `declare ${kind} ${name}: unknown;`, value: expression.text,
    initializerStart: options.patternOffset + expression.offset, modifiers: [kind], isExported: false, ...at })
    return name
  }
  const project = (node: Target, sourceType: string): void => {
    if (node.defaultValue) {
      const fallback = value(node.defaultValue, options.kind)
      const member = options.allocateName()
      sourceType = `(${sourceType}) extends infer ${member} ? ${member} extends undefined ? typeof ${fallback} : ${member} : never`
    }
    if (node.kind === 'name') {
      const comments = commented ? undefined : options.comments
      commented = true
      declarations.push({ kind: 'variable', name: node.name!, text: `${options.exported ? 'export ' : ''}declare ${options.kind} ${node.name}: ${sourceType};`, typeAnnotation: sourceType,
      modifiers: [options.kind], isExported: options.exported, leadingComments: comments, ...at })
      return
    }
    const elements = node.elements!
    const parameters: string[] = []
    const slots: Array<{ target: Target, index: number }> = []
    const returns: string[] = []
    for (const element of elements) {
      if (!element) { parameters.push(''); continue }
      const parameter = options.allocateName()
      let key = element.key
      if (element.computed) key = `[${value(element.computed, 'const')}]`
      parameters.push(element.rest ? `...${parameter}` : node.kind === 'object' ? `${key}: ${parameter}` : parameter)
      slots.push({ target: element.target, index: returns.length })
      returns.push(`typeof ${parameter}`)
    }
    const functionName = options.allocateName()
    const resultName = options.allocateName()
    const inferred = options.allocateName()
    const parameter = node.kind === 'object' ? `{ ${parameters.join(', ')} }` : `[${parameters.join(', ')}]`
    declarations.push({ kind: 'function', name: functionName, text: `declare function ${functionName}(${parameter}: ${sourceType}): [${returns.join(', ')}];`, isExported: false, ...at })
    declarations.push({ kind: 'type', name: resultName, text: `type ${resultName} = (typeof ${functionName}) extends (...args: never[]) => infer ${inferred} ? ${inferred} : never;`, isExported: false, ...at })
    for (const slot of slots) project(slot.target, `${resultName}[${slot.index}]`)
  }
  project(target, `typeof ${options.root.name}`)
  return declarations
}
