/**
 * Deep processor profiler — identify the O(n²) hotspot
 * Run: bun packages/dtsx/profiler-deep.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { scanDeclarations } from './src/extractor/scanner'
import { extractAllImportedItems, parseImportStatement } from './src/processor/imports'
import { formatComments } from './src/processor/comments'
import type { Declaration, ProcessingContext } from './src/types'

const ITERATIONS = 30

function isIdentChar(ch: number): boolean {
  return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57)
    || ch === 95 || ch === 36 || ch > 127
}

function isWordInText(name: string, text: string): boolean {
  let searchFrom = 0
  const nameLen = name.length
  while (searchFrom < text.length) {
    const idx = text.indexOf(name, searchFrom)
    if (idx === -1) return false
    const before = idx > 0 ? text.charCodeAt(idx - 1) : 32
    const after = idx + nameLen < text.length ? text.charCodeAt(idx + nameLen) : 32
    if (!isIdentChar(before) && !isIdentChar(after)) return true
    searchFrom = idx + 1
  }
  return false
}

function profileProcessor(label: string, source: string, filename: string) {
  const decls = scanDeclarations(source, filename, true, false)

  // Group declarations like the processor does
  const imports: Declaration[] = []
  const functions: Declaration[] = []
  const variables: Declaration[] = []
  const interfaces: Declaration[] = []
  const types: Declaration[] = []
  const classes: Declaration[] = []
  const enums: Declaration[] = []
  const modules: Declaration[] = []
  const exports: Declaration[] = []

  for (const d of decls) {
    switch (d.kind) {
      case 'import': imports.push(d); break
      case 'function': functions.push(d); break
      case 'variable': variables.push(d); break
      case 'interface': interfaces.push(d); break
      case 'type': types.push(d); break
      case 'class': classes.push(d); break
      case 'enum': enums.push(d); break
      case 'module': modules.push(d); break
      case 'export': exports.push(d); break
    }
  }

  console.log(`\n=== ${label} ===`)
  console.log(`  ${decls.length} declarations (${imports.length} imports, ${functions.length} funcs, ${variables.length} vars, ${interfaces.length} ifaces, ${types.length} types, ${classes.length} classes, ${enums.length} enums, ${exports.length} exports)`)

  // Profile Phase A: Import map building
  const timesA: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    const map = new Map<string, Declaration>()
    for (const imp of imports) {
      const items = extractAllImportedItems(imp.text)
      for (const item of items) map.set(item, imp)
    }
    timesA.push(performance.now() - s)
  }

  // Profile Phase B: Interface reference checking (O(n²))
  const timesB: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    const refs = new Set<string>()
    for (const iface of interfaces) {
      let found = false
      for (const func of functions) {
        if (func.isExported && func.text.includes(iface.name)) { found = true; break }
      }
      if (!found) {
        for (const cls of classes) {
          if (cls.text.includes(iface.name)) { found = true; break }
        }
      }
      if (!found) {
        for (const type of types) {
          if (type.text.includes(iface.name)) { found = true; break }
        }
      }
      if (found) refs.add(iface.name)
    }
    timesB.push(performance.now() - s)
  }

  // Profile Phase C: Combined text building
  const timesC: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    const parts: string[] = []
    for (const func of functions) if (func.isExported) parts.push(func.text)
    for (const v of variables) if (v.isExported) { parts.push(v.text); if (v.typeAnnotation) parts.push(v.typeAnnotation) }
    for (const iface of interfaces) if (iface.isExported) parts.push(iface.text)
    for (const t of types) parts.push(t.text)
    for (const c of classes) parts.push(c.text)
    for (const e of enums) parts.push(e.text)
    for (const m of modules) parts.push(m.text)
    for (const exp of exports) parts.push(exp.text)
    timesC.push(performance.now() - s)
  }

  // Profile Phase D: Import usage detection (O(n²) hot path)
  const allImportedItemsMap = new Map<string, Declaration>()
  for (const imp of imports) {
    const items = extractAllImportedItems(imp.text)
    for (const item of items) allImportedItemsMap.set(item, imp)
  }

  const combinedTextParts: string[] = []
  for (const func of functions) if (func.isExported) combinedTextParts.push(func.text)
  for (const v of variables) if (v.isExported) { combinedTextParts.push(v.text); if (v.typeAnnotation) combinedTextParts.push(v.typeAnnotation) }
  for (const iface of interfaces) if (iface.isExported) combinedTextParts.push(iface.text)
  for (const t of types) combinedTextParts.push(t.text)
  for (const c of classes) combinedTextParts.push(c.text)
  for (const e of enums) combinedTextParts.push(e.text)
  for (const m of modules) combinedTextParts.push(m.text)
  for (const exp of exports) combinedTextParts.push(exp.text)

  // Current approach: O(imports * parts)
  const timesD: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    const usedItems = new Set<string>()
    for (const item of allImportedItemsMap.keys()) {
      for (let p = 0; p < combinedTextParts.length; p++) {
        if (isWordInText(item, combinedTextParts[p])) {
          usedItems.add(item)
          break
        }
      }
    }
    timesD.push(performance.now() - s)
  }

  // Optimized approach: join once, search once per import
  const timesDOpt: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    const combinedText = combinedTextParts.join('\n')
    const usedItems = new Set<string>()
    for (const item of allImportedItemsMap.keys()) {
      if (isWordInText(item, combinedText)) {
        usedItems.add(item)
      }
    }
    timesDOpt.push(performance.now() - s)
  }

  // Profile Phase E: Import sorting
  const timesE: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    const importStrings = imports.map(imp => {
      const parsed = parseImportStatement(imp.text)
      if (!parsed) return ''
      return `import { ${parsed.namedItems.join(', ')} } from '${parsed.source}';`
    }).filter(Boolean)
    importStrings.sort((a, b) => a.localeCompare(b))
    timesE.push(performance.now() - s)
  }

  // Profile Phase F: Declaration processing (format + string building)
  const timesF: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    let result = ''
    for (const d of decls) {
      if (d.kind === 'import' || d.kind === 'export') continue
      const comments = formatComments(d.leadingComments, true)
      result += comments + d.text + '\n'
    }
    timesF.push(performance.now() - s)
  }

  // Optimized interface reference: join-then-search approach
  const timesBOpt: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const s = performance.now()
    // Build combined text once
    let combined = ''
    for (const func of functions) if (func.isExported) combined += func.text + '\n'
    for (const cls of classes) combined += cls.text + '\n'
    for (const t of types) combined += t.text + '\n'
    const refs = new Set<string>()
    for (const iface of interfaces) {
      if (isWordInText(iface.name, combined)) refs.add(iface.name)
    }
    timesBOpt.push(performance.now() - s)
  }

  // Print results
  const avg = (t: number[]) => t.reduce((a, b) => a + b, 0) / t.length
  const totalEst = avg(timesA) + avg(timesB) + avg(timesC) + avg(timesD) + avg(timesE) + avg(timesF)

  console.log(`  Estimated total:      ${totalEst.toFixed(3)}ms`)
  console.log()
  console.log(`  A. Import map build:  ${avg(timesA).toFixed(4)}ms  (${(avg(timesA) / totalEst * 100).toFixed(1)}%)`)
  console.log(`  B. Interface refs:    ${avg(timesB).toFixed(4)}ms  (${(avg(timesB) / totalEst * 100).toFixed(1)}%)  ← O(n²)`)
  console.log(`  B' Interface refs opt:${avg(timesBOpt).toFixed(4)}ms  (${((1 - avg(timesBOpt) / avg(timesB)) * 100).toFixed(0)}% faster)`)
  console.log(`  C. Text part build:   ${avg(timesC).toFixed(4)}ms  (${(avg(timesC) / totalEst * 100).toFixed(1)}%)`)
  console.log(`  D. Import filtering:  ${avg(timesD).toFixed(4)}ms  (${(avg(timesD) / totalEst * 100).toFixed(1)}%)  ← O(n²)`)
  console.log(`  D' Import filter opt: ${avg(timesDOpt).toFixed(4)}ms  (${((1 - avg(timesDOpt) / avg(timesD)) * 100).toFixed(0)}% faster)`)
  console.log(`  E. Import sorting:    ${avg(timesE).toFixed(4)}ms  (${(avg(timesE) / totalEst * 100).toFixed(1)}%)`)
  console.log(`  F. Decl processing:   ${avg(timesF).toFixed(4)}ms  (${(avg(timesF) / totalEst * 100).toFixed(1)}%)`)

  // Search stats
  console.log()
  console.log(`  Import items: ${allImportedItemsMap.size}`)
  console.log(`  Text parts: ${combinedTextParts.length}`)
  console.log(`  Total search pairs (current): ${allImportedItemsMap.size * combinedTextParts.length}`)
  console.log(`  Total search pairs (optimized): ${allImportedItemsMap.size}`)

  // Combined text length
  const totalTextLen = combinedTextParts.reduce((sum, t) => sum + t.length, 0)
  console.log(`  Total text to search: ${(totalTextLen / 1024).toFixed(1)}KB`)
}

const fixtureDir = join(import.meta.dir, 'test', 'fixtures', 'input')
let reactLike = ''
try { reactLike = readFileSync(join(fixtureDir, 'real-world', 'react-like.ts'), 'utf-8') } catch {}

function generateLarge(lines: number): string {
  const content: string[] = []
  // Add many imports to stress the import filtering
  for (let i = 0; i < 20; i++) {
    content.push(`import type { Type${i}A, Type${i}B, Type${i}C } from 'module-${i}'`)
  }
  content.push('')
  const ic = Math.floor(lines * 0.1)
  for (let i = 0; i < ic; i++) {
    content.push(`export interface Interface${i} {`)
    content.push(`  prop${i}: string`)
    content.push(`  method${i}(): void`)
    content.push(`  nested${i}: { inner: number }`)
    content.push(`}`)
    content.push('')
  }
  const tc = Math.floor(lines * 0.1)
  for (let i = 0; i < tc; i++) content.push(`export type Type${i} = string | number | Interface${i % ic}`)
  content.push('')
  const fc = Math.floor(lines * 0.2)
  for (let i = 0; i < fc; i++) {
    content.push(`export function func${i}(param: Type${i % tc}): Interface${i % ic} {`)
    content.push(`  return {} as Interface${i % ic}`)
    content.push(`}`)
    content.push('')
  }
  const vc = Math.floor(lines * 0.1)
  for (let i = 0; i < vc; i++) content.push(`export const var${i}: Type${i % tc} = 'value${i}'`)
  content.push('')
  const cc = Math.floor(lines * 0.1)
  for (let i = 0; i < cc; i++) {
    content.push(`export class Class${i} implements Interface${i % ic} {`)
    content.push(`  prop${i % ic} = 'value'`)
    content.push(`  nested${i % ic} = { inner: 42 }`)
    content.push(`  method${i % ic}() {}`)
    content.push(`  private privateMethod() {}`)
    content.push(`  static staticMethod(): void {}`)
    content.push(`}`)
    content.push('')
  }
  return content.join('\n')
}

console.log('=== Deep Processor Profiler ===')
profileProcessor('Synthetic 500 lines (many imports)', generateLarge(500), 'synth-500.ts')
profileProcessor('Synthetic 2000 lines (many imports)', generateLarge(2000), 'synth-2000.ts')
if (reactLike) profileProcessor('React-like (real-world)', reactLike, 'react-like.ts')
