// Retained references to explicitly excluded sources must fail before publication.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { dts } from '../../bun-plugin/src'
import { BuildCache } from '../src/cache'
import { defaultConfig } from '../src/config'
import { planDeclarationProject } from '../src/declaration-project'
import { generate } from '../src/generator'
import { isAvailable, runTsc } from './helpers/tsc'

async function fixture(check: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-excluded-relative-'))
  try {
    await mkdir(join(cwd, 'src'))
    await mkdir(join(cwd, 'dist'))
    await writeFile(join(cwd, 'package.json'), '{"private":true,"type":"module"}\n')
    // Extensionless authored imports are valid in this source Bundler project.
    // The declaration package is intended for strict NodeNext consumers.
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [] } }))
    await writeFile(join(cwd, 'src/hidden.ts'), 'export interface Hidden { count: number }\n')
    await writeFile(join(cwd, 'src/a.ts'), 'export const ready: number = 1\n')
    await writeFile(join(cwd, 'dist/a.d.ts'), 'export declare const previousReady: string;\r\n')
    await writeFile(join(cwd, 'dist/index.d.ts'), 'export declare const previous: string;\r\n')
    await writeFile(join(cwd, 'dist/runtime.js'), 'export const runtime = 7;\n')
    await check(cwd)
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
}

function options(cwd: string, clean = true) {
  return { cwd, root: './src', outdir: './dist', entrypoints: ['a.ts', 'index.ts'], exclude: ['hidden.ts'], moduleSpecifierMode: 'node' as const, failOnUnresolvedReExport: true, clean, isolatedDeclarations: false, incremental: false, parallel: false, keepComments: false, logLevel: 'silent' as const }
}

function checkAuthoredSource(cwd: string): void {
  expect(isAvailable).toBe(true)
  const result = runTsc(cwd, ['--project', 'tsconfig.json', '--noEmit'])
  expect(result.ok, result.output).toBe(true)
}

for (const clean of [false, true]) {
  for (const [kind, source] of [
    ['type re-export', "export type { Hidden } from './hidden'\n"],
    ['retained type import', "import type { Hidden } from './hidden'\nexport interface Box { value: Hidden }\n"],
  ] as const) {
    for (const producer of ['core', 'bun-plugin'] as const) {
    test(`${producer} rejects an excluded relative ${kind} before publication (clean=${clean})`, () => fixture(async (cwd) => {
      await writeFile(join(cwd, 'src/index.ts'), source)
      checkAuthoredSource(cwd)
      let failure: unknown
      try {
        if (producer === 'core') await generate(options(cwd, clean))
        else {
          const result = await Bun.build({ entrypoints: [join(cwd, 'src/a.ts'), join(cwd, 'src/index.ts')], outdir: join(cwd, 'dist'), target: 'bun', throw: false, plugins: [dts(options(cwd, clean))] })
          if (!result.success) failure = new Error(result.logs.map(log => log.message).join('\n'))
        }
      }
      catch (error) { failure = error }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error ? failure.message : '').toMatch(/excluded/i)
      const observed = {
        failed: failure instanceof Error,
        previousSibling: await readFile(join(cwd, 'dist/a.d.ts'), 'utf8'),
        declaration: await readFile(join(cwd, 'dist/index.d.ts'), 'utf8'),
        runtime: await readFile(join(cwd, 'dist/runtime.js'), 'utf8'),
        hiddenDelivered: await Bun.file(join(cwd, 'dist/hidden.d.ts')).exists(),
      }
      expect(observed).toEqual({ failed: true, previousSibling: 'export declare const previousReady: string;\r\n', declaration: 'export declare const previous: string;\r\n', runtime: 'export const runtime = 7;\n', hiddenDelivered: false })
    }))
    }
  }
}

