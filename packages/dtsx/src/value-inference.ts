import type { Declaration } from './types'
import { directConstValueAlias, returnTypeExpectsObject } from './declaration-references'
import { isIdentChar, isIdentStart } from './lexical'
import { sourceSyntaxTokens, tokenizeDeclarationSyntax } from './module-references'
import { extractAllImportedItems } from './processor/imports'
import { inferCallType, inferNarrowType } from './processor/type-inference'

interface Binding {
  declared?: string
  flow?: string
  unresolved: boolean
  active?: boolean
}

function sameType(left: string, right: string): boolean {
  const spelling = (type: string): string => tokenizeDeclarationSyntax(type).map(token => type.slice(token.start, token.end)).join('')
  return spelling(left) === spelling(right)
}

function primitive(type: string): string | undefined {
  if (['number', 'string', 'boolean', 'bigint', 'symbol', 'undefined', 'null'].includes(type)) return type
  const inferred = inferNarrowType(type, false)
  return ['number', 'string', 'boolean', 'bigint', 'undefined', 'null'].includes(inferred) ? inferred : undefined
}

/** Narrow an assignment against the declared union without turning 7 into a literal number type. */
function assignedType(declared: string, value: string): string | undefined {
  if (sameType(declared, value)) return declared
  const category = primitive(value)
  if (!category) return undefined
  const tokens = tokenizeDeclarationSyntax(declared)
  let depth = 0
  let start = 0
  const members: string[] = []
  for (const token of tokens) {
    const text = declared.slice(token.start, token.end)
    if (text === '(' || text === '[' || text === '{' || text === '<') depth++
    else if (text === ')' || text === ']' || text === '}' || text === '>') depth--
    else if (text === '|' && depth === 0) { members.push(declared.slice(start, token.start).trim()); start = token.end }
  }
  members.push(declared.slice(start).trim())
  const exact = members.find(member => sameType(member, value))
  if (exact) return exact
  if (members.includes(category)) return category === 'boolean' && (value === 'true' || value === 'false') ? value : category
  return undefined
}

/** Prepare emitted call queries before private closure, including in isolated mode. */
export function inferDeclarationCallTypes(declarations: Iterable<Declaration>): void {
  for (const declaration of declarations) {
    if (declaration.kind !== 'variable' || declaration.typeAnnotation || typeof declaration.value !== 'string') continue
    const emittedCall = inferCallType(declaration.value)
    if (emittedCall && inferNarrowType(declaration.value, false) === emittedCall) {
      declaration.inferredType = emittedCall
      declaration.text = `${declaration.isExported ? 'export ' : ''}declare ${declaration.modifiers?.[0] ?? 'const'} ${declaration.name}: ${emittedCall};`
    }
  }
}

/**
 * Infer identifier aliases and monomorphic local calls before private closure.
 * This models straight-line assignments, not TypeScript's complete control-flow graph.
 */
