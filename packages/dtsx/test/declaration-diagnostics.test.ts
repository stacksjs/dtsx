import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { processSourceWithContext, ZIG_CONTEXT_AVAILABLE } from '../../zig-dtsx/src'
import { dts } from '../../bun-plugin/src'
import { generate } from '../src/generator'
import { generateNativeDeclarationProject } from '../src/native-generation'
import { planNativeDeclarationProject } from '../src/native-project'
import fixtures from './fixtures/declaration-diagnostics.json'
import { traceAsync, traceSync } from './helpers/phase-trace'
import { runTsc } from './helpers/tsc'

// TypeScript 7.0.2, published gitHead in microsoft/typescript-go:
// 2bd066d87f5bafd315be9f40889d0a60b9e58e0b. See docs/diagnostic-coverage.md.
const active = Object.keys(fixtures)
const catalogOnly = [9005, 9006]
const strictIneligible = [9014]
const relatedSuggestions = [9027, 9028, 9029, 9030, 9031, 9032, 9033, 9034, 9035, 9036]
const catalog = [9005, 9006, 9007, 9008, 9009, 9010, 9011, 9012, 9013, 9014, 9015, 9016, 9017, 9018, 9019, 9020, 9021, 9022, 9023, 9025, 9026, 9027, 9028, 9029, 9030, 9031, 9032, 9033, 9034, 9035, 9036, 9037, 9038, 9039]
const compilerOptions = { strict: true, skipLibCheck: false, paths: {}, types: [], target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true }
const compiler = resolve(import.meta.dir, '../../../node_modules/typescript/lib/tsc.js')
const cli = process.env.DTSX_NATIVE_CLI ?? resolve(import.meta.dir, `../../zig-dtsx/zig-out/bin/zig-dtsx${process.platform === 'win32' ? '.exe' : ''}`)

async function sources(root: string): Promise<void> {
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'diagnostic-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: Object.fromEntries(active.map(code => [`./${code}`, { types: `./dist/${code}/index.d.ts`, import: `./dist/${code}/index.js` }])) }))
  for (const [code, fixture] of Object.entries(fixtures)) {
    await mkdir(join(root, 'src', code), { recursive: true })
    for (const [name, text] of Object.entries(fixture.files)) await writeFile(join(root, 'src', code, name), text)
  }
}

/** Independent modules keep every positive and declaration clean while
 * requiring each negative's exact diagnostic and owning file. */
async function controls(root: string, specifier: (code: string) => string): Promise<void> {
  const files: string[] = []
  for (const [code, fixture] of Object.entries(fixtures)) {
    for (const negative of [false, true]) {
      const file = `${negative ? 'negative' : 'positive'}-${code}.ts`
      files.push(file)
      await writeFile(join(root, file), `import * as api from '${specifier(code)}';\n${negative ? fixture.negative : fixture.positive}`)
    }
  }
  await writeFile(join(root, 'tsconfig.controls.json'), JSON.stringify({ compilerOptions, files }))
  const result = traceSync('Diagnostic positive and exact-negative compiler controls', () => runTsc(root, ['--project', 'tsconfig.controls.json']), { root })
  expect(result.ok, result.output).toBe(false)
  expect(result.output.match(/error TS\d+/g) ?? [], result.output).toEqual(Object.values(fixtures).map(fixture => `error TS${fixture.negativeCode}`))
  expect([...result.output.matchAll(/negative-(\d+)\.ts\(\d+,\d+\): error TS\d+/g)].map(match => match[1]), result.output).toEqual(active)
}

async function emitReference(root: string, isolated: boolean): Promise<string> {
  await writeFile(join(root, 'tsconfig.emit.json'), JSON.stringify({ compilerOptions: { ...compilerOptions, noEmit: false, declaration: true, emitDeclarationOnly: true, noEmitOnError: true, isolatedDeclarations: isolated, rootDir: './src', outDir: isolated ? './isolated' : './reference' }, include: ['src/**/*.ts'] }))
  const result = traceSync('Diagnostic reference declaration compiler', () => Bun.spawnSync([process.execPath, compiler, '--project', 'tsconfig.emit.json'], { cwd: root, timeout: 4000 }), { root, isolated })
  const output = result.stdout.toString() + result.stderr.toString()
  if (isolated) expect(result.exitCode, output).not.toBe(0)
  else expect(result.exitCode, output).toBe(0)
  return output
}

test('the catalog distinguishes 21 active primaries, 10 related suggestions and three ineligible rows', () => {
  const classified = [...active.map(Number), ...catalogOnly, ...strictIneligible, ...relatedSuggestions].sort((a, b) => a - b)
  expect(classified).toEqual(catalog)
  expect(new Set(classified).size).toBe(34)
})

