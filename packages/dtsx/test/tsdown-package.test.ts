import type { TsdownPlugin } from 'tsdown'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { build } from 'tsdown'
import { dts } from '../src/plugins/tsdown'
import { runTsc } from './helpers/tsc'

const source = `import type { Hidden } from './hidden.js'
export class Calculate {
  #hidden = () => ({ value: 2 })
  value(): number { return this.#hidden().value }
}
export function create(): Hidden { return { value: 2 } }
`

for (const scenario of [
  { formats: ['esm'], fixedExtension: true },
  { formats: ['cjs'], fixedExtension: true },
  { formats: ['esm', 'cjs'], fixedExtension: true },
  { formats: ['esm'], fixedExtension: false },
] as const) {
  const { formats, fixedExtension } = scenario
  test(`tsdown ${formats.join('+')} (fixed extensions: ${fixedExtension}) preserves renamed nested entries in a strict installed package`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dtsx-tsdown-package-'))
    const library = join(directory, 'library')
    const consumer = join(directory, 'consumer')
    try {
      await mkdir(join(library, 'src'), { recursive: true })
      await mkdir(consumer)
      const exports: Record<string, { types: string, default: string }> = {}
      if (formats.some(format => format === 'esm')) exports.import = { types: `./dist/nested/renamed${fixedExtension ? '.d.mts' : '.d.ts'}`, default: `./dist/nested/renamed${fixedExtension ? '.mjs' : '.js'}` }
      if (formats.some(format => format === 'cjs')) exports.require = { types: './dist/nested/renamed.d.cts', default: './dist/nested/renamed.cjs' }
      await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'tsdown-contract', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': exports } }))
      await writeFile(join(library, 'src/index.ts'), source)
      await writeFile(join(library, 'src/hidden.ts'), 'export interface Hidden { value: number }')
      await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ESNext', types: [], strict: true, skipLibCheck: false }, include: ['src'] }))
      const authored = runTsc(library, ['--project', 'tsconfig.json'])
      expect(authored.ok, authored.output).toBe(true)
      const plugin: TsdownPlugin = dts()
      await build({ cwd: library, config: false, entry: { 'nested/renamed': 'src/index.ts' }, format: [...formats], fixedExtension, outDir: 'dist', plugins: [plugin], logLevel: 'silent', report: false })
      expect((await readdir(join(library, 'dist'))).sort()).toEqual(['nested'])
      const archive = join(directory, 'library.tgz')
      const packed = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', archive], { cwd: library })
      expect(packed.exitCode, packed.stderr.toString()).toBe(0)
      await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { 'tsdown-contract': `file:${archive}` } }))
      for (const args of [[], ['--frozen-lockfile']]) {
        const installed = Bun.spawnSync([process.execPath, 'install', ...args], { cwd: consumer })
        expect(installed.exitCode, installed.stderr.toString()).toBe(0)
      }
      const files: string[] = []
      for (const format of formats) {
        const extension = format === 'esm' ? 'mts' : 'cts'
        const runtimeExtension = format === 'esm' ? fixedExtension ? 'mjs' : 'js' : 'cjs'
        const declarationExtension = runtimeExtension === 'js' ? 'ts' : extension
        const declaration = await readFile(join(library, `dist/nested/renamed.d.${declarationExtension}`), 'utf8')
        expect(declaration).toContain('value(): number')
        expect(await readFile(join(consumer, `node_modules/tsdown-contract/dist/nested/renamed.d.${declarationExtension}`), 'utf8')).toBe(declaration)
        const runtime = Bun.spawnSync([process.execPath, '-e', `const api = await import('./node_modules/tsdown-contract/dist/nested/renamed.${runtimeExtension}'); if (new api.Calculate().value() !== 2 || api.create().value !== 2) process.exit(1)`], { cwd: consumer })
        expect(runtime.exitCode, runtime.stderr.toString()).toBe(0)
        const prefix = "import { Calculate, create } from 'tsdown-contract';\n"
        for (const [name, text] of [
          ['positive', 'const n: number = new Calculate().value(); const v: number = create().value;'],
          ['negative', 'const wrong: string = new Calculate().value();'],
          ['privacy', 'new Calculate().hidden;'],
        ]) {
          const file = `${name}.${extension}`
          files.push(file)
          await writeFile(join(consumer, file), prefix + text)
        }
      }
      await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, skipLibCheck: false, paths: {}, types: [], target: 'ESNext', module: 'NodeNext', moduleResolution: 'NodeNext' }, files }))
      const controls = runTsc(consumer, ['--project', 'tsconfig.json'])
      expect(controls.ok).toBe(false)
      const errors = [...controls.output.matchAll(/(negative|privacy)\.(?:mts|cts)\(\d+,\d+\): error (TS\d+)/g)].map(match => match[2]).sort()
      expect(controls.output.match(/error TS\d+/g)?.length, controls.output).toBe(formats.length * 2)
      expect(errors).toEqual(formats.flatMap(() => ['TS2322', 'TS2339']).sort())
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test('tsdown rebuilds with a reused plugin and preserves multiple entry aliases', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-tsdown-rebuild-'))
  try {
    await mkdir(join(directory, 'src'))
    await writeFile(join(directory, 'src/a.ts'), 'export const first = 1')
    await writeFile(join(directory, 'src/b.ts'), 'export const second = true')
    const plugin: TsdownPlugin = dts()
    const config = { cwd: directory, config: false as const, entry: { renamed: 'src/a.ts', 'nested/second': 'src/b.ts' }, outDir: 'dist', plugins: [plugin], logLevel: 'silent' as const, report: false as const }
    await build(config)
    expect(await readFile(join(directory, 'dist/renamed.d.mts'), 'utf8')).toContain('first: 1')
    expect(await readFile(join(directory, 'dist/nested/second.d.mts'), 'utf8')).toContain('second: true')
    await writeFile(join(directory, 'src/a.ts'), "export const first = 'changed'")
    await build(config)
    expect(await readFile(join(directory, 'dist/renamed.d.mts'), 'utf8')).toContain("first: 'changed'")
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('tsdown preserves declarations when entry IDs use a different directory alias from the root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-tsdown-entry-alias-'))
  try {
    const project = join(directory, 'project')
    const alias = join(directory, 'alias')
    await mkdir(join(project, 'src'), { recursive: true })
    await writeFile(join(project, 'src/index.ts'), source)
    await writeFile(join(project, 'src/hidden.ts'), 'export interface Hidden { value: number }')
    await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await build({
      cwd: await realpath(project),
      config: false,
      entry: { index: join(alias, 'src/index.ts') },
      inputOptions: { resolve: { symlinks: false } },
      plugins: [dts()],
      logLevel: 'silent',
      report: false,
    })
    const declaration = await readFile(join(project, 'dist/index.d.mts'), 'utf8')
    expect(declaration).toContain('value(): number')
    expect(declaration).toContain('interface Hidden')
    const runtime = Bun.spawnSync([process.execPath, '-e', "const { Calculate, create } = await import('./dist/index.mjs'); if (new Calculate().value() !== 2 || create().value !== 2) process.exit(1)"], { cwd: project })
    expect(runtime.exitCode, runtime.stderr.toString()).toBe(0)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('tsdown fails the build when a requested declaration entry is excluded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-tsdown-excluded-'))
  try {
    await writeFile(join(directory, 'index.ts'), 'export const value = 2')
    await expect(build({ cwd: directory, config: false, entry: ['index.ts'], plugins: [dts({ exclude: ['**/index.ts'] })], logLevel: 'silent', report: false })).rejects.toThrow()
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('tsdown watch emits updated declarations before reporting the rebuild complete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-tsdown-watch-'))
  let handle: Awaited<ReturnType<typeof build>> | undefined
  const initial = Promise.withResolvers<void>()
  const rebuilt = Promise.withResolvers<void>()
  let completed = 0
  try {
    await writeFile(join(directory, 'index.ts'), 'export const answer = 1')
    handle = await build({
      cwd: directory,
      config: false,
      entry: ['index.ts'],
      watch: true,
      plugins: [dts()],
      logLevel: 'silent',
      report: false,
      hooks: { 'build:done': () => { (++completed === 1 ? initial : rebuilt).resolve() } },
    })
    await initial.promise
    expect(await readFile(join(directory, 'dist/index.d.mts'), 'utf8')).toContain('answer: 1')
    await writeFile(join(directory, 'index.ts'), 'export const answer = 2')
    await rebuilt.promise
    expect(await readFile(join(directory, 'dist/index.d.mts'), 'utf8')).toContain('answer: 2')
  }
  finally {
    await handle?.watch.close()
    await rm(directory, { recursive: true, force: true })
  }
})
