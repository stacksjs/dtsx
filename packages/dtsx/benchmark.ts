/* eslint-disable no-console */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { extractDeclarations } from './src/extractor'
import { generate } from './src/generator'
import { createStreamingProcessor, formatMemoryStats } from './src/memory'
import { processDeclarations } from './src/processor'

/**
 * Benchmark configuration
 */
interface BenchmarkConfig {
  warmupIterations: number
  benchmarkIterations: number
  outputDir: string
  verbose: boolean
}

/**
 * Benchmark result
 */
interface BenchmarkResult {
  name: string
  avgTimeMs: number
  minTimeMs: number
  maxTimeMs: number
  throughputCharsPerSec: number
  memoryUsedMB: number
  iterations: number
}

/**
 * Suite result
 */
interface SuiteResult {
  name: string
  results: BenchmarkResult[]
  totalTimeMs: number
}

/**
 * Phase timing result
 */
interface PhaseTimingResult {
  phase: string
  avgTimeMs: number
  percentOfTotal: number
  iterations: number
}

/**
 * Per-phase timing suite result
 */
interface PhaseTimingSuiteResult {
  name: string
  phases: PhaseTimingResult[]
  totalTimeMs: number
  fileSize: number
  lineCount: number
}

const defaultConfig: BenchmarkConfig = {
  warmupIterations: 3,
  benchmarkIterations: 100,
  outputDir: './benchmark-output',
  verbose: true,
}

/**
 * Run a single benchmark
 */
async function runBenchmark(
  name: string,
  fn: () => void | Promise<void>,
  config: BenchmarkConfig,
  inputSize: number,
): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < config.warmupIterations; i++) {
    await fn()
  }

  // Force GC if available
  if (global.gc) {
    global.gc()
  }

  const memBefore = process.memoryUsage()
  const times: number[] = []

  // Benchmark
  for (let i = 0; i < config.benchmarkIterations; i++) {
    const start = performance.now()
    await fn()
    const end = performance.now()
    times.push(end - start)
  }

  const memAfter = process.memoryUsage()

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const throughput = inputSize / avgTime * 1000 // chars per second
  const memoryUsed = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024

  return {
    name,
    avgTimeMs: avgTime,
    minTimeMs: minTime,
    maxTimeMs: maxTime,
    throughputCharsPerSec: throughput,
    memoryUsedMB: Math.max(0, memoryUsed),
    iterations: config.benchmarkIterations,
  }
}

/**
 * Conditional logger for benchmark output
 */
function log(message: string, verbose: boolean): void {
  if (verbose) {
    console.log(message)
  }
}

/**
 * Format benchmark result for display
 */
function formatResult(result: BenchmarkResult): string {
  return [
    `  ${result.name}`,
    `    Avg: ${result.avgTimeMs.toFixed(2)}ms`,
    `    Min: ${result.minTimeMs.toFixed(2)}ms`,
    `    Max: ${result.maxTimeMs.toFixed(2)}ms`,
    `    Throughput: ${(result.throughputCharsPerSec / 1000).toFixed(1)}k chars/sec`,
    `    Memory delta: ${result.memoryUsedMB.toFixed(2)}MB`,
  ].join('\n')
}

/**
 * Extraction benchmark suite
 */
