/**
 * Vue Single-File Component (SFC) support.
 *
 * Parses the `<script>` / `<script setup>` blocks of a `.vue` file and
 * transforms them into a virtual TypeScript module whose default export is a
 * `DefineComponent` typed from:
 *   - `defineProps<T>()` generics, runtime `defineProps({...})` objects, or
 *     Options-API `props` (including `PropType<T>` casts)
 *   - `defineEmits` generics / arrays and Options-API `emits`
 *   - `defineExpose({...})` exposed keys
 *
 * The virtual module is fed through the regular declaration pipeline, so every
 * plugin surface (bun, vite, esbuild, tsup, webpack) emits component
 * declarations without knowing anything about Vue.
 */

export interface VueSfcBlock {
  /** Raw block content (the TypeScript/JavaScript source). */
  content: string
  /** Raw attribute string of the opening tag. */
  attrs: string
  /** Whether the block is `<script setup>`. */
  setup: boolean
  /** Value of the `lang` attribute, lowercased (`ts`, `js`, ...). */
  lang: string
}

export interface VueSfc {
  /** The plain `<script>` block, if present. */
  script: VueSfcBlock | null
  /** The `<script setup>` block, if present. */
  scriptSetup: VueSfcBlock | null
}

/** Check whether a file path points at a Vue SFC. */
export function isVueFile(filePath: string): boolean {
  return filePath.endsWith('.vue')
}

/**
 * Parse the script blocks of a Vue SFC. Template/style content is ignored —
 * declarations only depend on the component's script.
 */
export function parseVueSfc(source: string): VueSfc {
  const sfc: VueSfc = { script: null, scriptSetup: null }
  const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = scriptTag.exec(source)) !== null) {
    const attrs = match[1] || ''
    const lang = /lang\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() ?? 'js'
    const block: VueSfcBlock = {
      content: match[2] ?? '',
      attrs,
      setup: /\bsetup\b/.test(attrs),
      lang,
    }
    if (block.setup) {
      // Later setup blocks win; Vue itself only allows one.
      sfc.scriptSetup = block
    }
    else {
      sfc.script = block
    }
  }
  return sfc
}

// ---------------------------------------------------------------------------
// Balanced-text scanning helpers (strings, template literals, comments aware)
// ---------------------------------------------------------------------------

/** Skip a quoted string starting at `i`; returns the index after the closer. */
function skipString(text: string, i: number): number {
  const quote = text[i]
  i++
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i++
  }
  return i
}

/** Skip a template literal starting at `i` (handles nested `${...}`). */
function skipTemplate(text: string, i: number): number {
  i++ // skip backtick
  let depth = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`' && depth === 0) return i + 1
    if (ch === '$' && text[i + 1] === '{') {
      depth++
      i += 2
      continue
    }
    if (ch === '}') {
      if (depth > 0) depth--
      i++
      continue
    }
    i++
  }
  return i
}

/** Skip a line or block comment starting at `i`. */
function skipComment(text: string, i: number): number {
  if (text[i + 1] === '/') {
    const end = text.indexOf('\n', i + 2)
    return end === -1 ? text.length : end + 1
  }
  if (text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2)
    return end === -1 ? text.length : end + 2
  }
  return i + 1
}

/**
 * Find the index of the closer matching the opener at `start`
 * (`text[start]` must be the opener). Returns -1 when unbalanced.
 */
export function findMatching(text: string, start: number, open: string, close: string): number {
  let depth = 0
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === '\'') {
      i = skipString(text, i)
      continue
    }
    if (ch === '`') {
      i = skipTemplate(text, i)
      continue
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i)
      continue
    }
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * Find the end of a generic parameter list opening at `start`
 * (`text[start]` must be `<`). Arrow functions (`=>`) and strings are skipped
 * so `>` inside object literal types does not close the list early.
 */
