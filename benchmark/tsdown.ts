/** Matched, fresh bundled declaration builds; compiler and correctness checks are outside timing. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { build, version as tsdownVersion } from 'tsdown'
import { clearSourceFileCache } from '../packages/dtsx/src/extractor'
import { clearDeclarationCache } from '../packages/dtsx/src/extractor/extract'
import { clearResultCache, generate } from '../packages/dtsx/src/generator'
import { clearProcessorCaches } from '../packages/dtsx/src/processor'

export interface BundledBuildTiming {
  tool: string
  files: number
  iterations: number
  avgMs: number
  minMs: number
  maxMs: number
  outputSha256: string
}

export interface BundledComparison {
  bun: string
  tsdown: string
  typescript: string
  mode: string
  results: BundledBuildTiming[]
}

async function compile(cwd: string, project: string): Promise<{ code: number, output: string }> {
  const pkg = Bun.resolveSync('typescript/package.json', import.meta.dir)
  const child = Bun.spawn([process.execPath, join(dirname(pkg), 'lib/tsc.js'), '--noEmit', '--project', project], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 30000 })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, output: stdout + stderr }
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export async function runTsdownComparison(options: { counts?: number[], iterations?: number, warmup?: number } = {}): Promise<BundledComparison> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dtsx-tsdown-benchmark-')))
  const results: BundledBuildTiming[] = []
  const iterations = options.iterations ?? 5
  const warmup = options.warmup ?? 1
  assert(Number.isInteger(iterations) && iterations > 0, 'Benchmark iterations must be a positive integer')
  assert(Number.isInteger(warmup) && warmup >= 0, 'Benchmark warmup must be a nonnegative integer')
  const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, types: [], paths: {} }
  try {
    for (const count of options.counts ?? [1, 10, 100]) {
      assert(Number.isInteger(count) && count > 0, 'Project sizes must be positive integers')
      const cwd = join(directory, `project-${count}`)
      await mkdir(join(cwd, 'src'), { recursive: true })
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'bundled-declaration-benchmark', type: 'module' }))
      const exports: string[] = []
      for (let index = 0; index < count; index++) {
        await writeFile(join(cwd, `src/item${index}.ts`), `export interface Item${index} { value: number }; export function create${index}(): Item${index} { return { value: ${index} } }`)
        exports.push(`export { create${index}, type Item${index} } from './item${index}.js'`)
      }
      await writeFile(join(cwd, 'src/index.ts'), exports.join('\n'))
      await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions, include: ['src'] }))
      const authored = await compile(cwd, 'tsconfig.json')
      assert(authored.code === 0, `Benchmark source is invalid: ${authored.output}`)
      for (const tool of ['dtsx', 'tsdown'] as const) {
        const outdir = join(cwd, tool)
        const output = join(outdir, 'index.d.mts')
        const times: number[] = []
        let declaration = ''
        for (let iteration = -warmup; iteration < iterations; iteration++) {
          await rm(outdir, { recursive: true, force: true })
          if (tool === 'dtsx') {
            clearResultCache()
            clearSourceFileCache()
            clearDeclarationCache()
            clearProcessorCaches()
          }
          const start = performance.now()
          if (tool === 'dtsx') {
            const stats = await generate({ cwd, root: 'src', entrypoints: ['index.ts'], outdir, bundle: true, bundleOutput: 'index.d.mts', moduleSpecifierMode: 'node', incremental: false })
            assert(stats.filesFailed === 0, 'DTSX benchmark generation failed')
          }
          else {
            const handle = await build({ cwd, config: false, entry: ['src/index.ts'], outDir: outdir, format: 'esm', fixedExtension: true, dts: { emitDtsOnly: true }, logLevel: 'silent', report: false })
            for (const bundle of handle.bundles) await bundle[Symbol.asyncDispose]()
          }
          const elapsed = performance.now() - start
          declaration = await readFile(output, 'utf8')
          for (let index = 0; index < count; index++) assert(declaration.includes(`create${index}`), `${tool} omitted entry export create${index}`)
          if (iteration >= 0) times.push(elapsed)
        }
        // Every sample must emit fresh files; strict positive/negative consumers
        // additionally qualify each tool before any timings are reported.
        const imports = Array.from({ length: count }, (_, index) => `create${index}, type Item${index}`).join(', ')
        const assertions = Array.from({ length: count }, (_, index) => `const item${index}: Item${index} = create${index}(); const n${index}: number = item${index}.value;`).join('\n')
        await writeFile(join(cwd, 'positive.mts'), `import { ${imports} } from './${tool}/index.mjs';\n${assertions}`)
        await writeFile(join(cwd, 'negative.mts'), `import { create0 } from './${tool}/index.mjs'; const wrong: string = create0().value;`)
        await writeFile(join(cwd, 'tsconfig.controls.json'), JSON.stringify({ compilerOptions, files: ['positive.mts', 'negative.mts'] }))
        const checked = await compile(cwd, 'tsconfig.controls.json')
        assert(checked.code !== 0 && checked.output.match(/error TS\d+/g)?.join(',') === 'error TS2322'
          && /negative\.mts\(\d+,\d+\): error TS2322/.test(checked.output), `${tool} failed strict benchmark controls: ${checked.output}`)
        results.push({ tool, files: count + 1, iterations, avgMs: times.reduce((sum, time) => sum + time, 0) / times.length, minMs: Math.min(...times), maxMs: Math.max(...times), outputSha256: createHash('sha256').update(declaration).digest('hex') })
      }
    }
    const typescript = JSON.parse(await readFile(Bun.resolveSync('typescript/package.json', import.meta.dir), 'utf8')).version
    return { bun: Bun.version, tsdown: tsdownVersion, typescript, mode: 'Fresh bundled declaration-only project builds; DTSX caches cleared. Both include graph discovery, declaration emission and writes. tsdown also runs its bundling pipeline. Source and strict positive/exact TS2322 controls run outside timing.', results }
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export function tsdownComparisonMarkdown(comparison: BundledComparison): string {
  return `### Bundled declarations: DTSX and tsdown\n\n${comparison.mode}\n\nBun ${comparison.bun}; tsdown ${comparison.tsdown}; TypeScript ${comparison.typescript}.\n\n| Tool | Source files | Samples | Average | Min | Max |\n| --- | --- | --- | --- | --- | --- |\n${comparison.results.map(row => `| ${row.tool} | ${row.files} | ${row.iterations} | ${row.avgMs.toFixed(2)} ms | ${row.minMs.toFixed(2)} ms | ${row.maxMs.toFixed(2)} ms |`).join('\n')}\n\n`
}

if (import.meta.main) {
  const comparison = await runTsdownComparison()
  console.log(tsdownComparisonMarkdown(comparison))
  const index = process.argv.indexOf('--output')
  if (index >= 0) {
    assert(process.argv[index + 1], '--output requires a filename')
    await writeFile(process.argv[index + 1], JSON.stringify(comparison, null, 2))
  }
}
