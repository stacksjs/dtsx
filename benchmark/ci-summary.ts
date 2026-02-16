/**
 * CI benchmark summary — cross-tool comparison + regression detection
 *
 * Reads the internal benchmark JSON, runs in-process comparison against
 * zig-dtsx (FFI), tsc, and oxc-transform, checks for regressions, and
 * writes everything to $GITHUB_STEP_SUMMARY.
 *
 * Usage: bun benchmark/ci-summary.ts [--results path] [--base path]
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isolatedDeclarationSync } from 'oxc-transform'
import ts from 'typescript'

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(name)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback
}

const resultsPath = getArg('--results', 'packages/dtsx/benchmark-results.json')
const basePath = getArg('--base', 'base-benchmark/benchmark-results.json')
const summaryPath = process.env.GITHUB_STEP_SUMMARY || ''

// ---------------------------------------------------------------------------
// Load internal benchmark results
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  name: string
  avgTimeMs: number
  minTimeMs: number
  maxTimeMs: number
  throughputCharsPerSec: number
  memoryUsedMB: number
  iterations: number
}

interface SuiteResult {
  name: string
  results: BenchmarkResult[]
  totalTimeMs: number
}

interface PhaseTimingResult {
  phase: string
  avgTimeMs: number
  percentOfTotal: number
}

interface PhaseTimingSuiteResult {
  name: string
  phases: PhaseTimingResult[]
  totalTimeMs: number
  fileSize: number
}

interface BenchmarkOutput {
  timestamp: string
  platform: string
  nodeVersion: string
  suites: SuiteResult[]
  phaseTimings: PhaseTimingSuiteResult[]
  summary: { totalTimeMs: number, totalBenchmarks: number, avgTimeMs: number }
}

const results: BenchmarkOutput = JSON.parse(readFileSync(resultsPath, 'utf8'))
const hasBase = existsSync(basePath)
const base: BenchmarkOutput | null = hasBase ? JSON.parse(readFileSync(basePath, 'utf8')) : null

// ---------------------------------------------------------------------------
// Cross-tool comparison — all in-process via API / FFI
// ---------------------------------------------------------------------------

const fixtureDir = join(import.meta.dir, '..', 'packages', 'dtsx', 'test', 'fixtures', 'input')

const SMALL_SOURCE = `
export interface Config { host: string; port: number; debug: boolean }
export type Status = 'active' | 'inactive' | 'pending'
export function createServer(config: Config): { start(): void; stop(): void } {
  return { start() {}, stop() {} }
}
export class Logger {
  constructor(private level: string) {}
  info(message: string): void { console.log(message) }
  error(message: string, error?: Error): void { console.error(message, error) }
}
export const VERSION: string = '1.0.0'
export const DEFAULT_PORT: number = 3000
export enum LogLevel { Debug = 'debug', Info = 'info', Warn = 'warn', Error = 'error' }
export type Callback<T> = (error: Error | null, result: T) => void
`

interface CrossToolInput {
  name: string
  filename: string
  source: string
}

// Generate synthetic TypeScript with many typed declarations
function generateSyntheticTS(approxLines: number): string {
  const blocks = Math.ceil(approxLines / 12)
  let source = ''
  for (let i = 0; i < blocks; i++) {
    source += `export interface Item${i} {
  id: number
  name: string
  value: ${i % 2 === 0 ? 'string' : 'number'}
  active: boolean
}

export function process${i}(item: Item${i}, options?: { verbose: boolean }): Item${i} {
  return item
}

export class Service${i} {
  constructor(private config: Item${i}) {}
  run(input: string): Promise<Item${i}> { return Promise.resolve(this.config) }
}

`
  }
  return source
}

const crossToolInputs: CrossToolInput[] = [
  { name: 'Small (~50 lines)', filename: 'small.ts', source: SMALL_SOURCE },
]

// Add real fixtures if they exist
const fixtureFiles = [
  { path: 'generics.ts', name: 'Medium (~100 lines)' },
  { path: 'ts-features.ts', name: 'Large (~330 lines)' },
  { path: 'real-world/react-like.ts', name: 'XLarge (~1050 lines)' },
]

for (const f of fixtureFiles) {
  const fullPath = join(fixtureDir, f.path)
  if (existsSync(fullPath)) {
    crossToolInputs.push({
      name: f.name,
      filename: f.path.replace(/.*\//, ''),
      source: readFileSync(fullPath, 'utf8'),
    })
  }
}

// Add synthetic larger inputs
crossToolInputs.push(
  { name: 'XXLarge (~2000 lines)', filename: 'xxlarge.ts', source: generateSyntheticTS(2000) },
  { name: 'Huge (~5000 lines)', filename: 'huge.ts', source: generateSyntheticTS(5000) },
)

// tsc helper
const tscOptions: ts.TranspileOptions = {
  compilerOptions: {
    declaration: true,
    emitDeclarationOnly: true,
    isolatedDeclarations: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  },
}

function tscGenerate(source: string, filename: string): string {
  return ts.transpileDeclaration(source, { ...tscOptions, fileName: filename }).outputText
}

// dtsx (Bun) — dynamic import
const { processSource } = await import('../packages/dtsx/src/generator')
const { clearSourceFileCache } = await import('../packages/dtsx/src/extractor')
const { clearDeclarationCache } = await import('../packages/dtsx/src/extractor/extract')
const { clearProcessorCaches } = await import('../packages/dtsx/src/processor')

function dtsxGenerate(source: string, filename: string): string {
  return processSource(source, filename, true, ['bun'], true)
}

function dtsxGenerateNoCache(source: string, filename: string): string {
  clearSourceFileCache()
  clearDeclarationCache()
  clearProcessorCaches()
  return processSource(source, filename, true, ['bun'], true)
}

// zig-dtsx — FFI (in-process, no spawn overhead)
let zigProcessSource: ((source: string, keepComments: boolean, isolatedDeclarations?: boolean) => string) | null = null
try {
  const zigMod = await import('../packages/zig-dtsx/src/index')
  if (zigMod.ZIG_AVAILABLE) {
    zigProcessSource = zigMod.processSource
    console.log('zig-dtsx FFI loaded (in-process)')
  }
  else {
    console.log('zig-dtsx shared library not found, skipping')
  }
}
catch (e) {
  console.log(`zig-dtsx FFI not available: ${e}`)
}

const hasZigDtsx = zigProcessSource !== null

function zigDtsxGenerate(source: string): string {
  return zigProcessSource!(source, true, true)
}

// tsgo — CLI only (no in-process API)
const tsgoBin = join(
  import.meta.dir, '..', 'node_modules',
  `@typescript/native-preview-${process.platform}-${process.arch}`,
  'lib',
  process.platform === 'win32' ? 'tsgo.exe' : 'tsgo',
)
const hasTsgo = existsSync(tsgoBin)
if (hasTsgo) console.log('tsgo CLI available')
else console.log('tsgo CLI not found, skipping')

const tsgoTmpDir = join(tmpdir(), 'dtsx-bench-tsgo')
const tsgoOutDir = join(tsgoTmpDir, 'out')
if (hasTsgo) mkdirSync(tsgoOutDir, { recursive: true })

const tsgoFlags = [
  '--declaration', '--emitDeclarationOnly', '--isolatedDeclarations',
  '--skipLibCheck', '--ignoreConfig', '--quiet', '--outDir', tsgoOutDir,
]

function tsgoGenerate(source: string, filename: string): string {
  const safeFilename = filename.replace(/[/\\]/g, '_')
  const tmpFile = join(tsgoTmpDir, safeFilename)
  writeFileSync(tmpFile, source)
  spawnSync(tsgoBin, [...tsgoFlags, tmpFile], { stdio: 'pipe', timeout: 30000 })
  const dtsFile = join(tsgoOutDir, safeFilename.replace(/\.ts$/, '.d.ts'))
  try { return readFileSync(dtsFile, 'utf8') } catch { return '' }
}

// Benchmark runner
function benchFn(fn: () => void, warmup = 5, iterations = 50): { avg: number, min: number, max: number } {
  for (let i = 0; i < warmup; i++) fn()
  const times: number[] = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  return { avg, min: Math.min(...times), max: Math.max(...times) }
}

type TimingResult = { avg: number, min: number, max: number }

interface CrossToolResult {
  input: string
  zigDtsx: TimingResult | null
  dtsx: TimingResult
  dtsxNoCache: TimingResult
  oxc: TimingResult
  tsc: TimingResult
  tsgo: TimingResult | null
}

console.log('Running cross-tool comparison...')
const crossToolResults: CrossToolResult[] = []

for (const input of crossToolInputs) {
  const zigDtsx = hasZigDtsx
    ? benchFn(() => zigDtsxGenerate(input.source))
    : null
  const dtsx = benchFn(() => dtsxGenerate(input.source, input.filename))
  const dtsxNoCache = benchFn(() => dtsxGenerateNoCache(input.source, input.filename))
  const oxc = benchFn(() => isolatedDeclarationSync(input.filename, input.source, { sourcemap: false }))
  const tsc = benchFn(() => tscGenerate(input.source, input.filename))
  const tsgo = hasTsgo
    ? benchFn(() => tsgoGenerate(input.source, input.filename), 2, 20)
    : null

  crossToolResults.push({ input: input.name, zigDtsx, dtsx, dtsxNoCache, oxc, tsc, tsgo })
  const zigStr = zigDtsx ? `zig-dtsx=${zigDtsx.avg.toFixed(3)}ms ` : ''
  const tsgoStr = tsgo ? ` tsgo=${tsgo.avg.toFixed(3)}ms` : ''
  console.log(`  ${input.name}: ${zigStr}dtsx=${dtsx.avg.toFixed(3)}ms oxc=${oxc.avg.toFixed(3)}ms tsc=${tsc.avg.toFixed(3)}ms${tsgoStr}`)
}

// ---------------------------------------------------------------------------
// Multi-file project benchmark (all in-process)
// ---------------------------------------------------------------------------

interface ProjectResult {
  fileCount: number
  zigDtsx: TimingResult | null
  dtsx: TimingResult
  oxc: TimingResult
  tsc: TimingResult
  tsgo: TimingResult | null
}

const projectCounts = [50, 100]
const projectResults: ProjectResult[] = []

console.log('Running multi-file project comparison...')

// Pre-generate project file sources in memory
const templates = crossToolInputs.slice(0, 4)

for (const count of projectCounts) {
  const projectFiles = Array.from({ length: count }, (_, i) => {
    const tmpl = templates[i % templates.length]
    return {
      name: `mod${i}.ts`,
      source: `// Module ${i}\nexport const __mod${i}_id: number = ${i}\n${tmpl.source}`,
    }
  })

  const zigProject = hasZigDtsx
    ? benchFn(() => {
        for (const f of projectFiles) zigDtsxGenerate(f.source)
      }, 1, 5)
    : null

  const dtsxProject = benchFn(() => {
    clearSourceFileCache()
    clearDeclarationCache()
    clearProcessorCaches()
    for (const f of projectFiles) processSource(f.source, f.name, true, ['bun'], true)
  }, 1, 5)

  const oxcProject = benchFn(() => {
    for (const f of projectFiles) isolatedDeclarationSync(f.name, f.source, { sourcemap: false })
  }, 1, 5)

  const tscProject = benchFn(() => {
    for (const f of projectFiles) tscGenerate(f.source, f.name)
  }, 1, 5)

  // tsgo: write all files to temp dir, then benchmark single invocation with all files
  let tsgoProject: TimingResult | null = null
  if (hasTsgo) {
    const tsgoProjectDir = join(tsgoTmpDir, `project-${count}`)
    const tsgoProjectOut = join(tsgoProjectDir, 'out')
    mkdirSync(tsgoProjectOut, { recursive: true })
    const tsgoProjectFiles: string[] = []
    for (const f of projectFiles) {
      const fpath = join(tsgoProjectDir, f.name)
      writeFileSync(fpath, f.source)
      tsgoProjectFiles.push(fpath)
    }
    tsgoProject = benchFn(() => {
      spawnSync(tsgoBin, [
        '--declaration', '--emitDeclarationOnly', '--isolatedDeclarations',
        '--skipLibCheck', '--ignoreConfig', '--quiet',
        '--outDir', tsgoProjectOut, ...tsgoProjectFiles,
      ], { stdio: 'pipe', timeout: 60000 })
    }, 1, 5)
  }

  projectResults.push({ fileCount: count, zigDtsx: zigProject, dtsx: dtsxProject, oxc: oxcProject, tsc: tscProject, tsgo: tsgoProject })
  const zigStr = zigProject ? `zig-dtsx=${zigProject.avg.toFixed(1)}ms ` : ''
  const tsgoStr = tsgoProject ? ` tsgo=${tsgoProject.avg.toFixed(1)}ms` : ''
  console.log(`  ${count} files: ${zigStr}dtsx=${dtsxProject.avg.toFixed(1)}ms oxc=${oxcProject.avg.toFixed(1)}ms tsc=${tscProject.avg.toFixed(1)}ms${tsgoStr}`)
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function fmt(ms: number): string {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)} ns`
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`
  if (ms < 1000) return `${ms.toFixed(2)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function fmtDelta(current: number, base: number): string {
  if (base === 0) return ''
  const pct = ((current - base) / base * 100)
  if (pct > 10) return `:red_circle: +${pct.toFixed(1)}%`
  if (pct < -10) return `:green_circle: ${pct.toFixed(1)}%`
  if (pct > 5) return `:yellow_circle: +${pct.toFixed(1)}%`
  if (pct < -5) return `:large_blue_circle: ${pct.toFixed(1)}%`
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function fmtThroughput(cps: number): string {
  if (cps > 1e9) return `${(cps / 1e9).toFixed(1)} G chars/s`
  if (cps > 1e6) return `${(cps / 1e6).toFixed(1)} M chars/s`
  return `${(cps / 1e3).toFixed(0)} K chars/s`
}

function fmtCell(ms: number, fastest: number): string {
  if (ms === fastest) return `**${fmt(ms)}**`
  const ratio = ms / fastest
  return `${fmt(ms)} _(${ratio.toFixed(1)}x)_`
}

// Render a comparison table (rows = tools, columns = inputs)
function renderTable(title: string, subtitle: string, tools: { name: string, getTime: (r: CrossToolResult) => number | null }[]): void {
  md += `### ${title}\n\n`
  md += `_${subtitle}_\n\n`

  // Header row: Tool | input1 | input2 | ...
  const colHeaders = ['Tool', ...crossToolResults.map(r => r.input)]
  md += `| ${colHeaders.join(' | ')} |\n`
  md += `|${colHeaders.map(() => '------').join('|')}|\n`

  // For each column, find the fastest time among all tools
  const fastestPerCol: number[] = crossToolResults.map((r) => {
    let min = Infinity
    for (const tool of tools) {
      const t = tool.getTime(r)
      if (t !== null && t < min) min = t
    }
    return min
  })

  for (const tool of tools) {
    const cells = [tool.name]
    for (let c = 0; c < crossToolResults.length; c++) {
      const t = tool.getTime(crossToolResults[c])
      cells.push(t !== null ? fmtCell(t, fastestPerCol[c]) : 'N/A')
    }
    md += `| ${cells.join(' | ')} |\n`
  }
  md += '\n'
}

// ---------------------------------------------------------------------------
// Build markdown summary
// ---------------------------------------------------------------------------

let md = '## Benchmark Results\n\n'
const runtime = typeof globalThis.Bun !== 'undefined' ? `Bun ${(globalThis as any).Bun.version}` : results.nodeVersion
md += `**Platform:** ${results.platform} | **Runtime:** ${runtime} | **Date:** ${results.timestamp.split('T')[0]}\n\n`

// --- Cached table ---
const cachedTools: { name: string, getTime: (r: CrossToolResult) => number | null }[] = [
  { name: '**dtsx (cached)**', getTime: r => r.dtsx.avg },
]
if (hasZigDtsx) cachedTools.push({ name: 'zig-dtsx', getTime: r => r.zigDtsx?.avg ?? null })
cachedTools.push(
  { name: 'oxc-transform', getTime: r => r.oxc.avg },
  { name: 'tsc', getTime: r => r.tsc.avg },
)
renderTable('In-Process API — Cached', 'Smart caching (hash check + cache hit) for watch mode, incremental builds, and CI.', cachedTools)

// --- No-cache table ---
const noCacheTools: { name: string, getTime: (r: CrossToolResult) => number | null }[] = []
if (hasZigDtsx) noCacheTools.push({ name: '**zig-dtsx**', getTime: r => r.zigDtsx?.avg ?? null })
noCacheTools.push(
  { name: 'oxc-transform', getTime: r => r.oxc.avg },
  { name: 'dtsx (no-cache)', getTime: r => r.dtsxNoCache.avg },
  { name: 'tsc', getTime: r => r.tsc.avg },
)
renderTable('In-Process API — No Cache', 'Raw single-transform comparison (cache cleared every iteration).', noCacheTools)

// --- tsgo note (CLI-only, not comparable to in-process tools) ---
if (hasTsgo) {
  md += '> **Note:** tsgo (`@typescript/native-preview`) is CLI-only — no in-process API is available yet. '
  md += 'Each measurement includes ~40ms process spawn overhead, so it is not directly comparable to the in-process tools above. '
  md += 'Once tsgo ships an in-process API, it will be added to the tables.\n\n'
}

// --- Multi-file project table ---
if (projectResults.length > 0) {
  md += '### Multi-File Project\n\n'
  md += '_All tools processing files in-process sequentially._\n\n'

  const projHeaders = ['Tool', ...projectResults.map(r => `${r.fileCount} files`)]
  md += `| ${projHeaders.join(' | ')} |\n`
  md += `|${projHeaders.map(() => '------').join('|')}|\n`

  const projTools: { name: string, getTime: (r: ProjectResult) => number | null }[] = []
  if (hasZigDtsx) projTools.push({ name: '**zig-dtsx**', getTime: r => r.zigDtsx?.avg ?? null })
  projTools.push(
    { name: 'dtsx', getTime: r => r.dtsx.avg },
    { name: 'oxc-transform', getTime: r => r.oxc.avg },
    { name: 'tsc', getTime: r => r.tsc.avg },
  )

  const fastestPerProj: number[] = projectResults.map((r) => {
    let min = Infinity
    for (const tool of projTools) {
      const t = tool.getTime(r)
      if (t !== null && t < min) min = t
    }
    return min
  })

  for (const tool of projTools) {
    const cells = [tool.name]
    for (let c = 0; c < projectResults.length; c++) {
      const t = tool.getTime(projectResults[c])
      cells.push(t !== null ? fmtCell(t, fastestPerProj[c]) : 'N/A')
    }
    md += `| ${cells.join(' | ')} |\n`
  }
  md += '\n'
}

// Regression detection
if (base) {
  md += '### Regression Detection\n\n'

  const avgDelta = fmtDelta(results.summary.avgTimeMs, base.summary.avgTimeMs)
  md += `**Overall:** avg ${fmt(base.summary.avgTimeMs)} → ${fmt(results.summary.avgTimeMs)} (${avgDelta})\n\n`

  let hasRegressions = false
  for (const suite of results.suites) {
    const baseSuite = base.suites.find(s => s.name === suite.name)
    if (!baseSuite) continue

    const rows: string[] = []
    for (const r of suite.results) {
      const br = baseSuite.results.find(x => x.name === r.name)
      if (!br) continue
      const delta = fmtDelta(r.avgTimeMs, br.avgTimeMs)
      const pct = ((r.avgTimeMs - br.avgTimeMs) / br.avgTimeMs * 100)
      if (pct > 10) hasRegressions = true
      rows.push(`| ${r.name} | ${fmt(br.avgTimeMs)} | ${fmt(r.avgTimeMs)} | ${delta} |`)
    }

    if (rows.length > 0) {
      md += `**${suite.name}**\n\n`
      md += '| Benchmark | Previous | Current | Change |\n'
      md += '|-----------|----------|---------|--------|\n'
      md += rows.join('\n') + '\n\n'
    }
  }

  if (!hasRegressions) {
    md += ':white_check_mark: No regressions detected (>10% threshold)\n\n'
  }
}
else {
  md += '> _No previous benchmark found for regression comparison_\n\n'
}

// Cross-tool regression tracking (zig-dtsx vs oxc-transform specific + all tools)
if (hasZigDtsx) {
  md += '### zig-dtsx vs oxc-transform\n\n'
  md += '| Input Size | zig-dtsx | oxc-transform | Speedup |\n'
  md += '|-----------|----------|---------------|----------|\n'
  for (const r of crossToolResults) {
    if (!r.zigDtsx) continue
    const speedup = r.oxc.avg / r.zigDtsx.avg
    const emoji = speedup >= 1 ? ':green_circle:' : ':red_circle:'
    md += `| ${r.input} | ${fmt(r.zigDtsx.avg)} | ${fmt(r.oxc.avg)} | ${emoji} ${speedup.toFixed(2)}x |\n`
  }
  md += '\n'
}

// zig-dtsx self-improvement vs previous run
const baseCrossToolForSelf = (base as any)?.crossTool as { input: string, zigDtsxMs: number | null }[] | undefined
const baseProjectForSelf = (base as any)?.projectBench as { fileCount: number, zigDtsxMs: number | null }[] | undefined

if (hasZigDtsx && baseCrossToolForSelf && baseCrossToolForSelf.length > 0) {
  md += '### zig-dtsx Improvement vs Previous Run\n\n'
  md += '| Input Size | Previous | Current | Change |\n'
  md += '|-----------|----------|---------|--------|\n'

  for (const r of crossToolResults) {
    if (!r.zigDtsx) continue
    const baseRow = baseCrossToolForSelf.find(b => b.input === r.input)
    if (!baseRow || baseRow.zigDtsxMs == null) continue
    const delta = fmtDelta(r.zigDtsx.avg, baseRow.zigDtsxMs)
    md += `| ${r.input} | ${fmt(baseRow.zigDtsxMs)} | ${fmt(r.zigDtsx.avg)} | ${delta} |\n`
  }

  // Also include multi-file project comparison
  if (baseProjectForSelf && baseProjectForSelf.length > 0) {
    for (const r of projectResults) {
      if (!r.zigDtsx) continue
      const baseRow = baseProjectForSelf.find(b => b.fileCount === r.fileCount)
      if (!baseRow || baseRow.zigDtsxMs == null) continue
      const delta = fmtDelta(r.zigDtsx.avg, baseRow.zigDtsxMs)
      md += `| ${r.fileCount} files (project) | ${fmt(baseRow.zigDtsxMs)} | ${fmt(r.zigDtsx.avg)} | ${delta} |\n`
    }
  }
  md += '\n'
}

// Cross-tool regression vs previous run
const baseCrossTool = (base as any)?.crossTool as { input: string, zigDtsxMs: number | null, dtsxCachedMs: number, dtsxNoCacheMs: number, oxcMs: number, tscMs: number, tsgoMs?: number | null }[] | undefined
if (baseCrossTool && baseCrossTool.length > 0) {
  md += '### Cross-Tool Changes vs Previous Run\n\n'
  md += '| Input Size | Tool | Previous | Current | Change |\n'
  md += '|-----------|------|----------|---------|--------|\n'

  const toolAccessors: { name: string, baseKey: string, getCurrent: (r: CrossToolResult) => number | null }[] = [
    { name: 'zig-dtsx', baseKey: 'zigDtsxMs', getCurrent: r => r.zigDtsx?.avg ?? null },
    { name: 'oxc-transform', baseKey: 'oxcMs', getCurrent: r => r.oxc.avg },
    { name: 'dtsx (no-cache)', baseKey: 'dtsxNoCacheMs', getCurrent: r => r.dtsxNoCache.avg },
    { name: 'tsc', baseKey: 'tscMs', getCurrent: r => r.tsc.avg },
  ]

  for (const r of crossToolResults) {
    const baseRow = baseCrossTool.find(b => b.input === r.input)
    if (!baseRow) continue
    for (const tool of toolAccessors) {
      const prev = (baseRow as any)[tool.baseKey] as number | null
      const curr = tool.getCurrent(r)
      if (prev == null || curr == null) continue
      const delta = fmtDelta(curr, prev)
      md += `| ${r.input} | ${tool.name} | ${fmt(prev)} | ${fmt(curr)} | ${delta} |\n`
    }
  }
  md += '\n'
}

// Internal benchmark details (collapsible)
md += '<details>\n<summary><strong>Internal Benchmark Details</strong></summary>\n\n'

for (const suite of results.suites) {
  md += `#### ${suite.name}\n\n`
  if (suite.results.length === 0) { md += '_No results_\n\n'; continue }

  const sorted = [...suite.results].sort((a, b) => a.avgTimeMs - b.avgTimeMs)
  const best = sorted[0].name

  md += '| Benchmark | Avg | Min | Max | Throughput | Memory |\n'
  md += '|-----------|-----|-----|-----|------------|--------|\n'
  for (const r of suite.results) {
    const marker = r.name === best ? ' :trophy:' : ''
    md += `| ${r.name}${marker} | ${fmt(r.avgTimeMs)} | ${fmt(r.minTimeMs)} | ${fmt(r.maxTimeMs)} | ${fmtThroughput(r.throughputCharsPerSec)} | ${r.memoryUsedMB.toFixed(1)} MB |\n`
  }
  md += '\n'
}

if (results.phaseTimings && results.phaseTimings.length > 0) {
  md += '#### Phase Timing\n\n'
  md += '| File | Phase | Avg Time | % of Total |\n'
  md += '|------|-------|----------|------------|\n'
  for (const timing of results.phaseTimings) {
    for (const phase of timing.phases) {
      const bar = '\u2588'.repeat(Math.min(Math.ceil(phase.percentOfTotal / 5), 20))
      md += `| ${timing.name} | ${phase.phase} | ${fmt(phase.avgTimeMs)} | ${bar} ${phase.percentOfTotal.toFixed(1)}% |\n`
    }
  }
  md += '\n'
}

md += '</details>\n\n'

md += '| Metric | Value |\n'
md += '|--------|-------|\n'
md += `| Total benchmarks | ${results.summary.totalBenchmarks} |\n`
md += `| Avg time | ${fmt(results.summary.avgTimeMs)} |\n`
md += `| Total time | ${(results.summary.totalTimeMs / 1000).toFixed(1)} s |\n`

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

if (summaryPath) {
  appendFileSync(summaryPath, md)
  console.log('Benchmark summary written to $GITHUB_STEP_SUMMARY')
}
else {
  console.log(md)
}

writeFileSync('benchmark-summary.md', md)

const fullResults = {
  ...results,
  crossTool: crossToolResults.map(r => ({
    input: r.input,
    zigDtsxMs: r.zigDtsx?.avg ?? null,
    dtsxCachedMs: r.dtsx.avg,
    dtsxNoCacheMs: r.dtsxNoCache.avg,
    oxcMs: r.oxc.avg,
    tscMs: r.tsc.avg,
    tsgoMs: r.tsgo?.avg ?? null,
  })),
  projectBench: projectResults.map(r => ({
    fileCount: r.fileCount,
    zigDtsxMs: r.zigDtsx?.avg ?? null,
    dtsxMs: r.dtsx.avg,
    oxcMs: r.oxc.avg,
    tscMs: r.tsc.avg,
    tsgoMs: r.tsgo?.avg ?? null,
  })),
}
writeFileSync(resultsPath, JSON.stringify(fullResults, null, 2))
console.log('Results updated with cross-tool data')