function findGenericEnd(text: string, start: number): number {
  let depth = 0
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === '\'') {
      i = skipString(text, i)
      continue
    }
    if (ch === '`') {
      i = skipTemplate(text, i)
      continue
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i)
      continue
    }
    if (ch === '=' && text[i + 1] === '>') {
      i += 2
      continue
    }
    if (ch === '<') depth++
    else if (ch === '>') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/** Split a top-level comma-separated list (tracking nesting and strings). */
function splitTopLevel(text: string, separator: string = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === '\'') {
      const end = skipString(text, i)
      current += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      const end = skipTemplate(text, i)
      current += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = skipComment(text, i)
      continue
    }
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++
    else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') depth--
    if (ch === separator && depth === 0) {
      parts.push(current)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

interface ObjectEntry {
  key: string
  value: string
  /** Method shorthand (`focus() { ... }`) — value holds the parameter list. */
  isMethod: boolean
}

/**
 * Split an object literal into its top-level entries. Expects `text` to start
 * with `{` and end with the matching `}`.
 */
function parseObjectEntries(text: string): ObjectEntry[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return []
  const close = findMatching(trimmed, 0, '{', '}')
  if (close === -1) return []
  const body = trimmed.slice(1, close)
  const entries: ObjectEntry[] = []
  for (const part of splitTopLevel(body)) {
    // Find a top-level `:` separating key from value.
    let colon = -1
    let depth = 0
    for (let i = 0; i < part.length; i++) {
      const ch = part[i]
      if (ch === '"' || ch === '\'') {
        i = skipString(part, i) - 1
        continue
      }
      if (ch === '`') {
        i = skipTemplate(part, i) - 1
        continue
      }
      if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++
      else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') depth--
      else if (ch === ':' && depth === 0) {
        colon = i
        break
      }
    }
    if (colon !== -1) {
      entries.push({ key: unquoteKey(part.slice(0, colon).trim()), value: part.slice(colon + 1).trim(), isMethod: false })
      continue
    }
    // Method shorthand: `focus(el: El) { ... }`
    const methodMatch = /^([A-Za-z_$][\w$]*|['"][^'"]+['"])\s*\(/.exec(part.trim())
    if (methodMatch) {
      entries.push({ key: unquoteKey(methodMatch[1]), value: part.trim(), isMethod: true })
      continue
    }
    // Shorthand property (`foo`) — no value to map.
    const shorthand = part.trim()
    if (shorthand) entries.push({ key: unquoteKey(shorthand), value: '', isMethod: false })
  }
  return entries
}

function unquoteKey(key: string): string {
  if ((key.startsWith('\'') && key.endsWith('\'')) || (key.startsWith('"') && key.endsWith('"'))) {
    return key.slice(1, -1)
  }
  return key
}

/** Render a key for a type literal, quoting when it is not a valid identifier. */
function typeKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)
}

// ---------------------------------------------------------------------------
// Compiler-macro extraction (defineProps / defineEmits / defineExpose)
// ---------------------------------------------------------------------------

interface MacroCall {
  /** Generic type argument text (`defineProps<T>`), when present. */
  generic: string | null
  /** First argument text, when the call has arguments. */
  arg: string | null
}

/** Locate the first `name(...)` / `name<T>(...)` call in `text`. */
function findMacroCall(text: string, name: string): MacroCall | null {
  const pattern = new RegExp(`\\b${name}\\b`, 'g')
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(text)) !== null) {
    let i = match.index + match[0].length
    while (i < text.length && /\s/.test(text[i])) i++
    let generic: string | null = null
    if (text[i] === '<') {
      const end = findGenericEnd(text, i)
      if (end === -1) return null
      generic = text.slice(i + 1, end).trim()
      i = end + 1
      while (i < text.length && /\s/.test(text[i])) i++
    }
    if (text[i] !== '(') continue // e.g. a type-only reference — keep scanning
    const end = findMatching(text, i, '(', ')')
    if (end === -1) return null
    const args = splitTopLevel(text.slice(i + 1, end))
    return { generic, arg: args.length > 0 ? args[0].trim() : null }
  }
  return null
}