async function runExtractionBenchmarks(config: BenchmarkConfig): Promise<SuiteResult> {
  log('\n📦 Extraction Benchmarks\n', config.verbose)

  const results: BenchmarkResult[] = []
  const suiteStart = performance.now()

  // Test files of different complexities
  const testFiles = [
    { path: 'test/fixtures/input/example/0001.ts', name: 'Simple (0001.ts)' },
    { path: 'test/fixtures/input/example/0002.ts', name: 'Medium (0002.ts)' },
    { path: 'test/fixtures/input/example/0003.ts', name: 'Complex (0003.ts)' },
    { path: 'test/fixtures/input/example/0005.ts', name: 'Very Complex (0005.ts)' },
    // Real-world fixtures
    { path: 'test/fixtures/input/real-world/lodash-like.ts', name: 'Lodash-like (real-world)' },
    { path: 'test/fixtures/input/real-world/react-like.ts', name: 'React-like (real-world)' },
  ]

  for (const testFile of testFiles) {
    try {
      if (!existsSync(testFile.path)) {
        log(`  ⚠️  Skipping ${testFile.name} - file not found`, config.verbose)
        continue
      }

      const sourceCode = await readFile(testFile.path, 'utf-8')

      const result = await runBenchmark(
        testFile.name,
        () => extractDeclarations(sourceCode, testFile.path),
        config,
        sourceCode.length,
      )

      results.push(result)
      log(formatResult(result), config.verbose)
      log('', config.verbose)
    }
    catch (error) {
      console.error(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    name: 'Extraction',
    results,
    totalTimeMs: performance.now() - suiteStart,
  }
}

/**
 * Generation benchmark suite
 */
async function runGenerationBenchmarks(config: BenchmarkConfig): Promise<SuiteResult> {
  log('\n🔨 Generation Benchmarks\n', config.verbose)

  const results: BenchmarkResult[] = []
  const suiteStart = performance.now()

  // Ensure output directory exists
  if (!existsSync(config.outputDir)) {
    await mkdir(config.outputDir, { recursive: true })
  }

  // Single file generation
  const singleFileSource = generateLargeTypeScriptFile(100)
  const singleFilePath = join(config.outputDir, 'single-file.ts')
  await writeFile(singleFilePath, singleFileSource)

  const singleResult = await runBenchmark(
    'Single File (100 lines)',
    async () => {
      await generate({
        cwd: process.cwd(),
        root: config.outputDir,
        outdir: join(config.outputDir, 'dist'),
        entrypoints: ['single-file.ts'],
        clean: false,
      })
    },
    { ...config, benchmarkIterations: 10 },
    singleFileSource.length,
  )
  results.push(singleResult)
  log(formatResult(singleResult), config.verbose)
  log('', config.verbose)

  // Medium file generation
  const mediumFileSource = generateLargeTypeScriptFile(1000)
  const mediumFilePath = join(config.outputDir, 'medium-file.ts')
  await writeFile(mediumFilePath, mediumFileSource)

  const mediumResult = await runBenchmark(
    'Medium File (1000 lines)',
    async () => {
      await generate({
        cwd: process.cwd(),
        root: config.outputDir,
        outdir: join(config.outputDir, 'dist'),
        entrypoints: ['medium-file.ts'],
        clean: false,
      })
    },
    { ...config, benchmarkIterations: 5 },
    mediumFileSource.length,
  )
  results.push(mediumResult)
  log(formatResult(mediumResult), config.verbose)
  log('', config.verbose)

  // Large file generation
  const largeFileSource = generateLargeTypeScriptFile(5000)
  const largeFilePath = join(config.outputDir, 'large-file.ts')
  await writeFile(largeFilePath, largeFileSource)

  const largeResult = await runBenchmark(
    'Large File (5000 lines)',
    async () => {
      await generate({
        cwd: process.cwd(),
        root: config.outputDir,
        outdir: join(config.outputDir, 'dist'),
        entrypoints: ['large-file.ts'],
        clean: false,
      })
    },
    { ...config, benchmarkIterations: 3 },
    largeFileSource.length,
  )
  results.push(largeResult)
  log(formatResult(largeResult), config.verbose)

  return {
    name: 'Generation',
    results,
    totalTimeMs: performance.now() - suiteStart,
  }
}

/**
 * Memory benchmark suite
 */
async function runMemoryBenchmarks(config: BenchmarkConfig): Promise<SuiteResult> {
  log('\n💾 Memory Benchmarks\n', config.verbose)

  const results: BenchmarkResult[] = []
  const suiteStart = performance.now()
  const processor = createStreamingProcessor({ profile: true })

  // Large file memory test
  const largeSource = generateLargeTypeScriptFile(10000)
  log(`  Testing with ${largeSource.length} chars (${largeSource.split('\n').length} lines)`, config.verbose)

  // Force GC
  if (global.gc)
    global.gc()

  const memBefore = processor.getMemoryStats()
  log(`  Memory before: ${formatMemoryStats(memBefore)}`, config.verbose)

  const extractStart = performance.now()
  const declarations = extractDeclarations(largeSource, 'large.ts')
  const extractEnd = performance.now()

  const memAfter = processor.getMemoryStats()
  log(`  Memory after: ${formatMemoryStats(memAfter)}`, config.verbose)
  log(`  Declarations found: ${declarations.length}`, config.verbose)
  log(`  Time: ${(extractEnd - extractStart).toFixed(2)}ms`, config.verbose)

  results.push({
    name: 'Large File Memory',
    avgTimeMs: extractEnd - extractStart,
    minTimeMs: extractEnd - extractStart,
    maxTimeMs: extractEnd - extractStart,
    throughputCharsPerSec: largeSource.length / (extractEnd - extractStart) * 1000,
    memoryUsedMB: memAfter.heapUsedMB - memBefore.heapUsedMB,
    iterations: 1,
  })

  return {
    name: 'Memory',
    results,
    totalTimeMs: performance.now() - suiteStart,
  }
}

/**
 * Real-world library benchmark suite
 * Tests against patterns from popular libraries
 */
async function runRealWorldBenchmarks(config: BenchmarkConfig): Promise<SuiteResult> {
  log('\n🌍 Real-World Library Benchmarks\n', config.verbose)

  const results: BenchmarkResult[] = []
  const suiteStart = performance.now()

  const realWorldFiles = [
    {
      path: 'test/fixtures/input/real-world/lodash-like.ts',
      name: 'Lodash-like',
      description: 'Utility library with many overloads and generics',
    },
    {
      path: 'test/fixtures/input/real-world/react-like.ts',
      name: 'React-like',
      description: 'Component library with complex JSX types',
    },
  ]

  for (const file of realWorldFiles) {
    try {
      if (!existsSync(file.path)) {
        log(`  ⚠️  Skipping ${file.name} - file not found`, config.verbose)
        continue
      }

      const sourceCode = await readFile(file.path, 'utf-8')
      const lineCount = sourceCode.split('\n').length

      log(`  📁 ${file.name}`, config.verbose)
      log(`     ${file.description}`, config.verbose)
      log(`     ${sourceCode.length} chars, ${lineCount} lines`, config.verbose)

      const result = await runBenchmark(
        file.name,
        () => extractDeclarations(sourceCode, file.path),
        { ...config, benchmarkIterations: Math.min(config.benchmarkIterations, 20) },
        sourceCode.length,
      )

      results.push(result)
      log(`     ⚡ ${result.avgTimeMs.toFixed(2)}ms avg (${(result.throughputCharsPerSec / 1000).toFixed(1)}k chars/sec)`, config.verbose)
      log('', config.verbose)
    }
    catch (error) {
      console.error(`  ❌ Error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    name: 'Real-World',
    results,
    totalTimeMs: performance.now() - suiteStart,
  }
}

/**
 * Per-phase timing benchmark suite
 * Breaks down time spent in each processing phase
 */
async function runPhaseTimingBenchmarks(config: BenchmarkConfig): Promise<PhaseTimingSuiteResult[]> {
  log('\n⏱️  Per-Phase Timing Benchmarks\n', config.verbose)

  const results: PhaseTimingSuiteResult[] = []

  // Test with different file sizes
  const sizes = [500, 2000, 5000]

  for (const size of sizes) {
    const source = generateLargeTypeScriptFile(size)
    const lineCount = source.split('\n').length
    const iterations = Math.max(3, Math.floor(20 / (size / 1000)))

    log(`  Testing ${size} lines (${source.length} chars)...`, config.verbose)

    // Phase timings
    const phaseTimes: Record<string, number[]> = {
      'File Read': [],
      'Extraction': [],
      'Processing': [],
      'Formatting': [],
      'Total': [],
    }

    // Warmup
    for (let i = 0; i < 2; i++) {
      extractDeclarations(source, `phase-test-${size}.ts`)
    }

    // Run benchmark
    for (let i = 0; i < iterations; i++) {
      const totalStart = performance.now()

      // Phase 1: File Read (simulated since we already have the source)
      const readStart = performance.now()
      const _sourceRef = source // Simulate file read reference
      const readEnd = performance.now()
      phaseTimes['File Read'].push(readEnd - readStart)

      // Phase 2: Extraction
      const extractStart = performance.now()
      const declarations = extractDeclarations(source, `phase-test-${size}.ts`)
      const extractEnd = performance.now()
      phaseTimes.Extraction.push(extractEnd - extractStart)

      // Phase 3: Processing
      const processStart = performance.now()
      const processed = processDeclarations(declarations, {
        filePath: `phase-test-${size}.ts`,
        sourceCode: source,
        declarations,
        usedTypes: new Set(),
      })
      const processEnd = performance.now()
      phaseTimes.Processing.push(processEnd - processStart)

      // Phase 4: Formatting (string operations)
      const formatStart = performance.now()
      const _output = typeof processed === 'string' ? processed : processed.join('\n')
      const formatEnd = performance.now()
      phaseTimes.Formatting.push(formatEnd - formatStart)

      const totalEnd = performance.now()
      phaseTimes.Total.push(totalEnd - totalStart)
    }

    // Calculate averages
    const phases: PhaseTimingResult[] = []
    const totalAvg = phaseTimes.Total.reduce((a, b) => a + b, 0) / iterations

    for (const [phase, times] of Object.entries(phaseTimes)) {
      if (phase === 'Total')
        continue

      const avgTime = times.reduce((a, b) => a + b, 0) / iterations
      phases.push({
        phase,
        avgTimeMs: avgTime,
        percentOfTotal: (avgTime / totalAvg) * 100,
        iterations,
      })
    }

    // Sort by time (descending)
    phases.sort((a, b) => b.avgTimeMs - a.avgTimeMs)

    results.push({
      name: `${size} lines`,
      phases,
      totalTimeMs: totalAvg,
      fileSize: source.length,
      lineCount,
    })

    // Print results
    log(`    Total: ${totalAvg.toFixed(2)}ms`, config.verbose)
    for (const phase of phases) {
      const bar = '█'.repeat(Math.ceil(phase.percentOfTotal / 5))
      log(`    ${phase.phase.padEnd(12)} ${phase.avgTimeMs.toFixed(2).padStart(8)}ms (${phase.percentOfTotal.toFixed(1).padStart(5)}%) ${bar}`, config.verbose)
    }
    log('', config.verbose)
  }

  return results
}

/**
 * Synthetic file benchmark suite
 */
async function runSyntheticBenchmarks(config: BenchmarkConfig): Promise<SuiteResult> {
  log('\n🧪 Synthetic Benchmarks\n', config.verbose)

  const results: BenchmarkResult[] = []
  const suiteStart = performance.now()

  const sizes = [100, 500, 1000, 5000, 10000]

  for (const size of sizes) {
    const source = generateLargeTypeScriptFile(size)

    const result = await runBenchmark(
      `${size} lines`,
      () => extractDeclarations(source, `synthetic-${size}.ts`),
      { ...config, benchmarkIterations: Math.max(1, Math.floor(50 / (size / 1000))) },
      source.length,
    )

    results.push(result)
    log(`  ${size} lines: ${result.avgTimeMs.toFixed(2)}ms (${(result.throughputCharsPerSec / 1000).toFixed(1)}k chars/sec)`, config.verbose)
  }

  return {
    name: 'Synthetic',
    results,
    totalTimeMs: performance.now() - suiteStart,
  }
}

/**
 * Generate a large TypeScript file for benchmarking
 */
function generateLargeTypeScriptFile(lines: number): string {
  const content: string[] = []

  // Add imports
  content.push('import { SomeType } from \'some-module\'')
  content.push('import type { AnotherType } from \'another-module\'')
  content.push('')

  // Add interfaces
  const interfaceCount = Math.floor(lines * 0.1)
  for (let i = 0; i < interfaceCount; i++) {
    content.push(`export interface Interface${i} {`)
    content.push(`  prop${i}: string`)
    content.push(`  method${i}(): void`)
    content.push(`  nested${i}: {`)
    content.push(`    inner: number`)
    content.push(`  }`)
    content.push(`}`)
    content.push('')
  }

  // Add types
  const typeCount = Math.floor(lines * 0.1)
  for (let i = 0; i < typeCount; i++) {
    content.push(`export type Type${i} = string | number | Interface${i % interfaceCount}`)
  }
  content.push('')

  // Add functions
  const funcCount = Math.floor(lines * 0.2)
  for (let i = 0; i < funcCount; i++) {
    content.push(`export function func${i}(param: Type${i % typeCount}): Interface${i % interfaceCount} {`)
    content.push(`  return {} as Interface${i % interfaceCount}`)
    content.push(`}`)
    content.push('')
  }

  // Add async functions
  const asyncFuncCount = Math.floor(lines * 0.1)
  for (let i = 0; i < asyncFuncCount; i++) {
    content.push(`export async function asyncFunc${i}(param: Type${i % typeCount}): Promise<Interface${i % interfaceCount}> {`)
    content.push(`  return {} as Interface${i % interfaceCount}`)
    content.push(`}`)
    content.push('')
  }

  // Add variables
  const varCount = Math.floor(lines * 0.1)
  for (let i = 0; i < varCount; i++) {
    content.push(`export const var${i}: Type${i % typeCount} = 'value${i}'`)
  }
  content.push('')

  // Add classes
  const classCount = Math.floor(lines * 0.1)
  for (let i = 0; i < classCount; i++) {
    content.push(`export class Class${i} implements Interface${i % interfaceCount} {`)
    content.push(`  prop${i % interfaceCount} = 'value'`)
    content.push(`  nested${i % interfaceCount} = { inner: 42 }`)
    content.push(`  method${i % interfaceCount}() {}`)
    content.push(`  private privateMethod() {}`)
    content.push(`  static staticMethod(): void {}`)
    content.push(`}`)
    content.push('')
  }

  // Add enums
  const enumCount = Math.floor(lines * 0.05)
  for (let i = 0; i < enumCount; i++) {
    content.push(`export enum Enum${i} {`)
    content.push(`  Value1 = 'value1',`)
    content.push(`  Value2 = 'value2',`)
    content.push(`  Value3 = ${i},`)
    content.push(`}`)
    content.push('')
  }

  // Add generic types
  const genericCount = Math.floor(lines * 0.05)
  for (let i = 0; i < genericCount; i++) {
    content.push(`export type Generic${i}<T, U extends Interface${i % interfaceCount}> = {`)
    content.push(`  value: T`)
    content.push(`  mapped: U`)
    content.push(`  array: T[]`)
    content.push(`}`)
    content.push('')
  }

  return content.join('\n')
}

/**
 * Print phase timing summary (only called in non-JSON mode)
 */
function printPhaseTimingSummary(timings: PhaseTimingSuiteResult[]): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log('⏱️  PHASE TIMING SUMMARY')
  console.log('='.repeat(60))

  // Calculate average percentages across all file sizes
  const phaseAverages = new Map<string, number[]>()

  for (const timing of timings) {
    for (const phase of timing.phases) {
      if (!phaseAverages.has(phase.phase)) {
        phaseAverages.set(phase.phase, [])
      }
      phaseAverages.get(phase.phase)!.push(phase.percentOfTotal)
    }
  }

  console.log('\nAverage Time Distribution:')
  console.log('-'.repeat(50))

  const averages: { phase: string, avgPercent: number }[] = []
  for (const [phase, percents] of phaseAverages) {
    const avgPercent = percents.reduce((a, b) => a + b, 0) / percents.length
    averages.push({ phase, avgPercent })
  }

  averages.sort((a, b) => b.avgPercent - a.avgPercent)

  for (const { phase, avgPercent } of averages) {
    const bar = '█'.repeat(Math.ceil(avgPercent / 2))
    const spaces = ' '.repeat(50 - bar.length)
    console.log(`${phase.padEnd(14)} ${avgPercent.toFixed(1).padStart(5)}% ${bar}${spaces}`)
  }

  console.log('\nPer-File Size Breakdown:')
  console.log('-'.repeat(50))

  for (const timing of timings) {
    console.log(`\n${timing.name} (${timing.fileSize} chars):`)
    console.log(`  Total: ${timing.totalTimeMs.toFixed(2)}ms`)

    for (const phase of timing.phases) {
      console.log(`  ${phase.phase.padEnd(12)} ${phase.avgTimeMs.toFixed(2).padStart(8)}ms (${phase.percentOfTotal.toFixed(1).padStart(5)}%)`)
    }
  }

  // Identify bottleneck
  const bottleneck = averages[0]
  console.log('\n💡 Optimization Target:')
  console.log(`   ${bottleneck.phase} accounts for ${bottleneck.avgPercent.toFixed(1)}% of processing time`)
}

/**
 * Print summary table (only called in non-JSON mode)
 */
function printSummary(suites: SuiteResult[]): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 BENCHMARK SUMMARY')
  console.log('='.repeat(60))

  for (const suite of suites) {
    console.log(`\n${suite.name} Suite (${suite.totalTimeMs.toFixed(0)}ms total)`)
    console.log('-'.repeat(50))

    if (suite.results.length === 0) {
      console.log('  No results')
      continue
    }

    // Find best and worst
    const sortedByTime = [...suite.results].sort((a, b) => a.avgTimeMs - b.avgTimeMs)
    const best = sortedByTime[0]
    const worst = sortedByTime[sortedByTime.length - 1]

    for (const result of suite.results) {
      const isBest = result === best
      const isWorst = result === worst && suite.results.length > 1
      const marker = isBest ? '🏆' : isWorst ? '🐢' : '  '
      console.log(`${marker} ${result.name}: ${result.avgTimeMs.toFixed(2)}ms`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
}

/**
 * Benchmark output for CI
 */
interface BenchmarkOutput {
  timestamp: string
  platform: string
  nodeVersion: string
  suites: SuiteResult[]
  phaseTimings: PhaseTimingSuiteResult[]
  summary: {
    totalTimeMs: number
    totalBenchmarks: number
    avgTimeMs: number
  }
}

/**
 * Main benchmark runner
 */
async function main() {
  const args = process.argv.slice(2)
  const jsonOutput = args.includes('--json')
  const outputFile = args.find(a => a.startsWith('--output='))?.split('=')[1]

  if (!jsonOutput) {
    console.log('🚀 dtsx Performance Benchmark Suite\n')
    console.log(`Node: ${process.version}`)
    console.log(`Platform: ${process.platform} ${process.arch}`)
    console.log(`Date: ${new Date().toISOString()}`)

    const processor = createStreamingProcessor()
    console.log(`Memory: ${formatMemoryStats(processor.getMemoryStats())}`)
  }

  const config = { ...defaultConfig }

  // Parse command line args
  if (args.includes('--quick')) {
    config.warmupIterations = 1
    config.benchmarkIterations = 10
  }
  if (args.includes('--ci')) {
    // CI mode: fewer iterations for speed, but still meaningful
    config.warmupIterations = 2
    config.benchmarkIterations = 20
  }
  if (args.includes('--verbose')) {
    config.verbose = true
  }
  if (jsonOutput) {
    config.verbose = false
  }

  const suites: SuiteResult[] = []
  let phaseTimings: PhaseTimingSuiteResult[] = []

  try {
    // Run all benchmark suites
    suites.push(await runExtractionBenchmarks(config))
    suites.push(await runSyntheticBenchmarks(config))
    suites.push(await runMemoryBenchmarks(config))

    // Run real-world benchmarks unless skipped
    if (!args.includes('--skip-real-world')) {
      suites.push(await runRealWorldBenchmarks(config))
    }

    // Run phase timing benchmarks unless skipped
    if (!args.includes('--skip-phases')) {
      phaseTimings = await runPhaseTimingBenchmarks(config)
    }

    if (!args.includes('--skip-generation')) {
      suites.push(await runGenerationBenchmarks(config))
    }

    // Calculate summary
    const totalTimeMs = suites.reduce((sum, s) => sum + s.totalTimeMs, 0)
    const totalBenchmarks = suites.reduce((sum, s) => sum + s.results.length, 0)
    const avgTimeMs = suites.flatMap(s => s.results).reduce((sum, r) => sum + r.avgTimeMs, 0) / totalBenchmarks

    // Output results
    if (jsonOutput) {
      const output: BenchmarkOutput = {
        timestamp: new Date().toISOString(),
        platform: `${process.platform} ${process.arch}`,
        nodeVersion: process.version,
        suites,
        phaseTimings,
        summary: {
          totalTimeMs,
          totalBenchmarks,
          avgTimeMs,
        },
      }

      const jsonStr = JSON.stringify(output, null, 2)

      if (outputFile) {
        await writeFile(outputFile, jsonStr)
        console.error(`Benchmark results written to ${outputFile}`)
      }
      else {
        console.log(jsonStr)
      }
    }
    else {
      // Print summary
      printSummary(suites)

      // Print phase timing summary
      if (phaseTimings.length > 0) {
        printPhaseTimingSummary(phaseTimings)
      }

      console.log('\n✅ Benchmark complete!')
    }

    // Cleanup
    if (existsSync(config.outputDir)) {
      await rm(config.outputDir, { recursive: true })
    }
  }
  catch (error) {
    console.error('\n❌ Benchmark failed:', error)
    process.exit(1)
  }
}

// Export for programmatic use
export {
  type BenchmarkConfig,
  type BenchmarkOutput,
  type BenchmarkResult,
  generateLargeTypeScriptFile,
  type PhaseTimingResult,
  type PhaseTimingSuiteResult,
  runBenchmark,
  runExtractionBenchmarks,
  runGenerationBenchmarks,
  runMemoryBenchmarks,
  runPhaseTimingBenchmarks,
  runRealWorldBenchmarks,
  runSyntheticBenchmarks,
  type SuiteResult,
}

// Run if executed directly
main().catch(console.error)
