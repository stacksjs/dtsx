/**
 * Render benchmark/results.json (from `bun benchmark/index.ts --json`) into the
 * README benchmark section and the website's docs/benchmarks.md page, so both
 * always show the same measured numbers and the machine they came from.
 *
 * Run: bun benchmark/render.ts [results.json]
 */
import type { BundledComparison } from './tsdown'
import type { MachineInfo } from './tools'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Row { section: string, tool: string, input: string, avgNs: number, p50Ns: number, minNs: number, maxNs: number, samples: number }
interface Results {
  date: string
  runs?: number
  loadAverage?: Array<{ start: number, end: number }>
  machine: MachineInfo
  inputs: Array<{ key: string, name: string, filename: string }>
  projects: number[]
  rows: Row[]
  tsdown: BundledComparison | null
}

const root = join(import.meta.dir, '..')
const resultsPath = process.argv[2] ?? join(import.meta.dir, 'results.json')
const results: Results = JSON.parse(readFileSync(resultsPath, 'utf8'))

function fmt(ns: number): string {
  if (ns < 1e3) return `${ns.toFixed(0)} ns`
  if (ns < 1e6) return `${(ns / 1e3).toFixed(2)} µs`
  if (ns < 1e9) return `${(ns / 1e6).toFixed(2)} ms`
  return `${(ns / 1e9).toFixed(2)} s`
}

function ratio(value: number, best: number): string {
  const r = value / best
  return r >= 10 ? `${r.toFixed(0)}x` : r >= 2 ? `${r.toFixed(1)}x` : `${r.toFixed(2)}x`
}

/** One comparison table: rows are tools, columns are inputs; fastest per column in bold. */
function table(section: string, tools: Array<{ key: string, label: string }>, columns: Array<{ key: string, label: string }>): string {
  const lookup = (tool: string, input: string): number | undefined =>
    results.rows.find(r => r.section === section && r.tool === tool && r.input === input)?.avgNs
  const best = columns.map(c => Math.min(...tools.map(t => lookup(t.key, c.key) ?? Infinity)))
  // Order rows by their average rank so the overall winner leads the table.
  const rank = (tool: string): number => columns.reduce((sum, c, i) => sum + (lookup(tool, c.key) ?? Infinity) / best[i], 0)
  const ordered = [...tools].sort((a, b) => rank(a.key) - rank(b.key))
  const header = `| Tool | ${columns.map(c => c.label).join(' | ')} |\n|------|${columns.map(() => '------').join('|')}|`
  const body = ordered.map((t) => {
    const cells = columns.map((c, i) => {
      const v = lookup(t.key, c.key)
      if (v === undefined) return '—'
      return v === best[i] ? `**${fmt(v)}**` : `${fmt(v)} _(${ratio(v, best[i])})_`
    })
    const label = cells.every(cell => cell.startsWith('**')) ? `**${t.label}**` : t.label
    return `| ${label} | ${cells.join(' | ')} |`
  })
  return [header, ...body].join('\n')
}

const m = results.machine
const cores = m.performanceCores && m.efficiencyCores
  ? `${m.cores}-core CPU (${m.performanceCores} performance + ${m.efficiencyCores} efficiency)`
  : `${m.cores}-core CPU`