/** Find a local `interface Name {...}` / `type Name = ...` declaration body. */
function findLocalType(text: string, name: string): string | null {
  const span = findLocalTypeSpan(text, name)
  if (!span) return null
  return span.kind === 'interface'
    ? text.slice(span.bodyStart, span.end)
    : text.slice(span.bodyStart, span.end).trim()
}

interface LocalTypeSpan {
  kind: 'interface' | 'type'
  /** Index of the `interface` / `type` keyword. */
  start: number
  /** Index just past the declaration. */
  end: number
  /** Index of the interface opening brace / start of the aliased type. */
  bodyStart: number
}

/** Locate the full span of a local `interface Name` / `type Name = ...` declaration. */
function findLocalTypeSpan(text: string, name: string): LocalTypeSpan | null {
  const interfacePattern = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`, 'm')
  const interfaceMatch = interfacePattern.exec(text)
  if (interfaceMatch) {
    const openBrace = interfaceMatch.index + interfaceMatch[0].length - 1
    const close = findMatching(text, openBrace, '{', '}')
    if (close !== -1) {
      return { kind: 'interface', start: interfaceMatch.index, end: close + 1, bodyStart: openBrace }
    }
  }
  const aliasPattern = new RegExp(`\\btype\\s+${name}\\b[^=]*=`, 'm')
  const aliasMatch = aliasPattern.exec(text)
  if (aliasMatch) {
    // The aliased type runs to the end of the statement (top-level newline or `;`).
    let i = aliasMatch.index + aliasMatch[0].length
    let depth = 0
    const start = i
    while (i < text.length) {
      const ch = text[i]
      if (ch === '"' || ch === '\'') {
        i = skipString(text, i)
        continue
      }
      if (ch === '`') {
        i = skipTemplate(text, i)
        continue
      }
      if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++
      else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') depth--
      else if ((ch === ';' || ch === '\n') && depth === 0) break
      i++
    }
    return { kind: 'type', start: aliasMatch.index, end: i, bodyStart: start }
  }
  return null
}

// ---------------------------------------------------------------------------
// Runtime props mapping (defineProps({...}), Options API `props`)
// ---------------------------------------------------------------------------

const RUNTIME_CTOR_TYPES: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'unknown[]',
  Object: 'Record<string, unknown>',
  Function: '(...args: any[]) => any',
  Symbol: 'symbol',
  Promise: 'Promise<unknown>',
  Date: 'Date',
  BigInt: 'bigint',
}

/** Extract `T` from a `... as PropType<T>` cast, if the text is one. */
function extractPropTypeCast(text: string): string | null {
  const castIndex = text.search(/\bas\s+PropType\s*</)
  if (castIndex === -1) return null
  const open = text.indexOf('<', castIndex)
  const close = findGenericEnd(text, open)
  if (close === -1) return null
  // The cast must wrap the whole value (`X as PropType<T>`).
  if (text.slice(close + 1).trim() !== '') return null
  return text.slice(open + 1, close).trim()
}

interface MappedProp {
  type: string
  optional: boolean
}

/** Map a runtime prop value (`String`, `{ type, required }`, ...) to a type. */
function mapRuntimePropValue(value: string): MappedProp {
  const text = value.trim()
  const cast = extractPropTypeCast(text)
  if (cast !== null) return { type: cast, optional: true }
  if (text === 'null') return { type: 'unknown', optional: true }
  if (text.startsWith('[')) {
    const close = findMatching(text, 0, '[', ']')
    if (close !== -1) {
      const ctors = splitTopLevel(text.slice(1, close))
        .map(ctor => mapRuntimePropValue(ctor).type)
        .filter(t => t !== 'unknown')
      return { type: ctors.length > 0 ? [...new Set(ctors)].join(' | ') : 'unknown', optional: true }
    }
  }
  if (text.startsWith('{')) {
    const entries = parseObjectEntries(text)
    const typeEntry = entries.find(e => e.key === 'type')
    const requiredEntry = entries.find(e => e.key === 'required')
    const type = typeEntry ? mapRuntimePropValue(typeEntry.value).type : 'unknown'
    const optional = !(requiredEntry && requiredEntry.value.trim() === 'true')
    return { type, optional }
  }
  if (RUNTIME_CTOR_TYPES[text]) return { type: RUNTIME_CTOR_TYPES[text], optional: true }
  // Unknown identifier: assume a custom class / constructor used as `type`.
  if (/^[A-Za-z_$][\w$.]*$/.test(text)) return { type: text, optional: true }
  return { type: 'unknown', optional: true }
}

