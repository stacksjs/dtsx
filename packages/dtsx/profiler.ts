/**
 * I/O breakdown profiler — understand where processing time goes
 * Run: bun packages/dtsx/profiler.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { hashContent } from './src/extractor/hash'
import { scanDeclarations } from './src/extractor/scanner'
import { processDeclarations } from './src/processor'
import type { ProcessingContext } from './src/types'

const ITERATIONS = 50
const WARMUP = 5

interface PhaseResult {
  name: string
  totalMs: number
  avgMs: number
  pctOfTotal: number
}

function profile(label: string, source: string, filename: string) {
  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    const decls = scanDeclarations(source, filename, true, false)
    const ctx: ProcessingContext = { filePath: filename, sourceCode: source, declarations: decls }
    processDeclarations(decls, ctx, true, ['bun'])
  }

  const phases: Record<string, number[]> = {
    hash: [],
    scan: [],
    process: [],
    total: [],
  }

  // Also profile sub-phases within scan
  const scanSubPhases: Record<string, number[]> = {
    scanFull: [],
  }

  for (let i = 0; i < ITERATIONS; i++) {
    const totalStart = performance.now()

    // Phase 1: Hashing (cache key computation)
    const hashStart = performance.now()
    hashContent(source)
    const hashEnd = performance.now()
    phases.hash.push(hashEnd - hashStart)

    // Phase 2: Scanning (declaration extraction)
    const scanStart = performance.now()
    const decls = scanDeclarations(source, filename, true, false)
    const scanEnd = performance.now()
    phases.scan.push(scanEnd - scanStart)
    scanSubPhases.scanFull.push(scanEnd - scanStart)

    // Phase 3: Processing (declaration to DTS)
    const processStart = performance.now()
    const ctx: ProcessingContext = { filePath: filename, sourceCode: source, declarations: decls }
    const result = processDeclarations(decls, ctx, true, ['bun'])
    const processEnd = performance.now()
    phases.process.push(processEnd - processStart)

    const totalEnd = performance.now()
    phases.total.push(totalEnd - totalStart)

    // Prevent dead code elimination
    if (result.length < 0) throw new Error('never')
  }

  // Calculate stats
  const results: PhaseResult[] = []
  const totalAvg = phases.total.reduce((a, b) => a + b, 0) / ITERATIONS

  for (const [name, times] of Object.entries(phases)) {
    if (name === 'total') continue
    const avg = times.reduce((a, b) => a + b, 0) / ITERATIONS
    results.push({
      name,
      totalMs: times.reduce((a, b) => a + b, 0),
      avgMs: avg,
      pctOfTotal: (avg / totalAvg) * 100,
    })
  }

  results.sort((a, b) => b.avgMs - a.avgMs)

  console.log(`\n=== ${label} (${source.length} chars, ${source.split('\n').length} lines) ===`)
  console.log(`Total avg: ${totalAvg.toFixed(3)}ms`)
  console.log(`Declarations found: ${scanDeclarations(source, filename, true, false).length}`)
  console.log()

  for (const r of results) {
    const bar = '#'.repeat(Math.ceil(r.pctOfTotal / 2))
    console.log(`  ${r.name.padEnd(12)} ${r.avgMs.toFixed(3).padStart(10)}ms  ${r.pctOfTotal.toFixed(1).padStart(5)}%  ${bar}`)
  }

  // Min/max for total
  const totalMin = Math.min(...phases.total)
  const totalMax = Math.max(...phases.total)
  const scanMin = Math.min(...phases.scan)
  const scanMax = Math.max(...phases.scan)
  const procMin = Math.min(...phases.process)
  const procMax = Math.max(...phases.process)
  console.log()
  console.log(`  Total range: ${totalMin.toFixed(3)}ms - ${totalMax.toFixed(3)}ms`)
  console.log(`  Scan  range: ${scanMin.toFixed(3)}ms - ${scanMax.toFixed(3)}ms`)
  console.log(`  Proc  range: ${procMin.toFixed(3)}ms - ${procMax.toFixed(3)}ms`)
}

// --- Profile scanner sub-phases ---
function profileScannerBreakdown(label: string, source: string, filename: string) {
  // We can't easily instrument inside scanDeclarations without modifying it,
  // so let's measure key aspects externally

  const ITERS = 30
  // Warmup
  for (let i = 0; i < 3; i++) scanDeclarations(source, filename, true, false)

  // Measure scan with vs without comments
  const withComments: number[] = []
  const withoutComments: number[] = []
  const withIsolated: number[] = []

  for (let i = 0; i < ITERS; i++) {
    let s = performance.now()
    scanDeclarations(source, filename, true, false)
    withComments.push(performance.now() - s)

    s = performance.now()
    scanDeclarations(source, filename, false, false)
    withoutComments.push(performance.now() - s)

    s = performance.now()
    scanDeclarations(source, filename, true, true)
    withIsolated.push(performance.now() - s)
  }

  const avgWith = withComments.reduce((a, b) => a + b, 0) / ITERS
  const avgWithout = withoutComments.reduce((a, b) => a + b, 0) / ITERS
  const avgIsolated = withIsolated.reduce((a, b) => a + b, 0) / ITERS

  console.log(`\n--- Scanner breakdown: ${label} ---`)
  console.log(`  With comments:    ${avgWith.toFixed(3)}ms`)
  console.log(`  Without comments: ${avgWithout.toFixed(3)}ms`)
  console.log(`  Comment overhead: ${(avgWith - avgWithout).toFixed(3)}ms (${((avgWith - avgWithout) / avgWith * 100).toFixed(1)}%)`)
  console.log(`  Isolated decls:   ${avgIsolated.toFixed(3)}ms`)
}

// --- Profile processor sub-phases ---
function profileProcessorBreakdown(label: string, source: string, filename: string) {
  const decls = scanDeclarations(source, filename, true, false)
  const ITERS = 30

  // Count declaration types
  const counts: Record<string, number> = {}
  for (const d of decls) {
    counts[d.kind] = (counts[d.kind] || 0) + 1
  }

  console.log(`\n--- Processor breakdown: ${label} ---`)
  console.log(`  Declaration types: ${JSON.stringify(counts)}`)
  console.log(`  Total declarations: ${decls.length}`)

  // Measure processor
  for (let i = 0; i < 3; i++) {
    const ctx: ProcessingContext = { filePath: filename, sourceCode: source, declarations: decls }
    processDeclarations(decls, ctx, true, ['bun'])
  }

  const times: number[] = []
  for (let i = 0; i < ITERS; i++) {
    const ctx: ProcessingContext = { filePath: filename, sourceCode: source, declarations: decls }
    const s = performance.now()
    processDeclarations(decls, ctx, true, ['bun'])
    times.push(performance.now() - s)
  }

  const avg = times.reduce((a, b) => a + b, 0) / ITERS
  console.log(`  Avg processing:   ${avg.toFixed(3)}ms`)
  console.log(`  Per declaration:   ${(avg / decls.length * 1000).toFixed(1)}µs`)
}

// --- Load fixtures ---
const fixtureDir = join(import.meta.dir, 'test', 'fixtures', 'input')

const SMALL = `
export interface Config {
  host: string
  port: number
  debug: boolean
}
export type Status = 'active' | 'inactive' | 'pending'
export function createServer(config: Config): { start(): void; stop(): void } {
  return { start() {}, stop() {} }
}
export class Logger {
  constructor(private level: string) {}
  info(message: string): void { console.log(message) }
  error(message: string, error?: Error): void { console.error(message, error) }
}
`

// Generate synthetic large file
function generateLarge(lines: number): string {
  const content: string[] = []
  content.push("import { SomeType } from 'some-module'")
  content.push("import type { AnotherType } from 'another-module'")
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
  for (let i = 0; i < tc; i++) {
    content.push(`export type Type${i} = string | number | Interface${i % ic}`)
  }
  content.push('')
  const fc = Math.floor(lines * 0.2)
  for (let i = 0; i < fc; i++) {
    content.push(`export function func${i}(param: Type${i % tc}): Interface${i % ic} {`)
    content.push(`  return {} as Interface${i % ic}`)
    content.push(`}`)
    content.push('')
  }
  const vc = Math.floor(lines * 0.1)
  for (let i = 0; i < vc; i++) {
    content.push(`export const var${i}: Type${i % tc} = 'value${i}'`)
  }
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
  const ec = Math.floor(lines * 0.05)
  for (let i = 0; i < ec; i++) {
    content.push(`export enum Enum${i} {`)
    content.push(`  Value1 = 'value1',`)
    content.push(`  Value2 = 'value2',`)
    content.push(`  Value3 = ${i},`)
    content.push(`}`)
    content.push('')
  }
  return content.join('\n')
}

// Load real fixtures
let reactLike = ''
let lodashLike = ''
try { reactLike = readFileSync(join(fixtureDir, 'real-world', 'react-like.ts'), 'utf-8') } catch {}
try { lodashLike = readFileSync(join(fixtureDir, 'real-world', 'lodash-like.ts'), 'utf-8') } catch {}

const MEDIUM = generateLarge(500)
const LARGE = generateLarge(1000)
const XLARGE = generateLarge(2000)

console.log('='.repeat(60))
console.log('dtsx Performance Profiler — I/O Breakdown')
console.log('='.repeat(60))
console.log(`Iterations: ${ITERATIONS}, Warmup: ${WARMUP}`)

// Run profiles
profile('Small (~15 lines)', SMALL, 'small.ts')
profile('Medium (~500 lines)', MEDIUM, 'medium.ts')
profile('Large (~1000 lines)', LARGE, 'large.ts')
profile('XLarge (~2000 lines)', XLARGE, 'xlarge.ts')

if (reactLike) profile('React-like (real-world)', reactLike, 'react-like.ts')
if (lodashLike) profile('Lodash-like (real-world)', lodashLike, 'lodash-like.ts')

// Scanner breakdowns
profileScannerBreakdown('Medium (~500 lines)', MEDIUM, 'medium.ts')
profileScannerBreakdown('Large (~1000 lines)', LARGE, 'large.ts')
profileScannerBreakdown('XLarge (~2000 lines)', XLARGE, 'xlarge.ts')
if (reactLike) profileScannerBreakdown('React-like', reactLike, 'react-like.ts')

// Processor breakdowns
profileProcessorBreakdown('Medium (~500 lines)', MEDIUM, 'medium.ts')
profileProcessorBreakdown('Large (~1000 lines)', LARGE, 'large.ts')
profileProcessorBreakdown('XLarge (~2000 lines)', XLARGE, 'xlarge.ts')
if (reactLike) profileProcessorBreakdown('React-like', reactLike, 'react-like.ts')

console.log('\n' + '='.repeat(60))
console.log('Done!')