export function inferDeclarationValueAliases(source: string, declarations: Declaration[], candidates: ReadonlyMap<string, Declaration>, importedFunctions: ReadonlySet<string> = new Set()): void {
  inferDeclarationCallTypes([...declarations, ...candidates.values()])
  const bindings = new Map<string, Binding>()
  const ordered: Declaration[] = []
  const seen = new Set<Declaration>()
  for (const declaration of [...declarations, ...candidates.values()]) {
    if (seen.has(declaration)) continue
    seen.add(declaration)
    ordered.push(declaration)
    if (declaration.kind === 'import') {
      for (const name of extractAllImportedItems(declaration.text)) bindings.set(name, { declared: `typeof ${name}`, flow: `typeof ${name}`, unresolved: false })
    }
    else if (['function', 'class', 'enum'].includes(declaration.kind)) {
      bindings.set(declaration.name, { declared: `typeof ${declaration.name}`, flow: `typeof ${declaration.name}`, unresolved: false })
    }
    else if (declaration.kind === 'variable') bindings.set(declaration.name, { declared: declaration.typeAnnotation, unresolved: false })
  }
  ordered.sort((left, right) => (left.start ?? 0) - (right.start ?? 0))
  const declaredFunctions = new Set(ordered.filter(item => item.kind === 'function' && !item.generics).map(item => item.name))
  for (const name of importedFunctions) declaredFunctions.add(name)
  const callRoots = new Map<string, string | undefined>()
  const directCall = (value: string): string | undefined => {
    value = value.trimStart()
    if (callRoots.has(value)) return callRoots.get(value)
    callRoots.set(value, undefined)
    if (!isIdentStart(value.charCodeAt(0))) return undefined
    let end = 1
    while (isIdentChar(value.charCodeAt(end))) end++
    if (!declaredFunctions.has(value.slice(0, end))) return undefined
    const items = tokenizeDeclarationSyntax(value)
    if (items[0]?.kind !== 'word' || !items[1] || value.slice(items[1].start, items[1].end) !== '(') return undefined
    let depth = 1
    for (let index = 2; index < items.length; index++) {
      const token = value.slice(items[index].start, items[index].end)
      if (token === '(') depth++
      else if (token === ')' && --depth === 0) {
        const name = index === items.length - 1 ? value.slice(items[0].start, items[0].end) : undefined
        callRoots.set(value, name)
        return name
      }
    }
    return undefined
  }
  const callCandidates = new Set(ordered.filter(item => item.kind === 'variable' && !item.typeAnnotation && typeof item.value === 'string').map(item => directCall(item.value as string)).filter((name): name is string => name !== undefined))
  const sourceTokens = callCandidates.size ? sourceSyntaxTokens(source) : undefined
  const counts = new Map<string, number>()
  if (sourceTokens) {
    let depth = 0
    for (let index = 0; index < sourceTokens.length; index++) {
      const text = source.slice(sourceTokens[index].start, sourceTokens[index].end)
      if (depth === 0 && text === 'function') {
        const following = sourceTokens[index + 1]
        const name = following && source.slice(following.start, following.end) === '*' ? sourceTokens[index + 2] : following
        if (name?.kind === 'word') {
          const spelling = source.slice(name.start, name.end)
          counts.set(spelling, (counts.get(spelling) ?? 0) + 1)
        }
      }
      if (['{', '(', '['].includes(text)) depth++
      else if (['}', ')', ']'].includes(text)) depth--
    }
  }
  const localCalls = new Map<string, Declaration>()
  for (const item of ordered) if (item.kind === 'function' && !item.generics && counts.get(item.name) === 1) localCalls.set(item.name, item)
  for (const name of importedFunctions) {
    // The project resolver verified this binding has one non-generic signature.
    const declaration = ordered.find(item => item.kind === 'import' && extractAllImportedItems(item.text).includes(name))
    if (declaration) localCalls.set(name, declaration)
  }
  let callTypeName = '__dtsx_call_result'
  while (source.includes(callTypeName)) callTypeName += '_'
  const callType = (name: string): string => `(typeof ${name}) extends (...args: never[]) => infer ${callTypeName} ? ${callTypeName} : never`
  const inferredCalls = new Map<Declaration, string>()
  let hasAlias = false
  for (const declaration of ordered) {
    if (declaration.kind !== 'variable' || declaration.typeAnnotation || typeof declaration.value !== 'string') continue
    const call = directCall(declaration.value)
    if (call && localCalls.has(call)) {
      inferredCalls.set(declaration, callType(call))
      bindings.get(declaration.name)!.active = true
      bindings.get(call)!.active = true
      hasAlias = true
    }
    if (declaration.modifiers?.[0] !== 'const') continue
    const alias = directConstValueAlias(declaration.value)
    if (!alias || alias === declaration.name || !bindings.has(alias)) continue
    bindings.get(alias)!.active = true
    bindings.get(declaration.name)!.active = true
    hasAlias = true
  }
  if (!hasAlias) return
  const tokens = sourceTokens ?? sourceSyntaxTokens(source)
  const text = (index: number): string => tokens[index] ? source.slice(tokens[index].start, tokens[index].end) : ''
  const pairs = new Map<number, number>()
  const parents = new Map<number, number>()
  const objectLiterals = new Set<number>()
  const classBodies = new Set<number>()
  const classMemberSyntax = new Set<number>()
  const instanceInitializers = new Map<number, number>()
  const delimiters: number[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = text(index)
    const parent = delimiters.at(-1)
    if (parent !== undefined) parents.set(index, parent)
    if (token === '{' && ['=', '(', '[', ',', ':', '?', 'return', 'yield'].includes(text(index - 1))) objectLiterals.add(index)
    if (['(', '[', '{'].includes(token)) delimiters.push(index)
    else if ([')', ']', '}'].includes(token)) {
      const open = delimiters.at(-1)
      if (open !== undefined && ['()', '[]', '{}'].includes(text(open) + token)) {
        delimiters.pop()
        pairs.set(open, index)
      }
    }
  }
  // Consume each longest operator once. Interior punctuation has no operator
  // entry, so the second '+' of 'other++' cannot also prefix the next name.
  const operators = new Map<number, string>()
  for (let index = 0; index < tokens.length; ) {
    if (tokens[index].kind !== 'punctuation') { index++; continue }
    const choices = ['>>>=', '**=', '&&=', '||=', '??=', '<<=', '>>=', '===', '!==', '>>>', '**', '&&', '||', '??', '<<', '>>', '=>', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '=']
    const spelling = choices.find(candidate => source.startsWith(candidate, tokens[index].start)) ?? text(index)
    operators.set(index, spelling)
    const end = tokens[index].start + spelling.length
    do { index++ } while (index < tokens.length && tokens[index].start < end)
  }
  // Classification does not skip evaluation of heritage, computed names,
  // fields or static blocks in the source-order write walk.
  for (let index = 0; index < tokens.length; index++) {
    const body = findClassBody(index)
    if (body !== undefined) classBodies.add(body)
  }
  for (const body of classBodies) classifyClassMembers(body)
  let cursor = 0

  function expressionType(expression: string): { type?: string, unresolved: boolean } {
    const alias = directConstValueAlias(expression)
    if (alias) {
      const binding = bindings.get(alias)
      return { type: binding?.flow, unresolved: binding?.unresolved ?? false }
    }
    const call = directCall(expression)
    const callable = call ? localCalls.get(call) : undefined
    if (callable) return { type: callable.returnType && primitive(callable.returnType) ? callable.returnType : callType(call!), unresolved: false }
    const type = inferNarrowType(expression, true)
    return { type: type === 'unknown' ? undefined : type, unresolved: false }
  }

  function operator(index: number): string {
    return operators.get(index) ?? ''
  }

  function write(index: number): { binding: Binding, operator: string } | undefined {
    if (tokens[index]?.kind !== 'word' || classMemberSyntax.has(index) || text(index - 1) === '.' || text(index - 1) === '#' && text(index - 2) === '.') return undefined
    const binding = bindings.get(text(index))
    if (!binding?.active) return undefined
    const next = operator(index + 1)
    if (['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??='].includes(next)) return { binding, operator: next }
    if (['++', '--'].includes(next) && !/[\r\n]/.test(source.slice(tokens[index].end, tokens[index + 1].start))) return { binding, operator: next }
    if (index >= 2 && ['++', '--'].includes(operator(index - 2))) {
      const previous = tokens[index - 3]
      const priorOperand = previous && (previous.kind === 'word' || previous.kind === 'quoted' || [')', ']'].includes(text(index - 3)))
      if (!previous || !priorOperand || /[\r\n;]/.test(source.slice(previous.end, tokens[index - 2].start))) return { binding, operator: operator(index - 2) }
    }
    return undefined
  }

  function assignment(index: number): Binding | undefined {
    const target = write(index)
    return target?.operator === '=' ? target.binding : undefined
  }

  function findClassBody(index: number): number | undefined {
    if (tokens[index]?.kind !== 'word' || text(index) !== 'class' || text(index - 1) === '.' || ['(', ':', '='].includes(text(index + 1))) return undefined
    let header = index + 1
    let angles = 0
    while (header < tokens.length) {
      const token = text(header)
      if (token === '{' && angles === 0) return header
      if (token === 'class') {
        const nested = findClassBody(header)
        if (nested !== undefined) { header = (pairs.get(nested) ?? nested) + 1; continue }
      }
      if (token === 'function') {
        const deferred = deferredBody(header, tokens.length)
        if (deferred) { header = deferred.end; continue }
      }
      if (token === '<') angles++
      else if (token === '>' && operator(header - 1) !== '=>' && angles > 0) angles--
      if (token === ';') break
      header = (pairs.get(header) ?? header) + 1
    }
    return undefined
  }

  function memberKey(member: number, limit: number, isClass: boolean): { next: number, isStatic: boolean } | undefined {
    let key = member
    let isStatic = false
    const modifiers = isClass
      ? ['public', 'protected', 'private', 'static', 'abstract', 'override', 'declare', 'readonly', 'accessor', 'async', 'get', 'set']
      : ['async', 'get', 'set']
    while (modifiers.includes(text(key)) && !['(', '<', '?', '!', ':', '=', ';', '}'].includes(text(key + 1))) {
      if (text(key) === 'static') isStatic = true
      key++
    }
    if (text(key) === '*') key++
    if (isClass && text(key) === '#') key++
    if (text(key) === '[') {
      const close = pairs.get(key)
      return close === undefined ? undefined : { next: close + 1, isStatic }
    }
    if (tokens[key]?.kind === 'word' || tokens[key]?.kind === 'quoted') return { next: key + 1, isStatic }
    let end = key + 1
    while (end < limit && tokens[end - 1].end === tokens[end].start && !['(', '<', '?', '!', ':', '=', ';', '}', '[', '{', ','].includes(text(end))) end++
    if (key < limit && inferNarrowType(source.slice(tokens[key].start, tokens[end - 1].end), false) === 'number') return { next: end, isStatic }
    return undefined
  }

  function memberHeaderEnd(member: number, limit: number, isClass: boolean): number | undefined {
    const parsed = memberKey(member, limit, isClass)
    if (!parsed) return undefined
    let key = parsed.next
    if (isClass && ['?', '!'].includes(text(key))) key++
    if (text(key) === '<') {
      let depth = 1
      key++
      while (key < limit && depth > 0) {
        if (text(key) === '<') depth++
        else if (text(key) === '>' && operator(key - 1) !== '=>') depth--
        key = (pairs.get(key) ?? key) + 1
      }
      if (depth !== 0) return undefined
    }
    return key
  }

  function methodHeaderMatches(member: number, index: number, isClass: boolean): boolean {
    return memberHeaderEnd(member, index, isClass) === index
  }

  function endsWithTypeArguments(start: number, end: number): boolean {
    let depth = 0
    let opening = -1
    for (let index = start; index < end; index = (pairs.get(index) ?? index) + 1) {
      if (text(index) === '<' && (depth > 0 || index > start && (tokens[index - 1].kind === 'word' || [')', ']'].includes(text(index - 1))))) {
        if (depth === 0) opening = index
        depth++
      }
      else if (text(index) === '>' && operator(index - 1) !== '=>' && depth > 0) {
        depth--
        if (index === end - 1 && depth === 0) return opening < index - 1
      }
    }
    return false
  }

  function beginsClassMember(index: number, close: number): boolean {
    if (text(index) === 'static' && text(index + 1) === '{') return true
    const header = memberHeaderEnd(index, close, true)
    return header !== undefined && (header === close || ['(', ':', '=', ';', '}'].includes(text(header)))
  }

  function classRangeEnd(start: number, container: number, stopAtEquals = false): number {
    const close = pairs.get(container) ?? tokens.length
    let index = start
    while (index < close) {
      if (text(index) === ';' || stopAtEquals && operator(index) === '=') return index
      if (index > start && parents.get(index) === container && /[\r\n]/.test(source.slice(tokens[index - 1].end, tokens[index].start))) {
        const previous = text(index - 1)
        // A closing type argument can complete an operand before a genuine
        // member header. A dot or another unfinished expression cannot.
        const genericOperand = previous === '>' && endsWithTypeArguments(start, index) && beginsClassMember(index, close)
        const incomplete = !genericOperand && ['+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '^', '!', '~', '?', ':', ',', '.', '(', '[', '{', 'as', 'in', 'of', 'new', 'typeof', 'keyof', 'extends', 'instanceof', 'satisfies', 'await', 'yield', 'void'].includes(previous)
        const continuation = ['.', '?', ':', ')', ']', '}', ',', '+', '-', '*', '/', '%', '<', '>', '=', '&', '|', '^', '`', '(', '[', 'as', 'satisfies', 'instanceof', 'in'].includes(text(index))
        if (!incomplete && !continuation) return index
      }
      index = (pairs.get(index) ?? index) + 1
    }
    return close
  }

  function markClassHeader(start: number, end: number): void {
    for (let index = start; index < end; index++) {
      // A computed name is evaluated, unlike the surrounding member syntax.
      if (text(index) === '[' && pairs.has(index)) { index = pairs.get(index)!; continue }
      if (tokens[index].kind === 'word') classMemberSyntax.add(index)
    }
  }

  function classifyClassMembers(container: number): void {
    const close = pairs.get(container) ?? tokens.length
    let member = container + 1
    while (member < close) {
      if (text(member) === ';') { member++; continue }
      if (text(member) === 'static' && text(member + 1) === '{') {
        member = (pairs.get(member + 1) ?? member + 1) + 1
        continue
      }
      const parsed = memberKey(member, close, true)
      if (!parsed) { member++; continue }
      const afterKey = memberHeaderEnd(member, close, true)
      if (afterKey === undefined) { member++; continue }
      markClassHeader(member, afterKey)
      if (text(afterKey) === '(') {
        const parameters = pairs.get(afterKey)
        const body = parameters === undefined ? undefined : methodBody(parameters, close)
        if (body !== undefined) { member = (pairs.get(body) ?? body) + 1; continue }
      }
      let assignment = afterKey
      if (text(assignment) === ':') assignment = classRangeEnd(assignment + 1, container, true)
      if (operator(assignment) === '=') {
        markClassHeader(member, assignment + 1)
        const start = assignment + 1
        const end = classRangeEnd(start, container)
        if (!parsed.isStatic && end > start) instanceInitializers.set(start, end)
        member = end
      }
      else {
        const end = classRangeEnd(afterKey, container)
        markClassHeader(member, end)
        member = Math.max(member + 1, end)
      }
    }
  }

  function isMethodParameters(index: number): boolean {
    const container = parents.get(index)
    if (container === undefined) return false
    const isClass = classBodies.has(container)
    if (!isClass && !objectLiterals.has(container)) return false
    if (methodHeaderMatches(container + 1, index, isClass)) return true
    for (let previous = container + 1; previous < index; previous++) {
      const parent = parents.get(previous)
      const memberSeparator = parents.get(previous) === container && (text(previous) === ',' || isClass && text(previous) === ';')
      const previousBody = isClass && text(previous) === '}' && parent !== undefined && parents.get(parent) === container
      const lineBoundary = isClass && parents.get(previous + 1) === container && /[\r\n]/.test(source.slice(tokens[previous].end, tokens[previous + 1].start))
      if ((memberSeparator || previousBody || lineBoundary) && methodHeaderMatches(previous + 1, index, isClass)) return true
    }
    return false
  }

  function methodBody(close: number, limit: number): number | undefined {
    let body = close + 1
    const typeStart = text(body) === ':' ? body + 1 : undefined
    while (body < limit) {
      if (text(body) === '{' && (typeStart === undefined || !returnTypeExpectsObject(source.slice(tokens[typeStart].start, tokens[body].start)))) return body
      if (typeStart === undefined) return undefined
      body = (pairs.get(body) ?? body) + 1
    }
    return undefined
  }

  function deferredBody(index: number, limit: number): { start: number, end: number } | undefined {
    let body = -1
    if (text(index) === '(') {
      const close = pairs.get(index)
      if (close !== undefined && isMethodParameters(index)) body = methodBody(close, limit) ?? -1
      else if (close !== undefined && operator(close + 1) === '=>') body = close + 3
      else if (close !== undefined && text(close + 1) === ':') {
        let result = close + 2
        while (result < limit && text(result) !== ';') {
          if (operator(result) === '=>') { body = result + 2; break }
          result = (pairs.get(result) ?? result) + 1
        }
      }
    }
    else if (tokens[index]?.kind === 'word' && operator(index + 1) === '=>') body = index + 3
    else if (text(index) === 'function') {
      let parameter = index + 1
      while (parameter < limit && text(parameter) !== '(') parameter = (pairs.get(parameter) ?? parameter) + 1
      const close = pairs.get(parameter)
      if (close === undefined) return undefined
      body = close + 1
      const typeStart = text(body) === ':' ? body + 1 : undefined
      while (body < limit) {
        if (text(body) === '{' && (typeStart === undefined || !returnTypeExpectsObject(source.slice(tokens[typeStart].start, tokens[body].start)))) break
        body = (pairs.get(body) ?? body) + 1
      }
    }
    if (body < 0 || body >= limit) return undefined
    if (text(body) === '{') return { start: index, end: (pairs.get(body) ?? limit - 1) + 1 }
    let end = body
    while (end < limit && ![',', ';', ')', ']', '}'].includes(text(end))) end = (pairs.get(end) ?? end) + 1
    return { start: index, end }
  }

  function invalidateWrites(start: number, end: number, skipDeferred = true): void {
    for (let index = start; index < end; index++) {
      const instanceEnd = instanceInitializers.get(index)
      if (instanceEnd !== undefined) { index = Math.min(instanceEnd, end) - 1; continue }
      const deferred = skipDeferred ? deferredBody(index, end) : undefined
      if (deferred) {
        let after = deferred.end
        while (text(after) === ')') after++
        const invoked = text(after) === '(' || text(after) === '.' && ['call', 'apply'].includes(text(after + 1)) && text(after + 2) === '('
        if (invoked) invalidateWrites(deferred.start, deferred.end, false)
        index = deferred.end - 1
        continue
      }
      const target = write(index)
      if (target) { target.binding.flow = undefined; target.binding.unresolved = true }
    }
  }

  function writeRange(limit: number): void {
    let structured = false
    while (cursor < tokens.length && tokens[cursor].start < limit) {
      const token = text(cursor)
      if (['if', 'else', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally', 'with'].includes(token)) structured = true
      if (token === ';') structured = false
      // Groups here belong to runtime statements between declarations. Writes
      // inside them are not unconditional source-order assignments.
      if (token === '(' || token === '{' || token === '[') {
        const close = pairs.get(cursor)
        let end = close ?? cursor + 1
        while (end < tokens.length && tokens[end].start >= limit) end--
        invalidateWrites(cursor + 1, end)
        cursor = end + 1
        if (token === '{') structured = false
        continue
      }
      const binding = assignment(cursor)
      if (binding) {
        const start = cursor + 2
        let end = start
        const stack: string[] = []
        while (end < tokens.length && tokens[end].start < limit) {
          const item = text(end)
          if (stack.length === 0 && (item === ';' || end > start && /[\r\n]/.test(source.slice(tokens[end - 1].end, tokens[end].start))
            && (assignment(end) || ['if', 'for', 'while', 'switch', 'try', 'do', 'return', 'throw'].includes(item)))) break
          if (item === '(' || item === '{' || item === '[') stack.push(item === '(' ? ')' : item === '{' ? '}' : ']')
          else if (item === stack.at(-1)) stack.pop()
          end++
        }
        const expression = end > start ? source.slice(tokens[start].start, tokens[end - 1].end) : ''
        invalidateWrites(start, end)
        const value = expressionType(expression)
        binding.flow = !structured && value.type ? binding.declared ? assignedType(binding.declared, value.type) : value.type : undefined
        binding.unresolved = structured || value.unresolved || !binding.flow
        cursor = end
        continue
      }
      // Compound assignments and updates need expression semantics beyond a
      // direct assignment. Do not reuse stale flow after seeing one.
      const target = write(cursor)
      if (target) { target.binding.flow = undefined; target.binding.unresolved = true }
      cursor++
    }
  }

  for (const declaration of ordered) {
    writeRange(declaration.start ?? 0)
    const declarationStart = cursor
    while (cursor < tokens.length && tokens[cursor].start < (declaration.end ?? 0)) cursor++
    if (declaration.kind !== 'variable') continue
    if (declaration.initializerStart !== undefined) {
      let initializer = declarationStart
      while (initializer < cursor && tokens[initializer].start < declaration.initializerStart) initializer++
      invalidateWrites(initializer, cursor)
    }
    const binding = bindings.get(declaration.name)!
    if (!binding.active) continue
    const expression = typeof declaration.value === 'string' ? declaration.value : ''
    if (!expression) { binding.flow = binding.declared; continue }
    const value = expressionType(expression)
    const alias = directConstValueAlias(expression)
    const origin = alias ? bindings.get(alias) : undefined
    const inferredCall = inferredCalls.get(declaration)
    if (inferredCall) {
      declaration.inferredType = inferredCall
    }
    else if (!declaration.typeAnnotation && declaration.modifiers?.[0] === 'const' && alias && alias !== declaration.name && origin) {
      if (value.unresolved) declaration.inferenceError = 'DTSX_UNSUPPORTED_VALUE_FLOW'
      else if (value.type) {
        declaration.inferredType = origin.declared && sameType(origin.declared, value.type) ? `typeof ${alias}` : value.type
      }
    }
    if (declaration.inferredType) {
      declaration.text = `${declaration.isExported ? 'export ' : ''}declare ${declaration.modifiers?.[0] ?? 'const'} ${declaration.name}: ${declaration.inferredType};`
    }
    if (declaration.typeAnnotation) {
      binding.flow = value.type ? assignedType(declaration.typeAnnotation, value.type) ?? declaration.typeAnnotation : declaration.typeAnnotation
    }
    else if (declaration.inferredType) {
      binding.declared = declaration.inferredType
      binding.flow = declaration.inferredType
    }
    else {
      const isConst = declaration.modifiers?.[0] === 'const'
      const container = expression.trim().startsWith('{') || expression.trim().startsWith('[')
      const inferred = inferNarrowType(expression, isConst && !container)
      binding.declared = inferred === 'unknown' ? undefined : inferred
      binding.flow = binding.declared
    }
    binding.unresolved = value.unresolved
  }
}
