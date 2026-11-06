import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isAvailable, runTsc } from '../../dtsx/test/helpers/tsc'

interface PackedManifest {
  name: string
  version: string
  exports: { '.': { types: string, import: string } }
  dependencies?: Record<string, string>
}

interface PackedPackage {
  directory: string
  archive: string
  files: Map<string, File>
  manifest: PackedManifest
  phase: (name: string) => void
}

async function withPackedPackage(check: (packed: PackedPackage) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'zig-dtsx-package-'))
  const started = performance.now()
  function phase(name: string): void {
    if (process.env.DTSX_PACKAGE_EVIDENCE)
      console.info(JSON.stringify({ directory, phase: name, elapsedMs: performance.now() - started }))
  }
  try {
    const archive = join(directory, 'package.tgz')
    phase('pack start')
    const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: resolve(import.meta.dir, '..') })
    phase('pack complete')
    expect(packed.exitCode, packed.stderr.toString()).toBe(0)
    const files = await new Bun.Archive(await readFile(archive)).files()
    const manifestFile = files.get('package/package.json')
    expect(manifestFile).toBeDefined()
    const manifest: PackedManifest = JSON.parse(await manifestFile!.text())
    phase('archive inspected')
    await check({ directory, archive, files, manifest, phase })
  }
  finally { await rm(directory, { recursive: true, force: true }) }
}

test('the normal native package archive contains its declared public types and import targets', () => withPackedPackage(async ({ files, manifest }) => {
  for (const [condition, target] of Object.entries(manifest.exports['.'])) {
    expect(target.startsWith('./'), condition).toBe(true)
    expect(files.has(`package/${target.slice(2)}`), `Missing packed ${condition} target ${target}`).toBe(true)
  }
}))

test('the normal packed Bun FFI binding retains strict public API types without loading a native library', () => withPackedPackage(async ({ directory, archive, files, manifest, phase }) => {
  expect(isAvailable).toBe(true)
  const consumer = join(directory, 'consumer')
  await mkdir(consumer)
  const sourceManifest: { devDependencies: Record<string, string> } = await Bun.file(resolve(import.meta.dir, '../../../package.json')).json()
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-zig-dtsx-consumer', private: true, type: 'module', dependencies: { [manifest.name]: `file:${archive}` }, devDependencies: { '@types/bun': sourceManifest.devDependencies['@types/bun'] } }))
  for (const args of [['install'], ['install', '--frozen-lockfile']]) {
    phase(`${args.join(' ')} start`)
    const installed = Bun.spawnSync([process.execPath, ...args], { cwd: consumer })
    phase(`${args.join(' ')} complete`)
    expect(installed.exitCode, installed.stderr.toString()).toBe(0)
  }
  for (const [name, payload] of files) {
    const relative = name.slice('package/'.length)
    expect(await Bun.file(join(consumer, 'node_modules', manifest.name, relative)).arrayBuffer()).toEqual(await payload.arrayBuffer())
  }
  phase('installed payloads compared')
  // Recheck the same real consumer after adding an invalid file. TypeScript's
  // own graph cache avoids checking unchanged dependency declarations twice;
  // the new file must still invalidate the project and produce exactly TS2322.
  const compilerOptions = { module: 'Preserve', moduleResolution: 'Bundler', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: ['bun'], noEmit: true, incremental: true, tsBuildInfoFile: './consumer.tsbuildinfo' }
  await writeFile(join(consumer, 'consumer.ts'), `import binding, { processSource, processBatch, processSourceWithContext, ZIG_AVAILABLE, ZIG_CONTEXT_AVAILABLE, type SourceEmissionContext } from '${manifest.name}';
const one: string = processSource('export const value = 1', true, false);
const many: string[] = processBatch(['export const value = 1'], false, 1);
const available: boolean = ZIG_AVAILABLE;
const contextual: boolean = ZIG_CONTEXT_AVAILABLE;
const context: SourceEmissionContext = { version: 1, moduleSpecifierMode: 'node', sourceFile: '/src/index.ts', outputFile: '/dist/index.d.ts', sourceHash: 'hash', rewrites: [] };
const emitted: string = processSourceWithContext('export const value = 1', context);
const api: { processSource: typeof processSource, processBatch: typeof processBatch, processSourceWithContext: typeof processSourceWithContext } = binding;
void [one, many, available, contextual, emitted, api];`)
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions, include: ['*.ts'] }))
  phase('strict positive start')
  const positive = runTsc(consumer, ['--project', 'tsconfig.json'])
  phase('strict positive complete')
  expect(positive.ok, positive.output).toBe(true)
  expect(await Bun.file(join(consumer, 'consumer.tsbuildinfo')).exists()).toBe(true)
  await writeFile(join(consumer, 'negative.ts'), `import { processSource } from '${manifest.name}'; const wrong: number = processSource('export const value = 1'); void wrong;`)
  phase('strict negative start')
  const negative = runTsc(consumer, ['--project', 'tsconfig.json'])
  phase('strict negative complete')
  expect(negative.ok).toBe(false)
  expect(negative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
  await writeFile(join(consumer, 'negative.ts'), `import { processSourceWithContext, type SourceEmissionContext } from '${manifest.name}'; const context: SourceEmissionContext = { version: 1, moduleSpecifierMode: 'node', sourceFile: '/src/index.ts', outputFile: '/dist/index.d.ts', sourceHash: 'hash', rewrites: [] }; const wrong: number = processSourceWithContext('export const value = 1', context); void wrong;`)
  const contextualNegative = runTsc(consumer, ['--project', 'tsconfig.json'])
  expect(contextualNegative.ok).toBe(false)
  expect(contextualNegative.output.match(/error TS\d+/g)).toEqual(['error TS2322'])
}))

