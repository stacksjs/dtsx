import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generate } from '../src/generator'
import { isAvailable, runTsc } from './helpers/tsc'

test('node output packs a runtime-reachable declaration graph for a strict NodeNext consumer', async () => {
  // The helper's unavailable-compiler result cannot qualify a consumer check.
  expect(isAvailable).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-node-specifier-package-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  try {
    await mkdir(join(library, 'src/detail'), { recursive: true })
    await mkdir(consumer)
    await writeFile(join(library, 'package.json'), JSON.stringify({
      name: 'node-specifier-library',
      version: '1.0.0',
      type: 'module',
      files: ['dist'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    }))
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
    await writeFile(join(library, 'src/index.ts'), `
export { normalize } from './normalize'
export type { Options } from './options'
export type { Metadata } from './detail'
`)
    await writeFile(join(library, 'src/normalize.ts'), `
import type { Options } from './options'
export function normalize(value: Options): number { return value.scale }
`)
    await writeFile(join(library, 'src/options.ts'), 'export interface Options { scale: number }')
    await writeFile(join(library, 'src/detail/index.ts'), 'export interface Metadata { name: string }')

    const built = await Bun.build({
      entrypoints: [join(library, 'src/index.ts')],
      outdir: join(library, 'dist'),
      target: 'node',
      format: 'esm',
    })
    expect(built.success).toBe(true)
    const stats = await generate({
      cwd: library,
      root: './src',
      entrypoints: ['index.ts'],
      outdir: './dist',
      moduleSpecifierMode: 'node',
    })
    expect(stats.errors).toEqual([])
    expect(stats.filesFailed).toBe(0)

    const archive = join(directory, 'library.tgz')
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({
      name: 'strict-node-consumer',
      private: true,
      type: 'module',
      dependencies: { 'node-specifier-library': `file:${archive}` },
    }))
    for (const argumentsList of [['install'], ['install', '--frozen-lockfile']]) {
      const installed = Bun.spawnSync([process.execPath, ...argumentsList], { cwd: consumer })
      expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    }

    await writeFile(join(consumer, 'runtime.mjs'), `import { normalize } from 'node-specifier-library'; console.log(normalize({ scale: 7 }))`)
    const runtime = Bun.spawnSync([process.execPath, 'runtime.mjs'], { cwd: consumer })
    expect(runtime.exitCode, runtime.stderr.toString()).toBe(0)
    expect(runtime.stdout.toString().trim()).toBe('7')

    const compilerOptions = {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ESNext',
      strict: true,
      skipLibCheck: false,
      paths: {},
      types: [],
      noEmit: true,
    }
    await writeFile(join(consumer, 'positive.ts'), `
import { normalize, type Options, type Metadata } from 'node-specifier-library'
const options: Options = { scale: 7 }
const count: number = normalize(options)
const metadata: Metadata = { name: 'accepted' }
export { count, metadata }
`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['positive.ts'] }))
    const positive = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(positive.ok, positive.output).toBe(true)

    await writeFile(join(consumer, 'negative.ts'), `import { normalize } from 'node-specifier-library'\nconst invalid: string = normalize({ scale: 7 })\nexport { invalid }\n`)
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['negative.ts'] }))
    const negative = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(negative.ok).toBe(false)
    expect(negative.output.match(/error TS\d+/g), negative.output).toEqual(['error TS2322'])
    expect(negative.output).toContain('negative.ts(2,')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
