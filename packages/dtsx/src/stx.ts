/**
 * STX single-file component declaration support.
 *
 * STX accepts Vue-style `<script>` blocks and Laravel Blade-style `@ts`
 * blocks. Both forms are collected into one virtual TypeScript module before
 * the normal semantic or isolated declaration scanner runs.
 */

import {
  collapseTypeText,
  extractDefaultExportOptions,
  filterLocalValueStatements,
  findMacroCall,
  findMatching,
  getOptionValue,
  mapRuntimeProps,
  maskNonCode,
  removeInlinedDeclaration,
  resolveEmitsType,
  resolveExposedType,
  resolvePropsType,
  skipNonCode,
  stripMacroStatements,
  type PropsResolution,
} from './vue'

export interface StxScriptBlock {
  /** TypeScript or JavaScript source contained by the block. */
  content: string
  /** Source syntax used to declare the block. */
  kind: 'script' | 'ts'
  /** Raw attributes for `<script>` blocks. */
  attrs: string
  /** Whether the block runs on the server, client, or in either context. */
  context: 'server' | 'client' | 'universal'
  /** Declared script language, lowercased. */
  lang: string
  /** Byte offset of the block's opening delimiter. */
  start: number
}

/** Check whether a file path points at an STX component. */
export function isStxFile(filePath: string): boolean {
  return filePath.endsWith('.stx')
}

function parseScriptBlocks(source: string): StxScriptBlock[] {
  const blocks: StxScriptBlock[] = []
  const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = scriptTag.exec(source)) !== null) {
    const attrs = match[1] ?? ''
    const lang = /\blang\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase()
      ?? (/\b(?:type\s*=\s*["'](?:text\/)?typescript["']|typescript)\b/i.test(attrs) ? 'ts' : 'js')
    const context = /\bserver\b/i.test(attrs)
      ? 'server'
      : /\bclient\b/i.test(attrs) ? 'client' : 'universal'
    blocks.push({
      content: match[2] ?? '',
      kind: 'script',
      attrs,
      context,
      lang,
      start: match.index,
    })
  }
  return blocks
}

/**
 * Parse Blade-style `@ts` blocks. Delimiters are recognized only when they
 * occupy a line, preventing `"@endts"` inside TypeScript strings and comments
 * from truncating the block. An unclosed block extends to end-of-file so a
 * partially edited component still yields the declarations written so far.
 */
function parseTsBlocks(source: string): StxScriptBlock[] {
  const blocks: StxScriptBlock[] = []
  const opener = /^[ \t]*@ts[ \t]*(?:\r?\n|$)/gm
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = opener.exec(source)) !== null) {
    const contentStart = opener.lastIndex
    const closer = /^[ \t]*@endts[ \t]*(?:\r?\n|$)/gm
    closer.lastIndex = contentStart
    const close = closer.exec(source)
    const contentEnd = close?.index ?? source.length
    blocks.push({
      content: source.slice(contentStart, contentEnd),
      kind: 'ts',
      attrs: '',
      context: 'universal',
      lang: 'ts',
      start: match.index,
    })
    if (!close) break
    opener.lastIndex = closer.lastIndex
  }
  return blocks
}

/** Collect all declaration-bearing STX blocks in document order. */
export function parseStxScripts(source: string): StxScriptBlock[] {
  return [...parseScriptBlocks(source), ...parseTsBlocks(source)]
    .sort((left, right) => left.start - right.start)
}

function isDeclarationBearingBlock(block: StxScriptBlock): boolean {
  if (block.kind === 'ts' || block.context !== 'universal' || block.lang === 'ts') return true
  // A plain HTML `<script>` commonly contains page bootstrap code rather than
  // component authoring state. Keep it only when it carries a public or typed
  // declaration signal; template-only runtime code cannot affect a `.d.ts`.
  return /\b(?:defineProps|defineEmits|defineExpose|defineSlots)\b|\bexport\s|\b(?:interface|type)\s+[A-Za-z_$]/.test(block.content)
}

