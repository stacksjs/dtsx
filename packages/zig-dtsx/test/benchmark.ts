/**
 * Benchmark: Zig DTS (CLI + FFI) vs TypeScript DTS emitter
 *
 * Three runners:
 *   1. Zig CLI  — spawns zig-out/bin/zig-dtsx, pipes via stdin
 *   2. Zig FFI  — calls the shared library in-process via Bun FFI
 *   3. TS       — calls processSource() from @stacksjs/dtsx in-process
 *
 * Two benchmark modes:
 *   A. Single-file — each fixture processed individually
 *   B. Multi-file project — all fixtures processed as a batch
 *
 * Usage: bun run test/benchmark.ts [--quick] [--cli-only]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const fixturesDir = resolve(import.meta.dir, '../../dtsx/test/fixtures')
const zigBinary = resolve(import.meta.dir, '..', 'zig-out', 'bin', 'zig-dtsx')
const args = process.argv.slice(2)
const quick = args.includes('--quick')
const cliOnly = args.includes('--cli-only')

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

function zigCli(input: string): string {
  const result = spawnSync(zigBinary, [], {
    input,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result.stdout
}

let zigFfi: ((input: string) => string) | null = null
let tsProcess: ((input: string) => string) | null = null

async function loadRunners(): Promise<void> {
  // Zig FFI
  if (!cliOnly) {
    try {
      const { processSource } = await import('../src/index')
      zigFfi = (source: string) => processSource(source, true)
    }
    catch {
      console.log('  Zig FFI: not available (run "zig build" first)')
    }
  }

  // TS
  try {
    const mod = await import('@stacksjs/dtsx')
    const fn = (mod as any).processSource ?? (mod as any).default?.processSource
    if (fn) {
      tsProcess = (source: string) => fn(source, 'bench.ts', true)
    }
    else {
      console.log('  TS: processSource not found in @stacksjs/dtsx')
    }
  }
  catch {
    console.log('  TS: could not import @stacksjs/dtsx')
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

interface SingleResult {
  name: string
  inputSize: number
  zigCliMs: number
  zigFfiMs: number | null
  tsMs: number | null
}

function bench(fn: (input: string) => string, input: string, iterations: number): number {
  // warmup
  for (let i = 0; i < 3; i++) fn(input)
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn(input)
  return (performance.now() - start) / iterations
}

// ---------------------------------------------------------------------------
// A) Single-file benchmark
// ---------------------------------------------------------------------------

async function singleFileBenchmark(): Promise<SingleResult[]> {
  const fixtures = [
    'imports', 'exports', 'function', 'function-types', 'variable',
    'interface', 'class', 'enum', 'type', 'namespace',
    'generics', 'advanced-types', 'edge-cases', 'complex-class', 'module',
    'type-only-imports', 'comments',
  ]

  const iterations = quick ? 20 : 100
  const results: SingleResult[] = []

  for (const fixture of fixtures) {
    const inputPath = join(fixturesDir, 'input', `${fixture}.ts`)
    if (!existsSync(inputPath)) continue

    const input = readFileSync(inputPath, 'utf-8')
    const inputSize = Buffer.byteLength(input, 'utf-8')

    const zigCliMs = bench(zigCli, input, iterations)
    const zigFfiMs = zigFfi ? bench(zigFfi, input, iterations) : null
    const tsMs = tsProcess ? bench(tsProcess, input, iterations) : null

    results.push({ name: fixture, inputSize, zigCliMs, zigFfiMs, tsMs })
  }

  // Large file — fewer iterations
  const checkerPath = join(fixturesDir, 'input', 'checker.ts')
  if (existsSync(checkerPath)) {
    const input = readFileSync(checkerPath, 'utf-8')
    const inputSize = Buffer.byteLength(input, 'utf-8')
    const iters = quick ? 2 : 5
    const zigCliMs = bench(zigCli, input, iters)
    const zigFfiMs = zigFfi ? bench(zigFfi, input, iters) : null
    const tsMs = tsProcess ? bench(tsProcess, input, iters) : null
    results.push({ name: 'checker.ts (large)', inputSize, zigCliMs, zigFfiMs, tsMs })
  }

  // Real-world fixtures
  for (const rw of ['lodash-like', 'react-like']) {
    const rwPath = join(fixturesDir, 'input', 'real-world', `${rw}.ts`)
    if (!existsSync(rwPath)) continue
    const input = readFileSync(rwPath, 'utf-8')
    const inputSize = Buffer.byteLength(input, 'utf-8')
    const iters = quick ? 10 : 50
    const zigCliMs = bench(zigCli, input, iters)
    const zigFfiMs = zigFfi ? bench(zigFfi, input, iters) : null
    const tsMs = tsProcess ? bench(tsProcess, input, iters) : null
    results.push({ name: rw, inputSize, zigCliMs, zigFfiMs, tsMs })
  }

  return results
}

// ---------------------------------------------------------------------------
// B) Multi-file project benchmark
// ---------------------------------------------------------------------------

interface ProjectResult {
  name: string
  fileCount: number
  totalSize: number
  zigCliMs: number
  zigFfiMs: number | null
  tsMs: number | null
}

function collectInputFiles(dir: string): { name: string, content: string }[] {
  const files: { name: string, content: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push({ name: entry.name, content: readFileSync(join(dir, entry.name), 'utf-8') })
    }
    else if (entry.isDirectory()) {
      for (const sub of readdirSync(join(dir, entry.name), { withFileTypes: true })) {
        if (sub.isFile() && sub.name.endsWith('.ts')) {
          files.push({
            name: `${entry.name}/${sub.name}`,
            content: readFileSync(join(dir, entry.name, sub.name), 'utf-8'),
          })
        }
      }
    }
  }
  return files
}

function benchProject(
  runner: (input: string) => string,
  files: { content: string }[],
  iterations: number,
): number {
  // warmup
  for (let w = 0; w < 2; w++) {
    for (const f of files) runner(f.content)
  }
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    for (const f of files) runner(f.content)
  }
  return (performance.now() - start) / iterations
}

async function multiFileBenchmark(): Promise<ProjectResult[]> {
  const results: ProjectResult[] = []
  const inputDir = join(fixturesDir, 'input')
  const allFiles = collectInputFiles(inputDir)

  // Small project: just the basic fixtures (no checker.ts)
  const smallFiles = allFiles.filter(f => !f.name.includes('checker'))
  const smallSize = smallFiles.reduce((s, f) => s + Buffer.byteLength(f.content, 'utf-8'), 0)
  const smallIters = quick ? 5 : 20

  {
    const zigCliMs = benchProject(zigCli, smallFiles, smallIters)
    const zigFfiMs = zigFfi ? benchProject(zigFfi, smallFiles, smallIters) : null
    const tsMs = tsProcess ? benchProject(tsProcess, smallFiles, smallIters) : null
    results.push({
      name: 'All fixtures (excl. checker)',
      fileCount: smallFiles.length,
      totalSize: smallSize,
      zigCliMs,
      zigFfiMs,
      tsMs,
    })
  }

  // Full project: everything including checker.ts
  const fullSize = allFiles.reduce((s, f) => s + Buffer.byteLength(f.content, 'utf-8'), 0)
  const fullIters = quick ? 2 : 5

  {
    const zigCliMs = benchProject(zigCli, allFiles, fullIters)
    const zigFfiMs = zigFfi ? benchProject(zigFfi, allFiles, fullIters) : null
    const tsMs = tsProcess ? benchProject(tsProcess, allFiles, fullIters) : null
    results.push({
      name: 'Full project (all files)',
      fileCount: allFiles.length,
      totalSize: fullSize,
      zigCliMs,
      zigFfiMs,
      tsMs,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function printSingleResults(results: SingleResult[]): void {
  const hasFFI = results.some(r => r.zigFfiMs !== null)
  const hasTS = results.some(r => r.tsMs !== null)

  // Header
  let header = `${'Fixture'.padEnd(22)} ${'Size'.padStart(8)}`
  header += ` ${'Zig CLI'.padStart(10)}`
  if (hasFFI) header += ` ${'Zig FFI'.padStart(10)}`
  if (hasTS) header += ` ${'TS'.padStart(10)}`
  if (hasFFI) header += ` ${'FFI/TS'.padStart(8)}`
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const r of results) {
    let row = `${r.name.padEnd(22)} ${formatBytes(r.inputSize).padStart(8)}`
    row += ` ${(r.zigCliMs.toFixed(2) + 'ms').padStart(10)}`
    if (hasFFI) row += ` ${r.zigFfiMs !== null ? (r.zigFfiMs.toFixed(2) + 'ms').padStart(10) : 'n/a'.padStart(10)}`
    if (hasTS) row += ` ${r.tsMs !== null ? (r.tsMs.toFixed(2) + 'ms').padStart(10) : 'n/a'.padStart(10)}`
    if (hasFFI && r.zigFfiMs !== null && r.tsMs !== null) {
      const speedup = r.tsMs / r.zigFfiMs
      row += ` ${(speedup.toFixed(1) + 'x').padStart(8)}`
    }
    console.log(row)
  }

  // Summary
  if (hasFFI && hasTS) {
    const withBoth = results.filter(r => r.zigFfiMs !== null && r.tsMs !== null)
    if (withBoth.length > 0) {
      const avgFFI = withBoth.reduce((s, r) => s + r.zigFfiMs!, 0) / withBoth.length
      const avgTS = withBoth.reduce((s, r) => s + r.tsMs!, 0) / withBoth.length
      console.log(`\n  Zig FFI avg: ${avgFFI.toFixed(3)}ms — TS avg: ${avgTS.toFixed(3)}ms — FFI is ${(avgTS / avgFFI).toFixed(1)}x faster`)
    }
  }
}

function printProjectResults(results: ProjectResult[]): void {
  const hasFFI = results.some(r => r.zigFfiMs !== null)
  const hasTS = results.some(r => r.tsMs !== null)

  let header = `${'Project'.padEnd(32)} ${'Files'.padStart(6)} ${'Size'.padStart(8)}`
  header += ` ${'Zig CLI'.padStart(10)}`
  if (hasFFI) header += ` ${'Zig FFI'.padStart(10)}`
  if (hasTS) header += ` ${'TS'.padStart(10)}`
  if (hasFFI) header += ` ${'FFI/TS'.padStart(8)}`
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const r of results) {
    let row = `${r.name.padEnd(32)} ${String(r.fileCount).padStart(6)} ${formatBytes(r.totalSize).padStart(8)}`
    row += ` ${(r.zigCliMs.toFixed(1) + 'ms').padStart(10)}`
    if (hasFFI) row += ` ${r.zigFfiMs !== null ? (r.zigFfiMs.toFixed(1) + 'ms').padStart(10) : 'n/a'.padStart(10)}`
    if (hasTS) row += ` ${r.tsMs !== null ? (r.tsMs.toFixed(1) + 'ms').padStart(10) : 'n/a'.padStart(10)}`
    if (hasFFI && r.zigFfiMs !== null && r.tsMs !== null) {
      const speedup = r.tsMs / r.zigFfiMs
      row += ` ${(speedup.toFixed(1) + 'x').padStart(8)}`
    }
    console.log(row)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(zigBinary)) {
    console.error(`Zig binary not found at: ${zigBinary}`)
    console.error('Run "zig build -Doptimize=ReleaseFast" first.')
    process.exit(1)
  }

  console.log('\n=== zig-dtsx Benchmark ===\n')
  console.log(`Zig CLI binary: ${zigBinary}`)
  console.log(`Mode: ${quick ? 'quick' : 'full'}${cliOnly ? ' (CLI only)' : ''}\n`)

  console.log('Loading runners...')
  await loadRunners()

  // A) Single-file benchmark
  console.log('\n--- Single-File Benchmark ---\n')
  const singleResults = await singleFileBenchmark()
  printSingleResults(singleResults)

  // B) Multi-file project benchmark
  console.log('\n\n--- Multi-File Project Benchmark ---\n')
  const projectResults = await multiFileBenchmark()
  printProjectResults(projectResults)

  console.log('\n')
}

main().catch(console.error)