/** Map a runtime props option (`{...}` or `[...]`) to a type literal. */
export function mapRuntimeProps(propsText: string): string | null {
  const text = propsText.trim()
  if (text.startsWith('{')) {
    const entries = parseObjectEntries(text)
    if (entries.length === 0) return '{}'
    const props = entries.map((entry) => {
      if (entry.isMethod || entry.value === '') return `${typeKey(entry.key)}?: unknown`
      const mapped = mapRuntimePropValue(entry.value)
      return `${typeKey(entry.key)}${mapped.optional ? '?' : ''}: ${mapped.type}`
    })
    return `{ ${props.join(', ')} }`
  }
  if (text.startsWith('[')) {
    const close = findMatching(text, 0, '[', ']')
    if (close === -1) return null
    const names = splitTopLevel(text.slice(1, close))
      .map(n => unquoteKey(n.trim()))
      .filter(n => n !== '')
    if (names.length === 0) return '{}'
    return `{ ${names.map(n => `${typeKey(n)}?: unknown`).join(', ')} }`
  }
  return null
}

// ---------------------------------------------------------------------------
// Emits mapping
// ---------------------------------------------------------------------------

/** Map an emits array literal (`['a', 'b']`) to a tuple type, or null. */
function mapEmitsArray(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[')) return null
  const close = findMatching(trimmed, 0, '[', ']')
  if (close === -1) return null
  const names = splitTopLevel(trimmed.slice(1, close)).map(n => n.trim())
  if (names.length === 0) return '{}'
  if (!names.every(n => (n.startsWith('\'') && n.endsWith('\'')) || (n.startsWith('"') && n.endsWith('"')))) {
    return 'string[]'
  }
  return `[${names.map(n => JSON.stringify(unquoteKey(n))).join(', ')}]`
}

/** Map an emits object literal (validators) to call signatures keyed by event. */
function mapEmitsObject(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return null
  const entries = parseObjectEntries(trimmed)
  if (entries.length === 0) return '{}'
  const signatures = entries.map(entry => `(e: ${JSON.stringify(entry.key)}, ...args: any[]) => void`)
  return `{ ${signatures.join(', ')} }`
}

/** Map a runtime emits argument (array or object) to an EmitsOptions type. */
function mapRuntimeEmits(argText: string): string | null {
  return mapEmitsArray(argText) ?? mapEmitsObject(argText)
}

// ---------------------------------------------------------------------------
// Compiler-macro statement stripping
// ---------------------------------------------------------------------------

/**
 * Remove `defineProps` / `defineEmits` / `defineExpose` / `defineOptions`
 * statements (including `withDefaults(defineProps(), ...)` wrappers) from
 * `<script setup>` content. Their type information has already been captured
 * in the synthesized component type; keeping the calls would only add noise
 * the declaration scanner does not need. Macros are only valid as top-level
 * statements, so a statement always starts at the beginning of a line.
 */
export function stripMacroStatements(content: string): string {
  let result = content
  for (const name of ['defineProps', 'defineEmits', 'defineExpose', 'defineOptions']) {
    result = stripMacro(result, name)
  }
  return result
}

function stripMacro(text: string, name: string): string {
  const pattern = new RegExp(`\\b${name}\\b`, 'g')
  const ranges: Array<[number, number]> = []
  let result = text
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(text)) !== null) {
    const lineStart = text.lastIndexOf('\n', match.index) + 1
    const prefix = text.slice(lineStart, match.index)
    // Allowed prefix: optional variable declarator, then an optional
    // `withDefaults(` wrapper directly around the macro call.
    const prefixMatch = /^\s*(?:(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*)?(withDefaults\s*\(\s*)?$/.exec(prefix)
    if (!prefixMatch) continue

    // Skip an optional generic parameter list after the macro name.
    let i = match.index + match[0].length
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] === '<') {
      const genericEnd = findGenericEnd(text, i)
      if (genericEnd === -1) continue
      i = genericEnd + 1
      while (i < text.length && /\s/.test(text[i])) i++
    }
    if (text[i] !== '(') continue
    let statementEnd = findMatching(text, i, '(', ')')
    if (statementEnd === -1) continue

    // When wrapped, the statement ends at the withDefaults(...) call.
    if (prefixMatch[1]) {
      const withDefaultsStart = lineStart + prefix.length - prefixMatch[1].length
      const wrapOpen = text.indexOf('(', withDefaultsStart)
      if (wrapOpen !== -1) {
        const wrapEnd = findMatching(text, wrapOpen, '(', ')')
        if (wrapEnd !== -1) statementEnd = wrapEnd
      }
    }

    // Swallow a trailing semicolon and the line's line break.
    let end = statementEnd + 1
    while (end < text.length && text[end] !== '\n' && /\s|;/.test(text[end])) end++
    if (text[end] === '\n') end++
    ranges.push([lineStart, end])
  }

  for (let i = ranges.length - 1; i >= 0; i--) {
    result = result.slice(0, ranges[i][0]) + result.slice(ranges[i][1])
  }
  return result
}

