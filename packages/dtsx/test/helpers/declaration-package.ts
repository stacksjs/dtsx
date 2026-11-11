import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { dts } from '../../../bun-plugin/src'
import { processSource, ZIG_AVAILABLE } from '../../../zig-dtsx/src'
import { generate } from '../../src'
import { traceAsync, traceSync } from './phase-trace'
import { isAvailable, runTsc } from './tsc'

export type DeclarationProducer = 'core' | 'bun-plugin' | 'native' | 'typescript'

export interface DeclarationPackageCase {
  source: string
  positive: string
  negatives: Array<{ code: number, content: string }>
  inspect?: (declaration: string) => void
}

/** Check authored and normally packed declarations with the same strict consumers. */
export async function checkDeclarationPackage(producer: DeclarationProducer, fixture: DeclarationPackageCase): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-declaration-contract-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }
  try {
    expect(isAvailable).toBe(true)
    if (producer === 'native') expect(ZIG_AVAILABLE).toBe(true)
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'declaration-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
    await writeFile(join(library, 'src/index.ts'), fixture.source)

    async function checkConsumers(cwd: string, specifier: string): Promise<void> {
      for (const [index, control] of [{ content: fixture.positive }, ...fixture.negatives].entries()) {
        await writeFile(join(cwd, 'control.ts'), `import * as api from '${specifier}'\n${control.content}\n`)
        await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['control.ts'] }))
        const result = runTsc(cwd, ['--project', 'tsconfig.json'])
        expect(result.ok, result.output).toBe(index === 0)
        if ('code' in control) {
          expect(result.output.match(/error TS\d+/g), result.output).toEqual([`error TS${control.code}`])
          expect(result.output).toContain('control.ts(')
        }
      }
    }

    await checkConsumers(library, './src/index.js')
    const details = { library, producer, sourceHash: new Bun.CryptoHasher('sha256').update(fixture.source).digest('hex') }
    const built = await traceAsync('Bun runtime build', () => Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'] })] : [] }), details)
    expect(built.success, JSON.stringify(built.logs)).toBe(true)
    if (producer === 'core' || producer === 'typescript') await traceAsync('Core declaration generation', () => generate({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], ...(producer === 'typescript' ? { engine: 'typescript' as const } : {}) }), details)
    else if (producer === 'native') await writeFile(join(library, 'dist/index.d.ts'), traceSync('Native declaration generation', () => processSource(fixture.source, true), details))

    const declaration = await readFile(join(library, 'dist/index.d.ts'), 'utf8')
    fixture.inspect?.(declaration)
    const archive = join(directory, 'library.tgz')
    const packed = traceSync('Normal package archive', () => Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library }), details)
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-consumer', private: true, type: 'module', dependencies: { 'declaration-contract': `file:${archive}` } }))
    for (const flags of [[], ['--frozen-lockfile']]) {
      const installed = traceSync(flags.length ? 'Frozen consumer installation' : 'Normal consumer installation', () => Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer }), details)
      expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    }
    expect(await readFile(join(consumer, 'node_modules/declaration-contract/dist/index.d.ts'), 'utf8')).toBe(declaration)
    await checkConsumers(consumer, 'declaration-contract')
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}
