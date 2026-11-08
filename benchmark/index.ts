/**
 * dtsx benchmark suite — dtsx vs oxc vs tsc (TypeScript 7), plus the dtsx JS SDK.
 *
 * Result keys: `zig-dtsx` is the native engine, published simply as "dtsx" (the dtsx
 * CLI and FFI binding). `dtsx` is the pure TypeScript SDK, published as "dtsx JS SDK"
 * and compared only with other JavaScript SDKs (see benchmark/render.ts).
 *
 * Section 1: In-process API, no cache — zig-dtsx (Bun FFI), dtsx (Bun), oxc-transform (N-API).
 *            Every dtsx cache is cleared on every iteration; this is the raw transform.
 * Section 2: In-process API, repeated build — dtsx's content-hash result cache on a
 *            warm watch/incremental rebuild. Only dtsx caches, so this section is
 *            reported separately and never used for head-to-head speedups.
 * Section 3: CLI, single file — every tool as a native executable via subprocess.
 * Section 4: CLI, multi-file project — every tool generating a whole directory.
 * Section 5: Bundled declarations — dtsx vs tsdown.
 *
 * Fairness rules:
 * - tsc has no in-process declaration API in TypeScript 7, so it only appears in CLI sections.
 * - Every CLI tool's output is verified after warmup; a tool that fails to emit aborts the run.
 * - dtsx and zig-dtsx run in their default (value-inferring) mode, which does more work than
 *   isolated-declarations-only emitters.
 *
 * Run: bun benchmark/index.ts [--json benchmark/results.json] [--skip-tsdown]
 */
import type { MachineInfo } from './tools'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bench, run, summary } from 'mitata'
import { isolatedDeclarationSync } from 'oxc-transform'
import { clearSourceFileCache } from '../packages/dtsx/src/extractor'
import { clearDeclarationCache } from '../packages/dtsx/src/extractor/extract'
import { clearResultCache, processSource } from '../packages/dtsx/src/generator'
import { clearProcessorCaches } from '../packages/dtsx/src/processor'
import { processSource as zigProcessSource } from '../packages/zig-dtsx/src/index'
import { dtsxExe, machineInfo, oxcCliEnv, oxcExe, tscExe, zigDtsxExe } from './tools'
import { runTsdownComparison, tsdownComparisonMarkdown } from './tsdown'

const argv = process.argv.slice(2)
const jsonIndex = argv.indexOf('--json')
const jsonPath = jsonIndex >= 0 ? (argv[jsonIndex + 1] ?? join(import.meta.dir, 'results.json')) : null
const skipTsdown = argv.includes('--skip-tsdown')