// ---------------------------------------------------------------------------
// Options API default-export extraction
// ---------------------------------------------------------------------------

interface OptionsExtraction {
  /** The options object literal text, when a component options object was found. */
  options: string | null
  /** The script with the default export removed (kept only when options were found). */
  script: string
  /** True when the default export is not an options object (class, identifier, ...). */
  passthrough: boolean
}

/** Extract the options object from `export default {...}` / `export default defineComponent({...})`. */
export function extractDefaultExportOptions(script: string): OptionsExtraction {
  const pattern = /\bexport\s+default\b/g
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(script)) !== null) {
    let i = match.index + match[0].length
    while (i < script.length && /\s/.test(script[i])) i++

    let objectStart = -1
    let objectEnd = -1
    let statementEnd = -1

    if (script[i] === '{') {
      objectStart = i
      objectEnd = findMatching(script, i, '{', '}')
      statementEnd = objectEnd
    }
    else if (script.startsWith('defineComponent', i)) {
      const callOpen = script.indexOf('(', i)
      if (callOpen !== -1) {
        let argStart = callOpen + 1
        while (argStart < script.length && /\s/.test(script[argStart])) argStart++
        if (script[argStart] === '{') {
          objectStart = argStart
          objectEnd = findMatching(script, argStart, '{', '}')
          const callEnd = findMatching(script, callOpen, '(', ')')
          statementEnd = callEnd
        }
      }
    }

    if (objectStart === -1 || objectEnd === -1 || statementEnd === -1) {
      // `export default class ...`, an identifier, ... — leave the script alone.
      return { options: null, script, passthrough: true }
    }

    let end = statementEnd + 1
    if (script[end] === ';') end++
    const cleaned = (script.slice(0, match.index) + script.slice(end)).trim()
    return { options: script.slice(objectStart, objectEnd + 1), script: cleaned, passthrough: false }
  }
  return { options: null, script, passthrough: false }
}

/** Pull a named option (`props`, `emits`) out of an options object literal. */
function getOptionValue(options: string, name: string): string | null {
  const entry = parseObjectEntries(options).find(e => e.key === name)
  return entry && entry.value !== '' ? entry.value : null
}

// ---------------------------------------------------------------------------
// Virtual module assembly
// ---------------------------------------------------------------------------

