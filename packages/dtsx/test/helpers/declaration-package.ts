import type { dts as SourceDts } from '../../../bun-plugin/src'
import type { processSource as SourceProcessSource, processSourceWithContext as SourceProcessSourceWithContext } from '../../../zig-dtsx/src'
import type { generate as SourceGenerate } from '../../src'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect } from 'bun:test'
import { traceAsync, traceSync } from './phase-trace'
import { isAvailable, runTsc } from './tsc'

export type DeclarationProducer = 'core' | 'bun-plugin' | 'native' | 'typescript'

interface DeclarationProducers {
  dts: typeof SourceDts
  generate: typeof SourceGenerate
  processSource: typeof SourceProcessSource
  processSourceWithContext: typeof SourceProcessSourceWithContext
  ZIG_AVAILABLE: boolean
  input: Record<string, unknown>
}

let selectedProducers: Promise<DeclarationProducers> | undefined

/** Run identical fixtures against source or explicit, version-checked package payloads. */
async function declarationProducers(): Promise<DeclarationProducers> {
  return selectedProducers ??= (async () => {
    const configuration = process.env.DTSX_DECLARATION_PRODUCERS
    if (!configuration) {
      const [plugin, native, core] = await Promise.all([import('../../../bun-plugin/src'), import('../../../zig-dtsx/src'), import('../../src')])
      return { dts: plugin.dts, generate: core.generate, processSource: native.processSource, processSourceWithContext: native.processSourceWithContext, ZIG_AVAILABLE: native.ZIG_AVAILABLE, input: { kind: 'source' } }
    }
    if (process.env.DTSX_NATIVE_LIBRARY) throw new Error('Published producers cannot use DTSX_NATIVE_LIBRARY')
    const input = JSON.parse(await readFile(configuration, 'utf8')) as { version?: unknown, core?: unknown, bunPlugin?: unknown, native?: unknown }
    if (typeof input.version !== 'string' || !input.version) throw new Error('Producer configuration requires an exact version')
    const packages: Array<Record<string, unknown>> = []
    async function packageEntry(root: string, target: unknown, name: string): Promise<string> {
      if (typeof target !== 'string' || !target.startsWith('./')) throw new Error(`${name} has no public import target`)
      const entry = await realpath(resolve(root, target))
      const within = relative(root, entry)
      if (isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) throw new Error(`${name}'s entry escapes its package`)
      return entry
    }
    async function inspect(key: 'core' | 'bunPlugin' | 'native', name: string) {
      if (typeof input[key] !== 'string') throw new Error(`Producer configuration requires ${key}'s package directory`)
      const root = await realpath(resolve(input[key] as string))
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
      if (manifest.name !== name || manifest.version !== input.version) throw new Error(`Expected ${name}@${input.version}, received ${manifest.name}@${manifest.version}`)
      const entry = await packageEntry(root, manifest.exports?.['.']?.import, name)
      if (key === 'native' && existsSync(join(root, 'zig-out'))) throw new Error('A published native producer cannot contain a local zig-out build')
      packages.push({ name, version: manifest.version, root, entry, sha256: new Bun.CryptoHasher('sha256').update(await readFile(entry)).digest('hex') })
      return { root, entry, manifest }
    }
    const [corePackage, pluginPackage, nativePackage] = await Promise.all([inspect('core', '@dtsx/dtsx'), inspect('bunPlugin', '@dtsx/bun'), inspect('native', 'zig-dtsx')])
    const resolutions: Array<Record<string, unknown>> = []
    // The plugin imports these public core modules. Check their actual Bun
    // resolution before importing any producer, so aliases cannot mix source
    // into a nominally published graph.
    for (const subpath of ['', 'generator', 'cache']) {
      const specifier = `@dtsx/dtsx${subpath ? `/${subpath}` : ''}`
      const target = subpath ? corePackage.manifest.exports?.[`./${subpath}`]?.import ?? corePackage.manifest.exports?.['./*']?.import?.replace('*', subpath) : corePackage.manifest.exports?.['.']?.import
      const expected = await packageEntry(corePackage.root, target, specifier)
      const resolved = await realpath(Bun.resolveSync(specifier, dirname(pluginPackage.entry)))
      if (resolved !== expected) throw new Error(`${specifier} resolves outside its configured public core entry`)
      resolutions.push({ specifier, importer: pluginPackage.entry, resolved, sha256: new Bun.CryptoHasher('sha256').update(await readFile(resolved)).digest('hex') })
    }
    const [core, plugin, native] = await Promise.all([import(pathToFileURL(corePackage.entry).href), import(pathToFileURL(pluginPackage.entry).href), import(pathToFileURL(nativePackage.entry).href)])
    for (const [name, value] of Object.entries({ generate: core.generate, dts: plugin.dts, processSource: native.processSource, processSourceWithContext: native.processSourceWithContext })) {
      if (typeof value !== 'function') throw new Error(`Published producer is missing ${name}`)
    }
    if (native.ZIG_AVAILABLE !== true) throw new Error('Published native producer is unavailable')
    const provenance = { kind: 'published-packages', version: input.version, configuration: resolve(configuration), packages: packages.sort((left, right) => String(left.name).localeCompare(String(right.name))), resolutions, nativeLibraryOverride: false }
    if (process.env.DTSX_DECLARATION_PRODUCER_RECEIPT) await writeFile(process.env.DTSX_DECLARATION_PRODUCER_RECEIPT, `${JSON.stringify(provenance, null, 2)}\n`)
    return { generate: core.generate as typeof SourceGenerate, dts: plugin.dts as typeof SourceDts, processSource: native.processSource as typeof SourceProcessSource, processSourceWithContext: native.processSourceWithContext as typeof SourceProcessSourceWithContext, ZIG_AVAILABLE: true, input: provenance }
  })()
}

