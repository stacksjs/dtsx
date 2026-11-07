import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'bun:test'
import * as native from '../../../zig-dtsx/src'
import { dts } from '../../../bun-plugin/src'
import { generate } from '../../src'
import { isAvailable, runTsc } from './tsc'

export interface PrivatePackageFixture {
  files: Record<string, string>
  packageType?: 'module' | 'commonjs'
  moduleDetection?: 'legacy'
  positive: string
  negatives: string[]
  retained?: Record<string, string[]>
  pruned?: Record<string, string[]>
}

/** Check authored contracts before packing actual producer output and installing it normally. */
export async function packedPrivateContract(producer: 'core' | 'bun-plugin' | 'native', fixture: PrivatePackageFixture): Promise<void> {
  expect(isAvailable).toBe(true)
  if (producer === 'native') expect(native.ZIG_AVAILABLE).toBe(true)
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-private-contract-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  const compilerOptions = { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true, moduleDetection: fixture.moduleDetection }
  const substitute = (source: string, module: string): string => source.replaceAll('PRIVATE_BASE', module === './src/index.js' ? './src/base.js' : `${module}/base`).replaceAll('PRIVATE_LIBRARY', module)
  const diagnostics = (output: string): string[] => output.match(/error TS\d+/g) ?? []
  try {
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    const exports: Record<string, { types: string, import: string }> = { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }
    if (fixture.files['base.ts']) exports['./base'] = { types: './dist/base.d.ts', import: './dist/base.js' }
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'private-declaration-library', version: '1.0.0', type: fixture.packageType ?? 'module', exports, files: ['dist'] }))
    for (const [name, source] of Object.entries(fixture.files)) await writeFile(join(library, 'src', name), source)
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['authored.ts'] }))
    await writeFile(join(library, 'authored.ts'), substitute(fixture.positive, './src/index.js'))
    const authored = runTsc(library, ['--project', 'tsconfig.json'])
    expect(authored.ok, authored.output).toBe(true)
    const sourceDiagnostics: string[][] = []
    for (const negative of fixture.negatives) {
      await writeFile(join(library, 'authored.ts'), substitute(negative, './src/index.js'))
      const result = runTsc(library, ['--project', 'tsconfig.json'])
      expect(result.ok, 'The authored invalid consumer must fail').toBe(false)
      expect(diagnostics(result.output).length).toBeGreaterThan(0)
      sourceDiagnostics.push(diagnostics(result.output))
    }

    const entrypoints = Object.keys(fixture.files)
    const built = await Bun.build({ entrypoints: entrypoints.map(name => join(library, 'src', name)), root: join(library, 'src'), outdir: join(library, 'dist'), target: 'bun', format: fixture.packageType === 'commonjs' ? 'cjs' : 'esm', plugins: producer === 'bun-plugin' ? [dts({ cwd: library, root: './src', entrypoints, outdir: './dist' })] : [] })
    expect(built.success).toBe(true)
    if (producer === 'core') await generate({ cwd: library, root: './src', entrypoints, outdir: './dist' })
    else if (producer === 'native') {
      for (const [name, source] of Object.entries(fixture.files)) await writeFile(join(library, 'dist', name.replace(/\.ts$/, '.d.ts')), native.processSource(source))
    }
    const archive = join(directory, 'library.tgz')
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-private-consumer', private: true, type: 'module', dependencies: { 'private-declaration-library': `file:${archive}` } }))
    for (const args of [[process.execPath, 'install'], [process.execPath, 'install', '--frozen-lockfile']]) {
      const installed = Bun.spawnSync(args, { cwd: consumer })
      expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    }
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['consumer.ts'] }))
    await writeFile(join(consumer, 'consumer.ts'), substitute(fixture.positive, 'private-declaration-library'))
    const generated = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(generated.ok, generated.output).toBe(true)
    for (let index = 0; index < fixture.negatives.length; index++) {
      await writeFile(join(consumer, 'consumer.ts'), substitute(fixture.negatives[index], 'private-declaration-library'))
      const result = runTsc(consumer, ['--project', 'tsconfig.json'])
      expect(result.ok, 'The generated contract must reject the same invalid consumer').toBe(false)
      expect(diagnostics(result.output)).toEqual(sourceDiagnostics[index])
    }
    for (const [name, expected] of Object.entries(fixture.retained ?? {})) {
      const declaration = await readFile(join(consumer, 'node_modules/private-declaration-library/dist', name), 'utf8')
      for (const text of expected) expect(declaration).toContain(text)
    }
    for (const [name, excluded] of Object.entries(fixture.pruned ?? {})) {
      const declaration = await readFile(join(consumer, 'node_modules/private-declaration-library/dist', name), 'utf8')
      for (const text of excluded) expect(declaration).not.toContain(text)
    }
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}
