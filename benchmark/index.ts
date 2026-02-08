/**
 * dtsx benchmark suite — compares dtsx vs oxc-transform vs tsc
 *
 * Run: bun benchmark/index.ts
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bench, run, summary } from 'mitata'
import { isolatedDeclarationSync } from 'oxc-transform'
import ts from 'typescript'
import { processSource } from '../packages/dtsx/src/generator'

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
// Warmup — ensure JIT / caches are warm before measuring
// ---------------------------------------------------------------------------

for (const { filename, source } of inputs) {
  processSource(source, filename)
  isolatedDeclarationSync(filename, source, { sourcemap: false })
  tscGenerate(source, filename)
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

for (const { name, filename, source } of inputs) {
  summary(() => {
    bench(`dtsx — ${name}`, () => {
      processSource(source, filename)
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
// Run
// ---------------------------------------------------------------------------

await run()
