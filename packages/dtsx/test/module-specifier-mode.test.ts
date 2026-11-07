import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config'
import { generate, processFile } from '../src/generator'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function createProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-module-specifier-mode-'))
  directories.push(cwd)
  await mkdir(join(cwd, 'src'))
  await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
  return cwd
}

for (const mode of ['default', 'preserve'] as const) {
  test(`${mode} output keeps existing extensionless declaration specifiers`, async () => {
    const cwd = await createProject()
    await writeFile(join(cwd, 'src/index.ts'), `export type { Value } from './value'`)
    await writeFile(join(cwd, 'src/value.ts'), 'export interface Value { count: number }')
    const config = { ...defaultConfig, cwd, root: './src', outdir: './dist', ...(mode === 'preserve' ? { moduleSpecifierMode: 'preserve' as const } : {}) }

    const declaration = await processFile(join(cwd, 'src/index.ts'), config)

    expect(declaration).toContain(`from './value'`)
    expect(declaration).not.toContain(`from './value.js'`)
  })
}

for (const [sourceExtension, runtimeExtension] of [['ts', 'js'], ['tsx', 'js'], ['mts', 'mjs'], ['cts', 'cjs']] as const) {
  test(`node output resolves a .${sourceExtension} target to .${runtimeExtension} independently of the importer`, async () => {
    const cwd = await createProject()
    await writeFile(join(cwd, 'src/index.ts'), `export type { Value } from './value'`)
    await writeFile(join(cwd, `src/value.${sourceExtension}`), 'export interface Value { count: number }')

    const declaration = await processFile(join(cwd, 'src/index.ts'), {
      ...defaultConfig,
      cwd,
      root: './src',
      outdir: './dist',
      moduleSpecifierMode: 'node',
    })

    expect(declaration).toContain(`from './value.${runtimeExtension}'`)
  })
}

test('node output retains written runtime extensions and URL suffixes', async () => {
  const cwd = await createProject()
  await writeFile(join(cwd, 'src/index.ts'), `
export type { Plain } from './plain.js'
export type { Module } from './module.mjs'
export type { Common } from './common.cjs'
export type Tagged = import('./plain?wire#tag').Plain
`)
  await writeFile(join(cwd, 'src/plain.ts'), 'export interface Plain { plain: true }')
  await writeFile(join(cwd, 'src/module.mts'), 'export interface Module { module: true }')
  await writeFile(join(cwd, 'src/common.cts'), 'export interface Common { common: true }')

  const declaration = await processFile(join(cwd, 'src/index.ts'), {
    ...defaultConfig,
    cwd,
    root: './src',
    outdir: './dist',
    moduleSpecifierMode: 'node',
  })

  expect(declaration).toContain(`from './plain.js'`)
  expect(declaration).toContain(`from './module.mjs'`)
  expect(declaration).toContain(`from './common.cjs'`)
  expect(declaration).toContain(`import('./plain.js?wire#tag')`)
})

for (const outputStructure of ['mirror', 'flat'] as const) {
  test(`node output maps directory indexes and type edges to emitted ${outputStructure} locations`, async () => {
    const cwd = await createProject()
    await mkdir(join(cwd, 'src/geometry'))
    await mkdir(join(cwd, 'src/parts'))
    await writeFile(join(cwd, 'src/entry.ts'), `
import type { Shape } from './geometry'
export interface PublicShape extends Shape { name: string }
export type { Widget } from './parts/widget'
export type LazyWidget = import('./parts/widget').Widget
export * from './format.mjs'
`)
    await writeFile(join(cwd, 'src/geometry/index.ts'), 'export interface Shape { size: number }')
    await writeFile(join(cwd, 'src/parts/widget.ts'), 'export interface Widget { enabled: boolean }')
    await writeFile(join(cwd, 'src/format.mts'), 'export const format: string = "shape"')

    const stats = await generate({
      cwd,
      root: './src',
      entrypoints: ['entry.ts'],
      outdir: './dist',
      outputStructure,
      moduleSpecifierMode: 'node',
      clean: true,
    })

    expect(stats.errors).toEqual([])
    expect(stats.filesFailed).toBe(0)
    const declaration = await readFile(join(cwd, 'dist/entry.d.ts'), 'utf8')
    const geometry = outputStructure === 'mirror' ? 'geometry/index' : 'index'
    const widget = outputStructure === 'mirror' ? 'parts/widget' : 'widget'
    expect(declaration).toContain(`from './${geometry}.js'`)
    expect(declaration).toContain(`from './${widget}.js'`)
    expect(declaration).toContain(`import('./${widget}.js')`)
    expect(declaration).toContain(`from './format.mjs'`)
    expect(await readFile(join(cwd, `dist/${geometry}.d.ts`), 'utf8')).toContain('interface Shape')
    expect(await readFile(join(cwd, `dist/${widget}.d.ts`), 'utf8')).toContain('interface Widget')
    expect(await readFile(join(cwd, 'dist/format.d.mts'), 'utf8')).toContain('format: string')
  })
}

test('incremental generation invalidates final declarations when the output policy changes', async () => {
  const cwd = await createProject()
  await writeFile(join(cwd, 'src/index.ts'), `export type { Value } from './value'`)
  await writeFile(join(cwd, 'src/value.ts'), 'export interface Value { count: number }')

  for (const moduleSpecifierMode of ['preserve', 'node', 'preserve'] as const) {
    const stats = await generate({ cwd, root: './src', entrypoints: ['index.ts'], outdir: './dist', incremental: true, moduleSpecifierMode })

    expect(stats.errors).toEqual([])
    expect(stats.filesGenerated).toBe(2)
    const declaration = await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')
    expect(declaration).toContain(moduleSpecifierMode === 'node' ? `from './value.js'` : `from './value'`)
  }
})

test('incremental node output re-resolves an unchanged importer when the target file kind changes', async () => {
  const cwd = await createProject()
  await writeFile(join(cwd, 'src/index.ts'), `export type { Value } from './value'`)
  await writeFile(join(cwd, 'src/value.ts'), 'export interface Value { count: number }')
  const config = { cwd, root: './src', entrypoints: ['index.ts'], outdir: './dist', incremental: true, moduleSpecifierMode: 'node' as const }

  const first = await generate(config)
  expect(first.errors).toEqual([])
  expect(await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')).toContain(`from './value.js'`)
  await rename(join(cwd, 'src/value.ts'), join(cwd, 'src/value.mts'))

  const second = await generate(config)
  expect(second.errors).toEqual([])
  expect(second.filesGenerated).toBe(2)
  expect(await readFile(join(cwd, 'dist/index.d.ts'), 'utf8')).toContain(`from './value.mjs'`)
  expect(await readFile(join(cwd, 'dist/value.d.mts'), 'utf8')).toContain('interface Value')
})
