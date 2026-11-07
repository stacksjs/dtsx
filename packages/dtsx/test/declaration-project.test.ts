import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/config'
import * as project from '../src/declaration-project'

// This seam proves source selection and intended output mapping without
// emission. Actual native delivery and installed consumers are separate gates.
test('project planning discovers mixed-kind dependencies without cleaning or writing outputs', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-declaration-plan-'))
  try {
    await Promise.all(['src/detail', 'src/nested', 'dist', '.dtsx-cache'].map(path => mkdir(join(cwd, path), { recursive: true })))
    const index = join(cwd, 'src/index.ts')
    const esm = join(cwd, 'src/detail/value.mts')
    const legacy = join(cwd, 'src/legacy.cts')
    const nested = join(cwd, 'src/nested/index.ts')
    await writeFile(index, "export type { Esm } from './detail/value.mjs'\nexport type { Legacy } from './legacy.cjs'\nexport type { Nested } from './nested'\n")
    await writeFile(esm, 'export interface Esm { count: number }\n')
    await writeFile(legacy, 'export interface Legacy { enabled: boolean }\n')
    await writeFile(nested, 'export interface Nested { name: string }\n')
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler' } }))
    await writeFile(join(cwd, 'dist/keep.txt'), 'existing output')
    await writeFile(join(cwd, 'dist/keep.d.ts'), 'declare const previous: unique symbol;\n')
    await writeFile(join(cwd, '.dtsx-cache/manifest.json'), '{"keep":"cache sentinel"}\n')
    expect(typeof project.planDeclarationProject).toBe('function')
    const plan = await project.planDeclarationProject({ ...defaultConfig, cwd, root: './src', outdir: './dist', entrypoints: ['index.ts'], clean: true, moduleSpecifierMode: 'node' })
    expect(plan.entryFiles).toEqual([index])
    expect(new Set(plan.files)).toEqual(new Set([index, esm, legacy, nested]))
    expect(plan.outputBySource.get(index)).toBe(join(cwd, 'dist/index.d.ts'))
    expect(plan.outputBySource.get(esm)).toBe(join(cwd, 'dist/detail/value.d.mts'))
    expect(plan.outputBySource.get(legacy)).toBe(join(cwd, 'dist/legacy.d.cts'))
    expect(plan.outputBySource.get(nested)).toBe(join(cwd, 'dist/nested/index.d.ts'))
    expect((await readdir(join(cwd, 'dist'))).sort()).toEqual(['keep.d.ts', 'keep.txt'])
    expect(await readFile(join(cwd, 'dist/keep.d.ts'), 'utf8')).toBe('declare const previous: unique symbol;\n')
    expect(await readFile(join(cwd, '.dtsx-cache/manifest.json'), 'utf8')).toBe('{"keep":"cache sentinel"}\n')
    expect(await Bun.file(join(cwd, '.gitignore')).exists()).toBe(false)
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
})

test('flat project output collisions fail without cleaning existing artifacts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-declaration-plan-collision-'))
  try {
    await Promise.all(['src/a', 'src/b', 'dist'].map(path => mkdir(join(cwd, path), { recursive: true })))
    await writeFile(join(cwd, 'src/a/value.ts'), 'export interface First { count: number }\n')
    await writeFile(join(cwd, 'src/b/value.ts'), 'export interface Second { name: string }\n')
    await writeFile(join(cwd, 'dist/keep.txt'), 'existing artifact')
    await writeFile(join(cwd, 'dist/keep.d.ts'), 'declare const priorArtifact: string;\n')
    await expect(project.planDeclarationProject({ ...defaultConfig, cwd, root: './src', outdir: './dist', entrypoints: ['**/*.ts'], outputStructure: 'flat', clean: true }))
      .rejects.toThrow('Output path collision:')
    expect((await readdir(join(cwd, 'dist'))).sort()).toEqual(['keep.d.ts', 'keep.txt'])
    expect(await readFile(join(cwd, 'dist/keep.d.ts'), 'utf8')).toBe('declare const priorArtifact: string;\n')
    expect(await readFile(join(cwd, 'dist/keep.txt'), 'utf8')).toBe('existing artifact')
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
})

test('planning keeps excluded reachable sources outside the output manifest without emitting or eagerly rejecting them', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dtsx-declaration-plan-exclusion-'))
  try {
    await mkdir(join(cwd, 'src'))
    const index = join(cwd, 'src/index.ts')
    const hidden = join(cwd, 'src/hidden.ts')
    await writeFile(index, "import type { Hidden } from './hidden'\nexport interface Box { value: Hidden }\n")
    await writeFile(hidden, 'export interface Hidden { count: number }\n')
    const plan = await project.planDeclarationProject({ ...defaultConfig, cwd, root: './src', outdir: './dist', entrypoints: ['index.ts'], exclude: ['hidden.ts'], moduleSpecifierMode: 'node' })
    expect(plan.files).toEqual([index])
    expect(plan.reachability?.reachable.has(hidden)).toBe(true)
    expect(plan.outputBySource.has(hidden)).toBe(false)
    expect(await Bun.file(join(cwd, 'dist/index.d.ts')).exists()).toBe(false)
  }
  finally { await rm(cwd, { recursive: true, force: true }) }
})