const machineLine = `${m.cpu}${m.model ? ` (\`${m.model}\`)` : ''}, ${cores}, ${m.memoryGB} GB RAM, ${m.os} (${m.arch})`
const loads = (results.loadAverage ?? []).flatMap(l => [l.start, l.end])
const runLine = results.runs && results.runs > 1
  ? `Each time is the median of ${results.runs} full runs${loads.length ? `; the 1-minute load average ranged ${Math.min(...loads).toFixed(1)}–${Math.max(...loads).toFixed(1)} during measurement` : ''}.`
  : loads.length ? `The 1-minute load average ranged ${Math.min(...loads).toFixed(1)}–${Math.max(...loads).toFixed(1)} during measurement.` : ''
const sourceLine = m.commit ? `dtsx ${m.versions.dtsx} at [\`${m.commit}\`](https://github.com/stacksjs/dtsx/commit/${m.commit.replace(/-dirty$/, '')})` : `dtsx ${m.versions.dtsx}`
const versionLine = `${sourceLine} · Bun ${m.bun} · Zig ${m.versions.zig} · oxc-transform ${m.versions['oxc-transform']} · TypeScript ${m.versions.typescript} (native \`tsc\`) · tsdown ${m.versions.tsdown}`

const inputColumns = results.inputs.map(i => ({ key: i.name, label: i.name }))
const projectColumns = results.projects.map(n => ({ key: `${n} files`, label: `${n} files` }))

// Headline tables: dtsx is the native engine (the dtsx CLI and the FFI binding).
const inProcess = table('inproc', [
  { key: 'zig-dtsx', label: 'dtsx' },
  { key: 'oxc-transform', label: 'oxc-transform' },
], inputColumns)

const cli = table('cli', [
  { key: 'zig-dtsx', label: 'dtsx' },
  { key: 'oxc', label: 'oxc' },
  { key: 'tsc', label: 'tsc 7' },
], inputColumns)

const project = table('project', [
  { key: 'zig-dtsx', label: 'dtsx' },
  { key: 'oxc', label: 'oxc' },
  { key: 'tsc', label: 'tsc 7' },
], projectColumns)

// JavaScript SDK tables: dtsx's TypeScript SDK against other JavaScript SDKs.
const sdkInProcess = table('inproc', [
  { key: 'dtsx', label: 'dtsx JS SDK' },
  { key: 'oxc-transform', label: 'oxc-transform' },
], inputColumns)

const cachedCells = results.inputs.map(i => fmt(results.rows.find(r => r.section === 'cached' && r.input === i.name)?.avgNs ?? Number.NaN))
const cached = `| | ${inputColumns.map(c => c.label).join(' | ')} |\n|---|${inputColumns.map(() => '---').join('|')}|\n| dtsx JS SDK (warm cache hit) | ${cachedCells.join(' | ')} |`

const bundled = results.tsdown
  ? `| Tool | ${[...new Set(results.tsdown.results.map(r => r.files))].map(n => `${n} source files`).join(' | ')} |\n|------|${[...new Set(results.tsdown.results.map(r => r.files))].map(() => '------').join('|')}|\n${['dtsx', 'tsdown'].map((tool) => {
    const cells = [...new Set(results.tsdown!.results.map(r => r.files))].map((files) => {
      const row = results.tsdown!.results.find(r => r.tool === tool && r.files === files)!
      const best = Math.min(...results.tsdown!.results.filter(r => r.files === files).map(r => r.avgMs))
      return row.avgMs === best ? `**${row.avgMs.toFixed(2)} ms**` : `${row.avgMs.toFixed(2)} ms _(${(row.avgMs / best).toFixed(1)}x)_`
    })
    const name = tool === 'dtsx' ? 'dtsx JS SDK' : 'tsdown JS SDK'
    return `| ${cells.every(cell => cell.startsWith('**')) ? `**${name}**` : name} | ${cells.join(' | ')} |`
  }).join('\n')}`
  : '_Not measured in this run._'

function body(level: '##' | '#'): string {
  const h2 = level === '#' ? '##' : '###'
  const h3 = `${h2}#`
  return `Measured on **${machineLine}** — ${results.date}.
${versionLine}.${runLine ? `\n${runLine}` : ''}

Reproduce with \`bun run benchmark:prepare && bun run benchmark:publish\`. Raw numbers live in [\`benchmark/results.json\`](https://github.com/stacksjs/dtsx/blob/main/benchmark/results.json).

${h2} How the comparison is kept fair

- Every tool emits real declarations for the same inputs; the harness verifies each tool's output before timing and aborts if any tool fails, so no row can time a crash.
- dtsx runs in its default value-inferring mode (narrow types and \`@defaultValue\` JSDoc), which does more work than isolated-declarations-only emitters.
- \`tsc\` is TypeScript 7's native Go compiler, run directly (no Node launcher) with \`--noCheck\`, its fastest declaration path. It has no in-process API, so it only appears in the CLI tables.
- oxc has no declaration CLI, so its CLI rows run a minimal Bun-compiled wrapper around \`oxc-transform\` (\`bun build --compile --splitting --bytecode\`).
- "No cache" means every dtsx cache is cleared on every iteration. The warm-cache table is reported separately and never used for comparisons.
- Times are means from [mitata](https://github.com/evanwashere/mitata); lower is better. **Bold** marks the fastest tool per column.

${h2} In-process API (no cache)

_One file transformed in the same process: dtsx through its native binding, oxc-transform through N-API._

${inProcess}

${h2} CLI: single file

_Each tool runs as an executable via subprocess, so process startup is included._

${cli}

${h2} CLI: multi-file project

_A whole directory of generated modules. dtsx and tsc use multiple threads; the oxc wrapper processes files sequentially because oxc ships no parallel declaration CLI._

${project}

${h2} JavaScript SDK

_The \`@stacksjs/dtsx\` SDK, which powers the bundler and build-tool plugins, called in-process like any other JavaScript SDK._

${h3} JS SDK: in-process, no cache

${sdkInProcess}

${h3} JS SDK: bundled declarations vs tsdown

_Fresh builds of the same project, checked by strict positive and negative consumer type-checks outside timing._

${bundled}

${h3} JS SDK: watch mode and incremental rebuilds

_The SDK's content-hash cache returns an unchanged file's declarations without re-scanning. No other tool here caches, so this is for reference only._

${cached}`
}

const readmeSection = `<!-- benchmarks:start -->\n\n## Benchmarks\n\n${body('##')}\n\n<!-- benchmarks:end -->`
const readmePath = join(root, 'README.md')
const readme = readFileSync(readmePath, 'utf8')
const start = readme.indexOf('<!-- benchmarks:start -->')
const end = readme.indexOf('<!-- benchmarks:end -->')
let nextReadme: string
if (start >= 0 && end > start) {
  nextReadme = readme.slice(0, start) + readmeSection + readme.slice(end + '<!-- benchmarks:end -->'.length)
}
else {
  // First render: replace the hand-written section up to the binary size table.
  const legacyStart = readme.indexOf('## Benchmarks')
  const legacyEnd = readme.indexOf('### Binary Size')
  if (legacyStart < 0 || legacyEnd < legacyStart) throw new Error('README has no benchmark section to replace')
  nextReadme = `${readme.slice(0, legacyStart)}${readmeSection}\n\n${readme.slice(legacyEnd)}`
}
writeFileSync(readmePath, nextReadme)

/** Replace a generated block (or, the first time, a legacy hand-written range). */
function replaceBlock(path: string, block: string, legacyStart: string, legacyEnd: string): void {
  const text = readFileSync(path, 'utf8')
  const open = text.indexOf('<!-- benchmarks:start -->')
  const close = text.indexOf('<!-- benchmarks:end -->')
  if (open >= 0 && close > open) {
    writeFileSync(path, text.slice(0, open) + block + text.slice(close + '<!-- benchmarks:end -->'.length))
    return
  }
  const from = text.indexOf(legacyStart)
  const to = text.indexOf(legacyEnd, from)
  if (from < 0 || to < from) throw new Error(`${path} has no benchmark section to replace`)
  writeFileSync(path, `${text.slice(0, from)}${block}\n\n${text.slice(to)}`)
}

const introSummary = `<!-- benchmarks:start -->

## Benchmarks

Measured on ${machineLine} (${results.date}, Bun ${m.bun}). See [Benchmarks](/benchmarks) for methodology and the JavaScript SDK comparison, including bundled builds and watch mode.

### In-process API (no cache)

${inProcess}

### CLI: single file

${cli}

### CLI: multi-file project

${project}

<!-- benchmarks:end -->`
replaceBlock(join(root, 'docs', 'intro.md'), introSummary, '## Benchmarks', '### Binary Size')

const page = `---
title: Benchmarks
description: Measured dtsx performance against oxc, tsc 7 and tsdown.
---

<!-- Generated by benchmark/render.ts from benchmark/results.json. Do not edit by hand. -->

# Benchmarks

${body('#')}
`
writeFileSync(join(root, 'docs', 'benchmarks.md'), page)
console.log('Updated README.md, docs/intro.md and docs/benchmarks.md')