test('strict node generation accepts a pruned excluded relative import', () => fixture(async (cwd) => {
  await writeFile(join(cwd, 'src/index.ts'), "import type { Hidden } from './hidden'\nexport const value: number = 1\n")
  checkAuthoredSource(cwd)
  const stats = await generate(options(cwd))
  expect(stats.filesFailed).toBe(0)
  const declaration = await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')
  expect(declaration).toContain('value: number;')
  expect(declaration).not.toContain('hidden')
  expect(await Bun.file(join(cwd, 'dist/hidden.d.ts')).exists()).toBe(false)
  expect(await readFile(join(cwd, 'dist/runtime.js'), 'utf8')).toBe('export const runtime = 7;\n')
  await writeFile(join(cwd, 'consumer.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['consumer.ts'] }))
  await writeFile(join(cwd, 'consumer.ts'), "import { value } from './dist/index.js'\nconst check: number = value\nvoid check\n")
  const positive = runTsc(cwd, ['--project', 'consumer.json'])
  expect(positive.ok, positive.output).toBe(true)
  await writeFile(join(cwd, 'consumer.ts'), "import { value } from './dist/index.js'\nconst check: string = value\nvoid check\n")
  const negative = runTsc(cwd, ['--project', 'consumer.json'])
  expect(negative.ok).toBe(false)
  expect(negative.output.match(/error TS\d+:/g)).toEqual(['error TS2322:'])
}))

test('a matching previous-format cache cannot bypass excluded-reference validation', () => fixture(async (cwd) => {
  const source = "import type { Hidden } from './hidden'\nexport interface Box { value: Hidden }\n"
  const file = join(cwd, 'src/index.ts')
  await writeFile(file, source)
  checkAuthoredSource(cwd)
  const config = { ...defaultConfig, ...options(cwd), incremental: true }
  const plan = await planDeclarationProject(config)
  const producer = new BuildCache(config, plan.getResolutionFingerprint())
  producer.update(file, source, "import type { Hidden } from './hidden.js';\nexport interface Box { value: Hidden }\n", cwd)
  producer.save()
  const path = join(cwd, '.dtsx-cache/manifest.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  // A matching prior-format fixture, not a claim that a published SDK produced
  // these bytes. A separate retained probe reproduced actual version6 reuse.
  await writeFile(path, JSON.stringify({ ...manifest, version: 6 }))
  await expect(generate(config)).rejects.toThrow(/excluded/i)
  expect(await readFile(join(cwd, 'dist/a.d.ts'), 'utf8')).toBe('export declare const previousReady: string;\r\n')
  expect(await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')).toBe('export declare const previous: string;\r\n')
  expect(await readFile(join(cwd, 'dist/runtime.js'), 'utf8')).toBe('export const runtime = 7;\n')
  expect(await Bun.file(join(cwd, 'dist/hidden.d.ts')).exists()).toBe(false)
}))

for (const clean of [false, true]) {
  for (const policy of ['exclude', 'root'] as const) {
    test(`a same-format cache cannot bypass a changed ${policy} policy (clean=${clean})`, () => fixture(async (cwd) => {
      await writeFile(join(cwd, 'src/index.ts'), "import type { Hidden } from './hidden'\nexport interface Box { value: Hidden }\n")
      checkAuthoredSource(cwd)
      // Disabling auto-inclusion keeps the selected files and resolution graph
      // identical while the explicit exclusion policy changes.
      const config = { ...options(cwd, clean), incremental: true, autoIncludeReExports: false, failOnUnresolvedReExport: false, exclude: [] as string[], ...(policy === 'root' ? { entrypoints: [join(cwd, 'src/a.ts'), join(cwd, 'src/index.ts')], outputStructure: 'flat' as const, exclude: ['src/hidden.ts'] } : {}) }
      const first = await generate(config)
      const second = await generate(config)
      expect(first.filesGenerated).toBe(2)
      expect(second.filesGenerated).toBe(0)
      const manifest = JSON.parse(await readFile(join(cwd, '.dtsx-cache/manifest.json'), 'utf8'))
      expect(manifest.version).toBeGreaterThanOrEqual(6)
      const previousSibling = await readFile(join(cwd, 'dist/a.d.ts'), 'utf8')
      const previousIndex = await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')
      expect(previousIndex).toContain('./hidden.js')
      const excluded = policy === 'exclude' ? { ...config, exclude: ['hidden.ts'] } : { ...config, root: '.' }
      // The cold guard must reject the same policy without touching the cache.
      await expect(generate({ ...excluded, incremental: false })).rejects.toThrow(/excluded/i)
      await expect(generate(excluded)).rejects.toThrow(/excluded/i)
      expect(await readFile(join(cwd, 'dist/a.d.ts'), 'utf8')).toBe(previousSibling)
      expect(await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')).toBe(previousIndex)
      expect(await readFile(join(cwd, 'dist/runtime.js'), 'utf8')).toBe('export const runtime = 7;\n')
      expect(await Bun.file(join(cwd, 'dist/hidden.d.ts')).exists()).toBe(false)
    }))
  }
}
