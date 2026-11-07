import type { Declaration } from './types'
import { scanSemanticDeclarations } from './extractor/scanner'
import { tokenizeDeclarationSyntax } from './module-references'
import { processVariableDeclaration } from './processor/declarations'

/** Retain local declaration scope without exporting implementation names. */
export function createReturnTypeScope(body: string, filename: string, freshName: () => string, retain: (declaration: Declaration) => void, generics = ''): { resolve: (type: string, position: number) => string, finish: (signature: string) => string } {
  interface Block { start: number, end: number, header: number, name: string, children: Block[], results: Map<string, string> }
  const results = new Map<string, string>()
  const root: Block = { start: 0, end: body.length, header: 0, name: '', children: [], results: new Map() }
  const bodyTokens = tokenizeDeclarationSyntax(body)
  const pairs: Array<{ open: number, close: number, header: number }> = []
  const braces: number[] = []
  const parens: number[] = []
  const closingParens = new Map<number, number>()
  for (let index = 0; index < bodyTokens.length; index++) {
    const token = bodyTokens[index]
    if (token.kind !== 'punctuation') continue
    const word = body.slice(token.start, token.end)
    if (word === '(') parens.push(index)
    else if (word === ')') { const open = parens.pop(); if (open !== undefined) closingParens.set(index, open) }
    else if (word === '{') braces.push(index)
    else if (word === '}') {
      const open = braces.pop()
      if (open === undefined) continue
      let header = bodyTokens[open].start
      const previous = open - 1
      const before = previous >= 0 ? body.slice(bodyTokens[previous].start, bodyTokens[previous].end) : ''
      if (before === ')') {
        const paren = closingParens.get(previous)
        if (paren !== undefined && paren > 0 && ['if', 'for', 'while', 'switch', 'catch', 'with'].includes(body.slice(bodyTokens[paren - 1].start, bodyTokens[paren - 1].end))) header = bodyTokens[paren - 1].start
      }
      else if (['else', 'try', 'finally', 'do'].includes(before)) header = bodyTokens[previous].start
      pairs.push({ open: bodyTokens[open].start, close: token.start, header })
    }
  }
  let blockIndex = 0
  const render = (block: Block, inherited: ReadonlySet<string> = new Set()): { declarations: Declaration[], text: string, exports: Array<{ type: string, name: string }> } => {
    const localNames = new Set(inherited)
    const tokens = tokenizeDeclarationSyntax(body.slice(block.start, block.end))
    let depth = 0
    for (let index = 0; index + 1 < tokens.length; index++) {
      const word = body.slice(block.start + tokens[index].start, block.start + tokens[index].end)
      if (word === '{') depth++
      else if (word === '}') depth--
      else if (!depth && ['type', 'interface'].includes(word)) localNames.add(body.slice(block.start + tokens[index + 1].start, block.start + tokens[index + 1].end))
    }
    let source = ''
    let cursor = block.start
    const exports = [...block.results].map(([type, name]) => ({ type, name }))
    for (const child of block.children.sort((left, right) => left.header - right.header)) {
      const nested = render(child, localNames)
      source += body.slice(cursor, child.header) + `\ndeclare namespace ${child.name} {\n${nested.text}\n}\n`
      cursor = child.end + 1
      for (const result of nested.exports) exports.push({ type: `${child.name}.${result.name}`, name: result.name })
    }
    source += `${body.slice(cursor, block.end)}\n;\n${exports.map(result => `export type ${result.name} = ${result.type};`).join('\n')}`
    const declarations = scanSemanticDeclarations(source, filename, false)
    for (const result of exports) localNames.add(result.name)
    const captured = generics ? genericNames(generics).map((name, index) => [name, `${helper}_capture_${index}`] as const) : []
    const text = declarations.map(declaration => generics && ['type', 'interface'].includes(declaration.kind) ? liftCapturedDeclaration(declaration, generics, captured, localNames) : (declaration.kind === 'variable' ? processVariableDeclaration(declaration, false) : declaration.text).replace(/^export\s+/, '').replace(/^declare\s+/, '')).join('\n')
    return { declarations, text, exports }
  }
  let helper: string | undefined
  return {
    resolve(type, position) {
      helper ??= freshName()
      let block = root
      for (const pair of pairs.filter(pair => pair.open < position && position < pair.close).sort((left, right) => left.open - right.open)) {
        let child = block.children.find(child => child.start === pair.open + 1)
        if (!child) { child = { start: pair.open + 1, end: pair.close, header: pair.header, name: `${helper}_scope_${blockIndex++}`, children: [], results: new Map() }; block.children.push(child) }
        block = child
      }
      let name = block.results.get(type)
      if (!name) { name = `${helper}_result_${results.size}`; block.results.set(type, name); results.set(name, type) }
      return `${helper}.${name}`
    },
    finish(signature) {
      if (!helper) return signature
      const rendered = render(root)
      const declarations = rendered.declarations
      const names = new Set(results.keys())
      if (declarations.every(declaration => names.has(declaration.name))) {
        const replacements = new Map(results)
        const tokens = tokenizeDeclarationSyntax(signature)
        let output = ''
        let cursor = 0
        for (let index = 0; index + 2 < tokens.length; index++) {
          if (signature.slice(tokens[index].start, tokens[index].end) !== helper || signature.slice(tokens[index + 1].start, tokens[index + 1].end) !== '.') continue
          const replacement = replacements.get(signature.slice(tokens[index + 2].start, tokens[index + 2].end))
          if (!replacement) continue
          output += signature.slice(cursor, tokens[index].start) + `(${replacement})`
          cursor = tokens[index + 2].end
          index += 2
        }
        return output + signature.slice(cursor)
      }
      if (generics) {
        const arguments_ = genericNames(generics).join(', ')
        const tokens = tokenizeDeclarationSyntax(signature)
        let output = ''
        let cursor = 0
        for (let index = 0; index + 2 < tokens.length; index++) {
          if (signature.slice(tokens[index].start, tokens[index].end) !== helper || signature.slice(tokens[index + 1].start, tokens[index + 1].end) !== '.' || !names.has(signature.slice(tokens[index + 2].start, tokens[index + 2].end))) continue
          output += `${signature.slice(cursor, tokens[index + 2].end)}<${arguments_}>`
          cursor = tokens[index + 2].end
          index += 2
        }
        signature = output + signature.slice(cursor)
      }
      const text = rendered.text
      retain({ kind: 'module', name: helper, text: `declare namespace ${helper} {\n${text}\n}`, moduleForm: 'namespace', isExported: false })
      return signature
    },
  }
}