/**
 * Drop local value statements (`const count = ref(0)`, `function increment()`)
 * that are not referenced anywhere else. Script-setup bindings are component
 * internals — keeping them would let the declaration pipeline's word-based
 * reference matching pull them into the output whenever a prop or event
 * happens to share their name. Statements whose names appear in the remaining
 * source or in the synthesized component type (e.g. via `typeof sizes`) are
 * kept, as are exported declarations.
 */
function filterLocalValueStatements(content: string, componentType: string): string {
  const spans = findLocalValueStatements(content)
  // Remove from the end backwards so earlier spans stay valid.
  let result = content
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]
    const rest = result.slice(0, span.start) + result.slice(span.end)
    if (new RegExp(`\\b${span.name}\\b`).test(rest)) continue
    if (new RegExp(`\\btypeof\\s+${span.name}\\b`).test(componentType)) continue
    result = rest
  }
  return result
}

interface LocalValueStatement {
  name: string
  start: number
  end: number
}

/**
 * Find top-level (column-zero, optionally indented) `const/let/var` and
 * `function` statements that are not exported. Multi-line statements are
 * included; a statement ends at its depth-zero `;` or, without one, at the
 * first depth-zero newline.
 */
function findLocalValueStatements(content: string): LocalValueStatement[] {
  const spans: LocalValueStatement[] = []
  const pattern = /^[ \t]*(const|let|var|(?:async[ \t]+)?function)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=\n]+)?=?/gm
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = pattern.exec(content)) !== null) {
    // Never touch exported declarations.
    const lineStart = content.lastIndexOf('\n', match.index) + 1
    if (/\bexport\b/.test(content.slice(lineStart, match.index))) continue

    const keyword = match[1]
    const name = match[2]
    let i = match.index + match[0].length
    let end = -1

    if (keyword.endsWith('function')) {
      // function name(params) [: ret] { body }
      const parenOpen = content.indexOf('(', i)
      if (parenOpen === -1) continue
      const parenClose = findMatching(content, parenOpen, '(', ')')
      if (parenClose === -1) continue
      i = parenClose + 1
      while (i < content.length && /\s/.test(content[i])) i++
      if (content[i] === ':') {
        // Skip the return type up to the body brace.
        while (i < content.length && content[i] !== '{' && content[i] !== '\n') i++
      }
      while (i < content.length && /\s/.test(content[i]) && content[i] !== '\n') i++
      if (content[i] !== '{') continue
      const bodyClose = findMatching(content, i, '{', '}')
      if (bodyClose === -1) continue
      end = bodyClose + 1
    }
    else {
      // const name [: type] = <expr> — scan to depth-zero `;` or newline.
      let depth = 0
      while (i < content.length) {
        const ch = content[i]
        if (ch === '"' || ch === '\'') {
          i = skipString(content, i)
          continue
        }
        if (ch === '`') {
          i = skipTemplate(content, i)
          continue
        }
        if (ch === '/' && (content[i + 1] === '/' || content[i + 1] === '*')) {
          i = skipComment(content, i)
          continue
        }
        if (ch === '{' || ch === '[' || ch === '(') depth++
        else if (ch === '}' || ch === ']' || ch === ')') depth--
        else if (ch === ';' && depth === 0) {
          end = i + 1
          break
        }
        else if (ch === '\n' && depth === 0) {
          end = i
          break
        }
        i++
      }
      if (end === -1) end = content.length
    }

    // Swallow the trailing newline so no blank gap remains.
    if (content[end] === '\n') end++
    spans.push({ name, start: match.index, end })
  }
  return spans
}

/**
 * Remove an inlined interface/alias declaration from script content, unless
 * the name is still referenced elsewhere or the declaration is exported.
 */
