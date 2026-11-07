import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../src/config'
import { generate, processFile } from '../src/generator'
import { runTsc } from './helpers/tsc'

async function project(check: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dtsx-augmentation-project-'))
  try {
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, files: ['control.ts'] }))
    await writeFile(join(root, 'src/index.ts'), "import { install } from './provider.js'; export { create } from './api.js'; install();")
    await writeFile(join(root, 'src/base.ts'), 'export class Base implements Base {}')
    await writeFile(join(root, 'src/api.ts'), "import { Base } from './base.js'; export function create(): number { return 7 }")
    await writeFile(join(root, 'src/provider.ts'), "import { Base } from './base.js'; declare module './base.js' { interface Base { add: (a: number, b: number) => number } } export function install(): void { Base.prototype.add = (a: number, b: number) => a + b }")
    await check(root)
  }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function strict(root: string, module: string, augmented: boolean): Promise<void> {
  await writeFile(join(root, 'control.ts'), `import { create } from '${module}'; const value: number = create()${augmented ? '.add(1, 2)' : ''}; void value`)
  const result = runTsc(root, ['--project', 'tsconfig.json'])
  expect(result.ok, result.output).toBe(true)
}

test('incremental augmentation topology invalidates an unchanged barrel and reuses unchanged output', () => project(async (root) => {
  const options = { cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' as const, incremental: true }
  await strict(root, './src/index.js', false)
  await generate(options)
  const index = join(root, 'dist/index.d.ts')
  expect(await readFile(index, 'utf8')).not.toContain('provider.js')
  const originalBarrel = await readFile(join(root, 'src/index.ts'), 'utf8')
  const cached = await generate(options)
  expect(cached.filesGenerated).toBe(0)
  await writeFile(join(root, 'src/api.ts'), "import { Base } from './base.js'; export function create(): Base { return new Base() }")
  await strict(root, './src/index.js', true)
  const changed = await generate(options)
  expect(changed.filesFailed, JSON.stringify(changed.errors)).toBe(0)
  expect(await readFile(index, 'utf8')).toContain("import './provider.js';")
  expect(await readFile(join(root, 'src/index.ts'), 'utf8')).toBe(originalBarrel)
  await strict(root, './dist/index.js', true)
  expect((await generate(options)).filesGenerated).toBe(0)
  await writeFile(join(root, 'src/api.ts'), "import { Base } from './base.js'; export function create(): number { return 7 }")
  await strict(root, './src/index.js', false)
  await generate(options)
  expect(await readFile(index, 'utf8')).not.toContain('provider.js')
  await strict(root, './dist/index.js', false)
}))

for (const policy of ['excluded', 'not included'] as const) {
  test(`a required augmentation provider ${policy} by source policy fails before publication`, () => project(async (root) => {
    await writeFile(join(root, 'src/api.ts'), "import { Base } from './base.js'; export function create(): Base { return new Base() }")
    await strict(root, './src/index.js', true)
    await mkdir(join(root, 'dist'))
    await writeFile(join(root, 'dist/index.d.ts'), 'retain previous declaration')
    await writeFile(join(root, 'dist/runtime.js'), 'retain runtime')
    const options = { cwd: root, root: './src', outdir: './dist', entrypoints: policy === 'excluded' ? ['index.ts'] : ['index.ts', 'api.ts', 'base.ts'], moduleSpecifierMode: 'node' as const, clean: true, ...(policy === 'excluded' ? { exclude: ['provider.ts'] } : { autoIncludeReExports: false }) }
    await expect(generate(options)).rejects.toThrow('Module augmentation import')
    expect(await readFile(join(root, 'dist/index.d.ts'), 'utf8')).toBe('retain previous declaration')
    expect(await readFile(join(root, 'dist/runtime.js'), 'utf8')).toBe('retain runtime')
  }))
}

test('standalone file processing uses the same graph activation context without publishing', () => project(async (root) => {
  await writeFile(join(root, 'src/api.ts'), "import { Base } from './base.js'; export function create(): Base { return new Base() }")
  const result = await processFile(join(root, 'src/index.ts'), { ...config, cwd: root, root: './src', outdir: './dist', entrypoints: ['index.ts'], moduleSpecifierMode: 'node' })
  expect(result).toContain("import './provider.js';")
  expect(await Bun.file(join(root, 'dist/index.d.ts')).exists()).toBe(false)
}))