function genericNames(generics: string): string[] {
  const tokens = tokenizeDeclarationSyntax(generics)
  const names: string[] = []
  let depth = 0
  let structural = 0
  let expected = false
  for (const token of tokens) {
    const text = generics.slice(token.start, token.end)
    if (text === '<') { depth++; if (depth === 1) expected = true }
    else if (text === '>' && generics[token.start - 1] !== '=') depth--
    else if (['(', '[', '{'].includes(text)) structural++
    else if ([')', ']', '}'].includes(text)) structural--
    else if (text === ',' && depth === 1 && !structural) expected = true
    else if (expected && token.kind === 'word' && !['const', 'in', 'out'].includes(text)) { names.push(text); expected = false }
  }
  return names
}

/** Lift the enclosing parameters onto every local type binding, including
 * recursive references; each alias keeps its own parameters and shadowing. */
function liftCapturedDeclaration(declaration: Declaration, generics: string, captured: ReadonlyArray<readonly [string, string]>, locals: ReadonlySet<string>): string {
  const own = new Set(genericNames(declaration.generics || ''))
  const rewrite = (text: string, bindLocals: boolean, shadow: ReadonlySet<string>): string => {
    const tokens = tokenizeDeclarationSyntax(text)
    let output = ''
    let cursor = 0
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      const word = text.slice(token.start, token.end)
      const next = tokens[index + 1] && text.slice(tokens[index + 1].start, tokens[index + 1].end)
      const after = tokens[index + 2] && text.slice(tokens[index + 2].start, tokens[index + 2].end)
      const previous = tokens[index - 1] && text.slice(tokens[index - 1].start, tokens[index - 1].end)
      if (token.kind !== 'word' || next === ':' || (next === '?' && after === ':')) continue
      const replacement = !shadow.has(word) && previous !== '.' && captured.find(([name]) => name === word)?.[1]
      if (replacement) {
        output += text.slice(cursor, token.start) + replacement
        cursor = token.end
      }
      else if (bindLocals && locals.has(word) && !shadow.has(word)) {
        const args = captured.map(([, name]) => name).join(', ')
        output += `${text.slice(cursor, token.end)}<${args}${next === '<' ? ', ' : '>'}`
        cursor = next === '<' ? tokens[++index].end : token.end
      }
    }
    return output + text.slice(cursor)
  }
  const tokens = tokenizeDeclarationSyntax(declaration.text)
  const kind = tokens.findIndex(token => ['type', 'interface'].includes(declaration.text.slice(token.start, token.end)))
  const binding = tokens[kind + 1]
  const original = declaration.generics || ''
  const end = original ? declaration.text.indexOf(original, binding.end) + original.length : binding.end
  const captureHeader = rewrite(captureParameters(generics), false, new Set())
  const ownHeader = original ? `, ${rewrite(original.slice(1, -1), true, own)}` : ''
  return `${declaration.text.slice(0, binding.end)}<${captureHeader}${ownHeader}>${rewrite(declaration.text.slice(end), true, own)}`.replace(/^export\s+/, '').replace(/^declare\s+/, '')
}

/** Captures are always supplied explicitly; retaining defaults would put a
 * required local parameter after an optional enclosing parameter. */
function captureParameters(generics: string): string {
  const text = generics.slice(1, -1)
  const tokens = tokenizeDeclarationSyntax(text)
  let depth = 0
  let cursor = 0
  let omitted = false
  let output = ''
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    const word = text.slice(token.start, token.end)
    if (['(', '[', '{', '<'].includes(word)) depth++
    else if ([')', ']', '}'].includes(word) || (word === '>' && text[token.start - 1] !== '=')) depth--
    else if (!depth && word === 'const') { output += text.slice(cursor, token.start); cursor = token.end }
    else if (!depth && word === '=' && text.slice(tokens[index + 1]?.start, tokens[index + 1]?.end) !== '>') {
      output += text.slice(cursor, token.start)
      omitted = true
    }
    else if (!depth && word === ',' && omitted) { cursor = token.start; omitted = false }
  }
  return output + (omitted ? '' : text.slice(cursor))
}
