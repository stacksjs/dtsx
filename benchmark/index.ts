/**
 * dtsx benchmark suite — compares dtsx vs oxc-transform vs tsc vs tsgo
 *
 * Section 1: In-process API benchmark — cached (dtsx, oxc-transform, tsc)
 *            dtsx uses smart caching (hash check + cache hit) which is how it
 *            actually runs in watch mode, incremental builds, and CI pipelines.
 * Section 2: In-process API benchmark — no cache (dtsx, oxc-transform, tsc)
 *            Cache cleared every iteration for raw single-transform comparison.
 * Section 3: CLI benchmark (dtsx vs oxc vs tsc vs tsgo) — compiled binaries
 * Section 4: Multi-file project benchmarks (dtsx vs oxc vs tsc vs tsgo)
 *
 * Run: bun benchmark/index.ts
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, tmpdir } from 'node:os'
import { join } from 'node:path'
import { bench, run, summary } from 'mitata'
import { isolatedDeclarationSync } from 'oxc-transform'
import ts from 'typescript'
import { clearSourceFileCache } from '../packages/dtsx/src/extractor'
import { clearDeclarationCache } from '../packages/dtsx/src/extractor/extract'
import { processSource } from '../packages/dtsx/src/generator'
import { clearProcessorCaches } from '../packages/dtsx/src/processor'

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

const inputs: Array<{ name: string, filename: string, source: string }> = [
  {
    name: 'small (~50 lines)',
    filename: 'small.ts',
    source: SMALL_SOURCE,
  },
  {
    name: 'medium (~100 lines)',
    filename: 'generics.ts',
    source: readFileSync(join(fixtureDir, 'generics.ts'), 'utf-8'),
  },
  {
    name: 'large (~330 lines)',
    filename: 'ts-features.ts',
    source: readFileSync(join(fixtureDir, 'ts-features.ts'), 'utf-8'),
  },
  {
    name: 'xlarge (~1050 lines)',
    filename: 'react-like.ts',
    source: readFileSync(join(fixtureDir, 'real-world', 'react-like.ts'), 'utf-8'),
  },
]

// ---------------------------------------------------------------------------
// tsc helper — uses ts.transpileDeclaration (TS 5.5+)
// ---------------------------------------------------------------------------

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
  const result = ts.transpileDeclaration(source, {
    ...tscOptions,
    fileName: filename,
  })
  return result.outputText
}

// ---------------------------------------------------------------------------
// CLI helpers — all tools run as compiled native binaries via subprocess
// ---------------------------------------------------------------------------

const dtsxExe = join(import.meta.dir, '..', 'packages', 'dtsx', 'bin', 'dtsx')
const oxcExe = join(import.meta.dir, 'oxc-emit')

const tsgoExe = join(
  import.meta.dir,
  '..',
  'node_modules',
  `@typescript/native-preview-${platform()}-${arch()}`,
  'lib',
  platform() === 'win32' ? 'tsgo.exe' : 'tsgo',
)

const tscExe = join(import.meta.dir, '..', 'node_modules', '.bin', 'tsc')

const cliBenchDir = join(tmpdir(), 'dtsx-bench-cli')
const cliOutDir = join(cliBenchDir, 'out')
mkdirSync(cliOutDir, { recursive: true })

// Pre-write input files to disk for CLI benchmarks
for (const { filename, source } of inputs) {
  writeFileSync(join(cliBenchDir, filename), source)
}

const cliFlags = [
  '--declaration',
  '--emitDeclarationOnly',
  '--isolatedDeclarations',
  '--skipLibCheck',
  '--outDir',
  cliOutDir,
]

function dtsxGenerateCLI(filename: string): void {
  spawnSync(dtsxExe, ['emit', join(cliBenchDir, filename), join(cliOutDir, filename.replace(/\.ts$/, '.d.ts'))], { stdio: 'pipe' })
}

function oxcGenerateCLI(filename: string): void {
  spawnSync(oxcExe, [join(cliBenchDir, filename), join(cliOutDir, filename.replace(/\.ts$/, '.d.ts'))], { stdio: 'pipe' })
}

function tsgoGenerateCLI(filename: string): void {
  spawnSync(tsgoExe, [
    ...cliFlags,
    '--ignoreConfig',
    '--quiet',
    join(cliBenchDir, filename),
  ], { stdio: 'pipe' })
}

function tscGenerateCLI(filename: string): void {
  spawnSync(tscExe, [
    ...cliFlags,
    '--noEmit',
    'false',
    join(cliBenchDir, filename),
  ], { stdio: 'pipe' })
}

// ---------------------------------------------------------------------------
// Warmup — ensure JIT / caches are warm before measuring
// ---------------------------------------------------------------------------

for (const { filename, source } of inputs) {
  processSource(source, filename, true, ['bun'], true)
  isolatedDeclarationSync(filename, source, { sourcemap: false })
  tscGenerate(source, filename)
  dtsxGenerateCLI(filename)
  oxcGenerateCLI(filename)
  tsgoGenerateCLI(filename)
  tscGenerateCLI(filename)
}

// ---------------------------------------------------------------------------
// Section 1: In-process API benchmarks — cached (dtsx vs oxc-transform vs tsc)
//   dtsx caches parsed SourceFiles and extracted declarations. This reflects
//   real-world performance in watch mode, incremental rebuilds, and CI where
//   the same files are processed repeatedly.
// ---------------------------------------------------------------------------

for (const { name, filename, source } of inputs) {
  summary(() => {
    bench(`dtsx (cached) — ${name}`, () => {
      processSource(source, filename, true, ['bun'], true)
    })

    bench(`oxc-transform — ${name}`, () => {
      isolatedDeclarationSync(filename, source, { sourcemap: false })
    })

    bench(`tsc — ${name}`, () => {
      tscGenerate(source, filename)
    })
  })
}

// ---------------------------------------------------------------------------
// Section 2: In-process API benchmarks — no cache (dtsx vs oxc-transform vs tsc)
//   Cache is cleared every iteration so each run does a full parse + transform.
//   This is the raw single-file transform speed comparison.
// ---------------------------------------------------------------------------

for (const { name, filename, source } of inputs) {
  summary(() => {
    bench(`dtsx (no-cache) — ${name}`, () => {
      clearSourceFileCache()
      clearDeclarationCache()
      clearProcessorCaches()
      processSource(source, filename, true, ['bun'], true)
    })

    bench(`oxc-transform — ${name}`, () => {
      isolatedDeclarationSync(filename, source, { sourcemap: false })
    })

    bench(`tsc — ${name}`, () => {
      tscGenerate(source, filename)
    })
  })
}

// ---------------------------------------------------------------------------
// Section 3: CLI benchmarks (dtsx vs oxc vs tsc vs tsgo — compiled binaries)
//   All tools run as compiled native binaries via subprocess.
//   dtsx is compiled via `bun build --compile --bytecode` (Zig/JSC AOT bytecode),
//   oxc-emit is compiled the same way wrapping oxc-transform (Rust NAPI),
//   tsgo is native Go, tsc is Node.js.
// ---------------------------------------------------------------------------

for (const { name, filename } of inputs) {
  summary(() => {
    bench(`dtsx (cli) — ${name}`, () => {
      dtsxGenerateCLI(filename)
    })

    bench(`oxc (cli) — ${name}`, () => {
      oxcGenerateCLI(filename)
    })

    bench(`tsc (cli) — ${name}`, () => {
      tscGenerateCLI(filename)
    })

    bench(`tsgo (cli) — ${name}`, () => {
      tsgoGenerateCLI(filename)
    })
  })
}

// ---------------------------------------------------------------------------
// Section 4: Multi-file project benchmarks (dtsx vs oxc vs tsc vs tsgo)
//   Real-world scenario: generate .d.ts for an entire project.
//   dtsx uses parallel processing + caching. This is where dtsx shines —
//   it's a purpose-built .d.ts generator, not just a single-file transformer.
// ---------------------------------------------------------------------------

const concurrency = Math.max(1, cpus().length - 1)
const projectSizes = [50, 100, 500]
const templates = inputs.map(i => i.source)

// Generate multi-file projects — each file gets unique export names
function generateProject(dir: string, count: number): string[] {
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (let i = 0; i < count; i++) {
    const template = templates[i % templates.length]
    const filename = `mod_${String(i).padStart(4, '0')}.ts`
    const filepath = join(dir, filename)
    // Make exports unique per file by adding a prefix comment + unique const
    const uniqueSource = `// Module ${i}\nexport const __mod${i}_id: number = ${i}\n\n${template}`
    writeFileSync(filepath, uniqueSource)
    files.push(filepath)
  }
  return files
}

interface ProjectBench {
  name: string
  count: number
  dir: string
  outDirDtsx: string
  outDirOxc: string
  outDirTsgo: string
  outDirTsc: string
  files: string[]
}

const projects: ProjectBench[] = projectSizes.map((count) => {
  const dir = join(tmpdir(), `dtsx-bench-project-${count}`)
  const outDirDtsx = join(dir, 'out-dtsx')
  const outDirOxc = join(dir, 'out-oxc')
  const outDirTsgo = join(dir, 'out-tsgo')
  const outDirTsc = join(dir, 'out-tsc')
  mkdirSync(outDirDtsx, { recursive: true })
  mkdirSync(outDirOxc, { recursive: true })
  mkdirSync(outDirTsgo, { recursive: true })
  mkdirSync(outDirTsc, { recursive: true })
  const files = generateProject(dir, count)
  return {
    name: `${count} files`,
    count,
    dir,
    outDirDtsx,
    outDirOxc,
    outDirTsgo,
    outDirTsc,
    files,
  }
})

function dtsxGenerateProject(p: ProjectBench): void {
  // Clean output dir between runs for fair comparison
  rmSync(p.outDirDtsx, { recursive: true, force: true })
  mkdirSync(p.outDirDtsx, { recursive: true })
  spawnSync(dtsxExe, [
    '--project',
    p.dir,
    '--outdir',
    p.outDirDtsx,
  ], { stdio: 'pipe' })
}

function oxcGenerateProject(p: ProjectBench): void {
  rmSync(p.outDirOxc, { recursive: true, force: true })
  mkdirSync(p.outDirOxc, { recursive: true })
  spawnSync(oxcExe, [
    '--project',
    p.dir,
    '--outdir',
    p.outDirOxc,
  ], { stdio: 'pipe' })
}

function tsgoGenerateProject(p: ProjectBench): void {
  rmSync(p.outDirTsgo, { recursive: true, force: true })
  mkdirSync(p.outDirTsgo, { recursive: true })
  spawnSync(tsgoExe, [
    '--declaration',
    '--emitDeclarationOnly',
    '--isolatedDeclarations',
    '--skipLibCheck',
    '--ignoreConfig',
    '--quiet',
    '--outDir',
    p.outDirTsgo,
    ...p.files,
  ], { stdio: 'pipe' })
}

function tscGenerateProject(p: ProjectBench): void {
  rmSync(p.outDirTsc, { recursive: true, force: true })
  mkdirSync(p.outDirTsc, { recursive: true })
  spawnSync(tscExe, [
    '--declaration',
    '--emitDeclarationOnly',
    '--isolatedDeclarations',
    '--skipLibCheck',
    '--noEmit',
    'false',
    '--outDir',
    p.outDirTsc,
    ...p.files,
  ], { stdio: 'pipe' })
}

// Warmup for multi-file benchmarks
for (const p of projects) {
  dtsxGenerateProject(p)
  oxcGenerateProject(p)
  tsgoGenerateProject(p)
  tscGenerateProject(p)
}

for (const p of projects) {
  summary(() => {
    bench(`dtsx (project) — ${p.name}`, () => {
      dtsxGenerateProject(p)
    })

    bench(`oxc (project) — ${p.name}`, () => {
      oxcGenerateProject(p)
    })

    bench(`tsc (project) — ${p.name}`, () => {
      tscGenerateProject(p)
    })

    bench(`tsgo (project) — ${p.name}`, () => {
      tsgoGenerateProject(p)
    })
  })
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await run()
