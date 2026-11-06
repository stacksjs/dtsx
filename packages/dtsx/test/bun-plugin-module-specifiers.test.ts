import type { PluginConfig } from '../../bun-plugin/src'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { dts as coreDts } from '../src/plugins/bun'
import { isAvailable, runTsc } from './helpers/tsc'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function createLibrary(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-bun-module-specifiers-'))
  directories.push(cwd)
  await mkdir(join(cwd, 'src/detail'), { recursive: true })
  await writeFile(join(cwd, 'package.json'), JSON.stringify({
    name: 'bun-adapter-node-library',
    version: '1.0.0',
    type: 'module',
    files: ['dist'],
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
  }))
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
  await writeFile(join(cwd, 'src/index.ts'), `export { normalize } from './normalize'\nexport type { Options } from './options'\nexport type { Metadata } from './detail'\n`)
  await writeFile(join(cwd, 'src/normalize.ts'), `import type { Options } from './options'\nexport function normalize(value: Options): number { return value.scale }\n`)
  await writeFile(join(cwd, 'src/options.ts'), 'export interface Options { scale: number }')
  await writeFile(join(cwd, 'src/detail/index.ts'), 'export interface Metadata { name: string }')
  return cwd
}

async function buildLibrary(cwd: string, target?: 'bun' | 'browser' | 'node', options: PluginConfig = {}, adapter: 'separate' | 'core' = 'separate') {
  const modes: Array<PluginConfig['moduleSpecifierMode']> = []
  const config = { cwd, root: './src', outdir: './dist', ...options }
  const result = await Bun.build({
    entrypoints: [join(cwd, 'src/index.ts')],
    outdir: join(cwd, 'dist'),
    format: 'esm',
    ...(target ? { target } : {}),
    plugins: [adapter === 'core' ? coreDts(config) : dts({
      ...config,
      on: {
        start(event) {
          if (event.data.type === 'start') modes.push(event.data.config.moduleSpecifierMode)
        },
      },
    })],
  })
  expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true)
  return { declaration: await readFile(join(cwd, 'dist/index.d.ts'), 'utf8'), modes }
}

// This boundary covers the real build adapter's policy and delivered declaration
// graph. It does not qualify the published DTSX SDK or native compiler contexts.
for (const adapter of ['separate', 'core'] as const) {
  for (const scenario of [
    { name: 'Node target derives node mode', target: 'node', expected: 'node' },
    { name: 'Node target honors explicit preserve mode', target: 'node', mode: 'preserve', expected: 'preserve' },
    { name: 'Bun target preserves existing spelling', target: 'bun', expected: 'preserve' },
    { name: 'browser target preserves existing spelling', target: 'browser', expected: 'preserve' },
    { name: 'ESM format without a Node target preserves existing spelling', expected: 'preserve' },
    { name: 'Bun target honors explicit node mode', target: 'bun', mode: 'node', expected: 'node' },
  ] as const) {
    test(`${adapter} Bun adapter: ${scenario.name}`, async () => {
      const cwd = await createLibrary()
      const { declaration, modes } = await buildLibrary(cwd, 'target' in scenario ? scenario.target : undefined, 'mode' in scenario ? { moduleSpecifierMode: scenario.mode } : {}, adapter)

      expect(declaration).toContain(scenario.expected === 'node' ? `from './normalize.js'` : `from './normalize'`)
      expect(declaration).toContain(scenario.expected === 'node' ? `from './options.js'` : `from './options'`)
      // Preserve retains the established resolver's explicit directory index.
      expect(declaration).toContain(scenario.expected === 'node' ? `from './detail/index.js'` : `from './detail/index'`)
      if (adapter === 'separate') expect(modes).toEqual([scenario.expected])
      expect(await readFile(join(cwd, 'dist/options.d.ts'), 'utf8')).toContain('interface Options')
      expect(await readFile(join(cwd, 'dist/detail/index.d.ts'), 'utf8')).toContain('interface Metadata')
    })
  }
}