function findPropsAssertion(script: string): string | null {
  const assertion = /(?:\$?props)\s+as\s+/g
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = assertion.exec(script)) !== null) {
    let start = assertion.lastIndex
    while (start < script.length && /\s/.test(script[start])) start++
    if (script[start] === '{') {
      const end = findMatching(script, start, '{', '}')
      if (end !== -1) return script.slice(start, end + 1).trim()
      continue
    }
    const name = /^[A-Za-z_$][\w$]*/.exec(script.slice(start))?.[0]
    if (!name) continue
    let end = start + name.length
    while (end < script.length && /\s/.test(script[end])) end++
    if (script[end] === '<') {
      const genericEnd = findMatching(script, end, '<', '>')
      if (genericEnd !== -1) end = genericEnd + 1
    }
    return script.slice(start, end).trim()
  }
  return null
}

function findPropsAnnotation(script: string): string | null {
  const match = /\b(?:const|let|var)\s+\$?props\s*:\s*([^=;\n]+)/.exec(script)
  return match?.[1]?.trim() ?? null
}

function inferAmbientPropType(codeAfterAccess: string): string {
  const value = /^\s*(?:\|\||\?\?)\s*([^;\n]+)/.exec(codeAfterAccess)?.[1]?.trim()
  if (/^['"`]/.test(value ?? '')) return 'string'
  if (/^(?:true|false)\b/.test(value ?? '')) return 'boolean'
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)\b/.test(value ?? '')) return 'number'
  if (/^\[/.test(value ?? '')) return 'unknown[]'
  if (/^\{/.test(value ?? '')) return 'Record<string, unknown>'
  if (/^\s*(?:===?|!==?)\s*(?:true|false)\b/.test(codeAfterAccess)) return 'boolean'
  return 'unknown'
}

function mergeAmbientPropType(previous: string | undefined, next: string): string {
  if (!previous || previous === 'unknown') return next
  if (next === 'unknown' || previous === next) return previous
  const members = new Set([...previous.split(' | '), ...next.split(' | ')])
  return [...members].join(' | ')
}

/** Infer the legacy `$props.name` STX contract used throughout component libraries. */
function resolveAmbientProps(script: string): PropsResolution | null {
  const code = maskNonCode(script)
  const props = new Map<string, string>()
  const access = /\$props(?:\.([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"\n]+)\2\s*\])/g
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = access.exec(script)) !== null) {
    if (code.slice(match.index, match.index + 6) !== '$props') continue
    const name = match[1] ?? match[3]
    const inferred = inferAmbientPropType(script.slice(access.lastIndex))
    props.set(name, mergeAmbientPropType(props.get(name), inferred))
  }
  if (props.size === 0) return null
  const members = [...props].map(([name, type]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)
    return `${key}?: ${type}`
  })
  return { type: `{ ${members.join(', ')} }` }
}

function resolveStxProps(script: string): PropsResolution | null {
  const macroProps = resolvePropsType(script, null)
  if (macroProps) return macroProps

  const assertedType = findPropsAssertion(script) ?? findPropsAnnotation(script)
  if (!assertedType) return resolveAmbientProps(script)

  if (/^[A-Za-z_$][\w$]*$/.test(assertedType)) {
    const escaped = assertedType.replace(/[$]/g, '\\$&')
    const exportedType = new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:interface|type)\\s+${escaped}\\b`)
    if (exportedType.test(script)) return { type: assertedType }
  }

  // Reuse the SFC resolver so local interfaces and aliases are inlined while
  // imported or compound type references remain intact.
  return resolvePropsType(`${script}\ndefineProps<${assertedType}>()`, null)
}

function stripStxCompilerStatements(content: string): string {
  return stripMacroStatements(content)
}

function isDeclarationStatement(statement: string): boolean {
  const code = maskNonCode(statement).trimStart()
  if (code === '') return true
  return /^(?:import\b|export\b|declare\b|interface\b|type\b|(?:export\s+)?namespace\b|(?:export\s+)?module\b|(?:abstract\s+)?class\b|const\b|let\b|var\b|(?:async\s+)?function\b)/.test(code)
}

/** Drop top-level browser/runtime statements that cannot contribute declarations. */
function filterTopLevelRuntimeStatements(content: string): string {
  const ranges: Array<[number, number]> = []
  let start = 0
  let depth = 0
  let i = 0
  while (i < content.length) {
    const ch = content[i]
    const nonCodeEnd = skipNonCode(content, i)
    if (nonCodeEnd > i) {
      i = nonCodeEnd
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++
    else if (ch === '}' || ch === ']' || ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ';' || ch === '\n') && depth === 0) {
      const end = i + 1
      if (!isDeclarationStatement(content.slice(start, end))) ranges.push([start, end])
      start = end
    }
    i++
  }
  if (start < content.length && !isDeclarationStatement(content.slice(start))) ranges.push([start, content.length])
  let result = content
  for (let j = ranges.length - 1; j >= 0; j--) {
    result = result.slice(0, ranges[j][0]) + result.slice(ranges[j][1])
  }
  return result
}

/**
 * Transform an STX component into a virtual TypeScript module.
 *
 * The output deliberately imports STX's own Vue-compatible `DefineComponent`
 * type. This makes generated declarations consumable without a Vue dependency
 * and exposes `$props` to STX's component utility types and call-site tooling.
 */
export function transformStxToTs(source: string): string {
  const blocks = parseStxScripts(source).filter(isDeclarationBearingBlock)
  let scriptContent = blocks.map(block => block.content).join('\n')
  let optionsProps: string | null = null

  const extraction = extractDefaultExportOptions(scriptContent)
  if (extraction.passthrough) return scriptContent
  scriptContent = extraction.script
  if (extraction.options) {
    const propsOption = getOptionValue(extraction.options, 'props')
    if (propsOption) optionsProps = mapRuntimeProps(propsOption)
  }

  const rawScript = scriptContent
  let filteredScript = stripStxCompilerStatements(scriptContent)
  const propsResolution = resolveStxProps(rawScript)
  const props = propsResolution?.type ?? optionsProps ?? '{}'
  const emits = resolveEmitsType(rawScript, null)
  const exposed = resolveExposedType(rawScript, null)
  const slots = findMacroCall(rawScript, 'defineSlots')?.generic ?? null

  const inlined = propsResolution?.inlinedLocal
  if (inlined) {
    filteredScript = removeInlinedDeclaration(filteredScript, inlined.name, inlined.declText)
  }

  let componentType = `DefineComponent<${props}>`
  const metadata: string[] = []
  if (emits) metadata.push(`readonly __stxEmits?: ${emits}`)
  if (slots) metadata.push(`readonly __stxSlots?: ${slots}`)
  if (exposed) metadata.push(`readonly __stxExposed?: ${exposed}`)
  if (metadata.length > 0) componentType += ` & { ${metadata.join(', ')} }`
  componentType = collapseTypeText(componentType)

  filteredScript = filterTopLevelRuntimeStatements(filterLocalValueStatements(filteredScript, componentType))
  // Put the synthesized public surface first. Some legal STX client scripts
  // start with browser-only expression statements (IIFEs, DOM registration),
  // which intentionally are not declaration syntax and may stop a lightweight
  // declaration scan before later statements.
  const parts = [
    `import type { DefineComponent } from '@stacksjs/stx'`,
    `type __DtsxStxComponentType = ${componentType}`,
    'const __dtsx_component__: __DtsxStxComponentType = null as unknown as __DtsxStxComponentType',
    'export default __dtsx_component__',
  ]
  if (filteredScript.trim() !== '') parts.push(filteredScript)
  return parts.join('\n')
}
