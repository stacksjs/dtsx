import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dts } from '../../bun-plugin/src'
import { dts as coreDts } from '../src/plugins/bun'
import { defaultConfig } from '../src/config'
import { processFile } from '../src/generator'
import { isAvailable, runTsc } from './helpers/tsc'

interface PackedCase {
  source?: string
  core?: boolean
  custom?: boolean
  paths?: Record<string, string[]>
  baseUrl?: boolean
  arrayExtends?: boolean
  packageExtends?: boolean
  presetMetadata?: boolean
  flat?: boolean
  linkedRoot?: boolean
  blockedSelf?: boolean
}

async function packedCase(options: PackedCase = {}): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-local-alias-package-'))
  const library = join(directory, 'library')
  const consumer = join(directory, 'consumer')
  try {
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(consumer)
    const compilerOptions = options.baseUrl
      ? { baseUrl: './library', paths: options.paths ?? { 'local/*': ['./src/*'] } }
      : { paths: options.paths ?? { 'local/*': ['./library/src/*'] } }
    await writeFile(join(directory, 'tsconfig.base.json'), `/* inherited JSONC */\n${JSON.stringify({ compilerOptions }).slice(0, -1)},}`)
    let extended: string | string[] = '../tsconfig.base.json'
    if (options.arrayExtends) {
      await writeFile(join(library, 'second.json'), JSON.stringify({ compilerOptions: { isolatedDeclarations: false } }))
      extended = ['../tsconfig.base.json', './second.json']
    }
    if (options.packageExtends) {
      const preset = join(library, 'node_modules/@fixture/config')
      await mkdir(preset, { recursive: true })
      await writeFile(join(preset, 'package.json'), JSON.stringify(options.presetMetadata
        ? { name: '@fixture/config', main: './index.js', tsconfig: './base.json' }
        : { name: '@fixture/config', exports: { '.': './tsconfig.json' } }))
      if (options.presetMetadata) await writeFile(join(preset, 'index.js'), 'export const notAConfiguration = true')
      await writeFile(join(preset, options.presetMetadata ? 'base.json' : 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { 'local/*': ['../../../src/*'] } } }))
      extended = '@fixture/config'
    }
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify(options.custom ? { compilerOptions: { paths: { 'local/*': ['./wrong/*'] } } } : { extends: extended }))
    if (options.custom) await writeFile(join(library, 'custom.json'), JSON.stringify({ extends: '../tsconfig.base.json' }))
    await writeFile(join(library, 'package.json'), JSON.stringify({ name: 'alias-library', version: '1.0.0', type: 'module', files: ['dist'], exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' }, ...(options.blockedSelf ? { './*': './dist/*.js', './private': null } : {}) } }))
    await writeFile(join(library, 'src/index.ts'), options.source ?? `import type { Item } from 'local/types'; export function accept(value: Item): Item { return value }`)
    await writeFile(join(library, 'src/types.ts'), `import type { Detail } from 'local/detail'; export interface Item { detail: Detail }`)
    await writeFile(join(library, 'src/detail.ts'), `export interface Detail { value: string }`)
    await mkdir(join(library, 'src/wrong'))
    await writeFile(join(library, 'src/wrong/types.ts'), `export interface Item { detail: { value: number } }`)
    if (options.linkedRoot) await symlink(join(library, 'src'), join(library, 'linked'))

    const result = await Bun.build({
      entrypoints: [join(library, 'src/index.ts')],
      outdir: join(library, 'dist'),
      target: 'bun',
      plugins: [(options.core ? coreDts : dts)({ cwd: library, root: options.flat ? './not-present' : options.linkedRoot ? './linked' : './src', outdir: './dist', entrypoints: options.flat ? [join(library, 'src/index.ts')] : ['index.ts'], outputStructure: options.flat ? 'flat' : 'mirror', tsconfigPath: options.custom ? './custom.json' : './tsconfig.json' })],
    })
    expect(result.success).toBe(true)
    const pack = Bun.spawnSync([process.execPath, 'pm', 'pack', '--filename', join(directory, 'library.tgz')], { cwd: library })
    expect(pack.exitCode, pack.stderr.toString()).toBe(0)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'strict-consumer', private: true, type: 'module', dependencies: { 'alias-library': `file:${join(directory, 'library.tgz')}` } }))
    await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'Preserve', moduleResolution: 'Bundler', target: 'ESNext', strict: true, skipLibCheck: false, paths: {}, types: [], noEmit: true }, include: ['consumer.ts'] }))
    await writeFile(join(consumer, 'consumer.ts'), `import { accept } from 'alias-library'; const value: string = accept({ detail: { value: 'ok' } }).detail.value; export { value }`)
    const installed = Bun.spawnSync([process.execPath, 'install'], { cwd: consumer })
    expect(installed.exitCode, installed.stderr.toString()).toBe(0)
    expect(isAvailable).toBe(true)
    const checked = runTsc(consumer, ['--project', 'tsconfig.json'])
    expect(checked.ok, checked.output).toBe(true)
    expect(await readFile(join(consumer, 'node_modules/alias-library/dist/index.d.ts'), 'utf8')).not.toContain('local/types')
    expect(await readFile(join(consumer, 'node_modules/alias-library/dist/types.d.ts'), 'utf8')).toContain(`from './detail'`)
    expect((await readdir(join(library, 'src'))).sort()).toEqual(['detail.ts', 'index.ts', 'types.ts', 'wrong'])
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('the public Bun plugin packs inherited local alias types for a strict consumer with no source paths', async () => {
  await packedCase()
})

test('type-position alias imports include their transitive declarations in a strict packed consumer', async () => {
  await packedCase({ source: `export function accept(value: import('local/types').Item): import('local/types').Item { return value }` })
})

test('the core public Bun plugin honors an explicit custom config instead of the nearest default', async () => {
  await packedCase({ core: true, custom: true })
})

test('JSONC array inheritance retains the originating baseUrl, exact mappings and ordered target fallback', async () => {
  await packedCase({ baseUrl: true, arrayExtends: true, paths: { 'local/*': ['./src/wrong/*', './src/*'], 'local/types': ['./src/types.ts'] } })
})

test('the most specific wildcard mapping wins before less specific fallbacks', async () => {
  await packedCase({ baseUrl: true, paths: { 'local/*': ['./src/wrong/*', './src/*'], 'local/deep/*': ['./src/*'] }, source: `export function accept(value: import('local/deep/types').Item): import('local/deep/types').Item { return value }` })
})

test('package tsconfig extends resolves local alias targets relative to the declaring configuration', async () => {
  await packedCase({ packageExtends: true })
})

test('package tsconfig metadata selects the preset instead of its JavaScript main', async () => {
  await packedCase({ packageExtends: true, presetMetadata: true })
})

test('alias reexports and type-position imports share the emitted declaration graph', async () => {
  await packedCase({ source: `export type { Item } from 'local/types'; export function accept(value: import('local/types').Item): import('local/types').Item { return value }` })
})

test('flat output preserves absolute-entrypoint support without requiring a source-root directory', async () => {
  await packedCase({ flat: true })
})

test('multiline type imports preserve local alias reachability for packed consumers', async () => {
  await packedCase({ source: `import type {\n  Item,\n} from 'local/types'\nexport function accept(value: Item): Item { return value }` })
})

test('a package-local symlinked source root never redirects declarations into authored source paths', async () => {
  await packedCase({ linkedRoot: true })
})

test('a blocked self subpath is not mistaken for a public wildcard export', async () => {
  await packedCase({ blockedSelf: true, paths: { 'local/*': ['./library/src/*'], 'alias-library/private': ['./library/src/types.ts'] }, source: `import type { Item } from 'alias-library/private'; export function accept(value: Item): Item { return value }` })
})

test('configured private hash-prefix aliases do not become output URL fragments', async () => {
  await packedCase({ paths: { 'local/*': ['./library/src/*'], '#private/*': ['./library/src/*'] }, source: `import type { Item } from '#private/types'; export function accept(value: Item): Item { return value }` })
})

async function boundaryCase(run: (library: string, directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'dtsx-alias-boundary-'))
  const library = join(directory, 'library')
  try {
    await mkdir(join(library, 'src'), { recursive: true })
    await mkdir(join(directory, 'sibling/src'), { recursive: true })
    await writeFile(join(directory, 'sibling/package.json'), JSON.stringify({ name: '@stacksjs/sibling', exports: { '.': './src/index.ts' } }))
    await writeFile(join(directory, 'sibling/src/index.ts'), 'export interface Sibling { remote: true }')
    await writeFile(join(library, 'package.json'), JSON.stringify({
      name: 'boundary-package', type: 'module',
      exports: { '.': './dist/index.js', './public': './dist/public.js' },
      imports: { '#stable': './dist/stable.js' },
      dependencies: { 'external-api': '1.0.0' },
    }))
    await writeFile(join(library, 'src/private.ts'), 'export interface Private { secret: true }')
    await run(library, directory)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('public packages, workspace exports, self exports, imports and builtins keep their published identity', async () => {
  await boundaryCase(async (library) => {
    const specifiers = ['@stacksjs/sibling', 'external-api', 'boundary-package/public', '#stable', 'node:fs', 'bun']
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: Object.fromEntries(specifiers.map(name => [name, [name === '@stacksjs/sibling' ? '../sibling/src/index.ts' : './src/private.ts']])) } }))
    await writeFile(join(library, 'src/index.ts'), `
import type { Sibling } from '@stacksjs/sibling'
import type { External } from 'external-api'
import type { Self } from 'boundary-package/public'
import type { Stable } from '#stable'
import type { Stats } from 'node:fs'
import type { BunFile } from 'bun'
export interface API { sibling: Sibling; external: External; self: Self; stable: Stable; stats: Stats; file: BunFile }
`)
    const result = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'] })] })
    expect(result.success).toBe(true)
    const declaration = await readFile(join(library, 'dist/index.d.ts'), 'utf8')
    for (const name of specifiers) expect(declaration).toContain(`from '${name}'`)
    expect((await readdir(join(library, 'dist'))).sort()).toEqual(['index.d.ts', 'index.js'])
  })
})

for (const state of ['missing', 'sibling', 'symlink'] as const) {
  test(`a private alias with a ${state} target fails before deleting the previous declarations`, async () => {
    await boundaryCase(async (library, directory) => {
      if (state === 'symlink') await symlink(join(directory, 'sibling/src/index.ts'), join(library, 'src/linked.ts'))
      const target = state === 'missing' ? './absent.ts' : state === 'sibling' ? '../sibling/src/index.ts' : './src/linked.ts'
      await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: [target] } } }))
      await writeFile(join(library, 'src/index.ts'), `import type { Sibling } from 'hidden'; export interface API { value: Sibling }`)
      await mkdir(join(library, 'dist'))
      await writeFile(join(library, 'dist/previous.d.ts'), 'previous successful output')
      let failure: unknown
      try {
        await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'] })] })
      }
      catch (error) { failure = error }
      expect(String(failure)).toContain('alias "hidden"')
      expect(await readFile(join(library, 'dist/previous.d.ts'), 'utf8')).toBe('previous successful output')
    })
  })
}

test('a public declaration alias cannot point to a target deliberately excluded from emission', async () => {
  await boundaryCase(async (library) => {
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./src/private.ts'] } } }))
    await writeFile(join(library, 'src/index.ts'), `import type { Private } from 'hidden'; export interface API { value: Private }`)
    await mkdir(join(library, 'dist'))
    await writeFile(join(library, 'dist/previous.d.ts'), 'previous successful output')
    let failure: unknown
    try {
      await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], exclude: ['private.ts'] })] })
    }
    catch (error) { failure = error }
    expect(String(failure)).toContain('excluded from this package build')
    expect(await readFile(join(library, 'dist/previous.d.ts'), 'utf8')).toBe('previous successful output')
  })
})

test('module-looking documentation and string literals are not private alias edges', async () => {
  await boundaryCase(async (library) => {
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { 'hidden/*': ['./absent/*'] } } }))
    await writeFile(join(library, 'src/index.ts'), `
/** Example: import { Missing } from 'hidden/comment' */
export const example: "import('hidden/literal').Missing" = "import('hidden/literal').Missing"
`)
    const result = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'] })] })
    expect(result.success).toBe(true)
    const declaration = await readFile(join(library, 'dist/index.d.ts'), 'utf8')
    expect(declaration).toContain("from 'hidden/comment'")
    expect(declaration).toContain("import('hidden/literal').Missing")
  })
})

test('module-looking regular expressions are not private alias edges', async () => {
  await boundaryCase(async (library) => {
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./absent.ts'] } } }))
    await writeFile(join(library, 'src/index.ts'), 'export const pattern = /import("hidden")/;')
    const result = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'] })] })
    expect(result.success).toBe(true)
    expect(await readFile(join(library, 'dist/index.d.ts'), 'utf8')).toContain('pattern')
  })
})

test('incremental public builds invalidate declarations when only an alias target changes', async () => {
  await boundaryCase(async (library) => {
    await writeFile(join(library, 'src/index.ts'), `import type { Choice } from 'hidden'; export interface API { choice: Choice }`)
    await writeFile(join(library, 'src/a.ts'), 'export interface Choice { first: string }')
    await writeFile(join(library, 'src/b.ts'), 'export interface Choice { second: number }')
    const build = async (): Promise<void> => {
      const result = await Bun.build({ entrypoints: [join(library, 'src/index.ts')], outdir: join(library, 'dist'), target: 'bun', plugins: [coreDts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'], incremental: true })] })
      expect(result.success).toBe(true)
    }
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./src/a.ts'] } } }))
    await build()
    expect(await readFile(join(library, 'dist/index.d.ts'), 'utf8')).toContain(`from './a'`)
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./src/b.ts'] } } }))
    await build()
    expect(await readFile(join(library, 'dist/index.d.ts'), 'utf8')).toContain(`from './b'`)
  })
})

test('standalone processFile calls reread the effective config instead of retaining a prior alias mapping', async () => {
  await boundaryCase(async (library) => {
    const entry = join(library, 'src/index.ts')
    await writeFile(entry, `import type { Choice } from 'hidden'; export interface API { choice: Choice }`)
    await writeFile(join(library, 'src/a.ts'), 'export interface Choice { first: string }')
    await writeFile(join(library, 'src/b.ts'), 'export interface Choice { second: number }')
    const config = { ...defaultConfig, cwd: library, root: './src', outdir: './dist' }
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./src/a.ts'] } } }))
    expect(await processFile(entry, config)).toContain(`from './a'`)
    await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./src/b.ts'] } } }))
    expect(await processFile(entry, config)).toContain(`from './b'`)
  })
})

const regexStatementContexts = [
  { name: 'if header', statement: 'if (value) /import("hidden")/.test(value);' },
  { name: 'while header', statement: 'while (false) /import("hidden")/.test(value);' },
  { name: 'for header', statement: 'for (; false;) /import("hidden")/.test(value);' },
  { name: 'for-of header', statement: 'for (const entry of [value]) /import("hidden")/.test(entry);' },
  { name: 'else branch', statement: 'if (false) {} else /import("hidden")/.test(value);' },
  { name: 'do body', statement: 'do /import("hidden")/.test(value); while (false);' },
  { name: 'nested call and quoted parenthesis', statement: 'if (value.includes(")")) /import("hidden")/.test(value);' },
  { name: 'regex within the header', statement: 'if (/[)]/.test(value)) /import("hidden")/.test(value);' },
  { name: 'header comments', statement: 'if /* before */ (value /* inside */) /* after */ /import("hidden")/.test(value);' },
  { name: 'nested template within the header', statement: 'if (`[${value ? `(${value})` : ")"}]`) /import("hidden")/.test(value);' },
]

for (const { name, statement } of regexStatementContexts) {
  test(`public plugin distinguishes a regex statement after ${name} from a private import`, async () => {
    await boundaryCase(async (library) => {
      await writeFile(join(library, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { hidden: ['./absent.ts'] } } }))
      await writeFile(join(library, 'src/index.ts'), `export function check(value: string): boolean { ${statement} return true; }\nexport const after: number = 7`)
      const entrypoints = [join(library, 'src/index.ts')]
      const baseline = await Bun.build({ entrypoints, outdir: join(library, 'ordinary'), target: 'bun' })
      expect(baseline.success).toBe(true)
      const result = await Bun.build({ entrypoints, outdir: join(library, 'dist'), target: 'bun', plugins: [dts({ cwd: library, root: './src', outdir: './dist', entrypoints: ['index.ts'] })] })
      expect(result.success).toBe(true)
      const declaration = await readFile(join(library, 'dist/index.d.ts'), 'utf8')
      expect(declaration).toContain('function check(value: string): boolean')
      expect(declaration).toContain('after: number')
    })
  })
}

for (const expression of ['Math.max(4, 2)', '({ if: (value: number): number => value }).if(4)']) {
  test(`call-expression division after ${expression} preserves real type-import reachability`, async () => {
    await packedCase({ source: `export const quotient = ${expression} / 2; export function accept(value: import('local/types').Item): import('local/types').Item { return value }` })
  })
}

for (const name of ['if', 'while', 'for', 'catch']) {
  test(`private #${name} method division preserves the later public export in a strict packed consumer`, async () => {
    await packedCase({ source: `export class Calculate { #${name}(value: number): number { return value } value(): number { return this.#${name}(4) / 2 } }; export function accept(value: import('local/types').Item): import('local/types').Item { return value }` })
  })
}

for (const name of ['return', 'await', 'else', 'do']) {
  test(`private #${name} property division preserves the later public export in a strict packed consumer`, async () => {
    await packedCase({ source: `export class Calculate { #${name} = 4; value(): number { return this.#${name} / 2 } }; export function accept(value: import('local/types').Item): import('local/types').Item { return value }` })
  })
}