test('every active primary is an actual isolated-declaration failure on strict-valid source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtsx-diagnostic-oracles-'))
  try {
    await sources(root)
    await controls(root, code => `./src/${code}/index.js`)
    const output = await emitReference(root, true)
    expect(output.match(/error TS\d+/g), output).toEqual(active.map(code => `error TS${code}`))
    expect([...output.matchAll(/src[\\/](\d+)[\\/]index\.ts\(\d+,\d+\): error TS\d+/g)].map(match => match[1]), output).toEqual(active)
    for (const code of active) expect(existsSync(join(root, 'isolated', code, 'index.d.ts'))).toBe(false)
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

test('non-entity interface and type-literal keys are source-invalid rather than TS9014 success fixtures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dtsx-diagnostic-eligibility-'))
  try {
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    await writeFile(join(root, 'interface.ts'), 'const KEY: unique symbol = Symbol(); export interface Example { [(KEY)]: number }')
    await writeFile(join(root, 'literal.ts'), 'const KEY: unique symbol = Symbol(); export type Example = { [(KEY)]: number }')
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions, files: ['interface.ts', 'literal.ts'] }))
    const result = runTsc(root, ['--project', 'tsconfig.json'])
    expect(result.ok, result.output).toBe(false)
    expect(result.output.match(/error TS\d+/g), result.output).toEqual(['error TS1169', 'error TS1170'])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

for (const producer of ['core', 'bun-plugin', 'native', 'native-project'] as const) {
  test(`${producer}: all 21 diagnostic contracts survive normal and frozen public installation`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dtsx-diagnostic-package-'))
    const library = join(root, 'library')
    const consumer = join(root, 'consumer')
    try {
      await mkdir(library)
      const details = { producer, library, consumer }
      await traceAsync('Diagnostic fixture preparation', () => sources(library), details)
      await controls(library, code => `./src/${code}/index.js`)
      await emitReference(library, false)
      await controls(library, code => `./reference/${code}/index.js`)
      const entrypoints = active.map(code => `${code}/index.ts`)
      const options = { cwd: library, root: './src', outdir: './dist', entrypoints, moduleSpecifierMode: 'node' as const }
      const built = await traceAsync('Diagnostic runtime and plugin build', () => Bun.build({ entrypoints: entrypoints.map(file => join(library, 'src', file)), root: join(library, 'src'), outdir: join(library, 'dist'), target: 'bun', plugins: producer === 'bun-plugin' ? [dts(options)] : [] }), details)
      expect(built.success, JSON.stringify(built.logs)).toBe(true)
      if (producer === 'core') {
        const result = await traceAsync('Diagnostic core generation', () => generate(options), details)
        expect(result.filesFailed, JSON.stringify(result.errors)).toBe(0)
      }
      else if (producer === 'native') {
        expect(ZIG_CONTEXT_AVAILABLE).toBe(true)
        const plan = await traceAsync('Diagnostic native project planning', () => planNativeDeclarationProject(options), details)
        expect(plan.files.length).toBe(22)
        for (const file of plan.files) {
          await mkdir(join(file.outputFile, '..'), { recursive: true })
          await traceAsync('Diagnostic native file emission', () => writeFile(file.outputFile, processSourceWithContext(file.source, file.context, true)), { ...details, sourceFile: file.sourceFile })
        }
      }
      else if (producer === 'native-project') {
        expect(existsSync(cli), cli).toBe(true)
        const result = await traceAsync('Diagnostic native CLI generation', () => generateNativeDeclarationProject(cli, options, { timeoutMs: 4000 }), details)
        expect(result.filesGenerated).toBe(22)
      }
      const archive = join(root, 'library.tgz')
      const packed = traceSync('Diagnostic normal package archive', () => Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library, timeout: 4000 }), details)
      expect(packed.exitCode, packed.stderr.toString()).toBe(0)
      await mkdir(consumer)
      await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'diagnostic-contract': `file:${archive}` } }))
      for (const flags of [[], ['--frozen-lockfile']]) {
        const installed = traceSync('Diagnostic normal or frozen consumer installation', () => Bun.spawnSync([process.execPath, 'install', ...flags], { cwd: consumer, timeout: 4000 }), { ...details, frozen: flags.length > 0 })
        expect(installed.exitCode, installed.stderr.toString()).toBe(0)
        for (const [code, fixture] of Object.entries(fixtures)) {
          for (const name of Object.keys(fixture.files)) {
            const file = name.replace(/\.ts$/, '.d.ts')
            expect(await readFile(join(consumer, 'node_modules/diagnostic-contract/dist', code, file), 'utf8')).toBe(await readFile(join(library, 'dist', code, file), 'utf8'))
          }
        }
        await controls(consumer, code => `diagnostic-contract/${code}`)
      }
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
}