test('an unpublished native workspace version installs without requiring its benchmark-only core package', () => withPackedPackage(async ({ directory, files, manifest }) => {
  const publisher = join(directory, 'publisher')
  const native = join(publisher, 'native')
  const core = join(publisher, 'core')
  const consumer = join(directory, 'consumer')
  const version = `${manifest.version}-package-test.${crypto.randomUUID()}`
  await Promise.all([native, core, consumer].map(path => mkdir(path, { recursive: true })))
  await writeFile(join(publisher, 'package.json'), JSON.stringify({ name: 'native-package-workspace', private: true, workspaces: ['native', 'core'] }))
  await Promise.all([...files].map(async ([name, payload]) => {
    const destination = join(native, name.slice('package/'.length))
    await mkdir(dirname(destination), { recursive: true })
    await Bun.write(destination, payload)
  }))
  const authoredNative: PackedManifest = await Bun.file(resolve(import.meta.dir, '../package.json')).json()
  const authoredCore: { name: string, version: string } = await Bun.file(resolve(import.meta.dir, '../../dtsx/package.json')).json()
  // The core descriptor models packaging metadata only. The consumer is outside
  // this workspace and receives no core source, exports, alias or runtime link.
  await writeFile(join(native, 'package.json'), JSON.stringify({ ...authoredNative, version }))
  await writeFile(join(core, 'package.json'), JSON.stringify({ ...authoredCore, version }))
  const archive = join(directory, 'unpublished-native.tgz')
  const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: native })
  expect(packed.exitCode, packed.stderr.toString()).toBe(0)
  const futureFiles = await new Bun.Archive(await readFile(archive)).files()
  const futureManifest: PackedManifest = JSON.parse(await futureFiles.get('package/package.json')!.text())
  expect(futureManifest.version).toBe(version)
  if (futureManifest.dependencies?.[authoredCore.name])
    expect(futureManifest.dependencies[authoredCore.name]).toBe(version)
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'unpublished-native-consumer', private: true, type: 'module', dependencies: { [manifest.name]: `file:${archive}` } }))
  const installed = Bun.spawnSync([process.execPath, 'install'], { cwd: consumer })
  expect(installed.exitCode, `${installed.stdout}\n${installed.stderr}`).toBe(0)
  const frozen = Bun.spawnSync([process.execPath, 'install', '--frozen-lockfile'], { cwd: consumer })
  expect(frozen.exitCode, frozen.stderr.toString()).toBe(0)
  expect(await Bun.file(join(consumer, 'node_modules', manifest.name, 'src/index.ts')).arrayBuffer()).toEqual(await files.get('package/src/index.ts')!.arrayBuffer())
  expect(await Bun.file(join(consumer, 'node_modules', authoredCore.name, 'package.json')).exists()).toBe(false)
}))