export interface DeclarationPackageCase {
  filename?: 'index.ts' | 'index.tsx'
  global?: boolean
  isolatedDeclarations?: boolean
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
  const filename = fixture.filename ?? 'index.ts'
  const compilerOptions = { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'preserve', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true, ...(fixture.global ? { moduleDetection: 'legacy' } : {}) }
  try {
    const { dts, generate, processSource, processSourceWithContext, ZIG_AVAILABLE, input } = await declarationProducers()
    expect(isAvailable).toBe(true)
    if (producer === 'native') expect(ZIG_AVAILABLE).toBe(true)
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'declaration-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } }))
    await writeFile(join(library, 'src', filename), fixture.source)

    async function checkConsumers(cwd: string, specifier: string): Promise<void> {
      for (const [index, control] of [{ content: fixture.positive }, ...fixture.negatives].entries()) {
        const reference = fixture.global ? `/// <reference path="${specifier === './src/index.js' ? './src/index.ts' : './node_modules/declaration-contract/dist/index.d.ts'}" />` : `import * as api from '${specifier}'`
        await writeFile(join(cwd, 'control.ts'), `${reference}\n${control.content}\n`)
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
    if (filename.endsWith('.tsx')) await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'createElement' } }))
    const emissionOptions = fixture.isolatedDeclarations === undefined ? {} : { isolatedDeclarations: fixture.isolatedDeclarations }
    const details = { library, producer, input, ...emissionOptions, sourceHash: new Bun.CryptoHasher('sha256').update(fixture.source).digest('hex') }
    const built = await traceAsync('Bun runtime build', () => Bun.build({ entrypoints: [join(library, 'src', filename)], outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: [filename], ...emissionOptions })] : [] }), details)
    expect(built.success, JSON.stringify(built.logs)).toBe(true)
    if (producer === 'core' || producer === 'typescript') await traceAsync('Core declaration generation', () => generate({ cwd: library, root: './src', outdir: './dist', entrypoints: [filename], ...emissionOptions, ...(producer === 'typescript' ? { engine: 'typescript' as const } : {}) }), details)
    else if (producer === 'native') await writeFile(join(library, 'dist/index.d.ts'), traceSync('Native declaration generation', () => fixture.filename
      ? processSourceWithContext(fixture.source, { version: 1, moduleSpecifierMode: 'preserve', sourceFile: join(library, 'src', filename), outputFile: join(library, 'dist/index.d.ts'), sourceHash: details.sourceHash, rewrites: [] }, true, fixture.isolatedDeclarations)
      : processSource(fixture.source, true, fixture.isolatedDeclarations), details))

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
