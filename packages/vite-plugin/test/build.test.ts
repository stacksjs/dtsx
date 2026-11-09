import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'vite'

const pluginEntry = join(import.meta.dir, '..', 'src', 'index.ts')
const projects: string[] = []

/** A throwaway Vite project. It sits in this package so `@dtsx/dtsx` resolves. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(import.meta.dir, '.vite-project-'))
  projects.push(dir)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

/** Runs `vite build` in the project, loading its `vite.config.ts`. */
async function viteBuild(dir: string): Promise<void> {
  await build({ root: dir, configFile: join(dir, 'vite.config.ts'), logLevel: 'silent' })
}

function config(body: string): string {
  return `import { dts } from ${JSON.stringify(pluginEntry)}\nexport default ${body}\n`
}

function declarations(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[]).filter(file => file.endsWith('.d.ts')).sort()
}

const library = {
  'src/index.ts': `export { double } from './utils'\nexport const version = '1.0.0'\n`,
  'src/utils.ts': `export function double(value: number): number { return value * 2 }\n`,
}

afterEach(() => {
  for (const dir of projects.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('vite build with @dtsx/vite', () => {
  test('a library build keeps declarations next to the bundle', async () => {
    const dir = project({
      ...library,
      'vite.config.ts': config(`{ plugins: [dts()], build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' } } }`),
    })
    await viteBuild(dir)

    const dist = join(dir, 'dist')
    expect(existsSync(join(dist, 'index.js'))).toBe(true)
    expect(declarations(dist)).toEqual(['index.d.ts', 'utils.d.ts'])
    expect(readFileSync(join(dist, 'index.d.ts'), 'utf8')).toContain(`export declare const version: '1.0.0';`)
    expect(readFileSync(join(dist, 'utils.d.ts'), 'utf8')).toContain('export declare function double(value: number): number;')
  })

  test('declarations from an earlier build are replaced, not kept by luck', async () => {
    const dir = project({
      ...library,
      'dist/stale.d.ts': 'export declare const stale: 1;\n',
      'vite.config.ts': config(`{ plugins: [dts()], build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' } } }`),
    })
    await viteBuild(dir)
    expect(declarations(join(dir, 'dist'))).toEqual(['index.d.ts', 'utils.d.ts'])
  })

  test('a library entry at the project root does not declare the Vite config', async () => {
    const dir = project({
      'index.ts': `export const answer = 42\n`,
      'vite.config.ts': config(`{ plugins: [dts()], build: { lib: { entry: 'index.ts', formats: ['es'], fileName: 'index' } } }`),
    })
    await viteBuild(dir)
    expect(declarations(join(dir, 'dist'))).toEqual(['index.d.ts'])
  })

  test('without a library entry the source root is src', async () => {
    const dir = project({
      ...library,
      'scripts/release.ts': `export const tool = true\n`,
      'vite.config.ts': config(`{ plugins: [dts()], build: { rolldownOptions: { input: 'src/index.ts' } } }`),
    })
    await viteBuild(dir)
    expect(declarations(join(dir, 'dist'))).toEqual(['index.d.ts', 'utils.d.ts'])
  })

  test('several output formats generate once', async () => {
    const dir = project({
      ...library,
      'vite.config.ts': [
        `import { dts } from ${JSON.stringify(pluginEntry)}`,
        `export default { plugins: [dts({ onSuccess: () => { (globalThis as any).__dtsxRuns += 1 } })], build: { lib: { entry: 'src/index.ts', formats: ['es', 'cjs'], fileName: 'index' } } }`,
      ].join('\n'),
    })
    ;(globalThis as any).__dtsxRuns = 0
    await viteBuild(dir)
    expect((globalThis as any).__dtsxRuns).toBe(1)
    expect(declarations(join(dir, 'dist'))).toEqual(['index.d.ts', 'utils.d.ts'])
  })

  test('timing after generates once the bundle is written', async () => {
    const dir = project({
      ...library,
      'vite.config.ts': config(`{ plugins: [dts({ timing: 'after' })], build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' } } }`),
    })
    await viteBuild(dir)
    expect(declarations(join(dir, 'dist'))).toEqual(['index.d.ts', 'utils.d.ts'])
  })

  test('an explicit root and outdir are used as given', async () => {
    const dir = project({
      ...library,
      'vite.config.ts': config(`{ plugins: [dts({ root: '.', entrypoints: ['src/**/*.ts'], outdir: 'types' })], build: { lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index' } } }`),
    })
    await viteBuild(dir)
    expect(declarations(join(dir, 'types'))).toEqual(['src/index.d.ts', 'src/utils.d.ts'])
  })
})