test('incremental Bun builds invalidate the adapter cache when the effective declaration policy changes', async () => {
  const cwd = await createLibrary()
  const adapterCache = join(cwd, 'adapter-cache')
  const hashes = new Map<string, string>()
  for (const scenario of [
    { target: 'bun', mode: 'preserve', expected: 'preserve' },
    { target: 'node', mode: 'node', expected: 'node' },
    { target: 'node', expected: 'node' },
    { target: 'node', mode: 'preserve', expected: 'preserve' },
    { target: 'bun', mode: 'node', expected: 'node' },
    { target: 'bun', expected: 'preserve' },
  ] as const) {
    const { declaration, modes } = await buildLibrary(cwd, scenario.target, {
      clean: false,
      incremental: true,
      cacheDir: adapterCache,
      ...('mode' in scenario ? { moduleSpecifierMode: scenario.mode } : {}),
    })
    expect(modes).toEqual([scenario.expected])
    expect(declaration).toContain(scenario.expected === 'node' ? `from './options.js'` : `from './options'`)
    const adapter = JSON.parse(await readFile(join(adapterCache, 'manifest.json'), 'utf8'))
    const current = adapter.configHash
    expect(typeof current).toBe('string')
    const sameMode = hashes.get(scenario.expected)
    if (sameMode) expect(current).toEqual(sameMode)
    const otherMode = hashes.get(scenario.expected === 'node' ? 'preserve' : 'node')
    if (otherMode) {
      expect(current).not.toBe(otherMode)
    }
    hashes.set(scenario.expected, current)
  }
})

test('the separate Bun adapter enables the core incremental declaration cache', async () => {
  const cwd = await createLibrary()
  const generated: number[] = []
  const options: PluginConfig = {
    clean: false,
    incremental: true,
    cacheDir: join(cwd, 'adapter-cache'),
    moduleSpecifierMode: 'node',
    onSuccess(stats) { generated.push(stats.filesGenerated) },
  }
  const { declaration } = await buildLibrary(cwd, 'bun', options)
  const core = JSON.parse(await readFile(join(cwd, 'adapter-cache/manifest.json'), 'utf8'))
  // writeToFile adds the final LF; the cache retains pre-write content.
  expect(`${core.entries['src/index.ts'].dtsContent}\n`).toBe(declaration)
  expect(core.entries['src/index.ts'].configHash).toBe(core.configHash)
  const second = await buildLibrary(cwd, 'bun', options)
  expect(second.declaration).toBe(declaration)
  const reused = JSON.parse(await readFile(join(cwd, 'adapter-cache/manifest.json'), 'utf8'))
  expect(reused.configHash).toBe(core.configHash)
  expect(reused.entries['src/index.ts'].generatedAt).toBe(core.entries['src/index.ts'].generatedAt)
  expect(generated).toEqual([4, 0])
})

test('Node-target Bun plugin output packs and installs for a strict NodeNext consumer', async () => {
  expect(isAvailable).toBe(true)
  const library = await createLibrary()
  await buildLibrary(library, 'node')
  const consumer = join(library, 'consumer')
  await mkdir(consumer)
  const archive = join(library, 'library.tgz')
  const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
  expect(packed.exitCode, packed.stderr.toString()).toBe(0)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    dependencies: { 'bun-adapter-node-library': `file:${archive}` },
  }))
  for (const args of [['install'], ['install', '--frozen-lockfile']]) {
    const installed = Bun.spawnSync([process.execPath, ...args], { cwd: consumer })
    expect(installed.exitCode, installed.stderr.toString()).toBe(0)
  }
  await writeFile(join(consumer, 'runtime.mjs'), `import { normalize } from 'bun-adapter-node-library'; console.log(normalize({ scale: 7 }))`)
  const runtime = Bun.spawnSync([process.execPath, 'runtime.mjs'], { cwd: consumer })
  expect(runtime.exitCode, runtime.stderr.toString()).toBe(0)
  expect(runtime.stdout.toString().trim()).toBe('7')
  const compilerOptions = { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
  await writeFile(join(consumer, 'positive.ts'), `import { normalize, type Options, type Metadata } from 'bun-adapter-node-library'\nconst options: Options = { scale: 7 }\nconst count: number = normalize(options)\nconst metadata: Metadata = { name: 'accepted' }\nexport { count, metadata }\n`)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['positive.ts'] }))
  const positive = runTsc(consumer, ['--project', 'tsconfig.json'])
  expect(positive.ok, positive.output).toBe(true)
  await writeFile(join(consumer, 'negative.ts'), `import { normalize } from 'bun-adapter-node-library'\nconst invalid: string = normalize({ scale: 7 })\nexport { invalid }\n`)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['negative.ts'] }))
  const negative = runTsc(consumer, ['--project', 'tsconfig.json'])
  expect(negative.ok).toBe(false)
  expect(negative.output.match(/error TS\d+/g), negative.output).toEqual(['error TS2322'])
  expect(negative.output).toContain('negative.ts(2,')
}, 60000)