for (const [name, exe] of [['dtsx', dtsxExe], ['zig-dtsx', zigDtsxExe], ['oxc-emit', oxcExe], ['tsc', tscExe]] as const) {
  if (!existsSync(exe)) throw new Error(`${name} executable missing at ${exe}. Run \`bun run benchmark:prepare\` first.`)
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const fixtureDir = join(import.meta.dir, '..', 'packages', 'dtsx', 'test', 'fixtures', 'input')

const SMALL_SOURCE = `
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

export const VERSION: string = '1.0.0'
export const DEFAULT_PORT: number = 3000

export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

export type Callback<T> = (error: Error | null, result: T) => void
export type Middleware = (req: Request, res: Response, next: () => void) => void
`

interface Input { key: string, name: string, filename: string, source: string }

const inputs: Input[] = [
  { key: 'small', name: 'Small (~50 lines)', filename: 'small.ts', source: SMALL_SOURCE },
  { key: 'medium', name: 'Medium (~100 lines)', filename: 'generics.ts', source: readFileSync(join(fixtureDir, 'generics.ts'), 'utf-8') },
  { key: 'large', name: 'Large (~330 lines)', filename: 'ts-features.ts', source: readFileSync(join(fixtureDir, 'ts-features.ts'), 'utf-8') },
  { key: 'xlarge', name: 'XLarge (~1050 lines)', filename: 'react-like.ts', source: readFileSync(join(fixtureDir, 'real-world', 'react-like.ts'), 'utf-8') },
]

// ---------------------------------------------------------------------------
// In-process helpers
// ---------------------------------------------------------------------------

function dtsxNoCache(source: string, filename: string): string {
  clearResultCache()
  clearSourceFileCache()
  clearDeclarationCache()
  clearProcessorCaches()
  return processSource(source, filename, true, ['bun'], false)
}

function dtsxCached(source: string, filename: string): string {
  return processSource(source, filename, true, ['bun'], false)
}

function zigInProcess(source: string): string {
  return zigProcessSource(source, true, false)
}

function oxcInProcess(source: string, filename: string): string {
  return isolatedDeclarationSync(filename, source, { sourcemap: false }).code
}

// ---------------------------------------------------------------------------
// CLI helpers — all tools run as executables via subprocess
// ---------------------------------------------------------------------------

const cliBenchDir = join(tmpdir(), 'dtsx-bench-cli')
const cliOutDir = join(cliBenchDir, 'out')
rmSync(cliBenchDir, { recursive: true, force: true })
mkdirSync(cliOutDir, { recursive: true })
for (const { filename, source } of inputs) writeFileSync(join(cliBenchDir, filename), source)

// tsc's fastest declaration path: no type-check pass (--noCheck). --isolatedDeclarations
// is omitted because TypeScript 7 refuses to emit when any declaration needs inference,
// and the fixtures intentionally contain values that require it.
const tscFlags = ['--declaration', '--emitDeclarationOnly', '--noCheck', '--skipLibCheck', '--ignoreConfig', '--quiet']

const outFor = (tool: string, filename: string): string => join(cliOutDir, `${tool}-${filename.replace(/\.ts$/, '.d.ts')}`)

const cliTools: Record<string, (filename: string) => void> = {
  'zig-dtsx': filename => void spawnSync(zigDtsxExe, [join(cliBenchDir, filename), '-o', outFor('zig-dtsx', filename)], { stdio: 'pipe' }),
  'dtsx': filename => void spawnSync(dtsxExe, ['emit', join(cliBenchDir, filename), outFor('dtsx', filename)], { stdio: 'pipe' }),
  'oxc': filename => void spawnSync(oxcExe, [join(cliBenchDir, filename), outFor('oxc', filename)], { stdio: 'pipe', env: oxcCliEnv }),
  'tsc': (filename) => {
    // tsc derives the output name from the input; emit into a per-tool directory.
    spawnSync(tscExe, [...tscFlags, '--outDir', join(cliOutDir, 'tsc'), join(cliBenchDir, filename)], { stdio: 'pipe' })
  },
}

function cliOutput(tool: string, filename: string): string {
  return tool === 'tsc' ? join(cliOutDir, 'tsc', filename.replace(/\.ts$/, '.d.ts')) : outFor(tool, filename)
}

// ---------------------------------------------------------------------------
// Warmup + verification — every tool must really produce declarations
// ---------------------------------------------------------------------------

for (const { filename, source } of inputs) {
  const produced: Record<string, string> = {
    'dtsx': dtsxNoCache(source, filename),
    'zig-dtsx': zigInProcess(source),
    'oxc-transform': oxcInProcess(source, filename),
  }
  for (const [tool, run] of Object.entries(cliTools)) {
    rmSync(cliOutput(tool, filename), { force: true })
    run(filename)
    const out = cliOutput(tool, filename)
    produced[`${tool} (cli)`] = existsSync(out) ? readFileSync(out, 'utf8') : ''
  }
  for (const [tool, text] of Object.entries(produced)) {
    if (!text.includes('export') && !text.includes('declare'))
      throw new Error(`${tool} produced no declarations for ${filename}; refusing to time a failing tool`)
  }
}

// ---------------------------------------------------------------------------
// Section 1: In-process, no cache
// ---------------------------------------------------------------------------

for (const { name, filename, source } of inputs) {
  summary(() => {
    bench(`inproc:zig-dtsx:${name}`, () => zigInProcess(source))
    bench(`inproc:dtsx:${name}`, () => dtsxNoCache(source, filename))
    bench(`inproc:oxc-transform:${name}`, () => oxcInProcess(source, filename))
  })
}

// ---------------------------------------------------------------------------
// Section 2: dtsx repeated build (content-hash cache hit)
// ---------------------------------------------------------------------------

for (const { name, filename, source } of inputs) {
  dtsxCached(source, filename)
  bench(`cached:dtsx:${name}`, () => dtsxCached(source, filename))
}

// ---------------------------------------------------------------------------
// Section 3: CLI, single file
// ---------------------------------------------------------------------------

for (const { name, filename } of inputs) {
  summary(() => {
    for (const [tool, run] of Object.entries(cliTools))
      bench(`cli:${tool}:${name}`, () => run(filename))
  })
}

// ---------------------------------------------------------------------------
// Section 4: multi-file project
// ---------------------------------------------------------------------------

const projectSizes = [50, 100, 500]
const templates = inputs.map(i => i.source)

interface Project { name: string, count: number, dir: string, files: string[] }

const projects: Project[] = projectSizes.map((count) => {
  const dir = join(tmpdir(), `dtsx-bench-project-${count}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (let i = 0; i < count; i++) {
    const filepath = join(dir, `mod_${String(i).padStart(4, '0')}.ts`)
    writeFileSync(filepath, `// Module ${i}\nexport const __mod${i}_id: number = ${i}\n\n${templates[i % templates.length]}`)
    files.push(filepath)
  }
  return { name: `${count} files`, count, dir, files }
})

function projectOut(p: Project, tool: string): string {
  return join(tmpdir(), `dtsx-bench-out-${p.count}-${tool}`)
}

const projectTools: Record<string, (p: Project) => void> = {
  'zig-dtsx': p => void spawnSync(zigDtsxExe, ['--project', p.dir, '--outdir', projectOut(p, 'zig-dtsx')], { stdio: 'pipe' }),
  'dtsx': p => void spawnSync(dtsxExe, ['--project', p.dir, '--outdir', projectOut(p, 'dtsx')], { stdio: 'pipe' }),
  'oxc': p => void spawnSync(oxcExe, ['--project', p.dir, '--outdir', projectOut(p, 'oxc')], { stdio: 'pipe', env: oxcCliEnv }),
  'tsc': p => void spawnSync(tscExe, [...tscFlags, '--outDir', projectOut(p, 'tsc'), ...p.files], { stdio: 'pipe' }),
}

function resetOut(p: Project, tool: string): void {
  const out = projectOut(p, tool)
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
}

for (const p of projects) {
  for (const [tool, run] of Object.entries(projectTools)) {
    resetOut(p, tool)
    run(p)
    const out = projectOut(p, tool)
    const emitted = readdirSync(out).filter(f => f.endsWith('.d.ts') && statSync(join(out, f)).size > 0).length
    if (emitted !== p.count) throw new Error(`${tool} emitted ${emitted}/${p.count} declaration files for ${p.name}`)
  }
}

for (const p of projects) {
  summary(() => {
    for (const [tool, run] of Object.entries(projectTools)) {
      // Output directories are recreated outside timing would be ideal, but mitata
      // has no per-iteration setup hook; every tool pays the same rm+mkdir cost.
      bench(`project:${tool}:${p.name}`, () => {
        resetOut(p, tool)
        run(p)
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const machine: MachineInfo = machineInfo()
console.log(`\n${machine.cpu} (${machine.model}), ${machine.cores} cores, ${machine.memoryGB} GB, ${machine.os}, Bun ${machine.bun}\n`)

const result = await run()
const tsdown = skipTsdown ? null : await runTsdownComparison()
if (tsdown) console.log(tsdownComparisonMarkdown(tsdown))

if (jsonPath) {
  const rows = result.benchmarks.map((b: any) => {
    const [section, tool, ...rest] = String(b.alias).split(':')
    const stats = b.runs[0].stats
    return { section, tool, input: rest.join(':'), avgNs: stats.avg, p50Ns: stats.p50, minNs: stats.min, maxNs: stats.max, samples: stats.samples.length }
  })
  writeFileSync(jsonPath, `${JSON.stringify({
    date: new Date().toISOString().slice(0, 10),
    machine,
    inputs: inputs.map(({ key, name, filename }) => ({ key, name, filename })),
    projects: projectSizes,
    rows,
    tsdown,
  }, null, 2)}\n`)
  console.log(`Wrote ${jsonPath}`)
}