function removeInlinedDeclaration(content: string, name: string, declText: string): string {
  const index = content.indexOf(declText)
  if (index === -1) return content
  // Never remove exported declarations — they are part of the module API.
  const lineStart = content.lastIndexOf('\n', index) + 1
  if (/\bexport\b/.test(content.slice(lineStart, index))) return content
  const rest = content.slice(0, index) + content.slice(index + declText.length)
  // Keep the declaration when the name is referenced anywhere else.
  if (new RegExp(`\\b${name}\\b`).test(rest)) return content
  return rest
}

interface PropsResolution {
  type: string
  /** A local interface/alias that was inlined into the props type. */
  inlinedLocal?: { name: string, declText: string }
}

/**
 * Collapse a type expression to a single line. Newlines separating object
 * literal members become `;`, continuation newlines (after an opener, comma,
 * colon, or before a closer, comma, union/intersection bar) become spaces.
 */
function collapseTypeText(text: string): string {
  let out = ''
  let i = 0
  const prevSignificant = (): string => {
    for (let j = out.length - 1; j >= 0; j--) {
      if (!/\s/.test(out[j])) return out[j]
    }
    return ''
  }
  const nextSignificant = (from: number): string => {
    for (let j = from; j < text.length; j++) {
      if (!/\s/.test(text[j])) return text[j]
    }
    return ''
  }
  while (i < text.length) {
    const ch = text[i]
    if (ch === '"' || ch === '\'') {
      const end = skipString(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '`') {
      const end = skipTemplate(text, i)
      out += text.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = skipComment(text, i)
      out += text.slice(i, end).replace(/\s*\n\s*/g, ' ')
      i = end
      continue
    }
    if (ch === '/' && text[i + 1] === '/') {
      // Line comment runs to the newline; the newline itself is handled below.
      let j = i + 2
      while (j < text.length && text[j] !== '\n') j++
      out += text.slice(i, j)
      i = j
      continue
    }
    if (ch === '\n') {
      const prev = prevSignificant()
      const next = nextSignificant(i + 1)
      if (prev === '' || next === '') {
        i++
        continue
      }
      if ('{;,(<:=['.includes(prev) || '}),]>;|&'.includes(next)) {
        if (!out.endsWith(' ') && !out.endsWith(';')) out += ' '
      }
      else {
        if (out.endsWith(' ')) out = out.slice(0, -1)
        out += '; '
      }
      i++
      // Skip the collapsed line's indentation.
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
      continue
    }
    out += ch
    i++
  }
  return out
}

function resolvePropsType(scriptSetup: string | null, script: string | null): PropsResolution | null {
  const sources = [scriptSetup, script].filter((s): s is string => s !== null)
  for (const source of sources) {
    const call = findMacroCall(source, 'defineProps')
    if (!call) continue
    if (call.generic) {
      const generic = call.generic
      // Inline object literal: `defineProps<{ msg: string }>()`
      if (generic.startsWith('{')) return { type: generic }
      // Local interface / alias: inline its body so the emitted declaration
      // does not dangle on a non-exported name.
      if (/^[A-Za-z_$][\w$]*$/.test(generic)) {
        for (const s of sources) {
          const span = findLocalTypeSpan(s, generic)
          if (!span) continue
          const local = findLocalType(s, generic)
          if (local === null) continue
          return { type: local, inlinedLocal: { name: generic, declText: s.slice(span.start, span.end) } }
        }
        return { type: generic }
      }
      return { type: generic }
    }
    if (call.arg) {
      const mapped = mapRuntimeProps(call.arg)
      if (mapped !== null) return { type: mapped }
    }
  }
  return null
}

function resolveEmitsType(scriptSetup: string | null, script: string | null): string | null {
  const sources = [scriptSetup, script].filter((s): s is string => s !== null)
  for (const source of sources) {
    const call = findMacroCall(source, 'defineEmits')
    if (!call) continue
    if (call.generic) return call.generic
    if (call.arg) {
      const mapped = mapRuntimeEmits(call.arg)
      if (mapped !== null) return mapped
    }
  }
  return null
}

function resolveExposedType(scriptSetup: string | null, script: string | null): string | null {
  const sources = [scriptSetup, script].filter((s): s is string => s !== null)
  for (const source of sources) {
    const call = findMacroCall(source, 'defineExpose')
    if (!call || !call.arg || !call.arg.startsWith('{')) continue
    const entries = parseObjectEntries(call.arg)
    if (entries.length === 0) return null
    const props = entries.map((entry) => {
      const isFunction = entry.isMethod || /=>|^\s*function\b/.test(entry.value)
      return `${typeKey(entry.key)}: ${isFunction ? '(...args: any[]) => any' : 'unknown'}`
    })
    return `{ ${props.join(', ')} }`
  }
  return null
}

/**
 * Transform a Vue SFC into a virtual TypeScript module whose declarations the
 * regular pipeline can emit. Always returns a module — a template-only SFC
 * still gets a bare `DefineComponent` default export.
 */
export function transformVueSfcToTs(source: string): string {
  const sfc = parseVueSfc(source)

  let scriptContent = ''
  let optionsProps: string | null = null
  let optionsEmits: string | null = null

  if (sfc.script) {
    const extraction = extractDefaultExportOptions(sfc.script.content)
    if (extraction.passthrough) {
      // `export default class/identifier/...` — the pipeline handles the
      // default export itself; appending a synthesized one would duplicate it.
      return sfc.scriptSetup
        ? `${sfc.script.content}\n${sfc.scriptSetup.content}`
        : sfc.script.content
    }
    scriptContent = extraction.script
    if (extraction.options) {
      const propsOption = getOptionValue(extraction.options, 'props')
      if (propsOption) optionsProps = mapRuntimeProps(propsOption)
      const emitsOption = getOptionValue(extraction.options, 'emits')
      if (emitsOption) optionsEmits = mapRuntimeEmits(emitsOption)
    }
  }

  const setupRaw = sfc.scriptSetup?.content ?? null
  let setupContent = setupRaw !== null ? stripMacroStatements(setupRaw) : null
  const propsResolution = resolvePropsType(setupRaw, setupRaw !== null ? null : scriptContent)
  const props = propsResolution?.type ?? optionsProps ?? '{}'
  const emits = resolveEmitsType(setupRaw, null) ?? optionsEmits
  const exposed = resolveExposedType(setupRaw, null)

  // When a local interface/alias was inlined into the props type, drop its
  // declaration from the virtual module unless something else references it —
  // an unreferenced remnant only fools reference counting into keeping setup
  // internals that share its property names. Exported declarations stay.
  const inlined = propsResolution?.inlinedLocal
  if (inlined) {
    scriptContent = removeInlinedDeclaration(scriptContent, inlined.name, inlined.declText)
    if (setupContent !== null) {
      setupContent = removeInlinedDeclaration(setupContent, inlined.name, inlined.declText)
    }
  }

  const typeArgs = [props, exposed ?? '{}']
  if (emits) {
    // DefineComponent<Props, RawBindings, D, C, M, Mixin, Extends, E>
    typeArgs.push('{}', '{}', '{}', '{}', '{}', emits)
  }
  const componentType = collapseTypeText(`DefineComponent<${typeArgs.join(', ')}>`)

  const parts: string[] = []
  const filteredScript = filterLocalValueStatements(scriptContent, componentType)
  if (filteredScript.trim() !== '') parts.push(filteredScript)
  if (setupContent && setupContent.trim() !== '') {
    const filteredSetup = filterLocalValueStatements(setupContent, componentType)
    if (filteredSetup.trim() !== '') parts.push(filteredSetup)
  }
  parts.push(`import type { DefineComponent } from 'vue'`)
  // A type alias keeps the const annotation free of generic argument lists —
  // the isolated declaration path cannot parse those on value declarations.
  parts.push(`type __DtsxComponentType = ${componentType}`)
  parts.push(`const __dtsx_component__: __DtsxComponentType = null as unknown as __DtsxComponentType`)
  parts.push('export default __dtsx_component__')
  return parts.join('\n')
}
